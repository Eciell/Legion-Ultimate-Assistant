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
                if (typeof Chat !== 'undefined' && Chat.activeMainTab === 'dm' && typeof Chat.renderMessages === 'function') {
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
                const warmRes = await fetch('/api/city/enter', {
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
