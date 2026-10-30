    // ============================================================
    // 7.3 МОДУЛЬ: ЧАТ — сеть: перехватчики и живой поток
    // ============================================================
    // Вынесено из modules/chat.js (v11.6.0, этап 2 декомпозиции).
    // Слой-миксин: перехват fetch / EventSource / WebSocket, живой поток
    // /api/live и разбор входящих в общий Chat.handleIncoming().
    // this внутри методов — это Chat (Object.assign в chat/chat.js).

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

                        // Триггерим перерисовку списка игроков, если он открыт
                        if (typeof Players !== 'undefined' && Players.onOnlinePlayersUpdated) {
                            try { Players.onOnlinePlayersUpdated(); } catch(e) {}
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
        }
    };
