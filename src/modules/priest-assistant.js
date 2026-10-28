    // ============================================================
    // 4.2. МОДУЛЬ: АССИСТЕНТ ЖРЕЦА (HUD для Похода)
    //
    // Данные боя берём из нативного контекста похода, который перехватывает
    // hooks.js (window.__lgQuestContext):
    //   q.b.st   — состояние боя ('hit' = бой идёт)
    //   q.b.low  — массив [login, name, hp] по раненым участникам
    //   q.b.sk   — умения героя в бою [id, кулдаун, тип] ('heal' = хилка)
    //
    // HUD показывает только отслеживаемых игроков (по умолчанию — друзей из
    // Players) и даёт кнопку быстрого хила. Рендер дешёвый: тяжёлая часть
    // (innerHTML) пересобирается только при изменении данных боя.
    // ============================================================
    const PriestAssistant = {
        hudEl: null,
        watchedNicks: [],          // ники в нижнем регистре
        _updateInterval: null,
        _lastRenderKey: '',
        _watchlistSaved: false,    // пользователь уже настраивал список (даже пустой)
        _menuBtn: null,
        _onQuestUpdate: null,
        _dragBound: false,

        STORAGE_KEY: 'LEGION_PRIEST_WATCHED',
        HUD_POS_KEY: 'LEGION_PRIEST_HUD_POS',

        init() {
            this._loadWatched();
            this._addMenuButton();

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
            if (this._onQuestUpdate) {
                document.removeEventListener('lg-quest-update', this._onQuestUpdate);
                this._onQuestUpdate = null;
            }
            if (this._menuBtn) {
                this._menuBtn.remove();
                this._menuBtn = null;
            }
            if (this.hudEl) {
                this.hudEl.remove();
                this.hudEl = null;
            }
            this._dragBound = false;
            this._lastRenderKey = '';
        },

        _addMenuButton() {
            const fabMenu = document.getElementById(DOM_IDS.fabMenu);
            if (!fabMenu || this._menuBtn) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'fab-menu-item';
            btn.textContent = '✨ Настройки Жреца';
            btn.addEventListener('click', () => this.openSettings());

            // Ставим сразу после «Профиля»: пункт остаётся в группе кнопок и не
            // задевает чекбокс «Отключить перехват чата» и индикатор стелса.
            const profileBtn = document.getElementById(DOM_IDS.btnProfile);
            if (profileBtn) profileBtn.insertAdjacentElement('afterend', btn);
            else fabMenu.appendChild(btn);

            this._menuBtn = btn;
        },

        _loadWatched() {
            try {
                const saved = localStorage.getItem(this.STORAGE_KEY);
                this._watchlistSaved = saved !== null;
                const arr = JSON.parse(saved);
                this.watchedNicks = Array.isArray(arr)
                    ? [...new Set(arr.map(n => String(n).trim().toLowerCase()).filter(Boolean))]
                    : [];
            } catch (e) {
                dbg('PriestAssistant: не удалось прочитать список отслеживаемых', e);
                this._watchlistSaved = false;
                this.watchedNicks = [];
            }
        },

        // Кого отслеживаем. Пока свой список не сохранён — берём список друзей,
        // чтобы HUD работал сразу после установки аддона.
        _getWatchSet() {
            if (this.watchedNicks.length) return new Set(this.watchedNicks);
            if (!this._watchlistSaved && typeof Players !== 'undefined' && typeof Players.getFriendsList === 'function') {
                try {
                    return new Set(Players.getFriendsList().map(n => String(n).toLowerCase()));
                } catch (e) {}
            }
            return new Set();
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
                window.ME?.user?.login,
                window.ME?.user?.name,
                window.ME?.hero?.n,
                window.ME?.hero?.name,
                typeof Chat !== 'undefined' ? Chat.myNick : ''
            ];
            for (const c of candidates) {
                if (c) return String(c).trim().toLowerCase();
            }
            return '';
        },

        // ctx.data() — снимок состояния похода (тот же объект, что игра гоняет
        // в своём рендере). ctx.act() — отправка действия в бой.
        _readQuest() {
            const ctx = window.__lgQuestContext;
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

        renderHud() {
            // После destroy() HUD не восстанавливаем.
            if (!this._updateInterval) return;

            const q = this._readQuest();
            const wounded = q ? this._collectWounded(q) : [];

            if (!wounded.length) {
                this._lastRenderKey = '';
                if (this.hudEl) this.hudEl.style.display = 'none';
                return;
            }

            const readyHeal = this._findReadyHeal(q);
            const healId = readyHeal ? `sk${readyHeal[0]}` : '';
            const renderKey = wounded.map(w => `${w.login}:${w.hp}`).join('|') + `|${healId}`;

            // Данные не изменились — не пересобираем innerHTML (иначе кнопки
            // пересоздаются каждый тик и «мигают» под курсором).
            if (this.hudEl && renderKey === this._lastRenderKey) {
                this.hudEl.style.display = 'flex';
                return;
            }
            this._lastRenderKey = renderKey;

            if (!this.hudEl) {
                this.hudEl = document.createElement('div');
                this.hudEl.className = 'priest-hud';
                this.hudEl.addEventListener('click', (e) => this._onHudClick(e));
                document.body.appendChild(this.hudEl);
            }
            this.hudEl.style.display = 'flex';

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

            this.hudEl.innerHTML = `
                <div class="priest-hud-title">
                    <span>✨ Панель Жреца</span>
                    <button type="button" class="priest-hud-settings" title="Настроить список отслеживаемых">⚙</button>
                </div>
                ${rows}
            `;

            // Перетаскивание вешаем один раз — после появления заголовка.
            if (!this._dragBound) {
                this._dragBound = true;
                UI.makeDraggable(this.hudEl, '.priest-hud-title', this.HUD_POS_KEY);
                // makeDraggable() только сохраняет позицию — восстанавливаем её сами.
                try {
                    const pos = JSON.parse(localStorage.getItem(this.HUD_POS_KEY) || 'null');
                    if (pos && pos.left && pos.top) {
                        this.hudEl.style.left = pos.left;
                        this.hudEl.style.top = pos.top;
                        this.hudEl.style.right = 'auto';
                    }
                } catch (e) {}
            }
        },

        _onHudClick(e) {
            const target = e.target;
            if (!target || !target.closest) return;

            if (target.closest('.priest-hud-settings')) {
                this.openSettings();
                return;
            }
            const btn = target.closest('.priest-heal-btn');
            if (btn && !btn.disabled) this.heal(btn.dataset.nick, btn);
        },

        heal(login, btn) {
            if (!login) return;

            const ctx = window.__lgQuestContext;
            if (!ctx || typeof ctx.act !== 'function') {
                UI.showToast('Поход: нет доступа к контексту боя', true);
                return;
            }

            // Данные читаем в момент клика: между тиками кулдаун мог измениться.
            const healSk = this._findReadyHeal(this._readQuest());
            if (!healSk) {
                UI.showToast('Хилка ещё не готова', true);
                this._lastRenderKey = '';
                this.renderHud();
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

            // Перерисуем чуть позже — кулдаун на сервере уже начался.
            setTimeout(() => {
                this._lastRenderKey = '';
                this.renderHud();
            }, 300);
        },

        openSettings() {
            const current = this.watchedNicks.join(', ');
            const input = window.prompt(
                'Ники друзей для отслеживания ХП через запятую (пусто — очистить):',
                current
            );
            if (input === null) return;

            const list = [...new Set(
                input.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
            )];

            this.watchedNicks = list;
            this._watchlistSaved = true;
            try {
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(list));
            } catch (e) {
                dbg('PriestAssistant: не удалось сохранить список', e);
            }

            UI.showToast(list.length
                ? `✨ Отслеживаем игроков: ${list.length}`
                : '✨ Список отслеживаемых очищен');
            this._lastRenderKey = '';
            this.renderHud();
        }
    };



