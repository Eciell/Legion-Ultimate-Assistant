// ==UserScript==
// @name         Legion: Ultimate Assistant (Chat, Auction, Pocket City)
// @namespace    http://tampermonkey.net/
// @version      11.5.0
// @description  QoL-аддон для Легиона: Умный чат, Сканер аукциона, Разведка, Планировщик, Карманный город. Без авто-копания.
// @connect      7tv.io
// @connect      cdn.7tv.app
// @connect      api.ivr.fi
// @author       eciell
// @match        https://play.multidonate.ru/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/Eciell/Legion-Ultimate-Assistant/main/dist/LegionUltimate.user.js
// @downloadURL  https://raw.githubusercontent.com/Eciell/Legion-Ultimate-Assistant/main/dist/LegionUltimate.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ===== src/core/utils.js =====
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
            const nativeCtx = window.__lgAucContext || window.__lgCityContext || window.__lgMineContext;
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

                // 1. Контексты игры: аукцион / город / шахта.
                // Вызов каждого контекста изолирован: упавший art() не должен
                // обрывать цепочку и лишать предмет картинки.
                const ctxs = [
                    window.__lgAucContext,
                    window.__lgCityContext,
                    window.__lgMineContext,
                    window.X,        // глобальный арт-резолвер игры
                    window.LGtine,   // запасной глобальный резолвер
                    { art: window.art, owner: window },     // глобальный метод игры
                    { art: window.fig, owner: window },     // запасной
                    { art: window.doodle, owner: window }   // запасной
                ].filter(Boolean);
                for (const ctx of ctxs) {
                    if (!ctx || typeof ctx.art !== 'function') continue;
                    let svg = '';
                    // owner нужен, чтобы window.art() вызывался с this === window
                    try { svg = ctx.art.call(ctx.owner || ctx, it); } catch (e) { svg = ''; }
                    if (isRealItemSvg(svg)) return svg;
                }

                // 2. Фолбэк на библиотеку инвентаря
                const inv = window.LGInventory;
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
                const mdName = window.MDDoodle?.names?.[id] || window.MDDoodle?.names?.cats?.items?.[id]?.name;
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
                const C = window.MDDoodle?.CATALOG;
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
            if (!m || typeof m !== 'object') return { author: null, text: null, k: null, to: null };

            const author = m.l || m.n || m.author || m.nick || m.name || m.login || m.from;
            const text = m.t || m.text || m.msg || m.m || m.message;
            const role = m.c || m.role || null;

            // Определяем, системное ли это сообщение (§2.7, SDK §7)
            const isSystem = author === 'Летопись' || author === 'Система'
                || (author && author.toLowerCase().includes('летопись'))
                || m.ev === 1;

            const aw = Array.isArray(m.aw) ? m.aw : null;
            const channel = m.channel || m.room || m.ch || null;
            const k = m.k || m.kind || (channel === 'dm' ? 'dm' : null);
            const to = m.to || m.target || null;

            return { author, text, id: m.id, seq: m.s, role, isSystem, aw, channel, k, to };
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
        looksLikeChat(o) {
            if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
            const text = o.t ?? o.text ?? o.msg ?? o.m ?? o.message;
            const author = o.l ?? o.n ?? o.author ?? o.name ?? o.nick ?? o.login ?? o.from;
            return typeof text === 'string' && text.trim().length > 0 && typeof author === 'string' && author.trim().length > 0;
        },
        extractChatDeep(m, depth = 0) {
            if (!m || depth > 4) return [];
            const result = [];

            // 1. Упакованный массив row: [id, s, l, n, t, at, ...]
            if (Array.isArray(m)) {
                // Если сам m — кортеж сообщения со строковым логином row[2] и текстом row[4]
                if (m.length >= 5 && typeof m[2] === 'string' && typeof m[4] === 'string' && m[4].trim()) {
                    return [{ id: m[0], s: m[1], l: m[2], n: m[3] || m[2], t: m[4], at: m[5], c: m[6] }];
                }

                // Или это массив сообщений/строк
                for (const item of m) {
                    if (Array.isArray(item)) {
                        if (item.length >= 5 && typeof item[2] === 'string' && typeof item[4] === 'string' && item[4].trim()) {
                            result.push({ id: item[0], s: item[1], l: item[2], n: item[3] || item[2], t: item[4], at: item[5], c: item[6] });
                        } else {
                            result.push(...this.extractChatDeep(item, depth + 1));
                        }
                    } else if (this.looksLikeChat(item)) {
                        result.push(item);
                    } else if (item && typeof item === 'object') {
                        result.push(...this.extractChatDeep(item, depth + 1));
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
                                channel: roomChannel || item.channel || item.room || null,
                                k: item.k || item.kind || null,
                                to: item.to || item.target || null
                            });
                        } else if (Array.isArray(item)) {
                            if (item.length >= 5 && typeof item[2] === 'string' && typeof item[4] === 'string' && item[4].trim()) {
                                result.push({
                                    id: item[0], s: item[1], l: item[2], n: item[3] || item[2],
                                    t: item[4], at: item[5], c: item[6], channel: roomChannel || null
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
                                t: row[4], at: row[5], c: row[6], channel: roomChannel || null
                            });
                        }
                    }
                    if (result.length) return result;
                }

                if (this.looksLikeChat(m)) {
                    return [m];
                }

                // Рекурсивный обход свойств объекта (до 4 уровней глубины)
                for (const k of Object.keys(m)) {
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

    // ===== src/core/styles.js =====
    // ============================================================
    // 3. СТИЛИ
    // ============================================================
    const STYLES = `
        .${DOM_IDS.customModal}, .custom-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(20, 16, 26, 0.98); border: 2px solid #caa55c; border-radius: 12px; padding: 20px; z-index: 10000; color: #f7eadf; width: 1200px; max-width: 98vw; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,0.85); font-family: 'Nunito', sans-serif; backdrop-filter: blur(4px); }
        .${DOM_IDS.customModal}.modal-compact, .custom-modal.modal-compact { width: 450px; max-width: 95vw; max-height: 65vh; padding: 16px; }
        .${DOM_IDS.customModal} h2, .custom-modal h2 { margin-top: 0; color: #ffcf6a; border-bottom: 1px solid #555; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center; cursor: grab; user-select: none; }
        .${DOM_IDS.customModal} h2:active, .custom-modal h2:active { cursor: grabbing; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar, .custom-modal ::-webkit-scrollbar { width: 6px; height: 6px; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar-track, .custom-modal ::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar-thumb, .custom-modal ::-webkit-scrollbar-thumb { background: #44374a; border-radius: 4px; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar-thumb:hover, .custom-modal ::-webkit-scrollbar-thumb:hover { background: #caa55c; }
        .custom-close { background: none; border: none; color: #ff8fa3; font-size: 24px; cursor: pointer; transition: color 0.2s; user-select: none; }
        .custom-close:hover { color: #fff; }
        .modal-tabs { display: flex; gap: 10px; margin-bottom: 15px; border-bottom: 1px solid #444; padding-bottom: 10px; flex-wrap: wrap; }
        .modal-tab { background: #2a2030; border: 1px solid #555; color: #ccc; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: all 0.2s; }
        .modal-tab:hover { background: #3a2c40; color: #fff; }
        .modal-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; }
        .tab-content { display: none; flex: 1; overflow: hidden; position: relative; }
        .tab-content.active { display: flex; gap: 20px; }
        .sim-tree-wrap { flex: 1; background: #223029; border: 10px solid #6b4423; border-radius: 12px; box-shadow: inset 0 0 20px rgba(0,0,0,0.8); position: relative; overflow: auto; display: flex; flex-direction: column; }
        .sim-tree-inner { min-width: 700px; padding: 20px; display: flex; flex-direction: column; height: 840px; }
        .sim-top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; background: rgba(0,0,0,0.4); padding: 10px 15px; border-radius: 8px; border: 2px solid #caa55c; position: relative; z-index: 10; }
        .sim-free-pts { font-size: 18px; font-weight: bold; color: #ffcf6a; }
        .sim-branches { position: relative; height: 760px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
        .sim-branch { position: relative; background: rgba(255,255,255,0.03); border-radius: 8px; height: 100%; }
        .sim-branch-header { text-align: center; font-weight: bold; color: #ffcf6a; font-size: 14px; position: absolute; top: 0; width: 100%; pointer-events: none; }
        .sim-branch-pts { font-size: 11px; color: #aaa; margin-top: 2px; }
        .sim-node { position: absolute; z-index: 2; display: flex; flex-direction: column; align-items: center; width: 90px; cursor: pointer; transform: translate(-50%, -50%); }
        .sim-node-icon { width: 44px; height: 44px; border-radius: 50%; background: #2a2030; border: 3px solid #555; display: flex; align-items: center; justify-content: center; font-size: 20px; transition: all 0.2s; box-shadow: 0 4px 6px rgba(0,0,0,0.5); }
        .sim-node.available .sim-node-icon { border-color: #ffcf6a; box-shadow: 0 0 10px rgba(255, 207, 106, 0.5); cursor: pointer; }
        .sim-node.available:hover .sim-node-icon { transform: scale(1.15); }
        .sim-node.maxed .sim-node-icon { background: #caa55c; border-color: #ffcf6a; color: #111; }
        .sim-node.locked { opacity: 0.6; cursor: not-allowed; }
        .sim-node.locked .sim-node-icon { border-style: dashed; background: #111; }
        .sim-node-ranks { display: flex; gap: 2px; margin-top: 4px; background: rgba(0,0,0,0.7); padding: 2px 4px; border-radius: 6px; }
        .sim-node-ranks i { width: 6px; height: 6px; border-radius: 50%; background: #333; border: 1px solid #555; }
        .sim-node-ranks i.filled { background: #ffcf6a; border-color: #ffcf6a; }
        .sim-node-name { font-size: 10px; text-align: center; margin-top: 2px; font-weight: bold; background: rgba(0,0,0,0.8); padding: 2px 4px; border-radius: 4px; line-height: 1.1; position: relative; z-index: 3; white-space: normal; }
        .sim-card { position: fixed; background: #f5e9c8; color: #2a2010; border: 3px solid #2b1d18; border-radius: 12px; padding: 15px; width: 280px; z-index: 10001; box-shadow: 0 10px 25px rgba(0,0,0,0.6); display: none; }
        .sim-card h4 { margin: 0 0 5px 0; font-size: 16px; color: #2b1d18; display: flex; justify-content: space-between; }
        .sim-card .desc { font-size: 13px; margin-bottom: 10px; line-height: 1.3; }
        .sim-card .req { font-size: 12px; color: #c2405a; font-weight: bold; margin-bottom: 10px; }
        .sim-card .controls { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
        .sim-card button { background: #caa55c; border: 2px solid #2b1d18; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; color: #2b1d18; font-size: 13px; }
        .sim-card button:disabled { opacity: 0.5; cursor: not-allowed; }
        .sim-card-close { position: absolute; top: 8px; right: 8px; cursor: pointer; font-size: 16px; color: #888; }
        .sim-reset-btn { background: #caa55c; color: #2b1d18; border: 2px solid #2b1d18; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; }
        .sim-reset-btn:hover { background: #ffcf6a; }
        .build-right { width: 250px; flex-shrink: 0; background: #111; padding: 15px; border-radius: 8px; border: 1px solid #333; height: fit-content; }
        .stats-panel h3 { margin-top: 0; color: #ffcf6a; font-size: 16px; border-bottom: 1px solid #444; padding-bottom: 5px; }
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
        .loader { display: flex; justify-content: center; align-items: center; height: 100px; font-size: 16px; color: #caa55c; font-weight: bold; }
        .${DOM_IDS.fabWrap}, .legion-fab-wrap { position: fixed; bottom: 20px; right: 20px; z-index: 10000; touch-action: none; user-select: none; }
        .${DOM_IDS.fabBtn}, .legion-fab-btn { width: 52px; height: 52px; border-radius: 50%; background: #1d1620; border: 2px solid #caa55c; color: #ffcf6a; font-size: 26px; display: flex; justify-content: center; align-items: center; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,0.75); transition: transform 0.2s, background 0.2s; position: relative; }
        .${DOM_IDS.fabBtn}:hover, .legion-fab-btn:hover { background: #2a2030; transform: scale(1.08); }
        .${DOM_IDS.fabBtn}:active, .legion-fab-btn:active { transform: scale(0.95); }
        .${DOM_IDS.fabMenu}, .legion-fab-menu { position: absolute; bottom: 62px; right: 0; min-width: 220px; background: rgba(29, 22, 32, 0.96); border: 2px solid #caa55c; border-radius: 10px; padding: 8px; display: none; flex-direction: column; gap: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.85); backdrop-filter: blur(8px); }
        .${DOM_IDS.fabMenu}.open, .legion-fab-menu.open { display: flex; animation: fabFadeIn 0.2s ease; }
        @keyframes fabFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .fab-menu-item { position: relative; background: #2a2030; color: #ffcf6a; border: 1px solid #555; border-radius: 6px; padding: 10px 14px; font-weight: bold; cursor: pointer; font-size: 13px; text-align: left; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center; }
        .fab-menu-item:hover { background: #caa55c; color: #1d1620; border-color: #caa55c; }
        .fab-menu-item.active { background: #4cc95a; color: #1d1620; border-color: #4cc95a; box-shadow: 0 0 15px rgba(76, 201, 90, 0.5); }
        .${DOM_IDS.chatBadge}, .chat-badge { position: absolute; top: -6px; right: -6px; background: #ff5a7a; color: #fff; border-radius: 50%; padding: 2px 7px; font-size: 12px; font-weight: 900; box-shadow: 0 2px 5px rgba(0,0,0,0.5); display: none; pointer-events: none; z-index: 2; }
        .${DOM_IDS.chatWidget}, .chat-widget { position: fixed; bottom: 80px; right: 20px; width: 320px; height: 400px; min-width: 320px; min-height: 400px; max-width: 95vw; max-height: 95vh; resize: both; background: #1d1620; border: 2px solid #caa55c; border-radius: 12px; display: flex; flex-direction: column; z-index: 10000; box-shadow: 0 10px 30px rgba(0,0,0,0.8); overflow: hidden; transition: transform 0.2s, opacity 0.2s; transform: translateY(20px); opacity: 0; pointer-events: none; }
        .${DOM_IDS.chatWidget}.open, .chat-widget.open { transform: translateY(0); opacity: 1; pointer-events: auto; }
        .chat-top-bar, .chat-header { background: #2a2030; padding: 10px 12px; font-weight: bold; color: #ffcf6a; display: flex; justify-content: space-between; align-items: center; gap: 8px; overflow: hidden; border-bottom: 1px solid #444; cursor: move; user-select: none; touch-action: none; box-sizing: border-box; }
        .chat-main-tabs, .chat-tabs { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; }
        .chat-main-tab, .chat-tab { background: #1d1620; border: 1px solid #444; color: #aaa; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; white-space: nowrap; font-weight: bold; user-select: none; pointer-events: auto; }
        .chat-main-tab.active, .chat-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; font-weight: bold; }
        .chat-sub-tabs { display: flex; gap: 6px; padding: 6px 12px; background: #231929; border-bottom: 1px solid #3a2b42; }
        .chat-sub-tab { background: #1d1620; border: 1px solid #444; color: #bbb; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; white-space: nowrap; user-select: none; pointer-events: auto; }
        .chat-sub-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; font-weight: bold; }
        .chat-role-icon { margin-right: 4px; }
        .chat-envelope { display: none; }
        .chat-close { cursor: pointer; color: #ff8fa3; padding: 4px 6px; flex-shrink: 0; font-size: 16px; line-height: 1; user-select: none; pointer-events: auto; }
        .chat-close:hover { color: #fff; }
        .chat-messages { flex: 1; padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #f7eadf !important; }
        .chat-msg { background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 8px; line-height: 1.3; word-wrap: break-word; color: #f7eadf !important; }
        .chat-msg.pending { opacity: 0.6; font-style: italic; }
        .chat-msg.streamer-msg { border-left: 3px solid #ffd700; background: rgba(255, 215, 0, 0.08); }
        .chat-msg.mention-msg { border-left: 3px solid #f7768e; background: rgba(247, 118, 142, 0.12); }
        .chat-text { color: #f7eadf !important; word-break: break-word; }
        .chat-author { font-weight: bold; color: #f7eadf !important; margin-right: 5px; }
        .chat-input-area { display: flex; padding: 10px; background: #111; border-top: 1px solid #333; gap: 5px; }
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
        /* ── Ассистент Жреца: плавающий HUD боя (Поход) ── */
        .priest-hud { position: fixed; top: 80px; right: 20px; background: #1e1724; border: 1px solid #caa55c; border-radius: 8px; padding: 10px; display: none; flex-direction: column; z-index: 10001; box-shadow: 0 4px 15px rgba(0,0,0,0.7); min-width: 150px; max-width: 240px; font-family: 'Nunito', sans-serif; color: #f7eadf; }
        .priest-hud-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: bold; color: #caa55c; font-size: 12px; margin-bottom: 8px; cursor: grab; user-select: none; touch-action: none; }
        .priest-hud-header:active { cursor: grabbing; }
        .priest-hud-watchlist { max-height: 100px; overflow-y: auto; }
        .priest-hud-watch-item { font-size: 11px; color: #aaa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .priest-hud-settings { background: none; border: none; color: #caa55c; font-size: 13px; line-height: 1; cursor: pointer; padding: 0 2px; }
        .priest-hud-settings:hover { color: #ffcf6a; }
        .priest-hud-actions { display: flex; align-items: center; gap: 6px; }
        .priest-hud-close { color: #ff5a7a; font-size: 12px; line-height: 1; cursor: pointer; padding: 0 2px; }
        .priest-hud-close:hover { color: #fff; }
        .priest-hud-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 4px; background: rgba(0,0,0,0.3); padding: 4px; border-radius: 4px; }
        .priest-hud-nick { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .priest-heal-btn { background: #28a745; color: #fff; border: none; border-radius: 3px; padding: 2px 6px; font-size: 11px; cursor: pointer; flex-shrink: 0; }
        .priest-heal-btn:hover:not(:disabled) { background: #34c759; }
        .priest-heal-btn:disabled { background: #555; color: #fff; cursor: not-allowed; opacity: 0.7; }
        /* 7TV-смайлики: размер задаётся переменной --t7-h (S/M/L/XL из настроек чата) */
        .t7-emote { height: var(--t7-h, 1.9em); vertical-align: middle; margin: 0 2px; }
    `;

    // ===== src/core/hooks.js =====
    // ============================================================
    // 0.1. ПЕРЕХВАТ НАРИВНЫХ КОНТЕКСТОВ ИГРЫ (Обход 429/409 ошибок)
    // ============================================================
    const G = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // ============================================================
    // 0.1.0. 🛡️ СТЕЛС-РЕЖИМ (Анти-детект вкладки)
    //
    // Скрываем от игры, что вкладка неактивна. Нужно для SSE и для
    // телеметрии vh. Блок обязан выполняться ДО хуков LGCity /
    // LGAuction / LGQuest / LGMine, иначе наша подмена fetch
    // вступит в конфликт с их перехватчиками.
    // ============================================================
    try {
        const docProto = (G.Document && G.Document.prototype) || Document.prototype;

        // Сохраняем реальные геттеры для нашего кода (если понадобится)
        if (!G.__lgRealDoc) {
            G.__lgRealDoc = {
                getHidden: Object.getOwnPropertyDescriptor(docProto, 'hidden')?.get,
                getVisibilityState: Object.getOwnPropertyDescriptor(docProto, 'visibilityState')?.get
            };
        }

        const defineVis = (target) => {
            try {
                Object.defineProperty(target, 'hidden', {
                    get: () => false,
                    set: () => {},
                    configurable: true
                });
                Object.defineProperty(target, 'visibilityState', {
                    get: () => 'visible',
                    set: () => {},
                    configurable: true
                });
            } catch (err) {}
        };
        defineVis(docProto);
        defineVis(document);
        if (G.document && G.document !== document) defineVis(G.document);

        // hasFocus = true
        try {
            if (typeof docProto.hasFocus === 'function') docProto.hasFocus = () => true;
            if (typeof document.hasFocus === 'function') document.hasFocus = () => true;
        } catch (err) {}

        // navigator.webdriver = false (классический детект автоматизации)
        try {
            Object.defineProperty(G.navigator, 'webdriver', {
                get: () => false,
                configurable: true
            });
        } catch (err) {}

        // Блокируем события скрытия (только для игры, но не мешаем нашим слушателям)
        const suppressHiddenEvent = (e) => {
            if (e && (e.type === 'visibilitychange' || e.type === 'webkitvisibilitychange')) {
                e.stopImmediatePropagation();
            }
        };
        window.addEventListener('visibilitychange', suppressHiddenEvent, true);
        document.addEventListener('visibilitychange', suppressHiddenEvent, true);
        if (G.window && G.window !== window) {
            G.window.addEventListener('visibilitychange', suppressHiddenEvent, true);
        }

        G.__lgStealthActive = true;
    } catch (e) {
        console.warn('[LEGION] Stealth: не удалось включить подмену видимости', e);
        G.__lgStealthActive = false;
    }

    // ------------------------------------------------------------
    // 0.1.0.1. Патч телеметрии: vh: 0 для POST /api/mine/*, /api/quest/*, /api/q*
    // Обёртка ставится один раз (флаг на page-window), чтобы не плодить слои.
    // ------------------------------------------------------------
    if (!G.__lgStealthFetchHooked) {
        G.__lgStealthFetchHooked = true;
        const stealthOrigFetch = G.fetch || window.fetch;
        const wrapFetch = function(...args) {
            try {
                const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
                const opts = args[1] || {};
                const isTarget = /\/api\/(mine|quest|q[a-z]+)/i.test(url);
                const isPost = (opts.method || 'GET').toUpperCase() === 'POST';

                if (isTarget && isPost && opts.body) {
                    if (typeof opts.body === 'string') {
                        try {
                            const bodyObj = JSON.parse(opts.body);
                            if (bodyObj && typeof bodyObj === 'object') {
                                let changed = false;
                                if (bodyObj.vh !== 0) { bodyObj.vh = 0; changed = true; }
                                if (bodyObj.k !== 1) { bodyObj.k = 1; changed = true; }
                                if (changed) {
                                    args[1] = { ...opts, body: JSON.stringify(bodyObj) };
                                }
                            }
                        } catch (e) {}
                    } else if (opts.body instanceof URLSearchParams) {
                        if (opts.body.get('vh') !== '0') opts.body.set('vh', '0');
                        if (opts.body.get('k') !== '1') opts.body.set('k', '1');
                    }
                }
            } catch (e) {}
            return stealthOrigFetch.apply(this, args);
        };
        G.fetch = wrapFetch;
        window.fetch = wrapFetch;
    }

    // ------------------------------------------------------------
    // 0.1.1. LGMine (шахта)
    //
    // Хук вынесен из общего гарда __lgHookedProps: шахта может
    // загрузиться позже аддона, поэтому и объявление свойства,
    // и «сторож» ниже обязаны отработать в любом случае.
    // ------------------------------------------------------------
    let rawLGMine = G.LGMine;

    const hookMine = (val) => {
        rawLGMine = val;
        if (val && !val.__hooked && typeof val.open === 'function') {
            val.__hooked = true;
            const orig = val.open;
            val.open = function (x, c) {
                // Контекст игры может содержать api() и/или art() — берём любой
                // из аргументов (в Ultimate арт приходит именно через .art).
                const ctx = (x && typeof x === 'object' && (typeof x.api === 'function' || typeof x.art === 'function')) ? x
                          : (c && typeof c === 'object' && (typeof c.api === 'function' || typeof c.art === 'function')) ? c
                          : null;
                if (ctx) G.__lgMineContext = ctx;
                return orig.apply(this, arguments);
            };
        }
    };

    if (rawLGMine) hookMine(rawLGMine);

    try {
        Object.defineProperty(G, 'LGMine', {
            configurable: true,
            enumerable: true,
            get: () => rawLGMine,
            set: (v) => hookMine(v)
        });
    } catch (e) {}

    // Сторож: LGMine мог загрузиться до аддона либо получить open позже.
    if (!G.__lgMineWatchdog) {
        G.__lgMineWatchdog = setInterval(() => {
            if (G.LGMine && !G.LGMine.__hooked) hookMine(G.LGMine);
        }, 1000);
    }

    if (!G.__lgHookedProps) {
        G.__lgHookedProps = true;
        let rawLGCity = G.LGCity;
        let rawLGAuction = G.LGAuction;
        let rawLGQuest = G.LGQuest;

        const hookCity = (val) => {
            rawLGCity = val;
            if (!val || val.__hooked) return;
            val.__hooked = true;

            if (typeof val.open === 'function') {
                const orig = val.open;
                val.open = function (r, cx) {
                    if (cx) G.__lgCityContext = cx;
                    return orig.apply(this, arguments);
                };
            }

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
        const hookQuest = (val) => {
            rawLGQuest = val;
            if (val && !val.__hooked && typeof val.open === 'function') {
                val.__hooked = true;
                const orig = val.open;
                val.open = function (el, qx) {
                    if (qx) G.__lgQuestContext = qx;
                    return orig.apply(this, arguments);
                };
            }
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

    // ===== src/core/ui.js =====
    // ============================================================
    // 2. UI-ФАБРИКА
    // ============================================================
    const UI = {
        _hudTimer: null,
        _toastTimer: null,
        _toastClickHandler: null,
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
            if (typeof Players !== 'undefined') Players.currentDMPeer = null;
            document.querySelectorAll('.' + DOM_IDS.customModal + ', .custom-modal').forEach(el => el.remove());
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

            // Восстановление позиции из localStorage под ключом LEGION_MODAL_POS
            try {
                const pos = JSON.parse(localStorage.getItem('LEGION_MODAL_POS') || 'null');
                if (pos && pos.left && pos.top) {
                    const leftVal = parseInt(pos.left, 10);
                    const topVal = parseInt(pos.top, 10);
                    const maxLeft = Math.max(10, (window.innerWidth || 1000) - (options.compact ? 100 : 200));
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

            document.body.appendChild(modal);
            const closeBtn = modal.querySelector('#custom-close-btn') || document.getElementById('custom-close-btn');
            if (closeBtn) closeBtn.addEventListener('click', () => this.closeModals());

            // Автоматическое перетаскивание окна за h2
            this.makeDraggable(modal, 'h2');

            return modal;
        },
        openPocketCity() {
            this.showModal(`
                <h2>🏰 Карманный Город <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="font-size:13px; color:#aaa; margin-bottom:15px; text-align:center;">
                    Прямой доступ к официальным зданиям игры из любой локации:
                </div>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:12px; margin-bottom:10px;">
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
                        <span>Когтекузня</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Заточка / Ремонт</small>
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
                </div>
            `);

            document.querySelectorAll('.pocket-grid-btn').forEach(btn => {
                btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-3px)'; btn.style.boxShadow = '0 6px 15px rgba(0,0,0,0.5)'; });
                btn.addEventListener('mouseleave', () => { btn.style.transform = 'none'; btn.style.boxShadow = 'none'; });
                btn.addEventListener('click', (e) => {
                    const room = e.currentTarget.getAttribute('data-room');
                    UI.closeModals();
                    if (room && typeof UI.openNativeBuilding === 'function') {
                        UI.openNativeBuilding(room);
                    }
                });
            });
        },
        async openNativeBuilding(roomId) {
            dbg(`Открытие нативного здания «${roomId}»...`);

            // 0. Нативно закрываем шахту, если она открыта (иначе игра выкинет на карту)
            const mnExitBtn = document.querySelector('[data-mn-exit]');
            if (mnExitBtn) {
                try { mnExitBtn.click(); } catch(e) {}
                // Даем игре 150мс, чтобы обработать выход, снять классы и перерисовать вкладки
                await new Promise(r => setTimeout(r, 150));
            }

            // 0.1. «Режим призрака» (на всякий случай, если шахта закрылась не до конца)
            const mn = document.querySelector('.mn');
            if (mn) {
                mn.style.setProperty('opacity', '0', 'important');
                mn.style.setProperty('pointer-events', 'none', 'important');
                mn.style.setProperty('z-index', '-9999', 'important');
                document.body.classList.remove('mn-on');
            }

            // 1. Снимаем блокировку похода (quest lockout / cityLocked)
            if (window.__lgQuestContext && typeof window.__lgQuestContext.openTown === 'function') {
                try { window.__lgQuestContext.openTown('fair'); } catch (e) {}
            }

            // 2. Гарантируем загрузку скриптов города
            if (!window.LGCity && typeof window.cityFiles === 'function') {
                try { await window.cityFiles(); } catch (e) {}
            }

            // 3. Разблокируем кнопку Города в шапке игры и переключаем вкладку
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

            // 4. Ожидаем инициализации LGCity и открываем официальное окно игры
            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                if (window.LGCity && typeof window.LGCity.panel === 'function') {
                    try {
                        window.LGCity.panel(roomId);
                        clearInterval(interval);
                    } catch (err) {
                        dbg('LGCity.panel attempt failed:', err);
                    }
                }
                if (attempts > 30) {
                    clearInterval(interval);
                    dbg('Город не загрузился вовремя.');
                    if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
                        UI.showToast('Город не загрузился вовремя', true);
                    }
                }
            }, 100);
        },
        setupFab(wrap, btn, menu) {
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
                    wrap.style.left = (e.clientX - offX) + 'px';
                    wrap.style.top = (e.clientY - offY) + 'px';
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
                    if (isOpen && typeof Players !== 'undefined' && Players.updateFriendsBadge) {
                        Players.updateFriendsBadge();
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
        },

        renderPlayerHudContent(hud, hero) {
            if (!hud) return;
            const name = hero?.name || hero?.n || window.LG_CH?.name || (window.ME?.user?.name) || 'Игрок';
            const rawClass = hero?.class || hero?.c || hero?.sk?.c || 'recruit';
            const className = (typeof BuildSim !== 'undefined' && BuildSim.classNames?.[rawClass]) || rawClass;
            const lvl = hero?.lvl || hero?.level || hero?.l || 1;

            // Здоровье: hero.hpNow / (hero.stats.hp или hero.hpMax)
            const hpNow = hero?.hpNow !== undefined ? hero.hpNow : (hero?.hp !== undefined ? hero.hp : '—');
            const hpMax = hero?.stats?.hp !== undefined ? hero.stats.hp : (hero?.hpMax !== undefined ? hero.hpMax : (hero?.maxHp || hero?.mhp || '—'));

            // Монеты: hero.money
            const moneyVal = hero?.money !== undefined ? hero.money : (hero?.coins !== undefined ? hero.coins : (hero?.gold !== undefined ? hero.gold : 0));

            const inMine = !!document.querySelector('.mn-world') ||
                           location.search.includes('sid=') ||
                           location.pathname.includes('/mine') ||
                           !!document.querySelector('.mn-screen') ||
                           (typeof Chat !== 'undefined' && Chat.isInMine && Chat.isInMine());
            const locText = inMine ? '⛏️ Шахта' : '🏙️ Город';
            const locColor = inMine ? '#4cc95a' : '#8fd3ff';

            hud.innerHTML = `
                <div class="player-hud-header" id="player-hud-drag-handle">
                    <span style="font-weight:bold; color:#ffcf6a; font-size:12px; display:flex; align-items:center; gap:4px;">
                        <span>👤</span> <span>${Utils.escapeHtml(name)}</span>
                    </span>
                    <button class="player-hud-close" id="player-hud-close-btn" title="Закрыть">✖</button>
                </div>
                <div class="player-hud-body">
                    <div class="player-hud-row">
                        <span class="player-hud-label">Класс:</span>
                        <span class="player-hud-val" style="color:#f7d794;">${Utils.escapeHtml(className)} (ур. ${lvl})</span>
                    </div>
                    <div class="player-hud-row">
                        <span class="player-hud-label">Здоровье:</span>
                        <span class="player-hud-val" id="player-hud-hp" style="color:#ff5a7a;">❤️ ${hpNow} / ${hpMax}</span>
                    </div>
                    <div class="player-hud-row">
                        <span class="player-hud-label">Монеты:</span>
                        <span class="player-hud-val" id="player-hud-money" style="color:#ffcf6a;">🪙 ${Utils.formatMoney(moneyVal)}</span>
                    </div>
                    <div class="player-hud-row">
                        <span class="player-hud-label">Локация:</span>
                        <span class="player-hud-val" id="player-hud-loc" style="color:${locColor};">${locText}</span>
                    </div>
                </div>
            `;

            hud.querySelector('#player-hud-close-btn')?.addEventListener('click', () => {
                hud.style.display = 'none';
                if (UI._hudTimer) {
                    clearInterval(UI._hudTimer);
                    UI._hudTimer = null;
                }
            });
        },

        setupPlayerHudDrag(hud) {
            let dragging = false, offX = 0, offY = 0;
            hud.addEventListener('pointerdown', (e) => {
                if (e.target.closest('#player-hud-close-btn') || !e.target.closest('#player-hud-drag-handle')) return;
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

            let hero = window.ME?.hero || window.ME?.me || window.__lgHero;
            if (hero) {
                this.renderPlayerHudContent(hud, hero);
            } else {
                hud.innerHTML = `
                    <div class="player-hud-header" id="player-hud-drag-handle">
                        <span style="font-weight:bold; color:#ffcf6a; font-size:12px;">👤 Профиль</span>
                        <button class="player-hud-close" id="player-hud-close-btn" title="Закрыть">✖</button>
                    </div>
                    <div class="player-hud-body" style="text-align:center; color:#aaa; padding:15px 10px;">
                        Загрузка профиля...
                    </div>
                `;
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

            // Динамическая локация и показатели каждые 1000 мс (§ Задача 1)
            this._hudTimer = setInterval(() => {
                if (!hud || hud.style.display === 'none') {
                    if (this._hudTimer) {
                        clearInterval(this._hudTimer);
                        this._hudTimer = null;
                    }
                    return;
                }
                const locEl = hud.querySelector('#player-hud-loc');
                if (locEl) {
                    const inMine = !!document.querySelector('.mn-world') ||
                                   location.search.includes('sid=') ||
                                   location.pathname.includes('/mine') ||
                                   !!document.querySelector('.mn-screen') ||
                                   (typeof Chat !== 'undefined' && Chat.isInMine && Chat.isInMine());
                    locEl.textContent = inMine ? '⛏️ Шахта' : '🏙️ Город';
                    locEl.style.color = inMine ? '#4cc95a' : '#8fd3ff';
                }

                const currentHero = window.ME?.hero || window.ME?.me || window.__lgHero;
                if (currentHero) {
                    const hpEl = hud.querySelector('#player-hud-hp');
                    if (hpEl) {
                        const curHp = currentHero.hpNow !== undefined ? currentHero.hpNow : (currentHero.hp !== undefined ? currentHero.hp : '—');
                        const mHp = currentHero.stats?.hp !== undefined ? currentHero.stats.hp : (currentHero.hpMax !== undefined ? currentHero.hpMax : (currentHero.maxHp || currentHero.mhp || '—'));
                        hpEl.textContent = `❤️ ${curHp} / ${mHp}`;
                    }
                    const moneyEl = hud.querySelector('#player-hud-money');
                    if (moneyEl) {
                        const mon = currentHero.money !== undefined ? currentHero.money : (currentHero.coins !== undefined ? currentHero.coins : (currentHero.gold !== undefined ? currentHero.gold : 0));
                        moneyEl.textContent = `🪙 ${Utils.formatMoney(mon)}`;
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

        statNames: { hp: 'Макс. HP', atk: 'Физ. урон', mag: 'Магия', def: 'Броня', crit: 'Крит %', dodge: 'Уклонение', pierce: 'Пробивание', resist: 'Сопротивление' },
        fxNames: { melee: 'Физ. урон %', magic: 'Магия %', hp: 'Макс. HP %', def: 'Броня', healPow: 'Сила лечения %', healIn: 'Вх. лечение %', crit: 'Крит %', critDmg: 'Сила крита', skel: 'Урон скелетов %', skelT: 'Время скелетов', leech: 'Вампиризм %', block: 'Снижение урона %', dodge: 'Уклонение %', lead: 'Урон по боссам %', first: 'Урон 1-й ход %', dmg: 'Весь урон %', pierce: 'Пробивание %', resist: 'Сопротивление', healCrit: 'Крит лечения %', regen: 'Регенерация %', low: 'Урон при низком HP %', a_siyanie: 'Сияние +%', a_obereg: 'Оберег +%', a_dlan: 'Длань +%', a_aura: 'Аура +%', aura: 'Аура −урон %', a_svet: 'Свет +%', a_vspyshka: 'Вспышка +%', a_oznob: 'Озноб +%', a_pricel: 'Прицел +%', a_grad: 'Град +%', a_natisk: 'Натиск +%', a_stoyka: 'Стойка +%', a_vspinu: 'Вспину +%', a_yad: 'Яд +%', a_vytyanut: 'Вытянуть +%', a_podnyat: 'Поднять +%', poison: 'Отрава %', steal: 'Кража %', loot: 'Добыча %', skelN: 'Скелетов +', volley: 'Залп +%', shieldBlock: 'Щит блок %', trapDodge: 'Ловушки %', steady: 'Промах→удар %', cleave: 'Замах %', cleaveBoss: 'Замах по боссу %', penBoss: 'Бронебой по боссу %', drain: 'Вытягивание %', hex: 'Проклятие +%', holy: 'По нежити +%', poisonT: 'Время отравы' },
        classNames: { recruit: '🐱 Новобранец', legionary: '🛡️ Легионер', archer: '🏹 Лучник', mage: '🔮 Маг', priest: '✨ Жрец', rogue: '🗡️ Разбойник', necromancer: '💀 Некромант', paladin: '🔨 Паладин' },
        nodeIcons: {
            nec_b_call: '💀', nec_b_grave: '❄️', nec_b_ward: '🛡️', nec_b_raise: '⬆️', nec_b_long: '⏳', nec_b_marrow: '🦴', nec_b_two: '👥', nec_b_hunger: '🍖', nec_b_fast: '⚡', nec_b_legion: '⚔️', nec_b_lich: '👑', nec_b_cap: '🌟',
            nec_l_sip: '🩸', nec_l_pale: '👻', nec_l_cold: '🧊', nec_l_drain: '🌪️', nec_l_thirst: '🥤', nec_l_skin: '🛡️', nec_l_deep: '🕳️', nec_l_regen: '💚', nec_l_low: '😫', nec_l_fast: '💨', nec_l_last: '🏺', nec_l_cap: '♾️',
            nec_d_bolt: '🏹', nec_d_eye: '👁️', nec_d_book: '📖', nec_d_curse: '🪄', nec_d_doom: '🎯', nec_d_mark: '💀', nec_d_hex: '🔮', nec_d_crit: '🦴', nec_d_omen: '☄️', nec_d_fast: '🤫', nec_d_rot: '🦠', nec_d_cap: '🌑',
            pri_h_hands: '🤲', pri_h_grace: '✨', pri_h_ward: '🛡️', pri_h_salve: '🧴', pri_h_cure: '💧', pri_h_quick: '⚡', pri_h_glow: '☀️', pri_h_halo: '😇', pri_h_miracle: '🪄', pri_h_vigil: '👁️', pri_h_spring: '⛲', pri_h_cap: '👑',
            pri_f_vest: '👕', pri_f_psalm: '📜', pri_f_hope: '🕊️', pri_f_wall: '🧱', pri_f_step: '👣', pri_f_omen: '🌟', pri_f_martyr: '🔥', pri_f_calm: '😌', pri_f_saint: '💫', pri_f_resur: '⚰️', pri_f_purity: '💎', pri_f_cap: '😇',
            pri_w_smite: '⚡', pri_w_censer: '🪔', pri_w_zeal: '💢', pri_w_judge: '⚖️', pri_w_sure: '🎯', pri_w_fervor: '❤️‍🔥', pri_w_wrath: '🌩️', pri_w_drain: '🩸', pri_w_last: '🙏', pri_w_doom: '💥', pri_w_dawn: '🌅', pri_w_cap: '🔨'
        },

        getNodeIcon(nodeId) {
            if (this.nodeIcons[nodeId]) return this.nodeIcons[nodeId];
            if (nodeId.startsWith('leg_')) return '⚔️';
            if (nodeId.startsWith('arc_')) return '🏹';
            if (nodeId.startsWith('mag_')) return '🔮';
            if (nodeId.startsWith('pri_')) return '✨';
            if (nodeId.startsWith('rog_')) return '🗡️';
            if (nodeId.startsWith('nec_')) return '💀';
            if (nodeId.startsWith('pal_')) return '🔨';
            return '⭐';
        },
        isSkipFx(key) { return SKIP_FX_PREFIXES.some(p => key.startsWith(p)); },

        // Текст навыка с подстановкой значений из node.fx (там прибавка за 1 ранг).
        // Для неизученного навыка (rank 0) показываем значения 1-го ранга.
        formatNodeText(node, rank) {
            if (!node.text) return '';
            const r = Math.max(1, rank); // Если ранг 0, показываем значение для 1-го ранга
            return node.text.replace(/\{(\w+)\}/g, (match, key) => {
                if (node.fx && node.fx[key] !== undefined) {
                    const val = node.fx[key] * r;
                    // Красивое форматирование: 1.2 -> "1.2", 3.0 -> "3"
                    return Number.isInteger(val) ? val.toString() : val.toFixed(1).replace('.0', '');
                }
                return match; // Если ключа нет в fx, оставляем как есть (или можно '?')
            });
        },

        init() {
            // Кнопка теперь принадлежит HeroPlanner — см. src/modules/hero-planner.js.
            // BuildSim остаётся как модуль и открывается из таба «Билды».
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.sim-node') && !e.target.closest('.sim-card')) {
                    document.querySelectorAll('.sim-card').forEach(c => c.remove());
                }
            });
        },

        async open() {
            const modal = UI.showModal(`<h2>🧮 Планировщик билдов <button class="custom-close" id="custom-close-btn">✖</button></h2><div id="buildsim-modal-body" style="display:flex; flex-direction:column; flex:1; min-height:0;"></div>`);
            const body = modal.querySelector('#buildsim-modal-body');
            if (body) await this.mount(body);
        },

        async mount(container) {
            if (!container) return;
            container.innerHTML = `<div class="loader">Загрузка данных...</div>`;
            try {
                const me = await Utils.fetchApi('/api/me');
                if (!me || !me.ok || !me.hero) throw new Error('Нет героя');
                if (!this.skillsCache) this.skillsCache = await Utils.fetchApi('/api/skills');
                if (!this.skillsCache || !this.skillsCache.classes) throw new Error('Нет данных о навыках');

                this.simulatedSkills = {};
                const h = me.hero;
                const equipped = h.items.filter(x => x.on);
                const bag = h.items.filter(x => !x.on && x.wearable);
                const allClasses = (this.skillsCache.classes || []).filter(c => c.branches && c.branches.length > 0);

                let tabsHtml = `<button class="modal-tab active" data-tab="gear">🛡️ Экипировка</button>`;
                allClasses.forEach(c => {
                    tabsHtml += `<button class="modal-tab" data-tab="${c.id}">${this.classNames[c.id] || c.name || c.id}</button>`;
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
                                    <div class="sim-top-bar">
                                        <div class="sim-free-pts">Свободно очков: <span id="free-${c.id}">0</span> / ${MAX_POINTS} <span style="font-size:12px;color:#aaa;">(Тестовый режим)</span></div>
                                        <button class="sim-reset-btn" data-reset="${c.id}">Сбросить всё</button>
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

                container.innerHTML = `
                    <div class="modal-tabs">${tabsHtml}</div>
                    ${contentHtml}
                `;

                container.querySelectorAll('.modal-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
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
            } catch (err) {
                dbg('[BUILD SIM] Ошибка монтирования:', err);
                container.innerHTML = `<div style="color:#ff5a7a; text-align:center; padding:20px;">Ошибка: ${err.message}</div>`;
            }
        },

        resetBuild(clsId) {
            this.simulatedSkills[clsId] = {};
            this.renderTree(clsId);
            document.querySelectorAll('.sim-card').forEach(c => c.remove());
        },

        yFor(req) {
            if (Y_MAP[req] !== undefined) return Y_MAP[req];
            return 680 - Math.round(((req || 0) / 30) * 600);
        },

        changeSkill(clsId, nodeId, delta, maxRank, preNode, branchReq, branchIds, event) {
            if (event) event.stopPropagation();
            if (!this.simulatedSkills[clsId]) this.simulatedSkills[clsId] = {};
            const simTree = this.simulatedSkills[clsId];
            const current = simTree[nodeId] || 0;
            if (delta > 0) {
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
                if (spent >= MAX_POINTS) return;
            }
            simTree[nodeId] = Math.max(0, current + delta);
            if (simTree[nodeId] === 0) delete simTree[nodeId];
            this.renderTree(clsId);
            const card = document.querySelector('.sim-card');
            if (card && card.dataset.node === nodeId) this.showNodeCard(clsId, nodeId, null);
        },

        renderTree(clsId) {
            const clsData = this.skillsCache.classes.find(c => c.id === clsId);
            if (!clsData) return;
            const container = document.getElementById(`tree-${clsId}`);
            if (!container) return;

            if (!this.simulatedSkills[clsId]) this.simulatedSkills[clsId] = {};
            const simTree = this.simulatedSkills[clsId];

            let spent = 0; Object.values(simTree).forEach(v => spent += v);
            const freeEl = document.getElementById(`free-${clsId}`);
            if (freeEl) freeEl.textContent = MAX_POINTS - spent;

            let html = '';
            const simStats = {};

            clsData.branches.forEach(branch => {
                let branchPoints = 0;
                (branch.nodes || []).forEach(n => branchPoints += (simTree[n.id] || 0));

                let lines = `<path d="M50% 20 L50% 680" class="trunk" style="stroke:#333;stroke-width:6px;" />`;
                (branch.nodes || []).forEach(node => {
                    if (node.pre) {
                        const parent = branch.nodes.find(n => n.id === node.pre);
                        if (parent) {
                            const pNodes = branch.nodes.filter(n => n.req === parent.req);
                            const cNodes = branch.nodes.filter(n => n.req === node.req);
                            const px = pNodes.length === 1 ? 50 : (pNodes.indexOf(parent) === 0 ? 25 : 75);
                            const cx = cNodes.length === 1 ? 50 : (cNodes.indexOf(node) === 0 ? 25 : 75);
                            const active = (simTree[node.id] || 0) > 0;
                            const py = this.yFor(parent.req);
                            const cy = this.yFor(node.req);
                            lines += `<path d="M${px}% ${py} L${cx}% ${cy}" class="${active ? 'active' : ''}"/>`;
                        }
                    }
                });

                html += `<div class="sim-branch">
                    <div class="sim-branch-header">${branch.name}<div class="sim-branch-pts">${branchPoints} очков</div></div>
                    <svg class="sim-lines" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;overflow:visible;">${lines}</svg>`;

                (branch.nodes || []).forEach(node => {
                    const rank = simTree[node.id] || 0;
                    const locked = branchPoints < node.req || (node.pre && !(simTree[node.pre] > 0));
                    const maxed = rank >= node.max;

                    if (rank > 0 && node.fx) {
                        for (const [k, v] of Object.entries(node.fx)) {
                            if (this.isSkipFx(k)) continue;
                            simStats[k] = (simStats[k] || 0) + (v * rank);
                        }
                    }

                    const tier = branch.nodes.filter(n => n.req === node.req);
                    let left = 50;
                    if (tier.length === 2) left = tier.indexOf(node) === 0 ? 25 : 75;
                    if (tier.length === 3) left = [15, 50, 85][tier.indexOf(node)];

                    let ranksHtml = '';
                    for (let i = 0; i < node.max; i++) ranksHtml += `<i class="${i < rank ? 'filled' : ''}"></i>`;
                    const icon = this.getNodeIcon(node.id);
                    const top = this.yFor(node.req);

                    html += `<div class="sim-node ${locked ? 'locked' : (maxed ? 'maxed' : 'available')}"
                        data-cls="${clsId}" data-node="${node.id}"
                        style="left:${left}%;top:${top}px">
                        <div class="sim-node-icon">${icon}</div>
                        <div class="sim-node-ranks">${ranksHtml}</div>
                        <div class="sim-node-name">${node.name}</div>
                    </div>`;
                });
                html += `</div>`;
            });

            container.innerHTML = html;

            container.querySelectorAll('.sim-node').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showNodeCard(el.dataset.cls, el.dataset.node, e);
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
        },

        showNodeCard(clsId, nodeId, event) {
            if (event) { event.stopPropagation(); event.preventDefault(); }
            const x = event ? event.clientX : window.innerWidth / 2;
            const y = event ? event.clientY : window.innerHeight / 2;

            document.querySelectorAll('.sim-card').forEach(c => c.remove());
            const clsData = this.skillsCache.classes.find(c => c.id === clsId);
            if (!clsData) return;
            const branch = clsData.branches.find(b => (b.nodes || []).some(n => n.id === nodeId));
            if (!branch) return;
            const node = branch.nodes.find(n => n.id === nodeId);
            if (!node) return;

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

            const card = document.createElement('div');
            card.className = 'sim-card';
            card.dataset.node = nodeId;
            card.style.display = 'block';

            const cw = 280, ch = 200;
            let px = x + 15, py = y - 50;
            if (px + cw > window.innerWidth) px = x - cw - 15;
            if (py + ch > window.innerHeight) py = window.innerHeight - ch - 20;
            if (py < 20) py = 20;
            card.style.left = px + 'px';
            card.style.top = py + 'px';

            card.innerHTML = `
                <div class="sim-card-close">✖</div>
                <h4>${node.name} <span>${rank}/${node.max}</span></h4>
                <div class="desc">${this.formatNodeText(node, rank)}</div>
                ${reqText ? `<div class="req">${reqText}</div>` : ''}
                <div class="controls">
                    <button data-action="minus" ${rank === 0 ? 'disabled' : ''}>- Убрать</button>
                    <button data-action="plus" ${maxed || locked ? 'disabled' : ''}>+ Вложить</button>
                </div>`;
            document.body.appendChild(card);

            card.querySelector('.sim-card-close').addEventListener('click', (e) => {
                e.stopPropagation();
                card.remove();
            });
            card.querySelectorAll('button[data-action]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const delta = btn.dataset.action === 'plus' ? 1 : -1;
                    this.changeSkill(clsId, node.id, delta, node.max, node.pre || null, node.req || 0, branchIds, e);
                });
            });
        }
    };

    // ===== src/modules/hero-planner.js =====
    // ============================================================
    // 4.1. МОДУЛЬ: ПЛАНИРОВЩИК ГЕРОЯ
    // Вкладки: Билды (заглушка → BuildSim), Заточка (рабочий калькулятор).
    // ============================================================
    const HeroPlanner = {
        // Таблица заточки (05_Mechanics.md). TODO: переключить источник на
        // hero.crafts / API в v1.1, если игра начнёт отдавать таблицу.
        ENCH: {
            max: 15,
            chance: [0, 95, 90, 80, 70, 55, 42, 30, 20, 12, 7, 4, 2, 1, 0.5, 0],
            bonus:  [0, 4, 9, 15, 22, 31, 42, 56, 74, 97, 125, 160, 200, 250, 310, 400],
            price:  [0, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5.5, 7.5, 10, 13, 17, 22, 28, 35],
            priceMin: 10,
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

        // Округление подтверждено живой игрой: и статы, и цена считаются через
        // Math.round. Все вызовы идут сюда — если поведение изменится, правим здесь.
        enchantStat(base, en) {
            const bonus = this.ENCH.bonus[Math.min(15, +en || 0)] || 0;
            return Math.round(base * (1 + bonus / 100));
        },

        enchantCost(itemV, level) {
            const pct = this.ENCH.price[Math.min(15, +level || 0)] || 0;
            return Math.max(this.ENCH.priceMin, Math.round(itemV * pct / 100));
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
                ownTabs?.querySelectorAll('.modal-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        ownTabs.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                        ownContents().forEach(c => c.classList.remove('active'));
                        tab.classList.add('active');
                        const target = document.getElementById(`tab-${tab.dataset.tab}`);
                        if (target) target.classList.add('active');
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
                        const curBonus = this.ENCH.bonus[Math.min(15, curEn)] || 0;
                        const divisor = 1 + curBonus / 100;
                        for (const [k, v] of Object.entries(item.stats || {})) {
                            baseStats[k] = Math.round(v / divisor);
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

                        // Применяем ресурсы
                        if (useStar) { chance += 25; cost += this.COST_STAR; starsUsed++; }
                        if (useSphere) { cost += this.COST_SPHERE; spheresUsed++; }

                        // Сумма с учетом выбранных стратегий
                        cumulativeStrat += cost;

                        // Выбираем, какую сумму показывать
                        const totalCostStr = isExpected
                            ? Utils.formatMoney(cumulativeStrat)
                            : Utils.formatMoney(cumulativeIdeal);

                        const statsLine = Object.entries(baseStats).map(([k, base]) => {
                            const final = this.enchantStat(base, lv);
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

                        // Бонус заточки на этом уровне (ENCH.bonus, %), для новых уровней — 0
                        const bonusPct = this.ENCH.bonus[lv] || 0;
                        rows += `<tr style="${isCur ? 'background:rgba(202,165,92,0.12);' : ''}">
                            <td><b>+${lv}</b>${isCur ? ' <small style="color:#ffcf6a;">(текущая)</small>' : ''}</td>
                            <td>${Math.min(100, chance)}%</td>
                            <td style="color:#4cc95a; font-weight:bold;">+${bonusPct}%</td>
                            <td>${Utils.formatMoney(cost)}</td>
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
                            ⭐ Звезда: +25% к шансу, +300 к цене. 🌐 Сфера: защита от поломки, +900 к цене.<br>
                            «Суммарно» = стоимость всех попыток с +1 до +N с учетом выбранных вами ресурсов.
                        </div>`
                            : `<div style="margin-top:10px; font-size:11px; color:#888; line-height:1.5;">
                            Стоимость = <code>max(10, round(v × price% / 100))</code>. Округление статов — <code>Math.round</code> (подтверждено игрой).<br>
                            <b>«Суммарно до +N»</b> = сумма всех базовых стоимостей с +1 до +N (без учета шансов и поломок, «идеальная» стоимость).
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

            } catch (err) {
                dbg('[HERO PLANNER] Ошибка:', err);
                UI.showModal(`<h2>❌ Ошибка <button class="custom-close" id="custom-close-btn">✖</button></h2><p>${Utils.escapeHtml(err.message)}</p>`);
            }
        }
    };

    // ===== src/modules/auction.js =====
    // ============================================================
    // 5. МОДУЛЬ: СКАНЕР АУКЦИОНА
    // ============================================================
    const Auction = {
        cityStockMap: new Map(),
        cityStockLoaded: false,
        cityStockLoading: null,
        ENCH_BONUS: [0, 4, 9, 15, 22, 31, 42, 56, 74, 97, 125, 160, 200, 250, 310, 400],

        init() {
            (document.getElementById(DOM_IDS.btnAuctionScan) || document.getElementById('btn-auction-scan'))?.addEventListener('click', () => this.open());
        },

        // Загрузка ассортимента и официальных цен магазинов города (/api/city/stock)
        async fetchCityStock() {
            if (this.cityStockLoaded && this.cityStockMap.size > 0) return this.cityStockMap;
            if (this.cityStockLoading) return this.cityStockLoading;

            this.cityStockLoading = (async () => {
                try {
                    const res = await Utils.fetchApi('/api/city/stock');
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
                    dbg('[AUCTION] Ошибка загрузки /api/city/stock:', e);
                } finally {
                    this.cityStockLoading = null;
                }
                return this.cityStockMap;
            })();

            return this.cityStockLoading;
        },

        getLotEvaluation(lot, data = null, activeMap = null) {
            const en = +lot.e || +lot.en || 0;
            const n = Math.max(1, +lot.n || +lot.qty || 1);
            const price = +lot.p || +lot.totalPrice || 0;
            const unitPrice = price / n;

            // 1. Поиск базовой цены в кэше магазинов
            const shopPrice = this.cityStockMap ? (this.cityStockMap.get(lot.i) || 0) : 0;
            const bonus = en > 0 ? (this.ENCH_BONUS[Math.min(15, en)] || 0) : 0;

            let fairUnit = 0;
            let sourceType = 'none';

            if (shopPrice > 0) {
                // Если shopPrice > 0, то fairUnit = shopPrice * (1 + bonus / 100)
                sourceType = 'shop';
                fairUnit = Math.max(1, Math.round(shopPrice * (1 + bonus / 100)));
            } else if (data && data.vals && data.vals[lot.i]) {
                sourceType = 'val';
                fairUnit = Math.max(1, Math.round(data.vals[lot.i] * (1 + bonus / 100)));
            } else if (activeMap && activeMap.has(lot.i)) {
                const arr = activeMap.get(lot.i);
                if (arr && arr.length >= 2) {
                    const sorted = arr.slice().sort((a, b) => a - b);
                    const med = sorted[Math.floor(sorted.length / 2)];
                    fairUnit = Math.round(med * (1 + bonus / 100));
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
                shopPrice
            };
        },

        getItemName(id, itemsMap = null) {
            if (!id) return '—';

            // 1. Сначала ищем в data.items[lot.i]?.name (или res.items[l.i]?.name из ответа аукциона)
            if (itemsMap && itemsMap[id]?.name) {
                return itemsMap[id].name;
            }

            // 2. MDDoodle
            try {
                const mdName = window.MDDoodle?.names?.[id] || window.MDDoodle?.names?.cats?.items?.[id]?.name;
                if (mdName) return mdName;
            } catch (e) {}

            // 3. Словарь известных популярных ресурсов
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

            // 4. Если в id есть знак подчеркивания _, заменяем его на пробел и делаем первую букву каждого слова заглавной
            if (typeof id === 'string' && id.includes('_')) {
                return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            }

            return String(id);
        },

        // Умный парсер: определяет слот, редкость и класс по ID предмета
        getItemMeta(id, rarityHint = '') {
            if (!id) return { slot: '', rarity: '', role: '' };

            let item = {};
            try { item = window.MDDoodle?.names?.cats?.items?.[id] || {}; } catch(e) {}

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
                else if (id.match(/(potion|apple|pear|pretzel|bread|kvass|cheese|pie|ham|roast|tea|stew|candy|milk)/)) slot = 'food';
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

        async open() {
            UI.showModal(`<h2>🔍 Сканер Аукциона <button class="custom-close" id="custom-close-btn">✖</button></h2><div class="loader">Считаем цены...</div>`);
            try {
                if (!this.cityStockLoaded) {
                    await this.fetchCityStock();
                }
                const res = await Utils.fetchApi('/api/auction');
                const lots = res.lots || res.body?.lots;
                if (!lots || !Array.isArray(lots) || !lots.length) {
                    return UI.showModal('<h2>Аукцион пуст <button class="custom-close" id="custom-close-btn">✖</button></h2>');
                }
                const itemsMap = res.items || res.body?.items || (res.data && res.data.items) || {};

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
                    const meta = this.getItemMeta(group.id, serverRarity); // Получаем слот, редкость, класс

                    group.lots.forEach(l => {
                        const ev = this.getLotEvaluation(l, res, activeMap);
                        const basePrice = ev.fairUnit > 0 ? ev.fairUnit : median;
                        const disc = ev.fairUnit > 0 ? ev.discount : (median > 0 ? Math.round(((median - l.unitPrice) / median) * 100) : 0);
                        const en = Number(l.en || l.e || l.enchant || 0);

                        processed.push({
                            id: l.i,
                            e: en,
                            name: this.getItemName(l.i, itemsMap) + (en > 0 ? ' +' + en : ''),
                            icon: Utils.getItemIcon(l.i),
                            qty: l.qty,
                            totalPrice: l.p,
                            unitPrice: l.unitPrice,
                            median: basePrice,
                            discount: disc,
                            timeLeft: Utils.formatTimeLeft(l.u),
                            seller: l.sn || l.s || '—',
                            metaSlot: meta.slot,
                            metaRarity: meta.rarity,
                            metaRole: meta.role,
                            sourceType: ev.sourceType,
                            lotId: l.id
                        });
                    });
                }

                UI.showModal(`
                    <h2>🔍 Сканер Аукциона <button class="custom-close" id="custom-close-btn">✖</button></h2>

                    <div style="display:flex; gap:10px; margin-bottom:15px; flex-wrap:wrap; align-items:center;">
                        <input type="text" id="auction-search" class="search-bar" style="margin:0; flex:1; min-width:200px;" placeholder="Поиск по названию...">

                        <select id="auction-filter-slot" class="search-bar" style="margin:0; width:auto; cursor:pointer;">
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

                        <select id="auction-filter-rarity" class="search-bar" style="margin:0; width:auto; cursor:pointer;">
                            <option value="">✨ Все редкости</option>
                            <option value="common">Обычное</option>
                            <option value="uncommon">Необычное</option>
                            <option value="rare">Редкое</option>
                            <option value="epic">Эпическое</option>
                            <option value="legendary">Легендарное</option>
                        </select>

                        <select id="auction-filter-role" class="search-bar" style="margin:0; width:auto; cursor:pointer;">
                            <option value="">🛡️ Все классы</option>
                            <option value="legionary">Легионер</option>
                            <option value="archer">Лучник</option>
                            <option value="mage">Маг</option>
                            <option value="priest">Жрец</option>
                            <option value="rogue">Разбойник</option>
                            <option value="necromancer">Некромант</option>
                            <option value="paladin">Паладин</option>
                        </select>

                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:#ffcf6a; font-weight:bold; font-size:14px; margin-left:auto;">
                            <input type="checkbox" id="auction-only-deals" style="width:16px; height:16px; accent-color:#caa55c;"> Только выгодные
                        </label>
                    </div>

                    <div class="table-container">
                        <table>
                            <thead><tr>
                                <th data-sort="name">Вещь</th>
                                <th data-sort="qty">Кол-во</th>
                                <th data-sort="totalPrice">Цена (общая)</th>
                                <th data-sort="unitPrice">Цена за 1 шт</th>
                                <th data-sort="median">Медиана</th>
                                <th data-sort="discount">Выгода</th>
                                <th data-sort="u">Осталось</th>
                                <th>Продавец</th>
                                <th style="width:75px; text-align:center;">Действие</th>
                            </tr></thead>
                            <tbody id="auction-body"></tbody>
                        </table>
                    </div>
                    <div style="margin-top:10px; font-size:12px; color:#888; text-align:right;">
                        Показаны первые 100 лотов из <span id="auction-count">0</span>
                    </div>`);

                const renderTable = (data) => {
                    const tbody = document.getElementById('auction-body');
                    const countEl = document.getElementById('auction-count');
                    if (!tbody) return;

                    countEl.textContent = data.length;

                    if (!data.length) {
                        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#888; padding:20px;">Ничего не найдено по заданным фильтрам.</td></tr>';
                        return;
                    }

                    const displayList = data.slice(0, 100);
                    let html = '';

                    displayList.forEach(l => {
                        const cls = l.discount >= 20 ? 'deal-great' : (l.discount >= 10 ? 'deal-good' : (l.discount < 0 ? 'deal-bad' : 'stat-eq'));
                        const qtyStr = l.qty > 1 ? `<b>${l.qty}</b>` : '1';
                        const totalPriceStr = l.qty > 1 ? `${Utils.formatMoney(l.totalPrice)} <small style="color:#888">(${Utils.formatMoney(l.unitPrice)})</small>` : Utils.formatMoney(l.totalPrice);

                        const rarityColors = { common: '#c9ccd6', uncommon: '#4cc95a', rare: '#4aa3ff', epic: '#b06bff', legendary: '#ffb83d' };
                        const color = rarityColors[l.metaRarity] || '#fff';
                        const rarityBadge = l.metaRarity ? `<span style="color:${color}; font-size:10px; border:1px solid ${color}; border-radius:4px; padding:0 4px; margin-left:5px; text-transform:capitalize;">${Utils.escapeHtml(l.metaRarity)}</span>` : '';

                        html += `<tr data-lot-id="${Utils.escapeHtml(l.id || '')}" data-lot-name="${Utils.escapeHtml(l.name || '')}">
                            <td>${l.icon ? `<img src="${Utils.safeUrl(l.icon)}" style="width:20px;vertical-align:middle;margin-right:5px;">` : ''}<b>${Utils.escapeHtml(l.name)}</b>${rarityBadge}</td>
                            <td>${qtyStr}</td>
                            <td style="color:#ffcf6a; font-weight:bold;">${totalPriceStr}</td>
                            <td style="font-weight:bold;">${Utils.formatMoney(l.unitPrice)}</td>
                            <td>${Utils.formatMoney(l.median)}</td>
                            <td class="${cls}">${l.discount > 0 ? '-' : '+'}${Math.abs(l.discount)}%</td>
                            <td style="color:#888;">${Utils.escapeHtml(l.timeLeft)}</td>
                            <td>${Utils.escapeHtml(l.seller || '')}</td>
                            <td style="text-align:center;">
                                <button class="auc-buy-btn" data-buy-lot="${l.lotId || l.id}" data-price="${l.totalPrice}" data-name="${Utils.escapeHtml(l.name)}">Купить</button>
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
                        if (!lotId) {
                            alert('Не удалось определить ID лота');
                            return;
                        }

                        if (!window.confirm(`Вы уверены, что хотите купить ${name} за ${Utils.formatMoney(price)}?`)) {
                            return;
                        }

                        btn.disabled = true;
                        const origText = btn.textContent;
                        btn.textContent = '...';

                        try {
                            const res = await Utils.fetchApi('/api/aucBuy', { lot: String(lotId), price: Number(price) });
                            const data = res?.body || res;
                            if (data && (data.ok || data.success || !data.error)) {
                                alert(`Успешно куплено: ${name}!`);
                                Auction.open();
                            } else {
                                const errMsg = data?.error || data?.msg || data?.err || 'Не удалось купить лот';
                                alert(`Ошибка покупки: ${errMsg}`);
                                btn.disabled = false;
                                btn.textContent = origText;
                            }
                        } catch (err) {
                            alert(`Ошибка покупки: ${err.message || err}`);
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
                        if (fSlot && l.metaSlot && l.metaSlot !== fSlot) return false;
                        if (fRarity && l.metaRarity && l.metaRarity !== fRarity) return false;

                        // Если выбран класс, показываем предметы этого класса + универсальные
                        if (fRole && l.metaRole && l.metaRole !== fRole) return false;

                        if (onlyDeals && l.discount < 10) return false;
                        return true;
                    });

                    renderTable(filtered);
                };

                current.sort((a, b) => b.discount - a.discount);
                update();

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
        _badgeTimer: null,
        _updateFriendsListFn: null,
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
            // Перерисовываем список друзей (если открыт) и вкладку «✉️ ЛС» (если активна)
            try {
                const listEl = document.getElementById('friends-view-list');
                if (listEl && listEl.style.display !== 'none' && typeof this._updateFriendsListFn === 'function') {
                    this._updateFriendsListFn();
                }
            } catch (e) {}
            try {
                if (typeof Chat !== 'undefined' && Chat.activeMainTab === 'dm' && typeof Chat.renderMessages === 'function') {
                    Chat.renderMessages();
                }
            } catch (e) {}
        },

        init() {
            (document.getElementById(DOM_IDS.btnPlayers) || document.getElementById('btn-players'))?.addEventListener('click', () => this.open());
            (document.getElementById(DOM_IDS.btnFriends) || document.getElementById('btn-friends'))?.addEventListener('click', () => this.openFriends());
            this.updateFriendsBadge();

            // Автообновление бейджа и списка друзей раз в 1.5 секунды
            if (this._badgeTimer) clearInterval(this._badgeTimer);
            this._badgeTimer = setInterval(() => {
                this.updateFriendsBadge();
                const listEl = document.getElementById('friends-view-list');
                if (listEl && listEl.style.display !== 'none' && typeof this._updateFriendsListFn === 'function') {
                    this._updateFriendsListFn();
                }
            }, 1500);
        },

        onOnlinePlayersUpdated() {
            this.updateFriendsBadge();
            const listEl = document.getElementById('friends-view-list');
            if (listEl && listEl.style.display !== 'none' && typeof this._updateFriendsListFn === 'function') {
                this._updateFriendsListFn();
            }
        },

        getFriendsList() {
            try {
                const raw = localStorage.getItem('LEGION_FRIENDS');
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    return [...new Set(arr.map(s => String(s).trim()).filter(Boolean))];
                }
            } catch (e) {}
            return [];
        },

        saveFriendsList(list) {
            try {
                const clean = [...new Set((list || []).map(s => String(s).trim()).filter(Boolean))];
                localStorage.setItem('LEGION_FRIENDS', JSON.stringify(clean));
                this.updateFriendsBadge();
            } catch (e) {
                dbg('Error saving friends list:', e);
            }
        },

        isFriend(nick) {
            if (!nick) return false;
            const target = String(nick).trim().toLowerCase();
            return this.getFriendsList().some(n => n.toLowerCase() === target);
        },

        addFriend(rawNick) {
            if (!rawNick) return false;
            const nick = String(rawNick).trim();
            if (nick.length < 2 || nick.length > 30) {
                UI.showToast('Некорректный ник игрока', true);
                return false;
            }
            const myNick = this.getMyNick().toLowerCase();
            if (myNick && nick.toLowerCase() === myNick) {
                UI.showToast('Нельзя добавить себя в друзья', true);
                return false;
            }
            if (this.isFriend(nick)) {
                UI.showToast(`${nick} уже в друзьях`);
                return false;
            }
            const list = this.getFriendsList();
            list.push(nick);
            this.saveFriendsList(list);
            UI.showToast(`🤝 ${nick} добавлен в друзья!`);
            return true;
        },

        removeFriend(rawNick) {
            if (!rawNick) return false;
            const target = String(rawNick).trim().toLowerCase();
            const list = this.getFriendsList().filter(n => n.toLowerCase() !== target);
            this.saveFriendsList(list);
            UI.showToast(`❌ ${rawNick} удален из друзей`);
            return true;
        },

        updateFriendsBadge() {
            const friends = this.getFriendsList();
            const badge = document.getElementById(DOM_IDS.friendsBadge);
            if (!friends.length) {
                if (badge) badge.style.display = 'none';
                return 0;
            }
            const citySet = this.getCityPlayers();
            const mineSet = this.getMinePlayers();
            let onlineCount = 0;
            friends.forEach(f => {
                const k = f.toLowerCase();
                if (citySet.has(k) || mineSet.has(k)) {
                    onlineCount++;
                }
            });

            if (badge) {
                if (onlineCount > 0) {
                    badge.textContent = String(onlineCount);
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }
            return onlineCount;
        },

        getMyNick() {
            return (window.ME && (window.ME.user?.name || window.ME.hero?.n || window.ME.hero?.name)) ||
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
                    const dbgVal = window.LGCity?.debug?.();
                    if (dbgVal && Array.isArray(dbgVal.others)) {
                        dbgVal.others.forEach(l => { if (l) set.add(String(l).trim().toLowerCase()); });
                    }
                } catch (e) {}
                try {
                    const peek = window.LGCity?.peek?.();
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
                const st = window.__lgMineState;
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
                    const st = window.__lgMineState;
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
            if (window.location.pathname.includes('/mine') || document.querySelector('.mn-heroes') || window.__lgMineState) {
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

            this.updateFriendsBadge();
        },

        openTradeWith(nick) {
            if (!nick) return;
            try {
                if (window.LGTrade && typeof window.LGTrade.invite === 'function') {
                    window.LGTrade.invite(nick);
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
                await Utils.fetchApi('/api/city/enter', {});
            } catch (e) {
                dbg('Session warmup failed', e);
            }

            const payload = { text: cleanText, to: nick, k: 'dm' }; // k: 'dm' обязателен!

            try {
                let data = null;
                let nativeOk = null;

                // 1. Пытаемся использовать нативный контекст города (как в прошлой версии)
                const nativeCtx = window.__lgCityContext || window.LGCity;
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
                if (!data) {
                    const res = await fetch('/api/city/say', {
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

        async openWhisperWith(nick, text = '') {
            if (!nick) return;

            // Ищем чат, который НЕ находится внутри контейнера шахты (.mn)
            let chatBox = null;
            const allChats = document.querySelectorAll('.cy-chat');
            for (const box of allChats) {
                if (!box.closest('.mn')) { // Если это не чат шахты
                    chatBox = box;
                    break;
                }
            }
            if (!chatBox) return; // Если городского чата нет на странице, ничего не делаем

            // Нативный триггер игры: .cy-chat → временный [data-dm] → вкладка ЛС
            try {
                const toggleBtn = chatBox.querySelector('.cy-chat-t');
                if (toggleBtn && (toggleBtn.getAttribute('aria-expanded') === 'false' || chatBox.querySelector('.cy-chat-b')?.hidden)) {
                    toggleBtn.click();
                }

                const list = chatBox.querySelector('.cy-chat-l');
                if (list) {
                    const dummy = document.createElement('span');
                    dummy.setAttribute('data-dm', nick);
                    list.appendChild(dummy);
                    dummy.click();
                    dummy.remove();
                }

                const dmTab = chatBox.querySelector('[data-tab="dm"]');
                if (dmTab) dmTab.click();

                // Текст вставляем только в инпут найденного (городского) чата
                const inp = chatBox.querySelector('.cy-chat input') || chatBox.querySelector('input');
                if (inp) {
                    if (text) inp.value = text;
                    inp.focus();
                }
            } catch (e) {
                dbg('openWhisperWith native trigger failed:', e);
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
                : (window.__lgMineState?.here || window.__lgMineState?.st?.here || 0);
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
                        : (window.__lgMineState?.here || window.__lgMineState?.st?.here || 0);
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
                    if (this.isFriend(p.nick)) badges.push(`<span style="background:rgba(202,165,92,0.25);color:#ffcf6a;border:1px solid #caa55c;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;">⭐ Друг</span>`);
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

        async openFriends() {
            UI.showModal(`<h2>🤝 Друзья <button class="custom-close" id="custom-close-btn">✖</button></h2><div class="loader">Сканируем локации...</div>`, { compact: true });
            await this.scan();
            this.renderFriends();
        },

        renderFriends() {
            UI.showModal(`
                <h2>🤝 Друзья <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div id="friends-view-list" style="display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden;">
                    <div style="display:flex; gap:8px; margin-bottom:12px; align-items:center; background:#1e1724; padding:8px 10px; border-radius:6px; border:1px solid #3d2f44;">
                        <input type="text" id="friend-add-input" class="search-bar" style="margin:0; flex:1; padding:6px 10px; font-size:13px;" placeholder="➕ Введите ник для добавления...">
                        <button id="friend-add-btn" style="background:#28a745; color:#fff; border:none; padding:6px 14px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px; white-space:nowrap;">Добавить</button>
                    </div>

                    <div style="display:flex; gap:8px; margin-bottom:12px; align-items:center;">
                        <input type="text" id="friends-search" class="search-bar" style="margin:0; flex:1; padding:6px 10px; font-size:13px;" placeholder="🔍 Поиск среди друзей...">
                        <button id="friends-refresh" style="background:#caa55c; color:#1d1620; border:none; padding:6px 14px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">🔄 Обновить</button>
                    </div>

                    <div style="font-size:12px; color:#aaa; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                        <span id="friends-count">Всего друзей: 0</span>
                        <span style="color:#ffcf6a;">(Нажмите на карточку для досье)</span>
                    </div>

                    <div id="friends-items" style="max-height:42vh; overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding-right:2px;"></div>
                </div>
                <div id="friends-view-dossier" style="display:none; max-height:52vh; overflow-y:auto; padding-right:2px;"></div>
            `, { compact: true });

            const updateFriendsList = () => {
                const q = (document.getElementById('friends-search')?.value || '').trim().toLowerCase();
                const container = document.getElementById('friends-items');
                const countEl = document.getElementById('friends-count');
                if (!container) return;
                const prevScroll = container.scrollTop;

                const friends = this.getFriendsList();
                const citySet = this.getCityPlayers();
                const mineSet = this.getMinePlayers();

                let onlineCount = 0;
                friends.forEach(f => {
                    const k = f.toLowerCase();
                    if (citySet.has(k) || mineSet.has(k)) onlineCount++;
                });

                if (countEl) {
                    countEl.innerHTML = `Всего друзей: <b>${friends.length}</b> (онлайн: <span style="color:#00ff66; font-weight:bold;">${onlineCount}</span>)`;
                }

                if (friends.length === 0) {
                    container.innerHTML = `<div style="text-align:center; padding:30px 15px; color:#888; font-style:italic;">У вас пока нет друзей в списке.<br><span style="font-size:12px; color:#aaa;">Добавьте друга через поле выше или нажмите ⭐ в Досье игрока.</span></div>`;
                    return;
                }

                // Сортировка: онлайн вверху, затем по алфавиту
                const sorted = [...friends].sort((a, b) => {
                    const aNear = (citySet.has(a.toLowerCase()) || mineSet.has(a.toLowerCase())) ? 1 : 0;
                    const bNear = (citySet.has(b.toLowerCase()) || mineSet.has(b.toLowerCase())) ? 1 : 0;
                    if (bNear !== aNear) return bNear - aNear;
                    return a.localeCompare(b);
                });

                const filtered = sorted.filter(f => !q || f.toLowerCase().includes(q));
                if (filtered.length === 0) {
                    container.innerHTML = `<div style="text-align:center; padding:20px; color:#888;">Друзья не найдены</div>`;
                    return;
                }

                const dmBtnStyle = 'background:#007bff; color:#fff; border:none; border-radius:4px; padding:3px 7px; cursor:pointer; font-size:12px; line-height:1; user-select:none;';
                const dmBtnTitle = 'Написать в ЛС';

                container.innerHTML = filtered.map(nick => {
                    const key = nick.toLowerCase();
                    const p = this.playersMap.get(key) || { nick, sources: new Set(), lastSeen: 0, lotsCount: 0 };
                    const isCity = citySet.has(key);
                    const isMine = mineSet.has(key);

                    const badges = [];
                    if (isCity) badges.push(`<span style="background:rgba(0,255,102,0.18);color:#00ff66;border:1px solid rgba(0,255,102,0.4);padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;">🏛️ В Городе</span>`);
                    if (isMine) badges.push(`<span style="background:rgba(255,153,0,0.18);color:#ff9900;border:1px solid rgba(255,153,0,0.4);padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;">⛏️ В Шахте</span>`);
                    if (p.lotsCount > 0) badges.push(`<span style="background:rgba(255,215,0,0.15);color:#ffd700;border:1px solid rgba(255,215,0,0.3);padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;">🏛️ Лотов: ${p.lotsCount}</span>`);
                    if (!isCity && !isMine) badges.push(`<span style="background:rgba(150,150,150,0.15);color:#8899aa;border:1px solid rgba(150,150,150,0.3);padding:2px 6px;border-radius:4px;font-size:11px;">📍 Не в сети</span>`);

                    return `
                        <div class="friend-card-row" data-nick="${Utils.escapeHtml(nick)}" style="background:#26202e; border:1px solid #44374a; border-radius:6px; padding:8px 12px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; transition:all 0.15s;">
                            <span style="font-weight:bold; color:#f7eadf; font-size:13px; display:flex; align-items:center; gap:6px;">${Utils.escapeHtml(nick)}${this.getUnreadDM(nick) > 0 ? `<span title="Непрочитанных ЛС: ${this.getUnreadDM(nick)}" style="background:#ff3b5c; color:#fff; font-size:10px; font-weight:bold; padding:1px 6px; border-radius:10px;">${this.getUnreadDM(nick)}</span>` : ''}</span>
                            <div style="display:flex; gap:6px; align-items:center;">
                                ${badges.join('')}
                                <button class="friend-quick-dm" data-nick="${Utils.escapeHtml(nick)}" title="${dmBtnTitle}" style="${dmBtnStyle}">✉️</button>
                                <button class="friend-quick-trade" data-nick="${Utils.escapeHtml(nick)}" title="Предложить обмен" style="background:#28a745; color:#fff; border:none; border-radius:4px; padding:3px 7px; cursor:pointer; font-size:12px; line-height:1; user-select:none;">🤝</button>
                                <button class="friend-quick-del" data-nick="${Utils.escapeHtml(nick)}" title="Удалить из друзей" style="background:#3a2028; color:#ff5a7a; border:1px solid #ff5a7a; border-radius:4px; padding:3px 7px; cursor:pointer; font-size:12px; line-height:1; user-select:none;">✖</button>
                                <span style="color:#caa55c; font-size:14px; margin-left:2px;">›</span>
                            </div>
                        </div>
                    `;
                }).join('');

                container.querySelectorAll('.friend-card-row').forEach(row => {
                    row.addEventListener('click', (e) => {
                        if (e.target.closest('button')) return;
                        const nick = row.getAttribute('data-nick');
                        if (nick) this.openDossier(nick, 'friends');
                    });
                });

                container.querySelectorAll('.friend-quick-dm').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const nick = btn.getAttribute('data-nick');
                        if (nick) this.openWhisperWith(nick);
                    });
                });

                container.querySelectorAll('.friend-quick-trade').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const nick = btn.getAttribute('data-nick');
                        if (nick) this.openTradeWith(nick);
                    });
                });

                container.querySelectorAll('.friend-quick-del').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const nick = btn.getAttribute('data-nick');
                        if (nick && window.confirm(`Удалить игрока ${nick} из друзей?`)) {
                            this.removeFriend(nick);
                            updateFriendsList();
                        }
                    });
                });
                if (prevScroll) {
                    container.scrollTop = prevScroll;
                }
            };

            this._updateFriendsListFn = updateFriendsList;
            updateFriendsList();

            const addInput = document.getElementById('friend-add-input');
            const addBtn = document.getElementById('friend-add-btn');
            const handleAdd = () => {
                const val = (addInput?.value || '').trim();
                if (!val) return;
                if (this.addFriend(val)) {
                    if (addInput) addInput.value = '';
                    updateFriendsList();
                }
            };
            addBtn?.addEventListener('click', handleAdd);
            addInput?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleAdd();
            });

            document.getElementById('friends-search')?.addEventListener('input', updateFriendsList);
            document.getElementById('friends-refresh')?.addEventListener('click', async () => {
                await this.scan();
                updateFriendsList();
            });
        },

        openDossier(nick, backView = null, forceDM = false) {
            const isFriends = backView === 'friends' || (!backView && !!document.getElementById('friends-view-list'));
            const listEl = document.getElementById(isFriends ? 'friends-view-list' : 'players-view-list');
            const dossierEl = document.getElementById(isFriends ? 'friends-view-dossier' : 'players-view-dossier');
            if (!listEl || !dossierEl) return;

            // Открыли диалог — непрочитанные ЛС от этого игрока обнуляем
            if (isFriends) this.clearUnreadDM(nick);

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

            const isFriend = this.isFriend(nick);
            const totalLotsPrice = playerLots.reduce((acc, l) => acc + (+l.p || 0), 0);

            if (isFriends || forceDM) {
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
                            <button id="dossier-friend-del-btn" title="Удалить из друзей" style="padding:4px 8px; background:#3a2028; color:#ff5a7a; border:1px solid #ff5a7a; border-radius:4px; font-weight:bold; cursor:pointer; font-size:11px;">✖</button>
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
                dmInput?.addEventListener('keypress', (e) => {
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

                document.getElementById('dossier-friend-del-btn')?.addEventListener('click', () => {
                    if (window.confirm(`Удалить игрока ${nick} из друзей?`)) {
                        this.removeFriend(nick);
                        this.currentDMPeer = null;
                        dossierEl.style.display = 'none';
                        listEl.style.display = 'flex';
                        if (isFriends) {
                            this.renderFriends();
                        } else {
                            this.render();
                        }
                    }
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
                        <button id="dossier-friend-btn" style="flex:1; padding:8px 4px; background:${isFriend ? '#dc3545' : '#caa55c'}; color:${isFriend ? '#fff' : '#1d1620'}; border:none; border-radius:6px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; font-size:12px;">
                            ${isFriend ? '💔 Удалить из друзей' : '⭐ В друзья'}
                        </button>
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

                const friendBtn = document.getElementById('dossier-friend-btn');
                if (friendBtn) {
                    friendBtn.addEventListener('click', () => {
                        if (this.isFriend(nick)) {
                            this.removeFriend(nick);
                            friendBtn.textContent = '⭐ В друзья';
                            friendBtn.style.background = '#caa55c';
                            friendBtn.style.color = '#1d1620';
                        } else {
                            this.addFriend(nick);
                            friendBtn.textContent = '💔 Удалить из друзей';
                            friendBtn.style.background = '#dc3545';
                            friendBtn.style.color = '#fff';
                        }
                    });
                }
            }

            document.getElementById('dossier-back-btn')?.addEventListener('click', () => {
                this.currentDMPeer = null;
                dossierEl.style.display = 'none';
                listEl.style.display = 'flex';
                if (isFriends) {
                    this.renderFriends();
                } else {
                    this.render();
                }
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

    // ===== src/modules/priest-assistant.js =====
    // ============================================================
    // 4.2. МОДУЛЬ: АССИСТЕНТ ЖРЕЦА (HUD для Похода)
    //
    // Данные боя берём из нативного контекста похода, который перехватывает
    // hooks.js (window.__lgQuestContext):
    //   q.b.st   — состояние боя ('hit' = бой идёт)
    //   q.b.low  — массив [login, name, hp] по раненым участникам
    //   q.b.sk   — умения героя в бою [id, кулдаун, тип] ('heal' = хилка)
    //
    // HUD показывает только отслеживаемых игроков (по умолчанию — друзей из
    // Players) и даёт кнопку быстрого хила. Рендер дешёвый: тяжёлая часть
    // (innerHTML) пересобирается только при изменении данных боя.
    // ============================================================
    const PriestAssistant = {
        hudEl: null,
        watchedNicks: [],          // ники как ввёл пользователь (сравнение — без учёта регистра)
        isVisible: false,          // HUD открывается/закрывается вручную из FAB-меню
        _remindedThisCombat: false,
        _updateInterval: null,
        _menuBtn: null,
        _ownsMenuBtn: false,       // true — кнопку создали сами (фолбэк), её же и удаляем
        _onQuestUpdate: null,
        _dragBound: false,

        STORAGE_KEY: 'LEGION_PRIEST_WATCHED',
        HUD_POS_KEY: 'LEGION_PRIEST_HUD_POS',
        VISIBLE_KEY: 'LEGION_PRIEST_HUD_VISIBLE',

        init() {
            this._loadVisibility();
            this._loadWatched();
            this._bindMenuButton();

            // Игра отдельного события об изменениях боя не даёт, но если оно
            // появится — перерисуем сразу, не ожидая тика поллинга.
            if (!this._onQuestUpdate) {
                this._onQuestUpdate = () => this.renderHud();
                document.addEventListener('lg-quest-update', this._onQuestUpdate);
            }

            // Поллинг: контекст похода обновляет q.b в реальном времени.
            if (this._updateInterval) clearInterval(this._updateInterval);
            this._updateInterval = setInterval(() => this.renderHud(), 1000);

            this.renderHud();
        },

        // Снятие таймеров/слушателей при повторном запуске аддона (single-instance guard).
        destroy() {
            if (this._updateInterval) {
                clearInterval(this._updateInterval);
                this._updateInterval = null;
            }
            if (this._onQuestUpdate) {
                document.removeEventListener('lg-quest-update', this._onQuestUpdate);
                this._onQuestUpdate = null;
            }
            // Кнопку из разметки main.js не трогаем (живёт вместе с FAB),
            // удаляем только аварийно созданный дубль.
            if (this._menuBtn && this._ownsMenuBtn) {
                this._menuBtn.remove();
            }
            this._menuBtn = null;
            this._ownsMenuBtn = false;
            if (this.hudEl) {
                this.hudEl.remove();
                this.hudEl = null;
            }
            this._dragBound = false;
            this._remindedThisCombat = false;
        },

        _loadVisibility() {
            try {
                this.isVisible = localStorage.getItem(this.VISIBLE_KEY) === 'true';
            } catch (e) {
                this.isVisible = false;
            }
        },

        _saveVisibility() {
            try {
                localStorage.setItem(this.VISIBLE_KEY, String(this.isVisible));
            } catch (e) {
                dbg('PriestAssistant: не удалось сохранить видимость HUD', e);
            }
        },

        _setVisible(visible) {
            this.isVisible = !!visible;
            this._saveVisibility();
            this._syncMenuButton();
            this.renderHud(true);
        },

        // Пункт FAB. Штатно кнопка объявлена в main.js (как «Профиль»);
        // динамическое создание — фолбэк, если разметка старая.
        _bindMenuButton() {
            const btn = document.getElementById('btn-priest-panel');
            if (btn) {
                btn.addEventListener('click', () => {
                    const fabMenu = document.getElementById(DOM_IDS.fabMenu);
                    if (fabMenu) fabMenu.classList.remove('open');
                    this._setVisible(!this.isVisible);
                });
                this._menuBtn = btn;
                this._ownsMenuBtn = false;
                this._syncMenuButton();
                return;
            }

            if (this._menuBtn) return;
            const fabMenu = document.getElementById(DOM_IDS.fabMenu);
            if (!fabMenu) return;

            const created = document.createElement('button');
            created.type = 'button';
            created.className = 'fab-menu-item';
            created.textContent = '✨ Панель Жреца';
            created.addEventListener('click', () => {
                fabMenu.classList.remove('open');
                this._setVisible(!this.isVisible);
            });

            // Ставим сразу после «Профиля»: пункт остаётся в группе кнопок и не
            // задевает чекбокс «Отключить перехват чата» и индикатор стелса.
            const profileBtn = document.getElementById(DOM_IDS.btnProfile);
            if (profileBtn) profileBtn.insertAdjacentElement('afterend', created);
            else fabMenu.appendChild(created);

            this._menuBtn = created;
            this._ownsMenuBtn = true;
            this._syncMenuButton();
        },

        // Подсветка активного пункта меню, пока панель открыта.
        _syncMenuButton() {
            if (!this._menuBtn || !this._menuBtn.classList) return;
            this._menuBtn.classList.toggle('active', this.isVisible);
            this._menuBtn.title = this.isVisible ? 'Скрыть панель Жреца' : 'Показать панель Жреца';
        },

        _loadWatched() {
            try {
                const arr = JSON.parse(localStorage.getItem(this.STORAGE_KEY));
                this.watchedNicks = Array.isArray(arr) ? this._normalizeNicks(arr) : [];
            } catch (e) {
                dbg('PriestAssistant: не удалось прочитать список отслеживаемых', e);
                this.watchedNicks = [];
            }
        },

        // Ники храним как ввёл пользователь (чтобы список читался нормально),
        // дубликаты убираем без учёта регистра.
        _normalizeNicks(list) {
            const seen = new Set();
            const out = [];
            (Array.isArray(list) ? list : []).forEach(raw => {
                const nick = String(raw).trim();
                const key = nick.toLowerCase();
                if (!nick || seen.has(key)) return;
                seen.add(key);
                out.push(nick);
            });
            return out;
        },

        // Кого отслеживаем. Пустой список = все друзья (как написано в настройках).
        _getWatchSet() {
            if (this.watchedNicks.length) {
                return new Set(this.watchedNicks.map(n => n.toLowerCase()));
            }
            if (typeof Players !== 'undefined' && typeof Players.getFriendsList === 'function') {
                try {
                    return new Set(Players.getFriendsList().map(n => String(n).toLowerCase()));
                } catch (e) {}
            }
            return new Set();
        },

        _getMyNick() {
            let playerNick = '';
            try {
                if (typeof Players !== 'undefined' && typeof Players.getMyNick === 'function') {
                    playerNick = Players.getMyNick();
                }
            } catch (e) {}

            const candidates = [
                playerNick,
                window.ME?.user?.login,
                window.ME?.user?.name,
                window.ME?.hero?.n,
                window.ME?.hero?.name,
                typeof Chat !== 'undefined' ? Chat.myNick : ''
            ];
            for (const c of candidates) {
                if (c) return String(c).trim().toLowerCase();
            }
            return '';
        },

        // Роль героя. В игре встречаются оба поля: role и class
        // (см. Chat.myRole = hero.class, BuildSim.classNames.priest).
        _getMyRole() {
            const hero = window.ME?.hero || window.ME?.me || window.__lgHero || null;
            const candidates = [
                hero && hero.role,
                hero && hero.class,
                hero && hero.cl,
                hero && hero.sk && hero.sk.c,
                window.ME?.user?.role,
                typeof Chat !== 'undefined' ? Chat.myRole : ''
            ];
            for (const c of candidates) {
                if (c) return String(c).trim().toLowerCase();
            }
            return '';
        },

        // ctx.data() — снимок состояния похода (тот же объект, что игра гоняет
        // в своём рендере). ctx.act() — отправка действия в бой.
        _readQuest() {
            const ctx = window.__lgQuestContext;
            if (!ctx || typeof ctx.data !== 'function') return null;
            try {
                const q = ctx.data();
                return (q && typeof q === 'object') ? q : null;
            } catch (e) {
                dbg('PriestAssistant: не удалось прочитать данные похода', e);
                return null;
            }
        },

        _collectWounded(q) {
            const battle = q && q.b;
            if (!battle || battle.st !== 'hit' || !Array.isArray(battle.low)) return [];

            const myNick = this._getMyNick();
            const watch = this._getWatchSet();
            if (!watch.size) return [];

            const seen = new Set();
            return battle.low
                .filter(row => Array.isArray(row) && row[0] != null)
                .map(row => {
                    const login = String(row[0]).trim();
                    const name = row[1] ? String(row[1]) : login;
                    const rawHp = Number(row[2]);
                    // HP приходит долей (0..1); на всякий случай принимаем и
                    // уже посчитанные проценты.
                    const hp = Number.isFinite(rawHp)
                        ? Math.min(100, Math.max(0, Math.round(rawHp <= 1 ? rawHp * 100 : rawHp)))
                        : 0;
                    return { login, name, hp };
                })
                .filter(w => {
                    const key = w.login.toLowerCase();
                    if (!key || key === myNick || seen.has(key) || !watch.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .sort((a, b) => a.hp - b.hp);
        },

        _findReadyHeal(q) {
            const skills = q && q.b && Array.isArray(q.b.sk) ? q.b.sk : null;
            if (!skills) return null;
            // Формат умения: [id, кулдаун, тип]. Готова та, у которой кулдаун 0.
            return skills.find(sk => Array.isArray(sk) && sk[2] === 'heal' && (sk[1] === 0 || sk[1] === '0')) || null;
        },

        renderHud(force = false) {
            // После destroy() HUD не восстанавливаем.
            if (!this._updateInterval) return;

            const q = this._readQuest();

            // Напоминание жрецу: бой идёт, панель закрыта — один раз за бой.
            if (q && q.b && q.b.st === 'hit' && this._getMyRole() === 'priest') {
                if (!this.isVisible && !this._remindedThisCombat) {
                    UI.showToast('✨ Вы Жрец! Откройте Панель Жреца в меню для быстрого хила.', false);
                    this._remindedThisCombat = true;
                }
            } else if (!q || !q.b || q.b.st !== 'hit') {
                // Бой закончился (или мы не в походе) — напоминание снова разрешено.
                this._remindedThisCombat = false;
            }

            // Панель закрыта пользователем — не создаём и не показываем HUD.
            if (!this.isVisible) {
                if (this.hudEl) this.hudEl.style.display = 'none';
                return;
            }

            this._ensureHud();

            // Состояние 1: контекста похода нет — статус и список наблюдения.
            if (!q) {
                this._showHud(this._outsideQuestHtml(), force);
                return;
            }

            // Состояние 2: в походе, но бой ещё не идёт (или уже закончился).
            if (!q.b || q.b.st !== 'hit') {
                this._showHud(this._hudHeader('✨ Жрец: Ожидание боя'), force);
                return;
            }

            const wounded = this._collectWounded(q);

            // Состояние 3: бой идёт, но из отслеживаемых никто не ранен.
            if (!wounded.length) {
                this._showHud(this._hudHeader('✨ Жрец: Все целы', '#4cc95a'), force);
                return;
            }

            // Состояние 4: бой, есть раненые — строки с кнопками хила.
            const readyHeal = this._findReadyHeal(q);
            const rows = wounded.map(w => {
                const hpColor = w.hp < 40 ? '#ff5a7a' : '#fff';
                const safeLogin = Utils.escapeHtml(w.login);
                const safeName = Utils.escapeHtml(w.name);
                const btnTitle = readyHeal ? `Хил на ${safeName}` : 'Хилка ещё не готова';
                return `
                    <div class="priest-hud-row">
                        <span class="priest-hud-nick" style="color:${hpColor};">${safeName} (${w.hp}%)</span>
                        <button type="button" class="priest-heal-btn" data-nick="${safeLogin}" title="${btnTitle}"${readyHeal ? '' : ' disabled'}>Хил</button>
                    </div>
                `;
            }).join('');

            this._showHud(this._hudHeader('✨ Панель Жреца') + rows, force);
        },

        _ensureHud() {
            if (this.hudEl) return;
            this.hudEl = document.createElement('div');
            this.hudEl.className = 'priest-hud';
            // Клики обрабатываем делегированием: innerHTML меняется, а слушатель один.
            this.hudEl.addEventListener('click', (e) => this._onHudClick(e));
            document.body.appendChild(this.hudEl);
        },

        // Пишем innerHTML только при реальном изменении — кнопки не «мигают».
        _showHud(html, force) {
            if (!this.hudEl) return;
            this.hudEl.style.display = 'flex';
            if (!force && this.hudEl.innerHTML === html) return;
            this.hudEl.innerHTML = html;
            this._bindDragOnce();
        },

        // Шапка HUD: статус слева, настройки и закрытие справа.
        _hudHeader(text, color) {
            const colorStyle = color ? ` style="color:${color};"` : '';
            return `
                <div class="priest-hud-header">
                    <span${colorStyle}>${text}</span>
                    <div class="priest-hud-actions">
                        <span class="priest-hud-settings" id="priest-settings-icon" title="Настройки">⚙️</span>
                        <span class="priest-hud-close" id="priest-close-icon" title="Закрыть">✖</span>
                    </div>
                </div>
            `;
        },

        _outsideQuestHtml() {
            const listHtml = this.watchedNicks.length
                ? this.watchedNicks.map(n => `<div class="priest-hud-watch-item">• ${Utils.escapeHtml(n)}</div>`).join('')
                : '<div class="priest-hud-watch-item">• (Все друзья)</div>';

            return this._hudHeader('✨ Жрец: Ожидание похода') +
                `<div class="priest-hud-watchlist">${listHtml}</div>`;
        },

        // Перетаскивание вешаем один раз — когда в HUD уже есть .priest-hud-header.
        _bindDragOnce() {
            if (this._dragBound || !this.hudEl) return;
            this._dragBound = true;
            UI.makeDraggable(this.hudEl, '.priest-hud-header', this.HUD_POS_KEY);
            // makeDraggable() только сохраняет позицию — восстанавливаем её сами.
            try {
                const pos = JSON.parse(localStorage.getItem(this.HUD_POS_KEY) || 'null');
                if (pos && pos.left && pos.top) {
                    this.hudEl.style.left = pos.left;
                    this.hudEl.style.top = pos.top;
                    this.hudEl.style.right = 'auto';
                }
            } catch (e) {}
        },

        _onHudClick(e) {
            const target = e.target;
            if (!target || !target.closest) return;

            if (target.closest('.priest-hud-close')) {
                this._setVisible(false);
                return;
            }
            if (target.closest('.priest-hud-settings')) {
                this.openSettings();
                return;
            }
            const btn = target.closest('.priest-heal-btn');
            if (btn && !btn.disabled) this.heal(btn.dataset.nick, btn);
        },

        heal(login, btn) {
            if (!login) return;

            const ctx = window.__lgQuestContext;
            if (!ctx || typeof ctx.act !== 'function') {
                UI.showToast('Поход: нет доступа к контексту боя', true);
                return;
            }

            // Данные читаем в момент клика: между тиками кулдаун мог измениться.
            const healSk = this._findReadyHeal(this._readQuest());
            if (!healSk) {
                UI.showToast('Хилка ещё не готова', true);
                this.renderHud(true);
                return;
            }

            try {
                ctx.act({ k: 'b', a: 'sk', w: healSk[0], t: login });
            } catch (e) {
                dbg('PriestAssistant: ошибка отправки хила', e);
                UI.showToast('Хил: сбой отправки', true);
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.textContent = '...';
            }
            UI.showToast(`✨ Хил на ${login}`);
        },

        openSettings() {
            const current = this.watchedNicks.join(', ');

            const modal = UI.showModal(`
                <h2>✨ Настройки Жреца <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="padding: 10px;">
                    <div style="font-size: 13px; color: #aaa; margin-bottom: 15px;">
                        Введите ники через запятую или пробел. Если поле пустое, панель будет отслеживать всех ваших друзей.
                    </div>
                    <textarea id="priest-nicks-input" maxlength="500" style="width: 100%; height: 100px; background: #111; border: 1px solid #444; color: #fff; padding: 10px; border-radius: 6px; box-sizing: border-box; font-family: monospace; resize: vertical;" placeholder="ник1, ник2, ник3">${Utils.escapeHtml(current)}</textarea>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button id="priest-save-btn" style="flex: 1; padding: 10px; background: #caa55c; color: #1d1620; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">Сохранить</button>
                    </div>
                </div>
            `, { compact: true });

            const input = modal?.querySelector('#priest-nicks-input');
            const saveBtn = modal?.querySelector('#priest-save-btn');
            if (!input || !saveBtn) return;

            saveBtn.addEventListener('click', () => {
                // Разделители: запятая, пробел, перенос строки (и их сочетания).
                this.watchedNicks = this._normalizeNicks(String(input.value || '').split(/[\s,]+/));

                try {
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.watchedNicks));
                } catch (e) {
                    dbg('PriestAssistant: не удалось сохранить список', e);
                }

                UI.showToast('Список отслеживаемых обновлен');
                UI.closeModals();
                this.renderHud(true); // Принудительный перерендер
            });
        }
    };

    // ===== src/modules/miner.js (исключён из этой сборки, используется заглушка) =====
    const Miner = {
        abortController: null,
        init() {
            document.getElementById(DOM_IDS.btnAutoMine)?.remove();
        },
        stopMining() {}
    };

    // ===== src/modules/chat.js =====
    // ============================================================
    // 7. МОДУЛЬ: ЧАТ
    // ============================================================
    // ============================================================
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

    const Chat = {
        widget: null,
        badge: null,
        unreadCount: 0,
        historyLoaded: false,
        disabled: localStorage.getItem('LEGION_CHAT_DISABLED') === 'true',
        _popoutWin: null,
        _origWidgetStyles: null,
        // Куда вернуть виджет после закрытия PiP: родной парент, сосед и исходные классы.
        _origWidgetParent: null,
        _origWidgetNextSibling: null,
        _origWidgetClasses: null,
        _origWidgetHadOpen: false,
        isOpen() {
            return !!(this._popoutWin || (this.widget && this.widget.classList.contains('open')));
        },
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
        setDisabled(val) {
            this.disabled = !!val;
            try {
                localStorage.setItem('LEGION_CHAT_DISABLED', String(this.disabled));
            } catch (e) {}
            if (this.disabled) {
                this.stopBackgroundLiveListener();
                if (this.isOpen()) {
                    this.close();
                }
                UI.showToast('🚫 Перехват чата отключен');
            } else {
                UI.showToast('💬 Перехват чата включен');
                this.startBackgroundLiveListener();
            }
        },
        STORAGE_KEY: 'LEGION_CHAT_HISTORY',
        activeMainTab: 'city',
        activeSubTab: 'general',
        dmTarget: null, // Ник собеседника, с которым сейчас открыт диалог во вкладке ЛС
        get activeTab() {
            if (this.activeMainTab === 'mine' || this.activeMainTab === 'dm') return this.activeMainTab;
            return this.activeSubTab;
        },
        set activeTab(val) {
            if (val === 'mine' || val === 'dm') {
                this.activeMainTab = val;
            } else {
                this.activeMainTab = 'city';
                this.activeSubTab = val;
            }
        },
        messages: [], // Массив всех сообщений
        myNick: window.LG_CH?.name || 'eciell',
        myRole: 'legionary',
        currentMineId: 'home',
        cooldownUntil: 0,
        // Статусы из /api/city/enter
        muted: false,
        mod: null,
        ign: new Set(),
        _toastTimer: null,
        _liveES: null,
        _livePollTimer: null,
        _liveRunning: false,
        _liveConnecting: false,
        _livePollDelay: 2500,

        getMineId() {
            return this.currentMineId 
                || (location.search.match(/[?&]c=([^&]+)/)?.[1]) 
                || 'home';
        },

        async syncMe() {
            try {
                const res = await Utils.fetchApi('/api/me');
                const me = res?.hero || res?.body?.hero;
                if (me) {
                    this.myNick = me.name || window.LG_CH?.name || 'eciell';
                    this.myRole = me.class || me.sk?.c || 'legionary';
                }
            } catch (e) {}
        },

        showError(msg) {
            let toast = document.getElementById('chat-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'chat-toast';
                toast.style.cssText = 'position:absolute;top:45px;left:10px;right:10px;background:#ff5a7a;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;text-align:center;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,0.5);transition:opacity 0.3s;';
                this.widget.appendChild(toast);
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

        isInMine() {
            return !!document.querySelector('.mn-world') ||
                   !!document.querySelector('.mn-screen') ||
                   !!document.querySelector('.mn-heroes') ||
                   (location.pathname.includes('/mine') && location.search.includes('sid='));
        },

        updateInputState() {
            const inp = this.widget?.querySelector('#chat-input') || document.getElementById('chat-input');
            const sendBtn = this.widget?.querySelector('#chat-send') || document.getElementById('chat-send');

            // Если открыт PiP, принудительно разрешаем ввод
            if (this._popoutWin) {
                if (inp) { inp.disabled = false; inp.placeholder = 'Написать сообщение...'; }
                if (sendBtn) sendBtn.disabled = false;
                return;
            }

            const inMine = this.isInMine();

            if (this.activeMainTab === 'mine' && !inMine) {
                if (inp) {
                    inp.disabled = true;
                    inp.placeholder = 'Доступно только в шахте';
                    inp.value = '';
                }
                if (sendBtn) sendBtn.disabled = true;
            } else if (this.activeMainTab === 'dm') {
                if (this.dmTarget) {
                    if (inp) {
                        inp.disabled = false;
                        inp.placeholder = `Написать ${this.dmTarget}...`;
                    }
                    if (sendBtn) sendBtn.disabled = false;
                } else {
                    if (inp) {
                        inp.disabled = true;
                        inp.placeholder = 'Выберите диалог в списке «✉️ ЛС»';
                        inp.value = '';
                    }
                    if (sendBtn) sendBtn.disabled = true;
                }
            } else if (this.activeMainTab === 'city' && this.activeSubTab === 'ach') {
                if (inp) {
                    inp.disabled = true;
                    inp.placeholder = 'Чат достижений (только чтение)';
                    inp.value = '';
                }
                if (sendBtn) sendBtn.disabled = true;
            } else {
                if (inp) {
                    inp.disabled = false;
                    const phMap = {
                        general: 'Написать в чат города...',
                        trade: 'Написать в торговлю...',
                        mine: 'Написать в чат шахты...'
                    };
                    inp.placeholder = phMap[this.activeTab] || 'Написать сообщение...';
                }
                if (sendBtn) sendBtn.disabled = false;
            }
        },

        init() {
            if (this.widget) return;
            this.widget = document.createElement('div');
            this.widget.className = `${DOM_IDS.chatWidget} chat-widget`;
            this.widget.id = DOM_IDS.chatWidget;
            this.widget.innerHTML = `
                <div class="chat-top-bar" id="chat-drag-handle">
                    <div class="chat-main-tabs">
                        <button class="chat-main-tab active" data-main-tab="city" type="button">🏙️ Город</button>
                        <button class="chat-main-tab" data-main-tab="mine" type="button">⛏️ Шахта</button>
                        <button class="chat-main-tab" data-main-tab="dm" type="button">✉️ ЛС</button>
                    </div>
                    <span class="chat-close" id="chat-close-btn" title="Закрыть">✖</span>
                </div>
                <div class="chat-sub-tabs" id="chat-sub-tabs">
                    <button class="chat-sub-tab active" data-sub-tab="general" type="button">Общий</button>
                    <button class="chat-sub-tab" data-sub-tab="trade" type="button">Торговля</button>
                    <button class="chat-sub-tab" data-sub-tab="ach" type="button">Достижения</button>
                </div>
                <div class="chat-messages" id="chat-messages"></div>
                <div class="chat-input-area">
                    <input type="text" class="chat-input" id="chat-input" placeholder="Написать в чат города..." maxlength="200">
                    <button class="chat-send" id="chat-send" type="button">➤</button>
                </div>`;
            document.body.appendChild(this.widget);
            this.badge = document.getElementById(DOM_IDS.chatBadge) || document.getElementById('chat-badge');

            (document.getElementById(DOM_IDS.btnChatToggle) || document.getElementById('btn-chat-toggle'))?.addEventListener('click', () => this.toggle());
            (document.getElementById(DOM_IDS.btnPopout) || document.getElementById('btn-popout'))?.addEventListener('click', () => this.popoutChat());

            // Делегирование событий на самом виджете: гарантирует работу и в основном окне, и в PiP окне
            this.widget.addEventListener('click', (e) => {
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
                    this.widget.querySelectorAll('.chat-main-tab').forEach(t => t.classList.remove('active'));
                    mainTab.classList.add('active');
                    this.activeMainTab = mainTab.getAttribute('data-main-tab') || 'city';
                    const subTabsRow = this.widget.querySelector('#chat-sub-tabs');
                    if (subTabsRow) {
                        subTabsRow.style.display = this.activeMainTab === 'city' ? 'flex' : 'none';
                    }
                    this.updateInputState();
                    this.renderMessages();
                    return;
                }

                const subTab = target.closest('.chat-sub-tab');
                if (subTab) {
                    e.preventDefault();
                    this.widget.querySelectorAll('.chat-sub-tab').forEach(t => t.classList.remove('active'));
                    subTab.classList.add('active');
                    this.activeSubTab = subTab.getAttribute('data-sub-tab') || 'general';
                    this.updateInputState();
                    this.renderMessages();
                    return;
                }
            });

            const inp = this.widget.querySelector('#chat-input');
            if (inp) {
                inp.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.send();
                    }
                });
            }

            this.setupDrag();
            this.syncMe();
        },

        setupDrag() {
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

            // 7TV: размер смайлов + глобальные/канальные эмоуты.
            SevenTV.loadSize();
            SevenTV.load();

            // Настройка Twitch-канала для эмоутов 7TV.
            const btn7tv = document.getElementById('btn-7tv-settings');
            if (btn7tv) {
                btn7tv.addEventListener('click', () => this.open7tvSettings());
            }
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

        toggle() {
            if (this.disabled) {
                UI.showToast('🚫 Перехват чата отключен в меню 🐱', true);
                return;
            }
            const open = this.widget.classList.toggle('open');
            if (open) {
                this.unreadCount = 0;
                this.updateBadge();
                this.updateInputState();
                this.startBackgroundLiveListener();
                const inp = this.widget?.querySelector('#chat-input') || document.getElementById('chat-input');
                if (inp && !inp.disabled) inp.focus();
                if (this.activeTab === 'mine') {
                    const box = this.widget?.querySelector('#chat-messages') || document.getElementById('chat-messages');
                    if (box) box.scrollTop = box.scrollHeight;
                } else {
                    if (!this.historyLoaded) this.loadHistory();
                    else {
                        const box = this.widget?.querySelector('#chat-messages') || document.getElementById('chat-messages');
                        if (box) box.scrollTop = box.scrollHeight;
                    }
                }
            } else {
                this.stopBackgroundLiveListener();
            }
        },

        // Открыть диалог с игроком прямо в виджете (используется кликабельными тостами ЛС)
        openDM(nick) {
            if (!nick) return;
            if (!this.widget) this.init();

            this.dmTarget = nick;

            // Открываем виджет, если он свернут (в PiP-окне класс .open уже стоит)
            if (!this.widget.classList.contains('open')) {
                this.toggle(); // toggle сам выставит .open и сфокусирует инпут
            }

            // Переключаем главную вкладку на ЛС
            this.activeMainTab = 'dm';

            // Синхронизируем UI (подсветка вкладок, поле ввода)
            const mainTabs = this.widget.querySelectorAll('.chat-main-tab');
            mainTabs.forEach(t => {
                t.classList.toggle('active', t.getAttribute('data-main-tab') === 'dm');
            });
            const subTabsRow = this.widget.querySelector('#chat-sub-tabs');
            if (subTabsRow) subTabsRow.style.display = 'none';

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
                this._popoutWin = null;
                this.widget.classList.remove('open');
                this.stopBackgroundLiveListener();
                return;
            }
            this.widget.classList.remove('open'); 
            this.stopBackgroundLiveListener();
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
                // Окно закрылось без pagehide (kill процесса) — сбрасываем ссылку
                this._popoutWin = null;
            }

            try {
                let win = null;

                // 1. Проверяем API documentPictureInPicture
                if (window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function') {
                    // Не открывать второй PiP, если первый уже висит
                    if (window.documentPictureInPicture.window) {
                        try { window.documentPictureInPicture.window.focus(); } catch (e) {}
                        this._popoutWin = window.documentPictureInPicture.window;
                        SevenTV.applySize();
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

                // 3. Копируем все CSS стили в новое окно
                try {
                    [...document.styleSheets].forEach(sheet => {
                        try {
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
                        .chat-widget {
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

                // Размер смайлов 7TV задаётся CSS-переменной — переносим её в PiP.
                SevenTV.applySize();

                // 4. Запоминаем родной парент и позицию — вернуть нужно туда, а не в body.
                this._origWidgetParent = this.widget.parentNode;
                this._origWidgetNextSibling = this.widget.nextSibling;
                this._origWidgetClasses = this.widget.className;
                this._origWidgetHadOpen = this.widget.classList.contains('open');

                // Сохраняем исходные стили виджета (все свойства, которые меняем в PiP-режиме)
                this._origWidgetStyles = {
                    position: this.widget.style.position || '',
                    top: this.widget.style.top || '',
                    left: this.widget.style.left || '',
                    bottom: this.widget.style.bottom || '',
                    right: this.widget.style.right || '',
                    width: this.widget.style.width || '',
                    height: this.widget.style.height || '',
                    maxWidth: this.widget.style.maxWidth || '',
                    maxHeight: this.widget.style.maxHeight || '',
                    minWidth: this.widget.style.minWidth || '',
                    minHeight: this.widget.style.minHeight || '',
                    borderRadius: this.widget.style.borderRadius || '',
                    border: this.widget.style.border || '',
                    boxShadow: this.widget.style.boxShadow || '',
                    display: this.widget.style.display || '',
                    flexDirection: this.widget.style.flexDirection || '',
                    overflow: this.widget.style.overflow || ''
                };

                // 5. Переносим виджет в body нового окна (растягиваем на всё окно PiP)
                this.widget.style.position = 'relative';
                this.widget.style.top = '0';
                this.widget.style.left = '0';
                this.widget.style.bottom = 'auto';
                this.widget.style.right = 'auto';
                this.widget.style.width = '100%';
                this.widget.style.height = '100%'; // Важно
                this.widget.style.maxWidth = '100%';
                this.widget.style.maxHeight = '100%'; // Важно
                this.widget.style.minWidth = '0'; // Важно
                this.widget.style.minHeight = '0'; // Важно
                this.widget.style.borderRadius = '0';
                this.widget.style.border = 'none';
                this.widget.style.boxShadow = 'none';
                this.widget.style.display = 'flex';
                this.widget.style.flexDirection = 'column';
                this.widget.style.overflow = 'hidden';
                this.widget.classList.add('open');

                win.document.body.appendChild(this.widget);

                // 6. Обработчик возврата виджета при закрытии окна
                const returnWidget = () => {
                    if (!this._popoutWin) return;
                    this._popoutWin = null;
                    const orig = this._origWidgetStyles || {};
                    const parent = this._origWidgetParent;
                    const nextSibling = this._origWidgetNextSibling;
                    if (this.widget) {
                        // Возврат строго в родной парент (не в body). Иначе виджет теряет
                        // контекст позиционирования и растягивает страницу.
                        if (parent && parent.isConnected) {
                            if (nextSibling && nextSibling.parentNode === parent) {
                                parent.insertBefore(this.widget, nextSibling);
                            } else {
                                parent.appendChild(this.widget);
                            }
                        } else if (document.body) {
                            document.body.appendChild(this.widget);
                        }
                        // Снимаем все inline-стили, затем накатываем сохранённые
                        this.widget.removeAttribute('style');
                        Object.assign(this.widget.style, orig);
                        // Восстанавливаем классы: убираем .open, если его не было
                        if (!this._origWidgetHadOpen) this.widget.classList.remove('open');
                        // Если он был .open — оставляем; иначе класс .open не должен появиться
                    }
                    this._origWidgetStyles = null;
                    this._origWidgetParent = null;
                    this._origWidgetNextSibling = null;
                    this._origWidgetClasses = null;
                    this.renderMessages();
                    this.updateInputState();
                };

                win.addEventListener('pagehide', returnWidget);
                win.addEventListener('unload', returnWidget);

                this.startBackgroundLiveListener();
                this.renderMessages();
                this.updateInputState();
                UI.showToast('📺 Чат вынесен в отдельное окно');
            } catch (err) {
                dbg('Popout chat failed:', err);
                UI.showToast('Ошибка при открытии окна чата', true);
            }
        },

        updateBadge() {
            const badges = document.querySelectorAll('#' + DOM_IDS.chatBadge + ', #' + DOM_IDS.fabChatBadge + ', #chat-badge, #fab-chat-badge');
            badges.forEach(b => {
                if (this.unreadCount > 0) {
                    b.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
                    b.style.display = 'block';
                } else {
                    b.style.display = 'none';
                }
            });
        },

        saveToStorage(author, text, role, isSystem, channel = null, k = null, aw = null) {
            try {
                const history = this.loadFromStorage();
                history.push({ author, text, role, isSystem, channel, k, aw, ts: Date.now() });
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
        handleIncoming(author, text, isMine = false, isHistory = false, id = null, seq = null, role = null, isSystem = false, aw = null, channel = null, k = null, to = null) {
            if (!text) return;

            // Перехват и фильтрация ЛС (не добавлять в общий чат)
            if (channel === 'dm' || k === 'dm') {
                if (typeof Players !== 'undefined' && Players.handleIncomingDM) {
                    Players.handleIncomingDM(author, text, to);
                }
                // Если этот диалог сейчас открыт во вкладке «✉️ ЛС» — считаем прочитанным.
                // Перерисовку выполняет Players.refreshUnreadDMViews() -> Chat.renderMessages().
                if (typeof Players !== 'undefined' && this.activeMainTab === 'dm' && this.dmTarget) {
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
                    const channelMatch = !channel || !m.channel || m.channel === channel;
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
                    if (aw && !pendingMsg.aw) pendingMsg.aw = aw;
                    if (channel && !pendingMsg.channel) pendingMsg.channel = channel;
                    this.renderMessages();
                    return;
                }
            }

            // 3. Дедупликация сообщений без ID (по автору и тексту за последние 8 секунд)
            if (!isHistory && !isMine && !id) {
                if (this.messages.slice(-25).some(m => m.author === author && m.text === text && (m.channel === channel || !m.channel || !channel) && Date.now() - m.ts < 8000)) return;
            }

            const msgObj = { author, text, role, isSystem, id, seq, aw, channel, k, to, ts: Date.now() };
            this.messages.push(msgObj);

            // Сохраняем в кэш только живые сообщения
            if (!isHistory) this.saveToStorage(author, text, role, isSystem, channel, k, aw);

            // Обновляем UI
            if (!isHistory) {
                this.renderMessages();
                // Скролл вниз выполняет renderMessages() и только если пользователь
                // уже был внизу — иначе чтение истории не прерывается.
                if (!this.isOpen() && !isMine && !isSelf) {
                    this.unreadCount++;
                    this.updateBadge();
                }
            }
        },

        // Клик по нику автора: вставляем «@Ник » в поле ввода
        insertMention(nick) {
            if (!nick) return;
            const inp = this.widget?.querySelector('#chat-input') || document.getElementById('chat-input');
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
            const box = this.widget?.querySelector('#chat-messages') || document.getElementById('chat-messages');
            if (!box) return;

            // Запоминаем позицию ДО очистки: если пользователь читает историю,
            // новый рендер не должен утаскивать его вниз.
            const wasAtBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 50;
            const prevScrollTop = box.scrollTop;
            const prevDmBox = box.querySelector('.chat-dm-messages');
            const dmWasAtBottom = prevDmBox ? (prevDmBox.scrollHeight - prevDmBox.scrollTop - prevDmBox.clientHeight) < 50 : true;
            const dmPrevScrollTop = prevDmBox ? prevDmBox.scrollTop : 0;

            box.innerHTML = '';

            // Вкладка «✉️ ЛС»: либо открытый диалог, либо список всех диалогов
            if (this.activeMainTab === 'dm') {
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
            if (this.activeMainTab === 'mine' && !this.isInMine()) {
                box.innerHTML = `
                    <div style="color:#aaa; text-align:center; padding:35px 15px; font-style:italic; line-height:1.6;">
                        <span style="font-size:32px; display:block; margin-bottom:8px;">⛏️</span>
                        <b style="color:#ffcf6a; font-size:14px;">Вы находитесь в городе.</b><br>
                        Чат шахты доступен только во время нахождения в шахте.
                    </div>`;
                return;
            }

            const filtered = this.messages.filter(m => {
                // ЛС отображаются отдельно — во вкладке «✉️ ЛС»
                if (m.k === 'dm') return false;

                const isMineMsg = m.channel === 'mine' || m.room === 'mine' || m.ch === 'mine';

                // Вкладка «Шахта»
                if (this.activeMainTab === 'mine') {
                    return !m.isSystem && isMineMsg;
                }

                // Вкладки города (Общий / Торговля / Достижения)
                if (isMineMsg) return false; // в городе сообщения шахты не показываем

                if (this.activeSubTab === 'general') {
                    // Общий: всё, что не торговля и не система
                    return !m.isSystem && m.k !== 'tr';
                }
                if (this.activeSubTab === 'trade') {
                    // Торговля: СТРОГО только серверный/локальный флаг 'tr'
                    return !m.isSystem && m.k === 'tr';
                }
                if (this.activeSubTab === 'ach') {
                    return m.isSystem;
                }
                return true;
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

                const authorNick = m.author || '';

                // Бейдж титула (aw) перед ником автора
                let awardBadge = '';
                const aw = m.aw;
                if (Array.isArray(aw) && aw.length > 0 && aw[0] && typeof aw[0] === 'object') {
                    const award = aw[0];
                    awardBadge = `<span class="chat-award-badge" title="${Utils.escapeHtml(award.d || '')}" style="display:inline-block; background:rgba(202,165,92,0.15); border:1px solid #caa55c; color:#ffcf6a; font-size:10px; font-weight:bold; padding:1px 6px; border-radius:10px; margin-right:6px; vertical-align:middle;">${Utils.escapeHtml(award.i || '')} ${Utils.escapeHtml(award.n || '')}</span>`;
                }

                const authorHtml = `<span class="chat-author nick-clickable" data-nick="${Utils.escapeHtml(authorNick)}" title="Кликните, чтобы упомянуть" style="color: ${meta.color || '#ffcf6a'} !important; cursor: pointer;">${Utils.escapeHtml(authorNick)}</span>`;

                if (m.k === 'dm') {
                    div.innerHTML = `
                        <span style="background:#007bff; color:#fff; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:4px; margin-right:4px;">✉️ ЛС для ${Utils.escapeHtml(m.to || '')}</span>
                        ${awardBadge}${authorHtml}
                        <span class="chat-text" style="color: #6edff6 !important;">${formattedText}</span>
                    `;
                } else if (m.isSystem) {
                    div.innerHTML = `
                        <span class="chat-role-icon">${meta.icon}</span>
                        <span class="chat-author" style="color: ${meta.color || '#ffcf6a'} !important;">${Utils.escapeHtml(m.author)}</span>
                        <span class="chat-text" style="color: #aaa !important; font-style: italic;">${formattedText}</span>
                    `;
                } else {
                    div.innerHTML = `
                        ${streamerBadge}${mentionBadge}${awardBadge}<span class="chat-role-icon">${meta.icon}</span>
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

            // Автоскролл только когда пользователь уже был внизу; иначе
            // возвращаем прежнюю позицию, чтобы не мешать чтению истории.
            if (wasAtBottom) box.scrollTop = box.scrollHeight;
            else box.scrollTop = prevScrollTop;
        },

        async send() {
            const input = this.widget?.querySelector('#chat-input') || document.getElementById('chat-input');
            if (!input) return;
            const rawText = input.value.trim();
            if (!rawText) return;

            // Открыт диалог во вкладке «✉️ ЛС» — отправляем ЛС прямо из виджета
            if (this.activeMainTab === 'dm' && this.dmTarget) {
                if (typeof Players === 'undefined' || typeof Players.sendDM !== 'function') {
                    this.showError('Отправка ЛС недоступна');
                    return;
                }
                input.value = '';
                const ok = await Players.sendDM(this.dmTarget, rawText);
                if (ok) {
                    this.renderMessages(); // Перерисовываем историю с новым сообщением
                } else {
                    input.value = rawText; // Возвращаем текст, если ошибка
                }
                return; // Выходим, чтобы не отправлять в общий чат
            }

            if (this.activeTab === 'ach') {
                this.showError('Вкладка достижений только для чтения');
                return;
            }
            if (this.activeMainTab === 'dm') {
                this.showError('Выберите диалог в списке «✉️ ЛС»');
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
            } else if (this.activeMainTab === 'mine') {
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
                k: dmMatch ? 'dm' : (!isMine && this.activeSubTab === 'trade' ? 'tr' : undefined),
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

            try {
                let res;
                let data = null;
                let nativeOk = null;
                let lastError = null;
                if (dmMatch) {
                    const payload = { text: cleanText, to: toUser, k: 'dm' }; // k: 'dm' обязателен!

                    // 1. Пытаемся использовать нативный контекст города (как в прошлой версии)
                    const nativeCtx = window.__lgCityContext || window.LGCity;
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
                    if (!data) {
                        res = await fetch('/api/city/say', {
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
                } else if (isMine) {
                    // Чат шахты — только c=, без apiPath / location.origin / credentials / cache
                    res = await fetch(`/api/mine/chat/say?c=${encodeURIComponent(mineId)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: rawText })
                    });
                } else if (this.activeSubTab === 'trade') {
                    // Торговля
                    res = await fetch('/api/city/say', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: rawText, k: 'tr' })
                    });
                } else {
                    // Общий чат
                    res = await fetch('/api/city/say', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: rawText })
                    });
                }

                if (!data) {
                    data = await res.json().catch(() => null);
                }

                const httpOk = nativeOk !== null ? nativeOk : !!(res && res.ok);
                if (!httpOk || (data && data.ok === false)) {
                    // откат
                    this.messages = this.messages.filter(m => m !== local);
                    input.value = rawText;
                    this.renderMessages();
                    const errMsg = (data && (data.error || data.err)) || lastError || (res ? `HTTP ${res.status}` : 'Ошибка сети');
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
                    if (msg.n || msg.l) {
                        this.myNick = msg.n || msg.l;
                        local.author = this.myNick;
                    }
                    if (Array.isArray(data.m) && data.m.length > 0) {
                        this.processMineMessages(data.m);
                    }
                }
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

        async loadHistory() {
            if (this.historyLoaded) return;
            this.historyLoaded = true;

            const cached = this.loadFromStorage();
            if (cached.length > 0) {
                cached.forEach(m => {
                    if (!this.messages.some(cur => (cur.id && cur.id === m.id) || (cur.author === m.author && cur.text === m.text && cur.channel === m.channel))) {
                        this.messages.push({ author: m.author, text: m.text, role: m.role, isSystem: m.isSystem, channel: m.channel, k: m.k, aw: m.aw, ts: m.ts });
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
                            // Кэш мог быть сохранён без титула — дополняем его из истории сервера
                            if (parsed.aw && !existing.aw) existing.aw = parsed.aw;
                            return;
                        }
                        this.handleIncoming(parsed.author, parsed.text, false, true, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to);
                    });
                }
            } catch (e) {
                dbg('Не удалось стянуть историю города', e);
            }

            this.renderMessages();
        },

        processMineMessages(list) {
            if (!list) return;
            const chats = Utils.extractChatDeep(list);
            let added = false;
            chats.forEach(m => {
                const parsed = Utils.extractChatFields(m);
                if (parsed.text) {
                    this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, 'mine');
                    added = true;
                }
            });
            if (added) this.renderMessages();
        },

        processRawMessages(msgs) {
            if (!msgs || !Array.isArray(msgs)) return;
            msgs.forEach(m => {
                const { author, text, id, seq, role, isSystem, aw, channel } = Utils.extractChatFields(m);
                if (!text) return;
                this.handleIncoming(author || 'Игрок', text, false, false, id, seq, role, isSystem, aw, channel);
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

        async startBackgroundLiveListener() {
            if (this.disabled || this._liveConnecting) return;

            // Защита от дублирования: живой поток уже открыт или подключается.
            if (this._liveES && (this._liveES.readyState === 0 || this._liveES.readyState === 1)) return;
            // Уже идёт fetch-поллинг — второй цикл не запускаем.
            if (this._liveRunning && !this._liveES && this._livePollTimer) return;

            // Старое закрытое соединение закрываем перед созданием нового.
            if (this._liveES) {
                try { this._liveES.close(); } catch (e) {}
                this._liveES = null;
            }
            this._liveRunning = true;
            this._liveConnecting = true;

            const sid = new URL(location.href).searchParams.get('sid');
            const livePath = '/api/live' + (sid ? `?sid=${encodeURIComponent(sid)}` : '');
            // EventSource должен подключаться к /api/live без префикса канала:
            // Utils.apiPath() добавляет /c/<канал>/ и ломает поток.
            const url = livePath;

            const startPollingFallback = () => {
                if (!this._liveRunning || this._livePollTimer) return;
                this._liveConnecting = false; // EventSource не создаётся — уходим в поллинг
                dbg('Starting live fetch polling fallback...');
                const poll = async () => {
                    if (!this._liveRunning) return;
                    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                    const timeoutId = controller ? setTimeout(() => controller.abort(), 3000) : null;
                    let hasPayload = false;
                    try {
                        const curSid = new URL(location.href).searchParams.get('sid');
                        // Поллинг идёт на тот же чистый /api/live, что и EventSource (без /c/<канал>/)
                        const pollUrl = '/api/live' + (curSid ? `?sid=${encodeURIComponent(curSid)}` : '');
                        const res = await fetch(pollUrl, {
                            signal: controller ? controller.signal : undefined,
                            credentials: 'same-origin',
                            cache: 'no-store'
                        });
                        const text = await res.text();
                        let data = null;
                        try { data = JSON.parse(text); } catch (e) {}

                        // Если пришел поток SSE строками "data: {...}"
                        if (!data && text && text.includes('data:')) {
                            hasPayload = true;
                            const lines = text.split('\n');
                            for (const line of lines) {
                                if (line.startsWith('data:')) {
                                    try {
                                        const lineData = JSON.parse(line.slice(5).trim());
                                        const lineLoc = this.resolveLiveChannel(lineData);
                                        Utils.updateOnlinePlayers(lineData, lineLoc);
                                        Utils.processIncomingDMs(lineData);
                                        const chats = Utils.extractChatDeep(lineData);
                                        chats.forEach(m => {
                                            const parsed = Utils.extractChatFields(m);
                                            if (parsed.text) {
                                                this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, lineLoc, parsed.k, parsed.to);
                                            }
                                        });
                                    } catch (err) {}
                                }
                            }
                        } else if (data) {
                            hasPayload = true;
                            const pollLoc = this.resolveLiveChannel(data);
                            Utils.updateOnlinePlayers(data, pollLoc);
                            Utils.processIncomingDMs(data);
                            if (data.c) this.currentMineId = data.c;
                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, pollLoc, parsed.k, parsed.to);
                                    }
                                });
                            }
                        }
                    } catch (e) {
                        dbg('Live poll error / abort:', e);
                    } finally {
                        // Бэкофф: пустые ответы не должны долбить /api/live каждые 2.5 с.
                        this._livePollDelay = hasPayload
                            ? 2500
                            : Math.min(30000, Math.max(2500, (this._livePollDelay || 2500) * 2));
                        if (timeoutId) clearTimeout(timeoutId);
                    }
                    if (this._liveRunning) {
                        this._livePollTimer = setTimeout(poll, this._livePollDelay);
                    }
                };
                poll();
            };

            try {
                if (typeof EventSource !== 'undefined') {
                    const es = new EventSource(url, { withCredentials: true, _customLive: true });
                    this._liveES = es;
                    this._liveConnecting = false;

                    es.onopen = () => console.log('Live Connected!');

                    const handleData = (raw) => {
                        try {
                            let data = raw;
                            if (typeof data === 'string') {
                                try { data = JSON.parse(data); } catch(e) {}
                            }
                            const esLoc = this.resolveLiveChannel(data);
                            Utils.updateOnlinePlayers(data, esLoc);
                            Utils.processIncomingDMs(data);
                            if (data && data.c) this.currentMineId = data.c;
                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, esLoc, parsed.k, parsed.to);
                                    }
                                });
                            }
                        } catch (err) {
                            dbg('Live ES data error:', err);
                        }
                    };

                    es.onmessage = (e) => handleData(e.data);
                    ['message', 'chat', 'mine', 'live', 'event', 'update'].forEach(ev => {
                        try { es.addEventListener(ev, (e) => handleData(e.data)); } catch(e) {}
                    });

                    es.onerror = (e) => {
                        dbg('Live EventSource error, switching to fetch polling:', e);
                        try { es.close(); } catch(err) {}
                        this._liveES = null;

                        // Сбрасываем TTL для всех sse-записей (делаем их «протухшими»)
                        if (window.__lgOnlinePlayers) {
                            const now = Date.now();
                            for (const [nick, info] of window.__lgOnlinePlayers.entries()) {
                                if (info && info.src === 'sse') {
                                    // Сдвигаем timestamp в прошлое — они больше не считаются свежими
                                    info.ts = now - 200000; // больше TTL_CITY (180000)
                                }
                            }
                        }

                        // Триггерим перерисовку списка игроков, если он открыт
                        if (typeof Players !== 'undefined' && Players.onOnlinePlayersUpdated) {
                            try { Players.onOnlinePlayersUpdated(); } catch(e) {}
                        }

                        startPollingFallback();
                    };
                } else {
                    startPollingFallback();
                }
            } catch (e) {
                dbg('Live EventSource init failed:', e);
                this._liveConnecting = false;
                startPollingFallback();
            }
        },

        stopBackgroundLiveListener() {
            this._liveRunning = false;
            this._liveConnecting = false;
            this._livePollDelay = 2500;
            if (this._liveES) {
                try { this._liveES.close(); } catch(e) {}
                this._liveES = null;
            }
            if (this._livePollTimer) {
                clearTimeout(this._livePollTimer);
                this._livePollTimer = null;
            }
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
                            let loc = isMine ? 'mine' : 'city';
                            if (isLive && data) {
                                const d = data.body || data.data || data;
                                if (d && (d.chatRoom === 'mine' || (Array.isArray(d.m) && d.m.length > 0 && !d.town))) {
                                    loc = 'mine';
                                } else if (d && (d.town || d.chatRoom === 'city' || d.chatRoom === '' || !d.chatRoom)) {
                                    loc = 'city';
                                }
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
                                        Chat.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to);
                                    }
                                });
                            }
                        } catch (err) {
                            dbg('ES intercept error:', err);
                        }
                    };

                    this.addEventListener('message', handler);
                    ['message', 'city', 'chat', 'say', 'init', 'mine', 'live', 'event', 'update'].forEach(ev => {
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

                            let loc = isMine ? 'mine' : 'city';
                            if (isLive && data) {
                                const d = data.body || data.data || data;
                                if (d && (d.chatRoom === 'mine' || (Array.isArray(d.m) && d.m.length > 0 && !d.town))) {
                                    loc = 'mine';
                                } else if (d && (d.town || d.chatRoom === 'city' || d.chatRoom === '' || !d.chatRoom)) {
                                    loc = 'city';
                                }
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
                                        Chat.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to);
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
                                    Chat.handleIncoming(a, t, false, false, null, null, null, false, null, loc);
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

        interceptFetch() {
            if (this._fetchIntercepted) return;
            // См. interceptEventSource: в sandbox патчим fetch страницы (unsafeWindow).
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const origFetch = pageWin.fetch || window.fetch;
            if (!origFetch || origFetch.__lgChatProxied) return;
            this._fetchIntercepted = true;
            const self = this;
            const wrappedFetch = async function(...args) {
                const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
                const res = await origFetch.apply(this, args);

                // Задача 3: Ранний выход при отправке сообщений (не клонировать и не парсить)
                if (url.includes('/api/city/say') || url.includes('/api/mine/chat/say')) {
                    return res;
                }

                // 0. Перехват живого потока, игроков онлайн и входящих ЛС (работает всегда)
                const isLive = url.includes('/api/live');
                if (url.includes('/api/city/') || url.includes('/api/mine/') || isLive) {
                    res.clone().json().then(data => {
                        if (data) {
                            const loc = url.includes('/api/mine/') ? 'mine' : (isLive ? self.resolveLiveChannel(data) : 'city');

                            // Задача 2 & Задача 4: общее количество и топ-игроки шахты из /api/mine/state
                            if (url.includes('/api/mine/state')) {
                                const d = data.body || data.data || data;
                                if (d) {
                                    if (typeof d.here === 'number') {
                                        window.__lgMineTotalHere = d.here;
                                    } else if (d.st && typeof d.st.here === 'number') {
                                        window.__lgMineTotalHere = d.st.here;
                                    }
                                    const topList = d.st?.top || d.top;
                                    if (Array.isArray(topList)) {
                                        const now = Date.now();
                                        topList.forEach(item => {
                                            const nick = (typeof item === 'string')
                                                ? item.trim()
                                                : (item && (item[0] || item.l || item.login || item.nick || item.name || item.n));
                                            if (nick && typeof nick === 'string' && nick.trim().length >= 2 && nick.trim().toLowerCase() !== 'me') {
                                                window.__lgOnlinePlayers.set(nick.trim().toLowerCase(), { loc: 'mine', ts: now });
                                            }
                                        });
                                    }
                                }
                            }

                            Utils.updateOnlinePlayers(data, loc);
                            Utils.processIncomingDMs(data);

                            // Чат живого потока разбираем только при включённом перехвате.
                            if (isLive && !self.disabled) {
                                if (data.c) self.currentMineId = data.c;
                                const chats = Utils.extractChatDeep(data);
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        self.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, loc, parsed.k, parsed.to);
                                    }
                                });
                            }
                        }
                    }).catch(() => {});
                }

                try {
                    // 1. Отслеживание ID текущей шахты для навигации
                    if (url.includes('/api/mine/')) {
                        const mMatch = url.match(/[?&]c=([^&]+)/);
                        if (mMatch) {
                            try { self.currentMineId = decodeURIComponent(mMatch[1]); } catch(e){}
                        }
                    }

                    // 2. Профиль персонажа (/api/me)
                    if (url.includes('/api/me')) {
                        res.clone().json().then(data => {
                            const hero = data?.hero || data?.body?.hero || data?.me;
                            if (hero) {
                                window.__lgHero = hero;
                                if (hero.name) self.myNick = hero.name;
                                if (hero.class) self.myRole = hero.class;
                                const hud = document.getElementById(DOM_IDS.playerHud) || document.getElementById('legion-player-hud');
                                if (hud && hud.style.display !== 'none' && typeof UI !== 'undefined' && UI.renderPlayerHudContent) {
                                    UI.renderPlayerHudContent(hud, hero);
                                }
                            }
                        }).catch(() => {});
                    }

                    // Парсим чат всегда, если перехват не отключён.
                    // Закрытый виджет не помеха: сообщения нужны для счётчика непрочитанных.
                    if (self.disabled) {
                        return res;
                    }

                    // 4. Состояние шахты и вход в шахту (сообщения чата шахты в data.chat.chat или data.m)
                    if (url.includes('/api/mine/state') || url.includes('/api/mine/enter') || url.includes('/api/mine/chat')) {
                        res.clone().json().then(data => {
                            if (!data || !data.ok) return;
                            if (data.c) self.currentMineId = data.c;
                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        self.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, 'mine', parsed.k, parsed.to);
                                    }
                                });
                            }
                        }).catch(() => {});
                    }

                    // 5. Вход в город (история чата города)
                    if (url.includes('/api/city/enter')) {
                        res.clone().json().then(data => {
                            if (data && data.ok && data.chat && Array.isArray(data.chat)) {
                                setTimeout(() => {
                                    data.chat.forEach(m => {
                                        const parsed = Utils.extractChatFields(m);
                                        if (parsed.text) {
                                            self.handleIncoming(parsed.author, parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, parsed.channel || 'city', parsed.k, parsed.to);
                                        }
                                    });
                                }, 100);
                            }
                        }).catch(() => {});
                    }
                } catch(e) {}

                return res;
            };
            try { wrappedFetch.__lgChatProxied = true; } catch (e) {}
            try { pageWin.fetch = wrappedFetch; } catch (e) {}
            if (pageWin !== window) { try { window.fetch = wrappedFetch; } catch (e) {} }
        }
    };

    // Экспорт 7TV для отладки: window.__LEGION__.Chat.SevenTV
    Chat.SevenTV = SevenTV;

    // ===== src/main.js =====
    // ============================================================
    // ТОЧКА ВХОДА (src/main.js)
    //
    // Все зависимости лежат в общем IIFE-скоупе сборки, импортов нет
    // (build.js просто конкатенирует файлы в описанном ниже порядке):
    //   core/utils.js  -> DEBUG, dbg, RAND_ID, DOM_IDS, API_BASE, Utils, randomDelay
    //   core/styles.js -> STYLES
    //   core/hooks.js  -> G (перехватчики LGCity / LGAuction / LGQuest / LGMine)
    //   core/ui.js     -> UI
    //   modules/*      -> BuildSim, HeroPlanner, Auction, Players, PriestAssistant, Miner, Chat
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
        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);

        const fabWrap = document.createElement('div');
        fabWrap.className = DOM_IDS.fabWrap;
        fabWrap.id = DOM_IDS.fabWrap;
        fabWrap.innerHTML = `
            <div class="${DOM_IDS.fabMenu}" id="${DOM_IDS.fabMenu}">
                <button class="fab-menu-item" id="${DOM_IDS.btnAutoMine}">⛏️ Умная Шахта (Выкл)</button>
                <button class="fab-menu-item" id="${DOM_IDS.btnBuildSim}">⚙️ Планировщик Героя</button>
                <button class="fab-menu-item" id="${DOM_IDS.btnAuctionScan}">🔍 Сканер Аукциона</button>
                <button class="fab-menu-item" id="${DOM_IDS.btnPlayers}">👥 Игроки (Разведка)</button>
                <button class="fab-menu-item" id="${DOM_IDS.btnFriends}">🤝 Друзья <span id="${DOM_IDS.friendsBadge}" style="display:none; background:#28a745; color:#fff; font-size:11px; padding:1px 6px; border-radius:10px; font-weight:bold; margin-left:auto;">0</span></button>
                <button class="fab-menu-item" id="${DOM_IDS.btnChatToggle}">💬 Чат Города <span class="${DOM_IDS.chatBadge}" id="${DOM_IDS.chatBadge}">0</span></button>
                <button class="fab-menu-item" id="${DOM_IDS.btnPopout}">📺 Вынести чат</button>
                <button class="fab-menu-item" id="${DOM_IDS.btnPocketCity}">🏰 Карманный Город</button>
                <button class="fab-menu-item" id="${DOM_IDS.btnProfile}">👤 Профиль</button>
                <button class="fab-menu-item" id="btn-priest-panel">✨ Панель Жреца</button>
                <button class="fab-menu-item" id="btn-7tv-settings">🎭 Канал 7TV</button>
                <label class="fab-menu-item" style="cursor:pointer; display:flex; align-items:center; justify-content:space-between; user-select:none; font-size:12px; gap:8px;">
                    <span>🚫 Отключить перехват чата</span>
                    <input type="checkbox" id="${DOM_IDS.chkChatDisable}" style="width:16px; height:16px; cursor:pointer; accent-color:#ff5a7a;">
                </label>
            </div>
            <div class="${DOM_IDS.fabBtn}" id="${DOM_IDS.fabBtn}" title="Меню Legion">
                <span id="${DOM_IDS.fabIcon}">🐱</span>
                <span class="${DOM_IDS.chatBadge}" id="${DOM_IDS.fabChatBadge}">0</span>
            </div>
        `;
        document.body.appendChild(fabWrap);

        // Восстановление позиции FAB из localStorage (§ Задача 2)
        try {
            const pos = JSON.parse(localStorage.getItem('LEGION_FAB_POS'));
            if (pos && pos.left && pos.top) {
                fabWrap.style.left = pos.left;
                fabWrap.style.top = pos.top;
                fabWrap.style.right = 'auto';
                fabWrap.style.bottom = 'auto';
            }
        } catch(e) {}

        const fabBtn = document.getElementById(DOM_IDS.fabBtn) || document.getElementById('legion-fab-btn');
        const fabMenu = document.getElementById(DOM_IDS.fabMenu) || document.getElementById('legion-fab-menu');
        UI.setupFab(fabWrap, fabBtn, fabMenu);

        (document.getElementById(DOM_IDS.btnPocketCity) || document.getElementById('btn-pocket-city'))?.addEventListener('click', () => UI.openPocketCity());
        (document.getElementById(DOM_IDS.btnProfile) || document.getElementById('btn-profile'))?.addEventListener('click', () => UI.togglePlayerHud());

        // 🛡️ Индикатор стелс-режима (всегда включён)
        const stealthItem = document.createElement('div');
        stealthItem.className = 'fab-menu-item';
        stealthItem.style.cssText = 'cursor:default; background:rgba(0,255,102,0.08); border-color:rgba(0,255,102,0.3); color:#00ff66; font-size:11px;';
        stealthItem.innerHTML = '<span>🛡️ Стелс</span><span style="font-weight:bold;">' + (window.__lgStealthActive ? 'АКТИВЕН' : 'ОШИБКА') + '</span>';
        document.getElementById(DOM_IDS.fabMenu)?.appendChild(stealthItem);
        (document.getElementById(DOM_IDS.btnPopout) || document.getElementById('btn-popout'))?.addEventListener('click', () => Chat.popoutChat());

        const chkChat = document.getElementById(DOM_IDS.chkChatDisable);
        if (chkChat) {
            chkChat.checked = !!Chat.disabled;
            chkChat.addEventListener('change', (e) => {
                Chat.setDisabled(e.target.checked);
            });
        }

        Miner.init();
        BuildSim.init();        // без кнопки — регистрирует только глобальный клик для .sim-card
        HeroPlanner.init();     // кнопка FAB ведёт сюда
        PriestAssistant.init(); // HUD Жреца в Походе (window.__lgQuestContext)
        Auction.init();
        Players.init();
        Chat.init();

        Chat.interceptEventSource();
        Chat.interceptWebSocket();
        Chat.interceptFetch();
        // Слушаем живой поток всегда (нужно для непрочитанных при закрытом виджете)
        if (!Chat.disabled) {
            Chat.startBackgroundLiveListener();
        }

        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') UI.closeModals(); });

        // 5.2. Экспорт API для отладки и single-instance guard
        const legionApi = {
            Utils,
            UI,
            Miner,
            BuildSim,
            HeroPlanner,
            Auction,
            Players,
            PriestAssistant,
            Chat,
            DOM_IDS,
            RAND_ID,
            _booted: true,
            shutdown: () => {
                PriestAssistant.destroy();
                if (Players._badgeTimer) {
                    clearInterval(Players._badgeTimer);
                    Players._badgeTimer = null;
                }
                if (Miner.abortController) {
                    try { Miner.abortController.abort(); } catch(e) {}
                    Miner.abortController = null;
                }
                Miner.stopMining();
                if (UI._hudTimer) {
                    clearInterval(UI._hudTimer);
                    UI._hudTimer = null;
                }
                if (Chat._popoutWin) {
                    try { Chat._popoutWin.close(); } catch(e) {}
                    Chat._popoutWin = null;
                }
                Chat.stopBackgroundLiveListener();
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
