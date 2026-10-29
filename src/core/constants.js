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
        btnFriends: `${RAND_ID}-btn-friends`,
        friendsBadge: `${RAND_ID}-friends-badge`,
        btnChatToggle: `${RAND_ID}-btn-chat-toggle`,
        btnPopout: `${RAND_ID}-btn-popout`,
        btnPocketCity: `${RAND_ID}-btn-pocket-city`,
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
    const Y_MAP = { 30: 80, 20: 230, 10: 380, 5: 530, 0: 680 };
    const SKIP_FX_PREFIXES = ['ctl_', 'act_', 'cd_'];

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
