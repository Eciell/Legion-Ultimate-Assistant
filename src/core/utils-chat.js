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

            if (updated) {
                try {
                    if (typeof Players !== 'undefined' && Players.onOnlinePlayersUpdated) {
                        Players.onOnlinePlayersUpdated();
                    }
                } catch(e) {}
            }
            return updated;
        },
    };
    Object.assign(Utils, UtilsChat);
