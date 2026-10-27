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
                // Контекст с api() может быть в первом или во втором аргументе
                const ctx = (x && typeof x.api === 'function') ? x : (c && typeof c.api === 'function') ? c : null;
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
                    if (cx) G.__lgAucContext = cx;
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
