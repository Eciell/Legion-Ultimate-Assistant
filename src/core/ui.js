    // ============================================================
    // 2. UI-ФАБРИКА
    // ============================================================
    const UI = {
        _hudTimer: null,
        _toastTimer: null,
        _toastClickHandler: null,
        // ПАТЧ 11.6.5g: узлы меню аддона + режим входа в него.
        //   _navMode: 'fab' — плавающая кнопка (шахта/поход),
        //             'native' — кнопка в баре игры (город).
        _fabWrap: null,
        _fabBtn: null,
        _fabMenu: null,
        _navMode: '',
        _navObserver: null,
        _navRetryTimer: null,
        _navRetries: 0,
        // ПАТЧ 11.6.5h.1: дубль состояния тумблера «Кнопка аддона в нижнем
        // меню игры». Нужен, если localStorage недоступен/заблокирован —
        // тогда выбор живёт в памяти до перезагрузки страницы.
        _nativeFabDisabled: false,
        showToast(msg, isError = false, onClick = null) {
            let toast = document.getElementById('lg-global-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'lg-global-toast';
                toast.style.cssText = 'position:fixed;bottom:85px;right:25px;background:#2a2030;border:1px solid #caa55c;color:#ffcf6a;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:bold;z-index:10002;box-shadow:0 4px 15px rgba(0,0,0,0.7);transition:opacity 0.3s, transform 0.3s;pointer-events:none;';
                document.body.appendChild(toast);
            }
            // Сбрасываем клик-обработчик предыдущего тоста
            if (this._toastClickHandler) {
                toast.removeEventListener('click', this._toastClickHandler);
                this._toastClickHandler = null;
            }
            if (typeof onClick === 'function') {
                toast.style.pointerEvents = 'auto';
                toast.style.cursor = 'pointer';
                this._toastClickHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try { onClick(); } catch (err) { dbg('toast click error:', err); }
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateY(10px)';
                };
                toast.addEventListener('click', this._toastClickHandler);
            } else {
                toast.style.pointerEvents = 'none';
                toast.style.cursor = 'default';
            }
            toast.textContent = msg;
            toast.style.borderColor = isError ? '#ff5a7a' : '#caa55c';
            toast.style.color = isError ? '#ff5a7a' : '#ffcf6a';
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => {
                if (toast) {
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateY(10px)';
                }
            }, 2500);
        },
        closeModals() {
            // Снимаем удержание вкладки «Город»: MutationObserver в
            // PocketCity.openNativeBuilding больше не должен возвращать её на экран.
            window.__POCKET_CITY_OPEN__ = false;
            if (typeof Players !== 'undefined') Players.currentDMPeer = null;
            // Удаляем только наши модалки (по префиксному классу), не трогая чужие.
            document.querySelectorAll('.' + DOM_IDS.customModal).forEach(el => el.remove());
            document.querySelectorAll('.sim-card').forEach(el => el.remove());
        },
        makeDraggable(element, handleSelector = 'h2', storageKey = 'LEGION_MODAL_POS') {
            if (!element) return;
            const handle = typeof handleSelector === 'string' ? element.querySelector(handleSelector) : handleSelector;
            if (!handle) return;

            // Компактные окна (modal-compact) всегда открываются по центру:
            // унаследованная из localStorage позиция от развёрнутых модалок
            // могла оказаться за границами экрана. Сбрасываем её и не
            // запоминаем координаты компактных окон.
            const isCompact = !!(element.classList && element.classList.contains('modal-compact'));
            if (isCompact) {
                if (storageKey) {
                    try { localStorage.removeItem(storageKey); } catch (err) {}
                }
                element.style.left = '50%';
                element.style.top = '50%';
                element.style.transform = 'translate(-50%, -50%)';
                element.style.right = 'auto';
                element.style.bottom = 'auto';
            }

            handle.style.cursor = 'grab';
            handle.style.userSelect = 'none';

            let dragging = false;
            let offX = 0;
            let offY = 0;

            const onPointerMove = (e) => {
                if (!dragging) return;
                let newLeft = e.clientX - offX;
                let newTop = e.clientY - offY;

                const maxLeft = Math.max(10, (window.innerWidth || 1000) - 60);
                const maxTop = Math.max(10, (window.innerHeight || 800) - 40);
                newLeft = Math.min(Math.max(newLeft, 0), maxLeft);
                newTop = Math.min(Math.max(newTop, 0), maxTop);

                element.style.left = `${newLeft}px`;
                element.style.top = `${newTop}px`;
            };

            const onPointerUp = (e) => {
                if (!dragging) return;
                dragging = false;
                handle.style.cursor = 'grab';
                try {
                    if (handle.releasePointerCapture && e.pointerId !== undefined) {
                        handle.releasePointerCapture(e.pointerId);
                    }
                } catch (err) {}
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);

                // Позицию компактных окон не сохраняем (см. isCompact выше).
                if (storageKey && !isCompact) {
                    try {
                        localStorage.setItem(storageKey, JSON.stringify({
                            left: element.style.left,
                            top: element.style.top
                        }));
                    } catch (err) {}
                }
            };

            handle.addEventListener('pointerdown', (e) => {
                const target = e.target;
                if (!target || !target.closest) return;
                if (target.closest('button, .custom-close, input, textarea, select, a, [data-no-drag]')) {
                    return;
                }
                if (e.button !== undefined && e.button !== 0) return;

                dragging = true;
                handle.style.cursor = 'grabbing';
                try {
                    if (handle.setPointerCapture && e.pointerId !== undefined) {
                        handle.setPointerCapture(e.pointerId);
                    }
                } catch (err) {}

                const r = element.getBoundingClientRect();
                element.style.transform = 'none';
                element.style.left = `${r.left}px`;
                element.style.top = `${r.top}px`;
                element.style.right = 'auto';
                element.style.bottom = 'auto';

                offX = e.clientX - r.left;
                offY = e.clientY - r.top;

                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('pointercancel', onPointerUp);
                e.preventDefault();
            });
        },
        showModal(html, options = {}) {
            this.closeModals();
            if (typeof options === 'boolean') options = { compact: options };
            if (typeof options === 'string') options = { customClass: options };

            const modal = document.createElement('div');
            let classNames = `${DOM_IDS.customModal} custom-modal`;
            if (options.compact) classNames += ' modal-compact';
            if (options.customClass) classNames += ` ${options.customClass}`;
            modal.className = classNames;
            modal.innerHTML = html;

            // Восстановление позиции из localStorage под ключом LEGION_MODAL_POS.
            // Для компактных окон позицию не читаем: её всё равно перезапишет
            // makeDraggable() (центрирование), а остаток от развёрнутой модалки
            // мог оказаться за границами экрана.
            if (!options.compact) {
                try {
                    const pos = JSON.parse(localStorage.getItem('LEGION_MODAL_POS') || 'null');
                    if (pos && pos.left && pos.top) {
                        const leftVal = parseInt(pos.left, 10);
                        const topVal = parseInt(pos.top, 10);
                        const maxLeft = Math.max(10, (window.innerWidth || 1000) - 200);
                        const maxTop = Math.max(10, (window.innerHeight || 800) - 60);

                        if (!isNaN(leftVal) && !isNaN(topVal) && leftVal >= 0 && leftVal <= maxLeft && topVal >= 0 && topVal <= maxTop) {
                            modal.style.left = pos.left;
                            modal.style.top = pos.top;
                            modal.style.transform = 'none';
                            modal.style.right = 'auto';
                            modal.style.bottom = 'auto';
                        }
                    }
                } catch (e) {}
            }

            document.body.appendChild(modal);
            const closeBtn = modal.querySelector('#custom-close-btn') || document.getElementById('custom-close-btn');
            if (closeBtn) closeBtn.addEventListener('click', () => this.closeModals());

            // Автоматическое перетаскивание окна за h2
            this.makeDraggable(modal, 'h2');

            return modal;
        },
        // ⚙️ Служебные настройки аддона: канал 7TV и перехват чата.
        // Вынесены из FAB-меню в модалку, чтобы меню не разрасталось.
        openSettings() {
            const chatDisabled = (typeof Chat !== 'undefined') ? !!Chat.disabled : false;
            // 11.6.0g-4: состояние тумблера подсветки ников (дефолт — включено).
            const addonHighlight = (typeof Chat !== 'undefined') ? Chat.addonHighlight !== false : true;

            // Разметка модалки — в core/ui-templates.js (UITemplates.settingsModal).
            const modal = this.showModal(UITemplates.settingsModal(chatDisabled, addonHighlight), { compact: true });

            if (!modal) return;

            modal.querySelector('#modal-7tv-btn')?.addEventListener('click', () => {
                this.closeModals();
                if (typeof Chat !== 'undefined' && typeof Chat.open7tvSettings === 'function') {
                    Chat.open7tvSettings();
                }
            });

            modal.querySelector('#modal-chk-chat')?.addEventListener('change', (e) => {
                if (typeof Chat !== 'undefined' && typeof Chat.setDisabled === 'function') {
                    Chat.setDisabled(e.target.checked);
                }
            });

            // 11.6.4e: тумблер «🎭 Отображать смайлы 7TV». Дефолт — включено
            // (ключа в localStorage ещё нет). Флаг читают
            // SevenTV.replaceEmotes / decorate / load() в
            // modules/chat/chat-emotes.js, поэтому и замена смайлов, и запросы
            // к 7TV прекращаются сразу, без перезагрузки страницы.
            const tvChk = modal.querySelector('#modal-chk-7tv');
            if (tvChk) {
                tvChk.checked = localStorage.getItem('LEGION_7TV_DISABLED') !== 'true';
                tvChk.addEventListener('change', (e) => {
                    localStorage.setItem('LEGION_7TV_DISABLED', String(!e.target.checked));
                    // Chat.setSevenTVEnabled() догрузит набор (если аддон
                    // стартовал с выключенным тумблером) и перерисует
                    // открытый чат.
                    if (typeof Chat !== 'undefined' && typeof Chat.setSevenTVEnabled === 'function') {
                        Chat.setSevenTVEnabled(e.target.checked);
                    }
                });
            }

            // 11.6.0g-4: подсветка ников Legion — сохраняем и перерисовываем чат.
            modal.querySelector('#modal-chk-addon-hl')?.addEventListener('change', (e) => {
                if (typeof Chat !== 'undefined' && typeof Chat.setAddonHighlight === 'function') {
                    Chat.setAddonHighlight(e.target.checked);
                }
            });

            // 11.6.1g: тумблер уведомлений о новых версиях.
            // Дефолт — включено (ключа в localStorage ещё нет). Значение читает
            // Chat.checkForUpdates() перед GM_notification.
            const notifyOn = localStorage.getItem('LEGION_UPDATE_NOTIFY') !== 'false';
            const notifyChk = modal.querySelector('#modal-chk-update-notify');
            if (notifyChk) notifyChk.checked = notifyOn;
            notifyChk?.addEventListener('change', (e) => {
                localStorage.setItem('LEGION_UPDATE_NOTIFY', String(e.target.checked));
            });

            // 11.6.2b: боевой ассистент в походах. Дефолт — включено (ключа ещё нет);
            // значение читает CombatAssistant._tick() при каждом тике.
            const combatChk = modal.querySelector('#modal-chk-combat-assist');
            if (combatChk) {
                combatChk.checked = localStorage.getItem('LEGION_COMBAT_ASSIST') !== 'false';
                combatChk.addEventListener('change', (e) => {
                    localStorage.setItem('LEGION_COMBAT_ASSIST', String(e.target.checked));
                });
            }

            // ПАТЧ 11.6.5h / h.1: тумблер «📌 Кнопка аддона в нижнем меню игры».
            // Порядок операций важен: сначала применяем выключение к DOM, потом
            // пишем в хранилище, и только затем пересчитываем режим. Так выбор
            // сработает, даже если localStorage недоступен (setItem бросит
            // исключение) или syncNavButton() упадёт на полпути.
            const nativeChk = modal.querySelector('#modal-chk-native-fab');
            if (nativeChk) {
                nativeChk.checked = UI._nativeFabEnabled();
                nativeChk.addEventListener('change', (e) => {
                    const isEnabled = e.target.checked;

                    // 1. Принудительно применяем выключение к DOM — сразу, не
                    //    дожидаясь syncNavButton().
                    UI._nativeFabDisabled = !isEnabled;
                    if (!isEnabled) {
                        document.querySelectorAll('.lgu-nav-btn').forEach(el => el.remove());
                        if (UI._fabBtn) UI._fabBtn.style.display = 'flex';
                        UI._navMode = 'fab';
                    }

                    // 2. Сохраняем выбор (страховка на случай закрытого
                    //    хранилища: дубль остаётся в UI._nativeFabDisabled).
                    try {
                        localStorage.setItem('LEGION_NATIVE_FAB', String(isEnabled));
                    } catch (err) {
                        dbg('[UI] LEGION_NATIVE_FAB: не удалось записать в localStorage', err);
                    }

                    // 3. Пересчитываем режим: при включении сюда же приходит
                    //    возврат кнопки в бар игры.
                    UI.syncNavButton();
                });
            }
        },
        // 🏰 Карманный город вынесен в modules/pocket-city.js (v11.6.0, этап 3):
        //    UI.openPocketCity()     -> PocketCity.open()
        //    UI.openNativeBuilding() -> PocketCity.openNativeBuilding()
        // ------------------------------------------------------------
        // ПАТЧ 11.6.5g: единая точка входа в меню аддона.
        //
        // Меню открывают двое: круглая FAB (шахта/поход) и нативная
        // кнопка «Аддон» в баре города (#gu-hud .gu-main). Логика «в какую
        // сторону раскрывать» живёт здесь, чтобы оба входа вели себя одинаково.
        // ------------------------------------------------------------
        toggleFabMenu() {
            const menu = this._fabMenu
                || document.getElementById(DOM_IDS.fabMenu)
                || document.getElementById('legion-fab-menu');
            if (!menu) return false;

            if (menu.classList.contains('open')) {
                this.closeFabMenu();
                return false;
            }

            const viewportH = window.innerHeight || 800;
            // У скрытого (display:none) меню scrollHeight равен 0, поэтому
            // «|| 400» и зажим по высоте окна — как в старом обработчике FAB.
            const menuHeight = Math.min(menu.scrollHeight || 400, viewportH - 120);

            // Якорь — сама FAB, а когда она скрыта (город) — её обёртка:
            // wrap сохраняет позицию, выбранную перетаскиванием.
            let anchorTop = null;
            const btnRect = this._fabBtn ? this._fabBtn.getBoundingClientRect() : null;
            if (btnRect && btnRect.height > 0) anchorTop = btnRect.top;
            if (anchorTop === null && this._fabWrap) anchorTop = this._fabWrap.getBoundingClientRect().top;
            if (anchorTop === null) anchorTop = viewportH;

            menu.classList.toggle('open-down', anchorTop < menuHeight + 20);
            menu.classList.add('open');
            return true;
        },

        closeFabMenu() {
            const menu = this._fabMenu
                || document.getElementById(DOM_IDS.fabMenu)
                || document.getElementById('legion-fab-menu');
            if (!menu) return;
            menu.classList.remove('open');
            menu.classList.remove('open-down');
        },

        // Кнопка «Аддон» для нативного бара игры. Классы .gu-b/.gu-bi/.gu-bl
        // родные (site/style.css игры), поэтому размер кружка, шрифт подписи
        // и подсветку берём у нативного худа — свой CSS почти не нужен.
        createNativeNavButton() {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'gu-b lgu-nav-btn';
            btn.setAttribute('data-gu', 'lgu-menu');
            btn.title = 'Меню аддона Legion';
            btn.setAttribute('aria-label', 'Меню аддона Legion');
            btn.innerHTML = `
                <span class="gu-bi" style="box-shadow: 0 0 0 1.5px #caa55c;">
                    <span style="font-size: 26px; line-height: 1;">🐱</span>
                </span>
                <span class="gu-bl" style="color: #ffcf6a;">Аддон</span>
            `;
            // pointerdown гасим: setupFab закрывает меню «кликом снаружи»
            // именно на pointerdown, иначе повторный клик по кнопке закрывал
            // бы меню и тут же открывал его снова.
            btn.addEventListener('pointerdown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleFabMenu();
            });
            return btn;
        },

        // ПАТЧ 11.6.5h.1: включён ли вход в меню через нижний бар игры.
        // Источник правды — localStorage, но его чтение может быть недоступно
        // (приватный режим, ограничения песочницы), поэтому выбор дублируется
        // в памяти (_nativeFabDisabled): тумблер работает до перезагрузки даже
        // без хранилища, а «мусорное» значение в нём трактуется как «включено».
        _nativeFabEnabled() {
            try {
                const raw = localStorage.getItem('LEGION_NATIVE_FAB');
                if (raw === 'true') return true;
                if (raw === 'false') return false;
            } catch (e) {}
            return this._nativeFabDisabled !== true;
        },

        // Умное переключение входа в меню:
        //   Город       — есть нативный бар: наша кнопка встаёт первой, FAB прячем;
        //   Шахта/Поход — бара нет: возвращаем плавающую FAB.
        // #gu-hud игра создаёт один раз и после выхода из города оставляет в DOM
        // (скрывая через html.gu-city), поэтому наличия бара ещё не достаточно.
        syncNavButton() {
            // ПАТЧ 11.6.5h: тумблер «📌 Кнопка аддона в нижнем меню игры».
            // Выключен — нативную кнопку не создаём (и убираем уже созданную),
            // а FAB остаётся плавающей в правом нижнем углу даже в городе.
            // Состояние читает _nativeFabEnabled() (localStorage + дубль в
            // памяти), см. ПАТЧ 11.6.5h.1.
            if (!this._nativeFabEnabled()) {
                // 1. Удаляем нативную кнопку из бара игры, если она есть.
                document.querySelectorAll('.lgu-nav-btn').forEach(el => el.remove());
                // 2. Возвращаем плавающую FAB (её мог спрятать нативный режим).
                if (this._fabBtn) this._fabBtn.style.display = 'flex';
                this._navMode = 'fab';
                this._navRetries = 0;
                return false;
            }

            const bar = document.querySelector('#gu-hud .gu-main');
            const inCity = !!bar && document.documentElement.classList.contains('gu-city');

            if (inCity) {
                this._navRetries = 0;
                if (!bar.querySelector('.lgu-nav-btn')) {
                    bar.prepend(this.createNativeNavButton());
                }
                if (this._navMode !== 'native') {
                    this._navMode = 'native';
                    // Меню, открытое в шахте, не должно висеть в городе без FAB.
                    this.closeFabMenu();
                }
                // Бар бывает скрыт (открыто окно героя, чат на мобиле) —
                // тогда FAB оставляем, иначе в меню аддона было бы не попасть.
                const barVisible = bar.getClientRects().length > 0;
                if (this._fabBtn) this._fabBtn.style.display = barVisible ? 'none' : 'flex';
                return true;
            }

            this._navMode = 'fab';
            if (this._fabBtn) this._fabBtn.style.display = 'flex';

            // HUD игра создаёт лениво (guRender -> guHud, до ~2 с после входа
            // в город). Пока бара нет, но город уже включён — добиваем парой
            // отложенных проверок, чтобы FAB не висела поверх нативного бара.
            if (!bar && document.documentElement.classList.contains('gu-city')) {
                this._scheduleNavRetry();
            }
            return false;
        },

        // До шести повторов по 400 мс: ждём появления #gu-hud после входа
        // в город (см. syncNavButton).
        _scheduleNavRetry() {
            if (this._navRetryTimer || this._navRetries >= 6) return;
            this._navRetries += 1;
            this._navRetryTimer = setTimeout(() => {
                this._navRetryTimer = null;
                this.syncNavButton();
            }, 400);
        },

        setupFab(wrap, btn, menu) {
            // ПАТЧ 11.6.5g: ссылки нужны toggleFabMenu()/syncNavButton() —
            // меню одно, а входов в него два (FAB и кнопка в баре города).
            this._fabWrap = wrap;
            this._fabBtn = btn;
            this._fabMenu = menu;
            let dragging = false, startX = 0, startY = 0, offX = 0, offY = 0, hasMoved = false;

            btn.addEventListener('pointerdown', (e) => {
                dragging = true;
                hasMoved = false;
                startX = e.clientX;
                startY = e.clientY;
                btn.setPointerCapture(e.pointerId);

                const r = wrap.getBoundingClientRect();
                offX = e.clientX - r.left;
                offY = e.clientY - r.top;
            });

            btn.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                if (!hasMoved && Math.hypot(e.clientX - startX, e.clientY - startY) > 5) {
                    hasMoved = true;
                }
                if (hasMoved) {
                    // Ограничиваем координаты рамками окна: иначе FAB можно утащить
                    // за пределы экрана и потерять (позиция ещё и сохраняется в localStorage).
                    const fabSize = 50; // Примерный размер FAB
                    let newX = e.clientX - offX;
                    let newY = e.clientY - offY;

                    newX = Math.max(0, Math.min(newX, window.innerWidth - fabSize));
                    newY = Math.max(0, Math.min(newY, window.innerHeight - fabSize));

                    wrap.style.left = newX + 'px';
                    wrap.style.top = newY + 'px';
                    wrap.style.right = 'auto';
                    wrap.style.bottom = 'auto';
                }
            });

            btn.addEventListener('pointerup', (e) => {
                if (!dragging) return;
                dragging = false;
                btn.releasePointerCapture(e.pointerId);

                if (hasMoved) {
                    try {
                        localStorage.setItem('LEGION_FAB_POS', JSON.stringify({
                            left: wrap.style.left,
                            top: wrap.style.top
                        }));
                    } catch (err) {}
                } else {
                    const isOpen = menu.classList.toggle('open');
                    if (isOpen) {
                        // Меню не должно улетать за край экрана: если над кнопкой
                        // мало места — раскрываем его вниз (класс open-down).
                        const rect = btn.getBoundingClientRect();
                        const viewportH = window.innerHeight || 800;
                        const menuHeight = Math.min(menu.scrollHeight || 400, viewportH - 120);
                        if (rect.top < menuHeight + 20) {
                            menu.classList.add('open-down');
                        } else {
                            menu.classList.remove('open-down');
                        }
                    } else {
                        menu.classList.remove('open-down');
                    }
                }
            });

            // Закрытие меню при клике снаружи
            document.addEventListener('pointerdown', (e) => {
                if (!wrap.contains(e.target)) {
                    menu.classList.remove('open');
                }
            });

            // Закрытие меню при клике по любому пункту (кроме чекбокса)
            menu.querySelectorAll('.fab-menu-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.tagName === 'INPUT' || e.target.closest('input')) return;
                    menu.classList.remove('open');
                });
            });

            // Аккордеон: клик по заголовку секции сворачивает/разворачивает её.
            // stopPropagation не даёт событию дойти до обработчиков меню и страницы.
            menu.querySelectorAll('.fab-section-title').forEach(title => {
                title.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const section = title.parentElement;
                    if (section) section.classList.toggle('collapsed');
                });
            });
        },

        // Текущая локация героя для HUD «👤 Профиль»: { text, color }.
        //   Шахта — по разметке нативного модуля (.mn-world/.mn-screen) либо по URL;
        //   Поход — по состоянию LGQuest (q.on) через штатный геттер игры
        //   LGQuest._view() (данные с задержкой стрима q.dl).
        _detectHudLocation() {
            const inMine = !!document.querySelector('.mn-world') ||
                           !!document.querySelector('.mn-screen') ||
                           location.search.includes('sid=') ||
                           location.pathname.includes('/mine') ||
                           (typeof Chat !== 'undefined' && Chat.isInMine && Chat.isInMine());
            if (inMine) return { text: '⛏️ Шахта', color: '#4cc95a' };

            let inQuest = false;
            try {
                if (G.LGQuest && typeof G.LGQuest._view === 'function') {
                    const q = G.LGQuest._view();
                    inQuest = !!(q && q.on);
                }
            } catch (e) {}
            if (inQuest) return { text: '🚩 Поход', color: '#ff9900' };

            return { text: '🏙️ Город', color: '#8fd3ff' };
        },

        // Опыт внутри уровня: { xp, xpNext }.
        // Игра отдаёт готовые поля xpInLevel / xpToNext (docs/API.md, GET /api/me).
        // В старых снимках их нет — считаем от абсолютных порогов, как это делает
        // сам клиент игры: набрано = xp - prevXp, нужно = next - prevXp.
        _heroXp(hero) {
            if (!hero) return { xp: 0, xpNext: 1 };
            const own = hero.xpInLevel !== undefined && hero.xpInLevel !== null;
            const prevXp = Math.max(0, Number(hero.prevXp) || 0);
            const xp = own
                ? Math.max(0, Number(hero.xpInLevel) || 0)
                : Math.max(0, (Number(hero.xp) || 0) - prevXp);
            const needRaw = own ? hero.xpToNext : hero.next;
            // Максимум уровня неизвестен (нет поля) — считаем полосу полной.
            const xpNext = (needRaw === undefined || needRaw === null)
                ? Math.max(1, xp)
                : Math.max(1, (Number(needRaw) || 0) - (own ? 0 : prevXp));
            return { xp, xpNext };
        },

        // ------------------------------------------------------------
        // HUD профиля (v11.5.6): настройки блоков, баффы и статус героя.
        // ------------------------------------------------------------

        // Какие блоки показывать в HUD. Ключ LEGION_HUD_SETTINGS общий для
        // всех персонажей. Битый/отсутствующий JSON не должен ломать HUD —
        // в этом случае возвращаем дефолты (всё включено).
        getHudSettings() {
            const defaults = { showLoc: true, showXp: true, showStats: true, showBuffs: true };
            try {
                const raw = localStorage.getItem('LEGION_HUD_SETTINGS');
                if (raw) return { ...defaults, ...JSON.parse(raw) };
            } catch (e) {}
            return defaults;
        },

        // Остаток времени баффа строкой: минуты, а в последнюю минуту — секунды,
        // иначе подпись «1м» висела бы до самого исчезновения эффекта.
        _hudTimeLeft(ms) {
            if (ms <= 60000) return `${Math.max(1, Math.ceil(ms / 1000))}с`;
            return `${Math.ceil(ms / 60000)}м`;
        },

        // Активные эффекты героя: сытость (eatUntil) и свиток (scrollUntil).
        // Оба поля — метки времени окончания действия в мс (см. клиент игры:
        // reference/LegionFrontSRC/site/city.js — h.eatUntil > Date.now()).
        _hudBuffs(hero) {
            const out = [];
            if (!hero) return out;
            const now = Date.now();
            const add = (until, icon, title) => {
                const ts = Number(until) || 0;
                if (ts > now) out.push({ icon, title, time: this._hudTimeLeft(ts - now), until: ts });
            };
            add(hero.eatUntil, '🍗', 'Сытость');
            add(hero.scrollUntil, '📜', 'Свиток');
            return out;
        },

        // Статус героя для бейджа в шапке HUD (docs/API.md, раздел «Герой»):
        //   мёртв   — hpNow <= 0 либо активен таймер deadUntil;
        //   призрак — hero.ghost (в клиенте игры призрак не переодевается);
        //   занят   — hero.busy (идёт бой на стриме).
        _hudStatus(hero) {
            if (!hero) return null;
            const now = Date.now();
            const deadUntil = Number(hero.deadUntil) || 0;
            const hpNow = Number(hero.hpNow);
            const isDead = hero.dead === true || (Number.isFinite(hpNow) && hpNow <= 0) || deadUntil > now;
            if (isDead) {
                const left = deadUntil > now ? ` ${this._hudTimeLeft(deadUntil - now)}` : '';
                return { text: `💀 Мертв${left}`, color: '#ff5a7a' };
            }
            if (hero.ghost) return { text: '👻 Призрак', color: '#8fd3ff' };
            if (hero.busy) return { text: '⚔️ Занят', color: '#ffcf6a' };
            return null;
        },

        // Подпись состояния HUD: по ней интервал в togglePlayerHud() понимает,
        // что набор баффов/статус изменился и карточку нужно перерисовать.
        _hudSignature(hero) {
            if (!hero) return '';
            const dead = (Number(hero.hpNow) <= 0) ? 1 : 0;
            return [
                hero.busy ? 1 : 0,
                hero.ghost ? 1 : 0,
                Number(hero.deadUntil) || 0,
                Number(hero.eatUntil) || 0,
                Number(hero.scrollUntil) || 0,
                dead
            ].join('|');
        },

        renderPlayerHudContent(hud, hero) {
            if (!hud) return;
            // Глобальный G (core/constants.js) — это unsafeWindow: ME/LGQuest
            // живут в контексте страницы и в песочнице напрямую не видны.
            // v11.6.0g-5: LG_CH сюда не подмешиваем — это Twitch-канал, а не
            // игрок; в HUD попадал чужой ник (баг «ника в чате»).
            const name = hero?.name || G.ME?.user?.name || G.ME?.user?.login || 'Игрок';
            const rawClass = hero?.class || hero?.c || hero?.sk?.c || 'recruit';
            const className = (typeof BuildSim !== 'undefined' && BuildSim.classNames?.[rawClass]) || rawClass;
            const lvl = hero?.lvl || hero?.level || hero?.l || 1;

            // Здоровье: hero.hpNow / (hero.stats.hp или hero.hpMax)
            const hpNow = hero?.hpNow !== undefined ? hero.hpNow : (hero?.hp !== undefined ? hero.hp : '—');
            const hpMax = hero?.stats?.hp !== undefined ? hero.stats.hp : (hero?.hpMax !== undefined ? hero.hpMax : (hero?.maxHp || hero?.mhp || '—'));

            // Монеты: hero.money
            const moneyVal = hero?.money !== undefined ? hero.money : (hero?.coins !== undefined ? hero.coins : (hero?.gold !== undefined ? hero.gold : 0));

            // Опыт и локация — общими хелперами (их же использует интервал ниже).
            const { xp, xpNext } = this._heroXp(hero);
            const loc = this._detectHudLocation();

            // Настройки HUD + расширенные данные (v11.5.6).
            const settings = this.getHudSettings();
            const buffs = this._hudBuffs(hero);
            const status = this._hudStatus(hero);

            // Статы: atk/mag/def клиент отдаёт в hero.stats, крит — в hero.xs
            // (реже в hero.stats.crit), поэтому набор нормализуем здесь.
            const hudStats = hero ? {
                atk: hero.stats ? hero.stats.atk : undefined,
                mag: hero.stats ? hero.stats.mag : undefined,
                def: hero.stats ? hero.stats.def : undefined,
                crit: (hero.stats && hero.stats.crit !== undefined) ? hero.stats.crit : (hero.xs ? hero.xs.crit : undefined)
            } : null;

            // Разметка HUD — в core/ui-templates.js (UITemplates.playerHud):
            // шаблон сам экранирует ник/класс и форматирует монеты.
            hud.innerHTML = UITemplates.playerHud(name, className, lvl, { now: hpNow, max: hpMax }, moneyVal, loc, xp, xpNext, {
                settings,
                stats: hudStats,
                buffs,
                status
            });

            // Метки для интервала в togglePlayerHud(): hudReady отличает готовую
            // карточку от заглушки «Загрузка профиля...», hudSig — набор
            // баффов/статуса (при изменении карточка перерисовывается).
            hud.dataset.hudReady = '1';
            hud.dataset.hudSig = this._hudSignature(hero);

            hud.querySelector('#player-hud-close-btn')?.addEventListener('click', () => {
                hud.style.display = 'none';
                if (UI._hudTimer) {
                    clearInterval(UI._hudTimer);
                    UI._hudTimer = null;
                }
            });

            // ⚙️ Настройки отображаемых блоков профиля (11.5.6).
            hud.querySelector('#player-hud-settings-btn')?.addEventListener('click', () => {
                const currentSettings = this.getHudSettings();
                UI.showModal(UITemplates.hudSettingsModal(currentSettings), { compact: true });
                // showModal() синхронно вставляет модалку в body — кнопка уже доступна.
                document.getElementById('hud-set-save')?.addEventListener('click', () => {
                    const newSettings = {
                        showLoc: !!document.getElementById('hud-set-loc')?.checked,
                        showXp: !!document.getElementById('hud-set-xp')?.checked,
                        showStats: !!document.getElementById('hud-set-stats')?.checked,
                        showBuffs: !!document.getElementById('hud-set-buffs')?.checked
                    };
                    try {
                        localStorage.setItem('LEGION_HUD_SETTINGS', JSON.stringify(newSettings));
                    } catch (e) {}
                    UI.closeModals();
                    // Перерисовываем карточку с новым набором блоков.
                    this.renderPlayerHudContent(hud, hero);
                });
            });
        },

        setupPlayerHudDrag(hud) {
            let dragging = false, offX = 0, offY = 0;
            hud.addEventListener('pointerdown', (e) => {
                if (e.target.closest('#player-hud-close-btn') || e.target.closest('#player-hud-settings-btn') || !e.target.closest('#player-hud-drag-handle')) return;
                dragging = true;
                hud.setPointerCapture(e.pointerId);
                const r = hud.getBoundingClientRect();
                offX = e.clientX - r.left;
                offY = e.clientY - r.top;
                hud.style.left = r.left + 'px';
                hud.style.top = r.top + 'px';
                hud.style.right = 'auto';
                hud.style.bottom = 'auto';
            });
            hud.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                hud.style.left = (e.clientX - offX) + 'px';
                hud.style.top = (e.clientY - offY) + 'px';
            });
            hud.addEventListener('pointerup', (e) => {
                if (!dragging) return;
                dragging = false;
                hud.releasePointerCapture(e.pointerId);
                try {
                    localStorage.setItem('LEGION_PROFILE_POS', JSON.stringify({
                        left: hud.style.left,
                        top: hud.style.top
                    }));
                } catch (err) {}
            });
        },

        async togglePlayerHud() {
            let hud = document.getElementById(DOM_IDS.playerHud) || document.getElementById('legion-player-hud');
            if (hud && hud.style.display !== 'none') {
                hud.style.display = 'none';
                if (this._hudTimer) {
                    clearInterval(this._hudTimer);
                    this._hudTimer = null;
                }
                return;
            }
            if (!hud) {
                hud = document.createElement('div');
                hud.id = DOM_IDS.playerHud;
                hud.className = DOM_IDS.playerHud;
                document.body.appendChild(hud);

                // Восстановление позиции из localStorage (§ Задача 3)
                try {
                    const pos = JSON.parse(localStorage.getItem('LEGION_PROFILE_POS'));
                    if (pos && pos.left && pos.top) {
                        hud.style.left = pos.left;
                        hud.style.top = pos.top;
                        hud.style.right = 'auto';
                        hud.style.bottom = 'auto';
                    }
                } catch (e) {}

                this.setupPlayerHudDrag(hud);
            }

            hud.style.display = 'flex';

            let hero = G.ME?.hero || G.ME?.me || window.__lgHero;
            if (hero) {
                this.renderPlayerHudContent(hud, hero);
            } else {
                // Заглушка до ответа /api/me — тоже из шаблонов.
                hud.innerHTML = UITemplates.playerHudLoading();
                // Метки готовой карточки снимаем: интервал дорисует HUD,
                // когда герой появится (проверка hudReady ниже).
                delete hud.dataset.hudReady;
                delete hud.dataset.hudSig;
                hud.querySelector('#player-hud-close-btn')?.addEventListener('click', () => {
                    hud.style.display = 'none';
                    if (UI._hudTimer) {
                        clearInterval(UI._hudTimer);
                        UI._hudTimer = null;
                    }
                });
            }

            // Очищаем старый интервал перед установкой нового
            if (this._hudTimer) {
                clearInterval(this._hudTimer);
                this._hudTimer = null;
            }

            // Живое обновление HUD: локация, HP, монеты и опыт каждые 1000 мс
            this._hudTimer = setInterval(() => {
                if (!hud || hud.style.display === 'none') {
                    if (this._hudTimer) {
                        clearInterval(this._hudTimer);
                        this._hudTimer = null;
                    }
                    return;
                }

                const currentHero = G.ME?.hero || G.ME?.me || window.__lgHero;

                // Герой появился позже (HUD ещё показывает заглушку «Загрузка
                // профиля...») — дорисовываем карточку целиком и выходим.
                // Проверяем метку готовности, а не #player-hud-xp-text: полосу
                // опыта можно отключить в настройках, и HUD перерисовывался бы
                // каждую секунду.
                if (currentHero && hud.dataset.hudReady !== '1') {
                    this.renderPlayerHudContent(hud, currentHero);
                    return;
                }

                // Изменился набор баффов или статус (поел, выпил свиток, умер,
                // начался бой) — перерисовываем карточку: состав элементов другой.
                if (currentHero && hud.dataset.hudSig !== this._hudSignature(currentHero)) {
                    this.renderPlayerHudContent(hud, currentHero);
                    return;
                }

                // Локация: Город / Шахта / Поход
                const locEl = hud.querySelector('#player-hud-loc');
                if (locEl) {
                    const loc = this._detectHudLocation();
                    locEl.textContent = loc.text;
                    locEl.style.color = loc.color;
                }

                if (currentHero) {
                    // HP: иконка ❤️ живёт в подписи шаблона, значение — только цифры.
                    const hpEl = hud.querySelector('#player-hud-hp');
                    if (hpEl) {
                        const curHp = currentHero.hpNow !== undefined ? currentHero.hpNow : (currentHero.hp !== undefined ? currentHero.hp : '—');
                        const mHp = currentHero.stats?.hp !== undefined ? currentHero.stats.hp : (currentHero.hpMax !== undefined ? currentHero.hpMax : (currentHero.maxHp || currentHero.mhp || '—'));
                        hpEl.textContent = (mHp !== null && mHp !== undefined) ? `${curHp} / ${mHp}` : curHp;
                    }
                    const moneyEl = hud.querySelector('#player-hud-money');
                    if (moneyEl) {
                        const mon = currentHero.money !== undefined ? currentHero.money : (currentHero.coins !== undefined ? currentHero.coins : (currentHero.gold !== undefined ? currentHero.gold : 0));
                        moneyEl.textContent = Utils.formatMoney(mon);
                    }
                    // Опыт: цифры и полоса прогресса уровня
                    const xpEl = hud.querySelector('#player-hud-xp-text');
                    const xpBar = hud.querySelector('#player-hud-xp-bar');
                    if (xpEl && xpBar) {
                        const { xp, xpNext } = this._heroXp(currentHero);
                        xpEl.textContent = `${xp} / ${xpNext}`;
                        // Math.max(1, …) — защита от деления на 0; 100 — потолок полосы.
                        xpBar.style.width = `${Math.min(100, Math.round((xp / Math.max(1, xpNext)) * 100))}%`;
                    }

                    // Баффы: пересчитываем подписи по data-until (см. ui-templates.js),
                    // чтобы таймер тикал без полной перерисовки HUD. Просроченные
                    // чипы убираем — на следующем тике hudSig перерисует карточку.
                    const buffsEl = hud.querySelector('#player-hud-buffs');
                    if (buffsEl) {
                        buffsEl.querySelectorAll('[data-until]').forEach(el => {
                            const until = Number(el.dataset.until) || 0;
                            const left = until - Date.now();
                            if (left > 0) {
                                el.textContent = `${el.dataset.icon || ''} ${this._hudTimeLeft(left)}`.trim();
                            } else {
                                el.remove();
                            }
                        });
                    }
                }
            }, 1000);

            try {
                const res = await Utils.fetchApi('/api/me');
                const freshHero = res?.hero || res?.body?.hero || res?.me || (res?.hpNow !== undefined ? res : null);
                if (freshHero) {
                    window.__lgHero = freshHero;
                    this.renderPlayerHudContent(hud, freshHero);
                }
            } catch (e) {
                dbg('[HUD] Ошибка запроса /api/me:', e);
            }
        }
    };
