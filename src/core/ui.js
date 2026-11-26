    // ============================================================
    // 2. UI-ФАБРИКА
    // ============================================================
    const UI = {
        _hudTimer: null,
        // v11.7.2: момент последнего события `me` LGLiveLink. Пока снимок
        // свежий, HUD предпочитает его G.ME (тот может отставать или быть
        // недоступен в песочнице).
        _heroLiveSeenAt: 0,
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
            // Запись хоткея не должна пережить закрытие модалки: иначе
            // следующий keydown молча перехватывался бы «висящим» рекордером.
            if (typeof this._stopBindRecording === 'function') this._stopBindRecording();
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
        // ⚙️ Служебные настройки аддона: уведомления о версиях, боевой
        // ассистент, подсветка ников аддона и место входа в меню.
        openSettings() {
            // Разметка модалки — в core/ui-templates.js (UITemplates.settingsModal).
            const modal = this.showModal(UITemplates.settingsModal(), { compact: true });

            if (!modal) return;

            // v11.7.2: единый рекордер хоткеев закрепа и 8 зданий Города.
            // Живёт в замыкании модалки; closeModals() гасит его через
            // _stopBindRecording(), чтобы keydown не перехватывался после закрытия.
            this._initPocketCityBindRecorders(modal);

            // 11.6.1g: тумблер уведомлений о новых версиях.
            // Дефолт — включено (ключа в localStorage ещё нет). Значение читает
            // checkAddonUpdate() из main.js перед GM_notification.
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

            // 11.7.2: подсветка ников пользователей аддона (modules/addon-presence.js).
            // Дефолт — включено. После клика сразу перестраиваем CSS: при
            // выключении _applyStyles() очистит простыню и кэш, при включении —
            // вернёт правила из уже загруженного набора /users.
            const addonHlChk = modal.querySelector('#modal-chk-addon-hl');
            if (addonHlChk) {
                addonHlChk.checked = Settings.get('addonHighlight');
                addonHlChk.addEventListener('change', (e) => {
                    Settings.set('addonHighlight', !!e.target.checked);
                    try {
                        if (typeof AddonPresence !== 'undefined') AddonPresence._applyStyles();
                    } catch (err) {
                        dbg('[UI] подсветка ников: сбой переключения', err);
                    }
                });
            }

            // 11.7.0: автоскип боёв с обычными и элитными монстрами (.cm-dlg).
            // По умолчанию выключен. Наблюдатель из modules/pocket-city.js
            // поднимается и снимается сразу — без перезагрузки страницы.
            const monsterSkipChk = modal.querySelector('#modal-chk-auto-skip-monsters');
            if (monsterSkipChk) {
                monsterSkipChk.checked = Settings.get('autoSkipMonsters');
                monsterSkipChk.addEventListener('change', (e) => {
                    const isEnabled = !!e.target.checked;
                    // Сначала применяем к наблюдателю (работает даже если
                    // localStorage заблокирован), затем сохраняем выбор.
                    try {
                        if (isEnabled) PocketCity.startMonsterAutoSkip();
                        else PocketCity.stopMonsterAutoSkip();
                    } catch (err) {
                        dbg('[UI] автоскип монстров: сбой переключения', err);
                    }
                    Settings.set('autoSkipMonsters', isEnabled);
                });
            }

            // 11.7.0: уведомления о сборах гильдии на элитных монстров
            const citymonGatherChk = modal.querySelector('#modal-chk-citymon-gather');
            if (citymonGatherChk) {
                citymonGatherChk.checked = Settings.get('citymonGatherEnabled');
                citymonGatherChk.addEventListener('change', (e) => {
                    const isEnabled = !!e.target.checked;
                    Settings.set('citymonGatherEnabled', isEnabled);
                    try {
                        if (typeof PocketCity !== 'undefined') {
                            if (isEnabled) {
                                PocketCity.startCityMonWatch();
                                PocketCity.pollCityMonLobbies(true);
                            } else {
                                PocketCity.hideCityMonGather();
                            }
                        }
                    } catch (err) {
                        dbg('[UI] сборы гильдии: сбой переключения', err);
                    }
                });
            }

            // 11.7.0: размер плашки сбора (S / M / L)
            const currentGatherSize = Settings.get('citymonGatherSize') || 'L';
            const gatherSizeBtns = modal.querySelectorAll('.lg-cm-size-btn');
            const updateActiveGatherSizeBtn = (val) => {
                gatherSizeBtns.forEach(btn => {
                    const active = (btn.dataset.size || '').toUpperCase() === (val || '').toUpperCase();
                    btn.style.background = active ? '#ffcf6a' : '#2a2035';
                    btn.style.color = active ? '#16121a' : '#bbb';
                    btn.style.borderColor = active ? '#ffcf6a' : '#4a3b55';
                });
            };
            updateActiveGatherSizeBtn(currentGatherSize);
            gatherSizeBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const newSize = (btn.dataset.size || 'L').toUpperCase();
                    Settings.set('citymonGatherSize', newSize);
                    updateActiveGatherSizeBtn(newSize);
                    try {
                        if (typeof PocketCity !== 'undefined' && typeof PocketCity.applyGatherSize === 'function') {
                            PocketCity.applyGatherSize(newSize);
                        }
                    } catch (err) {
                        dbg('[UI] сборы гильдии: сбой смены размера', err);
                    }
                });
            });

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
                        UI.pruneFabDuplicates();
                        UI._setFabVisible(true);
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

        // ------------------------------------------------------------
        // v11.7.2: ЕДИНЫЙ РЕКОРДЕР ХОТКЕЕВ «КАРМАННОГО ГОРОДА»
        //
        // Один и тот же механизм обслуживает закреп виджета и 8 зданий.
        // Клик по кнопке включает запись, Esc отменяет её без закрытия
        // модалки (capture-обработчик глушит событие до общего Esc ->
        // closeModals()), одиночные модификаторы игнорируются. Комбинация
        // нормализуется keybindCombo() по e.code (любая раскладка).
        //
        // Бинды зданий — JSON { [roomId]: combo } в localStorage
        // 'LEGION_POCKET_CITY_ROOM_BINDS'. При сохранении одинаковой
        // комбинации она снимается с прежнего слота, чтобы хоткей не
        // срабатывал на два действия.
        // ------------------------------------------------------------
        _initPocketCityBindRecorders(modal) {
            if (!modal) return;

            this._bindRecorders = [];
            this._bindRecording = false;
            this._bindRecordingOwner = null;
            this._bindCleanup = null;

            const pocketBtn = modal.querySelector('#modal-bind-pocket-city');
            if (pocketBtn) {
                this._registerBindRecorder({
                    btn: pocketBtn,
                    clearBtn: modal.querySelector('#modal-bind-pocket-city-clear'),
                    target: 'pocket',
                    labelEmpty: 'Не назначено',
                    get: () => {
                        try { return String(localStorage.getItem(POCKET_CITY_BIND_KEY) || '').trim(); }
                        catch (e) { return ''; }
                    },
                    set: (combo) => {
                        try {
                            localStorage.setItem(POCKET_CITY_BIND_KEY, combo || '');
                            return true;
                        } catch (e) {
                            dbg('[UI] не удалось сохранить хоткей Карманного Города', e);
                            return false;
                        }
                    }
                });
            }

            modal.querySelectorAll('.lg-room-bind-btn').forEach(btn => {
                const roomId = String(btn.dataset.room || '');
                if (!roomId) return;
                this._registerBindRecorder({
                    btn,
                    clearBtn: modal.querySelector(`.lg-room-bind-clear[data-room="${roomId}"]`),
                    target: `room:${roomId}`,
                    roomId,
                    labelEmpty: '—',
                    get: () => this._readRoomBinds()[roomId] || '',
                    set: (combo) => {
                        const map = this._readRoomBinds();
                        if (combo) map[roomId] = combo;
                        else delete map[roomId];
                        return this._writeRoomBinds(map);
                    }
                });
            });

            this._refreshBindLabels();
        },

        /** Один слот бинда: кнопка, сброс, чтение/запись значения и запись клавиши. */
        _registerBindRecorder(opts) {
            const self = this;
            const btn = opts.btn;
            const clearBtn = opts.clearBtn;
            const get = opts.get;
            const set = opts.set;
            const clear = opts.clear || (() => set(''));
            const labelEmpty = opts.labelEmpty || '—';
            let recording = false;

            const applyLabel = () => {
                const current = get() || '';
                btn.textContent = recording ? 'Нажмите...' : (current || labelEmpty);
                btn.classList.toggle('recording', recording);
                btn.title = recording
                    ? 'Нажмите комбинацию, Esc — отмена'
                    : (current ? `Комбинация: ${current}` : 'Назначить клавишу');
            };

            const onKeyDown = (e) => {
                if (!recording) return;
                // Модалку могли убрать мимо closeModals() — тихо снимаем запись.
                if (!btn.isConnected) { stop(); return; }

                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    stop();
                    return;
                }
                // Одиночные модификаторы не фиксируем: ждём основную клавишу.
                if (isKeybindModifier(e)) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                const combo = keybindCombo(e);
                if (!combo) return;

                e.preventDefault();
                e.stopPropagation();
                stop();
                // Сначала снимаем ту же комбинацию с других слотов, затем
                // записываем её в текущий: один хоткей — одно действие.
                self._clearBindConflicts(combo, opts.target);
                const ok = set(combo);
                self._refreshBindLabels();
                UI.showToast(ok
                    ? `⌨️ Хоткей сохранён: ${combo}`
                    : 'Не удалось сохранить хоткей', !ok);
            };

            // function-декларация: onKeyDown ссылается на stop, а stop — на
            // onKeyDown; хойстинг убирает TDZ-вопрос при чтении кода.
            function stop() {
                recording = false;
                self._bindRecording = false;
                if (self._bindRecordingOwner === btn) self._bindRecordingOwner = null;
                if (self._bindCleanup === stop) self._bindCleanup = null;
                document.removeEventListener('keydown', onKeyDown, true);
                applyLabel();
            }

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (recording) { stop(); return; }
                // Начать новую запись можно только после остановки прежней.
                self._stopBindRecording();
                recording = true;
                self._bindRecording = true;
                self._bindRecordingOwner = btn;
                self._bindCleanup = stop;
                self._refreshBindLabels();
                // capture: перехватываем раньше общего Esc -> UI.closeModals().
                document.addEventListener('keydown', onKeyDown, true);
            });

            if (clearBtn) {
                clearBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (recording) stop();
                    clear();
                    self._refreshBindLabels();
                    UI.showToast('⌨️ Хоткей сброшен');
                });
            }

            this._bindRecorders.push({ btn, refresh: applyLabel });
            applyLabel();
        },

        /** Бинды зданий: JSON { [roomId]: combo }, битые данные = пусто. */
        _readRoomBinds() {
            try {
                const raw = localStorage.getItem('LEGION_POCKET_CITY_ROOM_BINDS');
                if (!raw) return {};
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
                const out = {};
                for (const [roomId, combo] of Object.entries(parsed)) {
                    if (typeof combo === 'string' && combo.trim()) out[roomId] = combo.trim();
                }
                return out;
            } catch (e) {
                return {};
            }
        },

        _writeRoomBinds(map) {
            try {
                localStorage.setItem('LEGION_POCKET_CITY_ROOM_BINDS', JSON.stringify(map || {}));
                return true;
            } catch (e) {
                dbg('[UI] не удалось сохранить хоткеи зданий Города', e);
                return false;
            }
        },

        /**
         * Снять комбинацию с других слотов, если она уже занята.
         * @param {string} combo  нормализованная комбинация
         * @param {string} target 'pocket' либо 'room:<id>' — текущий слот
         */
        _clearBindConflicts(combo, target) {
            if (!combo) return;
            let changed = false;
            const rooms = this._readRoomBinds();

            // Закреп виджета не должен делить клавишу с зданием.
            if (target !== 'pocket') {
                try {
                    if (String(localStorage.getItem(POCKET_CITY_BIND_KEY) || '').trim() === combo) {
                        localStorage.setItem(POCKET_CITY_BIND_KEY, '');
                        changed = true;
                    }
                } catch (e) {}
            }

            for (const roomId of Object.keys(rooms)) {
                if (target === `room:${roomId}`) continue;
                if (rooms[roomId] === combo) {
                    delete rooms[roomId];
                    changed = true;
                }
            }
            if (changed) this._writeRoomBinds(rooms);
        },

        /** Обновить подписи всех кнопок-рекордеров открытой модалки. */
        _refreshBindLabels() {
            if (!Array.isArray(this._bindRecorders)) return;
            this._bindRecorders.forEach(item => {
                try { item.refresh(); } catch (e) {}
            });
        },

        /** Снять активную запись хоткея (closeModals / повторное открытие). */
        _stopBindRecording() {
            this._bindRecording = false;
            this._bindRecordingOwner = null;
            const cleanup = this._bindCleanup;
            this._bindCleanup = null;
            if (typeof cleanup === 'function') cleanup();
        },
        /**
         * «💛 Благодарность» из футера FAB-меню: титры с никами тех, кто
         * помог аддону. Разметка — UITemplates.thanksModal(), закрытие
         * (крестик / Esc / клик по затемнению при наличии) — общий showModal.
         */
        openThanks() {
            return this.showModal(UITemplates.thanksModal(), { compact: true, customClass: 'lg-thanks-modal' });
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

            // ПАТЧ 11.6.6e: снимаем inline-координаты, выставленные в прошлый
            // раз для нативной кнопки, иначе меню «прилипнет» к краю экрана
            // и в шахте, где снова работает плавающая FAB.
            this._resetMenuPosition(menu);

            // ПАТЧ 11.6.6e: в городе вход — кнопка «Аддон» в нижнем баре.
            // Раньше якорем всегда считалась плавающая FAB, но в городе она
            // скрыта (display:none), и меню (position:absolute от
            // .legion-fab-wrap) уезжало в правый нижний угол экрана.
            const nativeBtn = this._getNativeNavButton();
            if ((this._navMode === 'native' || nativeBtn) && this._positionMenuAboveButton(menu, nativeBtn)) {
                menu.classList.remove('open-down');
                menu.classList.add('open');
                return true;
            }

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

        // ПАТЧ 11.6.6e: нативная кнопка «Аддон» в баре города (создаётся в
        // syncNavButton). Берём только реально отрисованную: бар скрывается
        // при открытом окне героя/чате на мобиле — тогда единственный вход
        // в меню остаётся плавающая FAB, и якорем должна быть она.
        _getNativeNavButton() {
            // ПАТЧ 11.7.2: кнопок в документе может быть несколько — игра
            // пересобирает #gu-hud, а старый узел остаётся в DOM скрытым.
            // Берём только реально отрисованную кнопку в видимом баре.
            const buttons = document.querySelectorAll('.lgu-nav-btn');
            for (const btn of buttons) {
                if (btn.getClientRects().length === 0) continue;
                const bar = btn.closest('#gu-hud .gu-main') || btn.parentElement;
                if (bar && bar.getClientRects().length > 0) return btn;
            }
            return null;
        },

        // ============================================================
        // ПАТЧ 11.7.2: ЕДИНЫЙ КОНТРОЛЛЕР ВХОДА В МЕНЮ АДДОНА
        //
        // Входов в меню два:
        //   • плавающая FAB (.${DOM_IDS.fabWrap}) — шахта, поход, город
        //     с выключенным тумблером или скрытым баром;
        //   • кнопка «Аддон» в нижнем баре города (.lgu-nav-btn).
        //
        // Раньше каждый вход управлял только собой, поэтому при переходах
        // (Карманный Город -> Аукцион и другие здания) и при пересборке
        // игрового HUD в DOM могли остаться несколько FAB: от предыдущего
        // запуска скрипта (другой RAND_ID) или от гонки boot(). Теперь
        // монтирование идемпотентно: перед показом FAB всегда проверяется
        // видимость встроенной кнопки «Аддон», а лишние экземпляры
        // вычищаются из DOM.
        // ============================================================

        /**
         * Все обёртки FAB в документе, включая экземпляры прошлых запусков.
         * DOM_IDS.fabWrap содержит случайный RAND_ID, поэтому ищем ещё и по
         * стабильному суффиксу id/класса «-fab-wrap» (например, x-abcd-fab-wrap).
         * @returns {HTMLElement[]} только верхние обёртки, без вложенных
         */
        _fabWraps() {
            const nodes = new Set();
            const add = (sel) => {
                try { document.querySelectorAll(sel).forEach(el => nodes.add(el)); } catch (e) {}
            };
            add(`.${DOM_IDS.fabWrap}`);
            add(`#${DOM_IDS.fabWrap}`);
            add('[id$="-fab-wrap"]');
            add('[class*="-fab-wrap"]');

            const list = Array.from(nodes);
            // Если селектор зацепил вложенный узел, удалять нужно верхнюю
            // обёртку: иначе останется пустой контейнер с тем же суффиксом.
            return list.filter(el => !list.some(other => other !== el && other.contains(el)));
        },

        /**
         * Оставляет ровно один экземпляр FAB и перепривязывает ссылки
         * this._fabWrap / _fabBtn / _fabMenu к живым узлам DOM.
         * @param {HTMLElement|null} keep обёртка, которую нужно сохранить
         * @returns {HTMLElement|null} каноническая обёртка
         */
        pruneFabDuplicates(keep = null) {
            const wraps = this._fabWraps();
            if (!wraps.length) {
                this._fabWrap = this._fabBtn = this._fabMenu = null;
                return null;
            }

            let canonical = (keep && wraps.includes(keep)) ? keep : null;
            if (!canonical && this._fabWrap && wraps.includes(this._fabWrap)) canonical = this._fabWrap;
            if (!canonical) {
                // Предпочитаем экземпляр текущего запуска (с нашим RAND_ID).
                canonical = wraps.find(el => el.id === DOM_IDS.fabWrap || el.classList.contains(DOM_IDS.fabWrap)) || wraps[0];
            }

            wraps.forEach(el => {
                if (el === canonical) return;
                try { el.remove(); } catch (e) {}
            });

            this._fabWrap = canonical;
            this._fabBtn = canonical.querySelector(`#${DOM_IDS.fabBtn}`)
                || canonical.querySelector(`.${DOM_IDS.fabBtn}`)
                || canonical.querySelector('.legion-fab-btn');
            this._fabMenu = canonical.querySelector(`#${DOM_IDS.fabMenu}`)
                || canonical.querySelector(`.${DOM_IDS.fabMenu}`)
                || canonical.querySelector('.legion-fab-menu');
            return canonical;
        },

        /** Полностью убирает все обёртки FAB (перед повторным монтированием). */
        removeAllFabs() {
            this._fabWraps().forEach(el => {
                try { el.remove(); } catch (e) {}
            });
            this._fabWrap = this._fabBtn = this._fabMenu = null;
        },

        /** Виден ли сейчас вход «Аддон» в нижнем баре города. */
        hasVisibleNativeNav() {
            const btn = this._getNativeNavButton();
            if (!btn) return false;
            const bar = btn.closest('#gu-hud .gu-main') || btn.parentElement;
            return !!bar && bar.getClientRects().length > 0;
        },

        /**
         * Показ/скрытие FAB по живому узлу (ссылка могла устареть после
         * пересборки игрового DOM). Возвращает false, если кнопки нет.
         */
        _setFabVisible(visible) {
            let btn = (this._fabBtn && this._fabBtn.isConnected) ? this._fabBtn : null;
            if (!btn && this._fabWrap && this._fabWrap.isConnected) {
                btn = this._fabWrap.querySelector(`#${DOM_IDS.fabBtn}`)
                    || this._fabWrap.querySelector(`.${DOM_IDS.fabBtn}`)
                    || this._fabWrap.querySelector('.legion-fab-btn');
            }
            if (!btn) return false;
            this._fabBtn = btn;
            btn.style.display = visible ? 'flex' : 'none';
            return true;
        },

        /**
         * Идемпотентное монтирование FAB. main.js передаёт готовую обёртку
         * (единственное место, где создаётся разметка), а метод:
         *   1) вычищает дубли прошлых запусков, оставляя переданную обёртку;
         *   2) если видна встроенная кнопка «Аддон» — FAB скрывается,
         *      режим сразу переключается на 'native';
         *   3) иначе FAB показывается, режим 'fab'.
         * Повторный вызов не создаёт второй экземпляр и не плодит обработчики.
         *
         * @param {HTMLElement} wrap вновь созданная обёртка FAB
         * @returns {{wrap: HTMLElement, mode: 'fab'|'native'}|null}
         */
        mountFab(wrap) {
            if (!wrap || !wrap.isConnected) return null;

            const canonical = this.pruneFabDuplicates(wrap) || wrap;
            const btn = canonical.querySelector(`#${DOM_IDS.fabBtn}`)
                || canonical.querySelector(`.${DOM_IDS.fabBtn}`)
                || canonical.querySelector('.legion-fab-btn');
            if (!btn) return null;

            this._fabWrap = canonical;
            this._fabBtn = btn;
            this._fabMenu = canonical.querySelector(`#${DOM_IDS.fabMenu}`)
                || canonical.querySelector(`.${DOM_IDS.fabMenu}`)
                || canonical.querySelector('.legion-fab-menu');

            // Встроенная городская кнопка «Аддон» важнее: пока она на экране,
            // плавающий экземпляр не показываем — иначе два входа подряд.
            if (this.hasVisibleNativeNav()) {
                this._setFabVisible(false);
                this._navMode = 'native';
                return { wrap: canonical, mode: 'native' };
            }

            this._setFabVisible(true);
            this._navMode = 'fab';
            return { wrap: canonical, mode: 'fab' };
        },

        // ПАТЧ 11.6.6e: меню — ребёнок .legion-fab-wrap (position:fixed в
        // правом нижнем углу), поэтому position:absolute + right/bottom
        // привязывали его к углу экрана, а не к кнопке. Прибиваем меню к
        // нативной кнопке через position:fixed с координатами окна.
        _positionMenuAboveButton(menu, btn) {
            if (!menu || !btn) return false;
            const rect = btn.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) return false;

            const viewportW = window.innerWidth || 1000;
            const viewportH = window.innerHeight || 800;
            // У скрытого (display:none) меню offsetWidth/scrollHeight равны 0 —
            // берём значения из CSS: min-width 220px, запас по высоте «|| 400».
            const menuWidth = menu.offsetWidth || 220;
            const menuHeight = Math.min(menu.scrollHeight || 400, viewportH - 120);

            // По горизонтали центрируем меню над кнопкой и зажимаем в окно,
            // чтобы у правого края оно не обрезалось.
            let left = rect.left + rect.width / 2 - menuWidth / 2;
            left = Math.max(8, Math.min(left, viewportW - menuWidth - 8));

            menu.style.position = 'fixed';
            menu.style.right = 'auto';
            menu.style.left = left + 'px';

            if (rect.top >= menuHeight + 20) {
                // Место есть — раскрываем над кнопкой:
                // bottom = высота окна − верх кнопки + отступ 10px.
                menu.style.top = 'auto';
                menu.style.bottom = (viewportH - rect.top + 10) + 'px';
            } else {
                // Места сверху мало (мобильный ландшафт) — раскрываем вниз,
                // но не выпускаем меню за нижнюю границу окна.
                menu.style.bottom = 'auto';
                menu.style.top = Math.max(8, Math.min(rect.bottom + 10, viewportH - menuHeight - 8)) + 'px';
            }
            return true;
        },

        // ПАТЧ 11.6.6e: сбрасываем inline-координаты нативной кнопки, чтобы
        // меню снова подчинялось стилям .legion-fab-menu (absolute от wrap).
        _resetMenuPosition(menu) {
            if (!menu) return;
            ['position', 'left', 'right', 'top', 'bottom'].forEach(prop => {
                menu.style.removeProperty(prop);
            });
        },

        closeFabMenu() {
            const menu = this._fabMenu
                || document.getElementById(DOM_IDS.fabMenu)
                || document.getElementById('legion-fab-menu');
            if (!menu) return;
            menu.classList.remove('open');
            menu.classList.remove('open-down');
            // ПАТЧ 11.6.6e: иначе следующее открытие из FAB унаследует
            // координаты нативной кнопки.
            this._resetMenuPosition(menu);
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

        // ПАТЧ 11.6.6g: открыта ли Шахта.
        //
        // Шахта в игре — не вкладка, а полноэкранный оверлей `.mn` (mine.js
        // вешает на body `mn-on`), который лежит ПОВЕРХ «Города». Класс
        // html.gu-city при этом не снимается, поэтому по классам <html> мы
        // по-прежнему «в городе» — и нативная кнопка «Аддон» вместе с баром
        // уезжает под оверлей. Ловим шахту по body.mn-on; запасная проверка —
        // реально отрисованный `.mn` (на случай, если класс не сняли после
        // выхода или оверлей остался висеть в DOM).
        isInMine() {
            if (document.body && document.body.classList.contains('mn-on')) return true;
            const mine = document.querySelector('.mn');
            return !!mine && mine.getClientRects().length > 0;
        },

        // Умное переключение входа в меню:
        //   Город       — есть нативный бар: наша кнопка встаёт первой, FAB прячем;
        //   Шахта/Поход — бара нет: возвращаем плавающую FAB.
        // #gu-hud игра создаёт один раз и после выхода из города оставляет в DOM
        // (скрывая через html.gu-city), поэтому наличия бара ещё не достаточно.
        // ПАТЧ 11.6.6g: шахту (оверлей .mn поверх города, html.gu-city остаётся)
        // проверяем ОТДЕЛЬНО и раньше тумблера — см. первую ветку метода.
        syncNavButton() {
            // ПАТЧ 11.7.2: перед любым решением о показе FAB приводим DOM
            // к инварианту «ровно один экземпляр». Это убирает дубли от
            // второго запуска скрипта/прошлого RAND_ID, в том числе если
            // FAB оказалась поверх встроенной кнопки «Аддон».
            this.pruneFabDuplicates();

            // ПАТЧ 11.6.6g: в шахте бара игры не видно (он под оверлеем `.mn`),
            // поэтому единственный вход в аддон — плавающая FAB. Ветка стоит
            // ДО проверки тумблера: при включённом «📌 Кнопка аддона в нижнем
            // меню игры» нативная кнопка создаётся в баре города, но в шахте
            // она недоступна и должна быть убрана из DOM.
            if (this.isInMine()) {
                document.querySelectorAll('.lgu-nav-btn').forEach(el => el.remove());
                this._setFabVisible(true);
                if (this._navMode !== 'fab') {
                    // Меню нужно гасить только при переходе из города: там оно
                    // привязано координатами к нативной кнопке (position:fixed),
                    // и в шахте эти координаты уже неактуальны. На первом
                    // вызове (_navMode === '') закрывать нечего.
                    const fromNative = this._navMode === 'native';
                    this._navMode = 'fab';
                    if (fromNative) this.closeFabMenu();
                }
                this._navRetries = 0;
                return false;
            }

            // ПАТЧ 11.6.5h: тумблер «📌 Кнопка аддона в нижнем меню игры».
            // Выключен — нативную кнопку не создаём (и убираем уже созданную),
            // а FAB остаётся плавающей в правом нижнем углу даже в городе.
            // Состояние читает _nativeFabEnabled() (localStorage + дубль в
            // памяти), см. ПАТЧ 11.6.5h.1.
            if (!this._nativeFabEnabled()) {
                // 1. Удаляем нативную кнопку из бара игры, если она есть.
                document.querySelectorAll('.lgu-nav-btn').forEach(el => el.remove());
                // 2. Возвращаем плавающую FAB (её мог спрятать нативный режим).
                this._setFabVisible(true);
                this._navMode = 'fab';
                this._navRetries = 0;
                return false;
            }

            const bar = document.querySelector('#gu-hud .gu-main');
            const inCity = !!bar && document.documentElement.classList.contains('gu-city');

            if (inCity) {
                this._navRetries = 0;

                // ПАТЧ 11.7.2: один «Аддон» на актуальный бар. После
                // пересборки #gu-hud (например, при открытии Аукциона из
                // Карманного Города) в DOM могут остаться кнопки старого
                // бара — удаляем их, оставляя единственную актуальную.
                const buttons = Array.from(document.querySelectorAll('.lgu-nav-btn'));
                const current = buttons.find(el => el.parentElement === bar) || null;
                buttons.forEach(el => {
                    if (el === current) return;
                    try { el.remove(); } catch (e) {}
                });
                if (!current) {
                    bar.prepend(this.createNativeNavButton());
                }

                if (this._navMode !== 'native') {
                    this._navMode = 'native';
                    // Меню, открытое в шахте, не должно висеть в городе без FAB.
                    this.closeFabMenu();
                }
                // Бар бывает скрыт (открыто окно героя, чат на мобиле) —
                // тогда FAB оставляем, иначе в меню аддона было бы не попасть.
                // ПАТЧ 11.7.2: смотрим именно на видимость встроенной кнопки
                // «Аддон»: пока она на экране, плавающий дубль не показываем.
                this._setFabVisible(!this.hasVisibleNativeNav());
                return true;
            }

            // Не город: активный вход — плавающая FAB. Оставшиеся в скрытом
            // баре кнопки «Аддон» больше не нужны (актуальная создастся при
            // возвращении в город) и не должны дублировать FAB.
            document.querySelectorAll('.lgu-nav-btn').forEach(el => el.remove());
            this._navMode = 'fab';
            this._setFabVisible(true);

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
                    // ПАТЧ 11.6.6e: единая точка входа — toggleFabMenu() сама
                    // выбирает якорь (FAB или кнопка в баре города) и
                    // раскрывает меню в свободную сторону.
                    UI.toggleFabMenu();
                }
            });

            // Закрытие меню при клике снаружи
            document.addEventListener('pointerdown', (e) => {
                if (!wrap.contains(e.target)) {
                    UI.closeFabMenu();
                }
            });

            // Закрытие меню при клике по любому пункту (кроме чекбокса)
            menu.querySelectorAll('.fab-menu-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.tagName === 'INPUT' || e.target.closest('input')) return;
                    UI.closeFabMenu();
                });
            });

            // Аккордеон: клик по заголовку секции сворачивает/разворачивает её.
            // stopPropagation не даёт событию дойти до обработчиков меню и страницы.
            menu.querySelectorAll('.fab-section-title').forEach(title => {
                const toggleSection = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const section = title.parentElement;
                    if (section) section.classList.toggle('collapsed');
                };
                title.addEventListener('click', toggleSection);
                title.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') toggleSection(e);
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
                           location.pathname.includes('/mine');
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
        // HUD профиля: настройки блоков, баффы и статус героя.
        // ------------------------------------------------------------

        // Какие блоки показывать в HUD. Ключ LEGION_HUD_SETTINGS общий для
        // всех персонажей. Битый/отсутствующий JSON не должен ломать HUD —
        // в этом случае возвращаем дефолты (всё включено).
        getHudSettings() {
            const defaults = {
                showLoc: true,
                showXp: true,
                showStats: true,
                showBuffs: true,
                // v11.7.2: новые блоки карточки профиля.
                showSecondary: true,
                showQuickActions: true
            };
            try {
                const raw = localStorage.getItem('LEGION_HUD_SETTINGS');
                if (raw) return { ...defaults, ...JSON.parse(raw) };
            } catch (e) {}
            return defaults;
        },

        /**
         * v11.7.2: подпись длительности для таймера HP (hero.hpFullIn — мс).
         * Формат игры: часы/минуты, на последней минуте — секунды.
         */
        _hudDuration(ms) {
            const left = Math.max(0, Number(ms) || 0);
            if (left <= 0) return '';
            if (left >= 3600000) {
                const h = Math.floor(left / 3600000);
                const m = Math.round((left % 3600000) / 60000);
                return m > 0 ? `${h}ч ${m}м` : `${h}ч`;
            }
            if (left >= 60000) return `${Math.ceil(left / 60000)}м`;
            return `${Math.max(1, Math.ceil(left / 1000))}с`;
        },

        /**
         * Актуальный снимок героя для HUD. Если живой канал только что
         * присылал `me`, его снимок свежее G.ME (и доступен даже в песочнице,
         * где G.ME может быть undefined). Иначе — штатный G.ME, затем __lgHero.
         */
        _currentHeroSnapshot() {
            const live = window.__lgHero;
            const gmHero = G.ME?.hero || G.ME?.me || null;
            if (live && this._heroLiveSeenAt && (Date.now() - this._heroLiveSeenAt) < 5000) {
                return live;
            }
            return gmHero || live || null;
        },

        /**
         * HP героя для шаблона: now / max / процент / таймер восстановления.
         * hero.stats.hp — максимум (docs/API.md), hpMax/maxHp/mhp — фолбэки
         * старых снимков. hpFullIn — сколько мс осталось до полного HP
         * (site/app.js: h.hpFullIn), 0/undefined — таймера нет.
         */
        _hudHp(hero) {
            const h = hero || {};
            const nowRaw = h.hpNow !== undefined ? h.hpNow : (h.hp !== undefined ? h.hp : '—');
            const maxRaw = h.stats && h.stats.hp !== undefined
                ? h.stats.hp
                : (h.hpMax !== undefined ? h.hpMax : (h.maxHp !== undefined ? h.maxHp : h.mhp));
            const now = Number(nowRaw);
            const max = Number(maxRaw);
            const fullIn = Math.max(0, Number(h.hpFullIn) || 0);
            return {
                now: Number.isFinite(now) ? now : nowRaw,
                max: Number.isFinite(max) && max > 0 ? max : null,
                fullIn,
                timer: (Number.isFinite(now) && Number.isFinite(max) && max > 0 && now < max && fullIn > 0)
                    ? this._hudDuration(fullIn)
                    : ''
            };
        },

        /**
         * Активность героя.
         *
         * hero.mn (docs/API.md, app.js mineList) — это СПРАВОЧНИК шахт:
         * { home: { nm, dist, bi, dg, gem, i, q } }. Поля nm/dist/bi/dg/gem
         * постоянные, а добыча обозначается индексом забоя i: i >= 0 —
         * герой реально копает здесь (app.js: busy = m.i >= 0). Поэтому
         * наличие mn.home.nm само по себе НЕ значит, что игрок в шахте.
         *
         * Дополнительно учитываем физический экран шахты (.mn-world /
         * .mn-screen), а в конце — смерть/призрака, бой и активные баффы.
         * Если ничего нет — нейтральное «Свободен», без ложной шахты.
         */
        _hudActivity(hero) {
            const h = hero || {};

            const q = h.ql;
            if (q && typeof q === 'object' && q.on !== false) {
                const name = q.name || q.rn || q.kind || q.k || '';
                return { text: name ? `🚩 Поход: ${name}` : '🚩 В походе', color: '#ff9900' };
            }

            // Активный забой: m.i — индекс камня, который копает герой.
            const activeMine = Object.values(h.mn || {}).find(m => m && typeof m.i === 'number' && m.i >= 0);
            if (activeMine) {
                return { text: `⛏️ ${activeMine.nm || 'Шахта'}`, color: '#4cc95a' };
            }

            // Игрок физически в шахте, но между забоями/смотрит экран.
            const onMineScreen = !!document.querySelector('.mn-world') || !!document.querySelector('.mn-screen');
            if (onMineScreen) return { text: '⛏️ Шахта', color: '#4cc95a' };

            const status = this._hudStatus(h);
            if (status && /Мертв|Призрак/.test(status.text)) return status;

            if (h.busy) return { text: '⚔️ Занят боем', color: '#ffcf6a' };

            const buffs = this._hudBuffs(h);
            if (buffs.length) {
                const names = buffs.map(b => b.title).filter(Boolean).join(', ');
                return { text: names ? `✨ ${names}` : '✨ Под эффектом', color: '#ffcf6a' };
            }

            return { text: '🌿 Свободен', color: '#9aa4b2' };
        },

        /**
         * Вторичные характеристики hero.xs (docs/API.md). Нули не показываем:
         * игроку важен только реальный вклад. Иконки — визуальные маркеры.
         */
        _hudSecondaryStats(hero) {
            const xs = (hero && hero.xs) || null;
            if (!xs || typeof xs !== 'object') return [];
            const defs = [
                ['critDmg', '💢', 'Крит. урон', '%'],
                ['dodge', '🌀', 'Уклонение', '%'],
                ['pierce', '🗡️', 'Пробивание', ''],
                ['healPow', '💚', 'Сила лечения', '%'],
                ['luck', '🍀', 'Удача', ''],
                ['resist', '🛡️', 'Сопротивление', '%']
            ];
            const out = [];
            for (const [key, icon, label, suffix] of defs) {
                const val = Number(xs[key]);
                if (Number.isFinite(val) && val > 0) {
                    out.push({ icon, label, value: `${val}${suffix}` });
                }
            }
            return out;
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
            const classColor = (typeof BuildSim !== 'undefined' && BuildSim.classColors?.[rawClass]) || '#caa55c';
            const lvl = hero?.lvl || hero?.level || hero?.l || 1;

            // Здоровье: now / max / процент / таймер восстановления (hpFullIn).
            // Значения нормализует _hudHp(), шаблон только рисует.
            const hp = this._hudHp(hero);

            // Монеты: hero.money
            const moneyVal = hero?.money !== undefined ? hero.money : (hero?.coins !== undefined ? hero.coins : (hero?.gold !== undefined ? hero.gold : 0));

            // Опыт и локация — общими хелперами (их же использует интервал ниже).
            const { xp, xpNext } = this._heroXp(hero);
            const loc = this._detectHudLocation();

            // Настройки HUD + расширенные данные.
            const settings = this.getHudSettings();
            const buffs = this._hudBuffs(hero);
            const status = this._hudStatus(hero);
            const activity = this._hudActivity(hero);
            const secondary = this._hudSecondaryStats(hero);

            // Статы: atk/mag/def клиент отдаёт в hero.stats, крит — в hero.xs
            // (реже в hero.stats.crit), поэтому набор нормализуем здесь.
            const hudStats = hero ? {
                atk: hero.stats ? hero.stats.atk : undefined,
                mag: hero.stats ? hero.stats.mag : undefined,
                def: hero.stats ? hero.stats.def : undefined,
                crit: (hero.stats && hero.stats.crit !== undefined) ? hero.stats.crit : (hero.xs ? hero.xs.crit : undefined)
            } : null;

            // Быстрые переходы: кнопка есть только у существующего модуля.
            // Почта — нативная функция игры, поэтому достаточно наличия HUD/API.
            const quick = {
                city: typeof PocketCity !== 'undefined' && typeof PocketCity.open === 'function',
                mail: true,
                players: typeof Players !== 'undefined' && typeof Players.open === 'function'
            };

            // Разметка HUD — в core/ui-templates.js (UITemplates.playerHud):
            // шаблон сам экранирует ник/класс и форматирует монеты.
            hud.innerHTML = UITemplates.playerHud(name, className, lvl, { now: hp.now, max: hp.max }, moneyVal, loc, xp, xpNext, {
                settings,
                stats: hudStats,
                secondary,
                buffs,
                status,
                activity,
                classColor,
                guild: hero?.gt || '',
                debt: Number(hero?.debt) || 0,
                hpTimer: hp.timer,
                quick
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

            // v11.7.2: быстрые кнопки внизу карточки — Город / Почта / Разведка.
            hud.querySelector('#player-hud-qcity')?.addEventListener('click', () => {
                UI.closeFabMenu();
                try { PocketCity.open(); }
                catch (err) { dbg('[HUD] не удалось открыть Карманный Город', err); }
            });
            hud.querySelector('#player-hud-qmail')?.addEventListener('click', () => {
                UI.closeFabMenu();
                UI.openNativeMail();
            });
            hud.querySelector('#player-hud-qplayers')?.addEventListener('click', () => {
                UI.closeFabMenu();
                try {
                    if (typeof Players !== 'undefined' && typeof Players.open === 'function') Players.open();
                    else UI.showToast('Разведка недоступна', true);
                } catch (err) {
                    dbg('[HUD] не удалось открыть Разведку', err);
                    UI.showToast('Разведка недоступна', true);
                }
            });

            // ⚙️ Настройки отображаемых блоков профиля.
            hud.querySelector('#player-hud-settings-btn')?.addEventListener('click', () => {
                const currentSettings = this.getHudSettings();
                UI.showModal(UITemplates.hudSettingsModal(currentSettings), { compact: true });
                // showModal() синхронно вставляет модалку в body — кнопка уже доступна.
                document.getElementById('hud-set-save')?.addEventListener('click', () => {
                    const newSettings = {
                        showLoc: !!document.getElementById('hud-set-loc')?.checked,
                        showXp: !!document.getElementById('hud-set-xp')?.checked,
                        showStats: !!document.getElementById('hud-set-stats')?.checked,
                        showBuffs: !!document.getElementById('hud-set-buffs')?.checked,
                        showSecondary: !!document.getElementById('hud-set-secondary')?.checked,
                        showQuickActions: !!document.getElementById('hud-set-quick')?.checked
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

        /**
         * v11.7.2: нативная почта игры для кнопки «✉️ Почта» в профиле.
         *
         * Кнопка HUD: #gu-hud [data-gu="mail"] (app.js guHudHtml). Пока почта
         * закрыта, игра держит у неё aria-disabled="true" и <span class="gu-soon">;
         * после события lgmail guMail() снимает блокировку. API — window.LGMail
         * с методами open()/on() (app.js).
         *
         * Порядок: заблокированная кнопка без активного API — тост; иначе
         * LGMail.open(); если API ещё не загружен — штатный клик по кнопке.
         * window.fetch/LGMail не патчим.
         */
        openNativeMail() {
            const btn = document.querySelector('#gu-hud [data-gu="mail"]');
            const mail = G.LGMail || (typeof window !== 'undefined' ? window.LGMail : null);
            const apiReady = !!mail && typeof mail.open === 'function';
            const visualLocked = !!btn && (
                btn.getAttribute('aria-disabled') === 'true'
                || btn.classList.contains('gu-soon')
                || !!btn.querySelector('.gu-soon')
            );

            let mailOn = true;
            if (apiReady && typeof mail.on === 'function') {
                try { mailOn = mail.on() !== false; } catch (e) { mailOn = true; }
            }

            if (visualLocked && !mailOn) {
                this.showToast('Почта пока недоступна', true);
                return false;
            }

            if (apiReady) {
                try {
                    mail.open();
                    return true;
                } catch (err) {
                    dbg('[HUD] LGMail.open() не сработал:', err);
                }
            }

            if (btn) {
                try {
                    btn.click();
                    return true;
                } catch (err) {
                    dbg('[HUD] клик по кнопке почты не сработал:', err);
                }
            }

            this.showToast('Почта пока недоступна', true);
            return false;
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

            let hero = this._currentHeroSnapshot();
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

            // Живое обновление HUD: локация, HP, монеты и опыт каждые 1000 мс.
            // Само обновление вынесено в _refreshPlayerHud() — его же зовёт
            // событие `me` живого канала игры (мгновенно, без ожидания тика).
            this._hudTimer = setInterval(() => {
                if (!hud || hud.style.display === 'none') {
                    if (this._hudTimer) {
                        clearInterval(this._hudTimer);
                        this._hudTimer = null;
                    }
                    return;
                }
                const currentHero = this._currentHeroSnapshot();
                this._refreshPlayerHud(hud, currentHero || null);
            }, 1000);

            // v11.7.2: подписка на `me` LGLiveLink — HP/монеты/опыт меняются
            // мгновенно, даже если G.ME недоступен (снимок кладём в __lgHero).
            this.ensureHeroLiveUpdates();

            try {
                const res = await Utils.fetchApi('/api/me');
                const freshHero = res?.hero || res?.body?.hero || res?.me || (res?.hpNow !== undefined ? res : null);
                if (freshHero) {
                    window.__lgHero = freshHero;
                    this._heroLiveSeenAt = Date.now();
                    this.renderPlayerHudContent(hud, freshHero);
                }
            } catch (e) {
                dbg('[HUD] Ошибка запроса /api/me:', e);
            }
        },

        /* ------------------------------------------------------------
         * v11.7.2: ЖИВОЕ ОБНОВЛЕНИЕ ПРОФИЛЯ + ПОДПИСКА НА LGLiveLink
         *
         * LGLiveLink хранит инстанс в замыкании site-live.js, поэтому
         * единственная точка доступа — обёртка его open() (тот же приём,
         * что _hookLiveLink в modules/party.js). window.fetch, LGMine и
         * прочие нативные объекты НЕ патчатся: подписываемся только на
         * штатное SSE-событие `me`. Хук идемпотентен.
         * ---------------------------------------------------------- */

        /** Перерисовать карточку целиком или обновить значения на месте. */
        _refreshPlayerHud(hud, hero) {
            if (!hud || hud.style.display === 'none') return;
            if (!hero) {
                // Героя ещё нет — хотя бы локация (Город / Шахта / Поход).
                const locEl = hud.querySelector('#player-hud-loc');
                if (locEl) {
                    const loc = this._detectHudLocation();
                    locEl.textContent = loc.text;
                    locEl.style.color = loc.color;
                }
                return;
            }
            // Герой появился позже («Загрузка профиля...») либо изменился
            // состав баффов/статус — карточку нужно собрать заново.
            if (hud.dataset.hudReady !== '1'
                || hud.dataset.hudSig !== this._hudSignature(hero)) {
                this.renderPlayerHudContent(hud, hero);
                return;
            }
            this._updatePlayerHudValues(hud, hero);
        },

        /**
         * Точечное обновление значений без перерисовки innerHTML:
         * HP (текст/полоса/таймер), монеты/долг, опыт, локация, активность
         * и подписи баффов. Полная перерисовка сбивала бы drag и фокус.
         */
        _updatePlayerHudValues(hud, hero) {
            if (!hud || !hero) return;

            const loc = this._detectHudLocation();
            const locEl = hud.querySelector('#player-hud-loc');
            if (locEl) {
                locEl.textContent = loc.text;
                locEl.style.color = loc.color;
            }
            const activity = this._hudActivity(hero);
            const actEl = hud.querySelector('#player-hud-activity');
            if (actEl) {
                actEl.textContent = activity.text;
                actEl.style.color = activity.color;
            }

            // HP: текст, процент, градиент (красный/зелёный) и таймер.
            const hp = this._hudHp(hero);
            const hpEl = hud.querySelector('#player-hud-hp');
            if (hpEl) {
                hpEl.textContent = hp.max !== null ? `${hp.now} / ${hp.max}` : hp.now;
            }
            const hpBar = hud.querySelector('#player-hud-hp-bar');
            if (hpBar) {
                const pct = (hp.max && Number.isFinite(Number(hp.now)))
                    ? Math.max(0, Math.min(100, Math.round((Number(hp.now) / hp.max) * 100)))
                    : 0;
                hpBar.style.width = `${pct}%`;
                hpBar.style.background = pct <= 30
                    ? 'linear-gradient(90deg, #7a1f2c, #ff5a7a)'
                    : pct <= 60
                        ? 'linear-gradient(90deg, #7a5a1f, #ffcf6a)'
                        : 'linear-gradient(90deg, #1f7a3a, #4cc95a)';
            }
            const hpTimerEl = hud.querySelector('#player-hud-hp-timer');
            if (hpTimerEl) {
                if (hp.timer) {
                    hpTimerEl.textContent = `⏱ До полного: ${hp.timer}`;
                    hpTimerEl.style.display = '';
                } else {
                    hpTimerEl.textContent = '';
                    hpTimerEl.style.display = 'none';
                }
            }

            // Монеты и долг (строка долга скрыта, пока debt <= 0).
            const moneyEl = hud.querySelector('#player-hud-money');
            if (moneyEl) {
                const mon = hero.money !== undefined ? hero.money : (hero.coins !== undefined ? hero.coins : (hero.gold !== undefined ? hero.gold : 0));
                moneyEl.textContent = Utils.formatMoney(mon);
            }
            const debt = Number(hero.debt) || 0;
            const debtRow = hud.querySelector('#player-hud-debt-row');
            if (debtRow) debtRow.style.display = debt > 0 ? 'flex' : 'none';
            const debtEl = hud.querySelector('#player-hud-debt');
            if (debtEl) debtEl.textContent = debt > 0 ? Utils.formatMoney(debt) : '';

            // Опыт: цифры, процент и полоса прогресса уровня.
            const xpEl = hud.querySelector('#player-hud-xp-text');
            const xpBar = hud.querySelector('#player-hud-xp-bar');
            const xpPctEl = hud.querySelector('#player-hud-xp-pct');
            if (xpEl || xpBar) {
                const { xp, xpNext } = this._heroXp(hero);
                // Math.max(1, …) — защита от деления на 0; 100 — потолок полосы.
                const pct = Math.max(0, Math.min(100, Math.floor((xp / Math.max(1, xpNext)) * 100)));
                if (xpEl) xpEl.textContent = `${xp} / ${xpNext}`;
                if (xpPctEl) xpPctEl.textContent = `${pct}%`;
                if (xpBar) xpBar.style.width = `${pct}%`;
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
        },

        /** Мгновенное событие `me` живого канала: обновляем __lgHero и HUD. */
        _onHeroLiveUpdate(hero) {
            if (this._heroLiveDead) return;
            if (!hero || typeof hero !== 'object') return;
            // Даже если G.ME недоступен, свежий снимок героя теперь есть здесь.
            // В событии `me` нет ql (поход приходит отдельным событием `q`),
            // поэтому недостающие поля берём из прошлого снимка, а не теряем их.
            const prev = window.__lgHero;
            const merged = (prev && typeof prev === 'object')
                ? Object.assign({}, prev, hero)
                : hero;
            window.__lgHero = merged;
            this._heroLiveSeenAt = Date.now();
            const hud = document.getElementById(DOM_IDS.playerHud) || document.getElementById('legion-player-hud');
            if (!hud || hud.style.display === 'none') return;
            this._refreshPlayerHud(hud, merged);
        },

        /**
         * Подписаться на LGLiveLink `me`. Возвращает true, если хук уже стоит.
         * Обёртка идемпотентна: Party._hookLiveLink может навернуть свой слой
         * сверху — он вызывает наш open() и наш слушатель остаётся живым.
         */
        _hookHeroLiveLink() {
            if (this._heroLiveHooked) return true;
            const link = G.LGLiveLink;
            if (!link || typeof link.open !== 'function') return false;

            const self = this;
            const origOpen = link.open;
            const wrapper = function (opts) {
                const instance = origOpen.apply(this, arguments);
                try {
                    if (instance && typeof instance.addEventListener === 'function') {
                        self._heroLiveInstance = instance;
                        instance.addEventListener('me', (e) => {
                            try {
                                const data = JSON.parse(e.data);
                                if (data && data.hero) self._onHeroLiveUpdate(data.hero);
                            } catch (err) {
                                // Битую строку канала игнорируем: игра делает то же.
                            }
                        });
                    }
                } catch (err) {
                    dbg('[UI] LGLiveLink: подписка на `me` не удалась:', err);
                }
                return instance;
            };

            this._heroLiveOrigOpen = origOpen;
            this._heroLiveWrapper = wrapper;
            this._heroLiveHooked = true;
            this._heroLiveDead = false;
            link.open = wrapper;
            dbg('[UI] профиль: подписались на LGLiveLink `me`');
            return true;
        },

        /** Поднять хук сейчас или подождать LGLiveLink (он грузится лениво). */
        ensureHeroLiveUpdates() {
            if (this._heroLiveHooked) return true;
            if (this._hookHeroLiveLink()) {
                if (this._heroLiveRetryTimer) {
                    clearInterval(this._heroLiveRetryTimer);
                    this._heroLiveRetryTimer = null;
                }
                return true;
            }
            if (this._heroLiveRetryTimer) return false;
            let tries = 0;
            this._heroLiveRetryTimer = setInterval(() => {
                tries += 1;
                if (this._hookHeroLiveLink() || tries >= 60) {
                    clearInterval(this._heroLiveRetryTimer);
                    this._heroLiveRetryTimer = null;
                }
            }, 500);
            return false;
        },

        /** Снять обёртку LGLiveLink (shutdown при перезапуске скрипта). */
        _unhookHeroLiveLink() {
            if (this._heroLiveRetryTimer) {
                clearInterval(this._heroLiveRetryTimer);
                this._heroLiveRetryTimer = null;
            }
            const link = G.LGLiveLink;
            if (link && this._heroLiveWrapper && link.open === this._heroLiveWrapper) {
                link.open = this._heroLiveOrigOpen;
            }
            this._heroLiveWrapper = null;
            this._heroLiveOrigOpen = null;
            this._heroLiveInstance = null;
            this._heroLiveHooked = false;
            // Слушатель мог остаться в цепочке под чужим слоем (Party) —
            // помечаем инстанс мёртвым, чтобы он не трогал DOM после shutdown.
            this._heroLiveDead = true;
        }
    };
