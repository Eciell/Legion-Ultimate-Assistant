    // ============================================================
    // ТОЧКА ВХОДА (src/main.js)
    //
    // Все зависимости лежат в общем IIFE-скоупе сборки, импортов нет
    // (build.js просто конкатенирует файлы в описанном ниже порядке):
    //   core/constants.js    -> G, DEBUG, dbg, RAND_ID, DOM_IDS, API_BASE, Utils={}, randomDelay
    //   core/utils-format.js -> Utils.calculateMedian / formatMoney / parseCoinsText / formatCoinsHtml / formatTimeLeft
    //   core/utils-api.js    -> Utils.apiPath / fetchApi
    //   core/utils-art.js    -> Utils.getItemArtSvg / getItemArtHtml / getItemName / getItemIcon + декор UI
    //   core/utils.js        -> Utils.copyText / insertToQuestChat / updateOnlinePlayers
    //   core/styles.js -> STYLES
    //   core/hooks.js  -> перехватчики LGCity / LGAuction / LGQuest
    //                     (LGMine снят в 11.6.4b — античит шахты)
    //   core/ui-templates.js -> UITemplates (HTML: FAB-меню, модалки, HUD)
    //   core/ui.js     -> UI
    //   modules/*      -> BuildSim, HeroPlanner, Auction, Players,
    //                     PocketCity, CombatAssistant, Party, Arena,
    //                     Miner (заглушка)
    // 11.7.0: подсистема чата (modules/chat/*, core/utils-chat.js) удалена.
    // ============================================================

    // 5.3. Защита от повторного запуска (single-instance guard)
    // Page-context ссылка: при @grant window — песочница, а консоль и другие
    // скрипты видят только unsafeWindow.
    const LG_ROOT = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    if (LG_ROOT.__LEGION__?._booted) {
        try { LG_ROOT.__LEGION__.shutdown?.(); } catch (e) {}
    }

    // ============================================================
    // 5.4. Проверка обновлений аддона
    //
    // До 11.7.0 жила в modules/chat/chat-net.js и удалилась вместе с чатом.
    // GET /latest-version нашего сервера открытый (без X-Legion-Key), поэтому
    // хватает GM_xmlhttpRequest. Тумблер «🔔 Уведомлять о новых версиях»
    // (localStorage LEGION_UPDATE_NOTIFY) уважается: при 'false' не шлём даже
    // запрос. Сравнение версий — по числовым сегментам (11.7.0 > 11.6.10).
    // ============================================================
    function checkAddonUpdate() {
        try {
            if (localStorage.getItem('LEGION_UPDATE_NOTIFY') === 'false') return;
        } catch (e) { return; }
        if (typeof GM_xmlhttpRequest !== 'function') return;

        const current = (typeof GM_info !== 'undefined' && GM_info.script) ? String(GM_info.script.version || '') : '';
        if (!current) return;

        let base = 'https://legion.ctrlfree.host';
        try {
            if (Party && typeof Party.getBaseUrl === 'function') base = Party.getBaseUrl();
        } catch (e) {}

        const cmp = (a, b) => {
            const A = String(a).split('.').map(Number);
            const B = String(b).split('.').map(Number);
            for (let i = 0; i < Math.max(A.length, B.length); i++) {
                const x = A[i] || 0, y = B[i] || 0;
                if (x !== y) return x - y;
            }
            return 0;
        };

        GM_xmlhttpRequest({
            method: 'GET',
            url: String(base).replace(/\/+$/, '') + '/latest-version',
            timeout: 10000,
            onload(res) {
                if (!res || res.status !== 200) return;
                let data = null;
                try { data = JSON.parse(res.responseText); } catch (e) { return; }
                const latest = String((data && data.version) || '');
                if (!latest || cmp(latest, current) <= 0) return;

                const go = () => {
                    try {
                        if (typeof GM_openInTab === 'function') GM_openInTab(data.url || '', { active: true });
                    } catch (e) {}
                };
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        title: 'Legion Ultimate Assistant',
                        text: `Доступна версия ${latest} (у вас ${current})`,
                        timeout: 15000,
                        onclick: go
                    });
                } else if (typeof UI !== 'undefined' && UI.showToast) {
                    UI.showToast(`🔔 Доступна версия ${latest}`, false, go);
                }
            }
        });
    }

    // ============================================================
    // 8. ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    function boot() {
        // 1. Защита от iframe и Document PiP.
        // window.top в кросс-доменном iframe кидает SecurityError, поэтому try/catch:
        // ошибка доступа сама по себе означает, что мы в чужом iframe.
        let isIframe = false;
        try { isIframe = window.self !== window.top; } catch (e) { isIframe = true; }

        let isPiP = false;
        try { isPiP = !!(window.documentPictureInPicture && window.documentPictureInPicture.window === window); } catch (e) { isPiP = false; }

        // 2. Защита от legion-chat-window и других вторичных контекстов.
        //   /site/ver      — служебные страницы сайта (без /c/<канал>/);
        //   ?minechat      — окно чата шахты стороннего аддона;
        //   window.name    — именованные popup-окна (lgChat у того же аддона);
        //   не /c/...      — любой путь вне страницы канала игрой не является.
        // В таких контекстах мы бы создали второй style/fabWrap — дубликат FAB-меню.
        const isLegionChat =
            location.pathname.startsWith('/site/ver') ||
            location.search.includes('minechat') ||
            window.name === 'lgChat' ||
            !location.pathname.startsWith('/c/');

        if (isIframe || isPiP || isLegionChat) {
            dbg('Скрипт запущен во вторичном контексте (iframe / PiP / legion-chat-window), инициализация отменена.');
            return;
        }

        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);

        const fabWrap = document.createElement('div');
        fabWrap.className = DOM_IDS.fabWrap;
        fabWrap.id = DOM_IDS.fabWrap;
        // Вся разметка FAB-меню и круглой кнопки — в core/ui-templates.js
        // (v11.6.0, этап 3): main.js только подставляет id и версию скрипта.
        fabWrap.innerHTML = UITemplates.fabMenu(typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '11.7.0', DOM_IDS);
        document.body.appendChild(fabWrap);

        // Восстановление позиции FAB из localStorage (§ Задача 2)
        try {
            const pos = JSON.parse(localStorage.getItem('LEGION_FAB_POS'));
            if (pos && pos.left && pos.top) {
                const leftVal = parseInt(pos.left, 10);
                const topVal = parseInt(pos.top, 10);
                const fabSize = 50;

                // Проверяем, что позиция не за пределами экрана
                if (!isNaN(leftVal) && !isNaN(topVal) && leftVal >= 0 && leftVal <= window.innerWidth - fabSize && topVal >= 0 && topVal <= window.innerHeight - fabSize) {
                    fabWrap.style.left = pos.left;
                    fabWrap.style.top = pos.top;
                    fabWrap.style.right = 'auto';
                    fabWrap.style.bottom = 'auto';
                } else {
                    // Если позиция битая (за экраном) — сбрасываем
                    localStorage.removeItem('LEGION_FAB_POS');
                }
            }
        } catch(e) {}

        const fabBtn = document.getElementById(DOM_IDS.fabBtn) || document.getElementById('legion-fab-btn');
        const fabMenu = document.getElementById(DOM_IDS.fabMenu) || document.getElementById('legion-fab-menu');
        UI.setupFab(fabWrap, fabBtn, fabMenu);

        // ============================================================
        // ПАТЧ 11.6.5g: умный вход в меню аддона.
        //
        // В городе правый нижний угол уже занят нативным баром игры
        // (#gu-hud .gu-main): вставляем туда свою кнопку «Аддон», а
        // плавающую FAB прячем, чтобы не было двух входов подряд.
        // В шахте и походе бара нет — FAB возвращается на экран.
        // ============================================================
        UI.syncNavButton();

        if (typeof MutationObserver !== 'undefined') {
            // HUD игра строит лениво (guRender -> guHud) и после выхода из
            // города оставляет узел в DOM, переключая только html.gu-city.
            // Слушаем две дешёвые цели (появление #gu-hud в body и смену
            // классов на <html> и <body>), а не subtree всего документа: в
            // городе мутаций слишком много. Повторные вызовы склеиваем в один кадр.
            // Тумблер «📌 Кнопка аддона в нижнем меню игры» проверяется внутри
            // UI.syncNavButton(): при выключенном тумблере метод снимает нативную
            // кнопку и сразу выходит, поэтому наблюдатель её обратно не вернёт.
            //
            // ПАТЧ 11.6.6g: класс body отслеживаем из-за шахты — mine.js вешает
            // `mn-on` именно на body, а html.gu-city при этом остаётся (шахта
            // лежит оверлеем поверх города) и наш syncNavButton считал бы, что
            // мы в городе. ВАЖНО: повторный observe() на том же узле не
            // дополняет, а ЗАМЕНЯЕТ опции, поэтому childList и attributes для
            // body слиты в один вызов.
            let navSyncScheduled = false;
            const scheduleNavSync = () => {
                if (navSyncScheduled) return;
                navSyncScheduled = true;
                const run = () => { navSyncScheduled = false; UI.syncNavButton(); };
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
                else setTimeout(run, 150);
            };
            const navObserver = new MutationObserver(scheduleNavSync);
            navObserver.observe(document.body, { childList: true, attributes: true, attributeFilter: ['class'] });
            navObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            UI._navObserver = navObserver;
        }

        // 🏰 Карманный город — модуль (modules/pocket-city.js), не UI.
        (document.getElementById(DOM_IDS.btnPocketCity) || document.getElementById('btn-pocket-city'))?.addEventListener('click', () => PocketCity.open());
        (document.getElementById(DOM_IDS.btnProfile) || document.getElementById('btn-profile'))?.addEventListener('click', () => UI.togglePlayerHud());

        // ⚙️ Настройки (уведомления, боевой ассистент, вход в меню) вынесены
        // в отдельную модалку: FAB-меню стало короче, а служебные
        // переключатели больше не мешают кнопкам.
        document.getElementById('btn-fab-settings')?.addEventListener('click', () => UI.openSettings());

        Miner.init();
        BuildSim.init();        // без кнопки — регистрирует только глобальный клик для .sim-card
        HeroPlanner.init();     // кнопка FAB ведёт сюда
        Auction.init();
        Players.init();
        // 🎉 Пати: кнопка в FAB-меню, клиент сервера из server/ (шаг 1).
        Party.init();
        // ⚔️ Боевой ассистент (11.6.2b): подсказки по механикам боссов в походе.
        //    Отдельного пункта меню нет — тумблер в «⚙️ Настройках аддона».
        CombatAssistant.init();
        // ⚔️ Арена 5×5: шанс победы, согильдейцы в отряде противника и
        //    вкладка «Согильдейцы» в модалке приглашения. Контекст арены
        //    приходит из хука LGArena.open (core/hooks.js), своих патчей
        //    window.fetch/LGMine модуль не делает.
        Arena.init();
        // 📊 Статистика гильдии: четвёртая вкладка в нативном окне гильдии
        //    (.gl-modal). Появляется только своему руководству/доверенным
        //    (leader/lead/officer/trusted); данные — /api/guilds/guild
        //    с кэшем в памяти, window.fetch не патчится.
        GuildSummary.init();
        // 🏰 Карманный город: init() поднимает автоскип боёв с монстрами
        //    (тумблер «⏭️ Автоскип боёв с монстрами» в настройках), если он
        //    был включён в прошлой сессии, и запускает мониторинг сборов
        //    гильдии на элитных монстров (elist/ejoin, v11.7.0).
        //    Клики — только нативные, по .cm-dlg.
        PocketCity.init();

        // 🔔 Проверка обновлений: через 8 с после старта, чтобы не мешать
        // загрузке страницы и первому рендеру аддона.
        setTimeout(checkAddonUpdate, 8000);

        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') UI.closeModals(); });

        // 5.2. Экспорт API для отладки и single-instance guard
        const legionApi = {
            Utils,
            UI,
            UITemplates,
            Miner,
            BuildSim,
            HeroPlanner,
            Auction,
            Players,
            PocketCity,
            CombatAssistant,
            Arena,
            GuildSummary,
            Party,
            DOM_IDS,
            RAND_ID,
            _booted: true,
            shutdown: () => {
                if (Miner.abortController) {
                    try { Miner.abortController.abort(); } catch(e) {}
                    Miner.abortController = null;
                }
                Miner.stopMining();
                if (UI._hudTimer) {
                    clearInterval(UI._hudTimer);
                    UI._hudTimer = null;
                }
                // ПАТЧ 11.6.5g: снимаем наблюдатель за нативным HUD, отложенный
                // повтор и ссылки на узлы меню, а из бара игры убираем свою кнопку
                // (fabWrap удаляется ниже вместе с остальной разметкой).
                if (UI._navObserver) {
                    try { UI._navObserver.disconnect(); } catch (e) {}
                    UI._navObserver = null;
                }
                if (UI._navRetryTimer) {
                    clearTimeout(UI._navRetryTimer);
                    UI._navRetryTimer = null;
                }
                UI._fabWrap = UI._fabBtn = UI._fabMenu = null;
                UI._navMode = '';
                UI._navRetries = 0;
                document.querySelectorAll('.lgu-nav-btn').forEach(el => el.remove());
                // 11.7.0: подсистемы чата больше нет — её окно PiP, лента и
                // фоновые интервалы удалены вместе с модулем, гасить нечего.
                // 11.6.2b: гасим интервал боевого ассистента и убираем его контейнер,
                // иначе после перезапуска скрипта тикали бы два таймера.
                CombatAssistant.destroy();
                // Арена: снимаем MutationObserver, чистим кэши героев/состава
                // и убираем свои бейджи и вкладку из живого DOM.
                try { Arena.destroy?.(); } catch (e) {}
                // Статистика гильдии: снимаем наблюдатель и capture-клик,
                // чистим кэш состава и убираем вкладку/панель из .gl-modal.
                try { GuildSummary.destroy?.(); } catch (e) {}
                // 11.6.3c: гасим PerformanceObserver и HP-интервал Пати — иначе
                // старый инстанс продолжал бы слушать запросы игры (/api/me,
                // /api/qact) и слать state на наш сервер после перезапуска.
                Party.destroy();
                // 11.7.0: снимаем наблюдатель автоскипа боёв с монстрами и его
                // отложенные клики, а также опрос сборов на элитных монстров
                // (elist) с плашкой «Присоединиться» — иначе старый инстанс
                // продолжал бы нажимать «Пропустить» в окне .cm-dlg и слать
                // запросы после перезапуска скрипта.
                try { PocketCity.destroy?.(); } catch (e) {}
                document.querySelectorAll('.' + DOM_IDS.customModal + ', .sim-card, .float-btns, .' + DOM_IDS.fabWrap + ', #' + DOM_IDS.playerHud + ', .custom-modal, .legion-fab-wrap, #legion-player-hud').forEach(el => el.remove());
                legionApi._booted = false;
            }
        };

        // Публикуем API в page-context: при @grant песочница скрывает window от
        // консоли и других скриптов, unsafeWindow — нет. Дублируем в window, чтобы
        // внутренние ссылки (hooks.js) работали в обоих режимах.
        // v11.7.0: также экспортируем legionApi в unsafeWindow/G для удобной отладки из консоли.
        try { LG_ROOT.__LEGION__ = legionApi; } catch (e) {}
        try { window.__LEGION__ = legionApi; } catch (e) {}
        try { LG_ROOT.legionApi = legionApi; } catch (e) {}
        try { window.legionApi = legionApi; } catch (e) {}
        try { if (typeof G !== 'undefined' && G) G.legionApi = legionApi; } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
