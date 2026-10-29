    // ============================================================
    // 0. КОНСТАНТЫ И ОТЛАДКА
    // ============================================================
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

    // ============================================================
    // 1. УТИЛИТЫ
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

    const Utils = {
        sleep: (ms) => new Promise(r => setTimeout(r, ms)),
        apiPath(p) {
            if (!p) return API_BASE;
            if (p.startsWith('/c/')) return p;
            return API_BASE + (p.startsWith('/') ? p : '/' + p);
        },
        async fetchApi(path, body, signal) {
            // Те же правила, что и в getItemArtSvg: после @grant объекты игры
            // живут только в unsafeWindow.
            const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            const nativeCtx = G.__lgAucContext || G.__lgCityContext || G.__lgMineContext;
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

                // 1. Контексты игры: аукцион / город / шахта.
                // Вызов каждого контекста изолирован: упавший art() не должен
                // обрывать цепочку и лишать предмет картинки.
                const ctxs = [
                    G.__lgAucContext,
                    G.__lgCityContext,
                    G.__lgMineContext,
                    G.X,        // глобальный арт-резолвер игры
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
        enhanceAuctionRows(container, itemsMap) {
            if (!container) return;
            const rows = container.querySelectorAll('tr:not([data-lg-lot])');
            if (!rows || !rows.length) return;

            rows.forEach(row => {
                row.setAttribute('data-lg-lot', '1');
                const cells = row.querySelectorAll('td');
                if (cells.length < 4) return; // строка «Ничего не найдено»

                const itemCell = cells[0];
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

                itemCell.style.display = 'flex';
                itemCell.style.alignItems = 'center';
                itemCell.style.gap = '8px';
                itemCell.insertBefore(artDiv, itemCell.firstChild);

                // Декорируем цены
                for (let i = 2; i <= 4 && i < cells.length; i++) {
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
        formatTimeLeft(ms) {
            if (!ms) return '—';
            const diff = ms - Date.now();
            if (diff <= 0) return 'Истек';
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            return `${h}ч ${m}м`;
        },
        getItemName(id, itemsMap = null) {
            if (typeof Auction !== 'undefined' && Auction.getItemName) {
                return Auction.getItemName(id, itemsMap);
            }
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

            if (updated) {
                try {
                    if (typeof Players !== 'undefined' && Players.onOnlinePlayersUpdated) {
                        Players.onOnlinePlayersUpdated();
                    }
                } catch(e) {}
            }
            return updated;
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
        }
    };

    // ===== fix: приоритет арта из шахты для обеих сборок =====
    // Раньше патч жил в Personal-модуле miner.js, из-за чего в Ultimate
    // __lgMineContext.art не использовался вовсе. Идемпотентен: повторный
    // запуск (или запуск рядом с другим патчем) не плодит обёртки.
    (function patchMineArtResolver() {
        if (Utils.__mineCtxPatched || typeof Utils.getItemArtSvg !== 'function') return;
        Utils.__mineCtxPatched = true;

        const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        const origGetSvg = Utils.getItemArtSvg.bind(Utils);

        Utils.getItemArtSvg = function (lot, def) {
            try {
                const ctx = G.__lgMineContext;
                if (ctx && typeof ctx.art === 'function') {
                    const l = lot || {};
                    const it = { id: l.i, ...(def || {}), en: +l.en || 0 };
                    const svg = ctx.art(it);
                    if (isRealItemSvg(svg)) return svg;
                }
            } catch (e) {}
            return origGetSvg(lot, def);
        };
    })();

    const randomDelay = (min, max) => Utils.randomDelay(min, max);
