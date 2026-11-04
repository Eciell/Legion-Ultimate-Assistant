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
                        <button class="fab-menu-item" id="${d.btnParty}">🎉 Пати</button>
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
         * id элементов (#player-hud-hp / -money / -loc / -xp-text / -xp-bar /
         * -close-btn) читают интервал обновления и обработчик закрытия в core/ui.js.
         *
         * @param {string} name      ник игрока (экранируется)
         * @param {string} className название класса (экранируется)
         * @param {number} level     уровень
         * @param {object|string} hp { now, max } либо готовое здоровье
         * @param {number} money     монеты (форматируется Utils.formatMoney)
         * @param {object|string} loc { text, color } либо готовый текст локации
         * @param {number} xp        опыт, набранный в текущем уровне (xpInLevel)
         * @param {number} xpNext    сколько опыта нужно до следующего уровня (xpToNext)
         * @param {object} extra     дополнительные блоки HUD (v11.5.6):
         *   settings { showLoc, showXp, showStats, showBuffs } — что показывать;
         *   stats    { atk, mag, def, crit }                 — базовые статы;
         *   buffs    [{ icon, title, time, until }]          — еда / свиток;
         *   status   { text, color } | null                  — мёртв / занят.
         */
        playerHud(name, className, level, hp, money, loc, xp = 0, xpNext = 1, extra = {}) {
            const safeName = Utils.escapeHtml(name || 'Игрок');
            const safeClass = Utils.escapeHtml(className || '—');

            // Настройки отображения: без extra (старые вызовы) показываем всё.
            const s = extra.settings || {};
            const showLoc = s.showLoc !== false;
            const showXp = s.showXp !== false;
            const showStats = s.showStats !== false;
            const showBuffs = s.showBuffs !== false;

            // hp приходит либо парой { now, max }, либо готовой строкой/числом.
            const hpNow = (hp && typeof hp === 'object') ? (hp.now ?? '—') : (hp ?? '—');
            const hpMax = (hp && typeof hp === 'object') ? hp.max : null;
            const hpStr = (hpMax !== null && hpMax !== undefined) ? `${hpNow} / ${hpMax}` : hpNow;

            const locText = (loc && typeof loc === 'object') ? (loc.text || '🏙️ Город') : (loc || '🏙️ Город');
            const locColor = (loc && typeof loc === 'object' && loc.color) ? loc.color : '#8fd3ff';
            const moneyVal = Utils.formatMoney(money);

            // Прогресс уровня в процентах: xp / xpNext.
            // Math.max(1, …) защищает от деления на ноль (xpToNext бывает 0/undefined),
            // 100 — потолок полосы (на максимуме уровня опыт может «перелиться»).
            const xpPct = Math.min(100, Math.round((xp / Math.max(1, xpNext)) * 100));

            // Статус героя (мёртв / в бою / призрак) — бейдж в шапке карточки.
            // Цвет приходит из UI; всё, что не похоже на hex, отбрасываем,
            // чтобы в style не попала произвольная строка.
            const status = extra.status || null;
            const statusColor = (status && /^#[0-9a-fA-F]{3,8}$/.test(status.color || '')) ? status.color : '#ff5a7a';
            const statusHtml = (status && status.text)
                ? `<span id="player-hud-status" style="font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(255,90,122,0.12); border:1px solid ${statusColor}; color:${statusColor}; white-space:nowrap;">${Utils.escapeHtml(status.text)}</span>`
                : '';

            // Базовые статы. Number(...) — безопасный способ вставить числа
            // в innerHTML: строка с разметкой превратится в NaN, а затем в 0.
            let statsHtml = '';
            if (showStats && extra.stats) {
                const st = extra.stats;
                const atk = Number(st.atk) || 0;
                const mag = Number(st.mag) || 0;
                const def = Number(st.def) || 0;
                const crit = Number(st.crit) || 0;
                const cells = [];
                if (atk) cells.push(`<div style="color:#ffcf6a;">⚔️ Атака: ${atk}</div>`);
                if (mag) cells.push(`<div style="color:#b06bff;">✨ Магия: ${mag}</div>`);
                if (def) cells.push(`<div style="color:#4aa3ff;">🛡️ Броня: ${def}</div>`);
                if (crit) cells.push(`<div style="color:#ff5a7a;">💥 Крит: ${crit}%</div>`);
                if (cells.length) {
                    statsHtml = `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:11px; background:#16121a; padding:6px; border-radius:4px; margin-top:4px;">${cells.join('')}</div>`;
                }
            }

            // Активные эффекты (🍗 сытость / 📜 свиток). data-until и data-icon
            // читает интервал в core/ui.js: он тикает таймер каждую секунду,
            // не перерисовывая карточку целиком (иначе сбивался бы drag).
            let buffsHtml = '';
            if (showBuffs && Array.isArray(extra.buffs) && extra.buffs.length) {
                const chips = extra.buffs.map(b => {
                    const icon = Utils.escapeHtml(b.icon || '✨');
                    const title = Utils.escapeHtml(b.title || '');
                    const time = Utils.escapeHtml(b.time || '');
                    const until = Number(b.until) || 0;
                    return `<span data-until="${until}" data-icon="${icon}" style="background:rgba(202,165,92,0.2); border:1px solid #caa55c; color:#ffcf6a; font-size:10px; padding:2px 6px; border-radius:4px;" title="${title}">${icon} ${time}</span>`;
                });
                buffsHtml = `<div id="player-hud-buffs" style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">${chips.join('')}</div>`;
            }

            // Локация и полоса опыта прячутся настройками (v11.5.6).
            // id #player-hud-loc / -xp-* по-прежнему читает интервал обновления.
            const locHtml = showLoc
                ? `<div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                        <span style="color:#aaa;">📍 Локация:</span>
                        <span id="player-hud-loc" style="color:${Utils.escapeHtml(locColor)}; font-weight:bold;">${Utils.escapeHtml(locText)}</span>
                    </div>`
                : '';

            const xpHtml = showXp
                ? `<!-- Полоса опыта -->
                    <div style="margin-top: 4px;">
                        <div style="display:flex; justify-content:space-between; font-size:10px; color:#aaa; margin-bottom:3px;">
                            <span>Опыт</span>
                            <span id="player-hud-xp-text">${xp} / ${xpNext}</span>
                        </div>
                        <div style="height:8px; background:#111; border-radius:4px; overflow:hidden; border:1px solid #333;">
                            <div id="player-hud-xp-bar" style="height:100%; width:${xpPct}%; background:linear-gradient(90deg, #caa55c, #ffcf6a); transition: width 0.3s;"></div>
                        </div>
                    </div>`
                : '';

            return `
                <div class="player-hud-header" id="player-hud-drag-handle">
                    <span style="font-weight:bold; color:#ffcf6a; font-size:12px; display:flex; align-items:center; gap:4px; min-width:0;">
                        <span>👤</span> <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${safeName}</span>
                    </span>
                    <span style="display:flex; align-items:center; gap:6px;">
                        ${statusHtml}
                        <button class="player-hud-close" id="player-hud-settings-btn" title="Настройки профиля" style="color:#caa55c;">⚙️</button>
                        <button class="player-hud-close" id="player-hud-close-btn" title="Закрыть">✖</button>
                    </span>
                </div>
                <div class="player-hud-body" style="padding: 10px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                        <span style="color:#aaa;">Класс:</span>
                        <span style="color:#f7d794; font-weight:bold;">${safeClass} (ур. ${level})</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                        <span style="color:#aaa;">❤️ HP:</span>
                        <span id="player-hud-hp" style="color:#ff5a7a; font-weight:bold;">${hpStr}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                        <span style="color:#aaa;">🪙 Монеты:</span>
                        <span id="player-hud-money" style="color:#ffcf6a; font-weight:bold;">${moneyVal}</span>
                    </div>
                    ${locHtml}
                    ${statsHtml}
                    ${buffsHtml}
                    ${xpHtml}
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
        },

        /**
         * Модалка настроек HUD «👤 Профиль» (v11.5.6): какие блоки показывать.
         * Кнопку «Сохранить» (#hud-set-save) обрабатывает core/ui.js —
         * он же пишет выбор в localStorage (ключ LEGION_HUD_SETTINGS).
         *
         * @param {object} settings { showLoc, showXp, showStats, showBuffs }
         */
        hudSettingsModal(settings) {
            const s = settings || {};
            return `
                <h2>⚙️ Настройки Профиля <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="padding: 10px; display: flex; flex-direction: column; gap: 12px;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-loc" ${s.showLoc ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> 📍 Локация
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-xp" ${s.showXp ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> 📊 Опыт (полоса)
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-stats" ${s.showStats ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> ⚔️ Базовые статы (Атака, Магия, Броня)
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-buffs" ${s.showBuffs ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> 🍗 Активные эффекты (еда/свитки)
                    </label>
                    <button id="hud-set-save" style="margin-top:10px; background:#caa55c; color:#1d1620; border:none; border-radius:6px; padding:10px; font-weight:bold; cursor:pointer;">Сохранить</button>
                </div>
            `;
        }
    };
