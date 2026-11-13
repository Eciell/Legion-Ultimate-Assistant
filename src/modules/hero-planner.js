    // ============================================================
    // 4.1. МОДУЛЬ: ПЛАНИРОВЩИК ГЕРОЯ
    // Вкладки: Билды (заглушка → BuildSim), Заточка (рабочий калькулятор).
    // ============================================================
    const HeroPlanner = {
        // Таблица заточки (05_Mechanics.md). v11.6.5e: это ФОЛБЭК — если игра
        // уже отдала LG_GAME_DATA.enchant, шансы и цены берутся оттуда
        // (см. enchantChance / enchantPricePct / enchantPriceMin ниже).
        // Бонус заточки (ENCHANT_MULTIPLIERS) и цены попыток (ENCHANT_PRICES /
        // ENCHANT_PRICE_MIN) — общие: GAME_DATA в core/constants.js, чтобы не
        // дублировать их с auction.js.
        ENCH: {
            max: 15,
            // v11.6.5e: шансы после ребаланса (было 95/90/80/70/55/42/30/20/12/7/4/2/1/0.5/0).
            // Индекс = текущий уровень: chance[1] — шанс шага +1 -> +2.
            chance: [0, 100, 95, 90, 80, 70, 60, 50, 40, 32, 25, 20, 16, 12, 9, 6],
            slots: ['weapon', 'shield', 'armor', 'helmet', 'trinket']
        },

        // ── Режим «С учётом шансов» (стратегии) ──────────────────
        strategyMode: 'ideal', // 'ideal' | 'expected'
        // 11.6.5f: цель заточки (+N) для правой карточки Split-view.
        // null — не выбрана: берём следующий уровень (enchantTargetLevel).
        // Хранится в абсолютных уровнях (+1…+15); при смене предмета цель
        // не сбрасывается — просто зажимается в допустимый диапазон.
        targetLevel: null,
        userStars: 0,
        userSpheres: 0,
        allocatedStars: {},   // { lv: true }
        allocatedSpheres: {}, // { lv: true }

        // Стоимость ресурсов (из 05_Mechanics.md). v11.6.5e: ребаланс — 100/300.
        // Это фолбэк: живая цена кузнеца читается из enchant.coins
        // (см. baseResourcePrice), поэтому следующие ребалансы цен не ломают расчёт.
        COST_STAR: 100,
        COST_SPHERE: 300,

        // 11.6.2d: id ресурсов заточки в игре (рынок/аукцион, сумка).
        // Найдено в game-src: site/b-shop.js.txt (плитки материалов лавки) —
        // «Счастливая звезда» = enchant_star, «Сфера сохранения» =
        // enchant_sphere. Это те же id, под которыми предметы лежат на ауке,
        // поэтому по ним можно спросить медиану у нашего сервера.
        MATERIAL_IDS: { star: 'enchant_star', sphere: 'enchant_sphere' },
        // Медианы аука меняются медленно, а Планировщик открывают часто:
        // не чаще одного запроса в 5 минут (кэш живёт в памяти модуля).
        MEDIANS_TTL: 5 * 60 * 1000,
        _mediansAt: 0,
        _mediansPending: null,

        // Округление подтверждено живой игрой: и статы, и цена считаются через
        // Math.round. Все вызовы идут сюда — если поведение изменится, правим здесь.
        enchantStat(base, en, statKey) {
            const bonus = GAME_DATA.ENCHANT_MULTIPLIERS[Math.min(15, +en || 0)] || 0;
            // Для xstat-ов (crit, dodge, pierce и т.д.) бонус заточки делится на 4
            // (enchK=0.25 из game-data.js xstats.enchK). См. app.js:1393 enchStatsN.
            const effective = GAME_DATA.XSTAT_KEYS.has(statKey) ? bonus * GAME_DATA.ENCHANT_K : bonus;
            return Math.round(base * (1 + effective / 100));
        },

        // Обратный вычет заточки (когда сервер не отдал stats0): восстанавливаем
        // базу делением на тот же эффективный множитель, что и в enchantStat,
        // иначе для xstat-ов база получалась бы заниженной в 4 раза.
        enchantBase(stat, en, statKey) {
            const bonus = GAME_DATA.ENCHANT_MULTIPLIERS[Math.min(15, +en || 0)] || 0;
            const effective = GAME_DATA.XSTAT_KEYS.has(statKey) ? bonus * GAME_DATA.ENCHANT_K : bonus;
            const divisor = 1 + effective / 100;
            return divisor > 0 ? Math.round(stat / divisor) : stat;
        },

        /**
         * v11.6.5e: ШАНС УСПЕХА заточки, % (без способов, обычная заточка).
         *
         * Источник — живая таблица игры LG_GAME_DATA.enchant.chance, поэтому
         * ребалансы шансов не требуют правок аддона. Если таблицы ещё нет
         * (run-at document-start, урезанная сборка) — локальный фолбэк
         * ENCH.chance из этого объекта.
         *
         * @param {number} level текущий уровень: chance[level] — шанс шага level -> level+1
         * @returns {number} шанс в процентах
         */
        enchantChance(level) {
            const i = Math.min(15, +level || 0);
            const live = liveEnchantChance(i);
            return Number.isFinite(live) ? live : (this.ENCH.chance[i] || 0);
        },

        // v11.6.5e: цена попытки в % от стоимости предмета — из живой таблицы
        // игры (enchant.price), фолбэк — GAME_DATA.ENCHANT_PRICES.
        enchantPricePct(level) {
            return liveEnchantPricePct(level);
        },

        // v11.6.5e: минимум цены попытки, медь — из живой таблицы игры
        // (enchant.priceMin), фолбэк — GAME_DATA.ENCHANT_PRICE_MIN.
        enchantPriceMin() {
            return liveEnchantPriceMin();
        },

        // Стоимость одной попытки заточки с уровня level, медь.
        enchantCost(itemV, level) {
            const pct = this.enchantPricePct(level);
            return Math.max(this.enchantPriceMin(), Math.round(itemV * pct / 100));
        },

        /**
         * 11.6.5f: цель заточки для правой карточки Split-view.
         *
         * Приоритет: выбранный пользователем targetLevel (клик по строке
         * уровня или пресет +4/+7/+10/+15), иначе следующий уровень curEn + 1.
         *
         * Цель ВСЕГДА впереди текущего уровня и не выше ENCH.max: шаги
         * +1…+curEn уже пройдены, и включать их в «Итоговую стоимость» нельзя.
         * Поэтому targetLevel зажимается в [min(cur+1, max), max] — при
         * curEn = 15 остаётся только 15 (стоимость нулевая).
         *
         * @param {number} curEn текущая заточка предмета
         * @returns {number} целевой уровень (1…15)
         */
        enchantTargetLevel(curEn) {
            const max = this.ENCH.max;
            const cur = Math.min(max, Math.max(0, +curEn || 0));
            const min = Math.min(max, cur + 1);
            const t = +this.targetLevel;
            if (!Number.isFinite(t) || t <= 0) return min;
            return Math.min(max, Math.max(min, Math.round(t)));
        },

        /* ---------------------------------------------------------- */
        /* v11.6.3: штраф экипировки (gearPenalty из lib/game-data.js) */
        /* ---------------------------------------------------------- */

        /**
         * Штраф за один предмет «не для класса».
         *
         * Правила игры:
         *  - armor −25%, helmet −10%, shield −15% к основному стату;
         *  - магический фокус (slot === 'shield' && gear === 'cloth') —
         *    вторая рука мага/жреца: проверяется по cloth-ветке, поэтому
         *    для cloth-классов штрафа нет;
         *  - обычный щит разрешён только legionary/paladin (shieldOk).
         *
         * @param {string} role hero.role
         * @param {object} item предмет из /api/me
         * @returns {{pct:number, bad:boolean, focus:boolean, want:string, slot:string}}
         */
        gearPenaltyFor(role, item) {
            const out = { pct: 0, bad: false, focus: false, want: '', slot: '' };
            if (!role || !item) return out;
            const pen = GAME_DATA.GEAR_PEN[item.slot] || 0;
            const want = GAME_DATA.CLASS_GEAR[role] || '';
            const focus = isFocusItem(item);
            out.want = want;
            out.focus = focus;
            out.slot = item.slot;
            if (!pen) return out;

            let bad;
            if (item.slot === 'shield') {
                bad = focus
                    ? (!!want && want !== 'cloth')
                    : !GAME_DATA.CLASS_SHIELD[role];
            } else {
                const g = item.gear || 'any';
                bad = !!want && g !== 'any' && g !== want;
            }
            out.bad = bad;
            out.pct = bad ? pen : 0;
            return out;
        },

        /**
         * Суммарный штраф по списку НАДЕТЫХ предметов с потолком
         * GEAR_PEN_CAP. Возвращает { pct, parts: [{ item, pct }] }.
         */
        gearPenaltyTotal(role, items) {
            const parts = [];
            let pct = 0;
            for (const it of Array.isArray(items) ? items : []) {
                const r = this.gearPenaltyFor(role, it);
                if (!r.bad) continue;
                pct += r.pct;
                parts.push({ item: it, pct: r.pct });
            }
            return { pct: Math.min(GAME_DATA.GEAR_PEN_CAP, pct), parts };
        },

        // Короткая строка-резюме по экипировке. 11.6.5f.1: вкладка «Заточка»
        // больше не рисует отдельную полосу — статус показывается иконкой
        // (gearSummaryIcon) рядом с названием предмета; метод оставлен как
        // текстовый вариант для отладки/других вызовов.
        gearSummaryHtml(role, items) {
            const eff = this.gearPenaltyTotal(role, items);
            if (!eff.parts.length) {
                return '<span style="color:#8ff2a0;">✓ Экипировка подходит классу: штрафа нет.</span>';
            }
            const list = eff.parts
                .map(p => `${Utils.escapeHtml(p.item.name || p.item.slot)} −${p.pct}%`)
                .join(', ');
            return `<span style="color:#ffb3a0;">⚠ Штраф к основному стату: −${eff.pct}%</span> <span style="color:#888;">(${list})</span>`;
        },

        /**
         * 11.6.5f.1: компактный статус экипировки — одна иконка рядом с
         * названием предмета вместо отдельной полосы над таблицей.
         * Полный текст живёт в title (у штрафа — со списком предметов).
         *
         * @param {string} role класс героя
         * @param {Array} items надетые предметы
         * @returns {string} html
         */
        gearSummaryIcon(role, items) {
            const eff = this.gearPenaltyTotal(role, items);
            if (!eff.parts.length) {
                return '<span class="hp-gear-pill ok" title="Экипировка подходит классу: штрафа нет">✓</span>';
            }
            const list = eff.parts
                .map(p => `${p.item.name || p.item.slot} −${p.pct}%`)
                .join(', ');
            const tip = `Штраф к основному стату: −${eff.pct}% (${list})`;
            return `<span class="hp-gear-pill bad" title="${Utils.escapeHtml(tip)}">⚠</span>`;
        },

        // Ожидаемое число попыток (при 0% — Infinity)
        expectedAttempts(level) {
            const p = this.enchantChance(level) / 100;
            return p > 0 ? 1 / p : Infinity;
        },

        /* ---------------------------------------------------------- */
        /* 11.6.2d: динамические цены ресурсов (медиана аукциона)      */
        /* ---------------------------------------------------------- */

        /**
         * Медиана аукциона по ресурсу заточки: 'star' | 'sphere'.
         * 0 — наблюдений за 72 часа / последние 100 цен нет, сервер не ответил
         * или модуль Auction недоступен (урезанная сборка).
         *
         * Auction объявлен в modules/auction.js, а тот в сборке идёт ПОСЛЕ
         * hero-planner.js: обращаемся к нему только из методов (на момент
         * вызова все константы IIFE уже созданы), а try/catch страхует от
         * TDZ, если функцию дёрнут раньше времени.
         *
         * @param {'star'|'sphere'} kind
         * @returns {number}
         */
        resourceMedian(kind) {
            const id = this.MATERIAL_IDS[kind];
            if (!id) return 0;
            try {
                if (typeof Auction === 'undefined' || !Auction) return 0;
                if (typeof Auction.getMedian !== 'function') return 0;
                return Auction.getMedian(id) || 0;
            } catch (e) {
                return 0;
            }
        },

        /**
         * v11.6.5e: базовая цена ресурса заточки у кузнеца, медь.
         *
         * Живой источник — LG_GAME_DATA.enchant.coins.star / .sphere: игра
         * сама сообщает актуальные цены, поэтому ребаланс 100/300 (и любой
         * следующий) подхватывается без правок аддона. Фолбэк — локальные
         * COST_STAR / COST_SPHERE из этого объекта.
         *
         * @param {'star'|'sphere'} kind
         * @returns {number}
         */
        baseResourcePrice(kind) {
            const live = liveEnchant();
            const v = live && live.coins ? +live.coins[kind] : NaN;
            return (Number.isFinite(v) && v > 0)
                ? v
                : (kind === 'star' ? this.COST_STAR : this.COST_SPHERE);
        },

        /**
         * Цена ресурса заточки в меди.
         *
         * Фолбэк (11.6.2d): если медианы аука нет или она нулевая — берём
         * базовую цену кузнеца (baseResourcePrice, живая таблица игры либо
         * COST_STAR / COST_SPHERE). Ноль в стоимость попытки попасть не
         * может, иначе «Суммарно» занижалось бы.
         *
         * @param {'star'|'sphere'} kind
         * @returns {number}
         */
        resourcePrice(kind) {
            return this.resourceMedian(kind) || this.baseResourcePrice(kind);
        },

        /**
         * Подтянуть медианы звёзды и сферы с нашего сервера
         * (GET /market/medians, см. Auction.fetchMarketMedians).
         *
         * Троттлинг: не чаще раза в MEDIANS_TTL; параллельные вызовы
         * переиспользуют один промис (пользователь может щёлкать по табам).
         * Промис НИКОГДА не реджектится — Планировщик обязан рисоваться и на
         * базовых ценах, когда аукцион молчит.
         *
         * @param {boolean} force игнорировать TTL
         * @returns {Promise<void>}
         */
        refreshMaterialMedians(force = false) {
            if (this._mediansPending) return this._mediansPending;
            if (!force && Date.now() - this._mediansAt < this.MEDIANS_TTL) return Promise.resolve();

            const ids = [this.MATERIAL_IDS.star, this.MATERIAL_IDS.sphere];
            const run = (async () => {
                try {
                    if (typeof Auction === 'undefined' || !Auction) return;
                    if (typeof Auction.fetchMarketMedians !== 'function') return;
                    await Auction.fetchMarketMedians(ids);
                    // Отметку ставим только после успешного ответа: при ошибке
                    // следующий вход в Планировщик повторит запрос.
                    this._mediansAt = Date.now();
                } catch (e) {
                    dbg('[HERO PLANNER] Медианы ресурсов недоступны:', e);
                }
            })();

            // Признак «запрос в полёте» снимаем в микрозадаче, а не в finally:
            // тело могло завершиться СИНХРОННО (например, модуль Auction не
            // подключён), и finally успел бы обнулить поле раньше, чем оно
            // получит ссылку на промис — он залип бы навсегда.
            this._mediansPending = run;
            const clear = () => { this._mediansPending = null; };
            run.then(clear, clear);
            return run;
        },

        /**
         * Бейдж источника цены ресурса для UI:
         *   📈 — цена взята с аукциона (медиана сети за 72 часа / последние 100 цен);
         *   🏪 — базовая цена кузнеца (аукцион не ответил / нет наблюдений).
         * В title — сумма и пояснение, поэтому бейдж работает как тултип.
         *
         * @param {'star'|'sphere'} kind
         * @returns {string} html
         */
        priceBadge(kind) {
            const net = this.resourceMedian(kind);
            if (net > 0) {
                return `<span title="Цена взята с аукциона (медиана сети за 72 часа / последние 100 цен): ${Utils.formatMoney(net)}" style="cursor:help;">`
                    + `📈 <b style="color:#7ad1ff;">${Utils.formatMoney(net)}</b></span>`;
            }
            const base = this.baseResourcePrice(kind);
            return `<span title="Базовые цены (аукцион не отвечает): цена кузнеца ${Utils.formatMoney(base)}" style="cursor:help; color:#999;">`
                + `🏪 ${Utils.formatMoney(base)}</span>`;
        },

        /**
         * Строка цен ресурсов для вкладки «Заточка» (обновляется в renderTable,
         * когда медианы аука пришли с сервера).
         *
         * @returns {string} html
         */
        matsPriceHtml() {
            return `<span>⭐ Счастливая звезда: ${this.priceBadge('star')}</span>`
                + `<span>🌐 Сфера сохранения: ${this.priceBadge('sphere')}</span>`;
        },

        init() {
            (document.getElementById(DOM_IDS.btnBuildSim) || document.getElementById('btn-build-sim'))
                ?.addEventListener('click', () => this.open());
        },

        /* ---------------------------------------------------------- */
        /* 11.6.5c: СПОСОБНОСТИ АРЕНЫ (GET /api/abtokens)             */
        /* ---------------------------------------------------------- */

        // Категории прокачки ветки — ровно те же ключи, что в up/next/nodes
        // ответа /api/abtokens (см. docs/API.md).
        ARENA_KINDS: [
            ['lv', 'Ступень'],
            ['pow', 'Мощь'],
            ['eff', 'Мастерство'],
            ['dur', 'Размах']
        ],
        // 11.6.5c.2: прогрессивная цена прокачки (шкала из отчёта Antigravity).
        // Индекс = текущий уровень: ARENA_COST[kind][v] — цена ШАГА с v на v+1.
        // lv: 1/3/7/15/25 за 1..5-ю ступень; pow/eff/dur: 2/5/10 за 1..3-й узел
        // (в up они начинаются с нуля, поэтому индекс совпадает с up[kind]).
        ARENA_COST: {
            lv: [1, 3, 7, 15, 25],
            pow: [2, 5, 10],
            eff: [2, 5, 10],
            dur: [2, 5, 10]
        },
        // 11.6.5c.7: все классы игры (id + русское имя из lib/game-data.js).
        // id — те же, что hero.role и параметр ?cls= у /api/abtokens.
        ARENA_CLASSES: [
            ['legionary', 'Легионер'],
            ['archer', 'Лучник'],
            ['mage', 'Маг'],
            ['priest', 'Жрец'],
            ['rogue', 'Разбойник'],
            ['necromancer', 'Некромант'],
            ['paladin', 'Паладин']
        ],
        // arenaData — последний ответ /api/abtokens (null = ещё не грузили).
        // arenaSim — ЛОКАЛЬНЫЙ план прокачки (11.6.5c.3): АБСОЛЮТНЫЕ уровни
        // каждой категории по слоту, 0 = «пусто», arenaMax(kind) = потолок.
        // В отличие от старой дельты план не зависит от купленного в игре:
        // его можно поставить и ниже текущего состояния (разницу показывает
        // подпись «в игре: N»). Жетоны не тратятся — расходует только игра.
        arenaData: null,
        arenaSim: null,
        arenaCls: '',
        arenaBusy: false,
        arenaLoading: false,
        arenaError: '',

        /** Пустой план: все абсолютные уровни = 0 (загрузка данных и кнопка «Очистить»). */
        emptyArenaSim() {
            return { ab: { lv: 0, pow: 0, eff: 0, dur: 0 }, ult: { lv: 0, pow: 0, eff: 0, dur: 0 } };
        },

        /**
         * 11.6.5c.7: кнопки выбора класса для вкладки «Арена».
         * Активный класс подсвечен (класс .active), класс героя помечен ★ —
         * чтобы после экспериментов было видно, куда вернуться. Сами клики
         * вешает bindArenaClassTabs().
         */
        arenaClassTabsHtml() {
            const cur = this.arenaCls || '';
            const own = (G.ME && G.ME.hero && (G.ME.hero.role || G.ME.hero.class)) || '';
            const btns = this.ARENA_CLASSES.map(([id, name]) => {
                const act = id === cur;
                const mine = !!own && id === own;
                return `<button type="button" class="arena-class-btn${act ? ' active' : ''}"`
                    + ` data-cls="${Utils.escapeHtml(id)}"`
                    + ` title="${mine ? 'Класс твоего героя' : 'Посмотреть способности класса'}"`
                    + `${this.arenaLoading ? ' disabled' : ''}>`
                    + `${Utils.escapeHtml(name)}${mine ? ' ★' : ''}</button>`;
            }).join('');
            return `<div class="arena-class-tabs">${btns}</div>`;
        },

        /**
         * Клик по классу: грузим его дерево заново (GET /api/abtokens?cls=…).
         * План сбрасывается внутри loadArenaData: у классов разные ветки/up.
         */
        bindArenaClassTabs(box) {
            box.querySelectorAll('[data-cls]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const cls = btn.dataset.cls;
                    if (!cls || cls === this.arenaCls || this.arenaLoading) return;
                    this.loadArenaData(cls);
                });
            });
        },

        /**
         * id выбранной ветки. Сервер отдаёт активную ветку в поле br; если
         * его нет (или ветка исчезла из списка) — берём первую ветку класса.
         */
        arenaBranchId() {
            const d = this.arenaData;
            if (!d || !Array.isArray(d.branches) || !d.branches.length) return '';
            const cur = d.br || d.sel || '';
            return d.branches.some(b => b.id === cur) ? cur : d.branches[0].id;
        },

        arenaBranch() {
            const id = this.arenaBranchId();
            return (this.arenaData?.branches || []).find(b => b.id === id) || null;
        },

        /** Серверное значение категории у слота 'ab' | 'ult'. */
        arenaUp(slot, kind) {
            const s = this.arenaBranch()?.[slot];
            return s && s.up ? (+s.up[kind] || 0) : 0;
        },

        /** Потолок категории из arenaData.max; 0 — сервер лимит не сообщил. */
        arenaMax(kind) {
            const m = this.arenaData && this.arenaData.max;
            const v = m ? +m[kind] : NaN;
            return Number.isFinite(v) && v > 0 ? v : 0;
        },

        /** Абсолютный уровень из плана, но не выше потолка ступени. */
        arenaSimValue(slot, kind) {
            const val = (this.arenaSim?.[slot]?.[kind]) | 0;
            const cap = this.arenaMax(kind);
            return cap > 0 ? Math.min(val, cap) : val;
        },

        /**
         * Сумма абсолютных уровней плана (не жетонов!). 0 — пустой план;
         * нужно для доступности кнопки «Очистить»; деньги считает getPlanCost().
         */
        arenaSimTotal() {
            let sum = 0;
            for (const slot of ['ab', 'ult']) {
                for (const [kind] of this.ARENA_KINDS) {
                    sum += (this.arenaSim?.[slot]?.[kind]) | 0;
                }
            }
            return sum;
        },

        /** Цена одного шага с уровня v на v+1 (0 — дальше качать нельзя). */
        arenaStepCost(kind, v) {
            const prices = this.ARENA_COST[kind] || [];
            return prices[v] || 0;
        },

        /**
         * Полная стоимость плана в жетонах по шкале ARENA_COST: путь
         * «0 → arenaSim[kind]». slot не задан — сумма по обоим слотам.
         *
         * План абсолютный, поэтому уже купленные в игре уровни сюда тоже
         * попадают (это стоимость «с нуля»), а вложенное в игре вычитается
         * отдельно в сводке через s.paid — иначе двойного счёта не избежать.
         *   arenaSim.lv = 2 -> цена 1-й и 2-й ступени = 1 + 3 = 4.
         */
        getPlanCost(slot) {
            const slots = slot ? [slot] : ['ab', 'ult'];
            let total = 0;
            for (const sl of slots) {
                for (const [kind] of this.ARENA_KINDS) {
                    const cap = this.arenaMax(kind);
                    const raw = (this.arenaSim?.[sl]?.[kind]) | 0;
                    const to = cap > 0 ? Math.min(raw, cap) : raw;
                    for (let v = 0; v < to; v++) {
                        total += this.arenaStepCost(kind, v);
                    }
                }
            }
            return total;
        },

        /** Сколько жетонов уже вложено в игре по активной ветке (ab + ult). */
        arenaPaidTotal() {
            const b = this.arenaBranch();
            if (!b) return 0;
            return (+b.ab?.paid || 0) + (+b.ult?.paid || 0);
        },

        /**
         * «Как у меня сейчас»: план = текущие уровни персонажа (s.up), то есть
         * «ничего не докупаем». Копируем в emptyArenaSim(), чтобы не потерять
         * ключи категорий, если сервер добавит новые.
         */
        takeArenaFromGame() {
            const b = this.arenaBranch();
            const sim = this.emptyArenaSim();
            if (b) {
                for (const slot of ['ab', 'ult']) {
                    for (const [kind] of this.ARENA_KINDS) {
                        sim[slot][kind] = Math.max(0, (+b[slot]?.up?.[kind] || 0));
                    }
                }
            }
            this.arenaSim = sim;
        },

        /**
         * Загрузка дерева способностей арены для класса cls.
         * cls приходит из селектора классов (11.6.5c.7) или из open();
         * без аргумента берём текущий класс вкладки, затем класс героя.
         * Ответ кладём в this.arenaData, план обнуляем: у веток разные up/next,
         * поэтому старые абсолютные уровни к новой ветке не подходят.
         */
        async loadArenaData(cls) {
            if (this.arenaLoading) return;
            const target = cls || this.arenaCls || (G.ME && G.ME.hero && G.ME.hero.role) || '';
            const box = document.getElementById('tab-hero-arena');

            if (!target) {
                this.arenaData = null;
                this.arenaError = 'Класс героя неизвестен';
                this.renderArenaTab();
                return;
            }

            this.arenaCls = target;
            this.arenaLoading = true;
            this.arenaError = '';
            if (box) box.innerHTML = '<div class="hp-arena-loading">Загрузка способностей арены…</div>';

            try {
                const res = await Utils.fetchApi('/api/abtokens?cls=' + encodeURIComponent(target));
                // fetchApi кладёт ответ и в body, и в корень результата —
                // берём тот вариант, где реально лежит список веток.
                const d = (res && Array.isArray(res.branches)) ? res : (res && res.body) || null;
                if (!d || d.ok === false || !Array.isArray(d.branches) || !d.branches.length) {
                    throw new Error((d && d.error) || (res && res.error) || 'способности арены не загрузились');
                }
                this.arenaData = d;
                if (d.cls) this.arenaCls = d.cls;
                this.arenaSim = this.emptyArenaSim();
            } catch (err) {
                dbg('[HERO PLANNER] abtokens:', err);
                this.arenaData = null;
                this.arenaSim = null;
                this.arenaError = err.message || 'не загрузилось';
            } finally {
                this.arenaLoading = false;
            }

            this.renderArenaTab();
        },

        /**
         * Полная перерисовка вкладки «Арена»: шапка, ветки, два слота,
         * панель плана и подвал. Вызывается после загрузки данных, кликов
         * «+»/«−», кнопок «Как у меня сейчас»/«Очистить», импорта и выбора ветки.
         */
        renderArenaTab() {
            const box = document.getElementById('tab-hero-arena');
            if (!box) return; // вкладка ещё не смонтирована — рисовать некуда

            if (!this.arenaData) {
                if (this.arenaError) {
                    // Селектор классов оставляем и в ошибке: если один класс
                    // не загрузился, можно сразу переключиться на другой.
                    box.innerHTML = this.arenaClassTabsHtml()
                        + `<div class="hp-arena-empty">⚠ ${Utils.escapeHtml(this.arenaError)}`
                        + '<button type="button" class="hp-arena-btn" data-arena="reload">↻ Повторить</button></div>';
                    box.querySelector('[data-arena="reload"]')?.addEventListener('click', () => {
                        this.loadArenaData(this.arenaCls);
                    });
                    this.bindArenaClassTabs(box);
                } else {
                    box.innerHTML = '<div class="hp-arena-loading">Загрузка…</div>';
                }
                return;
            }

            const d = this.arenaData;
            const n = +d.n || 0;
            const week = +d.week || 0;
            const cap = +d.cap || 0;
            const wkPct = cap > 0 ? Math.max(0, Math.min(100, week / cap * 100)) : 0;
            const branch = this.arenaBranch();
            const simTotal = this.arenaSimTotal();  // сумма уровней плана (для «Очистить»)
            const planCost = this.getPlanCost();    // стоимость плана в жетонах

            // ── Шапка: баланс жетонов навыков + прогресс недели ──
            const headerHtml = `
                <div class="hp-arena-header">
                    <span class="hp-token-badge" title="Жетоны навыков (skillToken)">
                        🎫 <b>${n}</b> <small>жетонов</small>
                    </span>
                    <span class="hp-arena-week">
                        <small>За неделю: ${week} / ${cap}</small>
                        <span class="hp-week-bar"><i style="width:${wkPct.toFixed(1)}%"></i></span>
                    </span>
                    ${+d.spent > 0 ? `<span class="hp-arena-spent">Вложено в класс: <b>${+d.spent}</b></span>` : ''}
                    ${+d.lvl > 0 ? `<span class="hp-arena-spent">Уровень героя: <b>${+d.lvl}</b></span>` : ''}
                </div>`;

            // ── Ветки класса: активная подсвечена, клик делает ветку активной ──
            const line = (s, turn) => `<span class="hp-branch-line"><small>${turn}</small>`
                + `${Utils.escapeHtml(s.name || '—')}${+s.up?.lv > 1 ? ` <i>ст. ${+s.up.lv}</i>` : ''}</span>`;
            const branchesHtml = (d.branches || []).map(b => {
                const act = b.id === this.arenaBranchId();
                return `
                    <button type="button" class="hp-arena-branch-card${act ? ' active' : ''}"
                        data-branch="${Utils.escapeHtml(b.id)}"${this.arenaBusy ? ' disabled' : ''}>
                        <span class="hp-branch-ic">${Utils.escapeHtml(b.ab?.icon || '⚔')}</span>
                        <span class="hp-branch-lines">
                            ${line(b.ab || {}, '3-й ход')}
                            ${line(b.ult || {}, '5-й ход')}
                        </span>
                        ${act ? '<em class="hp-branch-active">активная</em>' : ''}
                    </button>`;
            }).join('');

            // ── Слот способности (ab, 3-й ход) и ульты (ult, 5-й ход) ──
            const slotHtml = (slot) => {
                const s = branch ? branch[slot] : null;
                if (!s) return '';
                const isUlt = slot === 'ult';
                // 11.6.5c.4: бонусы способности — массив строк s.lines
                // (напр. «Урон: 140%», «Кровотечение: 25%»), см. клиент игры
                // site/skills.js: `S.lines.join(', ')`. Формул масштабирования
                // API не отдаёт, поэтому показываем базовые цифры как есть.
                const bonusLines = (Array.isArray(s.lines) ? s.lines : [])
                    .map(x => String(x == null ? '' : x).trim())
                    .filter(Boolean);
                const bonusesHtml = bonusLines.length
                    ? `<div class="hp-ab-bonuses">${bonusLines
                        .map(x => `<span class="hp-ab-bonus">${Utils.escapeHtml(x)}</span>`)
                        .join('')}</div>`
                    : '';
                const rowsHtml = this.ARENA_KINDS.map(([kind, label]) => {
                    // plan — абсолютный уровень плана (arenaSim), base — куплено
                    // в игре (s.up), cur — план с обрезкой по потолку ступени.
                    const base = this.arenaUp(slot, kind);
                    const plan = (this.arenaSim?.[slot]?.[kind]) | 0;
                    const cur = this.arenaSimValue(slot, kind);
                    const capK = this.arenaMax(kind);
                    const nextPrice = s.next ? s.next[kind] : undefined;
                    // next[kind] === null — сервер сообщает, что ступень максимальная.
                    const topByServer = !!s.next && (kind in s.next) && nextPrice == null;
                    // Песочница (11.6.5c.6): единственное ограничение «+» — кап
                    // ступени. Закрытую способность тоже можно планировать:
                    // визуальной блокировки (класс shut и плашка «Откроется на
                    // N уровне») больше нет, обе карточки выглядят одинаково.
                    // Кошелёк (arenaData.n) кнопку НЕ блокирует: дефицит жетонов
                    // показываем отдельной сводкой плана.
                    const full = capK > 0 ? cur >= capK : (topByServer && cur >= base);
                    const plusDisabled = this.arenaBusy || full;
                    // «−» уменьшает абсолютный уровень плана вплоть до нуля:
                    // план может быть и ниже текущего состояния персонажа.
                    const minusDisabled = this.arenaBusy || cur <= 0;
                    // Пипсы (11.6.5c.8): золотые — уровни плана (arenaSim),
                    // синие — то, что уже куплено в игре (s.up), остальные пустые.
                    const pips = capK > 0
                        ? `<span class="hp-ab-pips">${Array.from({ length: capK }, (_, i) => {
                            const cls = i < plan ? 'on' : (i < base ? 'sim' : '');
                            return `<i${cls ? ` class="${cls}"` : ''}></i>`;
                        }).join('')}</span>`
                        : '<span class="hp-ab-pips"></span>';
                    const hint = topByServer ? 'максимум'
                        : (nextPrice != null ? `след. уровень: ${nextPrice} 🎫` : '');
                    // 11.6.5c.8: в блоке счёта показываем отличие плана от
                    // текущего состояния. Никакого парсинга текста/процентов —
                    // только цифры уровней из arenaSim и s.up.
                    const delta = plan - base;
                    const valNote = delta > 0
                        ? ` <small>(в игре: ${base}, +${delta} в плане)</small>`
                        : (delta < 0 ? ` <small>(в игре: ${base}, ${delta})</small>` : '');
                    // Описание категории выводим как есть, без вычислений.
                    const desc = s.nodes?.[kind] || '';
                    return `
                        <div class="hp-ab-row">
                            <span class="hp-ab-name">${label}</span>
                            ${pips}
                            <span class="hp-ab-val"><b>${cur}</b>${capK > 0 ? `/${capK}` : ''}${valNote}</span>
                            <button type="button" class="hp-ab-btn minus" data-slot="${slot}" data-kind="${kind}" data-dir="minus"
                                title="Убрать ступень из плана"${minusDisabled ? ' disabled' : ''}>−</button>
                            <button type="button" class="hp-ab-btn" data-slot="${slot}" data-kind="${kind}" data-dir="plus"
                                title="${Utils.escapeHtml(hint)}"${plusDisabled ? ' disabled' : ''}>+</button>
                            <span class="hp-ab-desc">в игре: ${base}</span>
                            ${desc ? `<span class="hp-ab-desc">${Utils.escapeHtml(desc)}</span>` : ''}
                        </div>`;
                }).join('');

                // Подвал карточки: только стоимость плана этого слота.
                // Проценты и знаменатель s.total убраны (11.6.5c.5): полная
                // картина и так в нижней панели вкладки.
                const slotCost = this.getPlanCost(slot);

                return `
                    <div class="hp-arena-card${isUlt ? ' ult' : ''}">
                        <div class="hp-arena-card-head">
                            <span class="hp-arena-card-ic">${Utils.escapeHtml(s.icon || (isUlt ? '★' : '◆'))}</span>
                            <span class="hp-arena-card-title">
                                <b>${Utils.escapeHtml(s.name || '—')}</b>
                                <small>${isUlt ? 'Ульта · каждый 5-й ход' : 'Способность · каждый 3-й ход'}</small>
                            </span>
                        </div>
                        <p class="hp-slot-text">${Utils.escapeHtml(s.text || '')}</p>
                        ${bonusesHtml}
                        <div class="hp-ab-rows">${rowsHtml}</div>
                        <div class="hp-card-foot">В плане: <b>${slotCost}</b> жетонов</div>
                    </div>`;
            };

            const slotsHtml = branch
                ? `<div class="hp-arena-slots">${slotHtml('ab')}${slotHtml('ult')}</div>`
                : '<div class="hp-arena-empty">Ветки способностей недоступны.</div>';

            // 11.6.5c.4: нижняя панель — ровно четыре цифры и дефицит.
            //   planCost  — X, полная стоимость плана от нуля (getPlanCost),
            //   paidTotal — Y, уже вложено в игре (s.paid по ab + ult),
            //   need      — Z = max(0, X − Y), сколько жетонов ещё нужно,
            //   missing   — Z − n, сколько не хватает из кошелька.
            // Дефицит НЕ блокирует кнопки (песочница): это подсказка «сколько фармить».
            const paidTotal = this.arenaPaidTotal();
            const need = Math.max(0, planCost - paidTotal);
            const missing = need - n;
            const summaryHtml = `
                <div class="arena-plan-summary">
                    <span>В наличии: <b>${n}</b> жетонов</span>
                    <span>В плане (всего): <b>${planCost}</b> жетонов</span>
                    <span>Уже вложено в игре: <b>${paidTotal}</b></span>
                    <span>Доплатить: <b>${need}</b></span>
                    ${need > n
                        ? `<span class="arena-deficit">Не хватает <b>${missing}</b> жетонов</span>`
                        : '<span class="arena-ready">Хватает жетонов!</span>'}
                </div>`;

            const actionHtml = `
                <div class="hp-arena-sim-bar">
                    <button type="button" class="hp-arena-btn" data-arena="take"${this.arenaBusy ? ' disabled' : ''}>Как у меня сейчас</button>
                    <button type="button" class="hp-arena-btn" data-arena="clear"${(simTotal > 0 && !this.arenaBusy) ? '' : ' disabled'}>✕ Очистить</button>
                    <button type="button" class="hp-arena-btn" data-arena="export"${this.arenaBusy ? ' disabled' : ''}>📤 Поделиться</button>
                    <button type="button" class="hp-arena-btn" data-arena="import"${this.arenaBusy ? ' disabled' : ''}>📥 Импорт</button>
                    ${this.arenaBusy ? '<span class="hp-arena-spent">⏳ выполняется…</span>' : ''}
                </div>
                ${summaryHtml}`;

            // Источники жетонов — те же цифры, что показывает сама игра (src/dayCap).
            const src = d.src || {};
            const dayCap = d.dayCap || {};
            const footHtml = '<div class="hp-card-foot">Откуда жетоны: задания дня '
                + `<b>+${+src.dailyAll || 0}</b>, задание эфира <b>+${+src.dailyAir || 0}</b>, `
                + `бой похода <b>+${+src.quest || 0}</b> (босс <b>+${+src.questBoss || 0}</b>`
                + `${dayCap.quest ? `, за день до ${+dayCap.quest}` : ''}), вылазка гильдии `
                + `<b>+${+src.guildrun || 0}</b>${dayCap.guildrun ? ` (за день до ${+dayCap.guildrun})` : ''}, `
                + `рейд гильдии <b>+${+src.raid || 0}</b>. За неделю — не больше <b>${cap}</b>.</div>`;

            box.innerHTML = `
                <div class="hp-arena-wrap">
                    ${headerHtml}
                    ${this.arenaClassTabsHtml()}
                    <div class="hp-arena-branches">${branchesHtml}</div>
                    ${slotsHtml}
                    ${actionHtml}
                    ${footHtml}
                </div>`;

            // 11.6.5c.7: выбор класса — перезагрузка дерева через ?cls=.
            this.bindArenaClassTabs(box);

            // Выбор ветки: чисто локальный переключатель (сеть не дёргаем).
            box.querySelectorAll('[data-branch]').forEach(btn => {
                btn.addEventListener('click', () => this.pickArenaBranch(btn.dataset.branch));
            });

            // «+» / «−» — локальная песочница с АБСОЛЮТНЫМИ уровнями плана:
            // кошелёк кнопки не блокирует, «+» ограничен только капом ступени,
            // «−» опускает план вплоть до нуля.
            box.querySelectorAll('.hp-ab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const slot = btn.dataset.slot;
                    const kind = btn.dataset.kind;
                    if (!this.arenaSim || !this.arenaSim[slot]) return;
                    const cur = this.arenaSimValue(slot, kind);
                    if (btn.dataset.dir === 'minus') {
                        if (cur <= 0) return;
                        this.arenaSim[slot][kind] = cur - 1;
                    } else {
                        const capK = this.arenaMax(kind);
                        if (capK > 0 && cur >= capK) return;
                        this.arenaSim[slot][kind] = cur + 1;
                    }
                    this.renderArenaTab();
                });
            });

            // «Как у меня сейчас»: план = текущие уровни персонажа (s.up).
            box.querySelector('[data-arena="take"]')?.addEventListener('click', () => {
                this.takeArenaFromGame();
                this.renderArenaTab();
            });

            // «✕ Очистить»: пустой план (все уровни = 0).
            box.querySelector('[data-arena="clear"]')?.addEventListener('click', () => {
                this.arenaSim = this.emptyArenaSim();
                this.renderArenaTab();
            });

            box.querySelector('[data-arena="export"]')?.addEventListener('click', () => this.exportArenaBuild());
            box.querySelector('[data-arena="import"]')?.addEventListener('click', () => {
                const code = window.prompt('Вставьте код билда арены (LGA1:…):', '');
                if (code) this.importArenaBuild(code);
            });
        },

        /**
         * Выбор активной ветки — чисто локальный переключатель (11.6.5c.3).
         * Сетевой POST /api/abtokens/act убран: планировщик не должен дёргать
         * игру ради предпросмотра. Все ветки класса уже пришли в одном ответе
         * /api/abtokens, поэтому достаточно поправить br; план обнуляем —
         * у веток разные up/next, старые абсолютные уровни к ним не подходят.
         */
        pickArenaBranch(br) {
            const d = this.arenaData;
            if (!d || !br || br === this.arenaBranchId()) return;
            d.br = br;
            this.arenaSim = this.emptyArenaSim();
            this.renderArenaTab();
        },

        /**
         * «📤 Поделиться»: собирает код плана
         *   LGA1:<cls>:<br>:<ab.lv,pow,eff,dur>:<ult.lv,pow,eff,dur>
         * Числа — АБСОЛЮТНЫЕ уровни плана (arenaSim, 0 = «пусто»), поэтому
         * получатель видит ровно собранный план, а не дельту от своего героя.
         */
        exportArenaBuild() {
            const d = this.arenaData;
            if (!d) { UI.showToast('Арена ещё не загружена', true); return ''; }
            const br = this.arenaBranchId();
            if (!br) { UI.showToast('Ветки способностей недоступны', true); return ''; }
            const pack = (slot) => this.ARENA_KINDS.map(([kind]) => this.arenaSimValue(slot, kind)).join(',');
            const code = `LGA1:${d.cls || this.arenaCls}:${br}:${pack('ab')}:${pack('ult')}`;
            this.copyArenaCode(code);
            return code;
        },

        /**
         * Копирование кода плана: GM_setClipboard -> Clipboard API -> prompt.
         * GM_setClipboard синхронный и не требует secure context, поэтому он
         * первый; остальные пути — запасные для других менеджеров/браузеров.
         */
        copyArenaCode(code) {
            const value = String(code || '');
            const manual = () => window.prompt('Скопируйте код билда арены:', value);
            try {
                if (typeof GM_setClipboard === 'function') {
                    GM_setClipboard(value);
                    UI.showToast('📋 Код билда скопирован в буфер');
                    return;
                }
            } catch (err) { dbg('[HERO PLANNER] GM_setClipboard:', err); }
            try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    navigator.clipboard.writeText(value)
                        .then(() => UI.showToast('📋 Код билда скопирован в буфер'), manual);
                    return;
                }
            } catch (err) { dbg('[HERO PLANNER] clipboard:', err); }
            manual();
        },

        /**
         * «📥 Импорт»: разбирает LGA1-код и раскладывает АБСОЛЮТНЫЕ уровни
         * прямо в arenaSim (0 = «пусто»). Потолок ступени применяем, чтобы
         * план не показывал недостижимые значения: выше сервер не пустит.
         */
        importArenaBuild(code) {
            const d = this.arenaData;
            if (!d) { UI.showToast('Арена ещё не загружена', true); return false; }

            const raw = String(code == null ? '' : code).trim();
            const m = /^LGA1:([A-Za-z0-9_]+):([A-Za-z0-9_-]+):((?:\d+,){3}\d+):((?:\d+,){3}\d+)$/.exec(raw);
            if (!m) { UI.showToast('❌ Неверный формат кода билда', true); return false; }

            const cls = m[1], br = m[2];
            const own = d.cls || this.arenaCls;
            if (own && cls !== own) {
                UI.showToast(`Код для класса «${cls}», а у героя «${own}»`, true);
                return false;
            }
            // Ветку не навязываем: категории у всех веток одинаковые, поэтому
            // план можно примерить и к другой — но спросим, чтобы не удивить.
            if (br !== this.arenaBranchId()
                && !window.confirm(`Код собран для ветки «${br}», активна «${this.arenaBranchId()}». Применить к активной?`)) {
                return false;
            }

            const want = { ab: m[3].split(',').map(Number), ult: m[4].split(',').map(Number) };
            const sim = this.emptyArenaSim();
            for (const slot of ['ab', 'ult']) {
                this.ARENA_KINDS.forEach(([kind], i) => {
                    const cap = this.arenaMax(kind);
                    // Цель ограничиваем потолком ступени: сервер выше не пустит.
                    const rawVal = Math.max(0, want[slot][i] | 0);
                    sim[slot][kind] = cap > 0 ? Math.min(rawVal, cap) : rawVal;
                });
            }
            this.arenaSim = sim;
            this.renderArenaTab();

            // Стоимость плана — полная, от нуля до абсолютных уровней плана.
            const need = this.getPlanCost();
            UI.showToast(need > 0
                ? `📥 Билд импортирован: в плане ${need} жетонов`
                : '📥 Билд импортирован: план пустой');
            return true;
        },

        async open() {
            UI.showModal(`<h2>⚙️ Планировщик Героя <button class="custom-close" id="custom-close-btn">✖</button></h2><div class="loader">Загрузка данных...</div>`);
            try {
                const me = await Utils.fetchApi('/api/me');
                if (!me || !me.ok || !me.hero) throw new Error('Нет героя');
                const h = me.hero;

                // 11.6.5c: состояние вкладки «Арена» сбрасываем на каждое открытие
                // окна — класс/ветка могли смениться, а запрос ещё не сделан.
                this.arenaCls = h.role || h.class || h.c || h.sk?.c || this.arenaCls || '';
                this.arenaData = null;
                this.arenaSim = null;
                this.arenaError = '';

                // Предметы для заточки. uid сервер отдаёт не всегда: без него все
                // карточки получили бы одинаковый ключ, поэтому отсутствующий uid
                // заменяем синтетическим (с префиксом локации).
                const mapItems = (arr, prefix) => (arr || [])
                    .filter(it => it && it.slot && this.ENCH.slots.includes(it.slot) && it.v > 0)
                    .map((it, idx) => (it.uid != null && it.uid !== '') ? it : { ...it, uid: `${prefix}-${idx}` });

                const equipped = mapItems(h.items?.filter(x => x.on), 'eq');
                const bag = mapItems(h.items?.filter(x => !x.on), 'bg');
                const storage = mapItems(h.sg?.store, 'st');

                const locations = {
                    equipped: { name: '🛡️ Надето', items: equipped },
                    bag: { name: '🎒 Сумка', items: bag },
                    storage: { name: '📦 Склад', items: storage }
                };

                let currentLocKey = 'equipped';
                let selectedItem = locations[currentLocKey].items[0] || null;

                // 11.6.5f.1: статус экипировки — маленькая иконка в шапке
                // выбранного предмета (раньше была отдельная полоса сверху).
                const gearIconHtml = this.gearSummaryIcon(h.role, equipped);

                const tabsHtml = `
                    <button class="modal-tab active" data-tab="hero-build">🛡️ Билды</button>
                    <button class="modal-tab" data-tab="hero-ench">⚒️ Заточка</button>
                    <button class="modal-tab" data-tab="hero-arena">⚔️ Арена</button>
                `;

                // .tab-content.active — это display:flex (строка), поэтому обеим
                // вкладкам задаём колонку: табы и плитка сверху, таблица снизу.
                const contentHtml = `
                    <div class="tab-content active" id="tab-hero-build" style="flex-direction:column; gap:0;">
                        <div id="hp-buildsim-container" style="display:flex; flex-direction:column; flex:1; min-height:0; overflow:auto; padding-bottom:20px;"></div>
                    </div>
                    <div class="tab-content" id="tab-hero-ench" style="flex-direction:column; gap:8px;">
                        <!-- 11.6.5f.1: строка 1 — режимы, инпуты ресурсов (только в
                             режиме шансов) и цены ресурсов в одной полосе. -->
                        <div class="hp-ench-topbar">
                            <div class="hp-mode-switch">
                                <button class="hp-mode-btn ${this.strategyMode === 'ideal' ? 'active' : ''}" data-mode="ideal" style="border:none; border-radius:5px; font-weight:bold; cursor:pointer; transition:all 0.2s; background:${this.strategyMode === 'ideal' ? '#caa55c' : 'transparent'}; color:${this.strategyMode === 'ideal' ? '#1d1620' : '#aaa'};">📊 Идеально</button>
                                <button class="hp-mode-btn ${this.strategyMode === 'expected' ? 'active' : ''}" data-mode="expected" style="border:none; border-radius:5px; font-weight:bold; cursor:pointer; transition:all 0.2s; background:${this.strategyMode === 'expected' ? '#caa55c' : 'transparent'}; color:${this.strategyMode === 'expected' ? '#1d1620' : '#aaa'};">🧠 С учётом шансов</button>
                            </div>
                            <div id="hp-resources-panel" class="hp-mat-inputs" style="display:${this.strategyMode === 'expected' ? 'flex' : 'none'};">
                                <label>⭐ Звёзды: <input type="number" id="hp-input-stars" min="0" max="15" value="${this.userStars}"></label>
                                <label>🌐 Сферы: <input type="number" id="hp-input-spheres" min="0" max="15" value="${this.userSpheres}"></label>
                            </div>
                            <!-- 11.6.2d: цены ресурсов. 📈 — медиана аука (за 72 часа /
                                 последние 100 цен), 🏪 — цена кузнеца (фолбэк).
                                 Содержимое обновляет renderTable после ответа сервера. -->
                            <div id="hp-mats-price" class="hp-mat-prices">${this.matsPriceHtml()}</div>
                        </div>

                        <!-- 11.6.5f.1: строка 2 — локации и плитка предметов рядом.
                             Статус экипировки (бывшая полоса «✓ Снаряжение подходит»)
                             теперь иконка рядом с названием предмета — см. renderTable. -->
                        <div class="hp-ench-subbar">
                            <div class="hp-loc-tabs">
                                <button class="hp-loc-btn active" data-loc="equipped" style="background:#caa55c; color:#1d1620; border:none; font-weight:bold; cursor:pointer;">🛡️ Надето</button>
                                <button class="hp-loc-btn" data-loc="bag" style="background:#2a2030; color:#aaa; border:1px solid #44374a; font-weight:bold; cursor:pointer;">🎒 Сумка</button>
                                <button class="hp-loc-btn" data-loc="storage" style="background:#2a2030; color:#aaa; border:1px solid #44374a; font-weight:bold; cursor:pointer;">📦 Склад</button>
                            </div>
                            <div id="hp-item-grid" class="hp-item-grid">
                                <!-- Сюда рендерятся карточки -->
                            </div>
                        </div>

                        <!-- Таблица результатов -->
                        <div id="hp-ench-result" style="flex:1; min-height:0; overflow:auto;">
                            <div style="color:#888; text-align:center; padding:20px;">Выберите предмет.</div>
                        </div>
                    </div>
                    <!-- 11.6.5c: «Способности Арены». Контейнер пустой: содержимое
                         рисует HeroPlanner.renderArenaTab() при клике на таб. -->
                    <div class="tab-content" id="tab-hero-arena" style="flex-direction:column; gap:12px; overflow-y:auto; padding-right:4px;"></div>
                `;

                const modal = UI.showModal(`
                    <h2>⚙️ Планировщик Героя (${Utils.escapeHtml(h.name || '')}) <button class="custom-close" id="custom-close-btn">✖</button></h2>
                    <div class="modal-tabs">${tabsHtml}</div>
                    ${contentHtml}
                `);

                // Переключение табов. Скоупим на собственный нав-бар HeroPlanner:
                // после BuildSim.mount() внутри #tab-hero-build появляются свои
                // .modal-tab/.tab-content, и глобальные селекторы сбросили бы их.
                const ownTabs = modal?.querySelector('.modal-tabs');
                const ownContents = () => Array.from(modal?.children || []).filter(el => el.classList.contains('tab-content'));
                // 11.6.2d: при входе на вкладку «Заточка» подтягиваем цены
                // звёзды/сферы с аукциона. Реальная реализация — ниже, после
                // renderTable (ей нужно перерисовать таблицу).
                let onEnchTabOpen = () => {};
                ownTabs?.querySelectorAll('.modal-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        ownTabs.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                        ownContents().forEach(c => c.classList.remove('active'));
                        tab.classList.add('active');
                        const target = document.getElementById(`tab-${tab.dataset.tab}`);
                        if (target) target.classList.add('active');
                        if (tab.dataset.tab === 'hero-ench') onEnchTabOpen();
                        // 11.6.5c: данные арены грузим лениво — только при первом
                        // открытии вкладки (GET /api/abtokens не нужен заранее).
                        if (tab.dataset.tab === 'hero-arena' && !this.arenaData && !this.arenaLoading) {
                            this.loadArenaData(this.arenaCls || (G.ME && G.ME.hero && G.ME.hero.role) || '');
                        }
                    });
                });

                // Инициализация встроенного планировщика билдов
                const buildCont = document.getElementById('hp-buildsim-container');
                if (buildCont && typeof BuildSim !== 'undefined' && typeof BuildSim.mount === 'function') {
                    BuildSim.mount(buildCont);
                }

                const gridEl = document.getElementById('hp-item-grid');
                const outEl = document.getElementById('hp-ench-result');

                // Рендер таблицы заточки для выбранного предмета
                const renderTable = () => {
                    if (!outEl) return;

                    // 11.6.2d: после ответа /market/medians цены ресурсов могли
                    // смениться — обновляем строку под переключателем режимов
                    // (она живёт вне outEl, поэтому перерисовывается отдельно).
                    const matsEl = document.getElementById('hp-mats-price');
                    if (matsEl) matsEl.innerHTML = this.matsPriceHtml();

                    const item = selectedItem;
                    if (!item) {
                        outEl.innerHTML = `<div style="color:#888; text-align:center; padding:20px;">В этой локации нет предметов для заточки.</div>`;
                        return;
                    }

                    const curEn = +(item.en ?? item.e ?? item.enchant ?? 0);

                    // ПРИОРИТЕТ: stats0 (точные базы из игры). Если нет — вычисляем обратным вычетом.
                    let baseStats = {};
                    const hasStats0 = item.stats0 && Object.keys(item.stats0).length > 0;
                    if (hasStats0) {
                        baseStats = item.stats0;
                    } else {
                        // Обратный вычет заточки. Для xstat-ов (crit, dodge, pierce…)
                        // эффективный процент вчетверо меньше (enchK=0.25), поэтому
                        // считаем через enchantBase, а не общим делителем.
                        for (const [k, v] of Object.entries(item.stats || {})) {
                            baseStats[k] = this.enchantBase(v, curEn, k);
                        }
                    }

                    const isExpected = this.strategyMode === 'expected';
                    const isExpanded = this.ENCH.max;
                    // 11.6.5f: цель правой карточки (null -> curEn + 1).
                    const target = this.enchantTargetLevel(curEn);

                    // ── Левая колонка: таблица уровней ──
                    // Колонки «Суммарно» и «Статы после» переехали в карточку
                    // цели: они описывают конкретную цель, а не каждый уровень.
                    let rows = '';
                    for (let lv = 1; lv <= isExpanded; lv++) {
                        let chance = this.enchantChance(lv);
                        const cost = this.enchantCost(item.v, lv);
                        const isCur = lv === curEn;
                        const passed = lv <= curEn;          // шаг уже пройден
                        const isTarget = !passed && lv === target;

                        const useStar = isExpected && !!this.allocatedStars[lv];
                        const useSphere = isExpected && !!this.allocatedSpheres[lv];
                        // ⭐ даёт +25% к шансу — показываем шанс уже с надбавкой.
                        if (useStar) chance += 25;

                        // Цена ресурса: медиана аука (за 72 часа / последние
                        // 100 цен), иначе базовая цена кузнеца — фолбэк внутри
                        // resourcePrice.
                        const starPrice = this.resourcePrice('star');
                        const spherePrice = this.resourcePrice('sphere');

                        // Отмеченный усилитель входит в стоимость попытки:
                        // колонка «Попытка» показывает реальные траты шага.
                        const attemptCost = cost
                            + (useStar ? starPrice : 0)
                            + (useSphere ? spherePrice : 0);

                        // 📈 — в стоимость вошёл ресурс, купленный на ауке
                        // (медиана сети). Тултип объясняет источник цены.
                        const aucUsed = (useStar && this.resourceMedian('star') > 0)
                            || (useSphere && this.resourceMedian('sphere') > 0);
                        const costCell = `${Utils.formatMoney(attemptCost)}${aucUsed
                            ? ' <span title="Цена включает ресурс с аукциона (медиана сети за 72 часа / последние 100 цен)" style="cursor:help; font-size:11px;">📈</span>'
                            : ''}`;

                        // Усилители: в режиме шансов — чипы с чекбоксами, в
                        // «Идеально» — приглушённые чипы-подсказки (там
                        // усилители не участвуют в расчёте).
                        const chipHint = passed
                            ? 'Шаг уже пройден'
                            : 'Усилители учитываются в режиме «С учётом шансов»';
                        const chips = (isExpected && !passed)
                            ? `<label class="hp-mat-chip star" title="Счастливая звезда: +25% к шансу, +${Utils.formatMoney(starPrice)} к цене">`
                                + `<input type="checkbox" class="hp-alloc-star" data-lv="${lv}" ${this.allocatedStars[lv] ? 'checked' : ''}>⭐</label>`
                                + `<label class="hp-mat-chip sphere" title="Сфера сохранения: защита от поломки, +${Utils.formatMoney(spherePrice)} к цене">`
                                + `<input type="checkbox" class="hp-alloc-sphere" data-lv="${lv}" ${this.allocatedSpheres[lv] ? 'checked' : ''}>🌐</label>`
                            : `<span class="hp-mat-chip muted" title="${chipHint}">⭐</span>`
                                + `<span class="hp-mat-chip muted" title="${chipHint}">🌐</span>`;

                        // Бонус заточки на этом уровне (GAME_DATA.ENCHANT_MULTIPLIERS, %)
                        const bonusPct = GAME_DATA.ENCHANT_MULTIPLIERS[lv] || 0;

                        const rowCls = ['hp-ench-row'];
                        if (passed) rowCls.push('passed');
                        if (isCur) rowCls.push('cur');
                        if (isTarget) rowCls.push('target');
                        const rowTitle = passed ? '' : ` title="Сделать целью +${lv}"`;

                        rows += `<tr class="${rowCls.join(' ')}" data-lv="${lv}"${rowTitle}>
                            <td><b>+${lv}</b>${isCur ? ' <small style="color:#ffcf6a;">(тек.)</small>' : ''}</td>
                            <td>${Math.min(100, chance)}%</td>
                            <td style="color:#4cc95a; font-weight:bold;">+${bonusPct}%</td>
                            <td>${costCell}</td>
                            <td class="hp-mats-cell">${chips}</td>
                        </tr>`;
                    }

                    // ── Правая колонка: карточка цели curEn -> target ──
                    // Две суммы: «идеальная» (все попытки удачны с первой) и с
                    // отмеченными усилителями. В режиме шансов показываем вторую.
                    const starPrice = this.resourcePrice('star');
                    const spherePrice = this.resourcePrice('sphere');
                    let costIdeal = 0;
                    let costStrat = 0;
                    let starsUsed = 0, spheresUsed = 0;
                    let attempts = 0;
                    for (let lv = curEn + 1; lv <= target; lv++) {
                        const step = this.enchantCost(item.v, lv);
                        costIdeal += step;
                        let stepCost = step;
                        let chance = this.enchantChance(lv);
                        if (isExpected && this.allocatedStars[lv]) { stepCost += starPrice; chance += 25; starsUsed++; }
                        if (isExpected && this.allocatedSpheres[lv]) { stepCost += spherePrice; spheresUsed++; }
                        costStrat += stepCost;
                        // 100 / chance — ожидаемое число попыток на один шаг
                        // (1/p). Сумма по пути даёт матожидание попыток на всю
                        // цель; при 0% шаг бесконечен, поэтому Infinity.
                        attempts += chance > 0 ? 100 / chance : Infinity;
                    }
                    const costTotal = isExpected ? costStrat : costIdeal;
                    const costExtra = Math.max(0, costStrat - costIdeal);
                    const attemptsStr = Number.isFinite(attempts) ? Math.ceil(attempts) : '∞';
                    const rangeText = target > curEn
                        ? `шагов +${curEn + 1}…+${target}`
                        : 'шагов нет (уровень максимальный)';

                    // Статы предмета на целевой заточке: база -> итог, прибавка
                    // отдельным зелёным числом.
                    const statHtml = Object.entries(baseStats).map(([k, base]) => {
                        const b = +base || 0;
                        const fin = this.enchantStat(b, target, k);
                        const gain = fin - b;
                        const name = (typeof BuildSim !== 'undefined' && BuildSim.statNames && BuildSim.statNames[k]) || k;
                        const safeName = Utils.escapeHtml(name);
                        return `<div class="hp-stat-row">
                            <span class="hp-stat-name" title="${safeName}">${safeName}</span>
                            <span class="hp-stat-val">${b} → <b>${fin}</b>${gain > 0 ? ` <span class="hp-stat-gain">+${gain}</span>` : ''}</span>
                        </div>`;
                    }).join('') || '<div class="hp-cost-sub">У предмета нет характеристик.</div>';

                    // Пресеты цели: уже пройденные уровни недоступны.
                    const presets = [4, 7, 10, 15].map(t => {
                        const done = t <= curEn;
                        const active = t === target;
                        return `<button type="button" class="hp-target-preset${active ? ' active' : ''}"`
                            + ` data-target="${t}"${done ? ' disabled title="Уже пройдено"' : ` title="Цель +${t}"`}>+${t}</button>`;
                    }).join('');

                    // v11.6.3: штраф/фокус и привязка выбранного предмета.
                    // Фокус (shield + cloth) для магов/жрецов считается по
                    // cloth-ветке — штраф за «щит» им не начисляется.
                    const gp = this.gearPenaltyFor(h.role, item);
                    const statLabel = ['mage', 'priest', 'necromancer'].includes(h.role) ? 'маг. урона' : 'физ. урона';
                    let gearNote = '';
                    if (gp.bad) {
                        gearNote = `<div style="font-size:11px; color:#ffb3a0; margin-top:2px;">⚠ Не для вашего класса: −${gp.pct}% ${statLabel}${gp.focus ? ' (фокус — только для ткани)' : ''}</div>`;
                    } else if (gp.focus) {
                        gearNote = `<div style="font-size:11px; color:#8ff2a0; margin-top:2px;">✦ Магический фокус: вторая рука, штрафа для ткани нет</div>`;
                    }
                    const boundNote = isBoundItem(item)
                        ? `<div style="font-size:11px; color:#ffb3a0; margin-top:2px;">🔒 ${BOUND_LINE}</div>`
                        : '';

                    // Клик по строке/пресету перерисовывает колонки целиком —
                    // сохраняем прокрутку списка уровней, иначе таблица прыгает
                    // наверх при каждом выборе цели. 11.6.5f.1: таблица теперь
                    // скроллится внутри .hp-ench-right, поэтому помним и его.
                    const keepScroll = outEl.scrollTop;
                    const keepTableScroll = outEl.querySelector('.hp-ench-right')?.scrollTop || 0;
                    outEl.innerHTML = `
                        <div style="background:#26202e; border:1px solid #44374a; border-radius:6px; padding:8px 12px; margin-bottom:10px; font-size:12px; display:flex; justify-content:space-between;">
                            <div><b style="color:#ffcf6a;">${Utils.escapeHtml(item.name)}</b>${gearIconHtml} (v: ${item.v}, тек: +${curEn})${gearNote}${boundNote}</div>
                        </div>
                        <div class="hp-ench-split">
                            <!-- 11.6.5f.1: карточка цели — СЛЕВА (класс .hp-ench-left,
                                 flex 1 1 40%), таблица уровней — СПРАВА (.hp-ench-right). -->
                            <div class="hp-ench-left">
                                <div class="hp-target-head">
                                    <div class="hp-target-title">Цель: <b>+${target}</b></div>
                                    <div class="hp-target-presets">${presets}</div>
                                </div>
                                <div class="hp-target-section">
                                    <div class="hp-target-sub">Характеристики на +${target}</div>
                                    <div class="hp-stat-grid">${statHtml}</div>
                                </div>
                                <div class="hp-target-section">
                                    <div class="hp-target-sub">Итоговая стоимость</div>
                                    <div class="hp-cost-total">${Utils.formatMoney(costTotal)}</div>
                                    <div class="hp-cost-sub">${rangeText} · попыток: ${attemptsStr}${isExpected
                                        ? `<br>В том числе ресурсы: ${Utils.formatMoney(costExtra)}`
                                        : ''}</div>
                                    ${isExpected ? `<div class="hp-cost-row">Использовано: ⭐ ${starsUsed}/${this.userStars}, 🌐 ${spheresUsed}/${this.userSpheres}</div>` : ''}
                                </div>
                            </div>
                            <div class="hp-ench-right">
                                <table class="hp-ench-table">
                                    <thead><tr>
                                        <th>Уровень</th>
                                        <th>Шанс</th>
                                        <th>Бонус</th>
                                        <th>Попытка</th>
                                        <th>Усилители</th>
                                    </tr></thead>
                                    <tbody>${rows}</tbody>
                                </table>
                            </div>
                        </div>
                        <div class="hp-cost-note">
                            ${isExpected
                                ? `⭐ Звезда: +25% к шансу, +${Utils.formatMoney(starPrice)} к цене. 🌐 Сфера: защита от поломки, +${Utils.formatMoney(spherePrice)} к цене.<br>
                            Цены ресурсов: 📈 — медиана аукциона (за 72 часа / последние 100 цен), 🏪 — базовая цена кузнеца (аукцион не отвечает).<br>
                            <b>«Итоговая стоимость»</b> = стоимость ${rangeText} с выбранными усилителями; «попыток» — матожидание с учётом шансов.<br>
                            Расширенные статы (крит, уклонение, пробивание и пр.) получают ¼ бонуса заточки (enchK = 0.25).`
                                : `Стоимость попытки = <code>max(priceMin, round(v × price% / 100))</code> из живой таблицы игры <code>LG_GAME_DATA.enchant</code>. Округление статов — <code>Math.round</code> (подтверждено игрой).<br>
                            <b>«Итоговая стоимость»</b> = сумма базовых стоимостей ${rangeText} (без шансов и поломок — «идеальная» стоимость).<br>
                            Звёзды и сферы учитываются в режиме «🧠 С учётом шансов»: 📈 — медиана аукциона (за 72 часа / последние 100 цен), 🏪 — цена кузнеца.<br>
                            Расширенные статы (крит, уклонение, пробивание и пр.) получают ¼ бонуса заточки (enchK = 0.25).`}
                        </div>
                    `;
                    outEl.scrollTop = keepScroll;
                    const tableWrap = outEl.querySelector('.hp-ench-right');
                    if (tableWrap) tableWrap.scrollTop = keepTableScroll;

                    // Обработчики чекбоксов
                    // Лимит ресурсов считаем по ВСЕМ отмеченным уровням, а не
                    // только по пути до цели (starsUsed/spheresUsed — счётчики
                    // карточки, они ограничены диапазоном curEn → target).
                    const countAllocated = (map) => Object.keys(map).filter(k => map[k]).length;
                    if (isExpected) {
                        outEl.querySelectorAll('.hp-alloc-star').forEach(cb => {
                            cb.addEventListener('change', (e) => {
                                const lv = +e.target.dataset.lv;
                                if (e.target.checked) {
                                    if (countAllocated(this.allocatedStars) >= this.userStars) {
                                        e.target.checked = false;
                                        UI.showToast('Звёзды закончились', true);
                                        return;
                                    }
                                    this.allocatedStars[lv] = true;
                                } else {
                                    delete this.allocatedStars[lv];
                                }
                                renderTable();
                            });
                        });
                        outEl.querySelectorAll('.hp-alloc-sphere').forEach(cb => {
                            cb.addEventListener('change', (e) => {
                                const lv = +e.target.dataset.lv;
                                if (e.target.checked) {
                                    if (countAllocated(this.allocatedSpheres) >= this.userSpheres) {
                                        e.target.checked = false;
                                        UI.showToast('Сферы закончились', true);
                                        return;
                                    }
                                    this.allocatedSpheres[lv] = true;
                                } else {
                                    delete this.allocatedSpheres[lv];
                                }
                                renderTable();
                            });
                        });
                    }

                    // 11.6.5f: клик по строке уровня делает его целью правой
                    // карточки. Пройденные шаги целью быть не могут, а клик по
                    // чипу усилителя целью не считается.
                    outEl.querySelectorAll('.hp-ench-row').forEach(tr => {
                        tr.addEventListener('click', (e) => {
                            if (e.target.closest('input, label')) return;
                            const lv = +tr.dataset.lv;
                            if (!Number.isFinite(lv) || lv <= curEn) return;
                            this.targetLevel = lv;
                            renderTable();
                        });
                    });

                    // Кнопки-пресеты цели (+4/+7/+10/+15).
                    outEl.querySelectorAll('.hp-target-preset').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const lv = +btn.dataset.target;
                            if (!Number.isFinite(lv) || lv <= curEn) return;
                            this.targetLevel = lv;
                            renderTable();
                        });
                    });
                };

                // 11.6.2d: при входе на вкладку «Заточка» тянем цены звёзды и
                // сферы с аукциона и перерисовываем таблицу. Пока ответа нет (или
                // если сервер молчит) в UI стоят базовые цены кузнеца.
                // refreshMaterialMedians троттлит запросы (5 минут) и никогда не
                // реджектится, поэтому .then срабатывает и при ошибке.
                onEnchTabOpen = () => {
                    this.refreshMaterialMedians().then(() => {
                        // Модалку могли закрыть, пока ходили на сервер.
                        if (!outEl || !outEl.isConnected) return;
                        renderTable();
                    });
                };

                // Рендер плитки предметов
                const renderGrid = () => {
                    if (!gridEl) return;
                    const locData = locations[currentLocKey];

                    if (!locData.items.length) {
                        gridEl.innerHTML = `<div style="color:#888; font-style:italic; padding:10px;">Нет предметов для заточки</div>`;
                        selectedItem = null;
                        renderTable();
                        return;
                    }

                    // Если текущий выбранный предмет не из этой локации — берем первый
                    if (!locData.items.find(x => x.uid === selectedItem?.uid)) {
                        selectedItem = locData.items[0];
                    }

                    gridEl.innerHTML = locData.items.map(it => {
                        const isSel = it.uid === selectedItem?.uid;
                        // Используем хелпер арта из утилит
                        const art = Utils.getItemArtHtml({ i: it.id ?? it.i, name: it.name }, it);
                        const border = isSel ? '2px solid #caa55c' : '1px solid #44374a';
                        const bg = isSel ? 'rgba(202,165,92,0.15)' : '#1e1724';
                        // v11.6.3: 🔒 — легендарка привязана (не передаётся),
                        // ✦ — магический фокус (вторая рука, shield + cloth).
                        const bound = isBoundItem(it);
                        const focus = isFocusItem(it);
                        const badges = (bound ? `<span title="${BOUND_LINE}" style="position:absolute; top:2px; right:2px; font-size:10px;">🔒</span>` : '')
                            + (focus ? `<span title="Магический фокус" style="position:absolute; top:2px; left:2px; font-size:10px;">✦</span>` : '');
                        const tip = `${it.name}${bound ? ' · ' + BOUND_LINE : ''}${focus ? ' · магический фокус' : ''}`;

                        // 11.6.5f.1: габариты плитки (min-width/padding, 24px арт)
                        // заданы в CSS — .hp-item-grid .hp-item-card/.hp-item-art.
                        // Инлайн оставлен только для цветов выбранного предмета.
                        return `<div class="hp-item-card" data-uid="${Utils.escapeHtml(it.uid)}" title="${Utils.escapeHtml(tip)}" style="position:relative; cursor:pointer; display:flex; flex-direction:column; align-items:center; background:${bg}; border:${border}; border-radius:6px; transition:all 0.15s;">
                            ${badges}
                            <div class="hp-item-art">
                                ${art || '📦'}
                            </div>
                            <div style="font-size:10px; color:#ccc; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%;">+${+(it.en || it.e || 0)}</div>
                        </div>`;
                    }).join('');

                    gridEl.querySelectorAll('.hp-item-card').forEach(el => {
                        el.addEventListener('click', () => {
                            // data-uid всегда строка — сравниваем как строки.
                            selectedItem = locData.items.find(x => String(x.uid) === el.dataset.uid);
                            renderGrid(); // Перерисовка для обновления рамки
                            renderTable();
                        });
                    });
                };

                // Суб-табы (Локации)
                const locBtns = modal?.querySelectorAll('.hp-loc-btn');
                locBtns?.forEach(btn => {
                    btn.addEventListener('click', () => {
                        currentLocKey = btn.dataset.loc;
                        locBtns.forEach(b => {
                            b.classList.remove('active');
                            b.style.background = '#2a2030';
                            b.style.color = '#aaa';
                            b.style.border = '1px solid #44374a';
                        });
                        btn.classList.add('active');
                        btn.style.background = '#caa55c';
                        btn.style.color = '#1d1620';
                        btn.style.border = 'none';

                        selectedItem = locations[currentLocKey].items[0] || null;
                        renderGrid();
                        renderTable();
                    });
                });

                // Обработка переключателя режимов
                modal?.querySelectorAll('.hp-mode-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        this.strategyMode = e.currentTarget.dataset.mode;

                        // Обновляем визуал кнопок
                        modal.querySelectorAll('.hp-mode-btn').forEach(b => {
                            b.classList.remove('active');
                            b.style.background = 'transparent';
                            b.style.color = '#aaa';
                        });
                        e.currentTarget.classList.add('active');
                        e.currentTarget.style.background = '#caa55c';
                        e.currentTarget.style.color = '#1d1620';

                        const resPanel = document.getElementById('hp-resources-panel');
                        if (resPanel) resPanel.style.display = this.strategyMode === 'expected' ? 'flex' : 'none';
                        renderTable();
                    });
                });

                document.getElementById('hp-input-stars')?.addEventListener('input', (e) => {
                    this.userStars = Math.max(0, Math.min(15, +e.target.value || 0));
                    // Очищаем лишние галочки, если количество уменьшилось
                    let count = 0;
                    for (let lv = 15; lv >= 1; lv--) {
                        if (this.allocatedStars[lv]) {
                            count++;
                            if (count > this.userStars) delete this.allocatedStars[lv];
                        }
                    }
                    renderTable();
                });

                document.getElementById('hp-input-spheres')?.addEventListener('input', (e) => {
                    this.userSpheres = Math.max(0, Math.min(15, +e.target.value || 0));
                    // Очищаем лишние галочки, если количество уменьшилось
                    let count = 0;
                    for (let lv = 15; lv >= 1; lv--) {
                        if (this.allocatedSpheres[lv]) {
                            count++;
                            if (count > this.userSpheres) delete this.allocatedSpheres[lv];
                        }
                    }
                    renderTable();
                });

                renderGrid();
                renderTable();

                // 11.6.2d: прогреваем медианы аука сразу при открытии окна —
                // тогда при переключении на «Заточку» цены уже актуальные.
                // Запрос троттлится (MEDIANS_TTL), префетч при ошибке молчит.
                this.refreshMaterialMedians();

            } catch (err) {
                dbg('[HERO PLANNER] Ошибка:', err);
                UI.showModal(`<h2>❌ Ошибка <button class="custom-close" id="custom-close-btn">✖</button></h2><p>${Utils.escapeHtml(err.message)}</p>`);
            }
        }
    };
