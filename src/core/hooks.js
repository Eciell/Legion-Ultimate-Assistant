    // ============================================================
    // 0.1. ПЕРЕХВАТ НАРИВНЫХ КОНТЕКСТОВ ИГРЫ (Обход 429/409 ошибок)
    // G объявлен в core/constants.js (подключается первым) — здесь не дублируем.
    //
    // 11.6.4b: хук LGMine.open УДАЛЁН. Античит шахты (reference/.../mine.js)
    // сравнивает идентичность методов напрямую:
    //   M.open !== open || M.onEvent !== onEvent  ->  pi |= 4
    // Поэтому объект LGMine больше не оборачивается и не переобъявляется:
    // контекст шахты (api/art) читается безопасно из существующих глобальных
    // переменных — G.X в core/utils-api.js и core/utils-art.js.
    // ============================================================

    if (!G.__lgHookedProps) {
        G.__lgHookedProps = true;
        let rawLGCity = G.LGCity;
        let rawLGAuction = G.LGAuction;
        let rawLGQuest = G.LGQuest;

        const hookCity = (val) => {
            rawLGCity = val;
            if (!val || val.__hooked) return;
            val.__hooked = true;

            // 11.6.4b: подмена LGCity.open тоже снята (любая подмена open на
            // игровых объектах — детект). Контекст города берём из G.X/LGCity
            // по месту вызова, см. core/utils-api.js, modules/players.js,
            // modules/chat/chat-pip.js.

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
        // ------------------------------------------------------------
        // LGQuest (поход)
        //
        // В реальном клиенте у LGQuest НЕТ метода open() (см.
        // docs/ARCHITECTURE.md §2: init(QX), data(q), show(on), result(r),
        // hero(), _view()), поэтому старый хук по val.open не срабатывал
        // никогда и G.__lgQuestContext оставался пустым.
        // Теперь контекст берём из:
        //   1) init(QX) — штатная точка входа в экран похода;
        //   2) _view() — игра зовёт его на собственные действия игрока;
        //      используем как маркер «мы в походе» и как страховку, если
        //      аддон загрузился уже после старта похода.
        // ------------------------------------------------------------

        // QX-мост обязан быть объектом с геймплейными методами: так мы не
        // сохраним случайно DOM-узел или номер комнаты.
        const isQuestCtx = (o) => !!o && typeof o === 'object' && !o.nodeType &&
            (typeof o.data === 'function' || typeof o.act === 'function' ||
             typeof o.api === 'function' || typeof o.hero === 'function');

        // v11.6.3: фасада LG.qx() в актуальном клиенте больше нет —
        // window.LG = { restyle, rerender } (см. reference/LegionFrontSRC/site/
        // app.js). Контекст QX сохраняем только из штатного init(ctx), а
        // «мы в походе» подтверждаем живым снимком оригинального _view().
        // Ссылку на оригинал держим локально: рекурсии через G.LGQuest нет.

        const hookQuest = (val) => {
            rawLGQuest = val;
            if (!val || val.__hooked) return;

            const origView = typeof val._view === 'function' ? val._view : null;
            const questLive = () => {
                try {
                    const q = origView ? origView.call(val) : null;
                    return !!(q && q.on);
                } catch (e) {
                    return false;
                }
            };

            let patched = false;

            // 1) init(QX) — сохраняем контекст похода.
            if (typeof val.init === 'function') {
                const origInit = val.init;
                val.init = function (ctx) {
                    // Штатный QX приходит аргументом. Если init позвали без
                    // него, но снимок _view() говорит «поход идёт» — ставим
                    // маркер, не выдумывая несуществующий фасад.
                    if (isQuestCtx(ctx)) {
                        G.__lgQuestContext = ctx;
                        G.__lgQuestOn = true;
                        dbg('LGQuest.init: контекст похода сохранён');
                    } else if (questLive()) {
                        G.__lgQuestOn = true;
                        dbg('LGQuest.init: активный поход подтверждён _view()');
                    }
                    return origInit.apply(this, arguments);
                };
                patched = true;
            }

            // 2) _view() — перехватываем вызов, чтобы точно знать, что
            //    мы внутри похода. v11.6.3: сам вызов _view() уже доказывает
            //    активный поход (игра зовёт его на каждом тике) — фасад qx()
            //    больше не нужен.
            if (typeof val._view === 'function') {
                const origViewCall = val._view;
                val._view = function () {
                    G.__lgQuestOn = true;
                    return origViewCall.apply(this, arguments);
                };
                patched = true;
            }

            // 3) data(q) — сеттер игры: сохраняем СЫРОЙ пакет до буферизации.
            //    quest.js кладёт его в RAW и показывает с задержкой стрима (q.dl),
            //    поэтому _view() отстаёт.
            // TODO: REMOVE — снимок писался для Ассистента Жреца
            // (modules/priest-assistant.js удалён в 11.6.0g-1); сейчас
            // G.__lgRawQuestData никто не читает. Хук оставлен, пока
            // пользователь не подтвердил удаление.
            if (typeof val.data === 'function' && !val.__dataHooked) {
                const origData = val.data;
                val.data = function (q) {
                    // G — это unsafeWindow (см. core/constants.js).
                    if (q) G.__lgRawQuestData = q;
                    return origData.apply(this, arguments);
                };
                val.__dataHooked = true;
                patched = true;
            }

            // Метку ставим только если реально что-то подменили: если
            // методы ещё не созданы, следующий сеттер LGQuest (или сторож)
            // попробует повесить хук повторно.
            if (patched) val.__hooked = true;
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
