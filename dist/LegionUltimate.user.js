// ==UserScript==
// @name         Legion: Ultimate Assistant (Auction, Pocket City, Party)
// @namespace    http://tampermonkey.net/
// @version      11.7.0
// @description  QoL-аддон для Легиона: Сканер аукциона, Разведка, Планировщик, Карманный город, Пати, Поход.
// @connect      localhost
// @connect      127.0.0.1
// @connect      legion.ctrlfree.host
// @connect      legiongame.gg
// @author       eciell
// @match        https://legiongame.gg/c/*
// @noframes
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/Eciell/Legion-Ultimate-Assistant/main/dist/LegionUltimate.user.js
// @downloadURL  https://raw.githubusercontent.com/Eciell/Legion-Ultimate-Assistant/main/dist/LegionUltimate.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ===== src/core/constants.js =====
    // ============================================================
    // 0. КОНСТАНТЫ, КЭШИ И БАЗОВЫЕ УТИЛИТЫ (core/constants.js)
    //
    // Подключается ПЕРВЫМ (см. CORE_ORDER в build.js): здесь объявляются
    // G, DEBUG/dbg, RAND_ID, DOM_IDS, API_BASE, общие константы, глобальные
    // кэши и пустой объект Utils. Методы в него добавляют utils-format /
    // utils-api / utils-art / utils через Object.assign — порядок
    // подключения критичен для TDZ (const/let).
    // ============================================================
    const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    const DEBUG = false;
    const dbg = (...a) => DEBUG && console.log('[LEGION]', ...a);

    // 0.1. ГЛОБАЛЬНЫЙ КЭШ ОНЛАЙНА ИГРОКОВ (сетевой перехват)
    window.__lgOnlinePlayers = window.__lgOnlinePlayers || new Map();
    window.__lgMineTotalHere = window.__lgMineTotalHere || 0;
    // 11.6.6c: отметка старта аддона — верхняя граница длительности сессий
    // (трекер онлайна не может знать о заходе раньше, чем мы запустились).
    G.__lguStartTime = G.__lguStartTime || Date.now();

    // «Арена» (modules/arena.js): контекст экрана (x из LGArena.open) и
    // последний снимок GET /api/arena. Заполняются в core/hooks.js —
    // до первого открытия арены оба значения null, а не undefined, чтобы
    // модуль мог проверять их без лишних typeof.
    G.__lgArenaContext = G.__lgArenaContext || null;
    G.__lgArenaData = G.__lgArenaData || null;

    // 0.0. РАНДОМИЗАЦИЯ DOM-ПРЕФИКСОВ
    const RAND_ID = 'x-' + Math.random().toString(36).substring(2, 6);

    const DOM_IDS = {
        fabWrap: `${RAND_ID}-fab-wrap`,
        fabMenu: `${RAND_ID}-fab-menu`,
        fabBtn: `${RAND_ID}-fab-btn`,
        fabIcon: `${RAND_ID}-fab-icon`,
        btnAutoMine: `${RAND_ID}-btn-auto-mine`,
        hudDragHandle: `${RAND_ID}-hud-drag-handle`,
        btnBuildSim: `${RAND_ID}-btn-build-sim`,
        btnAuctionScan: `${RAND_ID}-btn-auction-scan`,
        btnPlayers: `${RAND_ID}-btn-players`,
        btnPocketCity: `${RAND_ID}-btn-pocket-city`,
        // v11.6.0: «Пати» (modules/party.js) — кнопка в блоке «Социальное».
        btnParty: `${RAND_ID}-btn-party`,
        btnProfile: `${RAND_ID}-btn-profile`,
        // Модуль «Арена» (modules/arena.js): собственные классы/идентификаторы
        // вставок. Префикс RAND_ID нужен, чтобы после перезапуска скрипта
        // stale-копии можно было найти и убрать в destroy(), не задевая
        // нативную разметку арены (.arb / .av-root.av-wrap.arb в arena2.js).
        arenaBadgeBox: `${RAND_ID}-arena-badge-box`,
        arenaWinChance: `${RAND_ID}-arena-win-chance`,
        arenaFoeWarn: `${RAND_ID}-arena-foe-warn`,
        arenaGuildList: `${RAND_ID}-arena-guild-list`,
        arenaGuildTab: `${RAND_ID}-arena-guild-tab`,
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
    const API_BASE = (G && G.LG_BASE) || window.LG_BASE || (location.pathname.match(/^\/c\/[^/]+/)?.[0] || '');
    const MAX_POINTS = 50;

    /*
     * ------------------------------------------------------------
     * 0.9. НАСТРОЙКИ АДДОНА (v11.7.0)
     *
     * Реестр переключателей модалки «⚙️ Настройки аддона» (core/ui.js):
     * ключ localStorage + значение по умолчанию. Глобального состояния нет,
     * значение читается по месту через Settings.get(), поэтому тумблер
     * начинает работать сразу после клика — без перезагрузки страницы.
     *
     * autoSkipMonsters — автоскип боёв с обычными и элитными монстрами.
     * Наблюдатель и клики по нативным кнопкам .cm-dlg живут в
     * modules/pocket-city.js (PocketCity.startMonsterAutoSkip / init).
     *
     * citymonGatherEnabled — уведомления о сборах гильдии на элитных монстров
     * (по умолчанию false — выключено, включается пользователем вручную).
     *
     * citymonGatherSize — размер плашки уведомлений: 'S' / 'M' / 'L' (по умолчанию 'L').
     * ------------------------------------------------------------
     */
    const DEFAULT_SETTINGS = Object.freeze({
        autoSkipMonsters: false,
        citymonGatherEnabled: false,
        citymonGatherSize: 'L',
    });
    const SETTINGS_KEYS = Object.freeze({
        autoSkipMonsters: 'LEGION_AUTO_SKIP_MONSTERS',
        citymonGatherEnabled: 'LEGION_CITYMON_GATHER_ENABLED',
        citymonGatherSize: 'LEGION_CITYMON_GATHER_SIZE',
    });
    const Settings = {
        // Есть ли такая настройка в реестре (защита от опечаток в имени).
        has(name) {
            return Object.prototype.hasOwnProperty.call(SETTINGS_KEYS, name);
        },
        // Чтение настройки: нет ключа (или он пуст) — значение по умолчанию.
        // Исключение доступа (приватный режим / заблокированное хранилище)
        // тоже даёт дефолт, чтобы UI не падал.
        get(name) {
            const def = Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, name)
                ? DEFAULT_SETTINGS[name]
                : false;
            if (!Settings.has(name)) return def;
            try {
                const raw = localStorage.getItem(SETTINGS_KEYS[name]);
                if (raw === null || raw === '') return def;
                if (typeof def === 'boolean') return raw === 'true';
                return raw;
            } catch (e) {
                return def;
            }
        },
        // Запись настройки: boolean сохраняется 'true'/'false', string — строкой.
        set(name, value) {
            if (!Settings.has(name)) return false;
            try {
                const val = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
                localStorage.setItem(SETTINGS_KEYS[name], val);
                return true;
            } catch (e) {
                dbg('[Settings] не удалось сохранить настройку', name, e);
                return false;
            }
        },
    };
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
        // Заточка для них применяется с множителем enchK = 0.25 (÷4),
        // поэтому первичные статы (hp/atk/mag/def) и вторичные (crit, critDmg,
        // dodge, pierce, healPow, luck, resist) считаются по одной формуле,
        // но с разным эффективным процентом — см. HeroPlanner.enchantStat().
        XSTAT_KEYS: new Set(['crit', 'critDmg', 'dodge', 'pierce', 'healPow', 'luck', 'resist']),
        ENCHANT_K: 0.25,

        /*
         * v11.7 (клиент b62dcb896a): слоты, которые точит кузнец.
         *
         * Живая таблица игры (LG_GAME_DATA.enchant.slots) официально содержит
         * пять слотов, включая амулет: ['weapon','shield','armor','helmet',
         * 'trinket']. Этот список — фолбэк на случай, когда таблица ещё не
         * пришла (run-at document-start); приоритет живой таблицы отдаёт
         * liveEnchantSlots() ниже.
         */
        ENCHANT_SLOTS: ['weapon', 'shield', 'armor', 'helmet', 'trinket'],

        /*
         * v11.6.3 (актуализировано в v11.7): правила снаряжения из
         * lib/game-data.js.
         *
         * CLASS_GEAR — тип брони класса (classGear), CLASS_SHIELD — право
         * носить тяжёлый защитный щит (shieldOk). Для мага/жреца/некроманта
         * щит запрещён, но тканевый «щит» — это магический фокус
         * (isFocusItem), а предмет с флагом role — оффхенд-оружие
         * (isOffhandItem). Оба проверяются отдельными ветками, а не по
         * shieldOk().
         *
         * Новые классы обновления b62dcb896a:
         *   paladin     — тяжёлая броня, носит защитные щиты (shield: true);
         *   rogue       — лёгкая броня, тяжёлых щитов нет, оффхенд-оружие;
         *   necromancer — ткань, магические фокусы.
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
         * v11.7: русские названия классов (game-data.js: classes[].name).
         * Единый словарь для чата, сводки гильдии и инспектора героя —
         * сервер обычно отдаёт hero.roleName готовым, это фолбэк.
         */
        CLASS_NAMES: {
            recruit: 'Новобранец',
            legionary: 'Легионер',
            archer: 'Лучник',
            mage: 'Маг',
            priest: 'Жрец',
            rogue: 'Разбойник',
            necromancer: 'Некромант',
            paladin: 'Паладин'
        },

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

    // v11.7: слоты заточки из живой таблицы игры (enchant.slots). В клиенте
    // b62dcb896a их пять, включая 'trinket' (амулет). Если таблицы ещё нет
    // или она сменила формат — берём фолбэк GAME_DATA.ENCHANT_SLOTS.
    const liveEnchantSlots = () => {
        const live = liveEnchant();
        const list = live && Array.isArray(live.slots)
            ? live.slots.filter((s) => typeof s === 'string' && s)
            : null;
        return (list && list.length) ? list : GAME_DATA.ENCHANT_SLOTS;
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
     * v11.6.3 (актуализировано в v11.7): вторая рука из lib/game-data.js.
     *
     * Слот 'shield' в игре — это «вторая рука» и три разных типа предметов:
     *   isFocusItem   — магический фокус (gear === 'cloth'): маг/жрец/некромант
     *                   носит вместо щита, штрафа за «чужой» слот нет;
     *   isOffhandItem — оффхенд-оружие (есть role и gear !== 'cloth'):
     *                   разрешено только классу из it.role;
     *   isShieldItem  — защитный щит: разрешён лишь классам с shieldOk()
     *                   (legionary, paladin).
     * holdsShield(items) — есть ли в наборе надетый защитный щит; фокусы и
     * оффхенд-оружие щитом не считаются.
     */
    const isFocusItem = (it) => !!(it && it.slot === 'shield' && it.gear === 'cloth');
    const isOffhandItem = (it) => !!(it && it.slot === 'shield' && it.role && it.gear !== 'cloth');
    const isShieldItem = (it) => !!(it && it.slot === 'shield' && !isFocusItem(it) && !isOffhandItem(it));
    // on !== false: в ответах /api/guilds/hero и /api/arena/hero список items[]
    // уже содержит только надетые вещи, поля on там может не быть.
    const holdsShield = (items) => (Array.isArray(items) ? items : [])
        .some((x) => x && x.on !== false && isShieldItem(x));

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

    // ===== src/core/utils-format.js =====
    // ============================================================
    // 0.2. УТИЛИТЫ ФОРМАТИРОВАНИЯ (core/utils-format.js)
    // Деньги/монеты, статистика и время. Методы обращаются друг к другу
    // через this.* (после Object.assign this === Utils), как и раньше.
    // ============================================================
    const UtilsFormat = {
        calculateMedian(arr) {
            if (!arr.length) return 0;
            const s = [...arr].sort((a, b) => a - b);
            const m = Math.floor(s.length / 2);
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        },
        formatMoney(n) {
            n = Math.max(0, Math.floor(+n || 0));
            const g = Math.floor(n / 10000);
            const s = Math.floor(n / 100) % 100;
            const b = n % 100;
            const parts = [];
            if (g) parts.push(`${g} з`);
            if (s) parts.push(`${s} с`);
            if (b || (!g && !s)) parts.push(`${b} б`);
            return parts.join(' ');
        },
        // Разбор «12 з 34 с 56 б» → 123456
        parseCoinsText(str) {
            if (!str) return 0;
            let total = 0, matched = false;
            const g = String(str).match(/(\d+)\s*(?:з|зол)/i);
            const s = String(str).match(/(\d+)\s*(?:с|сер)/i);
            const b = String(str).match(/(\d+)\s*(?:б|мед)/i);
            if (g) { total += parseInt(g[1], 10) * 10000; matched = true; }
            if (s) { total += parseInt(s[1], 10) * 100; matched = true; }
            if (b) { total += parseInt(b[1], 10); matched = true; }
            return matched ? total : 0;
        },
        // Форматирование числа в HTML с иконками монет
        formatCoinsHtml(n) {
            n = Math.max(0, Math.floor(+n || 0));
            const g = Math.floor(n / 10000), s = Math.floor(n / 100) % 100, b = n % 100;
            const parts = [];
            if (g) parts.push(`<span>${g}<i class="b-coin-ico g" title="золотые"></i></span>`);
            if (s) parts.push(`<span>${s}<i class="b-coin-ico s" title="серебряные"></i></span>`);
            if (b || (!g && !s)) parts.push(`<span>${b}<i class="b-coin-ico b" title="медные"></i></span>`);
            const label = this.formatMoney(n);
            return `<span class="b-coin-wrap" role="img" aria-label="${label}" title="${label}">${parts.join(' ')}</span>`;
        },
        formatTimeLeft(ms) {
            if (!ms) return '—';
            const diff = ms - Date.now();
            if (diff <= 0) return 'Истек';
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            return `${h}ч ${m}м`;
        },
    };
    Object.assign(Utils, UtilsFormat);

    // ===== src/core/utils-api.js =====
// ============================================================
// 0.3. СЕТЕВОЙ СЛОЙ (core/utils-api.js)
// ============================================================
const UtilsApi = (() => {
    const G = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

    return {
        apiPath(p) {
            const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || G;
            const base = (win && win.LG_BASE) || (typeof location !== 'undefined' ? location.pathname.match(/^\/c\/[^/]+/)?.[0] : '') || API_BASE || '';
            if (!p) return base;
            if (p.startsWith('/c/')) return p;
            return base + (p.startsWith('/') ? p : '/' + p);
        },
        async fetchApi(path, body, signal) {
            // Поддержка обоих форматов:
            // 1) Utils.fetchApi(path, payload, signal) — payload как тело POST-запроса
            // 2) Utils.fetchApi(path, { method, headers, body, signal }) — явные опции fetch
            let method = 'GET';
            let headers = {};
            let requestBody = undefined;
            let reqSignal = signal;

            const isOptionsObj = body && typeof body === 'object' && ('method' in body || 'body' in body || 'headers' in body);
            if (isOptionsObj) {
                method = body.method || (body.body ? 'POST' : 'GET');
                headers = Object.assign({}, body.headers);
                requestBody = typeof body.body === 'object' ? JSON.stringify(body.body) : body.body;
                if (body.signal) reqSignal = body.signal;
            } else if (body !== undefined && body !== null) {
                method = 'POST';
                headers = { 'Content-Type': 'application/json' };
                requestBody = typeof body === 'string' ? body : JSON.stringify(body);
            }

            // Нативные контексты игры
            const nativeCtx = G.__lgAucContext || G.X;
            if (nativeCtx && typeof nativeCtx.api === 'function') {
                try {
                    let nativePayload = undefined;
                    if (isOptionsObj) {
                        nativePayload = body.body ? (typeof body.body === 'string' ? JSON.parse(body.body) : body.body) : undefined;
                    } else if (body !== undefined && body !== null) {
                        nativePayload = typeof body === 'string' ? JSON.parse(body) : body;
                    }
                    const res = await (nativePayload !== undefined ? nativeCtx.api(path, nativePayload) : nativeCtx.api(path));
                    if (res) {
                        const result = { ok: true, body: res, data: res, status: 200 };
                        if (typeof res === 'object' && !Array.isArray(res)) Object.assign(result, res);
                        return result;
                    }
                } catch (e) { /* если упало, идем в обычный fetch */ }
            }

            const url = this.apiPath(path);
            const opts = { credentials: 'same-origin', cache: 'no-store' };
            if (reqSignal) opts.signal = reqSignal;
            if (method) opts.method = method;
            if (Object.keys(headers).length) opts.headers = headers;
            if (requestBody !== undefined) {
                opts.body = requestBody;
                if (!opts.headers) opts.headers = {};
                if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
            }

            try {
                // v11.7.0: используем win.fetch (пропатченный страницей fetch с префиксом канала)
                // с фолбэком на нативный fetch песочницы Tampermonkey.
                const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || G;
                const fetchFn = (win && typeof win.fetch === 'function') ? win.fetch.bind(win) : fetch;
                const res = await fetchFn(url, opts);
                const data = await res.json().catch(() => null);
                const result = {
                    status: res.status,
                    ok: res.ok && (data ? data.ok !== false : true),
                    body: data,
                    data: data
                };
                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    Object.assign(result, data);
                }
                return result;
            } catch (err) {
                dbg('fetchApi error:', err);
                return { status: 0, ok: false, body: null, error: err.message };
            }
        },
    };
})();
Object.assign(Utils, UtilsApi);

    // ===== src/core/utils-art.js =====
    // ============================================================
    // 0.4. АРТ ПРЕДМЕТОВ И ДЕКОРАЦИЯ UI (core/utils-art.js)
    // isRealItemSvg остаётся отдельной функцией: она нужна и как метод
    // Utils.isRealItemSvg, и как локальный хелпер внутри модуля.
    // ============================================================
    // Реальный SVG-арт предмета.
    // Заглушка LGInventory.art / ctx.art = один <rect> с заливкой (коричневый
    // квадрат в .b-lot-art), поэтому требуем:
    //   1) длину ≥ 100 байт (реальные арты заметно больше);
    //   2) <path> ИЛИ ≥ 2 фигуры circle/ellipse/polygon/polyline/line.
    // <rect> без <path> и без других фигур не проходит никогда.
    function isRealItemSvg(svg) {
        if (!svg || typeof svg !== 'string') return false;
        if (svg.length < 100) return false;
        const hasPath = /<path[\s\/>]/i.test(svg);
        const shapes = svg.match(/<(circle|ellipse|polygon|polyline|line)[\s\/>]/gi);
        const shapeCount = shapes ? shapes.length : 0;
        return hasPath || shapeCount >= 2;
    }

    const UtilsArt = {
        isRealItemSvg,
        // SVG арт предмета. Сначала контексты игры (в аукционе это самый
        // надёжный источник), затем библиотека инвентаря. Заглушку-<rect>
        // отсекает isRealItemSvg().
        getItemArtSvg(lot, def) {
            try {
                lot = lot || {};
                const it = { id: lot.i, ...(def || {}), en: +lot.en || 0 };

                // ВАЖНО: в песочнице Tampermonkey (после @grant) window не видит
                // объекты страницы. Используем unsafeWindow (или G), если он доступен.
                const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

                // 1. Контексты игры: аукцион и текущий экранный контекст G.X.
                // 11.6.4b: __lgCityContext/__lgMineContext удалены вместе с
                // хуками LGCity.open / LGMine.open (детект античита шахты).
                // Вызов каждого контекста изолирован: упавший art() не должен
                // обрывать цепочку и лишать предмет картинки.
                const ctxs = [
                    G.__lgAucContext,
                    G.X,        // глобальный контекст/арт-резолвер игры
                    G.LGCity,   // город сам умеет art() (фолбэк контекста города)
                    G.LGtine,   // запасной глобальный резолвер
                    { art: G.art, owner: G },     // глобальный метод игры
                    { art: G.fig, owner: G },     // запасной
                    { art: G.doodle, owner: G }   // запасной
                ].filter(Boolean);
                for (const ctx of ctxs) {
                    if (!ctx || typeof ctx.art !== 'function') continue;
                    let svg = '';
                    // owner нужен, чтобы G.art() вызывался с this === G
                    try { svg = ctx.art.call(ctx.owner || ctx, it); } catch (e) { svg = ''; }
                    if (isRealItemSvg(svg)) return svg;
                }

                // 2. Фолбэк на библиотеку инвентаря
                const inv = G.LGInventory || G.LGItems || window.LGInventory;
                if (inv && typeof inv.art === 'function') {
                    let svg = '';
                    try { svg = inv.art(it); } catch (e) { svg = ''; }
                    if (isRealItemSvg(svg)) return svg;
                }
            } catch (e) {}
            return '';
        },
        // Арт предмета: реальный SVG → официальная иконка игры → эмодзи.
        // SVG идёт первым: именно так рисует нативный аукцион, и при полном
        // def (slot/look/rarity) LGInventory.art даёт настоящую картинку.
        // Заглушку-<rect> отсекает isRealItemSvg().
        getItemArtHtml(lot, def) {
            lot = lot || {};

            // 1. Настоящий SVG через контексты игры / LGInventory.art.
            // Приоритет над MDDoodle-иконкой: именно так рисует нативный
            // аукцион, и при полном def (slot/look/rarity) SVG гарантирован.
            const svg = this.getItemArtSvg(lot, def);
            if (svg) return svg;

            // 2. Официальная иконка из игры (MDDoodle) — если SVG не получился
            const icon = this.getItemIcon(lot.i);
            if (icon && icon.length > 5) {
                return `<img src="${this.safeUrl(icon)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;display:block;" onerror="this.style.display='none'">`;
            }

            // 3. Эмодзи по слоту/имени
            const slot = (def && def.slot) || '';
            const name = String((def && def.name) || lot.name || lot.i || '').toLowerCase();
            let ico = '📦';
            if (slot === 'weapon') ico = '⚔️';
            else if (slot === 'armor') ico = '🛡️';
            else if (slot === 'shield') ico = '🛡️';
            else if (slot === 'helmet') ico = '🪖';
            else if (slot === 'trinket') ico = '📿';
            else if (slot === 'food') ico = '🍖';
            else if (slot === 'potion') ico = '🧪';
            else if (slot === 'scroll') ico = '📜';
            else if (slot === 'material') ico = '💎';
            else if (/шлем|каск|колпак|шапк|тиар|корон/i.test(name)) ico = '🪖';
            else if (/меч|кинжал|топор|молот|булав|посох|копьё|лук|арбалет|гладиус/i.test(name)) ico = '⚔️';
            else if (/рогатк|снаряд|праща/i.test(name)) ico = '🏹';
            else if (/брон|доспех|латы|мантия|роба|куртка/i.test(name)) ico = '🛡️';
            else if (/щит/i.test(name)) ico = '🛡️';
            else if (/амулет|кольцо|подвеск|оберег/i.test(name)) ico = '📿';
            else if (/вобл|рыб|мясо|хлеб|яблоко|пирог|сыр|корм|еда/i.test(name)) ico = '🐟';
            else if (/зелье|эликсир|напиток/i.test(name)) ico = '🧪';
            else if (/свиток|печать|грамот/i.test(name)) ico = '📜';
            else if (/звезд|сфер|кристалл|камень|руда|слиток/i.test(name)) ico = '💎';
            return `<span style="font-size:22px;line-height:1;user-select:none;">${ico}</span>`;
        },
        // Заменить текст монет на иконки. Идём по текстовым узлам, чтобы
        // не потерять вложенные значения (например, «(цена за штуку)»).
        decorateMoneyText(el) {
            if (!el || el.hasAttribute('data-lg-money')) return;
            el.setAttribute('data-lg-money', '1');

            const doc = el.ownerDocument || document;
            const showText = (typeof NodeFilter !== 'undefined') ? NodeFilter.SHOW_TEXT : 4;
            let walker = null;
            try { walker = doc.createTreeWalker(el, showText, null); } catch (e) { walker = null; }

            if (!walker) {
                const total = this.parseCoinsText(el.textContent || '');
                if (total > 0) el.innerHTML = this.formatCoinsHtml(total);
                return;
            }

            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);

            for (const tn of nodes) {
                const amount = this.parseCoinsText(tn.nodeValue);
                if (amount <= 0) continue;
                const holder = doc.createElement('span');
                holder.innerHTML = this.formatCoinsHtml(amount);
                const coinEl = holder.firstElementChild;
                if (coinEl && tn.parentNode) tn.parentNode.replaceChild(coinEl, tn);
            }
        },
        // Обогатить строки таблицы аукциона: арт + иконки монет.
        // id/имя предмета приходят из data-атрибутов строки (auction.js),
        // data-lg-lot — метка «уже обработано».
        // 11.6.2c.5: строка — карточка (.auc-item-flex > .auc-item-info),
        // поэтому арт монтируется ПЕРВЫМ ребёнком .auc-item-flex (слева от
        // .auc-item-info), а не в плоскую <td>. Плоский вариант оставлен
        // фолбэком для старой разметки.
        enhanceAuctionRows(container, itemsMap) {
            if (!container) return;
            const rows = container.querySelectorAll('tr:not([data-lg-lot])');
            if (!rows || !rows.length) return;

            rows.forEach(row => {
                row.setAttribute('data-lg-lot', '1');
                const cells = row.querySelectorAll('td');
                // Строка «Ничего не найдено» — одна ячейка, арта и цен нет.
                if (cells.length < 3) return;

                const itemCell = cells[0];
                // Контейнер карточки: арт ставим перед .auc-item-info.
                const flexBox = itemCell.querySelector('.auc-item-flex') || itemCell;
                if (itemCell.querySelector('.b-lot-art')) return;

                const itemId = row.getAttribute('data-lot-id') || '';
                const lotName = row.getAttribute('data-lot-name') || '';
                // Полный предмет из itemsMap: {name, slot, look, rarity, ...}.
                // Без slot LGInventory.art падает в <rect fill="#a0703a">, и
                // isRealItemSvg отбрасывает заглушку -> эмодзи.
                const def = (itemsMap && itemId && itemsMap[itemId]) ? { ...itemsMap[itemId] } : { name: lotName };

                const artDiv = document.createElement('div');
                artDiv.className = 'b-lot-art';

                const existingImg = itemCell.querySelector('img');
                if (existingImg && existingImg.src && !existingImg.src.endsWith('/')) {
                    // Иконку игры переносим в арт-бокс (размеры задаёт CSS)
                    const cloned = existingImg.cloneNode(true);
                    try { cloned.removeAttribute('style'); } catch (e) {}
                    artDiv.appendChild(cloned);
                    existingImg.remove();
                } else {
                    if (existingImg) existingImg.remove();
                    artDiv.innerHTML = this.getItemArtHtml({ i: itemId, name: lotName }, def);
                }
                artDiv.title = lotName;

                if (flexBox !== itemCell) {
                    // 11.6.2c.5: карточка — арт слева от .auc-item-info.
                    flexBox.insertBefore(artDiv, flexBox.firstChild);
                } else {
                    // Фолбэк: плоская ячейка (старая разметка).
                    itemCell.style.display = 'flex';
                    itemCell.style.alignItems = 'center';
                    itemCell.style.gap = '8px';
                    itemCell.insertBefore(artDiv, itemCell.firstChild);
                }

                // Декорируем цены: 11.6.2c.5 — в таблице 6 колонок, деньги
                // только в «Цене» (индекс 1) и «Медиане» (индекс 2).
                for (let i = 1; i <= 2 && i < cells.length; i++) {
                    this.decorateMoneyText(cells[i]);
                }
            });
        },
        // Обогатить лоты в досье игрока (арт + иконки монет).
        // id берём из data-lot кнопки «Купить», имя — из карточки.
        enhanceDossierLots(container, itemsMap) {
            if (!container) return;
            container.querySelectorAll('.dossier-buy-btn').forEach(btn => {
                if (btn.hasAttribute('data-lg-lot')) return;
                btn.setAttribute('data-lg-lot', '1');

                const card = btn.parentElement && btn.parentElement.parentElement;
                if (!card) return;

                const lotId = btn.getAttribute('data-lot') || '';
                const lotName = ((card.querySelector('span[style*="font-weight:bold"], b') || {}).textContent || '').trim();
                const price = +btn.getAttribute('data-price') || 0;

                // data-lot — это id ЛОТА (напр. L2l28g), не id предмета.
                // Находим лот в Players._lastLots, берём l.i (id предмета) и
                // полный def из itemsMap. Без slot LGInventory.art вернёт
                // <rect fill="#a0703a">, и isRealItemSvg() отбросит заглушку.
                let itemId = lotId;
                let def = { name: lotName };
                try {
                    const lots = (typeof Players !== 'undefined' && Array.isArray(Players._lastLots)) ? Players._lastLots : [];
                    const lot = lots.find(x => x && x.id === lotId) || lots.find(x => x && x.i === lotId);
                    if (lot && lot.i) itemId = lot.i;
                    if (itemsMap && itemId && itemsMap[itemId]) def = { ...itemsMap[itemId] };
                } catch (e) {}

                const artSlot = card.querySelector('.b-lot-art');
                if (!artSlot) {
                    const artDiv = document.createElement('div');
                    artDiv.className = 'b-lot-art';

                    const existingImg = card.querySelector('img');
                    if (existingImg && existingImg.src && !existingImg.src.endsWith('/')) {
                        const cloned = existingImg.cloneNode(true);
                        try { cloned.removeAttribute('style'); } catch (e) {}
                        artDiv.appendChild(cloned);
                        existingImg.remove();
                    } else {
                        if (existingImg) existingImg.remove();
                        artDiv.innerHTML = this.getItemArtHtml({ i: itemId, name: lotName }, def);
                    }
                    artDiv.title = lotName;

                    card.insertBefore(artDiv, card.firstChild);
                }

                if (price > 0) {
                    const priceEl = card.querySelector('span[style*="color:#ffd700"]');
                    if (priceEl) priceEl.innerHTML = this.formatCoinsHtml(price);
                }
            });
        },
        getItemName(id, itemsMap = null) {
            if (!id) return '—';
            try {
                if (itemsMap && itemsMap[id]?.name) return itemsMap[id].name;
                const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
                const mdName = G.MDDoodle?.names?.[id] || G.MDDoodle?.names?.cats?.items?.[id]?.name;
                if (mdName) return mdName;
            } catch (e) {}

            const KNOWN_ITEMS = {
                enchant_star: 'Звезда заточки',
                star: 'Звезда',
                sphere: 'Сфера',
                aurus: 'Аурус',
                seal_fire: 'Печать огня',
                seal_water: 'Печать воды',
                seal_earth: 'Печать земли',
                seal_air: 'Печать воздуха',
                scroll_tp: 'Свиток телепортации',
                scroll_res: 'Свиток воскрешения',
                potion_hp: 'Зелье здоровья',
                potion_mp: 'Зелье маны',
                ore_iron: 'Железная руда',
                ore_gold: 'Золотая руда',
                gem_ruby: 'Рубин',
                gem_sapphire: 'Сапфир',
                gem_emerald: 'Изумруд',
                gem_diamond: 'Алмаз'
            };
            if (KNOWN_ITEMS[id]) return KNOWN_ITEMS[id];

            if (typeof id === 'string' && id.includes('_')) {
                return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            }
            return String(id);
        },
        // Умный парсер: определяет слот, редкость и класс по ID предмета.
        // Вынесено из modules/auction.js (v11.6.0, этап 4): мета нужна и арту
        // строк (enhanceAuctionRows/enhanceDossierLots), и сканеру аукциона,
        // поэтому живёт в core рядом с getItemName/getItemIcon.
        // В песочнице window — прокси без игровых объектов, справочник читаем
        // из unsafeWindow (G), как это делает getItemName.
        getItemMeta(id, rarityHint = '') {
            if (!id) return { slot: '', rarity: '', role: '' };

            let item = {};
            try {
                const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
                item = G.MDDoodle?.names?.cats?.items?.[id] || {};
            } catch(e) {}

            let slot = item.slot || '';
            // Приоритет: серверное значение лота → справочник MDDoodle → эвристика по ID
            let rarity = (rarityHint ? String(rarityHint).toLowerCase().trim() : '') || item.rarity || '';
            let role = item.role || '';

            // 1. Определяем слот (тип снаряжения)
            if (!slot) {
                if (id.match(/(sword|club|pitchfork|hatchet|spear|hammer|mace|gladius|bow|crook|staff|censer|axe|spatha|blade|dagger|stiletto|wand|rod|shiv|dirk|kris|fang|scepter|broom|fork)/)) slot = 'weapon';
                else if (id.match(/(lorica|robe|armor|jacket|mantle|cuirass|chainmail|segmentata|shroud|vest|cloak|cassock|jerkin|leathers)/)) slot = 'armor';
                else if (id.match(/(galea|hat|cap|helm|crown|hood|mask|tiara|head|beret|colpak)/)) slot = 'helmet';
                else if (id.match(/(shield|buckler|scutum)/)) slot = 'shield';
                else if (/^seal_/i.test(id) || /печать/i.test(id)) slot = 'scroll';
                else if (id.match(/(amulet|charm|bead|coin|tooth|ring|pendant|seal|halo|lucky|ear|horn|tear)/)) slot = 'trinket';
                else if (id.match(/(potion|apple|pear|pretzel|bread|kvass|cheese|pie|ham|roast|tea|stew|candy|milk|catnip|mint)/)) slot = 'food';
                else if (id.match(/(star|sphere|aurus)/)) slot = 'material';
                else if (id.match(/(scroll)/)) slot = 'scroll';
            }

            // 2. Определяем редкость
            if (!rarity) {
                if (id.match(/(legendary|aquila|diana|storm_heart|vesta|orcus|sol_hammer|dragon_scale|star_mantle|triumph|phoenix|mars_horn|hadrian|jack_lantern|laverna|metamorph)/)) rarity = 'legendary';
                else if (id.match(/(epic|_epic)/)) rarity = 'epic';
                else if (id.match(/(rare|mercury|crypt|lich|apollo|gladius|spatha|lorica|galea|scutum|storm_staff|centurion|legate|champion|warhammer|triarius|assassin|retiarius|longbow|sagittarius|ember|elder|gold_censer|tower_shield|hoplite|spiked|stargazer|crested|horned|priest_tiara|wolfpack|frost_bead|praetorian|pontifex|golden_crown|healer_beads)/)) rarity = 'rare';
                else if (id.match(/(uncommon|sharp|bearded|flanged|composite|yew|silver|iron_|chainmail|chain|leather|adept_robe|adept|hunter_cap|hunter|wizard_hat|wizard|segmentata|scale_armor|sage|archer_charm|legion_charm|miner_helmet|iron_galea)/)) rarity = 'uncommon';
                else rarity = 'common';
            }

            // 3. Определяем класс
            if (!role) {
                if (id.match(/(leg_|gladius|spatha|pitchfork|lorica|galea|scutum|hoplite|segmentata|legion|centurion|hatchet|pilum)/)) role = 'legionary';
                else if (id.match(/(arc_|bow|ranger|marksman|hunter_cap|hunter_armor|yew_bow|composite)/)) role = 'archer';
                else if (id.match(/(mag_|staff|crook|wizard|archmage|stargazer|ember|elder|walking_staff)/)) role = 'mage';
                else if (id.match(/(pri_|censer|priest|pontifex|tiara|healer)/)) role = 'priest';
                else if (id.match(/(rog_|dagger|stiletto|assassin|retiarius|kris|dirk|shiv)/)) role = 'rogue';
                else if (id.match(/(nec_|skull|grimoire|bone|dead|proserpina)/)) role = 'necromancer';
                else if (id.match(/(pal_|holymace|sol_hammer|templar|blessed|dawn_plate|apollo)/)) role = 'paladin';
            }

            return { slot, rarity, role };
        },
        // Иконка предмета: официальные каталоги MDDoodle (icons + категории).
        // В значениях каталогов встречаются и строки-URL, и объекты предметов,
        // поэтому путь к картинке нормализуем.
        getItemIcon(id) {
            try {
                if (!id) return '';
                const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
                const C = G.MDDoodle?.CATALOG;
                if (!C) return '';
                const raw = C.icons?.[id] || C.weapons?.[id] || C.armors?.[id] ||
                            C.shields?.[id] || C.hats?.[id] || C.acc?.[id] || '';
                if (!raw) return '';
                if (typeof raw === 'string') return raw;
                return raw.icon || raw.img || raw.src || raw.url || '';
            } catch (e) { return ''; }
        },
    };
    Object.assign(Utils, UtilsArt);

    // 11.6.4b: патч patchMineArtResolver удалён. Он оборачивал
    // Utils.getItemArtSvg ради приоритета __lgMineContext.art, а сам
    // __lgMineContext заполнялся хуком LGMine.open — именно его античит
    // шахты и ловит (M.open !== open). Контекст шахты теперь берётся из
    // G.X внутри ctxs (см. getItemArtSvg выше), обёртка не нужна.

    // ===== src/core/utils.js =====
    // ============================================================
    // 0.4. ОБЩИЕ ХЕЛПЕРЫ АДДОНА (core/utils.js)
    //
    // v11.7.0: файл заменил core/utils-chat.js — подсистема чата полностью
    // вырезана из проекта. Здесь остались только те хелперы, которые нужны
    // другим модулям:
    //   copyText()          — копирование текста в буфер обмена;
    //   insertToQuestChat() — вставка команды в поле чата похода (#qSayIn).
    //
    // Потребители: modules/combat-assistant.js (кликабельный бейдж команды и
    // кнопка «Вставить») и modules/party.js (кнопка «❤» — лечение союзника).
    // Подключается после utils-api.js: Utils уже объявлен в constants.js.
    // ============================================================
    const UtilsCommon = {
        /**
         * Копирование текста в буфер обмена.
         *
         * Порядок: Clipboard API (нужен secure context и разрешение браузера),
         * затем фолбэк через скрытую textarea + document.execCommand('copy').
         *
         * @param {string} text текст для копирования
         * @returns {Promise<boolean>} true — текст попал в буфер
         */
        copyText(text) {
            const value = String(text == null ? '' : text);

            // Фолбэк для браузеров/контекстов без navigator.clipboard.
            const legacyCopy = () => {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = value;
                    ta.setAttribute('readonly', '');
                    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
                    document.body.appendChild(ta);
                    ta.select();
                    ta.setSelectionRange(0, value.length);
                    let ok = false;
                    try { ok = document.execCommand('copy'); } catch (e) {}
                    ta.remove();
                    return ok;
                } catch (e) {
                    return false;
                }
            };

            try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    return navigator.clipboard.writeText(value).then(() => true, legacyCopy);
                }
            } catch (e) {}

            return Promise.resolve(legacyCopy());
        },

        /**
         * Вставка текста в поле команды похода (#qSayIn, см. site/quest.js).
         *
         * Игра блокирует вставку: noPaste на paste/drop + beforeinput
         * insertFromPaste. Поэтому значение пишем нативным сеттером из
         * цепочки прототипов самого элемента (realm-safe: не зависит от
         * песочницы Tampermonkey) и вручную шлём input/change.
         * Автоотправки нет: команду отправляет игрок по Enter.
         *
         * @param {string} text команда, например «удар» или «лечить @ник»
         * @returns {boolean} true — вставлено в поле; false — поля нет
         */
        insertToQuestChat(text) {
            const value = String(text == null ? '' : text);
            const input = document.querySelector('#qSayIn, .q-sayi, .q-say input');
            if (!input) return false;

            try {
                input.focus();
                let proto = Object.getPrototypeOf(input);
                let desc = null;
                while (proto && !desc) {
                    desc = Object.getOwnPropertyDescriptor(proto, 'value');
                    proto = Object.getPrototypeOf(proto);
                }
                if (desc && desc.set) desc.set.call(input, value);
                else input.value = value;

                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                if (typeof input.setSelectionRange === 'function') {
                    input.setSelectionRange(value.length, value.length);
                }
            } catch (e) {
                try { input.value = value; } catch (e2) { return false; }
            }

            return true;
        },

        /**
         * Трекер онлайна игроков (город/шахта).
         *
         * Раньше жил в core/utils-chat.js. Наполняет window.__lgOnlinePlayers
         * записями { loc, ts, firstSeen, src }; читают modules/players.js
         * («Разведка») и modules/arena.js (свежесть состава). Никаких
         * сообщений чата здесь нет — только логины из ответов игры.
         *
         * @param {*} raw              ответ API/SSE (объект, массив или список)
         * @param {string|null} defaultLoc 'city' | 'mine' | null
         * @param {string} src         источник ('sse' | 'api')
         * @returns {boolean} true — карта изменилась
         */
        updateOnlinePlayers(raw, defaultLoc = null, src = 'sse') {
            if (!raw) return false;
            let updated = false;
            const now = Date.now();
            if (!window.__lgOnlinePlayers || typeof window.__lgOnlinePlayers.set !== 'function') {
                window.__lgOnlinePlayers = new Map();
            }

            const extractNick = (item) => {
                if (!item) return null;
                if (typeof item === 'string') return item.trim();
                if (Array.isArray(item)) {
                    const first = item[0];
                    if (typeof first === 'string') return first.trim();
                    if (first && typeof first === 'object') {
                        const l = first.l || first.login || first.name || first.nick;
                        if (typeof l === 'string') return l.trim();
                    }
                }
                if (typeof item === 'object') {
                    const l = item.l || item.login || item.nick || item.name || item.n;
                    if (typeof l === 'string') return l.trim();
                }
                return null;
            };

            const processList = (list, loc) => {
                if (!Array.isArray(list)) return;
                list.forEach(item => {
                    const nick = extractNick(item);
                    if (nick && nick.length >= 2 && nick.length <= 30 && nick.toLowerCase() !== 'me') {
                        // 11.6.6c: firstSeen — время первого обнаружения сессии.
                        // Пауза больше 5 минут считается новым заходом: SSE-события
                        // города/шахты обновляют ts постоянно, так что «тишина»
                        // означает выход игрока (трекер онлайна аддона).
                        const nickKey = nick.toLowerCase();
                        const prev = window.__lgOnlinePlayers.get(nickKey);
                        const firstSeen = (prev && (now - prev.ts < 300_000)) ? (prev.firstSeen || prev.ts) : now;
                        window.__lgOnlinePlayers.set(nickKey, { loc, ts: now, firstSeen, src });
                        updated = true;
                    }
                });
            };

            const checkObject = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                const d = obj.body || obj.data || obj;
                const forceCity = d.chatRoom === 'city' || !!d.town;
                const forceMine = d.chatRoom === 'mine';

                if (d.a && Array.isArray(d.a)) {
                    processList(d.a, forceCity ? 'city' : ((defaultLoc === 'mine') ? 'mine' : 'city'));
                }
                if (d.m && Array.isArray(d.m)) {
                    processList(d.m, forceCity ? 'city' : ((defaultLoc === 'city') ? 'city' : 'mine'));
                }
                if (d.others && Array.isArray(d.others)) {
                    processList(d.others, forceCity ? 'city' : (forceMine ? 'mine' : (defaultLoc || 'city')));
                }
                if (d.town && typeof d.town === 'object') {
                    if (Array.isArray(d.town.others)) processList(d.town.others, 'city');
                    if (Array.isArray(d.town.a)) processList(d.town.a, 'city');
                    if (Array.isArray(d.town.players)) processList(d.town.players, 'city');
                    if (Array.isArray(d.town.p)) processList(d.town.p, 'city');
                }
                if (d.players && Array.isArray(d.players)) {
                    processList(d.players, forceCity ? 'city' : (forceMine ? 'mine' : (defaultLoc || 'city')));
                }
                if (d.heroes && Array.isArray(d.heroes)) {
                    processList(d.heroes, forceCity ? 'city' : ((defaultLoc === 'city') ? 'city' : 'mine'));
                }
                if (d.st && typeof d.st === 'object') {
                    if (Array.isArray(d.st.top)) processList(d.st.top, 'mine');
                    if (typeof d.st.here === 'number') window.__lgMineTotalHere = d.st.here;
                }
                if (Array.isArray(d.top)) {
                    processList(d.top, 'mine');
                }
                if (typeof d.here === 'number') {
                    window.__lgMineTotalHere = d.here;
                }
            };

            if (Array.isArray(raw)) {
                raw.forEach(checkObject);
            } else {
                checkObject(raw);
            }

            return updated;
        }
    };
    Object.assign(Utils, UtilsCommon);

    // ===== src/core/styles.js =====
    // ============================================================
    // 3. СТИЛИ
    // ============================================================
    const STYLES = `
        /* Глобальные переменные игры (нативные цвета дерева навыков, v11.6.1). */
        :root {
            --tb-slate: #25302c; --tb-slate2: #313f39; --tb-slate3: #19211e;
            --tb-wood: #a8754f; --tb-woodD: #6e4a2f;
            --tb-chalk: #f4f1e4; --tb-chalk2: #c9d2c3;
            --tb-ink: #2b1d18; --tb-gold: #ffcf4a;
            --br1: #84d4ff; --br2: #ffa982; --br3: #d6b4ff;
        }
        .${DOM_IDS.customModal}, .custom-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(20, 16, 26, 0.98); border: 2px solid #caa55c; border-radius: 12px; padding: 20px; z-index: 10000; color: #f7eadf; width: 1200px; max-width: 98vw; max-height: 88vh; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,0.85); font-family: 'Nunito', sans-serif; backdrop-filter: blur(4px); }
        .${DOM_IDS.customModal}.modal-compact, .custom-modal.modal-compact { width: 450px; max-width: 95vw; max-height: 65vh; padding: 16px; }
        .${DOM_IDS.customModal} h2, .custom-modal h2 { margin-top: 0; color: #ffcf6a; border-bottom: 1px solid #555; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center; cursor: grab; user-select: none; }
        .${DOM_IDS.customModal} h2:active, .custom-modal h2:active { cursor: grabbing; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar, .custom-modal ::-webkit-scrollbar { width: 6px; height: 6px; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar-track, .custom-modal ::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar-thumb, .custom-modal ::-webkit-scrollbar-thumb { background: #44374a; border-radius: 4px; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar-thumb:hover, .custom-modal ::-webkit-scrollbar-thumb:hover { background: #caa55c; }
        .custom-close { background: none; border: none; color: #ff8fa3; font-size: 24px; cursor: pointer; transition: color 0.2s; user-select: none; }
        .custom-close:hover { color: #fff; }
        /* Тумблеры в окне настроек (патч 11.6.2a): кастомный switch вместо
           нативного чекбокса. appearance: none убирает UA-отрисовку, дорожка
           красится фоном, бегунок — псевдоэлементом ::after.
           Включённое состояние — золотое, как кнопки аддона. */
        .lg-toggle { appearance: none; -webkit-appearance: none; width: 36px; height: 20px; flex: none; margin: 0; background: #444; border: none; border-radius: 10px; position: relative; cursor: pointer; outline: none; transition: background 0.2s; }
        .lg-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: transform 0.2s; }
        .lg-toggle:checked { background: #ffcf6a; }
        .lg-toggle:checked::after { transform: translateX(16px); }
        .lg-toggle:focus-visible { box-shadow: 0 0 0 2px #caa55c; }
        /* Пати: компактный крестик в правом верхнем углу заголовка (v11.6.0a). */
        .party-close { border-radius: 5px; transition: color 0.2s, background 0.2s; }
        .party-close:hover { color: #fff; background: rgba(255, 143, 163, 0.14); }
        /* Планировщик билдов: модалка BuildSim.open() в UI не используется
           (HeroPlanner монтирует дерево в #hp-buildsim-container), поэтому
           нерабочие правила для .sim-modal / #buildsim-modal-body удалены
           в v11.6.2a.3. Живые правила скролла — в конце этого файла,
           блок «ПЛАНИРОВЩИК БИЛДОВ — СКРОЛЛ». */
        .modal-tabs { display: flex; gap: 10px; margin-bottom: 15px; border-bottom: 1px solid #444; padding-bottom: 10px; flex-wrap: wrap; }
        .modal-tab { background: #2a2030; border: 1px solid #555; color: #ccc; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: all 0.2s; }
        .modal-tab:hover { background: #3a2c40; color: #fff; }
        .modal-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; }
        .tab-content { display: none; flex: 1; overflow: hidden; position: relative; }
        .tab-content.active { display: flex; gap: 20px; }
        /* ============================================================
           ДЕРЕВО НАВЫКОВ В СТИЛЕ НАТИВНОГО ЭКРАНА ИГРЫ (v11.6.1)
           Источник: reference/LegionFrontSRC/site/skills.css (.skx-*).
           v11.6.2a.5: TH=135, TOP=40, BOT=50 -> BH=630 (узлы 48px).
           ============================================================ */
        /* v11.6.1d: внутренний скролл убран — дерево (панель 38 + отступы +
           шапки веток 28 + поле 630) прокручивается вместе с модалкой
           (v11.6.3a: max-height: calc(100vh - 40px), height: auto).
           overflow: visible, чтобы не обрезались свечения узлов. */
        .sim-tree-wrap { flex: 1; min-width: 0; background: #16121a !important; border: 1px solid #3d2f44; border-radius: 8px; box-shadow: inset 0 0 20px rgba(0,0,0,0.6); position: relative; overflow: visible; display: flex; flex-direction: column; }
        /* v11.6.3b: min-width 800px (было 950) — дерево больше не сжимает
           сайдбар классов на средних экранах; три ветки всё ещё не «в кашу». */
        .sim-tree-inner { min-width: 800px; padding: 12px; display: flex; flex-direction: column; height: auto; flex-shrink: 0; background: transparent !important; position: relative; }
        /* Верхняя панель: ровно одна строка 38px (очки / билды / обмен). */
        .sim-top-bar { display: flex; align-items: center; gap: 8px; height: 38px; min-height: 38px; margin-bottom: 10px; padding: 0 8px; background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px; position: relative; z-index: 10; }
        .sim-free-pts { font-size: 12px; color: var(--tb-chalk2, #c9d2c3); white-space: nowrap; }
        .sim-free-pts b { color: var(--tb-gold, #ffcf4a); font-size: 16px; margin: 0 2px; font-variant-numeric: tabular-nums; }
        .sim-bar-sep { width: 1px; height: 20px; background: #3d2f44; flex: none; }
        .sim-top-bar input, .sim-top-bar select, .sim-top-bar button { height: 26px; box-sizing: border-box; border-radius: 6px; font-size: 12px; font-weight: 700; font-family: inherit; }
        .sim-top-bar input, .sim-top-bar select { background: #0f0f15; border: 1px solid #3d2f44; color: #fff; padding: 0 8px; outline: none; min-width: 0; }
        .sim-top-bar input { width: 120px; flex: 0 1 120px; }
        .sim-top-bar select { width: 150px; flex: 0 1 150px; cursor: pointer; }
        .sim-top-bar button { padding: 0 10px; cursor: pointer; white-space: nowrap; flex: none; transition: filter 0.15s, background 0.15s; }
        .sim-top-bar button:hover { filter: brightness(1.15); }
        .sim-save-btn { background: #caa55c; color: #1d1620; border: 1px solid #caa55c; }
        .sim-del-btn { background: transparent; color: #ff5a7a; border: 1px solid #ff5a7a; padding: 0 8px; }
        .sim-share-btn, .sim-import-btn { background: transparent; color: #caa55c; border: 1px solid #caa55c; }
        /* v11.6.5b.1: «⟲ От вложенного» — старт плана от текущих очков героя.
           Цвет нейтральный (не конфликтует с золотом «Поделиться» и красным
           «Сбросить всё»), чтобы в панели 38px кнопки различались. */
        .sim-keep-btn { background: transparent; color: #9fd0ff; border: 1px solid #9fd0ff; }
        .sim-keep-btn:hover { background: rgba(159, 208, 255, 0.14); }
        /* Инлайн-имя билда (патч 11.6.2a): поле и OK встают на место кнопки
           «Сохранить» внутри панели 38px. Селекторы с .sim-top-bar нужны,
           чтобы перебить общие правила панели (height: 26px, width: 120px). */
        .sim-top-bar .sim-save-name { width: 150px; flex: 0 1 150px; height: 28px; font-size: 12px; }
        .sim-top-bar .sim-save-ok { height: 28px; background: #caa55c; color: #1d1620; border: 1px solid #caa55c; }
        .sim-reset-btn { background: rgba(255, 90, 122, 0.1); color: #ff5a7a; border: 1px solid #ff5a7a; margin-left: auto; }
        .sim-reset-btn:hover { background: rgba(255, 90, 122, 0.22); }
        /* Ветки: три колонки как в нативном дереве, цвет ветки — --br1..--br3. */
        .sim-branches { position: relative; display: grid; grid-template-columns: repeat(var(--nb, 3), minmax(0, 1fr)); width: 100%; }
        .sim-branch { position: relative; min-width: 0; }
        .sim-branch + .sim-branch { border-left: 2px dashed rgba(244, 241, 228, 0.14); }
        .sim-branch:nth-child(1) { --bc: var(--br1, #84d4ff); }
        .sim-branch:nth-child(2) { --bc: var(--br2, #ffa982); }
        .sim-branch:nth-child(3) { --bc: var(--br3, #d6b4ff); }
        .sim-branch:nth-child(n+4) { --bc: var(--br1, #84d4ff); }
        .sim-branch-header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; height: 28px; margin: 0 12px; padding-bottom: 4px; border-bottom: 3px solid var(--bc, var(--tb-chalk)); color: var(--bc, var(--tb-chalk)); font-size: 13px; font-weight: 700; position: relative; z-index: 3; }
        .sim-branch-header .sim-svg { width: 18px; height: 18px; color: var(--bc, var(--tb-gold)); }
        .sim-branch-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sim-branch-pts { min-width: 24px; height: 24px; padding: 0 5px; display: grid; place-items: center; border-radius: 12px; background: var(--bc, var(--tb-slate3)); color: var(--tb-ink); border: 2px solid var(--tb-ink); font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; }
        /* Поле узлов: высота задаётся инлайном из BH (630px при TH=135).
           Значение ниже — только fallback до первого рендера. */
        .sim-in { position: relative; height: 630px; }
        .sim-lines { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 1; }
        .sim-lines path { fill: none; vector-effect: non-scaling-stroke; stroke-linecap: round; }
        .sim-lines .tk-bg { stroke: var(--tb-slate3, #19211e); stroke-width: 14px; }
        .sim-lines .tk-on { stroke: var(--bc, var(--tb-gold)); stroke-width: 6px; }
        .sim-lines .tk-off { stroke: var(--tb-chalk, #f4f1e4); stroke-opacity: 0.4; stroke-width: 3px; stroke-dasharray: 2 8; }
        .sim-lines .tw { stroke: var(--tb-chalk, #f4f1e4); stroke-opacity: 0.25; stroke-width: 2.5px; stroke-dasharray: 4 6; }
        .sim-lines .tw.op { stroke: var(--bc, var(--tb-chalk)); stroke-opacity: 0.55; stroke-dasharray: none; }
        .sim-lines .tw.on { stroke: var(--bc, var(--tb-gold)); stroke-opacity: 1; stroke-width: 4px; stroke-dasharray: none; }
        .sim-lines .pre { stroke: var(--tb-chalk, #f4f1e4); stroke-opacity: 0.3; stroke-width: 2px; stroke-dasharray: 3 6; }
        .sim-lines .pre.op { stroke: var(--bc, var(--tb-chalk)); stroke-opacity: 0.75; }
        .sim-lines .pre.on { stroke: var(--bc, var(--tb-gold)); stroke-opacity: 1; stroke-width: 3px; stroke-dasharray: none; }
        /* Гейты ярусов (патч 11.6.2a): плашка с замком на стволе между ярусами.
           Повторяет .skg нативного дерева (reference/LegionFrontSRC/site/skills.css):
           тёмный фон, пунктирная рамка, боковые «усики» на ствол.
           z-index ниже узлов (2) — плашка не перекрывает иконки навыков. */
        .sim-gate { position: absolute; left: 50%; z-index: 1; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; background: #19211e; color: var(--tb-chalk, #f4f1e4); border: 2px dashed var(--tb-chalk2, #c9d2c3); font-size: 11px; font-weight: 800; line-height: 1; white-space: nowrap; cursor: help; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45); }
        .sim-gate span { font-variant-numeric: tabular-nums; }
        .sim-gate::before, .sim-gate::after { content: ''; position: absolute; top: 50%; width: 14px; height: 4px; margin-top: -2px; border-radius: 2px; background: var(--tb-chalk2, #c9d2c3); }
        .sim-gate::before { right: 100%; }
        .sim-gate::after { left: 100%; }
        /* SVG-иконки: обводка currentColor, solid-вариант с полупрозрачной заливкой. */
        .sim-svg { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
        .sim-svg.so { fill: currentColor; fill-opacity: 0.18; }
        /* Узел: круг как .skx-i в нативном дереве.
           v11.6.2a.5: ширина 130px (было 110) — подписи навыков не режутся.
           Кружок 48px (+3px бордюр = 54).
           transform -24px держит центр кружка на линии яруса (y): -24 + 54/2 ≈ y+3,
           как было при кружке 42px и сдвиге -21px. */
        .sim-node { position: absolute; z-index: 2; transform: translate(-50%, -24px); display: grid; justify-items: center; width: 130px !important; cursor: pointer; }
        .sim-node-icon { position: relative; width: 48px; height: 48px; display: grid; place-items: center; border-radius: 50%; background: var(--tb-slate2, #313f39); border: 3px solid var(--tb-chalk2, #c9d2c3); color: var(--tb-chalk, #f4f1e4); box-shadow: 0 3px 0 rgba(0, 0, 0, 0.35); transition: translate 0.12s, box-shadow 0.12s; }
        .sim-node-icon .sim-svg { width: 26px; height: 26px; }
        .sim-node:hover { z-index: 4; }
        .sim-node:hover .sim-node-icon { translate: 0 -2px; }
        .sim-node .sim-node-icon { border-color: color-mix(in srgb, var(--bc, var(--tb-chalk2)) 60%, var(--tb-slate2)); }
        .sim-node.locked .sim-node-icon { background: var(--tb-slate3, #19211e); border-style: dashed; border-color: color-mix(in srgb, var(--tb-chalk) 35%, transparent); color: color-mix(in srgb, var(--tb-chalk) 45%, transparent); }
        .sim-node.available .sim-node-icon { background: color-mix(in srgb, var(--bc, var(--tb-gold)) 26%, var(--tb-slate2)); border: 3px solid var(--bc, var(--tb-gold)); color: var(--tb-chalk, #f4f1e4); box-shadow: 0 0 0 3px var(--tb-slate), 0 0 0 5px color-mix(in srgb, var(--bc, var(--tb-gold)) 45%, transparent); }
        .sim-node.available .sim-node-icon::after { content: ''; position: absolute; inset: -8px; border-radius: inherit; border: 3px solid var(--bc, var(--tb-gold)); opacity: 0; animation: simNodePulse 2s ease-out infinite; pointer-events: none; }
        @keyframes simNodePulse { 0% { transform: scale(0.88); opacity: 0.9; } 70%, 100% { transform: scale(1.22); opacity: 0; } }
        .sim-node.has .sim-node-icon { background: var(--bc, var(--tb-gold)); border: 3px solid var(--tb-ink); color: var(--tb-ink); box-shadow: 0 0 0 3px var(--tb-slate), 0 0 0 5px var(--bc, var(--tb-gold)); }
        .sim-node.has .sim-node-icon .sim-svg.so { fill-opacity: 0.4; }
        .sim-node.maxed .sim-node-icon { box-shadow: 0 0 0 3px var(--tb-slate), 0 0 0 5px var(--tb-gold); }
        /* Узел, чей тултип сейчас открыт (outline — чтобы не спорить с box-shadow
           состояний has/maxed/available). */
        .sim-node.sim-node-active .sim-node-icon { outline: 2px solid #caa55c; outline-offset: 3px; }
        .sim-node-ranks { display: flex; gap: 3px; margin-top: 2px; padding: 1px 4px; border-radius: 7px; background: var(--tb-slate, #25302c); }
        .sim-node-ranks i { width: 6px; height: 6px; border-radius: 50%; background: var(--tb-slate3, #19211e); border: 1.5px solid color-mix(in srgb, var(--tb-chalk) 45%, transparent); }
        .sim-node-ranks i.filled { background: var(--bc, var(--tb-gold)); border-color: var(--bc, var(--tb-gold)); }
        /* v11.6.2a.5: подпись шире (130px), длинные слова переносятся
           (word-wrap: break-word) и текст больше не обрезается по высоте —
           -webkit-line-clamp убран, слово переносится, а не режется. */
        .sim-node-name { max-width: 130px !important; margin-top: 2px; padding: 0 3px; font-size: 12px !important; line-height: 1.2 !important; font-weight: 700; text-align: center; color: var(--tb-chalk, #f4f1e4); background: var(--tb-slate, #25302c); border-radius: 4px; display: block; overflow: visible; hyphens: auto; word-wrap: break-word !important; overflow-wrap: anywhere; }
        .sim-node.locked .sim-node-name { color: var(--tb-chalk2, #c9d2c3); opacity: 0.8; }
        /* Тултип узла навыка (v11.6.1d).
           Один элемент на модалку, position: absolute: containing block —
           padding-box .custom-modal (она position: fixed), поэтому overflow
           дерева его не режет, а координаты не зависят от transform модалки.
           Видимость переключает класс .on (BuildSim.showNodeTooltip/hideTooltip). */
        .sim-tooltip { position: absolute; top: 0; left: 0; z-index: 10001; display: none; box-sizing: border-box; width: 290px; max-width: calc(100vw - 16px); padding: 12px 14px; background: rgba(22, 16, 12, 0.98); color: #f4f1e4; border: 2px solid #caa55c; border-radius: 10px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.7); font: 13px/1.35 'Nunito', system-ui, sans-serif; text-align: left; }
        .sim-tooltip.on { display: block; }
        .sim-tooltip h4 { margin: 0 22px 6px 0; padding: 0; border: none; font-size: 15px; line-height: 1.25; color: #ffcf6a; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        .sim-tooltip h4 span { flex: none; font-size: 12px; font-weight: 700; color: #c9d2c3; }
        .sim-tooltip .desc { margin-bottom: 8px; font-size: 13px; line-height: 1.35; }
        .sim-tooltip .req { margin-bottom: 8px; font-size: 12px; font-weight: 700; color: #ff8fa3; }
        .sim-tooltip .controls { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px; }
        .sim-tooltip button { flex: 1; padding: 6px 8px; background: #caa55c; color: #1d1620; border: 2px solid #2b1d18; border-radius: 6px; font-family: inherit; font-size: 12px; font-weight: 700; line-height: 1.2; cursor: pointer; }
        .sim-tooltip button:hover:not(:disabled) { filter: brightness(1.12); }
        .sim-tooltip button:disabled { opacity: 0.45; cursor: not-allowed; }
        .sim-tooltip-close { position: absolute; top: 6px; right: 8px; font-size: 13px; line-height: 1; color: #c9b184; cursor: pointer; user-select: none; }
        .sim-tooltip-close:hover { color: #fff; }
        /* ============================================================
           ПЛАНИРОВЩИК БИЛДОВ — ВЕРТИКАЛЬНЫЙ САЙДБАР КЛАССОВ (v11.6.3b)
           Горизонтальная строка табов заменена slim-сайдбаром слева
           (Вариант А): освобождает 50–60px по высоте под дерево навыков.
           Раскладка: .sim-layout (flex-строка) -> .sim-sidebar (170px) +
           .sim-main-content (дерево + панель статов, своя прокрутка).
           ============================================================ */
        .sim-layout {
            display: flex !important;
            align-items: stretch;     /* main-content тянется по высоте — иначе не скроллится */
            gap: 12px;
            flex: 1 !important;       /* занимает всю высоту контейнера BuildSim */
            min-height: 0 !important; /* без этого flex-потомок не даст внутренний скролл */
            width: 100%;
        }
        .sim-sidebar {
            display: flex;
            flex-direction: column;
            gap: 6px;
            flex: 0 0 170px;         /* фиксированная ширина: дерево не сжимает сайдбар */
            width: 170px;
            min-width: 0;
            max-height: 100%;
            overflow-y: auto;        /* страховка, если классов станет больше, чем влезает */
            overflow-x: hidden;
            align-self: flex-start;  /* не растягиваем по высоте дерева */
            position: sticky;        /* сайдбар «прилипает»: скроллится только дерево */
            top: 0;
            padding: 2px 6px 2px 0;
            box-sizing: border-box;
        }
        /* Правая часть: дерево + панель статов. Прокрутка живёт ЗДЕСЬ, чтобы
           модалка не скроллилась целиком (v11.6.3b). */
        .sim-main-content {
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            min-width: 0;
            min-height: 0;
            overflow-y: auto !important;
            overflow-x: hidden !important;
            padding-right: 2px;
        }
        /* Разделитель «Экипировка | классы» в сайдбаре. */
        .sim-sidebar-sep {
            flex: none;
            height: 1px;
            margin: 2px;
            background: linear-gradient(90deg, transparent, #3d2f44 15%, #3d2f44 85%, transparent);
        }
        /* v11.6.3: метка класса-владельца общих очков (режим sk.md =
           'shared'). Аналог нативного .skc-ow из skills.js. */
        .sim-sidebar .modal-tab.sim-tab .sim-tab-own {
            margin-left: auto;
            flex: none;
            min-width: 16px;
            padding: 0 4px;
            border-radius: 8px;
            background: #7ee08a;
            color: #12100e;
            font-size: 11px;
            font-weight: 900;
            line-height: 16px;
            text-align: center;
        }
        /* Кнопка класса в сайдбаре: вертикальный список, цветная полоска слева.
           Цвет класса в --c (инлайн-стиль таба из BuildSim.classColors),
           цвет текста на заливке — в --ct (BuildSim.classTextColors):
           неактивный — тёмная подложка + цветная полоска/текст,
           активный — заливка цветом класса; текст тёмный на светлых цветах
           (Жрец, Паладин, Разбойник) и белый на тёмных (Некромант). */
        .sim-sidebar .modal-tab.sim-tab {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 8px;
            width: 100%;
            height: 34px;
            min-height: 34px;
            padding: 0 10px;
            box-sizing: border-box;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-left: 3px solid var(--c, #caa55c);
            border-radius: 6px;
            background: rgba(0, 0, 0, 0.25);
            color: var(--c, #ffcf6a);
            font-size: 13px;
            font-weight: 700;
            font-family: inherit;
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            cursor: pointer;
            transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .sim-sidebar .modal-tab.sim-tab:hover {
            background: rgba(0, 0, 0, 0.45);
            border-color: rgba(255, 255, 255, 0.14);
            border-left-color: var(--c, #caa55c);
            color: var(--c, #ffcf6a);
        }
        .sim-sidebar .modal-tab.sim-tab.active {
            background: var(--c, #caa55c);
            border-color: var(--c, #caa55c);
            border-left-color: var(--c, #caa55c);
            color: var(--ct, #12100e);
        }
        .sim-sidebar .modal-tab.sim-tab .sim-svg {
            width: 16px;
            height: 16px;
            flex: none;
        }
        .sim-load-select option { background: #0f0f15; color: #fff; }
        .build-right { width: 250px; flex-shrink: 0; background: #1e1724; padding: 15px; border-radius: 8px; border: 1px solid #3d2f44; height: fit-content; }
        /* Панель статов справа */
        .stats-panel { background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px; padding: 15px; }
        .stats-panel h3 { color: #ffcf6a; margin-top: 0; font-size: 14px; border-bottom: 1px solid #3d2f44; padding-bottom: 10px; }
        .stat-line { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
        .stat-line span { color: #aaa; }
        .stat-line b { color: #4cc95a; }
        .search-bar { width: 100%; padding: 10px; margin-bottom: 15px; background: #111; border: 1px solid #555; color: #fff; border-radius: 6px; font-size: 14px; outline: none; box-sizing: border-box; }
        .table-container { overflow-y: auto; flex: 1; border: 1px solid #333; border-radius: 6px; }
        .${DOM_IDS.customModal} table, .custom-modal table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .${DOM_IDS.customModal} th, .${DOM_IDS.customModal} td, .custom-modal th, .custom-modal td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #333; }
        .${DOM_IDS.customModal} th, .custom-modal th { background: #2a2030; color: #ffcf6a; position: sticky; top: 0; cursor: pointer; user-select: none; z-index: 2; }
        .${DOM_IDS.customModal} th::after, .custom-modal th::after { content: ' ↕'; font-size: 10px; opacity: 0.5; }
        .${DOM_IDS.customModal} th.sort-asc::after, .custom-modal th.sort-asc::after { content: ' ↑'; opacity: 1; }
        .${DOM_IDS.customModal} th.sort-desc::after, .custom-modal th.sort-desc::after { content: ' ↓'; opacity: 1; }
        .stat-up { color: #4cc95a; font-weight: bold; }
        .stat-down { color: #ff5a7a; font-weight: bold; }
        .stat-eq { color: #888; }
        .deal-great { color: #4cc95a; font-weight: bold; text-shadow: 0 0 5px rgba(76, 201, 90, 0.5); }
        .deal-good { color: #8bc34a; font-weight: bold; }
        .deal-bad { color: #ff5a7a; }
        /* 11.6.2c.2: медиана сети в витрине аукциона и строка медианы в
           нативных тултипах предметов (#lg-tip игры и #lgi-tip инвентаря).
           Порог подсветки: цена за штуку ниже медианы на 15% и больше —
           зелёный, выше на 15% и больше — красный. */
        .auction-deal { color: #6fd49a !important; font-weight: bold; }
        .auction-overpriced { color: #ff5a7a !important; }
        .auction-median-col { font-size: 12px; opacity: 0.8; }
        /* 11.6.2c.4: кнопка «📡 Сканировать весь аукцион» в шапке сканера.
           class="btn" — родной класс игры, но у него нет фона/рамки, поэтому
           цвета аддона задаём по id (специфичность выше класса). :disabled —
           кулдаун 30 минут или идущее сканирование. */
        #lg-auction-full-scan {
            min-height: 0;
            padding: 5px 12px;
            background: #2a2030;
            border: 1px solid #caa55c;
            border-radius: 6px;
            color: #ffcf6a;
            font-family: inherit;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            white-space: nowrap;
            transition: background 0.2s, opacity 0.2s;
        }
        #lg-auction-full-scan:hover:not(:disabled) { background: #3d2f44; }
        #lg-auction-full-scan:disabled { cursor: not-allowed; opacity: 0.55; }
        .lg-market-median {
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid rgba(255,255,255,0.1);
            color: #ffcf6a;
            font-size: 13px;
            font-weight: bold;
            pointer-events: none;
        }
        .loader { display: flex; justify-content: center; align-items: center; height: 100px; font-size: 16px; color: #caa55c; font-weight: bold; }
        .${DOM_IDS.fabWrap}, .legion-fab-wrap { position: fixed; bottom: 20px; right: 20px; z-index: 10000; touch-action: none; user-select: none; }
        .${DOM_IDS.fabBtn}, .legion-fab-btn { width: 52px; height: 52px; border-radius: 50%; background: #1d1620; border: 2px solid #caa55c; color: #ffcf6a; font-size: 26px; display: flex; justify-content: center; align-items: center; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,0.75); transition: transform 0.2s, background 0.2s; position: relative; }
        .${DOM_IDS.fabBtn}:hover, .legion-fab-btn:hover { background: #2a2030; transform: scale(1.08); }
        .${DOM_IDS.fabBtn}:active, .legion-fab-btn:active { transform: scale(0.95); }
        .${DOM_IDS.fabMenu}, .legion-fab-menu { position: absolute; bottom: 62px; right: 0; min-width: 220px; background: rgba(29, 22, 32, 0.96); border: 2px solid #caa55c; border-radius: 10px; padding: 8px; display: none; flex-direction: column; gap: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.85); backdrop-filter: blur(8px); }
        .${DOM_IDS.fabMenu}.open, .legion-fab-menu.open { display: flex; animation: fabFadeIn 0.2s ease; }
        .${DOM_IDS.fabMenu}::-webkit-scrollbar, .legion-fab-menu::-webkit-scrollbar { width: 4px; }
        .${DOM_IDS.fabMenu}::-webkit-scrollbar-thumb, .legion-fab-menu::-webkit-scrollbar-thumb { background: #caa55c; border-radius: 4px; }
        .${DOM_IDS.fabMenu}::-webkit-scrollbar-track, .legion-fab-menu::-webkit-scrollbar-track { background: transparent; }
        .fab-section-title { flex-shrink: 0; }
        .fab-section { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
        .fab-section-body { display: flex; flex-direction: column; gap: 6px; overflow: hidden; transition: max-height 0.2s ease-out; }
        .fab-section.collapsed .fab-section-body { display: none; }
        .fab-arrow {
            display: inline-block;
            font-size: 16px;
            color: #caa55c;
            font-weight: bold;
            line-height: 1;
            transition: transform 0.2s, color 0.2s;
            width: 20px;
            text-align: center;
        }
        /* !important нужен из-за инлайнового color в разметке стрелки. */
        .fab-section-title:hover .fab-arrow { color: #ffcf6a !important; }
        .fab-section.collapsed .fab-arrow { transform: rotate(-90deg); }
        .${DOM_IDS.fabMenu}.open-down, .legion-fab-menu.open-down { top: 100%; bottom: auto; margin-top: 10px; margin-bottom: 0; }
        /* ПАТЧ 11.6.5g: кнопка «Аддон» в нативном баре города (#gu-hud .gu-main).
           Разметка использует родные классы игры (.gu-b/.gu-bi/.gu-bl), поэтому
           размеры кружка, шрифт и подсветку берём у неё. Здесь только страховка:
           emoji не должен раздувать круг и ломать сетку бара. */
        .lgu-nav-btn { flex-shrink: 0; }
        .lgu-nav-btn .gu-bi > span { display: block; font-size: 26px; line-height: 1; }
        @keyframes fabFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .fab-menu-item { position: relative; flex-shrink: 0; background: #2a2030; color: #ffcf6a; border: 1px solid #555; border-radius: 6px; padding: 10px 14px; font-weight: bold; cursor: pointer; font-size: 13px; text-align: left; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center; }
        .fab-menu-item:hover { background: #caa55c; color: #1d1620; border-color: #caa55c; }
        .fab-menu-item.active { background: #4cc95a; color: #1d1620; border-color: #4cc95a; box-shadow: 0 0 15px rgba(76, 201, 90, 0.5); }

        .auc-buy-btn { padding: 4px 8px; background: #28a745; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px; transition: background 0.2s, opacity 0.2s; }
        .auc-buy-btn:hover { background: #218838; }
        .auc-buy-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        /* Фиксы котов в шахте (баг игры) */
        .mn-fig.has-d:not(:has(> svg:not(.mna-dfig))) > svg.mna-dfig { display: block !important; }
        .mn-h .mna-dfig { overflow: visible !important; }

        /* UI-декоратор аукциона: иконки монет */
        .b-coin-wrap {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            white-space: nowrap;
            vertical-align: middle;
        }
        .b-coin-ico {
            width: 11px;
            height: 11px;
            border-radius: 50%;
            border: 1.5px solid rgba(0, 0, 0, 0.45);
            display: inline-block;
            vertical-align: middle;
            margin-left: 2px;
            margin-right: 1px;
            flex-shrink: 0;
            box-sizing: border-box;
        }
        .b-coin-ico.g {
            background: radial-gradient(circle at 35% 35%, #fff176, #f2c94c);
            box-shadow: 0 0 2px rgba(242, 201, 76, 0.45);
        }
        .b-coin-ico.s {
            background: radial-gradient(circle at 35% 35%, #ffffff, #d7dde2);
            box-shadow: 0 0 2px rgba(215, 221, 226, 0.45);
        }
        .b-coin-ico.b {
            background: radial-gradient(circle at 35% 35%, #e0965a, #c47a3a);
            box-shadow: 0 0 2px rgba(196, 122, 58, 0.45);
        }

        /* UI-декоратор аукциона: арт предмета */
        .b-lot-art {
            width: 40px;
            height: 40px;
            min-width: 40px;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.15);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            overflow: hidden;
            flex-shrink: 0;
            box-sizing: border-box;
        }
        .b-lot-art svg {
            width: 34px;
            height: 34px;
            max-width: 36px;
            max-height: 36px;
            display: block;
            overflow: visible;
        }
        .b-lot-art img {
            width: 32px;
            height: 32px;
            max-width: 32px;
            max-height: 32px;
            object-fit: contain;
            display: block;
        }
        #auction-body .b-lot-art {
            display: inline-flex;
            vertical-align: middle;
            margin-right: 5px;
            width: 32px;
            height: 32px;
            min-width: 32px;
        }
        #auction-body .b-lot-art img,
        #auction-body .b-lot-art svg {
            width: 26px;
            height: 26px;
        }
        #dossier-lots-container .b-lot-art {
            width: 30px;
            height: 30px;
            min-width: 30px;
        }
        #dossier-lots-container .b-lot-art img,
        #dossier-lots-container .b-lot-art svg {
            width: 24px;
            height: 24px;
        }
        #${DOM_IDS.playerHud}, #legion-player-hud { position: fixed; top: 100px; right: 20px; width: 220px; background: #1d1620; border: 2px solid #caa55c; border-radius: 10px; z-index: 10001; box-shadow: 0 8px 24px rgba(0,0,0,0.85); display: flex; flex-direction: column; overflow: hidden; font-family: 'Nunito', sans-serif; }
        .player-hud-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #2a2030; border-bottom: 1px solid #444; cursor: move; user-select: none; touch-action: none; }
        .player-hud-close { background: none; border: none; color: #ff8fa3; font-size: 14px; cursor: pointer; padding: 0 2px; line-height: 1; }
        .player-hud-close:hover { color: #fff; }
        .player-hud-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; font-size: 12px; }
        /* ── Пати (v11.6.0g-2): модалка, HP-панель и журнал ──
           Раньше формы окна «Пати» рисовались инлайном (серые рамки #444) —
           теперь это классы: тёмный фон, золотистые акценты #caa55c/#ffcf6a
           и hover-эффекты как у кнопки «Создать пати». */
        .party-modal h2 { border-bottom-color: #3a3040; }
        .party-muted { font-size: 11px; color: #c9b184; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
        .party-input { width: 100%; box-sizing: border-box; background: #16121a; border: 1px solid #4a3c56; color: #f7eadf; padding: 8px 10px; border-radius: 6px; font-size: 13px; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
        .party-input::placeholder { color: #7d7189; }
        .party-input:focus { border-color: #caa55c; box-shadow: 0 0 0 2px rgba(202, 165, 92, 0.15); }
        .party-input.party-token { font-family: monospace; font-size: 11px; }
        .party-btn { padding: 8px 12px; background: #2a2030; border: 1px solid #caa55c; color: #ffcf6a; border-radius: 6px; cursor: pointer; font-size: 13px; white-space: nowrap; transition: background 0.2s, color 0.2s, border-color 0.2s, box-shadow 0.2s; }
        .party-btn:hover:not(:disabled) { background: #caa55c; color: #1d1620; border-color: #e0bb6b; box-shadow: 0 0 10px rgba(202, 165, 92, 0.35); }
        .party-btn:active:not(:disabled) { transform: translateY(1px); }
        .party-btn:disabled { opacity: 0.55; cursor: default; }
        .party-btn-sm { padding: 4px 8px; border-radius: 5px; font-size: 11px; }
        .party-btn-lg { padding: 8px 12px; font-size: 13px; }
        .party-btn-danger { background: #3a1f28; border-color: #ff5a7a; color: #ff5a7a; }
        .party-btn-danger:hover:not(:disabled) { background: #ff5a7a; border-color: #ff8fa3; color: #1d1620; box-shadow: 0 0 10px rgba(255, 90, 122, 0.35); }
        .party-sep { border-top: 1px solid #3a3040; padding-top: 12px; }
        .party-field { display: flex; gap: 6px; }
        .party-self-nick { color: #ffcf6a; }
        /* Ошибка модалки: пустой блок не занимает места (раньше он всегда
           висел с display:none и текст ошибки был не виден). */
        .party-error { color: #ff8fa3; font-size: 12px; line-height: 1.35; }
        .party-error:empty { display: none; }

        /* ============================================================
           HUD ПАТИ (modules/party.js): карточки HP, журнала и чата (v11.7.0)
           ============================================================ */
        .party-hud-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: stretch;
            width: 276px;
            box-sizing: border-box;
            pointer-events: none;
        }
        .party-panel, .party-log-panel, .party-chat-panel {
            display: none;
            position: relative;
            box-sizing: border-box;
            width: 276px;
            background: rgba(18, 15, 24, 0.94);
            border: 1px solid rgba(202, 165, 92, 0.35);
            border-radius: 10px;
            padding: 8px 10px;
            box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);
            font: 12px/1.4 system-ui, "Segoe UI", sans-serif;
            color: #e8e8ea;
            pointer-events: none;
        }
        .party-drag-handle {
            pointer-events: auto;
            cursor: grab;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
        }
        .party-drag-handle:active,
        .party-hud-container.party-dragging .party-drag-handle {
            cursor: grabbing;
        }

        /* Карточка HP */
        .party-panel-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            font-size: 10px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #c9b184;
            font-weight: bold;
            margin-bottom: 6px;
        }
        .party-member-row {
            padding: 3px 4px;
            border-radius: 6px;
            margin-bottom: 4px;
            transition: background 0.15s ease;
            border-bottom: 1px dashed rgba(255, 255, 255, 0.06);
        }
        .party-member-row:hover {
            background: rgba(255, 255, 255, 0.04);
        }
        .party-member-row:last-child {
            border-bottom: none;
            margin-bottom: 0;
        }
        .party-member-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
        }
        .party-member-name {
            color: #ffcf6a;
            font-weight: bold;
            font-size: 11.5px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .party-member-hp-val {
            display: flex;
            align-items: center;
            gap: 5px;
            white-space: nowrap;
        }
        .party-hp-num {
            color: #d8c9a8;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
        }
        .party-hp-track {
            height: 5px;
            margin-top: 3px;
            border-radius: 3px;
            background: #251d2c;
            overflow: hidden;
        }
        .party-hp-fill {
            height: 5px;
            border-radius: 3px;
            transition: width 0.25s ease, background 0.2s ease;
        }

        /* Кнопка лечения */
        .party-heal-btn {
            pointer-events: auto;
            flex: none;
            padding: 1px 6px;
            background: #1c2b22;
            border: 1px solid #4ade80;
            color: #4ade80;
            border-radius: 4px;
            font-size: 10.5px;
            line-height: 14px;
            cursor: pointer;
            transition: background 0.15s, color 0.15s, transform 0.1s;
        }
        .party-heal-btn:hover:not(:disabled) {
            background: #4ade80;
            color: #120f18;
            transform: scale(1.05);
        }
        .party-heal-btn.copied {
            background: #ffcf6a !important;
            border-color: #ffcf6a !important;
            color: #120f18 !important;
            font-weight: bold;
        }
        .party-heal-btn:disabled {
            opacity: 0.5;
            cursor: default;
        }

        /* Карточка Журнала */
        .party-log-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            font-size: 10px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #c9b184;
            font-weight: bold;
        }
        .party-log-body {
            pointer-events: auto;
            max-height: 150px;
            overflow-y: auto;
            margin-top: 6px;
        }
        .party-log-body::-webkit-scrollbar { width: 4px; }
        .party-log-body::-webkit-scrollbar-thumb { background: #44374a; border-radius: 3px; }
        .party-log-body::-webkit-scrollbar-thumb:hover { background: #caa55c; }
        .party-log-toggle {
            pointer-events: auto;
            background: none;
            border: none;
            padding: 0 4px;
            color: #ffcf6a;
            cursor: pointer;
            font-size: 13px;
            font-weight: bold;
            line-height: 1;
        }
        .party-log-toggle:hover { color: #fff; }

        /* Карточка Чата пати */
        .party-chat-panel {
            flex-direction: column;
        }
        .party-chat-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .party-chat-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 10px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #c9b184;
            font-weight: bold;
        }
        .party-chat-badge {
            background: #e03e52;
            color: #fff;
            border-radius: 8px;
            padding: 0 5px;
            font-size: 9px;
            font-weight: bold;
            line-height: 13px;
        }
        .party-chat-toggle {
            pointer-events: auto;
            background: none;
            border: none;
            padding: 0 4px;
            color: #ffcf6a;
            cursor: pointer;
            font-size: 13px;
            font-weight: bold;
            line-height: 1;
        }
        .party-chat-toggle:hover { color: #fff; }
        .party-chat-content {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 6px;
        }
        .party-chat-body {
            pointer-events: auto;
            max-height: 140px;
            min-height: 50px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding-right: 2px;
        }
        .party-chat-body::-webkit-scrollbar { width: 4px; }
        .party-chat-body::-webkit-scrollbar-thumb { background: #44374a; border-radius: 3px; }
        .party-chat-body::-webkit-scrollbar-thumb:hover { background: #caa55c; }
        .party-chat-empty {
            color: #777;
            font-style: italic;
            font-size: 11px;
            text-align: center;
            padding: 10px 0;
        }
        .party-chat-msg {
            font-size: 11px;
            line-height: 1.35;
            word-break: break-word;
        }
        .party-chat-time {
            color: #7f7389;
            font-size: 9.5px;
            margin-right: 4px;
            font-variant-numeric: tabular-nums;
        }
        .party-chat-nick {
            color: #ffcf6a;
            font-weight: bold;
            margin-right: 4px;
        }
        .party-chat-nick.party-chat-self {
            color: #8ff2a0;
        }
        .party-chat-text {
            color: #ece5f0;
        }
        .party-chat-form {
            display: flex;
            align-items: center;
            gap: 4px;
            pointer-events: auto;
            margin-top: 2px;
        }
        .party-chat-input {
            flex: 1 1 auto;
            min-width: 0;
            background: #120d17;
            border: 1px solid #3d2f44;
            border-radius: 5px;
            padding: 4px 7px;
            font-size: 11px;
            color: #fff;
            outline: none;
            box-sizing: border-box;
        }
        .party-chat-input:focus {
            border-color: #caa55c;
        }
        .party-chat-send {
            flex: none;
            background: #caa55c;
            border: none;
            color: #120f18;
            border-radius: 5px;
            padding: 4px 8px;
            font-size: 10px;
            font-weight: bold;
            cursor: pointer;
            transition: filter 0.15s;
        }
        .party-chat-send:hover {
            filter: brightness(1.15);
        }

        /* ============================================================
           ПЛАНИРОВЩИК БИЛДОВ — СКРОЛЛ ДЕРЕВА + ГРАНИЦЫ МОДАЛКИ (v11.6.3b)
           v11.6.3a: высота модалки = min(контент, 100vh - 40px).
           v11.6.3b: прокрутка переехала ВНУТРЬ (.sim-main-content) — модалка
           больше не скроллится целиком, поэтому заголовок и сайдбар классов
           всегда остаются на месте, а дерево едет отдельно.
           Чтобы внутренний скролл включился, ограничение высоты должно
           доходить до .sim-main-content: каждое звено цепочки
           модалка -> #tab-hero-build -> #hp-buildsim-container -> .sim-layout
           обязано иметь min-height: 0 (иначе flex-потомок не даст себя сжать).
           ============================================================ */
        /* 1. Модалка: высота по контенту, но не выше окна минус 40px.
           box-sizing: border-box обязателен: padding 20px + рамка 2px должны
           входить в calc(100vh - 40px), иначе окно вылезает за экран на 44px
           и низ обрезается (именно это видел Firefox на 125%).
           v11.6.3b: overflow-y у модалки убран — скроллит .sim-main-content.
           overflow задан ЯВНО как hidden на обе оси: если оставить один
           overflow-x: hidden, CSS до-считает overflow-y как auto и модалка
           снова начнёт скроллиться сама (двойной скролл).
           Компактные окна (.modal-compact: настройки, пати, разведка) не
           растягиваем — иначе их 450px-раскладка ломается. */
        .${DOM_IDS.customModal}:not(.modal-compact), .custom-modal:not(.modal-compact) {
            max-height: calc(100vh - 40px) !important; /* Жёсткий потолок по высоте окна */
            height: auto !important;                   /* Тянется по контенту, а не 96vh */
            overflow: hidden !important;               /* Модалка не скроллится: скролл — внутри */
            display: flex !important;
            flex-direction: column !important;
            box-sizing: border-box !important;
            max-width: 95vw !important;
            width: 1400px !important;    /* Шире, чтобы ветки не сжимались */
        }
        /* 2. Вкладки планировщика и контейнер BuildSim — звенья flex-колонки.
           Главное здесь: flex: 1 1 auto + min-height: 0, чтобы ограничение
           высоты модалки доходило до .sim-layout и .sim-main-content — иначе
           внутренний скролл «не включается» и низ дерева обрезается.
           display/flex-direction задаём ТОЛЬКО активной вкладке (селектор с
           .active): правило по одному #id перебило бы
           .tab-content { display: none } и вкладка «Билды» оставалась бы
           видимой при переключении на «Заточку». */
        #tab-hero-build.active,
        #tab-hero-ench.active,
        #hp-buildsim-container {
            display: flex !important;
            flex-direction: column !important;
            flex: 1 1 auto !important;
            min-height: 0 !important;
            height: auto !important;
            /* v11.6.9: было max-height: none — теперь потолок = высота вкладки
               внутри модалки, иначе контент уезжает под нижнюю границу окна. */
            max-height: 100% !important;
            overflow: hidden !important;
        }
        /* v11.6.9: контейнер BuildSim — собственный scrollport. При штатной
           работе скроллит .sim-main-content (там sticky-сайдбар классов), но
           если браузер не сожмёт flex-цепочку, колесо всё равно прокрутит
           вкладку до «Навыков Арены» и сводки статов, а не обрежет низ. */
        #hp-buildsim-container {
            padding-bottom: 10px !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
        }
        #hp-buildsim-container .tab-content.active {
            overflow: visible !important;
            flex: none !important;
            height: auto !important;
        }
        /* 3. Обертка дерева: без внутреннего скролла и без flex-сжатия,
           чтобы не было «скролла в скролле» (v11.6.3a). */
        #hp-buildsim-container .sim-tree-wrap {
            overflow: visible !important;
            flex: none !important;
            min-height: auto !important;
            padding-bottom: 0 !important;
        }
        /* 4. Запас хода под нижний ряд узлов (узлы выступают за sim-in 630px).
           v11.6.2a.5: подписи больше не клипаются по 2 строки, запас 45 -> 60px.
           v11.6.3a: 60 -> 80px — жесткий запас под нижний ряд, чтобы скролл
           модалки гарантированно «доехал» до иконок и подписей. */
        #hp-buildsim-container .sim-tree-inner {
            overflow: visible !important;
            height: auto !important;
            padding-bottom: 80px !important;
        }

        /* ============================================================
           11.6.2c.5: UI/UX РЕДИЗАЙН «СКАНЕРА АУКЦИОНА»
           Карточные строки в нативном стиле игры: полоска редкости слева,
           двухстрочная карточка предмета, чипы второстепенных данных,
           фильтры-чипы вместо серых чекбоксов и премиальная кнопка скана.
           ВАЖНО: правила таблицы начинаются с .custom-modal — иначе их
           перебивают общие правила модалок (.custom-modal td / th выше).
           ============================================================ */
        /* Окно сканера. Общее правило .custom-modal:not(.modal-compact) из
           блока планировщика билдов растягивает ВСЕ обычные окна до 1400px
           и 96vh; для 6-колоночного аукциона это лишнее — фиксируем 1000px,
           чтобы таблица влезала без горизонтальной прокрутки. */
        .custom-modal.auc-modal {
            width: 1000px !important;
            height: auto !important;
            max-height: 92vh !important;
        }
        /* Скроллится сама таблица, а не окно целиком: иначе sticky-заголовок
           «Предмет/Цена/…» перестаёт липнуть, и шапка уезжает вместе с лотом.
           При коротком списке окно сжимается по контенту (flex: 0 1 auto). */
        .custom-modal.auc-modal .table-container { flex: 0 1 auto; max-height: 62vh; min-height: 0; }
        .custom-modal .auc-head { justify-content: flex-start !important; gap: 10px; }
        .custom-modal .auc-head-title { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
        .auc-info-btn { width: 26px; height: 26px; flex: none; padding: 0; border-radius: 50%; background: rgba(202, 165, 92, 0.15); border: 1px solid #caa55c; color: #caa55c; font-family: Georgia, serif; font-size: 15px; font-weight: bold; line-height: 1; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.15s, color 0.15s; }
        .auc-info-btn:hover { background: #caa55c; color: #1d1620; }
        /* Кнопка полного скана: id + класс перебивают старое правило по id. */
        #lg-auction-full-scan.auc-scan-btn { padding: 5px 14px; min-height: 0; background: linear-gradient(180deg, #3a2b39, #241a2b); border: 1px solid #caa55c; border-radius: 7px; color: #ffcf6a; font-family: inherit; font-size: 12px; font-weight: bold; letter-spacing: 0.02em; white-space: nowrap; cursor: pointer; box-shadow: inset 0 1px 0 rgba(255, 207, 106, 0.15), 0 2px 6px rgba(0, 0, 0, 0.4); transition: filter 0.15s, box-shadow 0.15s, opacity 0.2s; }
        #lg-auction-full-scan.auc-scan-btn:hover:not(:disabled) { filter: brightness(1.18); box-shadow: 0 0 12px rgba(202, 165, 92, 0.35); }
        #lg-auction-full-scan.auc-scan-btn:disabled { opacity: 0.55; cursor: not-allowed; filter: grayscale(0.3); }
        /* ── Тулбар: поиск, селекты, фильтры-чипы, пагинация ── */
        .auc-toolbar { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
        .auc-toolbar-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .auc-search-input { flex: 1 1 220px; min-width: 170px; box-sizing: border-box; margin: 0; padding: 8px 12px; background: #16111c; border: 1px solid #3d2f44; border-radius: 8px; color: #f7eadf; font-family: inherit; font-size: 13px; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
        .auc-search-input::placeholder { color: #7a6d86; }
        .auc-search-input:focus { border-color: #caa55c; box-shadow: 0 0 0 2px rgba(202, 165, 92, 0.18); }
        .auc-select { box-sizing: border-box; margin: 0; padding: 8px 10px; background: #16111c; border: 1px solid #3d2f44; border-radius: 8px; color: #e6dcc8; font-family: inherit; font-size: 12px; cursor: pointer; outline: none; transition: border-color 0.2s; }
        .auc-select:hover { border-color: #caa55c; }
        .auc-select:focus { border-color: #caa55c; }
        .auc-select option { background: #16111c; color: #e6dcc8; }
        /* Фильтры-чипы: сам чекбокс скрыт, активное состояние читается через
           :has(input:checked) — без JS-обвязки. */
        .auc-filter-chip { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; background: #1b1522; border: 1px solid #3d2f44; color: #b3a6bf; font-size: 12px; font-weight: bold; cursor: pointer; user-select: none; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s; }
        .auc-filter-chip input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
        .auc-filter-chip:hover { border-color: #caa55c; color: #ffcf6a; }
        .auc-filter-chip:has(input:checked) { background: rgba(202, 165, 92, 0.18); border-color: #caa55c; color: #ffcf6a; box-shadow: inset 0 0 8px rgba(202, 165, 92, 0.22); }
        .auc-filter-chip:has(input:focus-visible) { outline: 2px solid #caa55c; outline-offset: 1px; }
        .auc-pager { display: flex; align-items: center; gap: 8px; margin-left: auto; }
        .auc-page-btn { min-width: 32px; padding: 5px 10px; background: #1b1522; border: 1px solid #caa55c; border-radius: 8px; color: #caa55c; font-family: inherit; font-weight: bold; font-size: 12px; cursor: pointer; transition: background 0.15s, color 0.15s; }
        .auc-page-btn:hover:not(:disabled) { background: #caa55c; color: #1d1620; }
        .auc-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .auc-page-info { color: #9c8fa8; font-size: 12px; white-space: nowrap; }
        /* ── Таблица-карточки: 6 колонок ── */
        .custom-modal .auc-table { width: 100%; border-collapse: separate; border-spacing: 0 4px; table-layout: fixed; font-size: 13px; }
        .custom-modal .auc-table thead th { position: sticky; top: 0; z-index: 3; background: #241c2b; border: none; border-bottom: 1px solid #3d2f44; padding: 6px 10px; color: #caa55c; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
        .custom-modal .auc-table thead th.auc-col-action { text-align: center; cursor: default; }
        /* Стрелка сортировки ↕ нужна только сортируемым колонкам. */
        .custom-modal .auc-table th:not([data-sort])::after { content: ''; }
        .custom-modal .auc-row td { background: #241c2b; border: none; border-top: 1px solid rgba(255, 255, 255, 0.05); padding: 5px 10px; vertical-align: middle; transition: background 0.15s; }
        .custom-modal .auc-row td:first-child { border-left: 4px solid var(--rc, #c9ccd6); border-radius: 8px 0 0 8px; }
        .custom-modal .auc-row td:last-child { border-radius: 0 8px 8px 0; }
        .custom-modal .auc-row.is-cheap td { background: #23301f; }
        .custom-modal .auc-row.is-cur td { background: #2b2433; }
        .custom-modal .auc-row:hover td { background: #33283d; }
        /* Цвет редкости: одна переменная --rc на строку (наследуется в ячейки). */
        .auc-row[data-r="common"] { --rc: #c9ccd6; }
        .auc-row[data-r="uncommon"] { --rc: #4cc95a; }
        .auc-row[data-r="rare"] { --rc: #4aa3ff; }
        .auc-row[data-r="epic"] { --rc: #b06bff; }
        .auc-row[data-r="legendary"] { --rc: #ffb83d; }
        /* ── Карточка предмета: арт + название + субтитр с чипами ── */
        .auc-item-flex { display: flex; align-items: center; gap: 9px; min-width: 0; }
        .auc-item-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .auc-item-title { display: flex; align-items: center; gap: 5px; color: var(--rc, #f7eadf); font-weight: bold; white-space: nowrap; overflow: hidden; }
        .auc-item-name { overflow: hidden; text-overflow: ellipsis; }
        .auc-item-qty { flex: none; color: #ffcf6a; font-size: 12px; font-weight: bold; }
        .auc-item-sub { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; color: #9c8fa8; }
        .auc-rarity-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--rc, #c9ccd6); box-shadow: 0 0 6px var(--rc, #c9ccd6); }
        .auc-item-seller { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #auction-body .auc-item-flex .b-lot-art { margin-right: 0; }
        /* Микро-бейджи второстепенных данных (вложено заточки, цена NPC). */
        .auc-chip-tag { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 999px; font-size: 10px; line-height: 1.5; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); color: #d8c9a8; white-space: nowrap; }
        .auc-chip-tag.invested { background: rgba(176, 107, 255, 0.12); border-color: rgba(176, 107, 255, 0.35); color: #d9c2ff; }
        .auc-chip-tag.npc-cheap { background: rgba(76, 201, 90, 0.14); border-color: rgba(76, 201, 90, 0.45); color: #8ff2a0; font-weight: bold; }
        /* v11.6.3: привязанная легендарка — красноватый бейдж-замок. */
        .auc-chip-tag.bound { background: rgba(255, 120, 90, 0.14); border-color: rgba(255, 120, 90, 0.45); color: #ffb3a0; font-weight: bold; }
        /* ── Цена, медиана, выгода, таймер ── */
        .auc-price-box { display: flex; flex-direction: column; gap: 1px; line-height: 1.25; }
        .auc-price-total { color: #ffcf6a; font-weight: bold; white-space: nowrap; }
        .auc-price-unit { color: #9c8fa8; font-size: 11px; white-space: nowrap; }
        .auc-deal-badge { display: inline-block; min-width: 52px; padding: 2px 7px; border-radius: 6px; text-align: center; font-size: 12px; font-weight: bold; font-variant-numeric: tabular-nums; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); color: #b9aec6; }
        .auc-deal-badge.great { background: rgba(76, 201, 90, 0.16); border-color: rgba(76, 201, 90, 0.55); color: #6ff08a; text-shadow: 0 0 6px rgba(76, 201, 90, 0.45); }
        .auc-deal-badge.good { background: rgba(139, 195, 74, 0.14); border-color: rgba(139, 195, 74, 0.45); color: #b6e06a; }
        .auc-deal-badge.bad { background: rgba(255, 90, 122, 0.12); border-color: rgba(255, 90, 122, 0.4); color: #ff8fa3; }
        .auc-time { color: #9c8fa8; font-size: 12px; white-space: nowrap; }
        .auc-time.raffle { color: #e0a800; font-weight: bold; }
        /* Кнопка покупки: размеры и фон остаются инлайновыми (состояния из JS),
           здесь только форма и эффекты наведения. */
        .auc-buy-btn { border-radius: 6px !important; transition: filter 0.15s, box-shadow 0.15s, opacity 0.2s; }
        .auc-buy-btn:hover:not(:disabled) { filter: brightness(1.15); box-shadow: 0 0 10px rgba(76, 201, 90, 0.35); }
        .auc-buy-btn:disabled { filter: grayscale(0.4); }
        .auc-table-wrap { border: none; background: transparent; padding-right: 2px; }
        .custom-modal .auc-table td.auc-empty { background: transparent; border-left: none; text-align: center; padding: 20px; color: #888; }
        .auc-footer { margin-top: 8px; font-size: 12px; color: #8b7f96; text-align: right; }

        /* ============================================================
           11.7.0: РУЧНАЯ ВСТАВКА В ПОЛЕ КОМАНДЫ ПОХОДА (#qSayIn)
           Игра глушит вставку (noPaste на paste/drop/beforeinput), а слово
           механики босса в походе (.q-nc — canvas) отдаётся с
           user-select: none и pointer-events: none: выделить и скопировать
           его было нельзя. !important перебивает правила site/quest.css
           (специфичность у них такая же, поэтому без !important не выйдет).
           Обработчики вставки дополнительно глушит перехватчик из
           modules/combat-assistant.js (stopImmediatePropagation, БЕЗ
           preventDefault) — нативная вставка браузера остаётся рабочей.
           ============================================================ */
        .q-nc, .q-ncw {
            user-select: text !important;
            -webkit-user-select: text !important;
            pointer-events: auto !important;
        }

        /* ============================================================
           11.6.2b: БОЕВОЙ АССИСТЕНТ (modules/combat-assistant.js)
           Контейнер висит по центру сверху и прозрачен для мыши, чтобы не
           перекрывать нативный UI похода; кликабельны только карточка
           подсказки (pointer-events: auto) — заголовок «Внимание: …» и
           бейдж команды (v11.7.1: кнопка «Вставить» убрана). Баннер сбора
           отряда отсюда убран в 11.7.0: сборы теперь только гильдейские,
           на элитных монстров — см. блок ниже (.lg-cm-gather).
           ============================================================ */
        #lg-combat-assistant {
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
        }
        .lg-combat-banner {
            background: #c81e1e; color: #fff; font: 900 24px/1.2 Arial; padding: 12px 24px;
            border: 3px solid #ff5a5a; border-radius: 12px; box-shadow: 0 0 30px rgba(255,50,50,0.8);
            text-transform: uppercase; animation: lgPulse 1s infinite alternate;
        }
        @keyframes lgPulse { from { transform: scale(1); opacity: 0.9; } to { transform: scale(1.05); opacity: 1; } }
        .lg-combat-suggest {
            background: rgba(18,26,22,0.95); border: 2px solid #ffcf6a; color: #fff; padding: 8px 16px;
            border-radius: 8px; display: flex; gap: 12px; align-items: center; pointer-events: auto; font: bold 14px Arial;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }
        .lg-combat-btn { background: #ffcf6a; color: #000; border: none; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: transform 0.1s; }
        .lg-combat-btn:active { transform: scale(0.95); }
        /* v11.6.3: заметка о дебаффе отряда (v.wk) — не блокирует ввод. */
        .lg-combat-note {
            background: rgba(60, 48, 18, 0.95); border: 2px solid #ffcf6a; color: #ffe6a8;
            padding: 8px 14px; border-radius: 8px; font: bold 13px Arial;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5); pointer-events: none;
            max-width: min(560px, 90vw); text-align: center;
        }
        /* v11.7.0: команда — кликабельный бейдж (копирование в буфер). */
        .lg-combat-info { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
        /* v11.7.1: заголовок «Внимание: {что происходит}» — главный текст
           уведомления, поэтому чуть крупнее и контрастнее. */
        .lg-combat-hint { font-size: 13px; line-height: 1.3; color: #ffe6a8; max-width: min(520px, 88vw); }
        .lg-combat-cmd {
            background: #241d10; border: 1px dashed #ffcf6a; color: #ffcf6a;
            border-radius: 6px; padding: 4px 10px; font: bold 15px Arial;
            cursor: pointer; transition: background 0.15s, color 0.15s;
        }
        .lg-combat-cmd:hover { background: #ffcf6a; color: #000; }
        .lg-combat-cmd.copied { background: #4cc95a; border-color: #4cc95a; color: #16121a; }
        /* ============================================================
           11.7.0: СБОР ГИЛЬДИИ НА ЭЛИТНОГО МОНСТРА (modules/pocket-city.js)
           Плавающее уведомление о чужом открытом сборе (POST /api/citymon/act
           { op: 'elist' }) с кнопкой «Присоединиться» (op: 'ejoin').
           Палитра — как у остальных плашек аддона: тёмная панель, золотая
           рамка, золотая кнопка. Позиция: правый нижний угол.
           ============================================================ */
        #lg-citymon-gather {
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 99999 !important;
            display: none;
            pointer-events: none;
        }
        #lg-citymon-gather.on { display: block !important; }
        .lg-cm-gather {
            background: rgba(29, 22, 32, 0.96);
            border: 2px solid #caa55c;
            border-radius: 10px;
            padding: 10px 14px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            align-items: center;
            pointer-events: auto;
            font: bold 14px Arial;
            color: #f7eadf;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
            min-width: 260px;
            max-width: min(560px, 92vw);
            text-align: center;
        }
        .lg-cm-gather-head { color: #9fe3ff; font-size: 14px; line-height: 1.3; }
        /* Подпись с обратным отсчётом: цифры не «прыгают» (tabular-nums). */
        .lg-cm-gather-sub { color: #b9aec6; font-size: 12px; font-weight: normal; font-variant-numeric: tabular-nums; }
        .lg-cm-gather-row { display: flex; align-items: center; gap: 8px; }
        .lg-cm-gather-join {
            background: #ffcf6a; color: #16121a; border: none; padding: 6px 14px;
            border-radius: 6px; font-weight: bold; font-size: 13px; cursor: pointer;
            transition: transform 0.1s, filter 0.15s;
        }
        .lg-cm-gather-join:hover:not(:disabled) { filter: brightness(1.1); }
        .lg-cm-gather-join:active:not(:disabled) { transform: scale(0.95); }
        .lg-cm-gather-join:disabled { opacity: 0.55; cursor: default; }
        .lg-cm-gather-close {
            background: transparent; border: 1px solid #4a3b55; color: #9c8fa8;
            border-radius: 6px; padding: 5px 10px; font: bold 13px Arial;
            cursor: pointer; transition: color 0.15s, border-color 0.15s;
        }
        .lg-cm-gather-close:hover { color: #ff8fa3; border-color: #ff8fa3; }

        /* Размер M (~82-85% от L) */
        #lg-citymon-gather.lg-cm-size-m .lg-cm-gather {
            padding: 7px 11px;
            gap: 4px;
            border-radius: 8px;
            min-width: 220px;
            max-width: min(460px, 92vw);
        }
        #lg-citymon-gather.lg-cm-size-m .lg-cm-gather-head { font-size: 12.5px; line-height: 1.25; }
        #lg-citymon-gather.lg-cm-size-m .lg-cm-gather-sub { font-size: 11px; }
        #lg-citymon-gather.lg-cm-size-m .lg-cm-gather-row { gap: 6px; }
        #lg-citymon-gather.lg-cm-size-m .lg-cm-gather-join { padding: 4px 11px; font-size: 11.5px; border-radius: 5px; }
        #lg-citymon-gather.lg-cm-size-m .lg-cm-gather-close { padding: 4px 8px; font-size: 11.5px; border-radius: 5px; }

        /* Размер S (~68-72% от L, мини-плашка) */
        #lg-citymon-gather.lg-cm-size-s .lg-cm-gather {
            padding: 5px 8px;
            gap: 3px;
            border-radius: 6px;
            border-width: 1.5px;
            min-width: 180px;
            max-width: min(360px, 92vw);
        }
        #lg-citymon-gather.lg-cm-size-s .lg-cm-gather-head { font-size: 11px; line-height: 1.2; }
        #lg-citymon-gather.lg-cm-size-s .lg-cm-gather-sub { font-size: 10px; line-height: 1.2; }
        #lg-citymon-gather.lg-cm-size-s .lg-cm-gather-row { gap: 4px; }
        #lg-citymon-gather.lg-cm-size-s .lg-cm-gather-join { padding: 3px 8px; font-size: 10.5px; border-radius: 4px; }
        #lg-citymon-gather.lg-cm-size-s .lg-cm-gather-close { padding: 3px 6px; font-size: 10px; border-radius: 4px; }

        /* ============================================================
           11.6.5c: СПОСОБНОСТИ АРЕНЫ (modules/hero-planner.js)
           Вкладка «⚔️ Арена»: шапка с жетонами навыков, ветки класса,
           два слота (способность 3-го хода / ульта 5-го хода) и
           локальная симуляция прокачки.
           ============================================================ */
        /* Вкладка арены скроллится сама: контента много (ветки + два слота).
           display задаём только .active, иначе перебьём
           .tab-content { display: none } и вкладка не будет скрываться. */
        #tab-hero-arena.active {
            display: flex !important;
            flex-direction: column !important;
            flex: 1 1 auto !important;
            min-height: 0 !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
        }
        .hp-arena-wrap { display: flex; flex-direction: column; gap: 12px; padding-bottom: 8px; }
        .hp-arena-loading,
        .hp-arena-empty {
            display: flex; align-items: center; gap: 12px; justify-content: center;
            padding: 18px; color: #9c8fa8; font-size: 13px;
        }
        .hp-arena-empty { color: #ffb3a0; }
        /* ── Шапка: баланс жетонов + недельный прогресс ── */
        .hp-arena-header {
            display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px; padding: 10px 14px;
        }
        .hp-token-badge {
            display: inline-flex; align-items: center; gap: 8px;
            background: rgba(202, 165, 92, 0.12); border: 1px solid rgba(202, 165, 92, 0.45);
            border-radius: 999px; padding: 4px 14px; color: #d8c9a8; font-size: 12px; white-space: nowrap;
        }
        .hp-token-badge b { color: #ffcf6a; font-size: 18px; font-variant-numeric: tabular-nums; }
        .hp-arena-week { display: flex; flex-direction: column; gap: 4px; flex: 1 1 180px; min-width: 160px; }
        .hp-arena-week small { font-size: 11px; color: #9c8fa8; }
        .hp-week-bar {
            display: block; height: 8px; border-radius: 999px; overflow: hidden;
            background: #2a2030; border: 1px solid #44374a;
        }
        .hp-week-bar > i {
            display: block; height: 100%; border-radius: 999px;
            background: linear-gradient(90deg, #caa55c, #ffcf4a);
            box-shadow: 0 0 8px rgba(255, 207, 74, 0.45);
        }
        .hp-arena-spent { font-size: 12px; color: #9c8fa8; white-space: nowrap; }
        .hp-arena-spent b { color: #ffcf6a; }
        /* 11.6.5c.7: селектор класса на вкладке «Арена». */
        .arena-class-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
        .arena-class-btn {
            background: #2a2030; border: 1px solid #44374a; color: #d8c9a8;
            padding: 5px 12px; border-radius: 999px; font: inherit; font-size: 12px;
            font-weight: bold; cursor: pointer; white-space: nowrap;
            transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .arena-class-btn:hover:not(:disabled) { background: #352941; border-color: #caa55c; }
        .arena-class-btn.active {
            background: #caa55c; border-color: #caa55c; color: #1d1620;
            box-shadow: 0 0 8px rgba(202, 165, 92, 0.35);
        }
        .arena-class-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        /* ── Ветки класса ── */
        .hp-arena-branches { display: flex; gap: 10px; flex-wrap: wrap; }
        .hp-arena-branch-card {
            display: flex; align-items: center; gap: 10px; flex: 1 1 240px; min-width: 220px;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px; padding: 8px 12px;
            color: #e8dfd0; font: inherit; text-align: left; cursor: pointer;
            transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
        }
        .hp-arena-branch-card:hover:not(:disabled) { border-color: #caa55c; background: #251d2d; }
        .hp-arena-branch-card.active {
            border-color: #caa55c; background: rgba(202, 165, 92, 0.12);
            box-shadow: 0 0 10px rgba(202, 165, 92, 0.25);
        }
        .hp-arena-branch-card:disabled { opacity: 0.55; cursor: default; }
        .hp-branch-ic { flex: none; font-size: 22px; line-height: 1; }
        .hp-branch-lines { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
        .hp-branch-line {
            display: flex; align-items: baseline; gap: 6px; font-size: 12px; color: #d8c9a8;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .hp-branch-line small {
            flex: none; font-size: 10px; color: #7f7389; text-transform: uppercase; letter-spacing: 0.4px;
        }
        .hp-branch-line i { flex: none; font-style: normal; font-size: 11px; color: #8ff2a0; }
        .hp-branch-active {
            flex: none; font-style: normal; font-size: 10px; font-weight: bold;
            color: #1d1620; background: #caa55c; border-radius: 999px; padding: 2px 8px;
        }
        /* ── Два слота: способность (ab) и ульта (ult) ── */
        /* stretch + height:100% + flex:1 у строк выравнивают карточки по
           высоте: подвал «Вложено X из Y» прижимается к низу обеих. */
        .hp-arena-slots { display: flex; gap: 12px; flex-wrap: wrap; align-items: stretch; }
        .hp-arena-card {
            display: flex; flex-direction: column; gap: 8px;
            flex: 1 1 340px; min-width: 300px;
            height: 100%;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px; padding: 10px 12px;
        }
        .hp-arena-card.ult { border-color: rgba(176, 107, 255, 0.45); }
        .hp-arena-card-head { display: flex; align-items: center; gap: 10px; }
        .hp-arena-card-ic { flex: none; font-size: 20px; line-height: 1; }
        .hp-arena-card-title { display: flex; flex-direction: column; flex: 1; min-width: 0; }
        .hp-arena-card-title b { color: #f7eadf; font-size: 14px; }
        .hp-arena-card-title small { color: #9c8fa8; font-size: 11px; }
        .hp-slot-text { margin: 0; font-size: 11px; color: #9c8fa8; line-height: 1.45; }
        /* 11.6.5c.4: бонусы способности (s.lines из /api/abtokens) — чипы
           под описанием: «Урон: 140%», «Кровотечение: 25%» и т.п. */
        .hp-ab-bonuses { display: flex; flex-wrap: wrap; gap: 6px; }
        .hp-ab-bonus {
            font-size: 11px; line-height: 1.4; color: #9fdcff;
            background: rgba(122, 209, 255, 0.10); border: 1px solid rgba(122, 209, 255, 0.35);
            border-radius: 999px; padding: 1px 8px; font-variant-numeric: tabular-nums;
        }
        .hp-ab-rows { display: flex; flex-direction: column; gap: 6px; flex: 1; }
        /* Строка категории: название · пипсы · значение · «+» · описание.
           Описание — во всю ширину второй строкой (grid-column: 1 / -1). */
        .hp-ab-row {
            display: grid; grid-template-columns: 92px 1fr auto auto auto; align-items: center; gap: 6px 8px;
            padding: 5px 8px; border-radius: 6px;
            background: #241c2b; border: 1px solid #33283d;
        }
        .hp-ab-name { font-size: 12px; font-weight: bold; color: #e8dfd0; }
        .hp-ab-pips { display: flex; gap: 3px; flex-wrap: wrap; }
        .hp-ab-pips i {
            width: 9px; height: 9px; border-radius: 50%;
            background: #3a2f44; border: 1px solid #4a3b55;
        }
        /* 11.6.5c.8: пипсы — золотые уровни плана, синие купленные в игре. */
        .hp-ab-pips i.on { background: #caa55c; border-color: #ffcf4a; box-shadow: 0 0 6px rgba(255, 207, 74, 0.55); }
        .hp-ab-pips i.sim { background: #4aa3ff; border-color: #7ad1ff; box-shadow: 0 0 6px rgba(74, 163, 255, 0.55); }
        .hp-ab-val { font-size: 11px; color: #9c8fa8; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .hp-ab-val b { color: #ffcf6a; font-size: 12px; }
        .hp-ab-btn {
            width: 26px; height: 26px; padding: 0; line-height: 1;
            border-radius: 6px; border: 1px solid #caa55c;
            background: rgba(202, 165, 92, 0.16); color: #ffcf6a;
            font-weight: bold; font-size: 15px; cursor: pointer;
            transition: background 0.15s, transform 0.1s, opacity 0.15s;
        }
        .hp-ab-btn:hover:not(:disabled) { background: rgba(202, 165, 92, 0.34); }
        .hp-ab-btn:active:not(:disabled) { transform: scale(0.94); }
        .hp-ab-btn:disabled {
            opacity: 0.35; cursor: not-allowed;
            border-color: #4a3d55; color: #8b7f96; background: rgba(255, 255, 255, 0.04);
        }
        /* 11.6.5c.2: «−» — нейтральная кнопка отката шага плана. */
        .hp-ab-btn.minus { border-color: #6b5570; background: rgba(255, 255, 255, 0.05); color: #d8c9a8; }
        .hp-ab-btn.minus:hover:not(:disabled) { background: rgba(255, 255, 255, 0.14); }
        .hp-ab-desc { grid-column: 1 / -1; font-size: 10px; color: #7f7389; line-height: 1.4; }
        /* ── Панель действий ── */
        .hp-arena-sim-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        /* 11.6.5c.2: сводка плана — кошелёк, стоимость плана, дефицит.
           Дефицит ничего не блокирует: это подсказка «сколько фармить». */
        .arena-plan-summary {
            display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px;
            padding: 8px 14px; font-size: 12px; color: #d8c9a8;
        }
        .arena-plan-summary b { color: #ffcf6a; font-variant-numeric: tabular-nums; }
        .arena-deficit { color: #ffb3a0; font-weight: bold; }
        .arena-deficit b { color: #ff8f7a; }
        .arena-ready { color: #8ff2a0; font-weight: bold; }
        .hp-arena-btn {
            background: #2a2030; border: 1px solid #44374a; color: #d8c9a8;
            padding: 7px 14px; border-radius: 6px; font-weight: bold; font-size: 13px; cursor: pointer;
            transition: background 0.15s, border-color 0.15s, opacity 0.15s;
        }
        .hp-arena-btn:hover:not(:disabled) { background: #352941; border-color: #caa55c; }
        .hp-arena-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        /* ── Подвал карточки/вкладки ── */
        .hp-card-foot { font-size: 11px; color: #8b7f96; line-height: 1.5; }
        .hp-card-foot b { color: #ffcf6a; font-variant-numeric: tabular-nums; }

        /* Редизайн заточки: Split-view (11.6.5f).
           Слева — таблица уровней, справа — карточка выбранной цели (+N).
           minmax(0, 1fr) у первой колонки обязателен: иначе таблица
           распирает грид-колонку по min-content и правая карточка уезжает
           за край модалки. */
        /* 11.6.5f.1: слева карточка цели (40%), справа таблица уровней (60%).
           flex-basis в сумме даёт >100% из-за gap 12px, поэтому колонки чуть
           поджимаются flex-shrink — пропорция 40:60 сохраняется, а вторая
           колонка не переносится на новую строку. */
        .hp-ench-split {
            display: flex;
            gap: 12px;
            align-items: flex-start;
            min-height: 0;
        }
        .hp-ench-left {
            flex: 1 1 40%; min-width: 280px;
            display: flex; flex-direction: column; gap: 10px;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px;
            padding: 10px 12px;
        }
        /* Таблица уровней: без вертикального скроллбара, чтобы 16 строк помещались в окне. */
        .hp-ench-right {
            flex: 1 1 auto; min-width: 0;
            overflow-x: auto;
            overflow-y: visible;
        }
        /* Узкая модалка/маленькое окно — таблица уезжает под карточку цели. */
        @media (max-width: 980px) {
            .hp-ench-split { flex-direction: column; }
            .hp-ench-left, .hp-ench-right, .hp-ench-rightcol { flex: 1 1 auto; width: 100%; min-width: 0; }
        }
        /* Таблица уровней: компактнее общих правил .custom-modal th/td и без
           псевдоэлемента сортировки «↕» (здесь сортировки нет). Запрещаем
           вертикальное растяжение таблицы и строк (без пустых зазоров). */
        .custom-modal .hp-ench-table {
            height: auto !important;
            align-self: start;
            border-collapse: collapse;
        }
        .hp-ench-table tbody,
        .hp-ench-table tr {
            height: auto !important;
        }
        .custom-modal .hp-ench-table th,
        .custom-modal .hp-ench-table td {
            padding: 3px 8px !important;
            line-height: 1.2 !important;
            height: auto !important;
            font-size: 12px;
        }
        .custom-modal .hp-ench-table th { cursor: default; white-space: nowrap; }
        .custom-modal .hp-ench-table th::after { content: ''; }
        /* Строка уровня — кликабельный ВЫБОР уровня просмотра (v11.7.1: все
           строки +0…+15 кликабельны, в том числе пройденные). */
        .hp-ench-table .hp-ench-row { cursor: pointer; transition: background 0.12s; }
        .hp-ench-table .hp-ench-row:hover { background: rgba(202, 165, 92, 0.08); }
        .hp-ench-table .hp-ench-row.passed { cursor: default; opacity: 0.45; }
        .hp-ench-table .hp-ench-row.passed:hover { background: transparent; }
        .hp-ench-table .hp-ench-row.cur { opacity: 1; background: rgba(202, 165, 92, 0.12); }
        .hp-ench-table .hp-ench-row.target { background: rgba(122, 209, 255, 0.12); }
        .hp-ench-table .hp-ench-row.target td:first-child { box-shadow: inset 2px 0 0 #7ad1ff; }
        /* v11.7.1: строка ВЫБРАННОГО уровня просмотра (может быть и ниже
           текущей заточки) — голубая подсветка слева. */
        .hp-ench-table .hp-ench-row.preview { background: rgba(122, 209, 255, 0.1); }
        .hp-ench-table .hp-ench-row.preview td:first-child { box-shadow: inset 2px 0 0 #7ad1ff; }
        /* Колонка «Статы»: значения предмета на уровне этой строки. */
        .custom-modal .hp-ench-table td.hp-ench-stats {
            font-size: 11px; line-height: 1.35; color: #b9adc6;
            min-width: 140px; font-variant-numeric: tabular-nums;
        }
        /* Чипы усилителей (⭐ звезда / 🌐 сфера) в колонке «Усилители». */
        .hp-mats-cell { white-space: nowrap; }
        .hp-mat-chip {
            display: inline-flex; align-items: center; gap: 3px;
            font-size: 12px; line-height: 1; padding: 3px 6px; margin: 0 2px;
            border-radius: 6px; border: 1px solid #4a3b55; background: #241c2b;
            cursor: pointer; user-select: none;
        }
        .hp-mat-chip input { margin: 0; cursor: pointer; accent-color: #caa55c; }
        .hp-mat-chip.star { border-color: rgba(202, 165, 92, 0.5); }
        .hp-mat-chip.sphere { border-color: rgba(122, 209, 255, 0.45); }
        /* В режиме «Идеально» усилители не участвуют в расчёте — чипы-подсказки. */
        .hp-mat-chip.muted { cursor: default; opacity: 0.35; }
        /* v11.7.1: кнопки-переключатели ресурсов ⭐/🌐 в строках уровней
           (заменили браузерные чекбоксы). Активное состояние подсвечивается:
           звезда — золотым, сфера — голубым. */
        .hp-mat-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 24px; height: 22px; margin: 0 2px; padding: 0;
            font: inherit; font-size: 12px; line-height: 1;
            border-radius: 6px; border: 1px solid #4a3b55; background: #241c2b;
            cursor: pointer; user-select: none;
            transition: background 0.15s, border-color 0.15s, transform 0.1s;
        }
        .hp-mat-btn:hover { background: #352941; border-color: #6b5a7a; }
        .hp-mat-btn:active { transform: scale(0.94); }
        .hp-mat-btn.star:hover { border-color: rgba(202, 165, 92, 0.7); }
        .hp-mat-btn.sphere:hover { border-color: rgba(122, 209, 255, 0.7); }
        .hp-mat-btn.star.active {
            background: rgba(202, 165, 92, 0.28); border-color: #caa55c;
            box-shadow: 0 0 6px rgba(202, 165, 92, 0.45);
        }
        .hp-mat-btn.sphere.active {
            background: rgba(122, 209, 255, 0.22); border-color: #7ad1ff;
            box-shadow: 0 0 6px rgba(122, 209, 255, 0.4);
        }
        /* ── Шапка карточки: «Просмотр: +N» + пресеты уровней ── */
        .hp-target-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .hp-target-title { font-size: 13px; color: #d8c9a8; }
        .hp-target-title b { color: #ffcf6a; font-size: 19px; font-variant-numeric: tabular-nums; }
        .hp-target-presets { display: flex; gap: 4px; margin-left: auto; }
        .hp-target-preset {
            background: #2a2030; border: 1px solid #44374a; color: #d8c9a8;
            padding: 3px 9px; border-radius: 999px; font: inherit; font-size: 12px;
            font-weight: bold; cursor: pointer;
            transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
        }
        .hp-target-preset:hover:not(:disabled) { background: #352941; border-color: #caa55c; }
        .hp-target-preset.active { background: #caa55c; border-color: #caa55c; color: #1d1620; }
        .hp-target-preset:disabled { opacity: 0.35; cursor: not-allowed; }
        /* v11.7.1: пройденный уровень — приглушён, но КЛИКАБЕЛЕН (можно
           посмотреть статы на уже достигнутой заточке). */
        .hp-target-preset.done { opacity: 0.55; border-style: dashed; }
        .hp-target-preset.done:hover { opacity: 1; }
        /* ── Секции карточки: статы и стоимость ── */
        .hp-target-section {
            display: flex; flex-direction: column; gap: 6px;
            border-top: 1px solid #33283d; padding-top: 8px;
        }
        .hp-target-sub {
            font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: #9c8fa8;
        }
        .hp-stat-grid { display: flex; flex-direction: column; gap: 4px; }
        .hp-stat-row { display: flex; align-items: baseline; gap: 8px; font-size: 12px; color: #d8c9a8; }
        .hp-stat-name {
            flex: 1; min-width: 0; color: #9c8fa8;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .hp-stat-val { white-space: nowrap; font-variant-numeric: tabular-nums; }
        .hp-stat-val b { color: #ffcf6a; }
        .hp-stat-gain { color: #8ff2a0; font-size: 11px; }
        /* v11.7.1: значение на текущей заточке (когда смотрим другой уровень). */
        .hp-stat-cur { color: #9c8fa8; font-size: 11px; }
        .hp-cost-total { font-size: 20px; font-weight: bold; color: #ffcf6a; font-variant-numeric: tabular-nums; }
        .hp-cost-sub { font-size: 11px; color: #9c8fa8; line-height: 1.45; }
        .hp-cost-row { font-size: 12px; color: #d8c9a8; font-variant-numeric: tabular-nums; }
        .hp-cost-note { font-size: 11px; color: #888; line-height: 1.5; margin-top: 10px; }

        /* ── Компактный верх вкладки «Заточка» (11.6.5f.1) ──
           Было 5 полос подряд (режимы, инпуты ресурсов, цены, штраф
           экипировки, локации) — стало 2:
             1) topbar: режимы | инпуты | цены;
             2) суббар: локации + плитка предметов в один ряд.
           Статус экипировки ушёл в иконку рядом с названием предмета. */
        .hp-ench-topbar {
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px 16px; flex-wrap: wrap;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px;
            padding: 5px 10px;
        }
        .hp-mode-switch {
            display: flex; gap: 3px; flex: none;
            background: #241c2b; border: 1px solid #3d2f44; border-radius: 6px; padding: 3px;
        }
        .hp-ench-topbar .hp-mode-btn { padding: 5px 12px; font-size: 12px; line-height: 1.2; }
        .hp-mat-inputs { display: flex; align-items: center; gap: 12px; flex: 1 1 auto; }
        .hp-mat-inputs label {
            display: flex; align-items: center; gap: 6px;
            color: #ffcf6a; font-weight: bold; font-size: 12px; white-space: nowrap;
        }
        .hp-mat-inputs input {
            width: 44px; background: #111; border: 1px solid #555; color: #fff;
            padding: 2px 4px; border-radius: 4px; text-align: center;
            font-weight: bold; font-size: 12px;
        }
        .hp-mat-prices {
            display: flex; align-items: center; gap: 16px; margin-left: auto;
            font-size: 12px; color: #ccc; flex-wrap: wrap;
        }
        /* Вторая строка: локации слева, плитка предметов справа (скролл по X). */
        .hp-ench-subbar {
            display: flex; align-items: center; gap: 10px;
            border-bottom: 1px solid #44374a; padding-bottom: 6px; min-height: 0;
        }
        .hp-loc-tabs { display: flex; gap: 6px; flex: none; }
        .hp-loc-tabs .hp-loc-btn { padding: 4px 9px; font-size: 12px; line-height: 1.2; border-radius: 4px; }
        /* Плитка предметов: компактные иконки (было min-height:120px на контейнере
           и 32px арт с паддингом 8px — теперь ~44px по высоте). */
        .hp-item-grid {
            display: flex; align-items: center; gap: 6px;
            flex: 1 1 auto; min-width: 0; overflow-x: auto; padding: 2px 0;
        }
        .hp-item-grid .hp-item-card { min-width: 52px; padding: 4px 3px; }
        .hp-item-grid .hp-item-art {
            width: 24px; height: 24px; margin-bottom: 2px;
            display: flex; align-items: center; justify-content: center; overflow: hidden;
        }
        /* SVG-арт игры не имеет собственных размеров — растягиваем по контейнеру,
           как это делает <img> из getItemArtHtml (max-width/max-height:100%). */
        .hp-item-grid .hp-item-art > svg { width: 100%; height: 100%; display: block; }
        /* 11.6.5f.1: статус экипировки — маленькая иконка у названия предмета. */
        .hp-gear-pill {
            display: inline-flex; align-items: center; justify-content: center;
            width: 16px; height: 16px; margin-left: 4px; vertical-align: middle;
            border-radius: 50%; font-size: 11px; line-height: 1; cursor: help;
        }
        .hp-gear-pill.ok { color: #1d1620; background: #8ff2a0; }
        .hp-gear-pill.bad { color: #1d1620; background: #ffb3a0; }
        /* v11.7.1: шапка выбранного предмета — мини-арт + название/статус. */
        .hp-item-head { display: flex; align-items: flex-start; gap: 8px; }
        .hp-item-head-art {
            flex: none; width: 28px; height: 28px;
            display: flex; align-items: center; justify-content: center; overflow: hidden;
        }
        .hp-item-head-art > svg { width: 100%; height: 100%; display: block; }
        .hp-item-head-art > img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }

        /* ============================================================
           v11.7.0: ПЛАНИРОВЩИК ГЕРОЯ — ОКНО И БОКОВАЯ ПАНЕЛЬ СТАТОВ
           Модалка — min(1520px, 96vw) и не выше 92vh. Вкладки «Билды»
           и «Заточка» занимают 100% ширины. Двухколоночная сетка 1fr 320px
           с панелью характеристик рендерится строго внутри «Примерки».
           !important обязателен: общее правило некомпактных модалок
           задаёт width/height с !important.
           ============================================================ */
        .custom-modal.hp-planner-modal {
            width: min(1520px, 96vw) !important;
            max-height: 92vh !important;
        }
        /* v11.7.0: двухколоночная сетка строго внутри вкладки «Примерка» */
        .hp-fit-layout {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 320px;
            gap: 12px;
            flex: 1 1 auto;
            min-height: 0;
            width: 100%;
        }
        .hp-fit-main {
            display: flex;
            flex-direction: column;
            gap: 10px;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
        }
        #tab-hero-fit.active {
            display: flex !important;
            flex-direction: column !important;
            flex: 1 1 auto !important;
            min-height: 0 !important;
            max-height: 100% !important;
            overflow: hidden !important;
        }
        /* Узкое окно — панель характеристик уезжает под слоты примерки */
        @media (max-width: 1100px) {
            .hp-fit-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto; overflow-y: auto; }
            .hp-fit-layout > .hp-side { max-height: 40vh; }
        }

        /* Бейдж ТЕСТ на кнопке вкладки и внутри вкладки «Примерка» */
        .hp-test-badge {
            display: inline-block;
            padding: 1px 5px;
            font-size: 10px;
            font-weight: bold;
            letter-spacing: 0.5px;
            line-height: 1.2;
            border-radius: 4px;
            background: rgba(255, 107, 107, 0.2);
            color: #ff6b6b;
            border: 1px solid rgba(255, 107, 107, 0.6);
            vertical-align: middle;
            margin-left: 5px;
            text-transform: uppercase;
        }
        .modal-tab.active .hp-test-badge {
            background: #1d1620;
            color: #ff6b6b;
            border-color: #ff6b6b;
        }
        .hp-fit-head {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 2px;
        }
        .hp-fit-title {
            font-size: 14px;
            font-weight: bold;
            color: #ffcf6a;
        }

        /* ── Постоянная панель характеристик ── */
        .hp-side {
            display: flex; flex-direction: column; gap: 2px;
            min-height: 0; overflow-y: auto;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px;
            padding: 10px 12px; font-size: 12px;
        }
        .hp-side-head {
            font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px;
            color: #ffcf6a; font-weight: bold; margin-bottom: 4px;
        }
        .hp-side-cols,
        .hp-side-row {
            display: grid; grid-template-columns: 1fr auto 46px;
            align-items: baseline; gap: 6px;
        }
        .hp-side-cols {
            font-size: 10px; color: #7f7389; text-transform: uppercase;
            letter-spacing: 0.3px; border-bottom: 1px solid #33283d; padding-bottom: 4px;
        }
        .hp-side-cols span:nth-child(2),
        .hp-side-cols span:nth-child(3) { text-align: right; }
        .hp-side-row {
            padding: 2px 0; color: #d8c9a8;
            border-bottom: 1px dashed rgba(255, 255, 255, 0.04);
        }
        .hp-side-row.strong { color: #f7eadf; font-weight: bold; }
        .hp-side-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hp-side-vals { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .hp-side-vals b { color: #ffcf6a; }
        .hp-side-delta { text-align: right; font-weight: bold; font-variant-numeric: tabular-nums; }
        .hp-side-delta.up { color: #8ff2a0; }
        .hp-side-delta.down { color: #ff9a8a; }
        .hp-side-delta.same { color: #6f6380; }
        .hp-side-sep { border-top: 1px solid #44374a; margin: 5px 0 3px; }
        .hp-side-foot { margin-top: 6px; font-size: 10px; color: #8b7f96; line-height: 1.4; }

        /* ── Вкладка «👗 Примерка» ── */
        .hp-fit-top {
            display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px;
            padding: 6px 10px;
        }
        .hp-fit-field {
            display: flex; align-items: center; gap: 6px;
            font-size: 12px; color: #d8c9a8; white-space: nowrap;
        }
        .hp-fit-field select,
        .hp-fit-field input {
            background: #111; border: 1px solid #555; color: #fff;
            padding: 3px 6px; border-radius: 4px; font-weight: bold; font-size: 12px;
        }
        .hp-fit-field input { width: 58px; text-align: center; }
        .hp-fit-chk {
            display: flex; align-items: center; gap: 5px;
            font-size: 12px; color: #d8c9a8; cursor: pointer;
        }
        .hp-fit-rows { display: flex; flex-direction: column; gap: 6px; }
        .hp-fit-row {
            display: grid; grid-template-columns: 132px minmax(0, 1fr) 76px;
            align-items: center; gap: 8px;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 6px;
            padding: 5px 8px;
        }
        .hp-fit-slot { font-size: 12px; color: #d8c9a8; white-space: nowrap; }
        .hp-fit-row select {
            min-width: 0; width: 100%;
            background: #241c2b; border: 1px solid #44374a; color: #e8dfd0;
            border-radius: 4px; padding: 3px 6px; font-size: 12px;
        }
        .hp-fit-row select:focus { outline: none; border-color: #caa55c; }
        .hp-fit-en { font-variant-numeric: tabular-nums; text-align: center; }

        /* ── Компактная «Заточка»: справка справа снизу ── */
        .hp-cost-min { font-size: 11px; color: #8ff2a0; font-variant-numeric: tabular-nums; }
        .hp-ench-rightcol {
            flex: 1 1 60%; min-width: 0; min-height: 0;
            display: flex; flex-direction: column; gap: 6px;
            align-self: start;
        }
        /* v11.7.0: без вертикального скроллбара — таблица +0…+15 и справка помещаются целиком */
        .hp-ench-rightcol > .hp-ench-right {
            flex: 0 0 auto;
            max-height: none;
            overflow-x: auto;
            overflow-y: visible;
        }
        .hp-ench-hint {
            flex: none;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 6px;
            padding: 6px 9px; font-size: 10px; line-height: 1.45; color: #8b7f96;
        }
        .hp-ench-hint code { color: #d8c9a8; }
        .hp-ench-hint-prices {
            display: flex; flex-wrap: wrap; gap: 4px 14px;
            margin-bottom: 3px; font-size: 11px; color: #ccc;
        }

        /* 11.6.6c: палитра компактных бейджей участников (уровень, класс,
           роль, онлайн). v11.7: игра нативно показывает уровни, классы, силу
           и онлайн согильдейцев, поэтому окно гильдий аддон больше не
           размечает — правила оставлены как общая палитра для бейджей. */
        .lgu-guild-badges {
            display: inline-flex; flex-wrap: wrap; align-items: center;
            gap: 4px; margin-left: 6px; vertical-align: middle;
            font-size: 11px; line-height: 1.2; font-weight: normal;
        }
        .lgu-gst {
            display: inline-flex; align-items: center; gap: 3px;
            padding: 1px 6px; border-radius: 9px; white-space: nowrap;
            border: 1px solid #3d2f44; background: #201826; color: #cfc6d6;
            cursor: help;
        }
        .lgu-gst.on { border-color: #3d7a4a; background: #17301f; color: #8ff2a0; }
        .lgu-gst.on.mine { border-color: #4a6f8f; background: #16242e; color: #9fd6ff; }
        .lgu-gst.time { border-color: #4a4437; background: #241f16; color: #ffcf6a; }
        .lgu-gst.friend { border-color: #6b4a7a; background: #2a1f33; color: #e5b3ff; }
        .lgu-gst.warn { border-color: #7a3d3d; background: #2e1717; color: #ffb3a0; }
        .lgu-gst.off { border-color: #3d3d44; background: #1b1b20; color: #8a8a92; }

        /* 11.6.6c.1: уровень и класс героя. Классы .lgu-cls-* повторяют
           палитру игры (CLASS_META в reference/LegionFrontSRC/lib/game-data.js). */
        .lgu-gbadge {
            display: inline-flex; align-items: center; gap: 3px;
            padding: 1px 6px; border-radius: 9px; white-space: nowrap;
            border: 1px solid #3d2f44; background: #201826; color: #cfc6d6;
            font-weight: bold; cursor: help;
        }
        .lgu-glvl { border-color: #5a5142; background: #241f18; color: #ffcf6a; }
        .lgu-gcls { border-color: #4a5f7a; background: #17222e; color: #9fd6ff; }
        .lgu-cls-legionary { border-color: #a3122a; background: #2a1216; color: #ff9aa2; }
        .lgu-cls-archer { border-color: #2f7a3a; background: #142318; color: #9fe3a2; }
        .lgu-cls-rogue { border-color: #4a4a6a; background: #1b1b24; color: #c9c9e0; }
        .lgu-cls-mage { border-color: #5b3aa8; background: #1e1730; color: #c3a4ff; }
        .lgu-cls-necromancer { border-color: #2f5a4a; background: #14231e; color: #8fe3c4; }
        .lgu-cls-priest { border-color: #9a6a1a; background: #2a2212; color: #ffd88a; }
        .lgu-cls-paladin { border-color: #8a7a2a; background: #262212; color: #ffe9a0; }
        .lgu-cls-recruit { border-color: #3d3d44; background: #1b1b20; color: #b9b9c2; }

        /* «Арена» (modules/arena.js): бейдж шанса победы, плашка
           согильдейцев и подсветка слотов. Палитра — нативная светлая
           карточка новой арены (reference/LegionFrontSRC/site/arena2.css:
           --gw-sep, --gw-soft, --gw-line, --gw-bt, --ar-win/--ar-lose). */

        /* Бейдж шанса победы — в стиле .av-gain: светлая «пилюля» с рамкой,
           шрифт заголовков арены. */
        .lgu-win-chance {
            display: flex;
            align-items: center;
            border-radius: 999px;
            border: 2px solid var(--gw-sep, rgba(43, 29, 24, .2));
            background: var(--gw-soft, rgba(255, 255, 255, .7));
            font: 800 13px var(--gw-bt, 'Russo One', sans-serif);
            padding: 5px 12px;
            text-align: center;
            justify-content: center;
            cursor: help;
        }
        .lgu-win-chance.high {
            background: #eef8e8;
            border-color: rgba(47, 107, 26, .35);
            color: var(--ar-win, #2f6b1a);
        }
        .lgu-win-chance.mid {
            background: #fff8e2;
            border-color: rgba(176, 118, 12, .35);
            color: #8a5800;
        }
        .lgu-win-chance.low {
            background: #fdeceb;
            border-color: rgba(163, 48, 28, .35);
            color: var(--ar-lose, #a3301c);
        }
        /* .av-panel.av-off — блочная карточка с padding 12px, поэтому бейдж
           встаёт отдельной строкой перед .av-gain без своего отступа. */
        .av-panel.av-off > .lgu-win-chance { margin: 2px 0 0; }

        /* Плашка «Согильдейцы» — нативная «пилюля» .av-chip в зелёной гамме,
           чтобы не спорить с чипом рейтинга. margin-left: auto прижимает пару
           «бейдж + чип» вправо в .av-oh (display:flex;
           justify-content:space-between). Текст компактный (arena.js),
           полный список имён — всегда в title. */
        .lgu-guild-foe-warn {
            background: #e0f2d8;
            color: #1e4a12;
            border: 2px solid var(--gw-line, #2b1d18);
            border-radius: 999px;
            font: 800 12px var(--gw-bt, 'Russo One', sans-serif);
            padding: 3px 9px;
            white-space: nowrap;
            flex-shrink: 0;
            margin-left: auto;
            cursor: help;
        }

        /* Контейнер бейджей окна боя (.av-fwin): встаёт перед .av-fbtns. */
        .lgu-arena-card-badge {
            display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
            margin: 4px 0 8px;
        }
        .lgu-arena-card-badge .lgu-win-chance { margin: 0; }
        .lgu-arena-card-badge .lgu-guild-foe-warn { margin-left: 0; }

        /* Подсветка согильдейца на мини-сцене карточки (.av-mh.av-pN) и на
           поле боя (.av-hero.av-foe). Класс ставится только на контейнер:
           textContent, отступы и --fs внутри .av-nm не трогаем — иначе
           сломается нативный подбор размера шрифта ника (nm() в arena2.js). */
        .av-mh.lgu-ally-slot .av-nm {
            background: rgba(34, 98, 26, .92) !important;
            box-shadow: 0 0 0 1.5px #86efac;
        }
        .av-mh.lgu-ally-slot .av-nm span { color: #bbf7d0 !important; }
        .av-mh.lgu-ally-slot .av-f,
        .av-hero.av-foe.lgu-ally-slot .av-f {
            filter: drop-shadow(0 0 5px rgba(74, 222, 128, .9));
        }
        .av-hero.av-foe.lgu-ally-slot .av-nm {
            background: rgba(34, 98, 26, .92) !important;
            box-shadow: 0 0 0 1.5px #86efac;
        }

        /* v11.7: тултип снаряжения соперника (modules/arena.js).
           Появляется по наведению (250 мс) или клику на фигурку бойца на
           мини-сцене карточки (.av-scene .av-mh) и в окне боя (.av-fwin
           .av-hero). Палитра — нативная светлая карточка арены (arena2.css:
           --gw-card/--gw-line/--gw-bt/--gw-mute), поэтому не спорит с игрой. */
        .lgu-arena-gear-tip {
            position: fixed; z-index: 100000; pointer-events: none;
            width: min(300px, 92vw); padding: 9px 11px 10px;
            border: 2px solid var(--gw-line, #2b1d18);
            border-radius: calc(var(--gw-rc, 12px) * .9);
            background: var(--gw-card, #fffaf2);
            color: var(--gw-ink, #2b1d18);
            box-shadow: 0 10px 26px rgba(43, 29, 24, .22);
            font: 12px/1.35 var(--gw-tx, system-ui, sans-serif);
        }
        .lgu-agit-head { display: flex; flex-direction: column; gap: 1px; margin-bottom: 6px; }
        .lgu-agit-head > b {
            font: 700 13.5px var(--gw-bt, 'Russo One', sans-serif);
            color: var(--gw-title, #5a3458);
        }
        .lgu-agit-head > span,
        .lgu-agit-head > div > span { font-size: 11.5px; color: var(--gw-mute, #6b5148); }
        .lgu-agit-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
        .lgu-agit-items > li {
            display: grid;
            grid-template-columns: 82px minmax(0, 1fr);
            grid-template-areas: 'slot name' 'slot stat';
            column-gap: 7px; align-items: baseline;
            padding: 3px 5px; border-radius: 6px;
            background: var(--gw-soft, rgba(43, 29, 24, .05));
            border-left: 3px solid var(--gw-sep, rgba(43, 29, 24, .2));
        }
        .lgu-agit-items > li.empty { opacity: .62; }
        .lgu-agit-items > li[data-r="uncommon"] { border-left-color: #3f9e46; }
        .lgu-agit-items > li[data-r="rare"] { border-left-color: #3a7fd0; }
        .lgu-agit-items > li[data-r="epic"] { border-left-color: #8a4fd0; }
        .lgu-agit-items > li[data-r="legendary"] { border-left-color: #d9921f; }
        .lgu-agit-slot { grid-area: slot; font-size: 11px; color: var(--gw-mute, #6b5148); white-space: nowrap; }
        .lgu-agit-name {
            grid-area: name; min-width: 0;
            font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .lgu-agit-name > b { color: #b07b16; }
        .lgu-agit-items > li > small { grid-area: stat; font-size: 10.5px; color: var(--gw-mute, #6b5148); }
        .lgu-agit-abs { display: flex; flex-direction: column; gap: 2px; margin-top: 7px; font-size: 11px; }
        .lgu-agit-abs > span { display: flex; gap: 4px; align-items: baseline; }
        .lgu-agit-abs > span > i { font-style: normal; }
        .lgu-agit-abs > span.off { opacity: .6; }
        .lgu-agit-abs > span > b { color: var(--gw-title, #5a3458); }
        .lgu-agit-abs em { font-style: normal; font-size: 10.5px; opacity: .85; }


        /* ============================================================
           «СТАТИСТИКА ГИЛЬДИИ» (modules/guild-summary.js)
           Четвёртая вкладка в НАТИВНОМ окне гильдии (.gl-modal ->
           .gl-tabs.gl-tabs1 -> .gl-pane). Палитра — переменные темы
           reference/LegionFrontSRC/site/guilds.css / guilds2.css:
           --gw-card, --gw-sep, --gw-line, --gw-rc, --gw-bt, --gw-title,
           --gw-sel, --gw-acc. Своих цветов не вводим, чтобы сводка
           совпадала с нативной карточкой в любом скине.
           ============================================================ */
        .gl-tabs1 .lgu-gl-tab { display: inline-flex; align-items: center; }
        .gl-tabs1 .lgu-gl-tab > svg.i {
            width: 18px; height: 18px; flex: none; margin-right: 5px;
            display: block;
        }
        /* Нативная панель скрывается только на время показа нашей вкладки;
           селектор повторяет .gl-wide .gl-pane, поэтому !important нужен. */
        .gl-body > .gl-pane.lgu-gl-pane-hidden { display: none !important; }

        .gl-pane.lgu-gl-stats-pane {
            box-sizing: border-box;
            padding: 14px 16px 18px;
            color: var(--gw-ink, #2b1d18);
            font-family: var(--gw-tx, system-ui, sans-serif);
        }

        .lgu-gl-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
            gap: 10px;
            align-items: start;
        }
        .lgu-gl-card {
            min-width: 0;
            padding: 14px 18px;
            border: 2px solid var(--gw-sep, rgba(43, 29, 24, .15));
            border-radius: var(--gw-rc, 12px);
            background: var(--gw-card, #fff);
        }
        .lgu-gl-card-wide { grid-column: 1 / -1; }

        .lgu-gl-h4 {
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px; margin: 0 0 8px; padding-bottom: 6px;
            border-bottom: 2px dashed var(--gw-sep, rgba(43, 29, 24, .15));
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 15px;
            letter-spacing: 0.2px;
            color: var(--gw-title, #5a3458);
        }
        .lgu-gl-h4 > span {
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 14px;
            color: var(--gw-mute, #6b5148);
            white-space: nowrap;
        }

        /* Строки метрик: подпись слева, значение справа. */
        .lgu-gl-rows { display: flex; flex-direction: column; }
        .lgu-gl-row {
            display: flex; align-items: baseline; justify-content: space-between;
            gap: 10px; padding: 4px 0; font-size: 13.5px;
            border-bottom: 1px dashed var(--gw-sep, rgba(43, 29, 24, .15));
        }
        .lgu-gl-row:last-child { border-bottom: 0; }
        .lgu-gl-row > span { color: var(--gw-mute, #6b5148); font-weight: 600; }
        .lgu-gl-row > b {
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 14px;
            white-space: nowrap;
        }
        .lgu-gl-row > b.on { color: var(--gw-sel, #5a3458); }
        .lgu-gl-row > b.warn { color: var(--gw-hot, #b2442c); }

        /* Классы: название, доля и прогресс-бар (заливка --gw-sel). */
        .lgu-gl-classes {
            list-style: none; margin: 0; padding: 0;
            display: flex; flex-direction: column; gap: 7px;
        }
        .lgu-gl-cl-head {
            display: flex; align-items: baseline; justify-content: space-between;
            gap: 8px; font-size: 13px;
        }
        .lgu-gl-cl-head > b {
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: 600;
            font-size: 13.5px;
            color: var(--gw-title, #5a3458);
        }
        .lgu-gl-cl-head > span {
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 14px;
            color: var(--gw-mute, #6b5148);
            white-space: nowrap;
        }
        .lgu-gl-bar {
            height: 10px; margin-top: 3px; overflow: hidden;
            border: 2px solid var(--gw-line, #2b1d18);
            border-radius: 999px;
            background: var(--gw-chip, rgba(43, 29, 24, .12));
        }
        .lgu-gl-bar > i {
            display: block; height: 100%; width: 0; border-radius: 999px;
            background: var(--gw-sel, #5a3458);
            transition: width .25s;
        }

        /* Топ-5 по силе и список неактивных. */
        .lgu-gl-top, .lgu-gl-idle {
            list-style: none; margin: 0; padding: 0;
            display: flex; flex-direction: column; gap: 4px;
        }
        .lgu-gl-toprow, .lgu-gl-idlerow {
            display: flex; align-items: center; gap: 9px;
            padding: 5px 7px;
            border: 2px solid transparent;
            border-radius: calc(var(--gw-rc, 12px) * .6);
            background: var(--gw-soft, rgba(43, 29, 24, .04));
        }
        .lgu-gl-toprow.first {
            border-color: var(--gw-acc, #ffcf4a);
            background: var(--gw-hi, rgba(255, 207, 74, .2));
        }
        .lgu-gl-rank {
            flex: none; display: grid; place-items: center;
            width: 24px; height: 24px; border-radius: 50%;
            background: var(--gw-sel, #5a3458);
            color: var(--gw-on-sel, #fff1d6);
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 14px;
        }
        .lgu-gl-toprow.first .lgu-gl-rank {
            background: var(--gw-acc, #ffcf4a);
            color: var(--gw-on-acc, #2b1d18);
        }
        .lgu-gl-who { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
        .lgu-gl-who > b {
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: 600;
            font-size: 13.5px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .lgu-gl-who > small { font-size: 11.5px; color: var(--gw-mute, #6b5148); }
        .lgu-gl-power {
            flex: none; white-space: nowrap;
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 14px;
            color: var(--gw-title, #5a3458);
        }
        .lgu-gl-idledays {
            flex: none; white-space: nowrap;
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 14px;
            color: var(--gw-hot, #b2442c);
        }

        .lgu-gl-note { margin: 6px 0 0; font-size: 12.5px; color: var(--gw-mute, #6b5148); }
        .lgu-gl-foot { margin-top: 10px; text-align: right; }

        /* v11.7: кликабельные строки участников (инспектор героя). */
        .lgu-gl-hero-row { cursor: pointer; }
        .lgu-gl-hero-row:hover,
        .lgu-gl-hero-row:focus-visible {
            border-color: var(--gw-sel, #5a3458);
            background: var(--gw-chip, rgba(43, 29, 24, .12));
            outline: none;
        }
        .lgu-gl-hero-row:focus-visible { box-shadow: 0 0 0 2px var(--gw-acc, #ffcf4a); }
        .lgu-gl-hero-row > .lgu-gl-who > b { text-decoration: underline dotted transparent; }
        .lgu-gl-hero-row:hover > .lgu-gl-who > b { text-decoration-color: currentColor; }

        /* v11.7: оверлей-карточка героя участника (GET /api/guilds/hero).
           Палитра — переменные guilds2.css, чтобы карточка совпадала с
           нативной сводкой в любом скине. */
        .lgu-gl-hero {
            position: fixed; inset: 0; z-index: 9998;
            display: flex; align-items: center; justify-content: center;
            padding: 18px;
            background: rgba(20, 13, 10, .42);
        }
        .lgu-gl-hero-box {
            box-sizing: border-box;
            width: min(420px, 96vw); max-height: min(78vh, 720px); overflow: auto;
            padding: 12px 14px 14px;
            border: 2px solid var(--gw-line, #2b1d18);
            border-radius: calc(var(--gw-rc, 12px) * 1.1);
            background: var(--gw-card, #fffaf2);
            color: var(--gw-ink, #2b1d18);
            box-shadow: 0 16px 40px rgba(20, 13, 10, .38);
            font-family: var(--gw-tx, system-ui, sans-serif);
        }
        .lgu-gl-hero-head { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
        .lgu-gl-hero-head > div { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
        .lgu-gl-hero-head b {
            font: 700 15px var(--gw-bt, 'Russo One', sans-serif);
            color: var(--gw-title, #5a3458);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .lgu-gl-hero-head span { font-size: 11.5px; color: var(--gw-mute, #6b5148); }
        .lgu-gl-hero-x {
            flex: none; width: 26px; height: 26px; padding: 0;
            border-radius: 8px; cursor: pointer;
            border: 2px solid var(--gw-line, #2b1d18);
            background: var(--gw-soft, rgba(43, 29, 24, .05));
            color: var(--gw-hot, #b2442c);
            font-size: 13px; line-height: 1;
        }
        .lgu-gl-hero-x:hover { background: var(--gw-hi, rgba(255, 207, 74, .2)); }
        .lgu-gl-hero-meta {
            margin-bottom: 6px; font-size: 12px; color: var(--gw-mute, #6b5148);
        }
        .lgu-gl-hero-stats {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
            gap: 4px; margin-bottom: 8px;
        }
        .lgu-gl-hero-stats > span {
            display: flex; flex-direction: column; gap: 1px;
            padding: 4px 6px; border-radius: 7px;
            background: var(--gw-soft, rgba(43, 29, 24, .05));
            border: 1px solid var(--gw-sep, rgba(43, 29, 24, .2));
        }
        .lgu-gl-hero-stats small { font-size: 10.5px; color: var(--gw-mute, #6b5148); }
        .lgu-gl-hero-stats b { font: 700 13px var(--gw-bt, 'Russo One', sans-serif); }
        .lgu-gl-hero-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
        .lgu-gl-hero-items > li {
            display: grid; grid-template-columns: 82px minmax(0, 1fr);
            grid-template-areas: 'slot name' 'slot stat';
            column-gap: 7px; align-items: baseline;
            padding: 4px 6px; border-radius: 7px;
            background: var(--gw-soft, rgba(43, 29, 24, .05));
            border-left: 3px solid var(--gw-sep, rgba(43, 29, 24, .2));
        }
        .lgu-gl-hero-items > li.empty { opacity: .62; }
        .lgu-gl-hero-items > li[data-r="uncommon"] { border-left-color: #3f9e46; }
        .lgu-gl-hero-items > li[data-r="rare"] { border-left-color: #3a7fd0; }
        .lgu-gl-hero-items > li[data-r="epic"] { border-left-color: #8a4fd0; }
        .lgu-gl-hero-items > li[data-r="legendary"] { border-left-color: #d9921f; }
        .lgu-gl-hero-slot { grid-area: slot; font-size: 11px; color: var(--gw-mute, #6b5148); white-space: nowrap; }
        .lgu-gl-hero-name {
            grid-area: name; min-width: 0; font-weight: 600;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .lgu-gl-hero-name > b { color: #b07b16; }
        .lgu-gl-hero-items > li > small { grid-area: stat; font-size: 10.5px; color: var(--gw-mute, #6b5148); }
        .lgu-gl-hero-abs { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; font-size: 11.5px; }
        .lgu-gl-hero-abs > span { display: flex; gap: 5px; align-items: baseline; }
        .lgu-gl-hero-abs > span > i { font-style: normal; }
        .lgu-gl-hero-abs > span.off { opacity: .6; }
        .lgu-gl-hero-abs > span > b { color: var(--gw-title, #5a3458); }
        .lgu-gl-hero-abs em { font-style: normal; font-size: 10.5px; opacity: .85; }

        @media (max-width: 560px) {
            .lgu-gl-grid { grid-template-columns: minmax(0, 1fr); }
        }

        /* ============================================================
           ПЛАНИРОВЩИК БИЛДОВ — РАДИАЛЬНОЕ СОЗВЕЗДИЕ
           Модуль: modules/build-sim.js. Карта повторяет skillmap.js:
           viewBox="-600 -600 1200 1200", центр 'hub' в (0,0),
           ветки окрашены по bi % 3 (--bc-0..2 как в skillmap.css).
           ============================================================ */
        .lgu-skm-layout [hidden] { display: none !important; }
        /* v11.6.9: было align-items: flex-start — из-за этого .sim-main-content
           рос по контенту, его overflow-y: auto не включался, и низ вкладки
           («Навыки Арены», «Что дают открытые навыки») обрезался overflow:
           hidden у #tab-hero-build / #hp-buildsim-container. Сайдбар классов
           по-прежнему не растягивается: у .sim-sidebar свой align-self:
           flex-start + position: sticky. */
        .lgu-skm-layout { align-items: stretch; }
        .lgu-skm-layout > .sim-main-content { min-height: 0; max-height: 100%; }
        /* Дети колонки не сжимаются: иначе flex-shrink мог «сплющить» блок
           «Навыки Арены» или сводку, и вместо прокрутки вкладки появился бы
           второй, внутренний скролл. */
        .lgu-skm-layout .sim-main-content > * { flex: none; }
        .lgu-skm-layout .sim-sidebar .lgu-skm-i { width: 16px; height: 16px; flex: none; }
        .lgu-skm-layout .sim-tab.active .lgu-skm-i { color: inherit; }

        /* Шапка: счётчики SP/жетонов + пресеты. */
        .lgu-skm-bar {
            height: auto !important;
            min-height: 38px;
            flex-wrap: wrap;
            row-gap: 6px;
            padding: 6px 8px !important;
        }
        .lgu-skm-res { display: inline-flex; align-items: baseline; gap: 5px; white-space: nowrap; font-size: 12px; color: var(--tb-chalk2, #c9d2c3); }
        .lgu-skm-res em { font-style: normal; }
        .lgu-skm-res > b { color: var(--tb-gold, #ffcf4a); font-size: 16px; line-height: 1; font-variant-numeric: tabular-nums; }
        .lgu-skm-res > b.over { color: #ff6b81; }
        .lgu-skm-res > small { color: #9c8fa8; font-size: 11px; }
        .lgu-skm-bar .lgu-skm-build-list { width: 180px; flex: 0 1 180px; }
        .lgu-skm-bar .sim-save-name { width: 140px; flex: 0 1 140px; }

        /* Панель героя над картой. */
        .lgu-skm-hero {
            display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
            margin: 0 0 10px; padding: 8px 12px;
            background: linear-gradient(120deg, #1e1724, #241c2b);
            border: 1px solid #3d2f44; border-radius: 10px;
        }
        .lgu-skm-avat {
            display: grid; place-items: center; width: 34px; height: 34px; flex: none;
            border-radius: 50%; border: 2px solid var(--c, #ffd24a); color: var(--c, #ffd24a);
            background: rgba(0, 0, 0, .35);
        }
        .lgu-skm-avat .lgu-skm-i { width: 20px; height: 20px; }
        .lgu-skm-who { display: flex; flex-direction: column; min-width: 0; }
        .lgu-skm-who > b { color: #f7eadf; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lgu-skm-who > small { color: #9c8fa8; font-size: 11.5px; }
        .lgu-skm-pill {
            display: inline-flex; align-items: baseline; gap: 5px; padding: 3px 10px;
            border-radius: 999px; border: 1px solid #44374a; background: rgba(0, 0, 0, .3);
            color: #d8c9a8; font-size: 12px; white-space: nowrap;
        }
        .lgu-skm-pill em { font-style: normal; color: #9c8fa8; font-size: 10.5px; }
        /* Статус умения класса прижат вправо (бейдж «песочница» удалён). */
        .lgu-skm-pill.status { margin-left: auto; }
        /* Порог умения класса пройден: активный статус (зелёный), а не «перебор». */
        .lgu-skm-pill.hub-on {
            border-color: rgba(126, 217, 129, .55);
            background: rgba(64, 160, 82, .16);
            color: #8ee59a;
            box-shadow: 0 0 8px rgba(126, 217, 129, .22);
        }

        /* Карта + инспектор. */
        .lgu-skm-stage { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; align-items: start; margin-bottom: 12px; }
        .lgu-skm-map {
            position: relative; overflow: hidden; border-radius: 12px;
            border: 1px solid #2c3547;
            background: linear-gradient(160deg, #0b0f19 0%, #070a12 55%, #05070c 100%);
            height: clamp(360px, 56vh, 640px);
            cursor: grab;
            touch-action: none;
        }
        .lgu-skm-map.dragging { cursor: grabbing; }
        .lgu-skm-svg { display: block; width: 100%; height: 100%; user-select: none; }
        .lgu-skm-bg { fill: transparent; }
        .lgu-skm-zoom { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 4px; }
        .lgu-skm-zoom button {
            width: 28px; height: 28px; padding: 0; border-radius: 7px; cursor: pointer;
            border: 1px solid #3d4a5f; background: rgba(12, 17, 26, .85); color: #cfe0f5; font-size: 14px; line-height: 1;
        }
        .lgu-skm-zoom button:hover { border-color: #7fa7d6; color: #fff; }
        .lgu-skm-wait { fill: #9fb3c8; font: 16px 'Nunito', system-ui, sans-serif; }
        .lgu-skm-wait.bad { fill: #ff9aa8; }

        /* Рёбра созвездия. */
        .lgu-skm-edge { stroke: var(--bc, #5cc8ff); stroke-width: 2; stroke-linecap: round; opacity: .18; }
        .lgu-skm-edge.avail { opacity: .6; stroke-dasharray: 7 7; }
        .lgu-skm-edge.on { opacity: .95; stroke-width: 2.6; filter: drop-shadow(0 0 4px var(--bc, #5cc8ff)); }
        .lgu-skm-edge.q { stroke-dasharray: 2 7; opacity: .3; }
        .lgu-skm-edge.q.on { opacity: .9; }

        /* Центр (hub). */
        .lgu-skm-hub { color: var(--c, #ffd24a); cursor: pointer; }
        .lgu-skm-hub > circle { fill: rgba(12, 17, 26, .92); stroke: var(--c, #ffd24a); stroke-width: 2.4; }
        .lgu-skm-hub.on > circle { filter: drop-shadow(0 0 12px var(--c, #ffd24a)); stroke-width: 3; }
        .lgu-skm-hub.sel > circle { stroke: #fff; }
        .lgu-skm-hubcnt { fill: #9fb3c8; font: 12px 'Nunito', system-ui, sans-serif; }
        .lgu-skm-hub.on .lgu-skm-hubcnt { fill: var(--c, #ffd24a); font-size: 15px; }

        /* Пассивные узлы. */
        .lgu-skm-node { cursor: pointer; }
        .lgu-skm-node > circle { fill: rgba(9, 13, 21, .94); stroke: var(--bc, #5cc8ff); stroke-width: 2; transition: stroke-width .15s; }
        .lgu-skm-node > svg { color: var(--bc, #5cc8ff); opacity: .8; }
        .lgu-skm-node.has > circle { fill: color-mix(in srgb, var(--bc, #5cc8ff) 34%, #070a12); stroke-width: 2.6; }
        .lgu-skm-node.has > svg { color: #fff; opacity: 1; filter: drop-shadow(0 0 4px var(--bc, #5cc8ff)); }
        .lgu-skm-node.can > circle { stroke-dasharray: 5 4; }
        .lgu-skm-node.can > circle, .lgu-skm-node.can > svg { animation: lguSkmPulse 1.6s ease-in-out infinite; }
        .lgu-skm-node.cap > circle { stroke: #ffd24a; }
        .lgu-skm-node.sel > circle { stroke: #fff; stroke-width: 3; }
        .lgu-skm-node .rank { fill: #cbd5e1; font: 11px 'Nunito', system-ui, sans-serif; paint-order: stroke; stroke: #05070c; stroke-width: 3px; }
        .lgu-skm-node.has .rank { fill: #ffd24a; }
        @keyframes lguSkmPulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }

        /* Ромбы способностей Арены. */
        .lgu-skm-ab { cursor: pointer; }
        .lgu-skm-ab .shape { fill: rgba(9, 13, 21, .94); stroke: var(--bc, #c4a0ff); stroke-width: 2; }
        .lgu-skm-ab .glyph { fill: var(--bc, #c4a0ff); font: 16px 'Nunito', system-ui, sans-serif; }
        .lgu-skm-ab.has .shape { fill: color-mix(in srgb, var(--bc, #c4a0ff) 38%, #070a12); stroke-width: 2.6; }
        .lgu-skm-ab.has .glyph { fill: #fff; }
        .lgu-skm-ab.eq .shape { stroke: #ffd24a; filter: drop-shadow(0 0 7px rgba(255, 210, 74, .8)); }
        .lgu-skm-ab.can .shape { stroke-dasharray: 5 4; animation: lguSkmPulse 1.6s ease-in-out infinite; }
        .lgu-skm-ab.sel .shape { stroke: #fff; stroke-width: 3; }
        .lgu-skm-ab .badge { fill: #ffd24a; font: 11px 'Nunito', system-ui, sans-serif; paint-order: stroke; stroke: #05070c; stroke-width: 3px; }

        /* Молнии похода. */
        .lgu-skm-q rect { fill: rgba(9, 13, 21, .92); stroke: #55647c; stroke-width: 1.6; }
        .lgu-skm-q text { fill: #93a4bb; font: 13px 'Nunito', system-ui, sans-serif; }
        .lgu-skm-q.on rect { stroke: #ffd24a; filter: drop-shadow(0 0 6px rgba(255, 210, 74, .7)); }
        .lgu-skm-q.on text { fill: #ffd24a; }

        /* Подписи веток. */
        .lgu-skm-blab .nm { fill: var(--bc, #5cc8ff); font: 16px 'Russo One', 'Nunito', system-ui, sans-serif; letter-spacing: .03em; }
        .lgu-skm-blab .cnt { fill: #8fa1b8; font: 12px 'Nunito', system-ui, sans-serif; }

        /* Инспектор узла/способности/центра. */
        .lgu-skm-inspector {
            min-width: 0; padding: 12px; border-radius: 12px;
            border: 1px solid #3d2f44; background: #1e1724;
            max-height: clamp(360px, 56vh, 640px); overflow-y: auto;
        }
        .lgu-skm-hint { color: #c9d2c3; font-size: 12.5px; line-height: 1.45; }
        .lgu-skm-hint > b { display: block; margin-bottom: 8px; color: #ffcf6a; font-size: 13.5px; }
        .lgu-skm-hint p { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 6px; }
        .lgu-skm-hint i { flex: none; display: inline-grid; place-items: center; width: 16px; height: 16px; font-style: normal; }
        .lgu-skm-hint i.dot { border-radius: 50%; border: 2px solid #5cc8ff; margin-top: 2px; }
        .lgu-skm-hint i.diamond { border: 2px solid #c4a0ff; transform: rotate(45deg) scale(.72); margin-top: 2px; }
        .lgu-skm-hint i.bolt { color: #ffd24a; }
        .lgu-skm-hint .muted { color: #8b7f96; font-size: 11.5px; }

        .lgu-skm-ins { color: #e8e1d5; font-size: 12.5px; line-height: 1.4; }
        .lgu-skm-ins-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; padding-bottom: 7px; border-bottom: 1px dashed rgba(255, 255, 255, .14); }
        .lgu-skm-ins-head > b { flex: 1; min-width: 0; color: var(--bc, #ffcf6a); font-size: 15px; line-height: 1.25; }
        .lgu-skm-ins-head > small { color: #9c8fa8; font-size: 11px; white-space: nowrap; }
        .lgu-skm-ins-x { flex: none; width: 20px; height: 20px; padding: 0; border: none; border-radius: 5px; background: transparent; color: #c9b184; cursor: pointer; font-size: 12px; }
        .lgu-skm-ins-x:hover { color: #fff; background: rgba(255, 255, 255, .08); }
        .lgu-skm-ins-kind { margin-bottom: 6px; color: #9c8fa8; font-size: 11.5px; }
        .lgu-skm-ins-rank { margin-bottom: 6px; color: #c9d2c3; }
        .lgu-skm-ins-rank > b { color: #ffcf6a; font-size: 15px; }
        .lgu-skm-ins-fx { margin: 0 0 6px; color: #f4f1e4; }
        .lgu-skm-ins-next { margin: 0 0 6px; color: #9fb3c8; font-size: 11.5px; }
        .lgu-skm-ins-next.warn { color: #ffb3a0; }
        .lgu-skm-ins-cost { margin: 8px 0; padding: 6px 8px; border-radius: 7px; background: rgba(202, 165, 92, .12); color: #d8c9a8; }
        .lgu-skm-ins-cost b { color: #ffcf6a; }
        .lgu-skm-ins-nodes { list-style: none; margin: 6px 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
        .lgu-skm-ins-nodes li { display: flex; justify-content: space-between; gap: 8px; padding: 4px 6px; border-radius: 6px; background: rgba(0, 0, 0, .22); }
        .lgu-skm-ins-nodes span { color: #9c8fa8; font-size: 11.5px; }
        .lgu-skm-ins-nodes b { color: #f4f1e4; font-size: 11.5px; text-align: right; }
        .lgu-skm-ins-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
        .lgu-skm-btn {
            flex: 1 1 auto; min-width: 64px; height: 30px; padding: 0 10px;
            border: 1px solid #caa55c; border-radius: 7px; cursor: pointer;
            background: transparent; color: #ffcf6a; font: 700 12px 'Nunito', system-ui, sans-serif;
            transition: filter .15s, background .15s;
        }
        .lgu-skm-btn:hover:not(:disabled) { background: rgba(202, 165, 92, .16); }
        .lgu-skm-btn.main { background: #caa55c; border-color: #caa55c; color: #1d1620; }
        .lgu-skm-btn.main:hover:not(:disabled) { filter: brightness(1.1); }
        .lgu-skm-btn.danger { color: #ff8fa3; border-color: rgba(255, 90, 122, .6); }
        .lgu-skm-btn.danger:hover:not(:disabled) { background: rgba(255, 90, 122, .14); }
        .lgu-skm-btn:disabled { opacity: .42; cursor: not-allowed; }

        /* Блок «Навыки Арены». */
        .lgu-skm-arena { margin-bottom: 12px; padding: 12px 14px; border: 1px solid #3d2f44; border-radius: 10px; background: #1a1420; }
        .lgu-skm-arena-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; padding-bottom: 7px; border-bottom: 1px dashed #3d2f44; }
        .lgu-skm-arena-head > b { color: #ffcf6a; font-size: 14px; }
        .lgu-skm-arena-head > span { color: #9c8fa8; font-size: 12px; }
        .lgu-skm-arena-head > span b { color: #ffcf6a; font-size: 14px; }
        /* v11.6.9: красная подсветка (.over) у жетонов Арены удалена —
           жёсткого лимита жетонов в планировщике нет. */
        .lgu-skm-slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 10px; }
        .lgu-skm-slot { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 2px solid var(--bc, #6b6478); border-radius: 9px; background: rgba(0, 0, 0, .28); }
        .lgu-skm-slot.empty { border-style: dashed; opacity: .85; }
        .lgu-skm-slot-k { color: #c9d2c3; font-size: 11.5px; }
        .lgu-skm-slot select { height: 28px; padding: 0 8px; border: 1px solid #44374a; border-radius: 6px; background: #0f0f15; color: #fff; font: 700 12px 'Nunito', system-ui, sans-serif; }
        .lgu-skm-slot-meta { display: flex; flex-direction: column; gap: 2px; min-height: 30px; }
        .lgu-skm-slot-meta > b { color: #f4f1e4; font-size: 12.5px; }
        .lgu-skm-slot-meta > em { color: #9fb3c8; font-size: 11px; font-style: normal; }
        .lgu-skm-slot-meta > small { color: #8b7f96; font-size: 11.5px; }
        .lgu-skm-ups { display: flex; flex-direction: column; gap: 6px; }
        .lgu-skm-up { border: 1px solid #3d2f44; border-radius: 8px; background: rgba(0, 0, 0, .22); }
        .lgu-skm-up > summary { padding: 7px 10px; cursor: pointer; color: #f4f1e4; font-size: 12.5px; }
        .lgu-skm-up > summary small { color: #9c8fa8; font-size: 11px; }
        .lgu-skm-up[open] > summary { border-bottom: 1px dashed #3d2f44; }
        .lgu-skm-up-rows { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; }
        .lgu-skm-up-row { display: grid; grid-template-columns: 90px 24px 24px auto 24px 52px; align-items: center; gap: 4px; font-size: 12px; }
        .lgu-skm-up-row > span { color: #9c8fa8; }
        .lgu-skm-up-row > b { color: #ffcf6a; text-align: center; font-variant-numeric: tabular-nums; }
        .lgu-skm-up-row > small { color: #8b7f96; font-size: 11px; }
        .lgu-skm-up-row > em { color: #c9d2c3; font-style: normal; text-align: right; white-space: nowrap; }
        .lgu-skm-mini { width: 22px; height: 22px; padding: 0; border-radius: 5px; border: 1px solid #44374a; background: #241c2b; color: #f4f1e4; cursor: pointer; font-size: 12px; line-height: 1; }
        .lgu-skm-mini:hover:not(:disabled) { border-color: #caa55c; color: #ffcf6a; }
        .lgu-skm-mini:disabled { opacity: .35; cursor: not-allowed; }
        .lgu-skm-loads { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .lgu-skm-loadbtn { height: 26px; padding: 0 12px; border-radius: 6px; border: 1px solid #44374a; background: #241c2b; color: #d8c9a8; cursor: pointer; font: 700 12px 'Nunito', system-ui, sans-serif; }
        .lgu-skm-loadbtn:hover { border-color: #caa55c; color: #ffcf6a; }
        .lgu-skm-loadbtn.game { border-color: #caa55c; color: #ffcf6a; }

        /* Сводка. */
        .lgu-skm-summary { padding: 12px 14px; border: 1px solid #3d2f44; border-radius: 10px; background: #1a1420; }
        .lgu-skm-sum-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; padding-bottom: 7px; border-bottom: 1px dashed #3d2f44; }
        .lgu-skm-sum-head > b { color: #ffcf6a; font-size: 14px; }
        .lgu-skm-sum-head > span { color: #9c8fa8; font-size: 11.5px; }
        .lgu-skm-stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 5px 12px; }
        .lgu-skm-stats li { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 4px 8px; border-left: 3px solid var(--bc, #5cc8ff); border-radius: 4px; background: rgba(0, 0, 0, .22); font-size: 12px; }
        .lgu-skm-stats li > span { color: #c9d2c3; }
        .lgu-skm-stats li > b { color: #7ee08a; white-space: nowrap; }
        .lgu-skm-note { margin: 6px 0 0; color: #8b7f96; font-size: 12px; }
        .lgu-skm-error { padding: 18px; color: #ffb3a0; font-size: 13px; text-align: center; }

        /* Вкладка «Экипировка». */
        .lgu-skm-gear { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
        .lgu-skm-gear-col { min-width: 0; padding: 12px; border: 1px solid #3d2f44; border-radius: 10px; background: #1a1420; overflow-x: auto; }
        .lgu-skm-gear-col h3 { margin: 0 0 8px; color: #ffcf6a; font-size: 14px; }

        /* На узких экранах карта и инспектор — в колонку. */
        @media (max-width: 900px) {
            .lgu-skm-stage { grid-template-columns: minmax(0, 1fr); }
            .lgu-skm-inspector { max-height: none; }
        }


    `;

    // ===== src/core/hooks.js =====
    // ============================================================
    // 0.1. ПЕРЕХВАТ НАРИВНЫХ КОНТЕКСТОВ ИГРЫ (Обход 429/409 ошибок)
    // G объявлен в core/constants.js (подключается первым) — здесь не дублируем.
    //
    // 11.6.4b: хук LGMine.open УДАЛЁН. Античит шахты (reference/.../mine.js)
    // сравнивает идентичность методов напрямую:
    //   M.open !== open || M.onEvent !== onEvent  ->  pi |= 4
    // Поэтому объект LGMine больше не оборачивается и не переобъявляется:
    // контекст шахты (api/art) читается безопасно из существующих глобальных
    // переменных — G.X в core/utils-api.js и core/utils-art.js.
    // ============================================================

    if (!G.__lgHookedProps) {
        G.__lgHookedProps = true;
        let rawLGCity = G.LGCity;
        let rawLGAuction = G.LGAuction;
        let rawLGQuest = G.LGQuest;
        let rawLGArena = G.LGArena;

        const hookCity = (val) => {
            rawLGCity = val;
            if (!val || val.__hooked) return;
            val.__hooked = true;

            // 11.6.4b: подмена LGCity.open тоже снята (любая подмена open на
            // игровых объектах — детект). Контекст города берём из G.X/LGCity
            // по месту вызова, см. core/utils-api.js, modules/players.js.

            // Перехват городского SSE (кто зашел в город / вышел)
            if (typeof val.onEvent === 'function' && !val.__onEventHooked) {
                val.__onEventHooked = true;
                const origOnEvent = val.onEvent;
                val.onEvent = function (d) {
                    try {
                        if (d && window.__LEGION__?.Utils?.updateOnlinePlayers) {
                            window.__LEGION__.Utils.updateOnlinePlayers(d, 'city', 'sse');
                        }
                    } catch (e) {}
                    return origOnEvent.apply(this, arguments);
                };
            }
        };
        const hookAuc = (val) => {
            rawLGAuction = val;
            if (val && !val.__hooked && typeof val.render === 'function') {
                val.__hooked = true;
                const orig = val.render;
                val.render = function (el, cx, o) {
                    // Контекст аукциона: принимаем и api(), и art()
                    const ctx = (cx && typeof cx === 'object' && (typeof cx.api === 'function' || typeof cx.art === 'function')) ? cx : null;
                    if (ctx) G.__lgAucContext = ctx;
                    return orig.apply(this, arguments);
                };
            }
        };
        // ------------------------------------------------------------
        // LGQuest (поход)
        //
        // В реальном клиенте у LGQuest НЕТ метода open() (см.
        // docs/ARCHITECTURE.md §2: init(QX), data(q), show(on), result(r),
        // hero(), _view()), поэтому старый хук по val.open не срабатывал
        // никогда и G.__lgQuestContext оставался пустым.
        // Теперь контекст берём из:
        //   1) init(QX) — штатная точка входа в экран похода;
        //   2) _view() — игра зовёт его на собственные действия игрока;
        //      используем как маркер «мы в походе» и как страховку, если
        //      аддон загрузился уже после старта похода.
        // ------------------------------------------------------------

        // QX-мост обязан быть объектом с геймплейными методами: так мы не
        // сохраним случайно DOM-узел или номер комнаты.
        const isQuestCtx = (o) => !!o && typeof o === 'object' && !o.nodeType &&
            (typeof o.data === 'function' || typeof o.act === 'function' ||
             typeof o.api === 'function' || typeof o.hero === 'function');

        // v11.6.3: фасада LG.qx() в актуальном клиенте больше нет —
        // window.LG = { restyle, rerender } (см. reference/LegionFrontSRC/site/
        // app.js). Контекст QX сохраняем только из штатного init(ctx), а
        // «мы в походе» подтверждаем живым снимком оригинального _view().
        // Ссылку на оригинал держим локально: рекурсии через G.LGQuest нет.

        const hookQuest = (val) => {
            rawLGQuest = val;
            if (!val || val.__hooked) return;

            const origView = typeof val._view === 'function' ? val._view : null;
            const questLive = () => {
                try {
                    const q = origView ? origView.call(val) : null;
                    return !!(q && q.on);
                } catch (e) {
                    return false;
                }
            };

            let patched = false;

            // 1) init(QX) — сохраняем контекст похода.
            if (typeof val.init === 'function') {
                const origInit = val.init;
                val.init = function (ctx) {
                    // Штатный QX приходит аргументом. Если init позвали без
                    // него, но снимок _view() говорит «поход идёт» — ставим
                    // маркер, не выдумывая несуществующий фасад.
                    if (isQuestCtx(ctx)) {
                        G.__lgQuestContext = ctx;
                        G.__lgQuestOn = true;
                        dbg('LGQuest.init: контекст похода сохранён');
                    } else if (questLive()) {
                        G.__lgQuestOn = true;
                        dbg('LGQuest.init: активный поход подтверждён _view()');
                    }
                    return origInit.apply(this, arguments);
                };
                patched = true;
            }

            // 2) _view() — перехватываем вызов, чтобы точно знать, что
            //    мы внутри похода. v11.6.3: сам вызов _view() уже доказывает
            //    активный поход (игра зовёт его на каждом тике) — фасад qx()
            //    больше не нужен.
            if (typeof val._view === 'function') {
                const origViewCall = val._view;
                val._view = function () {
                    G.__lgQuestOn = true;
                    return origViewCall.apply(this, arguments);
                };
                patched = true;
            }

            // Метку ставим только если реально что-то подменили: если
            // методы ещё не созданы, следующий сеттер LGQuest (или сторож)
            // попробует повесить хук повторно.
            if (patched) val.__hooked = true;
        };

        // ------------------------------------------------------------
        // LGArena (арена 5×5)
        //
        // Точка входа нативной арены — open(el, x) (reference/…/arena.js,
        // экспорт в конце файла): x — контекст сайта с api(path, body),
        // el — контейнер экрана. Подменяем ТОЛЬКО эти два метода, ничего
        // не перезаписывая в window.fetch и не трогая LGMine.
        //
        // x.api оборачиваем лениво, из open(): контекст приходит аргументом,
        // раньше его взять неоткуда. После успешного ответа (res && res.ok)
        // зовём window.__LEGION__.Arena.onApiResponse(path, res, body):
        // модуль кэширует /api/arena и /api/arena/hero и перерисовывает
        // свои вставки. Ошибку/исключение в обработчике глушим — игровой
        // вызов обязан вернуть ровно то, что вернул оригинал.
        // ------------------------------------------------------------
        const hookArena = (val) => {
            rawLGArena = val;
            if (!val || val.__hooked) return;
            if (typeof val.open !== 'function') return;

            val.__hooked = true;
            const origOpen = val.open;
            val.open = function (el, x) {
                try {
                    G.__lgArenaContext = (x && typeof x === 'object') ? x : null;
                } catch (e) {}

                try {
                    if (x && typeof x.api === 'function' && !x.__apiHooked) {
                        x.__apiHooked = true;
                        const origApi = x.api;
                        x.api = function (path) {
                            // Аргументы пробрасываем как есть (body может быть
                            // undefined), а path запоминаем для обработчика:
                            // к моменту resolve замыкание уже не меняется.
                            const reqPath = String(path || '');
                            const reqBody = arguments.length > 1 ? arguments[1] : undefined;
                            const notify = (res) => {
                                try {
                                    if (res && res.ok) {
                                        window.__LEGION__?.Arena?.onApiResponse?.(reqPath, res, reqBody);
                                    }
                                } catch (e) {}
                                return res;
                            };
                            let out;
                            try {
                                out = origApi.apply(this, arguments);
                            } catch (e) {
                                throw e;
                            }
                            // api() игры асинхронный; синхронный результат
                            // (кэш/фолбэк) тоже поддерживаем — на всякий случай.
                            if (out && typeof out.then === 'function') return out.then(notify);
                            return notify(out);
                        };
                    }
                } catch (e) {}

                return origOpen.apply(this, arguments);
            };
        };

        if (rawLGCity) hookCity(rawLGCity);
        if (rawLGAuction) hookAuc(rawLGAuction);
        if (rawLGQuest) hookQuest(rawLGQuest);
        if (rawLGArena) hookArena(rawLGArena);

        try {
            Object.defineProperty(G, 'LGCity', {
                configurable: true,
                enumerable: true,
                get: () => rawLGCity,
                set: (v) => hookCity(v)
            });
            Object.defineProperty(G, 'LGAuction', {
                configurable: true,
                enumerable: true,
                get: () => rawLGAuction,
                set: (v) => hookAuc(v)
            });
            Object.defineProperty(G, 'LGQuest', {
                configurable: true,
                enumerable: true,
                get: () => rawLGQuest,
                set: (v) => hookQuest(v)
            });
            // LGArena: сайт присваивает window.LGArena один раз при загрузке
            // (site/arena.js), но при перезагрузке модуля присваивание может
            // повториться — сеттер повесит хук на новую версию.
            Object.defineProperty(G, 'LGArena', {
                configurable: true,
                enumerable: true,
                get: () => rawLGArena,
                set: (v) => hookArena(v)
            });
        } catch (e) {}
    }

    // ===== src/core/ui-templates.js =====
    // ============================================================
    // 2.0. HTML-ШАБЛОНЫ UI (core/ui-templates.js)
    //
    // Единственное место, где живёт разметка FAB-меню, модалок и HUD.
    // Вызывающий код (main.js, core/ui.js, modules/pocket-city.js) получает
    // готовую строку для innerHTML / UI.showModal().
    // Логика (обработчики, запросы, состояние) остаётся на месте: шаблоны —
    // чистые функции от переданных данных, побочных эффектов нет.
    //
    // Подключается между core/hooks.js и core/ui.js (см. CORE_ORDER):
    // UITemplates нужен UI.openSettings()/UI.togglePlayerHud() по вызову,
    // поэтому TDZ-порядок должен держать его строго перед ui.js.
    // ============================================================
    const UITemplates = {
        /**
         * Разметка FAB-обёртки: сворачиваемое меню из трёх секций + круглая
         * кнопка. Возвращается именно innerHTML для div.legion-fab-wrap.
         *
         * @param {string} version версия аддона для футера (GM_info.script.version)
         * @param {object} ids     DOM_IDS (id/классы с рандомным префиксом RAND_ID)
         */
        fabMenu(version, ids) {
            // Фолбэк версии — текущая версия сборки (релиз 11.6.0 будет
            // после завершения всех этапов рефакторинга).
            const v = version || '11.7.0';
            const d = ids || DOM_IDS;
            return `
            <div class="${d.fabMenu}" id="${d.fabMenu}" style="max-height: calc(100vh - 100px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: #caa55c transparent;">
                <!-- БЛОК: Инструменты (сворачиваемый) -->
                <div class="fab-section" data-section="tools">
                    <div class="fab-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#888; text-transform:uppercase; padding:4px 8px; user-select:none;">
                        <span>🛠 Инструменты</span>
                        <span class="fab-arrow" style="font-size:16px; color:#caa55c; font-weight:bold; line-height:1;">▼</span>
                    </div>
                    <div class="fab-section-body">
                        <button class="fab-menu-item" id="${d.btnAutoMine}">⛏️ Умная Шахта (Выкл)</button>
                        <button class="fab-menu-item" id="${d.btnBuildSim}">⚙️ Планировщик Героя</button>
                        <button class="fab-menu-item" id="${d.btnAuctionScan}">🔍 Сканер Аукциона</button>
                        <button class="fab-menu-item" id="${d.btnPocketCity}">🏰 Карманный Город</button>
                    </div>
                </div>

                <!-- БЛОК: Социальное (сворачиваемый) -->
                <div class="fab-section" data-section="social">
                    <div class="fab-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#888; text-transform:uppercase; padding:4px 8px; user-select:none;">
                        <span>👥 Социальное</span>
                        <span class="fab-arrow" style="font-size:16px; color:#caa55c; font-weight:bold; line-height:1;">▼</span>
                    </div>
                    <div class="fab-section-body">
                        <button class="fab-menu-item" id="${d.btnPlayers}">👥 Игроки (Разведка)</button>
                        <button class="fab-menu-item" id="${d.btnParty}">🎉 Пати</button>
                    </div>
                </div>

                <!-- БЛОК: Прочее (сворачиваемый) -->
                <div class="fab-section" data-section="settings">
                    <div class="fab-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#888; text-transform:uppercase; padding:4px 8px; user-select:none;">
                        <span>⚙️ Прочее</span>
                        <span class="fab-arrow" style="font-size:16px; color:#caa55c; font-weight:bold; line-height:1;">▼</span>
                    </div>
                    <div class="fab-section-body">
                        <button class="fab-menu-item" id="${d.btnProfile}">👤 Профиль</button>
                        <button class="fab-menu-item" id="btn-fab-settings">⚙️ Настройки</button>
                    </div>
                </div>

                <!-- ФУТЕР -->
                <div style="text-align:center; font-size:10px; color:#888; margin-top:8px; padding-top:8px; border-top:1px solid #333; user-select:none;">
                    Version: ${v}
                </div>
            </div>
            <div class="${d.fabBtn}" id="${d.fabBtn}" title="Меню Legion">
                <span id="${d.fabIcon}">🐱</span>
            </div>
        `;
        },

        /**
         * Модалка служебных настроек аддона (открывается из FAB-меню).
         * Обработчики кнопок навешивает UI.openSettings().
         *
         * 11.7.0: настройки чата (7TV, перехват ленты, подсветка ников)
         * удалены вместе с подсистемой чата — параметров у шаблона больше нет.
         */
        settingsModal() {
            return `
                <h2>⚙️ Настройки аддона <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="display:flex; flex-direction:column; gap:15px; padding:10px;">
                    <!-- v11.6.1g: тумблер уведомлений о новых версиях.
                         Состояние ставит и сохраняет UI.openSettings() (localStorage
                         'LEGION_UPDATE_NOTIFY'); проверка версии при выключенном
                         тумблере работает молча. -->
                    <label style="display:flex; justify-content:space-between; align-items:center; background:#1e1724; padding:10px; border-radius:6px; cursor:pointer; margin-top: 8px;">
                        <span>🔔 Уведомлять о новых версиях</span>
                        <input type="checkbox" class="lg-toggle" id="modal-chk-update-notify">
                    </label>
                    <!-- 11.6.2b: боевой ассистент в походах (подсказки по механикам
                         боссов). Состояние ставит и сохраняет UI.openSettings()
                         (localStorage 'LEGION_COMBAT_ASSIST'), читает каждую секунду
                         modules/combat-assistant.js. -->
                    <label style="display:flex; justify-content:space-between; align-items:center; background:#1e1724; padding:10px; border-radius:6px; cursor:pointer; margin-top: 8px;">
                        <span>⚔️ Боевой ассистент в походах</span>
                        <input type="checkbox" class="lg-toggle" id="modal-chk-combat-assist">
                    </label>
                    <!-- 11.7.0: автоскип боёв с монстрами (.cm-dlg). Состояние
                         ставит и сохраняет UI.openSettings() (Settings,
                         ключ 'LEGION_AUTO_SKIP_MONSTERS'); наблюдатель живёт
                         в modules/pocket-city.js и включается сразу. -->
                    <label style="display:flex; justify-content:space-between; align-items:center; background:#1e1724; padding:10px; border-radius:6px; cursor:pointer; margin-top: 8px;">
                        <span>⏭️ Автоскип боёв с монстрами</span>
                        <input type="checkbox" class="lg-toggle" id="modal-chk-auto-skip-monsters">
                    </label>
                    <div style="font-size:10px; color:#888; line-height:1.3; margin:-2px 2px 0;">Автоматически нажимает «Пропустить» / «Пропустить всё» в окне боя с обычными и элитными монстрами</div>
                    <!-- 11.7.0: уведомления о сборах гильдии на элитных монстров -->
                    <label style="display:flex; justify-content:space-between; align-items:center; background:#1e1724; padding:10px; border-radius:6px; cursor:pointer; margin-top: 8px;">
                        <span>📯 Уведомления о сборах на элитных монстров</span>
                        <input type="checkbox" class="lg-toggle" id="modal-chk-citymon-gather">
                    </label>
                    <div style="font-size:10px; color:#888; line-height:1.3; margin:-2px 2px 0;">Плавающее уведомление о чужих сборах гильдии с кнопкой «Присоединиться»</div>
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#1e1724; padding:8px 10px; border-radius:6px; margin-top: 6px;">
                        <span style="font-size:12px; color:#ddd;">Размер плашки сбора</span>
                        <div class="lg-cm-size-picker" style="display:flex; gap:4px;">
                            <button type="button" class="lg-cm-size-btn" data-size="S" style="background:#2a2035; border:1px solid #4a3b55; color:#bbb; border-radius:4px; padding:3px 10px; font-size:11px; font-weight:bold; cursor:pointer;">S</button>
                            <button type="button" class="lg-cm-size-btn" data-size="M" style="background:#2a2035; border:1px solid #4a3b55; color:#bbb; border-radius:4px; padding:3px 10px; font-size:11px; font-weight:bold; cursor:pointer;">M</button>
                            <button type="button" class="lg-cm-size-btn" data-size="L" style="background:#2a2035; border:1px solid #4a3b55; color:#bbb; border-radius:4px; padding:3px 10px; font-size:11px; font-weight:bold; cursor:pointer;">L</button>
                        </div>
                    </div>
                    <!-- ПАТЧ 11.6.5h: куда девать вход в меню — в нативный бар
                         города или оставить плавающую FAB. Состояние ставит
                         и сохраняет UI.openSettings() (localStorage
                         'LEGION_NATIVE_FAB'), читает UI.syncNavButton(). -->
                    <label style="display:flex; justify-content:space-between; align-items:center; background:#1e1724; padding:10px; border-radius:6px; cursor:pointer; margin-top: 8px;">
                        <span>📌 Кнопка аддона в нижнем меню игры</span>
                        <input type="checkbox" id="modal-chk-native-fab" class="lg-toggle">
                    </label>
                    <div style="font-size:10px; color:#888; line-height:1.3; margin:-2px 2px 0;">Если выключено, кнопка аддона останется плавающей в правом нижнем углу.</div>
                </div>
            `;
        },

        /**
         * Карточка профиля игрока (HUD «👤 Профиль»).
         * id элементов (#player-hud-hp / -money / -loc / -xp-text / -xp-bar /
         * -close-btn) читают интервал обновления и обработчик закрытия в core/ui.js.
         *
         * @param {string} name      ник игрока (экранируется)
         * @param {string} className название класса (экранируется)
         * @param {number} level     уровень
         * @param {object|string} hp { now, max } либо готовое здоровье
         * @param {number} money     монеты (форматируется Utils.formatMoney)
         * @param {object|string} loc { text, color } либо готовый текст локации
         * @param {number} xp        опыт, набранный в текущем уровне (xpInLevel)
         * @param {number} xpNext    сколько опыта нужно до следующего уровня (xpToNext)
         * @param {object} extra     дополнительные блоки HUD (v11.5.6):
         *   settings { showLoc, showXp, showStats, showBuffs } — что показывать;
         *   stats    { atk, mag, def, crit }                 — базовые статы;
         *   buffs    [{ icon, title, time, until }]          — еда / свиток;
         *   status   { text, color } | null                  — мёртв / занят.
         */
        playerHud(name, className, level, hp, money, loc, xp = 0, xpNext = 1, extra = {}) {
            const safeName = Utils.escapeHtml(name || 'Игрок');
            const safeClass = Utils.escapeHtml(className || '—');

            // Настройки отображения: без extra (старые вызовы) показываем всё.
            const s = extra.settings || {};
            const showLoc = s.showLoc !== false;
            const showXp = s.showXp !== false;
            const showStats = s.showStats !== false;
            const showBuffs = s.showBuffs !== false;

            // hp приходит либо парой { now, max }, либо готовой строкой/числом.
            const hpNow = (hp && typeof hp === 'object') ? (hp.now ?? '—') : (hp ?? '—');
            const hpMax = (hp && typeof hp === 'object') ? hp.max : null;
            const hpStr = (hpMax !== null && hpMax !== undefined) ? `${hpNow} / ${hpMax}` : hpNow;

            const locText = (loc && typeof loc === 'object') ? (loc.text || '🏙️ Город') : (loc || '🏙️ Город');
            const locColor = (loc && typeof loc === 'object' && loc.color) ? loc.color : '#8fd3ff';
            const moneyVal = Utils.formatMoney(money);

            // Прогресс уровня в процентах: xp / xpNext.
            // Math.max(1, …) защищает от деления на ноль (xpToNext бывает 0/undefined),
            // 100 — потолок полосы (на максимуме уровня опыт может «перелиться»).
            const xpPct = Math.min(100, Math.round((xp / Math.max(1, xpNext)) * 100));

            // Статус героя (мёртв / в бою / призрак) — бейдж в шапке карточки.
            // Цвет приходит из UI; всё, что не похоже на hex, отбрасываем,
            // чтобы в style не попала произвольная строка.
            const status = extra.status || null;
            const statusColor = (status && /^#[0-9a-fA-F]{3,8}$/.test(status.color || '')) ? status.color : '#ff5a7a';
            const statusHtml = (status && status.text)
                ? `<span id="player-hud-status" style="font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(255,90,122,0.12); border:1px solid ${statusColor}; color:${statusColor}; white-space:nowrap;">${Utils.escapeHtml(status.text)}</span>`
                : '';

            // Базовые статы. Number(...) — безопасный способ вставить числа
            // в innerHTML: строка с разметкой превратится в NaN, а затем в 0.
            let statsHtml = '';
            if (showStats && extra.stats) {
                const st = extra.stats;
                const atk = Number(st.atk) || 0;
                const mag = Number(st.mag) || 0;
                const def = Number(st.def) || 0;
                const crit = Number(st.crit) || 0;
                const cells = [];
                if (atk) cells.push(`<div style="color:#ffcf6a;">⚔️ Атака: ${atk}</div>`);
                if (mag) cells.push(`<div style="color:#b06bff;">✨ Магия: ${mag}</div>`);
                if (def) cells.push(`<div style="color:#4aa3ff;">🛡️ Броня: ${def}</div>`);
                if (crit) cells.push(`<div style="color:#ff5a7a;">💥 Крит: ${crit}%</div>`);
                if (cells.length) {
                    statsHtml = `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:11px; background:#16121a; padding:6px; border-radius:4px; margin-top:4px;">${cells.join('')}</div>`;
                }
            }

            // Активные эффекты (🍗 сытость / 📜 свиток). data-until и data-icon
            // читает интервал в core/ui.js: он тикает таймер каждую секунду,
            // не перерисовывая карточку целиком (иначе сбивался бы drag).
            let buffsHtml = '';
            if (showBuffs && Array.isArray(extra.buffs) && extra.buffs.length) {
                const chips = extra.buffs.map(b => {
                    const icon = Utils.escapeHtml(b.icon || '✨');
                    const title = Utils.escapeHtml(b.title || '');
                    const time = Utils.escapeHtml(b.time || '');
                    const until = Number(b.until) || 0;
                    return `<span data-until="${until}" data-icon="${icon}" style="background:rgba(202,165,92,0.2); border:1px solid #caa55c; color:#ffcf6a; font-size:10px; padding:2px 6px; border-radius:4px;" title="${title}">${icon} ${time}</span>`;
                });
                buffsHtml = `<div id="player-hud-buffs" style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">${chips.join('')}</div>`;
            }

            // Локация и полоса опыта прячутся настройками (v11.5.6).
            // id #player-hud-loc / -xp-* по-прежнему читает интервал обновления.
            const locHtml = showLoc
                ? `<div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                        <span style="color:#aaa;">📍 Локация:</span>
                        <span id="player-hud-loc" style="color:${Utils.escapeHtml(locColor)}; font-weight:bold;">${Utils.escapeHtml(locText)}</span>
                    </div>`
                : '';

            const xpHtml = showXp
                ? `<!-- Полоса опыта -->
                    <div style="margin-top: 4px;">
                        <div style="display:flex; justify-content:space-between; font-size:10px; color:#aaa; margin-bottom:3px;">
                            <span>Опыт</span>
                            <span id="player-hud-xp-text">${xp} / ${xpNext}</span>
                        </div>
                        <div style="height:8px; background:#111; border-radius:4px; overflow:hidden; border:1px solid #333;">
                            <div id="player-hud-xp-bar" style="height:100%; width:${xpPct}%; background:linear-gradient(90deg, #caa55c, #ffcf6a); transition: width 0.3s;"></div>
                        </div>
                    </div>`
                : '';

            return `
                <div class="player-hud-header" id="player-hud-drag-handle">
                    <span style="font-weight:bold; color:#ffcf6a; font-size:12px; display:flex; align-items:center; gap:4px; min-width:0;">
                        <span>👤</span> <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${safeName}</span>
                    </span>
                    <span style="display:flex; align-items:center; gap:6px;">
                        ${statusHtml}
                        <button class="player-hud-close" id="player-hud-settings-btn" title="Настройки профиля" style="color:#caa55c;">⚙️</button>
                        <button class="player-hud-close" id="player-hud-close-btn" title="Закрыть">✖</button>
                    </span>
                </div>
                <div class="player-hud-body" style="padding: 10px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                        <span style="color:#aaa;">Класс:</span>
                        <span style="color:#f7d794; font-weight:bold;">${safeClass} (ур. ${level})</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                        <span style="color:#aaa;">❤️ HP:</span>
                        <span id="player-hud-hp" style="color:#ff5a7a; font-weight:bold;">${hpStr}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                        <span style="color:#aaa;">🪙 Монеты:</span>
                        <span id="player-hud-money" style="color:#ffcf6a; font-weight:bold;">${moneyVal}</span>
                    </div>
                    ${locHtml}
                    ${statsHtml}
                    ${buffsHtml}
                    ${xpHtml}
                </div>
            `;
        },

        // Заглушка HUD до ответа /api/me (показывается в момент открытия).
        playerHudLoading() {
            return `
                    <div class="player-hud-header" id="player-hud-drag-handle">
                        <span style="font-weight:bold; color:#ffcf6a; font-size:12px;">👤 Профиль</span>
                        <button class="player-hud-close" id="player-hud-close-btn" title="Закрыть">✖</button>
                    </div>
                    <div class="player-hud-body" style="text-align:center; color:#aaa; padding:15px 10px;">
                        Загрузка профиля...
                    </div>
                `;
        },

        /**
         * Модалка «🏰 Карманный Город»: сетка кнопок-зданий.
         * Обработчики (hover + клик по data-room) навешивает PocketCity.open().
         *
         * v11.6.6f: добавлена карточка «Гильдия» (data-room="guild"). Это не
         * здание города, а окно LGGuilds, поэтому доступность считает
         * PocketCity.isGuildLocked() и передаёт её флагом — шаблон остаётся
         * «глупым» и не лезет в ME.
         *
         * @param {boolean} guildLocked нет доступа к гильдиям: карточка серая,
         *                              клик по ней PocketCity превращает в тост
         */
        pocketCityModal(guildLocked = false) {
            // Стиль кнопки один и тот же; серое состояние — отдельным хвостом,
            // чтобы не дублировать всю строку inline-стилей.
            const guildStyle = 'padding:16px 10px; background:#2a2140; border:2px solid #6c4fa8; border-radius:10px; color:#cbb6ff; font-weight:bold; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s; '
                + (guildLocked ? 'cursor:not-allowed; opacity:0.45; filter:grayscale(1);' : 'cursor:pointer;');
            return `
                <h2>🏰 Карманный Город <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="font-size:13px; color:#aaa; margin-bottom:15px; text-align:center;">
                    Прямой доступ к официальным зданиям игры из любой локации:
                </div>
                <!-- minmax(120px): 8 карточек (7 зданий + гильдия) укладываются в один ряд при ширине окна 1200px -->
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:12px; margin-bottom:10px;">
                    <button class="pocket-grid-btn" data-room="auction" style="padding:16px 10px; background:#1b2838; border:2px solid #335577; border-radius:10px; color:#8fd3ff; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">🏛️</span>
                        <span>Аукцион</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Рынок</small>
                    </button>
                    <button class="pocket-grid-btn" data-room="shop" style="padding:16px 10px; background:#1b3824; border:2px solid #2d663e; border-radius:10px; color:#78e08f; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">🏪</span>
                        <span>Лавка</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Магазин NPC</small>
                    </button>
                    <button class="pocket-grid-btn" data-room="anvil" style="padding:16px 10px; background:#381e3a; border:2px solid #663366; border-radius:10px; color:#f3a683; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">🔨</span>
                        <span>Заточка</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Наковальня / Ремонт</small>
                    </button>
                    <button class="pocket-grid-btn" data-room="trainer" style="padding:16px 10px; background:#3a351e; border:2px solid #665b2d; border-radius:10px; color:#f7d794; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">🎓</span>
                        <span>Тренер</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Дерево навыков</small>
                    </button>
                    <button class="pocket-grid-btn" data-room="storage" style="padding:16px 10px; background:#292929; border:2px solid #555; border-radius:10px; color:#e0e0e0; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">📦</span>
                        <span>Склад</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Банк / Сундук</small>
                    </button>
                    <button class="pocket-grid-btn" data-room="forge" style="padding:16px 10px; background:#3a1a14; border:2px solid #663322; border-radius:10px; color:#ff9977; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">⚔️</span>
                        <span>Кузня</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Оружие и броня</small>
                    </button>
                    <button class="pocket-grid-btn" data-room="magic" style="padding:16px 10px; background:#1a1a38; border:2px solid #333366; border-radius:10px; color:#aaaaff; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">🔮</span>
                        <span>Звездочёт</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Зелья/Свитки</small>
                    </button>
                    <!-- v11.6.6f: Гильдия — не здание города (LGCity.panel('guild')
                         не существует), а отдельное окно модуля гильдий LGGuilds.
                         aria-disabled вместо disabled: клик должен доходить до
                         обработчика PocketCity, чтобы показать тост. -->
                    <button class="pocket-grid-btn" data-room="guild"${guildLocked ? ' aria-disabled="true" title="Недоступно"' : ''} style="${guildStyle}">
                        <span style="font-size:32px;">🛡️</span>
                        <span>Гильдия</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">${guildLocked ? 'Недоступно' : 'Альянс'}</small>
                    </button>
                </div>
            `;
        },

        /**
         * Модалка настроек HUD «👤 Профиль» (v11.5.6): какие блоки показывать.
         * Кнопку «Сохранить» (#hud-set-save) обрабатывает core/ui.js —
         * он же пишет выбор в localStorage (ключ LEGION_HUD_SETTINGS).
         *
         * @param {object} settings { showLoc, showXp, showStats, showBuffs }
         */
        hudSettingsModal(settings) {
            const s = settings || {};
            return `
                <h2>⚙️ Настройки Профиля <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="padding: 10px; display: flex; flex-direction: column; gap: 12px;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-loc" ${s.showLoc ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> 📍 Локация
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-xp" ${s.showXp ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> 📊 Опыт (полоса)
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-stats" ${s.showStats ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> ⚔️ Базовые статы (Атака, Магия, Броня)
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-buffs" ${s.showBuffs ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> 🍗 Активные эффекты (еда/свитки)
                    </label>
                    <button id="hud-set-save" style="margin-top:10px; background:#caa55c; color:#1d1620; border:none; border-radius:6px; padding:10px; font-weight:bold; cursor:pointer;">Сохранить</button>
                </div>
            `;
        }
    };

    // ===== src/core/ui.js =====
    // ============================================================
    // 2. UI-ФАБРИКА
    // ============================================================
    const UI = {
        _hudTimer: null,
        _toastTimer: null,
        _toastClickHandler: null,
        // ПАТЧ 11.6.5g: узлы меню аддона + режим входа в него.
        //   _navMode: 'fab' — плавающая кнопка (шахта/поход),
        //             'native' — кнопка в баре игры (город).
        _fabWrap: null,
        _fabBtn: null,
        _fabMenu: null,
        _navMode: '',
        _navObserver: null,
        _navRetryTimer: null,
        _navRetries: 0,
        // ПАТЧ 11.6.5h.1: дубль состояния тумблера «Кнопка аддона в нижнем
        // меню игры». Нужен, если localStorage недоступен/заблокирован —
        // тогда выбор живёт в памяти до перезагрузки страницы.
        _nativeFabDisabled: false,
        showToast(msg, isError = false, onClick = null) {
            let toast = document.getElementById('lg-global-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'lg-global-toast';
                toast.style.cssText = 'position:fixed;bottom:85px;right:25px;background:#2a2030;border:1px solid #caa55c;color:#ffcf6a;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:bold;z-index:10002;box-shadow:0 4px 15px rgba(0,0,0,0.7);transition:opacity 0.3s, transform 0.3s;pointer-events:none;';
                document.body.appendChild(toast);
            }
            // Сбрасываем клик-обработчик предыдущего тоста
            if (this._toastClickHandler) {
                toast.removeEventListener('click', this._toastClickHandler);
                this._toastClickHandler = null;
            }
            if (typeof onClick === 'function') {
                toast.style.pointerEvents = 'auto';
                toast.style.cursor = 'pointer';
                this._toastClickHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try { onClick(); } catch (err) { dbg('toast click error:', err); }
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateY(10px)';
                };
                toast.addEventListener('click', this._toastClickHandler);
            } else {
                toast.style.pointerEvents = 'none';
                toast.style.cursor = 'default';
            }
            toast.textContent = msg;
            toast.style.borderColor = isError ? '#ff5a7a' : '#caa55c';
            toast.style.color = isError ? '#ff5a7a' : '#ffcf6a';
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => {
                if (toast) {
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateY(10px)';
                }
            }, 2500);
        },
        closeModals() {
            // Снимаем удержание вкладки «Город»: MutationObserver в
            // PocketCity.openNativeBuilding больше не должен возвращать её на экран.
            window.__POCKET_CITY_OPEN__ = false;
            if (typeof Players !== 'undefined') Players.currentDMPeer = null;
            // Удаляем только наши модалки (по префиксному классу), не трогая чужие.
            document.querySelectorAll('.' + DOM_IDS.customModal).forEach(el => el.remove());
            document.querySelectorAll('.sim-card').forEach(el => el.remove());
        },
        makeDraggable(element, handleSelector = 'h2', storageKey = 'LEGION_MODAL_POS') {
            if (!element) return;
            const handle = typeof handleSelector === 'string' ? element.querySelector(handleSelector) : handleSelector;
            if (!handle) return;

            // Компактные окна (modal-compact) всегда открываются по центру:
            // унаследованная из localStorage позиция от развёрнутых модалок
            // могла оказаться за границами экрана. Сбрасываем её и не
            // запоминаем координаты компактных окон.
            const isCompact = !!(element.classList && element.classList.contains('modal-compact'));
            if (isCompact) {
                if (storageKey) {
                    try { localStorage.removeItem(storageKey); } catch (err) {}
                }
                element.style.left = '50%';
                element.style.top = '50%';
                element.style.transform = 'translate(-50%, -50%)';
                element.style.right = 'auto';
                element.style.bottom = 'auto';
            }

            handle.style.cursor = 'grab';
            handle.style.userSelect = 'none';

            let dragging = false;
            let offX = 0;
            let offY = 0;

            const onPointerMove = (e) => {
                if (!dragging) return;
                let newLeft = e.clientX - offX;
                let newTop = e.clientY - offY;

                const maxLeft = Math.max(10, (window.innerWidth || 1000) - 60);
                const maxTop = Math.max(10, (window.innerHeight || 800) - 40);
                newLeft = Math.min(Math.max(newLeft, 0), maxLeft);
                newTop = Math.min(Math.max(newTop, 0), maxTop);

                element.style.left = `${newLeft}px`;
                element.style.top = `${newTop}px`;
            };

            const onPointerUp = (e) => {
                if (!dragging) return;
                dragging = false;
                handle.style.cursor = 'grab';
                try {
                    if (handle.releasePointerCapture && e.pointerId !== undefined) {
                        handle.releasePointerCapture(e.pointerId);
                    }
                } catch (err) {}
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);

                // Позицию компактных окон не сохраняем (см. isCompact выше).
                if (storageKey && !isCompact) {
                    try {
                        localStorage.setItem(storageKey, JSON.stringify({
                            left: element.style.left,
                            top: element.style.top
                        }));
                    } catch (err) {}
                }
            };

            handle.addEventListener('pointerdown', (e) => {
                const target = e.target;
                if (!target || !target.closest) return;
                if (target.closest('button, .custom-close, input, textarea, select, a, [data-no-drag]')) {
                    return;
                }
                if (e.button !== undefined && e.button !== 0) return;

                dragging = true;
                handle.style.cursor = 'grabbing';
                try {
                    if (handle.setPointerCapture && e.pointerId !== undefined) {
                        handle.setPointerCapture(e.pointerId);
                    }
                } catch (err) {}

                const r = element.getBoundingClientRect();
                element.style.transform = 'none';
                element.style.left = `${r.left}px`;
                element.style.top = `${r.top}px`;
                element.style.right = 'auto';
                element.style.bottom = 'auto';

                offX = e.clientX - r.left;
                offY = e.clientY - r.top;

                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('pointercancel', onPointerUp);
                e.preventDefault();
            });
        },
        showModal(html, options = {}) {
            this.closeModals();
            if (typeof options === 'boolean') options = { compact: options };
            if (typeof options === 'string') options = { customClass: options };

            const modal = document.createElement('div');
            let classNames = `${DOM_IDS.customModal} custom-modal`;
            if (options.compact) classNames += ' modal-compact';
            if (options.customClass) classNames += ` ${options.customClass}`;
            modal.className = classNames;
            modal.innerHTML = html;

            // Восстановление позиции из localStorage под ключом LEGION_MODAL_POS.
            // Для компактных окон позицию не читаем: её всё равно перезапишет
            // makeDraggable() (центрирование), а остаток от развёрнутой модалки
            // мог оказаться за границами экрана.
            if (!options.compact) {
                try {
                    const pos = JSON.parse(localStorage.getItem('LEGION_MODAL_POS') || 'null');
                    if (pos && pos.left && pos.top) {
                        const leftVal = parseInt(pos.left, 10);
                        const topVal = parseInt(pos.top, 10);
                        const maxLeft = Math.max(10, (window.innerWidth || 1000) - 200);
                        const maxTop = Math.max(10, (window.innerHeight || 800) - 60);

                        if (!isNaN(leftVal) && !isNaN(topVal) && leftVal >= 0 && leftVal <= maxLeft && topVal >= 0 && topVal <= maxTop) {
                            modal.style.left = pos.left;
                            modal.style.top = pos.top;
                            modal.style.transform = 'none';
                            modal.style.right = 'auto';
                            modal.style.bottom = 'auto';
                        }
                    }
                } catch (e) {}
            }

            document.body.appendChild(modal);
            const closeBtn = modal.querySelector('#custom-close-btn') || document.getElementById('custom-close-btn');
            if (closeBtn) closeBtn.addEventListener('click', () => this.closeModals());

            // Автоматическое перетаскивание окна за h2
            this.makeDraggable(modal, 'h2');

            return modal;
        },
        // ⚙️ Служебные настройки аддона: уведомления о версиях, боевой
        // ассистент и место входа в меню. Настройки чата (7TV, перехват
        // ленты, подсветка ников) удалены в 11.7.0 вместе с подсистемой чата.
        openSettings() {
            // Разметка модалки — в core/ui-templates.js (UITemplates.settingsModal).
            const modal = this.showModal(UITemplates.settingsModal(), { compact: true });

            if (!modal) return;

            // 11.6.1g: тумблер уведомлений о новых версиях.
            // Дефолт — включено (ключа в localStorage ещё нет). Значение читает
            // checkAddonUpdate() из main.js перед GM_notification.
            const notifyOn = localStorage.getItem('LEGION_UPDATE_NOTIFY') !== 'false';
            const notifyChk = modal.querySelector('#modal-chk-update-notify');
            if (notifyChk) notifyChk.checked = notifyOn;
            notifyChk?.addEventListener('change', (e) => {
                localStorage.setItem('LEGION_UPDATE_NOTIFY', String(e.target.checked));
            });

            // 11.6.2b: боевой ассистент в походах. Дефолт — включено (ключа ещё нет);
            // значение читает CombatAssistant._tick() при каждом тике.
            const combatChk = modal.querySelector('#modal-chk-combat-assist');
            if (combatChk) {
                combatChk.checked = localStorage.getItem('LEGION_COMBAT_ASSIST') !== 'false';
                combatChk.addEventListener('change', (e) => {
                    localStorage.setItem('LEGION_COMBAT_ASSIST', String(e.target.checked));
                });
            }

            // 11.7.0: автоскип боёв с обычными и элитными монстрами (.cm-dlg).
            // По умолчанию выключен. Наблюдатель из modules/pocket-city.js
            // поднимается и снимается сразу — без перезагрузки страницы.
            const monsterSkipChk = modal.querySelector('#modal-chk-auto-skip-monsters');
            if (monsterSkipChk) {
                monsterSkipChk.checked = Settings.get('autoSkipMonsters');
                monsterSkipChk.addEventListener('change', (e) => {
                    const isEnabled = !!e.target.checked;
                    // Сначала применяем к наблюдателю (работает даже если
                    // localStorage заблокирован), затем сохраняем выбор.
                    try {
                        if (isEnabled) PocketCity.startMonsterAutoSkip();
                        else PocketCity.stopMonsterAutoSkip();
                    } catch (err) {
                        dbg('[UI] автоскип монстров: сбой переключения', err);
                    }
                    Settings.set('autoSkipMonsters', isEnabled);
                });
            }

            // 11.7.0: уведомления о сборах гильдии на элитных монстров
            const citymonGatherChk = modal.querySelector('#modal-chk-citymon-gather');
            if (citymonGatherChk) {
                citymonGatherChk.checked = Settings.get('citymonGatherEnabled');
                citymonGatherChk.addEventListener('change', (e) => {
                    const isEnabled = !!e.target.checked;
                    Settings.set('citymonGatherEnabled', isEnabled);
                    try {
                        if (typeof PocketCity !== 'undefined') {
                            if (isEnabled) {
                                PocketCity.startCityMonWatch();
                                PocketCity.pollCityMonLobbies(true);
                            } else {
                                PocketCity.hideCityMonGather();
                            }
                        }
                    } catch (err) {
                        dbg('[UI] сборы гильдии: сбой переключения', err);
                    }
                });
            }

            // 11.7.0: размер плашки сбора (S / M / L)
            const currentGatherSize = Settings.get('citymonGatherSize') || 'L';
            const gatherSizeBtns = modal.querySelectorAll('.lg-cm-size-btn');
            const updateActiveGatherSizeBtn = (val) => {
                gatherSizeBtns.forEach(btn => {
                    const active = (btn.dataset.size || '').toUpperCase() === (val || '').toUpperCase();
                    btn.style.background = active ? '#ffcf6a' : '#2a2035';
                    btn.style.color = active ? '#16121a' : '#bbb';
                    btn.style.borderColor = active ? '#ffcf6a' : '#4a3b55';
                });
            };
            updateActiveGatherSizeBtn(currentGatherSize);
            gatherSizeBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const newSize = (btn.dataset.size || 'L').toUpperCase();
                    Settings.set('citymonGatherSize', newSize);
                    updateActiveGatherSizeBtn(newSize);
                    try {
                        if (typeof PocketCity !== 'undefined' && typeof PocketCity.applyGatherSize === 'function') {
                            PocketCity.applyGatherSize(newSize);
                        }
                    } catch (err) {
                        dbg('[UI] сборы гильдии: сбой смены размера', err);
                    }
                });
            });

            // ПАТЧ 11.6.5h / h.1: тумблер «📌 Кнопка аддона в нижнем меню игры».
            // Порядок операций важен: сначала применяем выключение к DOM, потом
            // пишем в хранилище, и только затем пересчитываем режим. Так выбор
            // сработает, даже если localStorage недоступен (setItem бросит
            // исключение) или syncNavButton() упадёт на полпути.
            const nativeChk = modal.querySelector('#modal-chk-native-fab');
            if (nativeChk) {
                nativeChk.checked = UI._nativeFabEnabled();
                nativeChk.addEventListener('change', (e) => {
                    const isEnabled = e.target.checked;

                    // 1. Принудительно применяем выключение к DOM — сразу, не
                    //    дожидаясь syncNavButton().
                    UI._nativeFabDisabled = !isEnabled;
                    if (!isEnabled) {
                        document.querySelectorAll('.lgu-nav-btn').forEach(el => el.remove());
                        if (UI._fabBtn) UI._fabBtn.style.display = 'flex';
                        UI._navMode = 'fab';
                    }

                    // 2. Сохраняем выбор (страховка на случай закрытого
                    //    хранилища: дубль остаётся в UI._nativeFabDisabled).
                    try {
                        localStorage.setItem('LEGION_NATIVE_FAB', String(isEnabled));
                    } catch (err) {
                        dbg('[UI] LEGION_NATIVE_FAB: не удалось записать в localStorage', err);
                    }

                    // 3. Пересчитываем режим: при включении сюда же приходит
                    //    возврат кнопки в бар игры.
                    UI.syncNavButton();
                });
            }
        },
        // 🏰 Карманный город вынесен в modules/pocket-city.js (v11.6.0, этап 3):
        //    UI.openPocketCity()     -> PocketCity.open()
        //    UI.openNativeBuilding() -> PocketCity.openNativeBuilding()
        // ------------------------------------------------------------
        // ПАТЧ 11.6.5g: единая точка входа в меню аддона.
        //
        // Меню открывают двое: круглая FAB (шахта/поход) и нативная
        // кнопка «Аддон» в баре города (#gu-hud .gu-main). Логика «в какую
        // сторону раскрывать» живёт здесь, чтобы оба входа вели себя одинаково.
        // ------------------------------------------------------------
        toggleFabMenu() {
            const menu = this._fabMenu
                || document.getElementById(DOM_IDS.fabMenu)
                || document.getElementById('legion-fab-menu');
            if (!menu) return false;

            if (menu.classList.contains('open')) {
                this.closeFabMenu();
                return false;
            }

            const viewportH = window.innerHeight || 800;
            // У скрытого (display:none) меню scrollHeight равен 0, поэтому
            // «|| 400» и зажим по высоте окна — как в старом обработчике FAB.
            const menuHeight = Math.min(menu.scrollHeight || 400, viewportH - 120);

            // ПАТЧ 11.6.6e: снимаем inline-координаты, выставленные в прошлый
            // раз для нативной кнопки, иначе меню «прилипнет» к краю экрана
            // и в шахте, где снова работает плавающая FAB.
            this._resetMenuPosition(menu);

            // ПАТЧ 11.6.6e: в городе вход — кнопка «Аддон» в нижнем баре.
            // Раньше якорем всегда считалась плавающая FAB, но в городе она
            // скрыта (display:none), и меню (position:absolute от
            // .legion-fab-wrap) уезжало в правый нижний угол экрана.
            const nativeBtn = this._getNativeNavButton();
            if ((this._navMode === 'native' || nativeBtn) && this._positionMenuAboveButton(menu, nativeBtn)) {
                menu.classList.remove('open-down');
                menu.classList.add('open');
                return true;
            }

            // Якорь — сама FAB, а когда она скрыта (город) — её обёртка:
            // wrap сохраняет позицию, выбранную перетаскиванием.
            let anchorTop = null;
            const btnRect = this._fabBtn ? this._fabBtn.getBoundingClientRect() : null;
            if (btnRect && btnRect.height > 0) anchorTop = btnRect.top;
            if (anchorTop === null && this._fabWrap) anchorTop = this._fabWrap.getBoundingClientRect().top;
            if (anchorTop === null) anchorTop = viewportH;

            menu.classList.toggle('open-down', anchorTop < menuHeight + 20);
            menu.classList.add('open');
            return true;
        },

        // ПАТЧ 11.6.6e: нативная кнопка «Аддон» в баре города (создаётся в
        // syncNavButton). Берём только реально отрисованную: бар скрывается
        // при открытом окне героя/чате на мобиле — тогда единственный вход
        // в меню остаётся плавающая FAB, и якорем должна быть она.
        _getNativeNavButton() {
            const btn = document.querySelector('.lgu-nav-btn');
            if (!btn || btn.getClientRects().length === 0) return null;
            return btn;
        },

        // ПАТЧ 11.6.6e: меню — ребёнок .legion-fab-wrap (position:fixed в
        // правом нижнем углу), поэтому position:absolute + right/bottom
        // привязывали его к углу экрана, а не к кнопке. Прибиваем меню к
        // нативной кнопке через position:fixed с координатами окна.
        _positionMenuAboveButton(menu, btn) {
            if (!menu || !btn) return false;
            const rect = btn.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) return false;

            const viewportW = window.innerWidth || 1000;
            const viewportH = window.innerHeight || 800;
            // У скрытого (display:none) меню offsetWidth/scrollHeight равны 0 —
            // берём значения из CSS: min-width 220px, запас по высоте «|| 400».
            const menuWidth = menu.offsetWidth || 220;
            const menuHeight = Math.min(menu.scrollHeight || 400, viewportH - 120);

            // По горизонтали центрируем меню над кнопкой и зажимаем в окно,
            // чтобы у правого края оно не обрезалось.
            let left = rect.left + rect.width / 2 - menuWidth / 2;
            left = Math.max(8, Math.min(left, viewportW - menuWidth - 8));

            menu.style.position = 'fixed';
            menu.style.right = 'auto';
            menu.style.left = left + 'px';

            if (rect.top >= menuHeight + 20) {
                // Место есть — раскрываем над кнопкой:
                // bottom = высота окна − верх кнопки + отступ 10px.
                menu.style.top = 'auto';
                menu.style.bottom = (viewportH - rect.top + 10) + 'px';
            } else {
                // Места сверху мало (мобильный ландшафт) — раскрываем вниз,
                // но не выпускаем меню за нижнюю границу окна.
                menu.style.bottom = 'auto';
                menu.style.top = Math.max(8, Math.min(rect.bottom + 10, viewportH - menuHeight - 8)) + 'px';
            }
            return true;
        },

        // ПАТЧ 11.6.6e: сбрасываем inline-координаты нативной кнопки, чтобы
        // меню снова подчинялось стилям .legion-fab-menu (absolute от wrap).
        _resetMenuPosition(menu) {
            if (!menu) return;
            ['position', 'left', 'right', 'top', 'bottom'].forEach(prop => {
                menu.style.removeProperty(prop);
            });
        },

        closeFabMenu() {
            const menu = this._fabMenu
                || document.getElementById(DOM_IDS.fabMenu)
                || document.getElementById('legion-fab-menu');
            if (!menu) return;
            menu.classList.remove('open');
            menu.classList.remove('open-down');
            // ПАТЧ 11.6.6e: иначе следующее открытие из FAB унаследует
            // координаты нативной кнопки.
            this._resetMenuPosition(menu);
        },

        // Кнопка «Аддон» для нативного бара игры. Классы .gu-b/.gu-bi/.gu-bl
        // родные (site/style.css игры), поэтому размер кружка, шрифт подписи
        // и подсветку берём у нативного худа — свой CSS почти не нужен.
        createNativeNavButton() {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'gu-b lgu-nav-btn';
            btn.setAttribute('data-gu', 'lgu-menu');
            btn.title = 'Меню аддона Legion';
            btn.setAttribute('aria-label', 'Меню аддона Legion');
            btn.innerHTML = `
                <span class="gu-bi" style="box-shadow: 0 0 0 1.5px #caa55c;">
                    <span style="font-size: 26px; line-height: 1;">🐱</span>
                </span>
                <span class="gu-bl" style="color: #ffcf6a;">Аддон</span>
            `;
            // pointerdown гасим: setupFab закрывает меню «кликом снаружи»
            // именно на pointerdown, иначе повторный клик по кнопке закрывал
            // бы меню и тут же открывал его снова.
            btn.addEventListener('pointerdown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleFabMenu();
            });
            return btn;
        },

        // ПАТЧ 11.6.5h.1: включён ли вход в меню через нижний бар игры.
        // Источник правды — localStorage, но его чтение может быть недоступно
        // (приватный режим, ограничения песочницы), поэтому выбор дублируется
        // в памяти (_nativeFabDisabled): тумблер работает до перезагрузки даже
        // без хранилища, а «мусорное» значение в нём трактуется как «включено».
        _nativeFabEnabled() {
            try {
                const raw = localStorage.getItem('LEGION_NATIVE_FAB');
                if (raw === 'true') return true;
                if (raw === 'false') return false;
            } catch (e) {}
            return this._nativeFabDisabled !== true;
        },

        // ПАТЧ 11.6.6g: открыта ли Шахта.
        //
        // Шахта в игре — не вкладка, а полноэкранный оверлей `.mn` (mine.js
        // вешает на body `mn-on`), который лежит ПОВЕРХ «Города». Класс
        // html.gu-city при этом не снимается, поэтому по классам <html> мы
        // по-прежнему «в городе» — и нативная кнопка «Аддон» вместе с баром
        // уезжает под оверлей. Ловим шахту по body.mn-on; запасная проверка —
        // реально отрисованный `.mn` (на случай, если класс не сняли после
        // выхода или оверлей остался висеть в DOM).
        isInMine() {
            if (document.body && document.body.classList.contains('mn-on')) return true;
            const mine = document.querySelector('.mn');
            return !!mine && mine.getClientRects().length > 0;
        },

        // Умное переключение входа в меню:
        //   Город       — есть нативный бар: наша кнопка встаёт первой, FAB прячем;
        //   Шахта/Поход — бара нет: возвращаем плавающую FAB.
        // #gu-hud игра создаёт один раз и после выхода из города оставляет в DOM
        // (скрывая через html.gu-city), поэтому наличия бара ещё не достаточно.
        // ПАТЧ 11.6.6g: шахту (оверлей .mn поверх города, html.gu-city остаётся)
        // проверяем ОТДЕЛЬНО и раньше тумблера — см. первую ветку метода.
        syncNavButton() {
            // ПАТЧ 11.6.6g: в шахте бара игры не видно (он под оверлеем `.mn`),
            // поэтому единственный вход в аддон — плавающая FAB. Ветка стоит
            // ДО проверки тумблера: при включённом «📌 Кнопка аддона в нижнем
            // меню игры» нативная кнопка создаётся в баре города, но в шахте
            // она недоступна и должна быть убрана из DOM.
            if (this.isInMine()) {
                document.querySelectorAll('.lgu-nav-btn').forEach(el => el.remove());
                if (this._fabBtn) this._fabBtn.style.display = 'flex';
                if (this._navMode !== 'fab') {
                    // Меню нужно гасить только при переходе из города: там оно
                    // привязано координатами к нативной кнопке (position:fixed),
                    // и в шахте эти координаты уже неактуальны. На первом
                    // вызове (_navMode === '') закрывать нечего.
                    const fromNative = this._navMode === 'native';
                    this._navMode = 'fab';
                    if (fromNative) this.closeFabMenu();
                }
                this._navRetries = 0;
                return false;
            }

            // ПАТЧ 11.6.5h: тумблер «📌 Кнопка аддона в нижнем меню игры».
            // Выключен — нативную кнопку не создаём (и убираем уже созданную),
            // а FAB остаётся плавающей в правом нижнем углу даже в городе.
            // Состояние читает _nativeFabEnabled() (localStorage + дубль в
            // памяти), см. ПАТЧ 11.6.5h.1.
            if (!this._nativeFabEnabled()) {
                // 1. Удаляем нативную кнопку из бара игры, если она есть.
                document.querySelectorAll('.lgu-nav-btn').forEach(el => el.remove());
                // 2. Возвращаем плавающую FAB (её мог спрятать нативный режим).
                if (this._fabBtn) this._fabBtn.style.display = 'flex';
                this._navMode = 'fab';
                this._navRetries = 0;
                return false;
            }

            const bar = document.querySelector('#gu-hud .gu-main');
            const inCity = !!bar && document.documentElement.classList.contains('gu-city');

            if (inCity) {
                this._navRetries = 0;
                if (!bar.querySelector('.lgu-nav-btn')) {
                    bar.prepend(this.createNativeNavButton());
                }
                if (this._navMode !== 'native') {
                    this._navMode = 'native';
                    // Меню, открытое в шахте, не должно висеть в городе без FAB.
                    this.closeFabMenu();
                }
                // Бар бывает скрыт (открыто окно героя, чат на мобиле) —
                // тогда FAB оставляем, иначе в меню аддона было бы не попасть.
                const barVisible = bar.getClientRects().length > 0;
                if (this._fabBtn) this._fabBtn.style.display = barVisible ? 'none' : 'flex';
                return true;
            }

            this._navMode = 'fab';
            if (this._fabBtn) this._fabBtn.style.display = 'flex';

            // HUD игра создаёт лениво (guRender -> guHud, до ~2 с после входа
            // в город). Пока бара нет, но город уже включён — добиваем парой
            // отложенных проверок, чтобы FAB не висела поверх нативного бара.
            if (!bar && document.documentElement.classList.contains('gu-city')) {
                this._scheduleNavRetry();
            }
            return false;
        },

        // До шести повторов по 400 мс: ждём появления #gu-hud после входа
        // в город (см. syncNavButton).
        _scheduleNavRetry() {
            if (this._navRetryTimer || this._navRetries >= 6) return;
            this._navRetries += 1;
            this._navRetryTimer = setTimeout(() => {
                this._navRetryTimer = null;
                this.syncNavButton();
            }, 400);
        },

        setupFab(wrap, btn, menu) {
            // ПАТЧ 11.6.5g: ссылки нужны toggleFabMenu()/syncNavButton() —
            // меню одно, а входов в него два (FAB и кнопка в баре города).
            this._fabWrap = wrap;
            this._fabBtn = btn;
            this._fabMenu = menu;
            let dragging = false, startX = 0, startY = 0, offX = 0, offY = 0, hasMoved = false;

            btn.addEventListener('pointerdown', (e) => {
                dragging = true;
                hasMoved = false;
                startX = e.clientX;
                startY = e.clientY;
                btn.setPointerCapture(e.pointerId);

                const r = wrap.getBoundingClientRect();
                offX = e.clientX - r.left;
                offY = e.clientY - r.top;
            });

            btn.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                if (!hasMoved && Math.hypot(e.clientX - startX, e.clientY - startY) > 5) {
                    hasMoved = true;
                }
                if (hasMoved) {
                    // Ограничиваем координаты рамками окна: иначе FAB можно утащить
                    // за пределы экрана и потерять (позиция ещё и сохраняется в localStorage).
                    const fabSize = 50; // Примерный размер FAB
                    let newX = e.clientX - offX;
                    let newY = e.clientY - offY;

                    newX = Math.max(0, Math.min(newX, window.innerWidth - fabSize));
                    newY = Math.max(0, Math.min(newY, window.innerHeight - fabSize));

                    wrap.style.left = newX + 'px';
                    wrap.style.top = newY + 'px';
                    wrap.style.right = 'auto';
                    wrap.style.bottom = 'auto';
                }
            });

            btn.addEventListener('pointerup', (e) => {
                if (!dragging) return;
                dragging = false;
                btn.releasePointerCapture(e.pointerId);

                if (hasMoved) {
                    try {
                        localStorage.setItem('LEGION_FAB_POS', JSON.stringify({
                            left: wrap.style.left,
                            top: wrap.style.top
                        }));
                    } catch (err) {}
                } else {
                    // ПАТЧ 11.6.6e: единая точка входа — toggleFabMenu() сама
                    // выбирает якорь (FAB или кнопка в баре города) и
                    // раскрывает меню в свободную сторону.
                    UI.toggleFabMenu();
                }
            });

            // Закрытие меню при клике снаружи
            document.addEventListener('pointerdown', (e) => {
                if (!wrap.contains(e.target)) {
                    UI.closeFabMenu();
                }
            });

            // Закрытие меню при клике по любому пункту (кроме чекбокса)
            menu.querySelectorAll('.fab-menu-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.tagName === 'INPUT' || e.target.closest('input')) return;
                    UI.closeFabMenu();
                });
            });

            // Аккордеон: клик по заголовку секции сворачивает/разворачивает её.
            // stopPropagation не даёт событию дойти до обработчиков меню и страницы.
            menu.querySelectorAll('.fab-section-title').forEach(title => {
                title.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const section = title.parentElement;
                    if (section) section.classList.toggle('collapsed');
                });
            });
        },

        // Текущая локация героя для HUD «👤 Профиль»: { text, color }.
        //   Шахта — по разметке нативного модуля (.mn-world/.mn-screen) либо по URL;
        //   Поход — по состоянию LGQuest (q.on) через штатный геттер игры
        //   LGQuest._view() (данные с задержкой стрима q.dl).
        _detectHudLocation() {
            const inMine = !!document.querySelector('.mn-world') ||
                           !!document.querySelector('.mn-screen') ||
                           location.search.includes('sid=') ||
                           location.pathname.includes('/mine');
            if (inMine) return { text: '⛏️ Шахта', color: '#4cc95a' };

            let inQuest = false;
            try {
                if (G.LGQuest && typeof G.LGQuest._view === 'function') {
                    const q = G.LGQuest._view();
                    inQuest = !!(q && q.on);
                }
            } catch (e) {}
            if (inQuest) return { text: '🚩 Поход', color: '#ff9900' };

            return { text: '🏙️ Город', color: '#8fd3ff' };
        },

        // Опыт внутри уровня: { xp, xpNext }.
        // Игра отдаёт готовые поля xpInLevel / xpToNext (docs/API.md, GET /api/me).
        // В старых снимках их нет — считаем от абсолютных порогов, как это делает
        // сам клиент игры: набрано = xp - prevXp, нужно = next - prevXp.
        _heroXp(hero) {
            if (!hero) return { xp: 0, xpNext: 1 };
            const own = hero.xpInLevel !== undefined && hero.xpInLevel !== null;
            const prevXp = Math.max(0, Number(hero.prevXp) || 0);
            const xp = own
                ? Math.max(0, Number(hero.xpInLevel) || 0)
                : Math.max(0, (Number(hero.xp) || 0) - prevXp);
            const needRaw = own ? hero.xpToNext : hero.next;
            // Максимум уровня неизвестен (нет поля) — считаем полосу полной.
            const xpNext = (needRaw === undefined || needRaw === null)
                ? Math.max(1, xp)
                : Math.max(1, (Number(needRaw) || 0) - (own ? 0 : prevXp));
            return { xp, xpNext };
        },

        // ------------------------------------------------------------
        // HUD профиля (v11.5.6): настройки блоков, баффы и статус героя.
        // ------------------------------------------------------------

        // Какие блоки показывать в HUD. Ключ LEGION_HUD_SETTINGS общий для
        // всех персонажей. Битый/отсутствующий JSON не должен ломать HUD —
        // в этом случае возвращаем дефолты (всё включено).
        getHudSettings() {
            const defaults = { showLoc: true, showXp: true, showStats: true, showBuffs: true };
            try {
                const raw = localStorage.getItem('LEGION_HUD_SETTINGS');
                if (raw) return { ...defaults, ...JSON.parse(raw) };
            } catch (e) {}
            return defaults;
        },

        // Остаток времени баффа строкой: минуты, а в последнюю минуту — секунды,
        // иначе подпись «1м» висела бы до самого исчезновения эффекта.
        _hudTimeLeft(ms) {
            if (ms <= 60000) return `${Math.max(1, Math.ceil(ms / 1000))}с`;
            return `${Math.ceil(ms / 60000)}м`;
        },

        // Активные эффекты героя: сытость (eatUntil) и свиток (scrollUntil).
        // Оба поля — метки времени окончания действия в мс (см. клиент игры:
        // reference/LegionFrontSRC/site/city.js — h.eatUntil > Date.now()).
        _hudBuffs(hero) {
            const out = [];
            if (!hero) return out;
            const now = Date.now();
            const add = (until, icon, title) => {
                const ts = Number(until) || 0;
                if (ts > now) out.push({ icon, title, time: this._hudTimeLeft(ts - now), until: ts });
            };
            add(hero.eatUntil, '🍗', 'Сытость');
            add(hero.scrollUntil, '📜', 'Свиток');
            return out;
        },

        // Статус героя для бейджа в шапке HUD (docs/API.md, раздел «Герой»):
        //   мёртв   — hpNow <= 0 либо активен таймер deadUntil;
        //   призрак — hero.ghost (в клиенте игры призрак не переодевается);
        //   занят   — hero.busy (идёт бой на стриме).
        _hudStatus(hero) {
            if (!hero) return null;
            const now = Date.now();
            const deadUntil = Number(hero.deadUntil) || 0;
            const hpNow = Number(hero.hpNow);
            const isDead = hero.dead === true || (Number.isFinite(hpNow) && hpNow <= 0) || deadUntil > now;
            if (isDead) {
                const left = deadUntil > now ? ` ${this._hudTimeLeft(deadUntil - now)}` : '';
                return { text: `💀 Мертв${left}`, color: '#ff5a7a' };
            }
            if (hero.ghost) return { text: '👻 Призрак', color: '#8fd3ff' };
            if (hero.busy) return { text: '⚔️ Занят', color: '#ffcf6a' };
            return null;
        },

        // Подпись состояния HUD: по ней интервал в togglePlayerHud() понимает,
        // что набор баффов/статус изменился и карточку нужно перерисовать.
        _hudSignature(hero) {
            if (!hero) return '';
            const dead = (Number(hero.hpNow) <= 0) ? 1 : 0;
            return [
                hero.busy ? 1 : 0,
                hero.ghost ? 1 : 0,
                Number(hero.deadUntil) || 0,
                Number(hero.eatUntil) || 0,
                Number(hero.scrollUntil) || 0,
                dead
            ].join('|');
        },

        renderPlayerHudContent(hud, hero) {
            if (!hud) return;
            // Глобальный G (core/constants.js) — это unsafeWindow: ME/LGQuest
            // живут в контексте страницы и в песочнице напрямую не видны.
            // v11.6.0g-5: LG_CH сюда не подмешиваем — это Twitch-канал, а не
            // игрок; в HUD попадал чужой ник (баг «ника в чате»).
            const name = hero?.name || G.ME?.user?.name || G.ME?.user?.login || 'Игрок';
            const rawClass = hero?.class || hero?.c || hero?.sk?.c || 'recruit';
            const className = (typeof BuildSim !== 'undefined' && BuildSim.classNames?.[rawClass]) || rawClass;
            const lvl = hero?.lvl || hero?.level || hero?.l || 1;

            // Здоровье: hero.hpNow / (hero.stats.hp или hero.hpMax)
            const hpNow = hero?.hpNow !== undefined ? hero.hpNow : (hero?.hp !== undefined ? hero.hp : '—');
            const hpMax = hero?.stats?.hp !== undefined ? hero.stats.hp : (hero?.hpMax !== undefined ? hero.hpMax : (hero?.maxHp || hero?.mhp || '—'));

            // Монеты: hero.money
            const moneyVal = hero?.money !== undefined ? hero.money : (hero?.coins !== undefined ? hero.coins : (hero?.gold !== undefined ? hero.gold : 0));

            // Опыт и локация — общими хелперами (их же использует интервал ниже).
            const { xp, xpNext } = this._heroXp(hero);
            const loc = this._detectHudLocation();

            // Настройки HUD + расширенные данные (v11.5.6).
            const settings = this.getHudSettings();
            const buffs = this._hudBuffs(hero);
            const status = this._hudStatus(hero);

            // Статы: atk/mag/def клиент отдаёт в hero.stats, крит — в hero.xs
            // (реже в hero.stats.crit), поэтому набор нормализуем здесь.
            const hudStats = hero ? {
                atk: hero.stats ? hero.stats.atk : undefined,
                mag: hero.stats ? hero.stats.mag : undefined,
                def: hero.stats ? hero.stats.def : undefined,
                crit: (hero.stats && hero.stats.crit !== undefined) ? hero.stats.crit : (hero.xs ? hero.xs.crit : undefined)
            } : null;

            // Разметка HUD — в core/ui-templates.js (UITemplates.playerHud):
            // шаблон сам экранирует ник/класс и форматирует монеты.
            hud.innerHTML = UITemplates.playerHud(name, className, lvl, { now: hpNow, max: hpMax }, moneyVal, loc, xp, xpNext, {
                settings,
                stats: hudStats,
                buffs,
                status
            });

            // Метки для интервала в togglePlayerHud(): hudReady отличает готовую
            // карточку от заглушки «Загрузка профиля...», hudSig — набор
            // баффов/статуса (при изменении карточка перерисовывается).
            hud.dataset.hudReady = '1';
            hud.dataset.hudSig = this._hudSignature(hero);

            hud.querySelector('#player-hud-close-btn')?.addEventListener('click', () => {
                hud.style.display = 'none';
                if (UI._hudTimer) {
                    clearInterval(UI._hudTimer);
                    UI._hudTimer = null;
                }
            });

            // ⚙️ Настройки отображаемых блоков профиля (11.5.6).
            hud.querySelector('#player-hud-settings-btn')?.addEventListener('click', () => {
                const currentSettings = this.getHudSettings();
                UI.showModal(UITemplates.hudSettingsModal(currentSettings), { compact: true });
                // showModal() синхронно вставляет модалку в body — кнопка уже доступна.
                document.getElementById('hud-set-save')?.addEventListener('click', () => {
                    const newSettings = {
                        showLoc: !!document.getElementById('hud-set-loc')?.checked,
                        showXp: !!document.getElementById('hud-set-xp')?.checked,
                        showStats: !!document.getElementById('hud-set-stats')?.checked,
                        showBuffs: !!document.getElementById('hud-set-buffs')?.checked
                    };
                    try {
                        localStorage.setItem('LEGION_HUD_SETTINGS', JSON.stringify(newSettings));
                    } catch (e) {}
                    UI.closeModals();
                    // Перерисовываем карточку с новым набором блоков.
                    this.renderPlayerHudContent(hud, hero);
                });
            });
        },

        setupPlayerHudDrag(hud) {
            let dragging = false, offX = 0, offY = 0;
            hud.addEventListener('pointerdown', (e) => {
                if (e.target.closest('#player-hud-close-btn') || e.target.closest('#player-hud-settings-btn') || !e.target.closest('#player-hud-drag-handle')) return;
                dragging = true;
                hud.setPointerCapture(e.pointerId);
                const r = hud.getBoundingClientRect();
                offX = e.clientX - r.left;
                offY = e.clientY - r.top;
                hud.style.left = r.left + 'px';
                hud.style.top = r.top + 'px';
                hud.style.right = 'auto';
                hud.style.bottom = 'auto';
            });
            hud.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                hud.style.left = (e.clientX - offX) + 'px';
                hud.style.top = (e.clientY - offY) + 'px';
            });
            hud.addEventListener('pointerup', (e) => {
                if (!dragging) return;
                dragging = false;
                hud.releasePointerCapture(e.pointerId);
                try {
                    localStorage.setItem('LEGION_PROFILE_POS', JSON.stringify({
                        left: hud.style.left,
                        top: hud.style.top
                    }));
                } catch (err) {}
            });
        },

        async togglePlayerHud() {
            let hud = document.getElementById(DOM_IDS.playerHud) || document.getElementById('legion-player-hud');
            if (hud && hud.style.display !== 'none') {
                hud.style.display = 'none';
                if (this._hudTimer) {
                    clearInterval(this._hudTimer);
                    this._hudTimer = null;
                }
                return;
            }
            if (!hud) {
                hud = document.createElement('div');
                hud.id = DOM_IDS.playerHud;
                hud.className = DOM_IDS.playerHud;
                document.body.appendChild(hud);

                // Восстановление позиции из localStorage (§ Задача 3)
                try {
                    const pos = JSON.parse(localStorage.getItem('LEGION_PROFILE_POS'));
                    if (pos && pos.left && pos.top) {
                        hud.style.left = pos.left;
                        hud.style.top = pos.top;
                        hud.style.right = 'auto';
                        hud.style.bottom = 'auto';
                    }
                } catch (e) {}

                this.setupPlayerHudDrag(hud);
            }

            hud.style.display = 'flex';

            let hero = G.ME?.hero || G.ME?.me || window.__lgHero;
            if (hero) {
                this.renderPlayerHudContent(hud, hero);
            } else {
                // Заглушка до ответа /api/me — тоже из шаблонов.
                hud.innerHTML = UITemplates.playerHudLoading();
                // Метки готовой карточки снимаем: интервал дорисует HUD,
                // когда герой появится (проверка hudReady ниже).
                delete hud.dataset.hudReady;
                delete hud.dataset.hudSig;
                hud.querySelector('#player-hud-close-btn')?.addEventListener('click', () => {
                    hud.style.display = 'none';
                    if (UI._hudTimer) {
                        clearInterval(UI._hudTimer);
                        UI._hudTimer = null;
                    }
                });
            }

            // Очищаем старый интервал перед установкой нового
            if (this._hudTimer) {
                clearInterval(this._hudTimer);
                this._hudTimer = null;
            }

            // Живое обновление HUD: локация, HP, монеты и опыт каждые 1000 мс
            this._hudTimer = setInterval(() => {
                if (!hud || hud.style.display === 'none') {
                    if (this._hudTimer) {
                        clearInterval(this._hudTimer);
                        this._hudTimer = null;
                    }
                    return;
                }

                const currentHero = G.ME?.hero || G.ME?.me || window.__lgHero;

                // Герой появился позже (HUD ещё показывает заглушку «Загрузка
                // профиля...») — дорисовываем карточку целиком и выходим.
                // Проверяем метку готовности, а не #player-hud-xp-text: полосу
                // опыта можно отключить в настройках, и HUD перерисовывался бы
                // каждую секунду.
                if (currentHero && hud.dataset.hudReady !== '1') {
                    this.renderPlayerHudContent(hud, currentHero);
                    return;
                }

                // Изменился набор баффов или статус (поел, выпил свиток, умер,
                // начался бой) — перерисовываем карточку: состав элементов другой.
                if (currentHero && hud.dataset.hudSig !== this._hudSignature(currentHero)) {
                    this.renderPlayerHudContent(hud, currentHero);
                    return;
                }

                // Локация: Город / Шахта / Поход
                const locEl = hud.querySelector('#player-hud-loc');
                if (locEl) {
                    const loc = this._detectHudLocation();
                    locEl.textContent = loc.text;
                    locEl.style.color = loc.color;
                }

                if (currentHero) {
                    // HP: иконка ❤️ живёт в подписи шаблона, значение — только цифры.
                    const hpEl = hud.querySelector('#player-hud-hp');
                    if (hpEl) {
                        const curHp = currentHero.hpNow !== undefined ? currentHero.hpNow : (currentHero.hp !== undefined ? currentHero.hp : '—');
                        const mHp = currentHero.stats?.hp !== undefined ? currentHero.stats.hp : (currentHero.hpMax !== undefined ? currentHero.hpMax : (currentHero.maxHp || currentHero.mhp || '—'));
                        hpEl.textContent = (mHp !== null && mHp !== undefined) ? `${curHp} / ${mHp}` : curHp;
                    }
                    const moneyEl = hud.querySelector('#player-hud-money');
                    if (moneyEl) {
                        const mon = currentHero.money !== undefined ? currentHero.money : (currentHero.coins !== undefined ? currentHero.coins : (currentHero.gold !== undefined ? currentHero.gold : 0));
                        moneyEl.textContent = Utils.formatMoney(mon);
                    }
                    // Опыт: цифры и полоса прогресса уровня
                    const xpEl = hud.querySelector('#player-hud-xp-text');
                    const xpBar = hud.querySelector('#player-hud-xp-bar');
                    if (xpEl && xpBar) {
                        const { xp, xpNext } = this._heroXp(currentHero);
                        xpEl.textContent = `${xp} / ${xpNext}`;
                        // Math.max(1, …) — защита от деления на 0; 100 — потолок полосы.
                        xpBar.style.width = `${Math.min(100, Math.round((xp / Math.max(1, xpNext)) * 100))}%`;
                    }

                    // Баффы: пересчитываем подписи по data-until (см. ui-templates.js),
                    // чтобы таймер тикал без полной перерисовки HUD. Просроченные
                    // чипы убираем — на следующем тике hudSig перерисует карточку.
                    const buffsEl = hud.querySelector('#player-hud-buffs');
                    if (buffsEl) {
                        buffsEl.querySelectorAll('[data-until]').forEach(el => {
                            const until = Number(el.dataset.until) || 0;
                            const left = until - Date.now();
                            if (left > 0) {
                                el.textContent = `${el.dataset.icon || ''} ${this._hudTimeLeft(left)}`.trim();
                            } else {
                                el.remove();
                            }
                        });
                    }
                }
            }, 1000);

            try {
                const res = await Utils.fetchApi('/api/me');
                const freshHero = res?.hero || res?.body?.hero || res?.me || (res?.hpNow !== undefined ? res : null);
                if (freshHero) {
                    window.__lgHero = freshHero;
                    this.renderPlayerHudContent(hud, freshHero);
                }
            } catch (e) {
                dbg('[HUD] Ошибка запроса /api/me:', e);
            }
        }
    };

    // ===== src/modules/miner.js (удалён в 11.6.4b: античит, используется заглушка) =====
    const Miner = {
        abortController: null,
        init() {
            document.getElementById(DOM_IDS.btnAutoMine)?.remove();
        },
        stopMining() {}
    };

    // ===== src/modules/build-sim.js =====
    // ============================================================
    // 4. МОДУЛЬ: ПЛАНИРОВЩИК БИЛДОВ — РАДИАЛЬНОЕ СОЗВЕЗДИЕ
    //
    // Новая система навыков игры (reference/LegionFrontSRC/site/skillmap.js):
    //   GET /api/skills        -> classes[].map = { P, E } — геометрия созвездия;
    //                             classes[].branches[].nodes[] — метаданные узлов;
    //   GET /api/skmap?cls=ID  -> состояние игрока (st.n/a/eq/s), лимиты
    //                             (step, classOpen), способности Арены (ab.br[]).
    //
    // ВАЖНО (античит/CSP): это ПЕСОЧНИЦА. POST /api/skmap/act не отправляется,
    // window.fetch/LGMine.open/LGMine.onEvent не патчатся. Действия меняют
    // только локальный объект sandbox — очки и жетоны игрока не тратятся.
    // ============================================================
    const BuildSim = {
        /* Имена классов (использует core/ui.js для карточки профиля). */
        classNames: { recruit: 'Новобранец', legionary: 'Легионер', archer: 'Лучник', mage: 'Маг', priest: 'Жрец', rogue: 'Разбойник', necromancer: 'Некромант', paladin: 'Паладин' },

        /* Цвета кнопок классов (нативный экран игры, как раньше). */
        classColors: { recruit: '#d7d3c8', legionary: '#ff7b7b', archer: '#7bff7b', mage: '#7bbaff', priest: '#ffcf4a', rogue: '#d4aaff', necromancer: '#7c52cc', paladin: '#ffdf7b' },
        classTextColors: { necromancer: '#fff' },

        /* Человеческие названия статов (использует hero-planner.js). */
        statNames: { hp: 'Макс. HP', atk: 'Физ. урон', mag: 'Магия', def: 'Броня', crit: 'Крит %', critDmg: 'Сила крита', dodge: 'Уклонение', pierce: 'Пробивание', healPow: 'Сила лечения', luck: 'Удача', resist: 'Сопротивление' },

        /* fx-ключи -> подписи в сводке «Что дают открытые навыки».
           v11.7.1: знаки «%» и «+» в подписях НЕ дублируются — суффикс и знак
           значения добавляет statList() (item.sign/item.suf). */
        fxNames: { melee: 'Физ. урон', magic: 'Магия', hp: 'Макс. HP', def: 'Броня', healPow: 'Сила лечения', healIn: 'Вх. лечение', crit: 'Крит', critDmg: 'Сила крита', skel: 'Урон скелетов', skelT: 'Время скелетов', leech: 'Вампиризм', block: 'Снижение урона', dodge: 'Уклонение', lead: 'Урон по боссам', first: 'Урон 1-й ход', dmg: 'Весь урон', pierce: 'Пробивание', resist: 'Сопротивление', healCrit: 'Крит лечения', regen: 'Регенерация', low: 'Урон при низком HP', ranged: 'Урон луком', poison: 'Отрава', steal: 'Кража', loot: 'Добыча', skelN: 'Скелетов', volley: 'Залп', shieldBlock: 'Щит блок', trapDodge: 'Ловушки', steady: 'Промах→удар', cleave: 'Замах', cleaveBoss: 'Замах по боссу', penBoss: 'Бронебой по боссу', drain: 'Вытягивание', hex: 'Проклятие', holy: 'По нежити', poisonT: 'Время отравы', abNext: 'Удар после умения', angel: 'Ангел-хранитель', backFoe: 'Урон по дальней линии', banner: 'Знамя когорты', breakHeal: 'Лечение при разбитом щите', burnChain: 'Цепной огонь', burnFoe: 'Урон по горящим', chillFoe: 'Урон по ознобу', chillProc: 'Шанс озноба', coverNb: 'Прикрытие соседа', critBleed: 'Кровотечение при крите', critBlind: 'Ослепление при крите', critBurn: 'Поджог при крите', critPierceWard: 'Крит сквозь щиты', dmgHeal: 'Лечение от урона', dodgeNext: 'Выстрел после уклонения', firstTeam: 'Урон команды в 1-й ход', guardAura: 'Аура защиты стойки', healNext: 'Удар после лечения', healRegen: 'Регенерация после лечения', healSplash: 'Всплеск лечения', highFoe: 'Урон по здоровым', highSelf: 'Урон при высоком HP', huntMark: 'Охотничья метка', killHit: 'Добивание врага', lastStand: 'Последний рубеж', lineCut: 'Защита соратников по линии', lowHeal: 'Лечение раненых', multiLow: 'Залп по раненым', overShield: 'Щит избытка лечения', phoenixHeart: 'Сердце феникса', ricochet: 'Рикошет выстрела', sameFoe: 'Пристрелка', shieldDmg: 'Урон под щитом', shieldUp: 'Прочность накладываемых щитов', startShield: 'Стартовый барьер', startWard: 'Стартовый оберег', taunt: 'Провокация', thorns: 'Шипы на щите', trap: 'Капкан', underShield: 'Защита под щитом', weakFoe: 'Урон по ослабленным', winter: 'Вечная зима' },

        /* Категории прокачки способностей Арены (как в /api/skmap: ab.br[].next). */
        ARENA_KINDS: [['lv', 'Ступень'], ['pow', 'Мощь'], ['eff', 'Эффект'], ['dur', 'Длительность']],
        ARENA_KIND_DEFAULT_MAX: { lv: 5, pow: 3, eff: 3, dur: 3 },
        /* Фолбэк-шкала цены шага (когда сервер не прислал next для этой ступени). */
        ARENA_COST: { lv: [1, 3, 7, 15, 25], pow: [2, 5, 10], eff: [2, 5, 10], dur: [2, 5, 10] },

        /* Ключи хранилища пресетов. */
        BUILD_KEY: 'lgu_saved_builds_v2',
        LEGACY_BUILD_KEY: 'LEGION_SAVED_BUILDS',

        /* Палитра веток (bi % 3) — как в skillmap.css (--bc-0..2). */
        BRANCH_COLORS: ['#5cc8ff', '#ff9466', '#c4a0ff'],

        /* ------------------------------------------------------------
         * Состояние модуля (память страницы)
         * ---------------------------------------------------------- */
        skillsCache: null,   // ответ GET /api/skills
        skmapCache: {},      // clsId -> ответ GET /api/skmap?cls=…
        sandbox: {},         // clsId -> { nodes, abilities, eq, up }
        savedBuilds: {},     // clsId -> [{ name, at, data }]
        hero: null,          // последний /api/me.hero (имя, уровень, статы)

        _skmapPending: {},   // clsId -> Promise (дедупликация запросов)
        _root: null,         // контейнер HeroPlanner (#hp-buildsim-container)
        _els: {},            // кэш элементов оболочки
        _cls: '',            // активный класс
        _tab: 'map',         // 'map' | 'gear'
        _sel: null,          // выбранный узел/ромб/'hub'
        _hover: null,        // узел под курсором
        _view: { s: 1, x: 0, y: 0 },
        _pan: null,
        _hashCode: '',       // код из ссылки #build=…
        _savedLoaded: false,
        _needLegacyMigration: false,
        _buildIndex: null,   // выбранный пресет в списке
        _buildName: '',
        /* ------------------------------------------------------------
         * Иконки (собственный компактный набор, viewBox 0 0 24 24).
         * ---------------------------------------------------------- */
        SKILL_ICONS: {
            sword: '<path d="M19.5 4.5 20 4l-.5 4.5L9.5 18.5l-4-4zM7.5 16.5l-3 3M4 15l5 5"/>',
            shield: '<path d="M12 3.5l7 2.8v5.1c0 4.6-3 7.8-7 9.6-4-1.8-7-5-7-9.6V6.3z"/>',
            bow: '<path d="M6 3c6 3 9 9 6 18M6 3l12 18M14 5h5v5M19 5 9 15"/>',
            spark: '<path d="M12 2.5l1.8 6.2 6.2 1.8-6.2 1.8L12 18.5l-1.8-6.2L4 10.5l6.2-1.8z"/>',
            fire: '<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.6 3-5.8 3.6-9.5 2 1.5 3 3.4 3.2 5.3 1-1 1.6-2.4 1.6-3.8 2.7 2.2 4.6 5 4.6 8 0 3.4-2.5 6-6 6z"/>',
            frost: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
            heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
            cross: '<path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>',
            skull: '<path d="M12 3.5a7.5 7.5 0 0 0-4.5 13.5v3h9v-3A7.5 7.5 0 0 0 12 3.5z"/><circle cx="9.3" cy="11.5" r="1.6"/><circle cx="14.7" cy="11.5" r="1.6"/>',
            star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
            bolt: '<path d="M13.5 2.5 5.5 13.5h6l-1.5 8 8-11h-6z"/>',
            crown: '<path d="M3.5 18.5h17M4.5 18.5 3.5 7l5 4 3.5-6 3.5 6 5-4-1 11.5z"/>',
            wind: '<path d="M3 8.5h11a3 3 0 1 0-3-3M3 12.5h15a3 3 0 1 1-3 3M3 16.5h8"/>',
            eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
            dagger: '<path d="M14.5 3.5 16 5l-7.5 9-2-2zM6.5 12l-2.5 2.5 2 2 2.5-2.5M5 15.5l-1.5 1.5 3 3L8 18.5M15 13.5l5 5"/>',
            vial: '<path d="M9.5 3.5h5M10.5 3.5v5L6 17a2.6 2.6 0 0 0 2.3 3.5h7.4A2.6 2.6 0 0 0 18 17l-4.5-8.5v-5M8 14.5h8"/>',
            sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
            drop: '<path d="M12 3.5s-6 6.6-6 10.6a6 6 0 0 0 12 0c0-4-6-10.6-6-10.6z"/>',
            coin: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.6-.9-1.5-1.3-2.5-1.3-1.5 0-2.5.8-2.5 1.9 0 2.7 5.2 1.3 5.2 4 0 1.1-1.1 1.9-2.7 1.9-1.1 0-2.1-.5-2.6-1.4M12 6.5v1.7M12 15.8v1.7"/>',
            leaf: '<path d="M4 20c8 0 16-4 16-16C10 4 4 10 4 20zM8 16c2-4 5-6 9-8"/>',
            hex: '<path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z"/>',
            tri: '<path d="M12 4l8 16H4z"/>',
            clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
            diam: '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>'
        },
        SOLID_ICONS: ['sword', 'shield', 'heart', 'cross', 'star', 'bolt', 'crown', 'fire', 'spark', 'leaf', 'hex', 'tri', 'diam', 'drop'],
        FX_ICONS: [
            [/^(melee|dmg|cleave|first|a_natisk|cd_natisk)$/, 'sword'],
            [/^(def|block|shieldBlock|resist|a_stoyka)$/, 'shield'],
            [/^(ranged|volley|pierce|a_pricel|a_grad|cd_grad)$/, 'bow'],
            [/^(magic|crit|critDmg|a_vspyshka|cd_vspyshka)$/, 'spark'],
            [/^(hp|regen|leech|healIn)$/, 'heart'],
            [/^(healPow|healCrit|a_obereg|cd_obereg|a_siyanie|cd_siyanie)$/, 'cross'],
            [/^(low|lastStand)$/, 'skull'],
            [/^(dodge|trapDodge)$/, 'wind'],
            [/^(steady|lead)$/, 'eye'],
            [/^(a_oznob|cd_oznob)$/, 'frost'],
            [/^(poison|poisonT|a_yad|cd_yad)$/, 'vial'],
            [/^(steal|loot)$/, 'coin'],
            [/^(a_vspinu|cd_vspinu)$/, 'dagger'],
            [/^(skel|skelT|skelN|a_podnyat|cd_podnyat)$/, 'skull'],
            [/^(drain|a_vytyanut|cd_vytyanut)$/, 'drop'],
            [/^(hex|a_proklyat|cd_proklyat)$/, 'fire'],
            [/^(holy|a_svet)$/, 'sun'],
            [/^(aura|a_dlan|cd_dlan|cd_aura)$/, 'cross']
        ],
        CLASS_ICONS: { legionary: 'sword', archer: 'bow', mage: 'spark', priest: 'cross', rogue: 'dagger', necromancer: 'skull', paladin: 'sun', gear: 'shield', recruit: 'diam' },
        /* Сопоставление id ветки и иконки (фолбэк, если у узла нет fx). */
        BRANCH_ICONS: { blade: 'sword', shield: 'shield', bow: 'bow', arcane: 'spark', fire: 'fire', frost: 'frost', holy: 'sun', light: 'sun', shadow: 'skull', dark: 'skull', blood: 'drop', life: 'heart', nature: 'leaf', poison: 'vial', wind: 'wind', might: 'crown', grace: 'cross' },

        /* Экранирование HTML/SVG-текста. */
        esc(v) { return Utils.escapeHtml(String(v == null ? '' : v)); },

        _iconPaths(key) { return this.SKILL_ICONS[key] || this.SKILL_ICONS.diam; },

        /* Иконка как самостоятельный <svg> (сайдбар, инспектор). */
        _svg(key) {
            const known = this.SKILL_ICONS[key] ? key : 'diam';
            const solid = this.SOLID_ICONS.indexOf(known) >= 0 ? ' so' : '';
            return `<svg class="lgu-skm-i${solid}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${this._iconPaths(known)}</svg>`;
        },

        /* Иконка как вложенный <svg> внутри группы созвездия. */
        _iconMarkup(key, size) {
            const s = size || 26;
            const known = this.SKILL_ICONS[key] ? key : 'diam';
            return `<svg x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${this._iconPaths(known)}</svg>`;
        },

        iconKeyOf(node, branch) {
            if (!node) return 'diam';
            const fxKeys = Object.keys(node.fx || {});
            if (fxKeys.some(k => k.indexOf('cd_') === 0)) return 'clock';
            if (node.kind === 'cap') return 'crown';
            if (node.kind === 'act') return 'bolt';
            if (node.kind === 'ctl') return 'star';
            for (const k of fxKeys) {
                for (const [re, icon] of this.FX_ICONS) if (re.test(k)) return icon;
            }
            const bid = branch && branch.id;
            if (bid && this.BRANCH_ICONS[bid]) return this.BRANCH_ICONS[bid];
            if (node.icon && this.SKILL_ICONS[node.icon]) return node.icon;
            return 'diam';
        },
        getNodeSvg(node, branch) { return this._svg(this.iconKeyOf(node, branch)); },
        getClassSvg(clsId) { return this._svg(this.CLASS_ICONS[clsId] || 'diam'); },

        isSkipFx(key) { return SKIP_FX_PREFIXES.some(p => key.indexOf(p) === 0); },

        /**
         * Коэффициент перевода сырого fx во вторичную характеристику.
         *
         * В игре resist/pierce лежат в fx «сырыми» и переводятся в статы через
         * LGGameData.xstats.fromFx (обычно 0.5: fx 60 -> +30). Без множителя
         * подсказки и сводка показывали удвоенные значения (+60 вместо +30).
         */
        xstatFromFx() {
            const src = (typeof G !== 'undefined' && G && G.LGGameData && G.LGGameData.xstats)
                ? G.LGGameData.xstats.fromFx
                : null;
            const base = { resist: 0.5, pierce: 0.5 };
            if (!src || typeof src !== 'object') return base;
            return { ...base, ...src };
        },

        /**
         * Текст навыка с подстановкой значений fx за текущий ранг.
         * Макросы cleaveBoss/penBoss/critX считаются на лету — их нет в fx
         * (см. kv() в reference/LegionFrontSRC/site/skills.js).
         */
        formatNodeText(node, rank) {
            if (!node || !node.text) return '';
            const r = Math.max(1, +rank || 1);
            const fx = node.fx || {};
            const fromFx = this.xstatFromFx();
            const fmt = (val) => Number.isInteger(val) ? String(val) : val.toFixed(1).replace(/\.0$/, '').replace('.', ',');
            const scaleOf = (key) => {
                const s = +fromFx[key];
                return isFinite(s) ? s : 1;
            };
            const rawText = String(node.text);

            let out = rawText.replace(/\{(\w+)\}/g, (match, key) => {
                if (key === 'cleaveBoss') return fmt((fx.cleave || 0) * r * 0.4);
                if (key === 'penBoss') return fmt((fx.pierce || 0) * r / 20);
                if (key === 'critX') return fmt(2 + (fx.critDmg || 0) * r / 100);
                // v11.7.0: {resist}/{pierce} в тексте — БАЗОВЫЙ ШАНС срабатывания
                // умения (например, «10%»), поэтому fx умножается ТОЛЬКО на ранг:
                // fromFx (0.5) применяется лишь к примечаниям о характеристиках.
                if (fx[key] !== undefined) return fmt(fx[key] * r);
                return match;
            });

            // v11.7.0: примечания добавляются ВСЕГДА, когда в fx есть resist/
            // pierce: игра дописывает вторичные статы даже без плейсхолдера
            // в тексте («Физ. урон +5 · характеристика «Сопротивление» +30»).
            const notes = [];
            if (fx.resist !== undefined) {
                notes.push(`характеристика «Сопротивление» +${fmt(fx.resist * r * scaleOf('resist'))}`);
            }
            if (fx.pierce !== undefined) {
                notes.push(`характеристика «Пробивание» +${fmt(fx.pierce * r * scaleOf('pierce'))}%`);
            }
            if (notes.length) out += ' · ' + notes.join(' · ');

            return out;
        },

        /** Кнопка BuildSim больше не нужна (её ведёт HeroPlanner), но init
         *  остаётся точкой входа из main.js. */
        init() { /* ничего не регистрируем: песочница монтируется в HeroPlanner */ },

        /* ------------------------------------------------------------
         * Данные класса / графа
         * ---------------------------------------------------------- */
        classList() {
            const list = (this.skillsCache && Array.isArray(this.skillsCache.classes)) ? this.skillsCache.classes : [];
            return list.filter(c => c && c.id && c.map && c.map.P);
        },

        clsData(cls) {
            const id = cls || this._cls;
            return this.classList().find(c => c.id === id) || null;
        },

        mapP() {
            const C = this.clsData();
            return (C && C.map && C.map.P) || {};
        },

        mapE() {
            const C = this.clsData();
            return (C && C.map && Array.isArray(C.map.E)) ? C.map.E : [];
        },

        /** Координаты узла: 'hub' — всегда центр (0,0). */
        pointOf(id) {
            if (id === 'hub') return { x: 0, y: 0 };
            const p = this.mapP()[id];
            return (p && isFinite(+p.x) && isFinite(+p.y)) ? { x: +p.x, y: +p.y } : null;
        },

        branchOf(id, cls) {
            const C = this.clsData(cls);
            if (!C) return null;
            for (const B of (C.branches || [])) {
                for (const n of (B.nodes || [])) if (n.id === id) return B;
            }
            return null;
        },

        nodeOf(id, cls) {
            const C = this.clsData(cls);
            if (!C) return null;
            for (const B of (C.branches || [])) {
                for (const n of (B.nodes || [])) if (n.id === id) return n;
            }
            return null;
        },

        /** Метаданные способности Арены: ключ «ветка:ab» / «ветка:ult». */
        abOf(key, cls) {
            const parts = String(key || '').split(':');
            if (parts.length !== 2) return null;
            const bid = parts[0], kind = parts[1];
            if (kind !== 'ab' && kind !== 'ult') return null;
            const V = this.skmapCache[cls || this._cls];
            const list = (V && V.ab && Array.isArray(V.ab.br)) ? V.ab.br : [];
            const br = list.find(x => x && x.id === bid);
            if (br && br[kind]) return br[kind];
            const C = this.clsData(cls);
            const B = C && (C.branches || []).find(b => b && b.id === bid);
            return (B && B[kind]) ? B[kind] : null;
        },

        branchIndex(bid) {
            const C = this.clsData();
            return C ? (C.branches || []).findIndex(b => b && b.id === bid) : -1;
        },

        branchColor(bi) {
            const i = Math.abs((+bi || 0) % 3);
            return this.BRANCH_COLORS[i];
        },

        /* ------------------------------------------------------------
         * Правила графа (повторяют skillmap.js)
         * ---------------------------------------------------------- */

        /** Соседи по рёбрам созвездия; рёбра 'q' (молнии похода) не считаются. */
        nbrs(id) {
            const out = [];
            for (const e of this.mapE()) {
                if (!e || e.length < 2 || e[3] === 'q') continue;
                if (e[0] === id) out.push(e[1]);
                else if (e[1] === id) out.push(e[0]);
            }
            return out;
        },

        _isOpen(st, id) {
            if (id === 'hub') return true;
            const s = st || this.state();
            return (+((s.nodes || {})[id]) > 0) || !!((s.abilities || {})[id]);
        },

        /** Все открытые узлы (для проверки связности/счётчиков). */
        _openedIds(st, skipId) {
            const out = [];
            for (const [id, r] of Object.entries((st && st.nodes) || {})) {
                if (+r > 0 && id !== skipId) out.push(id);
            }
            for (const [key, v] of Object.entries((st && st.abilities) || {})) {
                if (v && key !== skipId) out.push(key);
            }
            return out;
        },

        _reachable(allowed) {
            const seen = new Set(['hub']);
            const queue = ['hub'];
            while (queue.length) {
                const u = queue.pop();
                for (const v of this.nbrs(u)) {
                    if (allowed.has(v) && !seen.has(v)) { seen.add(v); queue.push(v); }
                }
            }
            return seen;
        },

        /**
         * Проверка ПКМ/«−»: узел можно закрыть, только если ни один из
         * оставшихся открытых узлов не потеряет связь с центром ('hub').
         */
        _canRemove(st, id) {
            const before = this._reachable(new Set(['hub'].concat(this._openedIds(st))));
            const after = this._reachable(new Set(['hub'].concat(this._openedIds(st, id))));
            for (const other of this._openedIds(st, id)) {
                if (before.has(other) && !after.has(other)) return false;
            }
            return true;
        },

        canOpen(st, id) {
            if (this._isOpen(st, id)) return false;
            return this.nbrs(id).some(nb => this._isOpen(st, nb));
        },

        openedCount(st) {
            const s = st || this.state();
            let n = 0;
            for (const r of Object.values(s.nodes || {})) if (+r > 0) n++;
            for (const v of Object.values(s.abilities || {})) if (v) n++;
            return n;
        },

        /** Молния похода активна, если открыт её узел-хозяин (p.host) либо
         *  смежный узел по ребру 'q'. */
        questActive(st, id) {
            const P = this.mapP();
            const key = String(id).indexOf('q:') === 0 ? String(id) : 'q:' + id;
            const p = P[key];
            if (p && p.host && this._isOpen(st, p.host)) return true;
            for (const e of this.mapE()) {
                if (!e || e[3] !== 'q') continue;
                if (e[0] === key && this._isOpen(st, e[1])) return true;
                if (e[1] === key && this._isOpen(st, e[0])) return true;
            }
            return false;
        },

        /* ------------------------------------------------------------
         * Песочница: состояние класса
         * ---------------------------------------------------------- */
        _blankState() {
            return { nodes: {}, abilities: {}, eq: { ab: '', ult: '' }, up: {} };
        },

        state(cls) {
            const id = cls || this._cls;
            if (!this.sandbox[id]) this.sandbox[id] = this._blankState();
            return this.sandbox[id];
        },

        _snapshot(st) {
            return {
                nodes: Object.assign({}, st.nodes || {}),
                abilities: Object.assign({}, st.abilities || {}),
                eq: { ab: (st.eq && st.eq.ab) || '', ult: (st.eq && st.eq.ult) || '' },
                up: JSON.parse(JSON.stringify(st.up || {}))
            };
        },

        /* ------------------------------------------------------------
         * Стоимость и балансы
         * ---------------------------------------------------------- */
        /** Цена следующей ступени пассивного узла (жетоны ⟡). */
        stepCost(rank) {
            const V = this.skmapCache[this._cls];
            const arr = (V && Array.isArray(V.step) && V.step.length) ? V.step : [3, 4, 5, 6];
            const i = Math.min(arr.length - 1, Math.max(0, (+rank || 1) - 1));
            return +arr[i] || (+rank || 1) + 2;
        },

        /**
         * Лимит очков плана — максимум уровня игры (skillsCache.maxLevel,
         * фолбэк 50 SP). Это НЕ текущий запас героя (skmap.pts): песочница
         * позволяет спланировать билд на весь максимум, а запас героя
         * показывается рядом как справочный ориентир.
         */
        spLimit() {
            const max = +((this.skillsCache && this.skillsCache.maxLevel) || 0);
            return (isFinite(max) && max > 0) ? max : MAX_POINTS;
        },

        spentSP(st) {
            const s = st || this.state();
            let n = 0;
            for (const r of Object.values(s.nodes || {})) if (+r > 0) n++;
            for (const v of Object.values(s.abilities || {})) if (v) n++;
            return n;
        },

        spFree(st) { return Math.max(0, this.spLimit() - this.spentSP(st)); },

        tokenBalance() {
            const V = this.skmapCache[this._cls];
            if (V && isFinite(+V.n)) return Math.max(0, +V.n);
            const ab = this.hero && this.hero.sk && this.hero.sk.ab;
            return ab ? Math.max(0, +ab.n || 0) : 0;
        },

        /** Потрачено жетонов планом: ступени узлов (rank >= 2) + прокачка Арены. */
        tokensSpent(st) {
            const s = st || this.state();
            let sum = 0;
            // Открытие узла — 1 SP; каждая ступень с 1 на 2, с 2 на 3… стоит
            // stepCost(текущий ранг) — ровно как в skillmap.js (plus()).
            for (const [, r] of Object.entries(s.nodes || {})) {
                for (let k = 1; k < (+r || 0); k++) sum += this.stepCost(k);
            }
            for (const [key, up] of Object.entries(s.up || {})) {
                if (!s.abilities[key]) continue;
                for (const [kind] of this.ARENA_KINDS) {
                    const base = kind === 'lv' ? 1 : 0;
                    sum += this._upPathCost(key, kind, base, +((up || {})[kind]) || 0);
                }
            }
            return sum;
        },

        abMax(kind) {
            const V = this.skmapCache[this._cls];
            const m = V && V.ab && V.ab.max;
            const v = m ? +m[kind] : 0;
            return (isFinite(v) && v > 0) ? v : (this.ARENA_KIND_DEFAULT_MAX[kind] || 1);
        },

        _normUp(up) {
            const src = up || {};
            return {
                lv: Math.max(1, +src.lv || 0),
                pow: Math.max(0, +src.pow || 0),
                eff: Math.max(0, +src.eff || 0),
                dur: Math.max(0, +src.dur || 0)
            };
        },

        /** Цена одного шага прокачки: next из /api/skmap у текущего уровня игры,
         *  иначе — фолбэк-шкала ARENA_COST. */
        _stepUpCost(key, kind, from) {
            const meta = this.abOf(key);
            const game = (meta && meta.up) ? (+meta.up[kind] || 0) : 0;
            if (meta && meta.next && +meta.next[kind] > 0 && (+from || 0) === game) return +meta.next[kind];
            const table = this.ARENA_COST[kind] || [];
            // v11.7.1: ступень способности ('lv') начинается с 1, а pow/eff/dur
            // — с 0. Поэтому для 'lv' индекс шкалы = шаг-1, иначе первый шаг
            // (1 -> 2) брал цену второй ступени и завышал план на 1 жетон.
            const idx = kind === 'lv' ? Math.max(0, (+from || 1) - 1) : (+from || 0);
            return +table[idx] || (+from || 0) + 2;
        },

        _upPathCost(key, kind, from, to) {
            let sum = 0;
            for (let v = +from || 0; v < (+to || 0); v++) sum += this._stepUpCost(key, kind, v);
            return sum;
        },

        /* ------------------------------------------------------------
         * Сеть: кэш /api/skills и /api/skmap
         * ---------------------------------------------------------- */
        async ensureSkills(force) {
            if (this.skillsCache && !force) return this.skillsCache;
            const res = await Utils.fetchApi('/api/skills');
            const d = (res && Array.isArray(res.classes)) ? res : (res && res.body) || null;
            if (!d || d.ok === false || !Array.isArray(d.classes)) {
                throw new Error((d && d.error) || (res && res.error) || 'нет данных о навыках');
            }
            this.skillsCache = d;
            return d;
        },

        async ensureSkmap(cls, force) {
            const id = cls || this._cls;
            if (!id) return null;
            if (this.skmapCache[id] && !force) return this.skmapCache[id];
            if (this._skmapPending[id] && !force) return this._skmapPending[id];
            const p = Utils.fetchApi('/api/skmap?cls=' + encodeURIComponent(id)).then((res) => {
                const d = (res && res.cls && res.st) ? res : (res && res.body && res.body.cls ? res.body : null);
                if (!d) throw new Error((res && res.error) || (res && res.body && res.body.error) || 'карта навыков не загрузилась');
                this.skmapCache[id] = d;
                return d;
            }).catch((err) => {
                dbg('[BUILD SIM] skmap:', err);
                throw err;
            }).finally(() => { delete this._skmapPending[id]; });
            this._skmapPending[id] = p;
            return p;
        },

        /* ------------------------------------------------------------
         * Монтирование в HeroPlanner (#hp-buildsim-container)
         * ---------------------------------------------------------- */
        async mount(container) {
            if (!container) return;
            this._root = container;
            this._sel = null;
            this._hover = null;
            this._tab = 'map';
            this._buildIndex = null;
            this._buildName = '';
            this._view = { s: 1, x: 0, y: 0 };
            this.loadSavedBuilds();
            const hash = window.location.hash || '';
            this._hashCode = hash.indexOf('#build=') >= 0 ? this._extractBuildCode(hash) : '';
            container.innerHTML = '<div class="loader">Загрузка созвездия навыков…</div>';
            try {
                await this.ensureSkills();
                if (!this.hero) {
                    const me = await Utils.fetchApi('/api/me');
                    if (me && me.ok && me.hero) this.hero = me.hero;
                }
                if (this._needLegacyMigration) {
                    this._migrateLegacyBuilds();
                    this._needLegacyMigration = false;
                }
                const list = this.classList();
                if (!list.length) throw new Error('карта навыков недоступна (нет map.P)');

                let initial = '';
                if (this._hashCode) {
                    initial = this.decodeBuild(this._hashCode);
                    if (initial) UI.showToast('📥 Билд загружен из ссылки!');
                    else UI.showToast('❌ Неверный формат кода билда', true);
                    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* noop */ }
                }
                const h = this.hero || {};
                const heroCls = h.role || h.class || h.c || (h.sk && h.sk.c) || '';
                const start = initial || (heroCls && list.some(c => c.id === heroCls) ? heroCls : list[0].id);

                this._renderShell();
                this._wire();
                await this.selectClass(start);
            } catch (err) {
                dbg('[BUILD SIM] mount:', err);
                container.innerHTML = `<div class="lgu-skm-error">⚠ ${this.esc(err.message || 'не удалось загрузить карту навыков')}</div>`;
            }
        },

        _renderShell() {
            const root = this._root;
            if (!root) return;
            root.innerHTML = `
                <div class="sim-layout lgu-skm-layout">
                    <div class="sim-sidebar" id="lgu-skm-side"></div>
                    <div class="sim-main-content" id="lgu-skm-main">
                        <div class="sim-top-bar lgu-skm-bar" id="lgu-skm-bar">
                            <div class="lgu-skm-res" title="Очки навыков плана">
                                <em>Очки навыков (SP):</em> <b id="lgu-skm-sp">0</b>
                                <small id="lgu-skm-sp-note"></small>
                            </div>
                            <div class="lgu-skm-res" title="Жетоны навыков, потраченные планом (⟡)">
                                <em>Жетоны (⟡):</em> <b id="lgu-skm-tok">0</b>
                                <small id="lgu-skm-tok-note"></small>
                            </div>
                            <span class="sim-bar-sep"></span>
                            <select id="lgu-skm-build-list" class="lgu-skm-build-list" data-build="select" aria-label="Сохранённые билды"></select>
                            <input id="lgu-skm-build-name" class="sim-save-name" type="text" maxlength="40" placeholder="Название билда" aria-label="Название билда">
                            <button type="button" class="sim-save-btn" data-act="save" title="Сохранить билд">💾</button>
                            <button type="button" class="sim-del-btn" data-act="delete" title="Удалить выбранный билд">🗑️</button>
                            <button type="button" class="sim-share-btn" data-act="share" title="Скопировать ссылку на билд">📤</button>
                            <button type="button" class="sim-import-btn" data-act="import" title="Импорт кода/ссылки">📥</button>
                            <button type="button" class="sim-keep-btn" data-act="reset" title="Сбросить план к состоянию игры">⟲</button>
                        </div>
                        <div class="lgu-skm-hero" id="lgu-skm-hero"></div>
                        <div class="lgu-skm-stage" id="lgu-skm-stage">
                            <div class="lgu-skm-map" id="lgu-skm-map">
                                <svg class="lgu-skm-svg" id="lgu-skm-svg" viewBox="-600 -600 1200 1200" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Созвездие навыков">
                                    <rect class="lgu-skm-bg" x="-600" y="-600" width="1200" height="1200"></rect>
                                    <g id="lgu-skm-world"></g>
                                </svg>
                                <div class="lgu-skm-zoom">
                                    <button type="button" data-act="zoom-in" aria-label="Приблизить">＋</button>
                                    <button type="button" data-act="zoom-out" aria-label="Отдалить">－</button>
                                    <button type="button" data-act="zoom-reset" aria-label="Сбросить вид">⌂</button>
                                </div>
                            </div>
                            <aside class="lgu-skm-inspector" id="lgu-skm-insp"></aside>
                        </div>
                        <div class="lgu-skm-arena" id="lgu-skm-arena"></div>
                        <div class="lgu-skm-summary" id="lgu-skm-summary"></div>
                        <div class="lgu-skm-gear" id="lgu-skm-gear" hidden></div>
                    </div>
                </div>`;
            const q = (s) => root.querySelector(s);
            this._els = {
                side: q('#lgu-skm-side'), main: q('#lgu-skm-main'), bar: q('#lgu-skm-bar'),
                sp: q('#lgu-skm-sp'), spNote: q('#lgu-skm-sp-note'),
                tok: q('#lgu-skm-tok'), tokNote: q('#lgu-skm-tok-note'),
                buildList: q('#lgu-skm-build-list'), name: q('#lgu-skm-build-name'),
                hero: q('#lgu-skm-hero'), stage: q('#lgu-skm-stage'), map: q('#lgu-skm-map'),
                svg: q('#lgu-skm-svg'), world: q('#lgu-skm-world'),
                insp: q('#lgu-skm-insp'), arena: q('#lgu-skm-arena'),
                summary: q('#lgu-skm-summary'), gear: q('#lgu-skm-gear')
            };
            this._wireMap();
        },

        /* ------------------------------------------------------------
         * Выбор класса
         * ---------------------------------------------------------- */
        async selectClass(cls) {
            const list = this.classList();
            if (!cls || !list.some(c => c.id === cls)) return;
            const needGame = !this.sandbox[cls];
            this._cls = cls;
            this._tab = 'map';
            this._sel = null;
            this._hover = null;
            this._view = { s: 1, x: 0, y: 0 };
            this.renderSidebar();
            this.renderHero();
            if (this._els.world) this._els.world.innerHTML = '<text class="lgu-skm-wait" x="0" y="0" text-anchor="middle">Загрузка карты класса…</text>';
            try {
                await this.ensureSkmap(cls);
            } catch (err) {
                if (this._els.world) {
                    this._els.world.innerHTML = `<text class="lgu-skm-wait bad" x="0" y="0" text-anchor="middle">⚠ ${this.esc(err.message || 'карта не загрузилась')}</text>`;
                }
            }
            if (this._cls !== cls) return;
            if (needGame || !this.sandbox[cls]) this.loadFromGame(null, true);
            this._buildIndex = null;
            this._buildName = '';
            this.renderAll();
        },

        /* ------------------------------------------------------------
         * Состояние игры -> песочница
         * ---------------------------------------------------------- */
        loadFromGame(index, silent) {
            const cls = this._cls;
            const V = this.skmapCache[cls];
            if (!V) {
                if (!silent) UI.showToast('Состояние игры ещё не загружено', true);
                return false;
            }
            if (!this.sandbox[cls]) this.sandbox[cls] = this._blankState();
            const st = this.sandbox[cls];

            if (index !== null && index !== undefined) {
                const set = (V.st && Array.isArray(V.st.s)) ? V.st.s[+index] : null;
                if (!set) {
                    if (!silent) UI.showToast('Этот набор пуст', true);
                    return false;
                }
                st.eq = { ab: (set.eq && set.eq.ab) || '', ult: (set.eq && set.eq.ult) || '' };
                const P = this.mapP();
                for (const kind of ['ab', 'ult']) {
                    const key = st.eq[kind];
                    if (key && P[key] && P[key].ab && key.slice(-(kind.length + 1)) === ':' + kind) st.abilities[key] = 1;
                    else st.eq[kind] = '';
                }
                if (!silent) UI.showToast(`📥 Загружен «${set.nm || 'набор'}»`);
            } else {
                const fresh = this._blankState();
                const srcN = (V.st && V.st.n) || {};
                for (const [id, r] of Object.entries(srcN)) {
                    const node = this.nodeOf(id, cls);
                    if (!node || !(+r > 0)) continue;
                    fresh.nodes[id] = Math.max(1, Math.min(+r, +node.max || 1));
                }
                const srcA = (V.st && V.st.a) || {};
                const P = this.clsData(cls).map.P;
                for (const key of Object.keys(srcA)) {
                    if (srcA[key] && P[key] && P[key].ab) fresh.abilities[key] = 1;
                }
                fresh.eq = { ab: (V.st && V.st.eq && V.st.eq.ab) || '', ult: (V.st && V.st.eq && V.st.eq.ult) || '' };
                for (const kind of ['ab', 'ult']) {
                    const key = fresh.eq[kind];
                    if (!key || !P[key] || !fresh.abilities[key]) fresh.eq[kind] = '';
                }
                for (const br of ((V.ab && V.ab.br) || [])) {
                    if (!br || !br.id) continue;
                    if (br.ab) fresh.up[br.id + ':ab'] = this._normUp(br.ab.up);
                    if (br.ult) fresh.up[br.id + ':ult'] = this._normUp(br.ult.up);
                }
                this.sandbox[cls] = fresh;
                if (!silent) UI.showToast('📥 Загружено текущее состояние героя');
            }
            this._buildIndex = null;
            this._buildName = '';
            this._sel = null;
            this.renderAll();
            return true;
        },

        /** Санитизация внешнего билда: неизвестные узлы/ранги/слоты отбрасываем,
         *  «висящие» острова (без связи с hub) удаляем. */
        _sanitizeBuild(cls, data) {
            const st = this._blankState();
            const C = this.clsData(cls);
            if (!C) return st;
            const P = (C.map && C.map.P) || {};
            const src = data || {};
            for (const [id, r] of Object.entries(src.nodes || {})) {
                const o = P[id];
                const node = this.nodeOf(id, cls);
                if (!o || o.ab || o.q || !node) continue;
                const rank = Math.max(1, Math.min(Math.floor(+r) || 0, +node.max || 1));
                if (rank > 0) st.nodes[id] = rank;
            }
            for (const key of Object.keys(src.abilities || {})) {
                const o = P[key];
                if (o && o.ab && src.abilities[key]) st.abilities[key] = 1;
            }
            const eq = src.eq || {};
            for (const kind of ['ab', 'ult']) {
                const key = String(eq[kind] || '');
                if (key && st.abilities[key] && key.slice(-(kind.length + 1)) === ':' + kind) st.eq[kind] = key;
            }
            for (const [key, up] of Object.entries(src.up || {})) {
                if (!st.abilities[key]) continue;
                const kind = key.split(':')[1];
                const max = this._abMaxFor(kind, cls);
                const u = this._normUp(up);
                st.up[key] = {
                    lv: Math.min(max, Math.max(1, u.lv)),
                    pow: Math.min(max, u.pow),
                    eff: Math.min(max, u.eff),
                    dur: Math.min(max, u.dur)
                };
            }
            const prevCls = this._cls;
            this._cls = cls;
            this._fixState(cls, st);
            this._cls = prevCls;
            return st;
        },

        /** Лимит категории прокачки для конкретного класса (до загрузки skmap). */
        _abMaxFor(kind, cls) {
            const V = this.skmapCache[cls || this._cls];
            const m = V && V.ab && V.ab.max;
            const v = m ? +m[kind] : 0;
            return (isFinite(v) && v > 0) ? v : (this.ARENA_KIND_DEFAULT_MAX[kind] || 1);
        },

        /** Удаляет открытые узлы, потерявшие связь с 'hub', и чистит слоты. */
        _fixState(cls, st) {
            const reach = this._reachable(new Set(['hub'].concat(this._openedIds(st))));
            for (const [id, r] of Object.entries(st.nodes || {})) {
                if (+r > 0 && !reach.has(id)) delete st.nodes[id];
            }
            for (const key of Object.keys(st.abilities || {})) {
                if (st.abilities[key] && !reach.has(key)) delete st.abilities[key];
            }
            for (const kind of ['ab', 'ult']) {
                const key = st.eq[kind];
                if (key && (!st.abilities[key] || key.slice(-(kind.length + 1)) !== ':' + kind)) st.eq[kind] = '';
            }
        },

        /* ------------------------------------------------------------
         * Общая перерисовка
         * ---------------------------------------------------------- */
        renderAll() {
            if (!this._root || !this._els.world) return;
            this.renderSidebar();
            this.renderHero();
            this.renderBar();
            this.renderMap();
            this.renderInspector();
            this.renderArena();
            this.renderSummary();
            this.renderGear();
            this._updateVisibility();
        },

        _updateVisibility() {
            const gear = this._tab === 'gear';
            const set = (el, hide) => { if (el) el.hidden = hide; };
            set(this._els.bar, gear);
            set(this._els.hero, gear);
            set(this._els.stage, gear);
            set(this._els.arena, gear);
            set(this._els.summary, gear);
            set(this._els.gear, !gear);
        },

        renderSidebar() {
            const el = this._els.side;
            if (!el) return;
            const list = this.classList();
            let html = `<button type="button" class="modal-tab sim-tab${this._tab === 'gear' ? ' active' : ''}" data-tab="gear">${this.getClassSvg('gear')}Экипировка</button>`;
            html += '<div class="sim-sidebar-sep"></div>';
            for (const c of list) {
                const color = this.classColors[c.id] || '#caa55c';
                const text = this.classTextColors[c.id] || '#12100e';
                const active = this._tab !== 'gear' && c.id === this._cls;
                html += `<button type="button" class="modal-tab sim-tab${active ? ' active' : ''}" data-class="${this.esc(c.id)}" style="--c:${color};--ct:${text}">${this.getClassSvg(c.id)}${this.esc(this.classNames[c.id] || c.name || c.id)}</button>`;
            }
            el.innerHTML = html;
        },

        renderHero() {
            const el = this._els.hero;
            if (!el) return;
            const C = this.clsData();
            const V = this.skmapCache[this._cls] || {};
            const h = this.hero || {};
            const name = h.name || (G.ME && G.ME.user && (G.ME.user.name || G.ME.user.login)) || 'Игрок';
            const lvl = h.lvl || h.level || h.l || (V.lvl || 1);
            const clsName = this.classNames[this._cls] || (C && C.name) || this._cls;
            const opened = this.openedCount();
            const classOpen = +(V.classOpen || 0);
            // classOpen — ПОРОГ открытия умения класса, а не лимит очков:
            // пока порог не взят, показываем прогресс; после — строго
            // «открыто», без дроби (7/3): перебора здесь быть не может.
            const hubOn = classOpen > 0 && opened >= classOpen;
            const hubPill = hubOn
                ? `<span class="lgu-skm-pill hub-on status" title="Порог ${classOpen} открытых узлов класса пройден">✦ Умение класса открыто</span>`
                : `<span class="lgu-skm-pill status" title="Нужно открыть узлов класса: ${classOpen || '—'}">До умения класса: ${opened} / ${classOpen || '—'}</span>`;
            el.innerHTML = `
                <span class="lgu-skm-avat" style="--c:${(C && C.color) || this.classColors[this._cls] || '#ffd24a'}">${this.getClassSvg(this._cls)}</span>
                <span class="lgu-skm-who"><b>${this.esc(name)}</b><small>${this.esc(clsName)} · ${this.esc(lvl)} ур.</small></span>
                ${hubPill}`;
        },

        renderBar() {
            const E = this._els;
            if (!E.sp || !this._els.world) return;
            const st = this.state();
            const V = this.skmapCache[this._cls] || {};
            const sp = this.spentSP(st);
            const limit = this.spLimit();
            E.sp.textContent = String(sp);
            // Перелимит — только выход за максимум уровня игры. Запас героя
            // (skmap.pts) ниже этого максимума — норма, а не ошибка билда.
            E.sp.classList.toggle('over', sp > limit);
            const heroPts = +(V.pts || (this.hero && this.hero.pts) || 0);
            E.spNote.textContent = `/ ${limit}${heroPts > 0 ? ` · у героя: ${heroPts}` : ''}`;
            E.sp.title = `План: ${sp} из ${limit} SP (максимум уровня игры)`
                + (heroPts > 0 ? ` · у героя сейчас ${heroPts} SP` : '');

            // Жёсткого лимита жетонов в планировщике НЕТ: остаток героя
            // (skmap.n) показываем рядом как справочный ориентир — точно так же,
            // как «у героя: N» у очков навыков. Поэтому .over здесь не ставим:
            // план дороже текущего запаса — не ошибка, а «докупить жетоны».
            const tok = this.tokensSpent(st);
            const heroTok = this.tokenBalance();
            E.tok.textContent = String(tok);
            E.tok.classList.remove('over');
            E.tokNote.textContent = `· у героя: ${heroTok}`;
            E.tok.title = 'Потрачено жетонов планом: ступени пассивных узлов + прокачка способностей Арены'
                + (heroTok > 0 ? ` · у героя сейчас ${heroTok} ⟡` : '');

            const list = this.savedBuilds[this._cls] || [];
            if (E.buildList) {
                E.buildList.innerHTML = '<option value="">— сохранённые билды —</option>'
                    + list.map((b, i) => `<option value="${i}">${this.esc(b.name)}</option>`).join('');
                E.buildList.value = (this._buildIndex !== null && list[this._buildIndex]) ? String(this._buildIndex) : '';
            }
            if (E.name && document.activeElement !== E.name) E.name.value = this._buildName || '';
        },

        /* ------------------------------------------------------------
         * SVG-карта созвездия
         * ---------------------------------------------------------- */
        /** Рёбра: открытая связь — яркая, доступная — пунктир, прочая — тусклая. */
        _mapEdges(st, C) {
            const P = C.map.P;
            const pt = (id) => id === 'hub' ? { x: 0, y: 0 } : P[id];
            let out = '';
            for (const e of (Array.isArray(C.map.E) ? C.map.E : [])) {
                if (!e || e.length < 2) continue;
                const a = e[0], b = e[1], bi = +e[2] || 0, q = e[3] === 'q';
                const A = pt(a), B = pt(b);
                if (!A || !B) continue;
                let state = '';
                if (q) state = this.questActive(st, b) ? ' on' : '';
                else if (this._isOpen(st, a) && this._isOpen(st, b)) state = ' on';
                else if ((this._isOpen(st, a) && this.canOpen(st, b)) || (this._isOpen(st, b) && this.canOpen(st, a))) state = ' avail';
                out += `<line class="lgu-skm-edge${state}${q ? ' q' : ''}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" style="--bc:${this.branchColor(bi)}"></line>`;
            }
            return out;
        },

        /** Центр: подсвечен, когда открыто >= classOpen узлов класса.
         *  classOpen — порог (а не лимит очков), поэтому после порога
         *  вместо дроби «5/3» рисуем «✦»: перебора здесь быть не может. */
        _mapHub(st, C, V) {
            const classOpen = +(V.classOpen || 0);
            const opened = this.openedCount(st);
            const on = classOpen > 0 && opened >= classOpen;
            const label = on ? '✦' : `${opened}/${classOpen || '—'}`;
            return `<g class="lgu-skm-hub${on ? ' on' : ''}${this._sel === 'hub' ? ' sel' : ''}" data-hub="1" style="--c:${this.esc(C.color || '#ffd24a')}">
                    <circle r="36"></circle>
                    ${this._iconMarkup(this.CLASS_ICONS[this._cls] || 'diam', 40)}
                    <text class="lgu-skm-hubcnt" y="60" text-anchor="middle">${label}</text>
                </g>`;
        },

        /** Узлы: круги пассивов, ромбы способностей, капсулы молний. */
        _mapNodes(st, C) {
            const P = C.map.P;
            let out = '';
            for (const [id, o] of Object.entries(P)) {
                if (!o) continue;
                const x = +o.x, y = +o.y;
                if (!isFinite(x) || !isFinite(y)) continue;
                const bc = this.esc(this.branchColor(+o.bi || 0));

                if (o.q) {
                    const on = this.questActive(st, id);
                    const qid = String(o.q || id).replace(/^q:/, '');
                    const act = ((C.actions || []).find(a => a && a.id === qid)) || null;
                    out += `<g class="lgu-skm-q${on ? ' on' : ''}" data-q="${this.esc(qid)}" transform="translate(${x},${y})">
                        <title>${this.esc(act ? `⚡ ${act.name || act.word || qid}: ${act.text || ''}` : '⚡ Умение похода')}</title>
                        <rect x="-16" y="-14" width="32" height="28" rx="14"></rect>
                        <text y="6" text-anchor="middle">⚡</text>
                    </g>`;
                    continue;
                }

                if (o.ab) {
                    const key = id;
                    const meta = this.abOf(key) || {};
                    const opened = !!st.abilities[key];
                    const equipped = st.eq.ab === key || st.eq.ult === key;
                    const can = this.canOpen(st, key);
                    const kind = key.split(':')[1];
                    const lv = opened ? ((st.up[key] && st.up[key].lv) || 1) : 0;
                    out += `<g class="lgu-skm-ab${opened ? ' has' : ''}${equipped ? ' eq' : ''}${can ? ' can' : ''}${this._sel === key ? ' sel' : ''}" data-ab="${this.esc(key)}" transform="translate(${x},${y})" style="--bc:${bc}">
                        <title>${this.esc(`${meta.name || key} · ${kind === 'ab' ? 'способность (3-й ход)' : 'ульта (5-й ход)'}`)}</title>
                        <rect class="shape" x="-21" y="-21" width="42" height="42" rx="7" transform="rotate(45)"></rect>
                        <text class="glyph" y="7" text-anchor="middle">${this.esc(meta.icon || (kind === 'ult' ? '★' : '◆'))}</text>
                        ${opened ? `<text class="badge" y="38" text-anchor="middle">${lv}</text>` : ''}
                    </g>`;
                    continue;
                }

                const node = this.nodeOf(id);
                if (!node) continue;
                const max = Math.max(1, +node.max || 1);
                const rank = Math.min(max, +st.nodes[id] || 0);
                const can = !rank && this.canOpen(st, id);
                const branch = this.branchOf(id);
                const cap = node.kind === 'cap';
                const rr = cap ? 28 : 24;
                out += `<g class="lgu-skm-node${rank ? ' has' : ''}${can ? ' can' : ''}${cap ? ' cap' : ''}${this._sel === id ? ' sel' : ''}" data-node="${this.esc(id)}" transform="translate(${x},${y})" style="--bc:${bc}">
                    <title>${this.esc(`${node.name}${rank ? ` · ${rank}/${max}` : ''}`)}</title>
                    <circle r="${rr}"></circle>
                    ${this._iconMarkup(this.iconKeyOf(node, branch), cap ? 28 : 24)}
                    <text class="rank" y="${rr + 15}" text-anchor="middle">${rank}/${max}</text>
                </g>`;
            }
            return out;
        },

        /** Подписи веток на радиусе R = 450, углы [-90, 30, 150]. */
        _mapLabels(st, C) {
            const ANG = [-90, 30, 150];
            let out = '';
            (C.branches || []).slice(0, 3).forEach((B, bi) => {
                const a = ANG[bi] * Math.PI / 180;
                const x = Math.round(Math.cos(a) * 450);
                const y = Math.round(Math.sin(a) * 450 + (Math.sin(a) < 0 ? -62 : 62));
                const total = (B.nodes || []).length;
                const done = (B.nodes || []).filter(n => this._isOpen(st, n.id)).length;
                out += `<g class="lgu-skm-blab" transform="translate(${x},${y})" style="--bc:${this.esc(this.branchColor(bi))}">
                    <text text-anchor="middle"><tspan class="nm">${this.esc(B.name || B.id)}</tspan><tspan class="cnt" x="0" dy="18">${done}/${total}</tspan></text>
                </g>`;
            });
            return out;
        },

        renderMap() {
            const world = this._els.world;
            if (!world) return;
            const C = this.clsData();
            if (!C || !C.map || !C.map.P) {
                world.innerHTML = '<text class="lgu-skm-wait bad" x="0" y="0" text-anchor="middle">Карта этого класса пока не готова</text>';
                return;
            }
            const st = this.state();
            const V = this.skmapCache[this._cls] || {};
            world.innerHTML = this._mapEdges(st, C)
                + this._mapHub(st, C, V)
                + this._mapNodes(st, C)
                + this._mapLabels(st, C);
            this._applyView();
        },

        /* ------------------------------------------------------------
         * Зум/пан карты
         * ---------------------------------------------------------- */
        _applyView() {
            const world = this._els.world;
            if (!world) return;
            const v = this._view;
            world.setAttribute('transform', `translate(${v.x.toFixed(2)} ${v.y.toFixed(2)}) scale(${v.s.toFixed(4)})`);
        },

        resetView() {
            this._view = { s: 1, x: 0, y: 0 };
            this._applyView();
        },

        /** Координаты курсора -> система viewBox (с учётом текущего transform). */
        _toWorld(clientX, clientY) {
            const svg = this._els.svg;
            if (!svg || typeof svg.createSVGPoint !== 'function') return { x: 0, y: 0 };
            const pt = svg.createSVGPoint();
            pt.x = clientX;
            pt.y = clientY;
            const m = svg.getScreenCTM();
            if (!m) return { x: 0, y: 0 };
            const p = pt.matrixTransform(m.inverse());
            return { x: (p.x - this._view.x) / this._view.s, y: (p.y - this._view.y) / this._view.s };
        },

        zoomAt(factor, clientX, clientY) {
            const svg = this._els.svg;
            if (!svg) return;
            let cx = clientX, cy = clientY;
            if (cx == null || cy == null) {
                const r = svg.getBoundingClientRect();
                cx = r.left + r.width / 2;
                cy = r.top + r.height / 2;
            }
            const p = this._toWorld(cx, cy);
            const s0 = this._view.s;
            const s1 = Math.min(3, Math.max(0.35, s0 * factor));
            this._view.x += p.x * (s0 - s1);
            this._view.y += p.y * (s0 - s1);
            this._view.s = s1;
            this._applyView();
        },

        _wireMap() {
            const map = this._els.map;
            if (!map || map.__lguSkmWired) return;
            map.__lguSkmWired = true;

            map.addEventListener('wheel', (e) => {
                // Зум колесом — ТОЛЬКО над самой картой созвездия. Над кнопками
                // масштаба и вне SVG колесо не перехватываем: там оно должно
                // прокручивать вкладку к «Навыкам Арены» и сводке статов.
                if (!e.deltaY) return;
                if (e.target.closest && e.target.closest('.lgu-skm-zoom')) return;
                const svg = this._els.svg;
                if (!svg || (e.target !== svg && !(e.target.closest && e.target.closest('#lgu-skm-svg')))) return;
                e.preventDefault();
                this.zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY);
            }, { passive: false });

            map.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                if (e.target.closest && e.target.closest('[data-node],[data-ab],[data-hub],button')) return;
                const r = this._els.svg.getBoundingClientRect();
                this._pan = {
                    id: e.pointerId, x: e.clientX, y: e.clientY,
                    vx: this._view.x, vy: this._view.y, s: this._view.s,
                    k: (Math.min(r.width, r.height) / 1200) || 1
                };
                map.classList.add('dragging');
                try { map.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
            });

            map.addEventListener('pointermove', (e) => {
                const p = this._pan;
                if (!p || p.id !== e.pointerId) return;
                this._view.x = p.vx + (e.clientX - p.x) / (p.k * p.s);
                this._view.y = p.vy + (e.clientY - p.y) / (p.k * p.s);
                this._applyView();
            });

            const stopPan = (e) => {
                if (!this._pan || this._pan.id !== e.pointerId) return;
                this._pan = null;
                map.classList.remove('dragging');
                try { map.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
            };
            map.addEventListener('pointerup', stopPan);
            map.addEventListener('pointercancel', stopPan);
        },

        /* ------------------------------------------------------------
         * Делегирование событий внутри оболочки
         * ---------------------------------------------------------- */
        _wire() {
            const root = this._root;
            if (!root || root.__lguSkmWired) return;
            root.__lguSkmWired = true;

            root.addEventListener('click', (e) => {
                const t = e.target;
                if (!t || !t.closest) return;

                const clsBtn = t.closest('[data-class]');
                if (clsBtn) { this.selectClass(clsBtn.dataset.class); return; }
                if (t.closest('[data-tab="gear"]')) {
                    this._tab = 'gear';
                    this.renderSidebar();
                    this._updateVisibility();
                    this.renderGear();
                    return;
                }

                const act = t.closest('[data-act]');
                if (act) { this._onAction(act.dataset.act, act.dataset); return; }
                if (t.closest('.lgu-skm-inspector')) return;

                const ab = t.closest('[data-ab]');
                if (ab) { this._onAbilityClick(ab.dataset.ab); return; }
                const nd = t.closest('[data-node]');
                if (nd) { this._onNodeClick(nd.dataset.node); return; }
                if (t.closest('[data-hub]')) {
                    this._sel = this._sel === 'hub' ? null : 'hub';
                    this.renderMap();
                    this.renderInspector();
                    return;
                }
                if (t.closest('.lgu-skm-map')) {
                    this._sel = null;
                    this.renderMap();
                    this.renderInspector();
                }
            });

            root.addEventListener('contextmenu', (e) => {
                const t = e.target;
                const unit = t && t.closest && t.closest('[data-ab],[data-node]');
                if (!unit) return;
                e.preventDefault();
                this._closeUnit(unit.dataset.ab || unit.dataset.node);
            });

            root.addEventListener('change', (e) => {
                const t = e.target;
                if (!t || !t.dataset) return;
                if (t.dataset.build === 'select') { this.loadBuild(+t.value); return; }
                if (t.dataset.eqSlot) {
                    const slot = t.dataset.eqSlot;
                    const st = this.state();
                    const key = t.value || '';
                    st.eq[slot] = (key && st.abilities[key]) ? key : '';
                    this.renderMap();
                    this.renderArena();
                    this.renderInspector();
                }
            });

            root.addEventListener('input', (e) => {
                const t = e.target;
                if (t && t.id === 'lgu-skm-build-name') this._buildName = t.value;
            });

            root.addEventListener('mouseover', (e) => {
                const t = e.target;
                if (!t || !t.closest || t.closest('.lgu-skm-inspector')) return;
                const u = t.closest('[data-node],[data-ab],[data-hub]');
                if (!u) return;
                const id = u.dataset.node || u.dataset.ab || (u.dataset.hub ? 'hub' : '');
                if (!id || this._hover === id) return;
                this._hover = id;
                this.renderInspector();
            });

            root.addEventListener('mouseout', (e) => {
                const t = e.target;
                if (!t || !t.closest) return;
                const u = t.closest('[data-node],[data-ab],[data-hub]');
                if (!u) return;
                if (e.relatedTarget && u.contains(e.relatedTarget)) return;
                const id = u.dataset.node || u.dataset.ab || (u.dataset.hub ? 'hub' : '');
                if (this._hover === id) {
                    this._hover = null;
                    this.renderInspector();
                }
            });
        },

        _onAction(act, ds) {
            switch (act) {
                case 'zoom-in': this.zoomAt(1.2); break;
                case 'zoom-out': this.zoomAt(1 / 1.2); break;
                case 'zoom-reset': this.resetView(); break;
                case 'plus': this._openOrStep(ds.id); break;
                case 'minus': this._closeUnit(ds.id); break;
                case 'equip': this._equip(ds.id); break;
                case 'sel-clear': this._sel = null; this.renderMap(); this.renderInspector(); break;
                case 'save': this.saveCurrentBuild(this._cls, this._buildName); break;
                case 'delete': this.deleteSelectedBuild(); break;
                case 'share': this.shareBuild(this._cls); break;
                case 'import': this.importBuild(); break;
                case 'reset': this.resetSandbox(); break;
                case 'load-game': this.loadFromGame(null); break;
                case 'load-set': this.loadFromGame(+ds.i); break;
                case 'up-plus': this._bumpUp(ds.key, ds.kind, 1); break;
                case 'up-minus': this._bumpUp(ds.key, ds.kind, -1); break;
                default: break;
            }
        },

        _onNodeClick(id) {
            const o = this.mapP()[id];
            if (!o || o.q) return;
            this._sel = id;
            this._openOrStep(id);
        },

        _onAbilityClick(key) {
            const st = this.state();
            this._sel = key;
            if (!this._isOpen(st, key)) this._openAbility(key);
            else this._equip(key);
        },

        /** ЛКМ по узлу: закрытый — открыть (1 SP), открытый — ступень (+1 ⟡). */
        _openOrStep(id) {
            const st = this.state();
            const o = this.mapP()[id];
            if (!o || o.q) return;
            if (o.ab) { this._openAbility(id); return; }
            const node = this.nodeOf(id);
            if (!node) return;
            const max = Math.max(1, +node.max || 1);
            const rank = +st.nodes[id] || 0;

            if (rank <= 0) {
                if (this.spFree(st) <= 0) {
                    UI.showToast('Свободных очков навыков нет', true);
                    this.renderInspector();
                    return;
                }
                if (!this.nbrs(id).some(nb => this._isOpen(st, nb))) {
                    UI.showToast('Узел не соединён с открытым — начните с соседнего', true);
                    this.renderInspector();
                    return;
                }
                st.nodes[id] = 1;
            } else if (rank < max) {
                const cost = this.stepCost(rank);
                if (this.tokensSpent(st) + cost > this.tokenBalance()) {
                    UI.showToast(`План превышает баланс жетонов: +${cost} ⟡`, true);
                }
                st.nodes[id] = rank + 1;
            } else {
                UI.showToast('Узел уже на максимуме');
                this.renderInspector();
                return;
            }
            this.renderAll();
        },

        /** Открытие ромба способности Арены (1 SP) + автогнездо. */
        _openAbility(key) {
            const st = this.state();
            if (this._isOpen(st, key)) return;
            if (this.spFree(st) <= 0) {
                UI.showToast('Свободных очков навыков нет', true);
                this.renderInspector();
                return;
            }
            if (!this.nbrs(key).some(nb => this._isOpen(st, nb))) {
                UI.showToast('Способность не соединена с открытым узлом', true);
                this.renderInspector();
                return;
            }
            st.abilities[key] = 1;
            const kind = String(key).split(':')[1];
            const meta = this.abOf(key);
            if ((kind === 'ab' || kind === 'ult') && !st.eq[kind]) st.eq[kind] = key;
            if (!st.up[key]) st.up[key] = this._normUp(meta && meta.up);
            this.renderAll();
        },

        _equip(key) {
            const st = this.state();
            if (!st.abilities[key]) return;
            const kind = String(key).split(':')[1];
            if (kind !== 'ab' && kind !== 'ult') return;
            st.eq[kind] = st.eq[kind] === key ? '' : key;
            this.renderMap();
            this.renderArena();
            this.renderInspector();
        },

        /** ПКМ / «−»: ступень вниз, а с rank 1 — закрытие с проверкой связности. */
        _closeUnit(id) {
            const st = this.state();
            const o = this.mapP()[id];
            if (!o || o.q) return;
            if (o.ab) {
                if (!st.abilities[id]) return;
                if (!this._canRemove(st, id)) {
                    UI.showToast('Нельзя закрыть: останутся узлы без связи с центром', true);
                    return;
                }
                delete st.abilities[id];
                if (st.eq.ab === id) st.eq.ab = '';
                if (st.eq.ult === id) st.eq.ult = '';
                this.renderAll();
                return;
            }
            const rank = +st.nodes[id] || 0;
            if (!rank) return;
            if (rank > 1) { st.nodes[id] = rank - 1; this.renderAll(); return; }
            if (!this._canRemove(st, id)) {
                UI.showToast('Нельзя закрыть: останутся узлы без связи с центром', true);
                return;
            }
            delete st.nodes[id];
            this.renderAll();
        },

        _bumpUp(key, kind, delta) {
            const st = this.state();
            if (!st.abilities[key] || !kind) return;
            const max = this.abMax(kind);
            const meta = this.abOf(key);
            const u = st.up[key] || (st.up[key] = this._normUp(meta && meta.up));
            const cur = +u[kind] || 0;
            const floor = kind === 'lv' ? 1 : 0;
            const next = Math.max(floor, Math.min(max, cur + delta));
            if (next === cur) return;
            if (delta > 0) {
                const cost = this._stepUpCost(key, kind, cur);
                UI.showToast(`⟡ ${cost} — шаг плана (жетоны не тратятся)`);
            }
            u[kind] = next;
            this.renderArena();
            this.renderBar();
            this.renderSummary();
        },

        resetSandbox() {
            const cls = this._cls;
            if (!cls) return;
            this.sandbox[cls] = this._blankState();
            if (this.skmapCache[cls]) this.loadFromGame(null, true);
            this._sel = null;
            this._buildIndex = null;
            this._buildName = '';
            this.renderAll();
            UI.showToast('⟲ План сброшен к состоянию игры');
        },

        /* ------------------------------------------------------------
         * Инспектор узла/способности/центра
         * ---------------------------------------------------------- */
        renderInspector() {
            const el = this._els.insp;
            if (!el) return;
            const id = this._sel || this._hover;
            const C = this.clsData();
            const st = this.state();
            const V = this.skmapCache[this._cls] || {};
            const head = (title, sub) => `<div class="lgu-skm-ins-head"><b>${this.esc(title)}</b><small>${this.esc(sub || '')}</small>${this._sel ? '<button type="button" class="lgu-skm-ins-x" data-act="sel-clear" aria-label="Закрыть">✕</button>' : ''}</div>`;

            if (!id) {
                el.innerHTML = `<div class="lgu-skm-hint">
                    <b>Как читать созвездие</b>
                    <p><i class="dot"></i>Круг — пассивный навык: работает и в походе, и на Арене.</p>
                    <p><i class="diamond"></i>Ромб — способность Арены (3-й или 5-й ход).</p>
                    <p><i class="bolt">⚡</i>Молния — умение похода у узла-хозяина.</p>
                    <p>ЛКМ — открыть/усилить, ПКМ — ступень вниз или закрыть.</p>
                    <p class="muted">Изменения в игру не отправляются.</p>
                </div>`;
                return;
            }

            if (id === 'hub') {
                const act = ((C && C.actions) || []).find(a => a && a.unlock && a.unlock.mastery != null) || null;
                const need = +(V.classOpen || 0);
                const opened = this.openedCount(st);
                const on = need > 0 && opened >= need;
                // classOpen — порог открытия, лимита очков в игре нет, поэтому
                // после порога показываем «открыто», а не дробь «5/3».
                const progress = on
                    ? `Порог ${need} пройден · открыто узлов: <b>${opened}</b>`
                    : `Прогресс: <b>${opened}</b> / ${need || '—'}`;
                el.innerHTML = `<div class="lgu-skm-ins hub">
                    ${head(this.classNames[this._cls] || (C && C.name) || this._cls, 'Центральное умение класса')}
                    <div class="lgu-skm-ins-kind">${on ? '✅ умение открыто' : `🔒 нужно открытых узлов: ${need || '—'}`}</div>
                    <div class="lgu-skm-ins-rank">${progress}</div>
                    <p class="lgu-skm-ins-fx">${this.esc(act ? (act.text || '') : 'Умение класса открывается по мере изучения созвездия.')}</p>
                    ${(act && need > 0) ? `<div class="lgu-skm-ins-cost">Стоимость: <b>бесплатно</b> после ${need} узлов</div>` : ''}
                </div>`;
                return;
            }

            const o = this.mapP()[id];
            if (!o) {
                el.innerHTML = `<div class="lgu-skm-ins">${head('Узел не найден', 'Карта класса обновилась')}</div>`;
                return;
            }

            if (o.q) {
                const qid = String(o.q || id).replace(/^q:/, '');
                const act = ((C && C.actions) || []).find(a => a && a.id === qid) || null;
                const on = this.questActive(st, id);
                const host = (this.mapP()[id] || {}).host;
                const hostNode = host ? this.nodeOf(host) : null;
                el.innerHTML = `<div class="lgu-skm-ins q">
                    ${head(act ? `⚡ ${act.name || act.word || qid}` : `⚡ ${qid}`, 'Умение похода')}
                    <div class="lgu-skm-ins-kind">${on ? 'Активно' : 'Не активно'}${hostNode ? ` · хозяин: ${this.esc(hostNode.name)}` : ''}</div>
                    <p class="lgu-skm-ins-fx">${this.esc(act ? (act.text || '') : 'Дополнительное действие героя в походе.')}</p>
                    <p class="lgu-skm-ins-next">Молния загорается автоматически, когда открыт узел-хозяин.</p>
                </div>`;
                return;
            }

            if (o.ab) {
                const kind = String(id).split(':')[1];
                const meta = this.abOf(id) || {};
                const bi = this.branchIndex(String(id).split(':')[0]);
                const bc = this.branchColor(bi);
                const opened = !!st.abilities[id];
                const equipped = st.eq[kind] === id;
                const can = this.canOpen(st, id);
                const up = st.up[id] || this._normUp(meta.up);
                const max = this.abMax('lv');
                const lvl = Math.min(max, +up.lv || 1);
                const costNext = opened && lvl < max ? this._stepUpCost(id, 'lv', lvl) : 0;
                const need = kind === 'ult' ? +(V.ab && V.ab.ultLvl) : +(V.ab && V.ab.abLvl);
                const heroLvl = +(V.lvl || 0);
                const nodeList = (meta.nodes && typeof meta.nodes === 'object')
                    ? `<ul class="lgu-skm-ins-nodes">${this.ARENA_KINDS.map(([k, label]) => `<li><span>${label}</span><b>${this.esc(meta.nodes[k] || '—')}</b></li>`).join('')}</ul>`
                    : '';
                el.innerHTML = `<div class="lgu-skm-ins ab" style="--bc:${bc}">
                    ${head(meta.name || id, kind === 'ab' ? 'Способность · 3-й ход' : 'Ульта · 5-й ход')}
                    <div class="lgu-skm-ins-kind">Ромб · ${opened ? `ступень ${lvl}` : 'не открыта'}${equipped ? ' · в гнезде' : ''}</div>
                    <p class="lgu-skm-ins-fx">${this.esc(meta.text || 'Способность Арены.')}</p>
                    ${need && heroLvl && heroLvl < need ? `<p class="lgu-skm-ins-next warn">В бою сработает с ${need} уровня героя (сейчас ${heroLvl}).</p>` : ''}
                    ${nodeList}
                    <div class="lgu-skm-ins-cost">${opened ? (costNext ? `Ступень ${lvl + 1}: <b>${costNext} ⟡</b>` : 'Прокачка на максимуме') : 'Открыть: <b>1 SP</b>'}</div>
                    <div class="lgu-skm-ins-btns">
                        <button type="button" class="lgu-skm-btn main" data-act="plus" data-id="${this.esc(id)}"${(!opened && !can) ? ' disabled' : ''}>${opened ? '+' : 'Открыть'}</button>
                        <button type="button" class="lgu-skm-btn" data-act="equip" data-id="${this.esc(id)}"${opened ? '' : ' disabled'}>${equipped ? 'Убрать из гнезда' : 'В слот Арены'}</button>
                        <button type="button" class="lgu-skm-btn danger" data-act="minus" data-id="${this.esc(id)}"${opened ? '' : ' disabled'}>${opened ? '−' : 'Закрыть'}</button>
                    </div>
                    ${(!opened && !can) ? '<p class="lgu-skm-ins-next">Сначала откройте соседний узел, соединённый линией.</p>' : ''}
                </div>`;
                return;
            }

            const node = this.nodeOf(id);
            if (!node) {
                el.innerHTML = `<div class="lgu-skm-ins">${head('Узел не найден', 'Карта класса обновилась')}</div>`;
                return;
            }
            const branch = this.branchOf(id);
            const bi = branch ? (C.branches || []).indexOf(branch) : 0;
            const bc = this.branchColor(bi);
            const max = Math.max(1, +node.max || 1);
            const rank = Math.min(max, +st.nodes[id] || 0);
            const can = !rank && this.canOpen(st, id);
            const curText = this.formatNodeText(node, Math.max(1, rank));
            const nextText = rank < max ? this.formatNodeText(node, rank + 1) : '';
            const noSp = !rank && this.spFree(st) <= 0;
            el.innerHTML = `<div class="lgu-skm-ins nd" style="--bc:${bc}">
                ${head(node.name || id, branch ? branch.name : 'Ветка')}
                <div class="lgu-skm-ins-kind">Круг · пассивный навык${node.kind === 'cap' ? ' · вершина ветки' : ''}</div>
                <div class="lgu-skm-ins-rank">Ступень <b>${rank}</b> из ${max}</div>
                <p class="lgu-skm-ins-fx">${this.esc(curText || 'Постоянный бонус героя.')}</p>
                ${(nextText && nextText !== curText) ? `<p class="lgu-skm-ins-next">Следующая ступень: ${this.esc(nextText)}</p>` : ''}
                <div class="lgu-skm-ins-cost">${rank ? (rank < max ? `Ступень ${rank + 1}: <b>${this.stepCost(rank)} ⟡</b>` : 'Максимальная ступень') : 'Открыть: <b>1 SP</b>'}</div>
                <div class="lgu-skm-ins-btns">
                    <button type="button" class="lgu-skm-btn main" data-act="plus" data-id="${this.esc(id)}"${(!rank && (!can || noSp)) || rank >= max ? ' disabled' : ''}>${rank ? '+' : 'Открыть'}</button>
                    <button type="button" class="lgu-skm-btn danger" data-act="minus" data-id="${this.esc(id)}"${rank ? '' : ' disabled'}>${rank > 1 ? '−' : 'Закрыть'}</button>
                </div>
                ${(!rank && !can) ? '<p class="lgu-skm-ins-next">Сначала откройте соседний узел, соединённый линией.</p>' : ''}
                ${noSp ? '<p class="lgu-skm-ins-next warn">Свободных очков навыков нет.</p>' : ''}
            </div>`;
        },

        /* ------------------------------------------------------------
         * Блок «Навыки Арены»: два гнезда + прокачка параметров
         * ---------------------------------------------------------- */
        renderArena() {
            const el = this._els.arena;
            if (!el) return;
            const st = this.state();
            const V = this.skmapCache[this._cls] || {};
            const keys = Object.keys(st.abilities || {}).filter(k => st.abilities[k]);
            const byKind = (kind) => keys.filter(k => k.slice(-(kind.length + 1)) === ':' + kind);

            const options = (kind) => '<option value="">— пусто —</option>' + byKind(kind).map((k) => {
                const m = this.abOf(k) || {};
                return `<option value="${this.esc(k)}"${st.eq[kind] === k ? ' selected' : ''}>${this.esc(m.name || k)}</option>`;
            }).join('');

            const slot = (kind) => {
                const key = st.eq[kind] || '';
                const meta = key ? (this.abOf(key) || {}) : null;
                const up = key ? (st.up[key] || this._normUp(meta && meta.up)) : null;
                const bc = key ? this.branchColor(this.branchIndex(key.split(':')[0])) : '#6b6478';
                return `<div class="lgu-skm-slot${key ? '' : ' empty'}" style="--bc:${bc}">
                    <span class="lgu-skm-slot-k">${kind === 'ab' ? 'Способность (3-й ход)' : 'Ульта (5-й ход)'}</span>
                    <select data-eq-slot="${kind}" aria-label="${kind === 'ab' ? 'Способность 3-го хода' : 'Ульта 5-го хода'}">${options(kind)}</select>
                    <div class="lgu-skm-slot-meta">${key
                        ? `<b>${this.esc(meta.name || key)}</b>${up ? `<em>Ступень ${up.lv} · Мощь ${up.pow} · Эффект ${up.eff} · Длит. ${up.dur}</em>` : ''}`
                        : '<small>Гнездо пусто — откройте ромб на карте.</small>'}</div>
                </div>`;
            };

            let ups = '';
            for (const key of keys) {
                const meta = this.abOf(key) || {};
                if (!st.up[key]) st.up[key] = this._normUp(meta.up);
                const u = st.up[key];
                const kind = key.split(':')[1];
                const rows = this.ARENA_KINDS.map(([k, label]) => {
                    const max = this.abMax(k);
                    const val = +u[k] || 0;
                    const cost = val < max ? this._stepUpCost(key, k, val) : 0;
                    const floor = k === 'lv' ? 1 : 0;
                    return `<div class="lgu-skm-up-row">
                        <span>${label}</span>
                        <button type="button" class="lgu-skm-mini" data-act="up-minus" data-key="${this.esc(key)}" data-kind="${k}"${val <= floor ? ' disabled' : ''} aria-label="Уменьшить ${label}">−</button>
                        <b>${val}</b><small>/ ${max}</small>
                        <button type="button" class="lgu-skm-mini" data-act="up-plus" data-key="${this.esc(key)}" data-kind="${k}"${val >= max ? ' disabled' : ''} aria-label="Увеличить ${label}">+</button>
                        <em>${cost ? cost + ' ⟡' : '—'}</em>
                    </div>`;
                }).join('');
                ups += `<details class="lgu-skm-up"${(st.eq.ab === key || st.eq.ult === key) ? ' open' : ''}>
                    <summary>${this.esc(meta.name || key)} <small>${kind === 'ab' ? '3-й ход' : '5-й ход'}</small></summary>
                    <div class="lgu-skm-up-rows">${rows}</div>
                </details>`;
            }

            const sets = (V.st && Array.isArray(V.st.s)) ? V.st.s : [];
            const setBtns = sets.slice(0, 3).map((s, i) => {
                const nm = (s && s.nm) || ('Набор ' + (i + 1));
                const eq = (s && s.eq) || {};
                const tip = [eq.ab ? (this.abOf(eq.ab) || {}).name : '', eq.ult ? (this.abOf(eq.ult) || {}).name : '']
                    .filter(Boolean).join(' + ') || 'набор пуст';
                return `<button type="button" class="lgu-skm-loadbtn" data-act="load-set" data-i="${i}" title="${this.esc(tip)}">${this.esc(nm)}</button>`;
            }).join('');

            const tok = this.tokensSpent(st);
            el.innerHTML = `<div class="lgu-skm-arena-head">
                    <b>Навыки Арены</b>
                    <span>Потрачено жетонов: <b>${tok}</b> ⟡</span>
                </div>
                <div class="lgu-skm-slots">${slot('ab')}${slot('ult')}</div>
                <div class="lgu-skm-ups">${ups || '<p class="lgu-skm-note">Открытых способностей Арены нет — откройте ромб на карте.</p>'}</div>
                <div class="lgu-skm-loads">
                    <button type="button" class="lgu-skm-loadbtn game" data-act="load-game">Из игры</button>
                    ${setBtns || '<small class="lgu-skm-note">Наборы игры недоступны</small>'}
                </div>`;
        },

        /* ------------------------------------------------------------
         * Сводка «Что дают открытые навыки» (аналог statList() из skillmap.js)
         * ---------------------------------------------------------- */
        statList() {
            const C = this.clsData();
            if (!C) return [];
            const st = this.state();
            const map = new Map();
            const out = [];
            (C.branches || []).forEach((B, bi) => {
                (B.nodes || []).forEach((n) => {
                    const r = Math.min(Math.max(1, +n.max || 1), +st.nodes[n.id] || 0);
                    if (!r) return;
                    const t = this.formatNodeText(n, r);
                    // «Физ. урон +15%» -> { label, sign, suf, v }
                    const m = /^([А-Яа-яЁё. ]{3,26}?) ?([+−-])(\d+(?:[.,]\d+)?)(%?)$/.exec(t);
                    if (m) {
                        const key = m[1].trim() + m[2] + m[4];
                        const v = parseFloat(m[3].replace(',', '.'));
                        const hit = map.get(key);
                        if (hit) { hit.v += v; hit.names.push(n.name); }
                        else {
                            const item = { label: m[1].trim(), sign: m[2] === '−' ? '−' : m[2], suf: m[4], v, color: this.branchColor(bi), names: [n.name] };
                            map.set(key, item);
                            out.push(item);
                        }
                        return;
                    }
                    // Фолбэк: структурированные fx узла (текст не распознан).
                    const fromFx = this.xstatFromFx();
                    for (const [fk, fv] of Object.entries(n.fx || {})) {
                        if (this.isSkipFx(fk) || !isFinite(+fv)) continue;
                        const pct = ['critDmg', 'skelN', 'skelT', 'def', 'resist', 'pierce'].indexOf(fk) < 0;
                        // resist/pierce: сырой fx -> стат через fromFx (0.5),
                        // иначе сводка удваивала значения (+60 вместо +30).
                        const scale = isFinite(+fromFx[fk]) ? +fromFx[fk] : 1;
                        const amount = (+fv) * r * scale;
                        const key = 'fx:' + fk;
                        const hit = map.get(key);
                        if (hit) { hit.v += amount; hit.names.push(n.name); }
                        else {
                            // v11.7.1: подписи fxNames без «%»/«+», но если
                            // живой ключ пришёл с хвостом знака — обрезаем его,
                            // чтобы не получить «Крит %%».
                            let rawLabel = String(this.fxNames[fk] || fk);
                            if (pct === true) rawLabel = rawLabel.replace(/\s*[%+]+$/, '').trim();
                            const item = { label: rawLabel, sign: '+', suf: pct ? '%' : '', v: amount, color: this.branchColor(bi), names: [n.name] };
                            map.set(key, item);
                            out.push(item);
                        }
                    }
                });
            });
            return out;
        },

        renderSummary() {
            const el = this._els.summary;
            if (!el) return;
            const list = this.statList();
            const V = this.skmapCache[this._cls] || {};
            const opened = this.openedCount();
            const need = +(V.classOpen || 0);
            const hubOn = need > 0 && opened >= need;
            const fmt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
            const body = list.length
                ? `<ul class="lgu-skm-stats">${list.map(x => `<li style="--bc:${x.color}" title="${this.esc(x.names.join(', '))}"><span>${this.esc(x.label)}</span><b>${x.sign}${fmt(x.v)}${x.suf}</b></li>`).join('')}</ul>`
                : '<p class="lgu-skm-note">Пока ничего не открыто.</p>';
            el.innerHTML = `<div class="lgu-skm-sum-head">
                    <b>Что дают открытые навыки</b>
                    <span>${hubOn ? '✅ умение класса открыто' : `до умения класса: ${Math.max(0, need - opened)} узл.`}</span>
                </div>${body}`;
        },

        /**
         * v11.7.0: числовые бонусы открытых узлов созвездия — для вкладки
         * «👗 Примерка» планировщика героя.
         *
         * statList() собирает ТЕКСТОВУЮ сводку («Физ. урон +15%»), а здесь
         * нужен агрегат в единицах характеристик героя:
         *   hp / def          — плоские значения (fx узла);
         *   atkPct / magPct   — проценты к физ./маг. урону (fx melee / magic);
         *   crit, critDmg, dodge, pierce, healPow, luck, resist — пункты.
         *
         * resist/pierce в fx лежат «сырыми», поэтому переводятся через
         * fromFx (обычно 0.5) — так же, как в игре и в примечаниях
         * formatNodeText(). Пропускаются служебные ключи (ctl_/act_/cd_).
         *
         * @returns {object|null} null — созвездие не загружено или пусто
         */
        skillBonuses() {
            const C = this.clsData();
            if (!C || !this._cls) return null;
            const st = this.state();
            const fromFx = this.xstatFromFx();
            // fx-ключ -> поле агрегата. Всё остальное (урон по боссам, залпы,
            // лечение и т.п.) на статы героя напрямую не влияет и опускается.
            const MAP = {
                melee: 'atkPct', magic: 'magPct', hp: 'hp', def: 'def',
                crit: 'crit', critDmg: 'critDmg', dodge: 'dodge', pierce: 'pierce',
                healPow: 'healPow', luck: 'luck', resist: 'resist'
            };
            const out = {
                hp: 0, def: 0, atkPct: 0, magPct: 0,
                crit: 0, critDmg: 0, dodge: 0, pierce: 0,
                healPow: 0, luck: 0, resist: 0
            };
            let any = false;
            (C.branches || []).forEach((B) => {
                (B.nodes || []).forEach((n) => {
                    const r = Math.min(Math.max(1, +n.max || 1), +st.nodes[n.id] || 0);
                    if (!r) return;
                    for (const [fk, fv] of Object.entries(n.fx || {})) {
                        const key = MAP[fk];
                        if (!key || this.isSkipFx(fk) || !isFinite(+fv)) continue;
                        const scale = isFinite(+fromFx[fk]) ? +fromFx[fk] : 1;
                        out[key] += (+fv) * r * scale;
                        any = true;
                    }
                });
            });
            return any ? out : null;
        },

        /* ------------------------------------------------------------
         * Вкладка «Экипировка» (статы героя + сравнение с сумкой)
         * ---------------------------------------------------------- */
        renderGear() {
            const el = this._els.gear;
            if (!el || this._tab !== 'gear') return;
            const h = this.hero;
            if (!h) { el.innerHTML = '<p class="lgu-skm-note">Данные героя не загружены.</p>'; return; }
            const items = Array.isArray(h.items) ? h.items : [];
            const equipped = items.filter(x => x && x.on && x.slot);
            const bag = items.filter(x => x && !x.on && x.slot);
            const statRows = Object.entries(h.stats || {}).map(([k, v]) => `<tr><td>${this.esc(this.statNames[k] || k)}</td><td>${this.esc(v)}</td></tr>`).join('');
            const bagRows = bag.map((item) => {
                const cur = equipped.find(x => x.slot === item.slot);
                const keys = new Set([].concat(Object.keys(item.stats || {}), Object.keys((cur && cur.stats) || {})));
                const changes = [];
                keys.forEach((k) => {
                    const nv = (item.stats && item.stats[k]) || 0;
                    const ov = (cur && cur.stats && cur.stats[k]) || 0;
                    if (nv === ov) return;
                    changes.push(`<div class="stat-line"><span>${this.esc(this.statNames[k] || k)}</span><b>${nv > ov ? '+' : ''}${nv - ov}</b></div>`);
                });
                return `<tr><td><b>${this.esc(item.name || '—')}</b><br><small>${this.esc(item.slot)}</small></td><td>${changes.join('') || '<span class="stat-eq">без изменений</span>'}</td></tr>`;
            }).join('');
            el.innerHTML = `<div class="lgu-skm-gear-col">
                    <h3>Текущие статы</h3>
                    <table><thead><tr><th>Параметр</th><th>Значение</th></tr></thead><tbody>${statRows || '<tr><td colspan="2">—</td></tr>'}</tbody></table>
                </div>
                <div class="lgu-skm-gear-col">
                    <h3>Сравнение с сумкой</h3>
                    <table><thead><tr><th>Вещь (слот)</th><th>Изменение статов</th></tr></thead><tbody>${bagRows || '<tr><td colspan="2">Сумка пуста</td></tr>'}</tbody></table>
                </div>`;
        },

        /* ------------------------------------------------------------
         * Пресеты билдов: GM_setValue / GM_getValue + мягкая миграция
         * со старого localStorage-ключа LEGION_SAVED_BUILDS.
         * ---------------------------------------------------------- */
        loadSavedBuilds() {
            if (this._savedLoaded) return;
            this._savedLoaded = true;
            let raw = null;
            try {
                raw = (typeof GM_getValue === 'function') ? GM_getValue(this.BUILD_KEY, '') : localStorage.getItem(this.BUILD_KEY);
            } catch (err) { dbg('[BUILD SIM] GM_getValue:', err); }
            if (!raw) {
                try { raw = localStorage.getItem(this.BUILD_KEY); } catch (err) { /* noop */ }
            }
            if (raw) {
                try {
                    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    const builds = (d && d.builds) ? d.builds : d;
                    if (builds && typeof builds === 'object' && !Array.isArray(builds)) this.savedBuilds = builds;
                } catch (err) { dbg('[BUILD SIM] разбор пресетов:', err); }
            } else {
                this._needLegacyMigration = true;
            }
        },

        _persistBuilds() {
            const payload = JSON.stringify({ v: 2, builds: this.savedBuilds });
            try {
                if (typeof GM_setValue === 'function') GM_setValue(this.BUILD_KEY, payload);
                else localStorage.setItem(this.BUILD_KEY, payload);
            } catch (err) {
                dbg('[BUILD SIM] сохранение пресетов:', err);
                try { localStorage.setItem(this.BUILD_KEY, payload); } catch (e) { /* noop */ }
            }
        },

        /**
         * Однократный перенос старых билдов { cls: [{ name, skills }] } из
         * localStorage в новый формат. Совпавшие nodeId переносятся, остальные
         * (старое дерево) отбрасываются; если не совпало ничего — тост.
         */
        _migrateLegacyBuilds() {
            let old = null;
            try { old = JSON.parse(localStorage.getItem(this.LEGACY_BUILD_KEY) || 'null'); } catch (err) { old = null; }
            if (!old || typeof old !== 'object' || Array.isArray(old)) return;
            let migrated = 0;
            let skipped = 0;
            for (const [cls, list] of Object.entries(old)) {
                if (!Array.isArray(list) || !this.clsData(cls)) continue;
                if (!this.savedBuilds[cls]) this.savedBuilds[cls] = [];
                for (const b of list) {
                    if (!b || !b.skills || typeof b.skills !== 'object') continue;
                    const nodes = {};
                    for (const [id, r] of Object.entries(b.skills)) {
                        const node = this.nodeOf(id, cls);
                        if (!node) continue;
                        const rank = Math.max(1, Math.min(Math.floor(+r) || 0, +node.max || 1));
                        if (rank > 0) nodes[id] = rank;
                    }
                    if (!Object.keys(nodes).length) { skipped++; continue; }
                    this.savedBuilds[cls].push({
                        name: b.name || 'Старый билд',
                        at: Date.now(),
                        legacy: true,
                        data: { nodes, abilities: {}, eq: { ab: '', ult: '' }, up: {} }
                    });
                    migrated++;
                }
            }
            this._persistBuilds();
            if (migrated) UI.showToast(`📦 Перенесено старых билдов: ${migrated}`);
            else if (skipped) UI.showToast('⚠ Старые билды несовместимы с новым деревом', true);
        },

        saveCurrentBuild(clsId, name) {
            const cls = clsId || this._cls;
            const nm = String(name == null ? '' : name).trim();
            if (!cls) return false;
            if (!nm) {
                UI.showToast('Введите название билда', true);
                return false;
            }
            const list = this.savedBuilds[cls] || (this.savedBuilds[cls] = []);
            const entry = { name: nm, at: Date.now(), data: this._snapshot(this.state(cls)) };
            const i = list.findIndex(b => b && b.name === nm);
            if (i >= 0) list[i] = entry;
            else list.push(entry);
            this._buildIndex = i >= 0 ? i : list.length - 1;
            this._buildName = nm;
            this._persistBuilds();
            this.renderBar();
            UI.showToast('💾 Билд сохранён');
            return true;
        },

        loadBuild(index) {
            const list = this.savedBuilds[this._cls] || [];
            const item = list[+index];
            if (!item) return false;
            this.sandbox[this._cls] = this._sanitizeBuild(this._cls, item.data);
            this._buildIndex = +index;
            this._buildName = item.name || '';
            this._sel = null;
            this.renderAll();
            UI.showToast(`📥 Билд «${item.name}» загружен`);
            return true;
        },

        deleteSelectedBuild() {
            const list = this.savedBuilds[this._cls] || [];
            if (this._buildIndex === null || !list[this._buildIndex]) {
                UI.showToast('Сначала выберите билд в списке', true);
                return;
            }
            const name = list[this._buildIndex].name;
            list.splice(this._buildIndex, 1);
            this._buildIndex = null;
            this._persistBuilds();
            this.renderBar();
            UI.showToast(`🗑️ Билд «${name}» удалён`);
        },

        /* ------------------------------------------------------------
         * Коды билдов: B2:<url-safe base64>
         * ---------------------------------------------------------- */
        _extractBuildCode(input) {
            const s = String(input == null ? '' : input).trim();
            const marker = '#build=';
            const i = s.indexOf(marker);
            const raw = i >= 0 ? s.slice(i + marker.length) : s;
            return raw.split('&')[0].trim();
        },

        _channel() {
            const m = String(API_BASE || '').match(/^\/c\/([^/]+)/);
            if (m) return m[1];
            const p = String(location.pathname || '').match(/^\/c\/([^/]+)/);
            if (p) return p[1];
            const u = G.ME && G.ME.user;
            return (u && (u.login || u.name)) || '';
        },

        encodeBuild(clsId) {
            const cls = clsId || this._cls;
            const st = this.state(cls);
            try {
                const payload = {
                    v: 2,
                    c: cls,
                    n: st.nodes || {},
                    a: st.abilities || {},
                    eq: { ab: (st.eq && st.eq.ab) || '', ult: (st.eq && st.eq.ult) || '' },
                    up: st.up || {}
                };
                const json = JSON.stringify(payload);
                return 'B2:' + btoa(encodeURIComponent(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            } catch (err) {
                dbg('[BUILD SIM] encodeBuild:', err);
                return '';
            }
        },

        _decodePayload(b64) {
            const s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/');
            const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
            const text = atob(s + pad);
            let json = text;
            try { json = decodeURIComponent(text); } catch (err) { /* старый формат без %-кодирования */ }
            return JSON.parse(json);
        },

        /**
         * Разбор кода билда:
         *   B2:<base64> — новый формат { v:2, c, n, a, eq, up };
         *   <base64>    — старый формат { cls, sk } (мягкая совместимость).
         * Возвращает id класса, в который применён билд, либо ''.
         */
        decodeBuild(code) {
            const raw = this._extractBuildCode(code);
            if (!raw) return '';
            let payload = null;
            let legacy = false;
            try {
                if (raw.slice(0, 3) === 'B2:') {
                    payload = this._decodePayload(raw.slice(3));
                } else {
                    const d = this._decodePayload(raw);
                    if (d && d.sk && typeof d.sk === 'object') {
                        legacy = true;
                        payload = { v: 1, c: d.cls || d.c || '', sk: d.sk };
                    }
                }
            } catch (err) {
                dbg('[BUILD SIM] decodeBuild:', err);
                payload = null;
            }
            if (!payload || typeof payload !== 'object') return '';

            const cls = String(payload.c || this._cls || '');
            if (!this.clsData(cls)) {
                UI.showToast('Код от неизвестного класса', true);
                return '';
            }

            let data;
            if (legacy) {
                const nodes = {};
                const all = Object.keys(payload.sk || {});
                let matched = 0;
                for (const id of all) {
                    const node = this.nodeOf(id, cls);
                    if (!node) continue;
                    nodes[id] = Math.max(1, Math.min(Math.floor(+payload.sk[id]) || 0, +node.max || 1));
                    matched++;
                }
                if (!matched) {
                    UI.showToast('Код от старого дерева несовместим с созвездием', true);
                    return '';
                }
                data = { nodes, abilities: {}, eq: { ab: '', ult: '' }, up: {} };
                if (matched < all.length) UI.showToast(`⚠ Перенесено узлов: ${matched} из ${all.length}`);
            } else {
                if (+payload.v !== 2) {
                    UI.showToast('Неподдерживаемая версия кода билда', true);
                    return '';
                }
                data = { nodes: payload.n, abilities: payload.a, eq: payload.eq, up: payload.up };
            }

            this.sandbox[cls] = this._sanitizeBuild(cls, data);
            this._cls = cls;
            this._buildIndex = null;
            this._buildName = '';
            this._sel = null;
            return cls;
        },

        shareBuild(clsId) {
            const code = this.encodeBuild(clsId);
            if (!code) {
                UI.showToast('Не удалось собрать код билда', true);
                return '';
            }
            const ch = this._channel();
            const url = `https://legiongame.gg/c/${ch}#build=${code}`;
            this._copy(url);
            return url;
        },

        _copy(text) {
            const value = String(text == null ? '' : text);
            const manual = () => window.prompt('Скопируйте ссылку на билд:', value);
            try {
                if (typeof GM_setClipboard === 'function') {
                    GM_setClipboard(value);
                    UI.showToast('📋 Ссылка на билд скопирована');
                    return;
                }
            } catch (err) { dbg('[BUILD SIM] GM_setClipboard:', err); }
            try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    navigator.clipboard.writeText(value)
                        .then(() => UI.showToast('📋 Ссылка на билд скопирована'), manual);
                    return;
                }
            } catch (err) { dbg('[BUILD SIM] clipboard:', err); }
            manual();
        },

        importBuild() {
            const code = window.prompt('Вставьте код билда (B2:…) или ссылку с #build=…', '');
            if (!code) return false;
            const cls = this.decodeBuild(code);
            if (!cls) {
                UI.showToast('❌ Неверный код билда', true);
                return false;
            }
            this._tab = 'map';
            this.selectClass(cls);
            UI.showToast('📥 Билд импортирован');
            return true;
        }
    };

    // ===== src/modules/hero-planner.js =====
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
        // v11.7.0: переключатель 📊/🧠 удалён — «Итоговая стоимость» всегда
        // ожидаемая, поэтому поле оставлено только для совместимости.
        strategyMode: 'expected', // 'ideal' | 'expected'
        // 11.6.5f: цель заточки (+N) для правой карточки Split-view.
        // null — не выбрана: берём следующий уровень (enchantTargetLevel).
        // Хранится в абсолютных уровнях (+1…+15); при смене предмета цель
        // не сбрасывается — просто зажимается в допустимый диапазон.
        targetLevel: null,
        // v11.7.1: уровень ПРОСМОТРА (0…15) отдельно от цели пути. Игрок может
        // посмотреть статы предмета на +0, +4, +7 и т.д., даже если текущая
        // заточка уже выше: тогда путь curEn -> previewLevel пустой (0 шагов).
        previewLevel: null,
        // v11.7.1: ручной ввод количества ресурсов убран — звёзды и сферы
        // теперь выбираются кнопками ⭐/🌐 в строках уровней, а расход
        // считается автоматически по пути curEn+1…previewLevel.
        userStars: 0,
        userSpheres: 0,
        allocatedStars: {},   // { lv: true }
        allocatedSpheres: {}, // { lv: true }

        // ── v11.7.0: вкладка «👗 Примерка» ───────────────────────
        // Пять слотов экипировки в порядке нативной карточки героя
        // (helmet, weapon, shield, armor, trinket).
        FITTING_SLOTS: [
            { id: 'helmet', name: 'Шлем', icon: '⛑' },
            { id: 'weapon', name: 'Оружие', icon: '⚔️' },
            { id: 'shield', name: 'Щит/оффхенд', icon: '🛡' },
            { id: 'armor', name: 'Броня', icon: '🥋' },
            { id: 'trinket', name: 'Амулет', icon: '📿' }
        ],
        /*
         * Веса боевой мощи (power): Σ stat[k] × POW[k] плюс +2 за каждый
         * уровень заточки надетых вещей — та же логика, что в карточке героя.
         */
        FIT_POW: { atk: 1, mag: 1, def: 1, hp: 0.25, crit: 0.8, critDmg: 0.2, dodge: 0.8, pierce: 0.8, healPow: 0.5, luck: 0.5, resist: 0.5 },
        /* Потолки вторичных характеристик (xstats.max из game-data.js). */
        FIT_CAPS: { crit: 50, critDmg: 200, dodge: 35, pierce: 75, healPow: 100, luck: 100 },
        /* Состояние примерки: моделируемый класс/уровень, флаг бонусов
           созвездия и выбор по слотам { slotId: { uid, en } }. */
        fitting: { role: '', level: 1, useSkills: false, slots: {} },

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

        /**
         * v11.7.1: уровень просмотра (0…15) для карточки «Заточка».
         *
         * В отличие от enchantTargetLevel НЕ зажимается вперёд текущей
         * заточки: игрок вправе посмотреть статы предмета на +0…+15.
         * Если уровень не выбран — берём цель пути (curEn + 1).
         *
         * @param {number} curEn текущая заточка предмета
         * @returns {number} уровень просмотра (0…15)
         */
        enchantPreviewLevel(curEn) {
            const max = this.ENCH.max;
            if (this.previewLevel == null) return this.enchantTargetLevel(curEn);
            const raw = Number(this.previewLevel);
            if (!Number.isFinite(raw)) return this.enchantTargetLevel(curEn);
            return Math.min(max, Math.max(0, Math.round(raw)));
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

        /* ---------------------------------------------------------- */
        /* v11.7.0: РАСЧЁТ «ПРИМЕРКИ» (вкладка 👗 Примерка)            */
        /* ---------------------------------------------------------- */

        /**
         * Базовые характеристики героя по уровню (1…50).
         *
         * Источник — живая таблица игры G.LGGameData.levelRow(lvl) (строка
         * уровней: hp/atk/mag/def). Если таблицы ещё нет (run-at
         * document-start, урезанная сборка), берём фолбэк аддона:
         *   hp = 15 + 5×lvl, atk/mag = ceil(lvl×0.42), def = floor(lvl×0.24).
         *
         * @param {number} level уровень героя
         * @returns {{hp:number, atk:number, mag:number, def:number}}
         */
        levelBaseStats(level) {
            const lvl = Math.min(50, Math.max(1, Math.round(+level || 1)));
            const fallback = {
                hp: 15 + 5 * lvl,
                atk: Math.ceil(lvl * 0.42),
                mag: Math.ceil(lvl * 0.42),
                def: Math.floor(lvl * 0.24)
            };
            let row = null;
            try {
                const gd = (typeof G !== 'undefined' && G) ? G.LGGameData : null;
                if (gd && typeof gd.levelRow === 'function') row = gd.levelRow(lvl);
            } catch (e) { row = null; }
            // Формат строки уровня может отличаться — берём только числовые
            // поля объекта, всё остальное закрывает фолбэк.
            const pick = (k) => {
                const v = (row && !Array.isArray(row)) ? +row[k] : NaN;
                return (Number.isFinite(v) && v > 0) ? v : fallback[k];
            };
            return { hp: pick('hp'), atk: pick('atk'), mag: pick('mag'), def: pick('def') };
        },

        /**
         * Статы предмета на +0 (без заточки).
         *
         * Приоритет — stats0 из /api/me (точные базы игры). Если его нет —
         * обратный вычет заточки: xstat-ы (crit, dodge, pierce…) теряют
         * ¼ бонуса, поэтому считаем через enchantBase, а не общим делителем.
         *
         * @param {object} item предмет из /api/me
         * @param {number} [curEn] текущая заточка (по умолчанию item.en)
         * @returns {object} { statKey: baseValue }
         */
        itemBaseStats(item, curEn) {
            if (!item) return {};
            if (item.stats0 && Object.keys(item.stats0).length) return item.stats0;
            const en = (curEn === undefined)
                ? +(item.en ?? item.e ?? item.enchant ?? 0)
                : curEn;
            const out = {};
            for (const [k, v] of Object.entries(item.stats || {})) {
                out[k] = this.enchantBase(+v || 0, en, k);
            }
            return out;
        },

        /**
         * Текущие характеристики героя из /api/me: первичные лежат в
         * hero.stats, вторичные — в hero.xs. Мощь считается той же формулой,
         * что и у примерки (Σ × POW + 2 за уровень заточки), иначе сравнение
         * «Было → Стало» было бы нечестным.
         *
         * @param {object} h hero из /api/me
         * @returns {{stats:object, power:number, penalty:number, parts:Array, critMul:number, enTotal:number}}
         */
        heroCurrentStats(h) {
            const items = (h && Array.isArray(h.items)) ? h.items.filter(x => x && x.on) : [];
            const src = Object.assign({}, (h && h.stats) || {}, (h && h.xs) || {});
            const stats = {};
            for (const k of Object.keys(this.FIT_POW)) {
                const v = +src[k];
                stats[k] = Number.isFinite(v) ? Math.round(v) : 0;
            }
            let enTotal = 0;
            for (const it of items) enTotal += Math.min(15, Math.max(0, Math.round(+(it.en ?? it.e ?? 0))));
            let power = 0;
            for (const [k, w] of Object.entries(this.FIT_POW)) power += (stats[k] || 0) * w;
            const gp = this.gearPenaltyTotal(h && h.role, items);
            return {
                stats,
                power: Math.round(power + 2 * enTotal),
                penalty: gp.pct,
                parts: gp.parts,
                critMul: 1 + (stats.critDmg || 0) / 100,
                enTotal
            };
        },

        /**
         * Точный расчёт характеристик «примерки»: база уровня + 5 предметов
         * на выбранной заточке + бонусы созвездия − штраф экипировки.
         *
         * Формулы (совпадают с игрой, app.js:1393 enchStatsN):
         *  - первичные статы предмета: round(base × (1 + bonus/100));
         *  - вторичные (XSTAT_KEYS): round(base × (1 + bonus×0.25/100)) —
         *    enchK = 0.25, иначе крит/уклонение завышались бы вчетверо;
         *  - потолки вторичных: crit 50, critDmg 200, dodge 35, pierce 75,
         *    healPow 100, luck 100;
         *  - штраф экипировки (gearPenalty, максимум 50%) режет mag у
         *    mage/priest/necromancer и atk у остальных классов;
         *  - мощь = Σ stat × POW + 2 за каждый уровень заточки.
         *
         * @param {string} role класс, для которого считаем
         * @param {number} level уровень героя (1…50)
         * @param {Array<{item:object, en:number}>} equippedItems до 5 записей
         * @param {object|null} skillsBonuses агрегат BuildSim.skillBonuses()
         * @returns {object} { stats, power, penalty, parts, critMul, enTotal, skillsUsed }
         */
        calculateFittingStats(role, level, equippedItems, skillsBonuses) {
            const base = this.levelBaseStats(level);
            // Классовый модификатор HP: маг хрупче, разбойник крепче.
            const hpMod = role === 'mage' ? -12 : (role === 'rogue' ? 10 : 0);
            const stats = {
                hp: base.hp + hpMod,
                atk: base.atk,
                mag: base.mag,
                def: base.def,
                // Базовые вторичные статы героя (xstats.base из game-data.js).
                crit: 8,
                critDmg: 50,
                dodge: 0,
                pierce: 0,
                healPow: 0,
                luck: 0,
                resist: 0
            };

            const entries = (Array.isArray(equippedItems) ? equippedItems : [])
                .filter(e => e && e.item)
                .map(e => ({ item: e.item, en: Math.min(15, Math.max(0, Math.round(+e.en || 0))) }));
            const items = entries.map(e => e.item);

            let enTotal = 0;
            for (const { item, en } of entries) {
                enTotal += en;
                const bonus = GAME_DATA.ENCHANT_MULTIPLIERS[en] || 0;
                const bases = this.itemBaseStats(item);
                for (const [k, raw] of Object.entries(bases || {})) {
                    const v = +raw || 0;
                    if (!v || !(k in stats)) continue;
                    const pct = GAME_DATA.XSTAT_KEYS.has(k)
                        ? bonus * GAME_DATA.ENCHANT_K
                        : bonus;
                    stats[k] += Math.round(v * (1 + pct / 100));
                }
            }

            // Бонусы открытого созвездия: hp/def — плоско, урон — процентом
            // от уже собранного пула, вторичные — пунктами.
            if (skillsBonuses) {
                stats.hp += Math.round(+skillsBonuses.hp || 0);
                stats.def += Math.round(+skillsBonuses.def || 0);
                stats.atk += Math.round(stats.atk * (+skillsBonuses.atkPct || 0) / 100);
                stats.mag += Math.round(stats.mag * (+skillsBonuses.magPct || 0) / 100);
                for (const k of ['crit', 'critDmg', 'dodge', 'pierce', 'healPow', 'luck', 'resist']) {
                    stats[k] += +skillsBonuses[k] || 0;
                }
            }

            // Штраф чужой экипировки: у магов режет магию, у остальных физурон.
            const gp = this.gearPenaltyTotal(role, items);
            if (gp.pct > 0) {
                const key = ['mage', 'priest', 'necromancer'].includes(role) ? 'mag' : 'atk';
                stats[key] = Math.round(stats[key] * (1 - gp.pct / 100));
            }

            for (const k of Object.keys(stats)) stats[k] = Math.round(stats[k] || 0);
            for (const [k, cap] of Object.entries(this.FIT_CAPS)) {
                if (stats[k] > cap) stats[k] = cap;
            }

            let power = 0;
            for (const [k, w] of Object.entries(this.FIT_POW)) power += (stats[k] || 0) * w;

            return {
                stats,
                power: Math.round(power + 2 * enTotal),
                penalty: gp.pct,
                parts: gp.parts,
                critMul: 1 + (stats.critDmg || 0) / 100,
                enTotal,
                skillsUsed: !!skillsBonuses
            };
        },

        /**
         * Выбор примерки -> записи { item, en } для calculateFittingStats().
         * Предметы ищутся в общем пуле (надетое + сумка + склад): uid
         * уникален за счёт префиксов eq-/bg-/st- из open().
         *
         * @param {Array} pool предметы всех локаций
         * @returns {Array<{item:object, en:number}>}
         */
        fittingEntries(pool) {
            const out = [];
            for (const slot of this.FITTING_SLOTS) {
                const sel = this.fitting.slots[slot.id];
                if (!sel || !sel.uid) continue;
                const item = (Array.isArray(pool) ? pool : []).find(x => String(x.uid) === String(sel.uid));
                if (!item) continue;
                out.push({ item, en: Math.min(15, Math.max(0, Math.round(+sel.en || 0))) });
            }
            return out;
        },

        /**
         * Результат примерки для текущего состояния (класс, уровень, слоты,
         * чекбокс «Учитывать бонусы созвездия навыков»).
         *
         * @param {object} h hero из /api/me (фолбэк класса/уровня)
         * @param {Array} pool предметы всех локаций
         * @returns {object} результат calculateFittingStats()
         */
        fittingResult(h, pool) {
            const role = this.fitting.role || (h && h.role) || '';
            const level = this.fitting.level || (h && h.level) || 1;
            let skills = null;
            if (this.fitting.useSkills) {
                try {
                    if (typeof BuildSim !== 'undefined' && BuildSim && typeof BuildSim.skillBonuses === 'function') {
                        skills = BuildSim.skillBonuses();
                    }
                } catch (e) { skills = null; }
            }
            return this.calculateFittingStats(role, level, this.fittingEntries(pool), skills);
        },

        /**
         * 11.6.5f.1: компактный статус экипировки — одна иконка рядом с
         * названием предмета вместо отдельной полосы над таблицей.
         * Полный текст живёт в title (у штрафа — со списком предметов).
         *
         * v11.7.1: в шапке карточки заточки больше НЕ используется — там
         * показывается статус ВЫБРАННОГО предмета (itemIconBadge по gp),
         * иначе плашка по надетым вещам путала при выборе вещи из сумки.
         * Метод оставлен как публичный helper сводки штрафа.
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

        /**
         * v11.7.1: арт предмета для плитки и шапки карточки заточки.
         *
         * Приоритет — нативный рендер игры G.LGInventory.art(it): только он
         * рисует сложные вещи («Нимб из мяты» и прочие легендарки), которые
         * Utils.getItemArtHtml() подменял эмодзи-заглушкой. still() игры
         * применяется, если доступен (как в site/inventory.js).
         * Фолбэк — общий хелпер аддона (SVG -> иконка игры -> эмодзи).
         *
         * @param {object} it предмет из /api/me
         * @returns {string} html
         */
        renderItemArt(it) {
            if (!it) return '📦';
            try {
                const inv = G.LGInventory;
                if (inv && typeof inv.art === 'function') {
                    const rawSvg = inv.art(it);
                    if (rawSvg && rawSvg.startsWith('<svg')) {
                        return (typeof inv.still === 'function') ? inv.still(rawSvg) : rawSvg;
                    }
                }
            } catch (e) {}
            return Utils.getItemArtHtml({ i: it.id ?? it.i, name: it.name }, it);
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
                // v11.7.1: иконка считается по КОНКРЕТНОМУ предмету (gp) внутри
                // renderTable — общая плашка по надетым вещам игрока путала
                // (предмет из сумки мог подходить, а плашка показывала штраф).

                const tabsHtml = `
                    <button class="modal-tab active" data-tab="hero-build">🛡️ Билды</button>
                    <button class="modal-tab" data-tab="hero-ench">⚒️ Заточка</button>
                    <button class="modal-tab" data-tab="hero-fit">👗 Примерка <span class="hp-test-badge">ТЕСТ</span></button>
                `;

                // v11.7.0: вкладки «Билды» и «Заточка» занимают 100% ширины
                // модального окна. Двухколоночная сетка (1fr 320px) с панелью
                // «Характеристики» рендерится строго внутри вкладки «Примерка».
                const contentHtml = `
                    <div class="tab-content active" id="tab-hero-build" style="flex-direction:column; gap:0;">
                        <div id="hp-buildsim-container" style="display:flex; flex-direction:column; flex:1; min-height:0; overflow:auto; padding-bottom:20px;"></div>
                    </div>
                    <div class="tab-content" id="tab-hero-ench" style="flex-direction:column; gap:8px;">
                        <!-- v11.7.0: верхняя полоса переключателя режимов и
                             ценники ⭐/🌐 убраны — кукла слотов и таблица
                             +0…+15 начинаются сразу под шапкой вкладок.
                             Стоимость попытки сразу считается ожидаемой, а
                             цены ресурсов и справка живут справа снизу
                             (см. renderTable). -->

                        <!-- 11.6.5f.1: локации и плитка предметов рядом.
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
                    <div class="tab-content" id="tab-hero-fit" style="flex-direction:column; gap:10px;">
                        <div class="hp-fit-layout">
                            <div class="hp-fit-main">
                                <div class="hp-fit-head">
                                    <span class="hp-fit-title">👗 Примерка экипировки <span class="hp-test-badge">ТЕСТ</span></span>
                                </div>
                                <!-- v11.7.0: примерка набора экипировки. Класс и уровень
                                     можно смоделировать, заточка каждого слота — +0…+15. -->
                                <div class="hp-fit-top">
                                    <label class="hp-fit-field">Класс
                                        <select id="hp-fit-role">${Object.entries(GAME_DATA.CLASS_NAMES).map(([id, nm]) => `<option value="${id}">${Utils.escapeHtml(nm)}</option>`).join('')}</select>
                                    </label>
                                    <label class="hp-fit-field">Уровень
                                        <input id="hp-fit-level" type="number" min="1" max="50" step="1">
                                    </label>
                                    <label class="hp-fit-chk" title="Прибавить бонусы открытых узлов созвездия из вкладки «Билды»">
                                        <input id="hp-fit-skills" type="checkbox"> учитывать созвездие
                                    </label>
                                    <button type="button" class="hp-arena-btn" id="hp-fit-reset" title="Вернуть текущие вещи героя">↺ К текущим вещам</button>
                                </div>
                                <div id="hp-fit-rows" class="hp-fit-rows"></div>
                                <div id="hp-fit-foot" class="hp-cost-note">Класс и уровень можно моделировать независимо от героя: заточка выбирается для каждого слота, «↺ К текущим вещам» возвращает надетое. Сравнение с текущими характеристиками — в панели справа.</div>
                            </div>
                            <!-- v11.7.0: боковая панель характеристик и сравнения «Текущий герой → Примерка». -->
                            <aside class="hp-side" id="hp-side"></aside>
                        </div>
                    </div>
                `;

                const modal = UI.showModal(`
                    <h2>⚙️ Планировщик Героя (${Utils.escapeHtml(h.name || '')}) <button class="custom-close" id="custom-close-btn">✖</button></h2>
                    <div class="modal-tabs">${tabsHtml}</div>
                    ${contentHtml}
                `, { customClass: 'hp-planner-modal' });

                // Переключение табов. Скоупим на собственный нав-бар HeroPlanner:
                // после BuildSim.mount() внутри #tab-hero-build появляются свои
                // .modal-tab/.tab-content, и глобальные селекторы сбросили бы их.
                const ownTabs = modal?.querySelector('.modal-tabs');
                // v11.7.0: собственные вкладки HeroPlanner — прямые потомки
                // модалки с классом .tab-content (вкладки BuildSim внутри
                // #tab-hero-build не затрагиваются).
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

                    const item = selectedItem;
                    if (!item) {
                        outEl.innerHTML = `<div style="color:#888; text-align:center; padding:20px;">В этой локации нет предметов для заточки.</div>`;
                        return;
                    }

                    const curEn = +(item.en ?? item.e ?? item.enchant ?? 0);

                    // ПРИОРИТЕТ: stats0 (точные базы из игры), иначе обратный
                    // вычет заточки — см. HeroPlanner.itemBaseStats().
                    const baseStats = this.itemBaseStats(item, curEn);
                    const isExpanded = this.ENCH.max;
                    // v11.7.1: уровень ПРОСМОТРА (0…15) отделён от цели пути.
                    // preview <= curEn означает «шагов нет»: карточка просто
                    // показывает статы предмета на выбранном уровне.
                    const preview = this.enchantPreviewLevel(curEn);
                    const hasPath = preview > curEn;
                    const starPrice = this.resourcePrice('star');
                    const spherePrice = this.resourcePrice('sphere');

                    // Компактная подпись стата для колонки «Статы»: убираем
                    // хвостовой «%» из statNames («Крит %» -> «Крит»), значение
                    // показываем числом, как в самой игре.
                    const shortStat = (k) => String(
                        (typeof BuildSim !== 'undefined' && BuildSim.statNames && BuildSim.statNames[k]) || k
                    ).replace(/\s*%$/, '');
                    const statKeys = Object.keys(baseStats || {});
                    // Статы предмета на произвольном уровне заточки (Math.round,
                    // xstat-ы получают ¼ бонуса — см. enchantStat).
                    const statsAt = (lv) => statKeys.length
                        ? statKeys.map(k => `${shortStat(k)} ${this.enchantStat(+baseStats[k] || 0, lv, k)}`).join(' · ')
                        : '—';

                    // ── Правая колонка: таблица уровней +0…+15 ──
                    // v11.7.1: первая строка — база +0, все строки кликабельны:
                    // клик выбирает уровень ПРОСМОТРА (в том числе ниже текущей
                    // заточки), а не только цель впереди.
                    let rows = '';
                    for (let lv = 0; lv <= isExpanded; lv++) {
                        const isBase = lv === 0;
                        const isCur = lv === curEn;
                        const isPreview = lv === preview;

                        // Усилители — только у шагов +1…+15 (у базы шага нет).
                        const useStar = !isBase && !!this.allocatedStars[lv];
                        const useSphere = !isBase && !!this.allocatedSpheres[lv];

                        let chance = 0;
                        let costCell = '—';
                        let chips = '—';
                        let bonusPct = 0;
                        if (!isBase) {
                            chance = this.enchantChance(lv);
                            // ⭐ даёт +25% к шансу — показываем шанс уже с надбавкой.
                            if (useStar) chance += 25;

                            // Отмеченный усилитель входит в стоимость попытки:
                            // колонка «Попытка» показывает реальные траты шага.
                            const attemptCost = this.enchantCost(item.v, lv)
                                + (useStar ? starPrice : 0)
                                + (useSphere ? spherePrice : 0);

                            // 📈 — в стоимость вошёл ресурс, купленный на ауке
                            // (медиана сети). Тултип объясняет источник цены.
                            const aucUsed = (useStar && this.resourceMedian('star') > 0)
                                || (useSphere && this.resourceMedian('sphere') > 0);
                            costCell = `${Utils.formatMoney(attemptCost)}${aucUsed
                                ? ' <span title="Цена включает ресурс с аукциона (медиана сети за 72 часа / последние 100 цен)" style="cursor:help; font-size:11px;">📈</span>'
                                : ''}`;

                            chips = `<button type="button" class="hp-mat-btn star ${useStar ? 'active' : ''}" data-lv="${lv}" title="Счастливая звезда (+25% к шансу, +${Utils.formatMoney(starPrice)})">⭐</button>`
                                + `<button type="button" class="hp-mat-btn sphere ${useSphere ? 'active' : ''}" data-lv="${lv}" title="Сфера сохранения (защита от поломки, +${Utils.formatMoney(spherePrice)})">🌐</button>`;

                            // Бонус заточки на этом уровне (GAME_DATA.ENCHANT_MULTIPLIERS, %)
                            bonusPct = GAME_DATA.ENCHANT_MULTIPLIERS[lv] || 0;
                        }

                        const rowCls = ['hp-ench-row'];
                        if (isCur) rowCls.push('cur');
                        if (isPreview) rowCls.push('preview');

                        rows += `<tr class="${rowCls.join(' ')}" data-lv="${lv}" title="Показать характеристики на +${lv}">
                            <td><b>+${lv}</b>${isBase ? ' <small style="color:#9c8fa8;">(база)</small>' : ''}${isCur ? ' <small style="color:#ffcf6a;">(тек.)</small>' : ''}</td>
                            <td>${isBase ? '—' : Math.min(100, chance) + '%'}</td>
                            <td style="color:#4cc95a; font-weight:bold;">+${bonusPct}%</td>
                            <td>${costCell}</td>
                            <td class="hp-mats-cell">${chips}</td>
                            <td class="hp-ench-stats">${statsAt(lv)}</td>
                        </tr>`;
                    }

                    // ── Левая колонка: карточка уровня просмотра ──
                    // v11.7.0: переключателя режимов больше нет — «Итоговая
                    // стоимость» сразу считается ОЖИДАЕМОЙ (с учётом шансов и
                    // отмеченных ⭐/🌐), а минимум без промахов идёт подписью.
                    let costIdeal = 0;
                    let costExpected = 0;
                    let starsUsed = 0, spheresUsed = 0;
                    let attempts = 0;
                    // v11.7.1: путь всегда вперёд (curEn+1…preview). Если
                    // preview <= curEn, цикл не выполняется — стоимость 0,
                    // а карточка показывает статы выбранного уровня.
                    for (let lv = curEn + 1; lv <= preview; lv++) {
                        const step = this.enchantCost(item.v, lv);
                        costIdeal += step;
                        let stepCost = step;
                        let chance = this.enchantChance(lv);
                        // Ресурсы выбранные кнопками ⭐/🌐 в строках таблицы.
                        if (this.allocatedStars[lv]) { stepCost += starPrice; chance += 25; starsUsed++; }
                        if (this.allocatedSpheres[lv]) { stepCost += spherePrice; spheresUsed++; }
                        // 100 / chance — ожидаемое число попыток на один шаг
                        // (1/p). Сумма по пути даёт матожидание попыток на всю
                        // цель; при 0% шаг бесконечен, поэтому Infinity.
                        attempts += chance > 0 ? 100 / chance : Infinity;
                        costExpected += chance > 0 ? stepCost * (100 / chance) : Infinity;
                    }
                    const costTotalRaw = costExpected;
                    const costTotal = Number.isFinite(costTotalRaw) ? Utils.formatMoney(costTotalRaw) : '∞';
                    const costMin = Number.isFinite(costIdeal) ? Utils.formatMoney(costIdeal) : '∞';
                    const costResources = starsUsed * starPrice + spheresUsed * spherePrice;
                    const attemptsStr = hasPath
                        ? (Number.isFinite(attempts) ? Math.ceil(attempts) : '∞')
                        : '0';
                    const rangeText = hasPath
                        ? `шагов +${curEn + 1}…+${preview}`
                        : (preview === curEn
                            ? 'шагов нет — это текущий уровень'
                            : `шагов нет — +${preview} уже пройден`);

                    // Статы предмета на выбранном уровне: база (+0) -> итог,
                    // прибавка отдельным зелёным числом. v11.7.1: если выбран
                    // уровень ниже текущей заточки, дополнительно показываем
                    // значение на текущей заточке (для сравнения).
                    const statHtml = Object.entries(baseStats).map(([k, base]) => {
                        const b = +base || 0;
                        const fin = this.enchantStat(b, preview, k);
                        const gain = fin - b;
                        const name = (typeof BuildSim !== 'undefined' && BuildSim.statNames && BuildSim.statNames[k]) || k;
                        const safeName = Utils.escapeHtml(name);
                        const curNote = preview !== curEn
                            ? ` <span class="hp-stat-cur" title="Сейчас, на +${curEn}">(+${curEn}: ${this.enchantStat(b, curEn, k)})</span>`
                            : '';
                        return `<div class="hp-stat-row">
                            <span class="hp-stat-name" title="${safeName}">${safeName}</span>
                            <span class="hp-stat-val">${b} → <b>${fin}</b>${gain > 0 ? ` <span class="hp-stat-gain">+${gain}</span>` : ''}${curNote}</span>
                        </div>`;
                    }).join('') || '<div class="hp-cost-sub">У предмета нет характеристик.</div>';

                    // Пресеты уровня просмотра. v11.7.1: пройденные уровни
                    // больше НЕ блокируются — их можно смотреть (класс .done
                    // лишь визуально помечает «уже пройдено»).
                    const presets = [0, 4, 7, 10, 15].map(t => {
                        const done = t > 0 && t <= curEn;
                        const active = t === preview;
                        return `<button type="button" class="hp-target-preset${active ? ' active' : ''}${done ? ' done' : ''}"`
                            + ` data-target="${t}" title="Показать +${t}">+${t}</button>`;
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
                    // v11.7.1: галочка/предупреждение — по ВЫБРАННОМУ предмету
                    // (gp), а не общей плашкой по надетым вещам героя.
                    const itemIconBadge = gp.bad
                        ? `<span class="hp-gear-pill bad" title="Не подходит классу: −${gp.pct}% ${statLabel}">⚠</span>`
                        : `<span class="hp-gear-pill ok" title="Подходит вашему классу">✓</span>`;
                    // Мини-арт предмета в шапке (нативный LGInventory.art).
                    const headArt = this.renderItemArt(item);

                    // Клик по строке/пресету перерисовывает колонки целиком —
                    // сохраняем прокрутку списка уровней, иначе таблица прыгает
                    // наверх при каждом выборе цели. 11.6.5f.1: таблица теперь
                    // скроллится внутри .hp-ench-right, поэтому помним и его.
                    const keepScroll = outEl.scrollTop;
                    const keepTableScroll = outEl.querySelector('.hp-ench-right')?.scrollTop || 0;
                    outEl.innerHTML = `
                        <div style="background:#26202e; border:1px solid #44374a; border-radius:6px; padding:8px 12px; margin-bottom:10px; font-size:12px;">
                            <div class="hp-item-head">
                                <span class="hp-item-head-art">${headArt || '📦'}</span>
                                <div>
                                    <b style="color:#ffcf6a;">${Utils.escapeHtml(item.name)}</b>${itemIconBadge} (v: ${item.v}, тек: +${curEn})${gearNote}${boundNote}
                                </div>
                            </div>
                        </div>
                        <div class="hp-ench-split">
                            <!-- 11.6.5f.1: карточка цели — СЛЕВА (класс .hp-ench-left,
                                 flex 1 1 40%), таблица уровней — СПРАВА (.hp-ench-right). -->
                            <div class="hp-ench-left">
                                <div class="hp-target-head">
                                    <div class="hp-target-title">Просмотр: <b>+${preview}</b></div>
                                    <div class="hp-target-presets">${presets}</div>
                                </div>
                                <div class="hp-target-section">
                                    <div class="hp-target-sub">Характеристики на +${preview}</div>
                                    <div class="hp-stat-grid">${statHtml}</div>
                                </div>
                                <div class="hp-target-section">
                                    <div class="hp-target-sub">Итоговая стоимость (ожидаемо)</div>
                                    <div class="hp-cost-total">${costTotal}</div>
                                    <div class="hp-cost-min">Минимум без промахов: ${costMin}</div>
                                    <div class="hp-cost-sub">${rangeText} · попыток: ${attemptsStr}</div>
                                    <div class="hp-cost-row">⭐ Звёзды: ${starsUsed} шт. · 🌐 Сферы: ${spheresUsed} шт.${costResources > 0
                                        ? ` — ${Utils.formatMoney(costResources)}`
                                        : ''}</div>
                                </div>
                            </div>
                            <div class="hp-ench-rightcol">
                                <div class="hp-ench-right">
                                    <table class="hp-ench-table">
                                        <thead><tr>
                                            <th>Уровень</th>
                                            <th>Шанс</th>
                                            <th>Бонус</th>
                                            <th>Попытка</th>
                                            <th>Усилители</th>
                                            <th>Статы</th>
                                        </tr></thead>
                                        <tbody>${rows}</tbody>
                                    </table>
                                </div>
                                <!-- v11.7.0: компактная справка справа снизу под
                                     таблицей +0…+15 (вместо полосы нотации). -->
                                <div class="hp-ench-hint">
                                    <div class="hp-ench-hint-prices">${this.matsPriceHtml()}</div>
                                    <div>Попытка = <code>max(priceMin, round(v × price% / 100))</code> из живой таблицы <code>LG_GAME_DATA.enchant</code>.</div>
                                    <div>«Ожидаемо» = стоимость шагов ${rangeText} с ⭐/🌐 × матожидание попыток (100 / шанс).</div>
                                    <div>Вторичные статы (крит, уклонение, пробивание…) получают ¼ бонуса заточки (enchK = 0.25).</div>
                                </div>
                            </div>
                        </div>
                    `;
                    outEl.scrollTop = keepScroll;
                    const tableWrap = outEl.querySelector('.hp-ench-right');
                    if (tableWrap) tableWrap.scrollTop = keepTableScroll;

                    // v11.7.1: кнопки-переключатели ресурсов ⭐/🌐. Всплытие
                    // гасим, иначе клик по кнопке сменил бы уровень просмотра.
                    outEl.querySelectorAll('.hp-mat-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const lv = +btn.dataset.lv;
                            if (!Number.isFinite(lv) || lv < 1) return;
                            const map = btn.classList.contains('star') ? this.allocatedStars : this.allocatedSpheres;
                            if (map[lv]) delete map[lv];
                            else map[lv] = true;
                            renderTable();
                        });
                    });

                    // v11.7.1: клик по любой строке +0…+15 выбирает уровень
                    // ПРОСМОТРА (в том числе ниже текущей заточки), а не только
                    // цель впереди. targetLevel держим синхронным.
                    outEl.querySelectorAll('.hp-ench-row').forEach(tr => {
                        tr.addEventListener('click', (e) => {
                            if (e.target.closest('button, input, label')) return;
                            const lv = +tr.dataset.lv;
                            if (!Number.isFinite(lv) || lv < 0) return;
                            this.previewLevel = lv;
                            this.targetLevel = lv;
                            renderTable();
                        });
                    });

                    // Пресеты уровня просмотра (+0/+4/+7/+10/+15).
                    outEl.querySelectorAll('.hp-target-preset').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const lv = +btn.dataset.target;
                            if (!Number.isFinite(lv) || lv < 0) return;
                            this.previewLevel = lv;
                            this.targetLevel = lv;
                            renderTable();
                        });
                    });
                };

                // ============================================================
                // v11.7.0: ВКЛАДКА «👗 ПРИМЕРКА» + ПАНЕЛЬ СТАТОВ
                //
                // Пул примерки — надетое, сумка и склад: uid уникальны за счёт
                // префиксов eq-/bg-/st- из mapItems(), поэтому поиск по строке
                // безопасен.
                // ============================================================
                const fitPool = [];
                for (const key of ['equipped', 'bag', 'storage']) {
                    for (const it of locations[key].items) fitPool.push(it);
                }
                const sideEl = document.getElementById('hp-side');

                // Примерка стартует с ТЕКУЩИХ вещей героя: игрок сразу видит
                // нулевую дельту и меняет только то, что хочет примерить.
                const initFitting = () => {
                    this.fitting = {
                        role: h.role || '',
                        level: Math.min(50, Math.max(1, +h.level || 1)),
                        useSkills: false,
                        slots: {}
                    };
                    for (const slot of this.FITTING_SLOTS) {
                        const it = equipped.find(x => x.slot === slot.id) || null;
                        this.fitting.slots[slot.id] = {
                            uid: it ? String(it.uid) : '',
                            en: it ? Math.min(15, Math.max(0, Math.round(+(it.en ?? it.e ?? 0)))) : 0
                        };
                    }
                    const roleSel = document.getElementById('hp-fit-role');
                    if (roleSel) roleSel.value = this.fitting.role;
                    const lvlInp = document.getElementById('hp-fit-level');
                    if (lvlInp) lvlInp.value = String(this.fitting.level);
                    const chk = document.getElementById('hp-fit-skills');
                    if (chk) chk.checked = false;
                };

                // Порядок строк как в нативной карточке героя: сначала основные
                // характеристики, затем вторичные (третий элемент — единица).
                const SIDE_ROWS = [
                    ['hp', 'Макс. HP', ''], ['atk', 'Физ. урон', ''], ['mag', 'Магия', ''], ['def', 'Броня', ''],
                    ['crit', 'Крит', '%'], ['critDmg', 'Сила крита', '%'], ['dodge', 'Уклонение', '%'],
                    ['pierce', 'Пробивание', '%'], ['healPow', 'Сила лечения', '%'],
                    ['luck', 'Удача', '%'], ['resist', 'Сопротивление', '']
                ];

                /**
                 * Постоянная правая панель: «Текущий герой → Примерка» по всем
                 * характеристикам + боевая мощь, штраф экипировки и множитель
                 * крита (1 + critDmg/100). Δ: +N зелёным, −N красным.
                 */
                const renderSide = () => {
                    if (!sideEl) return;
                    const cur = this.heroCurrentStats(h);
                    let fit = null;
                    try { fit = this.fittingResult(h, fitPool); } catch (e) { fit = null; }
                    const delta = (before, after) => {
                        const d = Math.round((after - before) * 10) / 10;
                        const cls = d > 0 ? 'up' : (d < 0 ? 'down' : 'same');
                        const txt = d > 0 ? `+${d}` : (d < 0 ? `−${Math.abs(d)}` : '±0');
                        return `<span class="hp-side-delta ${cls}">${txt}</span>`;
                    };
                    const statRow = ([k, label, suf]) => {
                        const before = +(cur.stats[k] || 0);
                        const after = fit ? +(fit.stats[k] || 0) : before;
                        return `<div class="hp-side-row"><span class="hp-side-name">${label}</span>`
                            + `<span class="hp-side-vals">${before}${suf} → <b>${after}${suf}</b></span>`
                            + delta(before, after) + '</div>';
                    };
                    const pwBefore = cur.power;
                    const pwAfter = fit ? fit.power : pwBefore;
                    const pen = fit ? fit.penalty : cur.penalty;
                    const critMul = fit ? fit.critMul : cur.critMul;
                    const skillsNote = !this.fitting.useSkills ? ''
                        : (fit && fit.skillsUsed ? ' · 🌟 созвездие учтено' : ' · 🌟 созвездие недоступно');
                    sideEl.innerHTML = `<div class="hp-side-head">Характеристики</div>
                        <div class="hp-side-cols"><span>Параметр</span><span>Сейчас → Примерка</span><span>Δ</span></div>
                        ${SIDE_ROWS.map(statRow).join('')}
                        <div class="hp-side-sep"></div>
                        <div class="hp-side-row strong"><span class="hp-side-name">Боевая мощь</span>`
                        + `<span class="hp-side-vals">${pwBefore} → <b>${pwAfter}</b></span>${delta(pwBefore, pwAfter)}</div>
                        <div class="hp-side-row"><span class="hp-side-name">Штраф экипировки</span>`
                        + `<span class="hp-side-vals">${pen ? '−' + pen + '%' : 'нет'}</span><span class="hp-side-delta same"></span></div>
                        <div class="hp-side-row"><span class="hp-side-name">Множитель крита</span>`
                        + `<span class="hp-side-vals">×${critMul.toFixed(2)}</span><span class="hp-side-delta same"></span></div>
                        <div class="hp-side-foot">Заточка: Σ +${fit ? fit.enTotal : cur.enTotal} ур. · +2 мощи за уровень${skillsNote}</div>`;
                };

                /**
                 * Строки примерки: слот -> предмет (optgroup по локациям) и
                 * уровень заточки +0…+15. Любое изменение сразу обновляет
                 * боковую панель, таблица заточки не перерисовывается.
                 */
                const renderFit = () => {
                    const rowsEl = document.getElementById('hp-fit-rows');
                    if (!rowsEl) return;
                    rowsEl.innerHTML = this.FITTING_SLOTS.map(slot => {
                        const sel = this.fitting.slots[slot.id] || { uid: '', en: 0 };
                        const groups = ['equipped', 'bag', 'storage'].map(key => {
                            const list = locations[key].items.filter(it => it.slot === slot.id);
                            if (!list.length) return '';
                            const opts = list.map(it => {
                                const on = String(it.uid) === String(sel.uid) ? ' selected' : '';
                                const en = +(it.en ?? it.e ?? 0);
                                const label = `${it.name || '—'}${en > 0 ? ` +${en}` : ''} · ${Utils.formatMoney(it.v || 0)}`;
                                return `<option value="${Utils.escapeHtml(String(it.uid))}"${on}>${Utils.escapeHtml(label)}</option>`;
                            }).join('');
                            return `<optgroup label="${Utils.escapeHtml(locations[key].name)}">${opts}</optgroup>`;
                        }).join('');
                        const enOpts = Array.from({ length: 16 }, (_, i) =>
                            `<option value="${i}"${i === (+sel.en || 0) ? ' selected' : ''}>+${i}</option>`).join('');
                        const chosen = fitPool.find(x => String(x.uid) === String(sel.uid));
                        const gp = chosen ? this.gearPenaltyFor(this.fitting.role, chosen) : null;
                        const warn = (gp && gp.bad)
                            ? `<span class="hp-gear-pill bad" title="Не для класса: −${gp.pct}%">⚠</span>`
                            : '';
                        return `<div class="hp-fit-row">
                            <span class="hp-fit-slot">${slot.icon} ${slot.name}${warn}</span>
                            <select class="hp-fit-item" data-slot="${slot.id}" title="Предмет из надетого, сумки или склада">
                                <option value="">— пусто —</option>${groups}
                            </select>
                            <select class="hp-fit-en" data-slot="${slot.id}" title="Уровень заточки (0…15)">${enOpts}</select>
                        </div>`;
                    }).join('');

                    rowsEl.querySelectorAll('.hp-fit-item').forEach(el => {
                        el.addEventListener('change', () => {
                            const slot = el.dataset.slot;
                            if (!this.fitting.slots[slot]) this.fitting.slots[slot] = { uid: '', en: 0 };
                            this.fitting.slots[slot].uid = el.value;
                            // Перерисовка нужна ради ⚠ «не для класса» у слота.
                            renderFit();
                            renderSide();
                        });
                    });
                    rowsEl.querySelectorAll('.hp-fit-en').forEach(el => {
                        el.addEventListener('change', () => {
                            const slot = el.dataset.slot;
                            if (!this.fitting.slots[slot]) this.fitting.slots[slot] = { uid: '', en: 0 };
                            this.fitting.slots[slot].en = Math.min(15, Math.max(0, +el.value || 0));
                            renderSide();
                        });
                    });
                };

                // ── Управление примеркой: класс, уровень, созвездие, сброс ──
                document.getElementById('hp-fit-role')?.addEventListener('change', (e) => {
                    this.fitting.role = e.target.value || h.role || '';
                    renderFit();   // ⚠ «не для класса» зависит от класса
                    renderSide();
                });
                document.getElementById('hp-fit-level')?.addEventListener('input', (e) => {
                    const lv = Math.min(50, Math.max(1, Math.round(+e.target.value || 1)));
                    this.fitting.level = lv;
                    renderSide();
                });
                // blur возвращает зажатую границу (1…50), если ввели 0 или 99.
                document.getElementById('hp-fit-level')?.addEventListener('blur', (e) => {
                    e.target.value = String(this.fitting.level);
                });
                document.getElementById('hp-fit-skills')?.addEventListener('change', (e) => {
                    this.fitting.useSkills = !!e.target.checked;
                    renderSide();
                });
                document.getElementById('hp-fit-reset')?.addEventListener('click', () => {
                    initFitting();
                    renderFit();
                    renderSide();
                });

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

                // initialTab: 'build' (по умолчанию) | 'fit' | 'ench'; 'arena'
                // уже нормализован в 'build'. «Билды» активны в разметке сразу.
                if (wanted === 'ench' || wanted === 'hero-ench') activateTab('hero-ench');
                else if (wanted === 'fit' || wanted === 'hero-fit') activateTab('hero-fit');

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
                        // v11.7.1: арт берём нативным рендером игры
                        // (LGInventory.art) — он рисует и легендарки вроде
                        // «Нимба из мяты», которые раньше падали в эмодзи.
                        const art = this.renderItemArt(it);
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

                // v11.7.0: переключатель «📊 Идеально / 🧠 С учётом шансов»
                // удалён — «Итоговая стоимость» всегда ожидаемая (renderTable),
                // поэтому обработчиков .hp-mode-btn больше нет.

                initFitting();
                renderFit();
                renderSide();
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

    // ===== src/modules/auction.js =====
    // ============================================================
    // 5. МОДУЛЬ: СКАНЕР АУКЦИОНА
    //
    // v11.6.2c.1: статистика цен на нашем сервере. Каждое открытие витрины
    // даёт снимок цен (цена за штуку, свои лоты отброшены) — пачка уходит в
    // POST /market/scan не чаще раза в 5 минут, а медианы по всем игрокам с
    // аддоном подтягиваются GET /market/medians и кладутся в marketMedians
    // (тултип колонки «Медиана»). Расчёты выгоды по-прежнему локальные.
    //
    // v11.6.2d: медианы отдаются наружу через Auction.getMedian(id) — ими
    // пользуется Планировщик героя (цены звёзд и сфер заточки в калькуляторе).
    // ============================================================
    const Auction = {
        cityStockMap: new Map(),
        cityStockLoaded: false,
        cityStockLoading: null,

        // 11.5.5: уровень героя и порог торговли (hero.tml — минимальный
        // уровень, с которого сервер разрешает покупку/обмен у игроков).
        // Пока /api/me не ответил, считаем, что ограничений нет.
        myLevel: 1,
        tradeMinLevel: 0,

        // 11.5.5: пагинация витрины вместо жёсткого среза в 100 строк.
        // currentPage — индекс страницы с нуля, pageSize — строк на страницу.
        currentPage: 0,
        pageSize: 50,

        // 11.5.5: оповещения о выгодных лотах. alertThreshold — минимальная
        // скидка в процентах, при которой показываем тост и играем сигнал.
        alertThreshold: 50,
        // 11.6.2c.3: минимальная «Выгода» (в % от медианы сети, если она есть),
        // при которой лот проходит фильтр «Только выгодные». Раньше порог был
        // жёстко зашит числом 10 в update().
        dealFilterMin: 10,
        // Звук можно выключить чекбоксом «Звук» в фильтрах; выбор живёт в
        // localStorage. Чтение обёрнуто в try: в приватном режиме/при
        // запрете хранилища getItem бросает исключение и ронял бы модуль.
        alertSoundEnabled: (() => {
            try { return localStorage.getItem('LEGION_AUC_SOUND') !== 'false'; }
            catch (e) { return true; }
        })(),

        // 11.5.5: «Мои лоты» и «Избранное». favorites — Set id ПРЕДМЕТОВ
        // (в processed поле id — это id предмета, id лота живёт в lotId):
        // звезда стоит рядом с названием, история цен и фильтры тоже по
        // предмету. Список хранится в localStorage как JSON-массив.
        showMyLotsOnly: false,
        myNick: '',
        favorites: (() => {
            try {
                const arr = JSON.parse(localStorage.getItem('LEGION_AUC_FAVS') || '[]');
                return new Set(Array.isArray(arr) ? arr : []);
            } catch (e) {
                // Битый JSON или запрещённое хранилище — стартуем с пустого.
                return new Set();
            }
        })(),
        showFavoritesOnly: false,

        // Конфиг аукциона канала из /api/auction (feePct/feeMin/com/maxLots/hours).
        // Нужен справке (showInfo), чтобы не показывать чужие числа.
        cfg: null,

        // 11.6.2c.1: статистика цен на нашем сервере (legion.ctrlfree.host).
        // marketMedians — { id: медиана } из GET /market/medians, только для
        //   отображения (тултип колонки «Медиана»);
        // marketScanBuffer — наблюдения {id, price} (цена за штуку), ещё не
        //   отправленные в POST /market/scan. Копится между открытиями
        //   витрины, поэтому пачка содержит несколько снимков цен.
        marketMedians: {},
        // 11.6.2c.2: справочник предметов из последнего GET /api/auction —
        // нужен строкам тултипов, чтобы узнать название предмета по id.
        lastItemsMap: null,
        marketScanBuffer: [],
        marketScanSentAt: 0,
        marketScanPending: false,
        // Троттлинг отправки (ТЗ 11.6.2c.1: раз в 5 минут) и пределы, которые
        // ждёт сервер (см. MARKET_LIMITS в server/db.js).
        MARKET_SYNC_MS: 5 * 60 * 1000,
        MARKET_MAX_BATCH: 500,
        MARKET_MAX_IDS: 200,
        MARKET_TIMEOUT: 12000,
        MARKET_WAIT_MS: 1200,
        // 11.6.5a: как часто можно перезапрашивать медиану для одного
        // предмета из подсказки. Тултип проверяется на каждую мутацию DOM,
        // поэтому без троттлинга один и тот же id уходил бы в /market/medians
        // по нескольку раз в секунду.
        TIP_MEDIAN_RETRY_MS: 2 * 60 * 1000,
        // 11.6.5a.2: инлайн-стиль строки медианы для HTML-хука. Инлайн, а не
        // класс из styles.js, потому что строка рождается внутри строки
        // разметки игры и должна переживать её перерисовки без наших правок.
        TIP_MEDIAN_LINE_STYLE: 'margin-top:6px;padding-top:4px;border-top:1px dashed rgba(255,255,255,0.2);font-size:12px;color:#ffd700;font-weight:600;display:flex;align-items:center;gap:4px;',

        // 11.6.2c.4: полное сканирование витрины (кнопка «📡 Сканировать весь
        // аукцион»). Отметка о последнем скане живёт в localStorage, чтобы
        // кулдаун переживал перезагрузку страницы; FULL_SCAN_MAX_LOTS —
        // предохранитель «не заваливать сервер»: сервер принимает 500 записей
        // за POST (MARKET_LIMITS.maxLotsPerScan), поэтому снимок уходит пачками.
        FULL_SCAN_KEY: 'lgFullScanAt',
        FULL_SCAN_COOLDOWN_MS: 30 * 60 * 1000,
        FULL_SCAN_MAX_LOTS: 5000,
        FULL_SCAN_MAX_PAGES: 25,
        fullScanPending: false,
        _fullScanTimer: null,

        // Базовая ценность (v) по редкости — фолбэк, если сервер не прислал
        // items[id].v (ивентовые и новые предметы). Значения из game-data.js
        // (RARITY_LIST) и применяются напрямую, без множителей по слоту.
        RARITY_BASE_V: {
            common: 200,
            uncommon: 3000,
            rare: 10000,
            epic: 40000,
            legendary: 200000
        },

        init() {
            (document.getElementById(DOM_IDS.btnAuctionScan) || document.getElementById('btn-auction-scan'))?.addEventListener('click', () => this.open());
            // 11.6.2c.2: дописываем «Медиана рынка» в нативные тултипы предметов
            // (экипировка/сумка героя и окно инвентаря).
            this.initItemTips();
        },

        // Загрузка ассортимента и официальных цен магазинов города (/api/city/stock)
        async fetchCityStock() {
            if (this.cityStockLoaded && this.cityStockMap.size > 0) return this.cityStockMap;
            if (this.cityStockLoading) return this.cityStockLoading;

            this.cityStockLoading = (async () => {
                const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
                let timeoutId = null;
                try {
                    // Жёсткий таймаут. Одного AbortController мало: Utils.fetchApi
                    // сначала пробует нативный ctx.api игры, которому signal не
                    // передать, поэтому гоняем запрос с таймером через
                    // Promise.race — Auction.open() не должен висеть навсегда
                    // на «Считаем цены...», если /api/city/stock молчит.
                    const timeout = new Promise((_, reject) => {
                        timeoutId = setTimeout(() => {
                            if (controller) {
                                try { controller.abort(); } catch (err) {}
                            }
                            reject(new Error('timeout 8000ms'));
                        }, 8000);
                    });

                    const res = await Promise.race([
                        Utils.fetchApi('/api/city/stock', null, controller ? controller.signal : undefined),
                        timeout
                    ]);
                    const data = res?.body || res;
                    if (data && (data.ok !== false)) {
                        const m = new Map();
                        const add = (it) => {
                            if (it && it.id && +it.coins > 0) {
                                const p = +it.coins;
                                if (!m.has(it.id) || m.get(it.id) > p) {
                                    m.set(it.id, p);
                                }
                            }
                        };
                        const walk = (v) => {
                            if (Array.isArray(v)) {
                                v.forEach(x => (x && x.id ? add(x) : walk(x)));
                            } else if (v && typeof v === 'object') {
                                Object.values(v).forEach(walk);
                            }
                        };
                        walk(data);
                        this.cityStockMap = m;
                        this.cityStockLoaded = true;
                        dbg('[AUCTION] База цен магазинов NPC успешно загружена:', m.size, 'товаров');
                        return m;
                    }
                } catch (e) {
                    dbg('[AUCTION] Таймаут или ошибка /api/city/stock:', e);
                } finally {
                    if (timeoutId) clearTimeout(timeoutId);
                    this.cityStockLoading = null;
                }
                return this.cityStockMap;
            })();

            return this.cityStockLoading;
        },

        /* ---------------------------------------------------------- */
        /* 11.6.2c.1: сканер цен и медианы нашего сервера              */
        /* ---------------------------------------------------------- */

        /**
         * Адрес и ключ нашего сервера.
         *
         * Хранятся в модуле «Пати» (Party.getBaseUrl / Party.API_KEY), поэтому
         * берём их оттуда, а фолбэки совпадают с DEFAULT_BASE_URL/API_KEY из
         * party.js. Модуль Party объявлен ниже в сборке, но Auction.open()
         * вызывается уже после инициализации всех модулей — TDZ не мешает.
         */
        marketServer() {
            let base = 'https://legion.ctrlfree.host';
            let key = 'LGU-default-secret-key-change-me';
            try {
                if (typeof Party !== 'undefined' && Party) {
                    if (typeof Party.getBaseUrl === 'function') base = Party.getBaseUrl() || base;
                    if (typeof Party.API_KEY === 'string' && Party.API_KEY) key = Party.API_KEY;
                }
            } catch (e) {
                // Нет модуля «Пати» (урезанная сборка) — работаем на фолбэках.
                dbg('[AUCTION] Party недоступен, берём адрес сервера по умолчанию:', e);
            }
            return { base: String(base).replace(/\/+$/, ''), key };
        },

        /**
         * Запрос к /market/* нашего сервера.
         *
         * Только GM_xmlhttpRequest: домен сервера чужой для игры, нативный
         * fetch упёрся бы в CSP `connect-src 'self'` (AGENTS.md §3). Заголовок
         * X-Legion-Key обязателен — без него сервер отвечает 401 ещё до
         * роутинга (Bearer здесь не нужен, статистика общая).
         *
         * @param {string} method
         * @param {string} path    например '/market/scan'
         * @param {object|null} body
         * @returns {Promise<object|null>}
         */
        _marketRequest(method, path, body = null) {
            const { base, key } = this.marketServer();
            const url = base + path;

            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest !== 'function') {
                    reject(new Error('GM_xmlhttpRequest недоступен: проверьте @grant в шапке'));
                    return;
                }

                GM_xmlhttpRequest({
                    method,
                    url,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Legion-Key': key
                    },
                    data: body === null ? undefined : JSON.stringify(body),
                    timeout: this.MARKET_TIMEOUT,
                    onload: (res) => {
                        let payload = null;
                        try {
                            payload = res.responseText ? JSON.parse(res.responseText) : null;
                        } catch (e) {
                            payload = null;
                        }
                        if (res.status >= 200 && res.status < 300) {
                            resolve(payload);
                            return;
                        }
                        const err = new Error(payload?.message || `HTTP ${res.status}`);
                        err.status = res.status;
                        reject(err);
                    },
                    onerror: () => reject(new Error(`Сервер статистики недоступен: ${url}`)),
                    ontimeout: () => reject(new Error(`Сервер статистики не ответил за ${this.MARKET_TIMEOUT / 1000} с: ${url}`)),
                    onabort: () => reject(new Error('Запрос статистики отменён'))
                });
            });
        },

        /**
         * Один лот витрины -> наблюдение { id, price } для /market/scan.
         *
         * Вынесено из collectMarketPrices, чтобы полное сканирование
         * (11.6.2c.4) считало цену тем же правилом, но БЕЗ ограничения
         * marketScanBuffer (он не больше пачки сервера — 500 записей).
         *
         * @param {object} lot лот из GET /api/auction
         * @returns {{id: string, price: number}|null} null — лот не годится
         */
        lotObservation(lot) {
            const id = String((lot && lot.i) || '').trim();
            const total = Number(lot && lot.p);
            if (!id || !Number.isFinite(total) || total <= 0) return null;

            // Свои лоты не учитываем: иначе игрок сам себе двигал бы медиану.
            const myNick = String(this.myNick || '').toLowerCase();
            const seller = String((lot && lot.s) || '').toLowerCase();
            if (myNick && seller === myNick) return null;

            const qty = Math.max(1, Number(lot && lot.n) || 1);
            return { id, price: Math.max(1, Math.round(total / qty)) };
        },

        /**
         * Снимок витрины -> наблюдения цен для POST /market/scan.
         *
         * Цена берётся ЗА ШТУКУ (l.p / l.n): в l.p лежит сумма за стопку, а
         * медиана считается по одной единице — ровно так же, как локальная
         * статистика модуля (groups.prices). Свои лоты не учитываем: иначе
         * игрок сам себе двигал бы медиану, выставляя «удобные» цены.
         *
         * @param {Array<object>} lots лоты из GET /api/auction
         * @returns {string[]} id предметов снимка (для GET /market/medians)
         */
        collectMarketPrices(lots) {
            const ids = [];
            const seen = new Set();
            if (!Array.isArray(lots) || !lots.length) return ids;

            for (const lot of lots) {
                const obs = this.lotObservation(lot);
                if (!obs) continue;

                if (!seen.has(obs.id)) {
                    seen.add(obs.id);
                    ids.push(obs.id);
                }
                // Буфер ограничен размером пачки сервера: лишние наблюдения
                // просто не копим (следующее открытие витрины их повторит).
                if (this.marketScanBuffer.length < this.MARKET_MAX_BATCH) {
                    this.marketScanBuffer.push(obs);
                }
            }
            return ids;
        },

        /**
         * Отправка накопленных наблюдений в POST /market/scan.
         *
         * Троттлинг 5 минут (ТЗ 11.6.2c.1): витрину можно открывать сколько
         * угодно раз, а сервер получает не больше одной пачки в окно. Пока
         * запрос в полёте, новый не начинаем — иначе на медленной сети
         * получались бы дубли и лишние 429.
         */
        flushMarketScan() {
            if (this.marketScanPending || !this.marketScanBuffer.length) return;
            const now = Date.now();
            if (now - this.marketScanSentAt < this.MARKET_SYNC_MS) return;

            const lots = this.marketScanBuffer.slice(0, this.MARKET_MAX_BATCH);
            // Буфер очищаем сразу: даже при ошибке повторять эти же цены
            // бессмысленно — следующее открытие витрины принесёт свежие.
            this.marketScanBuffer = [];
            this.marketScanSentAt = now;
            this.marketScanPending = true;

            this._marketRequest('POST', '/market/scan', { lots })
                .then((res) => { dbg('[AUCTION] Цены отправлены на сервер:', res && res.count); })
                .catch((e) => { dbg('[AUCTION] Отправка цен не удалась:', e); })
                .finally(() => { this.marketScanPending = false; });
        },

        /**
         * GET /market/medians?ids=… — медианы по всем игрокам с аддоном.
         *
         * Результат МЕРДЖИМ в this.marketMedians ({ id: цена }). null от сервера
         * («наблюдений за 72 часа / последние 100 цен нет») в объект не попадает: отсутствие ключа
         * и означает «данных нет», тултип в этом случае не рисуется.
         *
         * 11.6.2d: раньше объект ЗАМЕНЯЛСЯ ответом на один запрос. Планировщик
         * героя запрашивает всего два id (звезда/сфера), и такая замена стёрла
         * бы медианы всех лотов витрины — тултипы «Медиана рынка» пропали бы до
         * следующего открытия аукциона. Мердж безопасен и для витрины: цены
         * живут 72 часа на сервере, поэтому старый ключ не «протухает» мгновенно.
         *
         * @param {string[]} ids
         */
        async fetchMarketMedians(ids) {
            const list = [];
            for (const raw of Array.isArray(ids) ? ids : []) {
                const id = String(raw || '').trim();
                if (!id || list.includes(id)) continue;
                list.push(id);
                if (list.length >= this.MARKET_MAX_IDS) break;
            }
            if (!list.length) return;

            // Запятые кодируются вместе со списком: сервер разбирает ids через
            // searchParams.get('ids') и получает исходную строку.
            const res = await this._marketRequest('GET', '/market/medians?ids=' + encodeURIComponent(list.join(',')));
            const medians = res && res.medians;
            if (!medians || typeof medians !== 'object') return;

            const next = { ...this.marketMedians };
            for (const id of list) {
                const price = Math.round(Number(medians[id]));
                if (Number.isFinite(price) && price > 0) next[id] = price;
            }
            this.marketMedians = next;
        },

        /**
         * Синхронизация статистики по снимку витрины (v11.6.2c.1):
         *   1) собираем наблюдения цен и раз в 5 минут шлём пачку на сервер;
         *   2) тянем медианы и кладём их в память модуля.
         *
         * Медианы ждём не дольше MARKET_WAIT_MS: если наш сервер молчит,
         * витрина всё равно откроется и покажет локальную медиану.
         *
         * @param {Array<object>} lots лоты из GET /api/auction
         */
        async syncMarketData(lots) {
            const ids = this.collectMarketPrices(lots);
            this.flushMarketScan();
            if (!ids.length) return;

            const medians = this.fetchMarketMedians(ids).catch((e) => {
                dbg('[AUCTION] Медианы сервера недоступны:', e);
            });
            await Promise.race([
                medians,
                new Promise((resolve) => setTimeout(resolve, this.MARKET_WAIT_MS))
            ]);
        },

        /* ---------------------------------------------------------- */
        /* 11.6.2c.4: полное сканирование витрины                     */
        /* ---------------------------------------------------------- */

        /**
         * Время последнего успешного полного сканирования (мс) или 0.
         * localStorage может быть запрещён (приватный режим) — тогда отметки
         * просто нет и кулдаун не работает: ограничение живёт в браузере.
         */
        getFullScanAt() {
            try {
                const at = Number(localStorage.getItem(this.FULL_SCAN_KEY));
                return Number.isFinite(at) && at > 0 ? at : 0;
            } catch (e) {
                return 0;
            }
        },

        /** Остаток кулдауна в мс (0 — сканировать можно). */
        getFullScanCooldownLeft() {
            const at = this.getFullScanAt();
            if (!at) return 0;
            const left = this.FULL_SCAN_COOLDOWN_MS - (Date.now() - at);
            return left > 0 ? left : 0;
        },

        /** Отметка кулдауна; при запрете хранилища молча пропускаем. */
        markFullScanDone() {
            try { localStorage.setItem(this.FULL_SCAN_KEY, String(Date.now())); }
            catch (e) { dbg('[AUCTION] не удалось сохранить отметку полного скана:', e); }
        },

        /**
         * Текст кнопки: «📡 Сканировать весь аукцион» / «⏳ Ждать N мин» /
         * «⏳ Сканирую...». Минуты округляем вверх, чтобы «Ждать 0 мин» не
         * появлялось за секунду до конца кулдауна.
         */
        fullScanButtonLabel() {
            if (this.fullScanPending) return '⏳ Сканирую...';
            const left = this.getFullScanCooldownLeft();
            if (left > 0) return `⏳ Ждать ${Math.ceil(left / 60000)} мин`;
            return '📡 Сканировать весь аукцион';
        },

        /** Приводит кнопку в шапке сканера к текущему состоянию. */
        refreshFullScanButton() {
            const btn = document.getElementById('lg-auction-full-scan');
            if (!btn) return;
            btn.textContent = this.fullScanButtonLabel();
            btn.disabled = this.fullScanPending || this.getFullScanCooldownLeft() > 0;
        },

        /**
         * Тикер кулдауна: раз в секунду пересчитывает текст кнопки. Запускается
         * при открытии сканера и сам останавливается, когда модалку закрыли
         * (кнопки нет в DOM) или кулдаун вышел — тогда кнопка уже активна.
         */
        startFullScanTick() {
            this.stopFullScanTick();
            if (this.getFullScanCooldownLeft() <= 0) {
                this.refreshFullScanButton();
                return;
            }
            this._fullScanTimer = setInterval(() => {
                if (!document.getElementById('lg-auction-full-scan')) {
                    this.stopFullScanTick();
                    return;
                }
                this.refreshFullScanButton();
                if (this.getFullScanCooldownLeft() <= 0) this.stopFullScanTick();
            }, 1000);
        },

        stopFullScanTick() {
            if (this._fullScanTimer) {
                clearInterval(this._fullScanTimer);
                this._fullScanTimer = null;
            }
        },

        /**
         * Лоты ВСЕГО аукциона одним снимком.
         *
         * Игра запрашивает витрину без пагинации: site/auction.js делает один
         * GET /api/auction и читает D.lots целиком, других страниц в клиенте
         * нет (docs/API.md §12 — в ответе тоже нет page/next). Поэтому основная
         * ветка — один fetch.
         *
         * Защита на будущее: если сервер когда-нибудь начнёт отдавать страницы
         * (pages/next/total > lots.length), добираем их циклом ?page=N, пока
         * приходят новые лоты. Дубли отсекаем по id лота, поэтому эндпоинт,
         * игнорирующий ?page, не зациклит нас: страница без новых лотов — конец.
         *
         * @returns {Promise<Array<object>>} лоты (не больше FULL_SCAN_MAX_LOTS)
         */
        async fetchAllAuctionLots() {
            const first = await Utils.fetchApi('/api/auction');
            if (!first || first.ok === false) {
                throw new Error((first && (first.error || first.message)) || 'аукцион не ответил');
            }

            const firstLots = first.lots || (first.body && first.body.lots) || [];
            const lots = Array.isArray(firstLots) ? firstLots.slice(0, this.FULL_SCAN_MAX_LOTS) : [];
            const seen = new Set(lots.map((l) => String((l && l.id) || '')));

            const body = first.body || {};
            const pages = Number(first.pages || body.pages) || 0;
            const total = Number(first.total || body.total) || 0;
            const hasNext = first.next !== undefined || body.next !== undefined;
            if (!(pages > 1 || total > lots.length || hasNext)) return lots;

            for (let page = 2; page <= this.FULL_SCAN_MAX_PAGES; page++) {
                if (lots.length >= this.FULL_SCAN_MAX_LOTS) break;
                const res = await Utils.fetchApi('/api/auction?page=' + page);
                const list = (res && (res.lots || (res.body && res.body.lots))) || [];
                if (!Array.isArray(list) || !list.length) break;

                let added = 0;
                for (const lot of list) {
                    const key = String((lot && lot.id) || '');
                    if (key && seen.has(key)) continue;
                    if (key) seen.add(key);
                    lots.push(lot);
                    added++;
                    if (lots.length >= this.FULL_SCAN_MAX_LOTS) break;
                }
                if (!added) break;
            }
            return lots;
        },

        /**
         * Наблюдения цен по полному снимку витрины: без ограничения буфера в
         * 500 записей, но не больше FULL_SCAN_MAX_LOTS лотов.
         */
        collectFullScanPrices(lots) {
            const out = [];
            if (!Array.isArray(lots)) return out;
            for (const lot of lots) {
                if (out.length >= this.FULL_SCAN_MAX_LOTS) break;
                const obs = this.lotObservation(lot);
                if (obs) out.push(obs);
            }
            return out;
        },

        /**
         * Отправка наблюдений пачками по MARKET_MAX_BATCH (500 — предел
         * POST /market/scan, MARKET_LIMITS.maxLotsPerScan). Последовательно,
         * а не параллельно: сервер пишет каждую пачку транзакцией, залп из
         * десяти запросов ему не нужен.
         *
         * @param {Array<{id: string, price: number}>} observations
         * @returns {Promise<number>} сколько наблюдений принял сервер
         */
        async sendFullScanLots(observations) {
            let sent = 0;
            for (let i = 0; i < observations.length; i += this.MARKET_MAX_BATCH) {
                const batch = observations.slice(i, i + this.MARKET_MAX_BATCH);
                const res = await this._marketRequest('POST', '/market/scan', { lots: batch });
                const counted = Number(res && res.count);
                sent += Number.isFinite(counted) ? counted : batch.length;
            }
            return sent;
        },

        /**
         * Свежие медианы для предметов полного снимка (GET /market/medians).
         *
         * Список режем по MARKET_MAX_IDS (200 — больше сервер за запрос не
         * принимает) и МЕРДЖИМ результат в marketMedians, а не заменяем его:
         * в памяти могут быть медианы предметов, которых в снимке уже нет.
         *
         * @param {string[]} ids
         */
        async refreshMediansForIds(ids) {
            const unique = [];
            const seen = new Set();
            for (const raw of Array.isArray(ids) ? ids : []) {
                const id = String(raw || '').trim();
                if (!id || seen.has(id)) continue;
                seen.add(id);
                unique.push(id);
            }

            const merged = { ...this.marketMedians };
            for (let i = 0; i < unique.length; i += this.MARKET_MAX_IDS) {
                const chunk = unique.slice(i, i + this.MARKET_MAX_IDS);
                const res = await this._marketRequest('GET', '/market/medians?ids=' + encodeURIComponent(chunk.join(',')));
                const medians = res && res.medians;
                if (!medians || typeof medians !== 'object') continue;
                for (const id of chunk) {
                    const price = Math.round(Number(medians[id]));
                    if (Number.isFinite(price) && price > 0) merged[id] = price;
                }
            }
            this.marketMedians = merged;
        },

        /**
         * Полное сканирование витрины (ТЗ 11.6.2c.4).
         *
         * 1. Кулдаун 30 минут (localStorage lgFullScanAt): повторный клик
         *    только показывает тост и ничего не отправляет.
         * 2. Один снимок /api/auction (в игре нет пагинации), максимум 5000 лотов.
         * 3. Цены уходят пачками по 500; после успеха — отметка кулдауна,
         *    свежие медианы и перерисовка таблицы через onRendered().
         *
         * @param {Function} [onRendered] перерисовать витрину (update из open())
         */
        async runFullScan(onRendered) {
            if (this.fullScanPending) return;
            if (this.getFullScanCooldownLeft() > 0) {
                UI.showToast('Сканирование доступно раз в 30 минут', true);
                this.refreshFullScanButton();
                this.startFullScanTick();
                return;
            }

            this.fullScanPending = true;
            this.refreshFullScanButton();
            try {
                const lots = await this.fetchAllAuctionLots();
                const observations = this.collectFullScanPrices(lots);
                if (!observations.length) {
                    UI.showToast('На аукционе нет лотов для сканирования', true);
                    return;
                }

                const sent = await this.sendFullScanLots(observations);

                // Отметку кулдауна ставим ТОЛЬКО после успешной отправки: если
                // наш сервер лежит, игрок не должен ждать 30 минут впустую.
                this.markFullScanDone();
                // Полный снимок уже ушёл — обычный флаш этих же цен не нужен.
                this.marketScanBuffer = [];
                this.marketScanSentAt = Date.now();

                UI.showToast(`✅ Успешно просканировано ${sent} лотов`, false);

                // Медианы ждём не дольше MARKET_WAIT_MS: перерисовка не должна
                // висеть на медленном сервере — тогда останутся старые медианы.
                const ids = [...new Set(observations.map((o) => o.id))];
                await Promise.race([
                    this.refreshMediansForIds(ids).catch((e) => {
                        dbg('[AUCTION] Медианы после полного скана недоступны:', e);
                    }),
                    new Promise((resolve) => setTimeout(resolve, this.MARKET_WAIT_MS))
                ]);

                if (typeof onRendered === 'function') {
                    try { onRendered(); } catch (e) { dbg('[AUCTION] Перерисовка после скана:', e); }
                }
            } catch (e) {
                dbg('[AUCTION] Полное сканирование не удалось:', e);
                UI.showToast('Не удалось просканировать аукцион: ' + (e && e.message ? e.message : e), true);
            } finally {
                this.fullScanPending = false;
                this.startFullScanTick();
                this.refreshFullScanButton();
            }
        },

        /**
         * 11.6.2c.2: медиана сети по предмету из marketMedians.
         * 0 — наблюдений за 72 часа / последние 100 цен нет (колонка показывает «—»).
         *
         * @param {string} itemId
         * @returns {number}
         */
        getMarketMedian(itemId) {
            if (!itemId) return 0;
            const price = +this.marketMedians[itemId] || 0;
            return price > 0 ? price : 0;
        },

        /**
         * 11.6.2d: публичный доступ к медиане для других модулей.
         *
         * Планировщик героя (вкладка «Заточка») берёт отсюда цены звёзд и сфер.
         * 0 означает «наблюдений за 72 часа / последние 100 цен нет» — вызывающий обязан подставить
         * свою базовую цену (фолбэк), иначе стоимость попытки обнулится.
         *
         * @param {string} itemId
         * @returns {number}
         */
        getMedian(itemId) {
            if (!itemId) return 0;
            const price = Number(this.marketMedians[itemId]);
            return Number.isFinite(price) && price > 0 ? price : 0;
        },

        /**
         * title для ячейки «Медиана»: медиана сети из памяти модуля.
         * Пустая строка, если по предмету наблюдений нет (v11.6.2c.2).
         *
         * @param {string} itemId
         * @returns {string}
         */
        marketMedianTitle(itemId) {
            const net = this.getMarketMedian(itemId);
            if (net <= 0) return '';
            return ` title="Медиана сети (72 часа / последние 100 цен): ${Utils.formatMoney(net)}"`;
        },

        // 11.6.2c.2: строка «Медиана рынка» в НАТИВНЫХ подсказках предметов.
        //
        // 11.6.5a.2: основной путь — хук генератора HTML карточки предмета
        // (window.LGInventory.cardHtml, lib/inventory.js): строка вшивается в
        // готовую разметку ЕЩЁ ДО вставки в DOM. Раньше подсказку дописывал
        // MutationObserver, но игра перерисовывает её на pointermove, и каждый
        // такой проход добавлял узел заново — отсюда мерцание.
        //
        // 11.6.5a.3: второй хук — генератор карточки старого тултипа
        // (G.itemBody / G.cardTip, site/app.js). В текущем клиенте эти функции
        // локальны для модуля, поэтому хук ставится «если есть», а страховкой
        // остаётся обход #lg-tip / .tip.card из MutationObserver — строго при
        // отсутствии строки в подсказке.
        //
        // MutationObserver, кроме того, обслуживает плашку лавки города
        // (.cy-icard.on): её HTML генерирует site/cityshop.js, который мы не
        // перехватываем, а перерисовывается она редко (по клику/наведению).
        //
        // id предмета в разметке подсказки нет, поэтому (resolveTipItemId):
        //   1) игра помечает наведённый элемент aria-describedby="<id
        //      подсказки>" (tipPlace в app.js, tipShow в inventory.js) -> читаем
        //      11.6.5a: data-ig (uid в новом инвентаре), data-sel (uid в
        //      сумке), data-item/data-good/data-lot-id (прямой id) и ищем
        //      экземпляр в сумке, на складе (sg.store) и на складе аукциона (ar);
        //      11.6.5a.1: data-k="<uid>|<itemId>|…" у надетых вещей и
        //      data-lore="<itemId>" (.lg-lorebox) внутри самой подсказки;
        //   2) если якорь не помог — сравниваем заголовок подсказки с
        //      названиями из справочника предметов (tipNameIndex).
        // ------------------------------------------------------------
        initItemTips() {
            // Повторный boot() не должен плодить ни хуков, ни наблюдателей.
            this.hookInventoryCardHtml();
            // 11.6.5a.3: генератор карточки старого тултипа (site/app.js).
            this.hookItemBody();
            if (this._tipObserver || typeof MutationObserver === 'undefined') return;

            const check = () => {
                try {
                    // 11.6.5a.3 (п.4): резервный путь для старого тултипа
                    // #lg-tip / .tip.card. Строку добавляем ТОЛЬКО если её нет —
                    // повторной вставки на каждую мутацию не происходит,
                    // поэтому подсказка не мерцает.
                    const lgTip = document.getElementById('lg-tip');
                    if (lgTip && !lgTip.hidden && !lgTip.querySelector('.lg-market-median')) {
                        this.attachMarketMedian(lgTip);
                    }
                    document.querySelectorAll('.tip.card').forEach(el => {
                        if (!el.querySelector('.lg-market-median')) this.attachMarketMedian(el);
                    });
                    // 11.6.5a: плашка товара в лавках города (.cy-icard.on):
                    // она не #lg-tip и не .tip.card, поэтому раньше медиана в
                    // магазинах не появлялась вовсе.
                    document.querySelectorAll('.cy-icard.on').forEach(el => this.attachMarketMedian(el));
                } catch (e) {
                    dbg('[AUCTION] строка медианы в тултипе:', e);
                }
            };

            // Мутаций на странице много (лента чата и т.п.), поэтому проверку
            // склеиваем в один кадр: иначе на каждое сообщение шёл бы обход DOM.
            let scheduled = false;
            const checkSoon = () => {
                if (scheduled) return;
                scheduled = true;
                const run = () => { scheduled = false; check(); };
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
                else setTimeout(run, 16);
            };

            const observer = new MutationObserver(checkSoon);
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['hidden', 'class']
            });
            this._tipObserver = observer;
        },

        /**
         * 11.6.5a.2: перехват генератора HTML карточки предмета нового
         * инвентаря — `window.LGInventory.cardHtml(it, list, opts)`
         * (lib/inventory.js: api.cardHtml). Хук возвращает ту же разметку, но
         * со строкой «📈 Медиана рынка», поэтому дописывать DOM после
         * отрисовки не нужно и подсказка не мерцает.
         *
         * lib/inventory.js подключается отдельным файлом и может быть готов
         * позже нашего init(), поэтому первые 60 секунд ждём появления
         * объекта (интервал 500 мс) и хукаем ровно один раз.
         *
         * @returns {boolean} хук установлен
         */
        hookInventoryCardHtml() {
            if (this._cardHtmlHooked) return true;
            const inv = G.LGInventory;
            if (!inv || typeof inv.cardHtml !== 'function') {
                if (!this._cardHtmlTimer && typeof setInterval === 'function') {
                    let tries = 0;
                    this._cardHtmlTimer = setInterval(() => {
                        tries += 1;
                        if (this.hookInventoryCardHtml() || tries >= 120) {
                            clearInterval(this._cardHtmlTimer);
                            this._cardHtmlTimer = null;
                        }
                    }, 500);
                }
                return false;
            }

            this._cardHtmlHooked = true;
            this._origCardHtml = inv.cardHtml;
            const self = this;
            // arguments пробрасываем как есть: в клиенте сигнатура
            // cardHtml(it, list, opts), но нам нужен только it.
            inv.cardHtml = function () {
                const html = self._origCardHtml.apply(inv, arguments);
                try {
                    return self.injectTipMedian(html, arguments[0]);
                } catch (e) {
                    // Игра не должна страдать из-за нашей строки: отдаём
                    // оригинальную разметку.
                    dbg('[AUCTION] хук cardHtml:', e);
                    return html;
                }
            };
            return true;
        },

        /**
         * 11.6.5a.3: перехват генератора HTML карточки предмета из site/app.js.
         *
         * В референс-сборке `itemBody(it, h, o)` и `cardTip(el, it, h, o)`
         * объявлены ВНУТРИ модуля (function itemBody / function cardTip) и
         * наружу не выложены: window.itemBody и window.cardTip === undefined,
         * наружу идёт только фасад CX, который получает window.LGCity.open —
         * поэтому хук ставим «если есть»: как только клиент выложит генератор
         * в глобальную область, строка начнёт вшиваться в HTML до отрисовки.
         *
         * Пока их нет, работает резервный обход #lg-tip / .tip.card в
         * MutationObserver (только при отсутствии строки, см. initItemTips).
         *
         * @returns {boolean} хук установлен
         */
        hookItemBody() {
            if (this._itemBodyHooked) return true;
            const self = this;

            // Чистая функция, возвращающая HTML строкой — лучший вариант.
            const body = G.itemBody;
            if (typeof body === 'function') {
                this._origItemBody = body;
                this._itemBodyHooked = true;
                G.itemBody = function () {
                    const html = self._origItemBody.apply(G, arguments);
                    try {
                        return self.injectTipMedian(html, arguments[0]);
                    } catch (e) {
                        dbg('[AUCTION] хук itemBody:', e);
                        return html;
                    }
                };
                return true;
            }

            // cardTip: может вернуть строку, а может писать в #lg-tip сам.
            const tip = G.cardTip;
            if (typeof tip === 'function') {
                this._origCardTip = tip;
                this._itemBodyHooked = true;
                G.cardTip = function () {
                    const out = self._origCardTip.apply(G, arguments);
                    if (typeof out === 'string') {
                        try {
                            return self.injectTipMedian(out, arguments[1]);
                        } catch (e) {
                            dbg('[AUCTION] хук cardTip:', e);
                            return out;
                        }
                    }
                    // void: разметка уже улетела в #lg-tip — дописываем строку
                    // один раз (маркер не даст вставить её повторно).
                    try {
                        const openTip = document.getElementById('lg-tip');
                        if (openTip && !openTip.hidden && !openTip.querySelector('.lg-market-median')) {
                            self.attachMarketMedian(openTip);
                        }
                    } catch (e) {
                        dbg('[AUCTION] хук cardTip (dom):', e);
                    }
                    return out;
                };
                return true;
            }

            // Генераторов пока нет — ждём, как и хук LGInventory.cardHtml.
            if (!this._itemBodyTimer && typeof setInterval === 'function') {
                let tries = 0;
                this._itemBodyTimer = setInterval(() => {
                    tries += 1;
                    if (this.hookItemBody() || tries >= 120) {
                        clearInterval(this._itemBodyTimer);
                        this._itemBodyTimer = null;
                    }
                }, 500);
            }
            return false;
        },

        /**
         * Дописать строку медианы в готовый HTML карточки предмета.
         *
         * Вставка идёт через временный контейнер (innerHTML), а не правкой
         * живого DOM: так строка попадает в блок .d-q перед .d-dur и не
         * ломает разметку игры.
         *
         * @param {string} html результат LGInventory.cardHtml
         * @param {object} it предмет ({ id, … })
         * @returns {string} html со строкой .lg-market-median
         */
        injectTipMedian(html, it) {
            if (!html || typeof html !== 'string') return html;
            // Маркер-предохранитель: повторный проход (или чужая строка)
            // второй раз ничего не добавит.
            if (html.indexOf('lg-market-median') !== -1) return html;
            const itemId = it && it.id != null ? String(it.id) : '';
            if (!itemId) return html;

            const price = this.getMarketMedian(itemId);
            if (price <= 0) this.requestTipMedian(itemId, null);
            const text = price > 0 ? Utils.formatMoney(price) : 'загрузка...';
            const line = `<div class="lg-market-median" data-median-id="${Utils.escapeHtml(itemId)}" style="${this.TIP_MEDIAN_LINE_STYLE}">📈 Медиана рынка: ${text}</div>`;

            const temp = document.createElement('div');
            temp.innerHTML = html;
            const qBox = temp.querySelector('.d-q');
            if (qBox) {
                const durEl = qBox.querySelector('.d-dur');
                if (durEl) durEl.insertAdjacentHTML('beforebegin', line);
                else qBox.insertAdjacentHTML('beforeend', line);
            } else {
                temp.insertAdjacentHTML('beforeend', line);
            }
            return temp.innerHTML;
        },

        /**
         * Подставить актуальные цены в уже отрисованные строки «загрузка...».
         *
         * Меняем только текст узла (он помечен data-median-id), поэтому
         * подсказка обновляется на месте: без перерисовки и мерцания.
         */
        refreshOpenTipMedians() {
            let nodes = [];
            try {
                nodes = [...document.querySelectorAll('.lg-market-median[data-median-id]')];
            } catch (e) {
                return;
            }
            for (const node of nodes) {
                const id = node.getAttribute('data-median-id');
                const price = this.getMarketMedian(id);
                if (price > 0) node.textContent = `📈 Медиана рынка: ${Utils.formatMoney(price)}`;
            }
        },

        /**
         * Дописать строку «📈 Медиана рынка: …» в подсказку.
         *
         * 11.6.5a: место вставки зависит от разметки игры:
         *   #lg-tip   (.tip.card) — блок .d-q перед строкой прочности (.d-dur);
         *   .cy-icard (лавка)     — перед кнопкой «Купить…» (.cy-icbuy);
         *   #lgi-tip и прочее     — в конец подсказки.
         *
         * Если медианы в памяти ещё нет, цену дозапрашиваем у сервера и
         * возвращаемся сюда же, когда ответ придёт (requestTipMedian).
         * Повторный вызов безопасен: маркер .lg-market-median не даёт
         * вставить строку дважды.
         *
         * @param {Element} tipEl #lg-tip / #lgi-tip / .tip.card / .cy-icard
         */
        attachMarketMedian(tipEl) {
            if (!tipEl || tipEl.hidden) return;
            if (!tipEl.textContent || !tipEl.textContent.trim()) return;
            if (tipEl.querySelector('.lg-market-median')) return;

            const itemId = this.resolveTipItemId(tipEl);
            if (!itemId) return;

            const price = this.getMarketMedian(itemId);
            if (price <= 0) {
                // 11.6.5a: раньше здесь был голый return, и строка не
                // появлялась до тех пор, пока медиану не подтянет витрина.
                this.requestTipMedian(itemId, tipEl);
                return;
            }

            const line = document.createElement('div');
            line.className = 'lg-market-median';
            // 11.6.5a.3: помечаем строку id предмета, чтобы
            // refreshOpenTipMedians могла обновить цену на месте (без
            // пересоздания узла) — как у строки из HTML-хука.
            line.setAttribute('data-median-id', itemId);
            line.textContent = `📈 Медиана рынка: ${Utils.formatMoney(price)}`;
            this.insertTipMedian(tipEl, line);
        },

        /**
         * Куда вставить строку медианы.
         *
         * Подсказки игры устроены по-разному: карточка предмета держит
         * описание в блоке .d-q вместе со строкой прочности (.d-dur), а
         * плашка лавки заканчивается кнопкой «Купить…» (.cy-icbuy). «В конец»
         * годится только для окна инвентаря #lgi-tip — там плоский список.
         *
         * @param {Element} tipEl
         * @param {Element} line готовая строка .lg-market-median
         */
        insertTipMedian(tipEl, line) {
            // Карточка предмета (site/app.js: itemBody -> .d-q c .d-dur).
            const desc = tipEl.id === 'lg-tip' ? tipEl.querySelector('.d-q') : null;
            if (desc) {
                const dur = desc.querySelector('.d-dur');
                // insertBefore(el, null) === appendChild — когда прочности нет
                // (зелья, материалы) строка встаёт в конец блока.
                desc.insertBefore(line, dur && dur.parentElement === desc ? dur : null);
                return;
            }
            // Плашка лавки города (site/cityshop.js: кнопка .cy-icbuy в конце).
            const buy = tipEl.classList && tipEl.classList.contains('cy-icard')
                ? tipEl.querySelector('.cy-icbuy')
                : null;
            if (buy && buy.parentElement) {
                buy.parentElement.insertBefore(line, buy);
                return;
            }
            tipEl.appendChild(line);
        },

        /**
         * Запросить медиану по предмету, для которого её ещё нет в памяти.
         *
         * Троттлинг по id (TIP_MEDIAN_RETRY_MS): проверка подсказок идёт на
         * каждую мутацию DOM, поэтому без отметки один и тот же id уходил бы
         * в GET /market/medians постоянно.
         *
         * @param {string} itemId
         * @param {Element|null} tipEl подсказка для обновления; null — цену
         *   подставит refreshOpenTipMedians в уже отрисованные строки
         */
        requestTipMedian(itemId, tipEl) {
            if (!itemId || typeof this.fetchMarketMedians !== 'function') return;
            const now = Date.now();
            if (!this._tipMedianAsked) this._tipMedianAsked = new Map();
            const asked = this._tipMedianAsked;
            // Карта растёт на каждый просмотренный предмет — чистим, чтобы не
            // копить записи за долгую сессию.
            if (asked.size > 500) asked.clear();
            if (now - (asked.get(itemId) || 0) < this.TIP_MEDIAN_RETRY_MS) return;
            asked.set(itemId, now);

            Promise.resolve(this.fetchMarketMedians([itemId]))
                .then(() => {
                    // 11.6.5a.2: сначала подставляем цену в уже отрисованные
                    // строки «загрузка...» (их ставит хук cardHtml) — правится
                    // только текст, без перерисовки подсказки.
                    this.refreshOpenTipMedians();
                    // Медиана могла прийти — дописываем строку в ту же
                    // подсказку, если она ещё на экране. Повторного запроса не
                    // будет: отметка в _tipMedianAsked свежая.
                    if (tipEl && tipEl.isConnected && !tipEl.hidden) this.attachMarketMedian(tipEl);
                })
                .catch((e) => dbg('[AUCTION] Медиана для тултипа недоступна:', e));
        },

        /**
         * id предмета по подсказке: сначала якорь (aria-describedby), затем
         * совпадение заголовка с известным названием.
         *
         * 11.6.5a: id возвращается ДАЖЕ без медианы — прежняя проверка
         * getMarketMedian(direct) > 0 отсекала предметы, цены по которым ещё
         * нет, и строка не появлялась никогда (медиану теперь дозапрашивает
         * attachMarketMedian).
         *
         * @param {Element} tipEl
         * @returns {string} '' — предмет не опознан
         */
        resolveTipItemId(tipEl) {
            // 1. Якорь подсказки: игра ставит aria-describedby="lg-tip" на
            //    наведённую ячейку, инвентарь — aria-describedby="lgi-tip".
            const anchor = this.tipAnchor(tipEl);

            // 1.1 11.6.5a.1: data-k="<uid>|<itemId>|<rarity>|…" — так игра
            //     размечает надетые вещи. UID надетого экземпляра в
            //     G.ME.hero.items не лежит (он в слоте экипировки), поэтому
            //     id берём прямо из второго поля. Атрибут с одним полем
            //     (например data-k="atk" у ячейки статов) игнорируем.
            if (anchor) {
                const dataK = anchor.getAttribute('data-k');
                if (dataK) {
                    const parts = String(dataK).split('|');
                    if (parts.length > 1 && parts[1]) return parts[1].trim();
                }
            }

            // 1.2 11.6.5a.1: <div class="lg-lorebox" data-lore="<itemId>"> —
            //     id предмета внутри самой подсказки (LG_LORE.html). Самый
            //     надёжный фолбэк, когда якорь не опознан.
            const loreEl = tipEl.querySelector('[data-lore]');
            if (loreEl) {
                const loreId = (loreEl.getAttribute('data-lore') || '').trim();
                if (loreId) return loreId;
            }

            if (anchor) {
                // Прямые data-атрибуты предмета: наши строки витрины,
                // лавка города (data-good), сторонние аддоны.
                const direct = anchor.getAttribute('data-item-id')
                    || anchor.getAttribute('data-item')
                    || anchor.getAttribute('data-good')
                    || anchor.getAttribute('data-lot-id')
                    || anchor.closest('[data-lot-id]')?.getAttribute('data-lot-id')
                    || '';
                // 11.6.5a: id отдаём даже без медианы — иначе строка не
                // появится никогда (цену дозапрашивает attachMarketMedian).
                if (direct) return direct;

                // data-ig — UID экземпляра в новом инвентаре (lib/inventory.js),
                // data-sel — UID в сумке и надетом (site/app.js).
                const uid = anchor.getAttribute('data-ig') || anchor.getAttribute('data-sel') || '';
                const uidItemId = this.findHeroItemIdByUid(uid);
                if (uidItemId) return uidItemId;
            }

            // 2. По названию из заголовка подсказки.
            const title = this.tipTitleText(tipEl);
            if (!title) return '';
            return this.tipNameIndex()[title] || '';
        },

        /**
         * Элемент, на который наведён курсор (якорь подсказки).
         *
         * 11.6.5a: aria-describedby может содержать несколько id («lg-tip …»),
         * а на странице одновременно живут якоря скрытых панелей — берём
         * видимый. Плашка лавки (.cy-icard) в закреплённом режиме
         * aria-describedby не получает: её подсказка привязана к выбранному
         * товару (класс .on + data-good).
         *
         * @param {Element} tipEl
         * @returns {Element|null}
         */
        tipAnchor(tipEl) {
            const tipId = tipEl && tipEl.id ? String(tipEl.id) : '';
            const found = [];
            if (tipId) {
                let nodes = [];
                try {
                    nodes = [...document.querySelectorAll('[aria-describedby]')];
                } catch (e) {
                    nodes = [];
                }
                for (const el of nodes) {
                    const value = el.getAttribute('aria-describedby') || '';
                    if (!value) continue;
                    if (value === tipId || value.split(/\s+/).includes(tipId)) found.push(el);
                }
            }
            const isCard = !!(tipEl && tipEl.classList && tipEl.classList.contains('cy-icard'));
            if (!found.length && isCard) {
                try {
                    found.push(...document.querySelectorAll(
                        '.cy-hot.on[data-good], .cy-good.on[data-good], .cy-good[aria-pressed="true"]'
                    ));
                } catch (e) { /* селектор не разобрался — опознаем по названию */ }
            }
            if (!found.length) return null;
            // Скрытые панели тоже держат атрибут — предпочитаем видимый якорь.
            return found.find((el) => el.getClientRects().length > 0) || found[0];
        },

        /**
         * Списки экземпляров героя, у которых есть uid: сумка (items),
         * склад (sg.store) и склад аукциона (ar).
         *
         * @returns {Array<Array<object>>}
         */
        heroItemLists() {
            const hero = G.ME && G.ME.hero ? G.ME.hero : null;
            if (!hero) return [];
            const lists = [];
            if (Array.isArray(hero.items)) lists.push(hero.items);
            if (hero.sg && Array.isArray(hero.sg.store)) lists.push(hero.sg.store);
            if (Array.isArray(hero.ar)) lists.push(hero.ar);
            return lists;
        },

        /**
         * id предмета по uid экземпляра. 11.6.5a: ищем не только в сумке, но и
         * на складе (sg.store) и на складе аукциона (ar) — иначе медиана не
         * появлялась для вещей, которые лежат не в сумке.
         *
         * @param {string} uid
         * @returns {string} '' — экземпляр не найден
         */
        findHeroItemIdByUid(uid) {
            if (!uid) return '';
            const target = String(uid);
            for (const list of this.heroItemLists()) {
                const found = list.find(it => it && it.id != null && String(it.uid) === target);
                if (found) return String(found.id);
            }
            return '';
        },

        /**
         * Текст заголовка подсказки в нормализованном виде:
         *   .t-n      — имя предмета в тултипе игры (site/app.js),
         *   .lgi-th b — имя в тултипе инвентаря (lib/inventory.js),
         *   .cy-ich b — имя в плашке лавки города (site/cityshop.js),
         *   .au-cn    — название в карточке лота (site/auction.js).
         */
        tipTitleText(tipEl) {
            const node = tipEl.querySelector('.t-n, .lgi-th b, .cy-ich b, .au-cn, h2.d-n, h3, h4, b');
            if (!node) return '';
            return this.normalizeItemName(node.textContent || '');
        },

        /**
         * Индекс «нормализованное название -> id предмета».
         *
         * 11.6.5a: раньше индексировались только id, по которым уже есть
         * медиана, поэтому название из подсказки не находилось до загрузки
         * цен (а в лавке без открытого аукциона — никогда). Источники:
         *   1) весь справочник предметов аукциона this.lastItemsMap;
         *   2) id медиан и товаров лавок NPC (могут отсутствовать в справочнике);
         *   3) предметы героя — у них есть готовое name/baseName из /api/me.
         * Пересобирается, когда меняется размер любого из источников.
         */
        tipNameIndex() {
            const itemsKey = this.lastItemsMap ? Object.keys(this.lastItemsMap).length : 0;
            const stockKey = this.cityStockMap ? this.cityStockMap.size : 0;
            const heroLists = this.heroItemLists();
            const heroKey = heroLists.reduce((sum, list) => sum + list.length, 0);
            const key = Object.keys(this.marketMedians).sort().join(',')
                + '|' + itemsKey + '|' + stockKey + '|' + heroKey;
            if (this._tipNameIndex && this._tipNameIndexKey === key) return this._tipNameIndex;

            const map = {};
            const add = (id, name) => {
                const norm = this.normalizeItemName(name);
                if (norm && id && !map[norm]) map[norm] = String(id);
            };

            // 1. Справочник предметов витрины (приходит с GET /api/auction).
            const dict = this.lastItemsMap || {};
            for (const id of Object.keys(dict)) {
                const def = dict[id];
                add(id, (def && def.name) || Utils.getItemName(id, dict));
            }
            // 2. Медианы и ассортимент лавок NPC.
            for (const id of Object.keys(this.marketMedians)) add(id, Utils.getItemName(id, dict));
            if (this.cityStockMap) {
                for (const id of this.cityStockMap.keys()) add(id, Utils.getItemName(id, dict));
            }
            // 3. Предметы героя: имя уже пришло с /api/me.
            for (const list of heroLists) {
                for (const it of list) {
                    if (!it || it.id == null) continue;
                    add(it.id, it.name || it.baseName || Utils.getItemName(it.id, dict));
                }
            }
            this._tipNameIndex = map;
            this._tipNameIndexKey = key;
            return map;
        },

        /**
         * Название к сравнимому виду: без регистра и «ё», без хвостов «+3»
         * (заточка) и «×5» (количество).
         */
        normalizeItemName(value) {
            return String(value == null ? '' : value)
                .toLowerCase()
                .replace(/ё/g, 'е')
                .replace(/\s*\+\s*\d+\s*$/, '')
                .replace(/\s*[×x]\s*\d+\s*$/, '')
                .replace(/\s+/g, ' ')
                .trim();
        },

        // 11.5.5: базовая стоимость предмета (v) для расчёта «Вложено».
        // Порядок источников: vals[id] -> def.v -> лавка NPC -> медиана аналогов
        // (тот же слот + редкость) -> ценность по редкости (RARITY_BASE_V).
        // def — описание предмета из items[id] (может быть null/без slot/rarity).
        resolveItemV(id, def, auctionData) {
            // 1. Сервер прислал v напрямую
            if (auctionData && auctionData.vals && auctionData.vals[id]) {
                return auctionData.vals[id];
            }
            if (def && def.v) {
                return def.v;
            }
            // 1.5. Цена в лавке NPC: для товаров магазина это точная база,
            // а в vals её обычно нет (иначе бы сработал шаг 1).
            if (this.cityStockMap && this.cityStockMap.has(id)) {
                const npcPrice = this.cityStockMap.get(id);
                if (npcPrice > 0) return npcPrice;
            }
            const slot = def && def.slot ? String(def.slot).toLowerCase() : '';
            const rarity = def && def.rarity ? String(def.rarity).toLowerCase() : '';
            // 2. Медиана по аналогам (тот же слот + редкость)
            if (auctionData && auctionData.items && auctionData.vals && (slot || rarity)) {
                const peers = Object.entries(auctionData.items)
                    .filter(([peerId, peerDef]) => {
                        if (!peerDef || !auctionData.vals[peerId]) return false;
                        const pSlot = peerDef.slot ? String(peerDef.slot).toLowerCase() : '';
                        const pRarity = peerDef.rarity ? String(peerDef.rarity).toLowerCase() : '';
                        return pSlot === slot && pRarity === rarity;
                    })
                    .map(([peerId]) => auctionData.vals[peerId])
                    .sort((a, b) => a - b);

                if (peers.length > 0) {
                    return peers[Math.floor(peers.length / 2)];
                }
            }
            // 3. Фолбэк по редкости: игра применяет RARITY_LIST напрямую,
            // без множителей по слоту (для epic это 40000).
            return this.RARITY_BASE_V[rarity] || this.RARITY_BASE_V.common;
        },

        getLotEvaluation(lot, data = null, activeMap = null) {
            const en = +lot.e || +lot.en || 0;
            const n = Math.max(1, +lot.n || +lot.qty || 1);
            const price = +lot.p || +lot.totalPrice || 0;
            const unitPrice = price / n;

            // 1. Поиск базовой цены в кэше магазинов
            const shopPrice = this.cityStockMap ? (this.cityStockMap.get(lot.i) || 0) : 0;
            let invested = 0;
            if (en > 0) {
                let itemV = 0;
                const def = (data && data.items) ? data.items[lot.i] : null;
                if (def) {
                    itemV = this.resolveItemV(lot.i, def, data);
                } else if (this.cityStockMap && this.cityStockMap.has(lot.i)) {
                    // Предмета нет в items, но он есть в лавке NPC — берём
                    // точную цену магазина, чтобы не потерять базу (было до refactor'а).
                    itemV = this.cityStockMap.get(lot.i) || 0;
                }

                if (itemV > 0) {
                    // 11.6.5e: цены попыток и минимум берутся из живой таблицы
                    // игры (LG_GAME_DATA.enchant.price / priceMin), фолбэк —
                    // GAME_DATA.ENCHANT_PRICES / ENCHANT_PRICE_MIN.
                    const priceMin = liveEnchantPriceMin();
                    for (let lv = 1; lv <= en; lv++) {
                        invested += Math.max(priceMin, Math.round(itemV * liveEnchantPricePct(lv) / 100));
                    }
                }
            }

            let fairUnit = 0;
            let sourceType = 'none';

            if (shopPrice > 0) {
                // 11.5.5: выгода считается от БАЗОВОЙ цены NPC — заточка больше
                // не добавляет «справедливую цену» (её стоимость видна в «Вложено»).
                sourceType = 'shop';
                fairUnit = shopPrice;
            } else if (data && data.vals && data.vals[lot.i]) {
                sourceType = 'val';
                fairUnit = data.vals[lot.i];
            } else if (activeMap && activeMap.has(lot.i)) {
                const arr = activeMap.get(lot.i);
                if (arr && arr.length >= 2) {
                    const sorted = arr.slice().sort((a, b) => a - b);
                    const med = sorted[Math.floor(sorted.length / 2)];
                    fairUnit = med;
                    sourceType = 'market';
                }
            }

            const fairTotal = fairUnit > 0 ? fairUnit * n : 0;
            let discount = 0;
            if (fairUnit > 0 && unitPrice > 0) {
                discount = Math.round(((fairUnit - unitPrice) / fairUnit) * 100);
            }

            return {
                en,
                n,
                price,
                unitPrice,
                fairUnit,
                fairTotal,
                discount,
                sourceType,
                shopPrice,
                invested
            };
        },

        /**
         * 11.6.2c.3: процент выгоды лота — единый расчёт для колонки
         * «Выгода», фильтра «Только выгодные», сортировки и оповещений.
         *
         * Приоритет ориентира (сверху вниз):
         *   1. медиана сети (marketMedians[id]) — общая статистика игроков с
         *      аддоном за 72 часа / последние 100 цен (GET /market/medians). Именно её показывает
         *      колонка «Медиана», поэтому «Выгода» обязана считаться от неё:
         *      иначе строки расходятся (баг «Стеклянного шарика» — 39с 64
         *      против медианы 44с 8 показывалось минусом, хотя лот дешевле
         *      на 10%, потому что discount шёл от vals/лавки NPC);
         *   2. справедливая цена из getLotEvaluation (лавка NPC -> vals ->
         *      локальная медиана активных лотов) — если сети нет;
         *   3. локальная медиана группы лотов — последний фолбэк.
         *
         * unitPrice — цена ЗА ШТУКУ (l.p / l.n), медианы тоже за штуку,
         * поэтому сравниваем напрямую, без умножения на количество.
         *
         * @param {object} lot лот из groups (с unitPrice)
         * @param {object} ev результат getLotEvaluation
         * @param {number} median локальная медиана группы (за штуку)
         * @returns {{discount:number, ref:number, refSource:string}}
         */
        computeDiscount(lot, ev, median) {
            const unitPrice = +lot?.unitPrice || 0;
            const netMedian = this.getMarketMedian(lot?.i);

            let ref = 0;
            let refSource = 'none';
            if (netMedian > 0) {
                ref = netMedian;
                refSource = 'net';
            } else if (ev && ev.fairUnit > 0) {
                ref = ev.fairUnit;
                refSource = ev.sourceType || 'fair';
            } else if (median > 0) {
                ref = median;
                refSource = 'market';
            }

            if (ref <= 0 || unitPrice <= 0) return { discount: 0, ref, refSource };

            // Процент считается от ориентира (а не от цены лота): «-10%» —
            // лот дешевле медианы на 10%, «+5%» — дороже на 5%.
            const discount = Math.round(((ref - unitPrice) / ref) * 100);
            return { discount, ref, refSource };
        },

        // Парсинг предметов переехал в core/utils-art.js (v11.6.0, этап 4),
        // чтобы не было цикла utils-art.getItemName -> Auction.getItemName:
        //    Auction.getItemName(id, itemsMap) -> Utils.getItemName(id, itemsMap)
        //    Auction.getItemMeta(id, rarityHint) -> Utils.getItemMeta(id, rarityHint)

        // 11.5.5: состояние героя для проверки уровня торговли и фильтра
        // «Мои лоты». /api/me — основной источник (hero.level, hero.tml,
        // user.login); снимок страницы G.ME — резерв, чтобы сканер работал
        // и при молчащем API. Возвращает { hero, login }.
        async fetchMeState() {
            try {
                const res = await Utils.fetchApi('/api/me');
                const hero = res?.hero || res?.body?.hero || null;
                const login = res?.user?.login || res?.body?.user?.login || hero?.login || '';
                if (hero || login) return { hero, login: String(login || '') };
            } catch (e) {
                dbg('[AUCTION] /api/me недоступен:', e);
            }
            // ME живёт в page-context: в песочнице Tampermonkey только через G.
            const me = G.ME || null;
            const hero = me?.hero || me?.me || null;
            const login = me?.user?.login || hero?.login || '';
            return { hero, login: String(login || '') };
        },

        // 11.5.5: короткий сигнал о выгодном лоте через Web Audio API —
        // без внешних файлов и без <audio>. Контекст живёт только на время
        // сигнала: браузер разрешает всего несколько AudioContext на страницу,
        // поэтому после osc.stop() дожидаемся onended и закрываем ctx.
        playAlertSound() {
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                // 1. Узлы сигнала: осциллятор -> усиление -> колонки
                const ctx = new AC();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                // 2. Форма: синус 880 Гц, громкость 0.1 -> 0.01 за 0.5 с
                // (exponentialRampToValueAtTime не принимает 0, минимум 0.0001)
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, ctx.currentTime);
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.5);
                // 3. Освобождаем контекст, иначе за сессию накопится лимит
                osc.onended = () => { try { ctx.close(); } catch (e) {} };
            } catch (e) {
                // Нет AudioContext / запрещён автоплей — просто молчим:
                // оповещение в тосте уже показано.
                dbg('[AUCTION] звук недоступен:', e);
            }
        },

        // 11.5.5: справка «i» в шапке сканера. Числа берём из cfg канала
        // (/api/auction), а если сервер их не прислал — из игровых значений по
        // умолчанию (reference: game-data.js → auction): сбор 1% (мин. 10 меди),
        // комиссия 5%, лимит 10 лотов, сроки 24/48/72 ч. Стоимость заточки — из
        // живой таблицы игры LG_GAME_DATA.enchant.price (идеальная, без учёта
        // шансов), фолбэк — GAME_DATA.ENCHANT_PRICES.
        // v11.6.5b: лимит цены лота — cfg.maxPrice, иначе GAME_DATA.AUCTION_MAX_PRICE.
        showInfo() {
            const c = this.cfg || {};
            const feePct = c.feePct != null ? c.feePct : 1;
            const feeMin = c.feeMin != null ? c.feeMin : 10;
            const comPct = c.com != null ? c.com : 5;
            const maxLots = c.maxLots != null ? c.maxLots : 10;
            const hours = Array.isArray(c.hours) && c.hours.length ? c.hours : [24, 48, 72];
            // v11.6.5b: лимит цены лота — из cfg канала, иначе игровое значение.
            const maxPrice = this.maxLotPrice();
            const tmlNote = this.tradeMinLevel > 1
                ? `сейчас у тебя порог ${this.tradeMinLevel}-го уровня`
                : 'в этом канале ограничения нет';

            // Колонки: [заголовок, пояснение]. Массив вместо десяти <tr> —
            // справку проще править, когда колонок станет больше.
            const cols = [
                ['Вещь', 'Название, редкость, 📊 — история цен, ★/☆ — избранное'],
                ['Кол-во', 'Сколько штук в лоте (если стак)'],
                ['Цена (общая)', 'Стоимость всего лота'],
                ['Цена за 1 шт', 'Цена одной штуки (для стаков)'],
                ['Медиана', 'Медиана сети по наблюдениям за 72 часа / последние 100 цен (наш сервер). Если наблюдений нет — приглушённая локальная медиана активных лотов, иначе «—». Цена лота за штуку ниже медианы на 15% и больше — зелёная, выше на 15% и больше — красная'],
                ['Магазин', 'Цена NPC в официальной лавке (голубая). Строки дешевле магазина подсвечены зелёным'],
                ['Вложено', 'Идеальная (минимальная) стоимость заточки до текущего +N: сумма цен уровней без учёта шансов'],
                ['Выгода', 'На сколько % цена лота за штуку ниже ориентира: сначала медиана сети (72 часа / последние 100 цен), затем лавка NPC/справочная ценность/медиана активных лотов. Зелёный от 10%, красный — дороже ориентира'],
                ['Осталось', 'До конца лота. Если идёт розыгрыш — бейдж 🎲 Розыгрыш'],
                ['Продавец', 'Ник игрока, выставившего лот'],
                ['Действие', 'Купить / 🎲 Хочу (заявка) / Ваш лот / Ур. < N (низкий уровень торговли)']
            ];
            const colsHtml = cols.map(([title, desc], i) => {
                const border = i === cols.length - 1 ? '' : ' border-bottom:1px solid #3d2f44;';
                return `<tr style="${border.trim()}"><td style="padding:6px 8px; color:#ffcf6a; font-weight:bold; width:100px;">${title}</td><td style="padding:6px 8px;">${desc}</td></tr>`;
            }).join('');

            // Внутренний блок скроллится сам: у .modal-compact max-height 65vh,
            // поэтому нужен flex:1 + min-height:0, иначе контент вылезает за рамку.
            UI.showModal(`
                <h2 style="display:flex; align-items:center; gap:10px;">
                    ℹ️ Справка по Аукциону
                    <div style="margin-left:auto; display:flex; gap:8px; align-items:center;">
                        <button id="info-back-btn" style="background:#2a2030; border:1px solid #caa55c; color:#caa55c; padding:4px 10px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">← К витрине</button>
                        <button class="custom-close" id="custom-close-btn">✖</button>
                    </div>
                </h2>
                <div style="flex:1; min-height:0; overflow-y:auto; padding:5px 10px; font-size:13px; line-height:1.6; color:#ccc;">

                    <h3 style="color:#ffcf6a; font-size:14px; margin-top:15px;">🏛 Как работает аукцион</h3>
                    <p>Аукцион — общий рынок между всеми игроками канала. Ты можешь выставлять свои предметы и покупать чужие.</p>
                    <ul style="margin:8px 0; padding-left:20px;">
                        <li><b>Сбор за выставление:</b> <code>max(${feeMin} меди, ${feePct}% от цены)</code>. Списывается сразу и не возвращается, даже если лот снять.</li>
                        <li><b>Комиссия при продаже:</b> <code>${comPct}% от финальной цены</code>. Списывается при получении денег за проданный лот.</li>
                        <li><b>Сроки:</b> ${hours.join(' / ')} ч — по истечении лот снимается с витрины.</li>
                        <li><b>Максимум лотов:</b> ${maxLots} одновременно.</li>
                        <li><b>Минимальный уровень торговли:</b> поле <code>hero.tml</code> — ${tmlNote}.</li>
                        <li><b>Максимальная цена лота:</b> ${maxPrice} меди (${Utils.formatMoney(maxPrice)}). Лот дороже лимита выставить нельзя.</li>
                    </ul>

                    <h3 style="color:#ffcf6a; font-size:14px; margin-top:15px;">📊 Что показывают колонки</h3>
                    <table style="width:100%; border-collapse:collapse; margin-top:8px; font-size:12px;">${colsHtml}</table>

                    <h3 style="color:#ffcf6a; font-size:14px; margin-top:15px;">🎲 Розыгрыш (Raffle)</h3>
                    <p>Свежие лоты не покупаются мгновенно, а разыгрываются. Если видишь кнопку <b style="color:#e0a800;">🎲 Хочу (N)</b> — нажми, чтобы подать заявку; N — сколько заявок уже подано. Монеты спишутся, только если ты выиграешь розыгрыш.</p>

                    <h3 style="color:#ffcf6a; font-size:14px; margin-top:15px;">⭐ Фильтры и функции</h3>
                    <ul style="margin:8px 0; padding-left:20px;">
                        <li><b>⭐ Избранное:</b> звёздочка рядом с предметом добавляет его в отслеживаемые (список ведётся по предмету и хранится в браузере). Галочка «⭐ Избранное» показывает только их.</li>
                        <li><b>Мои лоты:</b> только то, что выставил ты сам (золотой фон, кнопка «Ваш лот»).</li>
                        <li><b>Только выгодные:</b> лоты с выгодой ≥ 10%.</li>
                        <li><b>Звук:</b> при открытии сканера — тост и сигнал, если на витрине есть лоты со скидкой от ${this.alertThreshold}%.</li>
                        <li><b>📊 История:</b> последние цены продаж предмета с учётом заточки (наведи курсор на иконку).</li>
                        <li><b>Пагинация:</b> по ${this.pageSize} лотов на страницу (кнопки ◀ и ▶); счётчик внизу — всего лотов.</li>
                    </ul>

                    <h3 style="color:#ffcf6a; font-size:14px; margin-top:15px;">⚔️ Заточка и цена</h3>
                    <p>Заточка (поле <code>en</code>) БОЛЬШЕ не увеличивает «справедливую цену»: выгода считается от базовой цены NPC/рынка. Вместо этого в колонке <b>«Вложено»</b> показана идеальная (минимальная) стоимость заточки до +N — сумма цен уровней из живой таблицы игры <code>LG_GAME_DATA.enchant.price</code> с учётом <code>priceMin</code> (если игра ещё не загрузилась — фолбэк на <code>GAME_DATA.ENCHANT_PRICES</code> / <code>ENCHANT_PRICE_MIN</code>), без учёта шансов.</p>
                </div>
            `, { compact: true });

            // 11.5.5: «← К витрине» — возврат из справки к сканеру. showModal в
            // начале сам вызывает closeModals(), поэтому просто перерисовываем
            // витрину заново (Auction.open()).
            document.getElementById('info-back-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                UI.closeModals();
                this.open();
            });
        },

        /**
         * v11.6.3: заглушка для персонажа без доступа к аукциону.
         *
         * В городе вход в аукцион проверяет hero.au; без флага комната
         * закрыта, и сканер не должен висеть на пустом ответе /api/auction.
         */
        _showHeroClosed() {
            UI.showModal(`
                <h2>🔒 Аукцион закрыт <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="margin:10px 0; padding:12px 14px; border:1px solid rgba(255,190,90,0.45); border-radius:8px; background:rgba(120,70,20,0.35); color:#ffd9a0; line-height:1.45;">
                    Аукцион пока закрыт для вашего персонажа (требуется разблокировка в игре).
                </div>
                <p style="color:#aaa; font-size:12px; margin:0;">
                    Игра отдаёт доступ флагом <code>hero.au</code> в <code>/api/me</code>.
                    Когда аукцион откроется, сканер заработает без перезапуска аддона.
                </p>
            `, { compact: true });
        },

        /**
         * v11.6.3: причина, по которой предмет нельзя выставить.
         *
         * Легендарная экипировка привязана к персонажу (bound в
         * game-data.js): её нельзя передать, продать на аукционе или
         * сдать в утиль. Материалы под правило не попадают.
         *
         * @returns {string} '' — можно продавать, иначе текст для тултипа.
         */
        sellBlockedReason(item) {
            return isBoundItem(item) ? BOUND_LINE : '';
        },

        /**
         * v11.6.5b: максимальная цена лота в меди.
         *
         * Игра отдаёт лимит в cfg.maxPrice из /api/auction. Конфиг канала
         * важнее игрового значения по умолчанию (на тестовых каналах лимит
         * может быть ниже), а GAME_DATA.AUCTION_MAX_PRICE нужен как фолбэк,
         * пока витрина не открыта и cfg ещё не получен.
         *
         * @returns {number} лимит цены лота, меди.
         */
        maxLotPrice() {
            const cfgMax = Math.trunc(Number(this.cfg && this.cfg.maxPrice));
            return Number.isFinite(cfgMax) && cfgMax > 0 ? cfgMax : GAME_DATA.AUCTION_MAX_PRICE;
        },

        /**
         * v11.6.5b: валидация цены лота перед отправкой в /api/aucSell.
         *
         * Цена — целое число меди в диапазоне 1..maxLotPrice(). Сервер в
         * такой запрос всё равно отвечает отказом, поэтому блокируем раньше,
         * чтобы пользователь не терял сбор за выставление.
         *
         * @param {number} price цена лота, меди.
         * @returns {string} '' — цена допустима, иначе текст для тултипа/алерта.
         */
        priceBlockedReason(price) {
            const p = Number(price);
            if (!Number.isFinite(p) || p <= 0) return 'Цена лота должна быть больше нуля';
            if (Math.trunc(p) !== p) return 'Цена лота указывается целым числом меди';
            const max = this.maxLotPrice();
            if (p > max) return `Максимальная цена лота: ${max}`;
            return '';
        },

        /**
         * v11.6.5b: ограничение ввода пользователя — цена обрезается до
         * лимита канала и приводится к целым меди (для поля ввода лота).
         * 0 означает «цена не задана» и вызывающий код должен это отсечь.
         *
         * @param {number} price введённая цена, меди.
         * @returns {number} цена в диапазоне 0..maxLotPrice().
         */
        clampLotPrice(price) {
            const p = Math.trunc(Number(price));
            if (!Number.isFinite(p) || p <= 0) return 0;
            return Math.min(p, this.maxLotPrice());
        },

        async open() {
            UI.showModal(`<h2>🔍 Сканер Аукциона <button class="custom-close" id="custom-close-btn">✖</button></h2><div class="loader">Считаем цены...</div>`);
            try {
                // v11.6.3: состояние героя нужно ДО запроса витрины — в игре
                // появился флаг доступа hero.au. Без него комната аукциона
                // закрыта заглушкой, а /api/auction отдаёт отказ/пустоту.
                const me = await this.fetchMeState().catch(() => null);
                this.myLevel = +me?.hero?.level || 1;
                this.tradeMinLevel = +me?.hero?.tml || 0;
                this.myNick = String(me?.login || '').toLowerCase();
                if (me && me.hero && !me.hero.au) {
                    this._showHeroClosed();
                    return;
                }
                if (!this.cityStockLoaded) {
                    await this.fetchCityStock();
                    // fetchCityStock ограничен таймаутом (8 с): если цены магазина
                    // не загрузились, продолжаем без них — оценка пойдёт по
                    // data.vals / медиане рынка, но модалка не зависнет.
                    if (!this.cityStockLoaded) {
                        dbg('[AUCTION] Цены магазинов недоступны — считаем без них');
                    }
                }
                const res = await Utils.fetchApi('/api/auction');
                const lots = res.lots || res.body?.lots;
                if (!lots || !Array.isArray(lots) || !lots.length) {
                    return UI.showModal('<h2>Аукцион пуст <button class="custom-close" id="custom-close-btn">✖</button></h2>');
                }
                const itemsMap = res.items || res.body?.items || (res.data && res.data.items) || {};
                // 11.6.2c.2: кэш справочника — по нему тултипы предметов
                // сопоставляют название с id при поиске медианы.
                this.lastItemsMap = itemsMap;
                // 11.5.5: история последних цен по предметам — { id: [[цена, заточка], …] }.
                const histMap = res.hist || res.body?.hist || {};
                // Конфиг канала: сбор за выставление, комиссия, сроки, лимит лотов.
                this.cfg = res.cfg || res.body?.cfg || null;

                // 11.6.2c.1: статистика цен. Вызываем после того, как известен
                // ник (по нему отбрасываются свои лоты), но до отрисовки —
                // медианы сети нужны для тултипа колонки «Медиана». Ждём их не
                // дольше MARKET_WAIT_MS, так что недоступный сервер витрину не
                // задерживает.
                await this.syncMarketData(lots);

                // Новый скан витрины — всегда с первой страницы.
                this.currentPage = 0;

                const groups = {};
                lots.forEach(l => {
                    if (!l.i || !l.p || l.p <= 0) return;

                    const qty = l.n || 1;
                    const unitPrice = l.p / qty;
                    const en = Number(l.e || l.en || l.enchant || 0);
                    const groupKey = `${l.i}_${en}`;

                    if (!groups[groupKey]) {
                        groups[groupKey] = { id: l.i, e: en, prices: [], lots: [] };
                    }
                    groups[groupKey].prices.push(unitPrice);
                    groups[groupKey].lots.push({ ...l, unitPrice, qty, en });
                });

                const activeMap = new Map();
                for (const key in groups) {
                    activeMap.set(groups[key].id, groups[key].prices);
                }

                const processed = [];
                for (const key in groups) {
                    const group = groups[key];
                    const median = Utils.calculateMedian(group.prices);
                    // Редкость по приоритету: лот сервера (l.rarity) → itemsMap (def.rarity) → эвристика по ID.
                    // itemsMap уже приходит в ответе аукциона и используется ниже для арта строк,
                    // поэтому берём редкость оттуда раньше, чем regex-эвристику getItemMeta.
                    const serverRarity = group.lots.map(l => l.rarity).find(r => r)
                        || (itemsMap && itemsMap[group.id] && itemsMap[group.id].rarity)
                        || '';
                    const meta = Utils.getItemMeta(group.id, serverRarity); // Получаем слот, редкость, класс
                    // v11.6.3: привязанная легендарка не продаётся. Если сервер
                    // всё же прислал такой лот — помечаем и блокируем покупку,
                    // чтобы не ловить отказ уже после клика.
                    const bound = !!this.sellBlockedReason({
                        rarity: meta.rarity,
                        slot: meta.slot,
                        // Явный флаг сервера (если когда-нибудь появится у лота).
                        bound: group.lots.some(l => l.bound === true)
                    });

                    group.lots.forEach(l => {
                        const ev = this.getLotEvaluation(l, res, activeMap);
                        // 11.6.2c.3: «Выгода» и «Медиана» считаются от ОДНОГО
                        // ориентира — медианы сети, если она есть. В поле median
                        // кладём тот же ориентир, чтобы сортировка по колонке
                        // «Медиана» и подсветка ±15% (11.6.2c.2) не расходились
                        // с числом в колонке «Выгода».
                        const discCalc = this.computeDiscount(l, ev, median);
                        const basePrice = discCalc.ref > 0 ? discCalc.ref : (ev.fairUnit > 0 ? ev.fairUnit : median);
                        const disc = discCalc.discount;
                        const en = Number(l.en || l.e || l.enchant || 0);

                        processed.push({
                            id: l.i,
                            e: en,
                            name: Utils.getItemName(l.i, itemsMap) + (en > 0 ? ' +' + en : ''),
                            icon: Utils.getItemIcon(l.i),
                            qty: l.qty,
                            totalPrice: l.p,
                            unitPrice: l.unitPrice,
                            median: basePrice,
                            discount: disc,
                            timeLeft: Utils.formatTimeLeft(l.u),
                            // 11.6.2c.5: числовая метка конца торгов — по ней
                            // сортирует колонка «Осталось» (th data-sort="u").
                            // Раньше поля не было, и клик по колонке ничего не менял.
                            u: l.u || 0,
                            seller: l.sn || l.s || '—',
                            // 11.5.5: логин продавца отдельно от отображаемого имени:
                            // «Мои лоты» сравнивают именно логин (me.user.login).
                            sellerLogin: l.s || '',
                            metaSlot: meta.slot,
                            metaRarity: meta.rarity,
                            metaRole: meta.role,
                            // v11.6.3: bound из game-data.js (legendary, не материал).
                            bound,
                            sourceType: ev.sourceType,
                            // 11.6.2c.3: от чего именно посчитана «Выгода» —
                            // net (медиана сети) / shop / val / market / none.
                            refSource: discCalc.refSource,
                            lotId: l.id,
                            // 11.5.5: ru — время окончания розыгрыша (0/undefined у
                            // обычного лота), wn — число заявок «Хочу» в розыгрыше.
                            ru: l.ru || null,
                            wn: +l.wn || 0,
                            // 11.5.5: цена этого предмета в магазинах NPC
                            // (/api/city/stock). 0 — в магазинах не продаётся.
                            npcPrice: this.cityStockMap.get(l.i) || 0,
                            // 11.5.5: идеальная (минимальная) стоимость заточки
                            // до текущего +N — для колонки «Вложено».
                            invested: ev.invested || 0
                        });
                    });
                }

                // 11.5.5: оповещение о лотах с большой скидкой. Считаем по всем
                // обработанным лотам (не по текущей странице и не по фильтрам):
                // смысл сигнала — «на витрине есть выгодное», а не «на экране».
                const goodDeals = processed.filter(l => l.discount >= this.alertThreshold);
                if (goodDeals.length > 0) {
                    UI.showToast(`🔥 Найдено выгодных лотов: ${goodDeals.length}!`, false);
                    if (this.alertSoundEnabled) this.playAlertSound();
                }

                UI.showModal(`
                    <h2 class="auc-head">
                        <span class="auc-head-title">🔍 Сканер Аукциона</span>
                        <button id="auction-info-btn" class="auc-info-btn" title="Справка по аукциону">i</button>
                        <button id="lg-auction-full-scan" class="btn auc-scan-btn" title="Снять цены со всех лотов витрины (доступно раз в 30 минут)">📡 Сканировать весь аукцион</button>
                        <button class="custom-close" id="custom-close-btn" style="margin-left:auto;">✖</button>
                    </h2>

                    <div class="auc-toolbar">
                        <div class="auc-toolbar-row">
                            <input type="text" id="auction-search" class="auc-search-input" placeholder="🔍 Поиск по названию...">

                            <select id="auction-filter-slot" class="auc-select">
                                <option value="">📦 Все слоты</option>
                                <option value="weapon">Оружие</option>
                                <option value="armor">Броня</option>
                                <option value="shield">Щит</option>
                                <option value="helmet">Шлем</option>
                                <option value="trinket">Амулет</option>
                                <option value="scroll">📜 Свитки / Печати</option>
                                <option value="food">Еда / Зелья</option>
                                <option value="material">Материал</option>
                            </select>

                            <select id="auction-filter-rarity" class="auc-select">
                                <option value="">✨ Все редкости</option>
                                <option value="common">Обычное</option>
                                <option value="uncommon">Необычное</option>
                                <option value="rare">Редкое</option>
                                <option value="epic">Эпическое</option>
                                <option value="legendary">Легендарное</option>
                            </select>

                            <select id="auction-filter-role" class="auc-select">
                                <option value="">🛡️ Все классы</option>
                                <option value="legionary">Легионер</option>
                                <option value="archer">Лучник</option>
                                <option value="mage">Маг</option>
                                <option value="priest">Жрец</option>
                                <option value="rogue">Разбойник</option>
                                <option value="necromancer">Некромант</option>
                                <option value="paladin">Паладин</option>
                            </select>

                        </div>

                        <div class="auc-toolbar-row">
                            <label class="auc-filter-chip"><input type="checkbox" id="auction-my-lots" ${this.showMyLotsOnly ? 'checked' : ''}><span>👤 Мои лоты</span></label>
                            <label class="auc-filter-chip"><input type="checkbox" id="auction-favs" ${this.showFavoritesOnly ? 'checked' : ''}><span>⭐ Избранное</span></label>
                            <label class="auc-filter-chip"><input type="checkbox" id="auction-only-deals"><span>🔥 Только выгодные</span></label>
                            <label class="auc-filter-chip"><input type="checkbox" id="auction-sound" ${this.alertSoundEnabled ? 'checked' : ''}><span>🔔 Звук</span></label>

                            <div class="auc-pager">
                                <button id="auction-prev" class="auc-page-btn" title="Предыдущая страница">◀</button>
                                <span id="auction-page-info" class="auc-page-info">Стр. 1 из 1</span>
                                <button id="auction-next" class="auc-page-btn" title="Следующая страница">▶</button>
                            </div>
                        </div>
                    </div>

                    <div class="table-container auc-table-wrap">
                        <table class="auc-table">
                            <colgroup>
                                <col>
                                <col style="width:130px;">
                                <col style="width:120px;">
                                <col style="width:92px;">
                                <col style="width:104px;">
                                <col style="width:96px;">
                            </colgroup>
                            <thead><tr>
                                <th data-sort="name">Предмет</th>
                                <th data-sort="totalPrice">Цена</th>
                                <th data-sort="median" title="Медиана сети по наблюдениям за 72 часа / последние 100 цен (legion.ctrlfree.host). Без наблюдений — локальная медиана активных лотов">Медиана</th>
                                <th data-sort="discount">Выгода</th>
                                <th data-sort="u">Осталось</th>
                                <th class="auc-col-action">Действие</th>
                            </tr></thead>
                            <tbody id="auction-body"></tbody>
                        </table>
                    </div>
                    <div class="auc-footer">
                        Всего лотов: <span id="auction-count">0</span> · на странице до ${this.pageSize}
                    </div>`, { customClass: 'auc-modal' });

                // Кнопка «i» в шапке: UI.showModal в начале зовёт closeModals(),
                // поэтому справка просто заменяет витрину (клик по витрине не нужен).
                document.getElementById('auction-info-btn')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showInfo();
                });

                // Сколько страниц было в последней отрисовке (для кнопки ▶).
                let lastTotalPages = 1;
                const renderTable = (data) => {
                    const tbody = document.getElementById('auction-body');
                    const countEl = document.getElementById('auction-count');
                    if (!tbody) return;

                    countEl.textContent = data.length;

                    // Пагинация: totalPages считается по отфильтрованному списку,
                    // поэтому смена фильтра/поиска сразу пересчитывает и её.
                    lastTotalPages = Math.max(1, Math.ceil(data.length / this.pageSize));
                    const pageInfo = document.getElementById('auction-page-info');
                    if (pageInfo) pageInfo.textContent = `Стр. ${this.currentPage + 1} из ${lastTotalPages}`;
                    const prevBtn = document.getElementById('auction-prev');
                    const nextBtn = document.getElementById('auction-next');
                    if (prevBtn) {
                        const off = this.currentPage <= 0;
                        prevBtn.disabled = off;
                        prevBtn.style.opacity = off ? '0.4' : '1';
                        prevBtn.style.cursor = off ? 'not-allowed' : 'pointer';
                    }
                    if (nextBtn) {
                        const off = this.currentPage + 1 >= lastTotalPages;
                        nextBtn.disabled = off;
                        nextBtn.style.opacity = off ? '0.4' : '1';
                        nextBtn.style.cursor = off ? 'not-allowed' : 'pointer';
                    }

                    if (!data.length) {
                        // 11.6.2c.5: в таблице 6 колонок (было 11).
                        tbody.innerHTML = '<tr><td colspan="6" class="auc-empty" style="text-align:center; color:#888; padding:20px;">Ничего не найдено по заданным фильтрам.</td></tr>';
                        return;
                    }

                    const start = this.currentPage * this.pageSize;
                    const displayList = data.slice(start, start + this.pageSize);
                    let html = '';

                    displayList.forEach(l => {
                        // 11.6.2c.5: классы подсветки цены сохранены (cls) — они же
                        // используются на бейдже «Выгода» вместе с .auc-deal-badge.
                        const cls = l.discount >= 20 ? 'deal-great' : (l.discount >= 10 ? 'deal-good' : (l.discount < 0 ? 'deal-bad' : 'stat-eq'));
                        const dealCls = l.discount >= 20 ? 'great' : (l.discount >= 10 ? 'good' : (l.discount < 0 ? 'bad' : 'neutral'));

                        // 11.5.5: розыгрыш идёт, пока не истекло время ru;
                        // порог tml блокирует покупку у игроков на низком уровне.
                        const isRaffle = l.ru && l.ru > Date.now();
                        const isLowLevel = this.myLevel < this.tradeMinLevel;

                        // 11.5.5: «свой» лот (продавец = логин из /api/me) и цена
                        // того же предмета в магазинах NPC. NPC торгует за 1 шт.,
                        // поэтому сравниваем с ценой лота за штуку, а не с общей.
                        const isCur = !!this.myNick && (
                            String(l.sellerLogin || '').toLowerCase() === this.myNick
                            || String(l.seller || '').toLowerCase() === this.myNick
                        );
                        const npcPrice = +l.npcPrice || this.cityStockMap.get(l.id) || 0;
                        const isCheap = npcPrice > 0 && l.unitPrice < npcPrice;
                        // 11.6.2c.5: цена NPC больше не отдельная колонка — это чип
                        // в карточке предмета. Нет цены NPC — чипа нет вовсе.
                        const npcChip = npcPrice > 0
                            ? (isCheap
                                ? `<span class="auc-chip-tag npc-cheap" title="Лот дешевле, чем в магазине NPC (${Utils.formatMoney(npcPrice)})">🔥 Дешевле NPC</span>`
                                : `<span class="auc-chip-tag" title="Цена в магазине NPC">🛒 ${Utils.formatMoney(npcPrice)}</span>`)
                            : '';

                        // v11.6.3: привязанная легендарка (bound) — показываем
                        // бейдж и блокируем покупку: сервер такую вещь не отдаст.
                        const boundChip = l.bound
                            ? `<span class="auc-chip-tag bound" title="${BOUND_LINE}">🔒 Привязана</span>`
                            : '';

                        // 11.6.2c.3: подсветка цены синхронизирована с колонкой
                        // «Выгода» — обе опираются на ОДИН ориентир (медиана сети
                        // в приоритете), поэтому строки больше не противоречат
                        // друг другу. Порог ±15% из 11.6.2c.2 сохранён: discount
                        // > 0 — лот дешевле ориентира.
                        const netMedian = this.getMarketMedian(l.id);
                        let priceCls = '';
                        if (l.discount >= 15) priceCls = 'auction-deal';
                        else if (l.discount <= -15) priceCls = 'auction-overpriced';
                        // Ячейка «Медиана»: медиана сети; если её нет — приглушённая
                        // локальная; если нет и локальной — прочерк.
                        const medianHtml = netMedian > 0
                            ? `<span class="auction-median-col">${Utils.formatMoney(netMedian)}</span>`
                            : (l.median > 0
                                ? `<span class="auction-median-col" style="opacity:0.45;">${Utils.formatMoney(l.median)}</span>`
                                : '<span style="color:#555;">—</span>');
                        const medianTitle = this.marketMedianTitle(l.id)
                            || (l.median > 0
                                ? ' title="Медиана сети (72 часа / последние 100 цен): нет данных — показана локальная медиана активных лотов"'
                                : ' title="Медиана сети (72 часа / последние 100 цен): нет данных"');

                        // 11.5.5: «Вложено» — идеальная (минимальная) стоимость
                        // заточки до +N (см. getLotEvaluation). 11.6.2c.5: отдельной
                        // колонки нет — у заточенных лотов это чип ⚒️ в карточке,
                        // у незаточенных чип не рендерится.
                        const investedHtml = l.invested > 0
                            ? `<span class="auc-chip-tag invested" title="Идеальная стоимость заточки до +${l.e || 0}">⚒️ ${Utils.formatMoney(l.invested)}</span>`
                            : '';

                        // Приоритет подсветки: дешевле магазина > мой лот.
                        // 11.6.2c.5: раньше это был инлайн-фон <tr>, но у карточных
                        // строк фон рисуют <td> (.auc-row td), поэтому подсветка
                        // переехала в классы строки.
                        const rowCls = 'auc-row' + (isCheap ? ' is-cheap' : (isCur ? ' is-cur' : ''));

                        let btnText = 'Купить';
                        let btnColor = '#28a745';
                        let btnDisabled = false;

                        if (l.bound) {
                            // v11.6.3: привязанную вещь купить нельзя.
                            btnText = '🔒 Привязана';
                            btnColor = '#555';
                            btnDisabled = true;
                        } else if (isCur) {
                            // Свой лот сервер всё равно не даст купить — не шлём запрос.
                            btnText = 'Ваш лот';
                            btnColor = '#555';
                            btnDisabled = true;
                        } else if (isLowLevel) {
                            btnText = `Ур. < ${this.tradeMinLevel}`;
                            btnColor = '#555';
                            btnDisabled = true;
                        } else if (isRaffle) {
                            btnText = `🎲 Хочу (${l.wn})`;
                            btnColor = '#e0a800';
                        }

                        // В колонке «Осталось» у розыгрыша бейдж вместо таймера:
                        // обычный formatTimeLeft(l.u) показывал бы конец торгов,
                        // а не конец розыгрыша.
                        const timeStr = isRaffle
                            ? '<span style="color:#e0a800;">🎲 Розыгрыш</span>'
                            : Utils.escapeHtml(l.timeLeft);

                        // 11.6.2c.5: редкость задаёт цвет левой полоски и названия
                        // (переменная --rc в styles.js), отдельный бейдж не нужен.
                        const rarity = l.metaRarity || 'common';

                        // 11.5.5: история цен из /api/auction (hist) — по предмету,
                        // записи вида [цена, заточка]. Показываем 📊 с полной
                        // историей в title: строк много, в ячейку они не влезут.
                        const histArr = Array.isArray(histMap[l.id]) ? histMap[l.id] : null;
                        let histIcon = '';
                        if (histArr && histArr.length > 0) {
                            const tooltip = histArr
                                .map(h => `${Utils.formatMoney(h[0])} (заточка +${h[1] || 0})`)
                                .join('\n');
                            histIcon = `<span title="${Utils.escapeHtml(tooltip)}" style="cursor:help; margin-left:5px; font-size:12px;">📊</span>`;
                        }

                        // 11.5.5: ★/☆ — «Избранное». Хранится по id предмета,
                        // поэтому звезда одинакова у всех лотов этого предмета.
                        const isFav = this.favorites.has(l.id);
                        const starHtml = `<span class="auc-fav-btn" data-id="${Utils.escapeHtml(l.id || '')}" title="${isFav ? 'Убрать из избранного' : 'В избранное'}" style="cursor:pointer; font-size:16px; margin-left:5px; color:${isFav ? '#ffd700' : '#555'};">${isFav ? '★' : '☆'}</span>`;

                        // 11.6.2c.5: карточная строка (6 колонок). Арт предмета
                        // (.b-lot-art) вставляет enhanceAuctionRows() первым
                        // ребёнком .auc-item-flex — то есть слева от .auc-item-info.
                        html += `<tr class="${rowCls}" data-r="${rarity}" data-lot-id="${Utils.escapeHtml(l.id || '')}" data-lot-name="${Utils.escapeHtml(l.name || '')}">
                            <td>
                                <div class="auc-item-flex">
                                    <div class="auc-item-info">
                                        <div class="auc-item-title">
                                            <span class="auc-item-name" title="${Utils.escapeHtml(l.name)}">${Utils.escapeHtml(l.name)}</span>
                                            ${l.qty > 1 ? `<span class="auc-item-qty">×${l.qty}</span>` : ''}
                                            ${histIcon}${starHtml}
                                        </div>
                                        <div class="auc-item-sub">
                                            <span class="auc-rarity-dot"></span>
                                            <span>${Utils.escapeHtml(l.metaRarity || '—')}</span>
                                            <span class="auc-item-seller" title="Продавец">👤 ${Utils.escapeHtml(l.seller || '—')}</span>
                                            ${investedHtml}${npcChip}${boundChip}
                                        </div>
                                    </div>
                                </div>
                            </td>
                            <td>
                                <div class="auc-price-box">
                                    <span class="auc-price-total${priceCls ? ' ' + priceCls : ''}">${Utils.formatMoney(l.totalPrice)}</span>
                                    ${l.qty > 1 ? `<span class="auc-price-unit">${Utils.formatMoney(l.unitPrice)} / шт</span>` : ''}
                                </div>
                            </td>
                            <td${medianTitle}>
                                <div class="auc-price-box">${medianHtml}</div>
                            </td>
                            <td><span class="auc-deal-badge ${dealCls} ${cls}">${l.discount > 0 ? '−' : '+'}${Math.abs(l.discount)}%</span></td>
                            <td><span class="auc-time${isRaffle ? ' raffle' : ''}">${timeStr}</span></td>
                            <td style="text-align:center;">
                                <button class="auc-buy-btn" data-buy-lot="${l.lotId || l.id}" data-price="${l.totalPrice}" data-name="${Utils.escapeHtml(l.name)}" data-raffle="${!!isRaffle}" data-raffle-end="${l.ru || 0}" style="background:${btnColor}; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:${btnDisabled ? 'not-allowed' : 'pointer'}; font-size:12px; width:100%;" ${btnDisabled ? 'disabled' : ''}>${btnText}</button>
                            </td>
                        </tr>`;
                    });
                    tbody.innerHTML = html;
                    // Обогащаем строки: арт + иконки монет (общий код для Ultimate и Personal)
                    try {
                        if (Utils && Utils.enhanceAuctionRows) Utils.enhanceAuctionRows(tbody, itemsMap);
                    } catch (e) { dbg('enhanceAuctionRows error:', e); }
                };

                const tbody = document.getElementById('auction-body');
                if (tbody) {
                    tbody.addEventListener('click', async (e) => {
                        const btn = e.target.closest('.auc-buy-btn');
                        if (!btn || btn.disabled) return;
                        const lotId = btn.getAttribute('data-buy-lot');
                        const price = Number(btn.getAttribute('data-price'));
                        const name = btn.getAttribute('data-name') || 'предмет';
                        // 11.5.5: розыгрыш помечается на кнопке при отрисовке.
                        const isRaffle = btn.getAttribute('data-raffle') === 'true';
                        const raffleEnd = Number(btn.getAttribute('data-raffle-end')) || 0;
                        if (!lotId) {
                            alert('Не удалось определить ID лота');
                            return;
                        }
                        // Защита от ложных покупок: цена/уровень могли измениться
                        // после отрисовки таблицы — проверяем ещё раз перед запросом.
                        if (!Number.isFinite(price) || price <= 0) {
                            alert('Некорректная цена лота — обновите список');
                            return;
                        }
                        // 11.6.5b: цена лота выше лимита (GAME_DATA.AUCTION_MAX_PRICE
                        // или cfg.maxPrice канала) — такой лот сервер принимать не
                        // должен, значит данные устарели или подменены: блокируем.
                        const priceBlock = this.priceBlockedReason(price);
                        if (priceBlock) {
                            alert(priceBlock);
                            return;
                        }
                        if (this.myLevel < this.tradeMinLevel) {
                            alert(`Обмен и передача доступны с ${this.tradeMinLevel} уровня (сейчас у тебя ${this.myLevel}-й)`);
                            return;
                        }
                        // Розыгрыш закончился между отрисовкой и кликом: без этого
                        // «Хочу» улетал бы как покупка по старой цене.
                        if (isRaffle && raffleEnd && raffleEnd <= Date.now()) {
                            alert('Розыгрыш уже завершён — обновите список');
                            return;
                        }

                        const actionText = isRaffle ? 'подать заявку на розыгрыш' : 'купить';
                        if (!window.confirm(`Вы уверены, что хотите ${actionText} ${name} за ${Utils.formatMoney(price)}?`)) return;

                        btn.disabled = true;
                        const origText = btn.textContent;
                        btn.textContent = '...';

                        try {
                            const res = await Utils.fetchApi('/api/aucBuy', { lot: String(lotId), price: Number(price) });
                            const data = res?.body || res;
                            if (data && (data.ok || data.success || !data.error)) {
                                const successMsg = isRaffle ? 'Заявка на розыгрыш подана!' : `Успешно куплено: ${name}!`;
                                alert(successMsg);
                                Auction.open(); // перезагрузить список
                            } else {
                                const errMsg = data?.error || data?.msg || data?.err || 'Не удалось купить лот';
                                alert(isRaffle ? `Ошибка заявки: ${errMsg}` : `Ошибка покупки: ${errMsg}`);
                                btn.disabled = false;
                                btn.textContent = origText;
                            }
                        } catch (err) {
                            alert(isRaffle ? `Ошибка заявки: ${err.message || err}` : `Ошибка покупки: ${err.message || err}`);
                            btn.disabled = false;
                            btn.textContent = origText;
                        }
                    });
                }

                let current = [...processed], sortCol = 'discount', sortAsc = false;

                const update = () => {
                    const q = document.getElementById('auction-search').value.toLowerCase();
                    const fSlot = document.getElementById('auction-filter-slot').value;
                    const fRarity = document.getElementById('auction-filter-rarity').value;
                    const fRole = document.getElementById('auction-filter-role').value;
                    const onlyDeals = document.getElementById('auction-only-deals').checked;

                    let filtered = current.filter(l => {
                        if (q && !l.name.toLowerCase().includes(q)) return false;
                        // Если фильтр выбран, предмет ОБЯЗАН иметь этот слот. Если слот неизвестен (пустой) — скрываем его.
                        if (fSlot && l.metaSlot !== fSlot) return false;
                        if (fRarity && l.metaRarity !== fRarity) return false;
                        // Универсальные предметы (без роли) должны проходить фильтр класса
                        if (fRole && l.metaRole && l.metaRole !== fRole) return false;

                        if (onlyDeals && l.discount < this.dealFilterMin) return false;
                        // 11.5.5: «Мои лоты» — продавец совпадает с логином из /api/me.
                        // Сравниваем и логин, и отображаемое имя: сервер отдаёт их
                        // раздельно (s / sn), а имя героя может не совпадать с логином.
                        // Без логина фильтр бесполезен — список остаётся пустым.
                        if (this.showMyLotsOnly) {
                            const byLogin = String(l.sellerLogin || '').toLowerCase() === this.myNick;
                            const byName = String(l.seller || '').toLowerCase() === this.myNick;
                            if (!this.myNick || (!byLogin && !byName)) return false;
                        }
                        // «Избранное» — по id предмета (см. комментарий у favorites).
                        if (this.showFavoritesOnly && !this.favorites.has(l.id)) return false;
                        return true;
                    });

                    // Пагинация: после смены фильтров страниц может стать меньше,
                    // поэтому currentPage прижимаем к последней существующей.
                    const totalPages = Math.ceil(filtered.length / this.pageSize);
                    if (this.currentPage >= totalPages) this.currentPage = Math.max(0, totalPages - 1);
                    renderTable(filtered);
                };

                current.sort((a, b) => b.discount - a.discount);
                update();

                // Кнопки страниц переключают this.currentPage и перерисовывают
                // таблицу через update() — фильтры и сортировка сохраняются.
                document.getElementById('auction-prev')?.addEventListener('click', () => {
                    if (this.currentPage <= 0) return;
                    this.currentPage--;
                    update();
                });
                document.getElementById('auction-next')?.addEventListener('click', () => {
                    if (this.currentPage + 1 >= lastTotalPages) return;
                    this.currentPage++;
                    update();
                });

                // 11.6.2c.4: полное сканирование витрины. Кнопка disabled на
                // время кулдауна (30 минут), тикер раз в секунду обновляет её
                // текст; update() перерисовывает таблицу, чтобы после скана
                // показать свежие медианы сети.
                document.getElementById('lg-auction-full-scan')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.runFullScan(update);
                });
                this.startFullScanTick();

                // Настройка звука оповещений: сохраняем в localStorage, чтобы
                // выбор жил между сканами (по умолчанию звук включён).
                document.getElementById('auction-sound')?.addEventListener('change', (e) => {
                    this.alertSoundEnabled = e.target.checked;
                    try {
                        localStorage.setItem('LEGION_AUC_SOUND', String(this.alertSoundEnabled));
                    } catch (err) {
                        dbg('[AUCTION] не удалось сохранить настройку звука:', err);
                    }
                });

                // 11.5.5: чекбоксы «Мои лоты» / «Избранное». После смены фильтра
                // возвращаемся на первую страницу: иначе можно остаться на
                // «Стр. 3 из 1» с пустой таблицей.
                document.getElementById('auction-my-lots')?.addEventListener('change', (e) => {
                    this.showMyLotsOnly = e.target.checked;
                    this.currentPage = 0;
                    update();
                });
                document.getElementById('auction-favs')?.addEventListener('change', (e) => {
                    this.showFavoritesOnly = e.target.checked;
                    this.currentPage = 0;
                    update();
                });

                // 11.5.5: клик по ★/☆ (делегирование). Слушатель отдельный от
                // кнопки покупки: звезда лежит в ячейке имени, а не в кнопке,
                // поэтому обработчик .auc-buy-btn её игнорирует.
                if (tbody) {
                    tbody.addEventListener('click', (e) => {
                        const star = e.target.closest('.auc-fav-btn');
                        if (!star) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const id = star.getAttribute('data-id');
                        if (!id) return;
                        if (this.favorites.has(id)) this.favorites.delete(id);
                        else this.favorites.add(id);
                        try {
                            localStorage.setItem('LEGION_AUC_FAVS', JSON.stringify([...this.favorites]));
                        } catch (err) {
                            dbg('[AUCTION] не удалось сохранить избранное:', err);
                        }
                        // Перерисовка: при включённом фильтре снятая звезда
                        // сразу убирает строку из таблицы.
                        update();
                    });
                }

                let t;
                document.getElementById('auction-search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(update, 300); });
                ['auction-filter-slot', 'auction-filter-rarity', 'auction-filter-role', 'auction-only-deals'].forEach(id => {
                    document.getElementById(id).addEventListener('change', update);
                });

                document.querySelectorAll('.custom-modal th[data-sort]').forEach(th => {
                    th.addEventListener('click', () => {
                        const col = th.dataset.sort;
                        if (sortCol === col) sortAsc = !sortAsc;
                        else { sortCol = col; sortAsc = false; }

                        document.querySelectorAll('.custom-modal th').forEach(e => e.classList.remove('sort-asc', 'sort-desc'));
                        th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');

                        current.sort((a, b) => {
                            let A = a[col], B = b[col];
                            if (typeof A === 'string') A = A.toLowerCase();
                            if (typeof B === 'string') B = B.toLowerCase();
                            return A < B ? (sortAsc ? -1 : 1) : (A > B ? (sortAsc ? 1 : -1) : 0);
                        });
                        update();
                    });
                });

            } catch (err) {
                dbg('[AUCTION]', err);
                UI.showModal(`<h2>❌ Ошибка <button class="custom-close" id="custom-close-btn">✖</button></h2><p>${err.message}</p>`);
            }
        }
    };

    // ===== src/modules/players.js =====
    // ============================================================
    // 5. МОДУЛЬ: РАЗВЕДКА (ИГРОКИ)
    // ============================================================
const Players = {
        playersMap: new Map(),
        _lastLots: [],
        _lastItemsMap: {},
        _lastAuctionScan: 0,
        _lastMineStateScan: 0,
        currentDMPeer: null,
        // Непрочитанные ЛС: { 'ник': количество }
        unreadDMs: {},

        getUnreadDM(nick) {
            if (!nick) return 0;
            return this.unreadDMs[String(nick).trim().toLowerCase()] || 0;
        },

        setUnreadDM(nick, count) {
            if (!nick) return;
            const key = String(nick).trim().toLowerCase();
            const num = Math.max(0, Number(count) || 0);
            if (num > 0) this.unreadDMs[key] = num;
            else delete this.unreadDMs[key];
        },

        addUnreadDM(nick) {
            if (!nick) return 0;
            const key = String(nick).trim().toLowerCase();
            this.unreadDMs[key] = (this.unreadDMs[key] || 0) + 1;
            return this.unreadDMs[key];
        },

        clearUnreadDM(nick) {
            if (!nick) return;
            const key = String(nick).trim().toLowerCase();
            if (!(key in this.unreadDMs)) return;
            delete this.unreadDMs[key];
        },

        init() {
            (document.getElementById(DOM_IDS.btnPlayers) || document.getElementById('btn-players'))?.addEventListener('click', () => this.open());
        },

        getMyNick() {
            // ME живёт в page-context: в песочнице Tampermonkey (@grant) обычный
            // window его не видит, поэтому читаем через G (= unsafeWindow).
            // 11.7.0: фолбэк на Chat.myNick убран вместе с подсистемой чата.
            return (G.ME && (G.ME.user?.name || G.ME.hero?.n || G.ME.hero?.name)) || '';
        },

        getCityPlayers() {
            const set = new Set();
            const now = Date.now();
            const TTL_CITY = 180000; // 3 минуты

            if (!window.__lgOnlinePlayers || typeof window.__lgOnlinePlayers.set !== 'function') {
                window.__lgOnlinePlayers = new Map();
            }

            // 1. Собираем из Map (SSE + API)
            if (window.__lgOnlinePlayers && window.__lgOnlinePlayers.size > 0) {
                for (const [nick, info] of window.__lgOnlinePlayers.entries()) {
                    if (info && info.loc === 'city' && (now - info.ts) < TTL_CITY) {
                        set.add(nick);
                    }
                }
            }

            // 2. Дополняем из DOM — но только если записи ещё нет в Map
            //    (SSE/API всегда приоритетнее DOM)
            try {
                document.querySelectorAll('.cy-view .cy-w[data-l], .cy-view [data-nick]').forEach(el => {
                    const l = el.getAttribute('data-l') || el.getAttribute('data-nick');
                    if (l && l.trim()) {
                        const key = l.trim().toLowerCase();
                        if (!set.has(key)) {
                            // Нашли в DOM — обновляем Map как источник 'dom'
                            window.__lgOnlinePlayers.set(key, { loc: 'city', ts: now, src: 'dom' });
                            set.add(key);
                        }
                    }
                });
            } catch (e) {}

            // 3. Фолбэк на методы игры, если Map пуста
            if (set.size === 0) {
                try {
                    const dbgVal = G.LGCity?.debug?.();
                    if (dbgVal && Array.isArray(dbgVal.others)) {
                        dbgVal.others.forEach(l => { if (l) set.add(String(l).trim().toLowerCase()); });
                    }
                } catch (e) {}
                try {
                    const peek = G.LGCity?.peek?.();
                    if (peek && Array.isArray(peek.w)) {
                        peek.w.forEach(item => { if (item && item[0]) set.add(String(item[0]).trim().toLowerCase()); });
                    }
                } catch (e) {}
            }

            return set;
        },

        getMinePlayers() {
            const set = new Set();
            const now = Date.now();
            const TTL_MINE = 45000; // 45 секунд

            if (!window.__lgOnlinePlayers || typeof window.__lgOnlinePlayers.set !== 'function') {
                window.__lgOnlinePlayers = new Map();
            }

            // 1. Из Map
            if (window.__lgOnlinePlayers && window.__lgOnlinePlayers.size > 0) {
                for (const [nick, info] of window.__lgOnlinePlayers.entries()) {
                    if (info && info.loc === 'mine' && (now - info.ts) < TTL_MINE) {
                        set.add(nick);
                    }
                }
            }

            // 2. Из st.dg (свежие данные с сервера) — обновляем Map как 'api'
            try {
                // 11.6.4b: miner.js удалён, поэтому G.__lgMineState обычно пуст —
                // состояние шахты приходит SSE-событием `mine`, а его разбирает
                // Utils.updateOnlinePlayers() (см. шаг 1 выше). Ветка оставлена
                // как фолбэк для сборок, где состояние кто-то положил вручную.
                const st = G.__lgMineState || window.__lgMineState;
                if (st && st.dg && (!st.at || now - st.at < 15000)) { // если снимок свежий (менее 15 сек)
                    Object.values(st.dg).flat().forEach(l => {
                        if (l) {
                            const key = String(l).trim().toLowerCase();
                            if (!set.has(key)) {
                                window.__lgOnlinePlayers.set(key, { loc: 'mine', ts: now, src: 'api' });
                                set.add(key);
                            }
                        }
                    });
                }
            } catch (e) {}

            // 3. Из DOM — только если ещё нет
            try {
                document.querySelectorAll('.mn-heroes [data-k]').forEach(el => {
                    const k = el.getAttribute('data-k') || '';
                    const login = k.replace(/^[dw]:/, '');
                    if (login && login !== 'me') {
                        const key = login.trim().toLowerCase();
                        if (!set.has(key)) {
                            window.__lgOnlinePlayers.set(key, { loc: 'mine', ts: now, src: 'dom' });
                            set.add(key);
                        }
                    }
                });
            } catch (e) {}

            // 4. Фолбэк на st.dl
            if (set.size === 0) {
                try {
                    const st = G.__lgMineState || window.__lgMineState;
                    if (st && Array.isArray(st.dl)) {
                        st.dl.forEach(item => {
                            const n = item && item[3];
                            if (n && typeof n === 'object') {
                                Object.keys(n).forEach(k => { if (k && k !== 'me') set.add(k.trim().toLowerCase()); });
                            }
                        });
                    }
                } catch (e) {}
            }

            return set;
        },

        addPlayer(rawNick, source) {
            if (!rawNick || typeof rawNick !== 'string') return;
            const nick = rawNick.trim();
            if (!nick || nick.length < 2 || nick.length > 30) return;
            const myNick = this.getMyNick().toLowerCase();
            const key = nick.toLowerCase();
            if (myNick && key === myNick) return;

            let p = this.playersMap.get(key);
            if (!p) {
                p = { nick, sources: new Set(), lastSeen: Date.now(), lotsCount: 0 };
                this.playersMap.set(key, p);
            }
            p.sources.add(source);
            p.lastSeen = Date.now();
        },

        async scan() {
            this.playersMap.forEach(p => { p.lotsCount = 0; });
            const now = Date.now();

            // /api/mine/state — не чаще раза в 10 секунд
            if (window.location.pathname.includes('/mine') || document.querySelector('.mn-heroes') || G.__lgMineState || window.__lgMineState) {
                if (now - this._lastMineStateScan > 10000) {
                    this._lastMineStateScan = now;
                    try {
                        const mRes = await Utils.fetchApi('/api/mine/state');
                        if (mRes) {
                            const d = mRes.body || mRes;
                            if (typeof d.here === 'number') window.__lgMineTotalHere = d.here;
                            else if (d.st && typeof d.st.here === 'number') window.__lgMineTotalHere = d.st.here;
                            Utils.updateOnlinePlayers(d, 'mine', 'api');
                        }
                    } catch(e) {}
                }
            }

            const cityPlayers = this.getCityPlayers();
            cityPlayers.forEach(login => this.addPlayer(login, '🏛️ Город'));

            const minePlayers = this.getMinePlayers();
            minePlayers.forEach(login => this.addPlayer(login, '⛏️ Шахта'));

            try {
                document.querySelectorAll('[data-nick], [data-author], .cy-chat-author, .cy-chat-m b, .cy-chat-b b').forEach(el => {
                    const n = el.getAttribute('data-nick') || el.getAttribute('data-author') || el.textContent;
                    if (n && n.trim() && !n.includes(':') && n.length >= 2 && n.length <= 25) {
                        this.addPlayer(n.trim(), '💬 Чат');
                    }
                });
            } catch (e) {}
            // 11.7.0: сбор ников из Chat.messages удалён вместе с подсистемой
            // чата — остаются DOM-источники (.cy-chat-*) и карта онлайна.

            // Пересчёт лотов по снимку аукциона (без повторного запроса)
            const applyLots = (lots) => {
                if (!Array.isArray(lots)) return;
                lots.forEach(lot => {
                    const sNick = (lot.sn || lot.s || '').trim();
                    if (sNick) {
                        this.addPlayer(sNick, '🏛️ Рынок');
                        const p = this.playersMap.get(sNick.toLowerCase());
                        if (p) p.lotsCount = (p.lotsCount || 0) + 1;
                    }
                });
            };

            // /api/auction — не чаще раза в 30 секунд
            if (now - this._lastAuctionScan > 30000) {
                this._lastAuctionScan = now;
                try {
                    const res = await Utils.fetchApi('/api/auction');
                    const lots = res?.lots || res?.body?.lots;
                    if (Array.isArray(lots)) {
                        this._lastLots = lots;
                        // items — карта id предмета -> {name, slot, look, rarity, ...}.
                        // Нужна для арта в досье: без slot LGInventory.art падает
                        // в <rect fill="#a0703a"> и isRealItemSvg() отбраковывает.
                        this._lastItemsMap = res?.items || res?.body?.items || (res?.data && res.data.items) || {};
                        applyLots(lots);
                    }
                } catch (e) {}
            } else {
                applyLots(this._lastLots);
            }
        },

        openTradeWith(nick) {
            if (!nick) return;
            try {
                if (G.LGTrade && typeof G.LGTrade.invite === 'function') {
                    G.LGTrade.invite(nick);
                    return;
                }
            } catch (e) {}

            Utils.fetchApi('/api/city/trade', { op: 'invite', to: nick }).then(res => {
                if (res && res.ok) {
                    UI.showToast(`Обмен предложен игроку ${nick}`);
                } else {
                    const err = (res && (res.error || res.err)) || 'Игрок не в городе';
                    UI.showToast(`Обмен: ${err}`, true);
                }
            }).catch(() => {
                UI.showToast(`Обмен: сбой сети`, true);
            });
        },

        getDMHistory(nick) {
            if (!nick) return [];
            try {
                const key = `LEGION_DM_HISTORY_${nick.trim().toLowerCase()}`;
                const raw = localStorage.getItem(key);
                if (raw) {
                    const arr = JSON.parse(raw);
                    if (Array.isArray(arr)) return arr;
                }
            } catch (e) {}
            return [];
        },

        saveDMMessage(peerNick, msg) {
            if (!peerNick || !msg || !msg.text) return false;
            try {
                const key = `LEGION_DM_HISTORY_${peerNick.trim().toLowerCase()}`;
                const history = this.getDMHistory(peerNick);
                const last = history[history.length - 1];
                if (last && last.from === msg.from && last.text === msg.text && Math.abs((msg.ts || Date.now()) - (last.ts || 0)) < 6000) {
                    return false;
                }
                history.push({
                    from: msg.from,
                    to: msg.to,
                    text: msg.text,
                    time: msg.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    ts: msg.ts || Date.now()
                });
                const trimmed = history.slice(-50);
                localStorage.setItem(key, JSON.stringify(trimmed));
                return true;
            } catch (e) {
                dbg('Error saving DM history:', e);
                return false;
            }
        },

        async sendDM(nick, text) {
            if (!nick || !text) return false;
            const cleanText = String(text).trim();
            if (!cleanText) return false;

            // ПРОГРЕВ СЕССИИ: без этого сервер считает, что мы в городе, и выдает 409
            try {
                // ВАЖНО: чистый fetch, а не Utils.fetchApi: тот может уйти через
                // нативный контекст игры (G.__lgAucContext / G.X) мимо сессии
                // города, прогрев тогда не сработает и отправка даст 409.
                // ПАТЧ 11.6.4h: сам адрес обязательно через Utils.apiPath —
                // иначе запрос уходит в корень домена мимо /c/<channel>/ (404).
                const warmRes = await fetch(Utils.apiPath('/api/city/enter'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({})
                });
                // Не роняем отправку из-за прогрева, но фиксируем проблему в логе:
                // 401/403 здесь означают, что сессия города не поднялась.
                if (!warmRes || !warmRes.ok) dbg('Session warmup failed:', warmRes && warmRes.status);
            } catch (e) {
                dbg('Session warmup failed', e);
            }

            const payload = { text: cleanText, to: nick, k: 'dm' }; // k: 'dm' обязателен!

            try {
                let data = null;
                let nativeOk = null;

                // 1. Пытаемся использовать нативный контекст города (как в прошлой версии)
                const nativeCtx = G.__lgCityContext || G.LGCity;
                if (nativeCtx && typeof nativeCtx.api === 'function') {
                    try {
                        const nativeData = await nativeCtx.api('/api/city/say', payload);
                        if (nativeData && typeof nativeData === 'object') {
                            data = nativeData;
                            nativeOk = nativeData.ok !== false;
                        }
                    } catch (err) {
                        dbg('Native DM send failed, fallback to fetch:', err);
                    }
                }

                // 2. Фолбэк: обычный fetch (как в прошлой версии)
                // ПАТЧ 11.6.4h: адрес через Utils.apiPath, иначе улетал в корень.
                if (!data) {
                    const res = await fetch(Utils.apiPath('/api/city/say'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify(payload)
                    });
                    data = await res.json().catch(() => null);
                    if (!res.ok) {
                        nativeOk = false;
                    }
                }

                // 3. Проверка успеха
                const httpOk = nativeOk !== null ? nativeOk : !!(data && data.ok !== false);
                if (!httpOk || (data && data.ok === false)) {
                    const errMsg = (data && (data.error || data.err)) || 'Не удалось отправить ЛС';
                    throw new Error(errMsg);
                }

                // Сохраняем историю и обновляем UI
                const myNick = this.getMyNick() || 'Я';
                const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                this.saveDMMessage(nick, { from: myNick, to: nick, text: cleanText, time: timeStr, ts: Date.now() });

                if (this.currentDMPeer && this.currentDMPeer.toLowerCase() === nick.toLowerCase()) {
                    this.renderDMMessages(nick);
                }
                return true;
            } catch (e) {
                dbg('Error sending DM:', e);
                UI.showToast(`Ошибка ЛС: ${e.message || 'сбой'}`, true);
                return false;
            }
        },

        handleIncomingDM(author, text, to = null, ts = null) {
            if (!text) return;
            const myNick = this.getMyNick();
            const isSelf = (myNick && author && author.toLowerCase() === myNick.toLowerCase()) || author === 'Я';

            let peerNick = isSelf ? (to || '') : author;
            if (!peerNick) return;

            const fromNick = author || (isSelf ? myNick : peerNick);
            const toNick = to || (isSelf ? peerNick : myNick);
            const timeStr = new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const saved = this.saveDMMessage(peerNick, {
                from: fromNick,
                to: toNick,
                text,
                time: timeStr,
                ts: ts || Date.now()
            });

            if (this.currentDMPeer && this.currentDMPeer.toLowerCase() === peerNick.toLowerCase()) {
                // Диалог открыт — сообщение сразу прочитано
                this.clearUnreadDM(peerNick);
                this.renderDMMessages(peerNick);
            } else if (!isSelf && saved) {
                // Счётчик непрочитанных + кликабельный тост: открываем окно
                // «Разведка» сразу на диалоге с этим игроком. v11.7.0: раньше
                // тост дёргал Chat.openDM() из удалённой подсистемы чата.
                this.addUnreadDM(peerNick);
                UI.showToast(
                    `✉️ ЛС от ${peerNick}: ${text.length > 25 ? text.slice(0, 25) + '...' : text}`,
                    false,
                    async () => {
                        await this.open();
                        this.openDossier(peerNick, 'players', true);
                    }
                );
            }
        },

        renderDMMessages(nick) {
            const historyBox = document.getElementById('friend-dm-history');
            if (!historyBox) return;

            const history = this.getDMHistory(nick);
            if (!history || history.length === 0) {
                historyBox.innerHTML = `<div style="text-align:center; color:#888; font-style:italic; margin:auto; padding:20px 0;">Начните диалог первым!</div>`;
                return;
            }

            const myNick = (this.getMyNick() || '').toLowerCase();
            historyBox.innerHTML = history.map(m => {
                const fromLower = (m.from || '').toLowerCase();
                const isSelf = fromLower === myNick || m.from === 'Я' || m.from === 'me';
                if (isSelf) {
                    return `
                        <div style="align-self:flex-end; max-width:80%; background:#1d3827; border:1px solid #2e5d3e; border-radius:10px 10px 2px 10px; padding:6px 10px; color:#eafbee; word-break:break-word; box-shadow:0 1px 3px rgba(0,0,0,0.3);">
                            <div style="font-size:13px; line-height:1.4;">${Utils.escapeHtml(m.text)}</div>
                            <div style="font-size:10px; color:#85c99e; text-align:right; margin-top:2px;">${Utils.escapeHtml(m.time || '')}</div>
                        </div>
                    `;
                } else {
                    return `
                        <div style="align-self:flex-start; max-width:80%; background:#282030; border:1px solid #4d3a5a; border-radius:10px 10px 10px 2px; padding:6px 10px; color:#f7eadf; word-break:break-word; box-shadow:0 1px 3px rgba(0,0,0,0.3);">
                            <div style="font-size:11px; font-weight:bold; color:#ffcf6a; margin-bottom:2px;">${Utils.escapeHtml(m.from || nick)}</div>
                            <div style="font-size:13px; line-height:1.4;">${Utils.escapeHtml(m.text)}</div>
                            <div style="font-size:10px; color:#aaa; text-align:right; margin-top:2px;">${Utils.escapeHtml(m.time || '')}</div>
                        </div>
                    `;
                }
            }).join('');

            historyBox.scrollTop = historyBox.scrollHeight;
        },

        async open() {
            UI.showModal(`<h2>👥 Разведка: Игроки <button class="custom-close" id="custom-close-btn">✖</button></h2><div class="loader">Сканируем локации и рынок...</div>`, { compact: true });
            await this.scan();
            this.render();
        },

        render() {
            const citySetInit = this.getCityPlayers();
            const mineSetInit = this.getMinePlayers();
            const totalMine = (typeof window.__lgMineTotalHere === 'number' && window.__lgMineTotalHere > 0)
                ? window.__lgMineTotalHere
                : ((G.__lgMineState || window.__lgMineState)?.here || (G.__lgMineState || window.__lgMineState)?.st?.here || 0);
            const countText = totalMine > 0
                ? `В шахте: ${totalMine} (известно ников: ${mineSetInit.size})`
                : `Игроков: ${this.playersMap.size} (Шахта: ${mineSetInit.size}, Город: ${citySetInit.size})`;

            UI.showModal(`
                <h2>👥 Разведка: Игроки онлайн <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div id="players-view-list" style="display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden;">
                    <div style="display:flex; gap:8px; margin-bottom:12px; align-items:center;">
                        <input type="text" id="players-search" class="search-bar" style="margin:0; flex:1;" placeholder="🔍 Поиск игрока...">
                        <button id="players-refresh" style="background:#caa55c; color:#1d1620; border:none; padding:8px 14px; border-radius:6px; font-weight:bold; cursor:pointer;">🔄 Обновить</button>
                    </div>
                    <div style="font-size:12px; color:#aaa; margin-bottom:10px; display:flex; justify-content:space-between;">
                        <span id="players-count">${countText}</span>
                        <span style="color:#ffcf6a;">(Нажмите на игрока для открытия досье)</span>
                    </div>
                    <div id="players-items" style="max-height:48vh; overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding-right:2px;"></div>
                </div>
                <div id="players-view-dossier" style="display:none; max-height:52vh; overflow-y:auto; padding-right:2px;"></div>
            `, { compact: true });

            const updateList = () => {
                const q = (document.getElementById('players-search')?.value || '').trim().toLowerCase();
                const container = document.getElementById('players-items');
                if (!container) return;

                const citySet = this.getCityPlayers();
                const mineSet = this.getMinePlayers();

                const countEl = document.getElementById('players-count');
                if (countEl) {
                    const totalMineNow = (typeof window.__lgMineTotalHere === 'number' && window.__lgMineTotalHere > 0)
                        ? window.__lgMineTotalHere
                        : ((G.__lgMineState || window.__lgMineState)?.here || (G.__lgMineState || window.__lgMineState)?.st?.here || 0);
                    if (totalMineNow > 0) {
                        countEl.textContent = `В шахте: ${totalMineNow} (известно ников: ${mineSet.size})`;
                    } else {
                        countEl.textContent = `Игроков: ${this.playersMap.size} (Шахта: ${mineSet.size}, Город: ${citySet.size})`;
                    }
                }

                const arr = Array.from(this.playersMap.values());
                arr.sort((a, b) => {
                    const aNear = (citySet.has(a.nick.toLowerCase()) || mineSet.has(a.nick.toLowerCase())) ? 1 : 0;
                    const bNear = (citySet.has(b.nick.toLowerCase()) || mineSet.has(b.nick.toLowerCase())) ? 1 : 0;
                    if (bNear !== aNear) return bNear - aNear;
                    if (b.lotsCount !== a.lotsCount) return b.lotsCount - a.lotsCount;
                    return a.nick.localeCompare(b.nick);
                });

                const filtered = arr.filter(p => !q || p.nick.toLowerCase().includes(q));
                if (filtered.length === 0) {
                    container.innerHTML = `<div style="text-align:center; padding:20px; color:#888;">Игроки не найдены</div>`;
                    return;
                }

                container.innerHTML = filtered.map(p => {
                    const key = p.nick.toLowerCase();
                    const badges = [];
                    if (citySet.has(key)) badges.push(`<span style="background:rgba(0,255,102,0.18);color:#00ff66;border:1px solid rgba(0,255,102,0.4);padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;">🏛️ В Городе</span>`);
                    if (mineSet.has(key)) badges.push(`<span style="background:rgba(255,153,0,0.18);color:#ff9900;border:1px solid rgba(255,153,0,0.4);padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;">⛏️ В Шахте</span>`);
                    if (p.lotsCount > 0) badges.push(`<span style="background:rgba(255,215,0,0.15);color:#ffd700;border:1px solid rgba(255,215,0,0.3);padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;">🏛️ Лотов: ${p.lotsCount}</span>`);
                    if (p.sources.has('💬 Чат') && !citySet.has(key) && !mineSet.has(key)) badges.push(`<span style="background:rgba(102,204,255,0.15);color:#66ccff;border:1px solid rgba(102,204,255,0.3);padding:2px 6px;border-radius:4px;font-size:11px;">💬 Чат</span>`);

                    return `
                        <div class="player-card-row" data-nick="${Utils.escapeHtml(p.nick)}" style="background:#26202e; border:1px solid #44374a; border-radius:6px; padding:8px 12px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; transition:all 0.15s;">
                            <span style="font-weight:bold; color:#f7eadf; font-size:13px;">${Utils.escapeHtml(p.nick)}</span>
                            <div style="display:flex; gap:6px; align-items:center;">
                                ${badges.join('')}
                                <span style="color:#caa55c; font-size:14px; margin-left:4px;">›</span>
                            </div>
                        </div>
                    `;
                }).join('');

                container.querySelectorAll('.player-card-row').forEach(row => {
                    row.addEventListener('click', () => {
                        const nick = row.getAttribute('data-nick');
                        if (nick) this.openDossier(nick, 'players');
                    });
                });
            };

            updateList();

            document.getElementById('players-search')?.addEventListener('input', updateList);
            document.getElementById('players-refresh')?.addEventListener('click', async () => {
                await this.scan();
                updateList();
            });
        },

        // backView оставлен в сигнатуре для совместимости вызовов (openDossier(nick, 'players', true));
        // вид «Друзья» удалён, поэтому параметр больше не влияет на разметку.
        openDossier(nick, backView = null, forceDM = false) {
            // Модуль «Друзья» удалён в 11.5.4 (нативные друзья игры) — досье
            // всегда живёт в окне «Разведка (Игроки)».
            const listEl = document.getElementById('players-view-list');
            const dossierEl = document.getElementById('players-view-dossier');
            if (!listEl || !dossierEl) return;

            // Открыли диалог — непрочитанные ЛС от этого игрока обнуляем
            if (forceDM) this.clearUnreadDM(nick);

            listEl.style.display = 'none';
            dossierEl.style.display = 'flex';
            dossierEl.style.flexDirection = 'column';
            dossierEl.style.flex = '1';
            dossierEl.style.minHeight = '0';

            const key = nick.toLowerCase();
            const p = this.playersMap.get(key) || { nick, sources: new Set(), lastSeen: Date.now(), lotsCount: 0 };
            const citySet = this.getCityPlayers();
            const mineSet = this.getMinePlayers();

            const isCity = citySet.has(key);
            const isMine = mineSet.has(key);

            let locationText = isCity ? '🏛️ В Городе' : (isMine ? '⛏️ В Шахте' : '📍 Не в сети');
            let locationColor = isCity ? '#00ff66' : (isMine ? '#ff9900' : '#8899aa');

            const playerLots = [];
            if (Array.isArray(this._lastLots)) {
                this._lastLots.forEach(l => {
                    const sNick = (l.sn || l.s || '').trim();
                    if (sNick.toLowerCase() === key) {
                        playerLots.push(l);
                    }
                });
            }

            const totalLotsPrice = playerLots.reduce((acc, l) => acc + (+l.p || 0), 0);

            if (forceDM) {
                this.currentDMPeer = nick;
                const lotsHtml = playerLots.map(l => {
                    const name = Utils.getItemName(l.i) + (l.e || l.en ? ' +' + (l.e || l.en) : '');
                    const icon = Utils.getItemIcon(l.i);
                    const qty = l.n || 1;
                    return `
                        <div style="background:#26202e; border:1px solid #44374a; border-radius:6px; padding:4px 8px; display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:6px;">
                                ${icon ? `<img src="${Utils.safeUrl(icon)}" style="width:16px;height:16px;vertical-align:middle;">` : ''}
                                <span style="font-weight:bold; color:#fff; font-size:11px;">${Utils.escapeHtml(name)} ${qty > 1 ? `×${qty}` : ''}</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span style="color:#ffd700; font-weight:bold; font-size:11px;">💰 ${Utils.formatMoney(l.p)}</span>
                                <button class="dossier-buy-btn" data-lot="${l.id}" data-price="${l.p}" style="padding:2px 6px; background:#caa55c; color:#1d1620; border:none; border-radius:4px; font-weight:bold; font-size:10px; cursor:pointer;">Купить</button>
                            </div>
                        </div>
                    `;
                }).join('');

                dossierEl.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #44374a; padding-bottom:8px; flex-shrink:0;">
                        <button id="dossier-back-btn" style="background:#2a2030; border:1px solid #caa55c; color:#caa55c; padding:4px 10px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">⬅ Назад к списку</button>
                        <div style="text-align:center;">
                            <span style="font-size:15px; font-weight:bold; color:#ffcf6a;">${Utils.escapeHtml(nick)}</span>
                            <div style="font-size:11px; color:${locationColor}; font-weight:bold;">${locationText}</div>
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button id="dossier-trade-btn" title="Предложить обмен" style="padding:4px 8px; background:#28a745; color:#fff; border:none; border-radius:4px; font-weight:bold; cursor:pointer; font-size:11px;">🤝 Обмен</button>
                        </div>
                    </div>
                    ${playerLots.length > 0 ? `
                        <div style="margin-bottom:6px; flex-shrink:0;">
                            <div id="dossier-lots-toggle" style="font-size:11px; color:#ffd700; cursor:pointer; user-select:none; display:flex; justify-content:space-between; align-items:center; background:#1b1622; padding:4px 8px; border-radius:4px; border:1px solid #3d2f44;">
                                <span>🏛️ Лотов на рынке: <b>${playerLots.length}</b> (на сумму ${Utils.formatMoney(totalLotsPrice)})</span>
                                <span id="dossier-lots-arrow">▾ Показать</span>
                            </div>
                            <div id="dossier-lots-container" style="display:none; max-height:100px; overflow-y:auto; margin-top:4px; flex-direction:column; gap:4px; padding-right:2px;">
                                ${lotsHtml}
                            </div>
                        </div>
                    ` : ''}
                    <div id="friend-dm-history" style="flex:1; min-height:160px; overflow-y:auto; background:#16121a; border:1px solid #3d2f44; border-radius:6px; padding:10px; display:flex; flex-direction:column; gap:8px; margin-bottom:8px;"></div>
                    <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
                        <input type="text" id="friend-dm-input" placeholder="Написать сообщение..." maxlength="300" style="flex:1; background:#201826; border:1px solid #44374a; color:#fff; padding:7px 10px; border-radius:6px; font-size:13px; outline:none;">
                        <button id="friend-dm-send-btn" style="background:#28a745; color:#fff; cursor:pointer; border:none; padding:7px 14px; border-radius:6px; font-weight:bold; font-size:12px; white-space:nowrap;" title="Отправить">Отправить</button>
                    </div>
                `;

                this.renderDMMessages(nick);

                const dmInput = document.getElementById('friend-dm-input');
                const dmSendBtn = document.getElementById('friend-dm-send-btn');
                const doSend = async () => {
                    const text = (dmInput?.value || '').trim();
                    if (!text) return;
                    dmInput.value = '';
                    const ok = await this.sendDM(nick, text);
                    if (!ok) {
                        dmInput.value = text;
                    } else {
                        dmInput.focus();
                    }
                };

                dmSendBtn?.addEventListener('click', doSend);
                dmInput?.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') doSend();
                });
                setTimeout(() => dmInput?.focus(), 100);

                const lotsToggle = document.getElementById('dossier-lots-toggle');
                const lotsContainer = document.getElementById('dossier-lots-container');
                const lotsArrow = document.getElementById('dossier-lots-arrow');
                lotsToggle?.addEventListener('click', () => {
                    if (!lotsContainer) return;
                    const isOpen = lotsContainer.style.display !== 'none';
                    lotsContainer.style.display = isOpen ? 'none' : 'flex';
                    if (lotsArrow) lotsArrow.textContent = isOpen ? '▾ Показать' : '▴ Скрыть';
                });
            } else {
                // Обычный режим досье из вкладки «Разведка (Игроки)»
                this.currentDMPeer = null;
                dossierEl.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #44374a; padding-bottom:8px; flex-shrink:0;">
                        <button id="dossier-back-btn" style="background:#2a2030; border:1px solid #caa55c; color:#caa55c; padding:4px 10px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">⬅ Назад к списку</button>
                        <span style="font-size:16px; font-weight:bold; color:#ffcf6a;">${Utils.escapeHtml(nick)}</span>
                    </div>
                    <div style="display:flex; gap:8px; margin-bottom:12px; flex-shrink:0;">
                        <button id="dossier-trade-btn" style="flex:1; padding:8px 4px; background:#28a745; color:#fff; border:none; border-radius:6px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; font-size:12px;">🤝 Обмен</button>
                        <button id="dossier-dm-btn" style="flex:1; padding:8px 4px; background:#28a745; color:#fff; border:none; border-radius:6px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; font-size:12px;" title="Написать в ЛС">✉️ ЛС</button>
                    </div>
                    <div style="background:#1b1622; border:1px solid #44374a; border-radius:6px; padding:10px; margin-bottom:12px; flex-shrink:0;">
                        <div style="font-size:12px; margin-bottom:4px;"><b>Текущая локация:</b> <span style="color:${locationColor}; font-weight:bold;">${locationText}</span></div>
                        <div style="font-size:12px; color:#aaa;"><b>Активных лотов на аукционе:</b> <span style="color:#ffd700; font-weight:bold;">${playerLots.length} шт. (на сумму ${Utils.formatMoney(totalLotsPrice)})</span></div>
                    </div>
                    <h3 style="font-size:14px; color:#ffcf6a; margin:10px 0 6px 0; flex-shrink:0;">🏛️ Лоты игрока на рынке</h3>
                    <div id="dossier-lots-container" style="max-height:26vh; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
                        ${playerLots.length === 0 ? `<div style="text-align:center; padding:15px; color:#888;">У игрока нет активных лотов на рынке</div>` : playerLots.map(l => {
                            const name = Utils.getItemName(l.i) + (l.e || l.en ? ' +' + (l.e || l.en) : '');
                            const icon = Utils.getItemIcon(l.i);
                            const qty = l.n || 1;
                            return `
                                <div style="background:#26202e; border:1px solid #44374a; border-radius:6px; padding:6px 10px; display:flex; justify-content:space-between; align-items:center;">
                                    <div style="display:flex; align-items:center; gap:6px;">
                                        ${icon ? `<img src="${Utils.safeUrl(icon)}" style="width:20px;height:20px;vertical-align:middle;">` : ''}
                                        <span style="font-weight:bold; color:#fff; font-size:12px;">${Utils.escapeHtml(name)} ${qty > 1 ? `×${qty}` : ''}</span>
                                    </div>
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        <span style="color:#ffd700; font-weight:bold; font-size:12px;">💰 ${Utils.formatMoney(l.p)}</span>
                                        <button class="dossier-buy-btn" data-lot="${l.id}" data-price="${l.p}" style="padding:4px 8px; background:#caa55c; color:#1d1620; border:none; border-radius:4px; font-weight:bold; font-size:11px; cursor:pointer;">Купить</button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;

                document.getElementById('dossier-dm-btn')?.addEventListener('click', () => {
                    // Принудительно открываем вид чата, оставаясь в текущем окне
                    this.openDossier(nick, 'players', true);
                });
            }

            document.getElementById('dossier-back-btn')?.addEventListener('click', () => {
                this.currentDMPeer = null;
                dossierEl.style.display = 'none';
                listEl.style.display = 'flex';
                this.render();
            });
            document.getElementById('dossier-trade-btn')?.addEventListener('click', () => this.openTradeWith(nick));

            // Обогащаем лоты в досье: арт + иконки монет (общий код)
            try {
                if (Utils && Utils.enhanceDossierLots) Utils.enhanceDossierLots(dossierEl, this._lastItemsMap || {});
            } catch (e) { dbg('enhanceDossierLots error:', e); }

            dossierEl.querySelectorAll('.dossier-buy-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const lotId = e.currentTarget.getAttribute('data-lot');
                    const price = +e.currentTarget.getAttribute('data-price');
                    btn.disabled = true;
                    btn.textContent = '⏳...';
                    try {
                        const buyRes = await Utils.fetchApi('/api/aucBuy', { lot: String(lotId), price: Number(price) });
                        if (buyRes && buyRes.ok) {
                            btn.textContent = '✔ Куплено';
                            btn.style.background = '#28a745';
                            btn.style.color = '#fff';
                        } else {
                            const buyErr = (buyRes && (buyRes.error || buyRes.err)) || 'Ошибка покупки';
                            UI.showToast(`Покупка: ${buyErr}`, true);
                            btn.disabled = false;
                            btn.textContent = 'Купить';
                            btn.style.background = '#caa55c';
                            btn.style.color = '#1d1620';
                        }
                    } catch (err) {
                        UI.showToast('Покупка: сбой сети', true);
                        btn.disabled = false;
                        btn.textContent = 'Купить';
                        btn.style.background = '#caa55c';
                        btn.style.color = '#1d1620';
                    }
                });
            });
        }
    };

    // ===== src/modules/pocket-city.js =====
// ============================================================
// 6.5. МОДУЛЬ: КАРМАННЫЙ ГОРОД (modules/pocket-city.js)
// ============================================================
const PocketCity = (() => {
    const G = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

    const PocketCity = {
        // Ожидание готовности города (v11.6.4c). Два этапа:
        //   1) city.js грузится лениво по клику на вкладку «Город»;
        //   2) сам город строится уже асинхронно (townPrep/LGCityGL.load).
        CITY_POLL_MS: 100,
        CITY_LOAD_TIMEOUT_MS: 5000,
        CITY_READY_TIMEOUT_MS: 10000,
        // v11.6.4d: пауза перед возвратом — даём игре доиграть закрытие
        // панели здания (closePanel снимает .in, hidden ставит через 260 мс).
        RETURN_DELAY_MS: 320,
        // Отключение текущего наблюдателя закрытия здания (повторные клики
        // по «Карманному городу» не должны плодить watchers).
        _closeWatch: null,

        // ---------------- 11.7.0: автоскип боёв с монстрами ----------------
        // Окно `.cm-dlg` — бой с обычным или элитным монстром. Работаем
        // только нативными кликами по кнопкам интерфейса: сетевых запросов
        // нет, window.fetch / LGMine не патчатся, поход и арена не трогаются.
        MONSTER_SKIP_CLICK_DELAY_MS: 100,
        _monsterObserver: null,
        _monsterRaf: 0,
        // Отложенные клики: гасятся в stopMonsterAutoSkip() / destroy().
        _monsterTimers: new Set(),

        // ---------------- 11.7.0: сборы гильдии на элитных монстров ----------------
        // Фоновый опрос POST /api/citymon/act { op: 'elist' }: ищем чужое
        // открытое лобби, в котором игрок ещё не состоит, и показываем
        // плавающее уведомление с кнопкой «Присоединиться» (op: 'ejoin').
        // Всё через Utils.fetchApi (контекст игры либо обычный fetch);
        // window.fetch / LGMine не патчатся.
        CITYMON_POLL_MS: 18000,
        // 429 / rate_limited у игры общий на все API — после отказа молчим
        // минуту, иначе опрос сам себя загонит в новый лимит.
        CITYMON_PAUSE_MS: 60000,
        CITYMON_TICK_MS: 1000,
        _citymonPollTimer: null,
        _citymonTickTimer: null,
        _citymonBusy: false,
        _citymonPausedUntil: 0,
        _citymonLobby: null,
        // id лобби, скрытые игроком вручную (кнопка «✕») — до перезагрузки.
        _citymonDismissed: new Set(),
        _citymonEl: null,
        _citymonVisibility: null,

        // Модалка со списком зданий: карточка -> нативное здание игры.
        open() {
            // Модалку берём из возврата showModal: её класс — с рандомным
            // префиксом (DOM_IDS.customModal), поэтому поиск
            // `.custom-modal:last-of-type` по документу ненадёжен.
            //
            // v11.6.6f: доступность гильдии считаем ДО рендера — карточка
            // «Гильдия» сразу рисуется в финальном состоянии, без мигания
            // «активна -> недоступна» после ответа /api/me.
            const guildLocked = PocketCity.isGuildLocked();
            const modal = UI.showModal(UITemplates.pocketCityModal(guildLocked));
            if (!modal) return;

            // Обработчики вешаем только на кнопки этой модалки: раньше поиск
            // шёл по всему документу и мог зацепить чужие .pocket-grid-btn.
            modal.querySelectorAll('.pocket-grid-btn').forEach(btn => {
                // Серая карточка «Гильдия» не должна «подпрыгивать» на hover.
                if (btn.getAttribute('aria-disabled') !== 'true') {
                    btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-3px)'; btn.style.boxShadow = '0 6px 15px rgba(0,0,0,0.5)'; });
                    btn.addEventListener('mouseleave', () => { btn.style.transform = 'none'; btn.style.boxShadow = 'none'; });
                }
                btn.addEventListener('click', (e) => {
                    const el = e.currentTarget;
                    const room = el.getAttribute('data-room');
                    // Недоступную карточку гасим через aria-disabled, а не
                    // disabled: disabled-кнопка не присылает клик, и игрок не
                    // поймёт, почему карточка не реагирует. Здесь — тост.
                    if (el.getAttribute('aria-disabled') === 'true') {
                        UI.showToast('Гильдия пока недоступна вашему герою', true);
                        return;
                    }
                    UI.closeModals();
                    if (room) PocketCity.openBuilding(room);
                });
            });
        },
        /**
         * Ждём выполнения условия, опрашивая его каждые CITY_POLL_MS.
         * true — дождались, false — истёк таймаут.
         */
        async waitFor(check, timeoutMs) {
            const deadline = Date.now() + timeoutMs;
            for (;;) {
                try {
                    if (check()) return true;
                } catch (e) { /* проверка не должна ломать ожидание */ }
                if (Date.now() >= deadline) return false;
                await new Promise(resolve => setTimeout(resolve, PocketCity.CITY_POLL_MS));
            }
        },
        /**
         * Готов ли город «по-настоящему» (v11.6.4c).
         *
         * LGCity появляется сразу после загрузки site/city.js, но его состояние
         * S создаётся только внутри LGCity.open(el, CX). До этого LGCity.panel(id)
         * и LGCity.room(id) — это `S && openPanel(id)`, то есть молчаливый no-op.
         * Из-за этого первый клик по зданию «уходил в молоко», а второй срабатывал
         * (город уже успевал построиться).
         *
         * Основной признак: в #tab-city есть .cy-room — его создаёт build()
         * одновременно с состоянием S. Запасной: методы-пробники LGCity
         * (debug/kw) возвращают null, пока S не создан.
         */
        isCityReady(pageWin) {
            const host = document.getElementById('tab-city');
            if (host && host.querySelector('.cy-room')) return true;
            const city = pageWin && pageWin.LGCity;
            if (!city) return false;
            for (const probe of ['debug', 'kw']) {
                try {
                    if (typeof city[probe] === 'function' && city[probe]()) return true;
                } catch (e) { /* метод-пробник может быть недоступен */ }
            }
            return false;
        },
        /**
         * Открыта ли шахта (v11.6.4d).
         *
         * В игре нет вкладки data-tab="mine": mine.js монтирует полноэкранный
         * оверлей `.mn` и вешает на body класс `mn-on`. Этот оверлей остаётся
         * поверх вкладки «Город» и после открытия здания — панель здания
         * (.cy-room) лежит выше него (z-index 200).
         */
        isMineOpen() {
            return document.body.classList.contains('mn-on') && !!document.querySelector('.mn');
        },
        /**
         * id активной вкладки игры без префикса: city / quest / hero / ...
         * app.js: tab() держит класс `.on` на элементах `.tab`.
         */
        activeTabId() {
            const on = document.querySelector('.tab.on');
            return on && on.id ? String(on.id).replace(/^tab-/, '') : '';
        },
        /**
         * Ждём закрытия окна нативного здания и возвращаем игрока туда,
         * откуда он пришёл (v11.6.4d).
         *
         * Панель здания — это `.cy-room` внутри #tab-city: openPanel() снимает
         * hidden и добавляет `.in`, closePanel() снимает `.in` (hidden ставит
         * через 260 мс). Наблюдаем атрибуты самой панели, поэтому ловим и
         * кнопку «Выйти», и Esc, и любые другие пути закрытия.
         */
        watchBuildingClose(from) {
            if (PocketCity._closeWatch) {
                try { PocketCity._closeWatch(); } catch (e) {}
                PocketCity._closeWatch = null;
            }
            const room = document.querySelector('#tab-city .cy-room');
            if (!room) return;

            let timer = 0;
            let observer = null;
            let done = false;
            const isOpen = () => !!(room.isConnected && !room.hidden && room.classList.contains('in'));
            const cleanup = () => {
                if (observer) { observer.disconnect(); observer = null; }
                if (timer) { clearTimeout(timer); timer = 0; }
                if (PocketCity._closeWatch === cleanup) PocketCity._closeWatch = null;
            };
            const finish = () => {
                if (done) return;
                done = true;
                cleanup();
                PocketCity.restoreAfterBuilding(from);
            };
            const check = () => {
                if (done) return;
                if (!room.isConnected) { finish(); return; }
                if (isOpen()) {
                    // Панель открыта (или уже открыли другое здание) — ждём дальше.
                    if (timer) { clearTimeout(timer); timer = 0; }
                    return;
                }
                if (timer) return;
                timer = setTimeout(() => {
                    timer = 0;
                    if (done) return;
                    if (isOpen()) return; // успели открыть другое здание
                    finish();
                }, PocketCity.RETURN_DELAY_MS);
            };

            try {
                observer = new MutationObserver(check);
                observer.observe(room, { attributes: true, attributeFilter: ['hidden', 'class', 'data-b'] });
            } catch (e) {
                dbg('Не удалось отследить закрытие здания:', e);
                return;
            }
            PocketCity._closeWatch = cleanup;
            check();
        },
        /**
         * Возврат после закрытия здания (v11.6.4d).
         *
         * Шахта: оверлей `.mn` всё это время лежал под панелью, поэтому вкладку
         * не трогаем — иначе «В город» из шахты (LGCity.wake) перестанет будить
         * город. Возвращаем нативный чат LGChatOne в шахту и гасим городской
         * слой через LGCity.sleep() — ровно так это делает openMine().
         *
         * Обычная вкладка: кликаем её кнопку — это штатный tab() игры.
         * window.tab в игре НЕ глобальный, поэтому клик надёжнее вызова.
         */
        restoreAfterBuilding(from) {
            if (!from) return;
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;

            if (from.inMine && PocketCity.isMineOpen()) {
                // 11.7.0: возврат нативного чата шахты (Chat.showForMine())
                // удалён вместе с подсистемой чата — LGChatOne игра вешает сама.
                const city = pageWin.LGCity;
                // Гасим городской слой только пока игра всё ещё на вкладке
                // «Город» (шахта всегда лежит поверх неё). Иначе не мешаем.
                if (PocketCity.activeTabId() === 'city' && city && typeof city.sleep === 'function') {
                    try { city.sleep(); } catch (e) { dbg('LGCity.sleep после здания:', e); }
                }
                dbg('Здание закрыто — вернулись в шахту.');
                return;
            }

            // Шахту успели закрыть (или её не было) — возвращаем вкладку игры.
            const want = String(from.tab || '');
            if (!want || want === 'city') return;
            // Игрок уже сам переключился — не перебиваем его выбор.
            if (PocketCity.activeTabId() !== 'city') return;
            const btn = document.querySelector(`.tabs button[data-tab="${want}"]`);
            if (btn && !btn.hidden) {
                try { btn.click(); } catch (e) { dbg(`Возврат на вкладку «${want}» не сработал:`, e); }
            }
        },
        /**
         * Роутер карточек Карманного Города (v11.6.6f).
         *
         * «guild» — окно гильдий альянса (LGGuilds), всё остальное — нативные
         * здания города через openNativeBuilding().
         */
        openBuilding(roomId) {
            if (roomId === 'guild') return PocketCity.openGuild();
            return PocketCity.openNativeBuilding(roomId);
        },
        /**
         * Окно гильдий альянса из Карманного Города (v11.6.6f).
         *
         * Гильдии живут не в городе, а в отдельном модуле игры
         * (site/guilds.js -> window.LGGuilds), поэтому городской конвейер
         * (вкладка «Город», LGCity.panel, ожидание .cy-room) здесь не нужен:
         * окно открывается из любой локации. Кнопка «Гильдия» в игровом HUD
         * (#gu-hud [data-gu="guild"]) делает ровно то же самое:
         * LGGuilds.open({ big: true }).
         */
        openGuild() {
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;

            // 1. Нативный API модуля гильдий — основной путь.
            const guilds = pageWin.LGGuilds;
            if (guilds && typeof guilds.open === 'function') {
                try {
                    guilds.open({ big: true });
                    dbg('Гильдии открыты через LGGuilds.open()');
                    return;
                } catch (e) {
                    // Не падаем: у игры бывают версии, где окно ещё не готово.
                    dbg('LGGuilds.open() не сработал:', e);
                }
            }

            // 2. Фолбэк — клик по нативной кнопке входа. Их две:
            //    #gu-hud [data-gu="guild"] — шапка игры (app.js);
            //    .cy-hud .gl-entry — вход, который guilds.js сам дорисовывает
            //    в шапку города (есть только на вкладке «Город»).
            const btn = document.querySelector('#gu-hud [data-gu="guild"], .cy-hud .gl-entry');
            if (btn) {
                try {
                    btn.click();
                    dbg('Гильдии открыты кликом по нативной кнопке');
                    return;
                } catch (e) {
                    dbg('Клик по нативной кнопке гильдий не сработал:', e);
                }
            }

            UI.showToast('Окно гильдии недоступно', true);
        },
        /**
         * Недоступна ли гильдия герою (v11.6.6f).
         *
         * Флаг доступа держит сама игра: app.js (guOn) пускает в игровое меню
         * только при ME.user && ME.hero.gu && ME.hero.cy. Берём именно gu —
         * это флаг гильдий. Флаг города cy намеренно НЕ дублируем: в тюрьме и
         * во время похода город закрыт, но окно гильдий у игрока всё равно
         * должно открываться.
         *
         * Пока /api/me не пришёл (нет ME/hero) или поля gu нет вовсе
         * (undefined/null — флаг переименовали или убрали), считаем гильдию
         * доступной: иначе карточка была бы серой у всех подряд. Гасим только
         * явный «ноль»: false или 0.
         */
        isGuildLocked() {
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const me = pageWin.ME;
            const hero = me && me.hero;
            if (!hero || hero.gu == null) return false;
            return !hero.gu;
        },
        async openNativeBuilding(roomId) {
            dbg(`Открытие нативного здания «${roomId}»...`);

            // Игровые объекты (LGCity / __lgQuestContext / cityFiles) живут
            // в page-context: после @grant window — песочница, поэтому берём
            // unsafeWindow (G), как это уже делается в main.js.
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;

            // 0. Запоминаем, откуда пришли (v11.6.4d), чтобы вернуться туда же
            // после закрытия здания. Шахта — оверлей `.mn`, а не вкладка,
            // поэтому она фиксируется отдельным флагом.
            const returnTo = { inMine: PocketCity.isMineOpen(), tab: PocketCity.activeTabId() };

            // 1. Обходим cityLocked (блокировку похода).
            // Шахту намеренно НЕ закрываем: она остаётся открытой под окном
            // здания (как у конкурента), иначе игрока выбрасывало из промысла.
            if (pageWin.__lgQuestContext && typeof pageWin.__lgQuestContext.openTown === 'function') {
                try { pageWin.__lgQuestContext.openTown('fair'); } catch (e) {}
            }

            // 2. Если игра когда-нибудь вынесет cityFiles в page-context —
            // догрузим скрипты сами. Сейчас это локальная функция app.js,
            // поэтому обычно ветка не срабатывает: загрузку запускает клик
            // по вкладке «Город» ниже.
            if (!pageWin.LGCity && typeof pageWin.cityFiles === 'function') {
                try { await pageWin.cityFiles(); } catch (e) {}
            }

            // 3. Принудительно переключаем вкладку на Город
            const cityTabBtn = document.querySelector('.tabs button[data-tab="city"]');
            if (cityTabBtn) {
                cityTabBtn.hidden = false;
                cityTabBtn.removeAttribute('aria-disabled');
                cityTabBtn.classList.remove('tab-lock');
                try { cityTabBtn.click(); } catch (e) {}
            }

            document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-city'));
            document.querySelectorAll('.tabs button').forEach(b => {
                const tab = b.dataset?.tab || b.getAttribute?.('data-tab');
                if (tab === 'city') b.setAttribute('aria-current', 'page');
                else b.removeAttribute('aria-current');
            });

            // 4. Ждём появления LGCity: city.js грузится лениво первым кликом.
            if (!(await PocketCity.waitFor(() => !!pageWin.LGCity, PocketCity.CITY_LOAD_TIMEOUT_MS))) {
                dbg('LGCity не появился вовремя.');
                UI.showToast('Не удалось загрузить модуль города', true);
                return;
            }

            // 5. Ждём готовности города: LGCity.open(el, CX) строит S и .cy-room.
            // До этого panel()/room() — no-op, поэтому первый клик и терялся.
            if (!(await PocketCity.waitFor(() => PocketCity.isCityReady(pageWin), PocketCity.CITY_READY_TIMEOUT_MS))) {
                dbg('Город не загрузился вовремя.');
                UI.showToast('Город не загрузился вовремя', true);
                return;
            }

            // 6. Открываем здание нативным методом. openBuilding — на случай,
            // если игра добавит такой API; сейчас есть panel()/room()
            // (мгновенный openPanel) и goBuilding() (с подходом героя).
            const city = pageWin.LGCity;
            for (const method of ['openBuilding', 'panel', 'room', 'goBuilding']) {
                if (typeof city[method] !== 'function') continue;
                let opened = false;
                try {
                    city[method](roomId);
                    opened = true;
                } catch (err) {
                    dbg(`LGCity.${method}('${roomId}') не сработал:`, err);
                }
                if (!opened) continue;
                dbg(`Здание «${roomId}» открыто через LGCity.${method}()`);
                // Ждём закрытия панели (v11.6.4d) и возвращаем вкладку/шахту.
                PocketCity.watchBuildingClose(returnTo);
                return;
            }

            UI.showToast('Не удалось открыть здание', true);
        },

        // ============================================================
        // 6.5.x. АВТОСКИП БОЁВ С МОНСТРАМИ (v11.7.0)
        //
        // Тумблер «⏭️ Автоскип боёв с монстрами» в «⚙️ Настройках аддона»
        // (ключ localStorage 'LEGION_AUTO_SKIP_MONSTERS', реестр Settings
        // в core/constants.js). Работает только через нативный клик по
        // кнопкам окна `.cm-dlg`: никаких запросов, перехватов LGMine и
        // патчей window.fetch. Поход и арена не затрагиваются.
        // ============================================================

        /**
         * Включение автоскипа. Идемпотентно: повторный вызов не создаёт
         * второй MutationObserver (например, если открыть настройки дважды).
         */
        startMonsterAutoSkip() {
            if (PocketCity._monsterObserver) return true;
            if (typeof MutationObserver !== 'function' || !document.body) return false;

            const observer = new MutationObserver(() => PocketCity.scheduleMonsterSkip());
            // childList + subtree: окно .cm-dlg вставляется в body целиком, а
            // его кнопки дорисовываются позже. attributes/disabled нужен,
            // чтобы поймать момент, когда кнопка перестала быть disabled.
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['disabled'],
            });
            PocketCity._monsterObserver = observer;

            // После «выкл → вкл» метки могли остаться на кнопках живого
            // диалога: без сброса проход уже не нажал бы «Пропустить».
            document.querySelectorAll('.cm-dlg [data-lgu-skipped]').forEach(el => {
                try { delete el.dataset.lguSkipped; } catch (e) {}
            });

            // Окно боя могло быть открыто ещё до включения тумблера —
            // мутации в этом случае не будет, проверяем сразу.
            PocketCity.scheduleMonsterSkip();
            dbg('Автоскип боёв с монстрами включён.');
            return true;
        },

        /**
         * Выключение автоскипа: снимаем наблюдатель, отменяем кадр и все
         * отложенные клики, чтобы после переключения тумблера ничего не нажалось.
         */
        stopMonsterAutoSkip() {
            if (PocketCity._monsterObserver) {
                try { PocketCity._monsterObserver.disconnect(); } catch (e) {}
                PocketCity._monsterObserver = null;
            }
            if (PocketCity._monsterRaf) {
                if (typeof cancelAnimationFrame === 'function') {
                    try { cancelAnimationFrame(PocketCity._monsterRaf); } catch (e) {}
                }
                clearTimeout(PocketCity._monsterRaf);
                PocketCity._monsterRaf = 0;
            }
            PocketCity._monsterTimers.forEach(timer => clearTimeout(timer));
            PocketCity._monsterTimers.clear();
            dbg('Автоскип боёв с монстрами выключен.');
        },

        /**
         * Троттлинг MutationObserver: в городе и бою мутации идут пачками,
         * поэтому один проход на кадр (requestAnimationFrame), лишние
         * вызовы склеиваются в один.
         */
        scheduleMonsterSkip() {
            if (!PocketCity._monsterObserver || PocketCity._monsterRaf) return;
            const run = () => {
                PocketCity._monsterRaf = 0;
                PocketCity.trySkipMonsterFight();
            };
            PocketCity._monsterRaf = (typeof requestAnimationFrame === 'function')
                ? requestAnimationFrame(run)
                : setTimeout(run, 16);
        },

        /**
         * Один проход по открытому окну боя с монстром.
         *
         * Порядок проверок:
         *   1) button[data-all] — «Пропустить всё»: полный скип цепочки
         *      элитного монстра (когда цепочка кончилась, кнопки нет);
         *   2) .cm-fight button[data-sp="skip"] — «Пропустить» одиночного боя.
         *
         * data-lguSkipped защищает от повторного клика, пока игра не закрыла
         * диалог: MutationObserver успевает вызвать проход несколько раз.
         */
        trySkipMonsterFight() {
            const dlg = document.querySelector('.cm-dlg');
            if (!dlg) return;

            let btn = dlg.querySelector('button[data-all]:not([disabled])');
            if (!btn) btn = dlg.querySelector('.cm-fight button[data-sp="skip"]:not([disabled])');
            if (!btn || btn.dataset.lguSkipped) return;

            btn.dataset.lguSkipped = '1';
            // 100 мс: клиент игры вешает обработчик click уже после рендера
            // диалога, поэтому мгновенный click() уходил бы в пустоту.
            const timer = setTimeout(() => {
                PocketCity._monsterTimers.delete(timer);
                // За эту задержку диалог мог закрыться — кликаем только
                // живую и всё ещё активную кнопку.
                if (btn.isConnected && !btn.disabled) {
                    try {
                        btn.click();
                        dbg('Автоскип: нажата кнопка пропуска боя.');
                    } catch (e) {
                        dbg('Автоскип: клик не прошёл:', e);
                    }
                }
            }, PocketCity.MONSTER_SKIP_CLICK_DELAY_MS);
            PocketCity._monsterTimers.add(timer);
        },

        // ============================================================
        // 6.5.y. СБОРЫ ГИЛЬДИИ НА ЭЛИТНЫХ МОНСТРОВ (v11.7.0)
        //
        // Раньше баннер «Идёт сбор в поход» жил в боевом ассистенте и
        // реагировал на q.gather — то есть только когда игрок уже в походе.
        // Теперь уведомление относится к сборам гильдии на элитных монстров
        // и работает из любой локации: опрос POST /api/citymon/act
        // { op: 'elist' } раз в 18 с, вступление — { op: 'ejoin', id }.
        // Никаких патчей window.fetch / LGMine: только Utils.fetchApi.
        // ============================================================

        /**
         * Доступен ли раздел элитных монстров:
         * v11.7.0: надёжный резолв через unsafeWindow/window и LG/ME.
         * Опрос запускается для любого авторизованного героя сразу после
         * загрузки страницы либо при наличии игровых модулей LGCityMon/LGGuilds
         * при условии, что настройка citymonGatherEnabled включена (по умолчанию false).
         */
        canWatchCityMon() {
            if (typeof Settings !== 'undefined' && !Settings.get('citymonGatherEnabled')) return false;
            const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
            const lg = win.LG || window.LG;
            const hero = (typeof lg?.hero === 'function' ? lg.hero() : null)
                || (typeof lg?.me === 'function' ? lg.me()?.hero : null)
                || win.ME?.hero;
            if (hero && typeof hero === 'object' && Object.keys(hero).length > 0) return true;
            return Boolean(win.LGCityMon || win.LGGuilds);
        },

        /**
         * Запуск фонового мониторинга (init() из main.js). Идемпотентно:
         * повторный вызов не плодит второй интервал и слушатель вкладки.
         */
        startCityMonWatch() {
            if (PocketCity._citymonPollTimer) return;
            PocketCity._citymonVisibility = () => {
                // Вернулись на вкладку — не ждём очередные 18 секунд.
                if (!document.hidden) PocketCity.pollCityMonLobbies();
            };
            document.addEventListener('visibilitychange', PocketCity._citymonVisibility);
            PocketCity._citymonPollTimer = setInterval(() => PocketCity.pollCityMonLobbies(), PocketCity.CITYMON_POLL_MS);
            // Первая проверка сразу: сбор мог идти ещё до запуска аддона.
            PocketCity.pollCityMonLobbies();
        },

        /** Остановка мониторинга: интервалы, слушатель вкладки, баннер, DOM. */
        stopCityMonWatch() {
            if (PocketCity._citymonPollTimer) {
                clearInterval(PocketCity._citymonPollTimer);
                PocketCity._citymonPollTimer = null;
            }
            if (PocketCity._citymonVisibility) {
                document.removeEventListener('visibilitychange', PocketCity._citymonVisibility);
                PocketCity._citymonVisibility = null;
            }
            PocketCity.hideCityMonGather();
            if (PocketCity._citymonEl) {
                try { PocketCity._citymonEl.remove(); } catch (e) {}
                PocketCity._citymonEl = null;
            }
            PocketCity._citymonPausedUntil = 0;
            PocketCity._citymonBusy = false;
        },

        /** 429 / rate_limited — общий лимит API игры, значит пауза. */
        isCityMonRateLimited(res) {
            if (!res) return false;
            if (res.status === 429) return true;
            const code = res.error || (res.body && (res.body.error || res.body.err));
            return code === 'rate_limited';
        },

        /**
         * Один цикл опроса elist.
         *
         * @param {boolean} force переопрос после ejoin/ошибки: игнорирует
         *   паузу по 429, но не скрытую вкладку и не отсутствие доступа
         */
        async pollCityMonLobbies(force = false) {
            // Свёрнутая вкладка — не опрашиваем (условие ТЗ 11.7.0).
            if (document.hidden) return;
            if (typeof Settings !== 'undefined' && !Settings.get('citymonGatherEnabled')) {
                PocketCity.hideCityMonGather();
                return;
            }
            if (!PocketCity.canWatchCityMon()) {
                PocketCity.hideCityMonGather();
                return;
            }
            if (PocketCity._citymonBusy) return;
            if (!force && Date.now() < PocketCity._citymonPausedUntil) return;

            PocketCity._citymonBusy = true;
            const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
            let res = null;
            try {
                if (typeof Utils !== 'undefined' && typeof Utils.fetchApi === 'function') {
                    res = await Utils.fetchApi('/api/citymon/act', { op: 'elist' });
                } else if (typeof win.fetch === 'function') {
                    const url = (win.LG_BASE || '') + '/api/citymon/act';
                    const r = await win.fetch(url, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ op: 'elist' })
                    });
                    const d = await r.json().catch(() => null);
                    res = { ok: r.ok && (d ? d.ok !== false : true), status: r.status, body: d, data: d, ...(d && typeof d === 'object' && !Array.isArray(d) ? d : {}) };
                }
            } catch (e) {
                dbg('citymon elist error:', e);
            } finally {
                PocketCity._citymonBusy = false;
            }

            if (PocketCity.isCityMonRateLimited(res)) {
                PocketCity._citymonPausedUntil = Date.now() + PocketCity.CITYMON_PAUSE_MS;
                dbg('citymon: 429/rate_limited — пауза 60 с');
                return;
            }

            const data = (res && typeof res === 'object') ? (res.body || res.data || res) : {};
            const isOk = Boolean(res?.ok ?? data?.ok);
            if (!res || !isOk) return; // сеть/сервер: баннер не трогаем

            // v11.7.0: игрок не состоит в гильдии — пауза на 5 минут,
            // чтобы не делать лишних запросов для игроков без гильдии.
            // res.guild может быть объектом { gid, name } при наличии гильдии.
            const guild = res.guild !== undefined ? res.guild : (data.guild !== undefined ? data.guild : undefined);
            const isNoGuild = guild === false || guild === null || (guild && typeof guild === 'object' && 'gid' in guild && !guild.gid);
            if (isNoGuild) {
                this._citymonPausedUntil = Date.now() + 300000;
                PocketCity._citymonPausedUntil = this._citymonPausedUntil;
                PocketCity.hideCityMonGather();
                return;
            }

            const lobby = PocketCity.findCityMonLobby(res);
            if (lobby) PocketCity.showCityMonGather(lobby);
            else PocketCity.hideCityMonGather();
        },

        /**
         * Первое подходящее открытое лобби: не моё, не истекло, есть места,
         * игрок не скрывал его вручную (✕).
         *
         * @param {object} res ответ /api/citymon/act: { ok, mine, list[] }
         * @returns {object|null} лобби L из list
         */
        findCityMonLobby(res) {
            if (!res) return null;
            const data = (res && typeof res === 'object') ? (res.body || res.data || res) : {};
            if (res.mine || data.mine) return null; // уже состою в каком-то сборе
            const list = Array.isArray(res.list) ? res.list : (Array.isArray(data.list) ? data.list : []);
            const now = Date.now();
            for (const L of list) {
                if (!L || L.st !== 'open' || L.mine) continue;
                if (PocketCity._citymonDismissed.has(L.id)) continue;
                // v11.7.0: until может приходить в секундах (< 1e12) или миллисекундах
                const untilMs = (L.until && +L.until < 1e12) ? +L.until * 1000 : (+L.until || 0);
                if (untilMs <= now) continue;
                const members = Array.isArray(L.members) ? L.members.length : 0;
                if (members >= (+L.max || 5)) continue;
                return L;
            }
            return null;
        },

        /**
         * v11.7.0: применение класса размера плашки уведомления (S / M / L).
         */
        applyGatherSize(size) {
            const s = (size || (typeof Settings !== 'undefined' ? Settings.get('citymonGatherSize') : null) || 'L').toLowerCase();
            const el = PocketCity._citymonEl || document.getElementById('lg-citymon-gather');
            if (el) {
                el.classList.remove('lg-cm-size-s', 'lg-cm-size-m', 'lg-cm-size-l');
                el.classList.add(`lg-cm-size-${s}`);
            }
        },

        /**
         * init() из boot() в main.js: поднимаем автоскип, если тумблер был
         * включён в прошлой сессии (настройка хранится в localStorage),
         * и запускаем фоновый мониторинг сборов на элитных монстров (если включено).
         */
        init() {
            if (Settings.get('autoSkipMonsters')) PocketCity.startMonsterAutoSkip();
            if (Settings.get('citymonGatherEnabled')) PocketCity.startCityMonWatch();
        },

        /**
         * Плавающее уведомление о чужом сборе (плашка в стиле аддона).
         *
         * Перерисовываем только при смене лобби: у того же L.id текст
         * подписи обновляет секундный тик, кнопки остаются живыми (иначе
         * слетала бы блокировка «Вступаем...» и фокус).
         */
        showCityMonGather(lobby) {
            if (!lobby || !document.body) return;
            const esc = (s) => (typeof Utils !== 'undefined' && Utils.escapeHtml ? Utils.escapeHtml(s) : String(s == null ? '' : s));

            let el = PocketCity._citymonEl;
            if (!el || !el.isConnected) {
                el = document.createElement('div');
                el.id = 'lg-citymon-gather';
                document.body.appendChild(el);
                PocketCity._citymonEl = el;
            }
            el.classList.add('on');
            PocketCity.applyGatherSize();

            const sameLobby = !!PocketCity._citymonLobby && PocketCity._citymonLobby.id === lobby.id;
            PocketCity._citymonLobby = lobby;

            if (sameLobby && el.querySelector('.lg-cm-gather')) {
                PocketCity.updateCityMonCaption();
                return;
            }

            el.innerHTML = `
                <div class="lg-cm-gather">
                    <div class="lg-cm-gather-head">📯 Сбор на элитного: ${esc(lobby.name)} (ур. ${esc(lobby.lvl == null ? '?' : lobby.lvl)}${lobby.tier ? ' ☠' : ''})</div>
                    <div class="lg-cm-gather-sub"></div>
                    <div class="lg-cm-gather-row">
                        <button type="button" class="lg-cm-gather-join">Присоединиться</button>
                        <button type="button" class="lg-cm-gather-close" title="Скрыть уведомление">✕</button>
                    </div>
                </div>
            `;

            const joinBtn = el.querySelector('.lg-cm-gather-join');
            if (joinBtn) joinBtn.addEventListener('click', () => PocketCity.joinCityMonLobby(joinBtn));

            const closeBtn = el.querySelector('.lg-cm-gather-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    const cur = PocketCity._citymonLobby;
                    // Скрываем точечно: остальные сборы продолжат всплывать.
                    if (cur && cur.id != null) PocketCity._citymonDismissed.add(cur.id);
                    PocketCity.hideCityMonGather();
                });
            }

            PocketCity.updateCityMonCaption();
            // Живой обратный отсчёт: правим только текст подписи.
            if (!PocketCity._citymonTickTimer) {
                PocketCity._citymonTickTimer = setInterval(() => PocketCity.updateCityMonCaption(), PocketCity.CITYMON_TICK_MS);
            }
        },

        /** Подпись баннера: состав, лидер и MM:SS до конца сбора. */
        cityMonCaption(lobby) {
            const L = lobby || PocketCity._citymonLobby;
            if (!L) return '';
            const members = Array.isArray(L.members) ? L.members.length : 0;
            const max = +L.max || 5;
            const untilMs = (L.until && +L.until < 1e12) ? +L.until * 1000 : (+L.until || 0);
            const left = Math.max(0, untilMs - Date.now());
            // ceil: на последней секунде показываем 00:01, а не 00:00 раньше времени.
            const total = Math.ceil(left / 1000);
            const mm = String(Math.floor(total / 60)).padStart(2, '0');
            const ss = String(total % 60).padStart(2, '0');
            return `Отряд: ${members}/${max} · Лидер: ${L.leader || '—'} · ${mm}:${ss}`;
        },

        /** Обновляет только текст подписи (кнопки и их состояние не трогаем). */
        updateCityMonCaption() {
            const el = PocketCity._citymonEl;
            if (!el) return;
            const sub = el.querySelector('.lg-cm-gather-sub');
            if (!sub) return;
            sub.textContent = PocketCity.cityMonCaption();
        },

        /** Прячет плашку и гасит секундный отсчёт (лобби забываем). */
        hideCityMonGather() {
            PocketCity._citymonLobby = null;
            if (PocketCity._citymonTickTimer) {
                clearInterval(PocketCity._citymonTickTimer);
                PocketCity._citymonTickTimer = null;
            }
            const el = PocketCity._citymonEl;
            if (!el) return;
            el.classList.remove('on');
            el.innerHTML = '';
        },

        /**
         * Вступление в сбор: POST /api/citymon/act { op: 'ejoin', id }.
         *
         * Кнопка блокируется на время запроса («Вступаем...»), результат —
         * тостом. В обоих случаях список перечитываем (elist): после успеха
         * своё лобби уже mine, после ошибки сбор мог закрыться/заполниться.
         */
        async joinCityMonLobby(btn) {
            if (!btn || btn.disabled) return;
            const lobby = PocketCity._citymonLobby;
            if (!lobby) return;

            const label = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Вступаем...';

            const toast = (msg, isError) => {
                if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(msg, !!isError);
            };

            const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
            let res = null;
            try {
                if (typeof Utils !== 'undefined' && typeof Utils.fetchApi === 'function') {
                    res = await Utils.fetchApi('/api/citymon/act', { op: 'ejoin', id: lobby.id });
                } else if (typeof win.fetch === 'function') {
                    const url = (win.LG_BASE || '') + '/api/citymon/act';
                    const r = await win.fetch(url, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ op: 'ejoin', id: lobby.id })
                    });
                    const d = await r.json().catch(() => null);
                    res = { ok: r.ok && (d ? d.ok !== false : true), status: r.status, body: d, data: d, ...(d && typeof d === 'object' && !Array.isArray(d) ? d : {}) };
                }
            } catch (e) {
                dbg('citymon ejoin error:', e);
            }

            const data = (res && typeof res === 'object') ? (res.body || res.data || res) : {};
            const isOk = Boolean(res?.ok ?? data?.ok);

            if (res && isOk) {
                toast(`Вы вступили в сбор на «${lobby.name}»!`, false);
                // Плашку гасим сразу, а список перечитываем — возможно,
                // открылся следующий сбор.
                PocketCity.hideCityMonGather();
                PocketCity.pollCityMonLobbies(true);
                return;
            }

            if (PocketCity.isCityMonRateLimited(res)) {
                PocketCity._citymonPausedUntil = Date.now() + PocketCity.CITYMON_PAUSE_MS;
            }
            const errText = (res && (res.error || (res.body && (res.body.error || res.body.err)) || (res.data && (res.data.error || res.data.err)))) || '';
            toast(errText || 'Не удалось вступить', true);

            // Пока шёл запрос, плашку могли скрыть/перерисовать.
            if (btn.isConnected) {
                btn.disabled = false;
                btn.textContent = label || 'Присоединиться';
            }
            PocketCity.pollCityMonLobbies(true);
        },

        /**
         * destroy() из shutdown() в main.js: снимаем наблюдатель и таймеры,
         * иначе старый инстанс кликал бы по кнопкам после перезапуска скрипта.
         * v11.7.0: заодно гасим мониторинг сборов на элитных монстров.
         */
        destroy() {
            PocketCity.stopMonsterAutoSkip();
            PocketCity.stopCityMonWatch();
            if (PocketCity._closeWatch) {
                try { PocketCity._closeWatch(); } catch (e) {}
                PocketCity._closeWatch = null;
            }
        }
    };

    return PocketCity;
})();

    // ===== src/modules/combat-assistant.js =====
    // ============================================================
    // 6.6. МОДУЛЬ: БОЕВОЙ АССИСТЕНТ (modules/combat-assistant.js)
    //
    // Подсказки по механикам боссов в походе (патч 11.6.2b): раз в секунду
    // читает состояние похода штатным геттером игры LGQuest._view()
    // (структура — docs/API.md, раздел «Объект состояния похода»).
    // Вывод — поверх экрана: предупреждение «ничего не пиши» без кнопок либо
    // кликабельный бейдж с командой (v11.7.1: кнопка «Вставить» убрана —
    // клик по самому слову копирует его в буфер).
    //
    // v11.7.0: автоотправки POST /api/qsay здесь нет и не было — аддон только
    // копирует команду в буфер и/или подставляет её в #qSayIn нативным
    // сеттером. Отправляет игрок сам по Enter.
    //
    // v11.7.0: игра ставит noPaste на поле команды похода, поэтому модуль
    // дополнительно вешает capture-перехватчик (paste/beforeinput/drop) и
    // глушит ТОЛЬКО игровые обработчики — нативная вставка Ctrl+V и
    // «ПКМ → Вставить» остаются рабочими.
    //
    // Баннер сбора в поход (q.gather) отсюда убран: уведомление о сборах
    // теперь живёт в modules/pocket-city.js и относится к элитным монстрам
    // (elist/ejoin), см. PocketCity.startCityMonWatch().
    //
    // Подключается после core/ui.js и modules/pocket-city.js (SHARED_MODULES
    // в build.js). Игровые объекты берём из G (core/constants.js — это
    // unsafeWindow): после @grant window — песочница, LGQuest в ней не виден.
    // ============================================================
    const CombatAssistant = {
        _el: null,
        _timer: null,
        // Подпись текущей отрисовки: защита от мерцания на каждом тике.
        _currentState: null,
        // v11.7.0: capture-обработчики вставки в #qSayIn (снимаются в destroy).
        _pasteGuards: null,

        init() {
            // Повторный init (перезапуск скрипта) не должен плодить таймеры.
            if (this._el) return;
            this._el = document.createElement('div');
            this._el.id = 'lg-combat-assistant';
            document.body.appendChild(this._el);
            this._bindPasteGuards();
            this._timer = setInterval(() => this._tick(), 1000);
        },

        // Гасим интервал и DOM при перезапуске скрипта (см. shutdown в main.js),
        // иначе старый таймер продолжал бы тикать рядом с новым.
        destroy() {
            if (this._timer) clearInterval(this._timer);
            this._timer = null;
            this._unbindPasteGuards();
            if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
            this._el = null;
            this._currentState = null;
        },

        _tick() {
            // Тумблер в настройках аддона (ключ LEGION_COMBAT_ASSIST, дефолт — вкл).
            const enabled = localStorage.getItem('LEGION_COMBAT_ASSIST') !== 'false';
            if (!enabled) {
                this._clear();
                return;
            }

            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const quest = pageWin.LGQuest;
            if (!quest || typeof quest._view !== 'function') {
                this._clear();
                return;
            }

            try {
                const q = quest._view();
                if (!q || !q.on) {
                    this._clear();
                    return;
                }

                // Подсказки нужны только полноправному участнику похода:
                // party = 'q' (очередь), 'ghost' (призрак), 'out' — не наш бой.
                if (q.party !== 'in') {
                    this._clear();
                    return;
                }

                this._render(this._evaluate(q));
            } catch (e) {
                console.warn('[LGU] CombatAssistant error:', e);
            }
        },

        /**
         * v11.7.0: поле команды похода? Игра вешает noPaste именно на него:
         * id — #qSayIn (site/quest.js), класс — .q-sayi (фолбэк, если id
         * переименуют). Проверяем оба признака.
         */
        _isQuestInput(el) {
            return !!el && (el.id === 'qSayIn' || !!(el.classList && el.classList.contains('q-sayi')));
        },

        /**
         * Capture-перехват вставки в #qSayIn (v11.7.0).
         *
         * Игра гасит paste/drop и beforeinput(insertFromPaste|Drop) на самом
         * поле, а игроку нужны штатные Ctrl+V и «ПКМ → Вставить». Слушатели
         * висят на window в фазе перехвата — то есть срабатывают РАНЬШЕ
         * обработчиков документа/поля — и глушат только их
         * (stopImmediatePropagation). preventDefault НЕ вызываем: иначе
         * браузер не вставит текст из буфера сам.
         *
         * window.fetch / LGMine здесь не патчатся: только DOM-события.
         */
        _bindPasteGuards() {
            if (this._pasteGuards) return;
            const onPasteCapture = (e) => {
                if (this._isQuestInput(e.target)) e.stopImmediatePropagation();
            };
            const onBeforeInputCapture = (e) => {
                // inputType бывает только у InputEvent; если поля нет —
                // ветка не срабатывает, и вставку ловит обработчик paste.
                if (this._isQuestInput(e.target) &&
                    /^insertFrom(Paste|Drop|PasteAsQuotation)$/.test(e.inputType || '')) {
                    e.stopImmediatePropagation();
                }
            };
            this._pasteGuards = { onPasteCapture, onBeforeInputCapture };
            window.addEventListener('paste', onPasteCapture, true);
            window.addEventListener('beforeinput', onBeforeInputCapture, true);
            window.addEventListener('drop', onPasteCapture, true);
        },

        /** Снимаем все три слушателя (destroy / перезапуск скрипта). */
        _unbindPasteGuards() {
            if (!this._pasteGuards) return;
            const { onPasteCapture, onBeforeInputCapture } = this._pasteGuards;
            window.removeEventListener('paste', onPasteCapture, true);
            window.removeEventListener('beforeinput', onBeforeInputCapture, true);
            window.removeEventListener('drop', onPasteCapture, true);
            this._pasteGuards = null;
        },

        /**
         * Смерть героя: обычный бой — b.hp === 0, босс — bg.in и bg.my <= 0.
         * Проверки повторяют deadIn() из site/quest.js.
         */
        _isDead(q) {
            return (q.b && q.b.st !== 'end' && q.b.hp === 0) ||
                   (q.bg && q.bg.st !== 'end' && q.bg.in && !(q.bg.my > 0));
        },

        /**
         * Предупреждение о дебаффе отряда из нового состояния похода.
         *
         * После неудачного привала игра пишет v.wk = [локаций_осталось,
         * %_снижения_урона]. Пока первый элемент > 0, весь урон отряда
         * снижен — предупреждаем игрока рядом с подсказкой.
         *
         * @param {object} q состояние похода из LGQuest._view()
         * @returns {string} '' или готовая строка предупреждения
         */
        _weaknessHint(q) {
            // v.wk — вложенный снимок, но часть клиентов отдаёт wk на верхнем
            // уровне; поддерживаем оба варианта, чтобы не зависеть от версии.
            const wk = (q && (q.wk || (q.v && q.v.wk))) || null;
            if (!Array.isArray(wk) || !(+wk[0] > 0)) return '';
            const locs = +wk[0];
            const pct = +wk[1] || 0;
            return `Урон снижен на ${pct}% (${locs} лок.)`;
        },

        /**
         * Решение по текущему состоянию похода + предупреждение о дебаффе.
         *
         * Оборачивает _evaluateCore: к hint добавляется строка про v.wk.
         * Если других подсказок нет (IDLE), показываем отдельную заметку,
         * чтобы ослабление не терялось между ходами.
         *
         * @param {object} q состояние похода из LGQuest._view()
         * @returns {{action: 'IDLE'|'NOTE'|'SILENCE'|'COMMAND', text?: string, hint?: string}}
         */
        _evaluate(q) {
            const res = this._evaluateCore(q);
            // v11.7.1: информативный заголовок «Внимание: …». Если ветка не
            // задала what сама — описываем ситуацию по состоянию похода
            // (телеграф, ловушка, событие, площадка, механика босса).
            if (res && res.action === 'COMMAND' && !res.what) res.what = this._situationText(q);
            const warn = this._weaknessHint(q);
            if (!warn) return res;
            if (res && res.action === 'IDLE') return this._isDead(q) ? res : { action: 'NOTE', text: warn };
            if (!res) return { action: 'NOTE', text: warn };
            res.hint = res.hint ? `${warn} · ${res.hint}` : warn;
            return res;
        },

        /**
         * v11.7.1: человеческое описание происходящего для заголовка
         * «Внимание: …» — чтобы игрок сразу видел суть угрозы.
         *
         * Источники (docs/API.md, «Объект состояния похода»):
         *   b.tele.text / b.tele.word — слово телеграфа;
         *   tr.name — ловушка, ev.name — событие, pz.kind — площадка;
         *   bg.mech.name / .text / .id — механика босса.
         *
         * @param {object} q состояние похода из LGQuest._view()
         * @returns {string} '' — описание не нашлось
         */
        _situationText(q) {
            const b = (q && q.b) || null;
            const tele = b && b.tele;
            if (tele) {
                const t = String(tele.text || tele.word || '').trim();
                if (t) return `телеграф: «${t}»`;
            }
            const tr = q && q.tr;
            if (tr && tr.name) return `ловушка «${tr.name}»`;
            const ev = q && q.ev;
            if (ev && ev.name) return `событие «${ev.name}»`;
            const pz = q && q.pz;
            if (pz && pz.kind) return `площадка: ${pz.kind}`;
            const M = q && q.bg && q.bg.mech;
            if (M) {
                const nm = String(M.name || M.text || '').trim();
                if (nm) return nm;
                if (M.id) return `механика ${M.id}`;
            }
            return '';
        },

        /**
         * Решение по текущему состоянию похода.
         * Порядок приоритетов: смерть -> запрет ввода -> механики -> обычный ход.
         *
         * @param {object} q состояние похода из LGQuest._view()
         * @returns {{action: 'IDLE'|'SILENCE'|'COMMAND', text?: string, hint?: string}}
         */
        _evaluateCore(q) {
            // 1. Смерть героя.
            if (this._isDead(q)) return { action: 'IDLE' };

            // 2. Газ в ловушке: писать нельзя, пока он не рассеется.
            if (q.tr && q.tr.gas && (q.tr.st === 'act' || q.tr.st === 'wait')) {
                return { action: 'SILENCE', text: '⚠️ ФИНТ / ТИШИНА — ничего не пиши!' };
            }

            // 3. Режим тишины босса. Логика 1:1 с sayHush() из site/quest.js:
            //    финт (mech.fake), семейство 'silence' (кроме M94/M55 — там
            //    молчать не нужно) и текстовая подсказка «не пиши / молчите».
            const M = q.bg && q.bg.mech;
            if (M) {
                if (M.fake === true) {
                    return { action: 'SILENCE', text: '⚠️ ФИНТ / ТИШИНА — ничего не пиши!' };
                }
                const silentFam = M.fam === 'silence' && M.id !== 'M94' && M.id !== 'M55';
                const silentTip = /ничего не пиш|молчите|не пишите/i.test(M.tip || '');
                if (silentFam || silentTip) {
                    return { action: 'SILENCE', text: '⚠️ ФИНТ / ТИШИНА — ничего не пиши!' };
                }
            }

            // 3.1. Финт/тишина на телеграфе обычного боя (docs/API.md: tele.fake,
            //      tele.hush). Писать слово в этом случае запрещено.
            if (q.b && q.b.tele && (q.b.tele.fake === true || q.b.tele.hush === true)) {
                return { action: 'SILENCE', text: '⚠️ ФИНТ / ТИШИНА — ничего не пиши!' };
            }

            // 4. Фонари Джека-Фонарщика: hw.lan.lit — 6 фонарей, false = погас.
            //    Команда зажигает один фонарь, поэтому берём первый погасший.
            if (q.bg && q.bg.hw && q.bg.hw.lan && Array.isArray(q.bg.hw.lan.lit)) {
                const offIdx = q.bg.hw.lan.lit.map((v, i) => (v ? 0 : i + 1)).filter(Boolean);
                if (offIdx.length > 0) {
                    return { action: 'COMMAND', text: `зажечь ${offIdx[0]}`, hint: 'Погас фонарь', what: 'погас фонарь — нужно зажечь' };
                }
            }

            // 5. Укус волка: bite — кусаемые площадки, area — своя площадка.
            //    Прыгаем на свободную И достижимую площадку: соседей берём из
            //    zn.a = [[номер, соседи, полигон]] — та же схема, что в zonesHtml().
            if (q.bg && Array.isArray(q.bg.bite) && q.bg.area) {
                if (q.bg.bite.includes(q.bg.area)) {
                    const Z = q.bg.zn || {};
                    const gone = Array.isArray(Z.gone) ? Z.gone : [];
                    const zones = Array.isArray(Z.a) ? Z.a : [];
                    const myRow = zones.find(a => Array.isArray(a) && a[0] === q.bg.area);
                    const neighbours = (myRow && Array.isArray(myRow[1])) ? myRow[1] : [];
                    const safe = zones
                        .map(a => (Array.isArray(a) ? a[0] : 0))
                        .filter(z => z && z !== q.bg.area && !q.bg.bite.includes(z) && !gone.includes(z));
                    const reachable = neighbours.length ? safe.filter(z => neighbours.includes(z)) : safe;
                    const target = reachable.length ? reachable[0] : safe[0];
                    if (target) {
                        return { action: 'COMMAND', text: `прыжок ${target}`, hint: 'Укус волка! Прыгай', what: 'укус волка — уходи с площадки' };
                    }
                }
            }

            // 6. Крылья (механика HPG10): у каждого крыла своя квота got/need.
            //    Если на своём крыле квота набрана, а на другом — нет,
            //    перепрыгиваем в первое недобранное крыло (W.z — площадки крыла).
            if (q.bg && M && M.id === 'HPG10' && q.bg.wings) {
                const W = q.bg.wings;
                const wingsZ = Array.isArray(W.z) ? W.z : [];
                const myWingIdx = q.bg.area
                    ? wingsZ.findIndex(z => Array.isArray(z) && z.includes(q.bg.area))
                    : -1;
                if (myWingIdx >= 0 && (W.got?.[myWingIdx] || 0) >= (W.need?.[myWingIdx] || 0)) {
                    const openWingIdx = wingsZ.findIndex((z, i) => (W.got?.[i] || 0) < (W.need?.[i] || 0));
                    const target = openWingIdx >= 0 ? (wingsZ[openWingIdx] || [])[0] : null;
                    if (target) {
                        return { action: 'COMMAND', text: `прыжок ${target}`, hint: 'Крыло закрыто! Смени позицию', what: 'квота крыла набрана — смени позицию' };
                    }
                }
            }

            // 7. Осадные орудия и приспешники: adds = [[имя, count, hpRatio]].
            //    count = 0 — осадное орудие/ворота (бьётся без номера),
            //    count > 0 — приспешники («удар ИМЯ N»); hpRatio <= 0 — уже добит.
            if (q.bg && Array.isArray(q.bg.adds)) {
                const alive = q.bg.adds.filter(a => Array.isArray(a) && a[2] > 0);
                const siege = alive.find(a => !(+a[1] > 0));
                if (siege) return { action: 'COMMAND', text: `удар ${siege[0]}`, hint: 'Цель осады', what: `цель осады — ${siege[0]}` };
                const mob = alive.find(a => +a[1] > 0);
                if (mob) return { action: 'COMMAND', text: `удар ${mob[0]} 1`, hint: 'Убей приспешника', what: `приспешник — ${mob[0]}` };
            }

            // 8. Телеграф в обычном бою: слово парирования (b.tele.word).
            //    'tele2' в текущем клиенте не встречается, оставлен на всякий случай.
            if (q.b && (q.b.st === 'tele' || q.b.st === 'tele2') && q.b.tele && q.b.tele.word) {
                // v11.7.1: заголовок уведомления — суть происходящего.
                // tele.text (расшифровка игры) приоритетнее самого слова.
                const teleText = String(q.b.tele.text || '').trim();
                const what = teleText
                    ? `телеграф: ${teleText}`
                    : `ответ на телеграф: ${q.b.tele.word}`;
                return { action: 'COMMAND', text: q.b.tele.word, hint: 'Ответ на телеграф', what };
            }

            // 9. Напоминание о своём ходе (b.turn пуст — ход в раунде не сделан).
            if (q.b && q.b.st === 'party' && !q.b.turn) {
                return { action: 'COMMAND', text: 'удар', hint: 'Твой ход', what: 'твой ход — нужна команда' };
            }

            return { action: 'IDLE' };
        },

        _clear() {
            if (this._el && this._el.innerHTML) this._el.innerHTML = '';
            // Сбрасываем подпись: иначе после паузы та же команда не отрисуется.
            this._currentState = null;
        },

        /**
         * Копирование команды в буфер обмена (клик по бейджу).
         * Подпись бейджа кратко меняется на «Скопировано ✓».
         */
        _copyCmd(el, text) {
            const restore = () => {
                if (!el || !el.isConnected) return;
                el.textContent = text;
                el.classList.remove('copied');
            };
            const done = () => {
                if (!el || !el.isConnected) return;
                el.textContent = 'Скопировано ✓';
                el.classList.add('copied');
                setTimeout(restore, 1200);
            };
            const fail = () => {
                if (typeof UI !== 'undefined' && UI.showToast) {
                    UI.showToast(`Не удалось скопировать. Текст: ${text}`, true);
                }
            };

            if (typeof Utils === 'undefined' || typeof Utils.copyText !== 'function') {
                fail();
                return;
            }
            Utils.copyText(text).then(ok => (ok ? done() : fail()), fail);
        },

        /**
         * Вставка подсказки в поле команды похода.
         *
         * v11.6.2b.1: логика (нативный сеттер value + input/change, обход
         * запрета вставки quest.js) вынесена в общий хелпер core/utils.js —
         * он же нужен кнопке «❤» в модуле пати. Автоотправки нет: игрок жмёт
         * Enter сам.
         *
         * v11.7.1: кнопка «Вставить» из уведомления убрана (остался только
         * клик по слову = копирование), поэтому метод пока НЕ вызывается из
         * UI. Оставлен для консольной отладки и возможного возврата кнопки —
         * удаление согласовывать с владельцем проекта.
         *
         * @returns {boolean} true — текст оказался в поле ввода
         */
        _insert(text) {
            if (typeof Utils === 'undefined' || typeof Utils.insertToQuestChat !== 'function') return false;
            const inserted = Utils.insertToQuestChat(text);
            if (inserted && typeof UI !== 'undefined' && UI.showToast) {
                UI.showToast(`Вставлено: ${text} — Enter, чтобы отправить`);
            }
            return inserted;
        },

        _render(res) {
            if (!this._el) return;
            if (!res || res.action === 'IDLE') {
                this._clear();
                return;
            }

            const esc = (s) => (typeof Utils !== 'undefined' && Utils.escapeHtml ? Utils.escapeHtml(s) : String(s == null ? '' : s));

            if (res.action === 'NOTE') {
                // v11.6.3: дебафф ослабления (v.wk) без активной подсказки —
                // показываем отдельную жёлтую заметку, а не баннер «НЕ ПИШИ».
                const sign = `note|${res.text}`;
                if (this._currentState === sign) return;
                this._currentState = sign;
                this._el.innerHTML = `<div class="lg-combat-note">⚠️ ${esc(res.text)}</div>`;
                return;
            }

            if (res.action === 'SILENCE') {
                // Баннер перерисовываем только при смене текста (антимерцание),
                // но ГАЗ -> ФИНТ -> ТИШИНА обязаны подменять друг друга.
                const sign = `silence|${res.text}`;
                if (this._currentState === sign) return;
                this._currentState = sign;
                this._el.innerHTML = `<div class="lg-combat-banner">${esc(res.text)}</div>`;
                return;
            }

            if (res.action === 'COMMAND') {
                const cmd = String(res.text == null ? '' : res.text);
                // v11.7.1: заголовок — «Внимание: {что происходит}», а не
                // общее «Ответ на телеграф». what задаёт _evaluateCore /
                // _situationText, hint остаётся запасным вариантом.
                const what = String(res.what || res.hint || 'нужна команда');
                // Не перерисовывать, если состояние не изменилось.
                const sign = `cmd|${what}|${cmd}`;
                if (this._currentState === sign) return;
                this._currentState = sign;

                // Команда — единственный кликабельный элемент: по клику слово
                // копируется в буфер («Скопировано ✓»). Кнопки «Вставить»
                // больше нет, автоотправки тоже нет.
                this._el.innerHTML = `
                    <div class="lg-combat-suggest">
                        <div class="lg-combat-info">
                            <div class="lg-combat-hint">Внимание: ${esc(what)}</div>
                            <button type="button" class="lg-combat-cmd" data-copy-cmd="${esc(cmd)}" title="Нажми, чтобы скопировать">${esc(cmd)}</button>
                        </div>
                    </div>
                `;

                const copyBtn = this._el.querySelector('[data-copy-cmd]');
                if (copyBtn) copyBtn.addEventListener('click', () => this._copyCmd(copyBtn, cmd));
            }
        }
    };

    // Для доступа из консоли страницы: window аддона — песочница, поэтому
    // публикуем в page-context через G (unsafeWindow), как это делает main.js.
    try {
        const caWin = (typeof G !== 'undefined' && G) ? G : window;
        caWin.LegionCombatAssistant = CombatAssistant;
    } catch (e) {}

    // ===== src/modules/party.js =====
    // ============================================================
    // 9. МОДУЛЬ: ПАТИ (группы игроков, шаг 1)
    //
    // Клиент к собственному серверу (server/), а не к API игры: запросы
    // идут мимо /c/<канал>/ через GM_xmlhttpRequest (см. AGENTS.md, §3:
    // домен сервера чужой для игры, поэтому обычный fetch упёрся бы в CORS
    // и CSP страницы `connect-src 'self'`).
    //
    // Хранилище — GM_setValue/GM_getValue (@grant в шапке):
    //   lgPartyBaseUrl — адрес сервера (по умолчанию https://legion.ctrlfree.host, см. v11.6.0e/f);
    //   lgParty        — {groupId, inviteToken, sessionId, login}
    //                    (inviteToken — техническое имя поля сервера,
    //                     в интерфейсе это «Код приглашения»);
    //   lgPartyOwner   — создал ли этот клиент пати.
    // Если GM-хранилище недоступно (старая версия скрипта без @grant),
    // молча падаем на localStorage, иначе модуль падал бы на первом клике.
    //
    // Шаг 1 = только auth/token-gate: create/join/leave/rotate/kick/members.
    // v11.6.0a: вход — по коду приглашения (inviteToken, POST /party/join),
    // memberId отдельно от sessionId, серверный leave и lowercase-логины.
    // Ник читается из игры ТОЛЬКО в момент клика «Создать»/«Присоединиться».
    // v11.6.0a.2: ник и HP берутся из GET /api/me (user.login / hero.hpNow),
    // LG_CH.login — только фолбэк: в песочнице он бывает пустым.
    // v11.6.0a.3: пустое состояние рисуется синхронно, поэтому при первом
    // открытии «Вы: …» показывал фолбэк LG_CH.login (логин Twitch-канала).
    // Теперь open() дозапрашивает /api/me в фоне и обновляет ТОЛЬКО текстовый
    // узел ника (.party-self-nick): полная перерисовка сбила бы фокус в поле
    // кода приглашения.
    // v11.6.0b: HP-панель. Раз в 3 с (только когда мы в пати) клиент шлёт
    // POST /party/:id/state и перерисовывает список из GET /party/:id/state.
    // v11.6.0c: журнал боя. В том же тике сравниваем снимки /api/me и шлём
    // события в POST /party/:id/log (quest_start/quest_end/death/heal).
    // v11.6.0c.1: добавлен тип damage («HP -N») — урон уменьшением hp.
    // v11.6.0d: взаимный хил. В строке HP-панели у раненого союзника появляется
    // кнопка «❤». v11.6.2b.1: прямой POST /api/qact убран — кнопка теперь
    // подставляет в поле похода команду «лечить @ник» через общий хелпер
    // Utils.insertToQuestChat() (core/utils.js), отправляет игрок по Enter.
    // Кнопка только если цель не мы, цель ранена, свой герой в походе и наш
    // класс — жрец (v11.6.0g-2: _prevMe.role === 'priest').
    // Под HP-панелью — блок «Журнал» с ленивой догрузкой GET .../log?since=.
    // v11.6.0g-2: UI-патч. В интерфейсе «inviteToken» называется «Код
    // приглашения»; модалка переведена на классы core/styles.js (тёмный фон,
    // золотистые акценты, hover как у «Создать пати»); HP-панель и журнал
    // живут в общем контейнере .party-hud-container и перетаскиваются за
    // заголовки, позиция — GM_setValue('lgPartyHudPos').
    // v11.6.3c: HP-синхронизация переведена на события PerformanceObserver
    // (запросы игры к /api/me и /api/qact): панель обновляется сразу после
    // ответа игры, а не по таймеру. Интервал 3 с оставлен фолбэком и растянут
    // до 30 с (АФК, скрытая вкладка, игра перестала слать запросы). Серии
    // запросов при загрузке страницы гасит троттлинг 2 с в _hpTick().
    // v11.6.6: штатный источник HP — событие `me` живого канала игры
    // (LGLiveLink.open -> SSE/WS). Оно несёт полный стейт героя (hpNow,
    // stats.hp), поэтому свой GET /api/me на каждое изменение больше не
    // нужен: _onHeroUpdate() обновляет панель по кэшу и шлёт нашему серверу
    // снимок. PerformanceObserver остаётся резервом: он не запускается, если
    // канал подтверждён событием `me`, и работает, если LGLiveLink недоступен
    // или хук не успел к уже открытому каналу.
    // ============================================================
    const Party = {
        BASE_URL_KEY: 'lgPartyBaseUrl',
        STATE_KEY: 'lgParty',
        OWNER_KEY: 'lgPartyOwner',
        // Позиция HUD {left, top} после перетаскивания (v11.6.0g-2).
        DRAG_KEY: 'lgPartyHudPos',
        DEFAULT_BASE_URL: 'https://legion.ctrlfree.host',
        // v11.6.0g-6: ключ доступа к нашему серверу. Должен совпадать с API_KEY
        // в server/index.js (env LGU_API_KEY) — иначе любой запрос получит 401.
        API_KEY: 'LGU-default-secret-key-change-me',
        REQUEST_TIMEOUT: 12000,
        // v11.6.3c: штатный триггер — PerformanceObserver (ответы игры на
        // /api/me и /api/qact), поэтому интервал стал страховкой на случай,
        // когда игра перестала слать запросы (АФК, вкладка в фоне, зависший
        // бой). ТЗ 11.6.0b ставило здесь 3000 мс.
        HP_SYNC_MS: 30000,
        // Троттлинг _hpTick(): игра отдаёт несколько /api/me подряд при
        // загрузке страницы, а каждый тик — это POST + GET на наш сервер.
        // 3000, а не 2000 (11.6.3-release): наш собственный _fetchMe() тоже
        // пишет resource-запись /api/me, и при окне 2 с медленный ответ успевал
        // «дозреть» после тика — observer запускал следующий тик от нашего же
        // запроса. 3 с гарантированно больше латентности и совпадает со старым
        // периодом опроса.
        HP_TICK_MIN_MS: 3000,
        // Сервер хранит ник только в нижнем регистре (server/index.js).
        LOGIN_RE: /^[a-z0-9_]{1,32}$/,
        // Код приглашения (inviteToken) = 16 случайных байт = 32 hex-символа
        // (server/db.js).
        INVITE_RE: /^[a-f0-9]{32}$/i,

        // Журнал боя (ТЗ 11.6.0c).
        LOG_LIMIT: 100,      // размер страницы догрузки (сервер: default 100, max 200)
        LOG_DOM_MAX: 500,    // столько же строк хранит сервер (trimLog, maxRows=500)
        // Цвет строки по типу события; остальные — обычный цвет текста панели.
        // damage — оранжевый, чтобы отличать урон от death (розовый);
        // heal_cast (хил по кнопке, v11.6.0d) — тот же зелёный, что и heal.
        LOG_COLORS: {
            damage: '#ff9a5a',
            heal_cast: '#5fd987',
            death: '#ff5a7a',
            heal: '#5fd987',
            drop: '#ffcf6a',
            system: '#888'
        },
        LOG_DEFAULT_COLOR: '#e8e8ea',

        // Рантайм-поля. Объявлены явно, чтобы в отладке не ловить undefined.
        _hpTimer: null,      // setInterval HP-синхронизации (фолбэк, 30 с)
        _hpBusy: false,      // тик уже в работе (медленная сеть)
        _lastHpTick: 0,      // Date.now() прошлого тика — троттлинг HP_TICK_MIN_MS
        _perfObserver: null, // PerformanceObserver: resource-записи /api/me, /api/qact
        // v11.6.6: живой канал игры (LGLiveLink) — штатный источник HP.
        _liveLinkHooked: false,  // обёртка LGLiveLink.open установлена
        _liveLinkSeen: false,    // пришло хотя бы одно событие `me`
        _liveLinkDead: false,    // инстанс выключен (destroy) — события игнорируем
        _liveLinkOrigOpen: null, // оригинальный LGLiveLink.open (для снятия хука)
        _liveLinkWrapper: null,  // наша обёртка (identity-проверка при unhook)
        _liveLinkInstance: null, // последний открытый инстанс канала
        _lastStates: null,       // последний GET /party/:id/state (кэш панели)
        _lastSelfHp: null,       // {hp, maxHp} последней отрисовки — фильтр повторов
        _cachedLogin: '',    // последний ник из /api/me — для синхронного рендера
        // Промис фонового /api/me для .party-self-nick: повторные open() не
        // должны плодить одинаковые запросы, пока первый ещё в полёте.
        _selfNickFetch: null,
        // Контейнер HUD (v11.6.0g-2): HP-панель и журнал — его дети, поэтому
        // перетаскивание за заголовок двигает оба блока сразу.
        HUD_ID: `${RAND_ID}-party-hud`,
        _hudResizeBound: false, // слушатель resize навешен (clamp при смене размера)
        // id панели с префиксом RAND_ID: чужие page-стили не должны её зацепить.
        PANEL_ID: `${RAND_ID}-party-hp-panel`,

        // Журнал боя: панель и состояние догрузки.
        LOG_PANEL_ID: `${RAND_ID}-party-log-panel`,
        _prevMe: null,       // предыдущий снимок /api/me для детектора событий
        _logOpen: true,      // панель развёрнута (свёрнутая не опрашивает сервер)
        _logBusy: false,     // GET/POST журнала уже в полёте
        _logSince: 0,        // nextSince с сервера (id последней известной строки)
        _logReady: false,    // первичная загрузка (limit=100) выполнена
        _logBodyEl: null,    // .party-log-body — кэш, чтобы не искать каждый тик

        // Чат пати (v11.7.0): панель и оперативное состояние
        CHAT_PANEL_ID: `${RAND_ID}-party-chat-panel`,
        _chatMessages: [],
        _chatSince: 0,
        _chatCollapsed: false,
        _chatUnread: 0,
        _chatBusy: false,
        _chatBodyEl: null,

        // v11.6.0g-2: инлайн-стили форм заменены классами из core/styles.js —
        // только так работают hover/focus-эффекты (inline :hover невозможен).
        // Кнопка «❤»: pointer-events:auto обязателен, сама панель —
        // pointer-events:none, чтобы не перехватывать клики по игре.
        INPUT_CLASS: 'party-input',
        TOKEN_INPUT_CLASS: 'party-input party-token',
        BTN_CLASS: 'party-btn',
        DANGER_BTN_CLASS: 'party-btn party-btn-danger',
        HEAL_BTN_CLASS: 'party-heal-btn',
        MUTED_CLASS: 'party-muted',

        /* ---------------------------------------------------------- */
        /* Хранилище                                                   */
        /* ---------------------------------------------------------- */

        _gmGet(key, fallback = null) {
            try {
                if (typeof GM_getValue === 'function') {
                    const v = GM_getValue(key, fallback);
                    return v === undefined ? fallback : v;
                }
            } catch (e) {
                dbg('[PARTY] GM_getValue недоступен:', e);
            }
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) return fallback;
                try { return JSON.parse(raw); } catch (e) { return raw; }
            } catch (e) {
                return fallback;
            }
        },

        _gmSet(key, value) {
            try {
                if (typeof GM_setValue === 'function') {
                    GM_setValue(key, value);
                    return;
                }
            } catch (e) {
                dbg('[PARTY] GM_setValue недоступен:', e);
            }
            try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
        },

        /** Сохранённое состояние пати либо null, если его нет/оно битое. */
        _readState() {
            let state = this._gmGet(this.STATE_KEY, null);
            if (typeof state === 'string') {
                // В localStorage значение лежит строкой — пробуем разобрать.
                try { state = JSON.parse(state); } catch (e) { return null; }
            }
            if (!state || typeof state !== 'object') return null;
            if (!state.groupId || !state.sessionId) return null;
            return state;
        },

        _writeState(party, isOwner) {
            const prev = this._readState();
            if (!party || (prev && prev.groupId !== party.groupId)) {
                this._resetChat();
            }
            this._gmSet(this.STATE_KEY, party);
            this._gmSet(this.OWNER_KEY, !!isOwner);
            // В пати появились/обновились данные — поднимаем HP-синхронизацию.
            // Повторный вызов безопасен: второй интервал не создаётся.
            this.startHpSync();
        },

        _isOwner() {
            return this._gmGet(this.OWNER_KEY, false) === true;
        },

        /**
         * Локальный сброс пати: чистит хранилище и перерисовывает модалку в
         * состояние «нет пати». Отдельного рендера не нужно: open() при
         * пустом состоянии сам показывает _modalHtmlEmpty().
         *
         * Используется и при выходе (partyLeave), и при 401 от сервера
         * (сессию убили киком или выходом владельца).
         */
        _resetLocalState() {
            // Интервал HP живёт только при активной пати: гасим его и прячем
            // панель до того, как перерисуем модалку (ТЗ 11.6.0b).
            this.stopHpSync();
            this._gmSet(this.STATE_KEY, null);
            this._gmSet(this.OWNER_KEY, false);
            // open() синхронно закроет текущую модалку и вставит новую.
            this.open().catch((e) => dbg('[PARTY] перерисовать модалку не удалось:', e));
        },

        /** База сервера без хвостовых слэшей. */
        getBaseUrl() {
            const saved = this._gmGet(this.BASE_URL_KEY, '');
            if (typeof saved === 'string' && saved.trim()) {
                return saved.trim().replace(/\/+$/, '');
            }
            // TODO (шаг 2+): поле «адрес сервера» в модалке для владельца пати.
            // Пока адрес меняется только через хранилище скрипта.
            return this.DEFAULT_BASE_URL;
        },

        /**
         * Канал игры (LG_CH.login). LG_CH живёт в page-context, поэтому читаем
         * строго через G (см. AGENTS.md §2). Нужен и для URL /api/me, и как
         * фолбэк-ник, если запрос к игре не удался.
         */
        _channelLogin() {
            try {
                return String(G?.LG_CH?.login || '').trim();
            } catch (e) {
                return '';
            }
        },

        /**
         * Ник и HP из игры: GET /c/<канал>/api/me (credentials: include).
         *
         * Источник истины для ника — user.login из ответа, а не LG_CH: в
         * песочнице Tampermonkey LG_CH бывает недоступен/устарел, и сервер
         * получал бы пустой логин. Запрос идёт обычным fetch: это тот же
         * origin (страница игры), поэтому CORS не при чём.
         *
         * Фолбэк: если /api/me упал — берём G.LG_CH.login и пишем console.warn
         * (ТЗ 11.6.0a.2). hp/maxHp в этом случае null, и HP-тик просто не
         * отправляет стейт, но панель продолжает работать по данным сервера.
         *
         * v11.6.0c: сюда же добавлены quest (ql из /api/me) и ghost — они
         * нужны детектору событий журнала. live=false означает фолбэк:
         * сравнивать такой снимок с предыдущим нельзя, иначе пропавший
         * /api/me выглядел бы как «вышел из похода» + «воскрес».
         *
         * v11.6.0g-2: добавлен role (hero.role) — кнопка «❤» рисуется только
         * жрецу, а роль видна только из /api/me.
         *
         * @returns {Promise<{login: string, hp: number|null, maxHp: number|null,
         *                    quest: object|null, ghost: boolean, role: string,
         *                    live: boolean}>}
         */
        async _fetchMe() {
            const channel = this._channelLogin();
            if (!channel) {
                console.warn('[PARTY] LG_CH.login недоступен — /api/me не запросить');
                return { login: '', hp: null, maxHp: null, quest: null, ghost: false, role: 'unknown', live: false };
            }

            try {
                const res = await fetch(`/c/${encodeURIComponent(channel)}/api/me`, {
                    credentials: 'include',
                    cache: 'no-store'
                });
                const data = await res.json().catch(() => null);
                const login = data?.user?.login;
                if (!res.ok || !login) {
                    throw new Error(`HTTP ${res.status}: нет user.login`);
                }

                // hero.stats.hp — максимум здоровья, hero.hpNow — текущее
                // (docs/API.md, §GET /api/me; в игре hpNow ?? stats.hp).
                const hp = Number(data.hero?.hpNow);
                const maxHp = Number(data.hero?.stats?.hp);
                // Класс героя (docs/API.md, §GET /api/me: "role": "priest").
                // 'unknown' — когда поля нет: хил тогда недоступен.
                const role = data.hero?.role || 'unknown';

                // ql — объект состояния похода (docs/API.md, §ql). При on:false
                // похода нет, поэтому нормализуем в null: детектору журнала
                // нужен простой признак «был/не был», а не форма снимка.
                const ql = data.ql;
                const quest = (ql && typeof ql === 'object' && ql.on !== false) ? ql : null;

                const me = {
                    login: String(login),
                    hp: Number.isFinite(hp) ? hp : null,
                    maxHp: Number.isFinite(maxHp) ? maxHp : null,
                    quest,
                    ghost: data.hero?.ghost === true,
                    role,
                    live: true
                };
                this._cachedLogin = me.login;
                return me;
            } catch (e) {
                console.warn('[PARTY] /api/me недоступен, берём LG_CH.login:', e);
                this._cachedLogin = channel;
                return { login: channel, hp: null, maxHp: null, quest: null, ghost: false, role: 'unknown', live: false };
            }
        },

        /**
         * Ник для показа в «нет пати». Синхронно (модалка рисуется сразу):
         * последний известный из /api/me, иначе LG_CH.login, иначе пусто.
         */
        _defaultNick() {
            return this._cachedLogin || this._channelLogin();
        },

        /**
         * Ник для отправки на сервер: читается из /api/me в момент клика,
         * чтобы не зафиксировать пустой/устаревший логин при открытии модалки.
         * @returns {Promise<string>} lowercase-логин
         */
        async _currentLogin() {
            const me = await this._fetchMe();
            if (!me.login) {
                throw new Error('Игра не загрузилась, попробуйте позже');
            }
            return this._normalizeLogin(me.login);
        },

        _normalizeLogin(login) {
            const nick = String(login ?? '').trim().toLowerCase();
            if (!this.LOGIN_RE.test(nick)) {
                throw new Error('Ник: 1–32 символа, только a–z, 0–9 и _');
            }
            return nick;
        },

        /** Человеческий текст ошибки по коду из ответа сервера. */
        _errorText(status, data, fallback) {
            const map = {
                bad_login: 'Ник: 1–32 символа, только a–z, 0–9 и _',
                bad_invite: 'Неверный код приглашения',
                bad_invite_token: 'Некорректный код приглашения',
                login_taken: 'Этот ник уже занят в пати',
                party_not_found: 'Пати с таким кодом приглашения не найдена — проверьте код',
                unauthorized: 'Сессия недействительна — войдите в пати заново',
                not_owner: 'Действие доступно только владельцу пати',
                not_member: 'Эта сессия не принадлежит пати',
                cannot_kick_self: 'Нельзя кикнуть себя',
                bad_member: 'Не указан участник для кика',
                member_not_found: 'Такого участника нет в пати',
                session_not_found: 'Такой сессии нет в пати',
                rate_limited: 'Слишком много попыток входа, подождите минуту',
                internal: 'Внутренняя ошибка сервера пати'
            };
            return map[data?.error] || data?.message || fallback || `HTTP ${status}`;
        },

        /* ---------------------------------------------------------- */
        /* HTTP                                                        */
        /* ---------------------------------------------------------- */

        _partyPath(action) {
            const state = this._readState();
            if (!state) throw new Error('Вы не в пати');
            return `/party/${encodeURIComponent(state.groupId)}/${action}`;
        },

        /**
         * Запрос к серверу пати через GM_xmlhttpRequest.
         * @param {string} method
         * @param {string} path   например '/party' или '/party/<id>/members'
         * @param {{body?: object|null, auth?: boolean}} options
         */
        _request(method, path, options = {}) {
            const auth = options.auth !== false;
            const url = this.getBaseUrl() + path;

            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest !== 'function') {
                    reject(new Error('GM_xmlhttpRequest недоступен: проверьте @grant в шапке'));
                    return;
                }

                const headers = { 'Content-Type': 'application/json' };
                // v11.6.0g-6: без этого заголовка сервер отвечает 401 — ключ
                // проверяется до роутинга, включая POST /party и /party/join.
                headers['X-Legion-Key'] = this.API_KEY;
                const state = this._readState();
                if (auth && state?.sessionId) {
                    headers.Authorization = 'Bearer ' + state.sessionId;
                }

                const data = options.body === undefined || options.body === null
                    ? null
                    : JSON.stringify(options.body);

                GM_xmlhttpRequest({
                    method,
                    url,
                    headers,
                    data: data === null ? undefined : data,
                    timeout: this.REQUEST_TIMEOUT,
                    onload: (res) => {
                        let payload = null;
                        try {
                            payload = res.responseText ? JSON.parse(res.responseText) : null;
                        } catch (e) {
                            payload = null;
                        }

                        if (res.status >= 200 && res.status < 300) {
                            resolve(payload);
                            return;
                        }

                        // 401 на bearer-эндпоинте = сессия мертва (кик, выход
                        // владельца, удалённая пати). POST /party и
                        // POST /party/join идут с auth:false и сюда не попадают.
                        // Локальное состояние чистим сразу, иначе клиент
                        // застрянет в «пати», которой уже нет.
                        if (res.status === 401 && auth) {
                            this._resetLocalState();
                            if (state) UI.showToast('Сессия истекла — вы вне пати', true);
                        }

                        const err = new Error(this._errorText(res.status, payload, `HTTP ${res.status}`));
                        err.status = res.status;
                        err.code = payload?.error || null;
                        err.sessionExpired = payload?.code === 'session_expired';
                        reject(err);
                    },
                    onerror: () => reject(new Error(`Сервер пати недоступен: ${url}`)),
                    ontimeout: () => reject(new Error(`Сервер пати не ответил за ${this.REQUEST_TIMEOUT / 1000} с: ${url}`)),
                    onabort: () => reject(new Error('Запрос к серверу пати отменён'))
                });
            });
        },

        /* ---------------------------------------------------------- */
        /* Публичный API (шаг 1)                                       */
        /* ---------------------------------------------------------- */

        /**
         * POST /party — создать пати. Клиент становится владельцем.
         * Ник берётся из игры в момент вызова (не из поля ввода).
         * @returns {Promise<{groupId: string, inviteToken: string, sessionId: string, login: string}>}
         */
        async partyCreate() {
            const nick = await this._currentLogin();
            const res = await this._request('POST', '/party', { body: { login: nick }, auth: false });
            if (!res?.groupId || !res?.inviteToken || !res?.sessionId) {
                throw new Error('Сервер вернул неполный ответ при создании пати');
            }
            const party = {
                groupId: res.groupId,
                inviteToken: res.inviteToken,
                sessionId: res.sessionId,
                login: nick
            };
            this._writeState(party, true);
            return party;
        },

        /**
         * POST /party/join — войти по коду приглашения.
         * groupId на клиенте не нужен: сервер находит пати по токену и
         * возвращает groupId в ответе.
         * @param {string} inviteToken код приглашения: 32 hex-символа (пробелы обрезаются)
         * @returns {Promise<{groupId: string, inviteToken: string, sessionId: string, login: string}>}
         */
        async partyJoin(inviteToken) {
            const token = String(inviteToken ?? '').trim();
            if (!token) throw new Error('Укажите код приглашения');
            if (!this.INVITE_RE.test(token)) throw new Error('Код приглашения: 32 hex-символа');
            const nick = await this._currentLogin();

            const res = await this._request(
                'POST',
                '/party/join',
                { body: { inviteToken: token, login: nick }, auth: false }
            );
            if (!res?.groupId || !res?.sessionId) {
                throw new Error('Сервер вернул неполный ответ при входе в пати');
            }
            const party = {
                groupId: res.groupId,
                inviteToken: token,
                sessionId: res.sessionId,
                login: nick
            };
            this._writeState(party, false);
            return party;
        },

        /**
         * DELETE /party/:id/leave, затем локальный сброс состояния.
         *
         * Владелец удаляет пати целиком (сервер вернёт deleted: "party"),
         * участник — только свою сессию (deleted: "self"). Если сервер
         * недоступен, локальное состояние всё равно чистим через
         * _resetLocalState(), иначе клиент застрял бы в «пати», которой уже
         * нет; пользователь получает предупреждение, что ник мог остаться
         * занятым.
         *
         * @returns {Promise<boolean>} true, если сервер подтвердил выход
         */
        async partyLeave() {
            const state = this._readState();
            let serverFailed = false;
            let alreadyReset = false;

            if (state) {
                try {
                    await this._request('DELETE', `/party/${encodeURIComponent(state.groupId)}/leave`);
                } catch (e) {
                    const status = Number(e?.status) || 0;
                    // 401/404 — сессии или пати уже нет (кик, чужой выход):
                    // локальная чистка как раз то, что нужно, без пугалки.
                    // При 401 _request() уже вызвал _resetLocalState().
                    if (status === 401) alreadyReset = true;
                    else if (status !== 404) serverFailed = true;
                    dbg('[PARTY] leave на сервере не удался:', e);
                }
            }

            // Единственная точка очистки: и здесь, и в 401-обработчике.
            if (!alreadyReset) this._resetLocalState();

            if (serverFailed) {
                UI.showToast(
                    'Не удалось связаться с сервером, выход только локальный — ник может остаться занятым',
                    true
                );
            }
            return !serverFailed;
        },

        /** @returns {{party: object|null, isOwner: boolean}} */
        partyState() {
            return { party: this._readState(), isOwner: this._isOwner() };
        },

        /**
         * POST /party/:id/rotate — перевыпустить код приглашения (только владелец).
         * @returns {Promise<string>} новый код приглашения
         */
        async partyRotateToken() {
            const state = this._readState();
            if (!state) throw new Error('Вы не в пати');
            if (!this._isOwner()) throw new Error('Код приглашения может перевыпустить только владелец пати');

            const res = await this._request('POST', this._partyPath('rotate'), { body: {} });
            if (!res?.inviteToken) throw new Error('Сервер не вернул новый код приглашения');

            this._writeState({ ...state, inviteToken: res.inviteToken }, true);
            return res.inviteToken;
        },

        /**
         * POST /party/:id/kick — исключить участника (только владелец).
         * @param {string} memberId memberId участника из partyMembers()
         */
        async partyKick(memberId) {
            if (!this._isOwner()) throw new Error('Кикать может только владелец пати');
            const target = String(memberId ?? '').trim();
            if (!target) throw new Error('Не указан memberId участника');

            await this._request('POST', this._partyPath('kick'), {
                body: { memberId: target }
            });
            return true;
        },

        /**
         * GET /party/:id/members — список участников.
         * Сервер отдаёт только публичные поля: {login, joinedAt, memberId,
         * role, self}. sessionId не приходит никому и никогда (это bearer).
         * @returns {Promise<Array<{login: string, joinedAt: number, memberId: string, role: 'owner'|'member', self: boolean}>>}
         */
        async partyMembers() {
            const res = await this._request('GET', this._partyPath('members'));
            return Array.isArray(res?.members) ? res.members : [];
        },

        /* ---------------------------------------------------------- */
        /* HP-панель и синхронизация состояния (шаг 2, v11.6.0b)      */
        /* ---------------------------------------------------------- */

        /* ---------------------------------------------------------- */
        /* HUD: контейнер, перетаскивание, clamp (v11.6.0g-2)          */
        /* ---------------------------------------------------------- */

        /**
         * Контейнер HUD: HP-панель и журнал — его дети, поэтому drag за любой
         * заголовок двигает оба блока сразу (ТЗ 11.6.0g-2 п.1).
         * Позиция берётся из GM_setValue('lgPartyHudPos'); пока её нет —
         * работает CSS-якорь top/right из core/styles.js.
         * pointer-events:none у контейнера: клики по игре не перехватываются,
         * интерактивные узлы возвращают auto в CSS (.party-drag-handle и др.).
         */
        _ensureHud() {
            let hud = document.getElementById(this.HUD_ID);
            if (hud && hud.isConnected) return hud;

            hud = document.createElement('div');
            hud.id = this.HUD_ID;
            hud.className = 'party-hud-container';
            document.body.appendChild(hud);

            // Сохранённую позицию применяем сразу; clamp внутри проверит
            // размеры — пока панели display:none, rect нулевой и он no-op.
            this._applyHudPosition(hud);

            // Смена размера окна: панель могла уехать за границы (п.6).
            if (!this._hudResizeBound) {
                this._hudResizeBound = true;
                window.addEventListener('resize', () => this._clampHud());
            }
            return hud;
        },

        /**
         * Применяет сохранённую позицию HUD {left, top}. Вызывается при
         * создании контейнера и на каждом рендере панели (ТЗ 11.6.0g-2 п.4).
         * Позиции нет — возвращаем CSS-якорь (right:20px, top:20px).
         */
        _applyHudPosition(hud = null) {
            const el = hud || document.getElementById(this.HUD_ID);
            if (!el) return;
            // Пока тащат, сохранённую позицию не навязываем: рендер приходит по
            // событиям игры и иначе дёргал бы панель из-под курсора.
            if (el.classList.contains('party-dragging')) return;

            const pos = this._gmGet(this.DRAG_KEY, null);
            const left = Number(pos?.left);
            const top = Number(pos?.top);
            if (!Number.isFinite(left) || !Number.isFinite(top)) {
                el.style.left = '';
                el.style.top = '';
                el.style.right = '20px';
                el.style.bottom = '';
                return;
            }

            el.style.left = `${Math.round(left)}px`;
            el.style.top = `${Math.round(top)}px`;
            el.style.right = 'auto';
            el.style.bottom = 'auto';
            this._clampHud(el);
        },

        /**
         * Возвращает HUD в пределы окна (ТЗ 11.6.0g-2 п.6): left/top
         * ограничиваются так, чтобы правый/нижний край не выходил за экран.
         * Скрытые панели имеют нулевые размеры — их не трогаем.
         */
        _clampHud(hud = null) {
            const el = hud || document.getElementById(this.HUD_ID);
            if (!el || !el.isConnected) return;

            const left = parseFloat(el.style.left);
            const top = parseFloat(el.style.top);
            // Панель ещё на CSS-якоре (right:20px) — двигать нечего.
            if (!Number.isFinite(left) || !Number.isFinite(top)) return;

            const rect = el.getBoundingClientRect();
            if (!rect.width && !rect.height) return; // оба блока скрыты

            const maxLeft = Math.max(0, (window.innerWidth || 0) - rect.width);
            const maxTop = Math.max(0, (window.innerHeight || 0) - rect.height);
            el.style.left = `${Math.round(Math.min(Math.max(0, left), maxLeft))}px`;
            el.style.top = `${Math.round(Math.min(Math.max(0, top), maxTop))}px`;
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        },

        /**
         * Перетаскивание за заголовок (ТЗ 11.6.0g-2 п.2–3).
         * pointerdown/move/up покрывают и мышь, и тач (touch-action:none в CSS).
         * В GM-хранилище позиция пишется ТОЛЬКО на отпускании: запись на
         * каждый pointermove — лишние обращения к хранилищу Tampermonkey.
         * @param {HTMLElement|null} handle заголовок панели или журнала
         */
        _bindHudDrag(handle) {
            if (!handle || handle.dataset.partyDragBound === '1') return;
            handle.dataset.partyDragBound = '1';

            let drag = null;

            const onMove = (e) => {
                if (!drag) return;
                const hud = document.getElementById(this.HUD_ID);
                if (!hud) return;
                const rect = hud.getBoundingClientRect();
                const maxLeft = Math.max(0, (window.innerWidth || 0) - rect.width);
                const maxTop = Math.max(0, (window.innerHeight || 0) - rect.height);
                const left = Math.min(Math.max(0, drag.left + (e.clientX - drag.startX)), maxLeft);
                const top = Math.min(Math.max(0, drag.top + (e.clientY - drag.startY)), maxTop);
                hud.style.left = `${Math.round(left)}px`;
                hud.style.top = `${Math.round(top)}px`;
                hud.style.right = 'auto';
                hud.style.bottom = 'auto';
                if (e.cancelable) e.preventDefault();
            };

            const onUp = () => {
                if (!drag) return;
                drag = null;
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);

                const hud = document.getElementById(this.HUD_ID);
                if (!hud) return;
                hud.classList.remove('party-dragging');

                const left = parseFloat(hud.style.left);
                const top = parseFloat(hud.style.top);
                if (Number.isFinite(left) && Number.isFinite(top)) {
                    this._gmSet(this.DRAG_KEY, { left: Math.round(left), top: Math.round(top) });
                }
            };

            handle.addEventListener('pointerdown', (e) => {
                // Только ЛКМ/касание; кнопки внутри заголовка (▾ журнала) не тащат.
                if (e.button) return;
                if (e.target && typeof e.target.closest === 'function' && e.target.closest('button')) return;

                const hud = document.getElementById(this.HUD_ID);
                if (!hud) return;
                const rect = hud.getBoundingClientRect();
                // Стартовые left/top — реальные координаты контейнера: он мог
                // стоять на CSS-якоре right:20px, а тащим уже в left/top.
                drag = { startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top };
                hud.classList.add('party-dragging');
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
                e.preventDefault();
            });
        },

        /**
         * HP-панель создаётся лениво внутри HUD-контейнера (v11.6.0g-2) и
         * живёт до перезагрузки страницы. Тёмный фон и скругления — класс
         * .party-panel из core/styles.js; заголовок «ПАТИ · HP» получает
         * .party-drag-handle (pointer-events:auto, cursor:grab).
         */
        _ensurePanel() {
            const hud = this._ensureHud();
            let el = document.getElementById(this.PANEL_ID);
            if (el && el.isConnected) {
                // После повторной инъекции скрипта панель могла остаться в body.
                if (el.parentElement !== hud) hud.appendChild(el);
                this._bindPanelClick(el);
                this._bindHudDrag(el.querySelector('.party-panel-title'));
                this._applyHudPosition(hud);
                return el;
            }

            el = document.createElement('div');
            el.id = this.PANEL_ID;
            el.className = 'party-panel';
            el.setAttribute('role', 'status');
            hud.appendChild(el);
            this._bindPanelClick(el);
            return el;
        },

        /**
         * Делегированный клик по кнопке «Хил» (v11.6.0d).
         *
         * Слушатель живёт на самой панели, а не на кнопках: _renderPanel()
         * переписывает innerHTML на каждом тике, и отдельные обработчики текли
         * бы/терялись. dataset-флаг не даёт навесить второй такой же слушатель,
         * если панель уже существовала в DOM (перезапуск скрипта на странице).
         */
        _bindPanelClick(el) {
            if (!el || el.dataset.partyHealBound === '1') return;
            el.dataset.partyHealBound = '1';
            el.addEventListener('click', (e) => {
                const target = e.target;
                const btn = (target && typeof target.closest === 'function')
                    ? target.closest('[data-party-heal]')
                    : null;
                if (!btn || btn.disabled) return;
                this._healMember(btn.getAttribute('data-party-heal'), btn);
            });
        },

        _hidePanel() {
            const el = document.getElementById(this.PANEL_ID);
            if (el) el.style.display = 'none';
        },

        /**
         * Перерисовка списка «ник: hp/maxHp» с цветовой полоской:
         * зелёный > 50%, жёлтый 20–50%, красный < 20% HP.
         * v11.6.0d: у раненого союзника в строке есть кнопка «❤» (_healMember).
         * v11.6.0g-2: кнопка — только жрецу (this._prevMe.role === 'priest');
         * заголовок панели стал drag-handle для перетаскивания HUD.
         * v11.6.6: opts.skipLog — не трогать журнал. Нужен _patchSelfHp():
         * событие `me` приходит часто, а _syncLogPanel() каждый раз делает
         * GET /party/:id/log. Журнал опрашивает тик синхронизации.
         * @param {Array<{login: string, hp: number, maxHp: number}>} states
         * @param {{skipLog?: boolean}} [opts]
         */
        _renderPanel(states, opts = {}) {
            const el = this._ensurePanel();
            const list = Array.isArray(states) ? states : [];

            // Свой ник берём из локального состояния: GET /party/:id/state
            // отдаёт только {login, hp, maxHp, updatedAt}, поля self там нет.
            const selfLogin = String(this._readState()?.login || '').toLowerCase();
            // Лечить можно только из похода — вне похода игра отклоняет запрос.
            // _prevMe появляется после первого «живого» снимка /api/me в _hpTick();
            // пока его нет, кнопку не рисуем (заведомо провальный запрос).
            const inQuest = !!this._prevMe?.quest;
            // v11.6.0g-2: класс героя. Роль приходит из /api/me (hero.role) и
            // кэшируется в _prevMe; у остальных классов кнопки «❤» нет вообще.
            const isPriest = this._prevMe?.role === 'priest';

            const rows = list.map((s) => {
                const nick = String(s.login || '?');
                const login = Utils.escapeHtml(nick);
                const rawMax = Math.max(0, Number(s.maxHp) || 0);
                const rawHp = Math.max(0, Number(s.hp) || 0);
                // hp не может быть больше максимума; при maxHp = 0 (битые
                // данные) показываем hp как есть, полоска остаётся пустой.
                const hp = Math.min(rawMax > 0 ? rawMax : rawHp, rawHp);
                const pct = rawMax > 0 ? Math.max(0, Math.min(100, (hp / rawMax) * 100)) : 0;
                // Ровно 50% — уже не «зелёный» (ТЗ: зелёный строго > 50%).
                const color = pct > 50 ? '#5fd987' : (pct < 20 ? '#ff5a7a' : '#ffcf6a');

                // Кнопка «Хил» (ТЗ 11.6.0d) — только если: мы жрец, цель не мы,
                // цель ранена (hp < maxHp) и свой герой в походе.
                const showHeal = isPriest
                    && inQuest
                    && nick.toLowerCase() !== selfLogin
                    && rawMax > 0
                    && rawHp < rawMax;
                const healBtn = showHeal
                    ? `<button type="button" class="${this.HEAL_BTN_CLASS}" data-party-heal="${login}"`
                        + ' title="Скопировать команду лечения">❤</button>'
                    : '';

                return `<div class="party-member-row">
                    <div class="party-member-info">
                        <span class="party-member-name">${login}:</span>
                        <span class="party-member-hp-val">
                            <span class="party-hp-num">${hp}/${rawMax}</span>
                            ${healBtn}
                        </span>
                    </div>
                    <div class="party-hp-track">
                        <div class="party-hp-fill" style="width:${pct.toFixed(1)}%; background:${color};"></div>
                    </div>
                </div>`;
            }).join('');

            // Заголовок — drag-handle (ТЗ 11.6.0g-2 п.2): .party-drag-handle
            // даёт pointer-events:auto и cursor:grab, т.к. сама панель
            // pointer-events:none и клики по игре не перехватывает.
            el.innerHTML = '<div class="party-panel-title party-drag-handle" title="Перетащить панель">'
                + '<span>Пати · HP</span></div>'
                + (rows || '<div style="color:#888;">Нет данных</div>');
            el.style.display = 'block';

            // innerHTML пересоздал заголовок — слушатель drag вешаем заново
            // (dataset-флаг не даёт задвоить его на одном и том же узле).
            this._bindHudDrag(el.querySelector('.party-panel-title'));

            // Позиция из хранилища применяется на каждом рендере (п.4).
            this._applyHudPosition();

            // Журнал и чат — соседи по HUD-контейнеру; их видимость и догрузку
            // синхронизируем на каждом тике (v11.6.6: кроме быстрых
            // перерисовок из _patchSelfHp, иначе каждое `me` = GET журнала).
            if (!opts.skipLog) {
                this._syncLogPanel();
                this._syncChatPanel();
            }
        },

        /* ---------------------------------------------------------- */
        /* Журнал боя (шаг 3, v11.6.0c)                               */
        /* ---------------------------------------------------------- */

        /**
         * Скрыть и очистить журнал. Вызывается из stopHpSync() — то есть на
         * leave и на 401: список прошлой пати после выхода показывать нельзя.
         */
        _hideLogPanel() {
            const el = document.getElementById(this.LOG_PANEL_ID);
            if (el) el.style.display = 'none';

            this._clearLog();
            this._logSince = 0;
            this._logReady = false;
            this._prevMe = null;
        },

        /**
         * Панель журнала создаётся лениво внутри HUD-контейнера (v11.6.0g-2):
         * раньше это был отдельный fixed-блок, который _positionLogPanel()
         * ставил вручную под HP-панель. Теперь оба блока — соседи по
         * flex-column с gap 8px, поэтому отступы считает CSS.
         */
        _ensureLogPanel() {
            const hud = this._ensureHud();
            let el = document.getElementById(this.LOG_PANEL_ID);
            if (el && el.isConnected) {
                if (el.parentElement !== hud) hud.appendChild(el);
                this._logBodyEl = el.querySelector('.party-log-body');
                this._bindHudDrag(el.querySelector('.party-log-head'));
                return el;
            }

            el = document.createElement('div');
            el.id = this.LOG_PANEL_ID;
            el.className = 'party-log-panel';

            // Заголовок статичный — innerHTML допустим. Строки событий
            // вставляются только через textContent (текст от других игроков).
            // .party-log-head — drag-handle: тянем за «Журнал», кнопка ▾
            // остаётся кликабельной (pointerdown по button игнорируется).
            el.innerHTML = '<div class="party-log-head party-drag-handle" title="Перетащить панель">'
                + '<span>Журнал</span>'
                + '<button type="button" class="party-log-toggle" title="Свернуть журнал">▾</button>'
                + '</div>'
                + '<div class="party-log-body">'
                + '<div class="party-log-empty" style="color:#888;">Пока пусто</div>'
                + '</div>';
            hud.appendChild(el);

            el.querySelector('.party-log-toggle')?.addEventListener('click', () => {
                this._setLogOpen(!this._logOpen);
            });
            this._bindHudDrag(el.querySelector('.party-log-head'));

            this._logBodyEl = el.querySelector('.party-log-body');
            return el;
        },

        /**
         * Раньше ставил журнал вплотную под HP-панелью вручную (top из
         * getBoundingClientRect). С v11.6.0g-2 оба блока лежат в общем
         * контейнере .party-hud-container (flex-column, gap 8px), поэтому
         * раскладку считает CSS. Метод оставлен ради вызова из
         * _syncLogPanel(): здесь применяем сохранённую позицию всего HUD.
         */
        _positionLogPanel() {
            this._applyHudPosition();
        },

        /**
         * Показывает журнал вместе с HP-панелью и запускает догрузку.
         * Вызывается из _renderPanel() на каждом тике синхронизации.
         */
        _syncLogPanel() {
            if (!this._readState()) return;
            const el = this._ensureLogPanel();
            this._positionLogPanel();
            el.style.display = 'block';
            this._applyLogOpenState();

            // _pollLog() сам выберет режим: since=0 -> последние LOG_LIMIT,
            // since>0 -> только новые строки.
            if (this._logOpen) this._pollLog();
        },

        /** ▾/▸ и видимость тела журнала без полной перерисовки панели. */
        _applyLogOpenState() {
            const el = document.getElementById(this.LOG_PANEL_ID);
            if (!el) return;
            const body = el.querySelector('.party-log-body');
            const btn = el.querySelector('.party-log-toggle');
            if (body) body.style.display = this._logOpen ? 'block' : 'none';
            if (btn) {
                btn.textContent = this._logOpen ? '▾' : '▸';
                btn.title = this._logOpen ? 'Свернуть журнал' : 'Развернуть журнал';
            }
        },

        /**
         * Свернуть/развернуть журнал. Свёрнутый не опрашивает сервер
         * (экономия трафика), при разворачивании сразу догоняем пропущенное
         * через since=_logSince.
         */
        _setLogOpen(open) {
            this._logOpen = !!open;
            this._applyLogOpenState();
            if (this._logOpen) this._pollLog();
        },

        /**
         * GET /party/:id/log: since=_logSince > 0 — догрузка новых строк,
         * иначе первичная загрузка последних LOG_LIMIT (ТЗ 11.6.0c).
         */
        async _pollLog() {
            if (!this._logOpen || this._logBusy) return;
            const party = this._readState();
            if (!party) return;

            this._logBusy = true;
            try {
                const query = this._logSince > 0
                    ? `?since=${this._logSince}&limit=${this.LOG_LIMIT}`
                    : `?limit=${this.LOG_LIMIT}`;
                const res = await this._request(
                    'GET',
                    `/party/${encodeURIComponent(party.groupId)}/log${query}`
                );

                // Пока ждали ответ, могли выйти или перезайти в другую пати:
                // чужие события в очищенную панель не дописываем.
                const cur = this._readState();
                if (!cur || cur.groupId !== party.groupId) return;

                // Первая порция заменяет плейсхолдер, следующие — дописываются.
                if (!this._logReady) {
                    this._clearLog();
                    this._logReady = true;
                }

                const events = Array.isArray(res?.events) ? res.events : [];
                this._appendLogEvents(events);

                const next = Number(res?.nextSince);
                if (Number.isFinite(next) && next > this._logSince) this._logSince = next;
            } catch (e) {
                console.warn('[PARTY] журнал: GET не удался:', e?.message || e);
                // 401: _request() уже вызвал _resetLocalState() -> stopHpSync()
                // -> _hideLogPanel(); здесь только страховка.
                if (Number(e?.status) === 401) this._hideLogPanel();
            } finally {
                this._logBusy = false;
            }
        },

        /** Плейсхолдер «Пока пусто» и сброс скролла. */
        _clearLog() {
            const body = this._logBodyEl
                || document.getElementById(this.LOG_PANEL_ID)?.querySelector('.party-log-body');
            if (!body) return;
            body.innerHTML = '<div class="party-log-empty" style="color:#888;">Пока пусто</div>';
            body.scrollTop = 0;
        },

        /** Дописывает события в конец; при переполнении — автоскролл вниз. */
        _appendLogEvents(events) {
            if (!Array.isArray(events) || !events.length) return;
            const body = this._logBodyEl
                || document.getElementById(this.LOG_PANEL_ID)?.querySelector('.party-log-body');
            if (!body) return;

            body.querySelector('.party-log-empty')?.remove();
            for (const ev of events) body.appendChild(this._logRowEl(ev));

            // Сервер хранит 500 строк (trimLog) — столько же держим в DOM,
            // чтобы долгая сессия не раздувала страницу.
            while (body.childElementCount > this.LOG_DOM_MAX) {
                body.firstElementChild?.remove();
            }

            if (body.scrollHeight > body.clientHeight) body.scrollTop = body.scrollHeight;
        },

        /**
         * Строка журнала: [HH:MM] login: text.
         * textContent, а не innerHTML: текст приходит от других игроков.
         */
        _logRowEl(ev) {
            const row = document.createElement('div');
            row.className = 'party-log-row';
            const color = this.LOG_COLORS[ev?.type] || this.LOG_DEFAULT_COLOR;
            row.style.cssText = `font-size:11px; line-height:1.45; word-break:break-word; color:${color};`;
            row.textContent = `[${this._formatLogTime(ev?.createdAt)}] ${ev?.login || '?'}: ${ev?.text || ''}`;
            return row;
        },

        /** createdAt (ms) -> HH:MM в локальной зоне браузера. */
        _formatLogTime(ts) {
            const value = Number(ts);
            const d = new Date(Number.isFinite(value) ? value : Date.now());
            if (Number.isNaN(d.getTime())) return '--:--';
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        },

        /* ---------------------------------------------------------- */
        /* Чат пати в RAM (v11.7.0)                                    */
        /* ---------------------------------------------------------- */

        /**
         * Панель чата пати создаётся лениво внутри HUD-контейнера под журналом.
         */
        _ensureChatPanel() {
            const hud = this._ensureHud();
            let el = document.getElementById(this.CHAT_PANEL_ID);
            if (el && el.isConnected) {
                if (el.parentElement !== hud) hud.appendChild(el);
                this._chatBodyEl = el.querySelector('.party-chat-body');
                this._bindHudDrag(el.querySelector('.party-chat-head'));
                return el;
            }

            el = document.createElement('div');
            el.id = this.CHAT_PANEL_ID;
            el.className = 'party-chat-panel';

            el.innerHTML = `
                <div class="party-chat-head party-drag-handle" title="Перетащить панель">
                    <div class="party-chat-title">
                        <span>💬 ЧАТ ПАТИ</span>
                        <span class="party-chat-badge" style="display:none;"></span>
                    </div>
                    <button type="button" class="party-chat-toggle" title="Свернуть/развернуть чат">−</button>
                </div>
                <div class="party-chat-content">
                    <div class="party-chat-body">
                        <div class="party-chat-empty">Сообщений пока нет</div>
                    </div>
                    <form class="party-chat-form">
                        <input type="text" class="party-chat-input" placeholder="Сообщение..." maxlength="300" autocomplete="off" />
                        <button type="submit" class="party-chat-send" title="Отправить">➤</button>
                    </form>
                </div>
            `;
            hud.appendChild(el);

            const toggleBtn = el.querySelector('.party-chat-toggle');
            toggleBtn?.addEventListener('click', () => {
                this._setChatCollapsed(!this._chatCollapsed);
            });

            const form = el.querySelector('.party-chat-form');
            const input = el.querySelector('.party-chat-input');
            if (input) {
                // Предотвращение срабатывания горячих клавиш игры
                const stopEv = (e) => e.stopPropagation();
                input.addEventListener('keydown', stopEv);
                input.addEventListener('keyup', stopEv);
                input.addEventListener('keypress', stopEv);
            }
            if (form && input) {
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const text = input.value.trim();
                    if (!text) return;
                    input.value = '';
                    await this._sendChatMessage(text);
                });
            }

            this._bindHudDrag(el.querySelector('.party-chat-head'));
            this._chatBodyEl = el.querySelector('.party-chat-body');
            this._applyChatCollapsedState();
            return el;
        },

        _setChatCollapsed(collapsed) {
            this._chatCollapsed = !!collapsed;
            if (!this._chatCollapsed) {
                this._chatUnread = 0;
            }
            this._applyChatCollapsedState();
        },

        _applyChatCollapsedState() {
            const el = document.getElementById(this.CHAT_PANEL_ID);
            if (!el) return;
            const content = el.querySelector('.party-chat-content');
            const toggleBtn = el.querySelector('.party-chat-toggle');
            const badge = el.querySelector('.party-chat-badge');
            if (content) content.style.display = this._chatCollapsed ? 'none' : 'flex';
            if (toggleBtn) toggleBtn.textContent = this._chatCollapsed ? '+' : '−';
            if (badge) {
                if (this._chatCollapsed && this._chatUnread > 0) {
                    badge.textContent = `+${this._chatUnread}`;
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }
            if (!this._chatCollapsed) {
                this._scrollChatToBottom();
            }
        },

        async _sendChatMessage(text) {
            const party = this._readState();
            if (!party) return;
            try {
                const res = await this._request(
                    'POST',
                    `/party/${encodeURIComponent(party.groupId)}/chat`,
                    { body: { text } }
                );
                if (res && res.ok) {
                    this._pollChat();
                }
            } catch (err) {
                console.warn('[PARTY] чат: ошибка отправки', err);
                if (typeof UI !== 'undefined' && UI.showToast) {
                    UI.showToast(err?.message || 'Не удалось отправить сообщение', true);
                }
            }
        },

        async _pollChat() {
            if (this._chatBusy) return;
            const party = this._readState();
            if (!party) return;

            this._chatBusy = true;
            try {
                const query = this._chatSince > 0 ? `?since=${this._chatSince}` : '';
                const res = await this._request(
                    'GET',
                    `/party/${encodeURIComponent(party.groupId)}/chat${query}`
                );

                const cur = this._readState();
                if (!cur || cur.groupId !== party.groupId) return;

                const msgs = Array.isArray(res?.messages) ? res.messages : [];
                if (msgs.length > 0) {
                    const selfLogin = String(cur.login || '').toLowerCase();
                    let addedNew = false;
                    let newForeign = 0;

                    const existingIds = new Set(this._chatMessages.map((m) => m.id));
                    for (const m of msgs) {
                        if (!existingIds.has(m.id)) {
                            this._chatMessages.push(m);
                            existingIds.add(m.id);
                            addedNew = true;
                            if (String(m.login || '').toLowerCase() !== selfLogin) {
                                newForeign++;
                            }
                        }
                    }

                    if (this._chatMessages.length > 50) {
                        this._chatMessages = this._chatMessages.slice(-50);
                    }

                    if (this._chatCollapsed && newForeign > 0) {
                        this._chatUnread += newForeign;
                    }

                    const next = Number(res?.nextSince);
                    if (Number.isFinite(next) && next > this._chatSince) {
                        this._chatSince = next;
                    }

                    if (addedNew) {
                        this._renderChatMessages();
                    }
                    this._applyChatCollapsedState();
                }
            } catch (err) {
                console.warn('[PARTY] чат: GET не удался:', err?.message || err);
            } finally {
                this._chatBusy = false;
            }
        },

        _renderChatMessages() {
            const el = this._ensureChatPanel();
            const body = el.querySelector('.party-chat-body');
            if (!body) return;

            if (!this._chatMessages.length) {
                body.innerHTML = '<div class="party-chat-empty">Сообщений пока нет</div>';
                return;
            }

            const selfLogin = String(this._readState()?.login || '').toLowerCase();
            const esc = (s) => (typeof Utils !== 'undefined' && Utils.escapeHtml ? Utils.escapeHtml(s) : String(s || ''));

            body.innerHTML = this._chatMessages.map((m) => {
                const isSelf = String(m.login || '').toLowerCase() === selfLogin;
                const d = new Date(m.at || Date.now());
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                const timeStr = `${hh}:${mm}`;
                const loginCls = isSelf ? 'party-chat-nick party-chat-self' : 'party-chat-nick';
                return `
                    <div class="party-chat-msg ${isSelf ? 'is-self' : ''}">
                        <span class="party-chat-time">${timeStr}</span>
                        <span class="${loginCls}">${esc(m.login)}:</span>
                        <span class="party-chat-text">${m.text || ''}</span>
                    </div>
                `;
            }).join('');

            this._scrollChatToBottom();
        },

        _scrollChatToBottom() {
            const body = this._chatBodyEl || document.querySelector('.party-chat-body');
            if (body) {
                body.scrollTop = body.scrollHeight;
            }
        },

        _syncChatPanel() {
            if (!this._readState()) return;
            const el = this._ensureChatPanel();
            el.style.display = 'block';
            this._pollChat();
        },

        _hideChatPanel() {
            const el = document.getElementById(this.CHAT_PANEL_ID);
            if (el) el.style.display = 'none';
        },

        _resetChat() {
            this._chatMessages = [];
            this._chatSince = 0;
            this._chatUnread = 0;
            this._chatBusy = false;
            this._hideChatPanel();
        },

        /**
         * Запускает синхронизацию HP: отправляем свой hp/maxHp и перерисовываем
         * общую панель из GET /party/:id/state.
         *
         * v11.6.3c: тик запускается по событию (ответ игры на /api/me, /api/qact)
         * через PerformanceObserver; интервал HP_SYNC_MS (30 с) — только фолбэк.
         * v11.6.6: основной триггер — событие `me` из LGLiveLink (см.
         * _onHeroUpdate); observer поднимается только как резерв.
         * Повторный вызов безопасен: второй интервал и observer не создаются.
         * Вызывается из _writeState() (создали/вошли) и init() (перезагрузка).
         */
        startHpSync() {
            if (!this._readState()) {
                // Не в пати — панель не нужна.
                this.stopHpSync();
                return;
            }

            // v11.6.6: сначала вешаем хук на живой канал игры (он же снимает
            // флаг «мёртв» после возможного destroy старого инстанса), и
            // только потом решаем, нужен ли PerformanceObserver-фолбэк.
            this._hookLiveLink();

            if (this._hpTimer) return;

            this._ensurePanel();
            // v11.6.3c: сначала подписываемся на запросы игры, потом ставим
            // интервал-фолбэк — так первый ответ /api/me не будет пропущен.
            this._startHpObserver();
            this._hpTimer = setInterval(() => { this._hpTick(); }, this.HP_SYNC_MS);
            // Первый тик — сразу, иначе панель пустует до первого запроса игры.
            this._hpTick();
        },

        /**
         * v11.6.3c: штатный триггер HP-синхронизации.
         *
         * PerformanceObserver читает resource-записи страницы (включая уже
         * случившиеся — buffered) и дергает _hpTick() на запросы игры,
         * меняющие состояние героя:
         *   • /api/me   — снимок hp/maxHp/quest/ghost/role;
         *   • /api/qact — действия в походе (удар, шаг, каст хила).
         * Серии запросов при загрузке страницы гасит троттлинг в _hpTick().
         */
        _startHpObserver() {
            if (this._perfObserver) return; // уже слушаем
            // v11.6.6: канал игры подтверждён событием `me` — observer не нужен,
            // HP приходит по живому потоку без наших запросов к /api/me.
            if (this._liveLinkHooked && this._liveLinkSeen) {
                dbg('[PARTY] HP: источник — LGLiveLink, PerformanceObserver не запускаем');
                return;
            }
            if (typeof PerformanceObserver !== 'function') {
                console.warn('[LGU] PerformanceObserver не поддерживается — HP обновляется по таймеру');
                return;
            }

            this._perfObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    // includes, а не ===: name — полный URL вида
                    // https://legiongame.gg/c/<канал>/api/me?...
                    // Лишние совпадения (/api/members и т.п.) отсекает
                    // троттлинг: лишний тик не чаще раза в HP_TICK_MIN_MS.
                    if (entry.name.includes('/api/me') || entry.name.includes('/api/qact')) {
                        this._hpTick();
                        break; // одной пачки записей достаточно для одного тика
                    }
                }
            });

            try {
                // buffered: true — догоняем записи, случившиеся до observe()
                // (первый экран игры уже успел запросить /api/me).
                this._perfObserver.observe({ type: 'resource', buffered: true });
            } catch (e) {
                console.warn('[LGU] PerformanceObserver не поддерживается', e);
                // observe() не поднялся — остаёмся на интервале-фолбэке.
                this._perfObserver = null;
            }
        },

        /* ---------------------------------------------------------- */
        /* Живой канал игры (v11.6.6)                                  */
        /* ---------------------------------------------------------- */

        /**
         * v11.6.6: подписка на событие `me` живого канала игры.
         *
         * Раньше HP-панель обновлялась по PerformanceObserver: мы замечали
         * запрос игры к /api/me и делали СВОЙ /api/me, чтобы узнать hp.
         * Теперь игра сама присылает полный стейт героя (hero.hpNow /
         * hero.stats.hp) в SSE-событии `me` — второй запрос не нужен.
         *
         * LGLiveLink хранит свой инстанс в замыкании site-live.js, поэтому
         * единственная точка доступа — обёртка его `open()`: при каждом
         * (пере)открытии канала подписываемся на `me` у нового инстанса.
         *
         * Хук идемпотентен: повторные startHpSync()/init() второй обёртки
         * не создают. Если LGLiveLink нет (старая версия сайта) — возвращаем
         * false, и модуль остаётся на PerformanceObserver (см. _startHpObserver).
         *
         * @returns {boolean} хук стоит (или уже стоял) и события доступны
         */
        _hookLiveLink() {
            const link = G.LGLiveLink;
            if (!link || typeof link.open !== 'function') return false;
            if (this._liveLinkWrapper && link.open === this._liveLinkWrapper) {
                this._liveLinkHooked = true;
                this._liveLinkDead = false;
                return true;
            }

            const self = this;
            const origOpen = link.open;

            // Обёртка обязана быть обычной function: игру интересует только
            // возвращённый инстанс, но apply(this) сохраняет поведение, если
            // LGLiveLink позовут как метод.
            const wrapper = function (opts) {
                const instance = origOpen.apply(this, arguments);
                try {
                    if (instance && typeof instance.addEventListener === 'function') {
                        self._liveLinkInstance = instance;
                        instance.addEventListener('me', (e) => {
                            try {
                                const data = JSON.parse(e.data);
                                if (data && data.hero) self._onHeroUpdate(data.hero);
                            } catch (err) {
                                // Битую строку канала игнорируем: игра делает то же.
                            }
                        });
                    }
                } catch (err) {
                    console.warn('[PARTY] LGLiveLink: подписка на `me` не удалась:', err);
                }
                return instance;
            };

            this._liveLinkOrigOpen = origOpen;
            this._liveLinkWrapper = wrapper;
            this._liveLinkDead = false;
            this._liveLinkHooked = true;
            link.open = wrapper;
            dbg('[PARTY] HP: подписались на LGLiveLink `me`');
            return true;
        },

        /**
         * v11.6.6: снять обёртку (destroy при перезапуске скрипта).
         *
         * Проверяем, что в link.open всё ещё наша обёртка: если поверх уже
         * навернулся новый инстанс скрипта, чужой хук не трогаем — иначе
         * сломали бы ему поток. Свой инстанс при этом помечен мёртвым и
         * событий не обрабатывает.
         */
        _unhookLiveLink() {
            const link = G.LGLiveLink;
            if (link && this._liveLinkWrapper && link.open === this._liveLinkWrapper) {
                link.open = this._liveLinkOrigOpen;
            }
            this._liveLinkWrapper = null;
            this._liveLinkOrigOpen = null;
            this._liveLinkInstance = null;
            this._liveLinkHooked = false;
        },

        /**
         * v11.6.6: новое состояние героя из события `me` LGLiveLink.
         *
         * data героя — полный объект (как в GET /api/me): hpNow, stats.hp,
         * ghost, role. Состояния похода (ql) в `me` НЕТ — оно идёт отдельным
         * событием `q`, поэтому quest берём из прошлого снимка: иначе каждый
         * тик выглядел бы как «вышел из похода» (ложный quest_end).
         *
         * Снимок сразу становится _prevMe (до await'ов): параллельные
         * события не должны дважды отправлять одно и то же событие журнала.
         * @param {object} hero hero из JSON события `me`
         */
        async _onHeroUpdate(hero) {
            if (this._liveLinkDead) return;
            if (!hero || typeof hero !== 'object') return;
            if (!this._readState()) return;

            // Первое событие подтверждает, что канал живой: резервный
            // PerformanceObserver (если он успел подняться) больше не нужен.
            if (!this._liveLinkSeen) {
                this._liveLinkSeen = Date.now();
                this._stopHpObserver();
            }

            const prev = this._prevMe;
            const hpRaw = Number(hero.hpNow);
            // stats.hp — максимум (docs/API.md); hpMax — фолбэк для старых
            // ответов, где максимум лежит в hero.hpMax.
            const maxRaw = Number(hero.stats && hero.stats.hp !== undefined ? hero.stats.hp : hero.hpMax);
            const hp = Number.isFinite(hpRaw) ? hpRaw : (prev ? prev.hp : null);
            const maxHp = (Number.isFinite(maxRaw) && maxRaw > 0) ? maxRaw : (prev ? prev.maxHp ?? null : null);

            const next = {
                hp,
                maxHp,
                quest: prev ? prev.quest ?? null : null,
                ghost: hero.ghost === true,
                role: hero.role || (prev ? prev.role : 'unknown')
            };

            // Журнал боя: те же правила, что в _hpTick(). Снимок пришёл из
            // живого канала, поэтому death/heal/damage по нему валидны.
            const events = prev ? this._detectLogEvents(prev, next) : [];
            this._prevMe = next; // до await: защита от двойной отправки

            // 1. Панель — сразу, по кэшу состояний, без запросов.
            this._patchSelfHp(next.hp, next.maxHp);
            // 2. Стейт на наш сервер (POST + GET) — «как обычно», но с
            //    готовым снимком: /api/me не запрашиваем. Внутри _hpTick()
            //    живёт троттлинг HP_TICK_MIN_MS, поэтому серия `me`-событий
            //    боя не превратится в серию запросов.
            this._hpTick(next).catch((e) => {
                console.warn('[PARTY] синхронизация HP (live):', e?.message || e);
            });

            // 3. События журнала — последовательно: id в БД должны идти по порядку.
            for (const ev of events) {
                if (this._liveLinkDead) return;
                if (!(await this._postLogEvent(ev.type, ev.text))) break;
                if (!this._readState()) return;
            }
        },

        /**
         * v11.6.6: мгновенная перерисовка своей строки по кэшу состояний.
         *
         * GET /party/:id/state не нужен: берём последний ответ сервера
         * (_lastStates) и подменяем в нём свой hp/maxHp. Если кэша ещё нет
         * (первый тик не ответил), рисуем одну свою строку — панель не
         * должна пустовать до ответа нашего сервера.
         *
         * Одинаковые значения пропускаем: событие `me` приходит и на монеты
         * или очередь действий, герой при этом не меняется.
         * @param {number|null} hp
         * @param {number|null} maxHp
         */
        _patchSelfHp(hp, maxHp) {
            if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return;
            if (this._lastSelfHp && this._lastSelfHp.hp === hp && this._lastSelfHp.maxHp === maxHp) return;
            this._lastSelfHp = { hp, maxHp };

            const state = this._readState();
            if (!state) return;
            const selfLogin = String(state.login || this._cachedLogin || '').toLowerCase();
            if (!selfLogin) return;

            const list = Array.isArray(this._lastStates) ? this._lastStates.slice() : [];
            const idx = list.findIndex((s) => String(s?.login || '').toLowerCase() === selfLogin);
            if (idx >= 0) {
                list[idx] = { ...list[idx], login: list[idx].login || selfLogin, hp, maxHp };
            } else {
                list.push({ login: selfLogin, hp, maxHp });
            }
            this._lastStates = list;
            // skipLog: журнал опрашивает тик синхронизации; иначе каждое
            // событие `me` (а их в бою много) давало бы GET /party/:id/log.
            this._renderPanel(list, { skipLog: true });
        },

        /** v11.6.3c: отключить observer (выход, 401, перезапуск скрипта). */
        _stopHpObserver() {
            if (this._perfObserver) {
                try { this._perfObserver.disconnect(); } catch (e) {}
                this._perfObserver = null;
            }
        },

        /**
         * Остановить интервал, observer и скрыть панели (выход, 401, перезапуск).
         */
        stopHpSync() {
            if (this._hpTimer) {
                clearInterval(this._hpTimer);
                this._hpTimer = null;
            }
            this._stopHpObserver();
            // v11.6.6: кэш панели и признак живого канала сбрасываем — при
            // следующем входе в пати observer снова подстрахует до первого `me`.
            this._lastStates = null;
            this._lastSelfHp = null;
            this._liveLinkSeen = false;
            this._hidePanel();
            // leave/401: журнал прошлой пати очищается и прячется.
            this._hideLogPanel();
            // leave/401: чат прошлой пати очищается и прячется.
            this._resetChat();
        },

        /**
         * v11.6.3c: полное выключение модуля (shutdown() в main.js).
         *
         * Без этого после перезапуска скрипта старый инстанс продолжал бы
         * слушать resource-записи страницы и слать HP на сервер.
         * ТЗ 11.6.3c, п.2: observer освобождаем явно; stopHpSync() ниже —
         * страховка на случай, если observer уже отключён.
         */
        destroy() {
            // v11.6.6: старый инстанс не должен ни принимать `me` из
            // LGLiveLink, ни слать state на наш сервер после перезапуска.
            this._liveLinkDead = true;
            if (this._perfObserver) {
                this._perfObserver.disconnect();
                this._perfObserver = null;
            }
            this.stopHpSync();
            this._unhookLiveLink();
        },

        /**
         * Сравнивает два «живых» снимка /api/me и возвращает события журнала.
         *
         * Правила (ТЗ 11.6.0c):
         *   • quest null -> объект => quest_start;
         *   • quest объект -> null => quest_end;
         *   • ghost false -> true ИЛИ hp стал 0 => death (ровно одно событие);
         *   • hp вырос => heal с дельтой;
         *   • hp уменьшился => damage с дельтой (v11.6.0c.1).
         *
         * prev === null (первый тик после входа в пати) событий не даёт:
         * состояние «до» неизвестно, а quest_start на входе в пати был бы ложным.
         *
         * @param {{hp: number|null, quest: object|null, ghost: boolean, role: string}|null} prev
         * @param {{hp: number|null, quest: object|null, ghost: boolean, role: string}} cur
         * @returns {Array<{type: string, text: string}>}
         */
        _detectLogEvents(prev, cur) {
            const events = [];
            if (!prev || !cur) return events;

            const prevQuest = prev.quest || null;
            const curQuest = cur.quest || null;
            if (!prevQuest && curQuest) {
                events.push({ type: 'quest_start', text: 'Вошёл в поход' });
            } else if (prevQuest && !curQuest) {
                events.push({ type: 'quest_end', text: 'Вышел из похода' });
            }

            const prevHp = (typeof prev.hp === 'number' && Number.isFinite(prev.hp)) ? prev.hp : null;
            const hp = (typeof cur.hp === 'number' && Number.isFinite(cur.hp)) ? cur.hp : null;

            // Гибель: игра ставит ghost, но hp может прийти нулём раньше флага.
            // Оба признака в одном тике дают ОДНО событие, а не два.
            if ((!prev.ghost && cur.ghost) || (prevHp !== null && prevHp > 0 && hp === 0)) {
                events.push({ type: 'death', text: 'Погиб' });
            }

            if (prevHp !== null && hp !== null && hp > prevHp) {
                events.push({ type: 'heal', text: `HP +${hp - prevHp}` });
            }

            // Урон (ТЗ 11.6.0c.1). Игра пошаговая: урон — дискретное событие,
            // поэтому «HP -N» соответствует одному удару, спама быть не должно.
            // Не логируем:
            //   • prevHp === 0 — смерть/призрак уже описаны событием death;
            //   • prev.ghost — первый тик после воскрешения: игра сбрасывает hp
            //     с 0 на боевое значение, это не боевой урон.
            // Летальный удар (hp > 0 -> 0) даёт damage + death: так в журнале
            // видно и величину последнего удара, и сам факт гибели.
            if (!prev.ghost && prevHp !== null && hp !== null && prevHp > hp && prevHp > 0) {
                events.push({ type: 'damage', text: `HP -${prevHp - hp}` });
            }

            return events;
        },

        /**
         * POST /party/:id/log. Возвращает false, если сессия мертва (401):
         * дальше в этом тике отправлять события бессмысленно.
         */
        async _postLogEvent(type, text) {
            // 401 предыдущего события мог уже сбросить состояние пати.
            if (!this._readState()) return false;
            try {
                await this._request('POST', this._partyPath('log'), { body: { type, text } });
                return true;
            } catch (e) {
                console.warn('[PARTY] журнал: POST не удался:', e?.message || e);
                return Number(e?.status) !== 401;
            }
        },

        /**
         * Один такт синхронизации: /api/me -> POST state -> GET state -> рендер.
         *
         * Запускается событием `me` LGLiveLink (v11.6.6), событием
         * PerformanceObserver (ответ игры на /api/me или /api/qact) и
         * фолбэк-интервалом HP_SYNC_MS; не чаще HP_TICK_MIN_MS.
         *
         * v11.6.6: meOverride — готовый снимок героя из события `me`
         * (см. _onHeroUpdate). С ним шаг 1 (/api/me) пропускается, а шаг 1a
         * (детектор журнала) не нужен: снимок уже сравнён и записан в
         * _prevMe вызывающей стороной.
         *
         * Ошибки сети и валидации намеренно «тихие» (console.warn): панель
         * обновляется часто, тосты на каждую ошибку были бы невыносимы.
         * Исключение — 401: он означает кик/удалённую пати, здесь нужен и
         * тост, и полный локальный сброс (его делает _request()).
         */
        async _hpTick(meOverride = null) {
            // v11.6.3c: троттлинг. Observer срабатывает на каждый /api/me, а
            // игра при загрузке страницы может отдать несколько подряд —
            // без ограничения это серия POST state + GET state на наш сервер.
            const now = Date.now();
            if (this._lastHpTick && now - this._lastHpTick < this.HP_TICK_MIN_MS) return; // Не чаще раза в 3 секунды
            this._lastHpTick = now;

            // Предыдущий тик ещё ждёт сеть (медленный сервер) — второй не нужен.
            if (this._hpBusy) return;
            const party = this._readState();
            if (!party) {
                this.stopHpSync();
                return;
            }

            const path = `/party/${encodeURIComponent(party.groupId)}/state`;
            this._hpBusy = true;
            try {
                // 1. Свой HP из игры. v11.6.6: если снимок пришёл событием
                //    `me` LGLiveLink (_onHeroUpdate), /api/me не запрашиваем.
                //    Без снимка — обычный GET /api/me; если он недоступен,
                //    стейт не отправляем, панель строится по данным сервера.
                const me = meOverride || await this._fetchMe();

                // 1a. Детектор журнала — только по «живому» снимку /api/me.
                //     Фолбэк (live:false) не должен выглядеть как quest_end/death.
                //     v11.6.6: у снимка из LGLiveLink флага live нет — события
                //     уже разобраны в _onHeroUpdate, повторять их нельзя.
                if (me.live) {
                    const events = this._detectLogEvents(this._prevMe, me);
                    for (const ev of events) {
                        // Последовательно: id в БД должны идти в порядке событий.
                        if (!(await this._postLogEvent(ev.type, ev.text))) break;
                    }
                    // _prevMe обновляем даже при ошибке сети: иначе одно и то же
                    // событие отправлялось бы каждый тик.
                    this._prevMe = { hp: me.hp, maxHp: me.maxHp, quest: me.quest, ghost: me.ghost, role: me.role };
                    // 401 внутри POST уже сбросил локальное состояние.
                    if (!this._readState()) return;
                }

                if (me.hp !== null && me.maxHp !== null && me.maxHp > 0) {
                    try {
                        // 2. POST — тихо: ошибка не должна спамить пользователя.
                        await this._request('POST', path, {
                            body: { hp: me.hp, maxHp: me.maxHp }
                        });
                    } catch (e) {
                        console.warn('[PARTY] не удалось отправить HP:', e?.message || e);
                        // 401 уже обработан в _request(): стейт сброшен, панель
                        // скрыта, тост показан — дальше GET бессмыслен.
                        if (Number(e?.status) === 401) return;
                    }
                }

                // 3. GET всех стейтов -> перерисовка панели.
                const res = await this._request('GET', path);
                // Пока ждали ответ, могли выйти из пати — тогда рендер не нужен.
                if (!this._readState()) return;
                // v11.6.6: кэш состояний — по нему _patchSelfHp() мгновенно
                // перерисовывает свою строку на событиях `me`.
                this._lastStates = Array.isArray(res?.states) ? res.states : null;
                this._renderPanel(res?.states);
            } catch (e) {
                console.warn('[PARTY] синхронизация HP:', e?.message || e);
                // 401 = нас кикнули/пати удалена: _request() уже вызвал
                // _resetLocalState() (там stopHpSync + тост), дублируем страховкой.
                if (Number(e?.status) === 401) this.stopHpSync();
            } finally {
                this._hpBusy = false;
            }
        },

        /* ---------------------------------------------------------- */
        /* Взаимный хил (шаг 4, v11.6.0d)                              */
        /* ---------------------------------------------------------- */

        /**
         * «Лечение» союзника: копируем команду похода «лечить @ник» в буфер обмена.
         *
         * v11.7.0: заменено с автовставки на надёжное копирование в буфер (как в боевом ассистенте).
         *
         * @param {string} targetLogin ник цели из data-party-heal
         * @param {HTMLButtonElement|null} button кнопка (кратковременно меняется на «✓»)
         */
        _healMember(targetLogin, button) {
            const target = String(targetLogin || '').trim();
            if (!target) return;

            const healCommand = `лечить @${target}`;
            const ok = typeof Utils !== 'undefined' && typeof Utils.copyText === 'function'
                ? Utils.copyText(healCommand)
                : false;

            if (ok) {
                if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
                    UI.showToast(`Команда «${healCommand}» скопирована!`, false);
                }
                if (button && button.isConnected) {
                    button.classList.add('copied');
                    button.textContent = '✓';
                    setTimeout(() => {
                        if (button && button.isConnected) {
                            button.classList.remove('copied');
                            button.textContent = '❤';
                        }
                    }, 1200);
                }
            } else {
                if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
                    UI.showToast(`Не удалось скопировать: ${healCommand}`, true);
                }
            }
        },

        /* ---------------------------------------------------------- */
        /* UI                                                          */
        /* ---------------------------------------------------------- */

        /** Кнопка «Пати» в FAB-меню (modules/auction.js — тот же паттерн). */
        init() {
            // Перезапуск скрипта (single-instance guard в main.js) не убивает
            // таймеры старого инстанса: два интервала HP и два observer'а =
            // двойной POST state на наш сервер. v11.6.3c: destroy() гасит и
            // интервал, и PerformanceObserver; stopHpSync() — фолбэк для
            // инстанса, поднятого старой версией скрипта.
            const prev = G.__LEGION__?.Party;
            if (prev && prev !== this) {
                try {
                    if (typeof prev.destroy === 'function') prev.destroy();
                    else prev.stopHpSync?.();
                } catch (e) {}
            }

            // v11.6.6: пытаемся навеситься на живой канал игры как можно
            // раньше — до того, как LGLiveLink переоткроется (смена вкладки,
            // реконнект). Если он откроется после нашего boot, событие `me`
            // пойдёт уже в _onHeroUpdate без запросов к /api/me.
            this._hookLiveLink();

            const btn = document.getElementById(DOM_IDS.btnParty) || document.getElementById('btn-party');
            btn?.addEventListener('click', () => this.open());

            // Скрипт мог загрузиться при уже активной пати (перезагрузка
            // страницы, повторная инъекция): панель поднимаем сразу.
            if (this._readState()) this.startHpSync();
        },

        /**
         * Копирование кода приглашения. navigator.clipboard требует secure
         * context и разрешения — при отказе выделяем текст в поле, чтобы
         * пользователь скопировал его вручную (Ctrl+C).
         */
        async _copy(text, fallbackEl = null) {
            const value = String(text ?? '');
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(value);
                    return true;
                }
            } catch (e) {
                dbg('[PARTY] clipboard.writeText недоступен:', e);
            }

            if (fallbackEl) {
                try {
                    fallbackEl.focus();
                    fallbackEl.select();
                    if (typeof fallbackEl.setSelectionRange === 'function') {
                        fallbackEl.setSelectionRange(0, value.length);
                    }
                } catch (e) {
                    dbg('[PARTY] выделить текст не удалось:', e);
                }
                return false;
            }

            // Совсем старый браузер без Clipboard API: execCommand-фолбэк.
            try {
                const ta = document.createElement('textarea');
                ta.value = value;
                ta.style.cssText = 'position:fixed; top:-1000px; left:-1000px; opacity:0;';
                document.body.appendChild(ta);
                ta.select();
                const ok = document.execCommand('copy');
                ta.remove();
                return ok;
            } catch (e) {
                return false;
            }
        },

        async open() {
            const state = this.partyState();

            if (!state.party) {
                const modal = UI.showModal(this._modalHtmlEmpty(), { compact: true, customClass: 'party-modal' });
                if (!modal) return;
                this._bindEmpty(modal);
                // Ник отрисован синхронно (мог уйти в фолбэк LG_CH.login):
                // дозапрашиваем /api/me в фоне и правим только текстовый узел.
                this._refreshSelfNick(modal);
                return;
            }

            const modal = UI.showModal(this._modalHtmlParty(state.party, state.isOwner), { compact: true, customClass: 'party-modal' });
            if (!modal) return;
            this._bindParty(modal, state.party);
            // Список участников — отдельным запросом: модалка открывается
            // сразу, а members может ответить 401 (сессию убили) или упасть
            // по сети. Ошибка не должна ломать само окно.
            this._refreshMembers(modal).catch((e) => dbg('[PARTY] members:', e));
        },

        /**
         * Догоняющий запрос ника для пустого состояния (ТЗ 11.6.0a.3).
         *
         * _modalHtmlEmpty() рендерится синхронно, а _fetchMe() асинхронный:
         * при первом открытии _cachedLogin пуст, поэтому «Вы: …» показывал
         * _channelLogin() — логин Twitch-канала вместо игрового ника. Здесь
         * запускаем фоновый GET /api/me и, когда он ответит, меняем ТОЛЬКО
         * textContent узла .party-self-nick.
         *
         * Полная перерисовка модалки запрещена: пользователь может уже
         * печатать код приглашения, innerHTML-рендер собьёт фокус и каретку.
         *
         * Пока запрос в полёте, повторный open() его переиспользует
         * (_selfNickFetch), а если ник уже кэширован — сеть не трогаем.
         *
         * @param {HTMLElement|null} modal окно, отрисованное в open()
         */
        _refreshSelfNick(modal = null) {
            if (this._cachedLogin) return;     // ник уже известен — фетч не нужен
            if (this._selfNickFetch) return;   // запрос уже в полёте

            this._selfNickFetch = this._fetchMe()
                .then((me) => {
                    const nick = String(me?.login || '').trim();
                    // И /api/me, и LG_CH.login молчат: оставляем то, что
                    // отрисовано («—» или прежний фолбэк), не стираем ник.
                    if (!nick) return;

                    // Окно могли закрыть — тогда обновлять нечего (узла нет).
                    // Если его успели открыть заново, новый рендер тоже
                    // показал фолбэк, поэтому берём актуальный узел из DOM.
                    const el = (modal && modal.isConnected)
                        ? modal.querySelector('.party-self-nick')
                        : document.querySelector('.party-self-nick');
                    if (el) el.textContent = nick;
                })
                .catch((e) => {
                    // _fetchMe() ловит свои ошибки сам (фолбэк LG_CH.login);
                    // сюда попадаем только при неожиданном сбое внутри.
                    console.warn('[PARTY] фоновый /api/me не ответил:', e);
                })
                .finally(() => {
                    this._selfNickFetch = null;
                });
        },

        /** Обрезка groupId для заголовка: первые 8 символов + «…». */
        _shortId(groupId) {
            const id = String(groupId || '');
            return id.length > 8 ? `${id.slice(0, 8)}…` : (id || '—');
        },

        /** Компактный крестик: правый верхний угол заголовка (h2 = flex). */
        _closeBtn() {
            return `<button class="custom-close party-close" id="custom-close-btn"
                style="font-size:16px; padding:4px 8px; line-height:1; margin-left:auto;"
                title="Закрыть">×</button>`;
        },

        /** Секция «УЧАСТНИКИ»: список заполняет _refreshMembers(). */
        _membersSection() {
            return `<div>
                <div class="${this.MUTED_CLASS}">Участники</div>
                <div id="party-members" style="display:flex; flex-direction:column; max-height:180px; overflow-y:auto;">
                    <div style="font-size:12px; color:#888;">Загрузка…</div>
                </div>
            </div>`;
        },

        /** Строка участника: «• <login> (вы|owner|member)» + «Кикнуть». */
        _memberRow(member, canKick) {
            const login = Utils.escapeHtml(member.login || '?');
            const labels = [];
            if (member.self) labels.push('вы');
            labels.push(member.role === 'owner' ? 'owner' : 'member');

            // Кик — только у владельца и только для чужих строк. memberId
            // храним в data-атрибуте: sessionId клиенту больше не приходит.
            const kick = (canKick && !member.self && member.memberId)
                ? `<button data-party-kick="${Utils.escapeHtml(member.memberId)}" class="${this.DANGER_BTN_CLASS} party-btn-sm">Кикнуть</button>`
                : '';

            return `<div style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:13px;">
                        <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">• ${login} <span style="color:#888;">(${labels.join(', ')})</span></span>
                        ${kick}
                    </div>`;
        },

        /** Состояние «нет пати»: создать либо присоединиться по коду приглашения. */
        _modalHtmlEmpty() {
            const nick = this._defaultNick();
            const safeNick = Utils.escapeHtml(nick || '—');

            return `
                <h2>👥 Пати ${this._closeBtn()}</h2>
                <div style="display:flex; flex-direction:column; gap:14px; padding:6px 2px;">
                    <div>
                        <div class="${this.MUTED_CLASS}">Создать пати</div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="flex:1; min-width:0; font-size:13px; color:#ccc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                Вы: <b class="party-self-nick">${safeNick}</b>
                            </div>
                            <button id="party-create-btn" class="${this.BTN_CLASS}">Создать</button>
                        </div>
                    </div>
                    <div class="party-sep">
                        <div class="${this.MUTED_CLASS}">Код приглашения</div>
                        <div class="party-field">
                            <input id="party-join-token" type="text" autocomplete="off" spellcheck="false"
                                placeholder="Вставьте код приглашения" class="${this.INPUT_CLASS}">
                            <button id="party-join-btn" class="${this.BTN_CLASS}">Присоединиться</button>
                        </div>
                    </div>
                    <div id="party-error" class="party-error"></div>
                </div>
            `;
        },

        /**
         * Состояние «в пати». owner видит полный код приглашения, ротацию и
         * кик; member — только состав и выход.
         */
        _modalHtmlParty(party, isOwner) {
            const safeLogin = Utils.escapeHtml(party.login || '—');
            const shortId = Utils.escapeHtml(this._shortId(party.groupId));

            const tokenBlock = isOwner ? `
                    <div>
                        <div class="${this.MUTED_CLASS}">Код приглашения</div>
                        <div class="party-field">
                            <input id="party-token-input" type="text" readonly value="${Utils.escapeHtml(party.inviteToken || '')}"
                                class="${this.TOKEN_INPUT_CLASS}">
                            <button id="party-copy-token" class="${this.BTN_CLASS}">Копировать</button>
                        </div>
                    </div>` : '';

            const rotateBtn = isOwner
                ? `<button id="party-rotate-btn" class="${this.BTN_CLASS}">Перевыпустить код</button>`
                : '';

            return `
                <h2>👥 Пати ${this._closeBtn()}</h2>
                <div style="display:flex; flex-direction:column; gap:12px; padding:6px 2px; overflow-y:auto;">
                    <div style="font-size:12px; color:#ccc; line-height:1.5;">
                        <div>Группа: <b style="color:#ffcf6a;">${shortId}</b></div>
                        <div>Вы: <b style="color:#ffcf6a;">${safeLogin}</b>${isOwner ? ' (owner)' : ''}</div>
                    </div>
                    ${tokenBlock}
                    ${this._membersSection()}
                    <div class="party-sep" style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button id="party-refresh-btn" class="${this.BTN_CLASS}">Обновить</button>
                        ${rotateBtn}
                        <button id="party-leave-btn" class="${this.DANGER_BTN_CLASS} party-btn-lg">Покинуть пати</button>
                    </div>
                    <div id="party-error" class="party-error"></div>
                </div>
            `;
        },

        /** Перезагружает список участников в уже открытую модалку. */
        async _refreshMembers(modal) {
            const box = modal?.querySelector('#party-members');
            if (!box) return;

            try {
                const members = await this.partyMembers();
                if (!box.isConnected) return;
                const isOwner = this.partyState().isOwner;
                box.innerHTML = members.length
                    ? members.map((m) => this._memberRow(m, isOwner)).join('')
                    : '<div style="color:#888; font-size:12px; padding:6px;">В пати пока никого нет</div>';
            } catch (e) {
                // 401 = сессию убили (кик/выход владельца): показываем текст
                // прямо в списке, иначе он навсегда останется «Загрузка…».
                if (box.isConnected) {
                    box.innerHTML = `<div style="color:#ff8fa3; font-size:12px; padding:6px;">${Utils.escapeHtml(e?.message || 'Не удалось загрузить участников')}</div>`;
                }
                dbg('[PARTY] members:', e);
            }
        },

        /**
         * Обёртка для кнопок: блокирует её на время запроса и показывает
         * ошибку в блоке #party-error (он живёт до перерисовки модалки).
         *
         * @param {HTMLButtonElement|null} btn
         * @param {HTMLElement|null} errorBox
         * @param {() => Promise<void>} fn
         * @param {string} [busyText] текст на время запроса (защита от двойного
         *   клика: «Создать»/«Присоединиться» ждут /api/me, это до секунды)
         */
        async _runAction(btn, errorBox, fn, busyText = '') {
            const prevText = btn ? btn.textContent : '';
            if (btn) {
                btn.disabled = true;
                if (busyText) btn.textContent = busyText;
            }
            if (errorBox) errorBox.textContent = '';
            try {
                await fn();
            } catch (e) {
                dbg('[PARTY] Ошибка действия:', e);
                const msg = e.message || 'Неизвестная ошибка';
                if (errorBox) errorBox.textContent = msg;
                else UI.showToast(msg, true);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    if (busyText) btn.textContent = prevText;
                }
            }
        },

        /** Обработчики состояния «нет пати». */
        _bindEmpty(modal) {
            const errorBox = modal.querySelector('#party-error');
            const createBtn = modal.querySelector('#party-create-btn');
            const joinBtn = modal.querySelector('#party-join-btn');

            // Ник НЕ читается здесь: partyCreate()/partyJoin() сами берут его
            // из /api/me в момент клика (модалка может висеть часами), а до
            // ответа кнопка заблокирована и показывает «...».
            createBtn?.addEventListener('click', () => this._runAction(createBtn, errorBox, async () => {
                const party = await this.partyCreate();
                UI.showToast(`Пати создана: ${this._shortId(party.groupId)}`);
                await this.open();
            }, '...'));

            joinBtn?.addEventListener('click', () => {
                const token = (modal.querySelector('#party-join-token')?.value || '').trim();
                return this._runAction(joinBtn, errorBox, async () => {
                    const party = await this.partyJoin(token);
                    UI.showToast(`Вы вошли в пати как ${party.login}`);
                    await this.open();
                }, '...');
            });
        },

        /** Обработчики состояния «в пати». */
        _bindParty(modal, party) {
            const errorBox = modal.querySelector('#party-error');

            modal.querySelector('#party-copy-token')?.addEventListener('click', async () => {
                const input = modal.querySelector('#party-token-input');
                const ok = await this._copy(party.inviteToken || '', input);
                UI.showToast(
                    ok ? 'Код приглашения скопирован' : 'Скопируйте код вручную (Ctrl+C)',
                    !ok
                );
            });

            const refreshBtn = modal.querySelector('#party-refresh-btn');
            refreshBtn?.addEventListener('click', () => this._runAction(refreshBtn, errorBox, async () => {
                await this._refreshMembers(modal);
            }));

            const rotateBtn = modal.querySelector('#party-rotate-btn');
            rotateBtn?.addEventListener('click', () => this._runAction(rotateBtn, errorBox, async () => {
                await this.partyRotateToken();
                UI.showToast('Код приглашения перевыпущен');
                // В модалке показан сам код — перерисовываем её целиком.
                await this.open();
            }));

            // Кик — делегирование: строки участников перерисовываются
            // после каждого обновления списка, отдельные слушатели текли бы.
            modal.querySelector('#party-members')?.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-party-kick]');
                if (!btn) return;
                const memberId = btn.getAttribute('data-party-kick');
                return this._runAction(btn, errorBox, async () => {
                    await this.partyKick(memberId);
                    UI.showToast('Участник исключён');
                    await this._refreshMembers(modal);
                });
            });

            const leaveBtn = modal.querySelector('#party-leave-btn');
            leaveBtn?.addEventListener('click', () => this._runAction(leaveBtn, errorBox, async () => {
                const serverOk = await this.partyLeave();
                // Модалку в «нет пати» уже перерисовал _resetLocalState().
                // При недоступном сервере partyLeave показал предупреждение.
                if (serverOk) UI.showToast('Вы вышли из пати');
            }));
        }
    };

    // ===== src/modules/arena.js =====
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
    //      (.av-itabs / .av-ibody) с приглашением в один клик;
    //   4) v11.7 — инспектор снаряжения: наведение (250 мс) или клик на
    //      фигурку бойца на мини-сцене карточки (.av-scene .av-mh) или в окне
    //      боя (.av-fwin .av-hero) показывает тултип с вещами (+en), их
    //      редкостью и способностями Арены (ab / ult). Данные —
    //      GET /api/arena/hero?login=… (кэш 60 с, пауза на 429/rate_limited).
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
        // v11.7: карточка героя (/api/arena/hero) живёт 60 с — так требует ТЗ
        // на инспектор снаряжения (тултип по наведению/клику на бойца).
        const HERO_TTL = 60000;
        // Пауза после неудачного/ограниченного запроса карточки героя: при
        // HTTP 429 или { error: 'rate_limited' } сервер просит не долбить API,
        // поэтому выдерживаем 15–30 с (см. heroBackoff()).
        const HERO_FAIL_TTL = 15000;
        const HERO_PAUSE_MIN = 15000;
        const HERO_PAUSE_MAX = 30000;
        // Лимит кэша героев: длинная сессия на арене не должна растить Map.
        const HERO_CACHE_MAX = 80;
        // Задержка показа тултипа при наведении (ТЗ: 250 мс).
        const HERO_TIP_DELAY = 250;

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

        // Кэш карточек героев (/api/arena/hero) объявлен ниже, в блоке
        // «Кэш героев» — там же TTL, лимит размера и пауза на 429.

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
        //
        // Наполняется двумя путями:
        //   1) из ответов самой игры (хук LGArena.open -> onApiResponse),
        //      когда игрок открывает карточку бойца в нативном окне;
        //   2) нашим ленивым запросом для тултипа снаряжения (requestHero).
        // Своих запросов на КАЖДОГО бойца список не делает — только по
        // наведению/клику на конкретную фигурку, с кэшем 60 с и паузой на
        // 429/rate_limited (server-side защита от спама).
        // ------------------------------------------------------------
        const heroCache = new Map();
        // Провалы по логину: не повторяем запрос раньше HERO_FAIL_TTL.
        const heroFail = new Map();
        // Дедупликация одновременных запросов: login -> Promise<hero|null>.
        const heroBusy = new Map();
        // Глобальная пауза после 429/rate_limited (общая на весь модуль).
        let heroPauseUntil = 0;
        let heroPauseWarned = false;

        // Обрезка кэша: Map хранит порядок вставки, поэтому удаляем самый
        // старый ключ. На каждого героя пишутся два ключа (login и имя),
        // лишние записи не критичны — они указывают на тот же объект.
        const trimHeroCache = () => {
            while (heroCache.size > HERO_CACHE_MAX) {
                const first = heroCache.keys().next();
                if (first.done) break;
                heroCache.delete(first.value);
            }
        };

        const cacheHero = (login, hero) => {
            if (!hero || typeof hero !== 'object') return;
            const at = Date.now();
            const record = { hero, at };
            const keys = [low(login), low(hero.name)].filter(Boolean);
            for (const key of keys) heroCache.set(key, record);
            trimHeroCache();
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

        // Пауза после ответа «слишком часто»: 15–30 с (ТЗ, антиспам).
        // Случайный разброс не даёт всем вкладкам/клиентам бить синхронно.
        const heroBackoff = () => {
            const ms = HERO_PAUSE_MIN + Math.round(Math.random() * (HERO_PAUSE_MAX - HERO_PAUSE_MIN));
            heroPauseUntil = Date.now() + ms;
            if (!heroPauseWarned) {
                heroPauseWarned = true;
                try {
                    if (typeof UI !== 'undefined' && UI.showToast) {
                        UI.showToast('Арена: сервер просит не частить с запросами — подождите немного', true);
                    }
                } catch (e) {}
            }
        };

        /**
         * v11.7: ленивая карточка героя для тултипа снаряжения.
         *
         * GET /api/arena/hero?login=<login> (docs/API.md, arena2.js:card) —
         * тот же эндпоинт, что использует нативная арена. Запрос уходит только
         * при наведении/клике на конкретного бойца (или если карточка уже
         * есть в кэше от самой игры).
         *
         * Защита от спама:
         *   - кэш в памяти (Map, TTL 60 c, лимит HERO_CACHE_MAX);
         *   - провал по логину блокирует повтор на HERO_FAIL_TTL;
         *   - HTTP 429 / { error: 'rate_limited' } -> общая пауза 15–30 с;
         *   - одновременные запросы одного логина склеиваются (heroBusy).
         *
         * @param {string} login логин бойца
         * @returns {Promise<object|null>} hero либо null (нет данных/пауза)
         */
        const requestHero = (login) => {
            const key = low(login);
            if (!key) return Promise.resolve(null);

            const cached = getHero({ login: key });
            if (cached) return Promise.resolve(cached);

            const now = Date.now();
            if (heroPauseUntil && now < heroPauseUntil) return Promise.resolve(null);
            const failed = heroFail.get(key) || 0;
            if (failed && (now - failed) < HERO_FAIL_TTL) return Promise.resolve(null);

            const busy = heroBusy.get(key);
            if (busy) return busy;

            const p = (async () => {
                let res = null;
                try {
                    // Utils.fetchApi сам выберет G.X.api (контекст арены) или
                    // обычный fetch с префиксом /c/<канал>/ — window.fetch не
                    // патчится.
                    res = await Utils.fetchApi('/api/arena/hero?login=' + encodeURIComponent(key));
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
                cacheHero(key, hero);
                return hero;
            })().finally(() => {
                heroBusy.delete(key);
            });

            heroBusy.set(key, p);
            return p;
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
                // v11.7: оффхенд-оружие (shield + role) — штраф только чужому
                // классу; сам слот 'shield' здесь не играет роли.
                if (isOffhandItem(it)) {
                    if (role && String(it.role).toLowerCase() !== role) pen += num(penTable[slot]);
                    continue;
                }
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
        // v11.7: инспектор снаряжения на Арене (тултип)
        //
        // Наведение (250 мс) или клик на фигурку бойца в карточке соперника
        // (.av-panel.av-off .av-scene .av-mh) или в окне боя (.av-fwin
        // .av-hero) показывает компактную карточку: ник, класс/уровень,
        // вещи с «+en» и редкостью, способности Арены (ab/ult).
        //
        // Данные — GET /api/arena/hero?login=… через requestHero(): кэш 60 с,
        // пауза на 429/rate_limited. Своих запросов «на всех» не делаем.
        // ------------------------------------------------------------
        const TIP_CLS = 'lgu-arena-gear-tip';
        const TIP_SLOTS = [
            ['helmet', 'Шлем'],
            ['weapon', 'Оружие'],
            ['armor', 'Доспех'],
            ['shield', 'Вторая рука'],
            ['trinket', 'Амулет']
        ];
        // Расшифровка статов предмета (arena2.js: STN).
        const TIP_STATS = {
            hp: 'здоровье', atk: 'атака', mag: 'магия', def: 'броня',
            crit: 'крит', critDmg: 'сила крита', dodge: 'уклонение',
            pierce: 'пробивание', healPow: 'лечение', luck: 'удача',
            resist: 'сопротивление'
        };
        const TIP_RARITY = {
            common: 'обычное', uncommon: 'необычное', rare: 'редкое',
            epic: 'эпическое', legendary: 'легендарное'
        };

        let tipEl = null;
        let tipTimer = 0;
        let tipForEl = null;
        let tipTarget = null;
        let onDocHover = null;
        // Слушатель scroll/resize: позиция тултипа считается один раз, поэтому
        // при прокрутке/изменении окна подсказку проще спрятать.
        let onTipViewport = null;
        const onTipViewportChange = () => {
            if (tipTimer) { clearTimeout(tipTimer); tipTimer = 0; }
            tipTarget = null;
            hideGearTip();
        };

        const tipClassRu = (role) => {
            const key = low(role);
            return (GAME_DATA.CLASS_NAMES && GAME_DATA.CLASS_NAMES[key]) || role || '';
        };

        // Ник фигурки: arena2.js кладёт полное имя в title у span внутри .av-nm.
        const nickOf = (el) => {
            const span = el && el.querySelector ? el.querySelector('.av-nm span') : null;
            return String((span && (span.getAttribute('title') || span.textContent)) || '').trim();
        };

        // Логин бойца из фигурки на мини-сцене карточки.
        //   - своя сцена (.av-mineScene) — готовый data-mk;
        //   - карточка соперника — логин лидера в .av-scene[data-sq] + индекс
        //     бойца из класса .av-pN (MW в arena2.js задаёт только порядок
        //     вывода, поэтому берём def[i], а не позицию в DOM).
        const sceneFighterLogin = (mh) => {
            const own = (mh.dataset && mh.dataset.mk) || '';
            if (own) return String(own);

            const scene = mh.closest ? mh.closest('.av-scene') : null;
            const leader = (scene && scene.dataset && scene.dataset.sq) || '';
            const offer = leader ? offerByLogin(leader) : null;
            if (!offer) return '';

            let idx = -1;
            for (const cls of Array.from(mh.classList || [])) {
                const m = /^av-p(\d)$/.exec(cls);
                if (m) { idx = +m[1]; break; }
            }
            const squad = foeSquad(offer);
            const fighter = idx >= 0 ? squad[idx] : null;
            if (fighter) return String(fighter.login || fighter.name || '');
            return nickOf(mh);
        };

        // Логин бойца из фигурки в окне боя: у врагов data-b="eN" (индекс в
        // foeT/клине обороны), у своих — data-k с логином.
        const fighterLogin = (el) => {
            if (!el || !el.closest) return '';
            const mh = el.closest('.av-mh');
            if (mh) return sceneFighterLogin(mh);

            const heroBtn = el.closest('.av-hero');
            if (!heroBtn) return '';

            const own = (heroBtn.dataset && heroBtn.dataset.k) || '';
            if (own) return String(own);

            const win = heroBtn.closest('.av-fwin') || heroBtn.closest('.av-bf') || fightWindow();
            const nickNames = win
                ? Array.from(win.querySelectorAll('.av-hero.av-foe .av-nm span'))
                    .map((x) => String(x.getAttribute('title') || x.textContent || '').trim())
                    .filter(Boolean)
                : [];
            const offer = pickFightOffer(nickNames);
            const idx = +(String((heroBtn.dataset && heroBtn.dataset.b) || '').replace(/^e/, ''));
            const squad = offer ? foeSquad(offer) : [];
            if (Number.isFinite(idx) && squad[idx]) {
                return String(squad[idx].login || squad[idx].name || '');
            }
            return nickOf(heroBtn);
        };

        // Только фигурки на сцене карточки и в окне боя (свои и вражеские).
        const hoverTarget = (node) => {
            if (!node || !node.closest) return null;
            const el = node.closest('.av-mh, .av-hero');
            if (!el) return null;
            if (el.classList.contains('av-mh')) {
                if (el.classList.contains('av-mhe')) return null; // пустой слот
                return el.closest('.av-scene') ? el : null;
            }
            return (el.closest('.av-fwin') || el.closest('.av-bf')) ? el : null;
        };

        const tipStatsText = (it) => {
            const stats = (it && it.stats) || {};
            const out = [];
            for (const [k, v] of Object.entries(stats)) {
                if (!num(v)) continue;
                out.push('+' + fmt(v) + ' ' + (TIP_STATS[k] || k));
                if (out.length >= 3) break;
            }
            return out.join(' · ');
        };

        const tipAbility = (cap, a) => {
            if (!a) return `<span><i>${cap}</i> нет</span>`;
            // lock — уровень героя, с которого способность открывается:
            // показываем и имя (как в нативном окне), и условие открытия.
            const lock = num(a.lock);
            const name = a.name || '—';
            const note = lock ? ` <em>(с ${lock} ур.)</em>` : '';
            return `<span${lock ? ' class="off"' : ''}><i>${Utils.escapeHtml(a.icon || '✦')}</i>${Utils.escapeHtml(cap)}: <b>${Utils.escapeHtml(name)}</b>${note}</span>`;
        };

        const tipHtml = (hero, nick) => {
            const by = {};
            for (const it of (Array.isArray(hero && hero.items) ? hero.items : [])) {
                if (it && !by[it.slot]) by[it.slot] = it;
            }

            const role = low((hero && (hero.role || hero.class)) || '');
            const meta = [tipClassRu(role), (num(hero && hero.level) ? fmt(hero.level) + ' ур.' : '')]
                .filter(Boolean).join(' · ');

            const items = TIP_SLOTS.map(([slot, ru]) => {
                const it = by[slot];
                if (!it) return `<li class="empty"><span class="lgu-agit-slot">${ru}</span><small>пусто</small></li>`;
                const en = num(it.en);
                const rar = TIP_RARITY[it.rarity] || '';
                const stats = tipStatsText(it);
                return `<li data-r="${Utils.escapeHtml(it.rarity || 'common')}">`
                    + `<span class="lgu-agit-slot">${ru}</span>`
                    + `<span class="lgu-agit-name">${Utils.escapeHtml(it.name || '—')}${en > 0 ? ` <b>+${en}</b>` : ''}</span>`
                    + `<small>${Utils.escapeHtml(rar)}${stats ? ' · ' + Utils.escapeHtml(stats) : ''}</small></li>`;
            }).join('');

            const ab = (hero && hero.ab) || {};
            return `<div class="lgu-agit-head"><b>${Utils.escapeHtml(nick || (hero && hero.name) || '')}</b>`
                + `<span>${Utils.escapeHtml(meta)}</span></div>`
                + `<ul class="lgu-agit-items">${items}</ul>`
                + `<div class="lgu-agit-abs">${tipAbility('способность', ab.ab)}${tipAbility('ульта', ab.ult)}</div>`;
        };

        const hideGearTip = () => {
            tipForEl = null;
            if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
            tipEl = null;
        };

        const placeGearTip = (el) => {
            if (!tipEl || !el || !el.isConnected) return;
            const r = el.getBoundingClientRect();
            const tr = tipEl.getBoundingClientRect();
            const gap = 10;
            let x = r.left + r.width / 2 - tr.width / 2;
            x = Math.max(8, Math.min((window.innerWidth || 0) - tr.width - 8, x));
            let y = r.top - tr.height - gap;
            if (y < 8) y = Math.min((window.innerHeight || 0) - tr.height - 8, r.bottom + gap);
            tipEl.style.left = Math.round(x) + 'px';
            tipEl.style.top = Math.round(Math.max(8, y)) + 'px';
        };

        const showGearTip = (el, hero, nick, loading) => {
            if (destroyed || !el || !el.isConnected) return;
            if (!tipEl) {
                tipEl = document.createElement('div');
                tipEl.className = TIP_CLS;
                tipEl.setAttribute('role', 'tooltip');
                document.body.appendChild(tipEl);
            }
            tipEl.innerHTML = loading
                ? `<div class="lgu-agit-head"><b>${Utils.escapeHtml(nick || 'Боец')}</b><span>Загружаем снаряжение…</span></div>`
                : tipHtml(hero, nick);
            tipForEl = el;
            placeGearTip(el);
        };

        const openGearTip = async (el) => {
            if (destroyed || !el || !el.isConnected) return;
            const login = fighterLogin(el);
            if (!login) return;
            const nick = nickOf(el) || login;

            let hero = getHero({ login });
            if (!hero) {
                showGearTip(el, null, nick, true);
                hero = await requestHero(login);
                // Пока ходили на сервер, курсор мог уйти — показываем только
                // если фигурка всё ещё в DOM, а тултип всё ещё её.
                if (destroyed || !el.isConnected || tipForEl !== el) return;
                if (!hero) { hideGearTip(); return; }
            }
            showGearTip(el, hero, nick, false);
        };

        // Делегированные pointerover/pointerout/click: рисуем подсказку с
        // задержкой 250 мс, прячем сразу при уходе курсора.
        const onArenaHover = (e) => {
            if (destroyed) return;

            if (e.type === 'pointerout') {
                const from = hoverTarget(e.target);
                if (!from) return;
                const to = hoverTarget(e.relatedTarget);
                if (to === from) return;
                if (tipTimer) { clearTimeout(tipTimer); tipTimer = 0; }
                tipTarget = null;
                hideGearTip();
                return;
            }

            // На тач-устройствах «наведения» нет — работает клик.
            if (e.type === 'pointerover' && e.pointerType === 'touch') return;

            const el = hoverTarget(e.target);
            if (!el) return;

            if (e.type === 'click') {
                if (tipTimer) { clearTimeout(tipTimer); tipTimer = 0; }
                tipTarget = null;
                openGearTip(el).catch(() => {});
                return;
            }

            if (tipForEl === el || tipTarget === el) return;
            if (tipTimer) clearTimeout(tipTimer);
            tipTarget = el;
            tipTimer = setTimeout(() => {
                tipTimer = 0;
                tipTarget = null;
                openGearTip(el).catch(() => {});
            }, HERO_TIP_DELAY);
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
            // Тултип снаряжения привязан к конкретной фигурке: игра
            // перерисовывает модалку целиком — если узел умер, подсказку
            // убираем, иначе она останется висеть с устаревшими данными.
            if (tipForEl && !tipForEl.isConnected) hideGearTip();
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

            // v11.7: тултип снаряжения — наведение (250 мс) и клик по фигурке
            // бойца на мини-сцене карточки и в окне боя. Слушаем в capture-фазе:
            // игра перерисовывает модалки целиком, делегирование по document
            // переживает любые innerHTML.
            if (!onDocHover) {
                onDocHover = onArenaHover;
                document.addEventListener('pointerover', onDocHover, true);
                document.addEventListener('pointerout', onDocHover, true);
                document.addEventListener('click', onDocHover, true);
                onTipViewport = onTipViewportChange;
                window.addEventListener('scroll', onTipViewport, true);
                window.addEventListener('resize', onTipViewport, true);
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
            if (onDocHover) {
                try {
                    document.removeEventListener('pointerover', onDocHover, true);
                    document.removeEventListener('pointerout', onDocHover, true);
                    document.removeEventListener('click', onDocHover, true);
                } catch (e) {}
                onDocHover = null;
            }
            if (onTipViewport) {
                try {
                    window.removeEventListener('scroll', onTipViewport, true);
                    window.removeEventListener('resize', onTipViewport, true);
                } catch (e) {}
                onTipViewport = null;
            }
            if (tipTimer) {
                clearTimeout(tipTimer);
                tipTimer = 0;
            }
            tipTarget = null;
            hideGearTip();
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
            heroFail.clear();
            heroBusy.clear();
            heroPauseUntil = 0;
            heroPauseWarned = false;
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

    // ===== src/modules/guild-summary.js =====
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

    // ===== src/main.js =====
    // ============================================================
    // ТОЧКА ВХОДА (src/main.js)
    //
    // Все зависимости лежат в общем IIFE-скоупе сборки, импортов нет
    // (build.js просто конкатенирует файлы в описанном ниже порядке):
    //   core/constants.js    -> G, DEBUG, dbg, RAND_ID, DOM_IDS, API_BASE, Utils={}, randomDelay
    //   core/utils-format.js -> Utils.calculateMedian / formatMoney / parseCoinsText / formatCoinsHtml / formatTimeLeft
    //   core/utils-api.js    -> Utils.apiPath / fetchApi
    //   core/utils-art.js    -> Utils.getItemArtSvg / getItemArtHtml / getItemName / getItemIcon + декор UI
    //   core/utils.js        -> Utils.copyText / insertToQuestChat / updateOnlinePlayers
    //   core/styles.js -> STYLES
    //   core/hooks.js  -> перехватчики LGCity / LGAuction / LGQuest
    //                     (LGMine снят в 11.6.4b — античит шахты)
    //   core/ui-templates.js -> UITemplates (HTML: FAB-меню, модалки, HUD)
    //   core/ui.js     -> UI
    //   modules/*      -> BuildSim, HeroPlanner, Auction, Players,
    //                     PocketCity, CombatAssistant, Party, Arena,
    //                     Miner (заглушка)
    // 11.7.0: подсистема чата (modules/chat/*, core/utils-chat.js) удалена.
    // ============================================================

    // 5.3. Защита от повторного запуска (single-instance guard)
    // Page-context ссылка: при @grant window — песочница, а консоль и другие
    // скрипты видят только unsafeWindow.
    const LG_ROOT = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    if (LG_ROOT.__LEGION__?._booted) {
        try { LG_ROOT.__LEGION__.shutdown?.(); } catch (e) {}
    }

    // ============================================================
    // 5.4. Проверка обновлений аддона
    //
    // До 11.7.0 жила в modules/chat/chat-net.js и удалилась вместе с чатом.
    // GET /latest-version нашего сервера открытый (без X-Legion-Key), поэтому
    // хватает GM_xmlhttpRequest. Тумблер «🔔 Уведомлять о новых версиях»
    // (localStorage LEGION_UPDATE_NOTIFY) уважается: при 'false' не шлём даже
    // запрос. Сравнение версий — по числовым сегментам (11.7.0 > 11.6.10).
    // ============================================================
    function checkAddonUpdate() {
        try {
            if (localStorage.getItem('LEGION_UPDATE_NOTIFY') === 'false') return;
        } catch (e) { return; }
        if (typeof GM_xmlhttpRequest !== 'function') return;

        const current = (typeof GM_info !== 'undefined' && GM_info.script) ? String(GM_info.script.version || '') : '';
        if (!current) return;

        let base = 'https://legion.ctrlfree.host';
        try {
            if (Party && typeof Party.getBaseUrl === 'function') base = Party.getBaseUrl();
        } catch (e) {}

        const cmp = (a, b) => {
            const A = String(a).split('.').map(Number);
            const B = String(b).split('.').map(Number);
            for (let i = 0; i < Math.max(A.length, B.length); i++) {
                const x = A[i] || 0, y = B[i] || 0;
                if (x !== y) return x - y;
            }
            return 0;
        };

        GM_xmlhttpRequest({
            method: 'GET',
            url: String(base).replace(/\/+$/, '') + '/latest-version',
            timeout: 10000,
            onload(res) {
                if (!res || res.status !== 200) return;
                let data = null;
                try { data = JSON.parse(res.responseText); } catch (e) { return; }
                const latest = String((data && data.version) || '');
                if (!latest || cmp(latest, current) <= 0) return;

                const go = () => {
                    try {
                        if (typeof GM_openInTab === 'function') GM_openInTab(data.url || '', { active: true });
                    } catch (e) {}
                };
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        title: 'Legion Ultimate Assistant',
                        text: `Доступна версия ${latest} (у вас ${current})`,
                        timeout: 15000,
                        onclick: go
                    });
                } else if (typeof UI !== 'undefined' && UI.showToast) {
                    UI.showToast(`🔔 Доступна версия ${latest}`, false, go);
                }
            }
        });
    }

    // ============================================================
    // 8. ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    function boot() {
        // 1. Защита от iframe и Document PiP.
        // window.top в кросс-доменном iframe кидает SecurityError, поэтому try/catch:
        // ошибка доступа сама по себе означает, что мы в чужом iframe.
        let isIframe = false;
        try { isIframe = window.self !== window.top; } catch (e) { isIframe = true; }

        let isPiP = false;
        try { isPiP = !!(window.documentPictureInPicture && window.documentPictureInPicture.window === window); } catch (e) { isPiP = false; }

        // 2. Защита от legion-chat-window и других вторичных контекстов.
        //   /site/ver      — служебные страницы сайта (без /c/<канал>/);
        //   ?minechat      — окно чата шахты стороннего аддона;
        //   window.name    — именованные popup-окна (lgChat у того же аддона);
        //   не /c/...      — любой путь вне страницы канала игрой не является.
        // В таких контекстах мы бы создали второй style/fabWrap — дубликат FAB-меню.
        const isLegionChat =
            location.pathname.startsWith('/site/ver') ||
            location.search.includes('minechat') ||
            window.name === 'lgChat' ||
            !location.pathname.startsWith('/c/');

        if (isIframe || isPiP || isLegionChat) {
            dbg('Скрипт запущен во вторичном контексте (iframe / PiP / legion-chat-window), инициализация отменена.');
            return;
        }

        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);

        const fabWrap = document.createElement('div');
        fabWrap.className = DOM_IDS.fabWrap;
        fabWrap.id = DOM_IDS.fabWrap;
        // Вся разметка FAB-меню и круглой кнопки — в core/ui-templates.js
        // (v11.6.0, этап 3): main.js только подставляет id и версию скрипта.
        fabWrap.innerHTML = UITemplates.fabMenu(typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '11.7.0', DOM_IDS);
        document.body.appendChild(fabWrap);

        // Восстановление позиции FAB из localStorage (§ Задача 2)
        try {
            const pos = JSON.parse(localStorage.getItem('LEGION_FAB_POS'));
            if (pos && pos.left && pos.top) {
                const leftVal = parseInt(pos.left, 10);
                const topVal = parseInt(pos.top, 10);
                const fabSize = 50;

                // Проверяем, что позиция не за пределами экрана
                if (!isNaN(leftVal) && !isNaN(topVal) && leftVal >= 0 && leftVal <= window.innerWidth - fabSize && topVal >= 0 && topVal <= window.innerHeight - fabSize) {
                    fabWrap.style.left = pos.left;
                    fabWrap.style.top = pos.top;
                    fabWrap.style.right = 'auto';
                    fabWrap.style.bottom = 'auto';
                } else {
                    // Если позиция битая (за экраном) — сбрасываем
                    localStorage.removeItem('LEGION_FAB_POS');
                }
            }
        } catch(e) {}

        const fabBtn = document.getElementById(DOM_IDS.fabBtn) || document.getElementById('legion-fab-btn');
        const fabMenu = document.getElementById(DOM_IDS.fabMenu) || document.getElementById('legion-fab-menu');
        UI.setupFab(fabWrap, fabBtn, fabMenu);

        // ============================================================
        // ПАТЧ 11.6.5g: умный вход в меню аддона.
        //
        // В городе правый нижний угол уже занят нативным баром игры
        // (#gu-hud .gu-main): вставляем туда свою кнопку «Аддон», а
        // плавающую FAB прячем, чтобы не было двух входов подряд.
        // В шахте и походе бара нет — FAB возвращается на экран.
        // ============================================================
        UI.syncNavButton();

        if (typeof MutationObserver !== 'undefined') {
            // HUD игра строит лениво (guRender -> guHud) и после выхода из
            // города оставляет узел в DOM, переключая только html.gu-city.
            // Слушаем две дешёвые цели (появление #gu-hud в body и смену
            // классов на <html> и <body>), а не subtree всего документа: в
            // городе мутаций слишком много. Повторные вызовы склеиваем в один кадр.
            // Тумблер «📌 Кнопка аддона в нижнем меню игры» проверяется внутри
            // UI.syncNavButton(): при выключенном тумблере метод снимает нативную
            // кнопку и сразу выходит, поэтому наблюдатель её обратно не вернёт.
            //
            // ПАТЧ 11.6.6g: класс body отслеживаем из-за шахты — mine.js вешает
            // `mn-on` именно на body, а html.gu-city при этом остаётся (шахта
            // лежит оверлеем поверх города) и наш syncNavButton считал бы, что
            // мы в городе. ВАЖНО: повторный observe() на том же узле не
            // дополняет, а ЗАМЕНЯЕТ опции, поэтому childList и attributes для
            // body слиты в один вызов.
            let navSyncScheduled = false;
            const scheduleNavSync = () => {
                if (navSyncScheduled) return;
                navSyncScheduled = true;
                const run = () => { navSyncScheduled = false; UI.syncNavButton(); };
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
                else setTimeout(run, 150);
            };
            const navObserver = new MutationObserver(scheduleNavSync);
            navObserver.observe(document.body, { childList: true, attributes: true, attributeFilter: ['class'] });
            navObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            UI._navObserver = navObserver;
        }

        // 🏰 Карманный город — модуль (modules/pocket-city.js), не UI.
        (document.getElementById(DOM_IDS.btnPocketCity) || document.getElementById('btn-pocket-city'))?.addEventListener('click', () => PocketCity.open());
        (document.getElementById(DOM_IDS.btnProfile) || document.getElementById('btn-profile'))?.addEventListener('click', () => UI.togglePlayerHud());

        // ⚙️ Настройки (уведомления, боевой ассистент, вход в меню) вынесены
        // в отдельную модалку: FAB-меню стало короче, а служебные
        // переключатели больше не мешают кнопкам.
        document.getElementById('btn-fab-settings')?.addEventListener('click', () => UI.openSettings());

        Miner.init();
        BuildSim.init();        // без кнопки — регистрирует только глобальный клик для .sim-card
        HeroPlanner.init();     // кнопка FAB ведёт сюда
        Auction.init();
        Players.init();
        // 🎉 Пати: кнопка в FAB-меню, клиент сервера из server/ (шаг 1).
        Party.init();
        // ⚔️ Боевой ассистент (11.6.2b): подсказки по механикам боссов в походе.
        //    Отдельного пункта меню нет — тумблер в «⚙️ Настройках аддона».
        CombatAssistant.init();
        // ⚔️ Арена 5×5: шанс победы, согильдейцы в отряде противника и
        //    вкладка «Согильдейцы» в модалке приглашения. Контекст арены
        //    приходит из хука LGArena.open (core/hooks.js), своих патчей
        //    window.fetch/LGMine модуль не делает.
        Arena.init();
        // 📊 Статистика гильдии: четвёртая вкладка в нативном окне гильдии
        //    (.gl-modal). Появляется только своему руководству/доверенным
        //    (leader/lead/officer/trusted); данные — /api/guilds/guild
        //    с кэшем в памяти, window.fetch не патчится.
        GuildSummary.init();
        // 🏰 Карманный город: init() поднимает автоскип боёв с монстрами
        //    (тумблер «⏭️ Автоскип боёв с монстрами» в настройках), если он
        //    был включён в прошлой сессии, и запускает мониторинг сборов
        //    гильдии на элитных монстров (elist/ejoin, v11.7.0).
        //    Клики — только нативные, по .cm-dlg.
        PocketCity.init();

        // 🔔 Проверка обновлений: через 8 с после старта, чтобы не мешать
        // загрузке страницы и первому рендеру аддона.
        setTimeout(checkAddonUpdate, 8000);

        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') UI.closeModals(); });

        // 5.2. Экспорт API для отладки и single-instance guard
        const legionApi = {
            Utils,
            UI,
            UITemplates,
            Miner,
            BuildSim,
            HeroPlanner,
            Auction,
            Players,
            PocketCity,
            CombatAssistant,
            Arena,
            GuildSummary,
            Party,
            DOM_IDS,
            RAND_ID,
            _booted: true,
            shutdown: () => {
                if (Miner.abortController) {
                    try { Miner.abortController.abort(); } catch(e) {}
                    Miner.abortController = null;
                }
                Miner.stopMining();
                if (UI._hudTimer) {
                    clearInterval(UI._hudTimer);
                    UI._hudTimer = null;
                }
                // ПАТЧ 11.6.5g: снимаем наблюдатель за нативным HUD, отложенный
                // повтор и ссылки на узлы меню, а из бара игры убираем свою кнопку
                // (fabWrap удаляется ниже вместе с остальной разметкой).
                if (UI._navObserver) {
                    try { UI._navObserver.disconnect(); } catch (e) {}
                    UI._navObserver = null;
                }
                if (UI._navRetryTimer) {
                    clearTimeout(UI._navRetryTimer);
                    UI._navRetryTimer = null;
                }
                UI._fabWrap = UI._fabBtn = UI._fabMenu = null;
                UI._navMode = '';
                UI._navRetries = 0;
                document.querySelectorAll('.lgu-nav-btn').forEach(el => el.remove());
                // 11.7.0: подсистемы чата больше нет — её окно PiP, лента и
                // фоновые интервалы удалены вместе с модулем, гасить нечего.
                // 11.6.2b: гасим интервал боевого ассистента и убираем его контейнер,
                // иначе после перезапуска скрипта тикали бы два таймера.
                CombatAssistant.destroy();
                // Арена: снимаем MutationObserver, чистим кэши героев/состава
                // и убираем свои бейджи и вкладку из живого DOM.
                try { Arena.destroy?.(); } catch (e) {}
                // Статистика гильдии: снимаем наблюдатель и capture-клик,
                // чистим кэш состава и убираем вкладку/панель из .gl-modal.
                try { GuildSummary.destroy?.(); } catch (e) {}
                // 11.6.3c: гасим PerformanceObserver и HP-интервал Пати — иначе
                // старый инстанс продолжал бы слушать запросы игры (/api/me,
                // /api/qact) и слать state на наш сервер после перезапуска.
                Party.destroy();
                // 11.7.0: снимаем наблюдатель автоскипа боёв с монстрами и его
                // отложенные клики, а также опрос сборов на элитных монстров
                // (elist) с плашкой «Присоединиться» — иначе старый инстанс
                // продолжал бы нажимать «Пропустить» в окне .cm-dlg и слать
                // запросы после перезапуска скрипта.
                try { PocketCity.destroy?.(); } catch (e) {}
                document.querySelectorAll('.' + DOM_IDS.customModal + ', .sim-card, .float-btns, .' + DOM_IDS.fabWrap + ', #' + DOM_IDS.playerHud + ', .custom-modal, .legion-fab-wrap, #legion-player-hud').forEach(el => el.remove());
                legionApi._booted = false;
            }
        };

        // Публикуем API в page-context: при @grant песочница скрывает window от
        // консоли и других скриптов, unsafeWindow — нет. Дублируем в window, чтобы
        // внутренние ссылки (hooks.js) работали в обоих режимах.
        // v11.7.0: также экспортируем legionApi в unsafeWindow/G для удобной отладки из консоли.
        try { LG_ROOT.__LEGION__ = legionApi; } catch (e) {}
        try { window.__LEGION__ = legionApi; } catch (e) {}
        try { LG_ROOT.legionApi = legionApi; } catch (e) {}
        try { window.legionApi = legionApi; } catch (e) {}
        try { if (typeof G !== 'undefined' && G) G.legionApi = legionApi; } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

})();
