    // ============================================================
    // 6.5. МОДУЛЬ: КАРМАННЫЙ ГОРОД (modules/pocket-city.js)
    //
    // Прямой доступ к официальным зданиям игры из любой локации.
    // Вынесено из core/ui.js (v11.6.0, этап 3): UI остаётся фабрикой
    // модалок/HUD, а вся логика «нативных» зданий живёт здесь.
    // Разметку отдаёт UITemplates.pocketCityModal(), окно — UI.showModal().
    //
    // Подключается после core/ui.js (SHARED_MODULES в build.js): методы
    // зовут UI/UITemplates по вызову, на этапе загрузки зависимостей нет.
    //
    // v11.6.4c: перед открытием здания ждём не просто появления LGCity,
    // а реальной готовности города (состояние S и .cy-room) — иначе первый
    // клик терялся: LGCity.panel(id) до LGCity.open(el, CX) — молчаливый no-op.
    //
    // v11.6.4d: после закрытия здания возвращаем игрока туда, откуда он пришёл.
    // Шахта в игре — не вкладка, а оверлей `.mn` (body.mn-on) поверх «Города»,
    // поэтому её запоминаем отдельно, чат LGChatOne перевешиваем обратно в шахту,
    // а городской слой гасим через LGCity.sleep() (как это делает openMine).
    // ============================================================
    const PocketCity = {
        // Ожидание готовности города (v11.6.4c). Два этапа:
        //   1) city.js грузится лениво по клику на вкладку «Город»;
        //   2) сам город строится уже асинхронно (townPrep/LGCityGL.load).
        CITY_POLL_MS: 100,
        CITY_LOAD_TIMEOUT_MS: 5000,
        CITY_READY_TIMEOUT_MS: 10000,
        // v11.6.4d: пауза перед возвратом — даём игре доиграть закрытие
        // панели здания (closePanel снимает .in, hidden ставит через 260 мс).
        RETURN_DELAY_MS: 320,
        // Отключение текущего наблюдателя закрытия здания (повторные клики
        // по «Карманному городу» не должны плодить watchers).
        _closeWatch: null,

        // Модалка со списком зданий: карточка -> нативное здание игры.
        open() {
            // Модалку берём из возврата showModal: её класс — с рандомным
            // префиксом (DOM_IDS.customModal), поэтому поиск
            // `.custom-modal:last-of-type` по документу ненадёжен.
            const modal = UI.showModal(UITemplates.pocketCityModal());
            if (!modal) return;

            // Обработчики вешаем только на кнопки этой модалки: раньше поиск
            // шёл по всему документу и мог зацепить чужие .pocket-grid-btn.
            modal.querySelectorAll('.pocket-grid-btn').forEach(btn => {
                btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-3px)'; btn.style.boxShadow = '0 6px 15px rgba(0,0,0,0.5)'; });
                btn.addEventListener('mouseleave', () => { btn.style.transform = 'none'; btn.style.boxShadow = 'none'; });
                btn.addEventListener('click', (e) => {
                    const room = e.currentTarget.getAttribute('data-room');
                    UI.closeModals();
                    if (room) PocketCity.openNativeBuilding(room);
                });
            });
        },
        /**
         * Ждём выполнения условия, опрашивая его каждые CITY_POLL_MS.
         * true — дождались, false — истёк таймаут.
         */
        async waitFor(check, timeoutMs) {
            const deadline = Date.now() + timeoutMs;
            for (;;) {
                try {
                    if (check()) return true;
                } catch (e) { /* проверка не должна ломать ожидание */ }
                if (Date.now() >= deadline) return false;
                await new Promise(resolve => setTimeout(resolve, PocketCity.CITY_POLL_MS));
            }
        },
        /**
         * Готов ли город «по-настоящему» (v11.6.4c).
         *
         * LGCity появляется сразу после загрузки site/city.js, но его состояние
         * S создаётся только внутри LGCity.open(el, CX). До этого LGCity.panel(id)
         * и LGCity.room(id) — это `S && openPanel(id)`, то есть молчаливый no-op.
         * Из-за этого первый клик по зданию «уходил в молоко», а второй срабатывал
         * (город уже успевал построиться).
         *
         * Основной признак: в #tab-city есть .cy-room — его создаёт build()
         * одновременно с состоянием S. Запасной: методы-пробники LGCity
         * (debug/kw) возвращают null, пока S не создан.
         */
        isCityReady(pageWin) {
            const host = document.getElementById('tab-city');
            if (host && host.querySelector('.cy-room')) return true;
            const city = pageWin && pageWin.LGCity;
            if (!city) return false;
            for (const probe of ['debug', 'kw']) {
                try {
                    if (typeof city[probe] === 'function' && city[probe]()) return true;
                } catch (e) { /* метод-пробник может быть недоступен */ }
            }
            return false;
        },
        /**
         * Открыта ли шахта (v11.6.4d).
         *
         * В игре нет вкладки data-tab="mine": mine.js монтирует полноэкранный
         * оверлей `.mn` и вешает на body класс `mn-on`. Этот оверлей остаётся
         * поверх вкладки «Город» и после открытия здания — панель здания
         * (.cy-room) лежит выше него (z-index 200).
         */
        isMineOpen() {
            return document.body.classList.contains('mn-on') && !!document.querySelector('.mn');
        },
        /**
         * id активной вкладки игры без префикса: city / quest / hero / ...
         * app.js: tab() держит класс `.on` на элементах `.tab`.
         */
        activeTabId() {
            const on = document.querySelector('.tab.on');
            return on && on.id ? String(on.id).replace(/^tab-/, '') : '';
        },
        /**
         * Ждём закрытия окна нативного здания и возвращаем игрока туда,
         * откуда он пришёл (v11.6.4d).
         *
         * Панель здания — это `.cy-room` внутри #tab-city: openPanel() снимает
         * hidden и добавляет `.in`, closePanel() снимает `.in` (hidden ставит
         * через 260 мс). Наблюдаем атрибуты самой панели, поэтому ловим и
         * кнопку «Выйти», и Esc, и любые другие пути закрытия.
         */
        watchBuildingClose(from) {
            if (PocketCity._closeWatch) {
                try { PocketCity._closeWatch(); } catch (e) {}
                PocketCity._closeWatch = null;
            }
            const room = document.querySelector('#tab-city .cy-room');
            if (!room) return;

            let timer = 0;
            let observer = null;
            let done = false;
            const isOpen = () => !!(room.isConnected && !room.hidden && room.classList.contains('in'));
            const cleanup = () => {
                if (observer) { observer.disconnect(); observer = null; }
                if (timer) { clearTimeout(timer); timer = 0; }
                if (PocketCity._closeWatch === cleanup) PocketCity._closeWatch = null;
            };
            const finish = () => {
                if (done) return;
                done = true;
                cleanup();
                PocketCity.restoreAfterBuilding(from);
            };
            const check = () => {
                if (done) return;
                if (!room.isConnected) { finish(); return; }
                if (isOpen()) {
                    // Панель открыта (или уже открыли другое здание) — ждём дальше.
                    if (timer) { clearTimeout(timer); timer = 0; }
                    return;
                }
                if (timer) return;
                timer = setTimeout(() => {
                    timer = 0;
                    if (done) return;
                    if (isOpen()) return; // успели открыть другое здание
                    finish();
                }, PocketCity.RETURN_DELAY_MS);
            };

            try {
                observer = new MutationObserver(check);
                observer.observe(room, { attributes: true, attributeFilter: ['hidden', 'class', 'data-b'] });
            } catch (e) {
                dbg('Не удалось отследить закрытие здания:', e);
                return;
            }
            PocketCity._closeWatch = cleanup;
            check();
        },
        /**
         * Возврат после закрытия здания (v11.6.4d).
         *
         * Шахта: оверлей `.mn` всё это время лежал под панелью, поэтому вкладку
         * не трогаем — иначе «В город» из шахты (LGCity.wake) перестанет будить
         * город. Возвращаем нативный чат LGChatOne в шахту и гасим городской
         * слой через LGCity.sleep() — ровно так это делает openMine().
         *
         * Обычная вкладка: кликаем её кнопку — это штатный tab() игры.
         * window.tab в игре НЕ глобальный, поэтому клик надёжнее вызова.
         */
        restoreAfterBuilding(from) {
            if (!from) return;
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;

            if (from.inMine && PocketCity.isMineOpen()) {
                // LGCity.open() перевешивает общий чат в root города, из-за чего
                // после возврата в шахту он оставался под оверлеем. Dock('mine')
                // делает шахту последней сценой и возвращает блок на место.
                if (typeof Chat !== 'undefined' && typeof Chat.showForMine === 'function') {
                    try { Chat.showForMine(); } catch (e) { dbg('Чат шахты не вернулся:', e); }
                }
                const city = pageWin.LGCity;
                // Гасим городской слой только пока игра всё ещё на вкладке
                // «Город» (шахта всегда лежит поверх неё). Иначе не мешаем.
                if (PocketCity.activeTabId() === 'city' && city && typeof city.sleep === 'function') {
                    try { city.sleep(); } catch (e) { dbg('LGCity.sleep после здания:', e); }
                }
                dbg('Здание закрыто — вернулись в шахту.');
                return;
            }

            // Шахту успели закрыть (или её не было) — возвращаем вкладку игры.
            const want = String(from.tab || '');
            if (!want || want === 'city') return;
            // Игрок уже сам переключился — не перебиваем его выбор.
            if (PocketCity.activeTabId() !== 'city') return;
            const btn = document.querySelector(`.tabs button[data-tab="${want}"]`);
            if (btn && !btn.hidden) {
                try { btn.click(); } catch (e) { dbg(`Возврат на вкладку «${want}» не сработал:`, e); }
            }
        },
        async openNativeBuilding(roomId) {
            dbg(`Открытие нативного здания «${roomId}»...`);

            // Игровые объекты (LGCity / __lgQuestContext / cityFiles) живут
            // в page-context: после @grant window — песочница, поэтому берём
            // unsafeWindow (G), как это уже делается в chat.js.
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;

            // 0. Запоминаем, откуда пришли (v11.6.4d), чтобы вернуться туда же
            // после закрытия здания. Шахта — оверлей `.mn`, а не вкладка,
            // поэтому она фиксируется отдельным флагом.
            const returnTo = { inMine: PocketCity.isMineOpen(), tab: PocketCity.activeTabId() };

            // 1. Обходим cityLocked (блокировку похода).
            // Шахту намеренно НЕ закрываем: она остаётся открытой под окном
            // здания (как у конкурента), иначе игрока выбрасывало из промысла.
            if (pageWin.__lgQuestContext && typeof pageWin.__lgQuestContext.openTown === 'function') {
                try { pageWin.__lgQuestContext.openTown('fair'); } catch (e) {}
            }

            // 2. Если игра когда-нибудь вынесет cityFiles в page-context —
            // догрузим скрипты сами. Сейчас это локальная функция app.js,
            // поэтому обычно ветка не срабатывает: загрузку запускает клик
            // по вкладке «Город» ниже.
            if (!pageWin.LGCity && typeof pageWin.cityFiles === 'function') {
                try { await pageWin.cityFiles(); } catch (e) {}
            }

            // 3. Принудительно переключаем вкладку на Город
            const cityTabBtn = document.querySelector('.tabs button[data-tab="city"]');
            if (cityTabBtn) {
                cityTabBtn.hidden = false;
                cityTabBtn.removeAttribute('aria-disabled');
                cityTabBtn.classList.remove('tab-lock');
                try { cityTabBtn.click(); } catch (e) {}
            }

            document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-city'));
            document.querySelectorAll('.tabs button').forEach(b => {
                const tab = b.dataset?.tab || b.getAttribute?.('data-tab');
                if (tab === 'city') b.setAttribute('aria-current', 'page');
                else b.removeAttribute('aria-current');
            });

            // 4. Ждём появления LGCity: city.js грузится лениво первым кликом.
            if (!(await PocketCity.waitFor(() => !!pageWin.LGCity, PocketCity.CITY_LOAD_TIMEOUT_MS))) {
                dbg('LGCity не появился вовремя.');
                UI.showToast('Не удалось загрузить модуль города', true);
                return;
            }

            // 5. Ждём готовности города: LGCity.open(el, CX) строит S и .cy-room.
            // До этого panel()/room() — no-op, поэтому первый клик и терялся.
            if (!(await PocketCity.waitFor(() => PocketCity.isCityReady(pageWin), PocketCity.CITY_READY_TIMEOUT_MS))) {
                dbg('Город не загрузился вовремя.');
                UI.showToast('Город не загрузился вовремя', true);
                return;
            }

            // 6. Открываем здание нативным методом. openBuilding — на случай,
            // если игра добавит такой API; сейчас есть panel()/room()
            // (мгновенный openPanel) и goBuilding() (с подходом героя).
            const city = pageWin.LGCity;
            for (const method of ['openBuilding', 'panel', 'room', 'goBuilding']) {
                if (typeof city[method] !== 'function') continue;
                let opened = false;
                try {
                    city[method](roomId);
                    opened = true;
                } catch (err) {
                    dbg(`LGCity.${method}('${roomId}') не сработал:`, err);
                }
                if (!opened) continue;
                dbg(`Здание «${roomId}» открыто через LGCity.${method}()`);
                // Ждём закрытия панели (v11.6.4d) и возвращаем вкладку/шахту.
                PocketCity.watchBuildingClose(returnTo);
                return;
            }

            UI.showToast('Не удалось открыть здание', true);
        }
    };
