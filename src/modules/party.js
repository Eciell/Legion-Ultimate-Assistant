    // ============================================================
    // 9. МОДУЛЬ: ПАТИ (группы игроков, шаг 1)
    //
    // Клиент к собственному серверу (server/), а не к API игры: запросы
    // идут мимо /c/<канал>/ через GM_xmlhttpRequest (см. AGENTS.md, §3:
    // домен сервера чужой для игры, поэтому обычный fetch упёрся бы в CORS
    // и CSP страницы `connect-src 'self'`).
    //
    // Хранилище — GM_setValue/GM_getValue (@grant в шапке):
    //   lgPartyBaseUrl — адрес сервера (по умолчанию http://localhost:8787);
    //   lgParty        — {groupId, inviteToken, sessionId, login};
    //   lgPartyOwner   — создал ли этот клиент пати.
    // Если GM-хранилище недоступно (старая версия скрипта без @grant),
    // молча падаем на localStorage, иначе модуль падал бы на первом клике.
    //
    // Шаг 1 = только auth/token-gate: create/join/leave/rotate/kick/members.
    // v11.6.0a: вход — по inviteToken (POST /party/join), memberId отдельно от
    // sessionId, серверный leave и lowercase-логины. Ник читается из игры
    // ТОЛЬКО в момент клика «Создать»/«Присоединиться».
    // v11.6.0a.2: ник и HP берутся из GET /api/me (user.login / hero.hpNow),
    // LG_CH.login — только фолбэк: в песочнице он бывает пустым.
    // v11.6.0b: HP-панель. Раз в 3 с (только когда мы в пати) клиент шлёт
    // POST /party/:id/state и перерисовывает список из GET /party/:id/state.
    // Журнал и хил — по-прежнему шаг 3+.
    // ============================================================
    const Party = {
        BASE_URL_KEY: 'lgPartyBaseUrl',
        STATE_KEY: 'lgParty',
        OWNER_KEY: 'lgPartyOwner',
        DEFAULT_BASE_URL: 'http://localhost:8787',
        REQUEST_TIMEOUT: 12000,
        // Период синхронизации HP (ТЗ 11.6.0b: раз в 3 секунды).
        HP_SYNC_MS: 3000,
        // Сервер хранит ник только в нижнем регистре (server/index.js).
        LOGIN_RE: /^[a-z0-9_]{1,32}$/,
        // inviteToken = 16 случайных байт = 32 hex-символа (server/db.js).
        INVITE_RE: /^[a-f0-9]{32}$/i,

        // Рантайм-поля. Объявлены явно, чтобы в отладке не ловить undefined.
        _hpTimer: null,      // setInterval HP-синхронизации
        _hpBusy: false,      // тик уже в работе (медленная сеть)
        _cachedLogin: '',    // последний ник из /api/me — для синхронного рендера
        // id панели с префиксом RAND_ID: чужие page-стили не должны её зацепить.
        PANEL_ID: `${RAND_ID}-party-hp-panel`,

        // Инлайн-стили: у модалок аддона нет готовых классов для форм,
        // а заводить их в core/styles.js ради одного окна — лишнее.
        INPUT_STYLE: 'width:100%; box-sizing:border-box; background:#222; border:1px solid #444; color:#fff; padding:8px 10px; border-radius:6px; font-size:13px; outline:none;',
        BTN_STYLE: 'padding:8px 12px; background:#2a2030; border:1px solid #caa55c; color:#ffcf6a; border-radius:6px; cursor:pointer; font-size:13px; white-space:nowrap;',
        DANGER_BTN_STYLE: 'padding:4px 8px; background:#3a1f28; border:1px solid #ff5a7a; color:#ff5a7a; border-radius:5px; cursor:pointer; font-size:11px; white-space:nowrap;',
        MUTED_STYLE: 'font-size:11px; color:#888; text-transform:uppercase; margin-bottom:6px;',

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
         * @returns {Promise<{login: string, hp: number|null, maxHp: number|null}>}
         */
        async _fetchMe() {
            const channel = this._channelLogin();
            if (!channel) {
                console.warn('[PARTY] LG_CH.login недоступен — /api/me не запросить');
                return { login: '', hp: null, maxHp: null };
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
                const me = {
                    login: String(login),
                    hp: Number.isFinite(hp) ? hp : null,
                    maxHp: Number.isFinite(maxHp) ? maxHp : null
                };
                this._cachedLogin = me.login;
                return me;
            } catch (e) {
                console.warn('[PARTY] /api/me недоступен, берём LG_CH.login:', e);
                this._cachedLogin = channel;
                return { login: channel, hp: null, maxHp: null };
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
                bad_invite: 'Неверный инвайт-токен',
                bad_invite_token: 'Некорректный инвайт-токен',
                login_taken: 'Этот ник уже занят в пати',
                party_not_found: 'Пати с таким токеном не найдена — проверьте inviteToken',
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
         * POST /party/join — войти по инвайт-токену.
         * groupId на клиенте не нужен: сервер находит пати по токену и
         * возвращает groupId в ответе.
         * @param {string} inviteToken 32 hex-символа (пробелы обрезаются)
         * @returns {Promise<{groupId: string, inviteToken: string, sessionId: string, login: string}>}
         */
        async partyJoin(inviteToken) {
            const token = String(inviteToken ?? '').trim();
            if (!token) throw new Error('Укажите inviteToken');
            if (!this.INVITE_RE.test(token)) throw new Error('Токен: 32 hex-символа');
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
         * POST /party/:id/rotate — перевыпустить инвайт-токен (только владелец).
         * @returns {Promise<string>} новый токен
         */
        async partyRotateToken() {
            const state = this._readState();
            if (!state) throw new Error('Вы не в пати');
            if (!this._isOwner()) throw new Error('Токен может перевыпустить только владелец пати');

            const res = await this._request('POST', this._partyPath('rotate'), { body: {} });
            if (!res?.inviteToken) throw new Error('Сервер не вернул новый inviteToken');

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

        /**
         * Элемент панели создаётся лениво и живёт до перезагрузки страницы.
         * Вариант «а» из ТЗ: fixed/right/top, тёмный фон и скругления как у FAB.
         * pointer-events:none — панель не должна перехватывать клики по игре.
         */
        _ensurePanel() {
            let el = document.getElementById(this.PANEL_ID);
            if (el && el.isConnected) return el;

            el = document.createElement('div');
            el.id = this.PANEL_ID;
            el.setAttribute('role', 'status');
            el.style.cssText = [
                'position:fixed', 'top:20px', 'right:20px', 'z-index:9999',
                'min-width:150px', 'max-width:260px',
                'background:rgba(20,16,26,0.92)', 'border:1px solid #3a3040',
                'border-radius:10px', 'padding:8px 10px',
                'box-shadow:0 6px 18px rgba(0,0,0,0.45)',
                'font:12px/1.4 system-ui,"Segoe UI",sans-serif', 'color:#e8e8ea',
                'display:none', 'pointer-events:none'
            ].join(';') + ';';
            document.body.appendChild(el);
            return el;
        },

        _hidePanel() {
            const el = document.getElementById(this.PANEL_ID);
            if (el) el.style.display = 'none';
        },

        /**
         * Перерисовка списка «ник: hp/maxHp» с цветовой полоской:
         * зелёный > 50%, жёлтый 20–50%, красный < 20% HP.
         * @param {Array<{login: string, hp: number, maxHp: number}>} states
         */
        _renderPanel(states) {
            const el = this._ensurePanel();
            const list = Array.isArray(states) ? states : [];

            const rows = list.map((s) => {
                const login = Utils.escapeHtml(s.login || '?');
                const rawMax = Math.max(0, Number(s.maxHp) || 0);
                const rawHp = Math.max(0, Number(s.hp) || 0);
                // hp не может быть больше максимума; при maxHp = 0 (битые
                // данные) показываем hp как есть, полоска остаётся пустой.
                const hp = Math.min(rawMax > 0 ? rawMax : rawHp, rawHp);
                const pct = rawMax > 0 ? Math.max(0, Math.min(100, (hp / rawMax) * 100)) : 0;
                // Ровно 50% — уже не «зелёный» (ТЗ: зелёный строго > 50%).
                const color = pct > 50 ? '#5fd987' : (pct < 20 ? '#ff5a7a' : '#ffcf6a');

                return `<div style="margin-bottom:6px;">
                    <div style="display:flex; justify-content:space-between; gap:8px;">
                        <span style="color:#ffcf6a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${login}:</span>
                        <span style="color:#ccc; white-space:nowrap;">${hp}/${rawMax}</span>
                    </div>
                    <div style="height:3px; margin-top:2px; border-radius:2px; background:#2a2030;">
                        <div style="height:3px; width:${pct.toFixed(1)}%; border-radius:2px; background:${color};"></div>
                    </div>
                </div>`;
            }).join('');

            el.innerHTML = '<div style="font-size:10px; letter-spacing:0.06em;'
                + ' text-transform:uppercase; color:#888; margin-bottom:6px;">Пати · HP</div>'
                + (rows || '<div style="color:#888;">Нет данных</div>');
            el.style.display = 'block';
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

        /** Остановить интервал и скрыть панель (выход, 401, перезапуск). */
        stopHpSync() {
            if (this._hpTimer) {
                clearInterval(this._hpTimer);
                this._hpTimer = null;
            }
            this._hidePanel();
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
         * Копирование токена. navigator.clipboard требует secure context и
         * разрешения — при отказе выделяем текст в поле, чтобы пользователь
         * скопировал его вручную (Ctrl+C).
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
                const modal = UI.showModal(this._modalHtmlEmpty(), { compact: true });
                if (!modal) return;
                this._bindEmpty(modal);
                return;
            }

            const modal = UI.showModal(this._modalHtmlParty(state.party, state.isOwner), { compact: true });
            if (!modal) return;
            this._bindParty(modal, state.party);
            // Список участников — отдельным запросом: модалка открывается
            // сразу, а members может ответить 401 (сессию убили) или упасть
            // по сети. Ошибка не должна ломать само окно.
            this._refreshMembers(modal).catch((e) => dbg('[PARTY] members:', e));
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
                <div style="${this.MUTED_STYLE}">Участники</div>
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
                ? `<button data-party-kick="${Utils.escapeHtml(member.memberId)}" style="${this.DANGER_BTN_STYLE}">Кикнуть</button>`
                : '';

            return `<div style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:13px;">
                        <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">• ${login} <span style="color:#888;">(${labels.join(', ')})</span></span>
                        ${kick}
                    </div>`;
        },

        /** Состояние «нет пати»: создать либо присоединиться по inviteToken. */
        _modalHtmlEmpty() {
            const nick = this._defaultNick();
            const safeNick = Utils.escapeHtml(nick || '—');

            return `
                <h2>👥 Пати ${this._closeBtn()}</h2>
                <div style="display:flex; flex-direction:column; gap:14px; padding:6px 2px;">
                    <div>
                        <div style="${this.MUTED_STYLE}">Создать пати</div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="flex:1; min-width:0; font-size:13px; color:#ccc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                Вы: <b style="color:#ffcf6a;">${safeNick}</b>
                            </div>
                            <button id="party-create-btn" style="${this.BTN_STYLE}">Создать</button>
                        </div>
                    </div>
                    <div style="border-top:1px solid #3a3040; padding-top:14px;">
                        <div style="${this.MUTED_STYLE}">Присоединиться</div>
                        <div style="display:flex; gap:6px;">
                            <input id="party-join-token" type="text" autocomplete="off" spellcheck="false"
                                placeholder="inviteToken" style="${this.INPUT_STYLE}">
                            <button id="party-join-btn" style="${this.BTN_STYLE}">Присоединиться</button>
                        </div>
                    </div>
                    <div id="party-error" style="display:none; color:#ff8fa3; font-size:12px; line-height:1.35;"></div>
                </div>
            `;
        },

        /**
         * Состояние «в пати». owner видит полный токен, ротацию и кик;
         * member — только состав и выход.
         */
        _modalHtmlParty(party, isOwner) {
            const safeLogin = Utils.escapeHtml(party.login || '—');
            const shortId = Utils.escapeHtml(this._shortId(party.groupId));

            const tokenBlock = isOwner ? `
                    <div>
                        <div style="${this.MUTED_STYLE}">Invite token</div>
                        <div style="display:flex; gap:6px;">
                            <input id="party-token-input" type="text" readonly value="${Utils.escapeHtml(party.inviteToken || '')}"
                                style="${this.INPUT_STYLE} font-size:11px; font-family:monospace;">
                            <button id="party-copy-token" style="${this.BTN_STYLE}">Копировать</button>
                        </div>
                    </div>` : '';

            const rotateBtn = isOwner
                ? `<button id="party-rotate-btn" style="${this.BTN_STYLE}">Перевыпустить токен</button>`
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
                    <div style="display:flex; gap:8px; flex-wrap:wrap; border-top:1px solid #3a3040; padding-top:12px;">
                        <button id="party-refresh-btn" style="${this.BTN_STYLE}">Обновить</button>
                        ${rotateBtn}
                        <button id="party-leave-btn" style="${this.DANGER_BTN_STYLE} padding:8px 12px; font-size:13px;">Покинуть пати</button>
                    </div>
                    <div id="party-error" style="display:none; color:#ff8fa3; font-size:12px; line-height:1.35;"></div>
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
                    ok ? 'Инвайт-токен скопирован' : 'Скопируйте токен вручную (Ctrl+C)',
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
                UI.showToast('Инвайт-токен перевыпущен');
                // В модалке показан сам токен — перерисовываем её целиком.
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
