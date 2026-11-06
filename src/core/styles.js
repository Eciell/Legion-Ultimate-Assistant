    // ============================================================
    // 3. СТИЛИ
    // ============================================================
    const STYLES = `
        /* Глобальные переменные игры (нативные цвета дерева навыков, v11.6.1). */
        :root {
            --tb-slate: #25302c; --tb-slate2: #313f39; --tb-slate3: #19211e;
            --tb-wood: #a8754f; --tb-woodD: #6e4a2f;
            --tb-chalk: #f4f1e4; --tb-chalk2: #c9d2c3;
            --tb-ink: #2b1d18; --tb-gold: #ffcf4a;
            --br1: #84d4ff; --br2: #ffa982; --br3: #d6b4ff;
        }
        .${DOM_IDS.customModal}, .custom-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(20, 16, 26, 0.98); border: 2px solid #caa55c; border-radius: 12px; padding: 20px; z-index: 10000; color: #f7eadf; width: 1200px; max-width: 98vw; max-height: 88vh; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,0.85); font-family: 'Nunito', sans-serif; backdrop-filter: blur(4px); }
        .${DOM_IDS.customModal}.modal-compact, .custom-modal.modal-compact { width: 450px; max-width: 95vw; max-height: 65vh; padding: 16px; }
        .${DOM_IDS.customModal} h2, .custom-modal h2 { margin-top: 0; color: #ffcf6a; border-bottom: 1px solid #555; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center; cursor: grab; user-select: none; }
        .${DOM_IDS.customModal} h2:active, .custom-modal h2:active { cursor: grabbing; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar, .custom-modal ::-webkit-scrollbar { width: 6px; height: 6px; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar-track, .custom-modal ::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar-thumb, .custom-modal ::-webkit-scrollbar-thumb { background: #44374a; border-radius: 4px; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar-thumb:hover, .custom-modal ::-webkit-scrollbar-thumb:hover { background: #caa55c; }
        .custom-close { background: none; border: none; color: #ff8fa3; font-size: 24px; cursor: pointer; transition: color 0.2s; user-select: none; }
        .custom-close:hover { color: #fff; }
        /* Пати: компактный крестик в правом верхнем углу заголовка (v11.6.0a). */
        .party-close { border-radius: 5px; transition: color 0.2s, background 0.2s; }
        .party-close:hover { color: #fff; background: rgba(255, 143, 163, 0.14); }
        /* Планировщик билдов (v11.6.1d): модалка выше (95vh), чтобы дерево
           навыков влезало целиком без внутреннего скролла. */
        .custom-modal.sim-modal, .${DOM_IDS.customModal}.sim-modal { max-height: 95vh; }
        .modal-tabs { display: flex; gap: 10px; margin-bottom: 15px; border-bottom: 1px solid #444; padding-bottom: 10px; flex-wrap: wrap; }
        .modal-tab { background: #2a2030; border: 1px solid #555; color: #ccc; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: all 0.2s; }
        .modal-tab:hover { background: #3a2c40; color: #fff; }
        .modal-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; }
        .tab-content { display: none; flex: 1; overflow: hidden; position: relative; }
        .tab-content.active { display: flex; gap: 20px; }
        /* ============================================================
           ДЕРЕВО НАВЫКОВ В СТИЛЕ НАТИВНОГО ЭКРАНА ИГРЫ (v11.6.1)
           Источник: reference/LegionFrontSRC/site/skills.css (.skx-*).
           Сетка сжата под 1920x1080: TH=95, TOP=30, BOT=45, BH=455.
           ============================================================ */
        /* v11.6.1d: внутренний скролл убран — при max-height: 95vh дерево
           (панель 38 + отступы + шапки веток 28 + поле 455) влезает целиком.
           overflow: visible, чтобы не обрезались свечения узлов. */
        .sim-tree-wrap { flex: 1; min-width: 0; background: #16121a !important; border: 1px solid #3d2f44; border-radius: 8px; box-shadow: inset 0 0 20px rgba(0,0,0,0.6); position: relative; overflow: visible; display: flex; flex-direction: column; }
        .sim-tree-inner { min-width: 820px; padding: 12px; display: flex; flex-direction: column; height: auto; flex-shrink: 0; background: transparent !important; position: relative; }
        /* Верхняя панель: ровно одна строка 38px (очки / билды / обмен). */
        .sim-top-bar { display: flex; align-items: center; gap: 8px; height: 38px; min-height: 38px; margin-bottom: 10px; padding: 0 8px; background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px; position: relative; z-index: 10; }
        .sim-free-pts { font-size: 12px; color: var(--tb-chalk2, #c9d2c3); white-space: nowrap; }
        .sim-free-pts b { color: var(--tb-gold, #ffcf4a); font-size: 16px; margin: 0 2px; font-variant-numeric: tabular-nums; }
        .sim-bar-sep { width: 1px; height: 20px; background: #3d2f44; flex: none; }
        .sim-top-bar input, .sim-top-bar select, .sim-top-bar button { height: 26px; box-sizing: border-box; border-radius: 6px; font-size: 12px; font-weight: 700; font-family: inherit; }
        .sim-top-bar input, .sim-top-bar select { background: #0f0f15; border: 1px solid #3d2f44; color: #fff; padding: 0 8px; outline: none; min-width: 0; }
        .sim-top-bar input { width: 120px; flex: 0 1 120px; }
        .sim-top-bar select { width: 150px; flex: 0 1 150px; cursor: pointer; }
        .sim-top-bar button { padding: 0 10px; cursor: pointer; white-space: nowrap; flex: none; transition: filter 0.15s, background 0.15s; }
        .sim-top-bar button:hover { filter: brightness(1.15); }
        .sim-save-btn { background: #caa55c; color: #1d1620; border: 1px solid #caa55c; }
        .sim-del-btn { background: transparent; color: #ff5a7a; border: 1px solid #ff5a7a; padding: 0 8px; }
        .sim-share-btn, .sim-import-btn { background: transparent; color: #caa55c; border: 1px solid #caa55c; }
        .sim-reset-btn { background: rgba(255, 90, 122, 0.1); color: #ff5a7a; border: 1px solid #ff5a7a; margin-left: auto; }
        .sim-reset-btn:hover { background: rgba(255, 90, 122, 0.22); }
        /* Ветки: три колонки как в нативном дереве, цвет ветки — --br1..--br3. */
        .sim-branches { position: relative; display: grid; grid-template-columns: repeat(var(--nb, 3), minmax(0, 1fr)); width: 100%; }
        .sim-branch { position: relative; min-width: 0; }
        .sim-branch + .sim-branch { border-left: 2px dashed rgba(244, 241, 228, 0.14); }
        .sim-branch:nth-child(1) { --bc: var(--br1, #84d4ff); }
        .sim-branch:nth-child(2) { --bc: var(--br2, #ffa982); }
        .sim-branch:nth-child(3) { --bc: var(--br3, #d6b4ff); }
        .sim-branch:nth-child(n+4) { --bc: var(--br1, #84d4ff); }
        .sim-branch-header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; height: 28px; margin: 0 12px; padding-bottom: 4px; border-bottom: 3px solid var(--bc, var(--tb-chalk)); color: var(--bc, var(--tb-chalk)); font-size: 13px; font-weight: 700; position: relative; z-index: 3; }
        .sim-branch-header .sim-svg { width: 18px; height: 18px; color: var(--bc, var(--tb-gold)); }
        .sim-branch-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sim-branch-pts { min-width: 24px; height: 24px; padding: 0 5px; display: grid; place-items: center; border-radius: 12px; background: var(--bc, var(--tb-slate3)); color: var(--tb-ink); border: 2px solid var(--tb-ink); font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; }
        /* Поле узлов: высота задаётся инлайном из BH (455px). */
        .sim-in { position: relative; height: 455px; }
        .sim-lines { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 1; }
        .sim-lines path { fill: none; vector-effect: non-scaling-stroke; stroke-linecap: round; }
        .sim-lines .tk-bg { stroke: var(--tb-slate3, #19211e); stroke-width: 14px; }
        .sim-lines .tk-on { stroke: var(--bc, var(--tb-gold)); stroke-width: 6px; }
        .sim-lines .tk-off { stroke: var(--tb-chalk, #f4f1e4); stroke-opacity: 0.4; stroke-width: 3px; stroke-dasharray: 2 8; }
        .sim-lines .tw { stroke: var(--tb-chalk, #f4f1e4); stroke-opacity: 0.25; stroke-width: 2.5px; stroke-dasharray: 4 6; }
        .sim-lines .tw.op { stroke: var(--bc, var(--tb-chalk)); stroke-opacity: 0.55; stroke-dasharray: none; }
        .sim-lines .tw.on { stroke: var(--bc, var(--tb-gold)); stroke-opacity: 1; stroke-width: 4px; stroke-dasharray: none; }
        .sim-lines .pre { stroke: var(--tb-chalk, #f4f1e4); stroke-opacity: 0.3; stroke-width: 2px; stroke-dasharray: 3 6; }
        .sim-lines .pre.op { stroke: var(--bc, var(--tb-chalk)); stroke-opacity: 0.75; }
        .sim-lines .pre.on { stroke: var(--bc, var(--tb-gold)); stroke-opacity: 1; stroke-width: 3px; stroke-dasharray: none; }
        /* SVG-иконки: обводка currentColor, solid-вариант с полупрозрачной заливкой. */
        .sim-svg { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
        .sim-svg.so { fill: currentColor; fill-opacity: 0.18; }
        /* Узел: круг как .skx-i в нативном дереве. */
        .sim-node { position: absolute; z-index: 2; transform: translate(-50%, -21px); display: grid; justify-items: center; width: 92px; cursor: pointer; }
        .sim-node-icon { position: relative; width: 42px; height: 42px; display: grid; place-items: center; border-radius: 50%; background: var(--tb-slate2, #313f39); border: 3px solid var(--tb-chalk2, #c9d2c3); color: var(--tb-chalk, #f4f1e4); box-shadow: 0 3px 0 rgba(0, 0, 0, 0.35); transition: translate 0.12s, box-shadow 0.12s; }
        .sim-node-icon .sim-svg { width: 23px; height: 23px; }
        .sim-node:hover { z-index: 4; }
        .sim-node:hover .sim-node-icon { translate: 0 -2px; }
        .sim-node .sim-node-icon { border-color: color-mix(in srgb, var(--bc, var(--tb-chalk2)) 60%, var(--tb-slate2)); }
        .sim-node.locked .sim-node-icon { background: var(--tb-slate3, #19211e); border-style: dashed; border-color: color-mix(in srgb, var(--tb-chalk) 35%, transparent); color: color-mix(in srgb, var(--tb-chalk) 45%, transparent); }
        .sim-node.available .sim-node-icon { background: color-mix(in srgb, var(--bc, var(--tb-gold)) 26%, var(--tb-slate2)); border: 3px solid var(--bc, var(--tb-gold)); color: var(--tb-chalk, #f4f1e4); box-shadow: 0 0 0 3px var(--tb-slate), 0 0 0 5px color-mix(in srgb, var(--bc, var(--tb-gold)) 45%, transparent); }
        .sim-node.available .sim-node-icon::after { content: ''; position: absolute; inset: -8px; border-radius: inherit; border: 3px solid var(--bc, var(--tb-gold)); opacity: 0; animation: simNodePulse 2s ease-out infinite; pointer-events: none; }
        @keyframes simNodePulse { 0% { transform: scale(0.88); opacity: 0.9; } 70%, 100% { transform: scale(1.22); opacity: 0; } }
        .sim-node.has .sim-node-icon { background: var(--bc, var(--tb-gold)); border: 3px solid var(--tb-ink); color: var(--tb-ink); box-shadow: 0 0 0 3px var(--tb-slate), 0 0 0 5px var(--bc, var(--tb-gold)); }
        .sim-node.has .sim-node-icon .sim-svg.so { fill-opacity: 0.4; }
        .sim-node.maxed .sim-node-icon { box-shadow: 0 0 0 3px var(--tb-slate), 0 0 0 5px var(--tb-gold); }
        /* Узел, чей тултип сейчас открыт (outline — чтобы не спорить с box-shadow
           состояний has/maxed/available). */
        .sim-node.sim-node-active .sim-node-icon { outline: 2px solid #caa55c; outline-offset: 3px; }
        .sim-node-ranks { display: flex; gap: 3px; margin-top: 2px; padding: 1px 4px; border-radius: 7px; background: var(--tb-slate, #25302c); }
        .sim-node-ranks i { width: 6px; height: 6px; border-radius: 50%; background: var(--tb-slate3, #19211e); border: 1.5px solid color-mix(in srgb, var(--tb-chalk) 45%, transparent); }
        .sim-node-ranks i.filled { background: var(--bc, var(--tb-gold)); border-color: var(--bc, var(--tb-gold)); }
        .sim-node-name { max-width: 92px; margin-top: 2px; padding: 0 3px; font-size: 10.5px; line-height: 1.15; font-weight: 700; text-align: center; color: var(--tb-chalk, #f4f1e4); background: var(--tb-slate, #25302c); border-radius: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; hyphens: auto; overflow-wrap: anywhere; }
        .sim-node.locked .sim-node-name { color: var(--tb-chalk2, #c9d2c3); opacity: 0.8; }
        .sim-card { position: fixed; background: #f5e9c8; color: #2a2010; border: 3px solid #2b1d18; border-radius: 12px; padding: 15px; width: 280px; z-index: 10001; box-shadow: 0 10px 25px rgba(0,0,0,0.6); display: none; }
        .sim-card h4 { margin: 0 0 5px 0; font-size: 16px; color: #2b1d18; display: flex; justify-content: space-between; }
        .sim-card .desc { font-size: 13px; margin-bottom: 10px; line-height: 1.3; }
        .sim-card .req { font-size: 12px; color: #c2405a; font-weight: bold; margin-bottom: 10px; }
        .sim-card .controls { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
        .sim-card button { background: #caa55c; border: 2px solid #2b1d18; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; color: #2b1d18; font-size: 13px; }
        .sim-card button:disabled { opacity: 0.5; cursor: not-allowed; }
        .sim-card-close { position: absolute; top: 8px; right: 8px; cursor: pointer; font-size: 16px; color: #888; }
        /* Тултип узла навыка (v11.6.1d).
           Один элемент на модалку, position: absolute: containing block —
           padding-box .custom-modal (она position: fixed), поэтому overflow
           дерева его не режет, а координаты не зависят от transform модалки.
           Видимость переключает класс .on (BuildSim.showNodeTooltip/hideTooltip). */
        .sim-tooltip { position: absolute; top: 0; left: 0; z-index: 10001; display: none; box-sizing: border-box; width: 290px; max-width: calc(100vw - 16px); padding: 12px 14px; background: rgba(22, 16, 12, 0.98); color: #f4f1e4; border: 2px solid #caa55c; border-radius: 10px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.7); font: 13px/1.35 'Nunito', system-ui, sans-serif; text-align: left; }
        .sim-tooltip.on { display: block; }
        .sim-tooltip h4 { margin: 0 22px 6px 0; padding: 0; border: none; font-size: 15px; line-height: 1.25; color: #ffcf6a; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        .sim-tooltip h4 span { flex: none; font-size: 12px; font-weight: 700; color: #c9d2c3; }
        .sim-tooltip .desc { margin-bottom: 8px; font-size: 13px; line-height: 1.35; }
        .sim-tooltip .req { margin-bottom: 8px; font-size: 12px; font-weight: 700; color: #ff8fa3; }
        .sim-tooltip .controls { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px; }
        .sim-tooltip button { flex: 1; padding: 6px 8px; background: #caa55c; color: #1d1620; border: 2px solid #2b1d18; border-radius: 6px; font-family: inherit; font-size: 12px; font-weight: 700; line-height: 1.2; cursor: pointer; }
        .sim-tooltip button:hover:not(:disabled) { filter: brightness(1.12); }
        .sim-tooltip button:disabled { opacity: 0.45; cursor: not-allowed; }
        .sim-tooltip-close { position: absolute; top: 6px; right: 8px; font-size: 13px; line-height: 1; color: #c9b184; cursor: pointer; user-select: none; }
        .sim-tooltip-close:hover { color: #fff; }
        /* Табы классов планировщика: компактные (34px), с SVG-иконкой класса. */
        .modal-tab.sim-tab { height: 34px; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; box-sizing: border-box; }
        .modal-tab.sim-tab .sim-svg { width: 16px; height: 16px; }
        /* Цвет класса в --c (инлайн-стиль таба из BuildSim.classColors, v11.6.1d):
           неактивный — тёмная подложка + цветная рамка/текст,
           активный — заливка цветом класса с тёмным текстом (как у Жреца в игре). */
        .modal-tab.sim-tab { border: 2px solid var(--c, #caa55c); color: var(--c, #ffcf6a); background: rgba(0, 0, 0, 0.25); }
        .modal-tab.sim-tab:hover { border-color: var(--c, #caa55c); color: var(--c, #ffcf6a); background: rgba(0, 0, 0, 0.45); }
        .modal-tab.sim-tab.active { background: var(--c, #caa55c); border-color: var(--c, #caa55c); color: #12100e; }
        .sim-load-select option { background: #0f0f15; color: #fff; }
        .build-right { width: 250px; flex-shrink: 0; background: #1e1724; padding: 15px; border-radius: 8px; border: 1px solid #3d2f44; height: fit-content; }
        /* Панель статов справа */
        .stats-panel { background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px; padding: 15px; }
        .stats-panel h3 { color: #ffcf6a; margin-top: 0; font-size: 14px; border-bottom: 1px solid #3d2f44; padding-bottom: 10px; }
        .stat-line { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
        .stat-line span { color: #aaa; }
        .stat-line b { color: #4cc95a; }
        .search-bar { width: 100%; padding: 10px; margin-bottom: 15px; background: #111; border: 1px solid #555; color: #fff; border-radius: 6px; font-size: 14px; outline: none; box-sizing: border-box; }
        .table-container { overflow-y: auto; flex: 1; border: 1px solid #333; border-radius: 6px; }
        .${DOM_IDS.customModal} table, .custom-modal table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .${DOM_IDS.customModal} th, .${DOM_IDS.customModal} td, .custom-modal th, .custom-modal td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #333; }
        .${DOM_IDS.customModal} th, .custom-modal th { background: #2a2030; color: #ffcf6a; position: sticky; top: 0; cursor: pointer; user-select: none; z-index: 2; }
        .${DOM_IDS.customModal} th::after, .custom-modal th::after { content: ' ↕'; font-size: 10px; opacity: 0.5; }
        .${DOM_IDS.customModal} th.sort-asc::after, .custom-modal th.sort-asc::after { content: ' ↑'; opacity: 1; }
        .${DOM_IDS.customModal} th.sort-desc::after, .custom-modal th.sort-desc::after { content: ' ↓'; opacity: 1; }
        .stat-up { color: #4cc95a; font-weight: bold; }
        .stat-down { color: #ff5a7a; font-weight: bold; }
        .stat-eq { color: #888; }
        .deal-great { color: #4cc95a; font-weight: bold; text-shadow: 0 0 5px rgba(76, 201, 90, 0.5); }
        .deal-good { color: #8bc34a; font-weight: bold; }
        .deal-bad { color: #ff5a7a; }
        .loader { display: flex; justify-content: center; align-items: center; height: 100px; font-size: 16px; color: #caa55c; font-weight: bold; }
        .${DOM_IDS.fabWrap}, .legion-fab-wrap { position: fixed; bottom: 20px; right: 20px; z-index: 10000; touch-action: none; user-select: none; }
        .${DOM_IDS.fabBtn}, .legion-fab-btn { width: 52px; height: 52px; border-radius: 50%; background: #1d1620; border: 2px solid #caa55c; color: #ffcf6a; font-size: 26px; display: flex; justify-content: center; align-items: center; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,0.75); transition: transform 0.2s, background 0.2s; position: relative; }
        .${DOM_IDS.fabBtn}:hover, .legion-fab-btn:hover { background: #2a2030; transform: scale(1.08); }
        .${DOM_IDS.fabBtn}:active, .legion-fab-btn:active { transform: scale(0.95); }
        .${DOM_IDS.fabMenu}, .legion-fab-menu { position: absolute; bottom: 62px; right: 0; min-width: 220px; background: rgba(29, 22, 32, 0.96); border: 2px solid #caa55c; border-radius: 10px; padding: 8px; display: none; flex-direction: column; gap: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.85); backdrop-filter: blur(8px); }
        .${DOM_IDS.fabMenu}.open, .legion-fab-menu.open { display: flex; animation: fabFadeIn 0.2s ease; }
        .${DOM_IDS.fabMenu}::-webkit-scrollbar, .legion-fab-menu::-webkit-scrollbar { width: 4px; }
        .${DOM_IDS.fabMenu}::-webkit-scrollbar-thumb, .legion-fab-menu::-webkit-scrollbar-thumb { background: #caa55c; border-radius: 4px; }
        .${DOM_IDS.fabMenu}::-webkit-scrollbar-track, .legion-fab-menu::-webkit-scrollbar-track { background: transparent; }
        .fab-section-title { flex-shrink: 0; }
        .fab-section { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
        .fab-section-body { display: flex; flex-direction: column; gap: 6px; overflow: hidden; transition: max-height 0.2s ease-out; }
        .fab-section.collapsed .fab-section-body { display: none; }
        .fab-arrow {
            display: inline-block;
            font-size: 16px;
            color: #caa55c;
            font-weight: bold;
            line-height: 1;
            transition: transform 0.2s, color 0.2s;
            width: 20px;
            text-align: center;
        }
        /* !important нужен из-за инлайнового color в разметке стрелки. */
        .fab-section-title:hover .fab-arrow { color: #ffcf6a !important; }
        .fab-section.collapsed .fab-arrow { transform: rotate(-90deg); }
        .${DOM_IDS.fabMenu}.open-down, .legion-fab-menu.open-down { top: 100%; bottom: auto; margin-top: 10px; margin-bottom: 0; }
        @keyframes fabFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .fab-menu-item { position: relative; flex-shrink: 0; background: #2a2030; color: #ffcf6a; border: 1px solid #555; border-radius: 6px; padding: 10px 14px; font-weight: bold; cursor: pointer; font-size: 13px; text-align: left; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center; }
        .fab-menu-item:hover { background: #caa55c; color: #1d1620; border-color: #caa55c; }
        .fab-menu-item.active { background: #4cc95a; color: #1d1620; border-color: #4cc95a; box-shadow: 0 0 15px rgba(76, 201, 90, 0.5); }
        .${DOM_IDS.chatBadge}, .chat-badge { position: absolute; top: -6px; right: -6px; background: #ff5a7a; color: #fff; border-radius: 50%; padding: 2px 7px; font-size: 12px; font-weight: 900; box-shadow: 0 2px 5px rgba(0,0,0,0.5); display: none; pointer-events: none; z-index: 2; }
        .${DOM_IDS.chatWidget}, .chat-widget { position: fixed; bottom: 80px; right: 20px; width: 320px; height: 400px; min-width: 320px; min-height: 400px; max-width: 95vw; max-height: 95vh; resize: both; background: #1d1620; border: 2px solid #caa55c; border-radius: 12px; display: flex; flex-direction: column; z-index: 10000; box-shadow: 0 10px 30px rgba(0,0,0,0.8); overflow: hidden; transition: transform 0.2s, opacity 0.2s; transform: translateY(20px); opacity: 0; pointer-events: none; }
        .${DOM_IDS.chatWidget}.open, .chat-widget.open { transform: translateY(0); opacity: 1; pointer-events: auto; }
        .chat-top-bar, .chat-header { background: #2a2030; padding: 10px 12px; font-weight: bold; color: #ffcf6a; display: flex; justify-content: space-between; align-items: center; gap: 8px; overflow: hidden; border-bottom: 1px solid #444; cursor: move; user-select: none; touch-action: none; box-sizing: border-box; flex-shrink: 0; }
        .chat-main-tabs, .chat-tabs { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; }
        .chat-main-tab, .chat-tab { background: #1d1620; border: 1px solid #444; color: #aaa; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; white-space: nowrap; font-weight: bold; user-select: none; pointer-events: auto; }
        .chat-main-tab.active, .chat-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; font-weight: bold; }
        .chat-sub-tabs { display: flex; gap: 6px; padding: 6px 12px; background: #231929; border-bottom: 1px solid #3a2b42; flex-shrink: 0; }
        .chat-sub-tab { background: #1d1620; border: 1px solid #444; color: #bbb; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; white-space: nowrap; user-select: none; pointer-events: auto; }
        .chat-sub-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; font-weight: bold; }
        .chat-role-icon { margin-right: 4px; }
        .chat-envelope { display: none; }
        .chat-close { cursor: pointer; color: #ff8fa3; padding: 4px 6px; flex-shrink: 0; font-size: 16px; line-height: 1; user-select: none; pointer-events: auto; }
        .chat-close:hover { color: #fff; }
        .chat-messages { flex: 1 1 0%; min-height: 0; padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #f7eadf !important; }
        .chat-msg { background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 8px; line-height: 1.3; word-wrap: break-word; color: #f7eadf !important; }
        .chat-msg.pending { opacity: 0.6; font-style: italic; }
        .chat-msg.streamer-msg { border-left: 3px solid #ffd700; background: rgba(255, 215, 0, 0.08); }
        .chat-msg.mention-msg { border-left: 3px solid #f7768e; background: rgba(247, 118, 142, 0.12); }
        .chat-text { color: #f7eadf !important; word-break: break-word; }
        .chat-author { font-weight: bold; color: #f7eadf !important; margin-right: 5px; }
        .chat-input-area { display: flex; padding: 10px; background: #111; border-top: 1px solid #333; gap: 5px; flex-shrink: 0; }
        .chat-input { flex: 1; background: #222; border: 1px solid #444; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 13px; outline: none; }
        .chat-input:focus { border-color: #caa55c; }
        .chat-send { background: #caa55c; color: #1d1620; border: none; padding: 0 15px; border-radius: 6px; font-weight: bold; cursor: pointer; user-select: none; pointer-events: auto; }
        .chat-send:hover { background: #ffcf6a; }
        .chat-widget button { user-select: none; pointer-events: auto; }
        .${DOM_IDS.hudLog}, .hud-log { position: fixed; bottom: 20px; left: 20px; width: 480px; max-height: 300px; background: rgba(29, 22, 32, 0.95); border: 2px solid #caa55c; border-radius: 8px; padding: 10px; z-index: 9999; overflow-y: auto; font-family: monospace; font-size: 12px; color: #f7eadf; box-shadow: 0 4px 10px rgba(0,0,0,0.5); display: none; }
        .${DOM_IDS.hudLog}.active, .hud-log.active { display: block; }
        .hud-log-header { font-weight: bold; color: #ffcf6a; margin-bottom: 8px; border-bottom: 1px solid #555; padding-bottom: 4px; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none; touch-action: none; }
        .hud-log-close { cursor: pointer; color: #ff8fa3; padding: 5px; }
        .hud-log-close:hover { color: #fff; }
        .hud-line { margin-bottom: 4px; line-height: 1.3; word-wrap: break-word; }
        .hud-line.info { color: #8fd3ff; }
        .hud-line.success { color: #4cc95a; }
        .hud-line.warn { color: #ff9800; }
        .hud-line.action { color: #ffcf6a; font-weight: bold; }
        .hud-line.error { color: #ff5a7a; }
        .auc-buy-btn { padding: 4px 8px; background: #28a745; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px; transition: background 0.2s, opacity 0.2s; }
        .auc-buy-btn:hover { background: #218838; }
        .auc-buy-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        /* Фиксы котов в шахте (баг игры) */
        .mn-fig.has-d:not(:has(> svg:not(.mna-dfig))) > svg.mna-dfig { display: block !important; }
        .mn-h .mna-dfig { overflow: visible !important; }

        /* UI-декоратор аукциона: иконки монет */
        .b-coin-wrap {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            white-space: nowrap;
            vertical-align: middle;
        }
        .b-coin-ico {
            width: 11px;
            height: 11px;
            border-radius: 50%;
            border: 1.5px solid rgba(0, 0, 0, 0.45);
            display: inline-block;
            vertical-align: middle;
            margin-left: 2px;
            margin-right: 1px;
            flex-shrink: 0;
            box-sizing: border-box;
        }
        .b-coin-ico.g {
            background: radial-gradient(circle at 35% 35%, #fff176, #f2c94c);
            box-shadow: 0 0 2px rgba(242, 201, 76, 0.45);
        }
        .b-coin-ico.s {
            background: radial-gradient(circle at 35% 35%, #ffffff, #d7dde2);
            box-shadow: 0 0 2px rgba(215, 221, 226, 0.45);
        }
        .b-coin-ico.b {
            background: radial-gradient(circle at 35% 35%, #e0965a, #c47a3a);
            box-shadow: 0 0 2px rgba(196, 122, 58, 0.45);
        }

        /* UI-декоратор аукциона: арт предмета */
        .b-lot-art {
            width: 40px;
            height: 40px;
            min-width: 40px;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.15);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            overflow: hidden;
            flex-shrink: 0;
            box-sizing: border-box;
        }
        .b-lot-art svg {
            width: 34px;
            height: 34px;
            max-width: 36px;
            max-height: 36px;
            display: block;
            overflow: visible;
        }
        .b-lot-art img {
            width: 32px;
            height: 32px;
            max-width: 32px;
            max-height: 32px;
            object-fit: contain;
            display: block;
        }
        #auction-body .b-lot-art {
            display: inline-flex;
            vertical-align: middle;
            margin-right: 5px;
            width: 32px;
            height: 32px;
            min-width: 32px;
        }
        #auction-body .b-lot-art img,
        #auction-body .b-lot-art svg {
            width: 26px;
            height: 26px;
        }
        #dossier-lots-container .b-lot-art {
            width: 30px;
            height: 30px;
            min-width: 30px;
        }
        #dossier-lots-container .b-lot-art img,
        #dossier-lots-container .b-lot-art svg {
            width: 24px;
            height: 24px;
        }
        #${DOM_IDS.playerHud}, #legion-player-hud { position: fixed; top: 100px; right: 20px; width: 220px; background: #1d1620; border: 2px solid #caa55c; border-radius: 10px; z-index: 10001; box-shadow: 0 8px 24px rgba(0,0,0,0.85); display: flex; flex-direction: column; overflow: hidden; font-family: 'Nunito', sans-serif; }
        .player-hud-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #2a2030; border-bottom: 1px solid #444; cursor: move; user-select: none; touch-action: none; }
        .player-hud-close { background: none; border: none; color: #ff8fa3; font-size: 14px; cursor: pointer; padding: 0 2px; line-height: 1; }
        .player-hud-close:hover { color: #fff; }
        .player-hud-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; font-size: 12px; }
        .player-hud-row { display: flex; justify-content: space-between; align-items: center; }
        .player-hud-label { color: #aaa; }
        .player-hud-val { font-weight: bold; }
        /* ── Пати (v11.6.0g-2): модалка, HP-панель и журнал ──
           Раньше формы окна «Пати» рисовались инлайном (серые рамки #444) —
           теперь это классы: тёмный фон, золотистые акценты #caa55c/#ffcf6a
           и hover-эффекты как у кнопки «Создать пати». */
        .party-modal h2 { border-bottom-color: #3a3040; }
        .party-muted { font-size: 11px; color: #c9b184; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
        .party-input { width: 100%; box-sizing: border-box; background: #16121a; border: 1px solid #4a3c56; color: #f7eadf; padding: 8px 10px; border-radius: 6px; font-size: 13px; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
        .party-input::placeholder { color: #7d7189; }
        .party-input:focus { border-color: #caa55c; box-shadow: 0 0 0 2px rgba(202, 165, 92, 0.15); }
        .party-input.party-token { font-family: monospace; font-size: 11px; }
        .party-btn { padding: 8px 12px; background: #2a2030; border: 1px solid #caa55c; color: #ffcf6a; border-radius: 6px; cursor: pointer; font-size: 13px; white-space: nowrap; transition: background 0.2s, color 0.2s, border-color 0.2s, box-shadow 0.2s; }
        .party-btn:hover:not(:disabled) { background: #caa55c; color: #1d1620; border-color: #e0bb6b; box-shadow: 0 0 10px rgba(202, 165, 92, 0.35); }
        .party-btn:active:not(:disabled) { transform: translateY(1px); }
        .party-btn:disabled { opacity: 0.55; cursor: default; }
        .party-btn-sm { padding: 4px 8px; border-radius: 5px; font-size: 11px; }
        .party-btn-lg { padding: 8px 12px; font-size: 13px; }
        .party-btn-danger { background: #3a1f28; border-color: #ff5a7a; color: #ff5a7a; }
        .party-btn-danger:hover:not(:disabled) { background: #ff5a7a; border-color: #ff8fa3; color: #1d1620; box-shadow: 0 0 10px rgba(255, 90, 122, 0.35); }
        .party-sep { border-top: 1px solid #3a3040; padding-top: 12px; }
        .party-field { display: flex; gap: 6px; }
        .party-self-nick { color: #ffcf6a; }
        /* Ошибка модалки: пустой блок не занимает места (раньше он всегда
           висел с display:none и текст ошибки был не виден). */
        .party-error { color: #ff8fa3; font-size: 12px; line-height: 1.35; }
        .party-error:empty { display: none; }

        /* HUD пати: HP-панель и журнал в одном контейнере, перетаскивание
           за заголовки. Контейнер и панели — pointer-events:none, чтобы не
           перехватывать клики по игре; интерактивные узлы возвращают auto. */
        .party-hud-container { position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; align-items: stretch; box-sizing: border-box; pointer-events: none; }
        .party-panel, .party-log-panel { display: none; position: relative; box-sizing: border-box; min-width: 150px; max-width: 260px; background: rgba(20, 16, 26, 0.92); border: 1px solid #3a3040; border-radius: 10px; padding: 8px 10px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); font: 12px/1.4 system-ui, "Segoe UI", sans-serif; color: #e8e8ea; pointer-events: none; }
        .party-drag-handle { pointer-events: auto; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
        .party-drag-handle:active, .party-hud-container.party-dragging .party-drag-handle { cursor: grabbing; }
        .party-panel-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #c9b184; margin-bottom: 6px; }
        .party-log-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .party-log-body { pointer-events: auto; max-height: 150px; overflow-y: auto; margin-top: 6px; }
        .party-log-body::-webkit-scrollbar { width: 6px; }
        .party-log-body::-webkit-scrollbar-thumb { background: #44374a; border-radius: 4px; }
        .party-log-body::-webkit-scrollbar-thumb:hover { background: #caa55c; }
        .party-log-toggle { pointer-events: auto; background: none; border: none; padding: 0 2px; color: #ffcf6a; cursor: pointer; font-size: 12px; line-height: 1; }
        .party-log-toggle:hover { color: #fff; }
        .party-heal-btn { pointer-events: auto; flex: none; padding: 0 5px; background: #22352a; border: 1px solid #5fd987; color: #5fd987; border-radius: 4px; font-size: 10px; line-height: 15px; cursor: pointer; transition: background 0.15s, color 0.15s; }
        .party-heal-btn:hover:not(:disabled) { background: #5fd987; color: #16121a; }
        .party-heal-btn:disabled { opacity: 0.6; cursor: default; }
        /* 7TV-смайлики: размер задаётся переменной --t7-h (S/M/L/XL из настроек чата) */
        .t7-emote { height: var(--t7-h, 1.9em); vertical-align: middle; margin: 0 2px; }
        /* Подсветка пользователей аддона (ТЗ 11.6.0h).
           НЕ переопределяем color — сохраняем индивидуальный цвет игрока
           (класс/ранг выставляет его самой игрой). text-shadow с currentColor
           даёт свечение ровно в его родном цвете. */
        .legion-addon-user {
            text-shadow: 0 0 4px currentColor, 0 0 10px currentColor !important;
        }
        .legion-addon-badge {
            display: inline-block;
            margin-right: 3px;
            font-size: 11px;
            /* Фирменное золотое свечение аддона (было голубое #00f0ff). */
            filter: drop-shadow(0 0 4px rgba(255, 207, 106, 0.7));
            vertical-align: middle;
            user-select: none;
        }

    `;
