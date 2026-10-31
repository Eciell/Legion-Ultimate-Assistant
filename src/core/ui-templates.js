    // ============================================================
    // 2.0. HTML-ШАБЛОНЫ UI (core/ui-templates.js)
    //
    // Единственное место, где живёт разметка FAB-меню, модалок и HUD.
    // Вызывающий код (main.js, core/ui.js, modules/pocket-city.js) получает
    // готовую строку для innerHTML / UI.showModal().
    // Логика (обработчики, запросы, состояние) остаётся на месте: шаблоны —
    // чистые функции от переданных данных, побочных эффектов нет.
    //
    // Подключается между core/hooks.js и core/ui.js (см. CORE_ORDER):
    // UITemplates нужен UI.openSettings()/UI.togglePlayerHud() по вызову,
    // поэтому TDZ-порядок должен держать его строго перед ui.js.
    // ============================================================
    const UITemplates = {
        /**
         * Разметка FAB-обёртки: сворачиваемое меню из трёх секций + круглая
         * кнопка. Возвращается именно innerHTML для div.legion-fab-wrap.
         *
         * @param {string} version версия аддона для футера (GM_info.script.version)
         * @param {object} ids     DOM_IDS (id/классы с рандомным префиксом RAND_ID)
         */
        fabMenu(version, ids) {
            // Фолбэк версии — текущая версия сборки (релиз 11.6.0 будет
            // после завершения всех этапов рефакторинга).
            const v = version || '11.5.3';
            const d = ids || DOM_IDS;
            return `
            <div class="${d.fabMenu}" id="${d.fabMenu}" style="max-height: calc(100vh - 100px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: #caa55c transparent;">
                <!-- БЛОК: Инструменты (сворачиваемый) -->
                <div class="fab-section" data-section="tools">
                    <div class="fab-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#888; text-transform:uppercase; padding:4px 8px; user-select:none;">
                        <span>🛠 Инструменты</span>
                        <span class="fab-arrow" style="font-size:16px; color:#caa55c; font-weight:bold; line-height:1;">▼</span>
                    </div>
                    <div class="fab-section-body">
                        <button class="fab-menu-item" id="${d.btnAutoMine}">⛏️ Умная Шахта (Выкл)</button>
                        <button class="fab-menu-item" id="${d.btnBuildSim}">⚙️ Планировщик Героя</button>
                        <button class="fab-menu-item" id="${d.btnAuctionScan}">🔍 Сканер Аукциона</button>
                        <button class="fab-menu-item" id="${d.btnPocketCity}">🏰 Карманный Город</button>
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
                        <button class="fab-menu-item" id="${d.btnPlayers}">👥 Игроки (Разведка)</button>
                        <button class="fab-menu-item" id="${d.btnFriends}">🤝 Друзья <span id="${d.friendsBadge}" style="display:none; background:#28a745; color:#fff; font-size:11px; padding:1px 6px; border-radius:10px; font-weight:bold; margin-left:auto;">0</span></button>
                        <button class="fab-menu-item" id="${d.btnPopout}">📺 Вынести чат <span class="${d.chatBadge}" id="${d.chatBadge}">0</span></button>
                    </div>
                </div>

                <!-- БЛОК: Прочее (сворачиваемый) -->
                <div class="fab-section" data-section="settings">
                    <div class="fab-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#888; text-transform:uppercase; padding:4px 8px; user-select:none;">
                        <span>⚙️ Прочее</span>
                        <span class="fab-arrow" style="font-size:16px; color:#caa55c; font-weight:bold; line-height:1;">▼</span>
                    </div>
                    <div class="fab-section-body">
                        <button class="fab-menu-item" id="${d.btnProfile}">👤 Профиль</button>
                        <button class="fab-menu-item" id="btn-fab-settings">⚙️ Настройки</button>
                    </div>
                </div>

                <!-- ФУТЕР -->
                <div id="${d.externalChatStatus}" style="font-size:11px; text-align:center; padding:5px; color:#888; margin-top:4px;">Проверка внешнего чата...</div>
                <div style="text-align:center; font-size:10px; color:#888; margin-top:8px; padding-top:8px; border-top:1px solid #333; user-select:none;">
                    Version: ${v}
                </div>
            </div>
            <div class="${d.fabBtn}" id="${d.fabBtn}" title="Меню Legion">
                <span id="${d.fabIcon}">🐱</span>
                <span class="${d.chatBadge}" id="${d.fabChatBadge}">0</span>
            </div>
        `;
        },

        /**
         * Модалка служебных настроек аддона (открывается из FAB-меню).
         * Обработчики кнопок навешивает UI.openSettings().
         *
         * @param {boolean} chatDisabled перехват чата отключён
         */
        settingsModal(chatDisabled) {
            return `
                <h2>⚙️ Настройки аддона <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="display:flex; flex-direction:column; gap:15px; padding:10px;">
                    <button id="modal-7tv-btn" style="width:100%; padding:10px; background:#2a2030; border:1px solid #caa55c; color:#ffcf6a; border-radius:6px; cursor:pointer; text-align:left;">🎭 Настройки канала 7TV</button>
                    <label style="display:flex; justify-content:space-between; align-items:center; background:#1e1724; padding:10px; border-radius:6px; cursor:pointer;">
                        <span>🚫 Отключить перехват чата</span>
                        <input type="checkbox" id="modal-chk-chat" style="width:16px; height:16px; accent-color:#ff5a7a;" ${chatDisabled ? 'checked' : ''}>
                    </label>
                </div>
            `;
        },

        /**
         * Карточка профиля игрока (HUD «👤 Профиль»).
         * id элементов (#player-hud-hp / -money / -loc / -close-btn) читает
         * интервал обновления и обработчик закрытия в core/ui.js.
         *
         * @param {string} name      ник игрока (экранируется)
         * @param {string} className название класса (экранируется)
         * @param {number} level     уровень
         * @param {object|string} hp { now, max } либо готовый текст здоровья
         * @param {number} money     монеты (форматируется Utils.formatMoney)
         * @param {object|string} loc { text, color } либо готовый текст локации
         */
        playerHud(name, className, level, hp, money, loc) {
            const hpText = (hp && typeof hp === 'object')
                ? `${hp.now ?? '—'} / ${hp.max ?? '—'}`
                : (hp ?? '—');
            const locText = (loc && typeof loc === 'object') ? (loc.text || '🏙️ Город') : (loc || '🏙️ Город');
            const locColor = (loc && typeof loc === 'object' && loc.color) ? loc.color : '#8fd3ff';
            return `
                <div class="player-hud-header" id="player-hud-drag-handle">
                    <span style="font-weight:bold; color:#ffcf6a; font-size:12px; display:flex; align-items:center; gap:4px;">
                        <span>👤</span> <span>${Utils.escapeHtml(name || 'Игрок')}</span>
                    </span>
                    <button class="player-hud-close" id="player-hud-close-btn" title="Закрыть">✖</button>
                </div>
                <div class="player-hud-body">
                    <div class="player-hud-row">
                        <span class="player-hud-label">Класс:</span>
                        <span class="player-hud-val" style="color:#f7d794;">${Utils.escapeHtml(className)} (ур. ${level})</span>
                    </div>
                    <div class="player-hud-row">
                        <span class="player-hud-label">Здоровье:</span>
                        <span class="player-hud-val" id="player-hud-hp" style="color:#ff5a7a;">❤️ ${hpText}</span>
                    </div>
                    <div class="player-hud-row">
                        <span class="player-hud-label">Монеты:</span>
                        <span class="player-hud-val" id="player-hud-money" style="color:#ffcf6a;">🪙 ${Utils.formatMoney(money)}</span>
                    </div>
                    <div class="player-hud-row">
                        <span class="player-hud-label">Локация:</span>
                        <span class="player-hud-val" id="player-hud-loc" style="color:${locColor};">${locText}</span>
                    </div>
                </div>
            `;
        },

        // Заглушка HUD до ответа /api/me (показывается в момент открытия).
        playerHudLoading() {
            return `
                    <div class="player-hud-header" id="player-hud-drag-handle">
                        <span style="font-weight:bold; color:#ffcf6a; font-size:12px;">👤 Профиль</span>
                        <button class="player-hud-close" id="player-hud-close-btn" title="Закрыть">✖</button>
                    </div>
                    <div class="player-hud-body" style="text-align:center; color:#aaa; padding:15px 10px;">
                        Загрузка профиля...
                    </div>
                `;
        },

        /**
         * Модалка «🏰 Карманный Город»: сетка кнопок-зданий.
         * Обработчики (hover + клик по data-room) навешивает PocketCity.open().
         */
        pocketCityModal() {
            return `
                <h2>🏰 Карманный Город <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="font-size:13px; color:#aaa; margin-bottom:15px; text-align:center;">
                    Прямой доступ к официальным зданиям игры из любой локации:
                </div>
                <!-- minmax(120px): 7 карточек-зданий укладываются в один ряд при ширине окна 1200px -->
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:12px; margin-bottom:10px;">
                    <button class="pocket-grid-btn" data-room="auction" style="padding:16px 10px; background:#1b2838; border:2px solid #335577; border-radius:10px; color:#8fd3ff; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">🏛️</span>
                        <span>Аукцион</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Рынок</small>
                    </button>
                    <button class="pocket-grid-btn" data-room="shop" style="padding:16px 10px; background:#1b3824; border:2px solid #2d663e; border-radius:10px; color:#78e08f; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">🏪</span>
                        <span>Лавка</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Магазин NPC</small>
                    </button>
                    <button class="pocket-grid-btn" data-room="anvil" style="padding:16px 10px; background:#381e3a; border:2px solid #663366; border-radius:10px; color:#f3a683; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">🔨</span>
                        <span>Заточка</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Наковальня / Ремонт</small>
                    </button>
                    <button class="pocket-grid-btn" data-room="trainer" style="padding:16px 10px; background:#3a351e; border:2px solid #665b2d; border-radius:10px; color:#f7d794; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">🎓</span>
                        <span>Тренер</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Дерево навыков</small>
                    </button>
                    <button class="pocket-grid-btn" data-room="storage" style="padding:16px 10px; background:#292929; border:2px solid #555; border-radius:10px; color:#e0e0e0; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">📦</span>
                        <span>Склад</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Банк / Сундук</small>
                    </button>
                    <button class="pocket-grid-btn" data-room="forge" style="padding:16px 10px; background:#3a1a14; border:2px solid #663322; border-radius:10px; color:#ff9977; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">⚔️</span>
                        <span>Кузня</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Оружие и броня</small>
                    </button>
                    <button class="pocket-grid-btn" data-room="magic" style="padding:16px 10px; background:#1a1a38; border:2px solid #333366; border-radius:10px; color:#aaaaff; font-weight:bold; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; transition:all 0.2s;">
                        <span style="font-size:32px;">🔮</span>
                        <span>Звездочёт</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Зелья/Свитки</small>
                    </button>
                </div>
            `;
        }
    };
