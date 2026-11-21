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
            // v11.7 (клиент b62dcb896a): амулет (trinket) официально входит в
            // enchant.slots и точится по общей шкале +0..+15. Список берём из
            // core/constants.js, чтобы не дублировать его с auction.js;
            // живая таблица игры имеет приоритет — см. enchantSlots().
            slots: GAME_DATA.ENCHANT_SLOTS
        },

        /**
         * v11.7: актуальный список затачиваемых слотов.
         *
         * Приоритет у живой таблицы игры (LG_GAME_DATA.enchant.slots — в
         * клиенте b62dcb896a там пять слотов, включая 'trinket'). Если таблицы
         * ещё нет (run-at document-start), отдаём фолбэк ENCH.slots.
         *
         * @returns {string[]} слоты, которые показывает калькулятор
         */
        enchantSlots() {
            const live = liveEnchantSlots();
            return (Array.isArray(live) && live.length) ? live : this.ENCH.slots;
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
         * Правила игры (lib/game-data.js: gearPenalty):
         *  - armor −25%, helmet −10%, shield −15% к основному стату;
         *  - магический фокус (slot === 'shield' && gear === 'cloth') —
         *    вторая рука мага/жреца/некроманта: проверяется по cloth-ветке,
         *    поэтому для cloth-классов штрафа нет;
         *  - оффхенд-оружие (slot === 'shield' && role && gear !== 'cloth') —
         *    разрешено только своему классу: штраф, если role !== item.role;
         *  - обычный защитный щит разрешён только legionary/paladin
         *    (CLASS_SHIELD = shieldOk).
         *
         * @param {string} role hero.role
         * @param {object} item предмет из /api/me
         * @returns {{pct:number, bad:boolean, focus:boolean, offhand:boolean, want:string, slot:string}}
         */
        gearPenaltyFor(role, item) {
            const out = { pct: 0, bad: false, focus: false, offhand: false, want: '', slot: '' };
            if (!role || !item) return out;
            const pen = GAME_DATA.GEAR_PEN[item.slot] || 0;
            const want = GAME_DATA.CLASS_GEAR[role] || '';
            const focus = isFocusItem(item);
            const offhand = isOffhandItem(item);
            out.want = want;
            out.focus = focus;
            out.offhand = offhand;
            out.slot = item.slot;
            if (!pen) return out;

            let bad;
            if (item.slot === 'shield') {
                if (offhand) {
                    // Оффхенд — оружие конкретного класса, «чужой» щит тут ни
                    // при чём: сравниваем класс предмета с классом героя.
                    bad = String(item.role).toLowerCase() !== String(role).toLowerCase();
                } else {
                    bad = focus
                        ? (!!want && want !== 'cloth')
                        : !GAME_DATA.CLASS_SHIELD[role];
                }
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

        /**
         * Открытие планировщика. initialTab — необязательный id вкладки:
         * 'build' | 'ench'. Устаревший 'arena' перенаправляется на «Билды»
         * (вкладка способностей Арены переехала в созвездие BuildSim).
         */
        async open(initialTab) {
            const wanted = (initialTab === 'arena') ? 'build' : String(initialTab || 'build');
            UI.showModal(`<h2>⚙️ Планировщик Героя <button class="custom-close" id="custom-close-btn">✖</button></h2><div class="loader">Загрузка данных...</div>`);
            try {
                const me = await Utils.fetchApi('/api/me');
                if (!me || !me.ok || !me.hero) throw new Error('Нет героя');
                const h = me.hero;

                // Предметы для заточки. uid сервер отдаёт не всегда: без него все
                // карточки получили бы одинаковый ключ, поэтому отсутствующий uid
                // заменяем синтетическим (с префиксом локации).
                // v11.7: список слотов — из живой таблицы игры (enchant.slots,
                // там есть 'trinket'), поэтому новый ребаланс слотов не ломает
                // фильтр. Фолбэк — GAME_DATA.ENCHANT_SLOTS.
                const enchSlots = this.enchantSlots();
                const mapItems = (arr, prefix) => (arr || [])
                    .filter(it => it && it.slot && enchSlots.includes(it.slot) && it.v > 0)
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
                const activateTab = (id) => {
                    const btn = ownTabs?.querySelector(`.modal-tab[data-tab="${id}"]`);
                    if (btn) btn.click();
                };
                ownTabs?.querySelectorAll('.modal-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        ownTabs.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                        ownContents().forEach(c => c.classList.remove('active'));
                        tab.classList.add('active');
                        const target = document.getElementById(`tab-${tab.dataset.tab}`);
                        if (target) target.classList.add('active');
                        if (tab.dataset.tab === 'hero-ench') onEnchTabOpen();
                    });
                });
                // initialTab из open() применяем ниже — после того как назначен
                // onEnchTabOpen (иначе первый вход на «Заточку» не подтянет цены).

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
                    // v11.7: оффхенд-оружие (shield + role) сравнивается с
                    // классом героя напрямую.
                    const gp = this.gearPenaltyFor(h.role, item);
                    const statLabel = ['mage', 'priest', 'necromancer'].includes(h.role) ? 'маг. урона' : 'физ. урона';
                    const offhandFor = (gp.offhand && GAME_DATA.CLASS_NAMES[item.role]) || item.role || '';
                    let gearNote = '';
                    if (gp.bad) {
                        const why = gp.focus ? ' (фокус — только для ткани)'
                            : (gp.offhand && offhandFor ? ` (оффхенд класса «${offhandFor}»)` : '');
                        gearNote = `<div style="font-size:11px; color:#ffb3a0; margin-top:2px;">⚠ Не для вашего класса: −${gp.pct}% ${statLabel}${Utils.escapeHtml(why)}</div>`;
                    } else if (gp.focus) {
                        gearNote = `<div style="font-size:11px; color:#8ff2a0; margin-top:2px;">✦ Магический фокус: вторая рука, штрафа для ткани нет</div>`;
                    } else if (gp.offhand) {
                        gearNote = `<div style="font-size:11px; color:#8ff2a0; margin-top:2px;">⚔ Оффхенд-оружие${offhandFor ? ' класса «' + Utils.escapeHtml(offhandFor) + '»' : ''}: штрафа нет</div>`;
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

                // initialTab: 'build' (по умолчанию) | 'ench'; 'arena' уже
                // нормализован в 'build'. «Билды» активны в разметке изначально.
                if (wanted === 'ench' || wanted === 'hero-ench') activateTab('hero-ench');

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
                        // ✦ — магический фокус (вторая рука, shield + cloth),
                        // ⚔ — оффхенд-оружие (вторая рука, shield + role).
                        const bound = isBoundItem(it);
                        const focus = isFocusItem(it);
                        const offhand = isOffhandItem(it);
                        const offhandRole = (offhand && GAME_DATA.CLASS_NAMES[it.role]) || it.role || '';
                        const badges = (bound ? `<span title="${BOUND_LINE}" style="position:absolute; top:2px; right:2px; font-size:10px;">🔒</span>` : '')
                            + (focus ? `<span title="Магический фокус" style="position:absolute; top:2px; left:2px; font-size:10px;">✦</span>` : '')
                            + (offhand ? `<span title="Оффхенд-оружие${offhandRole ? ': ' + Utils.escapeHtml(offhandRole) : ''}" style="position:absolute; top:2px; left:2px; font-size:10px;">⚔</span>` : '');
                        const tip = `${it.name}${bound ? ' · ' + BOUND_LINE : ''}${focus ? ' · магический фокус' : ''}${offhand ? ' · оффхенд' + (offhandRole ? ' для класса «' + offhandRole + '»' : '') : ''}`;

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
