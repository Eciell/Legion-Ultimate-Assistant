    // ============================================================
    // 0. КОНСТАНТЫ, КЭШИ И БАЗОВЫЕ УТИЛИТЫ (core/constants.js)
    //
    // Подключается ПЕРВЫМ (см. CORE_ORDER в build.js): здесь объявляются
    // G, DEBUG/dbg, RAND_ID, DOM_IDS, API_BASE, общие константы, глобальные
    // кэши и пустой объект Utils. Методы в него добавляют utils-format /
    // utils-api / utils-art / utils-chat через Object.assign — порядок
    // подключения критичен для TDZ (const/let).
    // ============================================================
    const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    const DEBUG = false;
    const dbg = (...a) => DEBUG && console.log('[LEGION]', ...a);

    // 0.1. ГЛОБАЛЬНЫЙ КЭШ ОНЛАЙНА ИГРОКОВ (сетевой перехват)
    window.__lgOnlinePlayers = window.__lgOnlinePlayers || new Map();
    window.__lgMineTotalHere = window.__lgMineTotalHere || 0;

    // 0.0. РАНДОМИЗАЦИЯ DOM-ПРЕФИКСОВ
    const RAND_ID = 'x-' + Math.random().toString(36).substring(2, 6);

    const DOM_IDS = {
        fabWrap: `${RAND_ID}-fab-wrap`,
        fabMenu: `${RAND_ID}-fab-menu`,
        fabBtn: `${RAND_ID}-fab-btn`,
        fabIcon: `${RAND_ID}-fab-icon`,
        btnAutoMine: `${RAND_ID}-btn-auto-mine`,
        hudLog: `${RAND_ID}-hud-log`,
        hudLogContent: `${RAND_ID}-hud-log-content`,
        hudDragHandle: `${RAND_ID}-hud-drag-handle`,
        hudLogCloseBtn: `${RAND_ID}-hud-log-close-btn`,
        btnBuildSim: `${RAND_ID}-btn-build-sim`,
        btnAuctionScan: `${RAND_ID}-btn-auction-scan`,
        btnPlayers: `${RAND_ID}-btn-players`,
        btnChatToggle: `${RAND_ID}-btn-chat-toggle`,
        btnPopout: `${RAND_ID}-btn-popout`,
        btnPocketCity: `${RAND_ID}-btn-pocket-city`,
        // v11.6.0: «Пати» (modules/party.js) — кнопка в блоке «Социальное».
        btnParty: `${RAND_ID}-btn-party`,
        btnProfile: `${RAND_ID}-btn-profile`,
        chkChatDisable: `${RAND_ID}-chk-chat-disable`,
        externalChatStatus: `${RAND_ID}-external-chat-status`,
        chatBadge: `${RAND_ID}-chat-badge`,
        fabChatBadge: `${RAND_ID}-fab-chat-badge`,
        chatWidget: `${RAND_ID}-chat-widget`,
        playerHud: `${RAND_ID}-player-hud`,
        customModal: `${RAND_ID}-modal`
    };

    /*
     * ------------------------------------------------------------
     * Справка по форматам данных (§0.8 / SDK):
     * 1. MDDoodle.names[id] -> имя предмета, fallback: MDDoodle?.names?.cats?.items?.[id]?.name
     * 2. st.bl / st.dl -> кортеж [left, w, rate, n], где n = число либо объект {player:ts}
     * 3. lot -> { i, p, n, u, sn (seller nick), s (seller fallback), e (enchant) }
     * 4. hero -> { name, class, stats, mn: mines, items }
     * ------------------------------------------------------------
     */
    const API_BASE = window.LG_BASE || (location.pathname.match(/^\/c\/[^/]+/)?.[0] || '');
    const CHAT_DEDUP_TTL = 8000;
    const MAX_POINTS = 50;
    /*
     * v11.6.1: сетка дерева навыков сжата под 1920x1080 без скролла.
     * Нативные пропорции (reference/LegionFrontSRC/site/skills.js):
     * TH 140 / TOP 40 / BOT 80 -> BH 680.
     * v11.6.2a.1: шаг яруса увеличен 95 -> 120 (узлы выросли до 48px, а между
     * подписью верхнего узла и кружком нижнего должно остаться место под
     * замочек яруса), TOP 40 / BOT 50 -> BH = 40 + 4*120 + 50 = 570.
     * v11.6.2a.5: шаг яруса 120 -> 135 (подписи стали шире и могут занимать
     * больше строк, между ярусами ~91px свободного места под замок),
     * TOP 40 / BOT 50 -> BH = 40 + 4*135 + 50 = 630.
     */
    const TH = 135;
    const TOP = 40;
    const BOT = 50;
    const BH = TOP + 4 * TH + BOT; // 630
    // Y-координаты ярусов req=30..0 (верх -> низ): BH - BOT - индекс_яруса * TH.
    const Y_MAP = { 30: TOP, 20: BH - BOT - 3 * TH, 10: BH - BOT - 2 * TH, 5: BH - BOT - TH, 0: BH - BOT };
    const SKIP_FX_PREFIXES = ['ctl_', 'act_', 'cd_'];

    /*
     * ------------------------------------------------------------
     * ИГРОВЫЕ ТАБЛИЦЫ (05_Mechanics.md)
     *
     * Единый источник данных для модулей: раньше auction.js (ENCH_BONUS)
     * и hero-planner.js (ENCH.bonus) держали свои копии одной и той же
     * таблицы заточки, и они могли разъехаться.
     * ------------------------------------------------------------
     */
    const GAME_DATA = {
        // Прирост характеристик предмета от уровня заточки, %:
        // индекс массива = уровень заточки (0..15), значение — процент.
        ENCHANT_MULTIPLIERS: [0, 4, 9, 15, 22, 31, 42, 56, 74, 97, 125, 160, 200, 250, 310, 400],

        // Цена попытки заточки в % от стоимости предмета (из 05_Mechanics.md).
        // ВНИМАНИЕ: это идеальная (минимальная) стоимость без учёта шансов —
        // считается, что все попытки успешны с первой. Индекс = уровень.
        // v11.6.5e: ребаланс — новая шкала цен и нулевой минимум. Живая
        // таблица игры имеет приоритет: см. liveEnchantPricePct() /
        // liveEnchantPriceMin() ниже, это фолбэк.
        ENCHANT_PRICES: [0, 0.5, 0.5, 1, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10],
        ENCHANT_PRICE_MIN: 0,

        // Расширенные характеристики (xstats) из game-data.js.
        // Заточка для них применяется с множителем enchK = 0.25 (÷4).
        XSTAT_KEYS: new Set(['crit', 'critDmg', 'dodge', 'pierce', 'healPow', 'luck', 'resist']),
        ENCHANT_K: 0.25,

        /*
         * v11.6.3: правила снаряжения из lib/game-data.js.
         *
         * CLASS_GEAR — тип брони класса (classGear), CLASS_SHIELD — право
         * носить тяжёлый щит (shieldOk). Для мага/жреца/некроманта щит
         * запрещён, но тканевый «щит» — это магический фокус (isFocusItem),
         * поэтому проверяется по cloth-ветке, а не по shieldOk().
         *
         * GEAR_PEN — штраф к основному стату за чужой слот (armor/helmet/
         * shield), GEAR_PEN_CAP — потолок суммарного штрафа.
         */
        CLASS_GEAR: { legionary: 'heavy', archer: 'light', mage: 'cloth', priest: 'cloth', rogue: 'light', necromancer: 'cloth', paladin: 'heavy' },
        CLASS_SHIELD: { legionary: true, paladin: true },
        GEAR_PEN: { armor: 25, helmet: 10, shield: 15 },
        GEAR_PEN_CAP: 50,
        GEAR_NAMES: { heavy: 'тяжёлое', light: 'лёгкое', cloth: 'ткань', any: 'для всех' },

        /*
         * v11.6.5b: максимальная цена лота на аукционе, медь.
         * Игра присылает тот же лимит в cfg.maxPrice из /api/auction —
         * конфиг канала имеет приоритет (см. Auction.maxLotPrice()), а это
         * значение нужно как фолбэк и для проверки цены до открытия витрины.
         */
        AUCTION_MAX_PRICE: 99990000
    };

    /*
     * ------------------------------------------------------------
     * v11.6.5e: ЖИВАЯ ТАБЛИЦА ЗАТОЧКИ ИЗ ИГРЫ (защита от ребалансов).
     *
     * Игра публикует таблицу в window.LG_GAME_DATA.enchant
     * (reference/LegionFrontSRC/lib/game-data.js):
     *   chance[0..15]     — шанс успеха, %;
     *   price[0..15]      — цена попытки, % от стоимости предмета;
     *   priceMin          — минимум цены попытки, медь;
     *   coins.star/sphere — цена ресурсов заточки у кузнеца, медь.
     *
     * Всё, что лежит в GAME_DATA выше (и HeroPlanner.ENCH.chance), — фолбэк:
     * таблицы может ещё не быть (run-at document-start) или она сменит
     * формат. Читаем строго через G (unsafeWindow): из песочницы
     * Tampermonkey window.LG_GAME_DATA вернёт undefined.
     * ------------------------------------------------------------
     */
    const liveEnchant = () => {
        try {
            const e = G.LG_GAME_DATA && G.LG_GAME_DATA.enchant;
            return (e && typeof e === 'object') ? e : null;
        } catch (err) {
            return null;
        }
    };

    // Шанс успеха, % (NaN — живой таблицы нет, вызывающий берёт свой фолбэк).
    const liveEnchantChance = (level) => {
        const live = liveEnchant();
        if (!live || !Array.isArray(live.chance)) return NaN;
        const v = +live.chance[Math.min(15, +level || 0)];
        return Number.isFinite(v) ? v : NaN;
    };

    // Цена попытки, % от стоимости предмета (фолбэк — GAME_DATA.ENCHANT_PRICES).
    const liveEnchantPricePct = (level) => {
        const i = Math.min(15, +level || 0);
        const live = liveEnchant();
        if (live && Array.isArray(live.price)) {
            const v = +live.price[i];
            if (Number.isFinite(v)) return v;
        }
        return GAME_DATA.ENCHANT_PRICES[i] || 0;
    };

    // Минимальная цена попытки, медь (фолбэк — GAME_DATA.ENCHANT_PRICE_MIN).
    const liveEnchantPriceMin = () => {
        const live = liveEnchant();
        const v = live ? +live.priceMin : NaN;
        return Number.isFinite(v) ? v : GAME_DATA.ENCHANT_PRICE_MIN;
    };

    /*
     * ------------------------------------------------------------
     * v11.6.3: ПРИВЯЗКА ПРЕДМЕТОВ (новое правило игры).
     *
     * bound(it) = legendary && slot !== 'material' && !it.mat:
     * легендарная экипировка персональная, её нельзя передать через
     * трейд, выставить на аукцион или сдать в утиль. Материалы
     * (slot === 'material' либо флаг mat) под правило не попадают.
     * Если сервер уже прислал явный флаг bound:true — верим ему.
     * ------------------------------------------------------------
     */
    const isBoundItem = (it) => !!(it && (it.bound === true ||
        (it.rarity === 'legendary' && it.slot !== 'material' && !it.mat)));
    const BOUND_LINE = 'Привязана: не передаётся';

    /*
     * v11.6.3: магический фокус (isFocus в game-data.js) — предмет
     * в слоте shield с gear === 'cloth'. Для магов/жрецов он заменяет
     * щит: штраф за «чужой» shield не начисляется, проверка идёт по cloth.
     */
    const isFocusItem = (it) => !!(it && it.slot === 'shield' && it.gear === 'cloth');

    // Единый объект утилит: наполняется модулями utils-* сразу после
    // объявления, поэтому к вызову кода из main.js он содержит всё нужное.
    const Utils = {};

    // --- Базовые утилиты (строки, промисы, задержки) ---
    const UtilsBase = {
        sleep: (ms) => new Promise(r => setTimeout(r, ms)),
        escapeHtml(s) {
            return String(s || '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },
        escapeRegex(s) {
            return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        },
        safeUrl(s) {
            if (!s) return '';
            try {
                return encodeURI(String(s)).replace(/"/g, '%22').replace(/'/g, '%27');
            } catch { return ''; }
        },
        randomDelay(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        },
    };
    Object.assign(Utils, UtilsBase);

    const randomDelay = (min, max) => Utils.randomDelay(min, max);
