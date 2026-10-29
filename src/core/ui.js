    // ============================================================
    // 2. UI-ФАБРИКА
    // ============================================================
    const UI = {
        _hudTimer: null,
        _toastTimer: null,
        _toastClickHandler: null,
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
            // openNativeBuilding больше не должен возвращать её на экран.
            window.__POCKET_CITY_OPEN__ = false;
            if (typeof Players !== 'undefined') Players.currentDMPeer = null;
            document.querySelectorAll('.' + DOM_IDS.customModal + ', .custom-modal').forEach(el => el.remove());
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

            // Восстановление позиции из localStorage под ключом LEGION_MODAL_POS
            try {
                const pos = JSON.parse(localStorage.getItem('LEGION_MODAL_POS') || 'null');
                if (pos && pos.left && pos.top) {
                    const leftVal = parseInt(pos.left, 10);
                    const topVal = parseInt(pos.top, 10);
                    const maxLeft = Math.max(10, (window.innerWidth || 1000) - (options.compact ? 100 : 200));
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

            document.body.appendChild(modal);
            const closeBtn = modal.querySelector('#custom-close-btn') || document.getElementById('custom-close-btn');
            if (closeBtn) closeBtn.addEventListener('click', () => this.closeModals());

            // Автоматическое перетаскивание окна за h2
            this.makeDraggable(modal, 'h2');

            return modal;
        },
        // ⚙️ Служебные настройки аддона: Стелс, канал 7TV и перехват чата.
        // Вынесены из FAB-меню в модалку, чтобы меню не разрасталось.
        openSettings() {
            // Флаг стелса живёт в page-context (его ставит hooks.js через unsafeWindow),
            // поэтому читаем оттуда же — иначе в песочнице всегда «ОШИБКА».
            const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            const stealthOn = !!(G && G.__lgStealthActive);
            const chatDisabled = (typeof Chat !== 'undefined') ? !!Chat.disabled : false;

            const modal = this.showModal(`
                <h2>⚙️ Настройки аддона <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="display:flex; flex-direction:column; gap:15px; padding:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#1e1724; padding:10px; border-radius:6px;">
                        <span>🛡️ Стелс-режим</span>
                        <span style="color:${stealthOn ? '#4cc95a' : '#ff5a7a'}; font-weight:bold;">
                            ${stealthOn ? 'АКТИВЕН' : 'ОШИБКА'}
                        </span>
                    </div>
                    <button id="modal-7tv-btn" style="width:100%; padding:10px; background:#2a2030; border:1px solid #caa55c; color:#ffcf6a; border-radius:6px; cursor:pointer; text-align:left;">🎭 Настройки канала 7TV</button>
                    <label style="display:flex; justify-content:space-between; align-items:center; background:#1e1724; padding:10px; border-radius:6px; cursor:pointer;">
                        <span>🚫 Отключить перехват чата</span>
                        <input type="checkbox" id="modal-chk-chat" style="width:16px; height:16px; accent-color:#ff5a7a;" ${chatDisabled ? 'checked' : ''}>
                    </label>
                </div>
            `, { compact: true });

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
        },
        openPocketCity() {
            this.showModal(`
                <h2>🏰 Карманный Город <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="font-size:13px; color:#aaa; margin-bottom:15px; text-align:center;">
                    Прямой доступ к официальным зданиям игры из любой локации:
                </div>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:12px; margin-bottom:10px;">
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
                        <span>Когтекузня</span>
                        <small style="color:#8899aa; font-size:10px; font-weight:normal;">Заточка / Ремонт</small>
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
                </div>
            `);

            document.querySelectorAll('.pocket-grid-btn').forEach(btn => {
                btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-3px)'; btn.style.boxShadow = '0 6px 15px rgba(0,0,0,0.5)'; });
                btn.addEventListener('mouseleave', () => { btn.style.transform = 'none'; btn.style.boxShadow = 'none'; });
                btn.addEventListener('click', (e) => {
                    const room = e.currentTarget.getAttribute('data-room');
                    UI.closeModals();
                    if (room && typeof UI.openNativeBuilding === 'function') {
                        UI.openNativeBuilding(room);
                    }
                });
            });
        },
        async openNativeBuilding(roomId) {
            dbg(`Открытие нативного здания «${roomId}»...`);

            // Игровые объекты (LGCity / LGMine / __lgQuestContext / cityFiles)
            // живут в page-context: после @grant window — песочница, поэтому
            // берём unsafeWindow (G), как это уже делается в chat.js.
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;

            // 1. Безопасно закрываем шахту, если она открыта
            const mnExitBtn = document.querySelector('[data-mn-exit]');
            if (mnExitBtn) {
                try { mnExitBtn.click(); } catch(e) {}
                // Ждём анимацию, чтобы игра успела снять классы и перерисовать вкладки
                await new Promise(r => setTimeout(r, 150));
            }
            if (pageWin.LGMine && typeof pageWin.LGMine.close === 'function') {
                try { pageWin.LGMine.close(); } catch(e) {}
            }

            // Убираем классы шахты, если они застряли
            document.body.classList.remove('mn-on');
            const mnEl = document.querySelector('.mn');
            if (mnEl) {
                mnEl.style.setProperty('opacity', '0', 'important');
                mnEl.style.setProperty('pointer-events', 'none', 'important');
                mnEl.style.setProperty('z-index', '-9999', 'important');
            }

            // 2. Обходим cityLocked (блокировку похода)
            if (pageWin.__lgQuestContext && typeof pageWin.__lgQuestContext.openTown === 'function') {
                try { pageWin.__lgQuestContext.openTown('fair'); } catch (e) {}
            }

            // 3. Гарантируем загрузку скриптов города
            if (!pageWin.LGCity && typeof pageWin.cityFiles === 'function') {
                try { await pageWin.cityFiles(); } catch (e) {}
            }

            // 4. Принудительно переключаем вкладку на Город
            const cityTabBtn = document.querySelector('.tabs button[data-tab="city"]');
            if (cityTabBtn) {
                cityTabBtn.hidden = false;
                cityTabBtn.removeAttribute('aria-disabled');
                cityTabBtn.classList.remove('tab-lock');
                try { cityTabBtn.click(); } catch (e) {}
            }

            document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-city'));
            document.querySelectorAll('.tabs button').forEach(b => {
                const tab = b.dataset?.tab || b.getAttribute?.('data-tab');
                if (tab === 'city') b.setAttribute('aria-current', 'page');
                else b.removeAttribute('aria-current');
            });

            // 5. Защита от выкидывания на карту похода (cityVis).
            // Игра перерисовывает шапку и может заменить узел вкладки, поэтому
            // наблюдение переносим на актуальный #tab-city, когда он меняется.
            const ensureCityObserver = () => {
                const cityTab = document.getElementById('tab-city');
                if (!cityTab) return;

                if (!window.__pocketCityObserver) {
                    window.__pocketCityObserver = new MutationObserver(() => {
                        if (!window.__POCKET_CITY_OPEN__) return;
                        const tab = document.getElementById('tab-city');
                        if (tab && !tab.classList.contains('on')) {
                            tab.classList.add('on');
                            const questTab = document.getElementById('tab-quest');
                            if (questTab) questTab.classList.remove('on');
                        }
                    });
                }
                if (window.__pocketCityObserverTarget !== cityTab) {
                    try { window.__pocketCityObserver.disconnect(); } catch (e) {}
                    window.__pocketCityObserver.observe(cityTab, { attributes: true, attributeFilter: ['class'] });
                    window.__pocketCityObserverTarget = cityTab;
                }
            };
            ensureCityObserver();
            window.__POCKET_CITY_OPEN__ = true;

            // 6. Будим город и вызываем панель
            let attempts = 0;
            let finished = false;
            const interval = setInterval(() => {
                if (finished) return;
                attempts++;
                ensureCityObserver();

                if (pageWin.LGCity && typeof pageWin.LGCity.panel === 'function') {
                    try {
                        if (typeof pageWin.LGCity.wake === 'function') {
                            pageWin.LGCity.wake(); // Будим, если S === null (город уснул)
                        }
                        // Ждём один кадр на сборку DOM
                        requestAnimationFrame(() => {
                            try {
                                pageWin.LGCity.panel(roomId);
                                finished = true;
                                clearInterval(interval);
                            } catch(e) { dbg('panel error:', e); }
                        });
                    } catch (err) {
                        dbg('LGCity.panel attempt failed:', err);
                    }
                }

                if (attempts > 30) {
                    clearInterval(interval);
                    window.__POCKET_CITY_OPEN__ = false;
                    dbg('Город не загрузился вовремя.');
                    UI.showToast('Город не загрузился вовремя', true);
                }
            }, 100);
        },
        setupFab(wrap, btn, menu) {
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
                        if (typeof Players !== 'undefined' && Players.updateFriendsBadge) {
                            Players.updateFriendsBadge();
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

        renderPlayerHudContent(hud, hero) {
            if (!hud) return;
            const name = hero?.name || hero?.n || window.LG_CH?.name || (window.ME?.user?.name) || 'Игрок';
            const rawClass = hero?.class || hero?.c || hero?.sk?.c || 'recruit';
            const className = (typeof BuildSim !== 'undefined' && BuildSim.classNames?.[rawClass]) || rawClass;
            const lvl = hero?.lvl || hero?.level || hero?.l || 1;

            // Здоровье: hero.hpNow / (hero.stats.hp или hero.hpMax)
            const hpNow = hero?.hpNow !== undefined ? hero.hpNow : (hero?.hp !== undefined ? hero.hp : '—');
            const hpMax = hero?.stats?.hp !== undefined ? hero.stats.hp : (hero?.hpMax !== undefined ? hero.hpMax : (hero?.maxHp || hero?.mhp || '—'));

            // Монеты: hero.money
            const moneyVal = hero?.money !== undefined ? hero.money : (hero?.coins !== undefined ? hero.coins : (hero?.gold !== undefined ? hero.gold : 0));

            const inMine = !!document.querySelector('.mn-world') ||
                           location.search.includes('sid=') ||
                           location.pathname.includes('/mine') ||
                           !!document.querySelector('.mn-screen') ||
                           (typeof Chat !== 'undefined' && Chat.isInMine && Chat.isInMine());
            const locText = inMine ? '⛏️ Шахта' : '🏙️ Город';
            const locColor = inMine ? '#4cc95a' : '#8fd3ff';

            hud.innerHTML = `
                <div class="player-hud-header" id="player-hud-drag-handle">
                    <span style="font-weight:bold; color:#ffcf6a; font-size:12px; display:flex; align-items:center; gap:4px;">
                        <span>👤</span> <span>${Utils.escapeHtml(name)}</span>
                    </span>
                    <button class="player-hud-close" id="player-hud-close-btn" title="Закрыть">✖</button>
                </div>
                <div class="player-hud-body">
                    <div class="player-hud-row">
                        <span class="player-hud-label">Класс:</span>
                        <span class="player-hud-val" style="color:#f7d794;">${Utils.escapeHtml(className)} (ур. ${lvl})</span>
                    </div>
                    <div class="player-hud-row">
                        <span class="player-hud-label">Здоровье:</span>
                        <span class="player-hud-val" id="player-hud-hp" style="color:#ff5a7a;">❤️ ${hpNow} / ${hpMax}</span>
                    </div>
                    <div class="player-hud-row">
                        <span class="player-hud-label">Монеты:</span>
                        <span class="player-hud-val" id="player-hud-money" style="color:#ffcf6a;">🪙 ${Utils.formatMoney(moneyVal)}</span>
                    </div>
                    <div class="player-hud-row">
                        <span class="player-hud-label">Локация:</span>
                        <span class="player-hud-val" id="player-hud-loc" style="color:${locColor};">${locText}</span>
                    </div>
                </div>
            `;

            hud.querySelector('#player-hud-close-btn')?.addEventListener('click', () => {
                hud.style.display = 'none';
                if (UI._hudTimer) {
                    clearInterval(UI._hudTimer);
                    UI._hudTimer = null;
                }
            });
        },

        setupPlayerHudDrag(hud) {
            let dragging = false, offX = 0, offY = 0;
            hud.addEventListener('pointerdown', (e) => {
                if (e.target.closest('#player-hud-close-btn') || !e.target.closest('#player-hud-drag-handle')) return;
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

            let hero = window.ME?.hero || window.ME?.me || window.__lgHero;
            if (hero) {
                this.renderPlayerHudContent(hud, hero);
            } else {
                hud.innerHTML = `
                    <div class="player-hud-header" id="player-hud-drag-handle">
                        <span style="font-weight:bold; color:#ffcf6a; font-size:12px;">👤 Профиль</span>
                        <button class="player-hud-close" id="player-hud-close-btn" title="Закрыть">✖</button>
                    </div>
                    <div class="player-hud-body" style="text-align:center; color:#aaa; padding:15px 10px;">
                        Загрузка профиля...
                    </div>
                `;
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

            // Динамическая локация и показатели каждые 1000 мс (§ Задача 1)
            this._hudTimer = setInterval(() => {
                if (!hud || hud.style.display === 'none') {
                    if (this._hudTimer) {
                        clearInterval(this._hudTimer);
                        this._hudTimer = null;
                    }
                    return;
                }
                const locEl = hud.querySelector('#player-hud-loc');
                if (locEl) {
                    const inMine = !!document.querySelector('.mn-world') ||
                                   location.search.includes('sid=') ||
                                   location.pathname.includes('/mine') ||
                                   !!document.querySelector('.mn-screen') ||
                                   (typeof Chat !== 'undefined' && Chat.isInMine && Chat.isInMine());
                    locEl.textContent = inMine ? '⛏️ Шахта' : '🏙️ Город';
                    locEl.style.color = inMine ? '#4cc95a' : '#8fd3ff';
                }

                const currentHero = window.ME?.hero || window.ME?.me || window.__lgHero;
                if (currentHero) {
                    const hpEl = hud.querySelector('#player-hud-hp');
                    if (hpEl) {
                        const curHp = currentHero.hpNow !== undefined ? currentHero.hpNow : (currentHero.hp !== undefined ? currentHero.hp : '—');
                        const mHp = currentHero.stats?.hp !== undefined ? currentHero.stats.hp : (currentHero.hpMax !== undefined ? currentHero.hpMax : (currentHero.maxHp || currentHero.mhp || '—'));
                        hpEl.textContent = `❤️ ${curHp} / ${mHp}`;
                    }
                    const moneyEl = hud.querySelector('#player-hud-money');
                    if (moneyEl) {
                        const mon = currentHero.money !== undefined ? currentHero.money : (currentHero.coins !== undefined ? currentHero.coins : (currentHero.gold !== undefined ? currentHero.gold : 0));
                        moneyEl.textContent = `🪙 ${Utils.formatMoney(mon)}`;
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
