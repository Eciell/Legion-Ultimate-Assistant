    // ============================================================
    // 7.3 МОДУЛЬ: ЧАТ — сеть: перехватчики и живой поток
    // ============================================================
    // Вынесено из modules/chat.js (v11.6.0, этап 2 декомпозиции).
    // Слой-миксин: перехват fetch / EventSource / WebSocket, живой поток
    // /api/live и разбор входящих в общий Chat.handleIncoming().
    // this внутри методов — это Chat (Object.assign в chat/chat.js).

    // v11.6.0g-3: период поллинга «кто играет с аддоном» (ТЗ — раз в 30 с).
    // Один тик = POST /heartbeat + GET /users, окно онлайна на сервере 15 мин.
    const ADDON_USERS_POLL_MS = 30000;

    const ChatNet = {
        // id текущей шахты (обновляется из /api/mine/* и /api/live).
        currentMineId: 'home',
        // Состояние живого потока /api/live.
        _liveES: null,
        _livePollTimer: null,
        _liveRunning: false,
        _liveConnecting: false,
        _livePollDelay: 2500,
        // TODO: REMOVE — пауза скрытой вкладки больше не используется:
        // поллинг полностью останавливается и поднимается по visibilitychange.
        _liveHiddenDelay: 5000,
        // Обработчик visibilitychange, который перезапускает поллинг после
        // возврата на вкладку. Ставится один раз в startBackgroundLiveListener().
        _visibilityHandler: null,

        _isLiveTabHidden() {
            // Стелс-режим удалён: просто читаем нативный document.hidden.
            return !!document.hidden;
        },

        getChannelLogin() {
            try {
                const m = location.pathname.match(/\/c\/([^/?#]+)/i);
                if (m && m[1]) return m[1].toLowerCase().trim();
                const paramC = new URL(location.href).searchParams.get('c');
                if (paramC && !/^\d+$/.test(paramC)) return paramC.toLowerCase().trim();
            } catch (e) {}
            return '';
        },

        isStreamerMessage(msg) {
            if (!msg || !msg.author) return false;
            const author = String(msg.author).toLowerCase().trim();
            const chLogin = this.getChannelLogin();
            if (!chLogin) return false;
            const chBase = chLogin.replace(/channel$/i, '');
            const authorBase = author.replace(/channel$/i, '');
            return author === chLogin || author === chBase || authorBase === chBase || authorBase === chLogin;
        },

        isMentionedMessage(msg) {
            if (!msg || !msg.text || !this.myNick) return false;
            const myNick = String(this.myNick).trim();
            if (!myNick || myNick.length < 2) return false;
            if (msg.author && String(msg.author).toLowerCase() === myNick.toLowerCase()) return false;
            const text = String(msg.text).toLowerCase();
            const lowerNick = myNick.toLowerCase();
            return text.includes('@' + lowerNick) || text.includes(lowerNick);
        },

        processMineMessages(list) {
            if (!list) return;
            const chats = Utils.extractChatDeep(list);
            let added = false;
            chats.forEach(m => {
                const parsed = Utils.extractChatFields(m);
                if (parsed.text) {
                    this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, 'mine', parsed.k, parsed.to, parsed.rank);
                    added = true;
                }
            });
            if (added) this.renderMessages();
        },

        processRawMessages(msgs) {
            if (!msgs || !Array.isArray(msgs)) return;
            msgs.forEach(m => {
                const { author, text, id, seq, role, rank, isSystem, aw, channel } = Utils.extractChatFields(m);
                if (!text) return;
                this.handleIncoming(author || 'Игрок', text, false, id, seq, role, isSystem, aw, channel, null, null, rank);
            });
        },

        // Определяем канал живого потока: город или шахта
        resolveLiveChannel(data) {
            try {
                const d = (data && (data.body || data.data || data)) || null;
                if (d) {
                    if (d.chatRoom === 'city' || d.town) return 'city';
                    if (d.chatRoom === 'mine' || d.mine) return 'mine';
                }
            } catch (e) {}
            return this.isInMine() ? 'mine' : 'city';
        },

        async startBackgroundLiveListener() {
            if (this.disabled || this._liveConnecting) return;

            // Возврат на вкладку: поллинг останавливается при document.hidden
            // (см. poll ниже), поэтому поток поднимаем заново по visibilitychange.
            if (!this._visibilityHandler) {
                this._visibilityHandler = () => {
                    if (!document.hidden && !this._liveRunning) {
                        this._livePollDelay = 2500;
                        this.startBackgroundLiveListener();
                    }
                };
                document.addEventListener('visibilitychange', this._visibilityHandler);
            }

            // Защита от дублирования: живой поток уже открыт или подключается.
            if (this._liveES && (this._liveES.readyState === 0 || this._liveES.readyState === 1)) return;
            // Уже идёт fetch-поллинг — второй цикл не запускаем.
            if (this._liveRunning && !this._liveES && this._livePollTimer) return;

            // Старое закрытое соединение закрываем перед созданием нового.
            if (this._liveES) {
                try { this._liveES.close(); } catch (e) {}
                this._liveES = null;
            }
            this._liveRunning = true;
            this._liveConnecting = true;

            const sid = new URL(location.href).searchParams.get('sid');
            const livePath = '/api/live' + (sid ? `?sid=${encodeURIComponent(sid)}` : '');
            // EventSource должен подключаться к /api/live без префикса канала:
            // Utils.apiPath() добавляет /c/<канал>/ и ломает поток.
            const url = livePath;

            const startPollingFallback = () => {
                if (!this._liveRunning || this._livePollTimer) return;
                this._liveConnecting = false; // EventSource не создаётся — уходим в поллинг
                dbg('Starting live fetch polling fallback...');
                const poll = async () => {
                    if (!this._liveRunning) return;
                    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                    const timeoutId = controller ? setTimeout(() => controller.abort(), 3000) : null;
                    let hasPayload = false;
                    try {
                        const curSid = new URL(location.href).searchParams.get('sid');
                        // Поллинг идёт на тот же чистый /api/live, что и EventSource (без /c/<канал>/)
                        const pollUrl = '/api/live' + (curSid ? `?sid=${encodeURIComponent(curSid)}` : '');
                        const res = await fetch(pollUrl, {
                            signal: controller ? controller.signal : undefined,
                            credentials: 'same-origin',
                            cache: 'no-store'
                        });
                        const text = await res.text();
                        let data = null;
                        try { data = JSON.parse(text); } catch (e) {}

                        // Если пришел поток SSE строками "data: {...}"
                        if (!data && text && text.includes('data:')) {
                            hasPayload = true;
                            const lines = text.split('\n');
                            for (const line of lines) {
                                if (line.startsWith('data:')) {
                                    try {
                                        const lineData = JSON.parse(line.slice(5).trim());
                                        const lineLoc = this.resolveLiveChannel(lineData);
                                        Utils.updateOnlinePlayers(lineData, lineLoc);
                                        Utils.processIncomingDMs(lineData);
                                        const chats = Utils.extractChatDeep(lineData);
                                        chats.forEach(m => {
                                            const parsed = Utils.extractChatFields(m);
                                            if (parsed.text) {
                                                this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, lineLoc, parsed.k, parsed.to, parsed.rank);
                                            }
                                        });
                                    } catch (err) {}
                                }
                            }
                        } else if (data) {
                            hasPayload = true;
                            const pollLoc = this.resolveLiveChannel(data);
                            Utils.updateOnlinePlayers(data, pollLoc);
                            Utils.processIncomingDMs(data);
                            if (data.c) this.currentMineId = data.c;
                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, pollLoc, parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                            }
                        }
                    } catch (e) {
                        dbg('Live poll error / abort:', e);
                    } finally {
                        // Бэкофф: пустые ответы не должны долбить /api/live каждые 2.5 с.
                        this._livePollDelay = hasPayload
                            ? 2500
                            : Math.min(30000, Math.max(2500, (this._livePollDelay || 2500) * 2));
                        if (timeoutId) clearTimeout(timeoutId);
                    }
                    if (!this._liveRunning) return;
                    // Не поллим, если вкладка скрыта и PiP не открыт.
                    const pipOpen = !!(this._popoutWin && !this._popoutWin.closed);
                    if (this._isLiveTabHidden() && !pipOpen) {
                        // Ждём разворота вкладки. Слушатель visibilitychange перезапустит poll,
                        // но только если _liveRunning снят — иначе startBackgroundLiveListener()
                        // посчитает поток уже запущенным и выйдет по гарду.
                        this._liveRunning = false;
                        this._livePollTimer = null;
                        return;
                    }
                    this._livePollTimer = setTimeout(poll, this._livePollDelay);
                };
                poll();
            };

            try {
                if (typeof EventSource !== 'undefined') {
                    const es = new EventSource(url, { withCredentials: true, _customLive: true });
                    this._liveES = es;
                    this._liveConnecting = false;

                    es.onopen = () => console.log('Live Connected!');

                    const handleData = (raw) => {
                        try {
                            let data = raw;
                            if (typeof data === 'string') {
                                try { data = JSON.parse(data); } catch(e) {}
                            }
                            const esLoc = this.resolveLiveChannel(data);
                            Utils.updateOnlinePlayers(data, esLoc);
                            Utils.processIncomingDMs(data);
                            if (data && data.c) this.currentMineId = data.c;
                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, esLoc, parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                            }
                        } catch (err) {
                            dbg('Live ES data error:', err);
                        }
                    };

                    es.onmessage = (e) => handleData(e.data);
                    // 'message' обрабатывается onmessage выше — второй раз не вешаем
                    ['chat', 'mine', 'live', 'event', 'update'].forEach(ev => {
                        try { es.addEventListener(ev, (e) => handleData(e.data)); } catch(e) {}
                    });

                    es.onerror = (e) => {
                        dbg('Live EventSource error, switching to fetch polling:', e);
                        try { es.close(); } catch(err) {}
                        this._liveES = null;

                        // Сбрасываем TTL для всех sse-записей (делаем их «протухшими»)
                        if (window.__lgOnlinePlayers) {
                            const now = Date.now();
                            for (const [nick, info] of window.__lgOnlinePlayers.entries()) {
                                if (info && info.src === 'sse') {
                                    // Сдвигаем timestamp в прошлое — они больше не считаются свежими
                                    info.ts = now - 200000; // больше TTL_CITY (180000)
                                }
                            }
                        }

                        startPollingFallback();
                    };
                } else {
                    startPollingFallback();
                }
            } catch (e) {
                dbg('Live EventSource init failed:', e);
                this._liveConnecting = false;
                startPollingFallback();
            }
        },

        stopBackgroundLiveListener() {
            this._liveRunning = false;
            this._liveConnecting = false;
            this._livePollDelay = 2500;
            // Снимаем слушатель разворота вкладки: при повторном старте он
            // будет поставлен заново (startBackgroundLiveListener).
            if (this._visibilityHandler) {
                document.removeEventListener('visibilitychange', this._visibilityHandler);
                this._visibilityHandler = null;
            }
            if (this._liveES) {
                try { this._liveES.close(); } catch(e) {}
                this._liveES = null;
            }
            if (this._livePollTimer) {
                clearTimeout(this._livePollTimer);
                this._livePollTimer = null;
            }
        },

        interceptEventSource() {
            if (this._esIntercepted) return;
            // @grant переводит Tampermonkey в sandbox: window — это прокси,
            // поэтому конструктор на странице патчим через unsafeWindow (G).
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const OrigES = pageWin.EventSource || window.EventSource;
            if (!OrigES || OrigES.__lgChatProxied) return;
            this._esIntercepted = true;
            const self = this;
            class ESProxy extends OrigES {
                constructor(...args) {
                    super(...args);
                    if (args[1]?._customLive) return;
                    const url = String(args[0] || '');
                    const isLive = url.includes('/api/live');
                    const isMine = isLive || url.includes('/api/mine/');

                    const handler = (e) => {
                        try {
                            let data = e.data;
                            if (typeof data === 'string') {
                                try { data = JSON.parse(data); } catch(err) {}
                            }
                            let loc = 'city';
                            if (isLive && data) {
                                const d = data.body || data.data || data;
                                // Используем общий метод, который понимает контекст
                                loc = self.resolveLiveChannel(d);
                            } else {
                                loc = isMine ? 'mine' : 'city';
                            }
                            // Перехват игроков для модуля «Друзья» (работает всегда)
                            Utils.updateOnlinePlayers(data, loc);
                            Utils.processIncomingDMs(data);

                            // Если перехват отключен — ничего не парсим (закрытый виджет не помеха).
                            if (self.disabled) return;

                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        const ch = parsed.channel || (loc === 'mine' ? 'mine' : 'city');
                                        Chat.handleIncoming(parsed.author || 'Игрок', parsed.text, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                            }
                        } catch (err) {
                            dbg('ES intercept error:', err);
                        }
                    };

                    this.addEventListener('message', handler);
                    // 'message' обрабатывается строкой выше — второй раз не вешаем
                    ['city', 'chat', 'say', 'init', 'mine', 'live', 'event', 'update'].forEach(ev => {
                        try { this.addEventListener(ev, handler); } catch(e) {}
                    });
                }
            }
            try { ESProxy.__lgChatProxied = true; } catch (e) {}
            try { pageWin.EventSource = ESProxy; } catch (e) {}
            if (pageWin !== window) { try { window.EventSource = ESProxy; } catch (e) {} }
        },

        interceptWebSocket() {
            if (this._wsIntercepted) return;
            // См. interceptEventSource: патчим конструктор страницы (unsafeWindow).
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const OrigWS = pageWin.WebSocket || window.WebSocket;
            if (!OrigWS || OrigWS.__lgChatProxied) return;
            this._wsIntercepted = true;
            const self = this;
            class WSProxy extends OrigWS {
                constructor(...args) {
                    super(...args);
                    const url = String(args[0] || '');
                    const isLive = url.includes('/api/live');
                    const isMine = isLive || url.includes('/api/mine/');

                    this.addEventListener('message', async (e) => {
                        try {
                            let data = e.data;
                            if (typeof Blob !== 'undefined' && data instanceof Blob) {
                                try {
                                    const text = await data.text();
                                    try { data = JSON.parse(text); } catch(err) { data = text; }
                                } catch (err) {}
                            } else if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
                                try {
                                    const text = new TextDecoder().decode(data);
                                    try { data = JSON.parse(text); } catch(err) { data = text; }
                                } catch (err) {}
                            } else if (typeof data === 'string') {
                                try { data = JSON.parse(data); } catch(err) {}
                            }

                            let loc = 'city';
                            if (isLive && data) {
                                const d = data.body || data.data || data;
                                // Используем общий метод, который понимает контекст
                                loc = self.resolveLiveChannel(d);
                            } else {
                                loc = isMine ? 'mine' : 'city';
                            }
                            // Перехват игроков для модуля «Друзья» (работает всегда)
                            Utils.updateOnlinePlayers(data, loc);
                            Utils.processIncomingDMs(data);

                            // Если перехват отключен — ничего не парсим.
                            // При закрытом виджете сообщения всё равно нужны (счётчик непрочитанных).
                            if (self.disabled) return;

                            // 1. Извлекаем сообщения через глубокий парсер extractChatDeep
                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        const ch = parsed.channel || (loc === 'mine' ? 'mine' : 'city');
                                        Chat.handleIncoming(parsed.author || 'Игрок', parsed.text, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                                return;
                            }

                            // 2. Строка вида Author: text
                            if (typeof data === 'string' && data.includes(':')) {
                                const i = data.indexOf(':');
                                const a = data.slice(0, i).trim();
                                const t = data.slice(i + 1).trim();
                                if (a && t && t.length < 500) {
                                    Chat.handleIncoming(a, t, false, null, null, null, false, null, loc);
                                }
                            }
                        } catch (err) {
                            dbg('WS intercept error:', err);
                        }
                    });
                }
            }
            try { WSProxy.__lgChatProxied = true; } catch (e) {}
            try { pageWin.WebSocket = WSProxy; } catch (e) {}
            if (pageWin !== window) { try { window.WebSocket = WSProxy; } catch (e) {} }
        },

        interceptFetch() {
            if (this._fetchIntercepted) return;
            // См. interceptEventSource: в sandbox патчим fetch страницы (unsafeWindow).
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const origFetch = pageWin.fetch || window.fetch;
            if (!origFetch || origFetch.__lgChatProxied) return;
            this._fetchIntercepted = true;
            const self = this;
            const wrappedFetch = async function(...args) {
                const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
                const res = await origFetch.apply(this, args);

                // Задача 3: Ранний выход при отправке сообщений (не клонировать и не парсить)
                if (url.includes('/api/city/say') || url.includes('/api/mine/chat/say')) {
                    return res;
                }

                // 0. Перехват живого потока, игроков онлайн и входящих ЛС (работает всегда)
                const isLive = url.includes('/api/live');
                if (url.includes('/api/city/') || url.includes('/api/mine/') || isLive) {
                    res.clone().json().then(data => {
                        if (data) {
                            const loc = url.includes('/api/mine/') ? 'mine' : (isLive ? self.resolveLiveChannel(data) : 'city');

                            // Задача 2 & Задача 4: общее количество и топ-игроки шахты из /api/mine/state
                            if (url.includes('/api/mine/state')) {
                                const d = data.body || data.data || data;
                                if (d) {
                                    if (typeof d.here === 'number') {
                                        window.__lgMineTotalHere = d.here;
                                    } else if (d.st && typeof d.st.here === 'number') {
                                        window.__lgMineTotalHere = d.st.here;
                                    }
                                    const topList = d.st?.top || d.top;
                                    if (Array.isArray(topList)) {
                                        const now = Date.now();
                                        topList.forEach(item => {
                                            const nick = (typeof item === 'string')
                                                ? item.trim()
                                                : (item && (item[0] || item.l || item.login || item.nick || item.name || item.n));
                                            if (nick && typeof nick === 'string' && nick.trim().length >= 2 && nick.trim().toLowerCase() !== 'me') {
                                                window.__lgOnlinePlayers.set(nick.trim().toLowerCase(), { loc: 'mine', ts: now });
                                            }
                                        });
                                    }
                                }
                            }

                            Utils.updateOnlinePlayers(data, loc);
                            Utils.processIncomingDMs(data);

                            // Чат живого потока разбираем только при включённом перехвате.
                            if (isLive && !self.disabled) {
                                if (data.c) self.currentMineId = data.c;
                                const chats = Utils.extractChatDeep(data);
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        self.handleIncoming(parsed.author || 'Игрок', parsed.text, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, loc, parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                            }

                            // История города из /api/city/enter: разбираем в этом же
                            // .then(), используя уже прочитанные data. Раньше ниже был
                            // отдельный блок со вторым res.clone().json() на тот же
                            // ответ — двойной парсинг и лишняя нагрузка.
                            // isHistory=true: это история, а не новое сообщение —
                            // в кэш/счётчик непрочитанных она попадать не должна
                            // (и ЛС отсюда повторно в Players не отдаются).
                            if (url.includes('/api/city/enter') && data.ok && Array.isArray(data.chat)) {
                                data.chat.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (!parsed.text) return;
                                    const ch = parsed.channel || 'city';
                                    // loadHistory() разбирает тот же ответ, поэтому
                                    // пропускаем то, что уже лежит в this.messages:
                                    // по id ИЛИ по автору+тексту (у старых сообщений
                                    // id может отсутствовать).
                                    const known = self.messages.some(cur =>
                                        (parsed.id && cur.id && cur.id === parsed.id) ||
                                        (!cur._pending && cur.author === parsed.author && cur.text === parsed.text &&
                                            (cur.channel || 'city') === ch)
                                    );
                                    if (known) return;
                                    self.handleIncoming(parsed.author, parsed.text, true, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to, parsed.rank);
                                });
                            }
                        }
                    }).catch(() => {});
                }

                try {
                    // 1. Отслеживание ID текущей шахты для навигации
                    if (url.includes('/api/mine/')) {
                        const mMatch = url.match(/[?&]c=([^&]+)/);
                        if (mMatch) {
                            try { self.currentMineId = decodeURIComponent(mMatch[1]); } catch(e){}
                        }
                    }

                    // 2. Профиль персонажа (/api/me)
                    if (url.includes('/api/me')) {
                        res.clone().json().then(data => {
                            const hero = data?.hero || data?.body?.hero || data?.me;
                            if (hero) {
                                window.__lgHero = hero;
                                if (hero.name) self.myNick = hero.name;
                                if (hero.class) self.myRole = hero.class;
                                const hud = document.getElementById(DOM_IDS.playerHud) || document.getElementById('legion-player-hud');
                                if (hud && hud.style.display !== 'none' && typeof UI !== 'undefined' && UI.renderPlayerHudContent) {
                                    UI.renderPlayerHudContent(hud, hero);
                                }
                            }
                        }).catch(() => {});
                    }

                    // Парсим чат всегда, если перехват не отключён.
                    // Закрытый виджет не помеха: сообщения нужны для счётчика непрочитанных.
                    if (self.disabled) {
                        return res;
                    }

                    // 4. Состояние шахты и вход в шахту (сообщения чата шахты в data.chat.chat или data.m)
                    if (url.includes('/api/mine/state') || url.includes('/api/mine/enter') || url.includes('/api/mine/chat')) {
                        res.clone().json().then(data => {
                            if (!data || !data.ok) return;
                            if (data.c) self.currentMineId = data.c;
                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        self.handleIncoming(parsed.author || 'Игрок', parsed.text, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, 'mine', parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                            }
                        }).catch(() => {});
                    }

                    // 5. Вход в город (/api/city/enter) — история чата разбирается
                    // в первом .then() этого перехватчика, отдельный res.clone()
                    // здесь больше не нужен (устранён двойной парсинг ответа).
                } catch(e) {}

                return res;
            };
            try { wrappedFetch.__lgChatProxied = true; } catch (e) {}
            try { pageWin.fetch = wrappedFetch; } catch (e) {}
            if (pageWin !== window) { try { window.fetch = wrappedFetch; } catch (e) {} }
        },

        /* ---------------------------------------------------------- */
        /* Подсветка пользователей аддона (v11.6.0g-3)                 */
        /* ---------------------------------------------------------- */

        // Таймер поллинга /heartbeat + /users.
        // ТЗ 11.6.0h.2: DOM-наблюдатель удалён — подсветку рисует CSS.
        _addonPollTimer: null,

        /**
         * База сервера аддона: сначала адрес пати (Party.getBaseUrl), затем
         * прод-домен. Party объявлен раньше чата (build.js: SHARED_MODULES
         * идут до CHAT_MODULES), но проверка на undefined оставлена — чат не
         * должен падать, если модуль пати когда-нибудь исключат из сборки.
         */
        _addonBaseUrl() {
            try {
                if (typeof Party !== 'undefined' && Party && typeof Party.getBaseUrl === 'function') {
                    const base = Party.getBaseUrl();
                    if (base) return String(base).trim().replace(/\/+$/, '');
                }
            } catch (e) {}
            return 'https://legion.ctrlfree.host';
        },

        /**
         * Запрос к серверу аддона через GM_xmlhttpRequest: домен чужой для
         * игры, обычный fetch упёрся бы в CORS и CSP `connect-src 'self'`
         * (см. AGENTS.md §3). Разбираем только JSON и только 2xx.
         */
        _addonRequest(method, url, body = null) {
            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest !== 'function') {
                    reject(new Error('GM_xmlhttpRequest недоступен: проверьте @grant в шапке'));
                    return;
                }
                GM_xmlhttpRequest({
                    method,
                    url,
                    headers: { 'Content-Type': 'application/json' },
                    data: body ? JSON.stringify(body) : undefined,
                    timeout: 8000,
                    onload: (res) => {
                        if (res.status < 200 || res.status >= 300) {
                            reject(new Error(`HTTP ${res.status}: ${url}`));
                            return;
                        }
                        try {
                            resolve(res.responseText ? JSON.parse(res.responseText) : null);
                        } catch (e) {
                            reject(new Error(`Некорректный JSON от ${url}`));
                        }
                    },
                    onerror: () => reject(new Error(`Сервер аддона недоступен: ${url}`)),
                    ontimeout: () => reject(new Error(`Сервер аддона не ответил за 8 с: ${url}`)),
                    onabort: () => reject(new Error('Запрос к серверу аддона отменён'))
                });
            });
        },

        /**
         * Отметка «я онлайн» + обновление списка пользователей аддона.
         *
         * POST /heartbeat {login} — чтобы нас видели другие; GET /users —
         * чтобы увидели мы. Ошибки сети не всплывают тостом: сервер аддона
         * может быть недоступен, подсветка просто остаётся на прошлом наборе.
         */
        async syncAddonUsers() {
            const nick = this.myNick ? String(this.myNick).trim() : '';
            // Ник ещё не пришёл (/api/me в пути) — отправим на следующем тике.
            if (!nick) return;

            const base = this._addonBaseUrl();

            try {
                await this._addonRequest('POST', base + '/heartbeat', { login: nick });
                const data = await this._addonRequest('GET', base + '/users');
                const list = (data && Array.isArray(data.users)) ? data.users : [];

                const next = new Set();
                list.forEach((login) => {
                    const norm = String(login || '').trim().toLowerCase();
                    if (norm) next.add(norm);
                });
                // Свой ник добавляем локально: heartbeat уже ушёл, а снимок
                // /users мог быть собран сервером до нашей вставки.
                next.add(nick.toLowerCase());

                const prev = this.addonUsers || new Set();
                const changed = next.size !== prev.size || Array.from(next).some((n) => !prev.has(n));
                this.addonUsers = next;

                // ТЗ 11.6.0h.1: persist-кэш списка. Нужен, чтобы после
                // перезагрузки страницы подсветка появилась мгновенно, не
                // дожидаясь ответа /users (см. Chat.init). TTL проверяется
                // при чтении — 1 час.
                try {
                    localStorage.setItem('LEGION_ADDON_USERS_CACHE', JSON.stringify({
                        list: Array.from(this.addonUsers),
                        ts: Date.now()
                    }));
                } catch (e) {}

                // ТЗ 11.6.0h.2: вместо обхода DOM и DOM-наблюдателя — просто
                // перегенерируем CSS-правила под новый список. Браузер применит
                // их к уже существующим <b data-nick> и к тем, которые игра
                // вставит позже, поэтому флэша при перерисовке ленты нет.
                this._applyAddonStyles();
                if (this._pipDoc) this._applyAddonStylesToPip(this._pipDoc);
                // Свой PiP-чат перерисовываем только при изменении состава:
                // innerHTML каждые 30 с сбивал бы выделение текста у читающего.
                if (changed && this.isOpen()) this.renderMessages();
            } catch (e) {
                dbg('[CHAT] подсветка аддона: синхронизация не удалась:', e && e.message ? e.message : e);
            }
        },

        /* ---------------------------------------------------------- */
        /* CSS-подсветка (ТЗ 11.6.0h.2)                               */
        /* ---------------------------------------------------------- */
        // DOM-наблюдатель, навешивание класса и вставка бейджа из JS удалены.
        // Вместо этого на каждый список /users генерируется одна CSS-простыня:
        // браузер сам применяет правила к любому <b data-nick="...">, даже если
        // игра полностью пересоздала DOM. Класс навешивать не нужно, поэтому
        // перерисовка ленты не может дать флэш «без подсветки».

        /**
         * Экранирование значения для строкового селектора атрибута.
         * Обратный слэш обязателен первым: иначе он «съест» следующую кавычку.
         */
        _cssAttrValue(nick) {
            return String(nick).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        },

        /**
         * Собирает CSS для текущего набора addonUsers.
         * Один источник и для основной страницы, и для PiP-документа.
         *
         * Флаг `i` в [data-nick="..." i] обязателен: addonUsers хранится в
         * нижнем регистре (сервер отдаёт логины нормализованными), а в
         * разметке игры ник стоит как в профиле — например, «BlackWolf».
         * Без `i` селектор не совпал бы и подсветки не было бы вообще.
         */
        _buildAddonStylesCss() {
            const nicks = Array.from(this.addonUsers || []);
            if (nicks.length === 0) return '';

            const esc = (n) => this._cssAttrValue(n);
            // Нативная лента игры: <b data-nick="login"> (reference/.../site-chat.js).
            const nativeSel = nicks.map(n => `b[data-nick="${esc(n)}" i]`).join(',');
            // Наш PiP-чат: <span class="chat-author" data-nick="login">.
            const pipSel = nicks.map(n => `.chat-author[data-nick="${esc(n)}" i]`).join(',');

            // v11.6.0h.3: «⚡» — не текст, а фоновая SVG-картинка. Псевдоэлемент
            // ::before добавлял символ в textContent узла, из-за чего игра
            // читала ник как "⚡nick": ломалось выделение текста и упоминание
            // по клику. background-image в разметку вообще не вмешивается —
            // textContent остаётся ровно "nick".
            // В data URI диез обязан быть %23, иначе браузер обрежет url по «#».
            return `
            ${nativeSel} {
                text-shadow: 0 0 4px currentColor, 0 0 10px currentColor !important;
                background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 16" width="12" height="16"><path d="M7 0L0 9h5v7l7-9H7z" fill="%23ffcf6a"/></svg>');
                background-repeat: no-repeat;
                background-position: left center;
                background-size: 10px 13px;
                padding-left: 14px !important;
            }
            ${pipSel} {
                text-shadow: 0 0 4px currentColor, 0 0 10px currentColor !important;
                background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 16" width="12" height="16"><path d="M7 0L0 9h5v7l7-9H7z" fill="%23ffcf6a"/></svg>');
                background-repeat: no-repeat;
                background-position: left center;
                background-size: 10px 13px;
                padding-left: 14px !important;
            }
        `;
        },

        /**
         * Создаёт/обновляет <style id="lg-addon-hl-styles"> в основной странице.
         * Одна запись textContent — браузер пересчитывает правила ровно один
         * раз за тик поллинга, а не на каждом узле ленты.
         */
        _applyAddonStyles() {
            const on = this.addonHighlight !== false;
            let style = document.getElementById('lg-addon-hl-styles');
            if (!on || this.addonUsers.size === 0) {
                // Тумблер выключен либо список пуст — простыня пустая,
                // подсветка исчезает мгновенно на всех уже отрисованных никах.
                if (style) style.textContent = '';
                return;
            }
            if (!style) {
                style = document.createElement('style');
                style.id = 'lg-addon-hl-styles';
                (document.head || document.documentElement).appendChild(style);
            }
            style.textContent = this._buildAddonStylesCss();
        },

        /**
         * То же самое для документа PiP-окна: у него свой DOM и свои стили.
         * Вызывать после создания PiP-окна и при каждом обновлении addonUsers.
         *
         * @param {Document} pipDoc документ PiP-окна (Chat._pipDoc)
         */
        _applyAddonStylesToPip(pipDoc) {
            if (!pipDoc || !pipDoc.head) return;
            const on = this.addonHighlight !== false;
            let style = typeof pipDoc.getElementById === 'function'
                ? pipDoc.getElementById('lg-addon-hl-styles')
                : null;
            if (!on || this.addonUsers.size === 0) {
                if (style) style.textContent = '';
                return;
            }
            if (!style) {
                style = pipDoc.createElement('style');
                style.id = 'lg-addon-hl-styles';
                pipDoc.head.appendChild(style);
            }
            style.textContent = this._buildAddonStylesCss();
        },

        /** Запуск поллинга /heartbeat + /users (раз в 30 с, идемпотентно). */
        startAddonUsersPolling() {
            if (this._addonPollTimer) return;

            // Первый тик сразу: ждать полминуты до первой подсветки незачем.
            // Наблюдателя за DOM здесь больше нет (ТЗ 11.6.0h.2) — подсветку
            // рисует CSS, который syncAddonUsers() перегенерирует сам.
            this.syncAddonUsers();

            this._addonPollTimer = setInterval(() => {
                this.syncAddonUsers();
            }, ADDON_USERS_POLL_MS);
        },

        /** Остановка поллинга (Chat.destroy). DOM-наблюдатель удалён — гасить нечего. */
        stopAddonUsersPolling() {
            if (this._addonPollTimer) {
                clearInterval(this._addonPollTimer);
                this._addonPollTimer = null;
            }
        },
    };
