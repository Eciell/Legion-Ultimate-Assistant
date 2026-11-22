// ============================================================
// 6.5. МОДУЛЬ: КАРМАННЫЙ ГОРОД (modules/pocket-city.js)
// ============================================================
const PocketCity = (() => {
    const G = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

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

        // ---------------- 11.7.0: автоскип боёв с монстрами ----------------
        // Окно `.cm-dlg` — бой с обычным или элитным монстром. Работаем
        // только нативными кликами по кнопкам интерфейса: сетевых запросов
        // нет, window.fetch / LGMine не патчатся, поход и арена не трогаются.
        MONSTER_SKIP_CLICK_DELAY_MS: 100,
        _monsterObserver: null,
        _monsterRaf: 0,
        // Отложенные клики: гасятся в stopMonsterAutoSkip() / destroy().
        _monsterTimers: new Set(),

        // ---------------- 11.7.0: сборы гильдии на элитных монстров ----------------
        // Фоновый опрос POST /api/citymon/act { op: 'elist' }: ищем чужое
        // открытое лобби, в котором игрок ещё не состоит, и показываем
        // плавающее уведомление с кнопкой «Присоединиться» (op: 'ejoin').
        // Всё через Utils.fetchApi (контекст игры либо обычный fetch);
        // window.fetch / LGMine не патчатся.
        CITYMON_POLL_MS: 18000,
        // 429 / rate_limited у игры общий на все API — после отказа молчим
        // минуту, иначе опрос сам себя загонит в новый лимит.
        CITYMON_PAUSE_MS: 60000,
        CITYMON_TICK_MS: 1000,
        _citymonPollTimer: null,
        _citymonTickTimer: null,
        _citymonBusy: false,
        _citymonPausedUntil: 0,
        _citymonLobby: null,
        // id лобби, скрытые игроком вручную (кнопка «✕») — до перезагрузки.
        _citymonDismissed: new Set(),
        _citymonEl: null,
        _citymonVisibility: null,

        // Модалка со списком зданий: карточка -> нативное здание игры.
        open() {
            // Модалку берём из возврата showModal: её класс — с рандомным
            // префиксом (DOM_IDS.customModal), поэтому поиск
            // `.custom-modal:last-of-type` по документу ненадёжен.
            //
            // v11.6.6f: доступность гильдии считаем ДО рендера — карточка
            // «Гильдия» сразу рисуется в финальном состоянии, без мигания
            // «активна -> недоступна» после ответа /api/me.
            const guildLocked = PocketCity.isGuildLocked();
            const modal = UI.showModal(UITemplates.pocketCityModal(guildLocked));
            if (!modal) return;

            // Обработчики вешаем только на кнопки этой модалки: раньше поиск
            // шёл по всему документу и мог зацепить чужие .pocket-grid-btn.
            modal.querySelectorAll('.pocket-grid-btn').forEach(btn => {
                // Серая карточка «Гильдия» не должна «подпрыгивать» на hover.
                if (btn.getAttribute('aria-disabled') !== 'true') {
                    btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-3px)'; btn.style.boxShadow = '0 6px 15px rgba(0,0,0,0.5)'; });
                    btn.addEventListener('mouseleave', () => { btn.style.transform = 'none'; btn.style.boxShadow = 'none'; });
                }
                btn.addEventListener('click', (e) => {
                    const el = e.currentTarget;
                    const room = el.getAttribute('data-room');
                    // Недоступную карточку гасим через aria-disabled, а не
                    // disabled: disabled-кнопка не присылает клик, и игрок не
                    // поймёт, почему карточка не реагирует. Здесь — тост.
                    if (el.getAttribute('aria-disabled') === 'true') {
                        UI.showToast('Гильдия пока недоступна вашему герою', true);
                        return;
                    }
                    UI.closeModals();
                    if (room) PocketCity.openBuilding(room);
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
                // 11.7.0: возврат нативного чата шахты (Chat.showForMine())
                // удалён вместе с подсистемой чата — LGChatOne игра вешает сама.
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
        /**
         * Роутер карточек Карманного Города (v11.6.6f).
         *
         * «guild» — окно гильдий альянса (LGGuilds), всё остальное — нативные
         * здания города через openNativeBuilding().
         */
        openBuilding(roomId) {
            if (roomId === 'guild') return PocketCity.openGuild();
            return PocketCity.openNativeBuilding(roomId);
        },
        /**
         * Окно гильдий альянса из Карманного Города (v11.6.6f).
         *
         * Гильдии живут не в городе, а в отдельном модуле игры
         * (site/guilds.js -> window.LGGuilds), поэтому городской конвейер
         * (вкладка «Город», LGCity.panel, ожидание .cy-room) здесь не нужен:
         * окно открывается из любой локации. Кнопка «Гильдия» в игровом HUD
         * (#gu-hud [data-gu="guild"]) делает ровно то же самое:
         * LGGuilds.open({ big: true }).
         */
        openGuild() {
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;

            // 1. Нативный API модуля гильдий — основной путь.
            const guilds = pageWin.LGGuilds;
            if (guilds && typeof guilds.open === 'function') {
                try {
                    guilds.open({ big: true });
                    dbg('Гильдии открыты через LGGuilds.open()');
                    return;
                } catch (e) {
                    // Не падаем: у игры бывают версии, где окно ещё не готово.
                    dbg('LGGuilds.open() не сработал:', e);
                }
            }

            // 2. Фолбэк — клик по нативной кнопке входа. Их две:
            //    #gu-hud [data-gu="guild"] — шапка игры (app.js);
            //    .cy-hud .gl-entry — вход, который guilds.js сам дорисовывает
            //    в шапку города (есть только на вкладке «Город»).
            const btn = document.querySelector('#gu-hud [data-gu="guild"], .cy-hud .gl-entry');
            if (btn) {
                try {
                    btn.click();
                    dbg('Гильдии открыты кликом по нативной кнопке');
                    return;
                } catch (e) {
                    dbg('Клик по нативной кнопке гильдий не сработал:', e);
                }
            }

            UI.showToast('Окно гильдии недоступно', true);
        },
        /**
         * Недоступна ли гильдия герою (v11.6.6f).
         *
         * Флаг доступа держит сама игра: app.js (guOn) пускает в игровое меню
         * только при ME.user && ME.hero.gu && ME.hero.cy. Берём именно gu —
         * это флаг гильдий. Флаг города cy намеренно НЕ дублируем: в тюрьме и
         * во время похода город закрыт, но окно гильдий у игрока всё равно
         * должно открываться.
         *
         * Пока /api/me не пришёл (нет ME/hero) или поля gu нет вовсе
         * (undefined/null — флаг переименовали или убрали), считаем гильдию
         * доступной: иначе карточка была бы серой у всех подряд. Гасим только
         * явный «ноль»: false или 0.
         */
        isGuildLocked() {
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const me = pageWin.ME;
            const hero = me && me.hero;
            if (!hero || hero.gu == null) return false;
            return !hero.gu;
        },
        async openNativeBuilding(roomId) {
            dbg(`Открытие нативного здания «${roomId}»...`);

            // Игровые объекты (LGCity / __lgQuestContext / cityFiles) живут
            // в page-context: после @grant window — песочница, поэтому берём
            // unsafeWindow (G), как это уже делается в main.js.
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
        },

        // ============================================================
        // 6.5.x. АВТОСКИП БОЁВ С МОНСТРАМИ (v11.7.0)
        //
        // Тумблер «⏭️ Автоскип боёв с монстрами» в «⚙️ Настройках аддона»
        // (ключ localStorage 'LEGION_AUTO_SKIP_MONSTERS', реестр Settings
        // в core/constants.js). Работает только через нативный клик по
        // кнопкам окна `.cm-dlg`: никаких запросов, перехватов LGMine и
        // патчей window.fetch. Поход и арена не затрагиваются.
        // ============================================================

        /**
         * Включение автоскипа. Идемпотентно: повторный вызов не создаёт
         * второй MutationObserver (например, если открыть настройки дважды).
         */
        startMonsterAutoSkip() {
            if (PocketCity._monsterObserver) return true;
            if (typeof MutationObserver !== 'function' || !document.body) return false;

            const observer = new MutationObserver(() => PocketCity.scheduleMonsterSkip());
            // childList + subtree: окно .cm-dlg вставляется в body целиком, а
            // его кнопки дорисовываются позже. attributes/disabled нужен,
            // чтобы поймать момент, когда кнопка перестала быть disabled.
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['disabled'],
            });
            PocketCity._monsterObserver = observer;

            // После «выкл → вкл» метки могли остаться на кнопках живого
            // диалога: без сброса проход уже не нажал бы «Пропустить».
            document.querySelectorAll('.cm-dlg [data-lgu-skipped]').forEach(el => {
                try { delete el.dataset.lguSkipped; } catch (e) {}
            });

            // Окно боя могло быть открыто ещё до включения тумблера —
            // мутации в этом случае не будет, проверяем сразу.
            PocketCity.scheduleMonsterSkip();
            dbg('Автоскип боёв с монстрами включён.');
            return true;
        },

        /**
         * Выключение автоскипа: снимаем наблюдатель, отменяем кадр и все
         * отложенные клики, чтобы после переключения тумблера ничего не нажалось.
         */
        stopMonsterAutoSkip() {
            if (PocketCity._monsterObserver) {
                try { PocketCity._monsterObserver.disconnect(); } catch (e) {}
                PocketCity._monsterObserver = null;
            }
            if (PocketCity._monsterRaf) {
                if (typeof cancelAnimationFrame === 'function') {
                    try { cancelAnimationFrame(PocketCity._monsterRaf); } catch (e) {}
                }
                clearTimeout(PocketCity._monsterRaf);
                PocketCity._monsterRaf = 0;
            }
            PocketCity._monsterTimers.forEach(timer => clearTimeout(timer));
            PocketCity._monsterTimers.clear();
            dbg('Автоскип боёв с монстрами выключен.');
        },

        /**
         * Троттлинг MutationObserver: в городе и бою мутации идут пачками,
         * поэтому один проход на кадр (requestAnimationFrame), лишние
         * вызовы склеиваются в один.
         */
        scheduleMonsterSkip() {
            if (!PocketCity._monsterObserver || PocketCity._monsterRaf) return;
            const run = () => {
                PocketCity._monsterRaf = 0;
                PocketCity.trySkipMonsterFight();
            };
            PocketCity._monsterRaf = (typeof requestAnimationFrame === 'function')
                ? requestAnimationFrame(run)
                : setTimeout(run, 16);
        },

        /**
         * Один проход по открытому окну боя с монстром.
         *
         * Порядок проверок:
         *   1) button[data-all] — «Пропустить всё»: полный скип цепочки
         *      элитного монстра (когда цепочка кончилась, кнопки нет);
         *   2) .cm-fight button[data-sp="skip"] — «Пропустить» одиночного боя.
         *
         * data-lguSkipped защищает от повторного клика, пока игра не закрыла
         * диалог: MutationObserver успевает вызвать проход несколько раз.
         */
        trySkipMonsterFight() {
            const dlg = document.querySelector('.cm-dlg');
            if (!dlg) return;

            let btn = dlg.querySelector('button[data-all]:not([disabled])');
            if (!btn) btn = dlg.querySelector('.cm-fight button[data-sp="skip"]:not([disabled])');
            if (!btn || btn.dataset.lguSkipped) return;

            btn.dataset.lguSkipped = '1';
            // 100 мс: клиент игры вешает обработчик click уже после рендера
            // диалога, поэтому мгновенный click() уходил бы в пустоту.
            const timer = setTimeout(() => {
                PocketCity._monsterTimers.delete(timer);
                // За эту задержку диалог мог закрыться — кликаем только
                // живую и всё ещё активную кнопку.
                if (btn.isConnected && !btn.disabled) {
                    try {
                        btn.click();
                        dbg('Автоскип: нажата кнопка пропуска боя.');
                    } catch (e) {
                        dbg('Автоскип: клик не прошёл:', e);
                    }
                }
            }, PocketCity.MONSTER_SKIP_CLICK_DELAY_MS);
            PocketCity._monsterTimers.add(timer);
        },

        // ============================================================
        // 6.5.y. СБОРЫ ГИЛЬДИИ НА ЭЛИТНЫХ МОНСТРОВ (v11.7.0)
        //
        // Раньше баннер «Идёт сбор в поход» жил в боевом ассистенте и
        // реагировал на q.gather — то есть только когда игрок уже в походе.
        // Теперь уведомление относится к сборам гильдии на элитных монстров
        // и работает из любой локации: опрос POST /api/citymon/act
        // { op: 'elist' } раз в 18 с, вступление — { op: 'ejoin', id }.
        // Никаких патчей window.fetch / LGMine: только Utils.fetchApi.
        // ============================================================

        /**
         * Доступен ли раздел элитных монстров:
         * v11.7.0: надёжный резолв через unsafeWindow/window и LG/ME.
         * Опрос запускается для любого авторизованного героя сразу после
         * загрузки страницы либо при наличии игровых модулей LGCityMon/LGGuilds
         * при условии, что настройка citymonGatherEnabled включена (по умолчанию false).
         */
        canWatchCityMon() {
            if (typeof Settings !== 'undefined' && !Settings.get('citymonGatherEnabled')) return false;
            const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
            const lg = win.LG || window.LG;
            const hero = (typeof lg?.hero === 'function' ? lg.hero() : null)
                || (typeof lg?.me === 'function' ? lg.me()?.hero : null)
                || win.ME?.hero;
            if (hero && typeof hero === 'object' && Object.keys(hero).length > 0) return true;
            return Boolean(win.LGCityMon || win.LGGuilds);
        },

        /**
         * Запуск фонового мониторинга (init() из main.js). Идемпотентно:
         * повторный вызов не плодит второй интервал и слушатель вкладки.
         */
        startCityMonWatch() {
            if (PocketCity._citymonPollTimer) return;
            PocketCity._citymonVisibility = () => {
                // Вернулись на вкладку — не ждём очередные 18 секунд.
                if (!document.hidden) PocketCity.pollCityMonLobbies();
            };
            document.addEventListener('visibilitychange', PocketCity._citymonVisibility);
            PocketCity._citymonPollTimer = setInterval(() => PocketCity.pollCityMonLobbies(), PocketCity.CITYMON_POLL_MS);
            // Первая проверка сразу: сбор мог идти ещё до запуска аддона.
            PocketCity.pollCityMonLobbies();
        },

        /** Остановка мониторинга: интервалы, слушатель вкладки, баннер, DOM. */
        stopCityMonWatch() {
            if (PocketCity._citymonPollTimer) {
                clearInterval(PocketCity._citymonPollTimer);
                PocketCity._citymonPollTimer = null;
            }
            if (PocketCity._citymonVisibility) {
                document.removeEventListener('visibilitychange', PocketCity._citymonVisibility);
                PocketCity._citymonVisibility = null;
            }
            PocketCity.hideCityMonGather();
            if (PocketCity._citymonEl) {
                try { PocketCity._citymonEl.remove(); } catch (e) {}
                PocketCity._citymonEl = null;
            }
            PocketCity._citymonPausedUntil = 0;
            PocketCity._citymonBusy = false;
        },

        /** 429 / rate_limited — общий лимит API игры, значит пауза. */
        isCityMonRateLimited(res) {
            if (!res) return false;
            if (res.status === 429) return true;
            const code = res.error || (res.body && (res.body.error || res.body.err));
            return code === 'rate_limited';
        },

        /**
         * Один цикл опроса elist.
         *
         * @param {boolean} force переопрос после ejoin/ошибки: игнорирует
         *   паузу по 429, но не скрытую вкладку и не отсутствие доступа
         */
        async pollCityMonLobbies(force = false) {
            // Свёрнутая вкладка — не опрашиваем (условие ТЗ 11.7.0).
            if (document.hidden) return;
            if (typeof Settings !== 'undefined' && !Settings.get('citymonGatherEnabled')) {
                PocketCity.hideCityMonGather();
                return;
            }
            if (!PocketCity.canWatchCityMon()) {
                PocketCity.hideCityMonGather();
                return;
            }
            if (PocketCity._citymonBusy) return;
            if (!force && Date.now() < PocketCity._citymonPausedUntil) return;

            PocketCity._citymonBusy = true;
            const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
            let res = null;
            try {
                if (typeof Utils !== 'undefined' && typeof Utils.fetchApi === 'function') {
                    res = await Utils.fetchApi('/api/citymon/act', { op: 'elist' });
                } else if (typeof win.fetch === 'function') {
                    const url = (win.LG_BASE || '') + '/api/citymon/act';
                    const r = await win.fetch(url, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ op: 'elist' })
                    });
                    const d = await r.json().catch(() => null);
                    res = { ok: r.ok && (d ? d.ok !== false : true), status: r.status, body: d, data: d, ...(d && typeof d === 'object' && !Array.isArray(d) ? d : {}) };
                }
            } catch (e) {
                dbg('citymon elist error:', e);
            } finally {
                PocketCity._citymonBusy = false;
            }

            if (PocketCity.isCityMonRateLimited(res)) {
                PocketCity._citymonPausedUntil = Date.now() + PocketCity.CITYMON_PAUSE_MS;
                dbg('citymon: 429/rate_limited — пауза 60 с');
                return;
            }

            const data = (res && typeof res === 'object') ? (res.body || res.data || res) : {};
            const isOk = Boolean(res?.ok ?? data?.ok);
            if (!res || !isOk) return; // сеть/сервер: баннер не трогаем

            // v11.7.0: игрок не состоит в гильдии — пауза на 5 минут,
            // чтобы не делать лишних запросов для игроков без гильдии.
            // res.guild может быть объектом { gid, name } при наличии гильдии.
            const guild = res.guild !== undefined ? res.guild : (data.guild !== undefined ? data.guild : undefined);
            const isNoGuild = guild === false || guild === null || (guild && typeof guild === 'object' && 'gid' in guild && !guild.gid);
            if (isNoGuild) {
                this._citymonPausedUntil = Date.now() + 300000;
                PocketCity._citymonPausedUntil = this._citymonPausedUntil;
                PocketCity.hideCityMonGather();
                return;
            }

            const lobby = PocketCity.findCityMonLobby(res);
            if (lobby) PocketCity.showCityMonGather(lobby);
            else PocketCity.hideCityMonGather();
        },

        /**
         * Первое подходящее открытое лобби: не моё, не истекло, есть места,
         * игрок не скрывал его вручную (✕).
         *
         * @param {object} res ответ /api/citymon/act: { ok, mine, list[] }
         * @returns {object|null} лобби L из list
         */
        findCityMonLobby(res) {
            if (!res) return null;
            const data = (res && typeof res === 'object') ? (res.body || res.data || res) : {};
            if (res.mine || data.mine) return null; // уже состою в каком-то сборе
            const list = Array.isArray(res.list) ? res.list : (Array.isArray(data.list) ? data.list : []);
            const now = Date.now();
            for (const L of list) {
                if (!L || L.st !== 'open' || L.mine) continue;
                if (PocketCity._citymonDismissed.has(L.id)) continue;
                // v11.7.0: until может приходить в секундах (< 1e12) или миллисекундах
                const untilMs = (L.until && +L.until < 1e12) ? +L.until * 1000 : (+L.until || 0);
                if (untilMs <= now) continue;
                const members = Array.isArray(L.members) ? L.members.length : 0;
                if (members >= (+L.max || 5)) continue;
                return L;
            }
            return null;
        },

        /**
         * v11.7.0: применение класса размера плашки уведомления (S / M / L).
         */
        applyGatherSize(size) {
            const s = (size || (typeof Settings !== 'undefined' ? Settings.get('citymonGatherSize') : null) || 'L').toLowerCase();
            const el = PocketCity._citymonEl || document.getElementById('lg-citymon-gather');
            if (el) {
                el.classList.remove('lg-cm-size-s', 'lg-cm-size-m', 'lg-cm-size-l');
                el.classList.add(`lg-cm-size-${s}`);
            }
        },

        /**
         * init() из boot() в main.js: поднимаем автоскип, если тумблер был
         * включён в прошлой сессии (настройка хранится в localStorage),
         * и запускаем фоновый мониторинг сборов на элитных монстров (если включено).
         */
        init() {
            if (Settings.get('autoSkipMonsters')) PocketCity.startMonsterAutoSkip();
            if (Settings.get('citymonGatherEnabled')) PocketCity.startCityMonWatch();
        },

        /**
         * Плавающее уведомление о чужом сборе (плашка в стиле аддона).
         *
         * Перерисовываем только при смене лобби: у того же L.id текст
         * подписи обновляет секундный тик, кнопки остаются живыми (иначе
         * слетала бы блокировка «Вступаем...» и фокус).
         */
        showCityMonGather(lobby) {
            if (!lobby || !document.body) return;
            const esc = (s) => (typeof Utils !== 'undefined' && Utils.escapeHtml ? Utils.escapeHtml(s) : String(s == null ? '' : s));

            let el = PocketCity._citymonEl;
            if (!el || !el.isConnected) {
                el = document.createElement('div');
                el.id = 'lg-citymon-gather';
                document.body.appendChild(el);
                PocketCity._citymonEl = el;
            }
            el.classList.add('on');
            PocketCity.applyGatherSize();

            const sameLobby = !!PocketCity._citymonLobby && PocketCity._citymonLobby.id === lobby.id;
            PocketCity._citymonLobby = lobby;

            if (sameLobby && el.querySelector('.lg-cm-gather')) {
                PocketCity.updateCityMonCaption();
                return;
            }

            el.innerHTML = `
                <div class="lg-cm-gather">
                    <div class="lg-cm-gather-head">📯 Сбор на элитного: ${esc(lobby.name)} (ур. ${esc(lobby.lvl == null ? '?' : lobby.lvl)}${lobby.tier ? ' ☠' : ''})</div>
                    <div class="lg-cm-gather-sub"></div>
                    <div class="lg-cm-gather-row">
                        <button type="button" class="lg-cm-gather-join">Присоединиться</button>
                        <button type="button" class="lg-cm-gather-close" title="Скрыть уведомление">✕</button>
                    </div>
                </div>
            `;

            const joinBtn = el.querySelector('.lg-cm-gather-join');
            if (joinBtn) joinBtn.addEventListener('click', () => PocketCity.joinCityMonLobby(joinBtn));

            const closeBtn = el.querySelector('.lg-cm-gather-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    const cur = PocketCity._citymonLobby;
                    // Скрываем точечно: остальные сборы продолжат всплывать.
                    if (cur && cur.id != null) PocketCity._citymonDismissed.add(cur.id);
                    PocketCity.hideCityMonGather();
                });
            }

            PocketCity.updateCityMonCaption();
            // Живой обратный отсчёт: правим только текст подписи.
            if (!PocketCity._citymonTickTimer) {
                PocketCity._citymonTickTimer = setInterval(() => PocketCity.updateCityMonCaption(), PocketCity.CITYMON_TICK_MS);
            }
        },

        /** Подпись баннера: состав, лидер и MM:SS до конца сбора. */
        cityMonCaption(lobby) {
            const L = lobby || PocketCity._citymonLobby;
            if (!L) return '';
            const members = Array.isArray(L.members) ? L.members.length : 0;
            const max = +L.max || 5;
            const untilMs = (L.until && +L.until < 1e12) ? +L.until * 1000 : (+L.until || 0);
            const left = Math.max(0, untilMs - Date.now());
            // ceil: на последней секунде показываем 00:01, а не 00:00 раньше времени.
            const total = Math.ceil(left / 1000);
            const mm = String(Math.floor(total / 60)).padStart(2, '0');
            const ss = String(total % 60).padStart(2, '0');
            return `Отряд: ${members}/${max} · Лидер: ${L.leader || '—'} · ${mm}:${ss}`;
        },

        /** Обновляет только текст подписи (кнопки и их состояние не трогаем). */
        updateCityMonCaption() {
            const el = PocketCity._citymonEl;
            if (!el) return;
            const sub = el.querySelector('.lg-cm-gather-sub');
            if (!sub) return;
            sub.textContent = PocketCity.cityMonCaption();
        },

        /** Прячет плашку и гасит секундный отсчёт (лобби забываем). */
        hideCityMonGather() {
            PocketCity._citymonLobby = null;
            if (PocketCity._citymonTickTimer) {
                clearInterval(PocketCity._citymonTickTimer);
                PocketCity._citymonTickTimer = null;
            }
            const el = PocketCity._citymonEl;
            if (!el) return;
            el.classList.remove('on');
            el.innerHTML = '';
        },

        /**
         * Вступление в сбор: POST /api/citymon/act { op: 'ejoin', id }.
         *
         * Кнопка блокируется на время запроса («Вступаем...»), результат —
         * тостом. В обоих случаях список перечитываем (elist): после успеха
         * своё лобби уже mine, после ошибки сбор мог закрыться/заполниться.
         */
        async joinCityMonLobby(btn) {
            if (!btn || btn.disabled) return;
            const lobby = PocketCity._citymonLobby;
            if (!lobby) return;

            const label = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Вступаем...';

            const toast = (msg, isError) => {
                if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(msg, !!isError);
            };

            const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
            let res = null;
            try {
                if (typeof Utils !== 'undefined' && typeof Utils.fetchApi === 'function') {
                    res = await Utils.fetchApi('/api/citymon/act', { op: 'ejoin', id: lobby.id });
                } else if (typeof win.fetch === 'function') {
                    const url = (win.LG_BASE || '') + '/api/citymon/act';
                    const r = await win.fetch(url, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ op: 'ejoin', id: lobby.id })
                    });
                    const d = await r.json().catch(() => null);
                    res = { ok: r.ok && (d ? d.ok !== false : true), status: r.status, body: d, data: d, ...(d && typeof d === 'object' && !Array.isArray(d) ? d : {}) };
                }
            } catch (e) {
                dbg('citymon ejoin error:', e);
            }

            const data = (res && typeof res === 'object') ? (res.body || res.data || res) : {};
            const isOk = Boolean(res?.ok ?? data?.ok);

            if (res && isOk) {
                toast(`Вы вступили в сбор на «${lobby.name}»!`, false);
                // Плашку гасим сразу, а список перечитываем — возможно,
                // открылся следующий сбор.
                PocketCity.hideCityMonGather();
                PocketCity.pollCityMonLobbies(true);
                return;
            }

            if (PocketCity.isCityMonRateLimited(res)) {
                PocketCity._citymonPausedUntil = Date.now() + PocketCity.CITYMON_PAUSE_MS;
            }
            const errText = (res && (res.error || (res.body && (res.body.error || res.body.err)) || (res.data && (res.data.error || res.data.err)))) || '';
            toast(errText || 'Не удалось вступить', true);

            // Пока шёл запрос, плашку могли скрыть/перерисовать.
            if (btn.isConnected) {
                btn.disabled = false;
                btn.textContent = label || 'Присоединиться';
            }
            PocketCity.pollCityMonLobbies(true);
        },

        /**
         * destroy() из shutdown() в main.js: снимаем наблюдатель и таймеры,
         * иначе старый инстанс кликал бы по кнопкам после перезапуска скрипта.
         * v11.7.0: заодно гасим мониторинг сборов на элитных монстров.
         */
        destroy() {
            PocketCity.stopMonsterAutoSkip();
            PocketCity.stopCityMonWatch();
            if (PocketCity._closeWatch) {
                try { PocketCity._closeWatch(); } catch (e) {}
                PocketCity._closeWatch = null;
            }
        }
    };

    return PocketCity;
})();
