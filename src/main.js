    // ============================================================
    // ТОЧКА ВХОДА (src/main.js)
    //
    // Все зависимости лежат в общем IIFE-скоупе сборки, импортов нет
    // (build.js просто конкатенирует файлы в описанном ниже порядке):
    //   core/constants.js    -> G, DEBUG, dbg, RAND_ID, DOM_IDS, API_BASE, Utils={}, randomDelay
    //   core/utils-format.js -> Utils.calculateMedian / formatMoney / parseCoinsText / formatCoinsHtml / formatTimeLeft
    //   core/utils-api.js    -> Utils.apiPath / fetchApi
    //   core/utils-art.js    -> Utils.getItemArtSvg / getItemArtHtml / getItemName / getItemIcon + декор UI
    //   core/utils-chat.js   -> Utils.chatHash / extractChatFields / extractChatDeep / updateOnlinePlayers / processIncomingDMs
    //   core/styles.js -> STYLES
    //   core/hooks.js  -> перехватчики LGCity / LGAuction / LGQuest / LGMine
    //   core/ui-templates.js -> UITemplates (HTML: FAB-меню, модалки, HUD)
    //   core/ui.js     -> UI
    //   modules/*      -> BuildSim, HeroPlanner, Auction, Players, PriestAssistant,
    //                     PocketCity, Performance, Chat
    // ============================================================

    // 5.3. Защита от повторного запуска (single-instance guard)
    // Page-context ссылка: при @grant window — песочница, а консоль и другие
    // скрипты видят только unsafeWindow.
    const LG_ROOT = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    if (LG_ROOT.__LEGION__?._booted) {
        try { LG_ROOT.__LEGION__.shutdown?.(); } catch (e) {}
    }

    // ============================================================
    // 8. ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    function boot() {
        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);

        const fabWrap = document.createElement('div');
        fabWrap.className = DOM_IDS.fabWrap;
        fabWrap.id = DOM_IDS.fabWrap;
        // Вся разметка FAB-меню и круглой кнопки — в core/ui-templates.js
        // (v11.6.0, этап 3): main.js только подставляет id и версию скрипта.
        fabWrap.innerHTML = UITemplates.fabMenu(typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '11.5.3', DOM_IDS);
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

        // 🏰 Карманный город — модуль (modules/pocket-city.js), не UI.
        (document.getElementById(DOM_IDS.btnPocketCity) || document.getElementById('btn-pocket-city'))?.addEventListener('click', () => PocketCity.open());
        (document.getElementById(DOM_IDS.btnProfile) || document.getElementById('btn-profile'))?.addEventListener('click', () => UI.togglePlayerHud());

        // ⚙️ Настройки (7TV, перехват чата) вынесены в отдельную модалку:
        // FAB-меню стало короче, а служебные переключатели больше не мешают кнопкам.
        // Кнопку «Вынести чат» (PiP) привязывает Chat.init(): второй слушатель
        // здесь давал двойной вызов popoutChat() и мигающее окно.
        document.getElementById('btn-fab-settings')?.addEventListener('click', () => UI.openSettings());

        // 🧹 Чистка журнала событий (modules/performance.js): opt-in, состояние
        // в localStorage (LG_PERF_CLEANUP). Удаляет только старые li.jr-e,
        // FPS и глобальные анимации игры не трогает.
        document.getElementById('btn-perf-cleanup')?.addEventListener('click', () => {
            Performance.toggle();
        });

        // Чекбокс «Отключить перехват чата» переехал в UI.openSettings()
        // (модалка), поэтому старая привязка к DOM_IDS.chkChatDisable удалена.

        Miner.init();
        BuildSim.init();        // без кнопки — регистрирует только глобальный клик для .sim-card
        HeroPlanner.init();     // кнопка FAB ведёт сюда
        PriestAssistant.init(); // HUD Жреца в Походе (window.__lgQuestContext)
        Auction.init();
        Players.init();
        Chat.init();
        Performance.init();     // 🧹 Чистка журнала событий (только если включена в меню)

        Chat.interceptEventSource();
        Chat.interceptWebSocket();
        Chat.interceptFetch();
        // Слушаем живой поток всегда (нужно для непрочитанных при закрытом виджете)
        if (!Chat.disabled) {
            Chat.startBackgroundLiveListener();
        }

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
            PriestAssistant,
            PocketCity,
            Performance,
            Chat,
            DOM_IDS,
            RAND_ID,
            _booted: true,
            shutdown: () => {
                PriestAssistant.destroy();
                if (Players._badgeTimer) {
                    clearInterval(Players._badgeTimer);
                    Players._badgeTimer = null;
                }
                if (Miner.abortController) {
                    try { Miner.abortController.abort(); } catch(e) {}
                    Miner.abortController = null;
                }
                Miner.stopMining();
                if (UI._hudTimer) {
                    clearInterval(UI._hudTimer);
                    UI._hudTimer = null;
                }
                // Чистка журнала: гасим таймер напрямую, без Performance.disable() —
                // тот зовёт UI.showToast, а при shutdown тост не нужен
                // (так же поступаем с Players._badgeTimer выше).
                if (Performance._interval) {
                    clearInterval(Performance._interval);
                    Performance._interval = null;
                }
                if (Chat._popoutWin) {
                    try { Chat._popoutWin.close(); } catch(e) {}
                    Chat._popoutWin = null;
                }
                Chat.stopBackgroundLiveListener();
                document.querySelectorAll('.' + DOM_IDS.customModal + ', .sim-card, .' + DOM_IDS.chatWidget + ', .float-btns, .' + DOM_IDS.fabWrap + ', #' + DOM_IDS.playerHud + ', .' + DOM_IDS.hudLog + ', #' + DOM_IDS.hudLog + ', .hud-log, .custom-modal, .chat-widget, .legion-fab-wrap, #legion-player-hud').forEach(el => el.remove());
                legionApi._booted = false;
            }
        };

        // Публикуем API в page-context: при @grant песочница скрывает window от
        // консоли и других скриптов, unsafeWindow — нет. Дублируем в window, чтобы
        // внутренние ссылки (hooks.js) работали в обоих режимах.
        try { LG_ROOT.__LEGION__ = legionApi; } catch (e) {}
        try { window.__LEGION__ = legionApi; } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
