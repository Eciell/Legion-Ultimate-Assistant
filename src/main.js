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
    //   core/hooks.js  -> перехватчики LGCity / LGAuction / LGQuest
    //                     (LGMine снят в 11.6.4b — античит шахты)
    //   core/ui-templates.js -> UITemplates (HTML: FAB-меню, модалки, HUD)
    //   core/ui.js     -> UI
    //   modules/*      -> BuildSim, HeroPlanner, Auction, Players,
    //                     PocketCity, CombatAssistant, Party, Miner (заглушка), Chat
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

        // Чекбокс «Отключить перехват чата» переехал в UI.openSettings()
        // (модалка), поэтому старая привязка к DOM_IDS.chkChatDisable удалена.

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
        Chat.init();

        Chat.interceptEventSource();
        Chat.interceptWebSocket();
        // 11.6.4b: подмена window.fetch удалена (античит шахты палит её по
        // отсутствию [native code]). Вместо хука — пассивный PerformanceObserver:
        // ловит запросы игры к /api/me и к городу/шахте и обновляет данные
        // своими запросами, ничего не перезаписывая.
        Chat.startNetworkObserver();
        // Фоновые задачи чата: хуки нативной ленты + Keep-Alive watch (ПАТЧ 11.6.4f).
        // Идемпотентно; своего EventSource на /api/live больше нет.
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
            PocketCity,
            CombatAssistant,
            Party,
            Chat,
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
                if (Chat._popoutWin) {
                    try { Chat._popoutWin.close(); } catch(e) {}
                    Chat._popoutWin = null;
                }
                Chat.stopBackgroundLiveListener();
                // 11.6.2b: гасим интервал боевого ассистента и убираем его контейнер,
                // иначе после перезапуска скрипта тикали бы два таймера.
                CombatAssistant.destroy();
                // ТЗ 11.6.0g-3: гасим поллинг /heartbeat + /users и
                // MutationObserver нативной ленты (иначе после перезапуска
                // скрипта остались бы два интервала).
                Chat.destroy();
                // 11.6.3c: гасим PerformanceObserver и HP-интервал Пати — иначе
                // старый инстанс продолжал бы слушать запросы игры (/api/me,
                // /api/qact) и слать state на наш сервер после перезапуска.
                Party.destroy();
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
