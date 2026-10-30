    // ============================================================
    // 5. МОДУЛЬ: СКАНЕР АУКЦИОНА
    // ============================================================
    const Auction = {
        cityStockMap: new Map(),
        cityStockLoaded: false,
        cityStockLoading: null,

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
            const bonus = en > 0 ? (GAME_DATA.ENCHANT_MULTIPLIERS[Math.min(15, en)] || 0) : 0;

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

        // Парсинг предметов переехал в core/utils-art.js (v11.6.0, этап 4),
        // чтобы не было цикла utils-art.getItemName -> Auction.getItemName:
        //    Auction.getItemName(id, itemsMap) -> Utils.getItemName(id, itemsMap)
        //    Auction.getItemMeta(id, rarityHint) -> Utils.getItemMeta(id, rarityHint)
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
                    const meta = Utils.getItemMeta(group.id, serverRarity); // Получаем слот, редкость, класс

                    group.lots.forEach(l => {
                        const ev = this.getLotEvaluation(l, res, activeMap);
                        const basePrice = ev.fairUnit > 0 ? ev.fairUnit : median;
                        const disc = ev.fairUnit > 0 ? ev.discount : (median > 0 ? Math.round(((median - l.unitPrice) / median) * 100) : 0);
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
