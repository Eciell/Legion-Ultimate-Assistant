    // ============================================================
    // 6.5. МОДУЛЬ: КАРМАННЫЙ ГОРОД (modules/pocket-city.js)
    //
    // Прямой доступ к официальным зданиям игры из любой локации.
    // Вынесено из core/ui.js (v11.6.0, этап 3): UI остаётся фабрикой
    // модалок/HUD, а вся логика «нативных» зданий живёт здесь.
    // Разметку отдаёт UITemplates.pocketCityModal(), окно — UI.showModal().
    //
    // Подключается после core/ui.js (SHARED_MODULES в build.js): методы
    // зовут UI/UITemplates по вызову, на этапе загрузки зависимостей нет.
    // ============================================================
    const PocketCity = {
        // Модалка со списком зданий: карточка -> нативное здание игры.
        open() {
            const modal = UI.showModal(UITemplates.pocketCityModal());
            if (!modal) return;

            // Обработчики вешаем только на кнопки этой модалки: раньше поиск
            // шёл по всему документу и мог зацепить чужие .pocket-grid-btn.
            modal.querySelectorAll('.pocket-grid-btn').forEach(btn => {
                btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-3px)'; btn.style.boxShadow = '0 6px 15px rgba(0,0,0,0.5)'; });
                btn.addEventListener('mouseleave', () => { btn.style.transform = 'none'; btn.style.boxShadow = 'none'; });
                btn.addEventListener('click', (e) => {
                    const room = e.currentTarget.getAttribute('data-room');
                    UI.closeModals();
                    if (room && typeof PocketCity.openNativeBuilding === 'function') {
                        PocketCity.openNativeBuilding(room);
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
        }
    };
