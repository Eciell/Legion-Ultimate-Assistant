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
         * («наблюдений за 7 дней нет») в объект не попадает: отсутствие ключа
         * и означает «данных нет», тултип в этом случае не рисуется.
         *
         * 11.6.2d: раньше объект ЗАМЕНЯЛСЯ ответом на один запрос. Планировщик
         * героя запрашивает всего два id (звезда/сфера), и такая замена стёрла
         * бы медианы всех лотов витрины — тултипы «Медиана рынка» пропали бы до
         * следующего открытия аукциона. Мердж безопасен и для витрины: цены
         * живут 7 дней на сервере, поэтому старый ключ не «протухает» мгновенно.
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
         * 0 — наблюдений за 7 дней нет (колонка показывает «—»).
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
         * 0 означает «наблюдений за 7 дней нет» — вызывающий обязан подставить
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
            return ` title="Медиана сети (7 дней): ${Utils.formatMoney(net)}"`;
        },

        // 11.6.2c.2: строка «Медиана рынка» в НАТИВНЫХ тултипах предметов.
        //
        // Игра рисует подсказки сама: #lg-tip (site/app.js — экипировка и
        // сумка героя) и #lgi-tip (lib/inventory.js — окно инвентаря).
        // Оба наполняются через innerHTML, поэтому единственная точка
        // перехвата — MutationObserver на document.body: как только игра
        // переписала содержимое подсказки, мы дописываем в её конец строку.
        //
        // id предмета в разметке подсказки нет, поэтому:
        //   1) игра помечает наведённый элемент aria-describedby="<id
        //      подсказки>" (tipPlace в app.js) -> читаем data-sel (это uid
        //      экземпляра) и ищем предмет в инвентаре героя (G.ME.hero.items);
        //   2) если якорь не помог — сравниваем заголовок подсказки с
        //      названиями предметов, по которым есть медиана (tipNameIndex).
        // ------------------------------------------------------------
        initItemTips() {
            // Повторный boot() не должен плодить наблюдателей.
            if (this._tipObserver || typeof MutationObserver === 'undefined') return;

            const check = () => {
                try {
                    const lgTip = document.getElementById('lg-tip');
                    if (lgTip) this.attachMarketMedian(lgTip);
                    const lgiTip = document.getElementById('lgi-tip');
                    if (lgiTip) this.attachMarketMedian(lgiTip);
                    // Карточка предмета в нативной подсказке (.tip.card) —
                    // отдельный режим #lg-tip, проверяем и по селектору.
                    document.querySelectorAll('.tip.card').forEach(el => this.attachMarketMedian(el));
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
         * Дописать строку «📈 Медиана рынка: …» в подсказку, если для её
         * предмета есть медиана сети. Повторный вызов безопасен: маркер
         * .lg-market-median не даёт вставить строку дважды.
         *
         * @param {Element} tipEl #lg-tip / #lgi-tip / .tip.card
         */
        attachMarketMedian(tipEl) {
            if (!tipEl || tipEl.hidden) return;
            if (!tipEl.textContent || !tipEl.textContent.trim()) return;
            if (tipEl.querySelector('.lg-market-median')) return;

            const itemId = this.resolveTipItemId(tipEl);
            if (!itemId) return;
            const price = this.getMarketMedian(itemId);
            if (price <= 0) return;

            const line = document.createElement('div');
            line.className = 'lg-market-median';
            line.textContent = `📈 Медиана рынка: ${Utils.formatMoney(price)}`;
            tipEl.appendChild(line);
        },

        /**
         * id предмета по подсказке: сначала якорь (aria-describedby), затем
         * совпадение заголовка с известным названием.
         *
         * @param {Element} tipEl
         * @returns {string} '' — предмет не опознан
         */
        resolveTipItemId(tipEl) {
            // 1. Якорь подсказки: игра ставит aria-describedby="lg-tip" на
            //    наведённую ячейку, инвентарь — aria-describedby="lgi-tip".
            const tipId = tipEl.id;
            if (tipId) {
                let anchor = null;
                try {
                    anchor = document.querySelector(`[aria-describedby="${tipId}"]`);
                } catch (e) {
                    anchor = null;
                }
                if (anchor) {
                    // Прямые data-атрибуты предмета (наши строки и сторонние аддоны).
                    const direct = anchor.getAttribute('data-item-id')
                        || anchor.getAttribute('data-lg-item')
                        || anchor.getAttribute('data-item')
                        || '';
                    if (direct && this.getMarketMedian(direct) > 0) return direct;

                    // Строка нашей витрины аукциона: id предмета в data-lot-id.
                    const lotRow = anchor.closest('[data-lot-id]');
                    const lotId = lotRow && lotRow.getAttribute('data-lot-id');
                    if (lotId && this.getMarketMedian(lotId) > 0) return lotId;

                    // data-sel — uid экземпляра предмета (app.js: data-sel="${it.uid}").
                    const uid = anchor.getAttribute('data-sel');
                    const items = G.ME?.hero?.items;
                    if (uid && Array.isArray(items)) {
                        const found = items.find(it => it && it.uid === uid);
                        if (found && found.id && this.getMarketMedian(found.id) > 0) return found.id;
                    }
                }
            }

            // 2. По названию из заголовка подсказки.
            const title = this.tipTitleText(tipEl);
            if (!title) return '';
            return this.tipNameIndex()[title] || '';
        },

        /**
         * Текст заголовка подсказки в нормализованном виде:
         *   .t-n      — имя предмета в тултипе игры (site/app.js),
         *   .lgi-th b — имя в тултипе инвентаря (lib/inventory.js).
         */
        tipTitleText(tipEl) {
            const node = tipEl.querySelector('.t-n, .lgi-th b, h4, b');
            if (!node) return '';
            return this.normalizeItemName(node.textContent || '');
        },

        /**
         * Индекс «нормализованное название -> id предмета» по всем id, для
         * которых есть медиана. Строится лениво и пересобирается, когда
         * меняется набор id (новый скан витрины) или справочник предметов.
         */
        tipNameIndex() {
            const itemsKey = this.lastItemsMap ? Object.keys(this.lastItemsMap).length : 0;
            const key = Object.keys(this.marketMedians).sort().join(',') + '|' + itemsKey;
            if (this._tipNameIndex && this._tipNameIndexKey === key) return this._tipNameIndex;

            const map = {};
            for (const id of Object.keys(this.marketMedians)) {
                const name = this.normalizeItemName(Utils.getItemName(id, this.lastItemsMap));
                if (name && !map[name]) map[name] = id;
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

        /**
         * 11.6.2c.3: процент выгоды лота — единый расчёт для колонки
         * «Выгода», фильтра «Только выгодные», сортировки и оповещений.
         *
         * Приоритет ориентира (сверху вниз):
         *   1. медиана сети (marketMedians[id]) — общая статистика игроков с
         *      аддоном за 7 дней (GET /market/medians). Именно её показывает
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
                ['Медиана', 'Медиана сети по наблюдениям за 7 дней (наш сервер). Если наблюдений нет — приглушённая локальная медиана активных лотов, иначе «—». Цена лота за штуку ниже медианы на 15% и больше — зелёная, выше на 15% и больше — красная'],
                ['Магазин', 'Цена NPC в официальной лавке (голубая). Строки дешевле магазина подсвечены зелёным'],
                ['Вложено', 'Идеальная (минимальная) стоимость заточки до текущего +N: сумма цен уровней без учёта шансов'],
                ['Выгода', 'На сколько % цена лота за штуку ниже ориентира: сначала медиана сети (7 дней), затем лавка NPC/справочная ценность/медиана активных лотов. Зелёный от 10%, красный — дороже ориентира'],
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
                                <th data-sort="median" title="Медиана сети по наблюдениям за 7 дней (legion.ctrlfree.host). Без наблюдений — локальная медиана активных лотов">Медиана</th>
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
                                ? ' title="Медиана сети (7 дней): нет данных — показана локальная медиана активных лотов"'
                                : ' title="Медиана сети (7 дней): нет данных"');

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
                                            ${investedHtml}${npcChip}
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
