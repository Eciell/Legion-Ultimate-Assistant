    // ============================================================
    // ТОЧКА ВХОДА (src/main.js)
    //
    // Все зависимости лежат в общем IIFE-скоупе сборки, импортов нет
    // (build.js просто конкатенирует файлы в описанном ниже порядке):
    //   core/utils.js  -> DEBUG, dbg, RAND_ID, DOM_IDS, API_BASE, Utils, randomDelay
    //   core/styles.js -> STYLES
    //   core/hooks.js  -> G (перехватчики LGCity / LGAuction / LGQuest / LGMine)
    //   core/ui.js     -> UI
    //   modules/*      -> BuildSim, HeroPlanner, Auction, Players, PriestAssistant, Miner, Chat
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
        fabWrap.innerHTML = `
            <div class="${DOM_IDS.fabMenu}" id="${DOM_IDS.fabMenu}" style="max-height: calc(100vh - 100px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: #caa55c transparent;">
                <!-- БЛОК: Инструменты (сворачиваемый) -->
                <div class="fab-section" data-section="tools">
                    <div class="fab-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#888; text-transform:uppercase; padding:4px 8px; user-select:none;">
                        <span>🛠 Инструменты</span>
                        <span class="fab-arrow" style="font-size:16px; color:#caa55c; font-weight:bold; line-height:1;">▼</span>
                    </div>
                    <div class="fab-section-body">
                        <button class="fab-menu-item" id="${DOM_IDS.btnAutoMine}">⛏️ Умная Шахта (Выкл)</button>
                        <button class="fab-menu-item" id="${DOM_IDS.btnBuildSim}">⚙️ Планировщик Героя</button>
                        <button class="fab-menu-item" id="${DOM_IDS.btnAuctionScan}">🔍 Сканер Аукциона</button>
                        <button class="fab-menu-item" id="${DOM_IDS.btnPocketCity}">🏰 Карманный Город</button>
                        <button class="fab-menu-item" id="btn-priest-panel">✨ Панель Жреца</button>
                    </div>
                </div>

                <!-- БЛОК: Социальное (сворачиваемый) -->
                <div class="fab-section" data-section="social">
                    <div class="fab-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#888; text-transform:uppercase; padding:4px 8px; user-select:none;">
                        <span>👥 Социальное</span>
                        <span class="fab-arrow" style="font-size:16px; color:#caa55c; font-weight:bold; line-height:1;">▼</span>
                    </div>
                    <div class="fab-section-body">
                        <button class="fab-menu-item" id="${DOM_IDS.btnPlayers}">👥 Игроки (Разведка)</button>
                        <button class="fab-menu-item" id="${DOM_IDS.btnFriends}">🤝 Друзья <span id="${DOM_IDS.friendsBadge}" style="display:none; background:#28a745; color:#fff; font-size:11px; padding:1px 6px; border-radius:10px; font-weight:bold; margin-left:auto;">0</span></button>
                        <button class="fab-menu-item" id="${DOM_IDS.btnPopout}">📺 Вынести чат <span class="${DOM_IDS.chatBadge}" id="${DOM_IDS.chatBadge}">0</span></button>
                    </div>
                </div>

                <!-- БЛОК: Прочее (сворачиваемый) -->
                <div class="fab-section" data-section="settings">
                    <div class="fab-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#888; text-transform:uppercase; padding:4px 8px; user-select:none;">
                        <span>⚙️ Прочее</span>
                        <span class="fab-arrow" style="font-size:16px; color:#caa55c; font-weight:bold; line-height:1;">▼</span>
                    </div>
                    <div class="fab-section-body">
                        <button class="fab-menu-item" id="${DOM_IDS.btnProfile}">👤 Профиль</button>
                        <button class="fab-menu-item" id="btn-fab-settings">⚙️ Настройки</button>
                    </div>
                </div>

                <!-- ФУТЕР -->
                <div id="${DOM_IDS.externalChatStatus}" style="font-size:11px; text-align:center; padding:5px; color:#888; margin-top:4px;">Проверка внешнего чата...</div>
                <div style="text-align:center; font-size:10px; color:#888; margin-top:8px; padding-top:8px; border-top:1px solid #333; user-select:none;">
                    Version: ${typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '11.5.3'}
                </div>
            </div>
            <div class="${DOM_IDS.fabBtn}" id="${DOM_IDS.fabBtn}" title="Меню Legion">
                <span id="${DOM_IDS.fabIcon}">🐱</span>
                <span class="${DOM_IDS.chatBadge}" id="${DOM_IDS.fabChatBadge}">0</span>
            </div>
        `;
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

        (document.getElementById(DOM_IDS.btnPocketCity) || document.getElementById('btn-pocket-city'))?.addEventListener('click', () => UI.openPocketCity());
        (document.getElementById(DOM_IDS.btnProfile) || document.getElementById('btn-profile'))?.addEventListener('click', () => UI.togglePlayerHud());

        // ⚙️ Настройки (Стелс, 7TV, перехват чата) вынесены в отдельную модалку:
        // FAB-меню стало короче, а служебные переключатели больше не мешают кнопкам.
        document.getElementById('btn-fab-settings')?.addEventListener('click', () => UI.openSettings());

        (document.getElementById(DOM_IDS.btnPopout) || document.getElementById('btn-popout') || document.getElementById('btn-chat-pip'))?.addEventListener('click', () => Chat.popoutChat());

        // Чекбокс «Отключить перехват чата» переехал в UI.openSettings()
        // (модалка), поэтому старая привязка к DOM_IDS.chkChatDisable удалена.

        Miner.init();
        BuildSim.init();        // без кнопки — регистрирует только глобальный клик для .sim-card
        HeroPlanner.init();     // кнопка FAB ведёт сюда
        PriestAssistant.init(); // HUD Жреца в Походе (window.__lgQuestContext)
        Auction.init();
        Players.init();
        Chat.init();

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
            Miner,
            BuildSim,
            HeroPlanner,
            Auction,
            Players,
            PriestAssistant,
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
