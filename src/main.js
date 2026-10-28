    // ============================================================
    // ТОЧКА ВХОДА (src/main.js)
    //
    // Все зависимости лежат в общем IIFE-скоупе сборки, импортов нет
    // (build.js просто конкатенирует файлы в описанном ниже порядке):
    //   core/utils.js  -> DEBUG, dbg, RAND_ID, DOM_IDS, API_BASE, Utils, randomDelay
    //   core/styles.js -> STYLES
    //   core/hooks.js  -> G (перехватчики LGCity / LGAuction / LGQuest / LGMine)
    //   core/ui.js     -> UI
    //   modules/*      -> BuildSim, HeroPlanner, Auction, Players, Miner, Chat
    // ============================================================

    // 5.3. Защита от повторного запуска (single-instance guard)
    if (window.__LEGION__?._booted) {
        try { window.__LEGION__.shutdown?.(); } catch (e) {}
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
            <div class="${DOM_IDS.fabMenu}" id="${DOM_IDS.fabMenu}">
                <button class="fab-menu-item" id="${DOM_IDS.btnAutoMine}">⛏️ Умная Шахта (Выкл)</button>
                <button class="fab-menu-item" id="${DOM_IDS.btnBuildSim}">⚙️ Планировщик Героя</button>
                <button class="fab-menu-item" id="${DOM_IDS.btnAuctionScan}">🔍 Сканер Аукциона</button>
                <button class="fab-menu-item" id="${DOM_IDS.btnPlayers}">👥 Игроки (Разведка)</button>
                <button class="fab-menu-item" id="${DOM_IDS.btnFriends}">🤝 Друзья <span id="${DOM_IDS.friendsBadge}" style="display:none; background:#28a745; color:#fff; font-size:11px; padding:1px 6px; border-radius:10px; font-weight:bold; margin-left:auto;">0</span></button>
                <button class="fab-menu-item" id="${DOM_IDS.btnChatToggle}">💬 Чат Города <span class="${DOM_IDS.chatBadge}" id="${DOM_IDS.chatBadge}">0</span></button>
                <button class="fab-menu-item" id="${DOM_IDS.btnPopout}">📺 Вынести чат</button>
                <button class="fab-menu-item" id="${DOM_IDS.btnPocketCity}">🏰 Карманный Город</button>
                <button class="fab-menu-item" id="${DOM_IDS.btnProfile}">👤 Профиль</button>
                <label class="fab-menu-item" style="cursor:pointer; display:flex; align-items:center; justify-content:space-between; user-select:none; font-size:12px; gap:8px;">
                    <span>🚫 Отключить перехват чата</span>
                    <input type="checkbox" id="${DOM_IDS.chkChatDisable}" style="width:16px; height:16px; cursor:pointer; accent-color:#ff5a7a;">
                </label>
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
                fabWrap.style.left = pos.left;
                fabWrap.style.top = pos.top;
                fabWrap.style.right = 'auto';
                fabWrap.style.bottom = 'auto';
            }
        } catch(e) {}

        const fabBtn = document.getElementById(DOM_IDS.fabBtn) || document.getElementById('legion-fab-btn');
        const fabMenu = document.getElementById(DOM_IDS.fabMenu) || document.getElementById('legion-fab-menu');
        UI.setupFab(fabWrap, fabBtn, fabMenu);

        (document.getElementById(DOM_IDS.btnPocketCity) || document.getElementById('btn-pocket-city'))?.addEventListener('click', () => UI.openPocketCity());
        (document.getElementById(DOM_IDS.btnProfile) || document.getElementById('btn-profile'))?.addEventListener('click', () => UI.togglePlayerHud());

        // 🛡️ Индикатор стелс-режима (всегда включён)
        const stealthItem = document.createElement('div');
        stealthItem.className = 'fab-menu-item';
        stealthItem.style.cssText = 'cursor:default; background:rgba(0,255,102,0.08); border-color:rgba(0,255,102,0.3); color:#00ff66; font-size:11px;';
        stealthItem.innerHTML = '<span>🛡️ Стелс</span><span style="font-weight:bold;">' + (window.__lgStealthActive ? 'АКТИВЕН' : 'ОШИБКА') + '</span>';
        document.getElementById(DOM_IDS.fabMenu)?.appendChild(stealthItem);
        (document.getElementById(DOM_IDS.btnPopout) || document.getElementById('btn-popout'))?.addEventListener('click', () => Chat.popoutChat());

        const chkChat = document.getElementById(DOM_IDS.chkChatDisable);
        if (chkChat) {
            chkChat.checked = !!Chat.disabled;
            chkChat.addEventListener('change', (e) => {
                Chat.setDisabled(e.target.checked);
            });
        }

        Miner.init();
        BuildSim.init();        // без кнопки — регистрирует только глобальный клик для .sim-card
        HeroPlanner.init();     // кнопка FAB ведёт сюда
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
        window.__LEGION__ = {
            Utils,
            UI,
            Miner,
            BuildSim,
            HeroPlanner,
            Auction,
            Players,
            Chat,
            DOM_IDS,
            RAND_ID,
            _booted: true,
            shutdown: () => {
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
                window.__LEGION__._booted = false;
            }
        };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
