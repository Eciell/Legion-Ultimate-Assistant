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
    /**
     * Единый набор карточек «Карманного Города»: полное окно и компактный
     * закреплённый виджет рисуют одни и те же здания, иконки и цвета.
     * Так игрок не путается при переключении между режимами.
     */
    const POCKET_CITY_ROOMS = [
        { room: 'auction', icon: '🏛️', name: 'Аукцион', hint: 'Рынок', bg: '#1b2838', border: '#335577', color: '#8fd3ff' },
        { room: 'shop', icon: '🏪', name: 'Лавка', hint: 'Магазин NPC', bg: '#1b3824', border: '#2d663e', color: '#78e08f' },
        { room: 'anvil', icon: '🔨', name: 'Заточка', hint: 'Наковальня / Ремонт', bg: '#381e3a', border: '#663366', color: '#f3a683' },
        { room: 'trainer', icon: '🎓', name: 'Тренер', hint: 'Дерево навыков', bg: '#3a351e', border: '#665b2d', color: '#f7d794' },
        { room: 'storage', icon: '📦', name: 'Склад', hint: 'Банк / Сундук', bg: '#292929', border: '#555', color: '#e0e0e0' },
        { room: 'forge', icon: '⚔️', name: 'Кузня', hint: 'Оружие и броня', bg: '#3a1a14', border: '#663322', color: '#ff9977' },
        { room: 'magic', icon: '🔮', name: 'Звездочёт', hint: 'Зелья/Свитки', bg: '#1a1a38', border: '#333366', color: '#aaaaff' },
        { room: 'guild', icon: '🛡️', name: 'Гильдия', hint: 'Альянс', bg: '#2a2140', border: '#6c4fa8', color: '#cbb6ff' }
    ];

    /**
     * Разметка кнопок-зданий. compact=true — мини-виджет закрепа:
     * те же иконки и цвета, но меньше отступы и без подписей.
     */
    const pocketCityRoomButtons = (guildLocked, compact = false) => POCKET_CITY_ROOMS.map(r => {
        const locked = r.room === 'guild' && guildLocked;
        const hint = (!compact && r.hint)
            ? `<small style="color:#8899aa; font-size:10px; font-weight:normal;">${locked ? 'Недоступно' : r.hint}</small>`
            : '';
        const pad = compact
            ? 'padding:8px 4px; gap:4px;'
            : 'padding:16px 10px; gap:8px;';
        return `<button class="pocket-grid-btn${compact ? ' pocket-grid-btn-compact' : ''}" data-room="${r.room}"${locked ? ' aria-disabled="true" title="Недоступно"' : ''} style="${pad} background:${r.bg}; border:2px solid ${r.border}; border-radius:10px; color:${r.color}; font-weight:bold; ${locked ? 'cursor:not-allowed; opacity:0.45; filter:grayscale(1);' : 'cursor:pointer;'} display:flex; flex-direction:column; align-items:center; font-size:${compact ? '10px' : '14px'}; transition:all 0.2s; min-width:0;">
            <span style="font-size:${compact ? '22px' : '32px'}; line-height:1;">${r.icon}</span>
            <span style="${compact ? 'line-height:1.15; text-align:center;' : ''}">${r.name}</span>
            ${hint}
        </button>`;
    }).join('');

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
            const v = version || '11.7.0';
            const d = ids || DOM_IDS;
            return `
            <div class="${d.fabMenu}" id="${d.fabMenu}" style="max-height: calc(100vh - 100px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: #caa55c transparent;">
                <!-- БЛОК: Инструменты (сворачиваемый) -->
                <div class="fab-section" data-section="tools">
                    <div class="fab-section-title" role="button" tabindex="0">
                        <span>🛠 Инструменты</span>
                        <span class="fab-arrow" aria-hidden="true">▼</span>
                    </div>
                    <div class="fab-section-body">
                        <button class="fab-menu-item" id="${d.btnAutoMine}">⛏️ Умная Шахта (Выкл)</button>
                        <button class="fab-menu-item" id="${d.btnBuildSim}">⚙️ Планировщик Героя</button>
                        <button class="fab-menu-item" id="${d.btnAuctionScan}">🔍 Сканер Аукциона</button>
                        <button class="fab-menu-item" id="${d.btnPocketCity}">🏰 Карманный Город</button>
                    </div>
                </div>

                <!-- БЛОК: Социальное (сворачиваемый) -->
                <div class="fab-section" data-section="social">
                    <div class="fab-section-title" role="button" tabindex="0">
                        <span>👥 Социальное</span>
                        <span class="fab-arrow" aria-hidden="true">▼</span>
                    </div>
                    <div class="fab-section-body">
                        <button class="fab-menu-item" id="${d.btnPlayers}">👥 Игроки (Разведка)</button>
                        <button class="fab-menu-item" id="${d.btnParty}">🎉 Пати</button>
                    </div>
                </div>

                <!-- БЛОК: Прочее (сворачиваемый) -->
                <div class="fab-section" data-section="settings">
                    <div class="fab-section-title" role="button" tabindex="0">
                        <span>⚙️ Прочее</span>
                        <span class="fab-arrow" aria-hidden="true">▼</span>
                    </div>
                    <div class="fab-section-body">
                        <button class="fab-menu-item" id="${d.btnProfile}">👤 Профиль</button>
                        <button class="fab-menu-item" id="btn-fab-settings">⚙️ Настройки</button>
                    </div>
                </div>

                <!-- ФУТЕР -->
                <div class="fab-footer">
                    <button type="button" class="fab-thanks-btn" id="btn-fab-thanks" title="Люди, которые помогли аддону">💛 Благодарность</button>
                    <div class="fab-version">Version: ${v}</div>
                </div>
            </div>
            <div class="${d.fabBtn}" id="${d.fabBtn}" title="Меню Legion">
                <span id="${d.fabIcon}">🐱</span>
            </div>
        `;
        },

        /**
         * Модалка служебных настроек аддона (открывается из FAB-меню).
         * Обработчики кнопок навешивает UI.openSettings().
         *
         * 11.7.0: из модалки убраны настройки чата (7TV, перехват ленты).
         * 11.7.2: подсветка ников пользователей аддона возвращена отдельным
         * лёгким модулем modules/addon-presence.js.
         */
        settingsModal() {
            return `
                <h2>⚙️ Настройки аддона <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div class="lg-settings-body">
                    <!-- СЕКЦИЯ 1: интерфейс и быстрый доступ -->
                    <div class="lg-settings-group">
                        <div class="lg-settings-group-title">🖥️ Интерфейс и быстрый доступ</div>
                        <!-- ПАТЧ 11.6.5h: куда девать вход в меню — в нативный бар
                             города или оставить плавающую FAB. Состояние ставит
                             и сохраняет UI.openSettings() (localStorage
                             'LEGION_NATIVE_FAB'), читает UI.syncNavButton(). -->
                        <div class="lg-setting-card">
                            <label class="lg-setting-row" style="cursor:pointer;">
                                <span>📌 Кнопка аддона в нижнем меню игры</span>
                                <input type="checkbox" id="modal-chk-native-fab" class="lg-toggle">
                            </label>
                            <div class="lg-setting-desc">Если выключено, кнопка аддона останется плавающей в правом нижнем углу.</div>
                        </div>
                        <!-- v11.7.2: горячая клавиша закрепа «Карманного Города».
                             Запись и сброс — UI.openSettings(); глобальный
                             keydown — PocketCity.startKeyBind(). -->
                        <div class="lg-setting-card">
                            <div class="lg-setting-row">
                                <span>⌨️ Горячая клавиша закрепа «Карманного Города»</span>
                                <div class="lg-bind-wrap">
                                    <button type="button" id="modal-bind-pocket-city" class="lg-bind-btn" title="Нажмите, затем нужную комбинацию">Не назначено</button>
                                    <button type="button" id="modal-bind-pocket-city-clear" class="lg-bind-clear" title="Сбросить комбинацию">✕</button>
                                </div>
                            </div>
                            <div class="lg-setting-desc">Нажмите на поле и введите комбинацию (например, Alt+C). Работает в любой раскладке; Esc отменяет запись.</div>
                        </div>
                        <!-- v11.7.2: горячие клавиши всех зданий Карманного Города.
                             Бинды живут одним JSON-объектом в localStorage
                             (LEGION_POCKET_CITY_ROOM_BINDS), запись — общий
                             рекордер UI.openSettings(), глобальный keydown —
                             PocketCity.startKeyBind(). -->
                        <div class="lg-setting-card">
                            <div class="lg-setting-row">
                                <span>⌨️ Горячие клавиши зданий Города</span>
                            </div>
                            <div class="lg-room-binds">
                                ${POCKET_CITY_ROOMS.map(r => `
                                    <div class="lg-room-bind-row">
                                        <span class="lg-room-bind-name" title="${Utils.escapeHtml(r.name)}">${r.icon} ${Utils.escapeHtml(r.name)}</span>
                                        <span class="lg-room-bind-controls">
                                            <button type="button" class="lg-bind-btn lg-room-bind-btn" data-room="${r.room}" title="Назначить клавишу">—</button>
                                            <button type="button" class="lg-bind-clear lg-room-bind-clear" data-room="${r.room}" title="Сбросить комбинацию">✕</button>
                                        </span>
                                    </div>`).join('')}
                            </div>
                            <div class="lg-setting-desc">Один хоткей — одно действие: при назначении занятой комбинации она снимается с прежнего здания или закрепа.</div>
                        </div>
                    </div>

                    <!-- СЕКЦИЯ 2: бой и уведомления -->
                    <div class="lg-settings-group">
                        <div class="lg-settings-group-title">⚔️ Бой и уведомления</div>
                        <!-- 11.6.2b: боевой ассистент в походах (подсказки по механикам
                             боссов). Состояние ставит и сохраняет UI.openSettings()
                             (localStorage 'LEGION_COMBAT_ASSIST'), читает каждую секунду
                             modules/combat-assistant.js. -->
                        <div class="lg-setting-card">
                            <label class="lg-setting-row" style="cursor:pointer;">
                                <span>⚔️ Боевой ассистент в походах</span>
                                <input type="checkbox" class="lg-toggle" id="modal-chk-combat-assist">
                            </label>
                        </div>
                        <!-- 11.7.0: автоскип боёв с монстрами (.cm-dlg). Состояние
                             ставит и сохраняет UI.openSettings() (Settings,
                             ключ 'LEGION_AUTO_SKIP_MONSTERS'); наблюдатель живёт
                             в modules/pocket-city.js и включается сразу. -->
                        <div class="lg-setting-card">
                            <label class="lg-setting-row" style="cursor:pointer;">
                                <span>⏭️ Автоскип боёв с монстрами</span>
                                <input type="checkbox" class="lg-toggle" id="modal-chk-auto-skip-monsters">
                            </label>
                            <div class="lg-setting-desc">Автоматически нажимает «Пропустить» / «Пропустить всё» в окне боя с обычными и элитными монстрами.</div>
                        </div>
                        <!-- 11.7.0: уведомления о сборах гильдии на элитных монстров -->
                        <div class="lg-setting-card">
                            <label class="lg-setting-row" style="cursor:pointer;">
                                <span>📯 Сборы гильдии на элитных монстров</span>
                                <input type="checkbox" class="lg-toggle" id="modal-chk-citymon-gather">
                            </label>
                            <div class="lg-setting-desc">Плавающее уведомление о чужих сборах гильдии с кнопкой «Присоединиться».</div>
                            <div class="lg-setting-row">
                                <span style="color:#bbb; font-size:11px;">Размер плашки</span>
                                <div class="lg-cm-size-picker" style="display:flex; gap:4px;">
                                    <button type="button" class="lg-cm-size-btn" data-size="S" style="background:#2a2035; border:1px solid #4a3b55; color:#bbb; border-radius:4px; padding:3px 10px; font-size:11px; font-weight:bold; cursor:pointer;">S</button>
                                    <button type="button" class="lg-cm-size-btn" data-size="M" style="background:#2a2035; border:1px solid #4a3b55; color:#bbb; border-radius:4px; padding:3px 10px; font-size:11px; font-weight:bold; cursor:pointer;">M</button>
                                    <button type="button" class="lg-cm-size-btn" data-size="L" style="background:#2a2035; border:1px solid #4a3b55; color:#bbb; border-radius:4px; padding:3px 10px; font-size:11px; font-weight:bold; cursor:pointer;">L</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- СЕКЦИЯ 3: чат и система -->
                    <div class="lg-settings-group">
                        <div class="lg-settings-group-title">💬 Чат и система</div>
                        <!-- 11.7.2: подсветка ников пользователей аддона в нативном
                             чате. Состояние хранит Settings.get/set('addonHighlight')
                             (localStorage 'LEGION_ADDON_HIGHLIGHT'), CSS генерирует
                             modules/addon-presence.js. -->
                        <div class="lg-setting-card">
                            <label class="lg-setting-row" style="cursor:pointer;">
                                <span>⚡ Подсветка ников Legion</span>
                                <input type="checkbox" class="lg-toggle" id="modal-chk-addon-hl">
                            </label>
                        </div>
                        <!-- v11.6.1g: тумблер уведомлений о новых версиях.
                             Состояние ставит и сохраняет UI.openSettings() (localStorage
                             'LEGION_UPDATE_NOTIFY'); проверка версии при выключенном
                             тумблере работает молча. -->
                        <div class="lg-setting-card">
                            <label class="lg-setting-row" style="cursor:pointer;">
                                <span>🔔 Уведомлять о новых версиях</span>
                                <input type="checkbox" class="lg-toggle" id="modal-chk-update-notify">
                            </label>
                        </div>
                    </div>
                </div>
            `;
        },

        /**
         * Модалка «💛 Благодарность» из футера FAB-меню.
         * Титры в тёмно-золотой стилистике аддона: ники выделены акцентом,
         * рядом — короткая причина благодарности. Обработчик закрытия
         * (#custom-close-btn) вешает UI.showModal().
         */
        thanksModal() {
            const people = [
                ['spector99th', 'реакции на обновлениях реально сильно умиляют, спасибо😭'],
                ['ghostiz_s6', 'регулярные баг-репорты и идеи для улучшения аддона, спасибо'],
                ['procto_fliy', 'помощь с багами и подсказки, как лучше сделать, спасибо'],
                ['b00mblch', 'идеи и баг-репорты, спасибо'],
                ['host1k', 'баг-репорты и идеи, спасибо']
            ];
            return `
                <h2>💛 Благодарность <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div class="lg-thanks">
                    <div class="lg-thanks-intro">
                        Аддон живёт и становится лучше благодаря этим людям:
                    </div>
                    <ul class="lg-thanks-list">
                        ${people.map(([nick, text]) => `
                            <li class="lg-thanks-item">
                                <span class="lg-thanks-nick">${Utils.escapeHtml(nick)}</span>
                                <span class="lg-thanks-text">${Utils.escapeHtml(text)}</span>
                            </li>`).join('')}
                    </ul>
                    <div class="lg-thanks-foot">Спасибо всем, кто пишет баг-репорты, предлагает идеи и просто поддерживает аддон ❤️</div>
                </div>
            `;
        },

        /**
         * Карточка профиля игрока (HUD «👤 Профиль»).
         * id элементов читают живое обновление и обработчики в core/ui.js:
         *   #player-hud-hp / -hp-bar / -hp-timer / -money / -debt-row / -loc /
         *   -activity / -xp-text / -xp-bar / -xp-pct / -close-btn.
         *
         * @param {string} name      ник игрока (экранируется)
         * @param {string} className название класса (экранируется)
         * @param {number} level     уровень
         * @param {object|string} hp { now, max } либо готовое здоровье
         * @param {number} money     монеты (форматируется Utils.formatMoney)
         * @param {object|string} loc { text, color } либо готовый текст локации
         * @param {number} xp        опыт, набранный в текущем уровне (xpInLevel)
         * @param {number} xpNext    сколько опыта нужно до следующего уровня (xpToNext)
         * @param {object} extra     дополнительные блоки HUD:
         *   settings { showLoc, showXp, showStats, showBuffs,
         *              showSecondary, showQuickActions } — что показывать;
         *   classColor — цвет класса из BuildSim.classColors;
         *   guild      — тег гильдии hero.gt;
         *   stats      { atk, mag, def, crit }            — базовые статы;
         *   secondary  [{ icon, label, value }]           — характеристики из hero.xs;
         *   buffs      [{ icon, title, time, until }]     — еда / свиток;
         *   status     { text, color } | null             — мёртв / занят;
         *   debt       — долг героя (медь), показывается только если > 0;
         *   hpTimer    — готовая подпись таймера восстановления HP;
         *   activity   { text, color }                    — поход / шахта;
         *   quick      { city, mail, players }             — доступность быстрых кнопок.
         */
        playerHud(name, className, level, hp, money, loc, xp = 0, xpNext = 1, extra = {}) {
            const safeName = Utils.escapeHtml(name || 'Игрок');
            const safeClass = Utils.escapeHtml(className || '—');
            const safeGuild = extra.guild ? Utils.escapeHtml(String(extra.guild)) : '';

            // Настройки отображения: без extra (старые вызовы) показываем всё.
            const s = extra.settings || {};
            const showLoc = s.showLoc !== false;
            const showXp = s.showXp !== false;
            const showStats = s.showStats !== false;
            const showBuffs = s.showBuffs !== false;
            const showSecondary = s.showSecondary !== false;
            const showQuick = s.showQuickActions !== false;

            // Цвет класса — только безопасный hex из BuildSim.classColors.
            const classColor = /^#[0-9a-fA-F]{3,8}$/.test(extra.classColor || '') ? extra.classColor : '#caa55c';

            // hp приходит либо парой { now, max }, либо готовой строкой/числом.
            const hpNow = (hp && typeof hp === 'object') ? (hp.now ?? '—') : (hp ?? '—');
            const hpMax = (hp && typeof hp === 'object') ? hp.max : null;
            const hpStr = (hpMax !== null && hpMax !== undefined) ? `${hpNow} / ${hpMax}` : hpNow;

            // Прогресс HP: цвет полосы зависит от процента (красный -> золотой -> зелёный).
            // Number.isFinite отсекает «—» и null: тогда полоса пустая, а не 100%.
            const hpNowNum = Number(hpNow);
            const hpMaxNum = Number(hpMax);
            const hpPct = (Number.isFinite(hpNowNum) && Number.isFinite(hpMaxNum) && hpMaxNum > 0)
                ? Math.max(0, Math.min(100, Math.round((hpNowNum / hpMaxNum) * 100)))
                : 0;
            const hpGradient = hpPct <= 30
                ? 'linear-gradient(90deg, #7a1f2c, #ff5a7a)'
                : hpPct <= 60
                    ? 'linear-gradient(90deg, #7a5a1f, #ffcf6a)'
                    : 'linear-gradient(90deg, #1f7a3a, #4cc95a)';

            const locText = (loc && typeof loc === 'object') ? (loc.text || '🏙️ Город') : (loc || '🏙️ Город');
            const locColor = (loc && typeof loc === 'object' && loc.color) ? loc.color : '#8fd3ff';
            const moneyVal = Utils.formatMoney(money);
            const debtVal = Number(extra.debt) || 0;

            // Прогресс уровня в процентах: xp / xpNext.
            // Math.max(1, …) защищает от деления на ноль (xpToNext бывает 0/undefined),
            // 100 — потолок полосы (на максимуме уровня опыт может «перелиться»).
            const xpPct = Math.max(0, Math.min(100, Math.floor((xp / Math.max(1, xpNext)) * 100)));

            // Статус героя (мёртв / в бою / призрак) — бейдж в шапке карточки.
            // Цвет приходит из UI; всё, что не похоже на hex, отбрасываем,
            // чтобы в style не попала произвольная строка.
            const status = extra.status || null;
            const statusColor = (status && /^#[0-9a-fA-F]{3,8}$/.test(status.color || '')) ? status.color : '#ff5a7a';
            const statusHtml = (status && status.text)
                ? `<span id="player-hud-status" class="player-hud-status" style="border-color:${statusColor}; color:${statusColor};">${Utils.escapeHtml(status.text)}</span>`
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
                if (atk) cells.push(`<div class="player-hud-stat" style="color:#ffcf6a;">⚔️ Атака<b>${atk}</b></div>`);
                if (mag) cells.push(`<div class="player-hud-stat" style="color:#b06bff;">✨ Магия<b>${mag}</b></div>`);
                if (def) cells.push(`<div class="player-hud-stat" style="color:#4aa3ff;">🛡️ Броня<b>${def}</b></div>`);
                if (crit) cells.push(`<div class="player-hud-stat" style="color:#ff5a7a;">💥 Крит<b>${crit}%</b></div>`);
                if (cells.length) {
                    statsHtml = `<div class="player-hud-stats">${cells.join('')}</div>`;
                }
            }

            // Вторичные характеристики hero.xs: показываем только значения > 0
            // (нули игроку не нужны), подписи и иконки готовит core/ui.js.
            let secondaryHtml = '';
            if (showSecondary && Array.isArray(extra.secondary) && extra.secondary.length) {
                const pills = extra.secondary.map(item => {
                    const icon = Utils.escapeHtml(item.icon || '✦');
                    const label = Utils.escapeHtml(item.label || '');
                    const value = Utils.escapeHtml(String(item.value));
                    return `<span class="player-hud-pill" title="${label}"><span class="player-hud-pill-ico">${icon}</span>${label}<b>${value}</b></span>`;
                });
                secondaryHtml = `<div id="player-hud-secondary" class="player-hud-pills">${pills.join('')}</div>`;
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
                    return `<span class="player-hud-buff" data-until="${until}" data-icon="${icon}" title="${title}">${icon} ${time}</span>`;
                });
                buffsHtml = `<div id="player-hud-buffs" class="player-hud-buffs">${chips.join('')}</div>`;
            }

            // Локация и активность (поход ql / шахта mn) прячутся настройками.
            // id #player-hud-loc / -activity по-прежнему читает живое обновление.
            const activity = extra.activity || null;
            const activityColor = (activity && /^#[0-9a-fA-F]{3,8}$/.test(activity.color || '')) ? activity.color : '#bbb';
            const locHtml = showLoc
                ? `<div class="player-hud-row">
                        <span class="player-hud-row-label">📍 Локация</span>
                        <span id="player-hud-loc" style="color:${Utils.escapeHtml(locColor)};">${Utils.escapeHtml(locText)}</span>
                    </div>
                    <div class="player-hud-row">
                        <span class="player-hud-row-label">🧭 Активность</span>
                        <span id="player-hud-activity" style="color:${activityColor};">${Utils.escapeHtml((activity && activity.text) || 'Свободен')}</span>
                    </div>`
                : '';

            const xpHtml = showXp
                ? `<div class="player-hud-bar-block">
                        <div class="player-hud-bar-head">
                            <span>📊 Опыт</span>
                            <span><span id="player-hud-xp-text">${xp} / ${xpNext}</span> <b id="player-hud-xp-pct">${xpPct}%</b></span>
                        </div>
                        <div class="player-hud-bar-track">
                            <div id="player-hud-xp-bar" class="player-hud-bar-fill" style="width:${xpPct}%; background:linear-gradient(90deg, #caa55c, #ffcf6a);"></div>
                        </div>
                    </div>`
                : '';

            const hpTimerText = extra.hpTimer ? Utils.escapeHtml(extra.hpTimer) : '';

            // Быстрые переходы: кнопки рисуем только для существующих модулей,
            // обработчики вешает core/ui.js (renderPlayerHudContent).
            const quick = extra.quick || {};
            const quickBtns = [];
            if (quick.city) quickBtns.push('<button type="button" class="player-hud-quick-btn" id="player-hud-qcity" title="Открыть Карманный Город">🏰 Город</button>');
            if (quick.mail) quickBtns.push('<button type="button" class="player-hud-quick-btn" id="player-hud-qmail" title="Открыть игровую почту">✉️ Почта</button>');
            if (quick.players) quickBtns.push('<button type="button" class="player-hud-quick-btn" id="player-hud-qplayers" title="Открыть разведку игроков">🔍 Разведка</button>');
            const quickHtml = (showQuick && quickBtns.length)
                ? `<div class="player-hud-quick">${quickBtns.join('')}</div>`
                : '';

            return `
                <div class="player-hud-header" id="player-hud-drag-handle">
                    <span class="player-hud-title">
                        <span class="player-hud-class-dot" style="background:${classColor}; box-shadow:0 0 6px ${classColor};"></span>
                        <span class="player-hud-name">${safeName}</span>
                        ${safeGuild ? `<span class="player-hud-guild">[${safeGuild}]</span>` : ''}
                        <span class="player-hud-level">ур. ${Number(level) || 1}</span>
                    </span>
                    <span class="player-hud-actions">
                        ${statusHtml}
                        <button class="player-hud-close" id="player-hud-settings-btn" title="Настройки профиля" style="color:#caa55c;">⚙️</button>
                        <button class="player-hud-close" id="player-hud-close-btn" title="Закрыть">✖</button>
                    </span>
                </div>
                <div class="player-hud-body">
                    <div class="player-hud-classline">
                        <span class="player-hud-class-badge" style="color:${classColor}; border-color:${classColor};">${safeClass}</span>
                    </div>

                    <div class="player-hud-bar-block">
                        <div class="player-hud-bar-head">
                            <span>❤️ Здоровье</span>
                            <span id="player-hud-hp">${hpStr}</span>
                        </div>
                        <div class="player-hud-bar-track">
                            <div id="player-hud-hp-bar" class="player-hud-bar-fill" style="width:${hpPct}%; background:${hpGradient};"></div>
                        </div>
                        <div id="player-hud-hp-timer" class="player-hud-bar-note"${hpTimerText ? '' : ' style="display:none;"'}>${hpTimerText ? `⏱ До полного: ${hpTimerText}` : ''}</div>
                    </div>

                    <div class="player-hud-row">
                        <span class="player-hud-row-label">🪙 Монеты</span>
                        <span id="player-hud-money" style="color:#ffcf6a;">${moneyVal}</span>
                    </div>
                    <div id="player-hud-debt-row" class="player-hud-row player-hud-debt"${debtVal > 0 ? '' : ' style="display:none;"'}>
                        <span class="player-hud-row-label">⚠️ Долг</span>
                        <span id="player-hud-debt">${debtVal > 0 ? Utils.formatMoney(debtVal) : ''}</span>
                    </div>

                    ${locHtml}
                    ${statsHtml}
                    ${secondaryHtml}
                    ${buffsHtml}
                    ${xpHtml}
                    ${quickHtml}
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
         *
         * v11.6.6f: добавлена карточка «Гильдия» (data-room="guild"). Это не
         * здание города, а окно LGGuilds, поэтому доступность считает
         * PocketCity.isGuildLocked() и передаёт её флагом — шаблон остаётся
         * «глупым» и не лезет в ME.
         *
         * @param {boolean} guildLocked нет доступа к гильдиям: карточка серая,
         *                              клик по ней PocketCity превращает в тост
         */
        pocketCityModal(guildLocked = false) {
            return `
                <h2>🏰 Карманный Город
                    <span class="pocket-city-head-actions">
                        <button type="button" class="pocket-city-pin-btn" id="pocket-city-pin-btn" title="Закрепить компактным виджетом">📌</button>
                        <button class="custom-close" id="custom-close-btn">✖</button>
                    </span>
                </h2>
                <div style="font-size:13px; color:#aaa; margin-bottom:15px; text-align:center;">
                    Прямой доступ к официальным зданиям игры из любой локации:
                </div>
                <!-- minmax(120px): 8 карточек (7 зданий + гильдия) укладываются в один ряд при ширине окна 1200px -->
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:12px; margin-bottom:10px;">
                    ${pocketCityRoomButtons(guildLocked, false)}
                </div>
            `;
        },

        /**
         * Компактный закреплённый виджет «🏰 Карманный Город».
         * Тот же набор зданий, иконок и цветов, что в полном окне, но
         * в 2 колонки и без подписей — игрок не путается при сворачивании.
         * Обработчики (перетаскивание, кнопки, здания) навешивает
         * PocketCity.showPinnedWidget().
         *
         * @param {boolean} guildLocked нет доступа к гильдиям (карточка серая)
         */
        pocketCityPinnedWidget(guildLocked = false) {
            return `
                <div class="lg-pc-widget-head" id="lg-pc-widget-drag">
                    <span class="lg-pc-widget-title">🏰 Город</span>
                    <span class="lg-pc-widget-actions">
                        <button type="button" class="lg-pc-widget-btn" id="lg-pc-widget-expand" title="Развернуть в полное окно">⛶</button>
                        <button type="button" class="lg-pc-widget-btn lg-pc-widget-close" id="lg-pc-widget-close" title="Открепить и скрыть">✖</button>
                    </span>
                </div>
                <div class="lg-pc-widget-grid">
                    ${pocketCityRoomButtons(guildLocked, true)}
                </div>
            `;
        },

        /**
         * Модалка настроек HUD «👤 Профиль»: какие блоки показывать.
         * Кнопку «Сохранить» (#hud-set-save) обрабатывает core/ui.js —
         * он же пишет выбор в localStorage (ключ LEGION_HUD_SETTINGS).
         *
         * @param {object} settings { showLoc, showXp, showStats, showBuffs,
         *                            showSecondary, showQuickActions }
         */
        hudSettingsModal(settings) {
            const s = settings || {};
            return `
                <h2>⚙️ Настройки Профиля <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="padding: 10px; display: flex; flex-direction: column; gap: 12px;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-loc" ${s.showLoc ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> 📍 Локация и активность
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-xp" ${s.showXp ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> 📊 Опыт (полоса)
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-stats" ${s.showStats ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> ⚔️ Основные статы (Атака, Магия, Броня, Крит)
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-secondary" ${s.showSecondary ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> ✦ Вторичные характеристики (hero.xs)
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-buffs" ${s.showBuffs ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> 🍗 Активные эффекты (еда/свитки)
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#eee;">
                        <input type="checkbox" id="hud-set-quick" ${s.showQuickActions ? 'checked' : ''} style="width:16px; height:16px; accent-color:#caa55c;"> 🚀 Быстрые кнопки (Город / Почта / Разведка)
                    </label>
                    <button id="hud-set-save" style="margin-top:10px; background:#caa55c; color:#1d1620; border:none; border-radius:6px; padding:10px; font-weight:bold; cursor:pointer;">Сохранить</button>
                </div>
            `;
        }
    };
