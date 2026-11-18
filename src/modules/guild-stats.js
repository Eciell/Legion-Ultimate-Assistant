    // ============================================================
    // 6.7. МОДУЛЬ: СОСТАВ ГИЛЬДИИ ДЛЯ ОФИЦЕРОВ (modules/guild-stats.js)
    //
    // Патч 11.6.6c (+ 11.6.6c.1: уровни и классы, + 11.6.8: сборы у стен).
    // В окне «Гильдии альянса»
    // (.gl-modal) на вкладке «Участники» дописывает к нику бейджи: уровень,
    // класс, онлайн и где, длительность сессии, «был N назад», друг ли игрок,
    // мут и ожидание переезда.
    //
    // Источники данных (docs/API.md):
    //   - состав и роли: GET /api/guilds/guild?id=<guildId> -> members[]
    //     (role, joinedAt, pending, mutedUntil);
    //   - права: G.LGGuilds.index() -> mine.member.role;
    //   - уровень и класс: GET /api/legion -> roster[] (до 120 героев) и
    //     roles{}; 11.6.8 — второй источник POST /api/citymon/act {op:'elist'}
    //     (состав открытых сборов элитных у стен, кэш _citymonCache);
    //     фолбэк — свой герой G.ME.hero;
    //   - онлайн и история заходов: window.__lgOnlinePlayers
    //     ({ loc, ts, firstSeen, src }, см. Utils.updateOnlinePlayers);
    //   - друзья: G.LGFriends.friends() / G.LGFriends.state(login).
    //
    // Модуль работает ТОЛЬКО у руководства: leader / lead / officer.
    // member / novice / trusted ничего не получают — ни бейджей, ни запросов.
    //
    // Подключается после core/ui.js (SHARED_MODULES в build.js), поэтому
    // G/Utils уже объявлены; main.js вызывает init() в boot().
    // ============================================================
    const GuildStats = {
        _observer: null,
        _timer: null,
        // Склейка нескольких мутаций в один проход.
        _scheduled: false,
        // Защита от повторного входа: _refresh() асинхронный.
        _busy: false,
        // Наша собственная инъекция — тоже мутация, поэтому ставим флаг.
        _injecting: false,
        _lastRun: 0,

        // Кэш профиля гильдии: состав меняется редко, окно открывают повторно.
        _guildId: null,
        _guildData: null,
        _guildAt: 0,
        // Снимок LGGuilds.index(): своя роль и id гильдии.
        _mine: null,
        _mineAt: 0,
        // Друзья: LGFriends.friends() отдаёт массив логинов (кэш игры 60 с).
        _friends: null,
        _friendsAt: 0,
        // 11.6.6c.1: ростер /api/legion — уровни и классы для бейджей.
        // { byLogin: Map<логин|имя, {level, role, roleName}>, roles, at, total }.
        _legionCache: null,
        _legionAt: 0,
        // Предупреждение про пустой/битый ростер — не чаще раза в 5 минут.
        _legionWarnAt: 0,
        // 11.6.8: кэш уровней и классов из открытых сборов элитных монстров
        // у стен. Ростер /api/legion отдаёт только топ-120 героев канала, а в
        // лобби сборов видны участники гильдии с реальным уровнем и классом.
        // Ключи: lowercase логин и name; значение { level, role, roleName, at }.
        _citymonCache: new Map(),
        // Время последнего запроса /api/citymon/act (троттлинг).
        _citymonFetchAt: 0,
        // Своя история первого обнаружения сессии: players.js (SSE/DOM/API)
        // перезаписывает записи window.__lgOnlinePlayers без firstSeen.
        _seen: new Map(),

        // Игрока не видели 5 минут — сессия считается завершённой. Тот же
        // порог, по которому updateOnlinePlayers() начинает новый firstSeen.
        ONLINE_TTL: 300000,
        GUILD_TTL: 60000,
        FRIENDS_TTL: 60000,
        LEGION_TTL: 60000,
        // Не чаще раза в минуту: сборы меняются не мгновенно, а окно
        // гильдии перерисовывается куда чаще.
        CITYMON_COOLDOWN_MS: 60000,
        MINE_TTL: 15000,
        // Шаг обновления «онлайн / был N назад» у открытого окна.
        TICK_MS: 30000,

        // Основной селектор из ТЗ (в некоторых сборках игры у .gl-pane есть
        // data-tab) и фолбэк на фактическую разметку reference/.../guilds.js,
        // где data-tab висит только на кнопках .gl-tabs.
        MEM_SELECTOR: '.gl-modal .gl-pane[data-tab="mem"] ul.gl-mem li[data-mtid]',
        MEM_FALLBACK: '.gl-modal .gl-pane ul.gl-mem li[data-mtid]',

        init() {
            // Повторный init (перезапуск скрипта) не должен плодить наблюдатели.
            if (this._observer) return;
            if (typeof MutationObserver === 'undefined') return;

            this._observer = new MutationObserver(() => this._onMutation());
            // Только childList: атрибуты нам не нужны, а в городе их сотни.
            // Окно гильдий игра создаёт в body и перерисовывает панель целиком.
            this._observer.observe(document.body, { childList: true, subtree: true });

            // Пока окно открыто — раз в 30 с обновляем «онлайн / был N назад»
            // даже без мутаций: время идёт, а DOM стоит.
            this._timer = setInterval(() => {
                if (!document.querySelector('.gl-modal')) return;
                if (!this._rows().length) return;
                this._refresh(false).catch(() => {});
            }, this.TICK_MS);
        },

        // Гасим наблюдатель и таймер при перезапуске скрипта (shutdown в main.js).
        destroy() {
            if (this._observer) {
                try { this._observer.disconnect(); } catch (e) {}
            }
            this._observer = null;
            if (this._timer) clearInterval(this._timer);
            this._timer = null;
            this._scheduled = false;
            this._busy = false;
            this._injecting = false;
            this._lastRun = 0;
            this._guildId = null;
            this._guildData = null;
            this._guildAt = 0;
            this._mine = null;
            this._mineAt = 0;
            this._friends = null;
            this._friendsAt = 0;
            this._legionCache = null;
            this._legionAt = 0;
            this._legionWarnAt = 0;
            this._citymonCache.clear();
            this._citymonFetchAt = 0;
            this._seen.clear();
        },

        // Руководство гильдии. trusted намеренно исключён: у него нет прав
        // на управление составом (docs/API.md, «Иерархия ролей»).
        isOfficer(role) {
            return role === 'leader' || role === 'lead' || role === 'officer';
        },

        // Полный профиль гильдии: состав, роли, pending, мут.
        async fetchGuildData(guildId) {
            const id = (guildId == null) ? '' : String(guildId);
            if (!id) return null;

            const now = Date.now();
            if (this._guildId === id && this._guildData && (now - this._guildAt) < this.GUILD_TTL) {
                return this._guildData;
            }

            let res = null;
            try {
                // Utils.fetchApi добавляет префикс /c/<канал>/ (см. core/utils-api.js)
                // и кладёт данные и в body, и в корень ответа.
                res = await Utils.fetchApi('/api/guilds/guild?id=' + encodeURIComponent(id));
            } catch (e) {
                return null;
            }

            const body = (res && res.body) || res;
            if (!body || body.ok === false || !Array.isArray(body.members)) return null;

            this._guildId = id;
            this._guildData = body;
            this._guildAt = now;
            return body;
        },

        // Снимок индекса гильдий: своя роль и гильдия. У игры ответ кэшируется
        // внутри, но мы держим свой короткий TTL — окно может перерисовываться.
        async _mineIndex(force) {
            const now = Date.now();
            if (!force && this._mine && (now - this._mineAt) < this.MINE_TTL) return this._mine;

            const LGG = G.LGGuilds;
            if (!LGG || typeof LGG.index !== 'function') return null;

            let res = null;
            try { res = await LGG.index(); } catch (e) { return null; }
            if (!res || typeof res !== 'object') return null;

            this._mine = res;
            this._mineAt = now;
            return res;
        },

        // Карта онлайна из трекера сессий: ключ — ник в нижнем регистре.
        getLegionMap() {
            const map = new Map();
            const src = window.__lgOnlinePlayers || G.__lgOnlinePlayers;
            if (!src || typeof src.forEach !== 'function') return map;

            const now = Date.now();
            // Верхняя граница длительности сессии: раньше запуска аддона
            // мы о заходе игрока знать не могли (см. core/constants.js).
            const started = Number(G.__lguStartTime) || 0;

            src.forEach((info, nick) => {
                if (!info) return;
                const key = String(nick || '').trim().toLowerCase();
                if (!key) return;

                const ts = Number(info.ts) || 0;
                if (!ts) return;
                const prev = map.get(key);
                // Одна запись обновляется из SSE/DOM/API — берём самое свежее.
                if (prev && (prev.ts || 0) >= ts) return;

                // players.js перезаписывает записи трекера без firstSeen,
                // поэтому историю дублируем в _seen: пока разрыв между
                // наблюдениями меньше ONLINE_TTL, это та же сессия.
                const memo = this._seen.get(key);
                const seamless = !!(memo && (ts - memo.ts) < this.ONLINE_TTL);
                let firstSeen = seamless ? memo.firstSeen : (Number(info.firstSeen) || ts);
                if (!firstSeen || firstSeen > ts) firstSeen = ts;
                if (started > 0 && firstSeen < started) firstSeen = started;
                this._seen.set(key, { ts, firstSeen });

                map.set(key, {
                    loc: info.loc || null,
                    ts,
                    firstSeen,
                    src: info.src || null
                });
            });

            // Чистим историю давно ушедших, чтобы Map не рос бесконечно.
            if (this._seen.size > 500) {
                for (const [k, v] of this._seen) {
                    if ((now - v.ts) > 86400000) this._seen.delete(k);
                }
            }
            return map;
        },

        // 11.6.6c.1: ростер /api/legion — единственный массовый источник
        // уровня и класса (docs/API.md, «GET /api/legion»). В ответе до 120
        // самых опытных героев канала, поэтому для остальных участников
        // уровень останется «ур. —», а класс не рисуется.
        async fetchLegionRoster(force) {
            const now = Date.now();
            if (!force && this._legionCache && (now - this._legionAt) < this.LEGION_TTL) {
                return this._legionCache;
            }

            let res = null;
            try {
                res = await Utils.fetchApi('/api/legion');
            } catch (e) {
                this._warnLegion('запрос /api/legion упал: ' + (e && e.message ? e.message : e));
                return this._legionCache;
            }

            const body = (res && res.body) || res;
            if (!body || body.ok === false) {
                this._warnLegion('ответ /api/legion без ok', body);
                return this._legionCache;
            }

            const roles = (body.roles && typeof body.roles === 'object') ? body.roles : {};
            const roster = Array.isArray(body.roster) ? body.roster : [];
            const byLogin = new Map();

            for (const h of roster) {
                if (!h) continue;
                const keys = [h.login, h.name]
                    .filter(Boolean)
                    .map((s) => String(s).trim().toLowerCase());
                if (!keys.length) continue;
                const role = h.role ? String(h.role) : '';
                const entry = {
                    level: Number(h.level) || 0,
                    role,
                    roleName: this._roleName(role, roles),
                    ghost: !!h.ghost
                };
                for (const key of keys) if (key) byLogin.set(key, entry);
            }

            // Пустой ростер — не ошибка (права/сезон/пустой канал), но
            // молча терять уровни нельзя: один warn в 5 минут в консоль.
            if (!roster.length) {
                this._warnLegion('/api/legion вернул пустой ростер: уровни и классы недоступны');
            }

            this._legionCache = {
                byLogin,
                roles,
                at: Number(body.at) || now,
                total: body.total || null
            };
            this._legionAt = now;
            return this._legionCache;
        },

        // Имя класса: сначала словарь roles из /api/legion, затем classes
        // из /api/me (G.ME.classes), иначе пусто — бейдж не рисуем.
        _roleName(role, roles) {
            const id = String(role || '');
            if (!id) return '';
            if (roles && roles[id] && roles[id].name) return String(roles[id].name);
            const me = G.ME;
            if (me && Array.isArray(me.classes)) {
                const hit = me.classes.find((c) => c && c.id === id);
                if (hit && hit.name) return String(hit.name);
            }
            return '';
        },

        // console.warn про /api/legion: не чаще раза в 5 минут, чтобы тик
        // обновления окна не заливал консоль.
        _warnLegion(msg, data) {
            const now = Date.now();
            if (this._legionWarnAt && (now - this._legionWarnAt) < 300000) return;
            this._legionWarnAt = now;
            try { console.warn('[GuildStats] ' + msg, data === undefined ? '' : data); } catch (e) {}
        },

        // 11.6.8: разбор ответа POST /api/citymon/act { op: 'elist' }.
        // В лобби сборов элитных у стен игра отдаёт участников гильдии с
        // полями { login, name, level, role }, включая тех, кого нет в
        // топ-120 /api/legion. Складываем в _citymonCache по lowercase
        // логину и по имени (бейджи ищут по обоим, см. _heroStats).
        // rosterRoles — словарь roles{} из /api/legion для имени класса.
        _parseCityMonLobbies(res, rosterRoles) {
            // Utils.fetchApi кладёт тело и в body, и в корень ответа.
            const body = (res && res.body && typeof res.body === 'object') ? res.body : res;
            if (!body || body.ok === false || !Array.isArray(body.list)) return 0;

            const roles = rosterRoles
                || (this._legionCache && this._legionCache.roles)
                || null;
            const at = Date.now();
            let added = 0;

            for (const lobby of body.list) {
                if (!lobby || !Array.isArray(lobby.members)) continue;
                for (const m of lobby.members) {
                    if (!m || typeof m !== 'object') continue;
                    const login = String(m.login || '').trim().toLowerCase();
                    const name = String(m.name || '').trim();
                    const role = m.role ? String(m.role) : '';
                    const entry = {
                        level: Number(m.level) || 0,
                        role,
                        roleName: this._roleName(role, roles),
                        at
                    };

                    const keys = [login];
                    const nameKey = name.toLowerCase();
                    if (nameKey && nameKey !== login) keys.push(nameKey);
                    for (const key of keys) {
                        if (!key) continue;
                        this._citymonCache.set(key, entry);
                        added += 1;
                    }
                }
            }
            return added;
        },

        // 11.6.8: запрос открытых сборов у стен с троттлингом.
        // _citymonFetchAt ставим ДО запроса: параллельный вызов (тик окна
        // и мутация DOM) не должен уйти вторым запросом. Ошибки глушим —
        // окно гильдии обязано рисоваться и без сборов.
        async fetchCityMonLobbies() {
            const now = Date.now();
            if (now - this._citymonFetchAt < this.CITYMON_COOLDOWN_MS) return 0;
            this._citymonFetchAt = now;

            let res = null;
            try {
                res = await Utils.fetchApi('/api/citymon/act', { op: 'elist' });
            } catch (e) {
                return 0;
            }
            return this._parseCityMonLobbies(res);
        },

        // Карта друзей: логин -> 'friends'. Остальные состояния (in/out/blocked)
        // берём точечно через G.LGFriends.state() в mergeStats().
        async getFriendsMap() {
            const now = Date.now();
            if (this._friends && (now - this._friendsAt) < this.FRIENDS_TTL) return this._friends;

            const map = new Map();
            const F = G.LGFriends;
            if (F && typeof F.friends === 'function') {
                try {
                    const list = await F.friends();
                    for (const login of (Array.isArray(list) ? list : [])) {
                        const key = String(login || '').trim().toLowerCase();
                        if (key) map.set(key, 'friends');
                    }
                } catch (e) {
                    // /api/friends не ответил — рисуем без метки друга.
                }
            }

            this._friends = map;
            this._friendsAt = now;
            return map;
        },

        // 11.6.6c.1 (+ 11.6.8): уровень и класс участника.
        //   1) ростер /api/legion (до 120 героев канала);
        //   2) кэш сборов у стен _citymonCache (11.6.8) — для остальных;
        //   3) свой герой G.ME.hero — если строка про тебя (логин/имя);
        //   4) данных нет — level 0 (бейдж «ур. —»), класс не рисуем.
        // src возвращаем наружу: по нему _injectBadges() рисует подсказку.
        _heroStats(member, domNick, roster) {
            const api = member || {};
            const login = String(api.login || '').trim().toLowerCase();
            const names = [api.name, api.login, domNick]
                .filter(Boolean)
                .map((s) => String(s).trim().toLowerCase());

            if (roster && roster.byLogin && typeof roster.byLogin.get === 'function') {
                for (const key of names) {
                    const hit = roster.byLogin.get(key);
                    if (hit) {
                        return {
                            level: hit.level,
                            role: hit.role,
                            roleName: hit.roleName || this._roleName(hit.role, roster.roles),
                            src: 'legion'
                        };
                    }
                }
            }

            // 11.6.8: второй источник — открытые сборы элитных монстров у стен.
            // Ростер /api/legion покрывает только топ-120 героев канала, а лобби
            // сборов отдают уровень и класс всех участников гильдии в них.
            // Запись без уровня и класса (level 0, role '') бесполезна — пропускаем,
            // чтобы не перекрыть фолбэк на своего героя.
            if (this._citymonCache && typeof this._citymonCache.get === 'function') {
                for (const key of names) {
                    const hit = this._citymonCache.get(key);
                    if (hit && (hit.level || hit.role)) {
                        return {
                            level: Number(hit.level) || 0,
                            role: hit.role || '',
                            roleName: hit.roleName || this._roleName(hit.role, roster && roster.roles),
                            src: 'citymon'
                        };
                    }
                }
            }

            // Фолбэк: у своего героя уровень и класс всегда известны.
            const me = G.ME;
            const myHero = me && (me.hero || me.me);
            if (myHero) {
                const myLogin = me.user ? String(me.user.login || '').trim().toLowerCase() : '';
                const heroLogin = String(myHero.login || '').trim().toLowerCase();
                const heroName = String(myHero.name || '').trim().toLowerCase();
                const mine = (login && (login === myLogin || login === heroLogin))
                    || (!!heroName && names.includes(heroName))
                    || (!!myLogin && names.includes(myLogin));
                if (mine) {
                    const role = myHero.role || myHero.class || '';
                    return {
                        level: Number(myHero.level) || 0,
                        role,
                        roleName: myHero.roleName || this._roleName(role, roster && roster.roles),
                        src: 'me'
                    };
                }
            }

            return { level: 0, role: '', roleName: '', src: '' };
        },

        // Сводит профиль участника (API), ник из DOM, карту онлайна, друзей
        // и ростер /api/legion в один плоский объект для _injectBadges().
        mergeStats(member, nick, legion, friends, now = Date.now(), roster = null) {
            const api = member || {};
            const domNick = String(nick || '').trim();
            const apiNick = String(api.name || api.login || '').trim();
            const login = String(api.login || '').trim();

            // Трекер онлайна ключуется ником из чата (обычно имя героя),
            // поэтому пробуем имя, логин и ник из DOM — первый найденный побеждает.
            const keys = [apiNick, login, domNick]
                .filter(Boolean)
                .map((s) => s.toLowerCase());

            let on = null;
            let usedKey = '';
            for (const key of keys) {
                const hit = (legion && typeof legion.get === 'function') ? legion.get(key) : null;
                if (hit) {
                    on = hit;
                    usedKey = key;
                    break;
                }
            }

            // Друзья в LGFriends хранятся по Twitch-логину.
            let friend = null;
            if (friends && typeof friends.get === 'function') {
                friend = friends.get(login.toLowerCase()) || friends.get(domNick.toLowerCase()) || null;
            }
            if (!friend) {
                const F = G.LGFriends;
                if (F && typeof F.state === 'function') {
                    try { friend = F.state(login || domNick) || null; } catch (e) { friend = null; }
                }
            }

            const ts = on ? (Number(on.ts) || 0) : 0;
            const online = !!(on && ts && (now - ts) < this.ONLINE_TTL);
            const firstSeen = online ? (Number(on.firstSeen) || ts) : 0;

            // 11.6.6c.1 (+ 11.6.8: сборы у стен) — уровень и класс из
            // ростера /api/legion, кэша сборов или своего героя G.ME.hero.
            const hero = this._heroStats(api, domNick, roster);

            return {
                tid: (api.tid != null) ? String(api.tid) : null,
                nick: apiNick || domNick,
                // Гильдейская роль (member/leader/...) и класс героя — разные вещи.
                guildRole: api.role || null,
                role: hero.role,
                roleName: hero.roleName,
                level: hero.level,
                // 11.6.8: источник уровня/класса (legion | citymon | me | '').
                levelSrc: hero.src,
                online,
                loc: online ? (on.loc || null) : null,
                src: online ? (on.src || null) : null,
                key: usedKey,
                lastTs: ts,
                firstSeen,
                // Длительность текущей сессии: от первого обнаружения захода.
                sessionMs: online ? Math.max(0, now - firstSeen) : 0,
                offlineMs: (!online && ts) ? Math.max(0, now - ts) : 0,
                friend,
                joinedAt: Number(api.joinedAt) || 0,
                pending: !!api.pending,
                mutedUntil: Number(api.mutedUntil) || 0,
                now
            };
        },

        _onMutation() {
            // Наша инъекция бейджей тоже мутация — иначе получили бы цикл.
            if (this._injecting || this._scheduled) return;
            this._scheduled = true;

            const run = () => {
                this._scheduled = false;
                // Дешёвый фильтр: в городе и шахте модалки гильдий нет.
                if (!document.querySelector('.gl-modal')) return;
                if (!this._rows().length) return;
                this._refresh(false).catch(() => {});
            };
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
            else setTimeout(run, 100);
        },

        // Строки состава текущего окна. Разметка игры: li[data-mtid] внутри
        // ul.gl-mem (заявки идут с data-req — они нам не нужны).
        _rows() {
            const rows = document.querySelectorAll(this.MEM_SELECTOR);
            if (rows.length) return Array.from(rows);
            return Array.from(document.querySelectorAll(this.MEM_FALLBACK));
        },

        async _refresh(force) {
            if (this._busy) return;
            if (!this._rows().length) return;

            const now = Date.now();
            if (!force && (now - this._lastRun) < 250) return;
            this._lastRun = now;

            this._busy = true;
            try {
                // 1. Права: без офицерской роли молчим и в API не ходим.
                const idx = await this._mineIndex();
                const me = (idx && idx.mine && idx.mine.member) ? idx.mine.member : null;
                if (!me || !this.isOfficer(me.role)) {
                    this._rows().forEach((li) => this._removeBadges(li));
                    return;
                }

                // 2. Состав гильдии и сопутствующие карты.
                const data = await this.fetchGuildData(me.guild);
                if (!data) return;

                const legion = this.getLegionMap();
                // 11.6.6c.1: ростер /api/legion и друзья грузим ДО обхода
                // строк, иначе первый проход рисовал бы «ур. —» без класса.
                const [roster, friends] = await Promise.all([
                    this.fetchLegionRoster(),
                    this.getFriendsMap()
                ]);

                const byTid = new Map();
                for (const m of (data.members || [])) {
                    if (m && m.tid != null) byTid.set(String(m.tid), m);
                }

                // 11.6.8: сборы у стен (POST /api/citymon/act {op:'elist'})
                // пополняют уровни и классы участников, которых нет в топ-120
                // /api/legion. Ходим только при реально открытом окне гильдии
                // (.gl-modal) и не чаще CITYMON_COOLDOWN_MS — троттлинг внутри
                // fetchCityMonLobbies(); словарь roles{} он берёт из уже
                // загруженного ростера (_legionCache), поэтому вызываем ПОСЛЕ
                // Promise.all выше, иначе класс из сборов остался бы без имени.
                if (document.querySelector('.gl-modal')) {
                    await this.fetchCityMonLobbies();
                }

                // 3. Бейджи по строкам. Строки без профиля в составе пропускаем:
                // это чужой профиль гильдии (окно открыто на другой гильдии)
                // или состав уже перерисовался — врать про онлайн нельзя.
                this._injecting = true;
                let matched = 0;
                const stamp = Date.now();
                try {
                    for (const li of this._rows()) {
                        const tid = li.getAttribute('data-mtid');
                        const member = byTid.get(String(tid)) || null;
                        if (!member) {
                            this._removeBadges(li);
                            continue;
                        }
                        matched += 1;
                        const stats = this.mergeStats(member, this._rowNick(li), legion, friends, stamp, roster);
                        this._injectBadges(li, stats);
                    }
                } finally {
                    this._injecting = false;
                }

                // Ни одна строка не совпала с составом своей гильдии — значит
                // открыт профиль чужой гильдии: бейджи там не нужны.
                if (!matched) this._rows().forEach((li) => this._removeBadges(li));
            } finally {
                this._busy = false;
            }
        },

        // Ник из строки состава: <b> внутри .gl-mn. Игра дописывает «(ты)»
        // в тот же <b>, поэтому суффикс вырезаем.
        _rowNick(li) {
            const b = li ? li.querySelector('.gl-mn > b') : null;
            if (!b) return '';
            return String(b.textContent || '').replace(/\(\s*ты\s*\)/ig, '').trim();
        },

        // Бейджи встают сразу после <b> с ником, внутри .gl-mn. pointer-events
        // не переопределяем: на строке висит контекстное меню действий.
        _injectBadges(li, stats) {
            if (!li || !stats) return;
            const nickEl = li.querySelector('.gl-mn > b');
            if (!nickEl) return;

            const badges = [];

            // 11.6.6c.1 (+ 11.6.8: сборы у стен): уровень и класс
            // (ростер /api/legion -> кэш сборов -> свой герой G.ME.hero).
            // Уровень рисуем всегда — «ур. —» честно показывает, что данных нет.
            const lvlTitle = !stats.level
                ? 'Уровень неизвестен: героя нет ни в ростере /api/legion, ни в сборах у стен'
                : (stats.levelSrc === 'citymon'
                    ? 'Уровень героя (данные сборов у стен)'
                    : (stats.levelSrc === 'me'
                        ? 'Уровень своего героя (G.ME.hero)'
                        : 'Уровень героя (данные /api/legion)'));
            badges.push({
                cls: 'lgu-gbadge lgu-glvl',
                raw: true,
                text: stats.level ? `ур. ${stats.level}` : 'ур. —',
                title: lvlTitle
            });
            if (stats.roleName) {
                badges.push({
                    cls: `lgu-gbadge lgu-gcls lgu-cls-${stats.role || 'recruit'}`,
                    raw: true,
                    text: stats.roleName,
                    title: stats.role ? `Класс героя: ${stats.role}` : 'Класс героя'
                });
            }

            if (stats.online) {
                // Город/шахта: подпись из loc трекера онлайна.
                const where = stats.loc === 'mine' ? '⛏ шахта'
                    : (stats.loc === 'city' ? '🏙 город' : '🟢 онлайн');
                const title = `Онлайн: ${where} · найден ${this._formatAgo(stats.firstSeen)}`
                    + (stats.src ? ` · источник: ${stats.src}` : '');
                badges.push({ cls: stats.loc === 'mine' ? 'on mine' : 'on', text: where, title });

                // Сессию короче минуты не показываем — это шум.
                if (stats.sessionMs >= 60000) {
                    badges.push({
                        cls: 'time',
                        text: '⏱ ' + this._formatDuration(stats.sessionMs),
                        title: 'В игре с ' + new Date(stats.firstSeen).toLocaleTimeString('ru-RU')
                    });
                }
            } else if (stats.lastTs) {
                badges.push({
                    cls: 'off',
                    text: '⚪ был ' + this._formatAgo(stats.lastTs),
                    title: 'Последняя активность: ' + new Date(stats.lastTs).toLocaleString('ru-RU')
                });
            } else {
                badges.push({
                    cls: 'off',
                    text: '⚪ офлайн',
                    title: 'Ни разу не попал в трекер онлайна аддона'
                });
            }

            if (stats.friend === 'friends') {
                badges.push({ cls: 'friend', text: '⭐ друг', title: 'Игрок у тебя в друзьях' });
            } else if (stats.friend === 'in') {
                badges.push({ cls: 'friend', text: '✉ зовёт', title: 'Прислал заявку в друзья' });
            }

            if (stats.mutedUntil > stats.now) {
                badges.push({
                    cls: 'warn',
                    text: '🔇 мут',
                    title: 'Мут в чате гильдии до ' + new Date(stats.mutedUntil).toLocaleString('ru-RU')
                });
            }
            if (stats.pending) {
                badges.push({ cls: 'warn', text: '⏳ переезд', title: 'Ждёт решения о переезде в гильдию' });
            }

            // Подпись содержимого: если ничего не изменилось, DOM не трогаем
            // (наблюдатель иначе раскрутил бы цикл мутаций).
            const sig = badges.map((b) => b.cls + ':' + b.text).join('|');
            let box = li.querySelector('.gl-mn > .lgu-guild-badges');
            if (box && box.dataset.sig === sig) return;

            if (!box) {
                box = document.createElement('span');
                box.className = 'lgu-guild-badges';
                nickEl.insertAdjacentElement('afterend', box);
            }

            box.dataset.sig = sig;
            box.innerHTML = '';
            for (const b of badges) {
                const el = document.createElement('span');
                // Уровень/класс используют собственные классы (.lgu-gbadge),
                // остальные бейджи — общий .lgu-gst.
                el.className = b.raw ? b.cls : 'lgu-gst ' + b.cls;
                el.textContent = b.text;
                if (b.title) el.title = b.title;
                box.appendChild(el);
            }
        },

        _removeBadges(li) {
            if (!li) return;
            li.querySelectorAll('.gl-mn > .lgu-guild-badges').forEach((el) => el.remove());
        },

        // Компактная подпись давности для бейджа: «только что», «5м назад»…
        _formatAgo(ts) {
            const t = Number(ts) || 0;
            if (!t) return 'неизвестно';
            const diff = Math.max(0, Date.now() - t);
            if (diff < 60000) return 'только что';
            const min = Math.floor(diff / 60000);
            if (min < 60) return min + 'м назад';
            const hours = Math.floor(min / 60);
            if (hours < 24) return hours + 'ч назад';
            return Math.floor(hours / 24) + 'д назад';
        },

        // Длительность сессии: «45м», «2ч 10м», «1д 3ч».
        _formatDuration(diffMs) {
            const sec = Math.max(0, Math.floor((Number(diffMs) || 0) / 1000));
            if (sec < 60) return Math.max(1, sec) + 'с';
            const min = Math.floor(sec / 60);
            if (min < 60) return min + 'м';
            const hours = Math.floor(min / 60);
            const rest = min % 60;
            if (hours < 24) return rest ? `${hours}ч ${rest}м` : `${hours}ч`;
            return `${Math.floor(hours / 24)}д ${hours % 24}ч`;
        }
    };

    // Для доступа из консоли страницы: window аддона — песочница, поэтому
    // публикуем в page-context через G (unsafeWindow), как это делает main.js.
    try {
        const gsWin = (typeof G !== 'undefined' && G) ? G : window;
        gsWin.LegionGuildStats = GuildStats;
    } catch (e) {}
