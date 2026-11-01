    // ============================================================
    // 4. МОДУЛЬ: ПЛАНИРОВЩИК БИЛДОВ
    // ============================================================
    const BuildSim = {
        skillsCache: null,
        simulatedSkills: {},
        savedBuilds: {}, // { [clsId]: [{ name, skills }] } — сохранённые в localStorage билды по классам
        _currentBuildName: '', // имя последнего сохранённого/загруженного билда (для будущих фич UI)
        _currentBuildNames: {}, // { [clsId]: name } — активный билд каждого класса (нужен для кнопки «Удалить»)

        statNames: { hp: 'Макс. HP', atk: 'Физ. урон', mag: 'Магия', def: 'Броня', crit: 'Крит %', critDmg: 'Сила крита', dodge: 'Уклонение', pierce: 'Пробивание', healPow: 'Сила лечения', luck: 'Удача', resist: 'Сопротивление' },
        fxNames: { melee: 'Физ. урон %', magic: 'Магия %', hp: 'Макс. HP %', def: 'Броня', healPow: 'Сила лечения %', healIn: 'Вх. лечение %', crit: 'Крит %', critDmg: 'Сила крита', skel: 'Урон скелетов %', skelT: 'Время скелетов', leech: 'Вампиризм %', block: 'Снижение урона %', dodge: 'Уклонение %', lead: 'Урон по боссам %', first: 'Урон 1-й ход %', dmg: 'Весь урон %', pierce: 'Пробивание %', resist: 'Сопротивление', healCrit: 'Крит лечения %', regen: 'Регенерация %', low: 'Урон при низком HP %', a_siyanie: 'Сияние +%', a_obereg: 'Оберег +%', a_dlan: 'Длань +%', a_aura: 'Аура +%', aura: 'Аура −урон %', a_svet: 'Свет +%', a_vspyshka: 'Вспышка +%', a_oznob: 'Озноб +%', a_pricel: 'Прицел +%', a_grad: 'Град +%', a_natisk: 'Натиск +%', a_stoyka: 'Стойка +%', a_vspinu: 'Вспину +%', a_yad: 'Яд +%', a_vytyanut: 'Вытянуть +%', a_podnyat: 'Поднять +%', poison: 'Отрава %', steal: 'Кража %', loot: 'Добыча %', skelN: 'Скелетов +', volley: 'Залп +%', shieldBlock: 'Щит блок %', trapDodge: 'Ловушки %', steady: 'Промах→удар %', cleave: 'Замах %', cleaveBoss: 'Замах по боссу %', penBoss: 'Бронебой по боссу %', drain: 'Вытягивание %', hex: 'Проклятие +%', holy: 'По нежити +%', poisonT: 'Время отравы' },
        classNames: { recruit: '🐱 Новобранец', legionary: '🛡️ Легионер', archer: '🏹 Лучник', mage: '🔮 Маг', priest: '✨ Жрец', rogue: '🗡️ Разбойник', necromancer: '💀 Некромант', paladin: '🔨 Паладин' },
        nodeIcons: {
            nec_b_call: '💀', nec_b_grave: '❄️', nec_b_ward: '🛡️', nec_b_raise: '⬆️', nec_b_long: '⏳', nec_b_marrow: '🦴', nec_b_two: '👥', nec_b_hunger: '🍖', nec_b_fast: '⚡', nec_b_legion: '⚔️', nec_b_lich: '👑', nec_b_cap: '🌟',
            nec_l_sip: '🩸', nec_l_pale: '👻', nec_l_cold: '🧊', nec_l_drain: '🌪️', nec_l_thirst: '🥤', nec_l_skin: '🛡️', nec_l_deep: '🕳️', nec_l_regen: '💚', nec_l_low: '😫', nec_l_fast: '💨', nec_l_last: '🏺', nec_l_cap: '♾️',
            nec_d_bolt: '🏹', nec_d_eye: '👁️', nec_d_book: '📖', nec_d_curse: '🪄', nec_d_doom: '🎯', nec_d_mark: '💀', nec_d_hex: '🔮', nec_d_crit: '🦴', nec_d_omen: '☄️', nec_d_fast: '🤫', nec_d_rot: '🦠', nec_d_cap: '🌑',
            pri_h_hands: '🤲', pri_h_grace: '✨', pri_h_ward: '🛡️', pri_h_salve: '🧴', pri_h_cure: '💧', pri_h_quick: '⚡', pri_h_glow: '☀️', pri_h_halo: '😇', pri_h_miracle: '🪄', pri_h_vigil: '👁️', pri_h_spring: '⛲', pri_h_cap: '👑',
            pri_f_vest: '👕', pri_f_psalm: '📜', pri_f_hope: '🕊️', pri_f_wall: '🧱', pri_f_step: '👣', pri_f_omen: '🌟', pri_f_martyr: '🔥', pri_f_calm: '😌', pri_f_saint: '💫', pri_f_resur: '⚰️', pri_f_purity: '💎', pri_f_cap: '😇',
            pri_w_smite: '⚡', pri_w_censer: '🪔', pri_w_zeal: '💢', pri_w_judge: '⚖️', pri_w_sure: '🎯', pri_w_fervor: '❤️‍🔥', pri_w_wrath: '🌩️', pri_w_drain: '🩸', pri_w_last: '🙏', pri_w_doom: '💥', pri_w_dawn: '🌅', pri_w_cap: '🔨'
        },

        getNodeIcon(nodeId) {
            if (this.nodeIcons[nodeId]) return this.nodeIcons[nodeId];
            if (nodeId.startsWith('leg_')) return '⚔️';
            if (nodeId.startsWith('arc_')) return '🏹';
            if (nodeId.startsWith('mag_')) return '🔮';
            if (nodeId.startsWith('pri_')) return '✨';
            if (nodeId.startsWith('rog_')) return '🗡️';
            if (nodeId.startsWith('nec_')) return '💀';
            if (nodeId.startsWith('pal_')) return '🔨';
            return '⭐';
        },
        isSkipFx(key) { return SKIP_FX_PREFIXES.some(p => key.startsWith(p)); },

        // Текст навыка с подстановкой значений из node.fx (там прибавка за 1 ранг).
        // Для неизученного навыка (rank 0) показываем значения 1-го ранга.
        formatNodeText(node, rank) {
            if (!node.text) return '';
            const r = Math.max(1, rank); // Если ранг 0, показываем значение для 1-го ранга
            return node.text.replace(/\{(\w+)\}/g, (match, key) => {
                if (node.fx && node.fx[key] !== undefined) {
                    const val = node.fx[key] * r;
                    // Красивое форматирование: 1.2 -> "1.2", 3.0 -> "3"
                    return Number.isInteger(val) ? val.toString() : val.toFixed(1).replace('.0', '');
                }
                return match; // Если ключа нет в fx, оставляем как есть (или можно '?')
            });
        },

        init() {
            // Кнопка теперь принадлежит HeroPlanner — см. src/modules/hero-planner.js.
            // BuildSim остаётся как модуль и открывается из таба «Билды».
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.sim-node') && !e.target.closest('.sim-card')) {
                    document.querySelectorAll('.sim-card').forEach(c => c.remove());
                }
            });
        },

        async open() {
            const modal = UI.showModal(`<h2>🧮 Планировщик билдов <button class="custom-close" id="custom-close-btn">✖</button></h2><div id="buildsim-modal-body" style="display:flex; flex-direction:column; flex:1; min-height:0;"></div>`);
            const body = modal.querySelector('#buildsim-modal-body');
            if (body) await this.mount(body);
        },

        async mount(container) {
            if (!container) return;
            // Сохранённые билды поднимаем до парсинга /api/me и /api/skills,
            // чтобы UI успел отрисовать список «Мои билды» при первом renderTree.
            this.loadSavedBuilds();
            // Очки при каждом открытии начинаются с нуля (this.simulatedSkills = {}),
            // поэтому и «активного» билда нет: кнопка «Удалить» до выбора/загрузки
            // честно попросит выбрать билд.
            this._currentBuildNames = {};
            this._currentBuildName = '';
            container.innerHTML = `<div class="loader">Загрузка данных...</div>`;
            try {
                const me = await Utils.fetchApi('/api/me');
                if (!me || !me.ok || !me.hero) throw new Error('Нет героя');
                if (!this.skillsCache) this.skillsCache = await Utils.fetchApi('/api/skills');
                if (!this.skillsCache || !this.skillsCache.classes) throw new Error('Нет данных о навыках');

                this.simulatedSkills = {};
                const h = me.hero;
                const equipped = h.items.filter(x => x.on);
                const bag = h.items.filter(x => !x.on && x.wearable);
                const allClasses = (this.skillsCache.classes || []).filter(c => c.branches && c.branches.length > 0);

                let tabsHtml = `<button class="modal-tab active" data-tab="gear">🛡️ Экипировка</button>`;
                allClasses.forEach(c => {
                    tabsHtml += `<button class="modal-tab" data-tab="${c.id}">${this.classNames[c.id] || c.name || c.id}</button>`;
                });

                let contentHtml = `
                    <div class="tab-content active" id="tab-gear">
                        <div style="flex:1;">
                            <h3>Текущие статы</h3>
                            <table><tr><th>Параметр</th><th>Значение</th></tr>`;
                for (const [k, v] of Object.entries(h.stats)) {
                    contentHtml += `<tr><td>${this.statNames[k] || k}</td><td>${v}</td></tr>`;
                }
                contentHtml += `</table></div><div style="flex:2;">
                        <h3>Сравнение с сумкой (что будет, если надеть)</h3>
                        <table><tr><th>Вещь (слот)</th><th>Изменение статов</th></tr>`;
                bag.forEach(item => {
                    const cur = equipped.find(x => x.slot === item.slot);
                    let changes = [];
                    const keys = new Set([...Object.keys(item.stats || {}), ...Object.keys(cur ? cur.stats || {} : {})]);
                    keys.forEach(k => {
                        const nv = (item.stats && item.stats[k]) || 0;
                        const ov = (cur && cur.stats && cur.stats[k]) || 0;
                        const d = nv - ov;
                        if (d !== 0) {
                            changes.push(`<span class="${d > 0 ? 'stat-up' : 'stat-down'}">${d > 0 ? '+' : ''}${d} ${this.statNames[k] || k}</span>`);
                        }
                    });
                    if (!changes.length) changes.push('<span class="stat-eq">Без изменений</span>');
                    contentHtml += `<tr><td><b>${item.name}</b> <br><small style="color:#888">(${item.slot})</small></td><td>${changes.join('<br>')}</td></tr>`;
                });
                contentHtml += `</table></div></div>`;

                allClasses.forEach(c => {
                    contentHtml += `
                        <div class="tab-content" id="tab-${c.id}">
                            <div class="sim-tree-wrap">
                                <div class="sim-tree-inner">
                                    <div class="sim-top-bar" style="display: flex; flex-direction: column; gap: 12px; background: #1e1724; padding: 12px; border-radius: 8px; border: 1px solid #3d2f44; margin-bottom: 15px;">
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div class="sim-free-pts" style="font-size: 14px; color: #eee;">Свободно очков: <span id="free-${c.id}" style="color: #caa55c; font-weight: bold; font-size: 18px;">0</span> <span style="color: #888;">/ ${MAX_POINTS}</span></div>
                                            <button class="sim-reset-btn" data-reset="${c.id}" style="background: rgba(255, 90, 122, 0.1); color: #ff5a7a; border: 1px solid #ff5a7a; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s;">Сбросить всё</button>
                                        </div>
                                        <div style="display: flex; gap: 8px; align-items: center; border-top: 1px solid #3d2f44; padding-top: 12px;">
                                            <input type="text" id="save-name-${c.id}" class="search-bar" style="margin:0; padding:8px 12px; font-size:12px; flex:1; background:#0f0f15; border:1px solid #3d2f44; color:#fff; border-radius:6px; outline:none;" placeholder="Название нового билда...">
                                            <button class="sim-save-btn" data-save="${c.id}" style="background: #28a745; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-size: 12px; font-weight: bold; cursor: pointer;">💾 Сохранить</button>
                                            <select id="load-select-${c.id}" class="search-bar" style="margin:0; padding:8px 12px; font-size:12px; width:180px; background:#0f0f15; border:1px solid #3d2f44; color:#fff; border-radius:6px; cursor:pointer; outline:none;">
                                                <option value="">— Мои билды —</option>
                                            </select>
                                            <button class="sim-del-btn" data-del="${c.id}" style="background: #3a2028; color: #ff5a7a; border: 1px solid #ff5a7a; border-radius: 6px; padding: 8px 12px; font-size: 12px; cursor: pointer;" title="Удалить выбранный билд">🗑️</button>
                                        </div>
                                    </div>
                                    <div class="sim-branches" id="tree-${c.id}"></div>
                                </div>
                            </div>
                            <div class="build-right stats-panel">
                                <h3>Итоговые статы симуляции</h3>
                                <div id="stats-${c.id}"></div>
                            </div>
                        </div>`;
                });

                container.innerHTML = `
                    <div class="modal-tabs">${tabsHtml}</div>
                    ${contentHtml}
                `;

                container.querySelectorAll('.modal-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        container.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                        container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                        tab.classList.add('active');
                        const target = container.querySelector(`#tab-${tab.dataset.tab}`);
                        if (target) target.classList.add('active');
                        if (tab.dataset.tab !== 'gear') this.renderTree(tab.dataset.tab);
                    });
                });

                container.querySelectorAll('[data-reset]').forEach(btn => {
                    btn.addEventListener('click', () => this.resetBuild(btn.dataset.reset));
                });
            } catch (err) {
                dbg('[BUILD SIM] Ошибка монтирования:', err);
                container.innerHTML = `<div style="color:#ff5a7a; text-align:center; padding:20px;">Ошибка: ${err.message}</div>`;
            }
        },

        resetBuild(clsId) {
            this.simulatedSkills[clsId] = {};
            this.renderTree(clsId);
            document.querySelectorAll('.sim-card').forEach(c => c.remove());
        },

        // ------------------------------------------------------------
        // Сохранённые билды (localStorage, ключ LEGION_SAVED_BUILDS).
        // Формат: { [clsId]: [{ name, skills }] }, skills — { [nodeId]: rank }.
        // Ключ общий для всех классов, поэтому запись идёт целиком объектом.
        // ------------------------------------------------------------
        // Активный билд запоминаем и общим полем (по ТЗ), и по классам:
        // иначе после переключения вкладки «Удалить» целилось бы в билд
        // другого класса с тем же именем.
        _setCurrentBuild(clsId, name) {
            this._currentBuildName = name || '';
            if (!this._currentBuildNames) this._currentBuildNames = {};
            if (name) this._currentBuildNames[clsId] = name;
            else delete this._currentBuildNames[clsId];
        },

        loadSavedBuilds() {
            try {
                const raw = localStorage.getItem('LEGION_SAVED_BUILDS');
                if (raw) this.savedBuilds = JSON.parse(raw) || {};
            } catch (e) {
                // Битый JSON / приватный режим — начинаем с чистого списка.
                this.savedBuilds = {};
            }
        },

        saveCurrentBuild(clsId, name) {
            if (!name) return false;
            if (!this.savedBuilds[clsId]) this.savedBuilds[clsId] = [];

            const currentSkills = this.simulatedSkills[clsId] || {};
            // Проверяем, нет ли уже билда с таким именем
            const existing = this.savedBuilds[clsId].findIndex(b => b.name === name);
            const entry = { name: name, skills: { ...currentSkills } };

            if (existing >= 0) this.savedBuilds[clsId][existing] = entry;
            else this.savedBuilds[clsId].push(entry);

            this._setCurrentBuild(clsId, name);
            try {
                localStorage.setItem('LEGION_SAVED_BUILDS', JSON.stringify(this.savedBuilds));
            } catch (e) {}
            return true;
        },

        loadBuild(clsId, index) {
            if (!this.savedBuilds[clsId] || !this.savedBuilds[clsId][index]) return;
            const build = this.savedBuilds[clsId][index];
            this.simulatedSkills[clsId] = { ...build.skills };
            this._setCurrentBuild(clsId, build.name);
            this.renderTree(clsId);
            UI.showToast(`📥 Билд «${build.name}» загружен`);
        },

        deleteBuild(clsId, index) {
            if (!this.savedBuilds[clsId] || !this.savedBuilds[clsId][index]) return;
            const name = this.savedBuilds[clsId][index].name;
            this.savedBuilds[clsId].splice(index, 1);
            // Удалили активный билд — забываем его имя, чтобы «Удалить»
            // не целилась в уже исчезнувшую запись.
            if (this._currentBuildNames && this._currentBuildNames[clsId] === name) {
                this._setCurrentBuild(clsId, '');
            }
            try {
                localStorage.setItem('LEGION_SAVED_BUILDS', JSON.stringify(this.savedBuilds));
            } catch (e) {}
            this.renderTree(clsId);
            UI.showToast(`🗑️ Билд «${name}» удален`);
        },

        // Удаление по имени активного билда: кнопка «🗑️» вызывает именно это.
        // Возвращает true, если запись найдена и удалена.
        deleteCurrentBuild(clsId) {
            const name = this._currentBuildNames ? this._currentBuildNames[clsId] : '';
            const list = this.savedBuilds[clsId] || [];
            const idx = name ? list.findIndex(b => b.name === name) : -1;
            if (idx < 0) {
                UI.showToast('Сначала загрузите или выберите билд', true);
                return false;
            }
            this.deleteBuild(clsId, idx);
            return true;
        },

        yFor(req) {
            if (Y_MAP[req] !== undefined) return Y_MAP[req];
            return 680 - Math.round(((req || 0) / 30) * 600);
        },

        changeSkill(clsId, nodeId, delta, maxRank, preNode, branchReq, branchIds, event) {
            if (event) event.stopPropagation();
            if (!this.simulatedSkills[clsId]) this.simulatedSkills[clsId] = {};
            const simTree = this.simulatedSkills[clsId];
            const current = simTree[nodeId] || 0;
            if (delta > 0) {
                if (current >= maxRank) return;
                if (preNode && !(simTree[preNode] > 0)) return;
                if (branchIds && branchReq > 0) {
                    let branchPts = 0;
                    Object.entries(simTree).forEach(([id, v]) => {
                        if (branchIds.has(id)) branchPts += v;
                    });
                    if (branchPts < branchReq) return;
                }
                let spent = 0; Object.values(simTree).forEach(v => spent += v);
                if (spent >= MAX_POINTS) return;
            }
            if (delta < 0) {
                // Полная симуляция снятия: строим дерево «как будто очко уже снято»
                // и проверяем, что всё оставшееся валидно по ДВУМ правилам игры:
                //   1) прямой prerequisite (node.pre) должен остаться изученным;
                //   2) в ветке должно остаться не меньше очков, чем требует тир (node.req).
                const clsData = (this.skillsCache && Array.isArray(this.skillsCache.classes))
                    ? this.skillsCache.classes.find(c => c.id === clsId)
                    : null;
                const branches = (clsData && Array.isArray(clsData.branches)) ? clsData.branches : [];

                if (branches.length) {
                    const allNodes = branches.flatMap(b => (b && b.nodes) || []);

                    // Копия дерева, а не мутация: откатывать simTree при отказе не нужно.
                    const testTree = { ...simTree };
                    testTree[nodeId] = Math.max(0, current + delta);
                    if (testTree[nodeId] === 0) delete testTree[nodeId];

                    let invalid = false;
                    for (const [id, rank] of Object.entries(testTree)) {
                        if (rank <= 0) continue;
                        const node = allNodes.find(n => n.id === id);
                        if (!node) continue;

                        // 1. Прямая зависимость.
                        if (node.pre && !(testTree[node.pre] > 0)) {
                            invalid = true;
                            break;
                        }

                        // 2. Требование по очкам в ветке. Считаем сумму по ветке
                        //    именно в симулированном дереве: снятие могло опустить
                        //    очки ветки ниже req у оставшихся узлов.
                        if (node.req > 0) {
                            const branch = branches.find(b => b && b.nodes && b.nodes.some(n => n.id === id));
                            if (branch) {
                                const bIds = new Set((branch.nodes || []).map(n => n.id));
                                let bp = 0;
                                Object.entries(testTree).forEach(([cid, cv]) => {
                                    if (bIds.has(cid)) bp += cv;
                                });
                                if (bp < node.req) {
                                    invalid = true;
                                    break;
                                }
                            }
                        }
                    }

                    if (invalid) {
                        UI.showToast('Сначала снимите зависимые навыки', true);
                        return;
                    }
                }
            }
            simTree[nodeId] = Math.max(0, current + delta);
            if (simTree[nodeId] === 0) delete simTree[nodeId];
            this.renderTree(clsId);
            const card = document.querySelector('.sim-card');
            if (card && card.dataset.node === nodeId) this.showNodeCard(clsId, nodeId, null);
        },

        renderTree(clsId) {
            const clsData = this.skillsCache.classes.find(c => c.id === clsId);
            if (!clsData) return;
            const container = document.getElementById(`tree-${clsId}`);
            if (!container) return;

            if (!this.simulatedSkills[clsId]) this.simulatedSkills[clsId] = {};
            const simTree = this.simulatedSkills[clsId];

            let spent = 0; Object.values(simTree).forEach(v => spent += v);
            const freeEl = document.getElementById(`free-${clsId}`);
            if (freeEl) freeEl.textContent = MAX_POINTS - spent;

            let html = '';
            const simStats = {};

            clsData.branches.forEach(branch => {
                let branchPoints = 0;
                (branch.nodes || []).forEach(n => branchPoints += (simTree[n.id] || 0));

                let lines = `<path d="M50% 20 L50% 680" class="trunk" style="stroke:#333;stroke-width:6px;" />`;
                (branch.nodes || []).forEach(node => {
                    if (node.pre) {
                        const parent = branch.nodes.find(n => n.id === node.pre);
                        if (parent) {
                            const pNodes = branch.nodes.filter(n => n.req === parent.req);
                            const cNodes = branch.nodes.filter(n => n.req === node.req);
                            const px = pNodes.length === 1 ? 50 : (pNodes.indexOf(parent) === 0 ? 25 : 75);
                            const cx = cNodes.length === 1 ? 50 : (cNodes.indexOf(node) === 0 ? 25 : 75);
                            const active = (simTree[node.id] || 0) > 0;
                            const py = this.yFor(parent.req);
                            const cy = this.yFor(node.req);
                            lines += `<path d="M${px}% ${py} L${cx}% ${cy}" class="${active ? 'active' : ''}"/>`;
                        }
                    }
                });

                html += `<div class="sim-branch">
                    <div class="sim-branch-header">${branch.name}<div class="sim-branch-pts">${branchPoints} очков</div></div>
                    <svg class="sim-lines" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;overflow:visible;">${lines}</svg>`;

                (branch.nodes || []).forEach(node => {
                    const rank = simTree[node.id] || 0;
                    const locked = branchPoints < node.req || (node.pre && !(simTree[node.pre] > 0));
                    const maxed = rank >= node.max;

                    if (rank > 0 && node.fx) {
                        for (const [k, v] of Object.entries(node.fx)) {
                            if (this.isSkipFx(k)) continue;
                            simStats[k] = (simStats[k] || 0) + (v * rank);
                        }
                    }

                    const tier = branch.nodes.filter(n => n.req === node.req);
                    let left = 50;
                    if (tier.length === 2) left = tier.indexOf(node) === 0 ? 25 : 75;
                    if (tier.length === 3) left = [15, 50, 85][tier.indexOf(node)];

                    let ranksHtml = '';
                    for (let i = 0; i < node.max; i++) ranksHtml += `<i class="${i < rank ? 'filled' : ''}"></i>`;
                    const icon = this.getNodeIcon(node.id);
                    const top = this.yFor(node.req);

                    html += `<div class="sim-node ${locked ? 'locked' : (maxed ? 'maxed' : 'available')}"
                        data-cls="${clsId}" data-node="${node.id}"
                        style="left:${left}%;top:${top}px">
                        <div class="sim-node-icon">${icon}</div>
                        <div class="sim-node-ranks">${ranksHtml}</div>
                        <div class="sim-node-name">${node.name}</div>
                    </div>`;
                });
                html += `</div>`;
            });

            container.innerHTML = html;

            container.querySelectorAll('.sim-node').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showNodeCard(el.dataset.cls, el.dataset.node, e);
                });
            });

            let statsHtml = '';
            if (!Object.keys(simStats).length) {
                statsHtml = `<div style="color:#888;font-style:italic;">Навыки не изучены</div>`;
            } else {
                for (const [k, v] of Object.entries(simStats)) {
                    if (v > 0) {
                        const isPct = !['critDmg', 'skelN', 'skelT', 'def'].includes(k);
                        statsHtml += `<div class="stat-line"><span>${this.fxNames[k] || k}</span><b>+${v.toFixed(1)}${isPct ? '%' : ''}</b></div>`;
                    }
                }
            }
            const statsEl = document.getElementById(`stats-${clsId}`);
            if (statsEl) statsEl.innerHTML = statsHtml;

            // --- Сохранённые билды: список + обработчики ---
            // Верхняя панель (.sim-top-bar) живёт вне #tree-${clsId}, поэтому
            // перерисовка дерева её не убивает — можно просто переназначать
            // .onclick (idempotent) вместо addEventListener в каждом рендере.
            const sel = document.getElementById(`load-select-${clsId}`);
            const delBtn = document.querySelector(`.sim-del-btn[data-del="${clsId}"]`);
            const saveBtn = document.querySelector(`.sim-save-btn[data-save="${clsId}"]`);
            const saveInput = document.getElementById(`save-name-${clsId}`);

            if (sel && saveBtn && delBtn && saveInput) {
                const builds = this.savedBuilds[clsId] || [];
                // Имя билда вводит пользователь → экранируем перед вставкой в innerHTML.
                sel.innerHTML = `<option value="">— Мои билды (${builds.length}) —</option>` +
                    builds.map((b, i) => `<option value="${i}">${Utils.escapeHtml(b.name)}</option>`).join('');

                // Преселект активного билда: видно, что именно удалит «🗑️».
                const currentName = this._currentBuildNames ? (this._currentBuildNames[clsId] || '') : '';
                const currentIdx = currentName ? builds.findIndex(b => b.name === currentName) : -1;
                if (currentIdx >= 0) sel.value = String(currentIdx);
                delBtn.title = currentIdx >= 0
                    ? `Удалить билд «${currentName}»`
                    : 'Удалить выбранный билд';

                saveBtn.onclick = () => {
                    const name = saveInput.value.trim();
                    if (!name) { UI.showToast('Введите имя билда', true); return; }
                    if (this.saveCurrentBuild(clsId, name)) {
                        UI.showToast('💾 Билд сохранен');
                        this.renderTree(clsId); // перерисовка для обновления списка
                    }
                };

                sel.onchange = () => {
                    // Выбор в списке сразу загружает билд и делает его активным;
                    // sel.value после renderTree выставит преселект выше.
                    if (sel.value !== '') this.loadBuild(clsId, +sel.value);
                };

                delBtn.onclick = () => {
                    // Целимся в активный билд (this._currentBuildNames), а не в sel.value:
                    // после перерисовки select сбрасывается на «— Мои билды —»,
                    // из-за чего индекс из sel.value терялся.
                    const targetName = this._currentBuildNames ? (this._currentBuildNames[clsId] || '') : '';
                    if (!targetName) { UI.showToast('Сначала загрузите или выберите билд', true); return; }
                    if (window.confirm(`Удалить билд «${targetName}»?`)) {
                        this.deleteCurrentBuild(clsId);
                    }
                };
            }
        },

        showNodeCard(clsId, nodeId, event) {
            if (event) { event.stopPropagation(); event.preventDefault(); }
            const x = event ? event.clientX : window.innerWidth / 2;
            const y = event ? event.clientY : window.innerHeight / 2;

            document.querySelectorAll('.sim-card').forEach(c => c.remove());
            const clsData = this.skillsCache.classes.find(c => c.id === clsId);
            if (!clsData) return;
            const branch = clsData.branches.find(b => (b.nodes || []).some(n => n.id === nodeId));
            if (!branch) return;
            const node = branch.nodes.find(n => n.id === nodeId);
            if (!node) return;

            if (!this.simulatedSkills[clsId]) this.simulatedSkills[clsId] = {};
            const simTree = this.simulatedSkills[clsId];
            const rank = simTree[nodeId] || 0;

            const branchIds = new Set((branch.nodes || []).map(n => n.id));
            let branchPoints = 0;
            branch.nodes.forEach(n => branchPoints += (simTree[n.id] || 0));
            const locked = branchPoints < node.req || (node.pre && !(simTree[node.pre] > 0));
            const maxed = rank >= node.max;

            let reqText = '';
            if (branchPoints < node.req) reqText = `Требуется очков в ветке: ${node.req}`;
            if (node.pre && !(simTree[node.pre] > 0)) reqText = `Сначала изучите предыдущий навык.`;

            const card = document.createElement('div');
            card.className = 'sim-card';
            card.dataset.node = nodeId;
            card.style.display = 'block';

            const cw = 280, ch = 200;
            let px = x + 15, py = y - 50;
            if (px + cw > window.innerWidth) px = x - cw - 15;
            if (py + ch > window.innerHeight) py = window.innerHeight - ch - 20;
            if (py < 20) py = 20;
            card.style.left = px + 'px';
            card.style.top = py + 'px';

            card.innerHTML = `
                <div class="sim-card-close">✖</div>
                <h4>${node.name} <span>${rank}/${node.max}</span></h4>
                <div class="desc">${this.formatNodeText(node, rank)}</div>
                ${reqText ? `<div class="req">${reqText}</div>` : ''}
                <div class="controls">
                    <button data-action="minus" ${rank === 0 ? 'disabled' : ''}>- Убрать</button>
                    <button data-action="plus" ${maxed || locked ? 'disabled' : ''}>+ Вложить</button>
                </div>`;
            document.body.appendChild(card);

            card.querySelector('.sim-card-close').addEventListener('click', (e) => {
                e.stopPropagation();
                card.remove();
            });
            card.querySelectorAll('button[data-action]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const delta = btn.dataset.action === 'plus' ? 1 : -1;
                    this.changeSkill(clsId, node.id, delta, node.max, node.pre || null, node.req || 0, branchIds, e);
                });
            });
        }
    };
