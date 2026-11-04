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
    // (Chat.popoutChat / renderMessages / interceptFetch для ui.js,
    // players.js и main.js) при этом не меняется.

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
        messages: [], // Массив всех сообщений
        activeMainTab: 'city',
        activeSubTab: 'general',
        // Ник узнаём из page-context (LG_CH) либо позже — асинхронно из syncMe().
        // Хардкод чужого ника опаснее пустого значения: до ответа /api/me лучше null.
        myNick: (typeof unsafeWindow !== 'undefined' && unsafeWindow.LG_CH?.name) || window.LG_CH?.name || null,
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

        get activeTab() {
            if (this.activeMainTab === 'mine' || this.activeMainTab === 'dm') return this.activeMainTab;
            return this.activeSubTab;
        },
        set activeTab(val) {
            if (val === 'mine' || val === 'dm') {
                this.activeMainTab = val;
            } else {
                this.activeMainTab = 'city';
                this.activeSubTab = val;
            }
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

        setDisabled(val) {
            this.disabled = !!val;
            try {
                localStorage.setItem('LEGION_CHAT_DISABLED', String(this.disabled));
            } catch (e) {}
            if (this.disabled) {
                this.stopBackgroundLiveListener();
                if (this.isOpen()) {
                    this.close();
                }
                UI.showToast('🚫 Перехват чата отключен');
            } else {
                UI.showToast('💬 Перехват чата включен');
                this.startBackgroundLiveListener();
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

        // v11.5.3: встроенный виджет чата удалён — его заменил сторонний плагин
        // Legion7TV (ProCto_Fliy). Здесь остаётся только то, что нужно нашему
        // вынесенному чату и перехватчикам:
        //   • кнопка «Вынести чат» и настройки 7TV;
        //   • эмоуты 7TV + синхронизация ника;
        //   • детектор внешнего чата.
        // interceptFetch / interceptEventSource / interceptWebSocket вызываются
        // из main.js сразу после init() — они идемпотентны и остаются включёнными.
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
            this.detectExternalChat();

            // v11.6.0g-3: подсветка ников пользователей аддона. Поллинг сам
            // шлёт POST /heartbeat (мы тоже в списке) и раз в 30 с обновляет
            // набор из GET /users; сеть и CSS-генератор — в chat-net.js.
            this.startAddonUsersPolling();

            // ТЗ 11.6.0h.2: подсветка из кэша применяется CSS-правилами, а не
            // классами в DOM. Браузер применит их к уже отрисованной ленте в
            // первом же кадре — ни флэша, ни ожидания ответа /users.
            if (typeof this._applyAddonStyles === 'function') this._applyAddonStyles();
        },

        // Детектор стороннего чата (Legion7TV, плагин ProCto_Fliy).
        // Статус рисуется строкой в FAB-меню; если плагина нет — даём ссылку.
        detectExternalChat() {
            setTimeout(() => {
                const statusEl = document.getElementById(DOM_IDS.externalChatStatus)
                    || document.getElementById('external-chat-status');
                if (!statusEl) return;

                // Проверяем, есть ли кнопка 7TV от плагина ProCto_Fliy
                const has7TVBtn = !!document.querySelector('.t7-btn');
                // Или проверяем флаг в unsafeWindow: после @grant объекты страницы
                // живут только там, обычный window их не видит.
                let has7TVWindow = false;
                try {
                    const pageWin = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
                    has7TVWindow = !!(pageWin && pageWin.LGChat && pageWin.LGChat.__t7);
                } catch (e) {}

                if (has7TVBtn || has7TVWindow) {
                    statusEl.innerHTML = `<span style="color:#4cc95a;">✅ Чат Legion7TV активен</span>`;
                } else {
                    statusEl.innerHTML = `<a href="https://github.com/mykhailkot-pixel/Legion7TV/raw/refs/heads/main/7tv-multidonate.user.js" target="_blank" style="color:#caa55c; text-decoration:underline;">Установить Legion7TV (чат)</a>`;
                }
            }, 2000);
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

                // Если этот диалог сейчас открыт во вкладке «✉️ ЛС» — считаем прочитанным.
                // Перерисовку выполняет Players.refreshUnreadDMViews() -> Chat.renderMessages().
                if (typeof Players !== 'undefined' && this.activeMainTab === 'dm' && this.dmTarget) {
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
         * Живой поток /api/live гасит сам shutdown (stopBackgroundLiveListener);
         * здесь — только таймер поллинга /heartbeat + /users. DOM-наблюдатель
         * нативной ленты удалён в 11.6.0h.2 (подсветку рисует CSS).
         */
        destroy() {
            this.stopAddonUsersPolling();
        },
    };

    // Подмешиваем слои. Объекты независимы и не пересекаются по ключам,
    // порядок важен лишь для читаемости: сначала данные, потом сеть, потом UI.
    Object.assign(Chat, ChatHistory);
    Object.assign(Chat, ChatNet);
    Object.assign(Chat, ChatPip);

    // Экспорт 7TV для отладки: window.__LEGION__.Chat.SevenTV
    Chat.SevenTV = SevenTV;
