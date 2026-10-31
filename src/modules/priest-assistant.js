    // ============================================================
    // 4.2. МОДУЛЬ: АССИСТЕНТ ЖРЕЦА (HUD для Похода)
    //
    // Данные боя берём из нативного модуля игры (в песочнице — через G).
    // Приоритет источников — от самого свежего к самому «ленивому»:
    //   G.__lgRawQuestData  — сырой пакет, перехваченный hooks.js на LGQuest.data(q)
    //                         (до буферизации и задержки стрима q.dl);
    //   G.__BB_LAST_RAW_Q__ — аналогичный снимок от «Чёрного ящика»;
    //   G.LGQuest._view()   — штатный геттер игры (данные с задержкой);
    //                         data(q) — СЕТТЕР, без аргумента возвращает undefined.
    //   q.on     — поход активен (false — завершён/не запущен)
    //   q.b.st   — фаза боя: 'party' (ход отряда — основное окно хила),
    //              'tele'/'mech'/'trans'/'hit' — бой идёт, 'intro'/'end' — нет
    //   q.b.low  — массив [login, name, hp] по раненым участникам
    //   q.b.sk   — умения героя в бою [id, кулдаун, тип] ('heal' = хилка)
    //
    // HUD показывает только отслеживаемых игроков и даёт кнопку быстрого хила.
    // Источник списка по умолчанию — НАТИВНЫЕ друзья игры (/api/friends),
    // локальный список «Друзья» из аддона удалён в 11.5.4.
    // Рендер дешёвый: тяжёлая часть (innerHTML) пересобирается только при
    // изменении данных боя.
    // ============================================================
    const PriestAssistant = {
        hudEl: null,
        watchedNicks: [],          // ники как ввёл пользователь (сравнение — без учёта регистра)
        nativeFriends: new Set(),  // нативные друзья игры (/api/friends), логины в нижнем регистре
        isVisible: false,          // HUD открывается/закрывается вручную из FAB-меню
        // true — показывать всех раненых отряда, игнорируя список (по умолчанию).
        showAllWounded: true,
        _remindedThisCombat: false,
        _updateInterval: null,
        _friendsInterval: null,    // периодическое обновление нативных друзей
        _friendsLoading: false,    // защита от наложения запросов /api/friends
        _menuBtn: null,
        _ownsMenuBtn: false,       // true — кнопку создали сами (фолбэк), её же и удаляем
        _onQuestUpdate: null,
        _dragBound: false,

        STORAGE_KEY: 'LEGION_PRIEST_WATCHED',
        HUD_POS_KEY: 'LEGION_PRIEST_HUD_POS',
        VISIBLE_KEY: 'LEGION_PRIEST_HUD_VISIBLE',
        ALL_KEY: 'LEGION_PRIEST_ALL',   // режим «показывать всех раненых»

        init() {
            // Список друзей берём у игры: аддон больше не ведёт свой.
            // Запрос асинхронный — HUD успевает отрисоваться и без него.
            this.loadNativeFriends();
            if (this._friendsInterval) clearInterval(this._friendsInterval);
            // Друга могли добавить прямо в игре — раз в минуту обновляем.
            this._friendsInterval = setInterval(() => this.loadNativeFriends(), 60000);

            this._loadVisibility();
            this._loadWatched();
            this._loadShowAll();
            this._bindMenuButton();

            // Игра отдельного события об изменениях боя не даёт, но если оно
            // появится — перерисуем сразу, не ожидая тика поллинга.
            if (!this._onQuestUpdate) {
                this._onQuestUpdate = () => this.renderHud();
                document.addEventListener('lg-quest-update', this._onQuestUpdate);
            }

            // Поллинг: контекст похода обновляет q.b в реальном времени.
            if (this._updateInterval) clearInterval(this._updateInterval);
            this._updateInterval = setInterval(() => this.renderHud(), 1000);

            this.renderHud();
        },

        // Снятие таймеров/слушателей при повторном запуске аддона (single-instance guard).
        destroy() {
            if (this._updateInterval) {
                clearInterval(this._updateInterval);
                this._updateInterval = null;
            }
            if (this._friendsInterval) {
                clearInterval(this._friendsInterval);
                this._friendsInterval = null;
            }
            if (this._onQuestUpdate) {
                document.removeEventListener('lg-quest-update', this._onQuestUpdate);
                this._onQuestUpdate = null;
            }
            // Кнопку из разметки main.js не трогаем (живёт вместе с FAB),
            // удаляем только аварийно созданный дубль.
            if (this._menuBtn && this._ownsMenuBtn) {
                this._menuBtn.remove();
            }
            this._menuBtn = null;
            this._ownsMenuBtn = false;
            if (this.hudEl) {
                this.hudEl.remove();
                this.hudEl = null;
            }
            this._dragBound = false;
            this._remindedThisCombat = false;
        },

        // ------------------------------------------------------------
        // Нативные друзья игры (GET /api/friends).
        //
        // Ответ современного клиента: { ok: true, friends: [{ login, ... }] },
        // но старые сборки могли отдавать просто массив логинов — поэтому
        // нормализуем оба варианта. При ошибке/пустом ответе прошлый кэш
        // НЕ затираем: панель продолжает работать по последнему списку.
        // ------------------------------------------------------------
        async loadNativeFriends() {
            if (this._friendsLoading) return;       // запрос уже в полёте
            this._friendsLoading = true;
            try {
                const res = await Utils.fetchApi('/api/friends');
                const data = res?.body || res;
                // Ответ: { ok, friends: [...] } либо просто массив друзей.
                const list = Array.isArray(data) ? data
                           : Array.isArray(data?.friends) ? data.friends
                           : Array.isArray(res?.friends) ? res.friends
                           : null;
                if (!list) return;

                const set = new Set();
                list.forEach(f => {
                    const raw = (f && typeof f === 'object')
                        ? (f.login || f.nick || f.name || '')
                        : f;
                    const key = String(raw || '').trim().toLowerCase();
                    if (key) set.add(key);
                });
                this.nativeFriends = set;
                dbg(`[PRIEST] Загружено нативных друзей: ${set.size}`);
            } catch (e) {
                dbg('[PRIEST] Ошибка загрузки нативных друзей:', e);
            } finally {
                this._friendsLoading = false;
            }
        },

        _loadVisibility() {
            try {
                this.isVisible = localStorage.getItem(this.VISIBLE_KEY) === 'true';
            } catch (e) {
                this.isVisible = false;
            }
        },

        _saveVisibility() {
            try {
                localStorage.setItem(this.VISIBLE_KEY, String(this.isVisible));
            } catch (e) {
                dbg('PriestAssistant: не удалось сохранить видимость HUD', e);
            }
        },

        _setVisible(visible) {
            this.isVisible = !!visible;
            this._saveVisibility();
            this._syncMenuButton();
            this.renderHud(true);
        },

        // Пункт FAB. Штатно кнопка объявлена в main.js (как «Профиль»);
        // динамическое создание — фолбэк, если разметка старая.
        _bindMenuButton() {
            const btn = document.getElementById('btn-priest-panel');
            if (btn) {
                btn.addEventListener('click', () => {
                    const fabMenu = document.getElementById(DOM_IDS.fabMenu);
                    if (fabMenu) fabMenu.classList.remove('open');
                    this._setVisible(!this.isVisible);
                });
                this._menuBtn = btn;
                this._ownsMenuBtn = false;
                this._syncMenuButton();
                return;
            }

            if (this._menuBtn) return;
            const fabMenu = document.getElementById(DOM_IDS.fabMenu);
            if (!fabMenu) return;

            const created = document.createElement('button');
            created.type = 'button';
            created.className = 'fab-menu-item';
            created.textContent = '✨ Панель Жреца';
            created.addEventListener('click', () => {
                fabMenu.classList.remove('open');
                this._setVisible(!this.isVisible);
            });

            // Ставим сразу после «Профиля»: пункт остаётся в группе кнопок
            // и не задевает кнопку «⚙️ Настройки» того же блока.
            const profileBtn = document.getElementById(DOM_IDS.btnProfile);
            if (profileBtn) profileBtn.insertAdjacentElement('afterend', created);
            else fabMenu.appendChild(created);

            this._menuBtn = created;
            this._ownsMenuBtn = true;
            this._syncMenuButton();
        },

        // Подсветка активного пункта меню, пока панель открыта.
        _syncMenuButton() {
            if (!this._menuBtn || !this._menuBtn.classList) return;
            this._menuBtn.classList.toggle('active', this.isVisible);
            this._menuBtn.title = this.isVisible ? 'Скрыть панель Жреца' : 'Показать панель Жреца';
        },

        _loadWatched() {
            try {
                const arr = JSON.parse(localStorage.getItem(this.STORAGE_KEY));
                this.watchedNicks = Array.isArray(arr) ? this._normalizeNicks(arr) : [];
            } catch (e) {
                dbg('PriestAssistant: не удалось прочитать список отслеживаемых', e);
                this.watchedNicks = [];
            }
        },

        // Режим «показывать всех раненых». Включён по умолчанию: пользователь
        // должен явно выключить его ('false'), чтобы вернуться к фильтру по
        // списку. Читаем/пишем безопасно — при запрещённом localStorage
        // аддон не должен падать на старте.
        _loadShowAll() {
            try {
                this.showAllWounded = localStorage.getItem(this.ALL_KEY) !== 'false';
            } catch (e) {
                this.showAllWounded = true;
            }
        },

        _saveShowAll() {
            try {
                localStorage.setItem(this.ALL_KEY, this.showAllWounded);
            } catch (e) {
                dbg('PriestAssistant: не удалось сохранить режим "все раненые"', e);
            }
        },

        // Переключение режима (чекбокс в настройках, при необходимости — кнопка в меню).
        toggleShowAll() {
            this.showAllWounded = !this.showAllWounded;
            this._saveShowAll();
            this.renderHud(true);
        },

        // Ники храним как ввёл пользователь (чтобы список читался нормально),
        // дубликаты убираем без учёта регистра.
        _normalizeNicks(list) {
            const seen = new Set();
            const out = [];
            (Array.isArray(list) ? list : []).forEach(raw => {
                const nick = String(raw).trim();
                const key = nick.toLowerCase();
                if (!nick || seen.has(key)) return;
                seen.add(key);
                out.push(nick);
            });
            return out;
        },

        // Кого отслеживаем. Пустой свой список = все нативные друзья игры
        // (как и написано в настройках панели).
        _getWatchSet() {
            if (this.watchedNicks.length) {
                return new Set(this.watchedNicks.map(n => n.toLowerCase()));
            }
            // nativeFriends уже приведены к нижнему регистру в loadNativeFriends().
            return new Set(this.nativeFriends);
        },

        _getMyNick() {
            let playerNick = '';
            try {
                if (typeof Players !== 'undefined' && typeof Players.getMyNick === 'function') {
                    playerNick = Players.getMyNick();
                }
            } catch (e) {}

            const candidates = [
                playerNick,
                G.ME?.user?.login,
                G.ME?.user?.name,
                G.ME?.hero?.n,
                G.ME?.hero?.name,
                typeof Chat !== 'undefined' ? Chat.myNick : ''
            ];
            for (const c of candidates) {
                if (c) return String(c).trim().toLowerCase();
            }
            return '';
        },

        // Роль героя. В Legion класс лежит в hero.class; role — устаревшее/пустое
        // поле, поэтому проверяем его только после class (см. Chat.myRole =
        // hero.class, BuildSim.classNames.priest).
        _getMyRole() {
            // ME/герой — объекты страницы: в песочнице доступны только через G.
            const hero = G.ME?.hero || G.ME?.me || G.__lgHero || window.__lgHero || null;
            const candidates = [
                hero && hero.class,
                hero && hero.role,
                hero && hero.cl,
                hero && hero.sk && hero.sk.c,
                G.ME?.user?.class,
                G.ME?.user?.role,
                typeof Chat !== 'undefined' ? Chat.myRole : ''
            ];
            for (const c of candidates) {
                if (c) return String(c).trim().toLowerCase();
            }
            return '';
        },

        // Состояние похода. Порядок источников (от самого свежего):
        //   1) __lgRawQuestData — сырой пакет из hooks.js (без задержки стрима);
        //   2) __BB_LAST_RAW_Q__ — сырой снимок от BlackBox (если он стоит);
        //   3) LGQuest._view() — штатный геттер игры (данные с задержкой q.dl);
        //   4) __lgQuestContext.data() — старый фолбэк.
        _readQuest() {
            const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

            // 1. Самый свежий пакет: игра зовёт data(q) на каждое обновление,
            //    hooks.js кладёт его сюда ДО буферизации в RAW игры.
            if (G.__lgRawQuestData && typeof G.__lgRawQuestData === 'object') {
                // { on: false } — поход завершён: это достоверно, старые
                // снимки (BlackBox/_view) подставлять нельзя.
                return G.__lgRawQuestData.on === false ? null : G.__lgRawQuestData;
            }

            // 2. Пакет от «Чёрного ящика» (если хука из п.1 ещё нет).
            if (G.__BB_LAST_RAW_Q__ && typeof G.__BB_LAST_RAW_Q__ === 'object') {
                return G.__BB_LAST_RAW_Q__.on === false ? null : G.__BB_LAST_RAW_Q__;
            }

            // 3. Запасной вариант: _view() — данные с задержкой стрима.
            if (G.LGQuest && typeof G.LGQuest._view === 'function') {
                try {
                    const v = G.LGQuest._view();
                    if (v && typeof v === 'object') return v.on === false ? null : v;
                } catch (e) {}
            }

            // 4. Старый fallback (у контекста QX метода data нет).
            const ctx = G.__lgQuestContext || window.__lgQuestContext;
            if (ctx && typeof ctx.data === 'function') {
                try {
                    const q = ctx.data();
                    if (q && typeof q === 'object') return q;
                } catch (e) {}
            }
            return null;
        },

        // Бой активен, если объект боя есть и фаза не 'end' и не 'intro'.
        // Фазы по docs/API.md: 'party' (ход отряда — тут и нужен хил),
        // 'tele', 'hit', 'mech', 'trans' — бой идёт; 'intro' и 'end' — нет.
        _isBattleActive(battle) {
            return !!battle && typeof battle === 'object' &&
                battle.st !== 'end' && battle.st !== 'intro';
        },

        // Раненые отряда (q.b.low). Показываем либо отслеживаемых (свой список
        // / друзья игры), либо ВСЕХ, если включён showAllWounded.
        // q можно не передавать — тогда читаем состояние похода сами.
        _collectWounded(q = this._readQuest()) {
            const battle = q && q.b;
            if (!this._isBattleActive(battle) || !Array.isArray(battle.low)) return [];

            const myNick = this._getMyNick();
            const isAll = this.showAllWounded;
            // В режиме «все» фильтр по списку не нужен вообще.
            const watchSet = isAll ? null : this._getWatchSet();
            if (!isAll && !watchSet.size) return [];

            const seen = new Set();
            return battle.low
                .filter(row => Array.isArray(row) && row[0] != null)
                .map(row => {
                    const login = String(row[0]).trim();
                    const name = row[1] ? String(row[1]) : login;
                    const rawHp = Number(row[2]);
                    // HP приходит долей (0..1); на всякий случай принимаем и
                    // уже посчитанные проценты.
                    const hp = Number.isFinite(rawHp)
                        ? Math.min(100, Math.max(0, Math.round(rawHp <= 1 ? rawHp * 100 : rawHp)))
                        : 0;
                    return { login, name, hp };
                })
                .filter(w => {
                    const key = w.login.toLowerCase();
                    if (!key || key === myNick || seen.has(key)) return false;
                    seen.add(key);
                    // Режим «все раненые»: показываем каждого, кроме себя.
                    if (isAll) return true;
                    return watchSet.has(key);
                })
                .sort((a, b) => a.hp - b.hp);
        },

        _findReadyHeal(q) {
            const skills = q && q.b && Array.isArray(q.b.sk) ? q.b.sk : null;
            if (!skills) return null;
            // Формат умения: [id, кулдаун, тип]. Готова та, у которой кулдаун 0.
            return skills.find(sk => Array.isArray(sk) && sk[2] === 'heal' && (sk[1] === 0 || sk[1] === '0')) || null;
        },

        renderHud(force = false) {
            // После destroy() HUD не восстанавливаем.
            if (!this._updateInterval) return;

            const q = this._readQuest();

            // Бой активен, если есть объект q.b и фаза не 'end' и не 'intro'.
            // Хил нужен именно в 'party' (ход отряда), а не только в 'hit'.
            const isBattle = this._isBattleActive(q && q.b);

            // Напоминание жрецу: бой идёт, панель закрыта — один раз за бой.
            if (isBattle && this._getMyRole() === 'priest') {
                if (!this.isVisible && !this._remindedThisCombat) {
                    UI.showToast('✨ Вы Жрец! Откройте Панель Жреца в меню для быстрого хила.', false);
                    this._remindedThisCombat = true;
                }
            } else if (!isBattle) {
                // Бой закончился (или мы не в походе) — напоминание снова разрешено.
                this._remindedThisCombat = false;
            }

            // Панель закрыта пользователем — не создаём и не показываем HUD.
            if (!this.isVisible) {
                if (this.hudEl) this.hudEl.style.display = 'none';
                return;
            }

            this._ensureHud();

            // Состояние 1: контекста похода нет — статус и список наблюдения.
            if (!q) {
                this._showHud(this._outsideQuestHtml(), force);
                return;
            }

            // Состояние 2: в походе, но бой ещё не идёт (или уже закончился).
            if (!isBattle) {
                this._showHud(this._hudHeader('✨ Жрец: Ожидание боя') + this._watchListHtml(), force);
                return;
            }

            const wounded = this._collectWounded(q);

            // Состояние 3: бой идёт, но из отслеживаемых никто не ранен.
            // Список наблюдаемых оставляем под заголовком — видно, что панель жива.
            if (!wounded.length) {
                this._showHud(this._hudHeader('✨ Жрец: Все целы', '#4cc95a') + this._watchListHtml(), force);
                return;
            }

            // Состояние 4: бой, есть раненые — строки с кнопками хила.
            const readyHeal = this._findReadyHeal(q);
            const rows = wounded.map(w => {
                const hpColor = w.hp < 40 ? '#ff5a7a' : '#fff';
                const safeLogin = Utils.escapeHtml(w.login);
                const safeName = Utils.escapeHtml(w.name);
                const btnTitle = readyHeal ? `Хил на ${safeName}` : 'Хилка ещё не готова';
                return `
                    <div class="priest-hud-row">
                        <span class="priest-hud-nick" style="color:${hpColor};">${safeName} (${w.hp}%)</span>
                        <button type="button" class="priest-heal-btn" data-nick="${safeLogin}" title="${btnTitle}"${readyHeal ? '' : ' disabled'}>Хил</button>
                    </div>
                `;
            }).join('');

            this._showHud(this._hudHeader('✨ Панель Жреца') + rows, force);
        },

        _ensureHud() {
            if (this.hudEl) return;
            this.hudEl = document.createElement('div');
            this.hudEl.className = 'priest-hud';
            // Клики обрабатываем делегированием: innerHTML меняется, а слушатель один.
            this.hudEl.addEventListener('click', (e) => this._onHudClick(e));
            document.body.appendChild(this.hudEl);
        },

        // Пишем innerHTML только при реальном изменении — кнопки не «мигают».
        _showHud(html, force) {
            if (!this.hudEl) return;
            this.hudEl.style.display = 'flex';
            if (!force && this.hudEl.innerHTML === html) return;
            this.hudEl.innerHTML = html;
            this._bindDragOnce();
        },

        // Шапка HUD: статус слева, настройки и закрытие справа.
        _hudHeader(text, color) {
            const colorStyle = color ? ` style="color:${color};"` : '';
            return `
                <div class="priest-hud-header">
                    <span${colorStyle}>${text}</span>
                    <div class="priest-hud-actions">
                        <span class="priest-hud-settings" id="priest-settings-icon" title="Настройки">⚙️</span>
                        <span class="priest-hud-close" id="priest-close-icon" title="Закрыть">✖</span>
                    </div>
                </div>
            `;
        },

        // Список отслеживаемых ников — общий рендер для всех состояний HUD.
        // Показываем свой список либо нативных друзей игры (их может быть
        // много, поэтому выводим счётчик). Пусто — значит «все друзья».
        _watchListHtml() {
            let listHtml;
            if (this.watchedNicks.length) {
                listHtml = this.watchedNicks
                    .map(n => `<div class="priest-hud-watch-item">• ${Utils.escapeHtml(n)}</div>`)
                    .join('');
            } else if (this.nativeFriends.size) {
                listHtml = `<div class="priest-hud-watch-item">• Друзей в игре: ${this.nativeFriends.size}</div>`;
            } else {
                listHtml = '<div class="priest-hud-watch-item">• (Все друзья)</div>';
            }

            return `<div class="priest-hud-watchlist">${listHtml}</div>`;
        },

        _outsideQuestHtml() {
            // Вне похода показываем, кого реально отслеживаем.
            return this._hudHeader('✨ Жрец: Ожидание похода') + this._watchListHtml();
        },

        // Перетаскивание вешаем один раз — когда в HUD уже есть .priest-hud-header.
        _bindDragOnce() {
            if (this._dragBound || !this.hudEl) return;
            this._dragBound = true;
            UI.makeDraggable(this.hudEl, '.priest-hud-header', this.HUD_POS_KEY);
            // makeDraggable() только сохраняет позицию — восстанавливаем её сами.
            try {
                const pos = JSON.parse(localStorage.getItem(this.HUD_POS_KEY) || 'null');
                if (pos && pos.left && pos.top) {
                    this.hudEl.style.left = pos.left;
                    this.hudEl.style.top = pos.top;
                    this.hudEl.style.right = 'auto';
                }
            } catch (e) {}
        },

        _onHudClick(e) {
            const target = e.target;
            if (!target || !target.closest) return;

            if (target.closest('.priest-hud-close')) {
                this._setVisible(false);
                return;
            }
            if (target.closest('.priest-hud-settings')) {
                this.openSettings();
                return;
            }
            const btn = target.closest('.priest-heal-btn');
            if (btn && !btn.disabled) this.heal(btn.dataset.nick, btn);
        },

        heal(login, btn) {
            if (!login) return;

            const ctx = G.__lgQuestContext || window.__lgQuestContext;
            if (!ctx || typeof ctx.act !== 'function') {
                UI.showToast('Поход: нет доступа к контексту боя', true);
                return;
            }

            // Данные читаем в момент клика: между тиками кулдаун мог измениться.
            const healSk = this._findReadyHeal(this._readQuest());
            if (!healSk) {
                UI.showToast('Хилка ещё не готова', true);
                this.renderHud(true);
                return;
            }

            try {
                ctx.act({ k: 'b', a: 'sk', w: healSk[0], t: login });
            } catch (e) {
                dbg('PriestAssistant: ошибка отправки хила', e);
                UI.showToast('Хил: сбой отправки', true);
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.textContent = '...';
            }
            UI.showToast(`✨ Хил на ${login}`);
        },

        openSettings() {
            const current = this.watchedNicks.join(', ');

            const modal = UI.showModal(`
                <h2>✨ Настройки Жреца <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="padding: 10px;">
                    <div style="font-size: 13px; color: #aaa; margin-bottom: 15px;">
                        Введите ники через запятую или пробел. Если поле пустое, панель будет отслеживать всех ваших друзей. Галочка ниже полностью отключает фильтр по списку.
                    </div>
                    <textarea id="priest-nicks-input" maxlength="500" style="width: 100%; height: 100px; background: #111; border: 1px solid #444; color: #fff; padding: 10px; border-radius: 6px; box-sizing: border-box; font-family: monospace; resize: vertical;" placeholder="ник1, ник2, ник3">${Utils.escapeHtml(current)}</textarea>
                    <label style="margin-top: 12px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="priest-show-all" style="width: 16px; height: 16px; accent-color: #caa55c; flex-shrink: 0;" ${this.showAllWounded ? 'checked' : ''}>
                        <span style="font-size: 13px;">Показывать ВСЕХ раненых (игнорировать список)</span>
                    </label>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button id="priest-save-btn" style="flex: 1; padding: 10px; background: #caa55c; color: #1d1620; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">Сохранить</button>
                    </div>
                </div>
            `, { compact: true });

            const input = modal?.querySelector('#priest-nicks-input');
            const saveBtn = modal?.querySelector('#priest-save-btn');
            if (!input || !saveBtn) return;

            // Режим «все раненые» применяем сразу, без кнопки «Сохранить»:
            // состояние пишем в localStorage и сразу перерисовываем HUD.
            const showAllChk = modal.querySelector('#priest-show-all');
            if (showAllChk) {
                showAllChk.addEventListener('change', (e) => {
                    this.showAllWounded = !!e.target.checked;
                    this._saveShowAll();
                    this.renderHud(true);
                });
            }

            saveBtn.addEventListener('click', () => {
                // Разделители: запятая, пробел, перенос строки (и их сочетания).
                this.watchedNicks = this._normalizeNicks(String(input.value || '').split(/[\s,]+/));

                try {
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.watchedNicks));
                } catch (e) {
                    dbg('PriestAssistant: не удалось сохранить список', e);
                }

                UI.showToast('Список отслеживаемых обновлен');
                UI.closeModals();
                this.renderHud(true); // Принудительный перерендер
            });
        }
    };



