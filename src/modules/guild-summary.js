    // ============================================================
    // 6.10. МОДУЛЬ: СВОДНАЯ СТАТИСТИКА ГИЛЬДИИ (modules/guild-summary.js)
    //
    // Четвёртая вкладка «Статистика» в НАТИВНОМ окне гильдии
    // (reference/LegionFrontSRC/site/guilds2.js: .gl-modal -> .gl-body ->
    // .gl-tabs.gl-tabs1 + .gl-pane) в стилистике guilds2.css.
    //
    // Доступ: только своя гильдия и только руководство/доверенные лица —
    // роль из G.LGGuilds.index().mine.member.role либо из ответа
    // /api/guilds/guild (me.role): leader, lead, officer, trusted.
    // Для novice/member и при просмотре чужой гильдии вкладки нет.
    //
    // Данные (docs/API.md, GET /api/guilds/guild?id=<id>):
    //   guild { name, tag, count, limit }
    //   me    { tid, role, can }
    //   members[] [{ tid, login, name, role, online, seenAt, joinedAt,
    //                hero { role, roleName, level, power } }]
    //
    // v11.7: инспектор участника. Клик по строке «Топ-5 по силе» или списка
    // неактивных лениво запрашивает GET /api/guilds/hero?tid=…&guild=…
    // (reference/LegionFrontSRC/site/guilds2.js: api.hero + heroWin) и
    // показывает оверлей-карточку: ник, класс, уровень, сила, первичные и
    // вторичные статы (st), 5 слотов экипировки (+en, редкость, статы) и
    // способности Арены (ab.ab / ab.ult).
    //
    // Античит / CSP:
    //   - window.fetch, LGMine.open и LGMine.onEvent НЕ патчим;
    //   - localStorage не используем: ответы сервера лежат в памяти
    //     (Map с TTL 60 c), при destroy() кэши чистятся;
    //   - при HTTP 429 или { error: 'rate_limited' } запросы героев встают
    //     на паузу 15–30 с (не долбим API);
    //   - id гильдии берём из G.ME / G.LGGuilds.index(), не чаще 30 c
    //     (index() — сетевой запрос нативного модуля).
    //
    // Подключается после core/ui.js (SHARED_MODULES в build.js); других
    // модулей аддона не касается. main.js вызывает init() в boot(),
    // destroy() — в shutdown().
    // ============================================================
    const GuildSummary = (() => {
        // Роли с доступом к сводке (иерархия из docs/API.md §15).
        const ROLE_OK = { leader: true, lead: true, officer: true, trusted: true };
        // Кэш ответа /api/guilds/guild: 60 c, как требует ТЗ.
        const GUILD_TTL = 60000;
        // v11.7: карточка героя участника (GET /api/guilds/hero) — 60 c.
        const HERO_TTL = 60000;
        // Пауза после провала запроса героя и лимит кэша (Map, не localStorage).
        const HERO_FAIL_TTL = 15000;
        const HERO_PAUSE_MIN = 15000;
        const HERO_PAUSE_MAX = 30000;
        const HERO_CACHE_MAX = 60;
        // Пауза после неудачного запроса, чтобы не долбить сервер.
        const GUILD_FAIL_TTL = 15000;
        // LGGuilds.index() — сетевой запрос: без гильдии не чаще 30 c.
        const GUILD_ID_TTL = 30000;
        // Склейка мутаций: не чаще четырёх проходов в секунду.
        const RUN_THROTTLE = 250;
        const DAY = 86400000;
        const WEEK = 7 * DAY;

        const TAB_KEY = 'lgu-stats';
        const PANE_CLS = 'lgu-gl-stats-pane';
        const HIDE_CLS = 'lgu-gl-pane-hidden';
        // Сколько неактивных показываем списком, остальное — счётчиком.
        const IDLE_LIMIT = 15;

        // Разметка вкладки — точно из ТЗ (иконка щита с барами).
        const TAB_HTML = '<button type="button" role="tab" aria-selected="false" data-tab="lgu-stats" class="lgu-gl-tab">'
            + '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
            + '<path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/>'
            + '<path d="M8 14v-3m4 3V8m4 6v-5"/></svg>Статистика</button>';

        // Русские имена классов: фолбэк, если hero.roleName сервер не отдал.
        const ROLE_RU = {
            legionary: 'Легионер', paladin: 'Паладин', rogue: 'Разбойник',
            recruit: 'Новобранец', archer: 'Лучник', mage: 'Маг',
            necromancer: 'Некромант', priest: 'Жрец'
        };
        // v11.7: инспектор участника — словари карточки героя.
        // Слоты в порядке нативного окна героя (guilds2.js: HSLOTS).
        const HERO_SLOTS = [
            ['helmet', 'Шлем'],
            ['weapon', 'Оружие'],
            ['shield', 'Вторая рука'],
            ['armor', 'Доспех'],
            ['trinket', 'Амулет']
        ];
        const HERO_RARITY = {
            common: 'обычное', uncommon: 'необычное', rare: 'редкое',
            epic: 'эпическое', legendary: 'легендарное'
        };
        const HERO_STATS = [
            ['hp', 'Здоровье'],
            ['atk', 'Атака'],
            ['mag', 'Магия'],
            ['def', 'Броня'],
            ['crit', 'Крит, %'],
            ['critDmg', 'Сила крита, %'],
            ['dodge', 'Уклонение, %'],
            ['pierce', 'Пробивание'],
            ['healPow', 'Сила лечения'],
            ['luck', 'Удача'],
            ['resist', 'Сопротивление']
        ];
        const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

        // Ранги: officer — синоним lead, member — novice (ROLE/ORD в guilds2.js).
        const TIERS = [
            { key: 'leader', title: 'Глава', roles: ['leader'] },
            { key: 'lead', title: 'Руководство', roles: ['lead', 'officer'] },
            { key: 'trusted', title: 'Доверенные', roles: ['trusted'] },
            { key: 'novice', title: 'Новички', roles: ['novice', 'member'] }
        ];

        // ------------------------------------------------------------
        // Состояние модуля
        // ------------------------------------------------------------
        let observer = null;
        let scheduled = false;
        let pendingForce = false;
        let deferredTimer = null;
        let destroyed = true;
        let running = false;
        let lastRun = 0;
        // Выбрана ли наша вкладка (игру перерисовывает .gl-body целиком,
        // поэтому флаг живёт отдельно от DOM).
        let wantStats = false;
        let onDocClick = null;

        // id своей гильдии и роль текущего игрока.
        let guildId = null;
        let guildIdAt = 0;
        let role = '';
        // Запрос /api/guilds/guild уже в полёте (дедупликация).
        let dataBusy = null;

        // Кэш ответов: gid -> { at, body }; провалы: gid -> timestamp.
        const cache = new Map();
        const failAt = new Map();

        // v11.7: карточки героев участников (GET /api/guilds/hero).
        // Только память: tid -> { at, hero }; heroFail — провалы по tid,
        // heroPauseUntil — общая пауза после 429/rate_limited (15–30 с).
        const heroCache = new Map();
        const heroFail = new Map();
        const heroBusy = new Map();
        let heroPauseUntil = 0;
        let heroPauseWarned = false;
        // Открытая карточка героя (оверлей поверх .gl-modal).
        let heroCard = null;
        let heroCardTid = '';
        let onHeroClick = null;
        let onHeroKey = null;

        // ------------------------------------------------------------
        // Мелкие утилиты
        // ------------------------------------------------------------
        const esc = (s) => Utils.escapeHtml(s);
        const low = (s) => String(s == null ? '' : s).trim().toLowerCase();
        const num = (v) => {
            const n = Math.round(+v || 0);
            return Number.isFinite(n) ? n : 0;
        };
        const fmt = (v) => num(v).toLocaleString('ru-RU');
        const modalRoot = () => document.querySelector('.gl-modal');
        const allowedRole = () => !!(role && ROLE_OK[role]);

        // Нативная панель вкладок лежит прямым ребёнком .gl-body рядом с
        // .gl-tabs: вложенные .gl-pane подокон (.gl-subb) не трогаем.
        const nativePane = (root) => root.querySelector('.gl-body > .gl-pane:not(.' + PANE_CLS + ')');

        // ------------------------------------------------------------
        // id своей гильдии
        //
        // Синхронные источники (G.ME) -> индекс нативного модуля гильдий
        // (G.LGGuilds.index() -> mine.member.guild / role). index() —
        // сетевой запрос, поэтому отметку ставим ДО await и не повторяем
        // чаще GUILD_ID_TTL: иначе каждая мутация DOM дёргала бы API.
        // ------------------------------------------------------------
        const resolveGuildId = async () => {
            if (guildId) return guildId;

            const me = G.ME;
            let id = me && (me.guild != null ? me.guild
                : (me.guildId != null ? me.guildId : (me.user ? me.user.guild : null)));
            // Иногда API отдаёт объект гильдии вместо id.
            if (id && typeof id === 'object') id = (id.id != null ? id.id : id.gid);
            if (id != null && id !== '') {
                guildId = String(id);
                return guildId;
            }

            const LGG = G.LGGuilds;
            if (!LGG || typeof LGG.index !== 'function') return null;

            const now = Date.now();
            if (guildIdAt && (now - guildIdAt) < GUILD_ID_TTL) return null;
            guildIdAt = now;

            let res = null;
            try { res = await LGG.index(); } catch (e) { return null; }

            const member = res && res.mine && res.mine.member;
            const mid = member && (member.guild != null ? member.guild : member.gid);
            // Роль из индекса — первый (и самый дешёвый) источник прав.
            if (member && member.role) role = String(member.role);
            if (mid != null && mid !== '') {
                guildId = String(mid);
                guildIdAt = 0;
                return guildId;
            }
            return null;
        };

        // Роль берём из ответа сервера: me.role — членство именно в этой
        // гильдии. me === null означает «мы не состоим» -> доступа нет.
        const applyRole = (body) => {
            if (!body) return;
            if (body.me && body.me.role) role = String(body.me.role);
            else if (body.me === null) role = '';
        };

        // ------------------------------------------------------------
        // Данные гильдии (кэш в памяти, TTL 60 c)
        // ------------------------------------------------------------
        const ensureData = async () => {
            if (dataBusy) return dataBusy;
            if (destroyed) return null;

            dataBusy = (async () => {
                try {
                    const id = await resolveGuildId();
                    if (!id) return null;

                    const hit = cache.get(id);
                    if (hit && (Date.now() - hit.at) < GUILD_TTL) {
                        applyRole(hit.body);
                        return hit.body;
                    }

                    const failed = failAt.get(id) || 0;
                    if (failed && (Date.now() - failed) < GUILD_FAIL_TTL) return null;

                    // Свой запрос через Utils.fetchApi: он сам добавит
                    // /c/<канал>/ и не патчит window.fetch.
                    let res = null;
                    try {
                        res = await Utils.fetchApi('/api/guilds/guild?id=' + encodeURIComponent(id));
                    } catch (e) {
                        failAt.set(id, Date.now());
                        return null;
                    }

                    const body = (res && res.body && typeof res.body === 'object') ? res.body : res;
                    if (!body || body.ok === false) {
                        failAt.set(id, Date.now());
                        return null;
                    }

                    cache.set(id, { at: Date.now(), body });
                    failAt.delete(id);
                    applyRole(body);
                    return body;
                } finally {
                    dataBusy = null;
                }
            })();

            return dataBusy;
        };

        // Окно показывает именно свою гильдию? У чужой профиль рисуется
        // через .gl-see без .gl-tabs1, но дополнительно сверяем тег/имя
        // из #glTitle с данными нашего же ответа.
        const matchesOwnGuild = (root) => {
            const hit = guildId ? cache.get(guildId) : null;
            if (!hit || !hit.body || !hit.body.guild) return true;
            const title = root.querySelector('#glTitle');
            if (!title) return true;
            const text = low(title.textContent);
            if (!text) return true;
            const name = low(hit.body.guild.name);
            const tag = low(hit.body.guild.tag);
            if (name && text.indexOf(name) !== -1) return true;
            if (tag && text.indexOf(tag) !== -1) return true;
            return false;
        };

        // ------------------------------------------------------------
        // Агрегированная статистика по members[]
        // ------------------------------------------------------------
        const buildStats = (body, at) => {
            const now = Date.now();
            const members = [];
            for (const m of ((body && body.members) || [])) {
                if (!m || m.pending === true) continue;
                if (!(m.login || m.name)) continue;
                members.push(m);
            }

            const total = members.length;
            const limit = num((body && body.limit) || (body && body.guild && body.guild.limit)) || 50;

            let online = 0;
            let active24 = 0;
            let active7 = 0;
            let idle = 0;
            let powerSum = 0;
            let levelSum = 0;
            let levelN = 0;
            let maxLevel = 0;

            const classMap = new Map();
            const roleMap = new Map();
            const roster = [];
            const idleList = [];

            for (const m of members) {
                const hero = (m.hero && typeof m.hero === 'object') ? m.hero : null;
                const seenAt = num(m.seenAt);
                const isOnline = m.online === true;
                const power = num(hero && hero.power);
                const level = num(hero && hero.level);
                const clsKey = String((hero && hero.role) || '');
                const clsName = String((hero && hero.roleName) || ROLE_RU[clsKey] || clsKey || 'Неизвестно');
                const name = String(m.name || m.login || '').trim();

                // Активность: online — точный флаг сервера; окна 24 ч и 7 дней
                // считаем по seenAt (время последнего захода). Онлайн попадает
                // в оба окна даже если seenAt сервер не прислал.
                if (isOnline) online++;
                if (isOnline || (seenAt > 0 && (now - seenAt) <= DAY)) active24++;
                if (isOnline || (seenAt > 0 && (now - seenAt) <= WEEK)) active7++;

                powerSum += power;
                if (level > 0) {
                    levelSum += level;
                    levelN++;
                    if (level > maxLevel) maxLevel = level;
                }

                if (!isOnline && seenAt > 0 && (now - seenAt) > WEEK) {
                    idle++;
                    idleList.push({
                        name,
                        cls: clsName,
                        level,
                        days: Math.max(7, Math.floor((now - seenAt) / DAY)),
                        // v11.7: для инспектора героя нужен tid участника.
                        tid: (m.tid != null ? String(m.tid) : ''),
                        login: low(m.login || name)
                    });
                }

                const cls = classMap.get(clsKey) || { name: clsName, count: 0 };
                cls.count++;
                classMap.set(clsKey, cls);

                const r = String(m.role || '');
                if (r) roleMap.set(r, (roleMap.get(r) || 0) + 1);

                roster.push({
                    name,
                    cls: clsName,
                    level,
                    power,
                    // v11.7: инспектор героя шлёт GET /api/guilds/hero?tid=…
                    tid: (m.tid != null ? String(m.tid) : ''),
                    login: low(m.login || name)
                });
            }

            // Классы: по убыванию количества; bar — относительно самого
            // многочисленного класса (визуальная шкала 0..100%).
            const classes = Array.from(classMap.values())
                .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'ru'));
            const maxCls = classes.length ? classes[0].count : 0;
            for (const c of classes) {
                c.pct = total ? Math.round(c.count / total * 100) : 0;
                c.bar = maxCls ? Math.max(4, Math.round(c.count / maxCls * 100)) : 0;
            }

            // Иерархия: TIERS склеивает officer с lead, member с novice.
            const tiers = TIERS.map((t) => ({
                key: t.key,
                title: t.title,
                count: t.roles.reduce((n, r) => n + (roleMap.get(r) || 0), 0)
            }));
            const known = new Set(TIERS.reduce((acc, t) => acc.concat(t.roles), []));
            let other = 0;
            for (const [r, n] of roleMap) if (!known.has(r)) other += n;
            if (other) tiers.push({ key: 'other', title: 'Без ранга', count: other });

            // Топ-5 по силе; при равенстве — по уровню.
            const top = roster.slice()
                .sort((a, b) => (b.power - a.power) || (b.level - a.level) || a.name.localeCompare(b.name, 'ru'))
                .slice(0, 5);

            idleList.sort((a, b) => (b.days - a.days) || a.name.localeCompare(b.name, 'ru'));

            return {
                total,
                limit,
                online,
                active24,
                active7,
                idle,
                powerSum,
                // Средняя сила — по всему составу (без данных = 0), чтобы
                // метрика не завышалась за счёт «только тех, у кого есть герой».
                avgPower: total ? Math.round(powerSum / total) : 0,
                avgLevel: levelN ? (levelSum / levelN) : 0,
                maxLevel,
                classes,
                tiers,
                top,
                idleList,
                updatedAt: at || now
            };
        };

        // ------------------------------------------------------------
        // Разметка панели: карточки в палитре guilds2.css (--gw-*)
        // ------------------------------------------------------------
        const row = (label, value, cls) => '<div class="lgu-gl-row"><span>' + esc(label) + '</span>'
            + '<b' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(value) + '</b></div>';

        const whenText = (ms) => {
            try {
                return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            } catch (e) { return ''; }
        };

        const memberMeta = (m) => [m.cls, m.level ? m.level + ' ур.' : '']
            .filter(Boolean).join(' · ');

        // Иерархия: строка «Глава 1 · 4%» (доля от состава).
        const tierRow = (t, total) => {
            const pct = total ? Math.round(t.count / total * 100) : 0;
            return row(t.title, t.count + (total ? ' · ' + pct + '%' : ''));
        };

        // v11.7: атрибуты кликабельной строки участника. Строка без tid
        // (старый сервер/заявка) остаётся обычной — карточку не открыть.
        const heroRowAttrs = (m) => {
            if (!m || !m.tid) return '';
            return ' data-tid="' + esc(m.tid) + '" data-name="' + esc(m.name || '') + '"'
                + ' role="button" tabindex="0" title="Нажмите — снаряжение и характеристики"';
        };

        const renderHtml = (s) => {
            const parts = [];
            parts.push('<div class="lgu-gl-grid">');

            // 1. Состав и активность.
            parts.push('<section class="lgu-gl-card"><h4 class="lgu-gl-h4">Активность</h4><div class="lgu-gl-rows">'
                + row('Состав', s.total + ' / ' + s.limit)
                + row('Сейчас в сети', String(s.online), s.online ? 'on' : '')
                + row('Заходили за 24 ч', String(s.active24))
                + row('Заходили за 7 дней', String(s.active7))
                + row('Неактивны более 7 дней', String(s.idle), s.idle ? 'warn' : '')
                + '</div></section>');

            // 2. Сила и уровни.
            parts.push('<section class="lgu-gl-card"><h4 class="lgu-gl-h4">Сила и уровни</h4><div class="lgu-gl-rows">'
                + row('Суммарная сила', fmt(s.powerSum))
                + row('Средняя сила', fmt(s.avgPower))
                + row('Средний уровень', s.avgLevel ? s.avgLevel.toFixed(1) : '—')
                + row('Максимальный уровень', s.maxLevel ? String(s.maxLevel) : '—')
                + '</div></section>');

            // 3. Иерархия ролей.
            parts.push('<section class="lgu-gl-card"><h4 class="lgu-gl-h4">Иерархия</h4><div class="lgu-gl-rows">'
                + s.tiers.map((t) => tierRow(t, s.total)).join('')
                + '</div></section>');

            // 4. Распределение по классам: прогресс-бары из --gw-sel.
            const classList = s.classes.length
                ? '<ul class="lgu-gl-classes">' + s.classes.map((c) =>
                    '<li class="lgu-gl-cl">'
                    + '<div class="lgu-gl-cl-head"><b>' + esc(c.name) + '</b>'
                    + '<span>' + c.count + ' · ' + c.pct + '%</span></div>'
                    + '<div class="lgu-gl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + c.pct + '">'
                    + '<i style="width:' + c.bar + '%"></i></div></li>').join('') + '</ul>'
                : '<p class="lgu-gl-note">Нет данных о классах.</p>';
            parts.push('<section class="lgu-gl-card lgu-gl-card-wide"><h4 class="lgu-gl-h4">Классы'
                + '<span>всего ' + s.total + '</span></h4>' + classList + '</section>');

            // 5. Топ-5 по силе. v11.7: строка кликабельна — открывает карточку
            //    героя (GET /api/guilds/hero?tid=…&guild=…).
            const topList = s.top.length
                ? '<ol class="lgu-gl-top">' + s.top.map((m, i) =>
                    '<li class="lgu-gl-toprow' + (i === 0 ? ' first' : '') + (m.tid ? ' lgu-gl-hero-row' : '') + '"' + heroRowAttrs(m) + '>'
                    + '<span class="lgu-gl-rank">' + (i + 1) + '</span>'
                    + '<span class="lgu-gl-who"><b>' + esc(m.name) + '</b>'
                    + '<small>' + esc(memberMeta(m)) + '</small></span>'
                    + '<b class="lgu-gl-power">' + fmt(m.power) + '</b></li>').join('') + '</ol>'
                : '<p class="lgu-gl-note">Нет данных о бойцах.</p>';
            parts.push('<section class="lgu-gl-card lgu-gl-card-wide"><h4 class="lgu-gl-h4">Топ-5 по силе'
                + '<span>из ' + s.total + '</span></h4>' + topList + '</section>');

            // 6. Неактивные > 7 дней — только если такие есть.
            if (s.idleList.length) {
                const shown = s.idleList.slice(0, IDLE_LIMIT);
                const rest = s.idleList.length - shown.length;
                parts.push('<section class="lgu-gl-card lgu-gl-card-wide"><h4 class="lgu-gl-h4">'
                    + 'Неактивны более 7 дней<span>' + s.idle + '</span></h4>'
                    + '<ul class="lgu-gl-idle">' + shown.map((m) =>
                        '<li class="lgu-gl-idlerow' + (m.tid ? ' lgu-gl-hero-row' : '') + '"' + heroRowAttrs(m) + '><span class="lgu-gl-who"><b>' + esc(m.name) + '</b>'
                        + '<small>' + esc(memberMeta(m)) + '</small></span>'
                        + '<span class="lgu-gl-idledays">' + m.days + ' дн.</span></li>').join('') + '</ul>'
                    + (rest > 0 ? '<p class="lgu-gl-note">и ещё ' + rest + '…</p>' : '')
                    + '</section>');
            }

            parts.push('</div>');
            parts.push('<p class="lgu-gl-note lgu-gl-foot">Данные: /api/guilds/guild · обновлено в '
                + esc(whenText(s.updatedAt)) + '</p>');
            return parts.join('');
        };

        // Перерисовка панели. Ключ кэша (gid:at) хранится в dataset, поэтому
        // повторные проходы наблюдателя не пересобирают разметку и не мигают.
        const renderPane = (root, failed) => {
            const pane = root.querySelector('.' + PANE_CLS);
            if (!pane) return;

            const hit = guildId ? cache.get(guildId) : null;
            if (!hit) {
                const key = failed ? 'fail' : 'wait';
                if (pane.dataset.lguKey !== key) {
                    pane.dataset.lguKey = key;
                    pane.innerHTML = '<p class="lgu-gl-note">'
                        + (failed ? 'Не удалось получить статистику гильдии.' : 'Загружаем статистику гильдии…')
                        + '</p>';
                }
                return;
            }

            const key = String(guildId) + ':' + hit.at;
            if (pane.dataset.lguKey === key) return;
            pane.dataset.lguKey = key;
            pane.innerHTML = renderHtml(buildStats(hit.body, hit.at));
        };

        // ------------------------------------------------------------
        // v11.7: инспектор участника — карточка героя
        //
        // Клик по строке в «Топ-5 по силе» или в списке неактивных лениво
        // запрашивает GET /api/guilds/hero?tid=<tid>&guild=<gid>
        // (reference/LegionFrontSRC/site/guilds2.js: api.hero + heroWin) и
        // показывает компактный оверлей поверх окна сводки.
        //
        // Антиспам:
        //   - кэш в памяти Map, TTL 60 c, лимит HERO_CACHE_MAX;
        //   - провал по tid блокирует повтор на HERO_FAIL_TTL;
        //   - HTTP 429 / { error: 'rate_limited' } -> общая пауза 15–30 с;
        //   - одновременные клики по одному tid склеиваются (heroBusy).
        // localStorage не используется.
        // ------------------------------------------------------------
        const trimHeroCache = () => {
            while (heroCache.size > HERO_CACHE_MAX) {
                const first = heroCache.keys().next();
                if (first.done) break;
                heroCache.delete(first.value);
            }
        };

        const heroBackoff = () => {
            const ms = HERO_PAUSE_MIN + Math.round(Math.random() * (HERO_PAUSE_MAX - HERO_PAUSE_MIN));
            heroPauseUntil = Date.now() + ms;
            if (!heroPauseWarned) {
                heroPauseWarned = true;
                try {
                    if (typeof UI !== 'undefined' && UI.showToast) {
                        UI.showToast('Сводка: сервер просит не частить с запросами — подождите немного', true);
                    }
                } catch (e) {}
            }
        };

        /**
         * Герой участника: GET /api/guilds/hero?tid=…&guild=…
         *
         * @param {string} tid id участника (members[].tid)
         * @returns {Promise<object|null>} hero либо null (нет данных/пауза)
         */
        const fetchHero = (tid) => {
            const key = String(tid || '');
            if (!key) return Promise.resolve(null);

            const hit = heroCache.get(key);
            if (hit && (Date.now() - hit.at) < HERO_TTL) return Promise.resolve(hit.hero);

            const now = Date.now();
            if (heroPauseUntil && now < heroPauseUntil) return Promise.resolve(null);
            const failed = heroFail.get(key) || 0;
            if (failed && (now - failed) < HERO_FAIL_TTL) return Promise.resolve(null);

            const busy = heroBusy.get(key);
            if (busy) return busy;

            const p = (async () => {
                const gid = await resolveGuildId();
                if (!gid) return null;

                let res = null;
                try {
                    // Utils.fetchApi добавит /c/<канал>/ и не патчит window.fetch.
                    res = await Utils.fetchApi('/api/guilds/hero?tid=' + encodeURIComponent(key)
                        + '&guild=' + encodeURIComponent(gid));
                } catch (e) {
                    heroFail.set(key, Date.now());
                    return null;
                }

                const body = (res && res.body && typeof res.body === 'object') ? res.body : res;
                const status = num(res && res.status);
                const error = String((body && body.error) || (res && res.error) || '');

                if (status === 429 || error === 'rate_limited') {
                    heroFail.set(key, Date.now());
                    heroBackoff();
                    return null;
                }

                const hero = body && body.hero;
                if (!body || body.ok === false || !hero || typeof hero !== 'object') {
                    heroFail.set(key, Date.now());
                    return null;
                }

                heroFail.delete(key);
                heroCache.set(key, { at: Date.now(), hero });
                trimHeroCache();
                return hero;
            })().finally(() => {
                heroBusy.delete(key);
            });

            heroBusy.set(key, p);
            return p;
        };
        // Строка статов предмета: до трёх ключевых прибавок (hp/atk/mag/def и
        // вторичные crit/critDmg/... — те же ключи, что в game-data.js xstats).
        const heroItemStats = (it) => {
            const out = [];
            const stats = (it && it.stats) || {};
            for (const [k, v] of Object.entries(stats)) {
                if (!num(v)) continue;
                const label = (GAME_DATA.XSTAT_KEYS && GAME_DATA.XSTAT_KEYS.has(k))
                    ? ({ crit: 'крит', critDmg: 'сила крита', dodge: 'уклонение',
                        pierce: 'пробивание', healPow: 'лечение', luck: 'удача',
                        resist: 'сопротивление' }[k] || k)
                    : ({ hp: 'здоровье', atk: 'атака', mag: 'магия', def: 'броня' }[k] || k);
                out.push('+' + fmt(v) + ' ' + label);
                if (out.length >= 3) break;
            }
            return out.join(' · ');
        };

        const heroAbility = (cap, a) => {
            if (!a) return `<span><i>${cap}</i> нет</span>`;
            // lock — уровень героя, с которого способность открывается.
            const lock = num(a.lock);
            const name = a.name || '—';
            const note = lock ? ` <em>(с ${lock} ур.)</em>` : '';
            return `<span${lock ? ' class="off"' : ''}><i>${esc(a.icon || '✦')}</i>${esc(cap)}: <b>${esc(name)}</b>${note}</span>`;
        };

        /**
         * Разметка карточки героя. Данные — hero из /api/guilds/hero:
         *   { power, st { hp, atk, mag, def, crit, ... }, level, role, roleName,
         *     items[] { slot, name, rarity, en, stats }, ab { ab, ult } }
         */
        const heroCardHtml = (hero, name, loading, failed) => {
            const head = `<div class="lgu-gl-hero-head"><div><b>${esc(name || 'Участник')}</b>`
                + `<span>${loading ? 'Загружаем героя…' : (failed ? 'Данные недоступны' : '')}</span>`
                + '</div><button type="button" class="lgu-gl-hero-x" data-hx="1" aria-label="Закрыть">✖</button></div>';

            if (loading || failed || !hero) {
                const note = failed
                    ? 'Не удалось получить снаряжение героя. Попробуйте позже.'
                    : 'Загружаем карточку участника…';
                return `<div class="lgu-gl-hero-box" role="dialog" aria-label="Герой участника">${head}`
                    + `<p class="lgu-gl-note">${esc(note)}</p></div>`;
            }

            const role = low(hero.role || hero.class || '');
            const clsName = String(hero.roleName || ROLE_RU[role] || role || 'Неизвестно');
            const lvl = num(hero.level);
            const power = num(hero.power);
            const meta = [clsName, lvl ? lvl + ' ур.' : '', power ? 'сила ' + fmt(power) : '']
                .filter(Boolean).join(' · ');

            // Характеристики: hp/atk/mag/def и вторичные (crit, critDmg,
            // dodge, pierce, healPow, luck, resist) — только те, что пришли.
            const st = (hero.st && typeof hero.st === 'object') ? hero.st : {};
            const stats = HERO_STATS
                .filter(([k]) => hasOwn(st, k) && Number.isFinite(Number(st[k])))
                .map(([k, ru]) => `<span><small>${esc(ru)}</small><b>${fmt(st[k])}</b></span>`)
                .join('');

            const by = {};
            for (const it of (Array.isArray(hero.items) ? hero.items : [])) {
                if (it && !by[it.slot]) by[it.slot] = it;
            }
            const items = HERO_SLOTS.map(([slot, ru]) => {
                const it = by[slot];
                if (!it) return `<li class="empty"><span class="lgu-gl-hero-slot">${ru}</span><small>пусто</small></li>`;
                const en = num(it.en);
                const rar = HERO_RARITY[it.rarity] || '';
                const statsText = heroItemStats(it);
                return `<li data-r="${esc(it.rarity || 'common')}">`
                    + `<span class="lgu-gl-hero-slot">${ru}</span>`
                    + `<span class="lgu-gl-hero-name">${esc(it.name || '—')}${en > 0 ? ` <b>+${en}</b>` : ''}</span>`
                    + `<small>${esc(rar)}${statsText ? ' · ' + esc(statsText) : ''}</small></li>`;
            }).join('');

            const ab = (hero.ab && typeof hero.ab === 'object') ? hero.ab : {};
            return `<div class="lgu-gl-hero-box" role="dialog" aria-label="Герой участника">${head}`
                + `<div class="lgu-gl-hero-meta">${esc(meta)}</div>`
                + (stats ? `<div class="lgu-gl-hero-stats">${stats}</div>` : '')
                + `<ul class="lgu-gl-hero-items">${items}</ul>`
                + `<div class="lgu-gl-hero-abs">${heroAbility('способность', ab.ab)}${heroAbility('ульта', ab.ult)}</div>`
                + '</div>';
        };

        const closeHeroCard = () => {
            if (heroCard && heroCard.parentNode) heroCard.parentNode.removeChild(heroCard);
            heroCard = null;
            heroCardTid = '';
        };

        // Оверлей живёт в .gl-modal (игра перерисовывает только .gl-body),
        // поэтому закрытие окна гильдии убирает карточку вместе с корнем.
        const renderHeroCard = (root, html) => {
            if (!heroCard || !heroCard.isConnected) {
                heroCard = document.createElement('div');
                heroCard.className = 'lgu-gl-hero';
                heroCard.addEventListener('click', (ev) => {
                    const t = ev.target;
                    if (t === heroCard || (t && t.closest && t.closest('[data-hx]'))) {
                        ev.preventDefault();
                        closeHeroCard();
                    }
                });
                root.appendChild(heroCard);
            }
            heroCard.innerHTML = html;
        };

        /**
         * Открыть карточку героя по строке участника.
         * Сначала показываем «загружаем», затем подменяем данными (или
         * сообщением об ошибке). Повторный клик по тому же tid карточку не
         * перерисовывает — она уже открыта.
         */
        const openHeroCard = async (root, tid, name) => {
            if (destroyed || !root || !tid) return;
            if (heroCardTid === tid && heroCard && heroCard.isConnected) return;

            heroCardTid = tid;
            const hit = heroCache.get(tid);
            const fresh = !!(hit && (Date.now() - hit.at) < HERO_TTL);
            renderHeroCard(root, heroCardHtml(fresh ? hit.hero : null, name, !fresh, false));
            if (fresh) return;

            const hero = await fetchHero(tid);
            if (destroyed || heroCardTid !== tid) return;
            const live = modalRoot();
            if (!live || !heroCard || !heroCard.isConnected) return;
            renderHeroCard(live, heroCardHtml(hero, name, false, !hero));
        };

        // Клик по строке «Топ-5»/неактивных. Слушаем на document в capture-фазе:
        // .gl-body игра перерисовывает целиком, делегирование это переживает.
        const onHeroRowClick = (e) => {
            if (destroyed || !e.target || !e.target.closest) return;
            const row = e.target.closest('.lgu-gl-hero-row[data-tid]');
            if (!row) return;
            if (!row.closest('.' + PANE_CLS)) return;
            if (e.target.closest('button, a, input, select, textarea')) return;
            const root = modalRoot();
            if (!root) return;
            e.preventDefault();
            e.stopPropagation();
            openHeroCard(root, row.dataset.tid, row.dataset.name || '').catch(() => {});
        };

        // Enter/Space на сфокусированной строке и Escape на открытой карточке.
        const onHeroRowKey = (e) => {
            if (destroyed) return;
            if (e.key === 'Escape') {
                if (heroCard) {
                    e.preventDefault();
                    // main.js на Escape закрывает модалки аддона — карточку
                    // героя закрываем сами и не отдаём событие дальше.
                    e.stopPropagation();
                    closeHeroCard();
                }
                return;
            }
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
            const row = (e.target && e.target.closest) ? e.target.closest('.lgu-gl-hero-row[data-tid]') : null;
            if (!row) return;
            const root = modalRoot();
            if (!root) return;
            e.preventDefault();
            openHeroCard(root, row.dataset.tid, row.dataset.name || '').catch(() => {});
        };

        // ------------------------------------------------------------
        // Вкладки и панель в .gl-modal
        // ------------------------------------------------------------
        const showPane = (root) => {
            root.querySelectorAll('.gl-tabs1 [data-tab]').forEach((t) => {
                t.setAttribute('aria-selected', String(t.dataset.tab === TAB_KEY));
            });
            root.querySelectorAll('.gl-body > .gl-pane').forEach((p) => {
                if (p.classList.contains(PANE_CLS)) p.classList.remove(HIDE_CLS);
                else p.classList.add(HIDE_CLS);
            });
        };

        const hidePane = (root) => {
            // v11.7: карточка героя относится к нашей вкладке — при уходе на
            // нативную вкладку её закрываем.
            closeHeroCard();
            const btn = root.querySelector('.gl-tabs1 [data-tab="' + TAB_KEY + '"]');
            if (btn) btn.setAttribute('aria-selected', 'false');
            root.querySelectorAll('.gl-body > .gl-pane').forEach((p) => {
                if (p.classList.contains(PANE_CLS)) p.classList.add(HIDE_CLS);
                else p.classList.remove(HIDE_CLS);
            });
        };

        // Убираем свои вставки (роль понизили / окно показывает чужую
        // гильдию) и возвращаем нативную панель на место.
        const removeInjected = (root) => {
            closeHeroCard();
            root.querySelectorAll('.gl-tabs1 [data-tab="' + TAB_KEY + '"]').forEach((el) => el.remove());
            root.querySelectorAll('.' + PANE_CLS).forEach((el) => el.remove());
            const native = nativePane(root);
            if (native) native.classList.remove(HIDE_CLS);
        };

        const inject = (root) => {
            if (destroyed || !root) return;
            const tabs = root.querySelector('.gl-tabs.gl-tabs1');
            // У чужой гильдии .gl-tabs1 нет (профиль рисуется через .gl-see).
            if (!tabs) { removeInjected(root); return; }
            if (!allowedRole() || !matchesOwnGuild(root)) { removeInjected(root); return; }

            let btn = tabs.querySelector('[data-tab="' + TAB_KEY + '"]');
            if (!btn) {
                // 4-я вкладка: перед «Управлением» (у него margin-left:auto,
                // поэтому оно остаётся прижатым вправо).
                const setTab = tabs.querySelector('[data-tab="set"]');
                if (setTab) setTab.insertAdjacentHTML('beforebegin', TAB_HTML);
                else tabs.insertAdjacentHTML('beforeend', TAB_HTML);
                btn = tabs.querySelector('[data-tab="' + TAB_KEY + '"]');
            }
            if (!btn) return;

            let pane = root.querySelector('.' + PANE_CLS);
            if (!pane) {
                pane = document.createElement('div');
                pane.className = 'gl-pane ' + PANE_CLS;
                pane.dataset.tab = TAB_KEY;
                const native = nativePane(root);
                if (native) native.insertAdjacentElement('afterend', pane);
                else tabs.insertAdjacentElement('afterend', pane);
            }

            if (wantStats) {
                showPane(root);
                renderPane(root, false);
            } else {
                hidePane(root);
            }
        };

        // ------------------------------------------------------------
        // События и жизненный цикл
        // ------------------------------------------------------------

        // Клик по вкладкам. Слушаем в capture-фазе на document: обработчик
        // игры висит на .gl-body (bubble) и на каждую нативную вкладку
        // перерисовывает .gl-body целиком — наш вызов должен успеть сбросить
        // флаг до этой перерисовки, иначе вставки «воскресали» бы заново.
        const onTabClick = (e) => {
            const target = e.target;
            if (!target || !target.closest) return;
            const tab = target.closest('[data-tab]');
            if (!tab) return;
            if (!tab.closest('.gl-tabs1')) return;
            const root = tab.closest('.gl-modal');
            if (!root) return;

            if (tab.dataset.tab === TAB_KEY) {
                e.preventDefault();
                e.stopPropagation();
                wantStats = true;
                inject(root);
                run(true).catch(() => {});
                return;
            }

            // Нативная вкладка: возвращаем её панель и снимаем выделение
            // с нашей кнопки (игра перерисует .gl-body следом).
            wantStats = false;
            hidePane(root);
        };

        const run = async (force) => {
            if (destroyed) return;
            const now = Date.now();
            if (!force && (now - lastRun) < RUN_THROTTLE) {
                // Проход не выбрасываем: окно гильдии ставится одним innerHTML,
                // и без повтора наши вставки не появятся до следующей мутации.
                runLater();
                return;
            }
            lastRun = now;

            running = true;
            try {
                const root = modalRoot();
                if (!root) { wantStats = false; return; }
                if (!root.querySelector('.gl-tabs.gl-tabs1')) { wantStats = false; return; }

                inject(root);
                // Роль и состав берём из /api/guilds/guild: до ответа вкладку
                // не показываем, чтобы novice/member её не увидели даже мигом.
                await ensureData();
                if (destroyed) return;

                const win = modalRoot();
                if (!win) return;
                inject(win);
                if (wantStats) {
                    const hit = guildId ? cache.get(guildId) : null;
                    renderPane(win, !hit);
                }
            } finally {
                running = false;
            }
        };

        // Отложенный повтор после окна троттлинга (один таймер на модуль).
        const runLater = () => {
            if (destroyed || deferredTimer) return;
            deferredTimer = setTimeout(() => {
                deferredTimer = null;
                run(true).catch(() => {});
            }, RUN_THROTTLE);
        };

        // Склейка мутаций в один кадр (requestAnimationFrame), с сохранением
        // флага force между вызовами.
        const schedule = (force) => {
            if (force) pendingForce = true;
            if (destroyed || scheduled) return;
            scheduled = true;
            const tick = () => {
                scheduled = false;
                const forced = pendingForce;
                pendingForce = false;
                run(forced).catch(() => {});
            };
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
            else setTimeout(tick, 80);
        };

        const init = () => {
            destroyed = false;

            if (!onDocClick) {
                onDocClick = onTabClick;
                document.addEventListener('click', onDocClick, true);
            }

            // v11.7: инспектор участника — клик/Enter по строке «Топ-5» и
            // неактивных, Escape закрывает карточку героя.
            if (!onHeroClick) {
                onHeroClick = onHeroRowClick;
                document.addEventListener('click', onHeroClick, true);
            }
            if (!onHeroKey) {
                onHeroKey = onHeroRowKey;
                document.addEventListener('keydown', onHeroKey, true);
            }

            if (observer || typeof MutationObserver === 'undefined') {
                schedule(true);
                return;
            }

            observer = new MutationObserver(() => {
                // Проход уже идёт/запланирован — не сканируем документ на
                // каждой пачке мутаций (в городе и чате их сотни в секунду).
                if (destroyed || running || scheduled) return;
                if (!document.querySelector('.gl-modal')) return;
                schedule(false);
            });
            observer.observe(document.body, { childList: true, subtree: true });

            // Аддон мог загрузиться уже с открытым окном гильдии.
            schedule(true);
        };

        const destroy = () => {
            destroyed = true;

            if (observer) {
                try { observer.disconnect(); } catch (e) {}
            }
            observer = null;

            if (onDocClick) {
                try { document.removeEventListener('click', onDocClick, true); } catch (e) {}
                onDocClick = null;
            }

            // v11.7: снимаем обработчики инспектора героя и убираем карточку.
            if (onHeroClick) {
                try { document.removeEventListener('click', onHeroClick, true); } catch (e) {}
                onHeroClick = null;
            }
            if (onHeroKey) {
                try { document.removeEventListener('keydown', onHeroKey, true); } catch (e) {}
                onHeroKey = null;
            }
            closeHeroCard();

            if (deferredTimer) {
                clearTimeout(deferredTimer);
                deferredTimer = null;
            }

            scheduled = false;
            pendingForce = false;
            running = false;
            lastRun = 0;
            wantStats = false;
            dataBusy = null;

            // Кэши живут только в памяти (localStorage не используем).
            cache.clear();
            failAt.clear();
            heroCache.clear();
            heroFail.clear();
            heroBusy.clear();
            heroPauseUntil = 0;
            heroPauseWarned = false;
            guildId = null;
            guildIdAt = 0;
            role = '';

            // Чистим свои вставки из живого DOM: нативные вкладки и панель
            // должны остаться такими, как их нарисовала игра.
            document.querySelectorAll('.gl-tabs1 [data-tab="' + TAB_KEY + '"]').forEach((el) => el.remove());
            document.querySelectorAll('.' + PANE_CLS).forEach((el) => el.remove());
            document.querySelectorAll('.gl-body > .gl-pane.' + HIDE_CLS).forEach((el) => el.classList.remove(HIDE_CLS));
        };

        return { init, destroy };
    })();

    // Для отладки из консоли страницы: window аддона — песочница, поэтому
    // публикуем в page-context через G (unsafeWindow), как main.js и Arena.
    try {
        const summaryWin = (typeof G !== 'undefined' && G) ? G : window;
        summaryWin.LegionGuildSummary = GuildSummary;
    } catch (e) {}
