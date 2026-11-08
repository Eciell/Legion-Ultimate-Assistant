    // ============================================================
    // 4.1. МОДУЛЬ: ПЛАНИРОВЩИК ГЕРОЯ
    // Вкладки: Билды (заглушка → BuildSim), Заточка (рабочий калькулятор).
    // ============================================================
    const HeroPlanner = {
        // Таблица заточки (05_Mechanics.md). TODO: переключить источник на
        // hero.crafts / API в v1.1, если игра начнёт отдавать таблицу.
        // Бонус заточки (ENCHANT_MULTIPLIERS) и цены попыток (ENCHANT_PRICES /
        // ENCHANT_PRICE_MIN) — общие: GAME_DATA в core/constants.js, чтобы не
        // дублировать их с auction.js.
        ENCH: {
            max: 15,
            chance: [0, 95, 90, 80, 70, 55, 42, 30, 20, 12, 7, 4, 2, 1, 0.5, 0],
            slots: ['weapon', 'shield', 'armor', 'helmet', 'trinket']
        },

        // ── Режим «С учётом шансов» (стратегии) ──────────────────
        strategyMode: 'ideal', // 'ideal' | 'expected'
        userStars: 0,
        userSpheres: 0,
        allocatedStars: {},   // { lv: true }
        allocatedSpheres: {}, // { lv: true }

        // Стоимость ресурсов (из 05_Mechanics.md)
        COST_STAR: 300,
        COST_SPHERE: 900,

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

        enchantCost(itemV, level) {
            const pct = GAME_DATA.ENCHANT_PRICES[Math.min(15, +level || 0)] || 0;
            return Math.max(GAME_DATA.ENCHANT_PRICE_MIN, Math.round(itemV * pct / 100));
        },

        // Шанс успеха, % (без способов, обычная заточка)
        enchantChance(level) {
            return this.ENCH.chance[Math.min(15, +level || 0)] || 0;
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
         * 0 — наблюдений за 7 дней нет, сервер не ответил или модуль Auction
         * недоступен (урезанная сборка).
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
         * Цена ресурса заточки в меди.
         *
         * Фолбэк (11.6.2d): если медианы аука нет или она нулевая — берём
         * базовую цену кузнеца (COST_STAR / COST_SPHERE, они же
         * game-data.js → enchant.coins: 300 и 900). Ноль в стоимость попытки
         * попасть не может, иначе «Суммарно» занижалось бы.
         *
         * @param {'star'|'sphere'} kind
         * @returns {number}
         */
        resourcePrice(kind) {
            const base = kind === 'star' ? this.COST_STAR : this.COST_SPHERE;
            return this.resourceMedian(kind) || base;
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
         *   📈 — цена взята с аукциона (медиана сети за 7 дней);
         *   🏪 — базовая цена кузнеца (аукцион не ответил / нет наблюдений).
         * В title — сумма и пояснение, поэтому бейдж работает как тултип.
         *
         * @param {'star'|'sphere'} kind
         * @returns {string} html
         */
        priceBadge(kind) {
            const net = this.resourceMedian(kind);
            if (net > 0) {
                return `<span title="Цена взята с аукциона (медиана сети за 7 дней): ${Utils.formatMoney(net)}" style="cursor:help;">`
                    + `📈 <b style="color:#7ad1ff;">${Utils.formatMoney(net)}</b></span>`;
            }
            const base = kind === 'star' ? this.COST_STAR : this.COST_SPHERE;
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

        async open() {
            UI.showModal(`<h2>⚙️ Планировщик Героя <button class="custom-close" id="custom-close-btn">✖</button></h2><div class="loader">Загрузка данных...</div>`);
            try {
                const me = await Utils.fetchApi('/api/me');
                if (!me || !me.ok || !me.hero) throw new Error('Нет героя');
                const h = me.hero;

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
                    <div class="tab-content" id="tab-hero-ench" style="flex-direction:column; gap:10px;">
                        <!-- Переключатель режимов (Стилизованный) -->
                        <div style="display:flex; background:#1e1724; border:1px solid #3d2f44; border-radius:8px; padding:4px; margin-bottom:10px;">
                            <button class="hp-mode-btn ${this.strategyMode === 'ideal' ? 'active' : ''}" data-mode="ideal" style="flex:1; padding:8px; border:none; border-radius:6px; font-weight:bold; cursor:pointer; transition:all 0.2s; background:${this.strategyMode === 'ideal' ? '#caa55c' : 'transparent'}; color:${this.strategyMode === 'ideal' ? '#1d1620' : '#aaa'};">📊 Идеально</button>
                            <button class="hp-mode-btn ${this.strategyMode === 'expected' ? 'active' : ''}" data-mode="expected" style="flex:1; padding:8px; border:none; border-radius:6px; font-weight:bold; cursor:pointer; transition:all 0.2s; background:${this.strategyMode === 'expected' ? '#caa55c' : 'transparent'}; color:${this.strategyMode === 'expected' ? '#1d1620' : '#aaa'};">🧠 С учётом шансов</button>
                        </div>

                        <!-- Панель ресурсов (скрыта в режиме ideal) -->
                        <div id="hp-resources-panel" style="display:${this.strategyMode === 'expected' ? 'flex' : 'none'}; gap:15px; align-items:center; justify-content:center; margin-bottom:10px; background:#1e1724; border:1px solid #3d2f44; border-radius:6px; padding:8px 12px;">
                            <label style="display:flex; align-items:center; gap:8px; color:#ffcf6a; font-weight:bold; font-size:14px;">
                                ⭐ Звёзды: <input type="number" id="hp-input-stars" min="0" max="15" value="${this.userStars}" style="width:45px; background:#111; border:1px solid #555; color:#fff; padding:4px; border-radius:4px; text-align:center; font-weight:bold;">
                            </label>
                            <label style="display:flex; align-items:center; gap:8px; color:#ffcf6a; font-weight:bold; font-size:14px;">
                                🌐 Сферы: <input type="number" id="hp-input-spheres" min="0" max="15" value="${this.userSpheres}" style="width:45px; background:#111; border:1px solid #555; color:#fff; padding:4px; border-radius:4px; text-align:center; font-weight:bold;">
                            </label>
                        </div>

                        <!-- 11.6.2d: цены ресурсов заточки. 📈 — медиана аука,
                             🏪 — базовая цена кузнеца (фолбэк). Содержимое
                             обновляет renderTable после ответа сервера. -->
                        <div id="hp-mats-price" style="display:flex; gap:18px; align-items:center; font-size:12px; color:#ccc; background:#1e1724; border:1px solid #3d2f44; border-radius:6px; padding:6px 12px; margin-bottom:10px;">
                            ${this.matsPriceHtml()}
                        </div>

                        <!-- Суб-табы локаций -->
                        <div style="display:flex; gap:6px; border-bottom:1px solid #44374a; padding-bottom:8px;">
                            <button class="hp-loc-btn active" data-loc="equipped" style="background:#caa55c; color:#1d1620; border:none; padding:6px 12px; border-radius:4px; font-weight:bold; cursor:pointer;">🛡️ Надето</button>
                            <button class="hp-loc-btn" data-loc="bag" style="background:#2a2030; color:#aaa; border:1px solid #44374a; padding:6px 12px; border-radius:4px; font-weight:bold; cursor:pointer;">🎒 Сумка</button>
                            <button class="hp-loc-btn" data-loc="storage" style="background:#2a2030; color:#aaa; border:1px solid #44374a; padding:6px 12px; border-radius:4px; font-weight:bold; cursor:pointer;">📦 Склад</button>
                        </div>

                        <!-- Плитка предметов -->
                        <div id="hp-item-grid" style="display:flex; gap:10px; overflow-x:auto; padding:10px 0; min-height:120px; align-items:flex-start;">
                            <!-- Сюда рендерятся карточки -->
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

                    let starsUsed = 0, spheresUsed = 0;

                    let rows = '';
                    let cumulativeIdeal = 0;
                    let cumulativeStrat = 0;
                    for (let lv = 1; lv <= isExpanded; lv++) {
                        let chance = this.enchantChance(lv);
                        let cost = this.enchantCost(item.v, lv);
                        const isCur = lv === curEn;

                        // Сохраняем идеальную сумму (без ресурсов)
                        cumulativeIdeal += cost;

                        const useStar = isExpected && this.allocatedStars[lv];
                        const useSphere = isExpected && this.allocatedSpheres[lv];

                        // 11.6.2d: цена ресурса — медиана аука, если по нему есть
                        // наблюдения за 7 дней, иначе базовая цена кузнеца
                        // (resourcePrice сам делает фолбэк).
                        const starPrice = this.resourcePrice('star');
                        const spherePrice = this.resourcePrice('sphere');

                        // Применяем ресурсы
                        if (useStar) { chance += 25; cost += starPrice; starsUsed++; }
                        if (useSphere) { cost += spherePrice; spheresUsed++; }

                        // Сумма с учетом выбранных стратегий
                        cumulativeStrat += cost;

                        // Выбираем, какую сумму показывать
                        const totalCostStr = isExpected
                            ? Utils.formatMoney(cumulativeStrat)
                            : Utils.formatMoney(cumulativeIdeal);

                        // 📈 у цены — в этой строке стоимость включает ресурс,
                        // взятый с аукциона (тултип объясняет источник).
                        const aucUsed = (useStar && this.resourceMedian('star') > 0)
                            || (useSphere && this.resourceMedian('sphere') > 0);
                        const costCell = `${Utils.formatMoney(cost)}${aucUsed
                            ? ' <span title="Цена взята с аукциона (медиана сети за 7 дней)" style="cursor:help; font-size:11px;">📈</span>'
                            : ''}`;

                        const statsLine = Object.entries(baseStats).map(([k, base]) => {
                            const final = this.enchantStat(base, lv, k);  // передаем ключ
                            return `${BuildSim.statNames[k] || k}: ${final}`;
                        }).join(' · ') || '—';

                        // Чекбоксы для стратегий
                        let stratCells = '';
                        if (isExpected) {
                            const sChecked = this.allocatedStars[lv] ? 'checked' : '';
                            const spChecked = this.allocatedSpheres[lv] ? 'checked' : '';
                            stratCells = `
                                <td style="text-align:center;"><input type="checkbox" class="hp-alloc-star" data-lv="${lv}" ${sChecked}></td>
                                <td style="text-align:center;"><input type="checkbox" class="hp-alloc-sphere" data-lv="${lv}" ${spChecked}></td>
                            `;
                        }

                        // Бонус заточки на этом уровне (GAME_DATA.ENCHANT_MULTIPLIERS, %), для новых уровней — 0
                        const bonusPct = GAME_DATA.ENCHANT_MULTIPLIERS[lv] || 0;
                        rows += `<tr style="${isCur ? 'background:rgba(202,165,92,0.12);' : ''}">
                            <td><b>+${lv}</b>${isCur ? ' <small style="color:#ffcf6a;">(текущая)</small>' : ''}</td>
                            <td>${Math.min(100, chance)}%</td>
                            <td style="color:#4cc95a; font-weight:bold;">+${bonusPct}%</td>
                            <td>${costCell}</td>
                            ${stratCells}
                            <td style="color:#ffcf6a; font-weight:bold;">${totalCostStr}</td>
                            <td style="font-size:12px; color:#ccc;">${statsLine}</td>
                        </tr>`;
                    }

                    const stratHeaders = isExpected ? `<th>⭐</th><th>🌐</th>` : '';

                    outEl.innerHTML = `
                        <div style="background:#26202e; border:1px solid #44374a; border-radius:6px; padding:8px 12px; margin-bottom:10px; font-size:12px; display:flex; justify-content:space-between;">
                            <div><b style="color:#ffcf6a;">${Utils.escapeHtml(item.name)}</b> (v: ${item.v}, тек: +${curEn})</div>
                            ${isExpected ? `<div>Использовано: ⭐ ${starsUsed}/${this.userStars} | 🌐 ${spheresUsed}/${this.userSpheres}</div>` : ''}
                        </div>
                        <table>
                            <thead><tr>
                                <th>Уровень</th>
                                <th>Шанс</th>
                                <th>Бонус</th>
                                <th>Стоимость</th>
                                ${stratHeaders}
                                <th>${isExpected ? 'Суммарно (с ресурсами)' : 'Суммарно до +N'}</th>
                                <th>Статы после</th>
                            </tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                        ${isExpected
                            ? `<div style="margin-top:10px; font-size:11px; color:#888; line-height:1.5;">
                            ⭐ Звезда: +25% к шансу, +${Utils.formatMoney(this.resourcePrice('star'))} к цене. 🌐 Сфера: защита от поломки, +${Utils.formatMoney(this.resourcePrice('sphere'))} к цене.<br>
                            Цены ресурсов: 📈 — медиана аукциона (наблюдения за 7 дней), 🏪 — базовая цена кузнеца (аукцион не отвечает).<br>
                            «Суммарно» = стоимость всех попыток с +1 до +N с учетом выбранных вами ресурсов.<br>
                            Расширенные статы (крит, уклонение, пробивание и пр.) получают ¼ бонуса заточки (enchK = 0.25).
                        </div>`
                            : `<div style="margin-top:10px; font-size:11px; color:#888; line-height:1.5;">
                            Стоимость = <code>max(10, round(v × price% / 100))</code>. Округление статов — <code>Math.round</code> (подтверждено игрой).<br>
                            <b>«Суммарно до +N»</b> = сумма всех базовых стоимостей с +1 до +N (без учета шансов и поломок, «идеальная» стоимость).<br>
                            Звёзды и сферы учитываются в режиме «🧠 С учётом шансов»: 📈 — медиана аукциона, 🏪 — базовая цена кузнеца.<br>
                            Расширенные статы (крит, уклонение, пробивание и пр.) получают ¼ бонуса заточки (enchK = 0.25).
                        </div>`}
                    `;

                    // Обработчики чекбоксов
                    if (isExpected) {
                        outEl.querySelectorAll('.hp-alloc-star').forEach(cb => {
                            cb.addEventListener('change', (e) => {
                                const lv = +e.target.dataset.lv;
                                if (e.target.checked) {
                                    if (starsUsed >= this.userStars) { e.target.checked = false; UI.showToast('Звёзды закончились', true); return; }
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
                                    if (spheresUsed >= this.userSpheres) { e.target.checked = false; UI.showToast('Сферы закончились', true); return; }
                                    this.allocatedSpheres[lv] = true;
                                } else {
                                    delete this.allocatedSpheres[lv];
                                }
                                renderTable();
                            });
                        });
                    }
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

                        return `<div class="hp-item-card" data-uid="${Utils.escapeHtml(it.uid)}" title="${Utils.escapeHtml(it.name)}" style="cursor:pointer; min-width:70px; display:flex; flex-direction:column; align-items:center; padding:8px 4px; background:${bg}; border:${border}; border-radius:6px; transition:all 0.15s;">
                            <div style="width:32px; height:32px; display:flex; align-items:center; justify-content:center; margin-bottom:6px; overflow:hidden;">
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
