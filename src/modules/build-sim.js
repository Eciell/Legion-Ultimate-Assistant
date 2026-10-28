    // ============================================================
    // 4. МОДУЛЬ: ПЛАНИРОВЩИК БИЛДОВ
    // ============================================================
    const BuildSim = {
        skillsCache: null,
        simulatedSkills: {},

        statNames: { hp: 'Макс. HP', atk: 'Физ. урон', mag: 'Магия', def: 'Броня', crit: 'Крит %', dodge: 'Уклонение', pierce: 'Пробивание', resist: 'Сопротивление' },
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
                                    <div class="sim-top-bar">
                                        <div class="sim-free-pts">Свободно очков: <span id="free-${c.id}">0</span> / ${MAX_POINTS} <span style="font-size:12px;color:#aaa;">(Тестовый режим)</span></div>
                                        <button class="sim-reset-btn" data-reset="${c.id}">Сбросить всё</button>
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
