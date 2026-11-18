    // ============================================================
    // 6.9. МОДУЛЬ: АРЕНА 5×5 (modules/arena.js)
    //
    // Три функции поверх нативного экрана арены (.arb / .ar-mw8):
    //   1) оценка шанса победы над каждым отрядом соперника — компактный
    //      бейдж в карточке оффера и на экране подготовки к атаке;
    //   2) предупреждение «Согильдейцы в команде противника» — плашка в
    //      шапке карточки и в заголовке экрана атаки;
    //   3) четвёртая вкладка «Согильдейцы» в модалке «Пригласить в отряд»
    //      с приглашением в один клик.
    //
    // Античит/CSP:
    //   - window.fetch, LGMine.open и LGMine.onEvent НЕ патчим;
    //   - контекст арены и её api() приходят из core/hooks.js (хук
    //     LGArena.open), оттуда же — onApiResponse(path, res, body);
    //   - никаких localStorage: кэши героев/состава живут в Map с TTL,
    //     при destroy() они очищаются.
    //
    // Данные (reference/LegionFrontSRC/site/arena.js.txt):
    //   GET  /api/arena            -> { duel, mine, bots, ... }
    //        duel.me   — мой профиль: rating, power?, squad { full, members[], lead }
    //        duel.offers[] — соперники: login, title, rating, power, win, lose,
    //                        def[] (клин обороны), squad[] (список для атаки)
    //   GET  /api/arena/hero?login -> { hero } — arena { hp, atk, mag, def },
    //                                 items[] (en, gear, slot), sk.t (навыки)
    //   POST /api/arena/act        -> { ok, error? } (invite и т.д.)
    //
    // Подключается после core/ui.js и modules/guild-stats.js (SHARED_MODULES
    // в build.js); main.js вызывает init() в boot(), destroy() — в shutdown().
    // ============================================================
    const Arena = (() => {
        // TTL кэшей. Герой меняется редко, состав гильдии — раз в минуту,
        // снимок арены перезапрашиваем не чаще 20 с (нативный экран и сам
        // обновляет его по кнопке «Обновить»).
        const HERO_TTL = 600000;
        const GUILD_TTL = 60000;
        const STATE_TTL = 20000;
        const STATE_FAIL_TTL = 15000;
        // Тот же порог, что у GuildStats/updateOnlinePlayers: 5 минут без
        // событий — игрок считается вышедшим.
        const ONLINE_TTL = 300000;
        // Склейка мутаций: не чаще четырёх проходов в секунду.
        const RUN_THROTTLE = 250;

        // Русские имена классов (ROLE в site/arena.js). Фолбэк, если
        // GuildStats ещё не загрузил словарь roles{}.
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

        // Последний снимок арены. mine — очередь командных боёв из ответа
        // (в site/arena.js это v.mine), поэтому отряд берём из duel.me.squad.
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

        // Состав нашей гильдии: два ключа на участника (login и name),
        // значение { login, name, role, level }.
        let guildMap = new Map();
        // Уникальные записи (для вкладки): тот же состав без дублей по ключам.
        let guildRecords = [];
        let guildId = null;
        let guildAt = 0;
        let guildBusy = null;
        // Гильдия вообще есть? Отдельный флаг: пустой ответ ≠ «не в гильдии».
        let inGuild = false;

        let observer = null;
        let scheduled = false;
        let injecting = false;
        let lastRun = 0;
        let stateBusy = false;
        // Проход уже идёт (внутри есть await) — второй не запускаем.
        let running = false;
        // Время последней попытки определить гильдию: если игрок без гильдии,
        // не дёргаем LGGuilds.index() на каждой мутации DOM.
        let guildTriedAt = 0;
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
        // Источники (по приоритету):
        //   1) кэш GuildStats._guildData — если окно гильдии уже открывали,
        //      состав лежит там и второй запрос не нужен;
        //   2) GET /api/guilds/guild?id=<guildId> (docs/API.md) — раз в минуту.
        // id гильдии берём из G.ME.guild, иначе из G.LGGuilds.index()
        // (res.mine.member.guild), как это делает guild-stats.js.
        // ------------------------------------------------------------
        const applyGuildData = (body) => {
            const map = new Map();
            const seen = new Map();
            let any = false;

            for (const m of ((body && body.members) || [])) {
                if (!m || !(m.login || m.name)) continue;
                any = true;
                const login = String(m.login || '').trim();
                const name = String(m.name || '').trim();
                const rec = {
                    login,
                    name: name || login,
                    // role в гильдии (leader/officer/member) — не класс героя!
                    guildRole: String(m.role || ''),
                    level: num(m.level),
                    pending: !!m.pending
                };
                for (const key of [low(login), low(name)]) {
                    if (key) map.set(key, rec);
                }
                const uniq = low(login || name);
                if (uniq && !seen.has(uniq)) seen.set(uniq, rec);
            }

            if (!any) return;
            guildMap = map;
            guildRecords = Array.from(seen.values());
            guildAt = Date.now();
            inGuild = true;
        };

        // id своей гильдии. Синхронные источники -> индекс LGGuilds.
        const resolveGuildId = async () => {
            if (guildId) return guildId;
            // Без гильдии индекс игры дёргать не чаще раза в 30 с.
            const now = Date.now();
            if (guildTriedAt && (now - guildTriedAt) < 30000) return null;

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
            let res = null;
            // Отметку ставим ДО запроса: параллельные проходы не должны
            // уйти вторым вызовом index().
            guildTriedAt = Date.now();
            try { res = await LGG.index(); } catch (e) { return null; }
            const member = res && res.mine && (res.mine.member || res.mine);
            const mid = member && (member.guild != null ? member.guild : member.gid);
            if (mid != null && mid !== '') {
                guildId = String(mid);
                guildTriedAt = 0;
                return guildId;
            }
            // Ответ есть, а гильдии нет — запоминаем, чтобы не дёргать API
            // на каждой мутации DOM.
            if (res && res.ok !== false) inGuild = false;
            return null;
        };

        const ensureGuild = async () => {
            if (guildBusy) return guildBusy;
            if (!destroyed) {
                guildBusy = (async () => {
                    try {
                        const id = await resolveGuildId();
                        if (!id) {
                            guildRecords = [];
                            guildMap = new Map();
                            return;
                        }
                        inGuild = true;
                        if (guildId === id && guildAt && (Date.now() - guildAt) < GUILD_TTL) return;

                        // 1) Кэш GuildStats (тот же формат /api/guilds/guild).
                        const gs = (typeof GuildStats !== 'undefined') ? GuildStats : null;
                        if (gs && gs._guildData && String(gs._guildId || '') === id
                            && (Date.now() - num(gs._guildAt)) < GUILD_TTL) {
                            applyGuildData(gs._guildData);
                            return;
                        }

                        // 2) Свой запрос. Utils.fetchApi добавит /c/<канал>/.
                        let res = null;
                        try {
                            res = await Utils.fetchApi('/api/guilds/guild?id=' + encodeURIComponent(id));
                        } catch (e) {
                            return;
                        }
                        const body = (res && res.body && typeof res.body === 'object') ? res.body : res;
                        if (body && body.ok !== false) applyGuildData(body);
                    } catch (e) {
                        // Состав гильдии — необязательные данные: без него
                        // арена работает, бейджи просто не появятся.
                    } finally {
                        guildBusy = null;
                    }
                })();
            }
            return guildBusy || Promise.resolve();
        };

        // Согильдеец? Проверяем логин и имя бойца, себя исключаем.
        const isGuildmate = (fighter) => {
            if (!fighter || !guildMap.size) return false;
            const mine = myLogin();
            for (const key of heroKeys(fighter)) {
                if (mine && key === mine) return false;
                if (guildMap.has(key)) return true;
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

        // Друг? G.LGFriends.state(login) -> 'friends' | 'in' | 'out' | ...
        const friendState = (rec) => {
            const F = G.LGFriends;
            if (!F || typeof F.state !== 'function') return '';
            const login = String((rec && rec.login) || '').trim();
            const name = String((rec && rec.name) || '').trim();
            for (const key of [login, name]) {
                if (!key) continue;
                try {
                    const st = F.state(key);
                    if (st) return String(st);
                } catch (e) { /* друзья не загрузились — молчим */ }
            }
            return '';
        };

        // Уровень и класс согильдейца. В members[] гильдии лежит только
        // гильдейская роль, поэтому класс/уровень ищем в кэшах GuildStats:
        //   _legionCache.byLogin — ростер /api/legion (топ-120 канала);
        //   _citymonCache        — сборы элитных у стен (достаёт остальных).
        const heroInfo = (rec) => {
            let level = num(rec && rec.level);
            let role = '';
            let roleName = '';

            const gs = (typeof GuildStats !== 'undefined') ? GuildStats : null;
            const keys = [low(rec && rec.login), low(rec && rec.name)].filter(Boolean);

            const roster = gs && gs._legionCache;
            if (roster && roster.byLogin && typeof roster.byLogin.get === 'function') {
                for (const key of keys) {
                    const hit = roster.byLogin.get(key);
                    if (!hit) continue;
                    level = num(hit.level) || level;
                    role = hit.role || role;
                    roleName = hit.roleName || roleName;
                    break;
                }
            }

            if (!role && gs && gs._citymonCache && typeof gs._citymonCache.get === 'function') {
                for (const key of keys) {
                    const hit = gs._citymonCache.get(key);
                    if (!hit) continue;
                    level = num(hit.level) || level;
                    role = hit.role || role;
                    roleName = hit.roleName || roleName;
                    break;
                }
            }

            return {
                level,
                role,
                roleName: roleName || ROLE_RU[role] || role || ''
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

        // Плашка «Согильдейцы в команде противника». Одна на контейнер:
        // повторные мутации только обновляют текст, дубликатов не появляется.
        //
        // opts.compact — режим шапки карточки (.arb-ch, там мало места):
        //   один короткий ник (<= 12 символов) -> «🛡️ Ник»,
        //   один длинный -> «🛡️ Согильдеец»,
        //   несколько -> «🛡️ Согильдейцы: N» (без списка имён).
        // На широком экране подготовки к атаке (ar-foe) выводим полный
        // список. Полный перечень имён всегда лежит в title.
        const renderGuildWarn = (parent, names, opts) => {
            if (!parent) return;
            const el = findOwn(parent, DOM_IDS.arenaFoeWarn);

            if (!names || !names.length) {
                if (el) el.remove();
                return;
            }

            const compact = !!(opts && opts.compact);
            const host = opts && opts.host;
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
                badge = document.createElement('span');
                badge.className = WARN_CLS + ' ' + DOM_IDS.arenaFoeWarn;
                (host || parent).appendChild(badge);
            }
            const sig = text + '|' + title;
            if (badge.dataset.sig === sig) return;
            badge.dataset.sig = sig;
            badge.textContent = text;
            badge.title = title;
        };

        // Подсветка слотов согильдейцев прямо на поле боя (.arb-scene).
        //
        // Массив o.def карточки соперника (индексы 0..4) строго соответствует
        // data-slot у плашек .ar-mw-lb и фигурок .ar-mw-h (см. miniWedge в
        // reference/LegionFrontSRC/site/arena.js.txt). Внутрь .ar-mw-n не
        // лезем: нативная fitBand() сама подбирает размер шрифта ника по
        // ширине слота, любые правки textContent/отступов её сломают —
        // поэтому только добавляем/снимаем класс на контейнерах.
        const renderAllySlots = (card, offer) => {
            if (!card) return;
            const def = (offer && Array.isArray(offer.def)) ? offer.def : [];
            const slots = Math.max(5, def.length);
            for (let i = 0; i < slots; i += 1) {
                const ally = !!(def[i] && isGuildmate(def[i]));
                for (const sel of [
                    '.ar-mw-lb[data-slot="' + i + '"]',
                    '.ar-mw-h[data-slot="' + i + '"]'
                ]) {
                    const node = card.querySelector(sel);
                    if (node) node.classList.toggle(ALLY_CLS, ally);
                }
            }
        };

        // Карточки соперников в лобби: бейдж — между .arb-scene и .arb-gain,
        // плашка согильдейцев — в шапку .arb-ch.ar-oh.
        const injectOfferCards = () => {
            const duel = state.duel;
            if (!duel || !Array.isArray(duel.offers)) return;

            const byLogin = new Map();
            for (const o of duel.offers) {
                if (o && o.login != null) byLogin.set(String(o.login), o);
            }

            for (const card of document.querySelectorAll('.arb-card.ar-off[data-off]')) {
                const offer = byLogin.get(card.getAttribute('data-off'));
                if (!offer) continue;

                const gain = card.querySelector('.arb-gain') || card.querySelector('.ar-gain');
                renderWinBadge(card, offer, (gain && gain.parentNode === card) ? gain : null);

                // Шапка карточки узкая — компактный бейдж, полный список в title.
                const head = card.querySelector('.arb-ch.ar-oh') || card.querySelector('.arb-ch');
                if (head) renderGuildWarn(head, guildNamesFor(offer), { compact: true });

                // Прямая подсветка слотов клина обороны на самом поле боя.
                renderAllySlots(card, offer);
            }
        };

        // Экран подготовки к атаке (section.arb-panel.ar-foe). Оффер ищем по
        // никам из .ar-mini: нативная арена не оставляет login в разметке.
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

        const injectFoeScreen = () => {
            const foe = document.querySelector('section.arb-panel.ar-foe');
            if (!foe) return;

            const names = Array.from(foe.querySelectorAll('.ar-mini .ar-n'))
                .map((el) => String(el.textContent || ''));
            const offer = findOfferByNames(names);
            if (!offer) {
                // Соперника в новом снимке уже нет — убираем устаревшую плашку.
                const stale = findOwn(foe, DOM_IDS.arenaBadgeBox);
                if (stale) stale.remove();
                return;
            }

            let box = findOwn(foe, DOM_IDS.arenaBadgeBox);
            if (!box) {
                box = document.createElement('div');
                box.className = 'lgu-arena-card-badge ' + DOM_IDS.arenaBadgeBox;
                const head = foe.querySelector('.arb-pt');
                if (head) head.insertAdjacentElement('afterend', box);
                else foe.insertBefore(box, foe.firstChild);
            }

            renderWinBadge(box, offer, null);
            renderGuildWarn(box, guildNamesFor(offer));
        };

        // ------------------------------------------------------------
        // Вкладка «Согильдейцы» в модалке «Пригласить в отряд»
        // ------------------------------------------------------------
        const tabPanel = (dlg) => (dlg ? dlg.querySelector('#arTabP') : null);

        // Приглашение в один клик: op:'invite' (site/arena.js, act()).
        // Контекст арены (x.api) сохранён хуком LGArena.open; фолбэк —
        // Utils.fetchApi, он сам выберет G.X.api или обычный запрос.
        const guildInvite = async (login, btn) => {
            if (!btn || btn.dataset.busy === '1') return;
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
                res = await apiFn('/api/arena/act', { op: 'invite', login });
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
                    UI.showToast('Приглашение отправлено: ' + login);
                }
                // Следующий проход заново возьмёт /api/arena: состав отряда
                // меняется после accept, а не сразу после invite.
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

        // Список согильдейцев в #arTabP. Разметка повторяет нативную вкладку
        // «Друзья» (friendsHtml): .ar-frbox / .ar-frh / ul.ar-frl / li.ar-fr.
        const renderGuildList = (panel) => {
            if (!panel) return;
            const duel = state.duel;
            const me = duel && duel.me;
            const sq = me && me.squad;
            const team = num(duel && duel.rules && duel.rules.team) || 5;
            const members = (sq && Array.isArray(sq.members)) ? sq.members : [];
            const full = !!(sq && (sq.full || members.length >= team));

            // 1) Отряд уже собран — нативная заглушка.
            if (full) {
                panel.innerHTML = '<p class="arb-mute ar-pr">В отряде уже 5 игроков.</p>';
                return;
            }
            // 2) Гильдии нет — звать некого.
            if (!inGuild) {
                panel.innerHTML = '<p class="arb-mute ar-pr">Ты не состоишь в гильдии.</p>';
                return;
            }
            // Состав не пришёл (сеть/права) — не врём про «нет гильдии».
            if (!guildRecords.length) {
                panel.innerHTML = '<p class="arb-mute ar-pr">Не удалось загрузить состав гильдии.</p>';
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
                const keys = heroKeys(rec);
                if (!keys.length) continue;
                if (own && keys.includes(own)) continue;
                if (keys.some((key) => taken.has(key))) continue;
                rows.push({
                    rec,
                    on: onlineInfo(rec),
                    friend: friendState(rec),
                    info: heroInfo(rec)
                });
            }

            // Онлайн — сверху, остальные по алфавиту.
            rows.sort((a, b) => {
                const diff = (b.on ? 1 : 0) - (a.on ? 1 : 0);
                if (diff) return diff;
                return String(a.rec.name || '').localeCompare(String(b.rec.name || ''), 'ru');
            });

            if (!rows.length) {
                panel.innerHTML = '<p class="arb-mute ar-pr">Все согильдейцы уже в отряде.</p>';
                return;
            }

            const item = (row) => {
                const { rec, info, on, friend } = row;
                // Онлайн в трекере аддона (город/шахта за последние 5 минут) —
                // для арены это максимум доступной информации о присутствии.
                const online = on
                    ? '<span class="ar-on here">онлайн здесь</span>'
                    : '<span class="ar-off0">не в сети</span>';
                const meta = [];
                if (info.roleName) meta.push(esc(info.roleName));
                if (info.level) meta.push(info.level + ' ур.');
                if (friend === 'friends') meta.push('⭐ друг');
                const login = rec.login || rec.name;
                return `<li class="ar-fr" data-login="${esc(login)}">`
                    + `<span class="ar-frn"><b class="ar-n">${esc(rec.name)}</b>${online}</span>`
                    + `<span class="muted ar-frw">${meta.join(', ')}</span>`
                    + `<button type="button" class="arb-btn sm" data-gldinv="${esc(login)}">Позвать</button></li>`;
            };

            panel.innerHTML = `<div class="ar-frbox ${DOM_IDS.arenaGuildList}" role="region" aria-label="Согильдейцы">`
                + '<div class="ar-frh"><b>Согильдейцы</b><span class="muted">онлайн — сверху</span></div>'
                + `<ul class="ar-frl">${rows.map(item).join('')}</ul></div>`;

            panel.querySelectorAll('[data-gldinv]').forEach((btn) => {
                btn.addEventListener('click', () => guildInvite(btn.dataset.gldinv, btn));
            });
        };

        // Подсветка вкладки: .on + aria-selected/tabindex, как у нативных
        // кнопок в inviteHtml() игры.
        const activateGuildTab = (tabs, btn) => {
            for (const tab of tabs.querySelectorAll('.arb-tab')) {
                const on = tab === btn;
                tab.classList.toggle('on', on);
                tab.setAttribute('aria-selected', String(on));
                tab.tabIndex = on ? 0 : -1;
            }
        };

        // Модалка «Пригласить в отряд»: .ar-mw8.arb .ar-dlg[aria-label=…].
        // Игра перерисовывает .ar-dlg целиком при каждой смене вкладки
        // (modalSet в site/arena.js), поэтому кнопку и обработчики ставим
        // заново на новый DOM; dataset.lguBound защищает от дублей, пока
        // узел жив.
        const injectInviteTab = () => {
            const dlg = document.querySelector('.ar-mw8.arb .ar-dlg[aria-label="Пригласить в отряд"]');
            if (!dlg) return;
            const tabs = dlg.querySelector('.arb-tabs');
            const panel = tabPanel(dlg);
            if (!tabs || !panel) return;

            let btn = tabs.querySelector('#arTab-guild');
            if (!btn) {
                btn = document.createElement('button');
                btn.type = 'button';
                btn.setAttribute('role', 'tab');
                btn.className = 'arb-tab ' + DOM_IDS.arenaGuildTab;
                btn.id = 'arTab-guild';
                btn.dataset.invtab = 'guild';
                btn.setAttribute('aria-selected', 'false');
                btn.setAttribute('aria-controls', 'arTabP');
                btn.tabIndex = -1;
                btn.textContent = 'Согильдейцы';

                const find = tabs.querySelector('#arTab-find');
                if (find) find.insertAdjacentElement('afterend', btn);
                else tabs.appendChild(btn);
            }

            if (!btn.dataset.lguBound) {
                btn.dataset.lguBound = '1';
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    activateGuildTab(tabs, btn);
                    renderGuildList(panel);
                    // Состав мог устареть — подтягиваем и дорисовываем.
                    ensureGuild().then(() => {
                        if (!btn.isConnected || !btn.classList.contains('on')) return;
                        renderGuildList(panel);
                    }).catch(() => {});
                });
            }

            // Клик по любой нативной вкладке (nick/fr/find) снимает
            // активность с нашей: игра считает активной только свою.
            for (const tab of tabs.querySelectorAll('.arb-tab:not(#arTab-guild)')) {
                if (tab.dataset.lguWatch) continue;
                tab.dataset.lguWatch = '1';
                tab.addEventListener('click', () => {
                    btn.classList.remove('on');
                    btn.setAttribute('aria-selected', 'false');
                    btn.tabIndex = -1;
                });
            }
        };

        // ------------------------------------------------------------
        // Снимок GET /api/arena
        // ------------------------------------------------------------
        const applyState = (data) => {
            if (!data || typeof data !== 'object' || data.ok === false) return;
            const duel = data.duel;
            if (!duel || typeof duel !== 'object') return;

            state.duel = duel;
            // mine — очередь командных боёв (site/arena.js, logList), а не
            // состав отряда; храним как есть, отряд берём из duel.me.squad.
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
                injectFoeScreen();
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
            if (!arenaRoot() && !document.querySelector('.ar-mw8.arb')) return;

            const now = Date.now();
            if (!force && (now - lastRun) < RUN_THROTTLE) return;
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
            if (observer || typeof MutationObserver === 'undefined') {
                schedule(true);
                return;
            }

            observer = new MutationObserver(() => {
                // Проход уже запланирован — не сканируем документ на каждой
                // пачке мутаций (в чате/городе их сотни в секунду).
                if (injecting || scheduled) return;
                if (!arenaRoot() && !document.querySelector('.ar-mw8.arb')) return;
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
            scheduled = false;
            pendingForce = false;
            injecting = false;
            lastRun = 0;
            stateBusy = false;
            guildBusy = null;

            state.duel = null;
            state.mine = null;
            state.me = null;
            state.at = 0;
            state.failAt = 0;

            heroCache.clear();
            guildMap = new Map();
            guildRecords = [];
            guildId = null;
            guildAt = 0;
            guildTriedAt = 0;
            inGuild = false;

            // Убираем свои вставки из живого DOM: нативные узлы остаются,
            // наши бейджи и вкладка не должны переживать перезапуск скрипта.
            document.querySelectorAll('.' + WIN_CLS + ', .' + WARN_CLS + ', .' + DOM_IDS.arenaBadgeBox)
                .forEach((el) => el.remove());
            // Классы подсветки живут на нативных слотах арены — снимаем их,
            // чтобы после выключения аддона поле выглядело как в игре.
            document.querySelectorAll('.' + ALLY_CLS).forEach((el) => el.classList.remove(ALLY_CLS));
            document.querySelectorAll('.' + DOM_IDS.arenaGuildList).forEach((el) => el.remove());
            const tab = document.getElementById('arTab-guild');
            if (tab) tab.remove();
        };

        return { init, destroy, onApiResponse };
    })();

    // Для отладки из консоли страницы: window аддона — песочница, поэтому
    // публикуем в page-context через G (unsafeWindow), как main.js.
    try {
        const arenaWin = (typeof G !== 'undefined' && G) ? G : window;
        arenaWin.LegionArena = Arena;
    } catch (e) {}
