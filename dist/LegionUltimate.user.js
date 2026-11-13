// ==UserScript==
// @name         Legion: Ultimate Assistant (Chat, Auction, Pocket City)
// @namespace    http://tampermonkey.net/
// @version      11.6.4
// @description  QoL-аддон для Легиона: Умный чат, Сканер аукциона, Разведка, Планировщик, Карманный город. Без авто-копания.
// @connect      7tv.io
// @connect      cdn.7tv.app
// @connect      api.ivr.fi
// @connect      localhost
// @connect      127.0.0.1
// @connect      legion.ctrlfree.host
// @author       eciell
// @match        https://play.multidonate.ru/c/*
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
    // apiPath добавляет префикс /c/<канал>/ (см. docs/API.md),
    // fetchApi ходит через нативные контексты игры с фолбэком на fetch.
    // ============================================================
    const UtilsApi = {
        apiPath(p) {
            if (!p) return API_BASE;
            if (p.startsWith('/c/')) return p;
            return API_BASE + (p.startsWith('/') ? p : '/' + p);
        },
        async fetchApi(path, body, signal) {
            // Те же правила, что и в getItemArtSvg: после @grant объекты игры
            // живут только в unsafeWindow.
            const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            // 11.6.4b: __lgMineContext / __lgCityContext больше не заполняются —
            // хуки LGMine.open и LGCity.open сняты ради античита шахты.
            // Остаётся контекст аукциона (hookAuc.render) и текущий экранный
            // контекст игры G.X (у него есть api()). Если ни того, ни другого
            // нет — уходим в обычный fetch ниже (Utils.apiPath соберёт URL).
            const nativeCtx = G.__lgAucContext || G.X;
            if (nativeCtx && typeof nativeCtx.api === 'function') {
                try {
                    const bodyObj = body ? (typeof body === 'string' ? JSON.parse(body) : body) : undefined;
                    const res = await (bodyObj !== undefined ? nativeCtx.api(path, bodyObj) : nativeCtx.api(path));
                    if (res) {
                        const result = { ok: true, body: res, status: 200 };
                        if (typeof res === 'object' && !Array.isArray(res)) Object.assign(result, res);
                        return result;
                    }
                } catch (e) { /* если упало, идем в обычный fetch */ }
            }

            const url = this.apiPath(path);
            const opts = { credentials: 'same-origin', cache: 'no-store' };
            if (signal) opts.signal = signal;
            if (body) {
                opts.method = 'POST';
                opts.headers = { 'Content-Type': 'application/json' };
                opts.body = JSON.stringify(body);
            }
            try {
                const res = await fetch(url, opts);
                const data = await res.json().catch(() => null);
                const result = {
                    status: res.status,
                    ok: res.ok && (data ? data.ok !== false : true),
                    body: data
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

    // ===== src/core/utils-chat.js =====
    // ============================================================
    // 0.5. РАЗБОР ЧАТА И СЕТЕВЫХ ДАННЫХ (core/utils-chat.js)
    // Извлечение сообщений из ответов API/SSE, дедуп, кэш онлайна
    // и обработка входящих ЛС.
    // ============================================================
    const UtilsChat = {
        chatHash(author, text) {
            const s = `${(author || '').trim().toLowerCase()}|${(text || '').trim()}`;
            let h = 5381;
            for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
            return h;
        },
        extractChatFields(m) {
            if (!m || typeof m !== 'object') return { author: null, text: null, k: null, to: null, rank: null };

            const author = m.l || m.n || m.author || m.nick || m.name || m.login || m.from;
            const text = m.t || m.text || m.msg || m.m || m.message;
            const role = m.c || m.role || null;
            // Статус модератора сервер присылает отдельно от класса:
            // r: "mod" (щиток), c: "legionary" (иконка класса).
            const rawRank = m.r || m.rank || null;
            const rank = rawRank ? String(rawRank).toLowerCase() : null;

            // Определяем, системное ли это сообщение (§2.7, SDK §7)
            const isSystem = author === 'Летопись' || author === 'Система'
                || (author && author.toLowerCase().includes('летопись'))
                || m.ev === 1;

            const aw = Array.isArray(m.aw) ? m.aw : null;
            const channel = m.channel || m.room || m.ch || null;
            const k = m.k || m.kind || (channel === 'dm' ? 'dm' : null);
            const to = m.to || m.target || null;

            return { author, text, id: m.id, seq: m.s, role, rank, isSystem, aw, channel, k, to };
        },
        // Служебные ветки payload'а, в которые extractChatDeep не должен
        // спускаться: там лежат награды/титулы/предметы (у них бывают поля
        // t/l/n), и они не должны превращаться в «сообщения» чата.
        NON_CHAT_KEYS: new Set([
            'aw', 'awards', 'award', 'items', 'item', 'hero', 'me', 'stats',
            'st', 'inv', 'inventory', 'sk', 'skills', 'ign', 'top', 'players',
            'title', 'titles', 'ach', 'achievements', 'achievement', 'reward', 'rewards'
        ]),
        looksLikeChat(o) {
            if (!o || typeof o !== 'object' || Array.isArray(o)) return false;

            // 1. Отсекаем объекты наград/титулов/предметов по характерным служебным полям
            if (o.i !== undefined || o.d !== undefined || o.en !== undefined || o.price !== undefined) return false;
            if (o.id && o.t && o.id === o.t) return false; // id совпадает с типом награды (pioneer === pioneer)

            // 2. В настоящем сообщении ВСЕГДА есть логин/автор (строка от 2 символов).
            // Поле 'n' (name) НЕ используется как автор, так как у наград n — это название.
            const author = o.author ?? o.from ?? o.login ?? o.l ?? (typeof o.nick === 'string' ? o.nick : null);
            if (typeof author !== 'string' || author.trim().length < 2) return false;

            // 3. Текст сообщения: поля text/msg/message либо t (только при наличии валидного автора)
            const text = o.text ?? o.message ?? o.msg ?? o.t ?? (typeof o.m === 'string' ? o.m : null);
            return typeof text === 'string' && text.trim().length > 0;
        },
        extractChatDeep(m, depth = 0) {
            if (!m || depth > 4) return [];
            const result = [];

            // 1. Упакованный массив row: [id, s, l, n, t, at, ...]
            if (Array.isArray(m)) {
                // Если сам m — кортеж сообщения со строковым логином row[2] и текстом row[4]
                if (m.length >= 5 && typeof m[2] === 'string' && typeof m[4] === 'string' && m[4].trim()) {
                    return [{ id: m[0], s: m[1], l: m[2], n: m[3] || m[2], t: m[4], at: m[5], c: m[6], r: m[7] || null, aw: Array.isArray(m[8]) ? m[8] : null }];
                }

                // Или это массив сообщений/строк
                for (const item of m) {
                    if (Array.isArray(item)) {
                        if (item.length >= 5 && typeof item[2] === 'string' && typeof item[4] === 'string' && item[4].trim()) {
                            result.push({ id: item[0], s: item[1], l: item[2], n: item[3] || item[2], t: item[4], at: item[5], c: item[6], r: item[7] || null, aw: Array.isArray(item[8]) ? item[8] : null });
                        } else {
                            result.push(...this.extractChatDeep(item, depth + 1));
                        }
                    } else if (item && typeof item === 'object') {
                        // Отсекаем награды/титулы в массивах (у них есть i или d, и нет l/author)
                        if (item.i !== undefined || item.d !== undefined) continue;
                        if (this.looksLikeChat(item)) {
                            result.push(item);
                        } else {
                            result.push(...this.extractChatDeep(item, depth + 1));
                        }
                    }
                }
                if (result.length) return result;
            }

            // 2. Объект с чатом: {"chat": [...], "chatRoom": "mine"} или {"m": [...]}
            if (m && typeof m === 'object') {
                const roomChannel = m.chatRoom || (m.c === 'mine' ? 'mine' : null);

                // Чат шахты: {"chat": [{"id":..., "t":..., "l":..., "c":..., "cn":...}], "chatRoom": "mine"}
                if (Array.isArray(m.chat)) {
                    for (const item of m.chat) {
                        if (this.looksLikeChat(item)) {
                            result.push({
                                id: item.id || null,
                                s: item.s || null,
                                l: item.l || item.author || null,
                                n: item.n || item.name || item.l || null,
                                t: item.t || item.text || item.msg || '',
                                at: item.at || item.time || Date.now(),
                                c: item.c || item.role || null,
                                cn: item.cn || null,
                                r: item.r || item.rank || null,
                                aw: Array.isArray(item.aw) ? item.aw : null,
                                channel: roomChannel || item.channel || item.room || null,
                                k: item.k || item.kind || null,
                                to: item.to || item.target || null
                            });
                        } else if (Array.isArray(item)) {
                            if (item.length >= 5 && typeof item[2] === 'string' && typeof item[4] === 'string' && item[4].trim()) {
                                result.push({
                                    id: item[0], s: item[1], l: item[2], n: item[3] || item[2],
                                    t: item[4], at: item[5], c: item[6],
                                    r: item[7] || null, aw: Array.isArray(item[8]) ? item[8] : null,
                                    channel: roomChannel || null
                                });
                            }
                        }
                    }
                    if (result.length) return result;
                }

                if (Array.isArray(m.m)) {
                    for (const row of m.m) {
                        // Строгая проверка: только строковый автор и текст, числа (координаты) отсекаются
                        if (Array.isArray(row) && row.length >= 5 && typeof row[2] === 'string' && typeof row[4] === 'string' && row[4].trim()) {
                            result.push({
                                id: row[0], s: row[1], l: row[2], n: row[3] || row[2],
                                t: row[4], at: row[5], c: row[6],
                                r: row[7] || null, aw: Array.isArray(row[8]) ? row[8] : null,
                                channel: roomChannel || null
                            });
                        }
                    }
                    if (result.length) return result;
                }

                if (this.looksLikeChat(m)) {
                    return [m];
                }

                // Рекурсивный обход свойств объекта (до 4 уровней глубины).
                // Служебные ветки (награды, предметы, герой, статы) не трогаем:
                // оттуда и приходят фейковые «сообщения» вроде pioneer.
                for (const k of Object.keys(m)) {
                    if (this.NON_CHAT_KEYS.has(k)) continue;
                    const v = m[k];
                    if (!v) continue;
                    if (this.looksLikeChat(v)) {
                        result.push(v);
                    } else if (typeof v === 'object') {
                        result.push(...this.extractChatDeep(v, depth + 1));
                    }
                }
            }

            // Дедупликация в пределах возвращаемого списка
            const seen = new Set();
            const unique = [];
            for (const item of result) {
                const key = item.id || `${item.l || item.author || ''}-${item.t || item.text || ''}-${item.at || item.s || ''}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(item);
                }
            }
            return unique;
        },
        extractMessages(data) {
            if (!data) return [];
            let result = [];

            const parse = (node) => {
                if (!node) return;
                if (Array.isArray(node)) {
                    // Распознаем упакованный массив сообщения: [id, seq, login, name, text, time]
                    if (node.length >= 5 && typeof node[0] === 'string' && typeof node[2] === 'string' && typeof node[4] === 'string') {
                        result.push({ id: node[0], s: node[1], l: node[2], n: node[3], t: node[4], at: node[5] });
                    } else {
                        node.forEach(parse);
                    }
                } else if (typeof node === 'object') {
                    if (node.m && Array.isArray(node.m)) {
                        node.m.forEach(parse);
                    } else if (node.chat && Array.isArray(node.chat)) {
                        node.chat.forEach(parse);
                    } else if (node.t || node.text || node.msg) {
                        result.push(node);
                    }
                }
            };

            parse(data);

            // Дедупликация
            const unique = [];
            const seen = new Set();
            for (const m of result) {
                const key = m.id || (m.l + m.t + m.s) || Math.random();
                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(m);
                }
            }
            return unique;
        },
        processIncomingDMs(raw) {
            if (!raw) return;
            try {
                if (typeof Players === 'undefined' || !Players.handleIncomingDM) return;
                const chats = this.extractChatDeep(raw);
                if (!chats || !chats.length) return;
                chats.forEach(m => {
                    const parsed = this.extractChatFields(m);
                    const isDM = parsed.k === 'dm' || parsed.channel === 'dm' || m.k === 'dm' || m.kind === 'dm' || m.channel === 'dm';
                    if (isDM && parsed.text) {
                        Players.handleIncomingDM(parsed.author, parsed.text, parsed.to);
                    }
                });
            } catch (err) {
                dbg('Error processing incoming DMs:', err);
            }
        },
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
                        window.__lgOnlinePlayers.set(nick.toLowerCase(), { loc, ts: now, src });
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
        },

        /**
         * Вставка текста в поле команды похода (#qSayIn, см. site/quest.js).
         *
         * Игра блокирует вставку: noPaste на paste/drop + beforeinput
         * insertFromPaste. Поэтому значение пишем нативным сеттером из
         * цепочки прототипов самого элемента (realm-safe: не зависит от
         * песочницы Tampermonkey) и вручную шлём input/change.
         * inputType = 'insertText' под запрет вставки не попадает, а
         * saySend() читает inp.value напрямую — команда уйдёт по Enter.
         *
         * Если поля нет (не в походе / чат похода скрыт) — копируем текст в
         * буфер: GM_setClipboard (если выдан @grant), затем Clipboard API,
         * затем execCommand-фолбэк на временном textarea.
         *
         * @param {string} text команда, например «лечить @ник» или «удар»
         * @returns {boolean} true — вставлено в поле; false — скопировано в буфер
         */
        insertToQuestChat(text) {
            const value = String(text == null ? '' : text);
            const input = document.querySelector('#qSayIn, .q-say input, #tab-quest input[type="text"], .q-say textarea');

            if (input) {
                input.focus();
                try {
                    let proto = Object.getPrototypeOf(input);
                    let desc = null;
                    while (proto && !desc) {
                        desc = Object.getOwnPropertyDescriptor(proto, 'value');
                        proto = Object.getPrototypeOf(proto);
                    }
                    if (desc && desc.set) desc.set.call(input, value);
                    else input.value = value;

                    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                } catch (e) {
                    input.value = value;
                }
                return true;
            }

            const toast = (msg, isError) => {
                if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(msg, !!isError);
            };
            const okMsg = 'Поле чата не найдено, текст скопирован';

            // Самый старый путь: скрытый textarea + execCommand('copy').
            const legacyCopy = () => {
                let ok = false;
                try {
                    const ta = document.createElement('textarea');
                    ta.value = value;
                    ta.setAttribute('readonly', '');
                    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
                    document.body.appendChild(ta);
                    ta.select();
                    try { ok = document.execCommand('copy'); } catch (e2) {}
                    ta.remove();
                } catch (e3) {}
                toast(ok ? okMsg : `Не удалось скопировать. Текст: ${value}`, !ok);
                return ok;
            };

            // 1. GM_setClipboard — синхронный; доступен только если выдан @grant.
            try {
                if (typeof GM_setClipboard === 'function') {
                    GM_setClipboard(value);
                    toast(okMsg, false);
                    return false;
                }
            } catch (e) {}

            // 2. Clipboard API (нужен secure context и разрешение браузера).
            try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    navigator.clipboard.writeText(value).then(
                        () => toast(okMsg, false),
                        () => legacyCopy()
                    );
                    return false;
                }
            } catch (e) {}

            return legacyCopy();
        },
    };
    Object.assign(Utils, UtilsChat);

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
        .sim-card { position: fixed; background: #f5e9c8; color: #2a2010; border: 3px solid #2b1d18; border-radius: 12px; padding: 15px; width: 280px; z-index: 10001; box-shadow: 0 10px 25px rgba(0,0,0,0.6); display: none; }
        .sim-card h4 { margin: 0 0 5px 0; font-size: 16px; color: #2b1d18; display: flex; justify-content: space-between; }
        .sim-card .desc { font-size: 13px; margin-bottom: 10px; line-height: 1.3; }
        .sim-card .req { font-size: 12px; color: #c2405a; font-weight: bold; margin-bottom: 10px; }
        .sim-card .controls { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
        .sim-card button { background: #caa55c; border: 2px solid #2b1d18; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; color: #2b1d18; font-size: 13px; }
        .sim-card button:disabled { opacity: 0.5; cursor: not-allowed; }
        .sim-card-close { position: absolute; top: 8px; right: 8px; cursor: pointer; font-size: 16px; color: #888; }
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
           'shared') и плашка-предупреждение над деревом. Аналог нативных
           .skc-ow / .busybar.sk-sh из skills.js. */
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
        .sim-sidebar .modal-tab.sim-tab .sim-tab-lock {
            margin-left: auto;
            flex: none;
            font-size: 11px;
            line-height: 16px;
            opacity: 0.75;
        }
        .sim-shared-host { flex: none; }
        .sim-shared-note {
            margin: 0 0 8px;
            padding: 7px 10px;
            border: 1px solid rgba(255, 190, 90, 0.45);
            border-radius: 6px;
            background: rgba(120, 70, 20, 0.35);
            color: #ffd9a0;
            font-size: 12px;
            line-height: 1.35;
        }
        .sim-shared-note.own {
            border-color: rgba(120, 220, 140, 0.45);
            background: rgba(30, 90, 40, 0.3);
            color: #b9f0c0;
        }
        /* v11.6.5b.1: плашка доступного пула очков («Доступно сейчас: N»).
           Голубая, чтобы не путалась с оранжевым предупреждением о чужом
           дереве и зелёной плашкой «очки вложены сюда». */
        .sim-avail-note {
            margin: 0 0 8px;
            padding: 7px 10px;
            border: 1px solid rgba(120, 180, 255, 0.45);
            border-radius: 6px;
            background: rgba(30, 60, 120, 0.3);
            color: #bcd8ff;
            font-size: 12px;
            line-height: 1.35;
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
        .${DOM_IDS.chatBadge}, .chat-badge { position: absolute; top: -6px; right: -6px; background: #ff5a7a; color: #fff; border-radius: 50%; padding: 2px 7px; font-size: 12px; font-weight: 900; box-shadow: 0 2px 5px rgba(0,0,0,0.5); display: none; pointer-events: none; z-index: 2; }
        .${DOM_IDS.chatWidget}, .chat-widget { position: fixed; bottom: 80px; right: 20px; width: 320px; height: 400px; min-width: 320px; min-height: 400px; max-width: 95vw; max-height: 95vh; resize: both; background: #1d1620; border: 2px solid #caa55c; border-radius: 12px; display: flex; flex-direction: column; z-index: 10000; box-shadow: 0 10px 30px rgba(0,0,0,0.8); overflow: hidden; transition: transform 0.2s, opacity 0.2s; transform: translateY(20px); opacity: 0; pointer-events: none; }
        .${DOM_IDS.chatWidget}.open, .chat-widget.open { transform: translateY(0); opacity: 1; pointer-events: auto; }
        .chat-top-bar, .chat-header { background: #2a2030; padding: 10px 12px; font-weight: bold; color: #ffcf6a; display: flex; justify-content: space-between; align-items: center; gap: 8px; overflow: hidden; border-bottom: 1px solid #444; cursor: move; user-select: none; touch-action: none; box-sizing: border-box; flex-shrink: 0; }
        /* ПАТЧ 11.6.4g: вкладок стало пять (Общий/Торговля/Ремёсла/Гильдия/
           Личные), а ширина PiP-окна всего 350px. Поэтому горизонтальный
           padding урезан до 6px, шрифт — 11px, а ряд вкладок переносится
           (flex-wrap), если не влезает в одну строку рядом с кнопкой «✖». */
        .chat-main-tabs, .chat-tabs { display: flex; flex-wrap: wrap; gap: 3px; flex: 1; min-width: 0; }
        .chat-main-tab, .chat-tab { background: #1d1620; border: 1px solid #444; color: #aaa; padding: 3px 6px; border-radius: 6px; cursor: pointer; font-size: 11px; white-space: nowrap; font-weight: bold; user-select: none; pointer-events: auto; }
        .chat-main-tab.active, .chat-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; font-weight: bold; }
        .chat-sub-tabs { display: flex; gap: 6px; padding: 6px 12px; background: #231929; border-bottom: 1px solid #3a2b42; flex-shrink: 0; }
        .chat-sub-tab { background: #1d1620; border: 1px solid #444; color: #bbb; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; white-space: nowrap; user-select: none; pointer-events: auto; }
        .chat-sub-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; font-weight: bold; }
        .chat-role-icon { margin-right: 4px; }
        .chat-envelope { display: none; }
        .chat-close { cursor: pointer; color: #ff8fa3; padding: 4px 6px; flex-shrink: 0; font-size: 16px; line-height: 1; user-select: none; pointer-events: auto; }
        .chat-close:hover { color: #fff; }
        .chat-messages { flex: 1 1 0%; min-height: 0; padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #f7eadf !important; }
        .chat-msg { background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 8px; line-height: 1.3; word-wrap: break-word; color: #f7eadf !important; }
        .chat-msg.pending { opacity: 0.6; font-style: italic; }
        .chat-msg.streamer-msg { border-left: 3px solid #ffd700; background: rgba(255, 215, 0, 0.08); }
        .chat-msg.mention-msg { border-left: 3px solid #f7768e; background: rgba(247, 118, 142, 0.12); }
        .chat-text { color: #f7eadf !important; word-break: break-word; }
        .chat-author { font-weight: bold; color: #f7eadf !important; margin-right: 5px; }
        .chat-input-area { display: flex; padding: 10px; background: #111; border-top: 1px solid #333; gap: 5px; flex-shrink: 0; }
        .chat-input { flex: 1; background: #222; border: 1px solid #444; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 13px; outline: none; }
        .chat-input:focus { border-color: #caa55c; }
        .chat-send { background: #caa55c; color: #1d1620; border: none; padding: 0 15px; border-radius: 6px; font-weight: bold; cursor: pointer; user-select: none; pointer-events: auto; }
        .chat-send:hover { background: #ffcf6a; }
        .chat-widget button { user-select: none; pointer-events: auto; }
        .${DOM_IDS.hudLog}, .hud-log { position: fixed; bottom: 20px; left: 20px; width: 480px; max-height: 300px; background: rgba(29, 22, 32, 0.95); border: 2px solid #caa55c; border-radius: 8px; padding: 10px; z-index: 9999; overflow-y: auto; font-family: monospace; font-size: 12px; color: #f7eadf; box-shadow: 0 4px 10px rgba(0,0,0,0.5); display: none; }
        .${DOM_IDS.hudLog}.active, .hud-log.active { display: block; }
        .hud-log-header { font-weight: bold; color: #ffcf6a; margin-bottom: 8px; border-bottom: 1px solid #555; padding-bottom: 4px; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none; touch-action: none; }
        .hud-log-close { cursor: pointer; color: #ff8fa3; padding: 5px; }
        .hud-log-close:hover { color: #fff; }
        .hud-line { margin-bottom: 4px; line-height: 1.3; word-wrap: break-word; }
        .hud-line.info { color: #8fd3ff; }
        .hud-line.success { color: #4cc95a; }
        .hud-line.warn { color: #ff9800; }
        .hud-line.action { color: #ffcf6a; font-weight: bold; }
        .hud-line.error { color: #ff5a7a; }
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
        .player-hud-row { display: flex; justify-content: space-between; align-items: center; }
        .player-hud-label { color: #aaa; }
        .player-hud-val { font-weight: bold; }
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

        /* HUD пати: HP-панель и журнал в одном контейнере, перетаскивание
           за заголовки. Контейнер и панели — pointer-events:none, чтобы не
           перехватывать клики по игре; интерактивные узлы возвращают auto. */
        .party-hud-container { position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; align-items: stretch; box-sizing: border-box; pointer-events: none; }
        .party-panel, .party-log-panel { display: none; position: relative; box-sizing: border-box; min-width: 150px; max-width: 260px; background: rgba(20, 16, 26, 0.92); border: 1px solid #3a3040; border-radius: 10px; padding: 8px 10px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); font: 12px/1.4 system-ui, "Segoe UI", sans-serif; color: #e8e8ea; pointer-events: none; }
        .party-drag-handle { pointer-events: auto; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
        .party-drag-handle:active, .party-hud-container.party-dragging .party-drag-handle { cursor: grabbing; }
        .party-panel-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #c9b184; margin-bottom: 6px; }
        .party-log-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .party-log-body { pointer-events: auto; max-height: 150px; overflow-y: auto; margin-top: 6px; }
        .party-log-body::-webkit-scrollbar { width: 6px; }
        .party-log-body::-webkit-scrollbar-thumb { background: #44374a; border-radius: 4px; }
        .party-log-body::-webkit-scrollbar-thumb:hover { background: #caa55c; }
        .party-log-toggle { pointer-events: auto; background: none; border: none; padding: 0 2px; color: #ffcf6a; cursor: pointer; font-size: 12px; line-height: 1; }
        .party-log-toggle:hover { color: #fff; }
        .party-heal-btn { pointer-events: auto; flex: none; padding: 0 5px; background: #22352a; border: 1px solid #5fd987; color: #5fd987; border-radius: 4px; font-size: 10px; line-height: 15px; cursor: pointer; transition: background 0.15s, color 0.15s; }
        .party-heal-btn:hover:not(:disabled) { background: #5fd987; color: #16121a; }
        .party-heal-btn:disabled { opacity: 0.6; cursor: default; }
        /* 7TV-смайлики: размер задаётся переменной --t7-h (S/M/L/XL из настроек чата) */
        .t7-emote { height: var(--t7-h, 1.9em); vertical-align: middle; margin: 0 2px; }
        /* Подсветка пользователей аддона (ТЗ 11.6.0h).
           НЕ переопределяем color — сохраняем индивидуальный цвет игрока
           (класс/ранг выставляет его самой игрой). text-shadow с currentColor
           даёт свечение ровно в его родном цвете. */
        .legion-addon-user {
            text-shadow: 0 0 4px currentColor, 0 0 10px currentColor !important;
        }
        .legion-addon-badge {
            display: inline-block;
            margin-right: 3px;
            font-size: 11px;
            /* Фирменное золотое свечение аддона (было голубое #00f0ff). */
            filter: drop-shadow(0 0 4px rgba(255, 207, 106, 0.7));
            vertical-align: middle;
            user-select: none;
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
            max-height: none !important;
            overflow: hidden !important;
        }
        #hp-buildsim-container {
            padding-bottom: 10px !important;
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
           11.6.2b: БОЕВОЙ АССИСТЕНТ (modules/combat-assistant.js)
           Контейнер висит по центру сверху и прозрачен для мыши, чтобы не
           перекрывать нативный UI похода; кликабельна только карточка
           подсказки (pointer-events: auto) с кнопкой «Вставить в чат».
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
        .hp-ab-val .hp-ab-sim { font-style: normal; color: #7ad1ff; }
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
        /* ── Плашка нехватки жетонов и панель действий ── */
        .hp-arena-alert {
            background: rgba(200, 30, 30, 0.18); border: 1px solid rgba(255, 90, 90, 0.55);
            color: #ffb3a0; font-size: 12px; font-weight: bold;
            border-radius: 6px; padding: 6px 10px;
        }
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
        .hp-arena-btn.primary { background: #caa55c; border-color: #caa55c; color: #1d1620; }
        .hp-arena-btn.primary:hover:not(:disabled) { background: #ffcf4a; border-color: #ffcf4a; }
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
        /* Таблица уровней: свой скролл, чтобы 15 строк не растягивали модалку.
           Отступ 350px — это h2, табы, две компактные строки верха
           (topbar + суббар), баннер предмета и сноска под сплитом. */
        .hp-ench-right {
            flex: 1 1 60%; min-width: 0;
            max-height: calc(100vh - 350px);
            overflow-y: auto;
        }
        /* Узкая модалка/маленькое окно — таблица уезжает под карточку цели. */
        @media (max-width: 980px) {
            .hp-ench-split { flex-direction: column; }
            .hp-ench-left, .hp-ench-right { flex: 1 1 auto; width: 100%; min-width: 0; }
        }
        /* Таблица уровней: компактнее общих правил .custom-modal th/td и без
           псевдоэлемента сортировки «↕» (здесь сортировки нет). */
        .custom-modal .hp-ench-table th,
        .custom-modal .hp-ench-table td { padding: 5px 8px; font-size: 13px; }
        .custom-modal .hp-ench-table th { cursor: default; white-space: nowrap; }
        .custom-modal .hp-ench-table th::after { content: ''; }
        /* Строка уровня — кликабельная цель. Пройденные шаги приглушены. */
        .hp-ench-table .hp-ench-row { cursor: pointer; transition: background 0.12s; }
        .hp-ench-table .hp-ench-row:hover { background: rgba(202, 165, 92, 0.08); }
        .hp-ench-table .hp-ench-row.passed { cursor: default; opacity: 0.45; }
        .hp-ench-table .hp-ench-row.passed:hover { background: transparent; }
        .hp-ench-table .hp-ench-row.cur { opacity: 1; background: rgba(202, 165, 92, 0.12); }
        .hp-ench-table .hp-ench-row.target { background: rgba(122, 209, 255, 0.12); }
        .hp-ench-table .hp-ench-row.target td:first-child { box-shadow: inset 2px 0 0 #7ad1ff; }
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
        /* ── Шапка карточки цели: «Цель: +N» + пресеты ── */
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

        const hookCity = (val) => {
            rawLGCity = val;
            if (!val || val.__hooked) return;
            val.__hooked = true;

            // 11.6.4b: подмена LGCity.open тоже снята (любая подмена open на
            // игровых объектах — детект). Контекст города берём из G.X/LGCity
            // по месту вызова, см. core/utils-api.js, modules/players.js,
            // modules/chat/chat-pip.js.

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

            // 3) data(q) — сеттер игры: сохраняем СЫРОЙ пакет до буферизации.
            //    quest.js кладёт его в RAW и показывает с задержкой стрима (q.dl),
            //    поэтому _view() отстаёт.
            // TODO: REMOVE — снимок писался для Ассистента Жреца
            // (modules/priest-assistant.js удалён в 11.6.0g-1); сейчас
            // G.__lgRawQuestData никто не читает. Хук оставлен, пока
            // пользователь не подтвердил удаление.
            if (typeof val.data === 'function' && !val.__dataHooked) {
                const origData = val.data;
                val.data = function (q) {
                    // G — это unsafeWindow (см. core/constants.js).
                    if (q) G.__lgRawQuestData = q;
                    return origData.apply(this, arguments);
                };
                val.__dataHooked = true;
                patched = true;
            }

            // Метку ставим только если реально что-то подменили: если
            // методы ещё не созданы, следующий сеттер LGQuest (или сторож)
            // попробует повесить хук повторно.
            if (patched) val.__hooked = true;
        };

        if (rawLGCity) hookCity(rawLGCity);
        if (rawLGAuction) hookAuc(rawLGAuction);
        if (rawLGQuest) hookQuest(rawLGQuest);

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
            const v = version || '11.5.3';
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
                        <button class="fab-menu-item" id="${d.btnPopout}">📺 Вынести чат <span class="${d.chatBadge}" id="${d.chatBadge}">0</span></button>
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
                <span class="${d.chatBadge}" id="${d.fabChatBadge}">0</span>
            </div>
        `;
        },

        /**
         * Модалка служебных настроек аддона (открывается из FAB-меню).
         * Обработчики кнопок навешивает UI.openSettings().
         *
         * @param {boolean} chatDisabled    перехват чата отключён
         * @param {boolean} addonHighlight  подсветка ников Legion включена (11.6.0g-4)
         */
        settingsModal(chatDisabled, addonHighlight = true) {
            return `
                <h2>⚙️ Настройки аддона <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="display:flex; flex-direction:column; gap:15px; padding:10px;">
                    <button id="modal-7tv-btn" style="width:100%; padding:10px; background:#2a2030; border:1px solid #caa55c; color:#ffcf6a; border-radius:6px; cursor:pointer; text-align:left;">🎭 Настройки канала 7TV</button>
                    <label style="display:flex; justify-content:space-between; align-items:center; background:#1e1724; padding:10px; border-radius:6px; cursor:pointer;">
                        <span>🚫 Отключить перехват чата</span>
                        <input type="checkbox" class="lg-toggle" id="modal-chk-chat" ${chatDisabled ? 'checked' : ''}>
                    </label>
                    <!-- 11.6.4e: тумблер отображения 7TV-смайлов. Состояние ставит
                         и сохраняет UI.openSettings() (localStorage
                         'LEGION_7TV_DISABLED'), читают рендер сообщений и загрузчик
                         набора (modules/chat/chat-emotes.js). -->
                    <label style="display:flex; justify-content:space-between; align-items:center; background:#1e1724; padding:10px; border-radius:6px; cursor:pointer; margin-top: 8px;">
                        <span>🎭 Отображать смайлы 7TV</span>
                        <input type="checkbox" class="lg-toggle" id="modal-chk-7tv">
                    </label>
                    <!-- v11.6.0g-4: подсветка ников пользователей аддона в чате -->
                    <label style="display:flex; justify-content:space-between; align-items:center; background:#1e1724; padding:10px; border-radius:6px; cursor:pointer; margin-top: 8px;">
                        <span>⚡ Подсветка ников Legion</span>
                        <input type="checkbox" class="lg-toggle" id="modal-chk-addon-hl" ${addonHighlight ? 'checked' : ''}>
                    </label>
                    <!-- v11.6.1g: тумблер уведомлений о новых версиях.
                         Состояние ставит и сохраняет UI.openSettings() (localStorage
                         'LEGION_UPDATE_NOTIFY'), сама проверка версии в chat-net.js
                         продолжает работать — просто молча. -->
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
         */
        pocketCityModal() {
            return `
                <h2>🏰 Карманный Город <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="font-size:13px; color:#aaa; margin-bottom:15px; text-align:center;">
                    Прямой доступ к официальным зданиям игры из любой локации:
                </div>
                <!-- minmax(120px): 7 карточек-зданий укладываются в один ряд при ширине окна 1200px -->
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
        // ⚙️ Служебные настройки аддона: канал 7TV и перехват чата.
        // Вынесены из FAB-меню в модалку, чтобы меню не разрасталось.
        openSettings() {
            const chatDisabled = (typeof Chat !== 'undefined') ? !!Chat.disabled : false;
            // 11.6.0g-4: состояние тумблера подсветки ников (дефолт — включено).
            const addonHighlight = (typeof Chat !== 'undefined') ? Chat.addonHighlight !== false : true;

            // Разметка модалки — в core/ui-templates.js (UITemplates.settingsModal).
            const modal = this.showModal(UITemplates.settingsModal(chatDisabled, addonHighlight), { compact: true });

            if (!modal) return;

            modal.querySelector('#modal-7tv-btn')?.addEventListener('click', () => {
                this.closeModals();
                if (typeof Chat !== 'undefined' && typeof Chat.open7tvSettings === 'function') {
                    Chat.open7tvSettings();
                }
            });

            modal.querySelector('#modal-chk-chat')?.addEventListener('change', (e) => {
                if (typeof Chat !== 'undefined' && typeof Chat.setDisabled === 'function') {
                    Chat.setDisabled(e.target.checked);
                }
            });

            // 11.6.4e: тумблер «🎭 Отображать смайлы 7TV». Дефолт — включено
            // (ключа в localStorage ещё нет). Флаг читают
            // SevenTV.replaceEmotes / decorate / load() в
            // modules/chat/chat-emotes.js, поэтому и замена смайлов, и запросы
            // к 7TV прекращаются сразу, без перезагрузки страницы.
            const tvChk = modal.querySelector('#modal-chk-7tv');
            if (tvChk) {
                tvChk.checked = localStorage.getItem('LEGION_7TV_DISABLED') !== 'true';
                tvChk.addEventListener('change', (e) => {
                    localStorage.setItem('LEGION_7TV_DISABLED', String(!e.target.checked));
                    // Chat.setSevenTVEnabled() догрузит набор (если аддон
                    // стартовал с выключенным тумблером) и перерисует
                    // открытый чат.
                    if (typeof Chat !== 'undefined' && typeof Chat.setSevenTVEnabled === 'function') {
                        Chat.setSevenTVEnabled(e.target.checked);
                    }
                });
            }

            // 11.6.0g-4: подсветка ников Legion — сохраняем и перерисовываем чат.
            modal.querySelector('#modal-chk-addon-hl')?.addEventListener('change', (e) => {
                if (typeof Chat !== 'undefined' && typeof Chat.setAddonHighlight === 'function') {
                    Chat.setAddonHighlight(e.target.checked);
                }
            });

            // 11.6.1g: тумблер уведомлений о новых версиях.
            // Дефолт — включено (ключа в localStorage ещё нет). Значение читает
            // Chat.checkForUpdates() перед GM_notification.
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

        closeFabMenu() {
            const menu = this._fabMenu
                || document.getElementById(DOM_IDS.fabMenu)
                || document.getElementById('legion-fab-menu');
            if (!menu) return;
            menu.classList.remove('open');
            menu.classList.remove('open-down');
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

        // Умное переключение входа в меню:
        //   Город       — есть нативный бар: наша кнопка встаёт первой, FAB прячем;
        //   Шахта/Поход — бара нет: возвращаем плавающую FAB.
        // #gu-hud игра создаёт один раз и после выхода из города оставляет в DOM
        // (скрывая через html.gu-city), поэтому наличия бара ещё не достаточно.
        syncNavButton() {
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
                    const isOpen = menu.classList.toggle('open');
                    if (isOpen) {
                        // Меню не должно улетать за край экрана: если над кнопкой
                        // мало места — раскрываем его вниз (класс open-down).
                        const rect = btn.getBoundingClientRect();
                        const viewportH = window.innerHeight || 800;
                        const menuHeight = Math.min(menu.scrollHeight || 400, viewportH - 120);
                        if (rect.top < menuHeight + 20) {
                            menu.classList.add('open-down');
                        } else {
                            menu.classList.remove('open-down');
                        }
                    } else {
                        menu.classList.remove('open-down');
                    }
                }
            });

            // Закрытие меню при клике снаружи
            document.addEventListener('pointerdown', (e) => {
                if (!wrap.contains(e.target)) {
                    menu.classList.remove('open');
                }
            });

            // Закрытие меню при клике по любому пункту (кроме чекбокса)
            menu.querySelectorAll('.fab-menu-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.tagName === 'INPUT' || e.target.closest('input')) return;
                    menu.classList.remove('open');
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
                           location.pathname.includes('/mine') ||
                           (typeof Chat !== 'undefined' && Chat.isInMine && Chat.isInMine());
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

    // ===== src/modules/build-sim.js =====
    // ============================================================
    // 4. МОДУЛЬ: ПЛАНИРОВЩИК БИЛДОВ
    // ============================================================
    const BuildSim = {
        skillsCache: null,
        simulatedSkills: {},
        savedBuilds: {}, // { [clsId]: [{ name, skills }] } — сохранённые в localStorage билды по классам
        _currentBuildName: '', // имя последнего сохранённого/загруженного билда (для будущих фич UI)
        _currentBuildNames: {}, // { [clsId]: name } — активный билд каждого класса (нужен для кнопки «Удалить»)
        _autoLoadClass: null, // класс, чей билд пришёл ссылкой #build=… (вкладку открываем после создания табов)
        _tooltipTimer: null, // setTimeout hover-тултипа узла (500 мс, ТЗ 11.6.1e)
        _tooltipState: null, // { clsId, nodeId, mode: 'hover'|'click' } — что сейчас показано
        // v11.6.3: режим навыков из hero.sk.md. 'shared' — один общий пул
        // очков по уровню героя в игре, но планировщик его игнорирует.
        // v11.6.5b.3: лимита по пулу героя больше нет вообще — полей
        // availablePoints / pointsLimit / heroLevel в объекте не осталось,
        // чтобы ограничение нельзя было случайно вернуть. maxPts() === 50.
        // 'class' (и старый 'hero') — прежняя модель, тот же лимит.
        skillMode: 'class',
        // v11.6.5b.1: вложенные ранги героя из hero.sk.t ({ [clsId]: { [nodeId]: rank } }).
        // Нужны кнопке «От вложенного» (режим keep).
        nativeSkills: {},
        ownerClass: '', // класс, в чьё дерево уже вложены общие очки (только зелёная метка ✓)
        _nativeSkillsWarm: null, // промис прогрева ленивого LGSkills (не блокирует UI)

        statNames: { hp: 'Макс. HP', atk: 'Физ. урон', mag: 'Магия', def: 'Броня', crit: 'Крит %', critDmg: 'Сила крита', dodge: 'Уклонение', pierce: 'Пробивание', healPow: 'Сила лечения', luck: 'Удача', resist: 'Сопротивление' },
        fxNames: { melee: 'Физ. урон %', magic: 'Магия %', hp: 'Макс. HP %', def: 'Броня', healPow: 'Сила лечения %', healIn: 'Вх. лечение %', crit: 'Крит %', critDmg: 'Сила крита', skel: 'Урон скелетов %', skelT: 'Время скелетов', leech: 'Вампиризм %', block: 'Снижение урона %', dodge: 'Уклонение %', lead: 'Урон по боссам %', first: 'Урон 1-й ход %', dmg: 'Весь урон %', pierce: 'Пробивание %', resist: 'Сопротивление', healCrit: 'Крит лечения %', regen: 'Регенерация %', low: 'Урон при низком HP %', a_siyanie: 'Сияние +%', a_obereg: 'Оберег +%', a_dlan: 'Длань +%', a_aura: 'Аура +%', aura: 'Аура −урон %', a_svet: 'Свет +%', a_vspyshka: 'Вспышка +%', a_oznob: 'Озноб +%', a_pricel: 'Прицел +%', a_grad: 'Град +%', a_natisk: 'Натиск +%', a_stoyka: 'Стойка +%', a_vspinu: 'Вспину +%', a_yad: 'Яд +%', a_vytyanut: 'Вытянуть +%', a_podnyat: 'Поднять +%', poison: 'Отрава %', steal: 'Кража %', loot: 'Добыча %', skelN: 'Скелетов +', volley: 'Залп +%', shieldBlock: 'Щит блок %', trapDodge: 'Ловушки %', steady: 'Промах→удар %', cleave: 'Замах %', cleaveBoss: 'Замах по боссу %', penBoss: 'Бронебой по боссу %', drain: 'Вытягивание %', hex: 'Проклятие +%', holy: 'По нежити +%', poisonT: 'Время отравы',
            // v11.6.5b: новые ключи ребаланса — проклятие и кулдауны действий.
            a_proklyat: 'Проклятие +%',
            cd_proklyat: 'КД Проклятия',
            cd_natisk: 'КД Натиска',
            cd_grad: 'КД Града',
            cd_vspyshka: 'КД Вспышки',
            cd_obereg: 'КД Оберега',
            cd_siyanie: 'КД Сияния',
            cd_oznob: 'КД Озноба',
            cd_yad: 'КД Яда',
            cd_vspinu: 'КД Вспину',
            cd_podnyat: 'КД Поднять',
            cd_vytyanut: 'КД Вытянуть',
            cd_dlan: 'КД Длани',
            cd_aura: 'КД Ауры' },
        classNames: { recruit: 'Новобранец', legionary: 'Легионер', archer: 'Лучник', mage: 'Маг', priest: 'Жрец', rogue: 'Разбойник', necromancer: 'Некромант', paladin: 'Паладин' },
        /*
         * Цвета кнопок классов — из нативного экрана игры (ТЗ 11.6.1d, скрин 4).
         * Значение кладётся в CSS-переменную --c таба класса: неактивный таб —
         * цветная рамка/текст на тёмной подложке, активный — заливка цветом.
         * recruit в нативном списке не подсвечивался — нейтральный серо-золотой.
         */
        classColors: { recruit: '#d7d3c8', legionary: '#ff7b7b', archer: '#7bff7b', mage: '#7bbaff', priest: '#ffcf4a', rogue: '#d4aaff', necromancer: '#7c52cc', paladin: '#ffdf7b' },

        /*
         * Цвет текста НА заливке цвета класса (активный таб, ТЗ 11.6.1e).
         * Правило контраста: светлая заливка (Жрец, Паладин, Разбойник #d4aaff) —
         * тёмный текст #12100e; тёмная заливка (Некромант #7c52cc) — белый.
         * Кладётся в CSS-переменную --ct (значение по умолчанию — тёмное).
         */
        classTextColors: { necromancer: '#fff' },

        /*
         * Словарь нативных SVG-иконок игры (viewBox 0 0 24 24, stroke=currentColor).
         * Источник: reference/LegionFrontSRC/site/skills.js (объекты NI и BI + DIAM).
         * Ключи иконок веток совпадают с id веток из /api/skills (blade, shield, ...)
         * и используются как fallback, когда у навыка нет подходящей fx-иконки.
         */
        SKILL_ICONS: {
            // --- Иконки навыков (NI) ---
            sword: '<path d="M19.5 4.5 20 4l-.5 4.5L9.5 18.5l-4-4zM7.5 16.5l-3 3M4 15l5 5"/>',
            shield: '<path d="M12 3.5l7 2.8v5.1c0 4.6-3 7.8-7 9.6-4-1.8-7-5-7-9.6V6.3z"/>',
            bow: '<path d="M6 3c6 3 9 9 6 18M6 3l12 18M14 5h5v5M19 5 9 15"/>',
            spark: '<path d="M12 2.5l1.8 6.2 6.2 1.8-6.2 1.8L12 18.5l-1.8-6.2L4 10.5l6.2-1.8z"/><path d="M19 17l.8 2.2 2.2.8-2.2.8L19 23"/>',
            fire: '<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.6 3-5.8 3.6-9.5 2 1.5 3 3.4 3.2 5.3 1-1 1.6-2.4 1.6-3.8 2.7 2.2 4.6 5 4.6 8 0 3.4-2.5 6-6 6z"/>',
            frost: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
            heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
            cross: '<path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>',
            skull: '<path d="M12 3.5a7.5 7.5 0 0 0-4.5 13.5v3h9v-3A7.5 7.5 0 0 0 12 3.5z"/><circle cx="9.3" cy="11.5" r="1.6"/><circle cx="14.7" cy="11.5" r="1.6"/><path d="M10.5 20.5v-2M13.5 20.5v-2"/>',
            star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
            bolt: '<path d="M13.5 2.5 5.5 13.5h6l-1.5 8 8-11h-6z"/>',
            crown: '<path d="M3.5 18.5h17M4.5 18.5 3.5 7l5 4 3.5-6 3.5 6 5-4-1 11.5z"/>',
            wind: '<path d="M3 8.5h11a3 3 0 1 0-3-3M3 12.5h15a3 3 0 1 1-3 3M3 16.5h8"/>',
            eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
            dagger: '<path d="M14.5 3.5 16 5l-7.5 9-2-2zM6.5 12l-2.5 2.5 2 2 2.5-2.5M5 15.5l-1.5 1.5 3 3L8 18.5"/><path d="M15 13.5l5 5"/>',
            vial: '<path d="M9.5 3.5h5M10.5 3.5v5L6 17a2.6 2.6 0 0 0 2.3 3.5h7.4A2.6 2.6 0 0 0 18 17l-4.5-8.5v-5M8 14.5h8"/>',
            sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
            drop: '<path d="M12 3.5s-6 6.6-6 10.6a6 6 0 0 0 12 0c0-4-6-10.6-6-10.6z"/>',
            coin: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.6-.9-1.5-1.3-2.5-1.3-1.5 0-2.5.8-2.5 1.9 0 2.7 5.2 1.3 5.2 4 0 1.1-1.1 1.9-2.7 1.9-1.1 0-2.1-.5-2.6-1.4M12 6.5v1.7M12 15.8v1.7"/>',
            // v11.6.3: иконки из обновлённого skills.js (CHECK подтверждения,
            // «часы» для cd_*, геометрические заглушки и точки/столбики).
            check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
            clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2.5"/>',
            leaf: '<path d="M5 19c0-8 5-13.5 14-14 .5 9-5 14-13 14z"/><path d="M5 19l8-8"/>',
            ring: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/>',
            hex: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/>',
            tri: '<path d="M12 4l8.5 15h-17z"/>',
            sq: '<rect x="5" y="5" width="14" height="14" rx="2.5"/>',
            dots: '<circle cx="8" cy="8" r="2.6"/><circle cx="16" cy="8" r="2.6"/><circle cx="12" cy="16" r="2.6"/>',
            bars: '<path d="M6 19V11M12 19V6M18 19v-5"/>',
            // --- Иконки веток (BI): ключ = id ветки из /api/skills ---
            blade: '<path d="M19.5 4.5 20 4l-.5 4.5L9.5 18.5l-4-4zM7.5 16.5l-3 3M4 15l5 5"/>',
            veteran: '<path d="M8 3h8l-1.5 6h-5zM12 9v3"/><circle cx="12" cy="16.5" r="4.2"/><path d="M12 14.6l.7 1.4 1.5.2-1.1 1 .3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1 1.5-.2z"/>',
            aim: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
            hunt: '<path d="M5 19 19 5M15 5h4v4M5 15l4 4M7 13l4 4"/><path d="M6 6c5-2 10 3 12 12"/>',
            shade: '<path d="M4 10.5c3-1.5 5.5-1.5 8 0s5 1.5 8 0M4 14.5c3-1.5 5.5-1.5 8 0s5 1.5 8 0M7 6.5c2-1 3.5-1 5 0s3 1 5 0"/>',
            lore: '<path d="M5 4.5h10.5a2 2 0 0 1 2 2V19.5H7a2 2 0 0 1-2-2zM5 17.5a2 2 0 0 1 2-2h10.5M9 8.5h5M9 11.5h4"/>',
            mercy: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>',
            faith: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
            wrath: '<path d="M13.5 2.5 5.5 13.5h6l-1.5 8 8-11h-6z"/>',
            blades: '<path d="M14.5 3.5 16 5l-7.5 9-2-2zM6.5 12l-2.5 2.5 2 2 2.5-2.5M5 15.5l-1.5 1.5 3 3L8 18.5"/><path d="M15 13.5l5 5"/>',
            venom: '<path d="M9.5 3.5h5M10.5 3.5v5L6 17a2.6 2.6 0 0 0 2.3 3.5h7.4A2.6 2.6 0 0 0 18 17l-4.5-8.5v-5M8 14.5h8"/>',
            shadow: '<path d="M15.5 4.5A8 8 0 1 0 19.5 16 6.5 6.5 0 0 1 15.5 4.5z"/>',
            bones: '<path d="M12 3.5a7.5 7.5 0 0 0-4.5 13.5v3h9v-3A7.5 7.5 0 0 0 12 3.5z"/><circle cx="9.3" cy="11.5" r="1.6"/><circle cx="14.7" cy="11.5" r="1.6"/>',
            life: '<path d="M12 3.5s-6 6.6-6 10.6a6 6 0 0 0 12 0c0-4-6-10.6-6-10.6z"/>',
            dark: '<path d="M9 21h6M10 21V11h4v10M12 11V8"/><path d="M12 8c-1.6-1.2-1.6-3 0-4.5 1.6 1.5 1.6 3.3 0 4.5z"/>',
            light: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
            grace: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>',
            bulwark: '<path d="M12 3.5l7 2.8v5.1c0 4.6-3 7.8-7 9.6-4-1.8-7-5-7-9.6V6.3z"/><path d="M12 7v10M8 11h8"/>',
            // Ромб-заглушка (DIAM) для неизвестных веток и классов.
            diam: '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>'
        },
        // Иконки, которые в игре заливаются полупрозрачно (нативный класс .so).
        // v11.6.3: список синхронизирован с SOLID из skills.js.
        SOLID_ICONS: ['sword', 'shield', 'heart', 'cross', 'star', 'bolt', 'crown', 'fire', 'spark', 'leaf', 'hex', 'tri', 'diam', 'sq', 'drop'],
        // fx-ключ -> иконка; порядок важен: срабатывает первое совпадение (FXI из skills.js).
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
        // Иконка класса для табов (CLI из skills.js); «Экипировка» — щит.
        CLASS_ICONS: { legionary: 'sword', archer: 'bow', mage: 'spark', priest: 'cross', rogue: 'dagger', necromancer: 'skull', paladin: 'sun', gear: 'shield' },
        // Горизонтальные позиции узлов внутри яруса (XS из skills.js).
        TIER_X: { 1: [50], 2: [28, 72], 3: [18, 50, 82], 4: [14, 38, 62, 86] },
        // SVG из словаря: solid-иконки заливаются полупрозрачно (нативный класс .so).
        _svg(key) {
            const known = this.SKILL_ICONS[key] ? key : 'diam';
            const solid = this.SOLID_ICONS.includes(known) ? ' so' : '';
            return `<svg class="sim-svg${solid}" viewBox="0 0 24 24" aria-hidden="true">${this.SKILL_ICONS[known]}</svg>`;
        },

        // Ключ иконки навыка: kind -> первый fx -> иконка ветки (iconOf из skills.js).
        iconKeyOf(node, branch) {
            if (!node) return 'diam';
            // v11.6.5b: нативное правило iconOf — навык с кулдауном (cd_*)
            // рисуется «часами» раньше любых проверок kind, даже если у него
            // есть другой fx-ключ или он является капом ветки.
            const hasCd = Object.keys(node.fx || {}).some(k => k.startsWith('cd_'));
            if (hasCd) return 'clock';
            if (node.kind === 'cap') return 'crown';
            if (node.kind === 'act') return 'bolt';
            if (node.kind === 'ctl') return 'star';
            for (const k of Object.keys(node.fx || {})) {
                for (const [re, icon] of this.FX_ICONS) if (re.test(k)) return icon;
            }
            const bid = branch && branch.id;
            return (bid && this.SKILL_ICONS[bid]) ? bid : 'diam';
        },

        getNodeSvg(node, branch) { return this._svg(this.iconKeyOf(node, branch)); },
        getBranchSvg(branch) {
            const bid = branch && branch.id;
            return this._svg((bid && this.SKILL_ICONS[bid]) ? bid : 'diam');
        },
        getClassSvg(clsId) { return this._svg(this.CLASS_ICONS[clsId] || 'diam'); },

        // Горизонталь узла в ярусе: нативные XS для 1-4 узлов, иначе равномерно.
        xFor(count, index) {
            const xs = this.TIER_X[count];
            if (xs && xs[index] !== undefined) return xs[index];
            return Math.round((100 * (index + 1)) / (count + 1));
        },
        isSkipFx(key) { return SKIP_FX_PREFIXES.some(p => key.startsWith(p)); },

        // Текст навыка с подстановкой значений из node.fx (там прибавка за 1 ранг).
        // Для неизученного навыка (rank 0) показываем значения 1-го ранга.
        //
        // v11.6.5b: игра ввела макросы ребаланса {cleaveBoss}, {penBoss}, {critX},
        // которых нет в node.fx — сервер их не присылает, значения считаются на
        // лету при отрисовке текста (см. kv() в reference/LegionFrontSRC/site/skills.js).
        formatNodeText(node, rank) {
            if (!node.text) return '';
            const r = Math.max(1, rank); // Если ранг 0, показываем значение для 1-го ранга
            const fx = node.fx || {};
            // Красивое форматирование: 1.2 -> "1.2", 3.0 -> "3"
            const fmt = (val) => Number.isInteger(val) ? val.toString() : val.toFixed(1).replace('.0', '');
            return node.text.replace(/\{(\w+)\}/g, (match, key) => {
                /*
                 * Вычисляемые макросы ребаланса (в fx их нет, поэтому проверяются
                 * ДО стандартной подстановки fx[key] * r):
                 *   cleaveBoss — 40% от «Замаха» за ранг: урон по боссу;
                 *   penBoss    — «Пробивание» / 20 за ранг: бронебой по боссу;
                 *   critX      — множитель крита: база ×2 + Сила крита / 100 за ранг.
                 */
                if (key === 'cleaveBoss') return fmt((fx.cleave || 0) * r * 0.4);
                if (key === 'penBoss') return fmt((fx.pierce || 0) * r / 20);
                if (key === 'critX') return fmt(2 + (fx.critDmg || 0) * r / 100);
                if (fx[key] !== undefined) {
                    return fmt(fx[key] * r);
                }
                return match; // Если ключа нет в fx, оставляем как есть (или можно '?')
            });
        },

        init() {
            // Кнопка теперь принадлежит HeroPlanner — см. src/modules/hero-planner.js.
            // BuildSim остаётся как модуль и открывается из таба «Билды».
            // Клик вне узла/тултипа закрывает тултип навыка (ТЗ 11.6.1d).
            document.addEventListener('click', (e) => {
                // Клики внутри тултипа (кнопки +/−, крестик) и по узлу обрабатывают
                // свои слушатели — здесь их не трогаем, иначе тултип закроется раньше.
                const t = e.target;
                if (t && t.closest && (t.closest('.sim-tooltip') || t.closest('.sim-node'))) return;
                // Старые карточки .sim-card (до v11.6.1d) могли остаться в DOM — чистим.
                document.querySelectorAll('.sim-card').forEach(c => c.remove());
                this.hideTooltip();
            });
        },

        async open() {
            // sim-modal: отдельный класс модалки — в styles.js ему поднята max-height
            // до 95vh, чтобы дерево навыков влезало целиком без внутреннего скролла.
            const modal = UI.showModal(`<h2>🧮 Планировщик билдов <button class="custom-close" id="custom-close-btn">✖</button></h2><div id="buildsim-modal-body" style="display:flex; flex-direction:column; flex:1; min-height:0;"></div>`, { customClass: 'sim-modal' });
            const body = modal.querySelector('#buildsim-modal-body');
            if (body) await this.mount(body);
        },

        // ------------------------------------------------------------
        // v11.6.3: ленивый LGSkills и режим общих очков (sk.md).
        // ------------------------------------------------------------

        /**
         * Прогрев нативного дерева навыков.
         *
         * В новом клиенте skills.js грузится лениво (`lazy('skills')` из
         * app.js) и до открытия вкладки «Навыки» window.LGSkills === undefined.
         * Свой каталог мы всё равно берём из /api/skills, поэтому прогрев —
         * необязательный фон: он нужен лишь затем, чтобы нативная вкладка
         * героя не оставалась пустой после открытия аддона.
         *
         * ВАЖНО: lazy() в app.js — локальная функция IIFE и наружу не
         * экспортируется. Сначала проверяем G.lazy (на случай, если клиент
         * её всё-таки отдаст), а при отсутствии молчим: данные уже пришли
         * через Utils.fetchApi('/api/skills').
         */
        warmNativeSkills() {
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            try {
                if (pageWin.LGSkills) return Promise.resolve(true);
                if (this._nativeSkillsWarm) return this._nativeSkillsWarm;
                if (typeof pageWin.lazy === 'function') {
                    this._nativeSkillsWarm = Promise.resolve(pageWin.lazy('skills'))
                        .catch(() => false)
                        .finally(() => { this._nativeSkillsWarm = null; });
                    return this._nativeSkillsWarm;
                }
            } catch (e) {
                dbg('[BUILD SIM] прогрев LGSkills не удался:', e);
            }
            return Promise.resolve(false);
        },

        /**
         * Режим очков навыков из /api/me -> hero.sk.
         *
         * Игра в shared-режиме разрешает вложение только в одно дерево, но
         * ПЛАНИРОВЩИК — песочница: он не зависит от текущих вложений игры.
         * v11.6.5b.3: из метода убраны пул очков героя (availablePoints) и
         * лимит (pointsLimit) — планирование всегда до maxPts() === 50,
         * в том числе для класса-владельца (ownerClass).
         * ownerClass остаётся только ради зелёной метки ✓ в сайдбаре.
         */
        readSkillMode(hero) {
            const sk = (hero && hero.sk) || {};
            this.skillMode = sk.md || 'class';
            this.ownerClass = '';
            this.nativeSkills = (sk.t && typeof sk.t === 'object' && !Array.isArray(sk.t)) ? sk.t : {};
            if (this.skillMode === 'shared') this.ownerClass = this.ownerOf(sk);
            return { mode: this.skillMode, limit: this.maxPts(), owner: this.ownerClass };
        },

        /**
         * v11.6.5b.3: лимит очков плана (maxPts из ТЗ).
         *
         * Всегда MAX_POINTS (50) — в любом режиме и для любого класса,
         * включая класс-владельца общих очков (ownerClass). Симулятор не
         * зависит от того, сколько очков уже вложено в игре. Ползунка в UI
         * нет: очки вкладываются только кнопками «+» / «−».
         */
        maxPts() {
            return MAX_POINTS;
        },

        // Класс, в чьё дерево уже вложены общие очки (ownerOf из skills.js):
        // первый класс sk.t, у которого есть ранг > 0.
        ownerOf(sk) {
            if (!sk || sk.md !== 'shared' || !sk.t) return '';
            for (const [cls, ranks] of Object.entries(sk.t)) {
                if (ranks && Object.values(ranks).some(r => +r > 0)) return cls;
            }
            return '';
        },

        async mount(container) {
            if (!container) return;
            // Ссылка вида …#build=<код> — обмен билдами без сервера. Код читаем
            // сразу, а ПРИМЕНЯЕМ ниже, после сброса simulatedSkills: иначе
            // импортированные навыки затёрлись бы пустым объектом.
            // Посторонний хэш (не от билда) игнорируем — иначе показывали бы
            // ложное «неверный формат кода».
            const hash = window.location.hash || '';
            const hashBuildCode = hash.includes('#build=') ? this._extractBuildCode(hash) : '';
            // Сохранённые билды поднимаем до парсинга /api/me и /api/skills,
            // чтобы UI успел отрисовать список «Мои билды» при первом renderTree.
            this.loadSavedBuilds();
            // v11.6.3: нативное дерево грузится лениво. Прогрев — фоном,
            // результат не ждём: каталог навыков берём из /api/skills.
            this.warmNativeSkills();
            // Тултип узла от прошлой сессии не должен «воскресать» при повторном
            // открытии модалки (state хранится на объекте BuildSim).
            this.hideTooltip();
            // Очки при каждом открытии начинаются с нуля (this.simulatedSkills = {}),
            // поэтому и «активного» билда нет: кнопка «Удалить» до выбора/загрузки
            // честно попросит выбрать билд.
            this._currentBuildNames = {};
            this._currentBuildName = '';
            container.innerHTML = `<div class="loader">Загрузка данных...</div>`;
            try {
                const me = await Utils.fetchApi('/api/me');
                if (!me || !me.ok || !me.hero) throw new Error('Нет героя');
                // v11.6.3: режим очков читаем ДО decodeBuild — импорт из
                // ссылки ограничен тем же лимитом, что и ручное вложение.
                this.readSkillMode(me.hero);
                if (!this.skillsCache) this.skillsCache = await Utils.fetchApi('/api/skills');
                if (!this.skillsCache || !this.skillsCache.classes) throw new Error('Нет данных о навыках');

                this.simulatedSkills = {};
                // Билд из ссылки применяем поверх пустой симуляции (код прочитан
                // в начале mount — до сброса применять было нельзя).
                if (hashBuildCode) {
                    this._autoLoadClass = this.decodeBuild(hashBuildCode);
                    if (this._autoLoadClass) UI.showToast('📥 Билд загружен из ссылки!');
                    else UI.showToast('❌ Неверный формат кода билда', true);
                    // Хэш убираем: иначе перезагрузка страницы снова перезапишет
                    // текущую симуляцию тем же билдом.
                    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}
                }
                const h = me.hero;
                const equipped = h.items.filter(x => x.on);
                const bag = h.items.filter(x => !x.on && x.wearable);
                const allClasses = (this.skillsCache.classes || []).filter(c => c.branches && c.branches.length > 0);

                // Табы классов: slim-сайдбар слева (v11.6.3b). Кнопки остаются
                // .modal-tab.sim-tab[data-tab] — обработчики кликов ниже и
                // автозагрузка билда из ссылки (_autoLoadClass) ищут по классу
                // и потому подхватывают новую разметку без изменений.
                let tabsHtml = `<button class="modal-tab sim-tab active" data-tab="gear">${this.getClassSvg('gear')}Экипировка</button>`;
                // Разделитель между системной вкладкой «Экипировка» и классами.
                tabsHtml += `<div class="sim-sidebar-sep"></div>`;
                allClasses.forEach(c => {
                    // --c: цвет класса из classColors (стили таба — в styles.js);
                    // --ct: цвет текста на заливке (classTextColors, ТЗ 11.6.1e).
                    const color = this.classColors[c.id] || '#caa55c';
                    const textColor = this.classTextColors[c.id] || '#12100e';
                    // v11.6.5b.2: замки с классов сняты — все деревья
                    // кликабельны всегда. Осталась только метка ✓ у класса,
                    // в который уже вложены общие очки (аналог .skc-ow).
                    const owned = this.skillMode === 'shared' && this.ownerClass === c.id;
                    const tabBadge = owned
                        ? '<span class="sim-tab-own" title="Очки навыков вложены в этот класс">✓</span>'
                        : '';
                    tabsHtml += `<button class="modal-tab sim-tab" data-tab="${c.id}" style="--c:${color};--ct:${textColor}">${this.getClassSvg(c.id)}${this.classNames[c.id] || c.name || c.id}${tabBadge}</button>`;
                });

                let contentHtml = `
                    <div class="tab-content active" id="tab-gear">
                        <div style="flex:1;">
                            <h3>Текущие статы</h3>
                            <table><tr><th>Параметр</th><th>Значение</th></tr>`;
                for (const [k, v] of Object.entries(h.stats)) {
                    contentHtml += `<tr><td>${this.statNames[k] || k}</td><td>${v}</td></tr>`;
                }
                contentHtml += `</table></div><div style="flex:2;">
                        <h3>Сравнение с сумкой (что будет, если надеть)</h3>
                        <table><tr><th>Вещь (слот)</th><th>Изменение статов</th></tr>`;
                bag.forEach(item => {
                    const cur = equipped.find(x => x.slot === item.slot);
                    let changes = [];
                    const keys = new Set([...Object.keys(item.stats || {}), ...Object.keys(cur ? cur.stats || {} : {})]);
                    keys.forEach(k => {
                        const nv = (item.stats && item.stats[k]) || 0;
                        const ov = (cur && cur.stats && cur.stats[k]) || 0;
                        const d = nv - ov;
                        if (d !== 0) {
                            changes.push(`<span class="${d > 0 ? 'stat-up' : 'stat-down'}">${d > 0 ? '+' : ''}${d} ${this.statNames[k] || k}</span>`);
                        }
                    });
                    if (!changes.length) changes.push('<span class="stat-eq">Без изменений</span>');
                    contentHtml += `<tr><td><b>${item.name}</b> <br><small style="color:#888">(${item.slot})</small></td><td>${changes.join('<br>')}</td></tr>`;
                });
                contentHtml += `</table></div></div>`;

                allClasses.forEach(c => {
                    contentHtml += `
                        <div class="tab-content" id="tab-${c.id}">
                            <div class="sim-tree-wrap">
                                <div class="sim-tree-inner">
                                    <!-- Верхняя панель: одна строка 38px (очки / билды / обмен). -->
                                    <div class="sim-top-bar">
                                        <div class="sim-free-pts">Свободно: <b id="free-${c.id}">0</b> / ${this.maxPts()}</div>
                                        <div class="sim-bar-sep"></div>
                                        <button class="sim-save-btn" data-save="${c.id}" title="Сохранить билд">Сохранить</button>
                                        <button class="sim-share-btn" data-share="${c.id}" title="Поделиться билдом">Поделиться</button>
                                        <button class="sim-import-btn" data-import="${c.id}" title="Импортировать билд">Импорт</button>
                                        <button class="sim-keep-btn" data-keep="${c.id}" title="От того, что уже вложено: взять очки, вложенные в игре, и планировать остальные до ${this.maxPts()}">⟲ Вложено</button>
                                        <div class="sim-bar-sep"></div>
                                        <select id="load-select-${c.id}" class="sim-load-select" title="Мои билды">
                                            <option value="">— Мои билды —</option>
                                        </select>
                                        <button class="sim-del-btn" data-del="${c.id}" title="Удалить выбранный билд">🗑️</button>
                                        <button class="sim-reset-btn" data-reset="${c.id}" title="Сбросить все навыки">Сбросить всё</button>
                                    </div>
                                    <div class="sim-branches" id="tree-${c.id}"></div>
                                </div>
                            </div>
                            <div class="build-right stats-panel">
                                <h3>Итоговые статы симуляции</h3>
                                <div id="stats-${c.id}"></div>
                            </div>
                        </div>`;
                });

                // v11.6.3b: двухоконный лейкаут — сайдбар классов слева, дерево
                // и панель статов справа. Кнопки остались .modal-tab.sim-tab
                // с data-tab, поэтому обработчики ниже и автозагрузка билда из
                // ссылки (.modal-tab[data-tab=…]) находят их внутри <aside>.
                container.innerHTML = `
                    <div class="sim-layout">
                        <aside class="sim-sidebar">
                            ${tabsHtml}
                        </aside>
                        <main class="sim-main-content">
                            ${contentHtml}
                        </main>
                    </div>
                `;

                container.querySelectorAll('.modal-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        // Тултип узла относится к дереву текущей вкладки — прячем его
                        // при переключении класса (ТЗ 11.6.1d).
                        this.hideTooltip();
                        container.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                        container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                        tab.classList.add('active');
                        const target = container.querySelector(`#tab-${tab.dataset.tab}`);
                        if (target) target.classList.add('active');
                        if (tab.dataset.tab !== 'gear') this.renderTree(tab.dataset.tab);
                    });
                });

                container.querySelectorAll('[data-reset]').forEach(btn => {
                    btn.addEventListener('click', () => this.resetBuild(btn.dataset.reset));
                });

                // Билд из ссылки: программно открываем вкладку его класса, чтобы
                // симуляция сразу отрисовалась (клик по табу зовёт renderTree).
                if (this._autoLoadClass) {
                    const autoTab = container.querySelector(`.modal-tab[data-tab="${this._autoLoadClass}"]`);
                    this._autoLoadClass = null;
                    if (autoTab) autoTab.click();
                }
            } catch (err) {
                dbg('[BUILD SIM] Ошибка монтирования:', err);
                container.innerHTML = `<div style="color:#ff5a7a; text-align:center; padding:20px;">Ошибка: ${err.message}</div>`;
            }
        },

        resetBuild(clsId) {
            this.simulatedSkills[clsId] = {};
            // ТЗ 11.6.1d, п. 2.1: «Сбросить всё» НЕ должно подставлять последний
            // сохранённый билд. Забываем активный билд класса — тогда renderTree()
            // вернёт <select> к плейсхолдеру «— Мои билды —», а не к старой записи.
            this._setCurrentBuild(clsId, '');
            this.hideTooltip();
            this.renderTree(clsId);
            document.querySelectorAll('.sim-card').forEach(c => c.remove());
        },

        /**
         * v11.6.5b.1: кнопка «⟲ Вложено» (режим keep, «от того, что уже вложено»).
         *
         * Берёт ранги, которые УЖЕ вложены в игре (hero.sk.t[clsId]), кладёт
         * их в симуляцию и оставляет свободными остальные очки до целевого
         * лимита плана (maxPts, до 50) — их план и добирает кнопками +.
         * Правила зависимостей/тиров проверять не нужно: ранги пришли из
         * валидного состояния игры.
         */
        keepNativeBuild(clsId) {
            const ranks = (this.nativeSkills && this.nativeSkills[clsId]) || {};
            const clean = {};
            let total = 0;
            Object.entries(ranks).forEach(([nodeId, rank]) => {
                const r = Math.floor(Number(rank));
                if (!Number.isFinite(r) || r <= 0) return;
                clean[nodeId] = r;
                total += r;
            });
            if (!total) {
                UI.showToast('В этом дереве нет вложенных очков — начинаем с чистого плана', true);
                return;
            }
            this.simulatedSkills[clsId] = clean;
            // Это не сохранённый билд: «🗑️» не должен целиться в localStorage.
            this._setCurrentBuild(clsId, '');
            this.hideTooltip();
            this.renderTree(clsId);
            UI.showToast(`⟲ Взято из игры: ${total} ${this._pointsWord(total)} · свободно до ${this.maxPts()}`);
        },

        // ------------------------------------------------------------
        // Сохранённые билды (localStorage, ключ LEGION_SAVED_BUILDS).
        // Формат: { [clsId]: [{ name, skills }] }, skills — { [nodeId]: rank }.
        // Ключ общий для всех классов, поэтому запись идёт целиком объектом.
        // ------------------------------------------------------------
        // Активный билд запоминаем и общим полем (по ТЗ), и по классам:
        // иначе после переключения вкладки «Удалить» целилось бы в билд
        // другого класса с тем же именем.
        _setCurrentBuild(clsId, name) {
            this._currentBuildName = name || '';
            if (!this._currentBuildNames) this._currentBuildNames = {};
            if (name) this._currentBuildNames[clsId] = name;
            else delete this._currentBuildNames[clsId];
        },

        loadSavedBuilds() {
            try {
                const raw = localStorage.getItem('LEGION_SAVED_BUILDS');
                if (raw) this.savedBuilds = JSON.parse(raw) || {};
            } catch (e) {
                // Битый JSON / приватный режим — начинаем с чистого списка.
                this.savedBuilds = {};
            }
        },

        saveCurrentBuild(clsId, name) {
            if (!name) return false;
            if (!this.savedBuilds[clsId]) this.savedBuilds[clsId] = [];

            const currentSkills = this.simulatedSkills[clsId] || {};
            // Проверяем, нет ли уже билда с таким именем
            const existing = this.savedBuilds[clsId].findIndex(b => b.name === name);
            const entry = { name: name, skills: { ...currentSkills } };

            if (existing >= 0) this.savedBuilds[clsId][existing] = entry;
            else this.savedBuilds[clsId].push(entry);

            this._setCurrentBuild(clsId, name);
            try {
                localStorage.setItem('LEGION_SAVED_BUILDS', JSON.stringify(this.savedBuilds));
            } catch (e) {}
            return true;
        },

        loadBuild(clsId, index) {
            if (!this.savedBuilds[clsId] || !this.savedBuilds[clsId][index]) return;
            const build = this.savedBuilds[clsId][index];
            this.simulatedSkills[clsId] = { ...build.skills };
            this._setCurrentBuild(clsId, build.name);
            this.renderTree(clsId);
            UI.showToast(`📥 Билд «${build.name}» загружен`);
        },

        deleteBuild(clsId, index) {
            if (!this.savedBuilds[clsId] || !this.savedBuilds[clsId][index]) return;
            const name = this.savedBuilds[clsId][index].name;
            this.savedBuilds[clsId].splice(index, 1);
            // Удалили активный билд — забываем его имя, чтобы «Удалить»
            // не целилась в уже исчезнувшую запись.
            if (this._currentBuildNames && this._currentBuildNames[clsId] === name) {
                this._setCurrentBuild(clsId, '');
            }
            try {
                localStorage.setItem('LEGION_SAVED_BUILDS', JSON.stringify(this.savedBuilds));
            } catch (e) {}
            this.renderTree(clsId);
            UI.showToast(`🗑️ Билд «${name}» удален`);
        },

        // Удаление по имени активного билда: кнопка «🗑️» вызывает именно это.
        // Возвращает true, если запись найдена и удалена.
        deleteCurrentBuild(clsId) {
            const name = this._currentBuildNames ? this._currentBuildNames[clsId] : '';
            const list = this.savedBuilds[clsId] || [];
            const idx = name ? list.findIndex(b => b.name === name) : -1;
            if (idx < 0) {
                UI.showToast('Сначала загрузите или выберите билд', true);
                return false;
            }
            this.deleteBuild(clsId, idx);
            return true;
        },

        // ------------------------------------------------------------
        // Инлайн-имя билда (патч 11.6.2a).
        // Панель .sim-top-bar — одна строка 38px, поэтому вместо window.prompt()
        // на месте кнопки «Сохранить» появляется пара «input + OK»
        // (CSS .sim-top-bar .sim-save-name: высота 28px, шрифт 12px).
        // Кнопку не удаляем, а прячем: её обработчик привязывается в renderTree()
        // (.onclick идемпотентно), а Enter / Esc / клик вне панели возвращают
        // разметку в исходное состояние.
        // ------------------------------------------------------------
        showSaveInline(clsId) {
            const saveBtn = document.querySelector(`.sim-save-btn[data-save="${clsId}"]`);
            if (!saveBtn) return;
            const bar = saveBtn.parentElement;
            // Повторный клик по «Сохранить» не должен плодить вторую пару.
            const existing = bar ? bar.querySelector('.sim-save-name') : null;
            if (existing) { existing.focus(); return; }

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'sim-save-name';
            input.placeholder = 'Название билда';
            input.maxLength = 40;
            input.value = (this._currentBuildNames && this._currentBuildNames[clsId]) || 'Мой билд';

            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'sim-save-ok';
            okBtn.textContent = 'OK';
            okBtn.title = 'Сохранить билд';

            saveBtn.style.display = 'none';
            // Порядок: «Сохранить» (скрыта) → input → OK.
            saveBtn.insertAdjacentElement('afterend', okBtn);
            saveBtn.insertAdjacentElement('afterend', input);

            const close = () => {
                document.removeEventListener('pointerdown', onOutside, true);
                input.remove();
                okBtn.remove();
                saveBtn.style.display = '';
            };

            const commit = () => {
                const name = (input.value || '').trim();
                if (!name) {
                    UI.showToast('Введите имя билда', true);
                    input.focus();
                    return;
                }
                // Сначала убираем пару, потом рендерим: renderTree() перерисовывает
                // дерево и список «Мои билды», панель должна быть как обычно.
                close();
                if (this.saveCurrentBuild(clsId, name)) {
                    UI.showToast('💾 Билд сохранен');
                    this.renderTree(clsId);
                }
            };

            const onOutside = (e) => {
                if (bar && !bar.contains(e.target)) close();
            };

            okBtn.onclick = commit;
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    close();
                }
            });
            // pointerdown, а не click: иначе клик по узлу дерева успел бы
            // отработать (очки/тултип) раньше, чем закроется панель.
            document.addEventListener('pointerdown', onOutside, true);

            input.focus();
            input.select();
        },

        // ------------------------------------------------------------
        // Обмен билдами без сервера: код в Base64 + ссылка #build=<код>.
        // Формат: { cls: '<класс>', sk: { <nodeId>: <ранг> } } → JSON →
        // encodeURIComponent (гарантирует ASCII, иначе btoa бросит исключение)
        // → Base64 → URL-safe: '+' → '-', '/' → '_', паддинг '=' срезан.
        // ------------------------------------------------------------
        encodeBuild(clsId) {
            const skills = this.simulatedSkills[clsId] || {};
            try {
                const json = JSON.stringify({ cls: clsId, sk: skills });
                return btoa(encodeURIComponent(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            } catch (e) {
                dbg('[BUILD SIM] Ошибка кодирования билда:', e);
                return '';
            }
        },

        // Код приходит извне (ссылка от другого игрока), поэтому декодируем
        // с проверками: известный класс, целые ранги в пределах node.max,
        // сумма очков не больше целевого лимита плана (maxPts, до 50).
        // Возвращает id класса, к которому относится билд, либо null.
        decodeBuild(code) {
            if (!code || typeof code !== 'string') return null;
            try {
                let b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
                // В ссылке паддинг срезан, а atob в части окружений требует
                // длину, кратную 4 — восстанавливаем.
                const pad = b64.length % 4;
                if (pad) b64 += '='.repeat(4 - pad);

                const data = JSON.parse(decodeURIComponent(atob(b64)));
                if (!data || typeof data !== 'object') return null;
                const cls = data.cls;
                const sk = data.sk;
                if (typeof cls !== 'string' || !sk || typeof sk !== 'object' || Array.isArray(sk)) return null;

                // Класс обязан быть в /api/skills — чужой код не подсунет произвольный clsId.
                const classes = (this.skillsCache && Array.isArray(this.skillsCache.classes)) ? this.skillsCache.classes : [];
                const clsData = classes.find(c => c.id === cls);
                if (!clsData) return null;

                // Допустимые узлы и максимумы рангов — из дерева этого класса.
                const nodeMax = new Map();
                (clsData.branches || []).forEach(b => (b.nodes || []).forEach(n => nodeMax.set(n.id, n.max || 1)));

                const clean = {};
                let total = 0;
                Object.entries(sk).forEach(([nodeId, rank]) => {
                    const max = nodeMax.get(nodeId);
                    if (!max) return;                  // узел не из этого дерева — пропускаем
                    const r = Math.floor(Number(rank));
                    if (!Number.isFinite(r) || r <= 0) return;
                    clean[nodeId] = Math.min(r, max);
                    total += clean[nodeId];
                });

                // «Перекачанный» билд (больше очков, чем даёт игра) не принимаем.
                // v11.6.3: лимит зависит от режима.
                // v11.6.5b.1: в shared план считается до MAX_POINTS (maxPts),
                // а не до уровня героя — иначе импорт плана на 50 не проходил.
                if (total > this.maxPts()) return null;

                this.simulatedSkills[cls] = clean;
                // Импорт — не сохранённый билд: «🗑️» не должен целиться
                // в запись из localStorage с тем же именем.
                this._setCurrentBuild(cls, '');
                return cls;
            } catch (e) {
                return null;
            }
        },

        // Достаём код из ссылки (#build=…), «голого» кода или текста с ссылкой.
        _extractBuildCode(input) {
            const raw = String(input || '').trim();
            const marker = '#build=';
            const idx = raw.indexOf(marker);
            // После кода в хэше могут идти другие параметры: #build=<код>&a=b
            return idx >= 0 ? raw.slice(idx + marker.length).split(/[&#\s]/)[0] : raw;
        },

        // «📤 Поделиться»: собираем ссылку с кодом билда и копируем в буфер.
        shareBuild(clsId) {
            const skills = this.simulatedSkills[clsId] || {};
            if (!Object.keys(skills).length) {
                UI.showToast('Сначала распределите очки навыков', true);
                return;
            }
            const code = this.encodeBuild(clsId);
            if (!code) { UI.showToast('Не удалось создать код билда', true); return; }

            // Код кладём в хэш: такой адрес не уходит на сервер игры и не
            // ломает SPA-роутинг (в отличие от query-параметра).
            const url = `${location.origin}${location.pathname}#build=${code}`;
            // clipboard.writeText доступен только в secure context и может быть
            // запрещён настройками браузера — тогда показываем окно для копирования.
            const fallback = () => window.prompt('Скопируйте ссылку на билд:', url);
            try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    navigator.clipboard.writeText(url)
                        .then(() => UI.showToast('📋 Ссылка на билд скопирована в буфер'))
                        .catch(fallback);
                } else {
                    fallback();
                }
            } catch (e) {
                fallback();
            }
        },

        // «📥 Импорт»: принимаем и ссылку целиком, и «голый» код.
        importBuild(clsId) {
            const input = window.prompt('Вставьте ссылку или код билда:');
            if (!input) return;

            const loadedCls = this.decodeBuild(this._extractBuildCode(input));
            if (!loadedCls) { UI.showToast('❌ Неверный формат кода билда', true); return; }

            UI.showToast('📥 Билд успешно импортирован!');
            if (loadedCls !== clsId) {
                // Билд другого класса — открываем его вкладку (клик сам зовёт
                // renderTree). Ищем внутри модалки планировщика: .modal-tab
                // используется и другими окнами аддона (аукцион, симулятор).
                const root = document.getElementById('buildsim-modal-body') || document;
                const tab = root.querySelector(`.modal-tab[data-tab="${loadedCls}"]`);
                if (tab) tab.click();
                else this.renderTree(loadedCls);
            } else {
                this.renderTree(clsId);
            }
        },

        yFor(req) {
            if (Y_MAP[req] !== undefined) return Y_MAP[req];
            // Произвольный req: линейно между нижним (0) и верхним (30) ярусом.
            return BH - BOT - Math.round(((req || 0) / 30) * 4 * TH);
        },

        // Русская форма слова «очко» для плашки гейта яруса (патч 11.6.2a):
        // 1 очко / 2 очка / 5 очков / 11 очков / 21 очко.
        _pointsWord(n) {
            const abs = Math.abs(n || 0);
            const tail100 = abs % 100;
            const tail10 = abs % 10;
            if (tail100 >= 11 && tail100 <= 14) return 'очков';
            if (tail10 === 1) return 'очко';
            if (tail10 >= 2 && tail10 <= 4) return 'очка';
            return 'очков';
        },

        changeSkill(clsId, nodeId, delta, maxRank, preNode, branchReq, branchIds, event) {
            if (event) event.stopPropagation();
            if (!this.simulatedSkills[clsId]) this.simulatedSkills[clsId] = {};
            const simTree = this.simulatedSkills[clsId];
            const current = simTree[nodeId] || 0;
            if (delta > 0) {
                // v11.6.5b.2: блокировка чужих деревьев в shared снята —
                // планировщик симулирует план на любой класс.
                // v11.6.5b.3: ни availablePoints, ни ownerClass здесь не
                // участвуют — лимит строго maxPts() (50) для любого класса.
                if (current >= maxRank) return;
                if (preNode && !(simTree[preNode] > 0)) return;
                if (branchIds && branchReq > 0) {
                    let branchPts = 0;
                    Object.entries(simTree).forEach(([id, v]) => {
                        if (branchIds.has(id)) branchPts += v;
                    });
                    if (branchPts < branchReq) return;
                }
                let spent = 0; Object.values(simTree).forEach(v => spent += v);
                // Считаем только очки ТЕКУЩЕГО ПЛАНА (simTree), а не вложения игры.
                if (spent >= this.maxPts()) return;
            }
            if (delta < 0) {
                // Полная симуляция снятия: строим дерево «как будто очко уже снято»
                // и проверяем, что всё оставшееся валидно по ДВУМ правилам игры:
                //   1) прямой prerequisite (node.pre) должен остаться изученным;
                //   2) в ветке должно остаться не меньше очков, чем требует тир (node.req).
                const clsData = (this.skillsCache && Array.isArray(this.skillsCache.classes))
                    ? this.skillsCache.classes.find(c => c.id === clsId)
                    : null;
                const branches = (clsData && Array.isArray(clsData.branches)) ? clsData.branches : [];

                if (branches.length) {
                    const allNodes = branches.flatMap(b => (b && b.nodes) || []);

                    // Копия дерева, а не мутация: откатывать simTree при отказе не нужно.
                    const testTree = { ...simTree };
                    testTree[nodeId] = Math.max(0, current + delta);
                    if (testTree[nodeId] === 0) delete testTree[nodeId];

                    let invalid = false;
                    for (const [id, rank] of Object.entries(testTree)) {
                        if (rank <= 0) continue;
                        const node = allNodes.find(n => n.id === id);
                        if (!node) continue;

                        // 1. Прямая зависимость.
                        if (node.pre && !(testTree[node.pre] > 0)) {
                            invalid = true;
                            break;
                        }

                        // 2. Требование по очкам в ветке. Считаем сумму по ветке
                        //    именно в симулированном дереве: снятие могло опустить
                        //    очки ветки ниже req у оставшихся узлов.
                        if (node.req > 0) {
                            const branch = branches.find(b => b && b.nodes && b.nodes.some(n => n.id === id));
                            if (branch) {
                                const bIds = new Set((branch.nodes || []).map(n => n.id));
                                let bp = 0;
                                Object.entries(testTree).forEach(([cid, cv]) => {
                                    if (bIds.has(cid)) bp += cv;
                                });
                                if (bp < node.req) {
                                    invalid = true;
                                    break;
                                }
                            }
                        }
                    }

                    if (invalid) {
                        UI.showToast('Сначала снимите зависимые навыки', true);
                        return;
                    }
                }
            }
            simTree[nodeId] = Math.max(0, current + delta);
            if (simTree[nodeId] === 0) delete simTree[nodeId];
            // renderTree() пересоздаёт узлы и прячет тултип, поэтому запоминаем его
            // состояние до перерисовки и восстанавливаем после (ТЗ 11.6.1d).
            const tipState = this._tooltipState ? { ...this._tooltipState } : null;
            this.renderTree(clsId);
            if (tipState && tipState.clsId === clsId && tipState.nodeId === nodeId) {
                this.showNodeTooltip(clsId, nodeId, tipState.mode === 'click');
            }
        },

        renderTree(clsId) {
            const clsData = this.skillsCache.classes.find(c => c.id === clsId);
            if (!clsData) return;
            // v11.6.3: перед рендером дерева убеждаемся, что нативный LGSkills
            // не остался в ленивом состоянии. Прогрев идемпотентен и нашу
            // отрисовку не блокирует (данные уже есть из /api/skills).
            this.warmNativeSkills();
            const container = document.getElementById(`tree-${clsId}`);
            if (!container) return;
            // Число колонок-веток как в нативном дереве (--nb), обычно 3.
            container.style.setProperty('--nb', String((clsData.branches || []).length || 3));

            if (!this.simulatedSkills[clsId]) this.simulatedSkills[clsId] = {};
            const simTree = this.simulatedSkills[clsId];
            let spent = 0; Object.values(simTree).forEach(v => spent += v);
            const freeEl = document.getElementById(`free-${clsId}`);
            // v11.6.5b.3: «Свободно: X / 50» = 50 минус сумма ВСЕХ очков
            // текущего плана. Вложения игры (hero.sk.t) и ownerClass в расчёт
            // не входят — полоска одинаково считается для любого класса.
            if (freeEl) freeEl.textContent = this.maxPts() - spent;

            let html = '';
            const simStats = {};

            clsData.branches.forEach(branch => {
                const nodes = branch.nodes || [];
                let branchPoints = 0;
                nodes.forEach(n => { branchPoints += (simTree[n.id] || 0); });

                // Раскладка ярусов: узлы одного req стоят на одной горизонтали (XS из игры).
                const tiers = new Map();
                nodes.forEach(n => {
                    if (!tiers.has(n.req)) tiers.set(n.req, []);
                    tiers.get(n.req).push(n);
                });
                const xMap = new Map();
                tiers.forEach(list => list.forEach((n, i) => xMap.set(n.id, this.xFor(list.length, i))));

                const topY = this.yFor(30);      // верхний ярус (req 30)
                const rootY = this.yFor(0) + 40; // ствол начинается под нижним узлом
                // Открытый ярус: максимальный req, набранный в ветке (req 0 открыт всегда).
                const openReq = [30, 20, 10, 5, 0].reduce((acc, req) => (req > acc && branchPoints >= req ? req : acc), 0);

                // Ствол: тёмная основа, пройденная часть цветом ветки, закрытая — пунктиром.
                let lines = `<path class="tk-bg" d="M50 ${rootY} V${topY}"/>`
                    + `<path class="tk-on" d="M50 ${rootY} V${this.yFor(openReq)}"/>`
                    + (openReq < 30 ? `<path class="tk-off" d="M50 ${this.yFor(openReq)} V${topY}"/>` : '');

                // Замочки ярусов (патч 11.6.2a, отступ пересчитан в 11.6.2a.1) —
                // аналог .skg нативного дерева. Плашка висит на стволе между ярусами,
                // показываем её только для ЗАКРЫТЫХ ярусов и пишем ОСТАТОК.
                // Геометрия при TH = 135 и кружке 54px (48 + 2×3):
                //   низ верхнего узла  ≈ y + 73  (кружок 54 + ранги 11 + подпись 2×14)
                //   верх кружка ниже   = y + TH − 27 = y + 108
                // центр свободной полосы ≈ y + 91…92 = y + (48 + TH) / 2 — та же
                // нативная формула, при TH = 135 она даёт 92px.
                // Плашка ~21px высотой целиком ложится в полосу 81…103 и не наезжает
                // ни на подпись навыка, ни на кружок следующего яруса.
                let gates = '';
                [...tiers.keys()].filter(req => req > 0).sort((a, b) => b - a).forEach(req => {
                    if (branchPoints >= req) return; // ярус уже открыт — замок не нужен
                    const gy = this.yFor(req) + Math.round((48 + TH) / 2);
                    const need = req - branchPoints;
                    const tip = `Откроется при ${req} ${this._pointsWord(req)} в ветке «${Utils.escapeHtml(branch.name)}» (сейчас ${branchPoints})`;
                    gates += `<div class="sim-gate" data-req="${req}" style="top:${gy}px" title="${tip}">🔒 <span>${need} ${this._pointsWord(need)}</span></div>`;
                });

                // Отводы к боковым узлам — кривые Безье; prereq — прямые линии.
                nodes.forEach(node => {
                    const rank = simTree[node.id] || 0;
                    const x = xMap.get(node.id);
                    const y = this.yFor(node.req);
                    const shut = branchPoints < node.req || (node.pre && !(simTree[node.pre] > 0));

                    if (x !== 50) {
                        const tw = rank > 0 ? 'tw on' : (shut ? 'tw' : 'tw op');
                        lines += `<path class="${tw}" d="M50 ${y + 40} Q50 ${y} ${x} ${y}"/>`;
                    }
                    if (node.pre) {
                        const parent = nodes.find(n => n.id === node.pre);
                        if (parent) {
                            const px = xMap.get(parent.id);
                            const cls = rank > 0 ? 'pre on' : ((simTree[parent.id] || 0) > 0 ? 'pre op' : 'pre');
                            lines += `<path class="${cls}" d="M${px} ${this.yFor(parent.req)} L${x} ${y}"/>`;
                        }
                    }
                });

                html += `<div class="sim-branch">
                    <div class="sim-branch-header">${this.getBranchSvg(branch)}<div class="sim-branch-title">${branch.name}</div><div class="sim-branch-pts" title="Очков в ветке">${branchPoints}</div></div>
                    <div class="sim-in" style="height:${BH}px">
                        <svg class="sim-lines" viewBox="0 0 100 ${BH}" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${gates}`;

                nodes.forEach(node => {
                    const rank = simTree[node.id] || 0;
                    const locked = branchPoints < node.req || (node.pre && !(simTree[node.pre] > 0));
                    const maxed = rank >= node.max;

                    if (rank > 0 && node.fx) {
                        for (const [k, v] of Object.entries(node.fx)) {
                            if (this.isSkipFx(k)) continue;
                            simStats[k] = (simStats[k] || 0) + (v * rank);
                        }
                    }

                    let ranksHtml = '';
                    for (let i = 0; i < node.max; i++) ranksHtml += `<i class="${i < rank ? 'filled' : ''}"></i>`;

                    // Состояния как в нативном дереве: lock / has / max / can (available).
                    const state = (locked ? ' locked' : '')
                        + (rank > 0 ? ' has' : '')
                        + (maxed ? ' maxed' : '')
                        + (!locked && !maxed ? ' available' : '');
                    const x = xMap.get(node.id);
                    const y = this.yFor(node.req);

                    html += `<div class="sim-node${state}"
                        data-cls="${clsId}" data-node="${node.id}"
                        style="left:${x}%;top:${y}px">
                        <div class="sim-node-icon">${this.getNodeSvg(node, branch)}</div>
                        <div class="sim-node-ranks">${ranksHtml}</div>
                        <div class="sim-node-name">${node.name}</div>
                    </div>`;
                });
                html += `</div></div>`;
            });

            container.innerHTML = html;

            container.querySelectorAll('.sim-node').forEach(el => {
                const nodeCls = el.dataset.cls;
                const nodeId = el.dataset.node;

                // Наведение: через 500 мс показываем тултип ТОЛЬКО с текстом.
                el.addEventListener('mouseenter', () => {
                    this._clearTooltipTimer();
                    this._tooltipTimer = setTimeout(() => {
                        this._tooltipTimer = null;
                        this.showNodeTooltip(nodeCls, nodeId, false);
                    }, 500);
                });

                // Мышь ушла раньше таймера — отменяем; висящий hover-тултип прячем.
                el.addEventListener('mouseleave', () => {
                    this._clearTooltipTimer();
                    if (this._tooltipState && this._tooltipState.mode === 'hover') this.hideTooltip();
                });

                // Клик: тултип с кнопками +/−; повторный клик по тому же узлу закрывает.
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const st = this._tooltipState;
                    if (st && st.mode === 'click' && st.clsId === nodeCls && st.nodeId === nodeId) {
                        this.hideTooltip();
                        return;
                    }
                    this._clearTooltipTimer();
                    this.showNodeTooltip(nodeCls, nodeId, true);
                });
            });

            let statsHtml = '';
            if (!Object.keys(simStats).length) {
                statsHtml = `<div style="color:#888;font-style:italic;">Навыки не изучены</div>`;
            } else {
                for (const [k, v] of Object.entries(simStats)) {
                    if (v > 0) {
                        const isPct = !['critDmg', 'skelN', 'skelT', 'def'].includes(k);
                        statsHtml += `<div class="stat-line"><span>${this.fxNames[k] || k}</span><b>+${v.toFixed(1)}${isPct ? '%' : ''}</b></div>`;
                    }
                }
            }
            const statsEl = document.getElementById(`stats-${clsId}`);
            if (statsEl) statsEl.innerHTML = statsHtml;

            // --- Сохранённые билды: список + обработчики ---
            // Верхняя панель (.sim-top-bar) живёт вне #tree-${clsId}, поэтому
            // перерисовка дерева её не убивает — можно просто переназначать
            // .onclick (idempotent) вместо addEventListener в каждом рендере.
            const sel = document.getElementById(`load-select-${clsId}`);
            const delBtn = document.querySelector(`.sim-del-btn[data-del="${clsId}"]`);
            const saveBtn = document.querySelector(`.sim-save-btn[data-save="${clsId}"]`);

            if (sel && saveBtn && delBtn) {
                const builds = this.savedBuilds[clsId] || [];
                // Имя билда вводит пользователь → экранируем перед вставкой в innerHTML.
                sel.innerHTML = `<option value="">— Мои билды (${builds.length}) —</option>` +
                    builds.map((b, i) => `<option value="${i}">${Utils.escapeHtml(b.name)}</option>`).join('');

                // Преселект активного билда: видно, что именно удалит «🗑️».
                const currentName = this._currentBuildNames ? (this._currentBuildNames[clsId] || '') : '';
                const currentIdx = currentName ? builds.findIndex(b => b.name === currentName) : -1;
                if (currentIdx >= 0) sel.value = String(currentIdx);
                delBtn.title = currentIdx >= 0
                    ? `Удалить билд «${currentName}»`
                    : 'Удалить выбранный билд';

                // Патч 11.6.2a: вместо window.prompt() — инлайн-поле имени прямо
                // в верхней панели (см. BuildSim.showSaveInline выше).
                saveBtn.onclick = () => this.showSaveInline(clsId);

                sel.onchange = () => {
                    // Плейсхолдер «— Мои билды —» = пустое дерево (ТЗ 11.6.1d, п. 2.2):
                    // раньше выбор дефолтного пункта ничего не делал и билд оставался.
                    if (sel.value === '') {
                        this.resetBuild(clsId);
                        return;
                    }
                    // Выбор в списке сразу загружает билд и делает его активным;
                    // sel.value после renderTree выставит преселект выше.
                    this.loadBuild(clsId, +sel.value);
                };

                delBtn.onclick = () => {
                    // Целимся в активный билд (this._currentBuildNames), а не в sel.value:
                    // после перерисовки select сбрасывается на «— Мои билды —»,
                    // из-за чего индекс из sel.value терялся.
                    const targetName = this._currentBuildNames ? (this._currentBuildNames[clsId] || '') : '';
                    if (!targetName) { UI.showToast('Сначала загрузите или выберите билд', true); return; }
                    if (window.confirm(`Удалить билд «${targetName}»?`)) {
                        this.deleteCurrentBuild(clsId);
                    }
                };
            }

            // --- Обмен билдами: «📤 Поделиться» / «📥 Импорт» ---
            // Кнопки статичны в .sim-top-bar (вне #tree-…), поэтому .onclick
            // переназначаем идемпотентно — как у кнопок сохранения выше.
            const shareBtn = document.querySelector(`.sim-share-btn[data-share="${clsId}"]`);
            if (shareBtn) shareBtn.onclick = () => this.shareBuild(clsId);

            const importBtn = document.querySelector(`.sim-import-btn[data-import="${clsId}"]`);
            if (importBtn) importBtn.onclick = () => this.importBuild(clsId);

            // v11.6.5b.1: «⟲ От вложенного» — план от текущих очков героя.
            const keepBtn = document.querySelector(`.sim-keep-btn[data-keep="${clsId}"]`);
            if (keepBtn) keepBtn.onclick = () => this.keepNativeBuild(clsId);

            // Перерисовка пересоздала узлы — старый тултип невалиден (позиция
            // устарела). changeSkill() при необходимости покажет его заново.
            this.hideTooltip();
        },

        // ------------------------------------------------------------
        // Тултип узла навыка (ТЗ 11.6.1d).
        // Один общий DOM-элемент .sim-tooltip на окно планировщика:
        //   • наведение 500 мс → только текст (без кнопок);
        //   • клик по узлу      → текст + кнопки «− Убрать» / «+ Вложить»;
        //   • повторный клик по тому же узлу / клик вне дерева → закрыть.
        // Элемент — прямой ребёнок .custom-modal (НЕ внутри .sim-tree-wrap),
        // поэтому overflow дерева его не обрезает. position: absolute, а не fixed:
        // модалка таскается и теряет transform, absolute же всегда считается
        // от её padding-box (модалка position: fixed), т.е. координаты стабильны.
        // ------------------------------------------------------------
        _clearTooltipTimer() {
            if (this._tooltipTimer) {
                clearTimeout(this._tooltipTimer);
                this._tooltipTimer = null;
            }
        },

        _getTooltip() {
            const body = document.getElementById('buildsim-modal-body');
            const host = (body && body.closest('.custom-modal')) || document.body;
            let tip = host.querySelector('.sim-tooltip');
            // Элемент должен быть один: остатки от прошлых модалок удаляем.
            document.querySelectorAll('.sim-tooltip').forEach(t => { if (t !== tip) t.remove(); });
            if (!tip) {
                tip = document.createElement('div');
                tip.className = 'sim-tooltip';
                host.appendChild(tip);
            }
            return tip;
        },

        hideTooltip() {
            this._clearTooltipTimer();
            this._tooltipState = null;
            document.querySelectorAll('.sim-tooltip').forEach(tip => {
                tip.classList.remove('on');
                tip.innerHTML = '';
            });
            document.querySelectorAll('.sim-node.sim-node-active').forEach(n => n.classList.remove('sim-node-active'));
        },

        // Ставим тултип рядом с узлом: справа, если влезает, иначе слева;
        // по вертикали — от верхней кромки узла, с прижатием к краям экрана.
        _positionTooltip(tip, nodeEl) {
            const host = tip.parentElement || document.body;
            const nRect = nodeEl.getBoundingClientRect();
            const vw = window.innerWidth || 1280;
            const vh = window.innerHeight || 720;
            const gap = 12, edge = 8;
            const w = tip.offsetWidth || 280;
            const h = tip.offsetHeight || 160;

            let x = nRect.right + gap;
            if (x + w > vw - edge) x = nRect.left - w - gap; // справа не влезает — слева
            x = Math.max(edge, Math.min(x, vw - w - edge));

            let y = nRect.top - 10;
            y = Math.max(edge, Math.min(y, vh - h - edge));

            // Пересчёт из системы окна в систему родителя.
            // v11.6.2a.3: в реальном UI планировщик живёт в #hp-buildsim-container
            // (HeroPlanner), #buildsim-modal-body отсутствует — тултип крепится
            // к document.body (см. _getTooltip), поэтому base = 0 и прокрутка
            // дерева его координаты не смещает.
            // Компенсация scrollLeft/scrollTop остаётся страховкой на случай,
            // если host окажется скроллящимся контейнером.
            const hRect = host.getBoundingClientRect();
            const inBody = host === document.body;
            const baseX = inBody ? 0 : hRect.left + host.clientLeft - (host.scrollLeft || 0);
            const baseY = inBody ? 0 : hRect.top + host.clientTop - (host.scrollTop || 0);

            tip.style.left = Math.round(x - baseX) + 'px';
            tip.style.top = Math.round(y - baseY) + 'px';
        },

        showNodeTooltip(clsId, nodeId, withControls) {
            const classes = (this.skillsCache && Array.isArray(this.skillsCache.classes)) ? this.skillsCache.classes : [];
            const clsData = classes.find(c => c.id === clsId);
            if (!clsData) return;
            const branch = (clsData.branches || []).find(b => (b.nodes || []).some(n => n.id === nodeId));
            if (!branch) return;
            const node = branch.nodes.find(n => n.id === nodeId);
            if (!node) return;

            // renderTree() пересоздаёт узлы — позиционируемся от актуального элемента.
            const treeEl = document.getElementById(`tree-${clsId}`);
            const nodeEl = treeEl ? Array.from(treeEl.querySelectorAll('.sim-node'))
                .find(el => el.dataset.node === nodeId) : null;
            if (!nodeEl) return; // вкладка закрыта — привязываться не к чему

            if (!this.simulatedSkills[clsId]) this.simulatedSkills[clsId] = {};
            const simTree = this.simulatedSkills[clsId];
            const rank = simTree[nodeId] || 0;

            const branchIds = new Set((branch.nodes || []).map(n => n.id));
            let branchPoints = 0;
            branch.nodes.forEach(n => branchPoints += (simTree[n.id] || 0));
            const locked = branchPoints < node.req || (node.pre && !(simTree[node.pre] > 0));
            const maxed = rank >= node.max;

            let reqText = '';
            if (branchPoints < node.req) reqText = `Требуется очков в ветке: ${node.req}`;
            if (node.pre && !(simTree[node.pre] > 0)) reqText = `Сначала изучите предыдущий навык.`;

            const tip = this._getTooltip();
            tip.dataset.cls = clsId;
            tip.dataset.node = nodeId;
            tip.classList.add('on');
            tip.innerHTML = `
                ${withControls ? '<div class="sim-tooltip-close" title="Закрыть">✖</div>' : ''}
                <h4>${Utils.escapeHtml(node.name)} <span>${rank}/${node.max}</span></h4>
                <div class="desc">${this.formatNodeText(node, rank)}</div>
                ${reqText ? `<div class="req">${reqText}</div>` : ''}
                ${withControls ? `<div class="controls">
                    <button type="button" data-action="minus" ${rank === 0 ? 'disabled' : ''}>− Убрать</button>
                    <button type="button" data-action="plus" ${maxed || locked ? 'disabled' : ''}>+ Вложить</button>
                </div>` : ''}`;

            // Позиция — после вставки контента: нужны реальные offsetWidth/Height.
            this._positionTooltip(tip, nodeEl);

            document.querySelectorAll('.sim-node.sim-node-active').forEach(n => n.classList.remove('sim-node-active'));
            nodeEl.classList.add('sim-node-active');

            const closeBtn = tip.querySelector('.sim-tooltip-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.hideTooltip();
                });
            }

            // stopPropagation обязателен: иначе клик по кнопке всплывёт до document
            // и тултип закроется раньше, чем отработает changeSkill().
            tip.querySelectorAll('button[data-action]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const delta = btn.dataset.action === 'plus' ? 1 : -1;
                    this.changeSkill(clsId, node.id, delta, node.max, node.pre || null, node.req || 0, branchIds, e);
                });
            });

            this._tooltipState = { clsId, nodeId, mode: withControls ? 'click' : 'hover' };
        },

        // Алиас для старых вызовов: карточка .sim-card заменена общим тултипом
        // (ТЗ 11.6.1d). Поведение как у клика по узлу — с кнопками +/−.
        showNodeCard(clsId, nodeId, event) {
            if (event) { event.stopPropagation(); event.preventDefault(); }
            this._clearTooltipTimer();
            this.showNodeTooltip(clsId, nodeId, true);
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
            const login = me?.user?.login || hero?.login
                || (typeof Chat !== 'undefined' ? Chat.myNick : '') || '';
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
            this.refreshUnreadDMViews();
        },

        addUnreadDM(nick) {
            if (!nick) return 0;
            const key = String(nick).trim().toLowerCase();
            this.unreadDMs[key] = (this.unreadDMs[key] || 0) + 1;
            this.refreshUnreadDMViews();
            return this.unreadDMs[key];
        },

        clearUnreadDM(nick) {
            if (!nick) return;
            const key = String(nick).trim().toLowerCase();
            if (!(key in this.unreadDMs)) return;
            delete this.unreadDMs[key];
            this.refreshUnreadDMViews();
        },

        refreshUnreadDMViews() {
            // Перерисовываем вкладку «✉️ ЛС», если она активна.
            // (Список «Друзья» удалён в 11.5.4: в игре появились нативные друзья.)
            try {
                if (typeof Chat !== 'undefined' && Chat.activeTab === 'dm' && typeof Chat.renderMessages === 'function') {
                    Chat.renderMessages();
                }
            } catch (e) {}
        },

        init() {
            (document.getElementById(DOM_IDS.btnPlayers) || document.getElementById('btn-players'))?.addEventListener('click', () => this.open());
        },

        getMyNick() {
            // ME живёт в page-context: в песочнице Tampermonkey (@grant) обычный
            // window его не видит, поэтому читаем через G (= unsafeWindow).
            return (G.ME && (G.ME.user?.name || G.ME.hero?.n || G.ME.hero?.name)) ||
                   (typeof Chat !== 'undefined' && Chat.myNick) ||
                   '';
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
            if (typeof Chat !== 'undefined' && Array.isArray(Chat.messages)) {
                Chat.messages.slice(-50).forEach(m => {
                    if (m && m.author && !m.isSystem) this.addPlayer(m.author, '💬 Чат');
                });
            }

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
                // Счётчик непрочитанных + кликабельный тост
                this.addUnreadDM(peerNick);
                UI.showToast(
                    `✉️ ЛС от ${peerNick}: ${text.length > 25 ? text.slice(0, 25) + '...' : text}`,
                    false,
                    () => {
                        if (typeof Chat !== 'undefined' && typeof Chat.openDM === 'function') {
                            Chat.openDM(peerNick);
                        }
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

        /**
         * Открыть ЛС с игроком (ПАТЧ 11.6.4f).
         *
         * Раньше здесь кликали по нативным узлам .cy-chat (data-dm + вкладка
         * «Личные»), но нативный чат теперь скрыт CSS-ом и живёт в DOM только
         * ради LGChatOne.place()/dock(). Идём через собственный Chat.openDM():
         * он открывает PiP и переключает вкладку «✉️ ЛС».
         *
         * text — необязательный черновик. openDM() асинхронный (может создать
         * PiP-окно), поэтому поле ввода ищем после его завершения.
         */
        async openWhisperWith(nick, text = '') {
            if (!nick) return;
            if (typeof Chat === 'undefined' || typeof Chat.openDM !== 'function') return;

            try {
                await Chat.openDM(nick);

                if (!text) return;
                const pipDoc = Chat._pipDoc;
                const inp = pipDoc && typeof pipDoc.getElementById === 'function'
                    ? pipDoc.getElementById('chat-input')
                    : null;
                if (inp) {
                    inp.value = text;
                    inp.focus();
                }
            } catch (e) {
                dbg('openWhisperWith failed:', e);
            }
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
    //
    // Прямой доступ к официальным зданиям игры из любой локации.
    // Вынесено из core/ui.js (v11.6.0, этап 3): UI остаётся фабрикой
    // модалок/HUD, а вся логика «нативных» зданий живёт здесь.
    // Разметку отдаёт UITemplates.pocketCityModal(), окно — UI.showModal().
    //
    // Подключается после core/ui.js (SHARED_MODULES в build.js): методы
    // зовут UI/UITemplates по вызову, на этапе загрузки зависимостей нет.
    //
    // v11.6.4c: перед открытием здания ждём не просто появления LGCity,
    // а реальной готовности города (состояние S и .cy-room) — иначе первый
    // клик терялся: LGCity.panel(id) до LGCity.open(el, CX) — молчаливый no-op.
    //
    // v11.6.4d: после закрытия здания возвращаем игрока туда, откуда он пришёл.
    // Шахта в игре — не вкладка, а оверлей `.mn` (body.mn-on) поверх «Города»,
    // поэтому её запоминаем отдельно, чат LGChatOne перевешиваем обратно в шахту,
    // а городской слой гасим через LGCity.sleep() (как это делает openMine).
    // ============================================================
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

        // Модалка со списком зданий: карточка -> нативное здание игры.
        open() {
            // Модалку берём из возврата showModal: её класс — с рандомным
            // префиксом (DOM_IDS.customModal), поэтому поиск
            // `.custom-modal:last-of-type` по документу ненадёжен.
            const modal = UI.showModal(UITemplates.pocketCityModal());
            if (!modal) return;

            // Обработчики вешаем только на кнопки этой модалки: раньше поиск
            // шёл по всему документу и мог зацепить чужие .pocket-grid-btn.
            modal.querySelectorAll('.pocket-grid-btn').forEach(btn => {
                btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-3px)'; btn.style.boxShadow = '0 6px 15px rgba(0,0,0,0.5)'; });
                btn.addEventListener('mouseleave', () => { btn.style.transform = 'none'; btn.style.boxShadow = 'none'; });
                btn.addEventListener('click', (e) => {
                    const room = e.currentTarget.getAttribute('data-room');
                    UI.closeModals();
                    if (room) PocketCity.openNativeBuilding(room);
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
                // LGCity.open() перевешивает общий чат в root города, из-за чего
                // после возврата в шахту он оставался под оверлеем. Dock('mine')
                // делает шахту последней сценой и возвращает блок на место.
                if (typeof Chat !== 'undefined' && typeof Chat.showForMine === 'function') {
                    try { Chat.showForMine(); } catch (e) { dbg('Чат шахты не вернулся:', e); }
                }
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
        async openNativeBuilding(roomId) {
            dbg(`Открытие нативного здания «${roomId}»...`);

            // Игровые объекты (LGCity / __lgQuestContext / cityFiles) живут
            // в page-context: после @grant window — песочница, поэтому берём
            // unsafeWindow (G), как это уже делается в chat.js.
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
        }
    };

    // ===== src/modules/combat-assistant.js =====
    // ============================================================
    // 6.6. МОДУЛЬ: БОЕВОЙ АССИСТЕНТ (modules/combat-assistant.js)
    //
    // Подсказки по механикам боссов в походе (патч 11.6.2b): раз в секунду
    // читает состояние похода штатным геттером игры LGQuest._view()
    // (структура — docs/API.md, раздел «Объект состояния похода»).
    // Вывод — поверх экрана: либо красный баннер «НЕ ПИШИ!», либо готовая
    // команда с кнопкой «Вставить в чат».
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

        init() {
            // Повторный init (перезапуск скрипта) не должен плодить таймеры.
            if (this._el) return;
            this._el = document.createElement('div');
            this._el.id = 'lg-combat-assistant';
            document.body.appendChild(this._el);
            this._timer = setInterval(() => this._tick(), 1000);
        },

        // Гасим интервал и DOM при перезапуске скрипта (см. shutdown в main.js),
        // иначе старый таймер продолжал бы тикать рядом с новым.
        destroy() {
            if (this._timer) clearInterval(this._timer);
            this._timer = null;
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
                // Ассистент нужен только полноправному участнику похода:
                // party = 'q' (очередь), 'ghost' (призрак), 'out' — не наш бой.
                if (!q || !q.on || q.party !== 'in') {
                    this._clear();
                    return;
                }

                this._render(this._evaluate(q));
            } catch (e) {
                console.warn('[LGU] CombatAssistant error:', e);
            }
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
            const warn = this._weaknessHint(q);
            if (!warn) return res;
            if (res && res.action === 'IDLE') return this._isDead(q) ? res : { action: 'NOTE', text: warn };
            if (!res) return { action: 'NOTE', text: warn };
            res.hint = res.hint ? `${warn} · ${res.hint}` : warn;
            return res;
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
                return { action: 'SILENCE', text: 'ГАЗ! НЕ ПИШИ!' };
            }

            // 3. Режим тишины босса. Логика 1:1 с sayHush() из site/quest.js:
            //    финт (mech.fake), семейство 'silence' (кроме M94/M55 — там
            //    молчать не нужно) и текстовая подсказка «не пиши / молчите».
            const M = q.bg && q.bg.mech;
            if (M) {
                if (M.fake === true) {
                    return { action: 'SILENCE', text: 'ФИНТ! НЕ ПИШИ!' };
                }
                const silentFam = M.fam === 'silence' && M.id !== 'M94' && M.id !== 'M55';
                const silentTip = /ничего не пиш|молчите|не пишите/i.test(M.tip || '');
                if (silentFam || silentTip) {
                    return { action: 'SILENCE', text: 'ТИШИНА! НЕ ПИШИ!' };
                }
            }

            // 3.1. Финт/тишина на телеграфе обычного боя (docs/API.md: tele.fake,
            //      tele.hush). Писать слово в этом случае запрещено.
            if (q.b && q.b.tele && (q.b.tele.fake === true || q.b.tele.hush === true)) {
                return { action: 'SILENCE', text: 'ФИНТ! НЕ ПИШИ!' };
            }

            // 4. Фонари Джека-Фонарщика: hw.lan.lit — 6 фонарей, false = погас.
            //    Команда зажигает один фонарь, поэтому берём первый погасший.
            if (q.bg && q.bg.hw && q.bg.hw.lan && Array.isArray(q.bg.hw.lan.lit)) {
                const offIdx = q.bg.hw.lan.lit.map((v, i) => (v ? 0 : i + 1)).filter(Boolean);
                if (offIdx.length > 0) {
                    return { action: 'COMMAND', text: `зажечь ${offIdx[0]}`, hint: 'Погас фонарь' };
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
                        return { action: 'COMMAND', text: `прыжок ${target}`, hint: 'Укус волка! Прыгай' };
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
                        return { action: 'COMMAND', text: `прыжок ${target}`, hint: 'Крыло закрыто! Смени позицию' };
                    }
                }
            }

            // 7. Осадные орудия и приспешники: adds = [[имя, count, hpRatio]].
            //    count = 0 — осадное орудие/ворота (бьётся без номера),
            //    count > 0 — приспешники («удар ИМЯ N»); hpRatio <= 0 — уже добит.
            if (q.bg && Array.isArray(q.bg.adds)) {
                const alive = q.bg.adds.filter(a => Array.isArray(a) && a[2] > 0);
                const siege = alive.find(a => !(+a[1] > 0));
                if (siege) return { action: 'COMMAND', text: `удар ${siege[0]}`, hint: 'Цель осады' };
                const mob = alive.find(a => +a[1] > 0);
                if (mob) return { action: 'COMMAND', text: `удар ${mob[0]} 1`, hint: 'Убей приспешника' };
            }

            // 8. Телеграф в обычном бою: слово парирования (b.tele.word).
            //    'tele2' в текущем клиенте не встречается, оставлен на всякий случай.
            if (q.b && (q.b.st === 'tele' || q.b.st === 'tele2') && q.b.tele && q.b.tele.word) {
                return { action: 'COMMAND', text: q.b.tele.word, hint: 'Ответ на телеграф' };
            }

            // 9. Напоминание о своём ходе (b.turn пуст — ход в раунде не сделан).
            if (q.b && q.b.st === 'party' && !q.b.turn) {
                return { action: 'COMMAND', text: 'удар', hint: 'Твой ход' };
            }

            return { action: 'IDLE' };
        },

        _clear() {
            if (this._el && this._el.innerHTML) this._el.innerHTML = '';
            // Сбрасываем подпись: иначе после паузы та же команда не отрисуется.
            this._currentState = null;
        },

        /**
         * Вставка подсказки в поле команды похода.
         *
         * v11.6.2b.1: сама логика (нативный сеттер value + input/change,
         * обход запрета вставки в quest.js) вынесена в общий хелпер
         * core/utils-chat.js — он же нужен кнопке «❤» в модуле пати.
         */
        _insert(text) {
            if (typeof Utils === 'undefined' || typeof Utils.insertToQuestChat !== 'function') return;
            const inserted = Utils.insertToQuestChat(text);
            // Если поля нет — хелпер уже показал тост про копирование в буфер.
            if (inserted && typeof UI !== 'undefined' && UI.showToast) {
                UI.showToast(`Вставлено: ${text} — Enter, чтобы отправить`);
            }
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
                // Не перерисовывать, если состояние не изменилось.
                const sign = `${res.hint || ''}|${res.text}`;
                if (this._currentState === sign) return;
                this._currentState = sign;

                this._el.innerHTML = `
                    <div class="lg-combat-suggest">
                        <div>
                            <div style="font-size:12px; opacity:0.8;">${esc(res.hint || '')}</div>
                            <div style="color:#ffcf6a;">${esc(res.text)}</div>
                        </div>
                        <button class="lg-combat-btn" id="lg-combat-insert">Вставить в чат</button>
                    </div>
                `;

                const btn = this._el.querySelector('#lg-combat-insert');
                if (btn) btn.onclick = () => this._insert(res.text);
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
    // Utils.insertToQuestChat() (core/utils-chat.js), отправляет игрок по Enter.
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
        // v11.6.0d: логины, по которым прямо сейчас идёт POST /api/qact.
        // v11.6.2b.1: хил переведён на вставку текста («лечить @ник»), набор
        // больше не заполняется, а _renderPanel по-прежнему читает его в
        // busy-проверке кнопки «❤» (всегда false).
        // TODO: REMOVE — удалить поле и busy-ветку в _renderPanel вместе.
        _healBusy: new Set(),
        _logOpen: true,      // панель развёрнута (свёрнутая не опрашивает сервер)
        _logBusy: false,     // GET/POST журнала уже в полёте
        _logSince: 0,        // nextSince с сервера (id последней известной строки)
        _logReady: false,    // первичная загрузка (limit=100) выполнена
        _logBodyEl: null,    // .party-log-body — кэш, чтобы не искать каждый тик

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
         * @param {Array<{login: string, hp: number, maxHp: number}>} states
         */
        _renderPanel(states) {
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
                const busy = this._healBusy.has(nick.toLowerCase());
                const showHeal = isPriest
                    && inQuest
                    && nick.toLowerCase() !== selfLogin
                    && rawMax > 0
                    && rawHp < rawMax;
                const healBtn = showHeal
                    ? `<button type="button" class="${this.HEAL_BTN_CLASS}" data-party-heal="${login}"`
                        + ` title="Вставить команду лечения в чат"${busy ? ' disabled' : ''}>${busy ? '...' : '❤'}</button>`
                    : '';

                return `<div style="margin-bottom:6px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <span style="color:#ffcf6a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${login}:</span>
                        <span style="display:flex; align-items:center; gap:4px; white-space:nowrap;">
                            <span style="color:#ccc;">${hp}/${rawMax}</span>
                            ${healBtn}
                        </span>
                    </div>
                    <div style="height:3px; margin-top:2px; border-radius:2px; background:#2a2030;">
                        <div style="height:3px; width:${pct.toFixed(1)}%; border-radius:2px; background:${color};"></div>
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

            // Журнал — сосед по HUD-контейнеру; его видимость и догрузку
            // синхронизируем на каждом тике.
            this._syncLogPanel();
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

        /**
         * Запускает синхронизацию HP: отправляем свой hp/maxHp и перерисовываем
         * общую панель из GET /party/:id/state.
         *
         * v11.6.3c: тик запускается по событию (ответ игры на /api/me, /api/qact)
         * через PerformanceObserver; интервал HP_SYNC_MS (30 с) — только фолбэк.
         * Повторный вызов безопасен: второй интервал и observer не создаются.
         * Вызывается из _writeState() (создали/вошли) и init() (перезагрузка).
         */
        startHpSync() {
            if (!this._readState()) {
                // Не в пати — панель не нужна.
                this.stopHpSync();
                return;
            }
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
            if (typeof PerformanceObserver !== 'function') {
                console.warn('[LGU] PerformanceObserver не поддерживается — HP обновляется по таймеру');
                return;
            }

            this._perfObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    // includes, а не ===: name — полный URL вида
                    // https://play.multidonate.ru/c/<канал>/api/me?...
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
            this._hidePanel();
            // leave/401: журнал прошлой пати очищается и прячется.
            this._hideLogPanel();
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
            if (this._perfObserver) {
                this._perfObserver.disconnect();
                this._perfObserver = null;
            }
            this.stopHpSync();
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
         * Запускается событием PerformanceObserver (ответ игры на /api/me или
         * /api/qact) и фолбэк-интервалом HP_SYNC_MS; не чаще HP_TICK_MIN_MS.
         *
         * Ошибки сети и валидации намеренно «тихие» (console.warn): панель
         * обновляется часто, тосты на каждую ошибку были бы невыносимы.
         * Исключение — 401: он означает кик/удалённую пати, здесь нужен и
         * тост, и полный локальный сброс (его делает _request()).
         */
        async _hpTick() {
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
                // 1. Свой HP из игры. Если /api/me недоступен — просто не
                //    отправляем стейт, панель строится по данным сервера.
                const me = await this._fetchMe();

                // 1a. Детектор журнала — только по «живому» снимку /api/me.
                //     Фолбэк (live:false) не должен выглядеть как quest_end/death.
                if (me.live) {
                    const events = this._detectLogEvents(this._prevMe, me);
                    for (const ev of events) {
                        // Последовательно: id в БД должны идти в порядке событий.
                        if (!(await this._postLogEvent(ev.type, ev.text))) break;
                    }
                    // _prevMe обновляем даже при ошибке сети: иначе одно и то же
                    // событие отправлялось бы каждый тик.
                    this._prevMe = { hp: me.hp, quest: me.quest, ghost: me.ghost, role: me.role };
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
         * «Лечение» союзника: вставляем команду похода в поле чата.
         *
         * v11.6.2b.1: прямой POST /c/<канал>/api/qact {k:'b',a:'sk',w:'лечение'}
         * убран. Игра сама разбирает текстовую команду «лечить @ник» (qsay),
         * а ручной запрос дублировал действие (кулдаун / двойной хил) и мог
         * разойтись с состоянием стрима. Теперь кнопка «❤» только подставляет
         * текст — отправляет игрок по Enter, как любую команду похода.
         *
         * @param {string} targetLogin ник цели из data-party-heal
         * @param {HTMLButtonElement|null} button кнопка (возвращается в исходный вид)
         */
        _healMember(targetLogin, button) {
            const target = String(targetLogin || '').trim();
            if (!target) return;

            const healCommand = `лечить @${target}`;
            // Поля может не быть (не в походе / чат похода скрыт): тогда хелпер
            // сам скопирует команду в буфер и покажет тост.
            const inserted = Utils.insertToQuestChat(healCommand);
            if (inserted) {
                UI.showToast(`Текст «${healCommand}» вставлен в чат. Нажмите Enter.`, false);
            }

            // Кнопку возвращаем в исходный вид: busy-рендер («...») остался
            // только от версий с запросом, панель перерисовывается по событиям.
            if (button && button.isConnected) {
                button.disabled = false;
                button.textContent = '❤';
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

    // ===== src/modules/miner.js (удалён в 11.6.4b: античит, используется заглушка) =====
    const Miner = {
        abortController: null,
        init() {
            document.getElementById(DOM_IDS.btnAutoMine)?.remove();
        },
        stopMining() {}
    };

    // ===== src/modules/chat/chat-emotes.js =====
    // ============================================================
    // 7.1 МОДУЛЬ: ЧАТ — 7TV эмоуты
    // ============================================================
    // Вынесено из modules/chat.js (v11.6.0, этап 2 декомпозиции).
    // Слой-миксин: ChatEmotes.SevenTV пробрасывается в Chat.SevenTV,
    // а load()/loadSize() вызываются из Chat.init().

    // 7TV: глобальные смайлики в чате
    //
    // Сайт отдаёт CSP `connect-src 'self'` и `img-src 'self' data: blob:`,
    // поэтому:
    //   • JSON эмоутов тянем через GM_xmlhttpRequest (обходит CSP);
    //   • картинки грузим блобом и подставляем blob:-URL (разрешён img-src).
    // UI стороннего аддона не копируем — только рендер смайликов.
    // ============================================================
    const SevenTV = {
        API_URL: 'https://7tv.io/v3/emote-sets/global',
        IVR_URL: 'https://api.ivr.fi/v2/twitch/user?login=',
        CHANNEL_API_URL: 'https://7tv.io/v3/users/twitch/',
        DEFAULT_CHANNEL: 'zakvielchannel',
        CHANNEL_KEY: 'LEGION_7TV_CHANNEL',
        // 11.6.4e: 'true' — смайлы 7TV не отображаются и не загружаются
        // (тумблер «🎭 Отображать смайлы 7TV» в UI.openSettings()).
        DISABLE_KEY: 'LEGION_7TV_DISABLED',
        channel: 'zakvielchannel',   // текущий канал (переопределяется из localStorage)
        _reloadQueued: false,
        _cacheEpoch: 0,

        // Размеры смайлов: применяются через CSS-переменную --t7-h.
        SIZES: {
            s: { h: '1.3em', label: 'S' },
            m: { h: '1.9em', label: 'M' },
            l: { h: '2.6em', label: 'L' },
            x: { h: '3.4em', label: 'XL' }
        },
        size: 'm',
        SIZE_KEY: 'LEGION_7TV_SIZE',

        applySize() {
            const conf = this.SIZES[this.size] || this.SIZES.m;
            const docs = [document];
            // Виджет может быть вынесен в PiP-окно — переменную нужно задать и там.
            try {
                if (typeof Chat !== 'undefined' && Chat._popoutWin && Chat._popoutWin.document) {
                    docs.push(Chat._popoutWin.document);
                }
            } catch (e) {}
            docs.forEach(doc => {
                try {
                    if (doc && doc.documentElement) {
                        doc.documentElement.style.setProperty('--t7-h', conf.h);
                    }
                } catch (e) {}
            });
        },

        loadSize() {
            try {
                const saved = localStorage.getItem(this.SIZE_KEY);
                if (saved && this.SIZES[saved]) this.size = saved;
            } catch (e) {}
            this.applySize();
        },

        /**
         * 11.6.4e: выключен ли рендер 7TV-смайлов.
         *
         * Ключ читается на каждом рендере/загрузке, а не кэшируется в поле:
         * тумблер должен действовать сразу, без перезагрузки страницы.
         */
        isDisabled() {
            try {
                return localStorage.getItem(this.DISABLE_KEY) === 'true';
            } catch (e) {
                // localStorage недоступен (приватный режим) — считаем, что включено.
                return false;
            }
        },
        // 1×1 прозрачный GIF: заглушка до подгрузки блоба (data: разрешён CSP).
        PLACEHOLDER: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        emotes: new Map(),      // name -> { url }
        blobUrls: new Map(),    // name -> blob: URL
        pending: new Map(),     // name -> Promise<string|null>
        loaded: false,
        loading: false,

        requestJson(url) {
            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest === 'function') {
                    GM_xmlhttpRequest({
                        method: 'GET', url, timeout: 15000,
                        onload: (r) => {
                            if (r.status < 200 || r.status >= 300) return reject(new Error('HTTP ' + r.status));
                            try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); }
                        },
                        onerror: () => reject(new Error('network error')),
                        ontimeout: () => reject(new Error('timeout'))
                    });
                    return;
                }
                // Без @grant запрос, скорее всего, заблокирует CSP сайта;
                // оставляем fetch как совместимый фолбэк для других менеджеров.
                fetch(url).then(r => r.json()).then(resolve, reject);
            });
        },

        requestBlob(url) {
            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest === 'function') {
                    GM_xmlhttpRequest({
                        method: 'GET', url, responseType: 'blob', timeout: 15000,
                        onload: (r) => {
                            if (r.status < 200 || r.status >= 300 || !r.response) {
                                return reject(new Error('HTTP ' + r.status));
                            }
                            resolve(r.response);
                        },
                        onerror: () => reject(new Error('network error')),
                        ontimeout: () => reject(new Error('timeout'))
                    });
                    return;
                }
                fetch(url, { mode: 'cors' })
                    .then(r => r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status)))
                    .then(resolve, reject);
            });
        },

        async load(force = false) {
            // 11.6.4e: тумблер выключен — наборы 7TV не запрашиваем вовсе
            // (экономия трафика). Chat.setSevenTVEnabled() догрузит набор,
            // когда тумблер включат обратно.
            if (this.isDisabled()) return;

            if (this.loading) {
                // Перезагрузка во время текущей загрузки — выполним после неё.
                if (force) this._reloadQueued = true;
                return;
            }
            if (this.loaded && !force) return;

            this.loading = true;
            this._resetCaches();

            let count = 0;
            try {
                // 1. Глобальный набор 7TV.
                const dataGlobal = await this.requestJson(this.API_URL);
                count += this._addEmotes(dataGlobal && dataGlobal.emotes);

                // 2. Набор канала: ник → Twitch ID (api.ivr.fi) → emote_set (7tv.io).
                let saved = '';
                try { saved = localStorage.getItem(this.CHANNEL_KEY) || ''; } catch (e) {}
                this.channel = String(saved || this.channel || this.DEFAULT_CHANNEL).trim().toLowerCase();

                if (this.channel) {
                    try {
                        const user = await this.requestJson(this.IVR_URL + encodeURIComponent(this.channel));
                        const id = user && user[0] && user[0].id;
                        if (id) {
                            const dataChan = await this.requestJson(this.CHANNEL_API_URL + encodeURIComponent(id));
                            const set = dataChan && dataChan.emote_set;
                            count += this._addEmotes(set && set.emotes);
                        }
                    } catch (chanErr) {
                        console.warn('[7TV] Не удалось загрузить канал', this.channel, chanErr);
                    }
                }

                this.loaded = count > 0;
                dbg(`[7TV] Загружено ${this.emotes.size} эмоутов (канал: ${this.channel}).`);
            } catch (e) {
                console.error('[7TV] Ошибка загрузки:', e);
            } finally {
                this.loading = false;
                if (this.loaded) {
                    // Смайлики пришли после первого рендера — обновим открытый чат.
                    try {
                        if (typeof Chat !== 'undefined' && Chat.widget) Chat.renderMessages();
                    } catch (e) {}
                }
                if (this._reloadQueued) {
                    this._reloadQueued = false;
                    this.load(true);
                }
            }
        },

        // Сброс кэша эмоутов/картинок (смена канала или force-перезагрузка).
        _resetCaches() {
            this._cacheEpoch = (this._cacheEpoch || 0) + 1;
            this.emotes.clear();
            for (const url of this.blobUrls.values()) {
                try { URL.revokeObjectURL(url); } catch (e) {}
            }
            this.blobUrls.clear();
            this.pending.clear();
        },

        _addEmotes(emoteList) {
            if (!Array.isArray(emoteList)) return 0;
            let added = 0;
            emoteList.forEach(e => {
                const host = e && e.data && e.data.host;
                if (!host || !host.url || !e.name || e.name === '__proto__') return;
                const files = (host.files || []).filter(f => f && f.format === 'WEBP' && f.name);
                const preferred = files.find(f => f.name === '2x.webp') || files[0];
                this.emotes.set(e.name, { url: 'https:' + host.url + '/' + (preferred ? preferred.name : '2x.webp') });
                added++;
            });
            return added;
        },

        replaceEmotes(rawText) {
            if (!rawText) return '';
            // replaceEmotes — единственная точка экранирования текста сообщения.
            const text = String(rawText);
            // 11.6.4e: тумблер «🎭 Отображать смайлы 7TV» выключен — отдаём
            // обычный текст (экранированный, иначе получим XSS через innerHTML).
            if (this.isDisabled()) return Utils.escapeHtml(text);
            if (!this.emotes.size) return Utils.escapeHtml(text);

            return text.split(/([^\p{L}\p{N}_]+)/u).map(part => {
                if (!part) return '';
                // Смайлом считается только целое слово; пунктуация/пробелы/эмодзи
                // отделяются как разделители и экранируются как обычный текст.
                if (!/^[\p{L}\p{N}_]+$/u.test(part) || !this.emotes.has(part)) return Utils.escapeHtml(part);
                const name = Utils.escapeHtml(part);
                return `<img class="t7-emote" data-t7="${name}" src="${this.PLACEHOLDER}" title="${name}" alt="${name}" loading="lazy">`;
            }).join('');
        },

        // После вставки HTML: меняем заглушки на blob:-URL смайликов.
        decorate(root) {
            // 11.6.4e: тумблер выключен — img.t7-emote в разметке не появляются,
            // но на всякий случай не тянем блобы смайлов.
            if (this.isDisabled()) return;
            if (!root || typeof root.querySelectorAll !== 'function' || !this.emotes.size) return;
            root.querySelectorAll('img.t7-emote[data-t7]').forEach(img => {
                const name = img.getAttribute('data-t7');
                if (!name) return;
                const ready = this.blobUrls.get(name);
                if (ready) { img.src = ready; return; }
                if (img.getAttribute('data-t7-loading') === '1') return;
                img.setAttribute('data-t7-loading', '1');
                this.getBlobUrl(name).then(url => {
                    img.removeAttribute('data-t7-loading');
                    if (url) img.src = url;
                    else if (img.parentNode) img.replaceWith((img.ownerDocument || document).createTextNode(name));
                });
            });
        },

        getBlobUrl(name) {
            if (this.blobUrls.has(name)) return Promise.resolve(this.blobUrls.get(name));
            if (this.pending.has(name)) return this.pending.get(name);
            const emote = this.emotes.get(name);
            if (!emote || !emote.url) return Promise.resolve(null);

            const epoch = this._cacheEpoch;
            const task = this.requestBlob(emote.url).then(blob => {
                const url = URL.createObjectURL(blob);
                // Пока грузили, канал/набор могли перезагрузить — старый блоб не кэшируем.
                if (epoch !== this._cacheEpoch) {
                    try { URL.revokeObjectURL(url); } catch (e) {}
                    return null;
                }
                this.blobUrls.set(name, url);
                return url;
            }).catch(e => {
                dbg('[7TV] Не удалось загрузить эмоут', name, e);
                return null;
            }).finally(() => this.pending.delete(name));

            this.pending.set(name, task);
            return task;
        }
    };

    // Слой чата: 7TV-эмоуты (склейка — см. chat/chat.js).
    const ChatEmotes = { SevenTV };

    // ===== src/modules/chat/chat-history.js =====
    // ============================================================
    // 7.2 МОДУЛЬ: ЧАТ — история и кэш сообщений
    // ============================================================
    // Вынесено из modules/chat.js (v11.6.0, этап 2 декомпозиции).
    // Слой-миксин: методы рассчитывают на this === Chat, поэтому
    // вливаются через Object.assign(Chat, ChatHistory).

    const ChatHistory = {
        // Ключ localStorage, куда пишется кэш последних 200 сообщений.
        STORAGE_KEY: 'LEGION_CHAT_HISTORY',
        // Флаг «история уже подтянута» — loadHistory() выполняется один раз.
        historyLoaded: false,
        // Статусы из /api/city/enter (заполняются в loadHistory).
        muted: false,
        mod: null,
        ign: new Set(),

        saveToStorage(author, text, role, isSystem, channel = null, k = null, aw = null, rank = null, id = null) {
            try {
                const history = this.loadFromStorage();
                history.push({ author, text, role, isSystem, channel, k, aw, rank, id, ts: Date.now() });
                const trimmed = history.length > 200 ? history.slice(-200) : history;
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(trimmed));
            } catch (e) { /* quota */ }
        },

        loadFromStorage() {
            try {
                const raw = localStorage.getItem(this.STORAGE_KEY);
                if (!raw) return [];
                const arr = JSON.parse(raw);
                return Array.isArray(arr) ? arr : [];
            } catch (e) { return []; }
        },

        // Своё сообщение кэшируем/обновляем. Ответ на отправку и эхо из потока —
        // это один и тот же объект (общий ts), поэтому запись ищется по нему:
        // эхо дописывает в localStorage id, aw и rank, не плодя дублей.
        cacheOwnMessage(msg) {
            if (!msg || !msg.text) return;
            try {
                const channel = msg.channel || 'city';
                const ts = msg.ts || Date.now();
                const entry = {
                    author: msg.author, text: msg.text, role: msg.role, isSystem: !!msg.isSystem,
                    channel: msg.channel, k: msg.k, aw: msg.aw, rank: msg.rank,
                    id: msg.id || null, ts
                };
                const history = this.loadFromStorage();
                const idx = history.findIndex(h => h && h.ts === ts && h.text === msg.text
                    && (h.author || '') === (msg.author || '')
                    && (h.channel || 'city') === channel);
                if (idx >= 0) {
                    history[idx] = { ...history[idx], ...entry };
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
                    return;
                }
                history.push(entry);
                const trimmed = history.length > 200 ? history.slice(-200) : history;
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(trimmed));
            } catch (e) {}
        },

        async loadHistory() {
            if (this.historyLoaded) return;
            this.historyLoaded = true;

            const cached = this.loadFromStorage();
            if (cached.length > 0) {
                cached.forEach(m => {
                    if (!this.messages.some(cur => (cur.id && cur.id === m.id) || (cur.author === m.author && cur.text === m.text && cur.channel === m.channel))) {
                        this.messages.push({ author: m.author, text: m.text, role: m.role, rank: m.rank, isSystem: m.isSystem, channel: m.channel, k: m.k, aw: m.aw, id: m.id || null, ts: m.ts });
                    }
                });
            }

            try {
                const res = await Utils.fetchApi('/api/city/enter', {});
                const data = res?.body || res;

                // Флаги мута / модерации / игнора из ответа сервера
                if (data && data.ok) {
                    if (data.chatMe) {
                        if ('muted' in data.chatMe) this.muted = data.chatMe.muted;
                        if ('mod' in data.chatMe && data.chatMe.mod !== 'own') this.mod = data.chatMe.mod;
                    }
                    if (Array.isArray(data.ign)) this.ign = new Set(data.ign);
                }

                if (data && data.ok && Array.isArray(data.chat)) {
                    data.chat.forEach(m => {
                        const parsed = Utils.extractChatFields(m);
                        if (!parsed.text) return;
                        const ch = parsed.channel || 'city';
                        // Не дублируем то, что уже есть в this.messages: по id ИЛИ по автору+тексту
                        const existing = this.messages.find(cur =>
                            (parsed.id && cur.id && cur.id === parsed.id) ||
                            (!cur._pending && cur.author === parsed.author && cur.text === parsed.text &&
                                (cur.channel || 'city') === ch)
                        );
                        if (existing) {
                            // Кэш мог быть сохранён без титула/статуса — дополняем из истории сервера
                            if (parsed.aw && !existing.aw) existing.aw = parsed.aw;
                            if (parsed.rank && !existing.rank) existing.rank = parsed.rank;
                            return;
                        }
                        this.handleIncoming(parsed.author, parsed.text, true, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to, parsed.rank);
                    });
                }
            } catch (e) {
                dbg('Не удалось стянуть историю города', e);
            }

            this.renderMessages();
        },

        async syncMe() {
            try {
                const res = await Utils.fetchApi('/api/me');
                // v11.6.0g-5: ник — это user.login из /api/me. LG_CH сюда не
                // подмешиваем: там логин Twitch-канала, а не игрока (баг «чужой
                // ник в чате»). Фолбэк — ME.user из page-context.
                const user = res?.user || (typeof G !== 'undefined' && G.ME?.user);
                const login = user?.login || user?.name;
                if (login) {
                    this.myNick = String(login).trim().toLowerCase();
                }
                const me = res?.hero || res?.body?.hero;
                if (me) {
                    this.myRole = me.class || me.sk?.c || 'legionary';
                }
            } catch (e) {}
        },
    };

    // ===== src/modules/chat/chat-net.js =====
    // ============================================================
    // 7.3 МОДУЛЬ: ЧАТ — сеть: перехватчики и живой поток
    // ============================================================
    // Вынесено из modules/chat.js (v11.6.0, этап 2 декомпозиции).
    // Слой-миксин: перехват EventSource / WebSocket, хуки нативной ленты
    // LGChatOne (ПАТЧ 11.6.4f: свой поток /api/live больше не открываем),
    // наблюдение за сетевой активностью игры (PerformanceObserver) и разбор
    // входящих в общий Chat.handleIncoming().
    // 11.6.4b: перехват window.fetch удалён — античит шахты палит подмену
    // fetch по отсутствию [native code] (см. блок «Наблюдение за сетевой
    // активностью игры» ниже).
    // this внутри методов — это Chat (Object.assign в chat/chat.js).

    // v11.6.0g-3: период поллинга «кто играет с аддоном» (ТЗ — раз в 30 с).
    // Один тик = POST /heartbeat + GET /users, окно онлайна на сервере 15 мин.
    const ADDON_USERS_POLL_MS = 30000;

    // ПАТЧ 11.6.4f: период Keep-Alive нативного чата. LGChatOne.sync() отправляет
    // POST /api/chat/watch {on:true} только при H.chat.open === true, а сервер
    // стримит сообщения в SSE лишь по watch. Свой поток мы больше не держим,
    // поэтому раз в 30 с возвращаем флаг открытия (Chat.startNativeChatWatch) —
    // но только пока открыт наш вынесенный чат (ПАТЧ 11.6.4g).
    const NATIVE_CHAT_KEEPALIVE_MS = 30000;

    // v11.6.1c: как часто спрашивать GET /latest-version (раз в час). Троттлинг
    // хранится в localStorage 'lgUpdateCheck', чтобы проверка не зависела от
    // перезапуска поллинга (переключение вкладок, повторный init чата).
    const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

    // 11.6.4b: минимальный интервал между нашими syncMe() по сигналу
    // PerformanceObserver. Игра зовёт /api/me часто (SSE `me`, действия, HUD),
    // а нам хватает знать логин и класс — 10 секунд более чем достаточно.
    const GAME_ME_SYNC_MS = 10000;

    // v11.6.0g-6: ключ доступа к нашему серверу. Должен совпадать с API_KEY в
    // server/index.js (env LGU_API_KEY). Это фильтр от случайных ботов, а не
    // секрет: значение лежит в публичной сборке аддона.
    const ADDON_API_KEY = 'LGU-default-secret-key-change-me';

    const ChatNet = {
        // id текущей шахты (обновляется из ленты LGChatOne и /api/mine/*).
        // ПАТЧ 11.6.4f: своего потока /api/live больше нет — состояние поллинга
        // и таймеры EventSource удалены вместе с startBackgroundLiveListener.
        currentMineId: 'home',

        getChannelLogin() {
            try {
                const m = location.pathname.match(/\/c\/([^/?#]+)/i);
                if (m && m[1]) return m[1].toLowerCase().trim();
                const paramC = new URL(location.href).searchParams.get('c');
                if (paramC && !/^\d+$/.test(paramC)) return paramC.toLowerCase().trim();
            } catch (e) {}
            return '';
        },

        isStreamerMessage(msg) {
            if (!msg || !msg.author) return false;
            const author = String(msg.author).toLowerCase().trim();
            const chLogin = this.getChannelLogin();
            if (!chLogin) return false;
            const chBase = chLogin.replace(/channel$/i, '');
            const authorBase = author.replace(/channel$/i, '');
            return author === chLogin || author === chBase || authorBase === chBase || authorBase === chLogin;
        },

        isMentionedMessage(msg) {
            if (!msg || !msg.text || !this.myNick) return false;
            const myNick = String(this.myNick).trim();
            if (!myNick || myNick.length < 2) return false;
            if (msg.author && String(msg.author).toLowerCase() === myNick.toLowerCase()) return false;
            const text = String(msg.text).toLowerCase();
            const lowerNick = myNick.toLowerCase();
            return text.includes('@' + lowerNick) || text.includes(lowerNick);
        },

        processMineMessages(list) {
            if (!list) return;
            const chats = Utils.extractChatDeep(list);
            let added = false;
            chats.forEach(m => {
                const parsed = Utils.extractChatFields(m);
                if (parsed.text) {
                    this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, 'mine', parsed.k, parsed.to, parsed.rank);
                    added = true;
                }
            });
            if (added) this.renderMessages();
        },

        processRawMessages(msgs) {
            if (!msgs || !Array.isArray(msgs)) return;
            msgs.forEach(m => {
                const { author, text, id, seq, role, rank, isSystem, aw, channel } = Utils.extractChatFields(m);
                if (!text) return;
                this.handleIncoming(author || 'Игрок', text, false, id, seq, role, isSystem, aw, channel, null, null, rank);
            });
        },

        // Определяем канал живого потока: город или шахта
        resolveLiveChannel(data) {
            try {
                const d = (data && (data.body || data.data || data)) || null;
                if (d) {
                    if (d.chatRoom === 'city' || d.town) return 'city';
                    if (d.chatRoom === 'mine' || d.mine) return 'mine';
                }
            } catch (e) {}
            return this.isInMine() ? 'mine' : 'city';
        },

        /**
         * ПАТЧ 11.6.4f: приём ленты нативного чата игры.
         *
         * Свой EventSource('/api/live') больше НЕ открываем: клиент Legion сам
         * стримит чат, а LGChatOne.onFeed(room, data) / enterFeed(room, r)
         * получают уже разобранные пакеты комнаты (см. reference/.../site-chatone.js).
         * Хуки на эти колбэки ставит Chat.hookNativeChat(), а сюда приходит тот же
         * формат, что раньше разбирался из SSE: { chat, chatDel, chatMe, c }.
         *
         * @param {string}  room      'city' | 'mine'
         * @param {object}  data      пакет ленты (onFeed) или истории (enterFeed)
         * @param {boolean} isHistory true для enterFeed — историю не считаем непрочитанной
         */
        ingestGameFeed(room, data, isHistory = false) {
            if (!data) return;
            const loc = room === 'mine' ? 'mine' : 'city';
            try {
                if (data.c != null) this.currentMineId = data.c;

                // Игроков и входящие ЛС разбираем всегда — на них держатся
                // «Друзья» и тосты ЛС, даже при выключенном перехвате чата.
                Utils.updateOnlinePlayers(data, loc);
                Utils.processIncomingDMs(data);

                if (this.disabled) return;

                // data.chat — массив сообщений комнаты: в шахте игра помечает их
                // rm: 'mine' и префиксом id 'm:', остальные поля те же, что
                // понимает Utils.extractChatFields() (l/n — автор, t — текст, c — класс).
                const list = Array.isArray(data.chat) ? data.chat : [];
                list.forEach((m) => {
                    const parsed = Utils.extractChatFields(m);
                    if (!parsed.text) return;
                    const ch = parsed.channel || loc;
                    this.handleIncoming(
                        parsed.author || 'Игрок', parsed.text, !!isHistory,
                        parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw,
                        ch, parsed.k, parsed.to, parsed.rank
                    );
                });
            } catch (err) {
                dbg('[CHAT] ingestGameFeed error:', err);
            }
        },

        /**
         * @deprecated ПАТЧ 11.6.4f: свой EventSource и поллинг /api/live удалены.
         *
         * Имя сохранено как точка совместимости для main.js, chat-pip.js и
         * Chat.setDisabled(): раньше метод поднимал фоновый поток, теперь он
         * идемпотентно вешает хуки на нативную ленту и включает Keep-Alive.
         */
        startBackgroundLiveListener() {
            if (this.disabled) return;
            this.hookNativeChat();
            this.startNativeChatWatch();
        },

        /**
         * @deprecated ПАТЧ 11.6.4f: полная остановка перехвата (выключение чата в
         * настройках, restart скрипта). Снимает Keep-Alive и хуки, чтобы после
         * перезапуска на G.LGChatOne не остался колбэк в мёртвый инстанс Chat.
         */
        stopBackgroundLiveListener() {
            this.stopNativeChatWatch();
        },

        interceptEventSource() {
            if (this._esIntercepted) return;
            // @grant переводит Tampermonkey в sandbox: window — это прокси,
            // поэтому конструктор на странице патчим через unsafeWindow (G).
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const OrigES = pageWin.EventSource || window.EventSource;
            if (!OrigES || OrigES.__lgChatProxied) return;
            this._esIntercepted = true;
            const self = this;
            class ESProxy extends OrigES {
                constructor(...args) {
                    super(...args);
                    if (args[1]?._customLive) return;
                    const url = String(args[0] || '');
                    const isLive = url.includes('/api/live');
                    const isMine = isLive || url.includes('/api/mine/');

                    const handler = (e) => {
                        try {
                            let data = e.data;
                            if (typeof data === 'string') {
                                try { data = JSON.parse(data); } catch(err) {}
                            }
                            let loc = 'city';
                            if (isLive && data) {
                                const d = data.body || data.data || data;
                                // Используем общий метод, который понимает контекст
                                loc = self.resolveLiveChannel(d);
                            } else {
                                loc = isMine ? 'mine' : 'city';
                            }
                            // Перехват игроков для модуля «Друзья» (работает всегда)
                            Utils.updateOnlinePlayers(data, loc);
                            Utils.processIncomingDMs(data);

                            // Если перехват отключен — ничего не парсим (закрытый виджет не помеха).
                            if (self.disabled) return;

                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        const ch = parsed.channel || (loc === 'mine' ? 'mine' : 'city');
                                        Chat.handleIncoming(parsed.author || 'Игрок', parsed.text, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                            }
                        } catch (err) {
                            dbg('ES intercept error:', err);
                        }
                    };

                    this.addEventListener('message', handler);
                    // 'message' обрабатывается строкой выше — второй раз не вешаем
                    ['city', 'chat', 'say', 'init', 'mine', 'live', 'event', 'update'].forEach(ev => {
                        try { this.addEventListener(ev, handler); } catch(e) {}
                    });
                }
            }
            try { ESProxy.__lgChatProxied = true; } catch (e) {}
            try { pageWin.EventSource = ESProxy; } catch (e) {}
            if (pageWin !== window) { try { window.EventSource = ESProxy; } catch (e) {} }
        },

        interceptWebSocket() {
            if (this._wsIntercepted) return;
            // См. interceptEventSource: патчим конструктор страницы (unsafeWindow).
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const OrigWS = pageWin.WebSocket || window.WebSocket;
            if (!OrigWS || OrigWS.__lgChatProxied) return;
            this._wsIntercepted = true;
            const self = this;
            class WSProxy extends OrigWS {
                constructor(...args) {
                    super(...args);
                    const url = String(args[0] || '');
                    const isLive = url.includes('/api/live');
                    const isMine = isLive || url.includes('/api/mine/');

                    this.addEventListener('message', async (e) => {
                        try {
                            let data = e.data;
                            if (typeof Blob !== 'undefined' && data instanceof Blob) {
                                try {
                                    const text = await data.text();
                                    try { data = JSON.parse(text); } catch(err) { data = text; }
                                } catch (err) {}
                            } else if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
                                try {
                                    const text = new TextDecoder().decode(data);
                                    try { data = JSON.parse(text); } catch(err) { data = text; }
                                } catch (err) {}
                            } else if (typeof data === 'string') {
                                try { data = JSON.parse(data); } catch(err) {}
                            }

                            let loc = 'city';
                            if (isLive && data) {
                                const d = data.body || data.data || data;
                                // Используем общий метод, который понимает контекст
                                loc = self.resolveLiveChannel(d);
                            } else {
                                loc = isMine ? 'mine' : 'city';
                            }
                            // Перехват игроков для модуля «Друзья» (работает всегда)
                            Utils.updateOnlinePlayers(data, loc);
                            Utils.processIncomingDMs(data);

                            // Если перехват отключен — ничего не парсим.
                            // При закрытом виджете сообщения всё равно нужны (счётчик непрочитанных).
                            if (self.disabled) return;

                            // 1. Извлекаем сообщения через глубокий парсер extractChatDeep
                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        const ch = parsed.channel || (loc === 'mine' ? 'mine' : 'city');
                                        Chat.handleIncoming(parsed.author || 'Игрок', parsed.text, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                                return;
                            }

                            // 2. Строка вида Author: text
                            if (typeof data === 'string' && data.includes(':')) {
                                const i = data.indexOf(':');
                                const a = data.slice(0, i).trim();
                                const t = data.slice(i + 1).trim();
                                if (a && t && t.length < 500) {
                                    Chat.handleIncoming(a, t, false, null, null, null, false, null, loc);
                                }
                            }
                        } catch (err) {
                            dbg('WS intercept error:', err);
                        }
                    });
                }
            }
            try { WSProxy.__lgChatProxied = true; } catch (e) {}
            try { pageWin.WebSocket = WSProxy; } catch (e) {}
            if (pageWin !== window) { try { window.WebSocket = WSProxy; } catch (e) {} }
        },

        /* ---------------------------------------------------------- */
        /* Наблюдение за сетевой активностью игры (11.6.4b)            */
        /* ---------------------------------------------------------- */
        // Античит шахты (reference/.../site/mine.js) считает подмену
        // window.fetch детектом:
        //   natv(window.fetch) === false && window.fetch !== LG_FETCH.w -> pi |= 1
        // Поэтому хук fetch снят полностью. Вместо него — пассивное наблюдение
        // через PerformanceObserver (тот же приём, что в modules/party.js для
        // /api/me и /api/qact): слушаем resource-записи браузера и НИЧЕГО не
        // перезаписываем — ни fetch, ни ответы.

        /** Слушатель resource-записей браузера. */
        _perfObserver: null,
        /** Date.now() последней синхронизации /api/me (троттлинг). */
        _lastMeSync: 0,

        /**
         * Поднимает наблюдатель за запросами игры. Идемпотентен.
         *
         * Что даёт без fetch-хука:
         *   • игра сходила в /api/me         -> наш syncMe() (ник и класс);
         *   • игра общается с городом/шахтой -> добираем хуки на LGChatOne
         *     (модуль site-chatone.js грузится лениво, на init() его могло не быть).
         *
         * Тела чужих ответов прочитать нельзя (PerformanceObserver отдаёт только
         * метаданные). Данные чата берём из колбэков нативного LGChatOne
         * (Chat.hookNativeChat -> ChatNet.ingestGameFeed), история города —
         * POST /api/city/enter в loadHistory(), топ шахты и «сколько народу в
         * шахте» — SSE-событием mine через Utils.updateOnlinePlayers().
         * Отдельный перехват ответов не нужен.
         */
        startNetworkObserver() {
            if (this._perfObserver) return;
            if (typeof PerformanceObserver !== 'function') {
                // Старые браузеры: остаёмся на хуках LGChatOne, деградация мягкая.
                dbg('[CHAT] PerformanceObserver не поддерживается — работаем без наблюдателя');
                return;
            }

            try {
                this._perfObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        const name = entry && entry.name ? entry.name : '';
                        // includes, а не ===: name — полный URL вида
                        // https://play.multidonate.ru/c/<канал>/api/me?...
                        if (name.includes('/api/me')) {
                            this._onGameMeTraffic();
                            break;
                        }
                        if (name.includes('/api/city/') || name.includes('/api/mine/') || name.includes('/api/live')) {
                            this._onGameChatTraffic();
                            break;
                        }
                    }
                });
                // buffered: false — прошлые записи не нужны, слушаем только новые.
                this._perfObserver.observe({ type: 'resource', buffered: false });
            } catch (e) {
                dbg('[CHAT] PerformanceObserver не запустился:', e);
                this._perfObserver = null;
            }
        },

        /** Гасит наблюдатель (выход, перезапуск скрипта). */
        stopNetworkObserver() {
            if (!this._perfObserver) return;
            try { this._perfObserver.disconnect(); } catch (e) {}
            this._perfObserver = null;
        },

        /**
         * Игра обновила /api/me — освежаем свой ник и класс своим запросом.
         *
         * Троттлинг GAME_ME_SYNC_MS: игру /api/me зовут часто (SSE `me`, любое
         * действие, HUD), а нам достаточно знать логин и класс. Свой запрос
         * тоже даёт resource-запись /api/me — троттлинг заодно не даёт
         * наблюдателю раскрутиться в бесконечный цикл.
         */
        _onGameMeTraffic() {
            const now = Date.now();
            if (now - this._lastMeSync < GAME_ME_SYNC_MS) return;
            this._lastMeSync = now;
            this.syncMe();
        },

        /**
         * Игра общается с городом/шахтой — значит, LGChatOne уже жив: модуль
         * site-chatone.js подгружается лениво (oneLoad() в app.js), поэтому на
         * момент Chat.init() его могло ещё не быть.
         *
         * ПАТЧ 11.6.4f: своего EventSource больше нет, так что здесь только
         * добираем хуки на нативную ленту (метод идемпотентен).
         */
        _onGameChatTraffic() {
            if (this.disabled) return;
            this.hookNativeChat();
        },

        /* ---------------------------------------------------------- */
        /* Подсветка пользователей аддона (v11.6.0g-3)                 */
        /* ---------------------------------------------------------- */

        // Таймер поллинга /heartbeat + /users.
        // ТЗ 11.6.0h.2: DOM-наблюдатель удалён — подсветку рисует CSS.
        _addonPollTimer: null,

        /**
         * База сервера аддона: сначала адрес пати (Party.getBaseUrl), затем
         * прод-домен. Party объявлен раньше чата (build.js: SHARED_MODULES
         * идут до CHAT_MODULES), но проверка на undefined оставлена — чат не
         * должен падать, если модуль пати когда-нибудь исключат из сборки.
         */
        _addonBaseUrl() {
            try {
                if (typeof Party !== 'undefined' && Party && typeof Party.getBaseUrl === 'function') {
                    const base = Party.getBaseUrl();
                    if (base) return String(base).trim().replace(/\/+$/, '');
                }
            } catch (e) {}
            return 'https://legion.ctrlfree.host';
        },

        /**
         * Запрос к серверу аддона через GM_xmlhttpRequest: домен чужой для
         * игры, обычный fetch упёрся бы в CORS и CSP `connect-src 'self'`
         * (см. AGENTS.md §3). Разбираем только JSON и только 2xx.
         */
        _addonRequest(method, url, body = null) {
            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest !== 'function') {
                    reject(new Error('GM_xmlhttpRequest недоступен: проверьте @grant в шапке'));
                    return;
                }
                GM_xmlhttpRequest({
                    method,
                    url,
                    // v11.6.0g-6: сервер пускает только с ключом (401 иначе).
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Legion-Key': ADDON_API_KEY
                    },
                    data: body ? JSON.stringify(body) : undefined,
                    timeout: 8000,
                    onload: (res) => {
                        if (res.status < 200 || res.status >= 300) {
                            reject(new Error(`HTTP ${res.status}: ${url}`));
                            return;
                        }
                        try {
                            resolve(res.responseText ? JSON.parse(res.responseText) : null);
                        } catch (e) {
                            reject(new Error(`Некорректный JSON от ${url}`));
                        }
                    },
                    onerror: () => reject(new Error(`Сервер аддона недоступен: ${url}`)),
                    ontimeout: () => reject(new Error(`Сервер аддона не ответил за 8 с: ${url}`)),
                    onabort: () => reject(new Error('Запрос к серверу аддона отменён'))
                });
            });
        },

        /**
         * Канал игры (LG_CH.login) в нижнем регистре.
         *
         * v11.6.0g-5: это НЕ ник игрока, а логин Twitch-канала. Нужен только
         * затем, чтобы не подсвечивать служебные сообщения канала как
         * «пользователь аддона».
         */
        _channelLogin() {
            try {
                if (typeof G === 'undefined' || !G) return '';
                return String(G.LG_CH?.login || '').trim().toLowerCase();
            } catch (e) {
                return '';
            }
        },

        /**
         * Ник текущего игрока для heartbeat и подсветки (нижний регистр).
         *
         * v11.6.0g-5: источники только игровые — ME.user из page-context и,
         * как фолбэк, GET /api/me. LG_CH сюда не подмешивается: там логин
         * Twitch-канала, из-за которого отправлялся и подсвечивался чужой ник.
         *
         * @returns {Promise<string>} нормализованный логин либо '' (неизвестен)
         */
        async _resolveMyLogin() {
            // 1. Страница уже знает игрока — самый дешёвый и свежий путь.
            try {
                if (typeof G !== 'undefined' && G) {
                    const pageLogin = G.ME?.user?.login || G.ME?.user?.name;
                    if (pageLogin) return String(pageLogin).trim().toLowerCase();
                }
            } catch (e) {}

            // 2. Ник, полученный ранее (syncMe / собственный GET /api/me).
            // 11.6.4b: перехвата /api/me больше нет — данные берём своим запросом.
            if (this.myNick) {
                const known = String(this.myNick).trim().toLowerCase();
                if (known) return known;
            }

            // 3. Фолбэк: сам /api/me — ME в странице может быть ещё пуст, а
            // первый heartbeat откладывать нельзя. Результат кэшируем в myNick,
            // поэтому следующий тик пойдёт уже без запроса.
            try {
                const res = await Utils.fetchApi('/api/me');
                const user = res?.user || res?.body?.user;
                const login = user?.login || user?.name;
                if (login) {
                    const norm = String(login).trim().toLowerCase();
                    this.myNick = norm;
                    return norm;
                }
            } catch (e) {}

            return '';
        },

        /**
         * Отметка «я онлайн» + обновление списка пользователей аддона.
         *
         * POST /heartbeat {login, version} — чтобы нас видели другие (и чтобы
         * сервер знал версию аддона для GET /stats); GET /users — чтобы увидели
         * мы. Ошибки сети не всплывают тостом: сервер аддона может быть
         * недоступен, подсветка просто остаётся на прошлом наборе.
         */
        async syncAddonUsers() {
            // v11.6.1c: раз в час заодно спрашиваем сервер о новой версии.
            // Без await — уведомление не должно задерживать подсветку, а
            // собственные ошибки checkForUpdates() гасит внутри себя.
            this.checkForUpdates();
            // v11.6.0g-5: ник резолвится через ME.user / /api/me, LG_CH не в счёт.
            const nick = await this._resolveMyLogin();
            // Ник ещё не пришёл (/api/me в пути) — отправим на следующем тике.
            if (!nick) return;

            const base = this._addonBaseUrl();
            // Канал игры: его логин не должен попасть в список подсветки.
            const channel = this._channelLogin();

            try {
                // Версия из шапки userscript'а: GM_info доступен в песочнице
                // Tampermonkey и не зависит от игры (фолбэк 'unknown').
                const ver = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || 'unknown';
                await this._addonRequest('POST', base + '/heartbeat', { login: nick, version: ver });
                const data = await this._addonRequest('GET', base + '/users');
                const list = (data && Array.isArray(data.users)) ? data.users : [];

                const next = new Set();
                list.forEach((login) => {
                    const norm = String(login || '').trim().toLowerCase();
                    // Канал игры (G.LG_CH.login) — не игрок: служебные сообщения
                    // канала идут в нативной ленте с его data-nick, и подсветка
                    // «аддоном» на них была бы ложной (v11.6.0g-5).
                    if (!norm || norm === channel) return;
                    next.add(norm);
                });
                // Свой ник добавляем локально: heartbeat уже ушёл, а снимок
                // /users мог быть собран сервером до нашей вставки. nick уже
                // нормализован (нижний регистр) в _resolveMyLogin().
                next.add(nick);

                const prev = this.addonUsers || new Set();
                const changed = next.size !== prev.size || Array.from(next).some((n) => !prev.has(n));
                this.addonUsers = next;

                // ТЗ 11.6.0h.1: persist-кэш списка. Нужен, чтобы после
                // перезагрузки страницы подсветка появилась мгновенно, не
                // дожидаясь ответа /users (см. Chat.init). TTL проверяется
                // при чтении — 1 час.
                try {
                    localStorage.setItem('LEGION_ADDON_USERS_CACHE', JSON.stringify({
                        list: Array.from(this.addonUsers),
                        ts: Date.now()
                    }));
                } catch (e) {}

                // ТЗ 11.6.0h.2: вместо обхода DOM и DOM-наблюдателя — просто
                // перегенерируем CSS-правила под новый список. Браузер применит
                // их к уже существующим <b data-nick> и к тем, которые игра
                // вставит позже, поэтому флэша при перерисовке ленты нет.
                this._applyAddonStyles();
                if (this._pipDoc) this._applyAddonStylesToPip(this._pipDoc);
                // Свой PiP-чат перерисовываем только при изменении состава:
                // innerHTML каждые 30 с сбивал бы выделение текста у читающего.
                if (changed && this.isOpen()) this.renderMessages();
            } catch (e) {
                dbg('[CHAT] подсветка аддона: синхронизация не удалась:', e && e.message ? e.message : e);
            }
        },

        /* ---------------------------------------------------------- */
        /* Проверка обновлений (ТЗ 11.6.1c)                           */
        /* ---------------------------------------------------------- */

        /**
         * Спрашивает GET /latest-version и, если на сервере версия новее,
         * показывает GM_notification со ссылкой на raw-сборку GitHub.
         *
         * Троттлинг — localStorage 'lgUpdateCheck' (раз в час). Хранилище
         * намеренно не GM-овское: это не настройка, а кэш момента проверки,
         * потеря которого стоит одного лишнего запроса.
         *
         * Ошибки не всплывают: старый сервер без эндпоинта ответит 404,
         * сервер может быть недоступен — тогда отметка времени не пишется и
         * проверка повторится на следующем тике поллинга.
         */
        async checkForUpdates() {
            try {
                const now = Date.now();
                const lastCheck = Number(localStorage.getItem('lgUpdateCheck') || 0) || 0;
                if (now - lastCheck <= UPDATE_CHECK_INTERVAL_MS) return;

                const base = this._addonBaseUrl();
                const res = await this._addonRequest('GET', base + '/latest-version');
                // Пустой ответ — не повод считать проверку выполненной.
                if (!res || !res.version) return;
                localStorage.setItem('lgUpdateCheck', String(now));

                // Своя версия — из шапки userscript'а. Без GM_info сравнение
                // невозможно (не Tampermonkey), поэтому просто выходим.
                const current = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '';
                if (!current) return;

                // numeric:true обязателен: лексикографически «11.6.10» < «11.6.9»,
                // а числовое сравнение даёт правильный порядок сегментов.
                const isNewer = String(res.version)
                    .localeCompare(String(current), undefined, { numeric: true, sensitivity: 'base' }) > 0;
                if (!isNewer) return;

                // GM_notification/GM_openInTab требуют @grant в шапке; проверка
                // typeof оставлена, чтобы в менеджере без этих API аддон не падал.
                // v11.6.1g: настройка «🔔 Уведомлять о новых версиях» (дефолт —
                // включено). Проверка версии выше всё равно выполняется, поэтому
                // троттлинг lgUpdateCheck обновляется, а уведомление просто не
                // показывается при выключенном тумблере.
                const notifyOn = localStorage.getItem('LEGION_UPDATE_NOTIFY') !== 'false';
                if (notifyOn && typeof GM_notification === 'function') {
                    GM_notification({
                        title: 'Legion Ultimate Assistant',
                        text: `Вышла новая версия ${res.version}. Нажмите, чтобы обновить.`,
                        onclick: () => {
                            if (typeof GM_openInTab === 'function') GM_openInTab(res.url);
                        }
                    });
                }
            } catch (e) {
                dbg('[CHAT] проверка обновлений не удалась:', e && e.message ? e.message : e);
            }
        },

        /* ---------------------------------------------------------- */
        /* CSS-подсветка (ТЗ 11.6.0h.2)                               */
        /* ---------------------------------------------------------- */
        // DOM-наблюдатель, навешивание класса и вставка бейджа из JS удалены.
        // Вместо этого на каждый список /users генерируется одна CSS-простыня:
        // браузер сам применяет правила к любому <b data-nick="...">, даже если
        // игра полностью пересоздала DOM. Класс навешивать не нужно, поэтому
        // перерисовка ленты не может дать флэш «без подсветки».

        /**
         * Экранирование значения для строкового селектора атрибута.
         * Обратный слэш обязателен первым: иначе он «съест» следующую кавычку.
         */
        _cssAttrValue(nick) {
            return String(nick).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        },

        /**
         * Собирает CSS для текущего набора addonUsers.
         * Один источник и для основной страницы, и для PiP-документа.
         *
         * Флаг `i` в [data-nick="..." i] обязателен: addonUsers хранится в
         * нижнем регистре (сервер отдаёт логины нормализованными), а в
         * разметке игры ник стоит как в профиле — например, «BlackWolf».
         * Без `i` селектор не совпал бы и подсветки не было бы вообще.
         */
        _buildAddonStylesCss() {
            const nicks = Array.from(this.addonUsers || []);
            if (nicks.length === 0) return '';

            const esc = (n) => this._cssAttrValue(n);
            // Нативная лента игры: <b data-nick="login"> (reference/.../site-chat.js).
            const nativeSel = nicks.map(n => `b[data-nick="${esc(n)}" i]`).join(',');
            // Наш PiP-чат: <span class="chat-author" data-nick="login">.
            const pipSel = nicks.map(n => `.chat-author[data-nick="${esc(n)}" i]`).join(',');

            // v11.6.1c: бейдж «⚡» убран полностью. Он рисовался фоновой
            // SVG-картинкой (чтобы не портить textContent ника), но визуально
            // мешал и сдвигал ник вправо из-за padding-left. Осталось только
            // свечение text-shadow — оно не меняет ни разметку, ни ширину узла.
            return `
            ${nativeSel} {
                text-shadow: 0 0 4px currentColor, 0 0 10px currentColor !important;
            }
            ${pipSel} {
                text-shadow: 0 0 4px currentColor, 0 0 10px currentColor !important;
            }
        `;
        },

        /**
         * Создаёт/обновляет <style id="lg-addon-hl-styles"> в основной странице.
         * Одна запись textContent — браузер пересчитывает правила ровно один
         * раз за тик поллинга, а не на каждом узле ленты.
         */
        _applyAddonStyles() {
            const on = this.addonHighlight !== false;
            let style = document.getElementById('lg-addon-hl-styles');
            if (!on || this.addonUsers.size === 0) {
                // Тумблер выключен либо список пуст — простыня пустая,
                // подсветка исчезает мгновенно на всех уже отрисованных никах.
                if (style) style.textContent = '';
                return;
            }
            if (!style) {
                style = document.createElement('style');
                style.id = 'lg-addon-hl-styles';
                (document.head || document.documentElement).appendChild(style);
            }
            style.textContent = this._buildAddonStylesCss();
        },

        /**
         * То же самое для документа PiP-окна: у него свой DOM и свои стили.
         * Вызывать после создания PiP-окна и при каждом обновлении addonUsers.
         *
         * @param {Document} pipDoc документ PiP-окна (Chat._pipDoc)
         */
        _applyAddonStylesToPip(pipDoc) {
            if (!pipDoc || !pipDoc.head) return;
            const on = this.addonHighlight !== false;
            let style = typeof pipDoc.getElementById === 'function'
                ? pipDoc.getElementById('lg-addon-hl-styles')
                : null;
            if (!on || this.addonUsers.size === 0) {
                if (style) style.textContent = '';
                return;
            }
            if (!style) {
                style = pipDoc.createElement('style');
                style.id = 'lg-addon-hl-styles';
                pipDoc.head.appendChild(style);
            }
            style.textContent = this._buildAddonStylesCss();
        },

        /** Запуск поллинга /heartbeat + /users (раз в 30 с, идемпотентно). */
        startAddonUsersPolling() {
            if (this._addonPollTimer) return;

            // Первый тик сразу: ждать полминуты до первой подсветки незачем.
            // Наблюдателя за DOM здесь больше нет (ТЗ 11.6.0h.2) — подсветку
            // рисует CSS, который syncAddonUsers() перегенерирует сам.
            this.syncAddonUsers();

            this._addonPollTimer = setInterval(() => {
                this.syncAddonUsers();
            }, ADDON_USERS_POLL_MS);
        },

        /** Остановка поллинга (Chat.destroy). DOM-наблюдатель удалён — гасить нечего. */
        stopAddonUsersPolling() {
            if (this._addonPollTimer) {
                clearInterval(this._addonPollTimer);
                this._addonPollTimer = null;
            }
        },
    };

    // ===== src/modules/chat/chat-pip.js =====
    // ============================================================
    // 7.4 МОДУЛЬ: ЧАТ — PiP-окно, рендер и отправка
    // ============================================================
    // Вынесено из modules/chat.js (v11.6.0, этап 2 декомпозиции).
    // Слой-миксин: единственное место, где живёт DOM чата (окно PiP,
    // documentPictureInPicture). Рендер ленты и отправка сообщений.
    // this внутри методов — это Chat (Object.assign в chat/chat.js).

    // ПАТЧ 11.6.4g: вкладки вынесенного чата. Набор и порядок повторяют
    // нативный чат игры (reference/LegionFrontSRC/lib/site-chat.js: TABS):
    // g — общий город, tr — торговля, mn — ремёсла/шахта, gl — гильдия,
    // dm — личные сообщения. Одна ось на всё состояние (Chat.activeTab).
    const CHAT_TABS = ['g', 'tr', 'mn', 'gl', 'dm'];

    // Подсказки в поле ввода под активную вкладку.
    const CHAT_TAB_PH = {
        g: 'Написать в чат города...',
        tr: 'Куплю / продам / меняю...',
        mn: 'Написать в чат шахты...',
        gl: 'Написать гильдии...',
        dm: 'Лично...'
    };

    const ChatPip = {
        widget: null,
        _popoutWin: null,
        // Документ PiP-окна. С v11.5.3 это единственное место, где живёт DOM чата:
        // обычный (встроенный) виджет удалён, за него отвечает плагин Legion7TV.
        _pipDoc: null,
        _origWidgetStyles: null,
        // Наследие встроенного виджета (возврат в родной парент). // TODO: REMOVE
        _origWidgetParent: null,
        _origWidgetNextSibling: null,
        _origWidgetClasses: null,
        _origWidgetHadOpen: false,
        cooldownUntil: 0,
        _toastTimer: null,

        // Корень чата: всегда берём актуальный DOM из документа PiP-окна.
        // this.widget может ссылаться на отсоединённый (detached) узел, поэтому
        // поиск идёт по документу, а не по сохранённой ссылке.
        _pipRoot() {
            if (this._pipDoc && this.isOpen()) {
                return this._pipDoc.querySelector('.chat-pip') || this._pipDoc.body;
            }
            return null;
        },

        // Поиск элемента чата (инпут, кнопка, лента сообщений) внутри PiP-документа.
        _pipEl(selector) {
            const root = this._pipRoot();
            return root ? root.querySelector(selector) : null;
        },

        // Синхронизация подсветки вкладок с this.activeTab.
        // Ищем по всему документу PiP-окна, а не только внутри this.widget: если
        // ссылка на виджет устарела (окно пересоздано), поиск по документу всё равно
        // найдёт реальные вкладки и снимет лишние active.
        _syncTabs(doc) {
            const d = doc || this._pipDoc || (this.widget && this.widget.ownerDocument) || null;
            if (!d || typeof d.querySelectorAll !== 'function') return;

            // ПАТЧ 11.6.4g: одна ось вкладок. Ключ лежит в data-tab кнопки
            // (g/tr/mn/gl/dm), а не в двух атрибутах main/sub, как раньше.
            d.querySelectorAll('.chat-main-tab').forEach(t => {
                const key = t.getAttribute('data-tab')
                    || (t.dataset && t.dataset.tab) || 'g';
                t.classList.toggle('active', key === this.activeTab);
            });
        },

        showError(msg) {
            // Встроенного виджета больше нет: тост живёт внутри PiP-окна,
            // а если оно закрыто — показываем обычный тост аддона.
            const root = this._pipRoot();
            if (!root) {
                UI.showToast(msg, true);
                return;
            }
            const doc = root.ownerDocument || document;
            let toast = doc.getElementById('chat-toast');
            if (!toast) {
                toast = doc.createElement('div');
                toast.id = 'chat-toast';
                toast.style.cssText = 'position:absolute;top:45px;left:10px;right:10px;background:#ff5a7a;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;text-align:center;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,0.5);transition:opacity 0.3s;';
                root.appendChild(toast);
            }
            toast.textContent = msg;
            toast.style.opacity = '1';
            toast.style.display = 'block';
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => {
                if (toast) {
                    toast.style.opacity = '0';
                    setTimeout(() => { if (toast) toast.style.display = 'none'; }, 300);
                }
            }, 2000);
        },

        updateInputState() {
            const inp = this._pipEl('#chat-input');
            const sendBtn = this._pipEl('#chat-send');
            const tab = this.activeTab;

            // Вкладка «Личные»: писать можно только внутри открытого диалога.
            if (tab === 'dm') {
                if (this.dmTarget) {
                    if (inp) {
                        inp.disabled = false;
                        inp.placeholder = `Написать ${this.dmTarget}...`;
                    }
                    if (sendBtn) sendBtn.disabled = false;
                } else {
                    if (inp) {
                        inp.disabled = true;
                        inp.placeholder = 'Выберите диалог в списке «Личные»';
                        inp.value = '';
                    }
                    if (sendBtn) sendBtn.disabled = true;
                }
                return;
            }

            // Ремёсла/шахта: сервер принимает сообщения только из шахты.
            if (tab === 'mn' && !this.isInMine()) {
                if (inp) {
                    inp.disabled = true;
                    inp.placeholder = 'Доступно только в шахте';
                    inp.value = '';
                }
                if (sendBtn) sendBtn.disabled = true;
                return;
            }

            // g / tr / gl — обычный ввод с подсказкой под вкладку.
            if (inp) {
                inp.disabled = false;
                inp.placeholder = CHAT_TAB_PH[tab] || 'Написать сообщение...';
            }
            if (sendBtn) sendBtn.disabled = false;
        },

        // DOM чата собирается только внутри документа PiP-окна.
        // В основной документ виджет больше не вставляется.
        _buildWidget(doc) {
            const docRef = doc || document;
            const widget = docRef.createElement('div');
            widget.className = 'chat-pip';
            // Важно: id НЕ должен совпадать с DOM_IDS.chatWidget — на этот id
            // в styles.js висят стили встроенного виджета (opacity:0, position:fixed).
            widget.id = 'chat-pip';
            widget.style.cssText = 'position:relative; display:flex; flex-direction:column; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; background:#1d1620; color:#f7eadf;';
            widget.innerHTML = `
                <div class="chat-top-bar" id="chat-drag-handle">
                    <div class="chat-main-tabs" role="tablist">
                        <button class="chat-main-tab active" data-tab="g" type="button">Общий</button>
                        <button class="chat-main-tab" data-tab="tr" type="button">Торговля</button>
                        <button class="chat-main-tab" data-tab="mn" type="button">Ремёсла</button>
                        <button class="chat-main-tab" data-tab="gl" type="button">Гильдия</button>
                        <button class="chat-main-tab" data-tab="dm" type="button">Личные</button>
                    </div>
                    <span class="chat-close" id="chat-close-btn" title="Закрыть">✖</span>
                </div>
                <div class="chat-messages" id="chat-messages"></div>
                <div class="chat-input-area">
                    <input type="text" class="chat-input" id="chat-input" placeholder="Написать в чат города..." maxlength="200">
                    <button class="chat-send" id="chat-send" type="button">➤</button>
                </div>`;
            this.widget = widget;

            // Делегирование событий: клики по вкладкам/кнопкам внутри PiP-окна.
            widget.addEventListener('click', (e) => {
                const target = e.target?.closest ? e.target : (e.target?.parentElement || e.target);
                if (!target || !target.closest) return;

                if (target.closest('#chat-close-btn') || target.closest('.chat-close')) {
                    e.preventDefault();
                    this.close();
                    return;
                }

                if (target.closest('#chat-send') || target.closest('.chat-send')) {
                    e.preventDefault();
                    this.send();
                    return;
                }

                const mainTab = target.closest('.chat-main-tab');
                if (mainTab) {
                    e.preventDefault();
                    // Ищем вкладки в документе PiP-окна, а не в this.widget:
                    // после пересоздания окна ссылка на виджет может быть устаревшей.
                    const tabDoc = this._pipDoc || (this.widget && this.widget.ownerDocument) || mainTab.ownerDocument;
                    const nextTab = mainTab.getAttribute('data-tab')
                        || (mainTab.dataset && mainTab.dataset.tab) || 'g';
                    // Неизвестный ключ не должен «терять» ленту — падаем на общий чат.
                    this.activeTab = CHAT_TABS.indexOf(nextTab) !== -1 ? nextTab : 'g';
                    if (tabDoc) {
                        tabDoc.querySelectorAll('.chat-main-tab').forEach(t => t.classList.remove('active'));
                    }
                    mainTab.classList.add('active');
                    this._syncTabs(tabDoc);
                    this.updateInputState();
                    this.renderMessages();
                    return;
                }
            });

            const inp = this.widget.querySelector('#chat-input');
            if (inp) {
                // keydown вместо keypress: keypress не срабатывает для части
                // раскладок/методов ввода и помечен как deprecated.
                inp.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.send();
                    }
                });
            }

            // Восстанавливаем активную вкладку: DOM пересоздаётся при каждом открытии PiP,
            // а состояние (g/tr/mn/gl/dm) хранится в Chat.activeTab.
            // Передаём сам виджет: он ещё не вставлен в документ, и querySelectorAll
            // по документу его вкладок не найдёт (по элементу — найдёт).
            this._syncTabs(widget);

            this.setupDrag();
            this.syncMe();
            return widget;
        },

        setupDrag() {
            // Виджет теперь живёт только внутри PiP-окна и растянут на всё окно,
            // поэтому перетаскивание не нужно. Код оставлен на случай возврата
            // обычного виджета. // TODO: REMOVE
            if (this._popoutWin) return;

            const handle = this.widget?.querySelector('#chat-drag-handle') || document.getElementById('chat-drag-handle');
            if (!handle) return;
            let dragging = false, offX = 0, offY = 0;
            handle.addEventListener('pointerdown', (e) => {
                // Если чат вынесен в отдельное PiP-окно, перетаскивание внутри виджета отключаем
                if (this._popoutWin) return;

                const target = e.target?.closest ? e.target : (e.target?.parentElement || e.target);
                if (!target || !target.closest) return;

                // Проверка: клик по кнопке, вкладке, скроллбару или инпуту отменяет перетаскивание
                if (
                    target.closest('button') ||
                    target.closest('.chat-tab') ||
                    target.closest('.chat-main-tab') ||
                    target.closest('.chat-sub-tab') ||
                    target.closest('.chat-close') ||
                    target.closest('input, textarea, select')
                ) {
                    return;
                }

                // Проверка клика по полосе прокрутки
                if (e.offsetX > handle.clientWidth || e.offsetY > handle.clientHeight) {
                    return;
                }

                dragging = true;
                try { handle.setPointerCapture(e.pointerId); } catch (_) {}
                const r = this.widget.getBoundingClientRect();
                offX = e.clientX - r.left;
                offY = e.clientY - r.top;
                this.widget.style.left = r.left + 'px';
                this.widget.style.top = r.top + 'px';
                this.widget.style.right = 'auto';
                this.widget.style.bottom = 'auto';
            });
            handle.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                this.widget.style.left = (e.clientX - offX) + 'px';
                this.widget.style.top = (e.clientY - offY) + 'px';
            });
            const stopDrag = (e) => {
                if (!dragging) return;
                dragging = false;
                try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
            };
            handle.addEventListener('pointerup', stopDrag);
            handle.addEventListener('pointercancel', stopDrag);

            // 7TV (размер смайлов, загрузка эмоутов, кнопка настроек канала)
            // перенесён в init(): он нужен PiP-чату даже при закрытом окне.
        },

        open7tvSettings() {
            const modal = UI.showModal(`
                <h2>🎭 Настройки 7TV <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="padding: 10px;">
                    <div style="font-size: 13px; color: #aaa; margin-bottom: 15px;">
                        Введите Twitch-ник канала, эмоуты которого хотите видеть (например, zakvielchannel).
                    </div>
                    <input type="text" id="t7-channel-input" class="search-bar" style="width: 100%; margin-bottom: 15px;" value="${Utils.escapeHtml(SevenTV.channel)}" placeholder="Ник на Twitch">
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:15px; border-top:1px solid #333; padding-top:15px;">
                        <span style="font-size:13px; color:#aaa;">Размер:</span>
                        <div style="display:flex; gap:5px;">
                            ${Object.entries(SevenTV.SIZES).map(([key, conf]) => `
                                <button class="t7-size-btn" data-size="${key}" style="padding:5px 12px; border-radius:6px; border:1px solid ${SevenTV.size === key ? '#9146ff' : '#444'}; background:${SevenTV.size === key ? '#9146ff' : '#111'}; color:#fff; cursor:pointer; font-weight:bold;">
                                    ${conf.label}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    <button id="t7-save-btn" style="width: 100%; padding: 10px; background: #caa55c; color: #1d1620; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">Сохранить и загрузить</button>
                </div>
            `, { compact: true });

            const input = modal?.querySelector('#t7-channel-input');
            const saveBtn = modal?.querySelector('#t7-save-btn');
            if (!input || !saveBtn) return;

            // Мгновенная смена размера смайлов + сохранение в localStorage.
            modal.querySelectorAll('.t7-size-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    SevenTV.size = btn.dataset.size;
                    try {
                        localStorage.setItem(SevenTV.SIZE_KEY, SevenTV.size);
                    } catch (e) {
                        dbg('[7TV] Не удалось сохранить размер', e);
                    }
                    SevenTV.applySize();

                    // Обновляем визуал кнопок
                    modal.querySelectorAll('.t7-size-btn').forEach(b => {
                        const isActive = b.dataset.size === SevenTV.size;
                        b.style.border = isActive ? '1px solid #9146ff' : '1px solid #444';
                        b.style.background = isActive ? '#9146ff' : '#111';
                    });
                });
            });

            saveBtn.addEventListener('click', async () => {
                const nick = String(input.value || '').trim().toLowerCase();
                const nextChannel = nick || SevenTV.DEFAULT_CHANNEL;

                // Канал не изменился — просто закрываем окно, без запросов к API.
                if (nextChannel === SevenTV.channel) {
                    UI.closeModals();
                    return;
                }

                // Канал изменился — сохраняем и принудительно перезагружаем набор.
                try {
                    localStorage.setItem(SevenTV.CHANNEL_KEY, nick);
                } catch (e) {
                    dbg('[7TV] Не удалось сохранить канал', e);
                }
                SevenTV.channel = nextChannel;
                UI.closeModals();
                UI.showToast('Загрузка эмоутов канала...');
                await SevenTV.load(true); // Принудительная перезагрузка
                this.renderMessages();    // Перерисовать чат (если открыт)
                UI.showToast(`Эмоуты обновлены (${SevenTV.emotes.size} шт)`);
            });
        },

        // Открыть ЛС с игроком в вынесенном чате (используется тостами ЛС).
        async openDM(nick) {
            if (!nick) return;
            if (this.disabled) {
                UI.showToast('🚫 Чат отключен в настройках FAB', true);
                return;
            }

            this.dmTarget = nick;

            // Переключаем вкладку на личные сообщения
            this.activeTab = 'dm';

            // Виджет живёт только в PiP-окне: если оно закрыто — открываем.
            if (!this._pipRoot()) await this.popoutChat();
            if (!this._pipRoot()) return;

            // Синхронизируем UI (подсветка вкладок, поле ввода)
            this._syncTabs();

            // Диалог открыт — снимаем счётчик непрочитанных
            if (typeof Players !== 'undefined' && typeof Players.clearUnreadDM === 'function') {
                Players.clearUnreadDM(nick);
            }

            this.updateInputState();
            this.renderMessages();
        },

        close() {
            if (this._popoutWin) {
                try { this._popoutWin.close(); } catch(e) {}
            }
            // DOM чата живёт в PiP-окне и умирает вместе с ним.
            this._popoutWin = null;
            this._pipDoc = null;
            this.widget = null;
            // ВАЖНО: stopBackgroundLiveListener() здесь НЕ вызываем. Фоновый
            // слушатель запущен специально, чтобы ловить непрочитанные ЛС/чат при
            // закрытом PiP. Останавливает его только shutdown() в main.js.
        },

        async popoutChat() {
            if (this.disabled) {
                UI.showToast('🚫 Чат отключен в настройках FAB', true);
                return;
            }

            if (this._popoutWin) {
                if (!this._popoutWin.closed) {
                    try { this._popoutWin.focus(); } catch (e) {}
                    return;
                }
                // Окно закрылось без pagehide (kill процесса) — сбрасываем ссылки
                this._popoutWin = null;
                this._pipDoc = null;
                this.widget = null;
            }

            try {
                let win = null;

                // 1. Проверяем API documentPictureInPicture
                if (window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function') {
                    // Не открывать второй PiP, если первый уже висит
                    if (window.documentPictureInPicture.window) {
                        const existing = window.documentPictureInPicture.window;
                        try { existing.focus(); } catch (e) {}
                        this._popoutWin = existing;
                        this._pipDoc = existing.document;
                        // v11.6.0h.2: PiP мог остаться от прошлого запуска
                        // скрипта — правил подсветки в нём тогда нет.
                        this._applyAddonStylesToPip(this._pipDoc);
                        // Если DOM чата в окне почему-то потерялся — собираем заново.
                        if (!this._pipRoot()) {
                            try { existing.document.body.appendChild(this._buildWidget(existing.document)); } catch (e) {}
                        }
                        SevenTV.applySize();
                        this.unreadCount = 0;
                        this.updateBadge();
                        this.renderMessages();
                        this.updateInputState();
                        return;
                    }
                    try {
                        win = await window.documentPictureInPicture.requestWindow({ width: 350, height: 500 });
                    } catch (pipErr) {
                        dbg('documentPictureInPicture error:', pipErr);
                        // Не падаем в window.open молча — это источник about:blank.
                        UI.showToast('PiP недоступен: ' + (pipErr.message || 'unknown'), true);
                        return;
                    }
                }

                // 2. Резервный путь только если PiP API вообще нет (не Chrome)
                if (!win) {
                    try {
                        win = window.open('', 'LegionChatPopout', 'width=350,height=500,resizable=yes,scrollbars=no');
                    } catch (e) {}
                }

                if (!win) {
                    UI.showToast('Не удалось открыть окно чата', true);
                    return;
                }

                this._popoutWin = win;
                this._pipDoc = win.document;

                // 3. Копируем все CSS стили в новое окно
                try {
                    [...document.styleSheets].forEach(sheet => {
                        try {
                            // v11.6.0h.2: простыню подсветки ников не копируем —
                            // в PiP её генерирует _applyAddonStylesToPip().
                            // Иначе в окне остался бы «снимок» старых правил,
                            // который нельзя погасить тумблером.
                            if (sheet.ownerNode && sheet.ownerNode.id === 'lg-addon-hl-styles') return;
                            if (sheet.href) {
                                const link = win.document.createElement('link');
                                link.rel = 'stylesheet';
                                link.href = sheet.href;
                                win.document.head.appendChild(link);
                            } else if (sheet.cssRules) {
                                const style = win.document.createElement('style');
                                for (const rule of sheet.cssRules) {
                                    style.appendChild(win.document.createTextNode(rule.cssText));
                                }
                                win.document.head.appendChild(style);
                            }
                        } catch (e) {}
                    });

                    document.querySelectorAll('style').forEach(s => {
                        try {
                            // Наша простыня подсветки — тоже мимо (см. выше).
                            if (s.id === 'lg-addon-hl-styles') return;
                            const style = win.document.createElement('style');
                            style.textContent = s.textContent;
                            win.document.head.appendChild(style);
                        } catch (e) {}
                    });

                    const baseStyle = win.document.createElement('style');
                    baseStyle.textContent = `
                        html, body {
                            color-scheme: dark;
                            color: #f7eadf;
                            background: #1a1418;
                            margin: 0;
                            padding: 0;
                            width: 100%;
                            height: 100%;
                            overflow: hidden;
                            font-family: 'Nunito', sans-serif;
                        }
                        .chat-pip {
                            display: flex !important;
                            flex-direction: column !important;
                            height: 100% !important;
                            width: 100% !important;
                            overflow: hidden !important;
                        }
                        .chat-top-bar, .chat-sub-tabs {
                            flex-shrink: 0 !important;
                        }
                        .chat-messages {
                            flex: 1 1 0% !important; /* Жестко задаем базовый размер 0, чтобы контейнер сжимался */
                            min-height: 0 !important;
                            overflow-y: auto !important;
                            display: flex !important;
                            flex-direction: column !important;
                        }
                        .chat-input-area {
                            flex-shrink: 0 !important;
                            background: #111;
                            border-top: 1px solid #333;
                            padding: 10px;
                            display: flex;
                            gap: 5px;
                        }
                    `;
                    win.document.head.appendChild(baseStyle);
                    win.document.title = '💬 Чат Legion';
                } catch (e) {
                    dbg('Error copying styles to popout window:', e);
                }

                // v11.6.0h.2: CSS-подсветка ников для документа PiP-окна.
                // Своя простыня нужна отдельно: document-правила из основной
                // страницы на другой документ не действуют.
                this._applyAddonStylesToPip(win.document);

                // Размер смайлов 7TV задаётся CSS-переменной — переносим её в PiP.
                SevenTV.applySize();

                // 4. DOM чата собираем сразу в документе PiP-окна:
                //    в основной странице встроенного виджета больше нет (v11.5.3).
                const widget = this._buildWidget(win.document);
                win.document.body.appendChild(widget);

                // 5. Очистка ссылок при закрытии окна: DOM чата умирает вместе с PiP,
                //    возвращать его в основную страницу больше не нужно.
                const cleanupPip = () => {
                    if (!this._popoutWin) return;
                    this._popoutWin = null;
                    this._pipDoc = null;
                    this.widget = null;
                    // Фоновый слушатель не останавливаем: он должен продолжать
                    // считать непрочитанные сообщения после закрытия PiP.
                };

                win.addEventListener('pagehide', cleanupPip);
                win.addEventListener('unload', cleanupPip);

                this.startBackgroundLiveListener();

                // Открыли чат — счётчик непрочитанных сбрасываем.
                this.unreadCount = 0;
                this.updateBadge();

                // История (кэш localStorage + /api/city/enter) нужна, чтобы PiP
                // открывался уже с сообщениями. loadHistory сам вызовет renderMessages.
                this.loadHistory();
                this.renderMessages();
                this.updateInputState();
                UI.showToast('📺 Чат вынесен в отдельное окно');
            } catch (err) {
                dbg('Popout chat failed:', err);
                UI.showToast('Ошибка при открытии окна чата', true);
            }
        },

        // Клик по нику автора: вставляем «@Ник » в поле ввода
        insertMention(nick) {
            if (!nick) return;
            const inp = this._pipEl('#chat-input');
            if (!inp || inp.disabled) return;
            const mention = '@' + nick + ' ';
            const val = inp.value || '';
            let start = typeof inp.selectionStart === 'number' ? inp.selectionStart : val.length;
            let end = typeof inp.selectionEnd === 'number' ? inp.selectionEnd : val.length;
            if (start > val.length) start = val.length;
            if (end > val.length) end = val.length;
            inp.value = val.slice(0, start) + mention + val.slice(end);
            const pos = start + mention.length;
            try { inp.setSelectionRange(pos, pos); } catch (e) {}
            inp.focus();
        },

        // Все диалоги ЛС: ключи LEGION_DM_HISTORY_* в localStorage
        getDMDialogs() {
            const dialogs = [];
            const myNick = (this.myNick || '').toLowerCase();
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const storageKey = localStorage.key(i);
                    if (!storageKey || !storageKey.startsWith('LEGION_DM_HISTORY_')) continue;
                    const nickKey = storageKey.slice('LEGION_DM_HISTORY_'.length);
                    if (!nickKey) continue;
                    let history = [];
                    try {
                        const rawHistory = JSON.parse(localStorage.getItem(storageKey) || '[]');
                        if (Array.isArray(rawHistory)) history = rawHistory;
                    } catch (e) { history = []; }
                    const last = history[history.length - 1] || null;
                    let peerNick = nickKey;
                    if (last) {
                        // Ник собеседника — участник диалога, совпадающий с ключом хранилища
                        const candidates = [last.from, last.to].filter(Boolean);
                        const matched = candidates.find(n => String(n).toLowerCase() === nickKey);
                        peerNick = matched || ((last.from && String(last.from).toLowerCase() !== myNick) ? last.from : (last.to || nickKey));
                    }
                    const unread = (typeof Players !== 'undefined' && typeof Players.getUnreadDM === 'function')
                        ? Players.getUnreadDM(nickKey) : 0;
                    dialogs.push({ key: nickKey, nick: peerNick || nickKey, last, ts: (last && last.ts) || 0, unread });
                }
            } catch (e) {}
            return dialogs.sort((a, b) => ((b.unread > 0) ? 1 : 0) - ((a.unread > 0) ? 1 : 0) || (b.ts - a.ts));
        },

        // Список диалогов во вкладке «✉️ ЛС»
        renderDMDialogList(box) {
            const ownerDoc = box.ownerDocument || document;
            const dialogs = this.getDMDialogs();
            box.innerHTML = '';
            if (dialogs.length === 0) {
                box.innerHTML = `<div style="color:#888; text-align:center; padding:25px 15px; font-style:italic;">Диалогов пока нет.<br><span style="font-size:12px;">Откройте Досье игрока или напишите «/w Ник текст».</span></div>`;
                return;
            }
            dialogs.forEach(d => {
                const row = ownerDoc.createElement('div');
                row.className = 'chat-dialog-row';
                row.setAttribute('data-nick', d.nick);
                row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 10px; background:#26202e; border:1px solid #44374a; border-radius:6px; margin-bottom:6px; cursor:pointer;';
                const preview = d.last ? String(d.last.text || '').slice(0, 45) : '';
                const unreadBadge = d.unread > 0
                    ? `<span style="background:#ff3b5c; color:#fff; font-size:10px; font-weight:bold; padding:1px 6px; border-radius:10px;">${d.unread}</span>`
                    : '';
                row.innerHTML = `
                    <div style="min-width:0;">
                        <div style="font-weight:bold; color:#f7eadf; font-size:13px;">${Utils.escapeHtml(d.nick)}</div>
                        <div style="color:#aaa; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${Utils.escapeHtml(preview)}</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        <span style="color:#8899aa; font-size:10px;">${Utils.escapeHtml((d.last && d.last.time) || '')}</span>
                        ${unreadBadge}
                    </div>`;
                row.addEventListener('click', () => {
                    // Диалог открывается прямо в виджете, нативный чат игры не трогаем
                    if (typeof Players !== 'undefined' && typeof Players.clearUnreadDM === 'function') {
                        Players.clearUnreadDM(d.nick);
                    }
                    this.dmTarget = d.nick;
                    this.updateInputState();
                    this.renderMessages();
                });
                box.appendChild(row);
            });
        },

        // Функция отрисовки (вызывается при клике на вкладки и приходе новых сообщений)
        renderMessages() {
            // Лента сообщений живёт в документе PiP-окна: если окно закрыто,
            // рендерить некуда — сообщения просто копятся в this.messages.
            // ВАЖНО: контейнер должен браться из актуального документа PiP-окна.
            // this.widget может указывать на устаревший (detached) DOM.
            const box = (this._pipDoc && this._pipDoc.querySelector('#chat-messages')) || this._pipEl('#chat-messages');
            if (!box) return;

            // Подсветка вкладок всегда соответствует Chat.activeTab:
            // раньше active-класс мог накапливаться сразу на нескольких вкладках.
            this._syncTabs();

            // Окно чата открыто (контейнер найден) — непрочитанных быть не должно.
            // Гасим счётчик прямо здесь: он копился, если инкремент успевал
            // пройти до/во время открытия PiP.
            if (this.unreadCount !== 0) {
                this.unreadCount = 0;
                this.updateBadge();
            }

            // Запоминаем позицию ДО очистки: если пользователь читает историю,
            // новый рендер не должен утаскивать его вниз.
            const wasAtBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 50;
            const prevScrollTop = box.scrollTop;
            const prevDmBox = box.querySelector('.chat-dm-messages');
            const dmWasAtBottom = prevDmBox ? (prevDmBox.scrollHeight - prevDmBox.scrollTop - prevDmBox.clientHeight) < 50 : true;
            const dmPrevScrollTop = prevDmBox ? prevDmBox.scrollTop : 0;

            box.innerHTML = '';

            // Вкладка «Личные»: либо открытый диалог, либо список всех диалогов
            if (this.activeTab === 'dm') {
                if (this.dmTarget) {
                    const ownerDoc = box.ownerDocument || document;

                    // Шапка диалога
                    box.innerHTML = `<div style="padding: 5px 10px; border-bottom: 1px solid #44374a; display: flex; justify-content: space-between; align-items: center; background: #2a2030; flex-shrink: 0;">
                        <span style="font-weight: bold; color: #ffcf6a;">Диалог с ${Utils.escapeHtml(this.dmTarget)}</span>
                        <button id="dm-back-btn" style="background: none; border: 1px solid #ff8fa3; color: #ff8fa3; border-radius: 4px; padding: 2px 6px; cursor: pointer; font-size: 11px;">Назад</button>
                    </div>`;

                    // Контейнер для сообщений
                    const msgContainer = ownerDoc.createElement('div');
                    msgContainer.className = 'chat-dm-messages';
                    msgContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 10px; overflow-y: auto; flex: 1;';
                    box.appendChild(msgContainer);

                    // Загружаем историю (используем метод из Players)
                    const history = Players.getDMHistory(this.dmTarget);
                    const myNick = (this.myNick || '').toLowerCase();

                    if (history.length === 0) {
                        msgContainer.innerHTML = `<div style="text-align:center; color:#888; font-style:italic; margin:auto;">История пуста...</div>`;
                    } else {
                        history.forEach(m => {
                            const isMe = (m.from || '').toLowerCase() === myNick || m.from === 'Я';
                            const div = ownerDoc.createElement('div');
                            div.style.cssText = `align-self: ${isMe ? 'flex-end' : 'flex-start'}; max-width: 80%; background: ${isMe ? '#1d3827' : '#282030'}; border: 1px solid ${isMe ? '#2e5d3e' : '#4d3a5a'}; border-radius: 8px; padding: 6px 10px; color: #fff; word-break: break-word;`;
                            div.innerHTML = `<div style="font-size:13px; line-height:1.4;">${SevenTV.replaceEmotes(m.text)}</div><div style="font-size:10px; color:#aaa; text-align:right; margin-top:2px;">${Utils.escapeHtml(m.time || '')}</div>`;
                            msgContainer.appendChild(div);
                        });
                        SevenTV.decorate(msgContainer);
                        // Вниз — только если пользователь и так был внизу.
                        if (dmWasAtBottom) msgContainer.scrollTop = msgContainer.scrollHeight;
                        else msgContainer.scrollTop = dmPrevScrollTop;
                    }

                    // Обработчик кнопки "Назад"
                    box.querySelector('#dm-back-btn').onclick = () => {
                        this.dmTarget = null;
                        this.updateInputState();
                        this.renderMessages();
                    };
                } else {
                    this.renderDMDialogList(box);
                }
                return; // Важно: выходим, чтобы не рендерить общий чат
            }

            // Заглушка, если игрок находится в городе (§ Задача 2 & 4)
            if (this.activeTab === 'mn' && !this.isInMine()) {
                box.innerHTML = `
                    <div style="color:#aaa; text-align:center; padding:35px 15px; font-style:italic; line-height:1.6;">
                        <span style="font-size:32px; display:block; margin-bottom:8px;">⛏️</span>
                        <b style="color:#ffcf6a; font-size:14px;">Вы находитесь в городе.</b><br>
                        Чат шахты доступен только во время нахождения в шахте.
                    </div>`;
                return;
            }

            // ПАТЧ 11.6.4g: классификация сообщений по вкладкам — копия нативной
            // логики (reference/LegionFrontSRC/lib/site-chat.js: tabOf):
            //   • tb — готовый ярлык вкладки от сервера: 'gl' у гильдейских
            //     сообщений, 'ev' у системных событий (заточки/достижения);
            //   • rm/channel === 'mine' — сообщения шахты (в нативе тег rm: 'mine');
            //   • k: 'tr' — торговля, k: 'dm' — личные;
            //   • всё остальное — общий чат города.
            const tabOf = (m) => m.tb || ((m.rm === 'mine' || m.channel === 'mine')
                ? 'mn'
                : m.k === 'tr' ? 'tr'
                : m.k === 'dm' ? 'dm'
                : 'g');

            const tab = this.activeTab;
            const filtered = this.messages.filter(m => {
                const t = tabOf(m);
                if (tab === 'g') {
                    // Общий: живые сообщения города без торговли и событий.
                    return t === 'g' && !m.isSystem && !m.ev;
                }
                // Торговля/Ремёсла: только живые сообщения этой вкладки.
                if (tab === 'tr') return t === 'tr' && !m.isSystem;
                if (tab === 'mn') return t === 'mn' && !m.isSystem;
                // Гильдия: tb === 'gl' (системных сообщений в гильдии не бывает).
                if (tab === 'gl') return t === 'gl';
                // 'dm' отрисован отдельной ветвью выше и сюда не доходит.
                return false;
            });

            const ownerDoc = box.ownerDocument || document;

            filtered.slice(-150).forEach(m => {
                const meta = this.getRoleMeta(m.role, m.isSystem);
                const div = ownerDoc.createElement('div');
                div.className = 'chat-msg' + (m._pending ? ' pending' : '');

                const isStreamer = !m.isSystem && this.isStreamerMessage(m);
                const isMention = !m.isSystem && this.isMentionedMessage(m);

                if (isStreamer) div.classList.add('streamer-msg');
                if (isMention) div.classList.add('mention-msg');

                const streamerBadge = isStreamer 
                    ? `<span style="background:#ffd700; color:#1d1620; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:4px; margin-right:4px;">👑 Стример</span>` 
                    : '';
                const mentionBadge = isMention 
                    ? `<span style="background:#f7768e; color:#fff; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:4px; margin-right:4px;">🔔 Упоминание</span>` 
                    : '';

                let formattedText = (typeof SevenTV !== 'undefined' && SevenTV.replaceEmotes)
                    ? SevenTV.replaceEmotes(m.text)
                    : Utils.escapeHtml(m.text);
                if (isMention && this.myNick) {
                    const escNick = Utils.escapeRegex(Utils.escapeHtml(this.myNick));
                    const reg = new RegExp(`(@?${escNick})`, 'gi');
                    // Подсвечиваем ник только в текстовых узлах, не задевая атрибуты img эмоутов.
                    formattedText = formattedText.split(/(<[^>]*>)/).map(part =>
                        part.startsWith('<') ? part : part.replace(reg, '<mark style="background:rgba(247,118,142,0.35);color:#ff757f;padding:1px 3px;border-radius:3px;">$1</mark>')
                    ).join('');
                }

                // Бейдж титула (aw) перед ником автора
                let awardBadge = '';
                const aw = m.aw;
                if (Array.isArray(aw) && aw.length > 0 && aw[0] && typeof aw[0] === 'object') {
                    const award = aw[0];
                    awardBadge = `<span class="chat-award-badge" title="${Utils.escapeHtml(award.d || '')}" style="display:inline-block; background:rgba(202,165,92,0.15); border:1px solid #caa55c; color:#ffcf6a; font-size:10px; font-weight:bold; padding:1px 6px; border-radius:10px; margin-right:6px; vertical-align:middle;">${Utils.escapeHtml(award.i || '')} ${Utils.escapeHtml(award.n || '')}</span>`;
                }

                // Щиток модератора: сервер отдаёт статус отдельно от класса
                // (r: "mod"), поэтому рисуем его перед иконкой класса.
                const modBadge = m.rank === 'mod'
                    ? `<span class="chat-mod-badge" title="Модератор" style="display:inline-block; background:rgba(255, 207, 106, 0.15); border:1px solid #caa55c; color:#ffcf6a; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:4px; margin-right:4px; vertical-align:middle;">⚖️ Модер</span>`
                    : '';

                const authorNick = m.author || '';
                const isAddon = this.isAddonUser(authorNick);
                // v11.6.1c: бейджа «⚡» больше нет ни в HTML, ни в CSS — ник
                // остаётся чистым текстом. Класс .legion-addon-user оставляем:
                // по нему core/styles.js и динамическая простыня дают свечение.
                const addonClass = isAddon ? ' legion-addon-user' : '';
                // v11.6.0h: бирюзовый #00f0ff больше не подставляется — у ника
                // остаётся его родной цвет класса (meta.color), а свечение
                // .legion-addon-user рисуется через currentColor, т.е. в нём же.
                // Оставлять style пустым для addon-ников нельзя: правило
                // .chat-author в core/styles.js задаёт color !important и
                // перекрасило бы их в белый, потеряв и цвет, и оттенок свечения.
                const authorColor = meta.color || '#ffcf6a';
                const styleColor = `color: ${authorColor} !important; `;
                const authorHtml = `<span class="chat-author nick-clickable${addonClass}" data-nick="${Utils.escapeHtml(authorNick)}" title="Кликните, чтобы упомянуть" style="${styleColor}cursor: pointer;">${Utils.escapeHtml(authorNick)}</span>`;

                if (m.k === 'dm') {
                    div.innerHTML = `
                        <span style="background:#007bff; color:#fff; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:4px; margin-right:4px;">✉️ ЛС для ${Utils.escapeHtml(m.to || '')}</span>
                        ${modBadge}${awardBadge}${authorHtml}
                        <span class="chat-text" style="color: #6edff6 !important;">${formattedText}</span>
                    `;
                } else if (m.isSystem) {
                    div.innerHTML = `
                        ${modBadge}<span class="chat-role-icon">${meta.icon}</span>
                        <span class="chat-author" style="color: ${meta.color || '#ffcf6a'} !important;">${Utils.escapeHtml(m.author)}</span>
                        <span class="chat-text" style="color: #aaa !important; font-style: italic;">${formattedText}</span>
                    `;
                } else {
                    div.innerHTML = `
                        ${streamerBadge}${mentionBadge}${awardBadge}${modBadge}<span class="chat-role-icon">${meta.icon}</span>
                        ${authorHtml}
                        <span class="chat-envelope">✉️</span>
                        <span class="chat-text" style="color: #f7eadf !important;">${formattedText}</span>
                    `;
                }
                const nickEl = div.querySelector('.nick-clickable');
                if (nickEl) {
                    nickEl.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.insertMention(nickEl.getAttribute('data-nick'));
                    });
                }
                box.appendChild(div);
            });

            // 7TV-смайлики: подгружаем blob:-картинки для вставленных img.t7-emote.
            SevenTV.decorate(box);

            if (filtered.length === 0) {
                box.innerHTML = `<div style="color:#888; text-align:center; padding:20px; font-style:italic;">(Здесь пока пусто...)</div>`;
            }

            // Автоскролл: если пользователь был внизу ИЛИ последнее сообщение наше
            // (своё только что отправленное не должно «пропадать» под краем).
            const lastMsg = filtered[filtered.length - 1];
            const lastIsMine = lastMsg && (lastMsg._pending || lastMsg.author === this.myNick || (this.myNick && String(lastMsg.author || '').toLowerCase() === this.myNick.toLowerCase()));

            if (wasAtBottom || lastIsMine) {
                box.scrollTop = box.scrollHeight;
            } else {
                box.scrollTop = prevScrollTop;
            }
        },

        async send() {
            const input = this._pipEl('#chat-input');
            if (!input) return;
            const rawText = input.value.trim();
            if (!rawText) return;

            // Открыт диалог во вкладке «Личные» — отправляем ЛС прямо из виджета
            if (this.activeTab === 'dm' && this.dmTarget) {
                // Сначала проверяем, не команда ли это /w: иначе в текст сообщения
                // уйдёт «/w Ник привет» целиком, и собеседник получит команду как текст.
                const dmCmd = rawText.match(/^\/(?:w|dm|whisper)\s+(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+(.*))?$/i);
                const actualText = dmCmd ? (dmCmd[4] || '').trim() : rawText;
                if (!actualText) {
                    this.showError('Формат: /w Ник сообщение');
                    return;
                }
                if (typeof Players === 'undefined' || typeof Players.sendDM !== 'function') {
                    this.showError('Отправка ЛС недоступна');
                    return;
                }
                input.value = '';
                const ok = await Players.sendDM(this.dmTarget, actualText);
                if (ok) {
                    this.renderMessages(); // Перерисовываем историю с новым сообщением
                } else {
                    input.value = rawText; // Возвращаем текст, если ошибка
                }
                return; // Выходим, чтобы не отправлять в общий чат
            }

            if (this.activeTab === 'dm') {
                this.showError('Выберите диалог в списке «Личные»');
                return;
            }
            if (this.cooldownUntil && Date.now() < this.cooldownUntil) {
                this.showError('Подождите перед отправкой...');
                return;
            }

            // ЛС: /w nick text, /dm nick text, /whisper nick text.
            // «@nick текст» — это НЕ ЛС, а обычное сообщение в общий чат (упоминание).
            const dmMatch = rawText.match(/^\/(?:w|dm|whisper)\s+(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+(.*))?$/i);

            let isMine = false;
            let mineId = null;
            let toUser = null;
            let cleanText = rawText;

            if (dmMatch) {
                toUser = (dmMatch[1] || dmMatch[2] || dmMatch[3] || '').trim();
                cleanText = (dmMatch[4] || '').trim();
                if (!toUser || !cleanText) {
                    this.showError('Формат: /w Ник сообщение');
                    return;
                }
            } else if (this.activeTab === 'mn') {
                if (!this.isInMine()) {
                    this.showError('Чат шахты доступен только в шахте');
                    return;
                }
                isMine = true;
                mineId = this.getMineId() || 'home';
            }

            input.value = '';
            const channel = dmMatch ? 'city' : (isMine ? 'mine' : 'city');

            const local = { 
                author: this.myNick, 
                text: dmMatch ? cleanText : rawText, 
                to: toUser,
                k: dmMatch ? 'dm' : (!isMine && this.activeTab === 'tr' ? 'tr' : undefined),
                role: this.myRole, 
                isSystem: false, 
                id: null, 
                seq: null, 
                channel,
                ts: Date.now(), 
                _pending: true 
            };
            this.messages.push(local);
            this.renderMessages();

            // 3. ПРОГРЕВ СЕССИИ: если отправляем в город (или ЛС), находясь в шахте
            if (!isMine && this.isInMine()) {
                try {
                    // ВАЖНО: чистый fetch, а не Utils.fetchApi — тот возьмёт контекст
                    // ШАХТЫ, и прогрев улетит не туда, дав 409 при отправке в город.
                    // ПАТЧ 11.6.4h: адрес собираем через Utils.apiPath, иначе запрос
                    // уходил в корень домена мимо /c/<channel>/ и получал 404.
                    await fetch(Utils.apiPath('/api/city/enter'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({})
                    });
                } catch (warmErr) {
                    dbg('City session warmup failed:', warmErr);
                }
            }

            try {
                let res;
                let data = null;

                // ПАТЧ 11.6.4h: адрес всегда собираем через Utils.apiPath — он
                // добавляет префикс /c/<channel>/. Голый fetch('/api/...') уходил
                // в корень домена (play.multidonate.ru/api/...) и получал 404:
                // переписывание путей делает window.fetch самой страницы, а из
                // песочницы Tampermonkey запрос идёт мимо него.
                let endpoint = '/api/chat/say';
                let payload = {};
                if (dmMatch) {
                    // ЛС — отдельный эндпоинт, тело { to, text }.
                    endpoint = '/api/dm/say';
                    payload = { to: toUser, text: cleanText };
                } else if (this.activeTab === 'gl') {
                    // Гильдия: ВАЖНО — поле 't', а не 'text'.
                    endpoint = '/api/guilds/say';
                    payload = { t: rawText };
                } else if (this.activeTab === 'mn') {
                    // Ремёсла/шахта: комнату сервер определяет по текущей сессии,
                    // поэтому c= в теле и в URL не нужен.
                    endpoint = '/api/chat/say';
                    payload = { room: 'mine', text: rawText };
                } else if (this.activeTab === 'tr') {
                    // Торговля — общая комната города с флагом k: 'tr'.
                    endpoint = '/api/chat/say';
                    payload = { room: 'city', k: 'tr', text: rawText };
                } else {
                    // Общий чат города.
                    endpoint = '/api/chat/say';
                    payload = { room: 'city', text: rawText };
                }

                res = await fetch(Utils.apiPath(endpoint), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify(payload)
                });
                data = await res.json().catch(() => null);

                // ПАТЧ 11.6.4h: фолбэк на старые адреса — если сервер не знает
                // новый эндпоинт. Все адреса строго через Utils.apiPath, иначе они
                // тоже улетали бы в корень домена. На rate_limited не ретраим,
                // чтобы не получить двойной запрос.
                const unknownEndpoint = !!res && (
                    res.status === 404
                    || (data && (data.error === 'not_found' || data.error === 'method_not_allowed'))
                );
                if (unknownEndpoint && dmMatch) {
                    // Старый путь ЛС: комната города с флагом k: 'dm'.
                    res = await fetch(Utils.apiPath('/api/city/say'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ text: cleanText, to: toUser, k: 'dm' })
                    });
                    data = await res.json().catch(() => null);
                } else if (unknownEndpoint && this.activeTab === 'gl') {
                    // Для гильдии фолбэка нет: /api/guilds/say — единственный путь.
                } else if (unknownEndpoint && isMine) {
                    // Старый путь шахты: обязательный параметр c=.
                    res = await fetch(Utils.apiPath(`/api/mine/chat/say?c=${encodeURIComponent(mineId)}`), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ text: rawText })
                    });
                    data = await res.json().catch(() => null);
                } else if (unknownEndpoint) {
                    // Старый путь города: общий чат либо торговля (k: 'tr').
                    res = await fetch(Utils.apiPath('/api/city/say'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify(this.activeTab === 'tr'
                            ? { text: rawText, k: 'tr' }
                            : { text: rawText })
                    });
                    data = await res.json().catch(() => null);
                }

                const httpOk = !!(res && res.ok);
                if (!httpOk || (data && data.ok === false)) {
                    // откат
                    this.messages = this.messages.filter(m => m !== local);
                    input.value = rawText;
                    this.renderMessages();
                    const errMsg = (data && (data.error || data.err)) || (res ? `HTTP ${res.status}` : 'Ошибка сети');
                    this.showError(errMsg);
                    if ((res && res.status === 429) || /не так быстро/i.test(errMsg)) {
                        this.cooldownUntil = Date.now() + 5000;
                    }
                    return;
                }

                // Успешная отправка
                local._pending = false;
                if (data) {
                    const msg = data.msg || data;
                    if (msg.id) local.id = msg.id;
                    if (msg.s) local.seq = msg.s;

                    // ЗАЩИТА: обновляем ник только если пришло поле l (login).
                    // Поле n (name/титул) игнорируем, иначе можно стать "Первопроходцем".
                    if (msg.l && typeof msg.l === 'string' && msg.l.length >= 2) {
                        this.myNick = msg.l;
                        local.author = this.myNick;
                    }
                    if (Array.isArray(data.m) && data.m.length > 0) {
                        this.processMineMessages(data.m);
                    }
                }
                // Гарантируем сохранение своего сообщения в кэш: эхо из потока
                // может не прийти вовсе либо прийти с чужим каналом.
                this.cacheOwnMessage(local);
                this.renderMessages();

                // Если это было ЛС, сохраняем в историю диалогов игрока
                if (dmMatch && toUser) {
                    if (typeof Players !== 'undefined' && typeof Players.saveDMMessage === 'function') {
                        const myNick = this.myNick || 'Я';
                        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        Players.saveDMMessage(toUser, {
                            from: myNick,
                            to: toUser,
                            text: cleanText,
                            time: timeStr,
                            ts: Date.now()
                        });
                        if (Players.currentDMPeer && Players.currentDMPeer.toLowerCase() === toUser.toLowerCase()) {
                            Players.renderDMMessages(toUser);
                        }
                    }
                }
            } catch (e) {
                this.messages = this.messages.filter(m => m !== local);
                input.value = rawText;
                this.renderMessages();
                this.showError('Сбой сети');
            }
        },
    };

    // ===== src/modules/chat/chat.js =====
    // ============================================================
    // 7. МОДУЛЬ: ЧАТ (фасад)
    // ============================================================
    // Чат разложен на независимые слои (src/modules/chat/):
    //   • chat-emotes.js — 7TV-смайлики и их кэш;
    //   • chat-history.js — localStorage-кэш и /api/city/enter;
    //   • chat-net.js — перехватчики сети и разбор входящих;
    //   • chat-pip.js — DOM/PiP-окно, рендер и отправка.
    // Слои — обычные объекты, методы которых рассчитывают на this === Chat,
    // поэтому склеиваются через Object.assign ниже. Внешний контракт
    // (Chat.popoutChat / renderMessages / startNetworkObserver для ui.js,
    // players.js и main.js) при этом не меняется.
    // 11.6.4b: interceptFetch удалён, его место занял startNetworkObserver.

    const Chat = {
        badge: null,
        unreadCount: 0,
        disabled: localStorage.getItem('LEGION_CHAT_DISABLED') === 'true',
        // v11.6.0h: подсветка ников пользователей аддона (⚡ + свечение в
        // родном цвете ника). Цвет НЕ перекрашивается — он остаётся игровым.
        // По умолчанию включена: ключа нет -> true; выключение пишет
        // строку 'false' (паттерн LEGION_AUC_SOUND). Настройка живёт в
        // localStorage, т.к. это UI-предпочтение, а не серверные данные.

        addonHighlight: localStorage.getItem('LEGION_ADDON_HIGHLIGHT') !== 'false',
        _inited: false,
        // ПАТЧ 11.6.4f: состояние хука нативной ленты LGChatOne и Keep-Alive.
        // _nativeChatOrig — оригинальные onFeed/enterFeed, чтобы снять хук при
        // выключении перехвата/перезапуске; _nativeWatchTimer — интервал watch.
        _nativeWatchTimer: null,
        _nativeChatOrig: null,
        messages: [], // Массив всех сообщений
        // ПАТЧ 11.6.4g: одна активная вкладка в терминах нативного чата игры
        // (reference/LegionFrontSRC/lib/site-chat.js: TABS = g/tr/mn/gl/dm).
        // Раньше было две оси — activeMainTab (city/mine/dm) и activeSubTab
        // (general/trade/ach): «Шахта» и «Торговля» жили в разных полях, и
        // подсветка вкладок рассинхронивалась.
        activeTab: 'g',
        // v11.6.0g-5: ник — это ME.user (page-context), а не LG_CH: в LG_CH
        // лежит логин Twitch-канала, из-за него в чат/HUD попадал чужой ник.
        // Если ME ещё пуст — ник придёт асинхронно из syncMe().
        // Хардкод чужого ника опаснее пустого значения: до ответа /api/me лучше null.
        myNick: (typeof unsafeWindow !== 'undefined' && (unsafeWindow.ME?.user?.login || unsafeWindow.ME?.user?.name)) || null,
        myRole: 'legionary',
        dmTarget: null, // Ник собеседника, с которым сейчас открыт диалог во вкладке ЛС
        currentMineId: 'home',
        SevenTV: ChatEmotes.SevenTV, // тот же объект, что и const SevenTV

        // v11.6.0g-3: ники, которые прямо сейчас играют с аддоном, в нижнем
        // регистре. Источник — GET /users сервера пати; наполняет
        // ChatNet.syncAddonUsers(). Пустой Set = подсветки нет.
        addonUsers: new Set(),

        /**
         * Есть ли ник в списке пользователей аддона.
         * Сервер отдаёт ники в нижнем регистре, а в сообщениях автор приходит
         * как в игре — поэтому сравниваем нормализованно.
         */
        isAddonUser(nick) {
            // Единый гейт подсветки. С v11.6.0h.2 нативную ленту красит CSS
            // (ChatNet._buildAddonStylesCss смотрит на addonHighlight сам),
            // а этот метод спрашивает PiP-рендер — по нему он ставит класс
            // .legion-addon-user (свечение) на .chat-author.
            if (this.addonHighlight === false) return false;
            if (!nick || this.addonUsers.size === 0) return false;
            return this.addonUsers.has(String(nick).trim().toLowerCase());
        },

        isOpen() {
            // Чат существует только внутри PiP-окна.
            // Опираемся на ссылки окно/документ, а не на isConnected: проверка
            // связности внутри PiP-документа нестабильна, из-за чего сообщения
            // при открытом чате продолжали копить непрочитанные.
            if (!this._popoutWin || this._popoutWin.closed) return false;
            return !!(this._pipDoc || this.widget);
        },

        getMineId() {
            return this.currentMineId 
                || (location.search.match(/[?&]c=([^&]+)/)?.[1]) 
                || 'home';
        },

        isInMine() {
            return !!document.querySelector('.mn-world') ||
                   !!document.querySelector('.mn-screen') ||
                   !!document.querySelector('.mn-heroes') ||
                   (location.pathname.includes('/mine') && location.search.includes('sid='));
        },

        /**
         * Вернуть нативный чат игры в шахту (v11.6.4d).
         *
         * LGChatOne — общий чат города/шахты: dock(k, root) регистрирует сцену,
         * а place() переносит блок в последнюю видимую. LGCity.open() заново
         * докает город, поэтому после «Карманного города» чат оставался в root
         * города под оверлеем `.mn` и в шахте не появлялся. Повторный
         * dock('mine') делает шахту последней и возвращает блок на место.
         *
         * Возвращает false, если шахта закрыта или LGChatOne недоступен —
         * это не ошибка (чат мог быть отключён настройками игры).
         */
        showForMine() {
            const mineRoot = document.querySelector('.mn');
            if (!mineRoot || !document.body.classList.contains('mn-on')) return false;
            const one = (typeof G !== 'undefined' && G) ? G.LGChatOne : null;
            if (!one || typeof one.dock !== 'function') return false;
            try {
                one.dock('mine', mineRoot); // dock() сам вызывает place()
                return true;
            } catch (e) {
                return false;
            }
        },

        /* ---------------------------------------------------------- */
        /* ПАТЧ 11.6.4f: хук нативной ленты LGChatOne                  */
        /* ---------------------------------------------------------- */

        /**
         * Перехват ленты нативного чата игры.
         *
         * Свой EventSource('/api/live') удалён: клиент Legion сам стримит чат и
         * отдаёт его разобранным в LGChatOne.onFeed(room, data) — новые сообщения
         * комнаты (city/mine) — и LGChatOne.enterFeed(room, r) — история при входе
         * в город/шахту. Формат пакета тот же, что приходил из SSE:
         * { chat: [...], chatDel: [...], chatMe, c }.
         *
         * Хук ставится ПОВЕРХ игры: сначала наш разбор, затем оригинал — поэтому
         * нативный чат продолжает работать как обычно (11.6.4g: он снова виден
         * на экране, мы его больше не скрываем и не подменяем).
         *
         * Модуль site-chatone.js грузится лениво (oneLoad() в reference/.../app.js),
         * поэтому метод идемпотентен и вызывается повторно из
         * ChatNet._onGameChatTraffic(), пока LGChatOne не появится.
         *
         * @returns {boolean} true, если хуки стоят на объекте игры
         */
        hookNativeChat() {
            const one = (typeof G !== 'undefined' && G) ? G.LGChatOne : null;
            if (!one || typeof one.onFeed !== 'function' || typeof one.enterFeed !== 'function') return false;
            // Уже обёрнут (этим или прежним инстансом, пока хуки не сняты).
            if (one.__lgChatHooked) return true;

            const self = this;
            // Сохраняем оригиналы: по ним же снимаем хук в unhookNativeChat().
            this._nativeChatOrig = { onFeed: one.onFeed, enterFeed: one.enterFeed };

            one.onFeed = function (room, data) {
                try { self.ingestGameFeed(room, data, false); } catch (e) {}
                return self._nativeChatOrig.onFeed.apply(this, arguments);
            };

            one.enterFeed = function (room, history) {
                try { self.ingestGameFeed(room, history, true); } catch (e) {}
                return self._nativeChatOrig.enterFeed.apply(this, arguments);
            };

            try { one.__lgChatHooked = true; } catch (e) {}
            dbg('[CHAT] Хук нативной ленты LGChatOne установлен');
            return true;
        },

        /**
         * Снять хуки с нативной ленты (выключение перехвата, restart скрипта).
         *
         * Возвращаем ровно те функции, что были до нас: иначе после перезапуска
         * аддона игра продолжала бы звать колбэк в мёртвый инстанс Chat.
         */
        unhookNativeChat() {
            const one = (typeof G !== 'undefined' && G) ? G.LGChatOne : null;
            const orig = this._nativeChatOrig;
            if (!one || !orig || !one.__lgChatHooked) return false;
            try {
                one.onFeed = orig.onFeed;
                one.enterFeed = orig.enterFeed;
                try { delete one.__lgChatHooked; } catch (e) { one.__lgChatHooked = false; }
            } catch (e) {
                return false;
            }
            this._nativeChatOrig = null;
            return true;
        },

        /**
         * Keep-Alive нативного чата (ТЗ 11.6.4f, раз в 30 с).
         *
         * LGChatOne.sync() отправляет POST /api/chat/watch {on:true} только когда
         * state().open === true, а сервер стримит сообщения в SSE лишь по watch.
         * Своей ленты у нас нет — сообщения приходят из хука onFeed, поэтому
         * watch нужно поддерживать живым.
         *
         * ПАТЧ 11.6.4g: нативный чат больше не скрыт CSS-ом, поэтому флаг open
         * навязываем ТОЛЬКО пока открыт наш вынесенный чат (Chat.isOpen()).
         * Если наш чат закрыт — нативные флаги не трогаем: игрок сам решает,
         * свернуть ему нативную ленту или оставить.
         */
        startNativeChatWatch() {
            if (this._nativeWatchTimer) return;
            const tick = () => {
                try {
                    const one = (typeof G !== 'undefined' && G) ? G.LGChatOne : null;
                    if (!one || typeof one.state !== 'function') {
                        // Модуль игры ещё не подгрузился — доберём хуки на следующем тике.
                        this.hookNativeChat();
                        return;
                    }
                    // Наш чат закрыт — не перебиваем выбор игрока по нативной ленте.
                    if (!this.isOpen()) return;
                    const st = one.state();
                    if (!st) return;
                    st.open = true;
                    if (typeof one.sync === 'function') one.sync();
                } catch (e) {}
            };
            tick();
            this._nativeWatchTimer = setInterval(tick, NATIVE_CHAT_KEEPALIVE_MS);
        },

        /** Остановка Keep-Alive и снятие хуков (Chat.destroy, выключение чата). */
        stopNativeChatWatch() {
            if (this._nativeWatchTimer) {
                clearInterval(this._nativeWatchTimer);
                this._nativeWatchTimer = null;
            }
            this.unhookNativeChat();
        },

        setDisabled(val) {
            this.disabled = !!val;
            try {
                localStorage.setItem('LEGION_CHAT_DISABLED', String(this.disabled));
            } catch (e) {}
            if (this.disabled) {
                // ПАТЧ 11.6.4f: своего потока /api/live нет — гасим Keep-Alive
                // и снимаем хуки с нативной ленты LGChatOne.
                this.stopNativeChatWatch();
                if (this.isOpen()) {
                    this.close();
                }
                UI.showToast('🚫 Перехват чата отключен');
            } else {
                UI.showToast('💬 Перехват чата включен');
                this.hookNativeChat();
                this.startNativeChatWatch();
            }
        },

        /**
         * Тумблер «⚡ Подсветка ников Legion» (ТЗ 11.6.0g-4, 11.6.0h.2).
         *
         * Сохраняем выбор и сразу перегенерируем CSS: пустая простыня снимает
         * подсветку со всех уже отрисованных ников мгновенно, без обхода DOM.
         * renderMessages() нужен только PiP-чату — там класс .legion-addon-user
         * ставит сам рендер.
         */
        setAddonHighlight(val) {
            this.addonHighlight = !!val;
            try {
                localStorage.setItem('LEGION_ADDON_HIGHLIGHT', String(this.addonHighlight));
            } catch (e) {}

            // ТЗ 11.6.0h.1: подсветку выключили — persist-кэш списка не нужен
            // (иначе после перезагрузки он бы «оживил» набор впустую). При
            // включении кэш заново запишет ближайший syncAddonUsers().
            if (!this.addonHighlight) {
                try { localStorage.removeItem('LEGION_ADDON_USERS_CACHE'); } catch (e) {}
            }

            // ТЗ 11.6.0h.2: переключение = одна перезапись <style>. Маркеров
            // data-legion-addon-applied в DOM больше нет — сбрасывать нечего.
            this._applyAddonStyles();
            if (this._pipDoc) this._applyAddonStylesToPip(this._pipDoc);
            if (this.isOpen && this.isOpen()) this.renderMessages();
        },

        /**
         * Тумблер «🎭 Отображать смайлы 7TV» (ТЗ 11.6.4e).
         *
         * Сам флаг живёт в localStorage (LEGION_7TV_DISABLED) и читается в точке
         * рендера — SevenTV.replaceEmotes()/decorate() — а также в SevenTV.load(),
         * поэтому выключение действует сразу и не требует перезагрузки страницы.
         * Здесь: сохраняем выбор, догружаем набор, если аддон стартовал с
         * выключенным тумблером, и перерисовываем открытый PiP-чат.
         */
        setSevenTVEnabled(val) {
            const enabled = !!val;
            try {
                localStorage.setItem(SevenTV.DISABLE_KEY, String(!enabled));
            } catch (e) {}

            // Набор не грузился, пока тумблер был выключен: load() сам вызовет
            // renderMessages() после успешной загрузки.
            if (enabled && !SevenTV.loaded) {
                SevenTV.load();
            }

            if (typeof this.isOpen === 'function' && this.isOpen() && typeof this.renderMessages === 'function') {
                this.renderMessages();
            }
        },

        // v11.5.3: встроенный виджет чата удалён — его заменил сторонний плагин
        // Legion7TV (ProCto_Fliy). Здесь остаётся только то, что нужно нашему
        // вынесенному чату и перехватчикам:
        //   • кнопка «Вынести чат» и настройки 7TV;
        //   • эмоуты 7TV + синхронизация ника;
        //   • детектор внешнего чата.
        // interceptEventSource / interceptWebSocket вызываются из main.js сразу
        // после init() — они идемпотентны и остаются включёнными. 11.6.4b:
        // interceptFetch удалён (античит шахты), вместо него startNetworkObserver.
        init() {
            if (this._inited) return;
            this._inited = true;

            // ТЗ 11.6.0h.1: сначала поднимаем прошлый список пользователей
            // аддона из localStorage — тогда подсветка появляется в первом же
            // кадре, не дожидаясь POST /heartbeat + GET /users. Кэш старше
            // часа (TTL) игнорируем: за это время состав мог поменяться, а
            // свежий набор придёт из syncAddonUsers() на первом тике.
            try {
                const raw = localStorage.getItem('LEGION_ADDON_USERS_CACHE');
                if (raw) {
                    const c = JSON.parse(raw);
                    if (Array.isArray(c?.list) && (Date.now() - (c.ts || 0)) < 60 * 60 * 1000) {
                        this.addonUsers = new Set(c.list.map(x => String(x).trim().toLowerCase()));
                    }
                }
            } catch (e) {}

            this.badge = document.getElementById(DOM_IDS.chatBadge) || document.getElementById('chat-badge');

            // btn-chat-pip — id из старой разметки FAB, оставлен для совместимости.
            (document.getElementById(DOM_IDS.btnPopout)
                || document.getElementById('btn-popout')
                || document.getElementById('btn-chat-pip'))?.addEventListener('click', () => this.popoutChat());

            // Настройки 7TV (канал и размер смайлов). В v11.5.3 кнопка FAB
            // «🎭 Канал 7TV» переехала в модалку UI.openSettings(), поэтому
            // эта привязка — только фолбэк для старой разметки.
            document.getElementById('btn-7tv-settings')?.addEventListener('click', () => this.open7tvSettings());

            // 7TV нужен PiP-чату: размер смайлов + набор эмоутов грузим один раз.
            SevenTV.loadSize();
            SevenTV.load();

            this.syncMe();

            // v11.6.0g-3: подсветка ников пользователей аддона. Поллинг сам
            // шлёт POST /heartbeat (мы тоже в списке) и раз в 30 с обновляет
            // набор из GET /users; сеть и CSS-генератор — в chat-net.js.
            this.startAddonUsersPolling();

            // ТЗ 11.6.0h.2: подсветка из кэша применяется CSS-правилами, а не
            // классами в DOM. Браузер применит их к уже отрисованной ленте в
            // первом же кадре — ни флэша, ни ожидания ответа /users.
            if (typeof this._applyAddonStyles === 'function') this._applyAddonStyles();

            // ПАТЧ 11.6.4f: фундамент нового чата. Нативный LGChatOne остаётся
            // в DOM (его place()/dock() перевешивают блок между городом и
            // шахтой — узел удалять нельзя). С 11.6.4g он снова виден на экране:
            // CSS-скрытие .cy-chat из styles.js удалено.
            // Ленту берём из его колбэков onFeed/enterFeed, а Keep-Alive держит
            // watch {on:true} включённым, иначе сервер не стримит сообщения.
            this.hookNativeChat();
            this.startNativeChatWatch();
        },

        getRoleMeta(role, isSystem) {
            if (isSystem) return { icon: '🏆', color: '#f0ad4e' }; // Для летописи/достижений
            const map = {
                'necromancer': { icon: '💀', color: '#b9a2ff' },
                'paladin': { icon: '🔨', color: '#f3d36b' },
                'priest': { icon: '✨', color: '#f0ad4e' },
                'mage': { icon: '🔮', color: '#5bc0de' },
                'rogue': { icon: '🗡️', color: '#d8bfd8' },
                'archer': { icon: '🏹', color: '#5cb85c' },
                'legionary': { icon: '🛡️', color: '#d9534f' },
            };
            return map[role] || { icon: '👤', color: '#ffcf6a' };
        },

        // Главная функция приема сообщений (§2.3 дедуп по id + дедуп своих исходящих)
        // isMine убран из сигнатуры: все вызовы передавали false, а свои сообщения
        // определяются по нику (isSelf) ниже.
        handleIncoming(author, text, isHistory = false, id = null, seq = null, role = null, isSystem = false, aw = null, channel = null, k = null, to = null, rank = null) {
            if (!text) return;

            // Перехват и фильтрация ЛС (не добавлять в общий чат)
            if (channel === 'dm' || k === 'dm') {
                // processIncomingDMs() уже вызвал Players.handleIncomingDM для этого
                // пакета (chat-net парсит входящие ЛС отдельно), поэтому историю
                // повторно в Players не отдаём — иначе дублируются тосты/счётчики.
                if (!isHistory && typeof Players !== 'undefined' && Players.handleIncomingDM) {
                    Players.handleIncomingDM(author, text, to);
                }

                // Пытаемся склеить с pending-сообщением из ЛС, чтобы оно не висело
                // в памяти черновиком (эхо приходит через тот же поток).
                if (this.myNick) {
                    for (let i = this.messages.length - 1; i >= 0; i--) {
                        const m = this.messages[i];
                        if (m._pending && m.k === 'dm' && m.text === text) {
                            m._pending = false;
                            break;
                        }
                    }
                }

                // Если этот диалог сейчас открыт во вкладке «✉️ Личные» — считаем прочитанным.
                // Перерисовку выполняет Players.refreshUnreadDMViews() -> Chat.renderMessages().
                if (typeof Players !== 'undefined' && this.activeTab === 'dm' && this.dmTarget) {
                    const myNick = (this.myNick || '').toLowerCase();
                    const isSelf = (author === 'Я') || (!!myNick && String(author || '').toLowerCase() === myNick);
                    const peer = isSelf ? (to || '') : (author || '');
                    if (peer && String(peer).toLowerCase() === String(this.dmTarget).toLowerCase()) {
                        Players.clearUnreadDM(peer);
                    }
                }
                return;
            }

            // 1. Если сообщение с таким ID уже есть и оно НЕ в статусе pending — это повтор из поллинга, пропускаем
            if (id && this.messages.slice(-100).some(m => m.id === id && !m._pending)) {
                return;
            }

            // 2. Дедупликация и сопоставление своих исходящих сообщений (_pending)
            const isSelf = author === this.myNick || (this.myNick && author && author.toLowerCase() === this.myNick.toLowerCase());
            if (isSelf) {
                let pendingMsg = null;
                for (let i = this.messages.length - 1; i >= 0; i--) {
                    const m = this.messages[i];
                    const authorMatch = m.author === author || m.author === this.myNick;
                    const textMatch = m.text === text;
                    // Pending-сообщение наше собственное: канал эха может отличаться
                    // (мы в шахте, а отправили в город), поэтому для _pending канал
                    // не проверяем — он останется тем, куда мы реально отправили.
                    const channelMatch = !channel || !m.channel || m.channel === channel || m._pending;
                    if (authorMatch && textMatch && channelMatch && (m._pending || (id && m.id === id))) {
                        pendingMsg = m;
                        break;
                    }
                }
                if (pendingMsg) {
                    pendingMsg._pending = false;
                    if (id && !pendingMsg.id) pendingMsg.id = id;
                    if (seq && !pendingMsg.seq) pendingMsg.seq = seq;
                    if (role && !pendingMsg.role) pendingMsg.role = role;
                    if (rank && !pendingMsg.rank) pendingMsg.rank = rank;
                    if (aw && !pendingMsg.aw) pendingMsg.aw = aw;
                    // НЕ ПЕРЕЗАПИСЫВАЕМ КАНАЛ, если он уже задан (например, 'city')
                    // Эхо может прийти как 'mine', если мы в шахте, но мы знаем, куда отправили.
                    if (!pendingMsg.channel && channel) pendingMsg.channel = channel;
                    // Своё сообщение тоже должно попасть в кэш: сюда мы приходим
                    // на эхо сервера, а основная ветка ниже уже пропускается.
                    if (!isHistory) this.cacheOwnMessage(pendingMsg);
                    this.renderMessages();
                    return;
                }
            }

            // 3. Дедупликация сообщений без ID (по автору и тексту за последние 8 секунд)
            if (!isHistory && !id) {
                if (this.messages.slice(-25).some(m => m.author === author && m.text === text && (m.channel === channel || !m.channel || !channel) && Date.now() - m.ts < 8000)) return;
            }

            const msgObj = { author, text, role, rank, isSystem, id, seq, aw, channel, k, to, ts: Date.now() };
            this.messages.push(msgObj);

            // Сохраняем в кэш только живые сообщения
            if (!isHistory) this.saveToStorage(author, text, role, isSystem, channel, k, aw, rank, id);

            // Ограничиваем массив, чтобы не копить память в долгих сессиях.
            // Срез делаем только при переполнении — это редкая операция.
            if (this.messages.length > 500) {
                this.messages = this.messages.slice(-500);
            }

            // Обновляем UI
            if (!isHistory) {
                this.renderMessages();
                // Скролл вниз выполняет renderMessages() и только если пользователь
                // уже был внизу — иначе чтение истории не прерывается.
                if (!this.isOpen() && !isSelf) {
                    this.unreadCount++;
                    this.updateBadge();
                }
            }
        },

        updateBadge() {
            const badges = document.querySelectorAll('#' + DOM_IDS.chatBadge + ', #' + DOM_IDS.fabChatBadge + ', #chat-badge, #fab-chat-badge');
            badges.forEach(b => {
                if (this.unreadCount > 0) {
                    b.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
                    b.style.display = 'block';
                } else {
                    // Сбрасываем и текст: иначе при повторном показе остаётся старый «99+».
                    b.textContent = '0';
                    b.style.display = 'none';
                }
            });
        },

        toggle() {
            if (this.disabled) {
                UI.showToast('🚫 Перехват чата отключен в меню 🐱', true);
                return;
            }
            // Обычного (встроенного) виджета больше нет: «открыть чат» = вынести в PiP.
            if (this.isOpen()) {
                try { this._popoutWin?.focus(); } catch (e) {}
                return;
            }
            this.popoutChat();
        },

        /**
         * Остановка фоновых задач чата (ТЗ 11.6.0g-3).
         *
         * Вызывается из legionApi.shutdown() в main.js при перезапуске скрипта.
         * Своего потока /api/live больше нет (ПАТЧ 11.6.4f): Keep-Alive и хуки
         * нативной ленты снимает stopNativeChatWatch(); здесь — таймер поллинга
         * /heartbeat + /users и PerformanceObserver. DOM-наблюдатель нативной
         * ленты удалён в 11.6.0h.2 (подсветку рисует CSS).
         */
        destroy() {
            this.stopAddonUsersPolling();
            // ПАТЧ 11.6.4f: снимаем Keep-Alive и хуки с нативной ленты — иначе
            // после перезапуска скрипта на G.LGChatOne остался бы колбэк в
            // мёртвый инстанс Chat (и лишний интервал каждые 30 с).
            this.stopNativeChatWatch();
            // 11.6.4b: гасим PerformanceObserver, иначе старый инстанс продолжал
            // бы слушать запросы игры (/api/me, /api/city, /api/mine) после
            // перезапуска скрипта.
            this.stopNetworkObserver();
        },
    };

    // Подмешиваем слои. Объекты независимы и не пересекаются по ключам,
    // порядок важен лишь для читаемости: сначала данные, потом сеть, потом UI.
    Object.assign(Chat, ChatHistory);
    Object.assign(Chat, ChatNet);
    Object.assign(Chat, ChatPip);

    // Экспорт 7TV для отладки: window.__LEGION__.Chat.SevenTV
    Chat.SevenTV = SevenTV;

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
    //   core/utils-chat.js   -> Utils.chatHash / extractChatFields / extractChatDeep / updateOnlinePlayers / processIncomingDMs
    //   core/styles.js -> STYLES
    //   core/hooks.js  -> перехватчики LGCity / LGAuction / LGQuest
    //                     (LGMine снят в 11.6.4b — античит шахты)
    //   core/ui-templates.js -> UITemplates (HTML: FAB-меню, модалки, HUD)
    //   core/ui.js     -> UI
    //   modules/*      -> BuildSim, HeroPlanner, Auction, Players,
    //                     PocketCity, CombatAssistant, Party, Miner (заглушка), Chat
    // ============================================================

    // 5.3. Защита от повторного запуска (single-instance guard)
    // Page-context ссылка: при @grant window — песочница, а консоль и другие
    // скрипты видят только unsafeWindow.
    const LG_ROOT = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    if (LG_ROOT.__LEGION__?._booted) {
        try { LG_ROOT.__LEGION__.shutdown?.(); } catch (e) {}
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
        fabWrap.innerHTML = UITemplates.fabMenu(typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '11.5.3', DOM_IDS);
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
            // классов на <html>), а не subtree всего документа: в городе
            // мутаций слишком много. Повторные вызовы склеиваем в один кадр.
            // Тумблер «📌 Кнопка аддона в нижнем меню игры» проверяется внутри
            // UI.syncNavButton(): при выключенном тумблере метод снимает нативную
            // кнопку и сразу выходит, поэтому наблюдатель её обратно не вернёт.
            let navSyncScheduled = false;
            const scheduleNavSync = () => {
                if (navSyncScheduled) return;
                navSyncScheduled = true;
                const run = () => { navSyncScheduled = false; UI.syncNavButton(); };
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
                else setTimeout(run, 150);
            };
            const navObserver = new MutationObserver(scheduleNavSync);
            navObserver.observe(document.body, { childList: true });
            navObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            UI._navObserver = navObserver;
        }

        // 🏰 Карманный город — модуль (modules/pocket-city.js), не UI.
        (document.getElementById(DOM_IDS.btnPocketCity) || document.getElementById('btn-pocket-city'))?.addEventListener('click', () => PocketCity.open());
        (document.getElementById(DOM_IDS.btnProfile) || document.getElementById('btn-profile'))?.addEventListener('click', () => UI.togglePlayerHud());

        // ⚙️ Настройки (7TV, перехват чата) вынесены в отдельную модалку:
        // FAB-меню стало короче, а служебные переключатели больше не мешают кнопкам.
        // Кнопку «Вынести чат» (PiP) привязывает Chat.init(): второй слушатель
        // здесь давал двойной вызов popoutChat() и мигающее окно.
        document.getElementById('btn-fab-settings')?.addEventListener('click', () => UI.openSettings());

        // Чекбокс «Отключить перехват чата» переехал в UI.openSettings()
        // (модалка), поэтому старая привязка к DOM_IDS.chkChatDisable удалена.

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
        Chat.init();

        Chat.interceptEventSource();
        Chat.interceptWebSocket();
        // 11.6.4b: подмена window.fetch удалена (античит шахты палит её по
        // отсутствию [native code]). Вместо хука — пассивный PerformanceObserver:
        // ловит запросы игры к /api/me и к городу/шахте и обновляет данные
        // своими запросами, ничего не перезаписывая.
        Chat.startNetworkObserver();
        // Фоновые задачи чата: хуки нативной ленты + Keep-Alive watch (ПАТЧ 11.6.4f).
        // Идемпотентно; своего EventSource на /api/live больше нет.
        if (!Chat.disabled) {
            Chat.startBackgroundLiveListener();
        }

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
            Party,
            Chat,
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
                if (Chat._popoutWin) {
                    try { Chat._popoutWin.close(); } catch(e) {}
                    Chat._popoutWin = null;
                }
                Chat.stopBackgroundLiveListener();
                // 11.6.2b: гасим интервал боевого ассистента и убираем его контейнер,
                // иначе после перезапуска скрипта тикали бы два таймера.
                CombatAssistant.destroy();
                // ТЗ 11.6.0g-3: гасим поллинг /heartbeat + /users и
                // MutationObserver нативной ленты (иначе после перезапуска
                // скрипта остались бы два интервала).
                Chat.destroy();
                // 11.6.3c: гасим PerformanceObserver и HP-интервал Пати — иначе
                // старый инстанс продолжал бы слушать запросы игры (/api/me,
                // /api/qact) и слать state на наш сервер после перезапуска.
                Party.destroy();
                document.querySelectorAll('.' + DOM_IDS.customModal + ', .sim-card, .' + DOM_IDS.chatWidget + ', .float-btns, .' + DOM_IDS.fabWrap + ', #' + DOM_IDS.playerHud + ', .' + DOM_IDS.hudLog + ', #' + DOM_IDS.hudLog + ', .hud-log, .custom-modal, .chat-widget, .legion-fab-wrap, #legion-player-hud').forEach(el => el.remove());
                legionApi._booted = false;
            }
        };

        // Публикуем API в page-context: при @grant песочница скрывает window от
        // консоли и других скриптов, unsafeWindow — нет. Дублируем в window, чтобы
        // внутренние ссылки (hooks.js) работали в обоих режимах.
        try { LG_ROOT.__LEGION__ = legionApi; } catch (e) {}
        try { window.__LEGION__ = legionApi; } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

})();
