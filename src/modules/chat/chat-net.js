    // ============================================================
    // 7.3 МОДУЛЬ: ЧАТ — сеть: перехватчики и живой поток
    // ============================================================
    // Вынесено из modules/chat.js (v11.6.0, этап 2 декомпозиции).
    // Слой-миксин: перехват EventSource / WebSocket, хуки нативной ленты
    // LGChatOne (ПАТЧ 11.6.4f: свой поток /api/live больше не открываем),
    // наблюдение за сетевой активностью игры (PerformanceObserver) и разбор
    // входящих в общий Chat.handleIncoming().
    // 11.6.4b: перехват window.fetch удалён — античит шахты палит подмену
    // fetch по отсутствию [native code] (см. блок «Наблюдение за сетевой
    // активностью игры» ниже).
    // this внутри методов — это Chat (Object.assign в chat/chat.js).

    // v11.6.0g-3: период поллинга «кто играет с аддоном» (ТЗ — раз в 30 с).
    // Один тик = POST /heartbeat + GET /users, окно онлайна на сервере 15 мин.
    const ADDON_USERS_POLL_MS = 30000;

    // ПАТЧ 11.6.4f: период Keep-Alive нативного чата. LGChatOne.sync() отправляет
    // POST /api/chat/watch {on:true} только при H.chat.open === true, а сервер
    // стримит сообщения в SSE лишь по watch. Свой поток мы больше не держим,
    // поэтому раз в 30 с возвращаем флаг открытия (Chat.startNativeChatWatch) —
    // но только пока открыт наш вынесенный чат (ПАТЧ 11.6.4g).
    const NATIVE_CHAT_KEEPALIVE_MS = 30000;

    // v11.6.1c: как часто спрашивать GET /latest-version (раз в час). Троттлинг
    // хранится в localStorage 'lgUpdateCheck', чтобы проверка не зависела от
    // перезапуска поллинга (переключение вкладок, повторный init чата).
    const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

    // 11.6.4b: минимальный интервал между нашими syncMe() по сигналу
    // PerformanceObserver. Игра зовёт /api/me часто (SSE `me`, действия, HUD),
    // а нам хватает знать логин и класс — 10 секунд более чем достаточно.
    const GAME_ME_SYNC_MS = 10000;

    // v11.6.0g-6: ключ доступа к нашему серверу. Должен совпадать с API_KEY в
    // server/index.js (env LGU_API_KEY). Это фильтр от случайных ботов, а не
    // секрет: значение лежит в публичной сборке аддона.
    const ADDON_API_KEY = 'LGU-default-secret-key-change-me';

    const ChatNet = {
        // id текущей шахты (обновляется из ленты LGChatOne и /api/mine/*).
        // ПАТЧ 11.6.4f: своего потока /api/live больше нет — состояние поллинга
        // и таймеры EventSource удалены вместе с startBackgroundLiveListener.
        currentMineId: 'home',

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

        /**
         * ПАТЧ 11.6.4f: приём ленты нативного чата игры.
         *
         * Свой EventSource('/api/live') больше НЕ открываем: клиент Legion сам
         * стримит чат, а LGChatOne.onFeed(room, data) / enterFeed(room, r)
         * получают уже разобранные пакеты комнаты (см. reference/.../site-chatone.js).
         * Хуки на эти колбэки ставит Chat.hookNativeChat(), а сюда приходит тот же
         * формат, что раньше разбирался из SSE: { chat, chatDel, chatMe, c }.
         *
         * @param {string}  room      'city' | 'mine'
         * @param {object}  data      пакет ленты (onFeed) или истории (enterFeed)
         * @param {boolean} isHistory true для enterFeed — историю не считаем непрочитанной
         */
        ingestGameFeed(room, data, isHistory = false) {
            if (!data) return;
            const loc = room === 'mine' ? 'mine' : 'city';
            try {
                if (data.c != null) this.currentMineId = data.c;

                // Игроков и входящие ЛС разбираем всегда — на них держатся
                // «Друзья» и тосты ЛС, даже при выключенном перехвате чата.
                Utils.updateOnlinePlayers(data, loc);
                Utils.processIncomingDMs(data);

                if (this.disabled) return;

                // data.chat — массив сообщений комнаты: в шахте игра помечает их
                // rm: 'mine' и префиксом id 'm:', остальные поля те же, что
                // понимает Utils.extractChatFields() (l/n — автор, t — текст, c — класс).
                const list = Array.isArray(data.chat) ? data.chat : [];
                list.forEach((m) => {
                    const parsed = Utils.extractChatFields(m);
                    if (!parsed.text) return;
                    const ch = parsed.channel || loc;
                    this.handleIncoming(
                        parsed.author || 'Игрок', parsed.text, !!isHistory,
                        parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw,
                        ch, parsed.k, parsed.to, parsed.rank
                    );
                });
            } catch (err) {
                dbg('[CHAT] ingestGameFeed error:', err);
            }
        },

        /**
         * @deprecated ПАТЧ 11.6.4f: свой EventSource и поллинг /api/live удалены.
         *
         * Имя сохранено как точка совместимости для main.js, chat-pip.js и
         * Chat.setDisabled(): раньше метод поднимал фоновый поток, теперь он
         * идемпотентно вешает хуки на нативную ленту и включает Keep-Alive.
         */
        startBackgroundLiveListener() {
            if (this.disabled) return;
            this.hookNativeChat();
            this.startNativeChatWatch();
        },

        /**
         * @deprecated ПАТЧ 11.6.4f: полная остановка перехвата (выключение чата в
         * настройках, restart скрипта). Снимает Keep-Alive и хуки, чтобы после
         * перезапуска на G.LGChatOne не остался колбэк в мёртвый инстанс Chat.
         */
        stopBackgroundLiveListener() {
            this.stopNativeChatWatch();
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

        /* ---------------------------------------------------------- */
        /* Наблюдение за сетевой активностью игры (11.6.4b)            */
        /* ---------------------------------------------------------- */
        // Античит шахты (reference/.../site/mine.js) считает подмену
        // window.fetch детектом:
        //   natv(window.fetch) === false && window.fetch !== LG_FETCH.w -> pi |= 1
        // Поэтому хук fetch снят полностью. Вместо него — пассивное наблюдение
        // через PerformanceObserver (тот же приём, что в modules/party.js для
        // /api/me и /api/qact): слушаем resource-записи браузера и НИЧЕГО не
        // перезаписываем — ни fetch, ни ответы.

        /** Слушатель resource-записей браузера. */
        _perfObserver: null,
        /** Date.now() последней синхронизации /api/me (троттлинг). */
        _lastMeSync: 0,

        /**
         * Поднимает наблюдатель за запросами игры. Идемпотентен.
         *
         * Что даёт без fetch-хука:
         *   • игра сходила в /api/me         -> наш syncMe() (ник и класс);
         *   • игра общается с городом/шахтой -> добираем хуки на LGChatOne
         *     (модуль site-chatone.js грузится лениво, на init() его могло не быть).
         *
         * Тела чужих ответов прочитать нельзя (PerformanceObserver отдаёт только
         * метаданные). Данные чата берём из колбэков нативного LGChatOne
         * (Chat.hookNativeChat -> ChatNet.ingestGameFeed), история города —
         * POST /api/city/enter в loadHistory(), топ шахты и «сколько народу в
         * шахте» — SSE-событием mine через Utils.updateOnlinePlayers().
         * Отдельный перехват ответов не нужен.
         */
        startNetworkObserver() {
            if (this._perfObserver) return;
            if (typeof PerformanceObserver !== 'function') {
                // Старые браузеры: остаёмся на хуках LGChatOne, деградация мягкая.
                dbg('[CHAT] PerformanceObserver не поддерживается — работаем без наблюдателя');
                return;
            }

            try {
                this._perfObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        const name = entry && entry.name ? entry.name : '';
                        // includes, а не ===: name — полный URL вида
                        // https://play.multidonate.ru/c/<канал>/api/me?...
                        if (name.includes('/api/me')) {
                            this._onGameMeTraffic();
                            break;
                        }
                        if (name.includes('/api/city/') || name.includes('/api/mine/') || name.includes('/api/live')) {
                            this._onGameChatTraffic();
                            break;
                        }
                    }
                });
                // buffered: false — прошлые записи не нужны, слушаем только новые.
                this._perfObserver.observe({ type: 'resource', buffered: false });
            } catch (e) {
                dbg('[CHAT] PerformanceObserver не запустился:', e);
                this._perfObserver = null;
            }
        },

        /** Гасит наблюдатель (выход, перезапуск скрипта). */
        stopNetworkObserver() {
            if (!this._perfObserver) return;
            try { this._perfObserver.disconnect(); } catch (e) {}
            this._perfObserver = null;
        },

        /**
         * Игра обновила /api/me — освежаем свой ник и класс своим запросом.
         *
         * Троттлинг GAME_ME_SYNC_MS: игру /api/me зовут часто (SSE `me`, любое
         * действие, HUD), а нам достаточно знать логин и класс. Свой запрос
         * тоже даёт resource-запись /api/me — троттлинг заодно не даёт
         * наблюдателю раскрутиться в бесконечный цикл.
         */
        _onGameMeTraffic() {
            const now = Date.now();
            if (now - this._lastMeSync < GAME_ME_SYNC_MS) return;
            this._lastMeSync = now;
            this.syncMe();
        },

        /**
         * Игра общается с городом/шахтой — значит, LGChatOne уже жив: модуль
         * site-chatone.js подгружается лениво (oneLoad() в app.js), поэтому на
         * момент Chat.init() его могло ещё не быть.
         *
         * ПАТЧ 11.6.4f: своего EventSource больше нет, так что здесь только
         * добираем хуки на нативную ленту (метод идемпотентен).
         */
        _onGameChatTraffic() {
            if (this.disabled) return;
            this.hookNativeChat();
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
                    // v11.6.0g-6: сервер пускает только с ключом (401 иначе).
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Legion-Key': ADDON_API_KEY
                    },
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
         * Канал игры (LG_CH.login) в нижнем регистре.
         *
         * v11.6.0g-5: это НЕ ник игрока, а логин Twitch-канала. Нужен только
         * затем, чтобы не подсвечивать служебные сообщения канала как
         * «пользователь аддона».
         */
        _channelLogin() {
            try {
                if (typeof G === 'undefined' || !G) return '';
                return String(G.LG_CH?.login || '').trim().toLowerCase();
            } catch (e) {
                return '';
            }
        },

        /**
         * Ник текущего игрока для heartbeat и подсветки (нижний регистр).
         *
         * v11.6.0g-5: источники только игровые — ME.user из page-context и,
         * как фолбэк, GET /api/me. LG_CH сюда не подмешивается: там логин
         * Twitch-канала, из-за которого отправлялся и подсвечивался чужой ник.
         *
         * @returns {Promise<string>} нормализованный логин либо '' (неизвестен)
         */
        async _resolveMyLogin() {
            // 1. Страница уже знает игрока — самый дешёвый и свежий путь.
            try {
                if (typeof G !== 'undefined' && G) {
                    const pageLogin = G.ME?.user?.login || G.ME?.user?.name;
                    if (pageLogin) return String(pageLogin).trim().toLowerCase();
                }
            } catch (e) {}

            // 2. Ник, полученный ранее (syncMe / собственный GET /api/me).
            // 11.6.4b: перехвата /api/me больше нет — данные берём своим запросом.
            if (this.myNick) {
                const known = String(this.myNick).trim().toLowerCase();
                if (known) return known;
            }

            // 3. Фолбэк: сам /api/me — ME в странице может быть ещё пуст, а
            // первый heartbeat откладывать нельзя. Результат кэшируем в myNick,
            // поэтому следующий тик пойдёт уже без запроса.
            try {
                const res = await Utils.fetchApi('/api/me');
                const user = res?.user || res?.body?.user;
                const login = user?.login || user?.name;
                if (login) {
                    const norm = String(login).trim().toLowerCase();
                    this.myNick = norm;
                    return norm;
                }
            } catch (e) {}

            return '';
        },

        /**
         * Отметка «я онлайн» + обновление списка пользователей аддона.
         *
         * POST /heartbeat {login, version} — чтобы нас видели другие (и чтобы
         * сервер знал версию аддона для GET /stats); GET /users — чтобы увидели
         * мы. Ошибки сети не всплывают тостом: сервер аддона может быть
         * недоступен, подсветка просто остаётся на прошлом наборе.
         */
        async syncAddonUsers() {
            // v11.6.1c: раз в час заодно спрашиваем сервер о новой версии.
            // Без await — уведомление не должно задерживать подсветку, а
            // собственные ошибки checkForUpdates() гасит внутри себя.
            this.checkForUpdates();
            // v11.6.0g-5: ник резолвится через ME.user / /api/me, LG_CH не в счёт.
            const nick = await this._resolveMyLogin();
            // Ник ещё не пришёл (/api/me в пути) — отправим на следующем тике.
            if (!nick) return;

            const base = this._addonBaseUrl();
            // Канал игры: его логин не должен попасть в список подсветки.
            const channel = this._channelLogin();

            try {
                // Версия из шапки userscript'а: GM_info доступен в песочнице
                // Tampermonkey и не зависит от игры (фолбэк 'unknown').
                const ver = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || 'unknown';
                await this._addonRequest('POST', base + '/heartbeat', { login: nick, version: ver });
                const data = await this._addonRequest('GET', base + '/users');
                const list = (data && Array.isArray(data.users)) ? data.users : [];

                const next = new Set();
                list.forEach((login) => {
                    const norm = String(login || '').trim().toLowerCase();
                    // Канал игры (G.LG_CH.login) — не игрок: служебные сообщения
                    // канала идут в нативной ленте с его data-nick, и подсветка
                    // «аддоном» на них была бы ложной (v11.6.0g-5).
                    if (!norm || norm === channel) return;
                    next.add(norm);
                });
                // Свой ник добавляем локально: heartbeat уже ушёл, а снимок
                // /users мог быть собран сервером до нашей вставки. nick уже
                // нормализован (нижний регистр) в _resolveMyLogin().
                next.add(nick);

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
        /* Проверка обновлений (ТЗ 11.6.1c)                           */
        /* ---------------------------------------------------------- */

        /**
         * Спрашивает GET /latest-version и, если на сервере версия новее,
         * показывает GM_notification со ссылкой на raw-сборку GitHub.
         *
         * Троттлинг — localStorage 'lgUpdateCheck' (раз в час). Хранилище
         * намеренно не GM-овское: это не настройка, а кэш момента проверки,
         * потеря которого стоит одного лишнего запроса.
         *
         * Ошибки не всплывают: старый сервер без эндпоинта ответит 404,
         * сервер может быть недоступен — тогда отметка времени не пишется и
         * проверка повторится на следующем тике поллинга.
         */
        async checkForUpdates() {
            try {
                const now = Date.now();
                const lastCheck = Number(localStorage.getItem('lgUpdateCheck') || 0) || 0;
                if (now - lastCheck <= UPDATE_CHECK_INTERVAL_MS) return;

                const base = this._addonBaseUrl();
                const res = await this._addonRequest('GET', base + '/latest-version');
                // Пустой ответ — не повод считать проверку выполненной.
                if (!res || !res.version) return;
                localStorage.setItem('lgUpdateCheck', String(now));

                // Своя версия — из шапки userscript'а. Без GM_info сравнение
                // невозможно (не Tampermonkey), поэтому просто выходим.
                const current = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '';
                if (!current) return;

                // numeric:true обязателен: лексикографически «11.6.10» < «11.6.9»,
                // а числовое сравнение даёт правильный порядок сегментов.
                const isNewer = String(res.version)
                    .localeCompare(String(current), undefined, { numeric: true, sensitivity: 'base' }) > 0;
                if (!isNewer) return;

                // GM_notification/GM_openInTab требуют @grant в шапке; проверка
                // typeof оставлена, чтобы в менеджере без этих API аддон не падал.
                // v11.6.1g: настройка «🔔 Уведомлять о новых версиях» (дефолт —
                // включено). Проверка версии выше всё равно выполняется, поэтому
                // троттлинг lgUpdateCheck обновляется, а уведомление просто не
                // показывается при выключенном тумблере.
                const notifyOn = localStorage.getItem('LEGION_UPDATE_NOTIFY') !== 'false';
                if (notifyOn && typeof GM_notification === 'function') {
                    GM_notification({
                        title: 'Legion Ultimate Assistant',
                        text: `Вышла новая версия ${res.version}. Нажмите, чтобы обновить.`,
                        onclick: () => {
                            if (typeof GM_openInTab === 'function') GM_openInTab(res.url);
                        }
                    });
                }
            } catch (e) {
                dbg('[CHAT] проверка обновлений не удалась:', e && e.message ? e.message : e);
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

            // v11.6.1c: бейдж «⚡» убран полностью. Он рисовался фоновой
            // SVG-картинкой (чтобы не портить textContent ника), но визуально
            // мешал и сдвигал ник вправо из-за padding-left. Осталось только
            // свечение text-shadow — оно не меняет ни разметку, ни ширину узла.
            return `
            ${nativeSel} {
                text-shadow: 0 0 4px currentColor, 0 0 10px currentColor !important;
            }
            ${pipSel} {
                text-shadow: 0 0 4px currentColor, 0 0 10px currentColor !important;
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
