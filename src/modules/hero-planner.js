    // ============================================================
    // 4.1. МОДУЛЬ: ПЛАНИРОВЩИК ГЕРОЯ
    // Вкладки: Билды (заглушка → BuildSim), Заточка (рабочий калькулятор).
    // ============================================================
    const HeroPlanner = {
        // Таблица заточки (05_Mechanics.md). TODO: переключить источник на
        // hero.crafts / API в v1.1, если игра начнёт отдавать таблицу.
        ENCH: {
            max: 15,
            chance: [0, 95, 90, 80, 70, 55, 42, 30, 20, 12, 7, 4, 2, 1, 0.5, 0],
            bonus:  [0, 4, 9, 15, 22, 31, 42, 56, 74, 97, 125, 160, 200, 250, 310, 400],
            price:  [0, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5.5, 7.5, 10, 13, 17, 22, 28, 35],
            priceMin: 10,
            slots: ['weapon', 'shield', 'armor', 'helmet', 'trinket']
        },

        // Округление подтверждено живой игрой: и статы, и цена считаются через
        // Math.round. Все вызовы идут сюда — если поведение изменится, правим здесь.
        enchantStat(base, en) {
            const bonus = this.ENCH.bonus[Math.min(15, +en || 0)] || 0;
            return Math.round(base * (1 + bonus / 100));
        },

        enchantCost(itemV, level) {
            const pct = this.ENCH.price[Math.min(15, +level || 0)] || 0;
            return Math.max(this.ENCH.priceMin, Math.round(itemV * pct / 100));
        },

        // Шанс успеха, % (без способов, обычная заточка)
        enchantChance(level) {
            return this.ENCH.chance[Math.min(15, +level || 0)] || 0;
        },

        // Ожидаемое число попыток (при 0% — Infinity)
        expectedAttempts(level) {
            const p = this.enchantChance(level) / 100;
            return p > 0 ? 1 / p : Infinity;
        },

        init() {
            (document.getElementById(DOM_IDS.btnBuildSim) || document.getElementById('btn-build-sim'))
                ?.addEventListener('click', () => this.open());
        },

        async open() {
            UI.showModal(`<h2>⚙️ Планировщик Героя <button class="custom-close" id="custom-close-btn">✖</button></h2><div class="loader">Загрузка данных...</div>`);
            try {
                const me = await Utils.fetchApi('/api/me');
                if (!me || !me.ok || !me.hero) throw new Error('Нет героя');
                const h = me.hero;

                // Предметы для заточки. uid сервер отдаёт не всегда: без него все
                // карточки получили бы одинаковый ключ, поэтому отсутствующий uid
                // заменяем синтетическим (с префиксом локации).
                const mapItems = (arr, prefix) => (arr || [])
                    .filter(it => it && it.slot && this.ENCH.slots.includes(it.slot) && it.v > 0)
                    .map((it, idx) => (it.uid != null && it.uid !== '') ? it : { ...it, uid: `${prefix}-${idx}` });

                const equipped = mapItems(h.items?.filter(x => x.on), 'eq');
                const bag = mapItems(h.items?.filter(x => !x.on), 'bg');
                const storage = mapItems(h.sg?.store, 'st');

                const locations = {
                    equipped: { name: '🛡️ Надето', items: equipped },
                    bag: { name: '🎒 Сумка', items: bag },
                    storage: { name: '📦 Склад', items: storage }
                };

                let currentLocKey = 'equipped';
                let selectedItem = locations[currentLocKey].items[0] || null;

                const tabsHtml = `
                    <button class="modal-tab active" data-tab="hero-build">🛡️ Билды</button>
                    <button class="modal-tab" data-tab="hero-ench">⚒️ Заточка</button>
                `;

                // .tab-content.active — это display:flex (строка), поэтому обеим
                // вкладкам задаём колонку: табы и плитка сверху, таблица снизу.
                const contentHtml = `
                    <div class="tab-content active" id="tab-hero-build" style="flex-direction:column; gap:0;">
                        <div id="hp-buildsim-container" style="display:flex; flex-direction:column; flex:1; min-height:0; overflow:auto; padding-bottom:20px;"></div>
                    </div>
                    <div class="tab-content" id="tab-hero-ench" style="flex-direction:column; gap:10px;">
                        <!-- Суб-табы локаций -->
                        <div style="display:flex; gap:6px; border-bottom:1px solid #44374a; padding-bottom:8px;">
                            <button class="hp-loc-btn active" data-loc="equipped" style="background:#caa55c; color:#1d1620; border:none; padding:6px 12px; border-radius:4px; font-weight:bold; cursor:pointer;">🛡️ Надето</button>
                            <button class="hp-loc-btn" data-loc="bag" style="background:#2a2030; color:#aaa; border:1px solid #44374a; padding:6px 12px; border-radius:4px; font-weight:bold; cursor:pointer;">🎒 Сумка</button>
                            <button class="hp-loc-btn" data-loc="storage" style="background:#2a2030; color:#aaa; border:1px solid #44374a; padding:6px 12px; border-radius:4px; font-weight:bold; cursor:pointer;">📦 Склад</button>
                        </div>

                        <!-- Плитка предметов -->
                        <div id="hp-item-grid" style="display:flex; gap:10px; overflow-x:auto; padding:10px 0; min-height:120px; align-items:flex-start;">
                            <!-- Сюда рендерятся карточки -->
                        </div>

                        <!-- Таблица результатов -->
                        <div id="hp-ench-result" style="flex:1; min-height:0; overflow:auto;">
                            <div style="color:#888; text-align:center; padding:20px;">Выберите предмет.</div>
                        </div>
                    </div>
                `;

                const modal = UI.showModal(`
                    <h2>⚙️ Планировщик Героя (${Utils.escapeHtml(h.name || '')}) <button class="custom-close" id="custom-close-btn">✖</button></h2>
                    <div class="modal-tabs">${tabsHtml}</div>
                    ${contentHtml}
                `);

                // Переключение табов. Скоупим на собственный нав-бар HeroPlanner:
                // после BuildSim.mount() внутри #tab-hero-build появляются свои
                // .modal-tab/.tab-content, и глобальные селекторы сбросили бы их.
                const ownTabs = modal?.querySelector('.modal-tabs');
                const ownContents = () => Array.from(modal?.children || []).filter(el => el.classList.contains('tab-content'));
                ownTabs?.querySelectorAll('.modal-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        ownTabs.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                        ownContents().forEach(c => c.classList.remove('active'));
                        tab.classList.add('active');
                        const target = document.getElementById(`tab-${tab.dataset.tab}`);
                        if (target) target.classList.add('active');
                    });
                });

                // Инициализация встроенного планировщика билдов
                const buildCont = document.getElementById('hp-buildsim-container');
                if (buildCont && typeof BuildSim !== 'undefined' && typeof BuildSim.mount === 'function') {
                    BuildSim.mount(buildCont);
                }

                const gridEl = document.getElementById('hp-item-grid');
                const outEl = document.getElementById('hp-ench-result');

                // Рендер таблицы заточки для выбранного предмета
                const renderTable = () => {
                    if (!outEl) return;
                    const item = selectedItem;
                    if (!item) {
                        outEl.innerHTML = `<div style="color:#888; text-align:center; padding:20px;">В этой локации нет предметов для заточки.</div>`;
                        return;
                    }

                    const curEn = +(item.en ?? item.e ?? item.enchant ?? 0);

                    // ПРИОРИТЕТ: stats0 (точные базы из игры). Если нет — вычисляем обратным вычетом.
                    let baseStats = {};
                    const hasStats0 = item.stats0 && Object.keys(item.stats0).length > 0;

                    if (hasStats0) {
                        baseStats = item.stats0;
                    } else {
                        const curBonus = this.ENCH.bonus[Math.min(15, curEn)] || 0;
                        const divisor = 1 + curBonus / 100;
                        for (const [k, v] of Object.entries(item.stats || {})) {
                            baseStats[k] = Math.round(v / divisor);
                        }
                    }

                    let rows = '';
                    let cumulativeCost = 0; // Сумма цен всех уровней до текущего
                    for (let lv = 1; lv <= this.ENCH.max; lv++) {
                        const cost = this.enchantCost(item.v, lv);
                        const chance = this.enchantChance(lv);
                        const isCur = lv === curEn;

                        // Просто суммируем базовую цену попытки, без учета шансов
                        cumulativeCost += cost;
                        const totalCostStr = Utils.formatMoney(cumulativeCost);

                        // Считаем статы от базы (stats0)
                        const statsLine = Object.entries(baseStats).map(([k, base]) => {
                            const final = this.enchantStat(base, lv);
                            return `${BuildSim.statNames[k] || k}: ${final}`;
                        }).join(' · ') || '—';

                        // Цвет редкости/предупреждения
                        let warning = '';
                        if (chance === 0) warning = `<span style="color:#ff5a7a; font-size:11px;">только Seal 15</span>`;
                        else if (chance <= 2) warning = `<span style="color:#ff9900; font-size:11px;">только с печатью</span>`;

                        rows += `<tr style="${isCur ? 'background:rgba(202,165,92,0.12);' : ''}">
                            <td><b>+${lv}</b>${isCur ? ' <small style="color:#ffcf6a;">(текущая)</small>' : ''}</td>
                            <td>${chance}%</td>
                            <td>${Utils.formatMoney(cost)}</td>
                            <td style="color:#ffcf6a; font-weight:bold;">${totalCostStr}</td>
                            <td style="font-size:12px; color:#ccc;">${statsLine}</td>
                            <td>${warning}</td>
                        </tr>`;
                    }

                    outEl.innerHTML = `
                        <div style="background:#26202e; border:1px solid #44374a; border-radius:6px; padding:8px 12px; margin-bottom:10px; font-size:12px;">
                            <b style="color:#ffcf6a;">${Utils.escapeHtml(item.name)}</b>
                            · слот: <b>${Utils.escapeHtml(item.slot)}</b>
                            · редкость: <b>${Utils.escapeHtml(item.rarity || '—')}</b>
                            · v: <b>${item.v}</b>
                            · текущая заточка: <b>+${curEn}</b>
                        </div>
                        <table>
                            <thead><tr>
                                <th>Уровень</th>
                                <th>Шанс</th>
                                <th>Стоимость попытки</th>
                                <th>Суммарно до +N</th>
                                <th>Статы после</th>
                                <th>Примечание</th>
                            </tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                        <div style="margin-top:10px; font-size:11px; color:#888; line-height:1.5;">
                            Стоимость = <code>max(10, round(v × price% / 100))</code>. Округление статов — <code>Math.round</code> (подтверждено игрой).<br>
                            <b>«Суммарно до +N»</b> = сумма всех базовых стоимостей с +1 до +N (без учета шансов и поломок, «идеальная» стоимость).
                        </div>
                    `;
                };

                // Рендер плитки предметов
                const renderGrid = () => {
                    if (!gridEl) return;
                    const locData = locations[currentLocKey];

                    if (!locData.items.length) {
                        gridEl.innerHTML = `<div style="color:#888; font-style:italic; padding:10px;">Нет предметов для заточки</div>`;
                        selectedItem = null;
                        renderTable();
                        return;
                    }

                    // Если текущий выбранный предмет не из этой локации — берем первый
                    if (!locData.items.find(x => x.uid === selectedItem?.uid)) {
                        selectedItem = locData.items[0];
                    }

                    gridEl.innerHTML = locData.items.map(it => {
                        const isSel = it.uid === selectedItem?.uid;
                        // Используем хелпер арта из утилит
                        const art = Utils.getItemArtHtml({ i: it.id ?? it.i, name: it.name }, it);
                        const border = isSel ? '2px solid #caa55c' : '1px solid #44374a';
                        const bg = isSel ? 'rgba(202,165,92,0.15)' : '#1e1724';

                        return `<div class="hp-item-card" data-uid="${Utils.escapeHtml(it.uid)}" title="${Utils.escapeHtml(it.name)}" style="cursor:pointer; min-width:70px; display:flex; flex-direction:column; align-items:center; padding:8px 4px; background:${bg}; border:${border}; border-radius:6px; transition:all 0.15s;">
                            <div style="width:32px; height:32px; display:flex; align-items:center; justify-content:center; margin-bottom:6px; overflow:hidden;">
                                ${art || '📦'}
                            </div>
                            <div style="font-size:10px; color:#ccc; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%;">+${+(it.en || it.e || 0)}</div>
                        </div>`;
                    }).join('');

                    gridEl.querySelectorAll('.hp-item-card').forEach(el => {
                        el.addEventListener('click', () => {
                            // data-uid всегда строка — сравниваем как строки.
                            selectedItem = locData.items.find(x => String(x.uid) === el.dataset.uid);
                            renderGrid(); // Перерисовка для обновления рамки
                            renderTable();
                        });
                    });
                };

                // Суб-табы (Локации)
                const locBtns = modal?.querySelectorAll('.hp-loc-btn');
                locBtns?.forEach(btn => {
                    btn.addEventListener('click', () => {
                        currentLocKey = btn.dataset.loc;
                        locBtns.forEach(b => {
                            b.classList.remove('active');
                            b.style.background = '#2a2030';
                            b.style.color = '#aaa';
                            b.style.border = '1px solid #44374a';
                        });
                        btn.classList.add('active');
                        btn.style.background = '#caa55c';
                        btn.style.color = '#1d1620';
                        btn.style.border = 'none';

                        selectedItem = locations[currentLocKey].items[0] || null;
                        renderGrid();
                        renderTable();
                    });
                });

                renderGrid();
                renderTable();

            } catch (err) {
                dbg('[HERO PLANNER] Ошибка:', err);
                UI.showModal(`<h2>❌ Ошибка <button class="custom-close" id="custom-close-btn">✖</button></h2><p>${Utils.escapeHtml(err.message)}</p>`);
            }
        }
    };
