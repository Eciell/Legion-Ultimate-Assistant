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
        /* Тумблеры в окне настроек (патч 11.6.2a): кастомный switch вместо
           нативного чекбокса. appearance: none убирает UA-отрисовку, дорожка
           красится фоном, бегунок — псевдоэлементом ::after.
           Включённое состояние — золотое, как кнопки аддона. */
        .lg-toggle { appearance: none; -webkit-appearance: none; width: 36px; height: 20px; flex: none; margin: 0; background: #444; border: none; border-radius: 10px; position: relative; cursor: pointer; outline: none; transition: background 0.2s; }
        .lg-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: transform 0.2s; }
        .lg-toggle:checked { background: #ffcf6a; }
        .lg-toggle:checked::after { transform: translateX(16px); }
        .lg-toggle:focus-visible { box-shadow: 0 0 0 2px #caa55c; }
        /* Пати: компактный крестик в правом верхнем углу заголовка (v11.6.0a). */
        .party-close { border-radius: 5px; transition: color 0.2s, background 0.2s; }
        .party-close:hover { color: #fff; background: rgba(255, 143, 163, 0.14); }
        /* Планировщик билдов: модалка BuildSim.open() в UI не используется
           (HeroPlanner монтирует дерево в #hp-buildsim-container), поэтому
           нерабочие правила для .sim-modal / #buildsim-modal-body удалены
           в v11.6.2a.3. Живые правила скролла — в конце этого файла,
           блок «ПЛАНИРОВЩИК БИЛДОВ — СКРОЛЛ». */
        .modal-tabs { display: flex; gap: 10px; margin-bottom: 15px; border-bottom: 1px solid #444; padding-bottom: 10px; flex-wrap: wrap; }
        .modal-tab { background: #2a2030; border: 1px solid #555; color: #ccc; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: all 0.2s; }
        .modal-tab:hover { background: #3a2c40; color: #fff; }
        .modal-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; }
        .tab-content { display: none; flex: 1; overflow: hidden; position: relative; }
        .tab-content.active { display: flex; gap: 20px; }
        /* ============================================================
           ДЕРЕВО НАВЫКОВ В СТИЛЕ НАТИВНОГО ЭКРАНА ИГРЫ (v11.6.1)
           Источник: reference/LegionFrontSRC/site/skills.css (.skx-*).
           v11.6.2a.5: TH=135, TOP=40, BOT=50 -> BH=630 (узлы 48px).
           ============================================================ */
        /* v11.6.1d: внутренний скролл убран — дерево (панель 38 + отступы +
           шапки веток 28 + поле 630) прокручивается вместе с модалкой (96vh).
           overflow: visible, чтобы не обрезались свечения узлов. */
        .sim-tree-wrap { flex: 1; min-width: 0; background: #16121a !important; border: 1px solid #3d2f44; border-radius: 8px; box-shadow: inset 0 0 20px rgba(0,0,0,0.6); position: relative; overflow: visible; display: flex; flex-direction: column; }
        /* v11.6.2a.5: min-width 950px — три ветки не сжимаются «в кашу». */
        .sim-tree-inner { min-width: 950px; padding: 12px; display: flex; flex-direction: column; height: auto; flex-shrink: 0; background: transparent !important; position: relative; }
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
        /* Инлайн-имя билда (патч 11.6.2a): поле и OK встают на место кнопки
           «Сохранить» внутри панели 38px. Селекторы с .sim-top-bar нужны,
           чтобы перебить общие правила панели (height: 26px, width: 120px). */
        .sim-top-bar .sim-save-name { width: 150px; flex: 0 1 150px; height: 28px; font-size: 12px; }
        .sim-top-bar .sim-save-ok { height: 28px; background: #caa55c; color: #1d1620; border: 1px solid #caa55c; }
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
        /* Поле узлов: высота задаётся инлайном из BH (630px при TH=135).
           Значение ниже — только fallback до первого рендера. */
        .sim-in { position: relative; height: 630px; }
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
        /* Гейты ярусов (патч 11.6.2a): плашка с замком на стволе между ярусами.
           Повторяет .skg нативного дерева (reference/LegionFrontSRC/site/skills.css):
           тёмный фон, пунктирная рамка, боковые «усики» на ствол.
           z-index ниже узлов (2) — плашка не перекрывает иконки навыков. */
        .sim-gate { position: absolute; left: 50%; z-index: 1; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; background: #19211e; color: var(--tb-chalk, #f4f1e4); border: 2px dashed var(--tb-chalk2, #c9d2c3); font-size: 11px; font-weight: 800; line-height: 1; white-space: nowrap; cursor: help; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45); }
        .sim-gate span { font-variant-numeric: tabular-nums; }
        .sim-gate::before, .sim-gate::after { content: ''; position: absolute; top: 50%; width: 14px; height: 4px; margin-top: -2px; border-radius: 2px; background: var(--tb-chalk2, #c9d2c3); }
        .sim-gate::before { right: 100%; }
        .sim-gate::after { left: 100%; }
        /* SVG-иконки: обводка currentColor, solid-вариант с полупрозрачной заливкой. */
        .sim-svg { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
        .sim-svg.so { fill: currentColor; fill-opacity: 0.18; }
        /* Узел: круг как .skx-i в нативном дереве.
           v11.6.2a.5: ширина 130px (было 110) — подписи навыков не режутся.
           Кружок 48px (+3px бордюр = 54).
           transform -24px держит центр кружка на линии яруса (y): -24 + 54/2 ≈ y+3,
           как было при кружке 42px и сдвиге -21px. */
        .sim-node { position: absolute; z-index: 2; transform: translate(-50%, -24px); display: grid; justify-items: center; width: 130px !important; cursor: pointer; }
        .sim-node-icon { position: relative; width: 48px; height: 48px; display: grid; place-items: center; border-radius: 50%; background: var(--tb-slate2, #313f39); border: 3px solid var(--tb-chalk2, #c9d2c3); color: var(--tb-chalk, #f4f1e4); box-shadow: 0 3px 0 rgba(0, 0, 0, 0.35); transition: translate 0.12s, box-shadow 0.12s; }
        .sim-node-icon .sim-svg { width: 26px; height: 26px; }
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
        /* v11.6.2a.5: подпись шире (130px), длинные слова переносятся
           (word-wrap: break-word) и текст больше не обрезается по высоте —
           -webkit-line-clamp убран, слово переносится, а не режется. */
        .sim-node-name { max-width: 130px !important; margin-top: 2px; padding: 0 3px; font-size: 12px !important; line-height: 1.2 !important; font-weight: 700; text-align: center; color: var(--tb-chalk, #f4f1e4); background: var(--tb-slate, #25302c); border-radius: 4px; display: block; overflow: visible; hyphens: auto; word-wrap: break-word !important; overflow-wrap: anywhere; }
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
        /* Цвет класса в --c (инлайн-стиль таба из BuildSim.classColors, v11.6.1d),
           цвет текста на заливке — в --ct (BuildSim.classTextColors, v11.6.1e):
           неактивный — тёмная подложка + цветная рамка/текст,
           активный — заливка цветом класса; текст тёмный на светлых цветах
           (Жрец, Паладин, Разбойник) и белый на тёмных (Некромант). */
        .modal-tab.sim-tab { border: 2px solid var(--c, #caa55c); color: var(--c, #ffcf6a); background: rgba(0, 0, 0, 0.25); }
        .modal-tab.sim-tab:hover { border-color: var(--c, #caa55c); color: var(--c, #ffcf6a); background: rgba(0, 0, 0, 0.45); }
        .modal-tab.sim-tab.active { background: var(--c, #caa55c); border-color: var(--c, #caa55c); color: var(--ct, #12100e); }
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
        /* 11.6.2c.2: медиана сети в витрине аукциона и строка медианы в
           нативных тултипах предметов (#lg-tip игры и #lgi-tip инвентаря).
           Порог подсветки: цена за штуку ниже медианы на 15% и больше —
           зелёный, выше на 15% и больше — красный. */
        .auction-deal { color: #6fd49a !important; font-weight: bold; }
        .auction-overpriced { color: #ff5a7a !important; }
        .auction-median-col { font-size: 12px; opacity: 0.8; }
        /* 11.6.2c.4: кнопка «📡 Сканировать весь аукцион» в шапке сканера.
           class="btn" — родной класс игры, но у него нет фона/рамки, поэтому
           цвета аддона задаём по id (специфичность выше класса). :disabled —
           кулдаун 30 минут или идущее сканирование. */
        #lg-auction-full-scan {
            min-height: 0;
            padding: 5px 12px;
            background: #2a2030;
            border: 1px solid #caa55c;
            border-radius: 6px;
            color: #ffcf6a;
            font-family: inherit;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            white-space: nowrap;
            transition: background 0.2s, opacity 0.2s;
        }
        #lg-auction-full-scan:hover:not(:disabled) { background: #3d2f44; }
        #lg-auction-full-scan:disabled { cursor: not-allowed; opacity: 0.55; }
        .lg-market-median {
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid rgba(255,255,255,0.1);
            color: #ffcf6a;
            font-size: 13px;
            font-weight: bold;
            pointer-events: none;
        }
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

        /* ============================================================
           ПЛАНИРОВЩИК БИЛДОВ — ПОЛНЫЙ СКРОЛЛ МОДАЛКИ (v11.6.2a.5)
           Скроллится вся модалка целиком, включая заголовок и табы.
           Внутренние контейнеры не режут высоту (overflow: visible).
           Нижний ряд узлов получает запас и не обрезается.
           ============================================================ */
        /* 1. Модалка занимает почти весь экран; скроллит её сама (v11.6.2a.5).
           Компактные окна (.modal-compact: настройки, пати, разведка) не
           растягиваем — иначе их 450px-раскладка ломается. */
        .${DOM_IDS.customModal}:not(.modal-compact), .custom-modal:not(.modal-compact) {
            max-height: 96vh !important; /* Занимает почти весь экран по высоте */
            height: 96vh !important;
            max-width: 95vw !important;
            width: 1400px !important;    /* Шире, чтобы ветки не сжимались */
            overflow-y: auto !important;
            overflow-x: auto !important;
        }
        /* 2. Снимаем flex-сжатие и overflow: hidden с вкладок планировщика */
        #tab-hero-build {
            overflow: visible !important;
            flex: none !important;
            height: auto !important;
        }
        #hp-buildsim-container {
            display: flex !important;
            flex-direction: column !important;
            max-height: none !important;
            overflow: visible !important;
            flex: none !important;
            height: auto !important;
            padding-bottom: 10px !important;
        }
        #hp-buildsim-container .tab-content.active {
            overflow: visible !important;
            flex: none !important;
            height: auto !important;
        }
        /* 3. Обертка дерева больше не изолирует внутренний скролл */
        #hp-buildsim-container .sim-tree-wrap {
            overflow: visible !important;
            flex: 1 1 auto !important;
            min-height: auto !important;
            padding-bottom: 0 !important;
        }
        /* 4. Запас хода под нижний ряд узлов (узлы выступают за sim-in 630px).
           v11.6.2a.5: подписи больше не клипаются по 2 строки, поэтому запас
           увеличен 45 -> 60px — трёхстрочное имя в нижнем ярусе не срезается. */
        #hp-buildsim-container .sim-tree-inner {
            overflow: visible !important;
            height: auto !important;
            padding-bottom: 60px !important;
        }

        /* ============================================================
           11.6.2c.5: UI/UX РЕДИЗАЙН «СКАНЕРА АУКЦИОНА»
           Карточные строки в нативном стиле игры: полоска редкости слева,
           двухстрочная карточка предмета, чипы второстепенных данных,
           фильтры-чипы вместо серых чекбоксов и премиальная кнопка скана.
           ВАЖНО: правила таблицы начинаются с .custom-modal — иначе их
           перебивают общие правила модалок (.custom-modal td / th выше).
           ============================================================ */
        /* Окно сканера. Общее правило .custom-modal:not(.modal-compact) из
           блока планировщика билдов растягивает ВСЕ обычные окна до 1400px
           и 96vh; для 6-колоночного аукциона это лишнее — фиксируем 1000px,
           чтобы таблица влезала без горизонтальной прокрутки. */
        .custom-modal.auc-modal {
            width: 1000px !important;
            height: auto !important;
            max-height: 92vh !important;
        }
        /* Скроллится сама таблица, а не окно целиком: иначе sticky-заголовок
           «Предмет/Цена/…» перестаёт липнуть, и шапка уезжает вместе с лотом.
           При коротком списке окно сжимается по контенту (flex: 0 1 auto). */
        .custom-modal.auc-modal .table-container { flex: 0 1 auto; max-height: 62vh; min-height: 0; }
        .custom-modal .auc-head { justify-content: flex-start !important; gap: 10px; }
        .custom-modal .auc-head-title { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
        .auc-info-btn { width: 26px; height: 26px; flex: none; padding: 0; border-radius: 50%; background: rgba(202, 165, 92, 0.15); border: 1px solid #caa55c; color: #caa55c; font-family: Georgia, serif; font-size: 15px; font-weight: bold; line-height: 1; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.15s, color 0.15s; }
        .auc-info-btn:hover { background: #caa55c; color: #1d1620; }
        /* Кнопка полного скана: id + класс перебивают старое правило по id. */
        #lg-auction-full-scan.auc-scan-btn { padding: 5px 14px; min-height: 0; background: linear-gradient(180deg, #3a2b39, #241a2b); border: 1px solid #caa55c; border-radius: 7px; color: #ffcf6a; font-family: inherit; font-size: 12px; font-weight: bold; letter-spacing: 0.02em; white-space: nowrap; cursor: pointer; box-shadow: inset 0 1px 0 rgba(255, 207, 106, 0.15), 0 2px 6px rgba(0, 0, 0, 0.4); transition: filter 0.15s, box-shadow 0.15s, opacity 0.2s; }
        #lg-auction-full-scan.auc-scan-btn:hover:not(:disabled) { filter: brightness(1.18); box-shadow: 0 0 12px rgba(202, 165, 92, 0.35); }
        #lg-auction-full-scan.auc-scan-btn:disabled { opacity: 0.55; cursor: not-allowed; filter: grayscale(0.3); }
        /* ── Тулбар: поиск, селекты, фильтры-чипы, пагинация ── */
        .auc-toolbar { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
        .auc-toolbar-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .auc-search-input { flex: 1 1 220px; min-width: 170px; box-sizing: border-box; margin: 0; padding: 8px 12px; background: #16111c; border: 1px solid #3d2f44; border-radius: 8px; color: #f7eadf; font-family: inherit; font-size: 13px; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
        .auc-search-input::placeholder { color: #7a6d86; }
        .auc-search-input:focus { border-color: #caa55c; box-shadow: 0 0 0 2px rgba(202, 165, 92, 0.18); }
        .auc-select { box-sizing: border-box; margin: 0; padding: 8px 10px; background: #16111c; border: 1px solid #3d2f44; border-radius: 8px; color: #e6dcc8; font-family: inherit; font-size: 12px; cursor: pointer; outline: none; transition: border-color 0.2s; }
        .auc-select:hover { border-color: #caa55c; }
        .auc-select:focus { border-color: #caa55c; }
        .auc-select option { background: #16111c; color: #e6dcc8; }
        /* Фильтры-чипы: сам чекбокс скрыт, активное состояние читается через
           :has(input:checked) — без JS-обвязки. */
        .auc-filter-chip { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; background: #1b1522; border: 1px solid #3d2f44; color: #b3a6bf; font-size: 12px; font-weight: bold; cursor: pointer; user-select: none; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s; }
        .auc-filter-chip input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
        .auc-filter-chip:hover { border-color: #caa55c; color: #ffcf6a; }
        .auc-filter-chip:has(input:checked) { background: rgba(202, 165, 92, 0.18); border-color: #caa55c; color: #ffcf6a; box-shadow: inset 0 0 8px rgba(202, 165, 92, 0.22); }
        .auc-filter-chip:has(input:focus-visible) { outline: 2px solid #caa55c; outline-offset: 1px; }
        .auc-pager { display: flex; align-items: center; gap: 8px; margin-left: auto; }
        .auc-page-btn { min-width: 32px; padding: 5px 10px; background: #1b1522; border: 1px solid #caa55c; border-radius: 8px; color: #caa55c; font-family: inherit; font-weight: bold; font-size: 12px; cursor: pointer; transition: background 0.15s, color 0.15s; }
        .auc-page-btn:hover:not(:disabled) { background: #caa55c; color: #1d1620; }
        .auc-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .auc-page-info { color: #9c8fa8; font-size: 12px; white-space: nowrap; }
        /* ── Таблица-карточки: 6 колонок ── */
        .custom-modal .auc-table { width: 100%; border-collapse: separate; border-spacing: 0 4px; table-layout: fixed; font-size: 13px; }
        .custom-modal .auc-table thead th { position: sticky; top: 0; z-index: 3; background: #241c2b; border: none; border-bottom: 1px solid #3d2f44; padding: 6px 10px; color: #caa55c; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
        .custom-modal .auc-table thead th.auc-col-action { text-align: center; cursor: default; }
        /* Стрелка сортировки ↕ нужна только сортируемым колонкам. */
        .custom-modal .auc-table th:not([data-sort])::after { content: ''; }
        .custom-modal .auc-row td { background: #241c2b; border: none; border-top: 1px solid rgba(255, 255, 255, 0.05); padding: 5px 10px; vertical-align: middle; transition: background 0.15s; }
        .custom-modal .auc-row td:first-child { border-left: 4px solid var(--rc, #c9ccd6); border-radius: 8px 0 0 8px; }
        .custom-modal .auc-row td:last-child { border-radius: 0 8px 8px 0; }
        .custom-modal .auc-row.is-cheap td { background: #23301f; }
        .custom-modal .auc-row.is-cur td { background: #2b2433; }
        .custom-modal .auc-row:hover td { background: #33283d; }
        /* Цвет редкости: одна переменная --rc на строку (наследуется в ячейки). */
        .auc-row[data-r="common"] { --rc: #c9ccd6; }
        .auc-row[data-r="uncommon"] { --rc: #4cc95a; }
        .auc-row[data-r="rare"] { --rc: #4aa3ff; }
        .auc-row[data-r="epic"] { --rc: #b06bff; }
        .auc-row[data-r="legendary"] { --rc: #ffb83d; }
        /* ── Карточка предмета: арт + название + субтитр с чипами ── */
        .auc-item-flex { display: flex; align-items: center; gap: 9px; min-width: 0; }
        .auc-item-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .auc-item-title { display: flex; align-items: center; gap: 5px; color: var(--rc, #f7eadf); font-weight: bold; white-space: nowrap; overflow: hidden; }
        .auc-item-name { overflow: hidden; text-overflow: ellipsis; }
        .auc-item-qty { flex: none; color: #ffcf6a; font-size: 12px; font-weight: bold; }
        .auc-item-sub { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; color: #9c8fa8; }
        .auc-rarity-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--rc, #c9ccd6); box-shadow: 0 0 6px var(--rc, #c9ccd6); }
        .auc-item-seller { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #auction-body .auc-item-flex .b-lot-art { margin-right: 0; }
        /* Микро-бейджи второстепенных данных (вложено заточки, цена NPC). */
        .auc-chip-tag { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 999px; font-size: 10px; line-height: 1.5; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); color: #d8c9a8; white-space: nowrap; }
        .auc-chip-tag.invested { background: rgba(176, 107, 255, 0.12); border-color: rgba(176, 107, 255, 0.35); color: #d9c2ff; }
        .auc-chip-tag.npc-cheap { background: rgba(76, 201, 90, 0.14); border-color: rgba(76, 201, 90, 0.45); color: #8ff2a0; font-weight: bold; }
        /* ── Цена, медиана, выгода, таймер ── */
        .auc-price-box { display: flex; flex-direction: column; gap: 1px; line-height: 1.25; }
        .auc-price-total { color: #ffcf6a; font-weight: bold; white-space: nowrap; }
        .auc-price-unit { color: #9c8fa8; font-size: 11px; white-space: nowrap; }
        .auc-deal-badge { display: inline-block; min-width: 52px; padding: 2px 7px; border-radius: 6px; text-align: center; font-size: 12px; font-weight: bold; font-variant-numeric: tabular-nums; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); color: #b9aec6; }
        .auc-deal-badge.great { background: rgba(76, 201, 90, 0.16); border-color: rgba(76, 201, 90, 0.55); color: #6ff08a; text-shadow: 0 0 6px rgba(76, 201, 90, 0.45); }
        .auc-deal-badge.good { background: rgba(139, 195, 74, 0.14); border-color: rgba(139, 195, 74, 0.45); color: #b6e06a; }
        .auc-deal-badge.bad { background: rgba(255, 90, 122, 0.12); border-color: rgba(255, 90, 122, 0.4); color: #ff8fa3; }
        .auc-time { color: #9c8fa8; font-size: 12px; white-space: nowrap; }
        .auc-time.raffle { color: #e0a800; font-weight: bold; }
        /* Кнопка покупки: размеры и фон остаются инлайновыми (состояния из JS),
           здесь только форма и эффекты наведения. */
        .auc-buy-btn { border-radius: 6px !important; transition: filter 0.15s, box-shadow 0.15s, opacity 0.2s; }
        .auc-buy-btn:hover:not(:disabled) { filter: brightness(1.15); box-shadow: 0 0 10px rgba(76, 201, 90, 0.35); }
        .auc-buy-btn:disabled { filter: grayscale(0.4); }
        .auc-table-wrap { border: none; background: transparent; padding-right: 2px; }
        .custom-modal .auc-table td.auc-empty { background: transparent; border-left: none; text-align: center; padding: 20px; color: #888; }
        .auc-footer { margin-top: 8px; font-size: 12px; color: #8b7f96; text-align: right; }

        /* ============================================================
           11.6.2b: БОЕВОЙ АССИСТЕНТ (modules/combat-assistant.js)
           Контейнер висит по центру сверху и прозрачен для мыши, чтобы не
           перекрывать нативный UI похода; кликабельна только карточка
           подсказки (pointer-events: auto) с кнопкой «Вставить в чат».
           ============================================================ */
        #lg-combat-assistant {
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
        }
        .lg-combat-banner {
            background: #c81e1e; color: #fff; font: 900 24px/1.2 Arial; padding: 12px 24px;
            border: 3px solid #ff5a5a; border-radius: 12px; box-shadow: 0 0 30px rgba(255,50,50,0.8);
            text-transform: uppercase; animation: lgPulse 1s infinite alternate;
        }
        @keyframes lgPulse { from { transform: scale(1); opacity: 0.9; } to { transform: scale(1.05); opacity: 1; } }
        .lg-combat-suggest {
            background: rgba(18,26,22,0.95); border: 2px solid #ffcf6a; color: #fff; padding: 8px 16px;
            border-radius: 8px; display: flex; gap: 12px; align-items: center; pointer-events: auto; font: bold 14px Arial;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }
        .lg-combat-btn { background: #ffcf6a; color: #000; border: none; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: transform 0.1s; }
        .lg-combat-btn:active { transform: scale(0.95); }

    `;
