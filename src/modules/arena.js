    // ============================================================
    // 6.9. МОДУЛЬ: АРЕНА 5×5 (modules/arena.js)
    //
    // Три функции поверх НОВОЙ арены клиента (reference/LegionFrontSRC/site/
    // arena2.js.txt + arena2.css): лобби с карточками .av-panel.av-off, окно
    // подготовки к бою .av-win.av-fwin и модалка приглашения .av-win.av-invwin.
    //   1) плашка шанса победы в карточке соперника и в окне боя;
    //   2) предупреждение «Согильдейцы в отряде противника» — компактный бейдж
    //      в шапке карточки (.av-oh) и подсветка фигурок (.av-mh.av-pN на
    //      мини-сцене .av-scene, .av-hero.av-foe в окне боя);
    //   3) четвёртая вкладка «Согильдейцы» в модалке «Пригласить в отряд»
    //      (.av-itabs / .av-ibody) с приглашением в один клик.
    //
    // Античит/CSP:
    //   - window.fetch, LGMine.open и LGMine.onEvent НЕ патчим;
    //   - контекст арены и её api() приходят из core/hooks.js (хук
    //     LGArena.open), оттуда же — onApiResponse(path, res, body);
    //   - никаких localStorage: кэш героев и состав гильдии живут в Map
    //     с TTL, при destroy() они очищаются.
    //
    // Данные (arena2.js):
    //   GET  /api/arena             -> { duel, mine, ... }
    //        duel.me.squad.members[] — свой клин: login, name, role, level, lead
    //        duel.offers[]          — соперники: login, title, rating, power,
    //                                 win, lose, def[] (клин обороны), test
    //   GET  /api/guilds/guild?id=  -> { guild, members[] } — состав гильдии;
    //        members[]: login, name, role (гильдейская), online, seenAt,
    //                   hero { level, role, roleName, power }
    //   GET  /api/arena/hero?login= -> { hero } — arena { hp, atk, mag, def },
    //                                  items[] (en, gear, slot), sk.t (навыки)
    //   POST /api/arena/act         -> { ok, error? }; приглашение — { op: 'inv', who }
    //
    // Подключается после core/ui.js (SHARED_MODULES в build.js) и не зависит
    // от других модулей: состав гильдии запрашивает сам.
    // main.js вызывает init() в boot(), destroy() — в shutdown().
    // ============================================================
    const Arena = (() => {
        // TTL кэшей. Герой меняется редко, состав гильдии — раз в минуту,
        // снимок арены перезапрашиваем не чаще 20 с (сам экран арены тоже
        // обновляет его кнопкой «Другие соперники»).
        const HERO_TTL = 600000;
        const GUILD_TTL = 60000;
        const STATE_TTL = 20000;
        const STATE_FAIL_TTL = 15000;
        // Тот же порог, что у Utils.updateOnlinePlayers: 5 минут без событий
        // города/шахты — игрок считается вышедшим. Это резервный источник
        // онлайна, если сервер гильдии не отдал members[].online.
        const ONLINE_TTL = 300000;
        // LGGuilds.index() — сетевой запрос: без гильдии не дёргаем чаще 30 с.
        const GUILD_ID_TTL = 30000;
        // Склейка мутаций: не чаще четырёх проходов в секунду.
        const RUN_THROTTLE = 250;

        // Русские имена классов (ROLE в arena2.js). Сервер гильдии отдаёт
        // hero.roleName готовым; словарь — фолбэк для старых ответов.
        const ROLE_RU = {
            legionary: 'Легионер', paladin: 'Паладин', rogue: 'Разбойник',
            recruit: 'Новобранец', archer: 'Лучник', mage: 'Маг',
            necromancer: 'Некромант', priest: 'Жрец'
        };
        // «Танки» и лекари для бонуса синергии клина.
        const TANKS = { paladin: true, legionary: true };
        const HEALERS = { priest: true };

        const esc = (s) => Utils.escapeHtml(s == null ? '' : String(s));
        const low = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
        const num = (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        };
        // 1234567 -> «1 234 567» (как big() в нативной арене).
        const fmt = (v) => String(Math.round(num(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

        // Последний снимок арены. mine — журнал командных боёв из ответа
        // (в arena2.js это d.mine), поэтому отряд берём из duel.me.squad.
        const state = {
            duel: null,
            mine: null,
            me: null,
            at: 0,
            failAt: 0
        };

        // Кэш карточек героев: ключ — логин и имя героя в нижнем регистре,
        // значение { hero, at }. Наполняется из ответов игры на
        // /api/arena/hero (когда игрок сам открывает карточку бойца):
        // своих запросов на каждого бойца НЕ делаем — это лишний трафик
        // и риск 429.
        const heroCache = new Map();

        // Состав нашей гильдии: два ключа на участника (login и имя),
        // значение — запись applyGuildData (см. блок «Состав гильдии»).
        let guildMap = new Map();
        // Уникальные записи (для вкладки): тот же состав без дублей по ключам.
        let guildRecords = [];
        // id текущей гильдии и время последнего обращения к LGGuilds.index().
        let guildId = null;
        let guildIdAt = 0;
        let guildBusy = null;
        // Гильдия вообще есть? Отдельный флаг: пустой ответ ≠ «не в гильдии».
        let inGuild = false;
        // Логин соперника из последнего клика «⚔ Атака» ([data-atk] в
        // arena2.js): по нему окно боя находит свой offer в duel.offers[].
        let lastAtkTarget = '';
        // Делегированный слушатель кликов (снимается в destroy()).
        let onDocClick = null;

        let observer = null;
        let scheduled = false;
        let injecting = false;
        let lastRun = 0;
        let stateBusy = false;
        // Проход уже идёт (внутри есть await) — второй не запускаем.
        let running = false;
        // Отложенный повтор после окна троттлинга (см. run/runLater).
        let deferredTimer = null;
        let destroyed = false;

        // ------------------------------------------------------------
        // Базовые выборки из состояния
        // ------------------------------------------------------------
        const arenaRoot = () => document.querySelector('.arb');

        // Свой логин: G.ME.user.login — источник и для чата, и для /api/me.
        const myLogin = () => {
            const me = G.ME;
            const direct = me && me.user && me.user.login;
            if (direct) return low(direct);
            const duelMe = state.duel && state.duel.me;
            return low(duelMe && duelMe.login);
        };

        // Отряд игрока. duel.me.squad.members — клин (5 героев),
        // duel.me.members — фолбэк старых сборок API.
        const mySquad = () => {
            const m = state.duel && state.duel.me;
            if (!m) return [];
            if (m.squad && Array.isArray(m.squad.members)) return m.squad.members;
            if (Array.isArray(m.members)) return m.members;
            return [];
        };

        // Бойцы оффера: def[] — клин обороны (карточка), squad[] — подробный
        // список для экрана атаки (site/arena.js, renderForm).
        const foeSquad = (offer) => {
            if (!offer) return [];
            if (Array.isArray(offer.def) && offer.def.length) return offer.def;
            if (Array.isArray(offer.squad) && offer.squad.length) return offer.squad;
            return [];
        };

        // Ключи бойца для поиска в кэшах: логин и имя в нижнем регистре.
        const heroKeys = (h) => {
            if (!h) return [];
            const out = [];
            const a = low(h.login);
            const b = low(h.name);
            if (a) out.push(a);
            if (b && b !== a) out.push(b);
            return out;
        };

        // ------------------------------------------------------------
        // Кэш героев (/api/arena/hero)
        // ------------------------------------------------------------
        const cacheHero = (login, hero) => {
            if (!hero || typeof hero !== 'object') return;
            const at = Date.now();
            const record = { hero, at };
            const keys = [low(login), low(hero.name)].filter(Boolean);
            for (const key of keys) heroCache.set(key, record);
        };

        const getHero = (fighter) => {
            const now = Date.now();
            for (const key of heroKeys(fighter)) {
                const hit = heroCache.get(key);
                if (!hit) continue;
                if ((now - hit.at) > HERO_TTL) {
                    heroCache.delete(key);
                    continue;
                }
                return hit.hero;
            }
            return null;
        };

        // ------------------------------------------------------------
        // Состав гильдии
        //
        // Модуль автономен: раньше состав гильдии брался из кэшей окна
        // гильдий, теперь его нет — запрашиваем состав сами:
        // GET /api/guilds/guild?id=<id> (docs/API.md), не чаще раза в минуту.
        // Кэш — Map с TTL: ключ — id гильдии, значение { at, map, records };
        // map — поиск по логину/имени, records — список без дублей для вкладки.
        // ------------------------------------------------------------
        const guildCache = new Map();

        // Разбор members[] нового ответа сервера: уровень/класс/сила лежат в
        // hero { level, role, roleName, power }, онлайн — готовым флагом.
        // Если сервер online не отдал (undefined), смотрим трекер аддона
        // window.__lgOnlinePlayers с TTL 5 минут.
        const applyGuildData = (body, id) => {
            const map = new Map();
            const seen = new Map();
            let any = false;

            for (const m of ((body && body.members) || [])) {
                if (!m || !(m.login || m.name)) continue;
                any = true;

                const login = low(m.login);
                const name = String(m.name || m.login || '').trim();
                const hero = (m.hero && typeof m.hero === 'object') ? m.hero : null;
                const online = (m.online === undefined)
                    ? !!onlineInfo({ login, name })
                    : !!m.online;

                const rec = {
                    login,
                    name: name || login,
                    // role в members[] — гильдейская роль (leader/officer/...),
                    // класс героя лежит отдельно в hero.role.
                    guildRole: String(m.role || ''),
                    online,
                    seenAt: num(m.seenAt),
                    level: num(hero && hero.level) || num(m.level),
                    role: String((hero && hero.role) || ''),
                    roleName: String((hero && hero.roleName) || ''),
                    power: num(hero && hero.power),
                    pending: !!m.pending
                };

                for (const key of [login, low(rec.name)]) {
                    if (key) map.set(key, rec);
                }
                const uniq = login || low(rec.name);
                if (uniq && !seen.has(uniq)) seen.set(uniq, rec);
            }

            if (!any) return false;
            const records = Array.from(seen.values());
            const key = String(id || guildId || '');
            if (key) guildCache.set(key, { at: Date.now(), map, records });
            guildMap = map;
            guildRecords = records;
            inGuild = true;
            return true;
        };

        // id своей гильдии. Синхронные источники -> индекс игры
        // (G.LGGuilds.index() -> mine.member.guild). Индекс — сетевой запрос,
        // поэтому отметку ставим ДО await и не повторяем чаще GUILD_ID_TTL:
        // иначе каждая мутация DOM на арене без гильдии дёргала бы API.
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
            if (mid != null && mid !== '') {
                guildId = String(mid);
                guildIdAt = 0;
                return guildId;
            }
            // Ответ есть, а гильдии нет: запоминаем, чтобы пустой ответ не
            // выглядел ошибкой сети.
            if (res && res.ok !== false) inGuild = false;
            return null;
        };

        const ensureGuild = async () => {
            if (guildBusy) return guildBusy;
            if (destroyed) return Promise.resolve();

            guildBusy = (async () => {
                try {
                    const id = await resolveGuildId();
                    if (!id) {
                        guildMap = new Map();
                        guildRecords = [];
                        return;
                    }
                    inGuild = true;

                    const cached = guildCache.get(id);
                    if (cached && (Date.now() - cached.at) < GUILD_TTL) {
                        guildMap = cached.map;
                        guildRecords = cached.records;
                        return;
                    }

                    // Свой запрос. Utils.fetchApi добавит /c/<канал>/.
                    let res = null;
                    try {
                        res = await Utils.fetchApi('/api/guilds/guild?id=' + encodeURIComponent(id));
                    } catch (e) {
                        return;
                    }
                    const body = (res && res.body && typeof res.body === 'object') ? res.body : res;
                    if (!body || body.ok === false) return;
                    // Пустой состав тоже кэшируем — иначе на каждую мутацию DOM
                    // улетал бы новый запрос к /api/guilds/guild.
                    if (!applyGuildData(body, id)) {
                        guildCache.set(id, { at: Date.now(), map: new Map(), records: [] });
                    }
                } catch (e) {
                    // Состав гильдии — необязательные данные: без него арена
                    // работает, бейджи просто не появятся.
                } finally {
                    guildBusy = null;
                }
            })();

            return guildBusy;
        };

        // Согильдеец? nick — ключ из DOM (title ника в .av-nm), fighter —
        // объект бойца из offer.def[] / duel.me.squad.members[].
        const isGuildmateKey = (nick) => {
            const key = low(nick);
            if (!key || !guildMap.size) return false;
            if (key === myLogin()) return false;
            return guildMap.has(key);
        };

        const isGuildmate = (fighter) => {
            if (!fighter || !guildMap.size) return false;
            for (const key of heroKeys(fighter)) {
                if (isGuildmateKey(key)) return true;
            }
            return false;
        };

        // Онлайн по трекеру аддона (window.__lgOnlinePlayers).
        // Формат записи: { loc, ts, firstSeen, src }, см. Utils.updateOnlinePlayers.
        const onlineInfo = (rec) => {
            const src = window.__lgOnlinePlayers || G.__lgOnlinePlayers;
            if (!src || typeof src.get !== 'function') return null;
            const now = Date.now();
            for (const key of [low(rec && rec.login), low(rec && rec.name)]) {
                if (!key) continue;
                const hit = src.get(key);
                const ts = num(hit && hit.ts);
                if (ts && (now - ts) < ONLINE_TTL) return hit;
            }
            return null;
        };

        // Уровень, класс и сила согильдейца. Новый ответ /api/guilds/guild
        // отдаёт их готовыми (hero.level, hero.role, hero.roleName,
        // hero.power), поэтому отдельных кэшей ростера не нужно.
        // Если полей нет (старый сервер), уточняем по кэшу /api/arena/hero.
        const heroInfo = (rec) => {
            let level = num(rec && rec.level);
            let role = low(rec && rec.role);
            let roleName = String((rec && rec.roleName) || '');

            if (!level || !role) {
                const hit = getHero(rec);
                if (hit) {
                    level = level || num(hit.level);
                    role = role || low(hit.role || hit.class);
                }
            }

            return {
                level,
                role,
                roleName: roleName || ROLE_RU[role] || role || '',
                power: num(rec && rec.power)
            };
        };

        // ------------------------------------------------------------
        // Оценка шанса победы
        // ------------------------------------------------------------

        // Мощь отряда. Приоритет: явное поле power (сервер отдаёт его
        // соперникам — o.power), затем собственный расчёт по уровням.
        //
        // Калибровка: серверная сила ≈ 53 единицы за каждый уровень бойца
        // (отряд суммарного 49-го уровня — это ~2650). У duel.me поля power
        // нет вообще, поэтому база своего отряда считается как
        // level * BASE_POWER_PER_LVL, а если по бойцу уже открывали карточку
        // (/api/arena/hero) или это наш собственный герой — его вклад
        // уточняется коэффициентом от статов/заточки. Коэффициент зажат в
        // FACTOR_MIN..FACTOR_MAX: прокси не должен уезжать из шкалы сервера.
        const BASE_POWER_PER_LVL = 53;
        const FACTOR_MIN = 0.85;
        const FACTOR_MAX = 1.25;

        const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

        // Заточка/таланты героя без арена-статов (у G.ME.hero блока arena
        // из /api/arena/hero может не быть).
        const gearStats = (hero) => {
            const items = Array.isArray(hero && hero.items) ? hero.items : [];
            let enSum = 0;
            let enCount = 0;
            for (const it of items) {
                if (!it) continue;
                enSum += num(it.en);
                enCount += 1;
            }
            const sk = hero && hero.sk && hero.sk.t;
            let pts = 0;
            let hasSk = false;
            if (sk && typeof sk === 'object') {
                hasSk = true;
                for (const key in sk) pts += num(sk[key]);
            }
            return {
                enAvg: enCount ? (enSum / enCount) : 0,
                pts: Math.min(60, pts),
                // Нет ни предметов, ни навыков — корректировать нечем,
                // коэффициент должен остаться нейтральным (1.0).
                has: enCount > 0 || hasSk
            };
        };

        // Герой бойца: сначала кэш /api/arena/hero, затем свой герой.
        // В duel.me.squad логина может не быть, поэтому сверяем и имена.
        const fighterHero = (fighter) => {
            const cached = getHero(fighter);
            if (cached) return cached;
            const me = G.ME;
            const own = me && me.hero;
            if (!own) return null;
            const keys = heroKeys(fighter);
            if (!keys.length) return null;
            // У G.ME.hero имя может лежать в n (players.js), а не в name.
            const ownKeys = [low(own.login), low(own.name), low(own.n)].filter(Boolean);
            for (const key of ownKeys) {
                if (keys.indexOf(key) !== -1) return own;
            }
            return null;
        };

        // Коэффициент вклада одного бойца (0.85..1.25).
        //   - есть arena-статы: отношение прокси-счёта героя к базовой силе
        //     его уровня — heroScore / (level * 53). Так поправка остаётся
        //     в той же шкале, что и серверный o.power;
        //   - только снаряжение: нейтральная точка +5 заточки и 20 очков
        //     талантов, каждый уровень заточки ~+1%, каждый ранг ~+0.2%.
        const powerFactor = (fighter, hero) => {
            if (!hero) return 1;
            const level = num(fighter && fighter.level) || num(hero.level);
            const score = heroScore(hero);
            if (score > 0 && level > 0) {
                return clamp(score / (level * BASE_POWER_PER_LVL), FACTOR_MIN, FACTOR_MAX);
            }
            const gear = gearStats(hero);
            if (!gear.has) return 1;
            const factor = 1 + 0.01 * (gear.enAvg - 5) + 0.002 * (gear.pts - 20);
            return clamp(factor, FACTOR_MIN, FACTOR_MAX);
        };

        const powerValue = (profile, squad) => {
            const direct = num(profile && profile.power);
            if (direct > 0) return direct;

            const list = Array.isArray(squad) ? squad : [];
            let total = 0;
            let levels = 0;
            for (const h of list) {
                const level = num(h && h.level);
                if (level <= 0) continue;
                levels += level;
                total += level * BASE_POWER_PER_LVL * powerFactor(h, fighterHero(h));
            }
            if (total > 0) return total;

            // Фолбэк для старых ответов API: power по бойцам, затем уровни.
            let sum = 0;
            for (const h of list) sum += num(h && h.power);
            if (sum > 0) return sum;
            return levels * BASE_POWER_PER_LVL;
        };

        // Синергия ролей: танк (паладин/легионер) держит первую линию,
        // лекарь (жрец) продлевает жизнь клина. Бонус маленький (+3%/+2%),
        // иначе он перебивал бы разницу силы.
        const synergyBonus = (list) => {
            if (!Array.isArray(list) || !list.length) return 0;
            let tank = false;
            let healer = false;
            for (const h of list) {
                const role = low(h && (h.role || h.class));
                if (TANKS[role]) tank = true;
                if (HEALERS[role]) healer = true;
            }
            return (tank ? 0.03 : 0) + (healer ? 0.02 : 0);
        };

        // Вклад одного героя по реальным боевым статам (GET /api/arena/hero).
        //
        // Формула — прокси «эффективного HP × урон»:
        //   raw = hp*0.30 + (atk + mag*0.85)*1.55 + def*0.95
        //   hp   — выживаемость (0.30 — вклад в общий счёт);
        //   atk/mag — урон; магия чуть дешевле физики (0.85), т.к. часть
        //             магии уходит в лечение/щиты, а не в чистый урон;
        //   def  — броня снижает получаемый урон, вес 0.95.
        // Множители:
        //   (1 + 0.012*enAvg) — средняя заточка надетых предметов (0..15):
        //                        каждый уровень ~+1.2% (таблица заточки игры
        //                        даёт прирост нелинейно, здесь линейный прокси);
        //   (1 - pen/100)     — штраф GEAR_PEN за чужой тип брони, потолок
        //                        GEAR_PEN_CAP (магический фокус не штрафуется);
        //   (1 + 0.004*pts)   — очки талантов sk.t, каждый ранг ~+0.4%
        //                        (потолок 60 очков, чтобы не разгонять бейдж).
        const heroScore = (hero) => {
            if (!hero || typeof hero !== 'object') return 0;
            const arena = hero.arena || {};
            const hp = num(arena.hp);
            const atk = num(arena.atk);
            const mag = num(arena.mag);
            const def = num(arena.def);
            if (!hp && !atk && !mag && !def) return 0;

            const items = Array.isArray(hero.items) ? hero.items : [];
            let enSum = 0;
            let enCount = 0;
            let pen = 0;
            const role = low(hero.role || hero.class);
            const classGear = (GAME_DATA.CLASS_GEAR && GAME_DATA.CLASS_GEAR[role]) || '';
            const penTable = GAME_DATA.GEAR_PEN || {};

            for (const it of items) {
                if (!it) continue;
                enSum += num(it.en);
                enCount += 1;
                const slot = String(it.slot || '');
                if (slot !== 'armor' && slot !== 'helmet' && slot !== 'shield') continue;
                // Магический фокус (cloth в слоте shield) — не чужой слот.
                if (isFocusItem(it)) continue;
                if (classGear && it.gear && it.gear !== 'any' && it.gear !== classGear) {
                    pen += num(penTable[slot]);
                }
            }
            pen = Math.min(num(GAME_DATA.GEAR_PEN_CAP) || 50, pen);

            const enAvg = enCount ? (enSum / enCount) : 0;
            const sk = hero.sk && hero.sk.t;
            let pts = 0;
            if (sk && typeof sk === 'object') {
                for (const key in sk) pts += num(sk[key]);
            }
            pts = Math.min(60, pts);

            const raw = hp * 0.30 + (atk + mag * 0.85) * 1.55 + def * 0.95;
            return raw * (1 + 0.012 * enAvg) * (1 - pen / 100) * (1 + 0.004 * pts);
        };

        // Суммарный счёт отряда по кэшу героев + покрытие кэшем.
        const teamScore = (list) => {
            const arr = Array.isArray(list) ? list : [];
            let sum = 0;
            let covered = 0;
            for (const h of arr) {
                if (!h) continue;
                const hero = getHero(h);
                if (!hero) continue;
                const score = heroScore(hero);
                if (score > 0) {
                    sum += score;
                    covered += 1;
                }
            }
            return { sum, covered, total: arr.length, ratio: arr.length ? covered / arr.length : 0 };
        };

        // Итоговая оценка. Диапазон ограничен 5..95%: точный исход боя
        // зависит от порядка ходов, талантов и крит-роллов, поэтому
        // «100%» на бейдже было бы враньём.
        const winChance = (offer) => {
            const duel = state.duel;
            const me = duel && duel.me;
            const squad = mySquad();
            const foes = foeSquad(offer);

            const myPower = powerValue(me, squad);
            const foePower = powerValue(offer, foes);
            const myRating = num(me && me.rating);
            const foeRating = num(offer && offer.rating);
            // Сервер не отдаёт power для duel.me — своя сила расчётная,
            // в подсказке помечаем её «~».
            const myPowerExact = num(me && me.power) > 0;

            // 1) Сила. Степенная логистика по отношению сил:
            //      prob = 1 / (1 + (foe/my)^4.8)
            //    равные силы дают ровно 50%, а разница уже в 10-15% силы
            //    ощутимо меняет шанс. Чистая силовая вероятность: на 10%
            //    сильнее — ~61%, на 20% — ~71%, на 10% слабее — ~39%,
            //    на 20% — ~29%; после смешивания с Elo при равном рейтинге
            //    это ~59/66/41/34%. Показатель 4.8 подобран так, чтобы
            //    кривая была чувствительной, но не «ступенчатой»
            //    (при 1.0 всегда 0.5, при ∞ -> 0/1).
            const powerProb = (myPower > 0 && foePower > 0)
                ? 1 / (1 + Math.pow(foePower / myPower, 4.8))
                : 0.5;
            // 2) Elo: 400 очков разницы = примерно 10:1 в пользу сильнейшего
            //    (стандартная логистическая кривая рейтинга).
            const eloProb = 1 / (1 + Math.pow(10, (foeRating - myRating) / 400));
            // Сила весит больше рейтинга (0.78/0.22): рейтинг арены
            // «размывается» тестовыми боями и обороной, а сила — прямое
            // сравнение текущих составов.
            let prob = 0.78 * powerProb + 0.22 * eloProb;
            // 3) Синергия клина: танк/лекарь у нас против их отсутствия.
            //    Ограничение ±4%: бонус не должен перебивать разницу силы.
            const syn = synergyBonus(squad) - synergyBonus(foes);
            prob += clamp(syn, -0.04, 0.04);
            const baseProb = prob;

            // 4) Уточнение по реальным статам, если героев уже осматривали
            //    (кэш /api/arena/hero). Нужно покрытие >= 60% с обеих сторон,
            //    иначе один осмотренный боец перекосит весь отряд.
            const mineStats = teamScore(squad);
            const foeStats = teamScore(foes);
            let detail = null;
            if (mineStats.sum > 0 && foeStats.sum > 0
                && mineStats.ratio >= 0.6 && foeStats.ratio >= 0.6) {
                const statProb = mineStats.sum / (mineStats.sum + foeStats.sum);
                prob = 0.45 * baseProb + 0.55 * statProb;
                detail = { mine: mineStats, foe: foeStats, prob: statProb };
            }

            prob = clamp(prob, 0.05, 0.95);
            const pct = Math.round(prob * 100);
            const level = pct >= 60 ? 'high' : (pct >= 40 ? 'mid' : 'low');

            const lines = [
                `Шанс победы: ~${pct}%`,
                `Сила: наша ${myPowerExact ? '' : '~'}${fmt(myPower)} — враг ${fmt(foePower)}`,
                `Рейтинг: наш ${myRating} — враг ${foeRating}`,
                detail
                    ? `Детальные статы: учтены (${detail.mine.covered}/${detail.mine.total} наших, `
                        + `${detail.foe.covered}/${detail.foe.total} врагов)`
                    : 'Детальные статы: нет данных — открой карточку бойца, чтобы уточнить оценку'
            ];

            return {
                pct,
                level,
                myPower,
                foePower,
                myPowerExact,
                myRating,
                foeRating,
                detail,
                title: lines.join('\n')
            };
        };

        // ------------------------------------------------------------
        // Вставки в DOM
        // ------------------------------------------------------------
        const WIN_CLS = 'lgu-win-chance';
        const WARN_CLS = 'lgu-guild-foe-warn';
        const ALLY_CLS = 'lgu-ally-slot';

        // Прямой потомок с нашим классом (querySelector(':scope > …') не
        // нужен: бейдж всегда лежит первым уровнем в своей карточке).
        const findOwn = (parent, cls) => {
            if (!parent || !parent.children) return null;
            for (const child of parent.children) {
                if (child.classList && child.classList.contains(cls)) return child;
            }
            return null;
        };

        // Бейдж шанса победы. dataset.sig — подпись содержимого: пока оценка
        // не изменилась, DOM не трогаем, иначе наблюдатель мутаций раскрутил
        // бы цикл «вставка -> мутация -> вставка».
        const renderWinBadge = (parent, offer, before) => {
            if (!parent) return;
            if (!offer) {
                const old = findOwn(parent, DOM_IDS.arenaWinChance);
                if (old) old.remove();
                return;
            }

            const calc = winChance(offer);
            const sig = calc.pct + '|' + calc.level + '|' + calc.title;
            let el = findOwn(parent, DOM_IDS.arenaWinChance);

            if (!el) {
                el = document.createElement('div');
                el.className = WIN_CLS + ' ' + DOM_IDS.arenaWinChance;
                if (before && before.parentNode === parent) parent.insertBefore(el, before);
                else parent.appendChild(el);
            }

            if (el.dataset.sig === sig) return;
            el.dataset.sig = sig;
            el.className = WIN_CLS + ' ' + DOM_IDS.arenaWinChance + ' ' + calc.level;
            el.textContent = `Шанс победы: ~${calc.pct}%`;
            el.title = calc.title;
        };

        // Имена согильдейцев в отряде противника (себя не считаем).
        const guildNamesFor = (offer) => {
            const out = [];
            for (const h of foeSquad(offer)) {
                if (!isGuildmate(h)) continue;
                const name = String((h && (h.name || h.login)) || '').trim();
                if (name && !out.includes(name)) out.push(name);
            }
            return out;
        };

        // Плашка «Согильдейцы в отряде противника». Одна на контейнер:
        // повторные мутации только обновляют текст, дубликатов не появляется.
        //
        // opts.compact — режим шапки карточки (.av-oh, там мало места):
        //   один короткий ник (<= 12 символов) -> «🛡️ Ник»,
        //   один длинный -> «🛡️ Согильдеец»,
        //   несколько -> «🛡️ Согильдейцы: N» (без списка имён).
        // opts.before — узел, перед которым встаёт бейдж: нативный
        // <span class="av-chip">🏆 …</span> в .av-oh.
        // В окне боя выводим полный список; перечень имён всегда в title.
        const renderGuildWarn = (parent, names, opts) => {
            if (!parent) return;
            const el = findOwn(parent, DOM_IDS.arenaFoeWarn);

            if (!names || !names.length) {
                if (el) el.remove();
                return;
            }

            const compact = !!(opts && opts.compact);
            const before = (opts && opts.before) || null;
            let text;
            if (!compact) {
                text = '🛡️ Согильдейцы: ' + names.join(', ');
            } else if (names.length > 1) {
                text = '🛡️ Согильдейцы: ' + names.length;
            } else if (String(names[0]).length <= 12) {
                text = '🛡️ ' + names[0];
            } else {
                text = '🛡️ Согильдеец';
            }
            const title = 'Согильдийцы в отряде: ' + names.join(', ');

            let badge = el;
            if (!badge) {
                // Класс av-chip даёт нативную «пилюлю», lgu-guild-foe-warn
                // перекрашивает её в зелёный (styles.js).
                badge = document.createElement('span');
                badge.className = 'av-chip ' + WARN_CLS + ' ' + DOM_IDS.arenaFoeWarn;
                if (before && before.parentNode === parent) parent.insertBefore(badge, before);
                else parent.appendChild(badge);
            } else if (before && before.parentNode === parent && badge.nextSibling !== before) {
                // Игра могла переставить узлы — держим бейдж непосредственно
                // перед нативным чипом рейтинга.
                parent.insertBefore(badge, before);
            }
            const sig = text + '|' + title;
            if (badge.dataset.sig === sig) return;
            badge.dataset.sig = sig;
            badge.textContent = text;
            badge.title = title;
        };

        // Подсветка слотов согильдейцев на мини-сцене карточки (.av-scene).
        //
        // arena2.js рендерит клин обороны так: массив MW = [3, 4, 1, 2, 0]
        // задаёт только ПОРЯДОК ВЫВОДА, а класс .av-pN — это индекс бойца в
        // offer.def[]. Поэтому ищем строго по селектору .av-mh.av-p${i}, а не
        // по позиции элемента в DOM (иначе бойцы перепутаются).
        // Внутрь .av-nm не лезем: nm() задаёт размер шрифта через --fs и
        // <wbr>, правки textContent/innerHTML сломают нативную вёрстку —
        // ставим только класс на контейнер.
        const renderAllySlots = (card, offer) => {
            if (!card) return;
            const def = (offer && Array.isArray(offer.def)) ? offer.def : [];

            for (let i = 0; i < 5; i += 1) {
                const slotEl = card.querySelector('.av-mh.av-p' + i);
                if (!slotEl) continue;

                let ally = !!(def[i] && isGuildmate(def[i]));
                if (!def[i]) {
                    // Резерв: полный ник бойца лежит в title у span внутри .av-nm.
                    const nick = slotEl.querySelector('.av-nm span');
                    ally = isGuildmateKey(nick && nick.getAttribute('title'));
                }
                slotEl.classList.toggle(ALLY_CLS, ally);
            }
        };

        // Соперник по логину. В arena2.js у карточки лобби нет data-off:
        // логин лидера лежит в кнопке сцены (.av-scene[data-sq]) и в кнопке
        // атаки ([data-atk]), поэтому ищем offer в duel.offers[] по нему.
        const offerByLogin = (login) => {
            const duel = state.duel;
            if (!duel || !Array.isArray(duel.offers)) return null;
            const key = low(login);
            if (!key) return null;
            for (const o of duel.offers) {
                if (o && low(o.login) === key) return o;
            }
            return null;
        };

        // Карточки соперников в лобби (.av-offs .av-panel.av-off):
        // плашка шанса — перед .av-gain, бейдж согильдейцев — в шапку .av-oh.
        const injectOfferCards = () => {
            const duel = state.duel;
            if (!duel || !Array.isArray(duel.offers)) return;

            for (const card of document.querySelectorAll('.av-offs .av-panel.av-off')) {
                const scene = card.querySelector('.av-scene');
                const atk = card.querySelector('[data-atk]');
                const targetLogin = (scene && scene.dataset.sq) || (atk && atk.dataset.atk);
                // Карточка-заглушка .av-ghost: ни сцены с data-sq, ни атаки.
                if (!targetLogin) continue;

                const offer = offerByLogin(targetLogin);
                if (!offer) continue;

                // Плашка шанса — перед .av-gain («Победа/Поражение»), если его
                // нет — перед .av-cf (сила + кнопка «⚔ Атака»).
                const gain = card.querySelector('.av-gain');
                const cf = card.querySelector('.av-cf');
                const before = (gain && gain.parentNode === card) ? gain
                    : ((cf && cf.parentNode === card) ? cf : null);
                renderWinBadge(card, offer, before);

                // Шапка карточки узкая — компактный бейдж, полный список в title.
                const head = card.querySelector('.av-oh');
                if (head) {
                    const chip = head.querySelector('.av-chip:not(.' + WARN_CLS + ')');
                    renderGuildWarn(head, guildNamesFor(offer), { compact: true, before: chip });
                }

                // Прямая подсветка слотов клина обороны на самой мини-сцене.
                renderAllySlots(card, offer);
            }
        };

        // Окно подготовки к бою (.av-win.av-fwin). У arena2.js это отдельная
        // модалка: поле .av-bf, фигурки противника .av-hero.av-foe и кнопки
        // «Как в обороне / ⚔ В бой» (.av-fbtns). Оффер ищем по никам из
        // .av-nm span[title]; если ников в DOM ещё нет — по lastAtkTarget.
        const findOfferByNames = (names) => {
            const duel = state.duel;
            if (!duel || !Array.isArray(duel.offers)) return null;
            const want = new Set((names || []).map((n) => low(n)).filter(Boolean));
            if (!want.size) return null;

            let best = null;
            let bestHit = 0;
            for (const o of duel.offers) {
                let hit = 0;
                for (const h of foeSquad(o)) {
                    const key = low(h && (h.name || h.login));
                    if (key && want.has(key)) hit += 1;
                }
                if (hit > bestHit) {
                    best = o;
                    bestHit = hit;
                }
            }
            return bestHit > 0 ? best : null;
        };

        // Окно боя. Класс av-fwin есть не во всех сборках клиента, поэтому
        // дополнительно узнаём его по полю .av-bf и кнопкам .av-fbtns.
        const fightWindow = () => {
            const direct = document.querySelector('.av-win.av-fwin');
            if (direct) return direct;
            for (const win of document.querySelectorAll('.av-win')) {
                if (win.querySelector('.av-fbtns') || win.querySelector('.av-bf')) return win;
            }
            return null;
        };

        // Отряд, на который открыто окно боя. Точный источник — последний клик
        // «⚔ Атака» (data-atk), но в окне может оказаться и месть (реванш):
        // поэтому сверяем ники фигурок врага из .av-hero.av-foe .av-nm span.
        const pickFightOffer = (nickNames) => {
            const want = new Set((nickNames || []).map(low).filter(Boolean));
            const target = offerByLogin(lastAtkTarget);
            if (target && (!want.size || foeSquad(target).some((h) => want.has(low(h && (h.name || h.login)))))) {
                return target;
            }
            return findOfferByNames(nickNames);
        };

        const injectFightWindow = () => {
            const win = fightWindow();
            if (!win) return;

            const nickNames = Array.from(win.querySelectorAll('.av-hero.av-foe .av-nm span'))
                .map((el) => String(el.getAttribute('title') || el.textContent || '').trim())
                .filter(Boolean);

            const offer = pickFightOffer(nickNames);
            const names = offer ? guildNamesFor(offer) : [];

            // Подсветка вражеских фигурок: def отряда надёжнее DOM, но ник из
            // title работает и когда оффер в новом снимке не нашёлся.
            for (const hero of win.querySelectorAll('.av-hero.av-foe')) {
                const span = hero.querySelector('.av-nm span');
                const nick = String((span && span.getAttribute('title')) || '').trim();
                const ally = isGuildmateKey(nick);
                hero.classList.toggle(ALLY_CLS, ally);
                if (ally && nick && !names.includes(nick)) names.push(nick);
            }

            // Сводная строка встаёт перед .av-fbtns («Как в обороне / В бой»).
            // Если показать нечего (нет снимка арены и нет согильдейцев),
            // коробку не создаём вовсе — иначе «создать -> удалить» крутило бы
            // MutationObserver бесконечным циклом.
            let box = win.querySelector('.' + DOM_IDS.arenaBadgeBox);
            if (!offer && !names.length) {
                if (box) box.remove();
                return;
            }

            if (!box) {
                box = document.createElement('div');
                box.className = 'lgu-arena-card-badge ' + DOM_IDS.arenaBadgeBox;
                const btns = win.querySelector('.av-fbtns');
                if (btns && btns.parentNode) btns.parentNode.insertBefore(box, btns);
                else win.appendChild(box);
            }

            renderWinBadge(box, offer, null);
            renderGuildWarn(box, names);
        };

        // ------------------------------------------------------------
        // Вкладка «Согильдейцы» в модалке «Пригласить в отряд»
        // (.av-win.av-invwin -> .av-itabs / .av-ibody)
        // ------------------------------------------------------------
        const inviteWin = () => document.querySelector('.av-win.av-invwin');

        // Приглашение в один клик. В arena2.js действие идёт как
        // { op: 'inv', who: <login> } — не путать со старой ареной, где было
        // { op: 'invite', login }. Контекст арены (x.api) сохранён хуком
        // LGArena.open; фолбэк — Utils.fetchApi, он сам выберет G.X.api.
        const guildInvite = async (login, btn) => {
            if (!btn || btn.dataset.busy === '1') return;
            const who = String(login || '').trim();
            if (!who) return;

            const label = btn.textContent;
            btn.dataset.busy = '1';
            btn.disabled = true;
            btn.textContent = 'Зовём…';

            const ctx = G.__lgArenaContext;
            const apiFn = (ctx && typeof ctx.api === 'function')
                ? ctx.api.bind(ctx)
                : Utils.fetchApi.bind(Utils);

            let res = null;
            try {
                res = await apiFn('/api/arena/act', { op: 'inv', who });
            } catch (e) {
                res = { ok: false, error: (e && e.message) || 'сеть недоступна' };
            }

            const body = (res && res.body && typeof res.body === 'object') ? res.body : res;
            const ok = !!(body && body.ok !== false && (!res || res.ok !== false));
            const errText = (body && body.error) || (res && res.error) || 'Не удалось позвать игрока';

            if (ok) {
                btn.textContent = 'Позван';
                btn.disabled = true;
                delete btn.dataset.busy;
                if (typeof UI !== 'undefined' && UI.showToast) {
                    UI.showToast('Приглашение отправлено: ' + who);
                }
                // Следующий проход заново возьмёт /api/arena: состав отряда
                // меняется после accept, а не сразу после приглашения.
                state.at = 0;
                state.failAt = 0;
                schedule(true);
                return;
            }

            btn.textContent = 'Ошибка';
            btn.title = errText;
            btn.disabled = false;
            delete btn.dataset.busy;
            if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(errText, true);
            setTimeout(() => {
                if (!btn.isConnected) return;
                btn.textContent = label || 'Позвать';
            }, 2000);
        };

        // Список согильдейцев в .av-ibody. Разметка повторяет нативную
        // вкладку «Поиск» (arena2.js: .av-ih4 / ul.av-ilist / li.av-irow):
        // первая ячейка строки — статичный глиф .av-f.av-fe (как ⚑ в нативном
        // наборе), сетка .av-irow рассчитана на «44px 1fr auto auto».
        const renderGuildList = (body) => {
            if (!body) return;
            const duel = state.duel;
            const me = duel && duel.me;
            const sq = me && me.squad;
            const members = mySquad();
            const team = num(duel && duel.rules && duel.rules.team) || 5;
            const full = !!(sq && sq.full) || members.length >= team;

            // 1) Отряд уже собран — нативная формулировка.
            if (full) {
                body.innerHTML = '<p class="av-inote">В отряде уже 5 игроков.</p>';
                return;
            }
            // 2) Гильдии нет — звать некого.
            if (!inGuild && !guildId) {
                body.innerHTML = '<p class="av-inote">Ты не состоишь в гильдии.</p>';
                return;
            }
            // Состав не пришёл (сеть/права) — не врём про «нет гильдии».
            if (!guildRecords.length) {
                body.innerHTML = '<p class="av-inote">Не удалось загрузить состав гильдии.</p>';
                return;
            }

            const own = myLogin();
            const taken = new Set();
            for (const h of members) {
                for (const key of heroKeys(h)) taken.add(key);
            }

            const rows = [];
            for (const rec of guildRecords) {
                if (rec.pending) continue;
                const key = rec.login || low(rec.name);
                if (!key) continue;
                if (own && key === own) continue;
                if (taken.has(key) || (rec.name && taken.has(low(rec.name)))) continue;
                rows.push(rec);
            }

            // Онлайн — сверху, затем по времени последней сессии, затем по алфавиту.
            rows.sort((a, b) => {
                const diff = (b.online ? 1 : 0) - (a.online ? 1 : 0);
                if (diff) return diff;
                const seen = num(b.seenAt) - num(a.seenAt);
                if (seen) return seen;
                return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
            });

            if (!rows.length) {
                body.innerHTML = '<p class="av-inote">Все согильдейцы уже в отряде.</p>';
                return;
            }

            const item = (rec) => {
                const info = heroInfo(rec);
                const meta = [];
                if (info.roleName) meta.push(info.roleName);
                if (info.level) meta.push(info.level + ' ур.');
                if (info.power) meta.push('сила ' + fmt(info.power));
                const status = rec.online
                    ? '<span class="av-st av-on">в сети</span>'
                    : '<span class="av-st">не в сети</span>';
                const login = rec.login || low(rec.name);
                return `<li class="av-irow"><span class="av-f av-fe">🛡</span>`
                    + `<span><b>${esc(rec.name)}</b><small>${esc(meta.join(' · '))}</small></span>`
                    + status
                    + `<button type="button" class="av-btn av-red" data-gldinv="${esc(login)}">Позвать</button></li>`;
            };

            const onlineCount = rows.filter((rec) => rec.online).length;
            body.innerHTML = `<h4 class="av-ih4"><span class="av-onl"></span> Согильдейцы онлайн <span>${onlineCount}</span></h4>`
                + `<ul class="av-ilist ${DOM_IDS.arenaGuildList}">${rows.map(item).join('')}</ul>`;

            body.querySelectorAll('[data-gldinv]').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    guildInvite(btn.dataset.gldinv, btn);
                });
            });
        };

        // Подсветка вкладки. arena2.css красит активную кнопку по
        // button[aria-selected="true"] -> --gw-sel, поэтому классы не нужны.
        const activateGuildTab = (tabs) => {
            if (!tabs) return;
            for (const tab of tabs.querySelectorAll('[data-it]')) {
                tab.setAttribute('aria-selected', String(tab.dataset.it === 'guild'));
            }
        };

        // Модалка «Пригласить в отряд»: .av-win.av-invwin -> .av-itabs /
        // .av-ibody. Игра перерисовывает её целиком на каждое действие
        // (draw(): w.innerHTML = ...), поэтому кнопку и обработчик ставим
        // заново на новый DOM; dataset.lguBound защищает от дублей, пока
        // узел жив.
        const injectInviteTab = () => {
            const win = inviteWin();
            if (!win) return;
            const tabs = win.querySelector('.av-itabs');
            const body = win.querySelector('.av-ibody');
            if (!tabs || !body) return;

            let btn = tabs.querySelector('[data-it="guild"]');
            if (!btn) {
                btn = document.createElement('button');
                btn.type = 'button';
                btn.setAttribute('role', 'tab');
                btn.dataset.it = 'guild';
                btn.setAttribute('aria-selected', 'false');
                btn.className = DOM_IDS.arenaGuildTab;
                btn.textContent = 'Согильдейцы';

                const find = tabs.querySelector('[data-it="find"]');
                if (find) find.insertAdjacentElement('afterend', btn);
                else tabs.appendChild(btn);
            }

            if (btn.dataset.lguBound === '1') return;
            btn.dataset.lguBound = '1';

            btn.addEventListener('click', (e) => {
                // У нативных вкладок стоит onclick, который зовёт draw() и
                // перерисовывает модалку — всплытие останавливаем.
                e.preventDefault();
                e.stopPropagation();
                activateGuildTab(tabs);

                // Состав уже в памяти — рисуем сразу, иначе заглушка и
                // повторная отрисовка после ответа /api/guilds/guild.
                if (guildRecords.length || guildId || inGuild) renderGuildList(body);
                else body.innerHTML = '<p class="av-inote">Загружаем состав гильдии…</p>';

                ensureGuild().then(() => {
                    if (!btn.isConnected) return;
                    if (btn.getAttribute('aria-selected') !== 'true') return;
                    renderGuildList(body);
                }).catch(() => {});
            });
        };

        // ------------------------------------------------------------
        // Снимок GET /api/arena
        // ------------------------------------------------------------
        const applyState = (data) => {
            if (!data || typeof data !== 'object' || data.ok === false) return;
            const duel = data.duel;
            if (!duel || typeof duel !== 'object') return;

            state.duel = duel;
            // mine — журнал командных боёв (arena2.js, logList), а не состав
            // отряда; храним как есть, отряд берём из duel.me.squad.
            state.mine = Array.isArray(data.mine) ? data.mine : state.mine;
            state.me = duel.me || state.me;
            state.at = Date.now();
            state.failAt = 0;
            try { G.__lgArenaData = data; } catch (e) {}
        };

        // Снимок нужен, когда аддон запустился уже на открытой арене
        // (хук LGArena.open к этому моменту ничего не поймал).
        const ensureState = async () => {
            if (stateBusy) return;
            const now = Date.now();
            if (state.duel && (now - state.at) < STATE_TTL) return;
            if (state.failAt && (now - state.failAt) < STATE_FAIL_TTL) return;

            stateBusy = true;
            try {
                const res = await Utils.fetchApi('/api/arena');
                const body = (res && res.body && typeof res.body === 'object') ? res.body : res;
                if (!body || body.ok === false || !body.duel) {
                    state.failAt = Date.now();
                    return;
                }
                applyState(body);
            } catch (e) {
                state.failAt = Date.now();
            } finally {
                stateBusy = false;
            }
        };

        // ------------------------------------------------------------
        // Ответы API (зовёт хук LGArena.open -> x.api)
        // ------------------------------------------------------------
        const onApiResponse = (path, res, reqBody) => {
            const p = String(path || '');
            if (!p) return;

            if (p.indexOf('/api/arena/hero') === 0) {
                const match = /[?&]login=([^&]*)/.exec(p);
                let login = '';
                try { login = match ? decodeURIComponent(match[1]) : ''; } catch (e) { login = match ? match[1] : ''; }
                const data = (res && res.body && typeof res.body === 'object') ? res.body : res;
                if (data && data.hero) cacheHero(login || data.hero.login, data.hero);
            } else if (/^\/api\/arena(\?|$)/.test(p)) {
                const data = (res && res.body && typeof res.body === 'object') ? res.body : res;
                applyState(data);
            } else if (p.indexOf('/api/arena/act') === 0) {
                // Состав отряда мог измениться (invite/accept/kick/sqleave) —
                // помечаем снимок устаревшим, следующий проход его обновит.
                state.at = 0;
                state.failAt = 0;
            } else {
                return;
            }

            // reqBody в обработке не нужен (ответ всегда в res), но
            // параметр держим по контракту хука.
            void reqBody;
            schedule(true);
        };

        // ------------------------------------------------------------
        // Жизненный цикл и наблюдатель DOM
        // ------------------------------------------------------------
        let pendingForce = false;

        // Все вставки одним синхронным блоком: флаг injecting страхует
        // наблюдатель от лишнего прохода прямо во время нашей отрисовки.
        const injectAll = () => {
            if (destroyed) return;
            injecting = true;
            try {
                injectOfferCards();
                injectFightWindow();
                injectInviteTab();
            } finally {
                injecting = false;
            }
        };

        // Один проход: быстрая отрисовка по уже известным данным, затем
        // подтягивание снимка арены и состава гильдии с повторной отрисовкой.
        // Сеть не задерживает бейджи: без ответа они появятся со следующими
        // данными, а не «через минуту после открытия арены».
        const run = async (force) => {
            if (destroyed || running) return;
            // Дешёвый фильтр: вне арены (город/шахта/поход) ничего не делаем.
            // .arb — корень arena2 (.av-root.av-wrap.arb) и подложка модалки
            // (.av-root.av-dim.arb); .av-win — окно боя/приглашения.
            if (!arenaRoot() && !document.querySelector('.av-win')) return;

            const now = Date.now();
            if (!force && (now - lastRun) < RUN_THROTTLE) {
                // Проход не выбрасываем: модалка арены ставится одним
                // innerHTML, и без повтора наши вставки в неё не появятся до
                // следующей мутации (которой может и не быть).
                runLater();
                return;
            }
            lastRun = now;

            running = true;
            try {
                injectAll();
                await ensureState();
                injectAll();
                await ensureGuild();
                injectAll();
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

            // Логин соперника из клика «⚔ Атака» ([data-atk] в карточке
            // .av-off): по нему окно боя находит свой offer в duel.offers[].
            // Слушаем в capture-фазе, чтобы значение было готово раньше, чем
            // обработчик игры откроет модалку.
            if (!onDocClick) {
                onDocClick = (e) => {
                    const btn = (e.target && e.target.closest) ? e.target.closest('[data-atk]') : null;
                    if (!btn) return;
                    const login = btn.dataset.atk;
                    if (!login) return;
                    lastAtkTarget = String(login);
                };
                document.addEventListener('click', onDocClick, true);
            }

            if (observer || typeof MutationObserver === 'undefined') {
                schedule(true);
                return;
            }

            observer = new MutationObserver(() => {
                // Проход уже запланирован — не сканируем документ на каждой
                // пачке мутаций (в чате/городе их сотни в секунду).
                if (injecting || scheduled) return;
                if (!arenaRoot() && !document.querySelector('.av-win')) return;
                schedule(false);
            });
            observer.observe(document.body, { childList: true, subtree: true });

            // Аддон мог загрузиться уже на открытой арене — сразу один проход.
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
            if (deferredTimer) {
                clearTimeout(deferredTimer);
                deferredTimer = null;
            }
            scheduled = false;
            pendingForce = false;
            injecting = false;
            lastRun = 0;
            stateBusy = false;
            guildBusy = null;
            lastAtkTarget = '';

            state.duel = null;
            state.mine = null;
            state.me = null;
            state.at = 0;
            state.failAt = 0;

            heroCache.clear();
            guildCache.clear();
            guildMap = new Map();
            guildRecords = [];
            guildId = null;
            guildIdAt = 0;
            inGuild = false;

            // Убираем свои вставки из живого DOM: нативные узлы остаются,
            // наши бейджи и вкладка не должны переживать перезапуск скрипта.
            document.querySelectorAll('.' + WIN_CLS + ', .' + WARN_CLS + ', .' + DOM_IDS.arenaBadgeBox + ', .' + DOM_IDS.arenaGuildTab)
                .forEach((el) => el.remove());
            // Классы подсветки живут на нативных слотах арены — снимаем их,
            // чтобы после выключения аддона поле выглядело как в игре.
            document.querySelectorAll('.' + ALLY_CLS).forEach((el) => el.classList.remove(ALLY_CLS));
            document.querySelectorAll('.av-itabs [data-it="guild"]').forEach((el) => el.remove());
            document.querySelectorAll('.' + DOM_IDS.arenaGuildList).forEach((el) => el.remove());
        };

        return { init, destroy, onApiResponse };
    })();

    // Для отладки из консоли страницы: window аддона — песочница, поэтому
    // публикуем в page-context через G (unsafeWindow), как main.js.
    try {
        const arenaWin = (typeof G !== 'undefined' && G) ? G : window;
        arenaWin.LegionArena = Arena;
    } catch (e) {}
