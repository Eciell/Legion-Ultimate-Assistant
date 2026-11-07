    // ============================================================
    // 5. МОДУЛЬ: СКАНЕР АУКЦИОНА
    //
    // v11.6.2c.1: статистика цен на нашем сервере. Каждое открытие витрины
    // даёт снимок цен (цена за штуку, свои лоты отброшены) — пачка уходит в
    // POST /market/scan не чаще раза в 5 минут, а медианы по всем игрокам с
    // аддоном подтягиваются GET /market/medians и кладутся в marketMedians
    // (тултип колонки «Медиана»). Расчёты выгоды по-прежнему локальные.
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

            const myNick = String(this.myNick || '').toLowerCase();
            for (const lot of lots) {
                const id = String((lot && lot.i) || '').trim();
                const total = Number(lot && lot.p);
                if (!id || !Number.isFinite(total) || total <= 0) continue;

                const seller = String((lot && lot.s) || '').toLowerCase();
                if (myNick && seller === myNick) continue;

                const qty = Math.max(1, Number(lot && lot.n) || 1);
                const unit = Math.max(1, Math.round(total / qty));

                if (!seen.has(id)) {
                    seen.add(id);
                    ids.push(id);
                }
                // Буфер ограничен размером пачки сервера: лишние наблюдения
                // просто не копим (следующее открытие витрины их повторит).
                if (this.marketScanBuffer.length < this.MARKET_MAX_BATCH) {
                    this.marketScanBuffer.push({ id, price: unit });
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
         * Результат кладём в this.marketMedians ({ id: цена }). null от сервера
         * («наблюдений за 7 дней нет») в объект не попадает: отсутствие ключа
         * и означает «данных нет», тултип в этом случае не рисуется.
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

            const next = {};
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

        /**
         * title для ячейки «Медиана»: медиана сети из памяти модуля.
         * Пустая строка, если по предмету наблюдений нет (v11.6.2c.1).
         *
         * @param {string} itemId
         * @returns {string}
         */
        marketMedianTitle(itemId) {
            const net = +this.marketMedians[itemId] || 0;
            if (net <= 0) return '';
            return ` title="Медиана сети (7 дн.): ${Utils.formatMoney(net)}"`;
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
                    for (let lv = 1; lv <= en; lv++) {
                        const pct = GAME_DATA.ENCHANT_PRICES[lv] || 0;
                        invested += Math.max(GAME_DATA.ENCHANT_PRICE_MIN, Math.round(itemV * pct / 100));
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
        // GAME_DATA.ENCHANT_PRICES (идеальная, без учёта шансов).
        showInfo() {
            const c = this.cfg || {};
            const feePct = c.feePct != null ? c.feePct : 1;
            const feeMin = c.feeMin != null ? c.feeMin : 10;
            const comPct = c.com != null ? c.com : 5;
            const maxLots = c.maxLots != null ? c.maxLots : 10;
            const hours = Array.isArray(c.hours) && c.hours.length ? c.hours : [24, 48, 72];
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
                ['Медиана', 'Ориентир цены: базовая цена лавки NPC → базовая ценность предмета → медиана активных лотов. Заточка в ориентир НЕ входит'],
                ['Магазин', 'Цена NPC в официальной лавке (голубая). Строки дешевле магазина подсвечены зелёным'],
                ['Вложено', 'Идеальная (минимальная) стоимость заточки до текущего +N: сумма цен уровней без учёта шансов'],
                ['Выгода', 'На сколько % цена лота ниже ориентира (зелёный = выгодно, красный = дорого)'],
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
                    <p>Заточка (поле <code>en</code>) БОЛЬШЕ не увеличивает «справедливую цену»: выгода считается от базовой цены NPC/рынка. Вместо этого в колонке <b>«Вложено»</b> показана идеальная (минимальная) стоимость заточки до +N — сумма цен уровней из <code>GAME_DATA.ENCHANT_PRICES</code> (с минимумом ${GAME_DATA.ENCHANT_PRICE_MIN} меди за попытку, без учёта шансов).</p>
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
                // (hero.level), порог обмена (hero.tml) и логин (user.login) нужны
                // до первой отрисовки (фильтр «Мои лоты» сравнивает с продавцом).
                const mePromise = this.fetchMeState();
                const res = await Utils.fetchApi('/api/auction');
                const me = await mePromise.catch(() => null);
                this.myLevel = +me?.hero?.level || 1;
                this.tradeMinLevel = +me?.hero?.tml || 0;
                this.myNick = String(me?.login || '').toLowerCase();
                const lots = res.lots || res.body?.lots;
                if (!lots || !Array.isArray(lots) || !lots.length) {
                    return UI.showModal('<h2>Аукцион пуст <button class="custom-close" id="custom-close-btn">✖</button></h2>');
                }
                const itemsMap = res.items || res.body?.items || (res.data && res.data.items) || {};
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
                            // 11.5.5: логин продавца отдельно от отображаемого имени:
                            // «Мои лоты» сравнивают именно логин (me.user.login).
                            sellerLogin: l.s || '',
                            metaSlot: meta.slot,
                            metaRarity: meta.rarity,
                            metaRole: meta.role,
                            sourceType: ev.sourceType,
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
                    <h2 style="display:flex; align-items:center; gap:10px;">
                        🔍 Сканер Аукциона
                        <button id="auction-info-btn" title="Справка по аукциону" style="width:26px; height:26px; border-radius:50%; background:rgba(202,165,92,0.15); border:1px solid #caa55c; color:#caa55c; font-weight:bold; font-size:16px; font-family:serif; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">i</button>
                        <button class="custom-close" id="custom-close-btn" style="margin-left:auto;">✖</button>
                    </h2>

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

                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:#ffcf6a; font-weight:bold; font-size:14px;">
                            <input type="checkbox" id="auction-my-lots" ${this.showMyLotsOnly ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> Мои лоты
                        </label>

                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:#ffcf6a; font-weight:bold; font-size:14px;">
                            <input type="checkbox" id="auction-favs" ${this.showFavoritesOnly ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> ⭐ Избранное
                        </label>

                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:#ffcf6a; font-weight:bold; font-size:14px;">
                            <input type="checkbox" id="auction-only-deals" style="width:16px; height:16px; accent-color:#caa55c;"> Только выгодные
                        </label>

                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:#ffcf6a; font-weight:bold; font-size:14px;">
                            <input type="checkbox" id="auction-sound" ${this.alertSoundEnabled ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> Звук
                        </label>

                        <div style="display:flex; gap:10px; align-items:center; margin-left:auto;">
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
                                <th data-sort="npcPrice">Магазин</th>
                                <th data-sort="invested">Вложено</th>
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
                        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; color:#888; padding:20px;">Ничего не найдено по заданным фильтрам.</td></tr>';
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

                        // 11.5.5: «свой» лот (продавец = логин из /api/me) и цена
                        // того же предмета в магазинах NPC. NPC торгует за 1 шт.,
                        // поэтому сравниваем с ценой лота за штуку, а не с общей.
                        const isCur = !!this.myNick && (
                            String(l.sellerLogin || '').toLowerCase() === this.myNick
                            || String(l.seller || '').toLowerCase() === this.myNick
                        );
                        const npcPrice = +l.npcPrice || this.cityStockMap.get(l.id) || 0;
                        const npcHtml = npcPrice > 0
                            ? `<span style="color:#8fd3ff;">${Utils.formatMoney(npcPrice)}</span>`
                            : '<span style="color:#555;">—</span>';
                        const isCheap = npcPrice > 0 && l.unitPrice < npcPrice;

                        // 11.5.5: «Вложено» — идеальная (минимальная) стоимость
                        // заточки до +N (см. getLotEvaluation). У незаточенных — «—».
                        const investedHtml = l.invested > 0
                            ? `<span style="color:#ffcf6a;">${Utils.formatMoney(l.invested)}</span>`
                            : `<span style="color:#555;">—</span>`;

                        // Приоритет подсветки: дешевле магазина > мой лот.
                        const rowStyle = isCheap
                            ? 'background: rgba(76, 201, 90, 0.1);'
                            : (isCur ? 'background:rgba(202,165,92,0.12);' : '');

                        let btnText = 'Купить';
                        let btnColor = '#28a745';
                        let btnDisabled = false;

                        if (isCur) {
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

                        // 11.5.5: ★/☆ — «Избранное». Хранится по id предмета,
                        // поэтому звезда одинакова у всех лотов этого предмета.
                        const isFav = this.favorites.has(l.id);
                        const starHtml = `<span class="auc-fav-btn" data-id="${Utils.escapeHtml(l.id || '')}" title="${isFav ? 'Убрать из избранного' : 'В избранное'}" style="cursor:pointer; font-size:16px; margin-left:5px; color:${isFav ? '#ffd700' : '#555'};">${isFav ? '★' : '☆'}</span>`;

                        html += `<tr data-lot-id="${Utils.escapeHtml(l.id || '')}" data-lot-name="${Utils.escapeHtml(l.name || '')}" style="${rowStyle}">
                            <td>${l.icon ? `<img src="${Utils.safeUrl(l.icon)}" style="width:20px;vertical-align:middle;margin-right:5px;">` : ''}<b>${Utils.escapeHtml(l.name)}</b>${rarityBadge}${histIcon}${starHtml}</td>
                            <td>${qtyStr}</td>
                            <td style="color:#ffcf6a; font-weight:bold;">${totalPriceStr}</td>
                            <td style="font-weight:bold;">${Utils.formatMoney(l.unitPrice)}</td>
                            <td${this.marketMedianTitle(l.id)}>${Utils.formatMoney(l.median)}</td>
                            <td>${npcHtml}</td>
                            <td style="color:#d8c9a8;">${investedHtml}</td>
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
