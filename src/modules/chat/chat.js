    // ============================================================
    // 7. МОДУЛЬ: ЧАТ (фасад)
    // ============================================================
    // Чат разложен на независимые слои (src/modules/chat/):
    //   • chat-emotes.js — 7TV-смайлики и их кэш;
    //   • chat-history.js — localStorage-кэш и /api/city/enter;
    //   • chat-net.js — перехватчики сети и разбор входящих;
    //   • chat-pip.js — DOM/PiP-окно, рендер и отправка.
    // Слои — обычные объекты, методы которых рассчитывают на this === Chat,
    // поэтому склеиваются через Object.assign ниже. Внешний контракт
    // (Chat.popoutChat / renderMessages / startNetworkObserver для ui.js,
    // players.js и main.js) при этом не меняется.
    // 11.6.4b: interceptFetch удалён, его место занял startNetworkObserver.

    const Chat = {
        badge: null,
        unreadCount: 0,
        disabled: localStorage.getItem('LEGION_CHAT_DISABLED') === 'true',
        // v11.6.0h: подсветка ников пользователей аддона (⚡ + свечение в
        // родном цвете ника). Цвет НЕ перекрашивается — он остаётся игровым.
        // По умолчанию включена: ключа нет -> true; выключение пишет
        // строку 'false' (паттерн LEGION_AUC_SOUND). Настройка живёт в
        // localStorage, т.к. это UI-предпочтение, а не серверные данные.

        addonHighlight: localStorage.getItem('LEGION_ADDON_HIGHLIGHT') !== 'false',
        _inited: false,
        // ПАТЧ 11.6.4f: состояние хука нативной ленты LGChatOne и Keep-Alive.
        // _nativeChatOrig — оригинальные onFeed/enterFeed, чтобы снять хук при
        // выключении перехвата/перезапуске; _nativeWatchTimer — интервал watch.
        _nativeWatchTimer: null,
        _nativeChatOrig: null,
        messages: [], // Массив всех сообщений
        // ПАТЧ 11.6.4g: одна активная вкладка в терминах нативного чата игры
        // (reference/LegionFrontSRC/lib/site-chat.js: TABS = g/tr/mn/gl/dm).
        // Раньше было две оси — activeMainTab (city/mine/dm) и activeSubTab
        // (general/trade/ach): «Шахта» и «Торговля» жили в разных полях, и
        // подсветка вкладок рассинхронивалась.
        activeTab: 'g',
        // v11.6.0g-5: ник — это ME.user (page-context), а не LG_CH: в LG_CH
        // лежит логин Twitch-канала, из-за него в чат/HUD попадал чужой ник.
        // Если ME ещё пуст — ник придёт асинхронно из syncMe().
        // Хардкод чужого ника опаснее пустого значения: до ответа /api/me лучше null.
        myNick: (typeof unsafeWindow !== 'undefined' && (unsafeWindow.ME?.user?.login || unsafeWindow.ME?.user?.name)) || null,
        myRole: 'legionary',
        dmTarget: null, // Ник собеседника, с которым сейчас открыт диалог во вкладке ЛС
        currentMineId: 'home',
        SevenTV: ChatEmotes.SevenTV, // тот же объект, что и const SevenTV

        // v11.6.0g-3: ники, которые прямо сейчас играют с аддоном, в нижнем
        // регистре. Источник — GET /users сервера пати; наполняет
        // ChatNet.syncAddonUsers(). Пустой Set = подсветки нет.
        addonUsers: new Set(),

        /**
         * Есть ли ник в списке пользователей аддона.
         * Сервер отдаёт ники в нижнем регистре, а в сообщениях автор приходит
         * как в игре — поэтому сравниваем нормализованно.
         */
        isAddonUser(nick) {
            // Единый гейт подсветки. С v11.6.0h.2 нативную ленту красит CSS
            // (ChatNet._buildAddonStylesCss смотрит на addonHighlight сам),
            // а этот метод спрашивает PiP-рендер — по нему он ставит класс
            // .legion-addon-user (свечение) на .chat-author.
            if (this.addonHighlight === false) return false;
            if (!nick || this.addonUsers.size === 0) return false;
            return this.addonUsers.has(String(nick).trim().toLowerCase());
        },

        isOpen() {
            // Чат существует только внутри PiP-окна.
            // Опираемся на ссылки окно/документ, а не на isConnected: проверка
            // связности внутри PiP-документа нестабильна, из-за чего сообщения
            // при открытом чате продолжали копить непрочитанные.
            if (!this._popoutWin || this._popoutWin.closed) return false;
            return !!(this._pipDoc || this.widget);
        },

        getMineId() {
            return this.currentMineId 
                || (location.search.match(/[?&]c=([^&]+)/)?.[1]) 
                || 'home';
        },

        isInMine() {
            return !!document.querySelector('.mn-world') ||
                   !!document.querySelector('.mn-screen') ||
                   !!document.querySelector('.mn-heroes') ||
                   (location.pathname.includes('/mine') && location.search.includes('sid='));
        },

        /**
         * Вернуть нативный чат игры в шахту (v11.6.4d).
         *
         * LGChatOne — общий чат города/шахты: dock(k, root) регистрирует сцену,
         * а place() переносит блок в последнюю видимую. LGCity.open() заново
         * докает город, поэтому после «Карманного города» чат оставался в root
         * города под оверлеем `.mn` и в шахте не появлялся. Повторный
         * dock('mine') делает шахту последней и возвращает блок на место.
         *
         * Возвращает false, если шахта закрыта или LGChatOne недоступен —
         * это не ошибка (чат мог быть отключён настройками игры).
         */
        showForMine() {
            const mineRoot = document.querySelector('.mn');
            if (!mineRoot || !document.body.classList.contains('mn-on')) return false;
            const one = (typeof G !== 'undefined' && G) ? G.LGChatOne : null;
            if (!one || typeof one.dock !== 'function') return false;
            try {
                one.dock('mine', mineRoot); // dock() сам вызывает place()
                return true;
            } catch (e) {
                return false;
            }
        },

        /* ---------------------------------------------------------- */
        /* ПАТЧ 11.6.4f: хук нативной ленты LGChatOne                  */
        /* ---------------------------------------------------------- */

        /**
         * Перехват ленты нативного чата игры.
         *
         * Свой EventSource('/api/live') удалён: клиент Legion сам стримит чат и
         * отдаёт его разобранным в LGChatOne.onFeed(room, data) — новые сообщения
         * комнаты (city/mine) — и LGChatOne.enterFeed(room, r) — история при входе
         * в город/шахту. Формат пакета тот же, что приходил из SSE:
         * { chat: [...], chatDel: [...], chatMe, c }.
         *
         * Хук ставится ПОВЕРХ игры: сначала наш разбор, затем оригинал — поэтому
         * нативный чат продолжает работать как обычно (11.6.4g: он снова виден
         * на экране, мы его больше не скрываем и не подменяем).
         *
         * Модуль site-chatone.js грузится лениво (oneLoad() в reference/.../app.js),
         * поэтому метод идемпотентен и вызывается повторно из
         * ChatNet._onGameChatTraffic(), пока LGChatOne не появится.
         *
         * @returns {boolean} true, если хуки стоят на объекте игры
         */
        hookNativeChat() {
            const one = (typeof G !== 'undefined' && G) ? G.LGChatOne : null;
            if (!one || typeof one.onFeed !== 'function' || typeof one.enterFeed !== 'function') return false;
            // Уже обёрнут (этим или прежним инстансом, пока хуки не сняты).
            if (one.__lgChatHooked) return true;

            const self = this;
            // Сохраняем оригиналы: по ним же снимаем хук в unhookNativeChat().
            this._nativeChatOrig = { onFeed: one.onFeed, enterFeed: one.enterFeed };

            one.onFeed = function (room, data) {
                try { self.ingestGameFeed(room, data, false); } catch (e) {}
                return self._nativeChatOrig.onFeed.apply(this, arguments);
            };

            one.enterFeed = function (room, history) {
                try { self.ingestGameFeed(room, history, true); } catch (e) {}
                return self._nativeChatOrig.enterFeed.apply(this, arguments);
            };

            try { one.__lgChatHooked = true; } catch (e) {}
            dbg('[CHAT] Хук нативной ленты LGChatOne установлен');
            return true;
        },

        /**
         * Снять хуки с нативной ленты (выключение перехвата, restart скрипта).
         *
         * Возвращаем ровно те функции, что были до нас: иначе после перезапуска
         * аддона игра продолжала бы звать колбэк в мёртвый инстанс Chat.
         */
        unhookNativeChat() {
            const one = (typeof G !== 'undefined' && G) ? G.LGChatOne : null;
            const orig = this._nativeChatOrig;
            if (!one || !orig || !one.__lgChatHooked) return false;
            try {
                one.onFeed = orig.onFeed;
                one.enterFeed = orig.enterFeed;
                try { delete one.__lgChatHooked; } catch (e) { one.__lgChatHooked = false; }
            } catch (e) {
                return false;
            }
            this._nativeChatOrig = null;
            return true;
        },

        /**
         * Keep-Alive нативного чата (ТЗ 11.6.4f, раз в 30 с).
         *
         * LGChatOne.sync() отправляет POST /api/chat/watch {on:true} только когда
         * state().open === true, а сервер стримит сообщения в SSE лишь по watch.
         * Своей ленты у нас нет — сообщения приходят из хука onFeed, поэтому
         * watch нужно поддерживать живым.
         *
         * ПАТЧ 11.6.4g: нативный чат больше не скрыт CSS-ом, поэтому флаг open
         * навязываем ТОЛЬКО пока открыт наш вынесенный чат (Chat.isOpen()).
         * Если наш чат закрыт — нативные флаги не трогаем: игрок сам решает,
         * свернуть ему нативную ленту или оставить.
         */
        startNativeChatWatch() {
            if (this._nativeWatchTimer) return;
            const tick = () => {
                try {
                    const one = (typeof G !== 'undefined' && G) ? G.LGChatOne : null;
                    if (!one || typeof one.state !== 'function') {
                        // Модуль игры ещё не подгрузился — доберём хуки на следующем тике.
                        this.hookNativeChat();
                        return;
                    }
                    // Наш чат закрыт — не перебиваем выбор игрока по нативной ленте.
                    if (!this.isOpen()) return;
                    const st = one.state();
                    if (!st) return;
                    st.open = true;
                    if (typeof one.sync === 'function') one.sync();
                } catch (e) {}
            };
            tick();
            this._nativeWatchTimer = setInterval(tick, NATIVE_CHAT_KEEPALIVE_MS);
        },

        /** Остановка Keep-Alive и снятие хуков (Chat.destroy, выключение чата). */
        stopNativeChatWatch() {
            if (this._nativeWatchTimer) {
                clearInterval(this._nativeWatchTimer);
                this._nativeWatchTimer = null;
            }
            this.unhookNativeChat();
        },

        setDisabled(val) {
            this.disabled = !!val;
            try {
                localStorage.setItem('LEGION_CHAT_DISABLED', String(this.disabled));
            } catch (e) {}
            if (this.disabled) {
                // ПАТЧ 11.6.4f: своего потока /api/live нет — гасим Keep-Alive
                // и снимаем хуки с нативной ленты LGChatOne.
                this.stopNativeChatWatch();
                if (this.isOpen()) {
                    this.close();
                }
                UI.showToast('🚫 Перехват чата отключен');
            } else {
                UI.showToast('💬 Перехват чата включен');
                this.hookNativeChat();
                this.startNativeChatWatch();
            }
        },

        /**
         * Тумблер «⚡ Подсветка ников Legion» (ТЗ 11.6.0g-4, 11.6.0h.2).
         *
         * Сохраняем выбор и сразу перегенерируем CSS: пустая простыня снимает
         * подсветку со всех уже отрисованных ников мгновенно, без обхода DOM.
         * renderMessages() нужен только PiP-чату — там класс .legion-addon-user
         * ставит сам рендер.
         */
        setAddonHighlight(val) {
            this.addonHighlight = !!val;
            try {
                localStorage.setItem('LEGION_ADDON_HIGHLIGHT', String(this.addonHighlight));
            } catch (e) {}

            // ТЗ 11.6.0h.1: подсветку выключили — persist-кэш списка не нужен
            // (иначе после перезагрузки он бы «оживил» набор впустую). При
            // включении кэш заново запишет ближайший syncAddonUsers().
            if (!this.addonHighlight) {
                try { localStorage.removeItem('LEGION_ADDON_USERS_CACHE'); } catch (e) {}
            }

            // ТЗ 11.6.0h.2: переключение = одна перезапись <style>. Маркеров
            // data-legion-addon-applied в DOM больше нет — сбрасывать нечего.
            this._applyAddonStyles();
            if (this._pipDoc) this._applyAddonStylesToPip(this._pipDoc);
            if (this.isOpen && this.isOpen()) this.renderMessages();
        },

        /**
         * Тумблер «🎭 Отображать смайлы 7TV» (ТЗ 11.6.4e).
         *
         * Сам флаг живёт в localStorage (LEGION_7TV_DISABLED) и читается в точке
         * рендера — SevenTV.replaceEmotes()/decorate() — а также в SevenTV.load(),
         * поэтому выключение действует сразу и не требует перезагрузки страницы.
         * Здесь: сохраняем выбор, догружаем набор, если аддон стартовал с
         * выключенным тумблером, и перерисовываем открытый PiP-чат.
         */
        setSevenTVEnabled(val) {
            const enabled = !!val;
            try {
                localStorage.setItem(SevenTV.DISABLE_KEY, String(!enabled));
            } catch (e) {}

            // Набор не грузился, пока тумблер был выключен: load() сам вызовет
            // renderMessages() после успешной загрузки.
            if (enabled && !SevenTV.loaded) {
                SevenTV.load();
            }

            if (typeof this.isOpen === 'function' && this.isOpen() && typeof this.renderMessages === 'function') {
                this.renderMessages();
            }
        },

        // v11.5.3: встроенный виджет чата удалён — его заменил сторонний плагин
        // Legion7TV (ProCto_Fliy). Здесь остаётся только то, что нужно нашему
        // вынесенному чату и перехватчикам:
        //   • кнопка «Вынести чат» и настройки 7TV;
        //   • эмоуты 7TV + синхронизация ника;
        //   • детектор внешнего чата.
        // interceptEventSource / interceptWebSocket вызываются из main.js сразу
        // после init() — они идемпотентны и остаются включёнными. 11.6.4b:
        // interceptFetch удалён (античит шахты), вместо него startNetworkObserver.
        init() {
            if (this._inited) return;
            this._inited = true;

            // ТЗ 11.6.0h.1: сначала поднимаем прошлый список пользователей
            // аддона из localStorage — тогда подсветка появляется в первом же
            // кадре, не дожидаясь POST /heartbeat + GET /users. Кэш старше
            // часа (TTL) игнорируем: за это время состав мог поменяться, а
            // свежий набор придёт из syncAddonUsers() на первом тике.
            try {
                const raw = localStorage.getItem('LEGION_ADDON_USERS_CACHE');
                if (raw) {
                    const c = JSON.parse(raw);
                    if (Array.isArray(c?.list) && (Date.now() - (c.ts || 0)) < 60 * 60 * 1000) {
                        this.addonUsers = new Set(c.list.map(x => String(x).trim().toLowerCase()));
                    }
                }
            } catch (e) {}

            this.badge = document.getElementById(DOM_IDS.chatBadge) || document.getElementById('chat-badge');

            // btn-chat-pip — id из старой разметки FAB, оставлен для совместимости.
            (document.getElementById(DOM_IDS.btnPopout)
                || document.getElementById('btn-popout')
                || document.getElementById('btn-chat-pip'))?.addEventListener('click', () => this.popoutChat());

            // Настройки 7TV (канал и размер смайлов). В v11.5.3 кнопка FAB
            // «🎭 Канал 7TV» переехала в модалку UI.openSettings(), поэтому
            // эта привязка — только фолбэк для старой разметки.
            document.getElementById('btn-7tv-settings')?.addEventListener('click', () => this.open7tvSettings());

            // 7TV нужен PiP-чату: размер смайлов + набор эмоутов грузим один раз.
            SevenTV.loadSize();
            SevenTV.load();

            this.syncMe();

            // v11.6.0g-3: подсветка ников пользователей аддона. Поллинг сам
            // шлёт POST /heartbeat (мы тоже в списке) и раз в 30 с обновляет
            // набор из GET /users; сеть и CSS-генератор — в chat-net.js.
            this.startAddonUsersPolling();

            // ТЗ 11.6.0h.2: подсветка из кэша применяется CSS-правилами, а не
            // классами в DOM. Браузер применит их к уже отрисованной ленте в
            // первом же кадре — ни флэша, ни ожидания ответа /users.
            if (typeof this._applyAddonStyles === 'function') this._applyAddonStyles();

            // ПАТЧ 11.6.4f: фундамент нового чата. Нативный LGChatOne остаётся
            // в DOM (его place()/dock() перевешивают блок между городом и
            // шахтой — узел удалять нельзя). С 11.6.4g он снова виден на экране:
            // CSS-скрытие .cy-chat из styles.js удалено.
            // Ленту берём из его колбэков onFeed/enterFeed, а Keep-Alive держит
            // watch {on:true} включённым, иначе сервер не стримит сообщения.
            this.hookNativeChat();
            this.startNativeChatWatch();
        },

        getRoleMeta(role, isSystem) {
            if (isSystem) return { icon: '🏆', color: '#f0ad4e' }; // Для летописи/достижений
            const map = {
                'necromancer': { icon: '💀', color: '#b9a2ff' },
                'paladin': { icon: '🔨', color: '#f3d36b' },
                'priest': { icon: '✨', color: '#f0ad4e' },
                'mage': { icon: '🔮', color: '#5bc0de' },
                'rogue': { icon: '🗡️', color: '#d8bfd8' },
                'archer': { icon: '🏹', color: '#5cb85c' },
                'legionary': { icon: '🛡️', color: '#d9534f' },
            };
            return map[role] || { icon: '👤', color: '#ffcf6a' };
        },

        // Главная функция приема сообщений (§2.3 дедуп по id + дедуп своих исходящих)
        // isMine убран из сигнатуры: все вызовы передавали false, а свои сообщения
        // определяются по нику (isSelf) ниже.
        handleIncoming(author, text, isHistory = false, id = null, seq = null, role = null, isSystem = false, aw = null, channel = null, k = null, to = null, rank = null) {
            if (!text) return;

            // Перехват и фильтрация ЛС (не добавлять в общий чат)
            if (channel === 'dm' || k === 'dm') {
                // processIncomingDMs() уже вызвал Players.handleIncomingDM для этого
                // пакета (chat-net парсит входящие ЛС отдельно), поэтому историю
                // повторно в Players не отдаём — иначе дублируются тосты/счётчики.
                if (!isHistory && typeof Players !== 'undefined' && Players.handleIncomingDM) {
                    Players.handleIncomingDM(author, text, to);
                }

                // Пытаемся склеить с pending-сообщением из ЛС, чтобы оно не висело
                // в памяти черновиком (эхо приходит через тот же поток).
                if (this.myNick) {
                    for (let i = this.messages.length - 1; i >= 0; i--) {
                        const m = this.messages[i];
                        if (m._pending && m.k === 'dm' && m.text === text) {
                            m._pending = false;
                            break;
                        }
                    }
                }

                // Если этот диалог сейчас открыт во вкладке «✉️ Личные» — считаем прочитанным.
                // Перерисовку выполняет Players.refreshUnreadDMViews() -> Chat.renderMessages().
                if (typeof Players !== 'undefined' && this.activeTab === 'dm' && this.dmTarget) {
                    const myNick = (this.myNick || '').toLowerCase();
                    const isSelf = (author === 'Я') || (!!myNick && String(author || '').toLowerCase() === myNick);
                    const peer = isSelf ? (to || '') : (author || '');
                    if (peer && String(peer).toLowerCase() === String(this.dmTarget).toLowerCase()) {
                        Players.clearUnreadDM(peer);
                    }
                }
                return;
            }

            // 1. Если сообщение с таким ID уже есть и оно НЕ в статусе pending — это повтор из поллинга, пропускаем
            if (id && this.messages.slice(-100).some(m => m.id === id && !m._pending)) {
                return;
            }

            // 2. Дедупликация и сопоставление своих исходящих сообщений (_pending)
            const isSelf = author === this.myNick || (this.myNick && author && author.toLowerCase() === this.myNick.toLowerCase());
            if (isSelf) {
                let pendingMsg = null;
                for (let i = this.messages.length - 1; i >= 0; i--) {
                    const m = this.messages[i];
                    const authorMatch = m.author === author || m.author === this.myNick;
                    const textMatch = m.text === text;
                    // Pending-сообщение наше собственное: канал эха может отличаться
                    // (мы в шахте, а отправили в город), поэтому для _pending канал
                    // не проверяем — он останется тем, куда мы реально отправили.
                    const channelMatch = !channel || !m.channel || m.channel === channel || m._pending;
                    if (authorMatch && textMatch && channelMatch && (m._pending || (id && m.id === id))) {
                        pendingMsg = m;
                        break;
                    }
                }
                if (pendingMsg) {
                    pendingMsg._pending = false;
                    if (id && !pendingMsg.id) pendingMsg.id = id;
                    if (seq && !pendingMsg.seq) pendingMsg.seq = seq;
                    if (role && !pendingMsg.role) pendingMsg.role = role;
                    if (rank && !pendingMsg.rank) pendingMsg.rank = rank;
                    if (aw && !pendingMsg.aw) pendingMsg.aw = aw;
                    // НЕ ПЕРЕЗАПИСЫВАЕМ КАНАЛ, если он уже задан (например, 'city')
                    // Эхо может прийти как 'mine', если мы в шахте, но мы знаем, куда отправили.
                    if (!pendingMsg.channel && channel) pendingMsg.channel = channel;
                    // Своё сообщение тоже должно попасть в кэш: сюда мы приходим
                    // на эхо сервера, а основная ветка ниже уже пропускается.
                    if (!isHistory) this.cacheOwnMessage(pendingMsg);
                    this.renderMessages();
                    return;
                }
            }

            // 3. Дедупликация сообщений без ID (по автору и тексту за последние 8 секунд)
            if (!isHistory && !id) {
                if (this.messages.slice(-25).some(m => m.author === author && m.text === text && (m.channel === channel || !m.channel || !channel) && Date.now() - m.ts < 8000)) return;
            }

            const msgObj = { author, text, role, rank, isSystem, id, seq, aw, channel, k, to, ts: Date.now() };
            this.messages.push(msgObj);

            // Сохраняем в кэш только живые сообщения
            if (!isHistory) this.saveToStorage(author, text, role, isSystem, channel, k, aw, rank, id);

            // Ограничиваем массив, чтобы не копить память в долгих сессиях.
            // Срез делаем только при переполнении — это редкая операция.
            if (this.messages.length > 500) {
                this.messages = this.messages.slice(-500);
            }

            // Обновляем UI
            if (!isHistory) {
                this.renderMessages();
                // Скролл вниз выполняет renderMessages() и только если пользователь
                // уже был внизу — иначе чтение истории не прерывается.
                if (!this.isOpen() && !isSelf) {
                    this.unreadCount++;
                    this.updateBadge();
                }
            }
        },

        updateBadge() {
            const badges = document.querySelectorAll('#' + DOM_IDS.chatBadge + ', #' + DOM_IDS.fabChatBadge + ', #chat-badge, #fab-chat-badge');
            badges.forEach(b => {
                if (this.unreadCount > 0) {
                    b.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
                    b.style.display = 'block';
                } else {
                    // Сбрасываем и текст: иначе при повторном показе остаётся старый «99+».
                    b.textContent = '0';
                    b.style.display = 'none';
                }
            });
        },

        toggle() {
            if (this.disabled) {
                UI.showToast('🚫 Перехват чата отключен в меню 🐱', true);
                return;
            }
            // Обычного (встроенного) виджета больше нет: «открыть чат» = вынести в PiP.
            if (this.isOpen()) {
                try { this._popoutWin?.focus(); } catch (e) {}
                return;
            }
            this.popoutChat();
        },

        /**
         * Остановка фоновых задач чата (ТЗ 11.6.0g-3).
         *
         * Вызывается из legionApi.shutdown() в main.js при перезапуске скрипта.
         * Своего потока /api/live больше нет (ПАТЧ 11.6.4f): Keep-Alive и хуки
         * нативной ленты снимает stopNativeChatWatch(); здесь — таймер поллинга
         * /heartbeat + /users и PerformanceObserver. DOM-наблюдатель нативной
         * ленты удалён в 11.6.0h.2 (подсветку рисует CSS).
         */
        destroy() {
            this.stopAddonUsersPolling();
            // ПАТЧ 11.6.4f: снимаем Keep-Alive и хуки с нативной ленты — иначе
            // после перезапуска скрипта на G.LGChatOne остался бы колбэк в
            // мёртвый инстанс Chat (и лишний интервал каждые 30 с).
            this.stopNativeChatWatch();
            // 11.6.4b: гасим PerformanceObserver, иначе старый инстанс продолжал
            // бы слушать запросы игры (/api/me, /api/city, /api/mine) после
            // перезапуска скрипта.
            this.stopNetworkObserver();
        },
    };

    // Подмешиваем слои. Объекты независимы и не пересекаются по ключам,
    // порядок важен лишь для читаемости: сначала данные, потом сеть, потом UI.
    Object.assign(Chat, ChatHistory);
    Object.assign(Chat, ChatNet);
    Object.assign(Chat, ChatPip);

    // Экспорт 7TV для отладки: window.__LEGION__.Chat.SevenTV
    Chat.SevenTV = SevenTV;
