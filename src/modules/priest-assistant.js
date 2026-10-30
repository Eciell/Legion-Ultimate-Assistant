    // ============================================================
    // 4.2. МОДУЛЬ: АССИСТЕНТ ЖРЕЦА (HUD для Похода)
    //
    // Данные боя берём из нативного контекста похода, который перехватывает
    // hooks.js (G.__lgQuestContext, в песочнице читается через G):
    //   q.b.st   — состояние боя ('hit' = бой идёт)
    //   q.b.low  — массив [login, name, hp] по раненым участникам
    //   q.b.sk   — умения героя в бою [id, кулдаун, тип] ('heal' = хилка)
    //
    // HUD показывает только отслеживаемых игроков и даёт кнопку быстрого хила.
    // Источник списка по умолчанию — НАТИВНЫЕ друзья игры (/api/friends),
    // свой локальный список Players.getFriendsList() больше не используется.
    // Рендер дешёвый: тяжёлая часть (innerHTML) пересобирается только при
    // изменении данных боя.
    // ============================================================
    const PriestAssistant = {
        hudEl: null,
        watchedNicks: [],          // ники как ввёл пользователь (сравнение — без учёта регистра)
        nativeFriends: new Set(),  // нативные друзья игры (/api/friends), логины в нижнем регистре
        isVisible: false,          // HUD открывается/закрывается вручную из FAB-меню
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

        init() {
            // Список друзей берём у игры: аддон больше не ведёт свой.
            // Запрос асинхронный — HUD успевает отрисоваться и без него.
            this.loadNativeFriends();
            if (this._friendsInterval) clearInterval(this._friendsInterval);
            // Друга могли добавить прямо в игре — раз в минуту обновляем.
            this._friendsInterval = setInterval(() => this.loadNativeFriends(), 60000);

            this._loadVisibility();
            this._loadWatched();
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

        // ctx.data() — снимок состояния похода (тот же объект, что игра гоняет
        // в своём рендере). ctx.act() — отправка действия в бой.
        _readQuest() {
            // Контекст похода — объект страницы (hooks.js пишет G.__lgQuestContext);
            // в песочнице window-копия всегда пустая, поэтому нужен G.
            const ctx = G.__lgQuestContext || window.__lgQuestContext;
            if (!ctx || typeof ctx.data !== 'function') return null;
            try {
                const q = ctx.data();
                return (q && typeof q === 'object') ? q : null;
            } catch (e) {
                dbg('PriestAssistant: не удалось прочитать данные похода', e);
                return null;
            }
        },

        _collectWounded(q) {
            const battle = q && q.b;
            if (!battle || battle.st !== 'hit' || !Array.isArray(battle.low)) return [];

            const myNick = this._getMyNick();
            const watch = this._getWatchSet();
            if (!watch.size) return [];

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
                    if (!key || key === myNick || seen.has(key) || !watch.has(key)) return false;
                    seen.add(key);
                    return true;
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

            // Напоминание жрецу: бой идёт, панель закрыта — один раз за бой.
            if (q && q.b && q.b.st === 'hit' && this._getMyRole() === 'priest') {
                if (!this.isVisible && !this._remindedThisCombat) {
                    UI.showToast('✨ Вы Жрец! Откройте Панель Жреца в меню для быстрого хила.', false);
                    this._remindedThisCombat = true;
                }
            } else if (!q || !q.b || q.b.st !== 'hit') {
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
            if (!q.b || q.b.st !== 'hit') {
                this._showHud(this._hudHeader('✨ Жрец: Ожидание боя'), force);
                return;
            }

            const wounded = this._collectWounded(q);

            // Состояние 3: бой идёт, но из отслеживаемых никто не ранен.
            if (!wounded.length) {
                this._showHud(this._hudHeader('✨ Жрец: Все целы', '#4cc95a'), force);
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

        _outsideQuestHtml() {
            // Вне похода показываем, кого реально отслеживаем: свой список
            // либо нативных друзей игры (их может быть много — выводим счётчик).
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

            return this._hudHeader('✨ Жрец: Ожидание похода') +
                `<div class="priest-hud-watchlist">${listHtml}</div>`;
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
                        Введите ники через запятую или пробел. Если поле пустое, панель будет отслеживать всех ваших друзей.
                    </div>
                    <textarea id="priest-nicks-input" maxlength="500" style="width: 100%; height: 100px; background: #111; border: 1px solid #444; color: #fff; padding: 10px; border-radius: 6px; box-sizing: border-box; font-family: monospace; resize: vertical;" placeholder="ник1, ник2, ник3">${Utils.escapeHtml(current)}</textarea>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button id="priest-save-btn" style="flex: 1; padding: 10px; background: #caa55c; color: #1d1620; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">Сохранить</button>
                    </div>
                </div>
            `, { compact: true });

            const input = modal?.querySelector('#priest-nicks-input');
            const saveBtn = modal?.querySelector('#priest-save-btn');
            if (!input || !saveBtn) return;

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



