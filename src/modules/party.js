    // ============================================================
    // 9. МОДУЛЬ: ПАТИ (группы игроков, шаг 1)
    //
    // Клиент к собственному серверу (server/), а не к API игры: запросы
    // идут мимо /c/<канал>/ через GM_xmlhttpRequest (см. AGENTS.md, §3:
    // домен сервера чужой для игры, поэтому обычный fetch упёрся бы в CORS
    // и CSP страницы `connect-src 'self'`).
    //
    // Хранилище — GM_setValue/GM_getValue (@grant в шапке):
    //   lgPartyBaseUrl — адрес сервера (по умолчанию https://legion.ctrlfree.host, см. v11.6.0e/f);
    //   lgParty        — {groupId, inviteToken, sessionId, login}
    //                    (inviteToken — техническое имя поля сервера,
    //                     в интерфейсе это «Код приглашения»);
    //   lgPartyOwner   — создал ли этот клиент пати.
    // Если GM-хранилище недоступно (старая версия скрипта без @grant),
    // молча падаем на localStorage, иначе модуль падал бы на первом клике.
    //
    // Шаг 1 = только auth/token-gate: create/join/leave/rotate/kick/members.
    // v11.6.0a: вход — по коду приглашения (inviteToken, POST /party/join),
    // memberId отдельно от sessionId, серверный leave и lowercase-логины.
    // Ник читается из игры ТОЛЬКО в момент клика «Создать»/«Присоединиться».
    // v11.6.0a.2: ник и HP берутся из GET /api/me (user.login / hero.hpNow),
    // LG_CH.login — только фолбэк: в песочнице он бывает пустым.
    // v11.6.0a.3: пустое состояние рисуется синхронно, поэтому при первом
    // открытии «Вы: …» показывал фолбэк LG_CH.login (логин Twitch-канала).
    // Теперь open() дозапрашивает /api/me в фоне и обновляет ТОЛЬКО текстовый
    // узел ника (.party-self-nick): полная перерисовка сбила бы фокус в поле
    // кода приглашения.
    // v11.6.0b: HP-панель. Раз в 3 с (только когда мы в пати) клиент шлёт
    // POST /party/:id/state и перерисовывает список из GET /party/:id/state.
    // v11.6.0c: журнал боя. В том же тике сравниваем снимки /api/me и шлём
    // события в POST /party/:id/log (quest_start/quest_end/death/heal).
    // v11.6.0c.1: добавлен тип damage («HP -N») — урон уменьшением hp.
    // v11.6.0d: взаимный хил. В строке HP-панели у раненого союзника появляется
    // кнопка «❤» -> _healMember() -> POST /c/<канал>/api/qact
    // {k:'b', a:'sk', w:'лечение', t:<ник>}. Успех пишется в журнал типом
    // heal_cast. Кнопка только если цель не мы, цель ранена, свой герой в
    // походе (вне похода игра отклоняет запрос) и наш класс — жрец
    // (v11.6.0g-2: _prevMe.role === 'priest').
    // Под HP-панелью — блок «Журнал» с ленивой догрузкой GET .../log?since=.
    // v11.6.0g-2: UI-патч. В интерфейсе «inviteToken» называется «Код
    // приглашения»; модалка переведена на классы core/styles.js (тёмный фон,
    // золотистые акценты, hover как у «Создать пати»); HP-панель и журнал
    // живут в общем контейнере .party-hud-container и перетаскиваются за
    // заголовки, позиция — GM_setValue('lgPartyHudPos').
    // ============================================================
    const Party = {
        BASE_URL_KEY: 'lgPartyBaseUrl',
        STATE_KEY: 'lgParty',
        OWNER_KEY: 'lgPartyOwner',
        // Позиция HUD {left, top} после перетаскивания (v11.6.0g-2).
        DRAG_KEY: 'lgPartyHudPos',
        DEFAULT_BASE_URL: 'https://legion.ctrlfree.host',
        // v11.6.0g-6: ключ доступа к нашему серверу. Должен совпадать с API_KEY
        // в server/index.js (env LGU_API_KEY) — иначе любой запрос получит 401.
        API_KEY: 'LGU-default-secret-key-change-me',
        REQUEST_TIMEOUT: 12000,
        // Период синхронизации HP (ТЗ 11.6.0b: раз в 3 секунды).
        HP_SYNC_MS: 3000,
        // Сервер хранит ник только в нижнем регистре (server/index.js).
        LOGIN_RE: /^[a-z0-9_]{1,32}$/,
        // Код приглашения (inviteToken) = 16 случайных байт = 32 hex-символа
        // (server/db.js).
        INVITE_RE: /^[a-f0-9]{32}$/i,

        // Журнал боя (ТЗ 11.6.0c).
        LOG_LIMIT: 100,      // размер страницы догрузки (сервер: default 100, max 200)
        LOG_DOM_MAX: 500,    // столько же строк хранит сервер (trimLog, maxRows=500)
        // Цвет строки по типу события; остальные — обычный цвет текста панели.
        // damage — оранжевый, чтобы отличать урон от death (розовый);
        // heal_cast (хил по кнопке, v11.6.0d) — тот же зелёный, что и heal.
        LOG_COLORS: {
            damage: '#ff9a5a',
            heal_cast: '#5fd987',
            death: '#ff5a7a',
            heal: '#5fd987',
            drop: '#ffcf6a',
            system: '#888'
        },
        LOG_DEFAULT_COLOR: '#e8e8ea',

        // Рантайм-поля. Объявлены явно, чтобы в отладке не ловить undefined.
        _hpTimer: null,      // setInterval HP-синхронизации
        _hpBusy: false,      // тик уже в работе (медленная сеть)
        _cachedLogin: '',    // последний ник из /api/me — для синхронного рендера
        // Промис фонового /api/me для .party-self-nick: повторные open() не
        // должны плодить одинаковые запросы, пока первый ещё в полёте.
        _selfNickFetch: null,
        // Контейнер HUD (v11.6.0g-2): HP-панель и журнал — его дети, поэтому
        // перетаскивание за заголовок двигает оба блока сразу.
        HUD_ID: `${RAND_ID}-party-hud`,
        _hudResizeBound: false, // слушатель resize навешен (clamp при смене размера)
        // id панели с префиксом RAND_ID: чужие page-стили не должны её зацепить.
        PANEL_ID: `${RAND_ID}-party-hp-panel`,

        // Журнал боя: панель и состояние догрузки.
        LOG_PANEL_ID: `${RAND_ID}-party-log-panel`,
        _prevMe: null,       // предыдущий снимок /api/me для детектора событий
        // v11.6.0d: логины, по которым прямо сейчас идёт POST /api/qact.
        // Панель перерисовывается раз в 3 с, и без этого набора двойной клик
        // (или клик сразу после рендера) отправил бы второй запрос лечения.
        _healBusy: new Set(),
        _logOpen: true,      // панель развёрнута (свёрнутая не опрашивает сервер)
        _logBusy: false,     // GET/POST журнала уже в полёте
        _logSince: 0,        // nextSince с сервера (id последней известной строки)
        _logReady: false,    // первичная загрузка (limit=100) выполнена
        _logBodyEl: null,    // .party-log-body — кэш, чтобы не искать каждый тик

        // v11.6.0g-2: инлайн-стили форм заменены классами из core/styles.js —
        // только так работают hover/focus-эффекты (inline :hover невозможен).
        // Кнопка «❤»: pointer-events:auto обязателен, сама панель —
        // pointer-events:none, чтобы не перехватывать клики по игре.
        INPUT_CLASS: 'party-input',
        TOKEN_INPUT_CLASS: 'party-input party-token',
        BTN_CLASS: 'party-btn',
        DANGER_BTN_CLASS: 'party-btn party-btn-danger',
        HEAL_BTN_CLASS: 'party-heal-btn',
        MUTED_CLASS: 'party-muted',

        /* ---------------------------------------------------------- */
        /* Хранилище                                                   */
        /* ---------------------------------------------------------- */

        _gmGet(key, fallback = null) {
            try {
                if (typeof GM_getValue === 'function') {
                    const v = GM_getValue(key, fallback);
                    return v === undefined ? fallback : v;
                }
            } catch (e) {
                dbg('[PARTY] GM_getValue недоступен:', e);
            }
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) return fallback;
                try { return JSON.parse(raw); } catch (e) { return raw; }
            } catch (e) {
                return fallback;
            }
        },

        _gmSet(key, value) {
            try {
                if (typeof GM_setValue === 'function') {
                    GM_setValue(key, value);
                    return;
                }
            } catch (e) {
                dbg('[PARTY] GM_setValue недоступен:', e);
            }
            try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
        },

        /** Сохранённое состояние пати либо null, если его нет/оно битое. */
        _readState() {
            let state = this._gmGet(this.STATE_KEY, null);
            if (typeof state === 'string') {
                // В localStorage значение лежит строкой — пробуем разобрать.
                try { state = JSON.parse(state); } catch (e) { return null; }
            }
            if (!state || typeof state !== 'object') return null;
            if (!state.groupId || !state.sessionId) return null;
            return state;
        },

        _writeState(party, isOwner) {
            this._gmSet(this.STATE_KEY, party);
            this._gmSet(this.OWNER_KEY, !!isOwner);
            // В пати появились/обновились данные — поднимаем HP-синхронизацию.
            // Повторный вызов безопасен: второй интервал не создаётся.
            this.startHpSync();
        },

        _isOwner() {
            return this._gmGet(this.OWNER_KEY, false) === true;
        },

        /**
         * Локальный сброс пати: чистит хранилище и перерисовывает модалку в
         * состояние «нет пати». Отдельного рендера не нужно: open() при
         * пустом состоянии сам показывает _modalHtmlEmpty().
         *
         * Используется и при выходе (partyLeave), и при 401 от сервера
         * (сессию убили киком или выходом владельца).
         */
        _resetLocalState() {
            // Интервал HP живёт только при активной пати: гасим его и прячем
            // панель до того, как перерисуем модалку (ТЗ 11.6.0b).
            this.stopHpSync();
            this._gmSet(this.STATE_KEY, null);
            this._gmSet(this.OWNER_KEY, false);
            // open() синхронно закроет текущую модалку и вставит новую.
            this.open().catch((e) => dbg('[PARTY] перерисовать модалку не удалось:', e));
        },

        /** База сервера без хвостовых слэшей. */
        getBaseUrl() {
            const saved = this._gmGet(this.BASE_URL_KEY, '');
            if (typeof saved === 'string' && saved.trim()) {
                return saved.trim().replace(/\/+$/, '');
            }
            // TODO (шаг 2+): поле «адрес сервера» в модалке для владельца пати.
            // Пока адрес меняется только через хранилище скрипта.
            return this.DEFAULT_BASE_URL;
        },

        /**
         * Канал игры (LG_CH.login). LG_CH живёт в page-context, поэтому читаем
         * строго через G (см. AGENTS.md §2). Нужен и для URL /api/me, и как
         * фолбэк-ник, если запрос к игре не удался.
         */
        _channelLogin() {
            try {
                return String(G?.LG_CH?.login || '').trim();
            } catch (e) {
                return '';
            }
        },

        /**
         * Ник и HP из игры: GET /c/<канал>/api/me (credentials: include).
         *
         * Источник истины для ника — user.login из ответа, а не LG_CH: в
         * песочнице Tampermonkey LG_CH бывает недоступен/устарел, и сервер
         * получал бы пустой логин. Запрос идёт обычным fetch: это тот же
         * origin (страница игры), поэтому CORS не при чём.
         *
         * Фолбэк: если /api/me упал — берём G.LG_CH.login и пишем console.warn
         * (ТЗ 11.6.0a.2). hp/maxHp в этом случае null, и HP-тик просто не
         * отправляет стейт, но панель продолжает работать по данным сервера.
         *
         * v11.6.0c: сюда же добавлены quest (ql из /api/me) и ghost — они
         * нужны детектору событий журнала. live=false означает фолбэк:
         * сравнивать такой снимок с предыдущим нельзя, иначе пропавший
         * /api/me выглядел бы как «вышел из похода» + «воскрес».
         *
         * v11.6.0g-2: добавлен role (hero.role) — кнопка «❤» рисуется только
         * жрецу, а роль видна только из /api/me.
         *
         * @returns {Promise<{login: string, hp: number|null, maxHp: number|null,
         *                    quest: object|null, ghost: boolean, role: string,
         *                    live: boolean}>}
         */
        async _fetchMe() {
            const channel = this._channelLogin();
            if (!channel) {
                console.warn('[PARTY] LG_CH.login недоступен — /api/me не запросить');
                return { login: '', hp: null, maxHp: null, quest: null, ghost: false, role: 'unknown', live: false };
            }

            try {
                const res = await fetch(`/c/${encodeURIComponent(channel)}/api/me`, {
                    credentials: 'include',
                    cache: 'no-store'
                });
                const data = await res.json().catch(() => null);
                const login = data?.user?.login;
                if (!res.ok || !login) {
                    throw new Error(`HTTP ${res.status}: нет user.login`);
                }

                // hero.stats.hp — максимум здоровья, hero.hpNow — текущее
                // (docs/API.md, §GET /api/me; в игре hpNow ?? stats.hp).
                const hp = Number(data.hero?.hpNow);
                const maxHp = Number(data.hero?.stats?.hp);
                // Класс героя (docs/API.md, §GET /api/me: "role": "priest").
                // 'unknown' — когда поля нет: хил тогда недоступен.
                const role = data.hero?.role || 'unknown';

                // ql — объект состояния похода (docs/API.md, §ql). При on:false
                // похода нет, поэтому нормализуем в null: детектору журнала
                // нужен простой признак «был/не был», а не форма снимка.
                const ql = data.ql;
                const quest = (ql && typeof ql === 'object' && ql.on !== false) ? ql : null;

                const me = {
                    login: String(login),
                    hp: Number.isFinite(hp) ? hp : null,
                    maxHp: Number.isFinite(maxHp) ? maxHp : null,
                    quest,
                    ghost: data.hero?.ghost === true,
                    role,
                    live: true
                };
                this._cachedLogin = me.login;
                return me;
            } catch (e) {
                console.warn('[PARTY] /api/me недоступен, берём LG_CH.login:', e);
                this._cachedLogin = channel;
                return { login: channel, hp: null, maxHp: null, quest: null, ghost: false, role: 'unknown', live: false };
            }
        },

        /**
         * Ник для показа в «нет пати». Синхронно (модалка рисуется сразу):
         * последний известный из /api/me, иначе LG_CH.login, иначе пусто.
         */
        _defaultNick() {
            return this._cachedLogin || this._channelLogin();
        },

        /**
         * Ник для отправки на сервер: читается из /api/me в момент клика,
         * чтобы не зафиксировать пустой/устаревший логин при открытии модалки.
         * @returns {Promise<string>} lowercase-логин
         */
        async _currentLogin() {
            const me = await this._fetchMe();
            if (!me.login) {
                throw new Error('Игра не загрузилась, попробуйте позже');
            }
            return this._normalizeLogin(me.login);
        },

        _normalizeLogin(login) {
            const nick = String(login ?? '').trim().toLowerCase();
            if (!this.LOGIN_RE.test(nick)) {
                throw new Error('Ник: 1–32 символа, только a–z, 0–9 и _');
            }
            return nick;
        },

        /** Человеческий текст ошибки по коду из ответа сервера. */
        _errorText(status, data, fallback) {
            const map = {
                bad_login: 'Ник: 1–32 символа, только a–z, 0–9 и _',
                bad_invite: 'Неверный код приглашения',
                bad_invite_token: 'Некорректный код приглашения',
                login_taken: 'Этот ник уже занят в пати',
                party_not_found: 'Пати с таким кодом приглашения не найдена — проверьте код',
                unauthorized: 'Сессия недействительна — войдите в пати заново',
                not_owner: 'Действие доступно только владельцу пати',
                not_member: 'Эта сессия не принадлежит пати',
                cannot_kick_self: 'Нельзя кикнуть себя',
                bad_member: 'Не указан участник для кика',
                member_not_found: 'Такого участника нет в пати',
                session_not_found: 'Такой сессии нет в пати',
                rate_limited: 'Слишком много попыток входа, подождите минуту',
                internal: 'Внутренняя ошибка сервера пати'
            };
            return map[data?.error] || data?.message || fallback || `HTTP ${status}`;
        },

        /* ---------------------------------------------------------- */
        /* HTTP                                                        */
        /* ---------------------------------------------------------- */

        _partyPath(action) {
            const state = this._readState();
            if (!state) throw new Error('Вы не в пати');
            return `/party/${encodeURIComponent(state.groupId)}/${action}`;
        },

        /**
         * Запрос к серверу пати через GM_xmlhttpRequest.
         * @param {string} method
         * @param {string} path   например '/party' или '/party/<id>/members'
         * @param {{body?: object|null, auth?: boolean}} options
         */
        _request(method, path, options = {}) {
            const auth = options.auth !== false;
            const url = this.getBaseUrl() + path;

            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest !== 'function') {
                    reject(new Error('GM_xmlhttpRequest недоступен: проверьте @grant в шапке'));
                    return;
                }

                const headers = { 'Content-Type': 'application/json' };
                // v11.6.0g-6: без этого заголовка сервер отвечает 401 — ключ
                // проверяется до роутинга, включая POST /party и /party/join.
                headers['X-Legion-Key'] = this.API_KEY;
                const state = this._readState();
                if (auth && state?.sessionId) {
                    headers.Authorization = 'Bearer ' + state.sessionId;
                }

                const data = options.body === undefined || options.body === null
                    ? null
                    : JSON.stringify(options.body);

                GM_xmlhttpRequest({
                    method,
                    url,
                    headers,
                    data: data === null ? undefined : data,
                    timeout: this.REQUEST_TIMEOUT,
                    onload: (res) => {
                        let payload = null;
                        try {
                            payload = res.responseText ? JSON.parse(res.responseText) : null;
                        } catch (e) {
                            payload = null;
                        }

                        if (res.status >= 200 && res.status < 300) {
                            resolve(payload);
                            return;
                        }

                        // 401 на bearer-эндпоинте = сессия мертва (кик, выход
                        // владельца, удалённая пати). POST /party и
                        // POST /party/join идут с auth:false и сюда не попадают.
                        // Локальное состояние чистим сразу, иначе клиент
                        // застрянет в «пати», которой уже нет.
                        if (res.status === 401 && auth) {
                            this._resetLocalState();
                            if (state) UI.showToast('Сессия истекла — вы вне пати', true);
                        }

                        const err = new Error(this._errorText(res.status, payload, `HTTP ${res.status}`));
                        err.status = res.status;
                        err.code = payload?.error || null;
                        err.sessionExpired = payload?.code === 'session_expired';
                        reject(err);
                    },
                    onerror: () => reject(new Error(`Сервер пати недоступен: ${url}`)),
                    ontimeout: () => reject(new Error(`Сервер пати не ответил за ${this.REQUEST_TIMEOUT / 1000} с: ${url}`)),
                    onabort: () => reject(new Error('Запрос к серверу пати отменён'))
                });
            });
        },

        /* ---------------------------------------------------------- */
        /* Публичный API (шаг 1)                                       */
        /* ---------------------------------------------------------- */

        /**
         * POST /party — создать пати. Клиент становится владельцем.
         * Ник берётся из игры в момент вызова (не из поля ввода).
         * @returns {Promise<{groupId: string, inviteToken: string, sessionId: string, login: string}>}
         */
        async partyCreate() {
            const nick = await this._currentLogin();
            const res = await this._request('POST', '/party', { body: { login: nick }, auth: false });
            if (!res?.groupId || !res?.inviteToken || !res?.sessionId) {
                throw new Error('Сервер вернул неполный ответ при создании пати');
            }
            const party = {
                groupId: res.groupId,
                inviteToken: res.inviteToken,
                sessionId: res.sessionId,
                login: nick
            };
            this._writeState(party, true);
            return party;
        },

        /**
         * POST /party/join — войти по коду приглашения.
         * groupId на клиенте не нужен: сервер находит пати по токену и
         * возвращает groupId в ответе.
         * @param {string} inviteToken код приглашения: 32 hex-символа (пробелы обрезаются)
         * @returns {Promise<{groupId: string, inviteToken: string, sessionId: string, login: string}>}
         */
        async partyJoin(inviteToken) {
            const token = String(inviteToken ?? '').trim();
            if (!token) throw new Error('Укажите код приглашения');
            if (!this.INVITE_RE.test(token)) throw new Error('Код приглашения: 32 hex-символа');
            const nick = await this._currentLogin();

            const res = await this._request(
                'POST',
                '/party/join',
                { body: { inviteToken: token, login: nick }, auth: false }
            );
            if (!res?.groupId || !res?.sessionId) {
                throw new Error('Сервер вернул неполный ответ при входе в пати');
            }
            const party = {
                groupId: res.groupId,
                inviteToken: token,
                sessionId: res.sessionId,
                login: nick
            };
            this._writeState(party, false);
            return party;
        },

        /**
         * DELETE /party/:id/leave, затем локальный сброс состояния.
         *
         * Владелец удаляет пати целиком (сервер вернёт deleted: "party"),
         * участник — только свою сессию (deleted: "self"). Если сервер
         * недоступен, локальное состояние всё равно чистим через
         * _resetLocalState(), иначе клиент застрял бы в «пати», которой уже
         * нет; пользователь получает предупреждение, что ник мог остаться
         * занятым.
         *
         * @returns {Promise<boolean>} true, если сервер подтвердил выход
         */
        async partyLeave() {
            const state = this._readState();
            let serverFailed = false;
            let alreadyReset = false;

            if (state) {
                try {
                    await this._request('DELETE', `/party/${encodeURIComponent(state.groupId)}/leave`);
                } catch (e) {
                    const status = Number(e?.status) || 0;
                    // 401/404 — сессии или пати уже нет (кик, чужой выход):
                    // локальная чистка как раз то, что нужно, без пугалки.
                    // При 401 _request() уже вызвал _resetLocalState().
                    if (status === 401) alreadyReset = true;
                    else if (status !== 404) serverFailed = true;
                    dbg('[PARTY] leave на сервере не удался:', e);
                }
            }

            // Единственная точка очистки: и здесь, и в 401-обработчике.
            if (!alreadyReset) this._resetLocalState();

            if (serverFailed) {
                UI.showToast(
                    'Не удалось связаться с сервером, выход только локальный — ник может остаться занятым',
                    true
                );
            }
            return !serverFailed;
        },

        /** @returns {{party: object|null, isOwner: boolean}} */
        partyState() {
            return { party: this._readState(), isOwner: this._isOwner() };
        },

        /**
         * POST /party/:id/rotate — перевыпустить код приглашения (только владелец).
         * @returns {Promise<string>} новый код приглашения
         */
        async partyRotateToken() {
            const state = this._readState();
            if (!state) throw new Error('Вы не в пати');
            if (!this._isOwner()) throw new Error('Код приглашения может перевыпустить только владелец пати');

            const res = await this._request('POST', this._partyPath('rotate'), { body: {} });
            if (!res?.inviteToken) throw new Error('Сервер не вернул новый код приглашения');

            this._writeState({ ...state, inviteToken: res.inviteToken }, true);
            return res.inviteToken;
        },

        /**
         * POST /party/:id/kick — исключить участника (только владелец).
         * @param {string} memberId memberId участника из partyMembers()
         */
        async partyKick(memberId) {
            if (!this._isOwner()) throw new Error('Кикать может только владелец пати');
            const target = String(memberId ?? '').trim();
            if (!target) throw new Error('Не указан memberId участника');

            await this._request('POST', this._partyPath('kick'), {
                body: { memberId: target }
            });
            return true;
        },

        /**
         * GET /party/:id/members — список участников.
         * Сервер отдаёт только публичные поля: {login, joinedAt, memberId,
         * role, self}. sessionId не приходит никому и никогда (это bearer).
         * @returns {Promise<Array<{login: string, joinedAt: number, memberId: string, role: 'owner'|'member', self: boolean}>>}
         */
        async partyMembers() {
            const res = await this._request('GET', this._partyPath('members'));
            return Array.isArray(res?.members) ? res.members : [];
        },

        /* ---------------------------------------------------------- */
        /* HP-панель и синхронизация состояния (шаг 2, v11.6.0b)      */
        /* ---------------------------------------------------------- */

        /* ---------------------------------------------------------- */
        /* HUD: контейнер, перетаскивание, clamp (v11.6.0g-2)          */
        /* ---------------------------------------------------------- */

        /**
         * Контейнер HUD: HP-панель и журнал — его дети, поэтому drag за любой
         * заголовок двигает оба блока сразу (ТЗ 11.6.0g-2 п.1).
         * Позиция берётся из GM_setValue('lgPartyHudPos'); пока её нет —
         * работает CSS-якорь top/right из core/styles.js.
         * pointer-events:none у контейнера: клики по игре не перехватываются,
         * интерактивные узлы возвращают auto в CSS (.party-drag-handle и др.).
         */
        _ensureHud() {
            let hud = document.getElementById(this.HUD_ID);
            if (hud && hud.isConnected) return hud;

            hud = document.createElement('div');
            hud.id = this.HUD_ID;
            hud.className = 'party-hud-container';
            document.body.appendChild(hud);

            // Сохранённую позицию применяем сразу; clamp внутри проверит
            // размеры — пока панели display:none, rect нулевой и он no-op.
            this._applyHudPosition(hud);

            // Смена размера окна: панель могла уехать за границы (п.6).
            if (!this._hudResizeBound) {
                this._hudResizeBound = true;
                window.addEventListener('resize', () => this._clampHud());
            }
            return hud;
        },

        /**
         * Применяет сохранённую позицию HUD {left, top}. Вызывается при
         * создании контейнера и на каждом рендере панели (ТЗ 11.6.0g-2 п.4).
         * Позиции нет — возвращаем CSS-якорь (right:20px, top:20px).
         */
        _applyHudPosition(hud = null) {
            const el = hud || document.getElementById(this.HUD_ID);
            if (!el) return;
            // Пока тащат, сохранённую позицию не навязываем: рендер раз в 3 с
            // иначе дёргал бы панель из-под курсора.
            if (el.classList.contains('party-dragging')) return;

            const pos = this._gmGet(this.DRAG_KEY, null);
            const left = Number(pos?.left);
            const top = Number(pos?.top);
            if (!Number.isFinite(left) || !Number.isFinite(top)) {
                el.style.left = '';
                el.style.top = '';
                el.style.right = '20px';
                el.style.bottom = '';
                return;
            }

            el.style.left = `${Math.round(left)}px`;
            el.style.top = `${Math.round(top)}px`;
            el.style.right = 'auto';
            el.style.bottom = 'auto';
            this._clampHud(el);
        },

        /**
         * Возвращает HUD в пределы окна (ТЗ 11.6.0g-2 п.6): left/top
         * ограничиваются так, чтобы правый/нижний край не выходил за экран.
         * Скрытые панели имеют нулевые размеры — их не трогаем.
         */
        _clampHud(hud = null) {
            const el = hud || document.getElementById(this.HUD_ID);
            if (!el || !el.isConnected) return;

            const left = parseFloat(el.style.left);
            const top = parseFloat(el.style.top);
            // Панель ещё на CSS-якоре (right:20px) — двигать нечего.
            if (!Number.isFinite(left) || !Number.isFinite(top)) return;

            const rect = el.getBoundingClientRect();
            if (!rect.width && !rect.height) return; // оба блока скрыты

            const maxLeft = Math.max(0, (window.innerWidth || 0) - rect.width);
            const maxTop = Math.max(0, (window.innerHeight || 0) - rect.height);
            el.style.left = `${Math.round(Math.min(Math.max(0, left), maxLeft))}px`;
            el.style.top = `${Math.round(Math.min(Math.max(0, top), maxTop))}px`;
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        },

        /**
         * Перетаскивание за заголовок (ТЗ 11.6.0g-2 п.2–3).
         * pointerdown/move/up покрывают и мышь, и тач (touch-action:none в CSS).
         * В GM-хранилище позиция пишется ТОЛЬКО на отпускании: запись на
         * каждый pointermove — лишние обращения к хранилищу Tampermonkey.
         * @param {HTMLElement|null} handle заголовок панели или журнала
         */
        _bindHudDrag(handle) {
            if (!handle || handle.dataset.partyDragBound === '1') return;
            handle.dataset.partyDragBound = '1';

            let drag = null;

            const onMove = (e) => {
                if (!drag) return;
                const hud = document.getElementById(this.HUD_ID);
                if (!hud) return;
                const rect = hud.getBoundingClientRect();
                const maxLeft = Math.max(0, (window.innerWidth || 0) - rect.width);
                const maxTop = Math.max(0, (window.innerHeight || 0) - rect.height);
                const left = Math.min(Math.max(0, drag.left + (e.clientX - drag.startX)), maxLeft);
                const top = Math.min(Math.max(0, drag.top + (e.clientY - drag.startY)), maxTop);
                hud.style.left = `${Math.round(left)}px`;
                hud.style.top = `${Math.round(top)}px`;
                hud.style.right = 'auto';
                hud.style.bottom = 'auto';
                if (e.cancelable) e.preventDefault();
            };

            const onUp = () => {
                if (!drag) return;
                drag = null;
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);

                const hud = document.getElementById(this.HUD_ID);
                if (!hud) return;
                hud.classList.remove('party-dragging');

                const left = parseFloat(hud.style.left);
                const top = parseFloat(hud.style.top);
                if (Number.isFinite(left) && Number.isFinite(top)) {
                    this._gmSet(this.DRAG_KEY, { left: Math.round(left), top: Math.round(top) });
                }
            };

            handle.addEventListener('pointerdown', (e) => {
                // Только ЛКМ/касание; кнопки внутри заголовка (▾ журнала) не тащат.
                if (e.button) return;
                if (e.target && typeof e.target.closest === 'function' && e.target.closest('button')) return;

                const hud = document.getElementById(this.HUD_ID);
                if (!hud) return;
                const rect = hud.getBoundingClientRect();
                // Стартовые left/top — реальные координаты контейнера: он мог
                // стоять на CSS-якоре right:20px, а тащим уже в left/top.
                drag = { startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top };
                hud.classList.add('party-dragging');
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
                e.preventDefault();
            });
        },

        /**
         * HP-панель создаётся лениво внутри HUD-контейнера (v11.6.0g-2) и
         * живёт до перезагрузки страницы. Тёмный фон и скругления — класс
         * .party-panel из core/styles.js; заголовок «ПАТИ · HP» получает
         * .party-drag-handle (pointer-events:auto, cursor:grab).
         */
        _ensurePanel() {
            const hud = this._ensureHud();
            let el = document.getElementById(this.PANEL_ID);
            if (el && el.isConnected) {
                // После повторной инъекции скрипта панель могла остаться в body.
                if (el.parentElement !== hud) hud.appendChild(el);
                this._bindPanelClick(el);
                this._bindHudDrag(el.querySelector('.party-panel-title'));
                this._applyHudPosition(hud);
                return el;
            }

            el = document.createElement('div');
            el.id = this.PANEL_ID;
            el.className = 'party-panel';
            el.setAttribute('role', 'status');
            hud.appendChild(el);
            this._bindPanelClick(el);
            return el;
        },

        /**
         * Делегированный клик по кнопке «Хил» (v11.6.0d).
         *
         * Слушатель живёт на самой панели, а не на кнопках: _renderPanel()
         * переписывает innerHTML каждые 3 с, и отдельные обработчики текли бы/
         * терялись. dataset-флаг не даёт навесить второй такой же слушатель,
         * если панель уже существовала в DOM (перезапуск скрипта на странице).
         */
        _bindPanelClick(el) {
            if (!el || el.dataset.partyHealBound === '1') return;
            el.dataset.partyHealBound = '1';
            el.addEventListener('click', (e) => {
                const target = e.target;
                const btn = (target && typeof target.closest === 'function')
                    ? target.closest('[data-party-heal]')
                    : null;
                if (!btn || btn.disabled) return;
                this._healMember(btn.getAttribute('data-party-heal'), btn);
            });
        },

        _hidePanel() {
            const el = document.getElementById(this.PANEL_ID);
            if (el) el.style.display = 'none';
        },

        /**
         * Перерисовка списка «ник: hp/maxHp» с цветовой полоской:
         * зелёный > 50%, жёлтый 20–50%, красный < 20% HP.
         * v11.6.0d: у раненого союзника в строке есть кнопка «❤» (_healMember).
         * v11.6.0g-2: кнопка — только жрецу (this._prevMe.role === 'priest');
         * заголовок панели стал drag-handle для перетаскивания HUD.
         * @param {Array<{login: string, hp: number, maxHp: number}>} states
         */
        _renderPanel(states) {
            const el = this._ensurePanel();
            const list = Array.isArray(states) ? states : [];

            // Свой ник берём из локального состояния: GET /party/:id/state
            // отдаёт только {login, hp, maxHp, updatedAt}, поля self там нет.
            const selfLogin = String(this._readState()?.login || '').toLowerCase();
            // Лечить можно только из похода — вне похода игра отклоняет запрос.
            // _prevMe появляется после первого «живого» снимка /api/me в _hpTick();
            // пока его нет, кнопку не рисуем (заведомо провальный запрос).
            const inQuest = !!this._prevMe?.quest;
            // v11.6.0g-2: класс героя. Роль приходит из /api/me (hero.role) и
            // кэшируется в _prevMe; у остальных классов кнопки «❤» нет вообще.
            const isPriest = this._prevMe?.role === 'priest';

            const rows = list.map((s) => {
                const nick = String(s.login || '?');
                const login = Utils.escapeHtml(nick);
                const rawMax = Math.max(0, Number(s.maxHp) || 0);
                const rawHp = Math.max(0, Number(s.hp) || 0);
                // hp не может быть больше максимума; при maxHp = 0 (битые
                // данные) показываем hp как есть, полоска остаётся пустой.
                const hp = Math.min(rawMax > 0 ? rawMax : rawHp, rawHp);
                const pct = rawMax > 0 ? Math.max(0, Math.min(100, (hp / rawMax) * 100)) : 0;
                // Ровно 50% — уже не «зелёный» (ТЗ: зелёный строго > 50%).
                const color = pct > 50 ? '#5fd987' : (pct < 20 ? '#ff5a7a' : '#ffcf6a');

                // Кнопка «Хил» (ТЗ 11.6.0d) — только если: мы жрец, цель не мы,
                // цель ранена (hp < maxHp) и свой герой в походе.
                const busy = this._healBusy.has(nick.toLowerCase());
                const showHeal = isPriest
                    && inQuest
                    && nick.toLowerCase() !== selfLogin
                    && rawMax > 0
                    && rawHp < rawMax;
                const healBtn = showHeal
                    ? `<button type="button" class="${this.HEAL_BTN_CLASS}" data-party-heal="${login}"`
                        + ` title="Лечить ${login}"${busy ? ' disabled' : ''}>${busy ? '...' : '❤'}</button>`
                    : '';

                return `<div style="margin-bottom:6px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <span style="color:#ffcf6a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${login}:</span>
                        <span style="display:flex; align-items:center; gap:4px; white-space:nowrap;">
                            <span style="color:#ccc;">${hp}/${rawMax}</span>
                            ${healBtn}
                        </span>
                    </div>
                    <div style="height:3px; margin-top:2px; border-radius:2px; background:#2a2030;">
                        <div style="height:3px; width:${pct.toFixed(1)}%; border-radius:2px; background:${color};"></div>
                    </div>
                </div>`;
            }).join('');

            // Заголовок — drag-handle (ТЗ 11.6.0g-2 п.2): .party-drag-handle
            // даёт pointer-events:auto и cursor:grab, т.к. сама панель
            // pointer-events:none и клики по игре не перехватывает.
            el.innerHTML = '<div class="party-panel-title party-drag-handle" title="Перетащить панель">'
                + '<span>Пати · HP</span></div>'
                + (rows || '<div style="color:#888;">Нет данных</div>');
            el.style.display = 'block';

            // innerHTML пересоздал заголовок — слушатель drag вешаем заново
            // (dataset-флаг не даёт задвоить его на одном и том же узле).
            this._bindHudDrag(el.querySelector('.party-panel-title'));

            // Позиция из хранилища применяется на каждом рендере (п.4).
            this._applyHudPosition();

            // Журнал — сосед по HUD-контейнеру; его видимость и догрузку
            // синхронизируем на каждом тике.
            this._syncLogPanel();
        },

        /* ---------------------------------------------------------- */
        /* Журнал боя (шаг 3, v11.6.0c)                               */
        /* ---------------------------------------------------------- */

        /**
         * Скрыть и очистить журнал. Вызывается из stopHpSync() — то есть на
         * leave и на 401: список прошлой пати после выхода показывать нельзя.
         */
        _hideLogPanel() {
            const el = document.getElementById(this.LOG_PANEL_ID);
            if (el) el.style.display = 'none';

            this._clearLog();
            this._logSince = 0;
            this._logReady = false;
            this._prevMe = null;
        },

        /**
         * Панель журнала создаётся лениво внутри HUD-контейнера (v11.6.0g-2):
         * раньше это был отдельный fixed-блок, который _positionLogPanel()
         * ставил вручную под HP-панель. Теперь оба блока — соседи по
         * flex-column с gap 8px, поэтому отступы считает CSS.
         */
        _ensureLogPanel() {
            const hud = this._ensureHud();
            let el = document.getElementById(this.LOG_PANEL_ID);
            if (el && el.isConnected) {
                if (el.parentElement !== hud) hud.appendChild(el);
                this._logBodyEl = el.querySelector('.party-log-body');
                this._bindHudDrag(el.querySelector('.party-log-head'));
                return el;
            }

            el = document.createElement('div');
            el.id = this.LOG_PANEL_ID;
            el.className = 'party-log-panel';

            // Заголовок статичный — innerHTML допустим. Строки событий
            // вставляются только через textContent (текст от других игроков).
            // .party-log-head — drag-handle: тянем за «Журнал», кнопка ▾
            // остаётся кликабельной (pointerdown по button игнорируется).
            el.innerHTML = '<div class="party-log-head party-drag-handle" title="Перетащить панель">'
                + '<span>Журнал</span>'
                + '<button type="button" class="party-log-toggle" title="Свернуть журнал">▾</button>'
                + '</div>'
                + '<div class="party-log-body">'
                + '<div class="party-log-empty" style="color:#888;">Пока пусто</div>'
                + '</div>';
            hud.appendChild(el);

            el.querySelector('.party-log-toggle')?.addEventListener('click', () => {
                this._setLogOpen(!this._logOpen);
            });
            this._bindHudDrag(el.querySelector('.party-log-head'));

            this._logBodyEl = el.querySelector('.party-log-body');
            return el;
        },

        /**
         * Раньше ставил журнал вплотную под HP-панелью вручную (top из
         * getBoundingClientRect). С v11.6.0g-2 оба блока лежат в общем
         * контейнере .party-hud-container (flex-column, gap 8px), поэтому
         * раскладку считает CSS. Метод оставлен ради вызова из
         * _syncLogPanel(): здесь применяем сохранённую позицию всего HUD.
         */
        _positionLogPanel() {
            this._applyHudPosition();
        },

        /**
         * Показывает журнал вместе с HP-панелью и запускает догрузку.
         * Вызывается из _renderPanel() на каждом тике синхронизации.
         */
        _syncLogPanel() {
            if (!this._readState()) return;
            const el = this._ensureLogPanel();
            this._positionLogPanel();
            el.style.display = 'block';
            this._applyLogOpenState();

            // _pollLog() сам выберет режим: since=0 -> последние LOG_LIMIT,
            // since>0 -> только новые строки.
            if (this._logOpen) this._pollLog();
        },

        /** ▾/▸ и видимость тела журнала без полной перерисовки панели. */
        _applyLogOpenState() {
            const el = document.getElementById(this.LOG_PANEL_ID);
            if (!el) return;
            const body = el.querySelector('.party-log-body');
            const btn = el.querySelector('.party-log-toggle');
            if (body) body.style.display = this._logOpen ? 'block' : 'none';
            if (btn) {
                btn.textContent = this._logOpen ? '▾' : '▸';
                btn.title = this._logOpen ? 'Свернуть журнал' : 'Развернуть журнал';
            }
        },

        /**
         * Свернуть/развернуть журнал. Свёрнутый не опрашивает сервер
         * (экономия трафика), при разворачивании сразу догоняем пропущенное
         * через since=_logSince.
         */
        _setLogOpen(open) {
            this._logOpen = !!open;
            this._applyLogOpenState();
            if (this._logOpen) this._pollLog();
        },

        /**
         * GET /party/:id/log: since=_logSince > 0 — догрузка новых строк,
         * иначе первичная загрузка последних LOG_LIMIT (ТЗ 11.6.0c).
         */
        async _pollLog() {
            if (!this._logOpen || this._logBusy) return;
            const party = this._readState();
            if (!party) return;

            this._logBusy = true;
            try {
                const query = this._logSince > 0
                    ? `?since=${this._logSince}&limit=${this.LOG_LIMIT}`
                    : `?limit=${this.LOG_LIMIT}`;
                const res = await this._request(
                    'GET',
                    `/party/${encodeURIComponent(party.groupId)}/log${query}`
                );

                // Пока ждали ответ, могли выйти или перезайти в другую пати:
                // чужие события в очищенную панель не дописываем.
                const cur = this._readState();
                if (!cur || cur.groupId !== party.groupId) return;

                // Первая порция заменяет плейсхолдер, следующие — дописываются.
                if (!this._logReady) {
                    this._clearLog();
                    this._logReady = true;
                }

                const events = Array.isArray(res?.events) ? res.events : [];
                this._appendLogEvents(events);

                const next = Number(res?.nextSince);
                if (Number.isFinite(next) && next > this._logSince) this._logSince = next;
            } catch (e) {
                console.warn('[PARTY] журнал: GET не удался:', e?.message || e);
                // 401: _request() уже вызвал _resetLocalState() -> stopHpSync()
                // -> _hideLogPanel(); здесь только страховка.
                if (Number(e?.status) === 401) this._hideLogPanel();
            } finally {
                this._logBusy = false;
            }
        },

        /** Плейсхолдер «Пока пусто» и сброс скролла. */
        _clearLog() {
            const body = this._logBodyEl
                || document.getElementById(this.LOG_PANEL_ID)?.querySelector('.party-log-body');
            if (!body) return;
            body.innerHTML = '<div class="party-log-empty" style="color:#888;">Пока пусто</div>';
            body.scrollTop = 0;
        },

        /** Дописывает события в конец; при переполнении — автоскролл вниз. */
        _appendLogEvents(events) {
            if (!Array.isArray(events) || !events.length) return;
            const body = this._logBodyEl
                || document.getElementById(this.LOG_PANEL_ID)?.querySelector('.party-log-body');
            if (!body) return;

            body.querySelector('.party-log-empty')?.remove();
            for (const ev of events) body.appendChild(this._logRowEl(ev));

            // Сервер хранит 500 строк (trimLog) — столько же держим в DOM,
            // чтобы долгая сессия не раздувала страницу.
            while (body.childElementCount > this.LOG_DOM_MAX) {
                body.firstElementChild?.remove();
            }

            if (body.scrollHeight > body.clientHeight) body.scrollTop = body.scrollHeight;
        },

        /**
         * Строка журнала: [HH:MM] login: text.
         * textContent, а не innerHTML: текст приходит от других игроков.
         */
        _logRowEl(ev) {
            const row = document.createElement('div');
            row.className = 'party-log-row';
            const color = this.LOG_COLORS[ev?.type] || this.LOG_DEFAULT_COLOR;
            row.style.cssText = `font-size:11px; line-height:1.45; word-break:break-word; color:${color};`;
            row.textContent = `[${this._formatLogTime(ev?.createdAt)}] ${ev?.login || '?'}: ${ev?.text || ''}`;
            return row;
        },

        /** createdAt (ms) -> HH:MM в локальной зоне браузера. */
        _formatLogTime(ts) {
            const value = Number(ts);
            const d = new Date(Number.isFinite(value) ? value : Date.now());
            if (Number.isNaN(d.getTime())) return '--:--';
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        },

        /**
         * Запускает синхронизацию HP: раз в 3 с отправляем свой hp/maxHp и
         * перерисовываем общую панель из GET /party/:id/state.
         * Повторный вызов безопасен: второй интервал не создаётся.
         * Вызывается из _writeState() (создали/вошли) и init() (перезагрузка).
         */
        startHpSync() {
            if (!this._readState()) {
                // Не в пати — панель не нужна.
                this.stopHpSync();
                return;
            }
            if (this._hpTimer) return;

            this._ensurePanel();
            this._hpTimer = setInterval(() => { this._hpTick(); }, this.HP_SYNC_MS);
            // Первый тик — сразу, иначе панель пустует первые 3 секунды.
            this._hpTick();
        },

        /** Остановить интервал и скрыть панели (выход, 401, перезапуск). */
        stopHpSync() {
            if (this._hpTimer) {
                clearInterval(this._hpTimer);
                this._hpTimer = null;
            }
            this._hidePanel();
            // leave/401: журнал прошлой пати очищается и прячется.
            this._hideLogPanel();
        },

        /**
         * Сравнивает два «живых» снимка /api/me и возвращает события журнала.
         *
         * Правила (ТЗ 11.6.0c):
         *   • quest null -> объект => quest_start;
         *   • quest объект -> null => quest_end;
         *   • ghost false -> true ИЛИ hp стал 0 => death (ровно одно событие);
         *   • hp вырос => heal с дельтой;
         *   • hp уменьшился => damage с дельтой (v11.6.0c.1).
         *
         * prev === null (первый тик после входа в пати) событий не даёт:
         * состояние «до» неизвестно, а quest_start на входе в пати был бы ложным.
         *
         * @param {{hp: number|null, quest: object|null, ghost: boolean, role: string}|null} prev
         * @param {{hp: number|null, quest: object|null, ghost: boolean, role: string}} cur
         * @returns {Array<{type: string, text: string}>}
         */
        _detectLogEvents(prev, cur) {
            const events = [];
            if (!prev || !cur) return events;

            const prevQuest = prev.quest || null;
            const curQuest = cur.quest || null;
            if (!prevQuest && curQuest) {
                events.push({ type: 'quest_start', text: 'Вошёл в поход' });
            } else if (prevQuest && !curQuest) {
                events.push({ type: 'quest_end', text: 'Вышел из похода' });
            }

            const prevHp = (typeof prev.hp === 'number' && Number.isFinite(prev.hp)) ? prev.hp : null;
            const hp = (typeof cur.hp === 'number' && Number.isFinite(cur.hp)) ? cur.hp : null;

            // Гибель: игра ставит ghost, но hp может прийти нулём раньше флага.
            // Оба признака в одном тике дают ОДНО событие, а не два.
            if ((!prev.ghost && cur.ghost) || (prevHp !== null && prevHp > 0 && hp === 0)) {
                events.push({ type: 'death', text: 'Погиб' });
            }

            if (prevHp !== null && hp !== null && hp > prevHp) {
                events.push({ type: 'heal', text: `HP +${hp - prevHp}` });
            }

            // Урон (ТЗ 11.6.0c.1). Игра пошаговая: урон — дискретное событие,
            // поэтому «HP -N» соответствует одному удару, спама быть не должно.
            // Не логируем:
            //   • prevHp === 0 — смерть/призрак уже описаны событием death;
            //   • prev.ghost — первый тик после воскрешения: игра сбрасывает hp
            //     с 0 на боевое значение, это не боевой урон.
            // Летальный удар (hp > 0 -> 0) даёт damage + death: так в журнале
            // видно и величину последнего удара, и сам факт гибели.
            if (!prev.ghost && prevHp !== null && hp !== null && prevHp > hp && prevHp > 0) {
                events.push({ type: 'damage', text: `HP -${prevHp - hp}` });
            }

            return events;
        },

        /**
         * POST /party/:id/log. Возвращает false, если сессия мертва (401):
         * дальше в этом тике отправлять события бессмысленно.
         */
        async _postLogEvent(type, text) {
            // 401 предыдущего события мог уже сбросить состояние пати.
            if (!this._readState()) return false;
            try {
                await this._request('POST', this._partyPath('log'), { body: { type, text } });
                return true;
            } catch (e) {
                console.warn('[PARTY] журнал: POST не удался:', e?.message || e);
                return Number(e?.status) !== 401;
            }
        },

        /**
         * Один такт синхронизации: /api/me -> POST state -> GET state -> рендер.
         *
         * Ошибки сети и валидации намеренно «тихие» (console.warn): панель
         * обновляется раз в 3 с, тосты каждые 3 с были бы невыносимы.
         * Исключение — 401: он означает кик/удалённую пати, здесь нужен и
         * тост, и полный локальный сброс (его делает _request()).
         */
        async _hpTick() {
            // Предыдущий тик ещё ждёт сеть (медленный сервер) — второй не нужен.
            if (this._hpBusy) return;
            const party = this._readState();
            if (!party) {
                this.stopHpSync();
                return;
            }

            const path = `/party/${encodeURIComponent(party.groupId)}/state`;
            this._hpBusy = true;
            try {
                // 1. Свой HP из игры. Если /api/me недоступен — просто не
                //    отправляем стейт, панель строится по данным сервера.
                const me = await this._fetchMe();

                // 1a. Детектор журнала — только по «живому» снимку /api/me.
                //     Фолбэк (live:false) не должен выглядеть как quest_end/death.
                if (me.live) {
                    const events = this._detectLogEvents(this._prevMe, me);
                    for (const ev of events) {
                        // Последовательно: id в БД должны идти в порядке событий.
                        if (!(await this._postLogEvent(ev.type, ev.text))) break;
                    }
                    // _prevMe обновляем даже при ошибке сети: иначе одно и то же
                    // событие отправлялось бы каждый тик.
                    this._prevMe = { hp: me.hp, quest: me.quest, ghost: me.ghost, role: me.role };
                    // 401 внутри POST уже сбросил локальное состояние.
                    if (!this._readState()) return;
                }

                if (me.hp !== null && me.maxHp !== null && me.maxHp > 0) {
                    try {
                        // 2. POST — тихо: ошибка не должна спамить пользователя.
                        await this._request('POST', path, {
                            body: { hp: me.hp, maxHp: me.maxHp }
                        });
                    } catch (e) {
                        console.warn('[PARTY] не удалось отправить HP:', e?.message || e);
                        // 401 уже обработан в _request(): стейт сброшен, панель
                        // скрыта, тост показан — дальше GET бессмыслен.
                        if (Number(e?.status) === 401) return;
                    }
                }

                // 3. GET всех стейтов -> перерисовка панели.
                const res = await this._request('GET', path);
                // Пока ждали ответ, могли выйти из пати — тогда рендер не нужен.
                if (!this._readState()) return;
                this._renderPanel(res?.states);
            } catch (e) {
                console.warn('[PARTY] синхронизация HP:', e?.message || e);
                // 401 = нас кикнули/пати удалена: _request() уже вызвал
                // _resetLocalState() (там stopHpSync + тост), дублируем страховкой.
                if (Number(e?.status) === 401) this.stopHpSync();
            } finally {
                this._hpBusy = false;
            }
        },

        /* ---------------------------------------------------------- */
        /* Взаимный хил (шаг 4, v11.6.0d)                              */
        /* ---------------------------------------------------------- */

        /**
         * Лечение союзника: POST /c/<канал>/api/qact.
         *
         * Тело — «кнопка» похода: k:'b' (button), a:'sk' (навык), w:'лечение'
         * (подпись кнопки), t:<ник цели>. Запрос идёт с того же origin, что и
         * страница игры, поэтому обычный fetch с credentials:'include' (CORS
         * тут не при чём), а не Utils.fetchApi — это не /api/… путь пати.
         *
         * Ответ {ok:true, id} = «действие встало в очередь» (AGENTS.md §3):
         * игра применит хил не сразу, поэтому HP-панель обновляем с задержкой
         * 1 с, иначе GET state вернёт ещё старое HP.
         *
         * Ошибки игры (нет похода, кулдаун, цель умерла/вне зоны) приходят как
         * {ok:false, error} или не-2xx — показываем их тостом через _runAction.
         *
         * @param {string} targetLogin ник цели из data-party-heal
         * @param {HTMLButtonElement|null} button кнопка (блокируется на время запроса)
         */
        async _healMember(targetLogin, button) {
            const target = String(targetLogin || '').trim();
            if (!target) return;

            const key = target.toLowerCase();
            // Клик пришёл, пока предыдущий запрос по этой же цели в полёте:
            // второй POST не нужен (панель перерисовывается раз в 3 с).
            if (this._healBusy.has(key)) return;
            this._healBusy.add(key);

            try {
                await this._runAction(button, null, async () => {
                    try {
                        const channel = this._channelLogin();
                        if (!channel) throw new Error('игра не загрузилась');

                        const url = `/c/${encodeURIComponent(channel)}/api/qact`;
                        const body = { k: 'b', a: 'sk', w: 'лечение', t: target };

                        const res = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify(body)
                        });
                        const data = await res.json().catch(() => ({}));

                        if (!res.ok || data.ok === false) {
                            // Ошибка игры: нет похода, кулдаун, цель умерла и т.д.
                            throw new Error(data.error || `HTTP ${res.status}`);
                        }

                        // Успех: пишем в журнал пати. Сбой журнала не отменяет хил
                        // (_postLogEvent возвращает false, а не бросает).
                        await this._postLogEvent('heal_cast', `Лечит ${target}`);

                        // Принудительно обновить HP-панель через 1 с (ждём, пока
                        // игра применит хил). _hpTick(), а не _runTick(): в этом
                        // модуле такт синхронизации называется именно _hpTick().
                        setTimeout(() => { this._hpTick(); }, 1000);
                    } catch (err) {
                        // Тост показывает сам _runAction (errorBox = null),
                        // поэтому префикс из ТЗ добавляем ровно один раз — здесь.
                        throw new Error(`Не удалось: ${err?.message || err}`);
                    }
                }, '...');
            } finally {
                this._healBusy.delete(key);
                // Кнопку могла перерисовать панель, пока шёл запрос: busy-флаг
                // уже снят, но узел в DOM вернём в исходный вид (в _runAction
                // prevText мог оказаться '...' от busy-рендера).
                if (button && button.isConnected) {
                    button.disabled = false;
                    button.textContent = '❤';
                }
            }
        },

        /* ---------------------------------------------------------- */
        /* UI                                                          */
        /* ---------------------------------------------------------- */

        /** Кнопка «Пати» в FAB-меню (modules/auction.js — тот же паттерн). */
        init() {
            // Перезапуск скрипта (single-instance guard в main.js) не убивает
            // таймеры старого инстанса: два интервала HP = двойной POST раз в 3 с.
            const prev = G.__LEGION__?.Party;
            if (prev && prev !== this) {
                try { prev.stopHpSync?.(); } catch (e) {}
            }

            const btn = document.getElementById(DOM_IDS.btnParty) || document.getElementById('btn-party');
            btn?.addEventListener('click', () => this.open());

            // Скрипт мог загрузиться при уже активной пати (перезагрузка
            // страницы, повторная инъекция): панель поднимаем сразу.
            if (this._readState()) this.startHpSync();
        },

        /**
         * Копирование кода приглашения. navigator.clipboard требует secure
         * context и разрешения — при отказе выделяем текст в поле, чтобы
         * пользователь скопировал его вручную (Ctrl+C).
         */
        async _copy(text, fallbackEl = null) {
            const value = String(text ?? '');
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(value);
                    return true;
                }
            } catch (e) {
                dbg('[PARTY] clipboard.writeText недоступен:', e);
            }

            if (fallbackEl) {
                try {
                    fallbackEl.focus();
                    fallbackEl.select();
                    if (typeof fallbackEl.setSelectionRange === 'function') {
                        fallbackEl.setSelectionRange(0, value.length);
                    }
                } catch (e) {
                    dbg('[PARTY] выделить текст не удалось:', e);
                }
                return false;
            }

            // Совсем старый браузер без Clipboard API: execCommand-фолбэк.
            try {
                const ta = document.createElement('textarea');
                ta.value = value;
                ta.style.cssText = 'position:fixed; top:-1000px; left:-1000px; opacity:0;';
                document.body.appendChild(ta);
                ta.select();
                const ok = document.execCommand('copy');
                ta.remove();
                return ok;
            } catch (e) {
                return false;
            }
        },

        async open() {
            const state = this.partyState();

            if (!state.party) {
                const modal = UI.showModal(this._modalHtmlEmpty(), { compact: true, customClass: 'party-modal' });
                if (!modal) return;
                this._bindEmpty(modal);
                // Ник отрисован синхронно (мог уйти в фолбэк LG_CH.login):
                // дозапрашиваем /api/me в фоне и правим только текстовый узел.
                this._refreshSelfNick(modal);
                return;
            }

            const modal = UI.showModal(this._modalHtmlParty(state.party, state.isOwner), { compact: true, customClass: 'party-modal' });
            if (!modal) return;
            this._bindParty(modal, state.party);
            // Список участников — отдельным запросом: модалка открывается
            // сразу, а members может ответить 401 (сессию убили) или упасть
            // по сети. Ошибка не должна ломать само окно.
            this._refreshMembers(modal).catch((e) => dbg('[PARTY] members:', e));
        },

        /**
         * Догоняющий запрос ника для пустого состояния (ТЗ 11.6.0a.3).
         *
         * _modalHtmlEmpty() рендерится синхронно, а _fetchMe() асинхронный:
         * при первом открытии _cachedLogin пуст, поэтому «Вы: …» показывал
         * _channelLogin() — логин Twitch-канала вместо игрового ника. Здесь
         * запускаем фоновый GET /api/me и, когда он ответит, меняем ТОЛЬКО
         * textContent узла .party-self-nick.
         *
         * Полная перерисовка модалки запрещена: пользователь может уже
         * печатать код приглашения, innerHTML-рендер собьёт фокус и каретку.
         *
         * Пока запрос в полёте, повторный open() его переиспользует
         * (_selfNickFetch), а если ник уже кэширован — сеть не трогаем.
         *
         * @param {HTMLElement|null} modal окно, отрисованное в open()
         */
        _refreshSelfNick(modal = null) {
            if (this._cachedLogin) return;     // ник уже известен — фетч не нужен
            if (this._selfNickFetch) return;   // запрос уже в полёте

            this._selfNickFetch = this._fetchMe()
                .then((me) => {
                    const nick = String(me?.login || '').trim();
                    // И /api/me, и LG_CH.login молчат: оставляем то, что
                    // отрисовано («—» или прежний фолбэк), не стираем ник.
                    if (!nick) return;

                    // Окно могли закрыть — тогда обновлять нечего (узла нет).
                    // Если его успели открыть заново, новый рендер тоже
                    // показал фолбэк, поэтому берём актуальный узел из DOM.
                    const el = (modal && modal.isConnected)
                        ? modal.querySelector('.party-self-nick')
                        : document.querySelector('.party-self-nick');
                    if (el) el.textContent = nick;
                })
                .catch((e) => {
                    // _fetchMe() ловит свои ошибки сам (фолбэк LG_CH.login);
                    // сюда попадаем только при неожиданном сбое внутри.
                    console.warn('[PARTY] фоновый /api/me не ответил:', e);
                })
                .finally(() => {
                    this._selfNickFetch = null;
                });
        },

        /** Обрезка groupId для заголовка: первые 8 символов + «…». */
        _shortId(groupId) {
            const id = String(groupId || '');
            return id.length > 8 ? `${id.slice(0, 8)}…` : (id || '—');
        },

        /** Компактный крестик: правый верхний угол заголовка (h2 = flex). */
        _closeBtn() {
            return `<button class="custom-close party-close" id="custom-close-btn"
                style="font-size:16px; padding:4px 8px; line-height:1; margin-left:auto;"
                title="Закрыть">×</button>`;
        },

        /** Секция «УЧАСТНИКИ»: список заполняет _refreshMembers(). */
        _membersSection() {
            return `<div>
                <div class="${this.MUTED_CLASS}">Участники</div>
                <div id="party-members" style="display:flex; flex-direction:column; max-height:180px; overflow-y:auto;">
                    <div style="font-size:12px; color:#888;">Загрузка…</div>
                </div>
            </div>`;
        },

        /** Строка участника: «• <login> (вы|owner|member)» + «Кикнуть». */
        _memberRow(member, canKick) {
            const login = Utils.escapeHtml(member.login || '?');
            const labels = [];
            if (member.self) labels.push('вы');
            labels.push(member.role === 'owner' ? 'owner' : 'member');

            // Кик — только у владельца и только для чужих строк. memberId
            // храним в data-атрибуте: sessionId клиенту больше не приходит.
            const kick = (canKick && !member.self && member.memberId)
                ? `<button data-party-kick="${Utils.escapeHtml(member.memberId)}" class="${this.DANGER_BTN_CLASS} party-btn-sm">Кикнуть</button>`
                : '';

            return `<div style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:13px;">
                        <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">• ${login} <span style="color:#888;">(${labels.join(', ')})</span></span>
                        ${kick}
                    </div>`;
        },

        /** Состояние «нет пати»: создать либо присоединиться по коду приглашения. */
        _modalHtmlEmpty() {
            const nick = this._defaultNick();
            const safeNick = Utils.escapeHtml(nick || '—');

            return `
                <h2>👥 Пати ${this._closeBtn()}</h2>
                <div style="display:flex; flex-direction:column; gap:14px; padding:6px 2px;">
                    <div>
                        <div class="${this.MUTED_CLASS}">Создать пати</div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="flex:1; min-width:0; font-size:13px; color:#ccc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                Вы: <b class="party-self-nick">${safeNick}</b>
                            </div>
                            <button id="party-create-btn" class="${this.BTN_CLASS}">Создать</button>
                        </div>
                    </div>
                    <div class="party-sep">
                        <div class="${this.MUTED_CLASS}">Код приглашения</div>
                        <div class="party-field">
                            <input id="party-join-token" type="text" autocomplete="off" spellcheck="false"
                                placeholder="Вставьте код приглашения" class="${this.INPUT_CLASS}">
                            <button id="party-join-btn" class="${this.BTN_CLASS}">Присоединиться</button>
                        </div>
                    </div>
                    <div id="party-error" class="party-error"></div>
                </div>
            `;
        },

        /**
         * Состояние «в пати». owner видит полный код приглашения, ротацию и
         * кик; member — только состав и выход.
         */
        _modalHtmlParty(party, isOwner) {
            const safeLogin = Utils.escapeHtml(party.login || '—');
            const shortId = Utils.escapeHtml(this._shortId(party.groupId));

            const tokenBlock = isOwner ? `
                    <div>
                        <div class="${this.MUTED_CLASS}">Код приглашения</div>
                        <div class="party-field">
                            <input id="party-token-input" type="text" readonly value="${Utils.escapeHtml(party.inviteToken || '')}"
                                class="${this.TOKEN_INPUT_CLASS}">
                            <button id="party-copy-token" class="${this.BTN_CLASS}">Копировать</button>
                        </div>
                    </div>` : '';

            const rotateBtn = isOwner
                ? `<button id="party-rotate-btn" class="${this.BTN_CLASS}">Перевыпустить код</button>`
                : '';

            return `
                <h2>👥 Пати ${this._closeBtn()}</h2>
                <div style="display:flex; flex-direction:column; gap:12px; padding:6px 2px; overflow-y:auto;">
                    <div style="font-size:12px; color:#ccc; line-height:1.5;">
                        <div>Группа: <b style="color:#ffcf6a;">${shortId}</b></div>
                        <div>Вы: <b style="color:#ffcf6a;">${safeLogin}</b>${isOwner ? ' (owner)' : ''}</div>
                    </div>
                    ${tokenBlock}
                    ${this._membersSection()}
                    <div class="party-sep" style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button id="party-refresh-btn" class="${this.BTN_CLASS}">Обновить</button>
                        ${rotateBtn}
                        <button id="party-leave-btn" class="${this.DANGER_BTN_CLASS} party-btn-lg">Покинуть пати</button>
                    </div>
                    <div id="party-error" class="party-error"></div>
                </div>
            `;
        },

        /** Перезагружает список участников в уже открытую модалку. */
        async _refreshMembers(modal) {
            const box = modal?.querySelector('#party-members');
            if (!box) return;

            try {
                const members = await this.partyMembers();
                if (!box.isConnected) return;
                const isOwner = this.partyState().isOwner;
                box.innerHTML = members.length
                    ? members.map((m) => this._memberRow(m, isOwner)).join('')
                    : '<div style="color:#888; font-size:12px; padding:6px;">В пати пока никого нет</div>';
            } catch (e) {
                // 401 = сессию убили (кик/выход владельца): показываем текст
                // прямо в списке, иначе он навсегда останется «Загрузка…».
                if (box.isConnected) {
                    box.innerHTML = `<div style="color:#ff8fa3; font-size:12px; padding:6px;">${Utils.escapeHtml(e?.message || 'Не удалось загрузить участников')}</div>`;
                }
                dbg('[PARTY] members:', e);
            }
        },

        /**
         * Обёртка для кнопок: блокирует её на время запроса и показывает
         * ошибку в блоке #party-error (он живёт до перерисовки модалки).
         *
         * @param {HTMLButtonElement|null} btn
         * @param {HTMLElement|null} errorBox
         * @param {() => Promise<void>} fn
         * @param {string} [busyText] текст на время запроса (защита от двойного
         *   клика: «Создать»/«Присоединиться» ждут /api/me, это до секунды)
         */
        async _runAction(btn, errorBox, fn, busyText = '') {
            const prevText = btn ? btn.textContent : '';
            if (btn) {
                btn.disabled = true;
                if (busyText) btn.textContent = busyText;
            }
            if (errorBox) errorBox.textContent = '';
            try {
                await fn();
            } catch (e) {
                dbg('[PARTY] Ошибка действия:', e);
                const msg = e.message || 'Неизвестная ошибка';
                if (errorBox) errorBox.textContent = msg;
                else UI.showToast(msg, true);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    if (busyText) btn.textContent = prevText;
                }
            }
        },

        /** Обработчики состояния «нет пати». */
        _bindEmpty(modal) {
            const errorBox = modal.querySelector('#party-error');
            const createBtn = modal.querySelector('#party-create-btn');
            const joinBtn = modal.querySelector('#party-join-btn');

            // Ник НЕ читается здесь: partyCreate()/partyJoin() сами берут его
            // из /api/me в момент клика (модалка может висеть часами), а до
            // ответа кнопка заблокирована и показывает «...».
            createBtn?.addEventListener('click', () => this._runAction(createBtn, errorBox, async () => {
                const party = await this.partyCreate();
                UI.showToast(`Пати создана: ${this._shortId(party.groupId)}`);
                await this.open();
            }, '...'));

            joinBtn?.addEventListener('click', () => {
                const token = (modal.querySelector('#party-join-token')?.value || '').trim();
                return this._runAction(joinBtn, errorBox, async () => {
                    const party = await this.partyJoin(token);
                    UI.showToast(`Вы вошли в пати как ${party.login}`);
                    await this.open();
                }, '...');
            });
        },

        /** Обработчики состояния «в пати». */
        _bindParty(modal, party) {
            const errorBox = modal.querySelector('#party-error');

            modal.querySelector('#party-copy-token')?.addEventListener('click', async () => {
                const input = modal.querySelector('#party-token-input');
                const ok = await this._copy(party.inviteToken || '', input);
                UI.showToast(
                    ok ? 'Код приглашения скопирован' : 'Скопируйте код вручную (Ctrl+C)',
                    !ok
                );
            });

            const refreshBtn = modal.querySelector('#party-refresh-btn');
            refreshBtn?.addEventListener('click', () => this._runAction(refreshBtn, errorBox, async () => {
                await this._refreshMembers(modal);
            }));

            const rotateBtn = modal.querySelector('#party-rotate-btn');
            rotateBtn?.addEventListener('click', () => this._runAction(rotateBtn, errorBox, async () => {
                await this.partyRotateToken();
                UI.showToast('Код приглашения перевыпущен');
                // В модалке показан сам код — перерисовываем её целиком.
                await this.open();
            }));

            // Кик — делегирование: строки участников перерисовываются
            // после каждого обновления списка, отдельные слушатели текли бы.
            modal.querySelector('#party-members')?.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-party-kick]');
                if (!btn) return;
                const memberId = btn.getAttribute('data-party-kick');
                return this._runAction(btn, errorBox, async () => {
                    await this.partyKick(memberId);
                    UI.showToast('Участник исключён');
                    await this._refreshMembers(modal);
                });
            });

            const leaveBtn = modal.querySelector('#party-leave-btn');
            leaveBtn?.addEventListener('click', () => this._runAction(leaveBtn, errorBox, async () => {
                const serverOk = await this.partyLeave();
                // Модалку в «нет пати» уже перерисовал _resetLocalState().
                // При недоступном сервере partyLeave показал предупреждение.
                if (serverOk) UI.showToast('Вы вышли из пати');
            }));
        }
    };
