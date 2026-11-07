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
        ENCHANT_PRICES: [0, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5.5, 7.5, 10, 13, 17, 22, 28, 35],
        ENCHANT_PRICE_MIN: 10,

        // Расширенные характеристики (xstats) из game-data.js.
        // Заточка для них применяется с множителем enchK = 0.25 (÷4).
        XSTAT_KEYS: new Set(['crit', 'critDmg', 'dodge', 'pierce', 'healPow', 'luck', 'resist']),
        ENCHANT_K: 0.25
    };

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
