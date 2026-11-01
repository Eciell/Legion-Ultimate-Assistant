    // ============================================================
    // 5. МОДУЛЬ: СКАНЕР АУКЦИОНА
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
        // Звук можно выключить чекбоксом «Звук» в фильтрах; выбор живёт в
        // localStorage. Чтение обёрнуто в try: в приватном режиме/при
        // запрете хранилища getItem бросает исключение и ронял бы модуль.
        alertSoundEnabled: (() => {
            try { return localStorage.getItem('LEGION_AUC_SOUND') !== 'false'; }
            catch (e) { return true; }
        })(),

        init() {
            (document.getElementById(DOM_IDS.btnAuctionScan) || document.getElementById('btn-auction-scan'))?.addEventListener('click', () => this.open());
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

        // 11.5.5: состояние героя для проверки уровня торговли.
        // /api/me — основной источник (hero.level, hero.tml); снимок страницы
        // G.ME.hero — резерв, чтобы сканер работал и при молчащем API.
        async fetchHeroState() {
            try {
                const res = await Utils.fetchApi('/api/me');
                const hero = res?.hero || res?.body?.hero || null;
                if (hero) return hero;
            } catch (e) {
                dbg('[AUCTION] /api/me недоступен:', e);
            }
            // ME живёт в page-context: в песочнице Tampermonkey только через G.
            return G.ME?.hero || G.ME?.me || null;
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

        async open() {
            UI.showModal(`<h2>🔍 Сканер Аукциона <button class="custom-close" id="custom-close-btn">✖</button></h2><div class="loader">Считаем цены...</div>`);
            try {
                if (!this.cityStockLoaded) {
                    await this.fetchCityStock();
                    // fetchCityStock ограничен таймаутом (8 с): если цены магазина
                    // не загрузились, продолжаем без них — оценка пойдёт по
                    // data.vals / медиане рынка, но модалка не зависнет.
                    if (!this.cityStockLoaded) {
                        dbg('[AUCTION] Цены магазинов недоступны — считаем без них');
                    }
                }
                // 11.5.5: витрину и состояние героя тянем параллельно — уровень
                // (hero.level) и порог обмена (hero.tml) нужны до первой отрисовки.
                const heroPromise = this.fetchHeroState();
                const res = await Utils.fetchApi('/api/auction');
                const hero = await heroPromise.catch(() => null);
                this.myLevel = +hero?.level || 1;
                this.tradeMinLevel = +hero?.tml || 0;
                const lots = res.lots || res.body?.lots;
                if (!lots || !Array.isArray(lots) || !lots.length) {
                    return UI.showModal('<h2>Аукцион пуст <button class="custom-close" id="custom-close-btn">✖</button></h2>');
                }
                const itemsMap = res.items || res.body?.items || (res.data && res.data.items) || {};
                // 11.5.5: история последних цен по предметам — { id: [[цена, заточка], …] }.
                const histMap = res.hist || res.body?.hist || {};

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
                            lotId: l.id,
                            // 11.5.5: ru — время окончания розыгрыша (0/undefined у
                            // обычного лота), wn — число заявок «Хочу» в розыгрыше.
                            ru: l.ru || null,
                            wn: +l.wn || 0
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

                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:#ffcf6a; font-weight:bold; font-size:14px;">
                            <input type="checkbox" id="auction-sound" ${this.alertSoundEnabled ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> Звук
                        </label>

                        <div style="display:flex; gap:10px; align-items:center; margin-left:10px;">
                            <button id="auction-prev" title="Предыдущая страница" style="background:#2a2030; border:1px solid #caa55c; color:#caa55c; padding:4px 10px; border-radius:4px; cursor:pointer; font-weight:bold;">◀</button>
                            <span id="auction-page-info" style="color:#aaa; font-size:12px;">Стр. 1 из 1</span>
                            <button id="auction-next" title="Следующая страница" style="background:#2a2030; border:1px solid #caa55c; color:#caa55c; padding:4px 10px; border-radius:4px; cursor:pointer; font-weight:bold;">▶</button>
                        </div>
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
                        Всего лотов: <span id="auction-count">0</span> · на странице до ${this.pageSize}
                    </div>`);

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
                        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#888; padding:20px;">Ничего не найдено по заданным фильтрам.</td></tr>';
                        return;
                    }

                    const start = this.currentPage * this.pageSize;
                    const displayList = data.slice(start, start + this.pageSize);
                    let html = '';

                    displayList.forEach(l => {
                        const cls = l.discount >= 20 ? 'deal-great' : (l.discount >= 10 ? 'deal-good' : (l.discount < 0 ? 'deal-bad' : 'stat-eq'));
                        const qtyStr = l.qty > 1 ? `<b>${l.qty}</b>` : '1';
                        const totalPriceStr = l.qty > 1 ? `${Utils.formatMoney(l.totalPrice)} <small style="color:#888">(${Utils.formatMoney(l.unitPrice)})</small>` : Utils.formatMoney(l.totalPrice);

                        // 11.5.5: розыгрыш идёт, пока не истекло время ru;
                        // порог tml блокирует покупку у игроков на низком уровне.
                        const isRaffle = l.ru && l.ru > Date.now();
                        const isLowLevel = this.myLevel < this.tradeMinLevel;

                        let btnText = 'Купить';
                        let btnColor = '#28a745';
                        let btnDisabled = false;

                        if (isLowLevel) {
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

                        const rarityColors = { common: '#c9ccd6', uncommon: '#4cc95a', rare: '#4aa3ff', epic: '#b06bff', legendary: '#ffb83d' };
                        const color = rarityColors[l.metaRarity] || '#fff';
                        const rarityBadge = l.metaRarity ? `<span style="color:${color}; font-size:10px; border:1px solid ${color}; border-radius:4px; padding:0 4px; margin-left:5px; text-transform:capitalize;">${Utils.escapeHtml(l.metaRarity)}</span>` : '';

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

                        html += `<tr data-lot-id="${Utils.escapeHtml(l.id || '')}" data-lot-name="${Utils.escapeHtml(l.name || '')}">
                            <td>${l.icon ? `<img src="${Utils.safeUrl(l.icon)}" style="width:20px;vertical-align:middle;margin-right:5px;">` : ''}<b>${Utils.escapeHtml(l.name)}</b>${rarityBadge}${histIcon}</td>
                            <td>${qtyStr}</td>
                            <td style="color:#ffcf6a; font-weight:bold;">${totalPriceStr}</td>
                            <td style="font-weight:bold;">${Utils.formatMoney(l.unitPrice)}</td>
                            <td>${Utils.formatMoney(l.median)}</td>
                            <td class="${cls}">${l.discount > 0 ? '-' : '+'}${Math.abs(l.discount)}%</td>
                            <td style="color:#888;">${timeStr}</td>
                            <td>${Utils.escapeHtml(l.seller || '')}</td>
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

                        if (onlyDeals && l.discount < 10) return false;
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
