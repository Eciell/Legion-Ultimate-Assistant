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
    };

    // Подмешиваем слои. Объекты независимы и не пересекаются по ключам,
    // порядок важен лишь для читаемости: сначала данные, потом сеть, потом UI.
    Object.assign(Chat, ChatHistory);
    Object.assign(Chat, ChatNet);
    Object.assign(Chat, ChatPip);

    // Экспорт 7TV для отладки: window.__LEGION__.Chat.SevenTV
    Chat.SevenTV = SevenTV;
