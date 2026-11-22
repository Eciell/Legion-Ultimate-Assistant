    // ============================================================
    // МОДУЛЬ: ПРИСУТСТВИЕ ПОЛЬЗОВАТЕЛЕЙ АДДОНА (addon-presence.js)
    //
    // Вернули в 11.7.1.1 после удаления чата в 11.7.0: подсветка ников
    // пользователей аддона в НАТИВНОМ игровом чате.
    //
    // Схема:
    //   1. POST /heartbeat {login, version, clientToken} — отмечаем себя
    //      онлайн на legion.ctrlfree.host (раз в 30 с).
    //   2. GET /users -> {users: ["login", ...]} — список активных ников.
    //   3. Генерируем <style id="lg-addon-hl-styles"> с правилами
    //      b[data-nick="login" i] { text-shadow: ... currentColor }.
    //
    // Почему CSS, а не классы на узлах: игра перерисовывает ленту целиком
    // (reference/LegionFrontSRC/lib/site-chat.js: chatAppend/chatRender), и
    // классы слетали бы на каждом обновлении. Атрибутный селектор переживает
    // перерисовку и не трогает textContent ника (по нему работает нативное
    // контекстное меню и ответ @ник).
    //
    // clientToken стабилен (GM_getValue/GM_setValue): сервер резервирует ник
    // за первым токеном на 15 минут, иначе после перезагрузки страницы
    // отвечает 409 login_claimed и подсветка «пропадает» для самого игрока.
    // ============================================================
    const AddonPresence = {
        POLL_MS: 30000,
        CACHE_KEY: 'LEGION_ADDON_USERS_CACHE',
        TOKEN_KEY: 'lgClientToken',
        CACHE_TTL_MS: 60 * 60 * 1000, // 1 час, как в старом Chat
        STYLE_ID: 'lg-addon-hl-styles',

        // Ники в нижнем регистре — сервер отдаёт логины нормализованными.
        users: new Set(),
        _timer: null,
        _token: '',
        _myLogin: '',
        _syncBusy: false,
        _active: false,
        _wakeHandler: null,

        /** Только логин, без отображаемого user.name (сервер его не примет). */
        _normalizeLogin(value) {
            const login = String(value ?? '').trim().toLowerCase();
            return /^[a-z0-9_]{1,32}$/.test(login) ? login : '';
        },

        /**
         * Синхронные источники из page-context: ME и LG.me()/LG.hero().
         * ME и LG живут в page-context, поэтому читаем через G (= unsafeWindow).
         */
        _resolveLogin() {
            try {
                const direct = this._normalizeLogin(G?.ME?.user?.login);
                if (direct) return direct;
            } catch (e) {}

            try {
                const lg = G?.LG;
                const viaMe = (typeof lg?.me === 'function') ? lg.me()?.user?.login : '';
                const viaHero = (typeof lg?.hero === 'function') ? lg.hero()?.login : '';
                return this._normalizeLogin(viaMe) || this._normalizeLogin(viaHero);
            } catch (e) {}

            return '';
        },

        /**
         * Надёжный логин текущего игрока:
         *   1) G.ME.user.login;
         *   2) LG.me().user.login / LG.hero().login;
         *   3) прямой GET /c/<channel>/api/me (как Party._fetchMe).
         *
         * user.name сознательно не используется: это отображаемое имя, оно
         * может не пройти серверную валидацию ^[a-z0-9_]{1,32}$.
         */
        async _fetchLogin() {
            // Кэш на время сессии: сбрасывается в '' по visibilitychange/focus,
            // чтобы смена аккаунта в той же вкладке подхватилась сразу.
            if (this._myLogin) return this._myLogin;

            const direct = this._resolveLogin();
            if (direct) {
                this._myLogin = direct;
                return direct;
            }

            try {
                const channel = String(G?.LG_CH?.login || '').trim();
                if (!channel) return '';

                const res = await fetch(`/c/${encodeURIComponent(channel)}/api/me`, {
                    credentials: 'include',
                    cache: 'no-store'
                });
                const data = await res.json().catch(() => null);
                const login = this._normalizeLogin(data?.user?.login);
                if (!res.ok || !login) return '';

                this._myLogin = login;
                return login;
            } catch (e) {
                return '';
            }
        },

        /** Для диагностики: последний валидный логин либо пустая строка. */
        getMyLogin() {
            return this._myLogin || '';
        },

        /** Канал игры — не игрок: его сервисные сообщения не подсвечиваем. */
        _channelLogin() {
            try {
                return String(G?.LG_CH?.login || '').trim().toLowerCase();
            } catch (e) {
                return '';
            }
        },

        /**
         * Новый clientToken. crypto.randomUUID() даёт 36 символов и проходит
         * серверную проверку [A-Za-z0-9_-]{16,128}. Фолбэк — base36-строка.
         */
        _newToken() {
            try {
                if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                    const uuid = crypto.randomUUID();
                    if (typeof uuid === 'string' && uuid.length >= 16) return uuid;
                }
            } catch (e) {}
            let rand = '';
            while (rand.length < 16) rand += Math.random().toString(36).slice(2);
            return 'lgu-' + rand;
        },

        /**
         * Стабильный токен клиента: GM-хранилище, затем localStorage.
         * Новый генерируется только если сохранённого нет или он короче 16.
         */
        getClientToken() {
            if (this._token) return this._token;

            let token = '';
            try {
                if (typeof GM_getValue === 'function') {
                    token = String(GM_getValue(this.TOKEN_KEY, '') || '').trim();
                }
            } catch (e) {}
            if (token.length < 16) {
                try {
                    token = String(localStorage.getItem(this.TOKEN_KEY) || '').trim();
                } catch (e) {}
            }
            if (token.length < 16) {
                token = this._newToken();
                try {
                    if (typeof GM_setValue === 'function') GM_setValue(this.TOKEN_KEY, token);
                } catch (e) {}
                try { localStorage.setItem(this.TOKEN_KEY, token); } catch (e) {}
            }

            this._token = token;
            return token;
        },

        _loadCache() {
            if (!Settings.get('addonHighlight')) return;
            try {
                const raw = localStorage.getItem(this.CACHE_KEY);
                if (!raw) return;
                const cache = JSON.parse(raw);
                if (!Array.isArray(cache?.list)) return;
                if ((Date.now() - Number(cache.ts || 0)) > this.CACHE_TTL_MS) return;

                const next = new Set();
                cache.list.forEach((nick) => {
                    const key = String(nick || '').trim().toLowerCase();
                    if (key) next.add(key);
                });
                if (next.size) this.users = next;
            } catch (e) {}
        },

        _saveCache() {
            if (!Settings.get('addonHighlight')) return;
            try {
                localStorage.setItem(this.CACHE_KEY, JSON.stringify({
                    list: Array.from(this.users),
                    ts: Date.now()
                }));
            } catch (e) {}
        },

        _clearCache() {
            try { localStorage.removeItem(this.CACHE_KEY); } catch (e) {}
        },

        /**
         * Один тик: heartbeat + users. Ошибки сети не всплывают тостом —
         * подсветка просто остаётся на прошлом наборе/кэше.
         */
        async sync() {
            if (this._syncBusy) return;
            this._syncBusy = true;

            try {
                const login = await this._fetchLogin();
                if (!login) return;

                const version = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version)
                    ? String(GM_info.script.version)
                    : 'unknown';

                // Party._request уже умеет GM_xmlhttpRequest + X-Legion-Key.
                // auth:false — запрос не зависит от активной сессии пати и
                // 401/403/404 не трактуются как «пати распалась».
                //
                // v11.7.2: heartbeat в собственном try/catch. 409 login_claimed
                // или временная ошибка сети не должны блокировать GET /users —
                // иначе один сбой heartbeat гасит подсветку до следующего тика.
                try {
                    await Party._request('POST', '/heartbeat', {
                        auth: false,
                        body: { login, version, clientToken: this.getClientToken() }
                    });
                } catch (e) {
                    dbg('[PRESENCE] heartbeat не прошёл:', e && e.message ? e.message : e);
                }

                const data = await Party._request('GET', '/users', { auth: false });
                const list = Array.isArray(data?.users) ? data.users : [];
                const channel = this._channelLogin();

                const next = new Set();
                list.forEach((nick) => {
                    const key = String(nick || '').trim().toLowerCase();
                    if (!key || key === channel) return;
                    next.add(key);
                });
                // Свой ник добавляем локально: heartbeat уже ушёл, а снимок
                // /users мог быть собран сервером до нашей вставки.
                next.add(login);

                this.users = next;
                this._saveCache();

                // После stop() ответ может прийти уже «в никуда» — не
                // воскрешаем <style> и не трогаем DOM.
                if (!this._active) return;
                this._applyStyles();
            } catch (e) {
                dbg('[PRESENCE] синхронизация не удалась:', e && e.message ? e.message : e);
            } finally {
                this._syncBusy = false;
            }
        },

        /** Экранирование значения для строкового CSS-селектора. */
        _cssAttrValue(nick) {
            return String(nick).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        },

        /**
         * Перестраивает простыню подсветки. Цвет НЕ переопределяем: игра
         * сама красит ники через nickColor() в site-chat.js, а text-shadow
         * с currentColor даёт свечение ровно в родном цвете игрока.
         */
        _applyStyles() {
            if (!this._active) return;

            const on = Settings.get('addonHighlight');
            let style = document.getElementById(this.STYLE_ID);

            if (!on || this.users.size === 0) {
                if (style) style.textContent = '';
                if (!on) this._clearCache();
                return;
            }

            if (!style) {
                style = document.createElement('style');
                style.id = this.STYLE_ID;
                (document.head || document.documentElement).appendChild(style);
            }

            const selectors = [];
            this.users.forEach((nick) => {
                const key = String(nick || '').trim().toLowerCase();
                if (!key) return;
                selectors.push(`b[data-nick="${this._cssAttrValue(key)}" i]`);
            });

            style.textContent = selectors.length
                ? `${selectors.join(',\n')} {\n    text-shadow: 0 0 4px currentColor, 0 0 10px currentColor !important;\n}\n`
                : '';
        },

        /** Запуск: кэш -> мгновенная подсветка -> первый тик -> интервал. */
        start() {
            if (this._timer) return;
            this._active = true;

            // v11.7.2: при возврате на вкладку сбрасываем логин и сразу
            // синхронизируемся — так смена аккаунта в той же вкладке
            // подхватывается без перезагрузки страницы.
            if (!this._wakeHandler) {
                this._wakeHandler = () => {
                    if (document.hidden) return;
                    this._myLogin = '';
                    this.sync();
                };
                document.addEventListener('visibilitychange', this._wakeHandler);
                window.addEventListener('focus', this._wakeHandler);
            }

            this._loadCache();
            this._applyStyles();
            this.sync();
            this._timer = setInterval(() => this.sync(), this.POLL_MS);
        },

        /** Остановка: интервал + стиль + слушатели фокуса. Кэш не трогаем. */
        stop() {
            this._active = false;
            if (this._timer) {
                clearInterval(this._timer);
                this._timer = null;
            }
            if (this._wakeHandler) {
                document.removeEventListener('visibilitychange', this._wakeHandler);
                window.removeEventListener('focus', this._wakeHandler);
                this._wakeHandler = null;
            }
            const style = document.getElementById(this.STYLE_ID);
            if (style) style.remove();
            this.users.clear();
            this._syncBusy = false;
        },
    };
