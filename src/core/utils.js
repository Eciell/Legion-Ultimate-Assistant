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
        getItemIcon(id) {
            try { return window.MDDoodle?.CATALOG?.icons?.[id] || ''; } catch { return ''; }
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
    const randomDelay = (min, max) => Utils.randomDelay(min, max);
