    // ============================================================
    // 0.1. ПЕРЕХВАТ НАРИВНЫХ КОНТЕКСТОВ ИГРЫ (Обход 429/409 ошибок)
    // G объявлен в core/constants.js (подключается первым) — здесь не дублируем.
    // ============================================================

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
