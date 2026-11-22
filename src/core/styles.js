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
           шапки веток 28 + поле 630) прокручивается вместе с модалкой
           (v11.6.3a: max-height: calc(100vh - 40px), height: auto).
           overflow: visible, чтобы не обрезались свечения узлов. */
        .sim-tree-wrap { flex: 1; min-width: 0; background: #16121a !important; border: 1px solid #3d2f44; border-radius: 8px; box-shadow: inset 0 0 20px rgba(0,0,0,0.6); position: relative; overflow: visible; display: flex; flex-direction: column; }
        /* v11.6.3b: min-width 800px (было 950) — дерево больше не сжимает
           сайдбар классов на средних экранах; три ветки всё ещё не «в кашу». */
        .sim-tree-inner { min-width: 800px; padding: 12px; display: flex; flex-direction: column; height: auto; flex-shrink: 0; background: transparent !important; position: relative; }
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
        /* v11.6.5b.1: «⟲ От вложенного» — старт плана от текущих очков героя.
           Цвет нейтральный (не конфликтует с золотом «Поделиться» и красным
           «Сбросить всё»), чтобы в панели 38px кнопки различались. */
        .sim-keep-btn { background: transparent; color: #9fd0ff; border: 1px solid #9fd0ff; }
        .sim-keep-btn:hover { background: rgba(159, 208, 255, 0.14); }
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
        /* ============================================================
           ПЛАНИРОВЩИК БИЛДОВ — ВЕРТИКАЛЬНЫЙ САЙДБАР КЛАССОВ (v11.6.3b)
           Горизонтальная строка табов заменена slim-сайдбаром слева
           (Вариант А): освобождает 50–60px по высоте под дерево навыков.
           Раскладка: .sim-layout (flex-строка) -> .sim-sidebar (170px) +
           .sim-main-content (дерево + панель статов, своя прокрутка).
           ============================================================ */
        .sim-layout {
            display: flex !important;
            align-items: stretch;     /* main-content тянется по высоте — иначе не скроллится */
            gap: 12px;
            flex: 1 !important;       /* занимает всю высоту контейнера BuildSim */
            min-height: 0 !important; /* без этого flex-потомок не даст внутренний скролл */
            width: 100%;
        }
        .sim-sidebar {
            display: flex;
            flex-direction: column;
            gap: 6px;
            flex: 0 0 170px;         /* фиксированная ширина: дерево не сжимает сайдбар */
            width: 170px;
            min-width: 0;
            max-height: 100%;
            overflow-y: auto;        /* страховка, если классов станет больше, чем влезает */
            overflow-x: hidden;
            align-self: flex-start;  /* не растягиваем по высоте дерева */
            position: sticky;        /* сайдбар «прилипает»: скроллится только дерево */
            top: 0;
            padding: 2px 6px 2px 0;
            box-sizing: border-box;
        }
        /* Правая часть: дерево + панель статов. Прокрутка живёт ЗДЕСЬ, чтобы
           модалка не скроллилась целиком (v11.6.3b). */
        .sim-main-content {
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            min-width: 0;
            min-height: 0;
            overflow-y: auto !important;
            overflow-x: hidden !important;
            padding-right: 2px;
        }
        /* Разделитель «Экипировка | классы» в сайдбаре. */
        .sim-sidebar-sep {
            flex: none;
            height: 1px;
            margin: 2px;
            background: linear-gradient(90deg, transparent, #3d2f44 15%, #3d2f44 85%, transparent);
        }
        /* v11.6.3: метка класса-владельца общих очков (режим sk.md =
           'shared'). Аналог нативного .skc-ow из skills.js. */
        .sim-sidebar .modal-tab.sim-tab .sim-tab-own {
            margin-left: auto;
            flex: none;
            min-width: 16px;
            padding: 0 4px;
            border-radius: 8px;
            background: #7ee08a;
            color: #12100e;
            font-size: 11px;
            font-weight: 900;
            line-height: 16px;
            text-align: center;
        }
        /* Кнопка класса в сайдбаре: вертикальный список, цветная полоска слева.
           Цвет класса в --c (инлайн-стиль таба из BuildSim.classColors),
           цвет текста на заливке — в --ct (BuildSim.classTextColors):
           неактивный — тёмная подложка + цветная полоска/текст,
           активный — заливка цветом класса; текст тёмный на светлых цветах
           (Жрец, Паладин, Разбойник) и белый на тёмных (Некромант). */
        .sim-sidebar .modal-tab.sim-tab {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 8px;
            width: 100%;
            height: 34px;
            min-height: 34px;
            padding: 0 10px;
            box-sizing: border-box;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-left: 3px solid var(--c, #caa55c);
            border-radius: 6px;
            background: rgba(0, 0, 0, 0.25);
            color: var(--c, #ffcf6a);
            font-size: 13px;
            font-weight: 700;
            font-family: inherit;
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            cursor: pointer;
            transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .sim-sidebar .modal-tab.sim-tab:hover {
            background: rgba(0, 0, 0, 0.45);
            border-color: rgba(255, 255, 255, 0.14);
            border-left-color: var(--c, #caa55c);
            color: var(--c, #ffcf6a);
        }
        .sim-sidebar .modal-tab.sim-tab.active {
            background: var(--c, #caa55c);
            border-color: var(--c, #caa55c);
            border-left-color: var(--c, #caa55c);
            color: var(--ct, #12100e);
        }
        .sim-sidebar .modal-tab.sim-tab .sim-svg {
            width: 16px;
            height: 16px;
            flex: none;
        }
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
        /* ПАТЧ 11.6.5g: кнопка «Аддон» в нативном баре города (#gu-hud .gu-main).
           Разметка использует родные классы игры (.gu-b/.gu-bi/.gu-bl), поэтому
           размеры кружка, шрифт и подсветку берём у неё. Здесь только страховка:
           emoji не должен раздувать круг и ломать сетку бара. */
        .lgu-nav-btn { flex-shrink: 0; }
        .lgu-nav-btn .gu-bi > span { display: block; font-size: 26px; line-height: 1; }
        @keyframes fabFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .fab-menu-item { position: relative; flex-shrink: 0; background: #2a2030; color: #ffcf6a; border: 1px solid #555; border-radius: 6px; padding: 10px 14px; font-weight: bold; cursor: pointer; font-size: 13px; text-align: left; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center; }
        .fab-menu-item:hover { background: #caa55c; color: #1d1620; border-color: #caa55c; }
        .fab-menu-item.active { background: #4cc95a; color: #1d1620; border-color: #4cc95a; box-shadow: 0 0 15px rgba(76, 201, 90, 0.5); }

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

        /* ============================================================
           HUD ПАТИ (modules/party.js): карточки HP, журнала и чата (v11.7.0)
           ============================================================ */
        .party-hud-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: stretch;
            width: 276px;
            box-sizing: border-box;
            pointer-events: none;
        }
        .party-panel, .party-log-panel, .party-chat-panel {
            display: none;
            position: relative;
            box-sizing: border-box;
            width: 276px;
            background: rgba(18, 15, 24, 0.94);
            border: 1px solid rgba(202, 165, 92, 0.35);
            border-radius: 10px;
            padding: 8px 10px;
            box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);
            font: 12px/1.4 system-ui, "Segoe UI", sans-serif;
            color: #e8e8ea;
            pointer-events: none;
        }
        .party-drag-handle {
            pointer-events: auto;
            cursor: grab;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
        }
        .party-drag-handle:active,
        .party-hud-container.party-dragging .party-drag-handle {
            cursor: grabbing;
        }

        /* Карточка HP */
        .party-panel-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            font-size: 10px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #c9b184;
            font-weight: bold;
            margin-bottom: 6px;
        }
        .party-member-row {
            padding: 3px 4px;
            border-radius: 6px;
            margin-bottom: 4px;
            transition: background 0.15s ease;
            border-bottom: 1px dashed rgba(255, 255, 255, 0.06);
        }
        .party-member-row:hover {
            background: rgba(255, 255, 255, 0.04);
        }
        .party-member-row:last-child {
            border-bottom: none;
            margin-bottom: 0;
        }
        .party-member-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
        }
        .party-member-name {
            color: #ffcf6a;
            font-weight: bold;
            font-size: 11.5px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .party-member-hp-val {
            display: flex;
            align-items: center;
            gap: 5px;
            white-space: nowrap;
        }
        .party-hp-num {
            color: #d8c9a8;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
        }
        .party-hp-track {
            height: 5px;
            margin-top: 3px;
            border-radius: 3px;
            background: #251d2c;
            overflow: hidden;
        }
        .party-hp-fill {
            height: 5px;
            border-radius: 3px;
            transition: width 0.25s ease, background 0.2s ease;
        }

        /* Кнопка лечения */
        .party-heal-btn {
            pointer-events: auto;
            flex: none;
            padding: 1px 6px;
            background: #1c2b22;
            border: 1px solid #4ade80;
            color: #4ade80;
            border-radius: 4px;
            font-size: 10.5px;
            line-height: 14px;
            cursor: pointer;
            transition: background 0.15s, color 0.15s, transform 0.1s;
        }
        .party-heal-btn:hover:not(:disabled) {
            background: #4ade80;
            color: #120f18;
            transform: scale(1.05);
        }
        .party-heal-btn.copied {
            background: #ffcf6a !important;
            border-color: #ffcf6a !important;
            color: #120f18 !important;
            font-weight: bold;
        }
        .party-heal-btn:disabled {
            opacity: 0.5;
            cursor: default;
        }

        /* Карточка Журнала */
        .party-log-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            font-size: 10px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #c9b184;
            font-weight: bold;
        }
        .party-log-body {
            pointer-events: auto;
            max-height: 150px;
            overflow-y: auto;
            margin-top: 6px;
        }
        .party-log-body::-webkit-scrollbar { width: 4px; }
        .party-log-body::-webkit-scrollbar-thumb { background: #44374a; border-radius: 3px; }
        .party-log-body::-webkit-scrollbar-thumb:hover { background: #caa55c; }
        .party-log-toggle {
            pointer-events: auto;
            background: none;
            border: none;
            padding: 0 4px;
            color: #ffcf6a;
            cursor: pointer;
            font-size: 13px;
            font-weight: bold;
            line-height: 1;
        }
        .party-log-toggle:hover { color: #fff; }

        /* Карточка Чата пати */
        .party-chat-panel {
            flex-direction: column;
        }
        .party-chat-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .party-chat-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 10px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #c9b184;
            font-weight: bold;
        }
        .party-chat-badge {
            background: #e03e52;
            color: #fff;
            border-radius: 8px;
            padding: 0 5px;
            font-size: 9px;
            font-weight: bold;
            line-height: 13px;
        }
        .party-chat-toggle {
            pointer-events: auto;
            background: none;
            border: none;
            padding: 0 4px;
            color: #ffcf6a;
            cursor: pointer;
            font-size: 13px;
            font-weight: bold;
            line-height: 1;
        }
        .party-chat-toggle:hover { color: #fff; }
        .party-chat-content {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 6px;
        }
        .party-chat-body {
            pointer-events: auto;
            max-height: 140px;
            min-height: 50px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding-right: 2px;
        }
        .party-chat-body::-webkit-scrollbar { width: 4px; }
        .party-chat-body::-webkit-scrollbar-thumb { background: #44374a; border-radius: 3px; }
        .party-chat-body::-webkit-scrollbar-thumb:hover { background: #caa55c; }
        .party-chat-empty {
            color: #777;
            font-style: italic;
            font-size: 11px;
            text-align: center;
            padding: 10px 0;
        }
        .party-chat-msg {
            font-size: 11px;
            line-height: 1.35;
            word-break: break-word;
        }
        .party-chat-time {
            color: #7f7389;
            font-size: 9.5px;
            margin-right: 4px;
            font-variant-numeric: tabular-nums;
        }
        .party-chat-nick {
            color: #ffcf6a;
            font-weight: bold;
            margin-right: 4px;
        }
        .party-chat-nick.party-chat-self {
            color: #8ff2a0;
        }
        .party-chat-text {
            color: #ece5f0;
        }
        .party-chat-form {
            display: flex;
            align-items: center;
            gap: 4px;
            pointer-events: auto;
            margin-top: 2px;
        }
        .party-chat-input {
            flex: 1 1 auto;
            min-width: 0;
            background: #120d17;
            border: 1px solid #3d2f44;
            border-radius: 5px;
            padding: 4px 7px;
            font-size: 11px;
            color: #fff;
            outline: none;
            box-sizing: border-box;
        }
        .party-chat-input:focus {
            border-color: #caa55c;
        }
        .party-chat-send {
            flex: none;
            background: #caa55c;
            border: none;
            color: #120f18;
            border-radius: 5px;
            padding: 4px 8px;
            font-size: 10px;
            font-weight: bold;
            cursor: pointer;
            transition: filter 0.15s;
        }
        .party-chat-send:hover {
            filter: brightness(1.15);
        }

        /* ============================================================
           ПЛАНИРОВЩИК БИЛДОВ — СКРОЛЛ ДЕРЕВА + ГРАНИЦЫ МОДАЛКИ (v11.6.3b)
           v11.6.3a: высота модалки = min(контент, 100vh - 40px).
           v11.6.3b: прокрутка переехала ВНУТРЬ (.sim-main-content) — модалка
           больше не скроллится целиком, поэтому заголовок и сайдбар классов
           всегда остаются на месте, а дерево едет отдельно.
           Чтобы внутренний скролл включился, ограничение высоты должно
           доходить до .sim-main-content: каждое звено цепочки
           модалка -> #tab-hero-build -> #hp-buildsim-container -> .sim-layout
           обязано иметь min-height: 0 (иначе flex-потомок не даст себя сжать).
           ============================================================ */
        /* 1. Модалка: высота по контенту, но не выше окна минус 40px.
           box-sizing: border-box обязателен: padding 20px + рамка 2px должны
           входить в calc(100vh - 40px), иначе окно вылезает за экран на 44px
           и низ обрезается (именно это видел Firefox на 125%).
           v11.6.3b: overflow-y у модалки убран — скроллит .sim-main-content.
           overflow задан ЯВНО как hidden на обе оси: если оставить один
           overflow-x: hidden, CSS до-считает overflow-y как auto и модалка
           снова начнёт скроллиться сама (двойной скролл).
           Компактные окна (.modal-compact: настройки, пати, разведка) не
           растягиваем — иначе их 450px-раскладка ломается. */
        .${DOM_IDS.customModal}:not(.modal-compact), .custom-modal:not(.modal-compact) {
            max-height: calc(100vh - 40px) !important; /* Жёсткий потолок по высоте окна */
            height: auto !important;                   /* Тянется по контенту, а не 96vh */
            overflow: hidden !important;               /* Модалка не скроллится: скролл — внутри */
            display: flex !important;
            flex-direction: column !important;
            box-sizing: border-box !important;
            max-width: 95vw !important;
            width: 1400px !important;    /* Шире, чтобы ветки не сжимались */
        }
        /* 2. Вкладки планировщика и контейнер BuildSim — звенья flex-колонки.
           Главное здесь: flex: 1 1 auto + min-height: 0, чтобы ограничение
           высоты модалки доходило до .sim-layout и .sim-main-content — иначе
           внутренний скролл «не включается» и низ дерева обрезается.
           display/flex-direction задаём ТОЛЬКО активной вкладке (селектор с
           .active): правило по одному #id перебило бы
           .tab-content { display: none } и вкладка «Билды» оставалась бы
           видимой при переключении на «Заточку». */
        #tab-hero-build.active,
        #tab-hero-ench.active,
        #hp-buildsim-container {
            display: flex !important;
            flex-direction: column !important;
            flex: 1 1 auto !important;
            min-height: 0 !important;
            height: auto !important;
            /* v11.6.9: было max-height: none — теперь потолок = высота вкладки
               внутри модалки, иначе контент уезжает под нижнюю границу окна. */
            max-height: 100% !important;
            overflow: hidden !important;
        }
        /* v11.6.9: контейнер BuildSim — собственный scrollport. При штатной
           работе скроллит .sim-main-content (там sticky-сайдбар классов), но
           если браузер не сожмёт flex-цепочку, колесо всё равно прокрутит
           вкладку до «Навыков Арены» и сводки статов, а не обрежет низ. */
        #hp-buildsim-container {
            padding-bottom: 10px !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
        }
        #hp-buildsim-container .tab-content.active {
            overflow: visible !important;
            flex: none !important;
            height: auto !important;
        }
        /* 3. Обертка дерева: без внутреннего скролла и без flex-сжатия,
           чтобы не было «скролла в скролле» (v11.6.3a). */
        #hp-buildsim-container .sim-tree-wrap {
            overflow: visible !important;
            flex: none !important;
            min-height: auto !important;
            padding-bottom: 0 !important;
        }
        /* 4. Запас хода под нижний ряд узлов (узлы выступают за sim-in 630px).
           v11.6.2a.5: подписи больше не клипаются по 2 строки, запас 45 -> 60px.
           v11.6.3a: 60 -> 80px — жесткий запас под нижний ряд, чтобы скролл
           модалки гарантированно «доехал» до иконок и подписей. */
        #hp-buildsim-container .sim-tree-inner {
            overflow: visible !important;
            height: auto !important;
            padding-bottom: 80px !important;
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
        /* v11.6.3: привязанная легендарка — красноватый бейдж-замок. */
        .auc-chip-tag.bound { background: rgba(255, 120, 90, 0.14); border-color: rgba(255, 120, 90, 0.45); color: #ffb3a0; font-weight: bold; }
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
           11.7.0: РУЧНАЯ ВСТАВКА В ПОЛЕ КОМАНДЫ ПОХОДА (#qSayIn)
           Игра глушит вставку (noPaste на paste/drop/beforeinput), а слово
           механики босса в походе (.q-nc — canvas) отдаётся с
           user-select: none и pointer-events: none: выделить и скопировать
           его было нельзя. !important перебивает правила site/quest.css
           (специфичность у них такая же, поэтому без !important не выйдет).
           Обработчики вставки дополнительно глушит перехватчик из
           modules/combat-assistant.js (stopImmediatePropagation, БЕЗ
           preventDefault) — нативная вставка браузера остаётся рабочей.
           ============================================================ */
        .q-nc, .q-ncw {
            user-select: text !important;
            -webkit-user-select: text !important;
            pointer-events: auto !important;
        }

        /* ============================================================
           11.6.2b: БОЕВОЙ АССИСТЕНТ (modules/combat-assistant.js)
           Контейнер висит по центру сверху и прозрачен для мыши, чтобы не
           перекрывать нативный UI похода; кликабельны только карточка
           подсказки (pointer-events: auto) — заголовок «Внимание: …» и
           бейдж команды (v11.7.1: кнопка «Вставить» убрана). Баннер сбора
           отряда отсюда убран в 11.7.0: сборы теперь только гильдейские,
           на элитных монстров — см. блок ниже (.lg-cm-gather).
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
        /* v11.6.3: заметка о дебаффе отряда (v.wk) — не блокирует ввод. */
        .lg-combat-note {
            background: rgba(60, 48, 18, 0.95); border: 2px solid #ffcf6a; color: #ffe6a8;
            padding: 8px 14px; border-radius: 8px; font: bold 13px Arial;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5); pointer-events: none;
            max-width: min(560px, 90vw); text-align: center;
        }
        /* v11.7.0: команда — кликабельный бейдж (копирование в буфер). */
        .lg-combat-info { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
        /* v11.7.1: заголовок «Внимание: {что происходит}» — главный текст
           уведомления, поэтому чуть крупнее и контрастнее. */
        .lg-combat-hint { font-size: 13px; line-height: 1.3; color: #ffe6a8; max-width: min(520px, 88vw); }
        .lg-combat-cmd {
            background: #241d10; border: 1px dashed #ffcf6a; color: #ffcf6a;
            border-radius: 6px; padding: 4px 10px; font: bold 15px Arial;
            cursor: pointer; transition: background 0.15s, color 0.15s;
        }
        .lg-combat-cmd:hover { background: #ffcf6a; color: #000; }
        .lg-combat-cmd.copied { background: #4cc95a; border-color: #4cc95a; color: #16121a; }
        /* ============================================================
           11.7.0: СБОР ГИЛЬДИИ НА ЭЛИТНОГО МОНСТРА (modules/pocket-city.js)
           Плавающее уведомление о чужом открытом сборе (POST /api/citymon/act
           { op: 'elist' }) с кнопкой «Присоединиться» (op: 'ejoin').
           Палитра — как у остальных плашек аддона: тёмная панель, золотая
           рамка, золотая кнопка. Позиция: правый нижний угол.
           ============================================================ */
        #lg-citymon-gather {
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 99999 !important;
            display: none;
            pointer-events: none;
        }
        #lg-citymon-gather.on { display: block !important; }
        .lg-cm-gather {
            background: rgba(29, 22, 32, 0.96);
            border: 2px solid #caa55c;
            border-radius: 10px;
            padding: 10px 14px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            align-items: center;
            pointer-events: auto;
            font: bold 14px Arial;
            color: #f7eadf;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
            min-width: 260px;
            max-width: min(560px, 92vw);
            text-align: center;
        }
        .lg-cm-gather-head { color: #9fe3ff; font-size: 14px; line-height: 1.3; }
        /* Подпись с обратным отсчётом: цифры не «прыгают» (tabular-nums). */
        .lg-cm-gather-sub { color: #b9aec6; font-size: 12px; font-weight: normal; font-variant-numeric: tabular-nums; }
        .lg-cm-gather-row { display: flex; align-items: center; gap: 8px; }
        .lg-cm-gather-join {
            background: #ffcf6a; color: #16121a; border: none; padding: 6px 14px;
            border-radius: 6px; font-weight: bold; font-size: 13px; cursor: pointer;
            transition: transform 0.1s, filter 0.15s;
        }
        .lg-cm-gather-join:hover:not(:disabled) { filter: brightness(1.1); }
        .lg-cm-gather-join:active:not(:disabled) { transform: scale(0.95); }
        .lg-cm-gather-join:disabled { opacity: 0.55; cursor: default; }
        .lg-cm-gather-close {
            background: transparent; border: 1px solid #4a3b55; color: #9c8fa8;
            border-radius: 6px; padding: 5px 10px; font: bold 13px Arial;
            cursor: pointer; transition: color 0.15s, border-color 0.15s;
        }
        .lg-cm-gather-close:hover { color: #ff8fa3; border-color: #ff8fa3; }

        /* Размер M (~82-85% от L) */
        #lg-citymon-gather.lg-cm-size-m .lg-cm-gather {
            padding: 7px 11px;
            gap: 4px;
            border-radius: 8px;
            min-width: 220px;
            max-width: min(460px, 92vw);
        }
        #lg-citymon-gather.lg-cm-size-m .lg-cm-gather-head { font-size: 12.5px; line-height: 1.25; }
        #lg-citymon-gather.lg-cm-size-m .lg-cm-gather-sub { font-size: 11px; }
        #lg-citymon-gather.lg-cm-size-m .lg-cm-gather-row { gap: 6px; }
        #lg-citymon-gather.lg-cm-size-m .lg-cm-gather-join { padding: 4px 11px; font-size: 11.5px; border-radius: 5px; }
        #lg-citymon-gather.lg-cm-size-m .lg-cm-gather-close { padding: 4px 8px; font-size: 11.5px; border-radius: 5px; }

        /* Размер S (~68-72% от L, мини-плашка) */
        #lg-citymon-gather.lg-cm-size-s .lg-cm-gather {
            padding: 5px 8px;
            gap: 3px;
            border-radius: 6px;
            border-width: 1.5px;
            min-width: 180px;
            max-width: min(360px, 92vw);
        }
        #lg-citymon-gather.lg-cm-size-s .lg-cm-gather-head { font-size: 11px; line-height: 1.2; }
        #lg-citymon-gather.lg-cm-size-s .lg-cm-gather-sub { font-size: 10px; line-height: 1.2; }
        #lg-citymon-gather.lg-cm-size-s .lg-cm-gather-row { gap: 4px; }
        #lg-citymon-gather.lg-cm-size-s .lg-cm-gather-join { padding: 3px 8px; font-size: 10.5px; border-radius: 4px; }
        #lg-citymon-gather.lg-cm-size-s .lg-cm-gather-close { padding: 3px 6px; font-size: 10px; border-radius: 4px; }

        /* ============================================================
           11.6.5c: СПОСОБНОСТИ АРЕНЫ (modules/hero-planner.js)
           Вкладка «⚔️ Арена»: шапка с жетонами навыков, ветки класса,
           два слота (способность 3-го хода / ульта 5-го хода) и
           локальная симуляция прокачки.
           ============================================================ */
        /* Вкладка арены скроллится сама: контента много (ветки + два слота).
           display задаём только .active, иначе перебьём
           .tab-content { display: none } и вкладка не будет скрываться. */
        #tab-hero-arena.active {
            display: flex !important;
            flex-direction: column !important;
            flex: 1 1 auto !important;
            min-height: 0 !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
        }
        .hp-arena-wrap { display: flex; flex-direction: column; gap: 12px; padding-bottom: 8px; }
        .hp-arena-loading,
        .hp-arena-empty {
            display: flex; align-items: center; gap: 12px; justify-content: center;
            padding: 18px; color: #9c8fa8; font-size: 13px;
        }
        .hp-arena-empty { color: #ffb3a0; }
        /* ── Шапка: баланс жетонов + недельный прогресс ── */
        .hp-arena-header {
            display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px; padding: 10px 14px;
        }
        .hp-token-badge {
            display: inline-flex; align-items: center; gap: 8px;
            background: rgba(202, 165, 92, 0.12); border: 1px solid rgba(202, 165, 92, 0.45);
            border-radius: 999px; padding: 4px 14px; color: #d8c9a8; font-size: 12px; white-space: nowrap;
        }
        .hp-token-badge b { color: #ffcf6a; font-size: 18px; font-variant-numeric: tabular-nums; }
        .hp-arena-week { display: flex; flex-direction: column; gap: 4px; flex: 1 1 180px; min-width: 160px; }
        .hp-arena-week small { font-size: 11px; color: #9c8fa8; }
        .hp-week-bar {
            display: block; height: 8px; border-radius: 999px; overflow: hidden;
            background: #2a2030; border: 1px solid #44374a;
        }
        .hp-week-bar > i {
            display: block; height: 100%; border-radius: 999px;
            background: linear-gradient(90deg, #caa55c, #ffcf4a);
            box-shadow: 0 0 8px rgba(255, 207, 74, 0.45);
        }
        .hp-arena-spent { font-size: 12px; color: #9c8fa8; white-space: nowrap; }
        .hp-arena-spent b { color: #ffcf6a; }
        /* 11.6.5c.7: селектор класса на вкладке «Арена». */
        .arena-class-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
        .arena-class-btn {
            background: #2a2030; border: 1px solid #44374a; color: #d8c9a8;
            padding: 5px 12px; border-radius: 999px; font: inherit; font-size: 12px;
            font-weight: bold; cursor: pointer; white-space: nowrap;
            transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .arena-class-btn:hover:not(:disabled) { background: #352941; border-color: #caa55c; }
        .arena-class-btn.active {
            background: #caa55c; border-color: #caa55c; color: #1d1620;
            box-shadow: 0 0 8px rgba(202, 165, 92, 0.35);
        }
        .arena-class-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        /* ── Ветки класса ── */
        .hp-arena-branches { display: flex; gap: 10px; flex-wrap: wrap; }
        .hp-arena-branch-card {
            display: flex; align-items: center; gap: 10px; flex: 1 1 240px; min-width: 220px;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px; padding: 8px 12px;
            color: #e8dfd0; font: inherit; text-align: left; cursor: pointer;
            transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
        }
        .hp-arena-branch-card:hover:not(:disabled) { border-color: #caa55c; background: #251d2d; }
        .hp-arena-branch-card.active {
            border-color: #caa55c; background: rgba(202, 165, 92, 0.12);
            box-shadow: 0 0 10px rgba(202, 165, 92, 0.25);
        }
        .hp-arena-branch-card:disabled { opacity: 0.55; cursor: default; }
        .hp-branch-ic { flex: none; font-size: 22px; line-height: 1; }
        .hp-branch-lines { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
        .hp-branch-line {
            display: flex; align-items: baseline; gap: 6px; font-size: 12px; color: #d8c9a8;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .hp-branch-line small {
            flex: none; font-size: 10px; color: #7f7389; text-transform: uppercase; letter-spacing: 0.4px;
        }
        .hp-branch-line i { flex: none; font-style: normal; font-size: 11px; color: #8ff2a0; }
        .hp-branch-active {
            flex: none; font-style: normal; font-size: 10px; font-weight: bold;
            color: #1d1620; background: #caa55c; border-radius: 999px; padding: 2px 8px;
        }
        /* ── Два слота: способность (ab) и ульта (ult) ── */
        /* stretch + height:100% + flex:1 у строк выравнивают карточки по
           высоте: подвал «Вложено X из Y» прижимается к низу обеих. */
        .hp-arena-slots { display: flex; gap: 12px; flex-wrap: wrap; align-items: stretch; }
        .hp-arena-card {
            display: flex; flex-direction: column; gap: 8px;
            flex: 1 1 340px; min-width: 300px;
            height: 100%;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px; padding: 10px 12px;
        }
        .hp-arena-card.ult { border-color: rgba(176, 107, 255, 0.45); }
        .hp-arena-card-head { display: flex; align-items: center; gap: 10px; }
        .hp-arena-card-ic { flex: none; font-size: 20px; line-height: 1; }
        .hp-arena-card-title { display: flex; flex-direction: column; flex: 1; min-width: 0; }
        .hp-arena-card-title b { color: #f7eadf; font-size: 14px; }
        .hp-arena-card-title small { color: #9c8fa8; font-size: 11px; }
        .hp-slot-text { margin: 0; font-size: 11px; color: #9c8fa8; line-height: 1.45; }
        /* 11.6.5c.4: бонусы способности (s.lines из /api/abtokens) — чипы
           под описанием: «Урон: 140%», «Кровотечение: 25%» и т.п. */
        .hp-ab-bonuses { display: flex; flex-wrap: wrap; gap: 6px; }
        .hp-ab-bonus {
            font-size: 11px; line-height: 1.4; color: #9fdcff;
            background: rgba(122, 209, 255, 0.10); border: 1px solid rgba(122, 209, 255, 0.35);
            border-radius: 999px; padding: 1px 8px; font-variant-numeric: tabular-nums;
        }
        .hp-ab-rows { display: flex; flex-direction: column; gap: 6px; flex: 1; }
        /* Строка категории: название · пипсы · значение · «+» · описание.
           Описание — во всю ширину второй строкой (grid-column: 1 / -1). */
        .hp-ab-row {
            display: grid; grid-template-columns: 92px 1fr auto auto auto; align-items: center; gap: 6px 8px;
            padding: 5px 8px; border-radius: 6px;
            background: #241c2b; border: 1px solid #33283d;
        }
        .hp-ab-name { font-size: 12px; font-weight: bold; color: #e8dfd0; }
        .hp-ab-pips { display: flex; gap: 3px; flex-wrap: wrap; }
        .hp-ab-pips i {
            width: 9px; height: 9px; border-radius: 50%;
            background: #3a2f44; border: 1px solid #4a3b55;
        }
        /* 11.6.5c.8: пипсы — золотые уровни плана, синие купленные в игре. */
        .hp-ab-pips i.on { background: #caa55c; border-color: #ffcf4a; box-shadow: 0 0 6px rgba(255, 207, 74, 0.55); }
        .hp-ab-pips i.sim { background: #4aa3ff; border-color: #7ad1ff; box-shadow: 0 0 6px rgba(74, 163, 255, 0.55); }
        .hp-ab-val { font-size: 11px; color: #9c8fa8; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .hp-ab-val b { color: #ffcf6a; font-size: 12px; }
        .hp-ab-btn {
            width: 26px; height: 26px; padding: 0; line-height: 1;
            border-radius: 6px; border: 1px solid #caa55c;
            background: rgba(202, 165, 92, 0.16); color: #ffcf6a;
            font-weight: bold; font-size: 15px; cursor: pointer;
            transition: background 0.15s, transform 0.1s, opacity 0.15s;
        }
        .hp-ab-btn:hover:not(:disabled) { background: rgba(202, 165, 92, 0.34); }
        .hp-ab-btn:active:not(:disabled) { transform: scale(0.94); }
        .hp-ab-btn:disabled {
            opacity: 0.35; cursor: not-allowed;
            border-color: #4a3d55; color: #8b7f96; background: rgba(255, 255, 255, 0.04);
        }
        /* 11.6.5c.2: «−» — нейтральная кнопка отката шага плана. */
        .hp-ab-btn.minus { border-color: #6b5570; background: rgba(255, 255, 255, 0.05); color: #d8c9a8; }
        .hp-ab-btn.minus:hover:not(:disabled) { background: rgba(255, 255, 255, 0.14); }
        .hp-ab-desc { grid-column: 1 / -1; font-size: 10px; color: #7f7389; line-height: 1.4; }
        /* ── Панель действий ── */
        .hp-arena-sim-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        /* 11.6.5c.2: сводка плана — кошелёк, стоимость плана, дефицит.
           Дефицит ничего не блокирует: это подсказка «сколько фармить». */
        .arena-plan-summary {
            display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px;
            padding: 8px 14px; font-size: 12px; color: #d8c9a8;
        }
        .arena-plan-summary b { color: #ffcf6a; font-variant-numeric: tabular-nums; }
        .arena-deficit { color: #ffb3a0; font-weight: bold; }
        .arena-deficit b { color: #ff8f7a; }
        .arena-ready { color: #8ff2a0; font-weight: bold; }
        .hp-arena-btn {
            background: #2a2030; border: 1px solid #44374a; color: #d8c9a8;
            padding: 7px 14px; border-radius: 6px; font-weight: bold; font-size: 13px; cursor: pointer;
            transition: background 0.15s, border-color 0.15s, opacity 0.15s;
        }
        .hp-arena-btn:hover:not(:disabled) { background: #352941; border-color: #caa55c; }
        .hp-arena-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        /* ── Подвал карточки/вкладки ── */
        .hp-card-foot { font-size: 11px; color: #8b7f96; line-height: 1.5; }
        .hp-card-foot b { color: #ffcf6a; font-variant-numeric: tabular-nums; }

        /* Редизайн заточки: Split-view (11.6.5f).
           Слева — таблица уровней, справа — карточка выбранной цели (+N).
           minmax(0, 1fr) у первой колонки обязателен: иначе таблица
           распирает грид-колонку по min-content и правая карточка уезжает
           за край модалки. */
        /* 11.6.5f.1: слева карточка цели (40%), справа таблица уровней (60%).
           flex-basis в сумме даёт >100% из-за gap 12px, поэтому колонки чуть
           поджимаются flex-shrink — пропорция 40:60 сохраняется, а вторая
           колонка не переносится на новую строку. */
        .hp-ench-split {
            display: flex;
            gap: 12px;
            align-items: flex-start;
            min-height: 0;
        }
        .hp-ench-left {
            flex: 1 1 40%; min-width: 280px;
            display: flex; flex-direction: column; gap: 10px;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px;
            padding: 10px 12px;
        }
        /* Таблица уровней: без вертикального скроллбара, чтобы 16 строк помещались в окне. */
        .hp-ench-right {
            flex: 1 1 auto; min-width: 0;
            overflow-x: auto;
            overflow-y: visible;
        }
        /* Узкая модалка/маленькое окно — таблица уезжает под карточку цели. */
        @media (max-width: 980px) {
            .hp-ench-split { flex-direction: column; }
            .hp-ench-left, .hp-ench-right, .hp-ench-rightcol { flex: 1 1 auto; width: 100%; min-width: 0; }
        }
        /* Таблица уровней: компактнее общих правил .custom-modal th/td и без
           псевдоэлемента сортировки «↕» (здесь сортировки нет). Запрещаем
           вертикальное растяжение таблицы и строк (без пустых зазоров). */
        .custom-modal .hp-ench-table {
            height: auto !important;
            align-self: start;
            border-collapse: collapse;
        }
        .hp-ench-table tbody,
        .hp-ench-table tr {
            height: auto !important;
        }
        .custom-modal .hp-ench-table th,
        .custom-modal .hp-ench-table td {
            padding: 3px 8px !important;
            line-height: 1.2 !important;
            height: auto !important;
            font-size: 12px;
        }
        .custom-modal .hp-ench-table th { cursor: default; white-space: nowrap; }
        .custom-modal .hp-ench-table th::after { content: ''; }
        /* Строка уровня — кликабельный ВЫБОР уровня просмотра (v11.7.1: все
           строки +0…+15 кликабельны, в том числе пройденные). */
        .hp-ench-table .hp-ench-row { cursor: pointer; transition: background 0.12s; }
        .hp-ench-table .hp-ench-row:hover { background: rgba(202, 165, 92, 0.08); }
        .hp-ench-table .hp-ench-row.passed { cursor: default; opacity: 0.45; }
        .hp-ench-table .hp-ench-row.passed:hover { background: transparent; }
        .hp-ench-table .hp-ench-row.cur { opacity: 1; background: rgba(202, 165, 92, 0.12); }
        .hp-ench-table .hp-ench-row.target { background: rgba(122, 209, 255, 0.12); }
        .hp-ench-table .hp-ench-row.target td:first-child { box-shadow: inset 2px 0 0 #7ad1ff; }
        /* v11.7.1: строка ВЫБРАННОГО уровня просмотра (может быть и ниже
           текущей заточки) — голубая подсветка слева. */
        .hp-ench-table .hp-ench-row.preview { background: rgba(122, 209, 255, 0.1); }
        .hp-ench-table .hp-ench-row.preview td:first-child { box-shadow: inset 2px 0 0 #7ad1ff; }
        /* Колонка «Статы»: значения предмета на уровне этой строки. */
        .custom-modal .hp-ench-table td.hp-ench-stats {
            font-size: 11px; line-height: 1.35; color: #b9adc6;
            min-width: 140px; font-variant-numeric: tabular-nums;
        }
        /* Чипы усилителей (⭐ звезда / 🌐 сфера) в колонке «Усилители». */
        .hp-mats-cell { white-space: nowrap; }
        .hp-mat-chip {
            display: inline-flex; align-items: center; gap: 3px;
            font-size: 12px; line-height: 1; padding: 3px 6px; margin: 0 2px;
            border-radius: 6px; border: 1px solid #4a3b55; background: #241c2b;
            cursor: pointer; user-select: none;
        }
        .hp-mat-chip input { margin: 0; cursor: pointer; accent-color: #caa55c; }
        .hp-mat-chip.star { border-color: rgba(202, 165, 92, 0.5); }
        .hp-mat-chip.sphere { border-color: rgba(122, 209, 255, 0.45); }
        /* В режиме «Идеально» усилители не участвуют в расчёте — чипы-подсказки. */
        .hp-mat-chip.muted { cursor: default; opacity: 0.35; }
        /* v11.7.1: кнопки-переключатели ресурсов ⭐/🌐 в строках уровней
           (заменили браузерные чекбоксы). Активное состояние подсвечивается:
           звезда — золотым, сфера — голубым. */
        .hp-mat-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 24px; height: 22px; margin: 0 2px; padding: 0;
            font: inherit; font-size: 12px; line-height: 1;
            border-radius: 6px; border: 1px solid #4a3b55; background: #241c2b;
            cursor: pointer; user-select: none;
            transition: background 0.15s, border-color 0.15s, transform 0.1s;
        }
        .hp-mat-btn:hover { background: #352941; border-color: #6b5a7a; }
        .hp-mat-btn:active { transform: scale(0.94); }
        .hp-mat-btn.star:hover { border-color: rgba(202, 165, 92, 0.7); }
        .hp-mat-btn.sphere:hover { border-color: rgba(122, 209, 255, 0.7); }
        .hp-mat-btn.star.active {
            background: rgba(202, 165, 92, 0.28); border-color: #caa55c;
            box-shadow: 0 0 6px rgba(202, 165, 92, 0.45);
        }
        .hp-mat-btn.sphere.active {
            background: rgba(122, 209, 255, 0.22); border-color: #7ad1ff;
            box-shadow: 0 0 6px rgba(122, 209, 255, 0.4);
        }
        /* ── Шапка карточки: «Просмотр: +N» + пресеты уровней ── */
        .hp-target-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .hp-target-title { font-size: 13px; color: #d8c9a8; }
        .hp-target-title b { color: #ffcf6a; font-size: 19px; font-variant-numeric: tabular-nums; }
        .hp-target-presets { display: flex; gap: 4px; margin-left: auto; }
        .hp-target-preset {
            background: #2a2030; border: 1px solid #44374a; color: #d8c9a8;
            padding: 3px 9px; border-radius: 999px; font: inherit; font-size: 12px;
            font-weight: bold; cursor: pointer;
            transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
        }
        .hp-target-preset:hover:not(:disabled) { background: #352941; border-color: #caa55c; }
        .hp-target-preset.active { background: #caa55c; border-color: #caa55c; color: #1d1620; }
        .hp-target-preset:disabled { opacity: 0.35; cursor: not-allowed; }
        /* v11.7.1: пройденный уровень — приглушён, но КЛИКАБЕЛЕН (можно
           посмотреть статы на уже достигнутой заточке). */
        .hp-target-preset.done { opacity: 0.55; border-style: dashed; }
        .hp-target-preset.done:hover { opacity: 1; }
        /* ── Секции карточки: статы и стоимость ── */
        .hp-target-section {
            display: flex; flex-direction: column; gap: 6px;
            border-top: 1px solid #33283d; padding-top: 8px;
        }
        .hp-target-sub {
            font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: #9c8fa8;
        }
        .hp-stat-grid { display: flex; flex-direction: column; gap: 4px; }
        .hp-stat-row { display: flex; align-items: baseline; gap: 8px; font-size: 12px; color: #d8c9a8; }
        .hp-stat-name {
            flex: 1; min-width: 0; color: #9c8fa8;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .hp-stat-val { white-space: nowrap; font-variant-numeric: tabular-nums; }
        .hp-stat-val b { color: #ffcf6a; }
        .hp-stat-gain { color: #8ff2a0; font-size: 11px; }
        /* v11.7.1: значение на текущей заточке (когда смотрим другой уровень). */
        .hp-stat-cur { color: #9c8fa8; font-size: 11px; }
        .hp-cost-total { font-size: 20px; font-weight: bold; color: #ffcf6a; font-variant-numeric: tabular-nums; }
        .hp-cost-sub { font-size: 11px; color: #9c8fa8; line-height: 1.45; }
        .hp-cost-row { font-size: 12px; color: #d8c9a8; font-variant-numeric: tabular-nums; }
        .hp-cost-note { font-size: 11px; color: #888; line-height: 1.5; margin-top: 10px; }

        /* ── Компактный верх вкладки «Заточка» (11.6.5f.1) ──
           Было 5 полос подряд (режимы, инпуты ресурсов, цены, штраф
           экипировки, локации) — стало 2:
             1) topbar: режимы | инпуты | цены;
             2) суббар: локации + плитка предметов в один ряд.
           Статус экипировки ушёл в иконку рядом с названием предмета. */
        .hp-ench-topbar {
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px 16px; flex-wrap: wrap;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px;
            padding: 5px 10px;
        }
        .hp-mode-switch {
            display: flex; gap: 3px; flex: none;
            background: #241c2b; border: 1px solid #3d2f44; border-radius: 6px; padding: 3px;
        }
        .hp-ench-topbar .hp-mode-btn { padding: 5px 12px; font-size: 12px; line-height: 1.2; }
        .hp-mat-inputs { display: flex; align-items: center; gap: 12px; flex: 1 1 auto; }
        .hp-mat-inputs label {
            display: flex; align-items: center; gap: 6px;
            color: #ffcf6a; font-weight: bold; font-size: 12px; white-space: nowrap;
        }
        .hp-mat-inputs input {
            width: 44px; background: #111; border: 1px solid #555; color: #fff;
            padding: 2px 4px; border-radius: 4px; text-align: center;
            font-weight: bold; font-size: 12px;
        }
        .hp-mat-prices {
            display: flex; align-items: center; gap: 16px; margin-left: auto;
            font-size: 12px; color: #ccc; flex-wrap: wrap;
        }
        /* Вторая строка: локации слева, плитка предметов справа (скролл по X). */
        .hp-ench-subbar {
            display: flex; align-items: center; gap: 10px;
            border-bottom: 1px solid #44374a; padding-bottom: 6px; min-height: 0;
        }
        .hp-loc-tabs { display: flex; gap: 6px; flex: none; }
        .hp-loc-tabs .hp-loc-btn { padding: 4px 9px; font-size: 12px; line-height: 1.2; border-radius: 4px; }
        /* Плитка предметов: компактные иконки (было min-height:120px на контейнере
           и 32px арт с паддингом 8px — теперь ~44px по высоте). */
        .hp-item-grid {
            display: flex; align-items: center; gap: 6px;
            flex: 1 1 auto; min-width: 0; overflow-x: auto; padding: 2px 0;
        }
        .hp-item-grid .hp-item-card { min-width: 52px; padding: 4px 3px; }
        .hp-item-grid .hp-item-art {
            width: 24px; height: 24px; margin-bottom: 2px;
            display: flex; align-items: center; justify-content: center; overflow: hidden;
        }
        /* SVG-арт игры не имеет собственных размеров — растягиваем по контейнеру,
           как это делает <img> из getItemArtHtml (max-width/max-height:100%). */
        .hp-item-grid .hp-item-art > svg { width: 100%; height: 100%; display: block; }
        /* 11.6.5f.1: статус экипировки — маленькая иконка у названия предмета. */
        .hp-gear-pill {
            display: inline-flex; align-items: center; justify-content: center;
            width: 16px; height: 16px; margin-left: 4px; vertical-align: middle;
            border-radius: 50%; font-size: 11px; line-height: 1; cursor: help;
        }
        .hp-gear-pill.ok { color: #1d1620; background: #8ff2a0; }
        .hp-gear-pill.bad { color: #1d1620; background: #ffb3a0; }
        /* v11.7.1: шапка выбранного предмета — мини-арт + название/статус. */
        .hp-item-head { display: flex; align-items: flex-start; gap: 8px; }
        .hp-item-head-art {
            flex: none; width: 28px; height: 28px;
            display: flex; align-items: center; justify-content: center; overflow: hidden;
        }
        .hp-item-head-art > svg { width: 100%; height: 100%; display: block; }
        .hp-item-head-art > img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }

        /* ============================================================
           v11.7.0: ПЛАНИРОВЩИК ГЕРОЯ — ОКНО И БОКОВАЯ ПАНЕЛЬ СТАТОВ
           Модалка — min(1520px, 96vw) и не выше 92vh. Вкладки «Билды»
           и «Заточка» занимают 100% ширины. Двухколоночная сетка 1fr 320px
           с панелью характеристик рендерится строго внутри «Примерки».
           !important обязателен: общее правило некомпактных модалок
           задаёт width/height с !important.
           ============================================================ */
        .custom-modal.hp-planner-modal {
            width: min(1520px, 96vw) !important;
            max-height: 92vh !important;
        }
        /* v11.7.0: двухколоночная сетка строго внутри вкладки «Примерка» */
        .hp-fit-layout {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 320px;
            gap: 12px;
            flex: 1 1 auto;
            min-height: 0;
            width: 100%;
        }
        .hp-fit-main {
            display: flex;
            flex-direction: column;
            gap: 10px;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
        }
        #tab-hero-fit.active {
            display: flex !important;
            flex-direction: column !important;
            flex: 1 1 auto !important;
            min-height: 0 !important;
            max-height: 100% !important;
            overflow: hidden !important;
        }
        /* Узкое окно — панель характеристик уезжает под слоты примерки */
        @media (max-width: 1100px) {
            .hp-fit-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto; overflow-y: auto; }
            .hp-fit-layout > .hp-side { max-height: 40vh; }
        }

        /* Бейдж ТЕСТ на кнопке вкладки и внутри вкладки «Примерка» */
        .hp-test-badge {
            display: inline-block;
            padding: 1px 5px;
            font-size: 10px;
            font-weight: bold;
            letter-spacing: 0.5px;
            line-height: 1.2;
            border-radius: 4px;
            background: rgba(255, 107, 107, 0.2);
            color: #ff6b6b;
            border: 1px solid rgba(255, 107, 107, 0.6);
            vertical-align: middle;
            margin-left: 5px;
            text-transform: uppercase;
        }
        .modal-tab.active .hp-test-badge {
            background: #1d1620;
            color: #ff6b6b;
            border-color: #ff6b6b;
        }
        .hp-fit-head {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 2px;
        }
        .hp-fit-title {
            font-size: 14px;
            font-weight: bold;
            color: #ffcf6a;
        }

        /* ── Постоянная панель характеристик ── */
        .hp-side {
            display: flex; flex-direction: column; gap: 2px;
            min-height: 0; overflow-y: auto;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px;
            padding: 10px 12px; font-size: 12px;
        }
        .hp-side-head {
            font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px;
            color: #ffcf6a; font-weight: bold; margin-bottom: 4px;
        }
        .hp-side-cols,
        .hp-side-row {
            display: grid; grid-template-columns: 1fr auto 46px;
            align-items: baseline; gap: 6px;
        }
        .hp-side-cols {
            font-size: 10px; color: #7f7389; text-transform: uppercase;
            letter-spacing: 0.3px; border-bottom: 1px solid #33283d; padding-bottom: 4px;
        }
        .hp-side-cols span:nth-child(2),
        .hp-side-cols span:nth-child(3) { text-align: right; }
        .hp-side-row {
            padding: 2px 0; color: #d8c9a8;
            border-bottom: 1px dashed rgba(255, 255, 255, 0.04);
        }
        .hp-side-row.strong { color: #f7eadf; font-weight: bold; }
        .hp-side-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hp-side-vals { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .hp-side-vals b { color: #ffcf6a; }
        .hp-side-delta { text-align: right; font-weight: bold; font-variant-numeric: tabular-nums; }
        .hp-side-delta.up { color: #8ff2a0; }
        .hp-side-delta.down { color: #ff9a8a; }
        .hp-side-delta.same { color: #6f6380; }
        .hp-side-sep { border-top: 1px solid #44374a; margin: 5px 0 3px; }
        .hp-side-foot { margin-top: 6px; font-size: 10px; color: #8b7f96; line-height: 1.4; }

        /* ── Вкладка «👗 Примерка» ── */
        .hp-fit-top {
            display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 8px;
            padding: 6px 10px;
        }
        .hp-fit-field {
            display: flex; align-items: center; gap: 6px;
            font-size: 12px; color: #d8c9a8; white-space: nowrap;
        }
        .hp-fit-field select,
        .hp-fit-field input {
            background: #111; border: 1px solid #555; color: #fff;
            padding: 3px 6px; border-radius: 4px; font-weight: bold; font-size: 12px;
        }
        .hp-fit-field input { width: 58px; text-align: center; }
        .hp-fit-chk {
            display: flex; align-items: center; gap: 5px;
            font-size: 12px; color: #d8c9a8; cursor: pointer;
        }
        .hp-fit-rows { display: flex; flex-direction: column; gap: 6px; }
        .hp-fit-row {
            display: grid; grid-template-columns: 132px minmax(0, 1fr) 76px;
            align-items: center; gap: 8px;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 6px;
            padding: 5px 8px;
        }
        .hp-fit-slot { font-size: 12px; color: #d8c9a8; white-space: nowrap; }
        .hp-fit-row select {
            min-width: 0; width: 100%;
            background: #241c2b; border: 1px solid #44374a; color: #e8dfd0;
            border-radius: 4px; padding: 3px 6px; font-size: 12px;
        }
        .hp-fit-row select:focus { outline: none; border-color: #caa55c; }
        .hp-fit-en { font-variant-numeric: tabular-nums; text-align: center; }

        /* ── Компактная «Заточка»: справка справа снизу ── */
        .hp-cost-min { font-size: 11px; color: #8ff2a0; font-variant-numeric: tabular-nums; }
        .hp-ench-rightcol {
            flex: 1 1 60%; min-width: 0; min-height: 0;
            display: flex; flex-direction: column; gap: 6px;
            align-self: start;
        }
        /* v11.7.0: без вертикального скроллбара — таблица +0…+15 и справка помещаются целиком */
        .hp-ench-rightcol > .hp-ench-right {
            flex: 0 0 auto;
            max-height: none;
            overflow-x: auto;
            overflow-y: visible;
        }
        .hp-ench-hint {
            flex: none;
            background: #1e1724; border: 1px solid #3d2f44; border-radius: 6px;
            padding: 6px 9px; font-size: 10px; line-height: 1.45; color: #8b7f96;
        }
        .hp-ench-hint code { color: #d8c9a8; }
        .hp-ench-hint-prices {
            display: flex; flex-wrap: wrap; gap: 4px 14px;
            margin-bottom: 3px; font-size: 11px; color: #ccc;
        }

        /* 11.6.6c: палитра компактных бейджей участников (уровень, класс,
           роль, онлайн). v11.7: игра нативно показывает уровни, классы, силу
           и онлайн согильдейцев, поэтому окно гильдий аддон больше не
           размечает — правила оставлены как общая палитра для бейджей. */
        .lgu-guild-badges {
            display: inline-flex; flex-wrap: wrap; align-items: center;
            gap: 4px; margin-left: 6px; vertical-align: middle;
            font-size: 11px; line-height: 1.2; font-weight: normal;
        }
        .lgu-gst {
            display: inline-flex; align-items: center; gap: 3px;
            padding: 1px 6px; border-radius: 9px; white-space: nowrap;
            border: 1px solid #3d2f44; background: #201826; color: #cfc6d6;
            cursor: help;
        }
        .lgu-gst.on { border-color: #3d7a4a; background: #17301f; color: #8ff2a0; }
        .lgu-gst.on.mine { border-color: #4a6f8f; background: #16242e; color: #9fd6ff; }
        .lgu-gst.time { border-color: #4a4437; background: #241f16; color: #ffcf6a; }
        .lgu-gst.friend { border-color: #6b4a7a; background: #2a1f33; color: #e5b3ff; }
        .lgu-gst.warn { border-color: #7a3d3d; background: #2e1717; color: #ffb3a0; }
        .lgu-gst.off { border-color: #3d3d44; background: #1b1b20; color: #8a8a92; }

        /* 11.6.6c.1: уровень и класс героя. Классы .lgu-cls-* повторяют
           палитру игры (CLASS_META в reference/LegionFrontSRC/lib/game-data.js). */
        .lgu-gbadge {
            display: inline-flex; align-items: center; gap: 3px;
            padding: 1px 6px; border-radius: 9px; white-space: nowrap;
            border: 1px solid #3d2f44; background: #201826; color: #cfc6d6;
            font-weight: bold; cursor: help;
        }
        .lgu-glvl { border-color: #5a5142; background: #241f18; color: #ffcf6a; }
        .lgu-gcls { border-color: #4a5f7a; background: #17222e; color: #9fd6ff; }
        .lgu-cls-legionary { border-color: #a3122a; background: #2a1216; color: #ff9aa2; }
        .lgu-cls-archer { border-color: #2f7a3a; background: #142318; color: #9fe3a2; }
        .lgu-cls-rogue { border-color: #4a4a6a; background: #1b1b24; color: #c9c9e0; }
        .lgu-cls-mage { border-color: #5b3aa8; background: #1e1730; color: #c3a4ff; }
        .lgu-cls-necromancer { border-color: #2f5a4a; background: #14231e; color: #8fe3c4; }
        .lgu-cls-priest { border-color: #9a6a1a; background: #2a2212; color: #ffd88a; }
        .lgu-cls-paladin { border-color: #8a7a2a; background: #262212; color: #ffe9a0; }
        .lgu-cls-recruit { border-color: #3d3d44; background: #1b1b20; color: #b9b9c2; }

        /* «Арена» (modules/arena.js): бейдж шанса победы, плашка
           согильдейцев и подсветка слотов. Палитра — нативная светлая
           карточка новой арены (reference/LegionFrontSRC/site/arena2.css:
           --gw-sep, --gw-soft, --gw-line, --gw-bt, --ar-win/--ar-lose). */

        /* Бейдж шанса победы — в стиле .av-gain: светлая «пилюля» с рамкой,
           шрифт заголовков арены. */
        .lgu-win-chance {
            display: flex;
            align-items: center;
            border-radius: 999px;
            border: 2px solid var(--gw-sep, rgba(43, 29, 24, .2));
            background: var(--gw-soft, rgba(255, 255, 255, .7));
            font: 800 13px var(--gw-bt, 'Russo One', sans-serif);
            padding: 5px 12px;
            text-align: center;
            justify-content: center;
            cursor: help;
        }
        .lgu-win-chance.high {
            background: #eef8e8;
            border-color: rgba(47, 107, 26, .35);
            color: var(--ar-win, #2f6b1a);
        }
        .lgu-win-chance.mid {
            background: #fff8e2;
            border-color: rgba(176, 118, 12, .35);
            color: #8a5800;
        }
        .lgu-win-chance.low {
            background: #fdeceb;
            border-color: rgba(163, 48, 28, .35);
            color: var(--ar-lose, #a3301c);
        }
        /* .av-panel.av-off — блочная карточка с padding 12px, поэтому бейдж
           встаёт отдельной строкой перед .av-gain без своего отступа. */
        .av-panel.av-off > .lgu-win-chance { margin: 2px 0 0; }

        /* Плашка «Согильдейцы» — нативная «пилюля» .av-chip в зелёной гамме,
           чтобы не спорить с чипом рейтинга. margin-left: auto прижимает пару
           «бейдж + чип» вправо в .av-oh (display:flex;
           justify-content:space-between). Текст компактный (arena.js),
           полный список имён — всегда в title. */
        .lgu-guild-foe-warn {
            background: #e0f2d8;
            color: #1e4a12;
            border: 2px solid var(--gw-line, #2b1d18);
            border-radius: 999px;
            font: 800 12px var(--gw-bt, 'Russo One', sans-serif);
            padding: 3px 9px;
            white-space: nowrap;
            flex-shrink: 0;
            margin-left: auto;
            cursor: help;
        }

        /* Контейнер бейджей окна боя (.av-fwin): встаёт перед .av-fbtns. */
        .lgu-arena-card-badge {
            display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
            margin: 4px 0 8px;
        }
        .lgu-arena-card-badge .lgu-win-chance { margin: 0; }
        .lgu-arena-card-badge .lgu-guild-foe-warn { margin-left: 0; }

        /* Подсветка согильдейца на мини-сцене карточки (.av-mh.av-pN) и на
           поле боя (.av-hero.av-foe). Класс ставится только на контейнер:
           textContent, отступы и --fs внутри .av-nm не трогаем — иначе
           сломается нативный подбор размера шрифта ника (nm() в arena2.js). */
        .av-mh.lgu-ally-slot .av-nm {
            background: rgba(34, 98, 26, .92) !important;
            box-shadow: 0 0 0 1.5px #86efac;
        }
        .av-mh.lgu-ally-slot .av-nm span { color: #bbf7d0 !important; }
        .av-mh.lgu-ally-slot .av-f,
        .av-hero.av-foe.lgu-ally-slot .av-f {
            filter: drop-shadow(0 0 5px rgba(74, 222, 128, .9));
        }
        .av-hero.av-foe.lgu-ally-slot .av-nm {
            background: rgba(34, 98, 26, .92) !important;
            box-shadow: 0 0 0 1.5px #86efac;
        }

        /* v11.7: тултип снаряжения соперника (modules/arena.js).
           Появляется по наведению (250 мс) или клику на фигурку бойца на
           мини-сцене карточки (.av-scene .av-mh) и в окне боя (.av-fwin
           .av-hero). Палитра — нативная светлая карточка арены (arena2.css:
           --gw-card/--gw-line/--gw-bt/--gw-mute), поэтому не спорит с игрой. */
        .lgu-arena-gear-tip {
            position: fixed; z-index: 100000; pointer-events: none;
            width: min(300px, 92vw); padding: 9px 11px 10px;
            border: 2px solid var(--gw-line, #2b1d18);
            border-radius: calc(var(--gw-rc, 12px) * .9);
            background: var(--gw-card, #fffaf2);
            color: var(--gw-ink, #2b1d18);
            box-shadow: 0 10px 26px rgba(43, 29, 24, .22);
            font: 12px/1.35 var(--gw-tx, system-ui, sans-serif);
        }
        .lgu-agit-head { display: flex; flex-direction: column; gap: 1px; margin-bottom: 6px; }
        .lgu-agit-head > b {
            font: 700 13.5px var(--gw-bt, 'Russo One', sans-serif);
            color: var(--gw-title, #5a3458);
        }
        .lgu-agit-head > span,
        .lgu-agit-head > div > span { font-size: 11.5px; color: var(--gw-mute, #6b5148); }
        .lgu-agit-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
        .lgu-agit-items > li {
            display: grid;
            grid-template-columns: 82px minmax(0, 1fr);
            grid-template-areas: 'slot name' 'slot stat';
            column-gap: 7px; align-items: baseline;
            padding: 3px 5px; border-radius: 6px;
            background: var(--gw-soft, rgba(43, 29, 24, .05));
            border-left: 3px solid var(--gw-sep, rgba(43, 29, 24, .2));
        }
        .lgu-agit-items > li.empty { opacity: .62; }
        .lgu-agit-items > li[data-r="uncommon"] { border-left-color: #3f9e46; }
        .lgu-agit-items > li[data-r="rare"] { border-left-color: #3a7fd0; }
        .lgu-agit-items > li[data-r="epic"] { border-left-color: #8a4fd0; }
        .lgu-agit-items > li[data-r="legendary"] { border-left-color: #d9921f; }
        .lgu-agit-slot { grid-area: slot; font-size: 11px; color: var(--gw-mute, #6b5148); white-space: nowrap; }
        .lgu-agit-name {
            grid-area: name; min-width: 0;
            font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .lgu-agit-name > b { color: #b07b16; }
        .lgu-agit-items > li > small { grid-area: stat; font-size: 10.5px; color: var(--gw-mute, #6b5148); }
        .lgu-agit-abs { display: flex; flex-direction: column; gap: 2px; margin-top: 7px; font-size: 11px; }
        .lgu-agit-abs > span { display: flex; gap: 4px; align-items: baseline; }
        .lgu-agit-abs > span > i { font-style: normal; }
        .lgu-agit-abs > span.off { opacity: .6; }
        .lgu-agit-abs > span > b { color: var(--gw-title, #5a3458); }
        .lgu-agit-abs em { font-style: normal; font-size: 10.5px; opacity: .85; }


        /* ============================================================
           «СТАТИСТИКА ГИЛЬДИИ» (modules/guild-summary.js)
           Четвёртая вкладка в НАТИВНОМ окне гильдии (.gl-modal ->
           .gl-tabs.gl-tabs1 -> .gl-pane). Палитра — переменные темы
           reference/LegionFrontSRC/site/guilds.css / guilds2.css:
           --gw-card, --gw-sep, --gw-line, --gw-rc, --gw-bt, --gw-title,
           --gw-sel, --gw-acc. Своих цветов не вводим, чтобы сводка
           совпадала с нативной карточкой в любом скине.
           ============================================================ */
        .gl-tabs1 .lgu-gl-tab { display: inline-flex; align-items: center; }
        .gl-tabs1 .lgu-gl-tab > svg.i {
            width: 18px; height: 18px; flex: none; margin-right: 5px;
            display: block;
        }
        /* Нативная панель скрывается только на время показа нашей вкладки;
           селектор повторяет .gl-wide .gl-pane, поэтому !important нужен. */
        .gl-body > .gl-pane.lgu-gl-pane-hidden { display: none !important; }

        .gl-pane.lgu-gl-stats-pane {
            box-sizing: border-box;
            padding: 14px 16px 18px;
            color: var(--gw-ink, #2b1d18);
            font-family: var(--gw-tx, system-ui, sans-serif);
        }

        .lgu-gl-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
            gap: 10px;
            align-items: start;
        }
        .lgu-gl-card {
            min-width: 0;
            padding: 14px 18px;
            border: 2px solid var(--gw-sep, rgba(43, 29, 24, .15));
            border-radius: var(--gw-rc, 12px);
            background: var(--gw-card, #fff);
        }
        .lgu-gl-card-wide { grid-column: 1 / -1; }

        .lgu-gl-h4 {
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px; margin: 0 0 8px; padding-bottom: 6px;
            border-bottom: 2px dashed var(--gw-sep, rgba(43, 29, 24, .15));
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 15px;
            letter-spacing: 0.2px;
            color: var(--gw-title, #5a3458);
        }
        .lgu-gl-h4 > span {
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 14px;
            color: var(--gw-mute, #6b5148);
            white-space: nowrap;
        }

        /* Строки метрик: подпись слева, значение справа. */
        .lgu-gl-rows { display: flex; flex-direction: column; }
        .lgu-gl-row {
            display: flex; align-items: baseline; justify-content: space-between;
            gap: 10px; padding: 4px 0; font-size: 13.5px;
            border-bottom: 1px dashed var(--gw-sep, rgba(43, 29, 24, .15));
        }
        .lgu-gl-row:last-child { border-bottom: 0; }
        .lgu-gl-row > span { color: var(--gw-mute, #6b5148); font-weight: 600; }
        .lgu-gl-row > b {
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 14px;
            white-space: nowrap;
        }
        .lgu-gl-row > b.on { color: var(--gw-sel, #5a3458); }
        .lgu-gl-row > b.warn { color: var(--gw-hot, #b2442c); }

        /* Классы: название, доля и прогресс-бар (заливка --gw-sel). */
        .lgu-gl-classes {
            list-style: none; margin: 0; padding: 0;
            display: flex; flex-direction: column; gap: 7px;
        }
        .lgu-gl-cl-head {
            display: flex; align-items: baseline; justify-content: space-between;
            gap: 8px; font-size: 13px;
        }
        .lgu-gl-cl-head > b {
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: 600;
            font-size: 13.5px;
            color: var(--gw-title, #5a3458);
        }
        .lgu-gl-cl-head > span {
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 14px;
            color: var(--gw-mute, #6b5148);
            white-space: nowrap;
        }
        .lgu-gl-bar {
            height: 10px; margin-top: 3px; overflow: hidden;
            border: 2px solid var(--gw-line, #2b1d18);
            border-radius: 999px;
            background: var(--gw-chip, rgba(43, 29, 24, .12));
        }
        .lgu-gl-bar > i {
            display: block; height: 100%; width: 0; border-radius: 999px;
            background: var(--gw-sel, #5a3458);
            transition: width .25s;
        }

        /* Топ-5 по силе и список неактивных. */
        .lgu-gl-top, .lgu-gl-idle {
            list-style: none; margin: 0; padding: 0;
            display: flex; flex-direction: column; gap: 4px;
        }
        .lgu-gl-toprow, .lgu-gl-idlerow {
            display: flex; align-items: center; gap: 9px;
            padding: 5px 7px;
            border: 2px solid transparent;
            border-radius: calc(var(--gw-rc, 12px) * .6);
            background: var(--gw-soft, rgba(43, 29, 24, .04));
        }
        .lgu-gl-toprow.first {
            border-color: var(--gw-acc, #ffcf4a);
            background: var(--gw-hi, rgba(255, 207, 74, .2));
        }
        .lgu-gl-rank {
            flex: none; display: grid; place-items: center;
            width: 24px; height: 24px; border-radius: 50%;
            background: var(--gw-sel, #5a3458);
            color: var(--gw-on-sel, #fff1d6);
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 14px;
        }
        .lgu-gl-toprow.first .lgu-gl-rank {
            background: var(--gw-acc, #ffcf4a);
            color: var(--gw-on-acc, #2b1d18);
        }
        .lgu-gl-who { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
        .lgu-gl-who > b {
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: 600;
            font-size: 13.5px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .lgu-gl-who > small { font-size: 11.5px; color: var(--gw-mute, #6b5148); }
        .lgu-gl-power {
            flex: none; white-space: nowrap;
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 14px;
            color: var(--gw-title, #5a3458);
        }
        .lgu-gl-idledays {
            flex: none; white-space: nowrap;
            font-family: var(--gw-bt, 'Russo One', system-ui, sans-serif);
            font-weight: var(--gw-btw, 400);
            font-size: 14px;
            color: var(--gw-hot, #b2442c);
        }

        .lgu-gl-note { margin: 6px 0 0; font-size: 12.5px; color: var(--gw-mute, #6b5148); }
        .lgu-gl-foot { margin-top: 10px; text-align: right; }

        /* v11.7: кликабельные строки участников (инспектор героя). */
        .lgu-gl-hero-row { cursor: pointer; }
        .lgu-gl-hero-row:hover,
        .lgu-gl-hero-row:focus-visible {
            border-color: var(--gw-sel, #5a3458);
            background: var(--gw-chip, rgba(43, 29, 24, .12));
            outline: none;
        }
        .lgu-gl-hero-row:focus-visible { box-shadow: 0 0 0 2px var(--gw-acc, #ffcf4a); }
        .lgu-gl-hero-row > .lgu-gl-who > b { text-decoration: underline dotted transparent; }
        .lgu-gl-hero-row:hover > .lgu-gl-who > b { text-decoration-color: currentColor; }

        /* v11.7: оверлей-карточка героя участника (GET /api/guilds/hero).
           Палитра — переменные guilds2.css, чтобы карточка совпадала с
           нативной сводкой в любом скине. */
        .lgu-gl-hero {
            position: fixed; inset: 0; z-index: 9998;
            display: flex; align-items: center; justify-content: center;
            padding: 18px;
            background: rgba(20, 13, 10, .42);
        }
        .lgu-gl-hero-box {
            box-sizing: border-box;
            width: min(420px, 96vw); max-height: min(78vh, 720px); overflow: auto;
            padding: 12px 14px 14px;
            border: 2px solid var(--gw-line, #2b1d18);
            border-radius: calc(var(--gw-rc, 12px) * 1.1);
            background: var(--gw-card, #fffaf2);
            color: var(--gw-ink, #2b1d18);
            box-shadow: 0 16px 40px rgba(20, 13, 10, .38);
            font-family: var(--gw-tx, system-ui, sans-serif);
        }
        .lgu-gl-hero-head { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
        .lgu-gl-hero-head > div { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
        .lgu-gl-hero-head b {
            font: 700 15px var(--gw-bt, 'Russo One', sans-serif);
            color: var(--gw-title, #5a3458);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .lgu-gl-hero-head span { font-size: 11.5px; color: var(--gw-mute, #6b5148); }
        .lgu-gl-hero-x {
            flex: none; width: 26px; height: 26px; padding: 0;
            border-radius: 8px; cursor: pointer;
            border: 2px solid var(--gw-line, #2b1d18);
            background: var(--gw-soft, rgba(43, 29, 24, .05));
            color: var(--gw-hot, #b2442c);
            font-size: 13px; line-height: 1;
        }
        .lgu-gl-hero-x:hover { background: var(--gw-hi, rgba(255, 207, 74, .2)); }
        .lgu-gl-hero-meta {
            margin-bottom: 6px; font-size: 12px; color: var(--gw-mute, #6b5148);
        }
        .lgu-gl-hero-stats {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
            gap: 4px; margin-bottom: 8px;
        }
        .lgu-gl-hero-stats > span {
            display: flex; flex-direction: column; gap: 1px;
            padding: 4px 6px; border-radius: 7px;
            background: var(--gw-soft, rgba(43, 29, 24, .05));
            border: 1px solid var(--gw-sep, rgba(43, 29, 24, .2));
        }
        .lgu-gl-hero-stats small { font-size: 10.5px; color: var(--gw-mute, #6b5148); }
        .lgu-gl-hero-stats b { font: 700 13px var(--gw-bt, 'Russo One', sans-serif); }
        .lgu-gl-hero-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
        .lgu-gl-hero-items > li {
            display: grid; grid-template-columns: 82px minmax(0, 1fr);
            grid-template-areas: 'slot name' 'slot stat';
            column-gap: 7px; align-items: baseline;
            padding: 4px 6px; border-radius: 7px;
            background: var(--gw-soft, rgba(43, 29, 24, .05));
            border-left: 3px solid var(--gw-sep, rgba(43, 29, 24, .2));
        }
        .lgu-gl-hero-items > li.empty { opacity: .62; }
        .lgu-gl-hero-items > li[data-r="uncommon"] { border-left-color: #3f9e46; }
        .lgu-gl-hero-items > li[data-r="rare"] { border-left-color: #3a7fd0; }
        .lgu-gl-hero-items > li[data-r="epic"] { border-left-color: #8a4fd0; }
        .lgu-gl-hero-items > li[data-r="legendary"] { border-left-color: #d9921f; }
        .lgu-gl-hero-slot { grid-area: slot; font-size: 11px; color: var(--gw-mute, #6b5148); white-space: nowrap; }
        .lgu-gl-hero-name {
            grid-area: name; min-width: 0; font-weight: 600;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .lgu-gl-hero-name > b { color: #b07b16; }
        .lgu-gl-hero-items > li > small { grid-area: stat; font-size: 10.5px; color: var(--gw-mute, #6b5148); }
        .lgu-gl-hero-abs { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; font-size: 11.5px; }
        .lgu-gl-hero-abs > span { display: flex; gap: 5px; align-items: baseline; }
        .lgu-gl-hero-abs > span > i { font-style: normal; }
        .lgu-gl-hero-abs > span.off { opacity: .6; }
        .lgu-gl-hero-abs > span > b { color: var(--gw-title, #5a3458); }
        .lgu-gl-hero-abs em { font-style: normal; font-size: 10.5px; opacity: .85; }

        @media (max-width: 560px) {
            .lgu-gl-grid { grid-template-columns: minmax(0, 1fr); }
        }

        /* ============================================================
           ПЛАНИРОВЩИК БИЛДОВ — РАДИАЛЬНОЕ СОЗВЕЗДИЕ
           Модуль: modules/build-sim.js. Карта повторяет skillmap.js:
           viewBox="-600 -600 1200 1200", центр 'hub' в (0,0),
           ветки окрашены по bi % 3 (--bc-0..2 как в skillmap.css).
           ============================================================ */
        .lgu-skm-layout [hidden] { display: none !important; }
        /* v11.6.9: было align-items: flex-start — из-за этого .sim-main-content
           рос по контенту, его overflow-y: auto не включался, и низ вкладки
           («Навыки Арены», «Что дают открытые навыки») обрезался overflow:
           hidden у #tab-hero-build / #hp-buildsim-container. Сайдбар классов
           по-прежнему не растягивается: у .sim-sidebar свой align-self:
           flex-start + position: sticky. */
        .lgu-skm-layout { align-items: stretch; }
        .lgu-skm-layout > .sim-main-content { min-height: 0; max-height: 100%; }
        /* Дети колонки не сжимаются: иначе flex-shrink мог «сплющить» блок
           «Навыки Арены» или сводку, и вместо прокрутки вкладки появился бы
           второй, внутренний скролл. */
        .lgu-skm-layout .sim-main-content > * { flex: none; }
        .lgu-skm-layout .sim-sidebar .lgu-skm-i { width: 16px; height: 16px; flex: none; }
        .lgu-skm-layout .sim-tab.active .lgu-skm-i { color: inherit; }

        /* Шапка: счётчики SP/жетонов + пресеты. */
        .lgu-skm-bar {
            height: auto !important;
            min-height: 38px;
            flex-wrap: wrap;
            row-gap: 6px;
            padding: 6px 8px !important;
        }
        .lgu-skm-res { display: inline-flex; align-items: baseline; gap: 5px; white-space: nowrap; font-size: 12px; color: var(--tb-chalk2, #c9d2c3); }
        .lgu-skm-res em { font-style: normal; }
        .lgu-skm-res > b { color: var(--tb-gold, #ffcf4a); font-size: 16px; line-height: 1; font-variant-numeric: tabular-nums; }
        .lgu-skm-res > b.over { color: #ff6b81; }
        .lgu-skm-res > small { color: #9c8fa8; font-size: 11px; }
        .lgu-skm-bar .lgu-skm-build-list { width: 180px; flex: 0 1 180px; }
        .lgu-skm-bar .sim-save-name { width: 140px; flex: 0 1 140px; }

        /* Панель героя над картой. */
        .lgu-skm-hero {
            display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
            margin: 0 0 10px; padding: 8px 12px;
            background: linear-gradient(120deg, #1e1724, #241c2b);
            border: 1px solid #3d2f44; border-radius: 10px;
        }
        .lgu-skm-avat {
            display: grid; place-items: center; width: 34px; height: 34px; flex: none;
            border-radius: 50%; border: 2px solid var(--c, #ffd24a); color: var(--c, #ffd24a);
            background: rgba(0, 0, 0, .35);
        }
        .lgu-skm-avat .lgu-skm-i { width: 20px; height: 20px; }
        .lgu-skm-who { display: flex; flex-direction: column; min-width: 0; }
        .lgu-skm-who > b { color: #f7eadf; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lgu-skm-who > small { color: #9c8fa8; font-size: 11.5px; }
        .lgu-skm-pill {
            display: inline-flex; align-items: baseline; gap: 5px; padding: 3px 10px;
            border-radius: 999px; border: 1px solid #44374a; background: rgba(0, 0, 0, .3);
            color: #d8c9a8; font-size: 12px; white-space: nowrap;
        }
        .lgu-skm-pill em { font-style: normal; color: #9c8fa8; font-size: 10.5px; }
        /* Статус умения класса прижат вправо (бейдж «песочница» удалён). */
        .lgu-skm-pill.status { margin-left: auto; }
        /* Порог умения класса пройден: активный статус (зелёный), а не «перебор». */
        .lgu-skm-pill.hub-on {
            border-color: rgba(126, 217, 129, .55);
            background: rgba(64, 160, 82, .16);
            color: #8ee59a;
            box-shadow: 0 0 8px rgba(126, 217, 129, .22);
        }

        /* Карта + инспектор. */
        .lgu-skm-stage { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; align-items: start; margin-bottom: 12px; }
        .lgu-skm-map {
            position: relative; overflow: hidden; border-radius: 12px;
            border: 1px solid #2c3547;
            background: linear-gradient(160deg, #0b0f19 0%, #070a12 55%, #05070c 100%);
            height: clamp(360px, 56vh, 640px);
            cursor: grab;
            touch-action: none;
        }
        .lgu-skm-map.dragging { cursor: grabbing; }
        .lgu-skm-svg { display: block; width: 100%; height: 100%; user-select: none; }
        .lgu-skm-bg { fill: transparent; }
        .lgu-skm-zoom { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 4px; }
        .lgu-skm-zoom button {
            width: 28px; height: 28px; padding: 0; border-radius: 7px; cursor: pointer;
            border: 1px solid #3d4a5f; background: rgba(12, 17, 26, .85); color: #cfe0f5; font-size: 14px; line-height: 1;
        }
        .lgu-skm-zoom button:hover { border-color: #7fa7d6; color: #fff; }
        .lgu-skm-wait { fill: #9fb3c8; font: 16px 'Nunito', system-ui, sans-serif; }
        .lgu-skm-wait.bad { fill: #ff9aa8; }

        /* Рёбра созвездия. */
        .lgu-skm-edge { stroke: var(--bc, #5cc8ff); stroke-width: 2; stroke-linecap: round; opacity: .18; }
        .lgu-skm-edge.avail { opacity: .6; stroke-dasharray: 7 7; }
        .lgu-skm-edge.on { opacity: .95; stroke-width: 2.6; filter: drop-shadow(0 0 4px var(--bc, #5cc8ff)); }
        .lgu-skm-edge.q { stroke-dasharray: 2 7; opacity: .3; }
        .lgu-skm-edge.q.on { opacity: .9; }

        /* Центр (hub). */
        .lgu-skm-hub { color: var(--c, #ffd24a); cursor: pointer; }
        .lgu-skm-hub > circle { fill: rgba(12, 17, 26, .92); stroke: var(--c, #ffd24a); stroke-width: 2.4; }
        .lgu-skm-hub.on > circle { filter: drop-shadow(0 0 12px var(--c, #ffd24a)); stroke-width: 3; }
        .lgu-skm-hub.sel > circle { stroke: #fff; }
        .lgu-skm-hubcnt { fill: #9fb3c8; font: 12px 'Nunito', system-ui, sans-serif; }
        .lgu-skm-hub.on .lgu-skm-hubcnt { fill: var(--c, #ffd24a); font-size: 15px; }

        /* Пассивные узлы. */
        .lgu-skm-node { cursor: pointer; }
        .lgu-skm-node > circle { fill: rgba(9, 13, 21, .94); stroke: var(--bc, #5cc8ff); stroke-width: 2; transition: stroke-width .15s; }
        .lgu-skm-node > svg { color: var(--bc, #5cc8ff); opacity: .8; }
        .lgu-skm-node.has > circle { fill: color-mix(in srgb, var(--bc, #5cc8ff) 34%, #070a12); stroke-width: 2.6; }
        .lgu-skm-node.has > svg { color: #fff; opacity: 1; filter: drop-shadow(0 0 4px var(--bc, #5cc8ff)); }
        .lgu-skm-node.can > circle { stroke-dasharray: 5 4; }
        .lgu-skm-node.can > circle, .lgu-skm-node.can > svg { animation: lguSkmPulse 1.6s ease-in-out infinite; }
        .lgu-skm-node.cap > circle { stroke: #ffd24a; }
        .lgu-skm-node.sel > circle { stroke: #fff; stroke-width: 3; }
        .lgu-skm-node .rank { fill: #cbd5e1; font: 11px 'Nunito', system-ui, sans-serif; paint-order: stroke; stroke: #05070c; stroke-width: 3px; }
        .lgu-skm-node.has .rank { fill: #ffd24a; }
        @keyframes lguSkmPulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }

        /* Ромбы способностей Арены. */
        .lgu-skm-ab { cursor: pointer; }
        .lgu-skm-ab .shape { fill: rgba(9, 13, 21, .94); stroke: var(--bc, #c4a0ff); stroke-width: 2; }
        .lgu-skm-ab .glyph { fill: var(--bc, #c4a0ff); font: 16px 'Nunito', system-ui, sans-serif; }
        .lgu-skm-ab.has .shape { fill: color-mix(in srgb, var(--bc, #c4a0ff) 38%, #070a12); stroke-width: 2.6; }
        .lgu-skm-ab.has .glyph { fill: #fff; }
        .lgu-skm-ab.eq .shape { stroke: #ffd24a; filter: drop-shadow(0 0 7px rgba(255, 210, 74, .8)); }
        .lgu-skm-ab.can .shape { stroke-dasharray: 5 4; animation: lguSkmPulse 1.6s ease-in-out infinite; }
        .lgu-skm-ab.sel .shape { stroke: #fff; stroke-width: 3; }
        .lgu-skm-ab .badge { fill: #ffd24a; font: 11px 'Nunito', system-ui, sans-serif; paint-order: stroke; stroke: #05070c; stroke-width: 3px; }

        /* Молнии похода. */
        .lgu-skm-q rect { fill: rgba(9, 13, 21, .92); stroke: #55647c; stroke-width: 1.6; }
        .lgu-skm-q text { fill: #93a4bb; font: 13px 'Nunito', system-ui, sans-serif; }
        .lgu-skm-q.on rect { stroke: #ffd24a; filter: drop-shadow(0 0 6px rgba(255, 210, 74, .7)); }
        .lgu-skm-q.on text { fill: #ffd24a; }

        /* Подписи веток. */
        .lgu-skm-blab .nm { fill: var(--bc, #5cc8ff); font: 16px 'Russo One', 'Nunito', system-ui, sans-serif; letter-spacing: .03em; }
        .lgu-skm-blab .cnt { fill: #8fa1b8; font: 12px 'Nunito', system-ui, sans-serif; }

        /* Инспектор узла/способности/центра. */
        .lgu-skm-inspector {
            min-width: 0; padding: 12px; border-radius: 12px;
            border: 1px solid #3d2f44; background: #1e1724;
            max-height: clamp(360px, 56vh, 640px); overflow-y: auto;
        }
        .lgu-skm-hint { color: #c9d2c3; font-size: 12.5px; line-height: 1.45; }
        .lgu-skm-hint > b { display: block; margin-bottom: 8px; color: #ffcf6a; font-size: 13.5px; }
        .lgu-skm-hint p { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 6px; }
        .lgu-skm-hint i { flex: none; display: inline-grid; place-items: center; width: 16px; height: 16px; font-style: normal; }
        .lgu-skm-hint i.dot { border-radius: 50%; border: 2px solid #5cc8ff; margin-top: 2px; }
        .lgu-skm-hint i.diamond { border: 2px solid #c4a0ff; transform: rotate(45deg) scale(.72); margin-top: 2px; }
        .lgu-skm-hint i.bolt { color: #ffd24a; }
        .lgu-skm-hint .muted { color: #8b7f96; font-size: 11.5px; }

        .lgu-skm-ins { color: #e8e1d5; font-size: 12.5px; line-height: 1.4; }
        .lgu-skm-ins-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; padding-bottom: 7px; border-bottom: 1px dashed rgba(255, 255, 255, .14); }
        .lgu-skm-ins-head > b { flex: 1; min-width: 0; color: var(--bc, #ffcf6a); font-size: 15px; line-height: 1.25; }
        .lgu-skm-ins-head > small { color: #9c8fa8; font-size: 11px; white-space: nowrap; }
        .lgu-skm-ins-x { flex: none; width: 20px; height: 20px; padding: 0; border: none; border-radius: 5px; background: transparent; color: #c9b184; cursor: pointer; font-size: 12px; }
        .lgu-skm-ins-x:hover { color: #fff; background: rgba(255, 255, 255, .08); }
        .lgu-skm-ins-kind { margin-bottom: 6px; color: #9c8fa8; font-size: 11.5px; }
        .lgu-skm-ins-rank { margin-bottom: 6px; color: #c9d2c3; }
        .lgu-skm-ins-rank > b { color: #ffcf6a; font-size: 15px; }
        .lgu-skm-ins-fx { margin: 0 0 6px; color: #f4f1e4; }
        .lgu-skm-ins-next { margin: 0 0 6px; color: #9fb3c8; font-size: 11.5px; }
        .lgu-skm-ins-next.warn { color: #ffb3a0; }
        .lgu-skm-ins-cost { margin: 8px 0; padding: 6px 8px; border-radius: 7px; background: rgba(202, 165, 92, .12); color: #d8c9a8; }
        .lgu-skm-ins-cost b { color: #ffcf6a; }
        .lgu-skm-ins-nodes { list-style: none; margin: 6px 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
        .lgu-skm-ins-nodes li { display: flex; justify-content: space-between; gap: 8px; padding: 4px 6px; border-radius: 6px; background: rgba(0, 0, 0, .22); }
        .lgu-skm-ins-nodes span { color: #9c8fa8; font-size: 11.5px; }
        .lgu-skm-ins-nodes b { color: #f4f1e4; font-size: 11.5px; text-align: right; }
        .lgu-skm-ins-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
        .lgu-skm-btn {
            flex: 1 1 auto; min-width: 64px; height: 30px; padding: 0 10px;
            border: 1px solid #caa55c; border-radius: 7px; cursor: pointer;
            background: transparent; color: #ffcf6a; font: 700 12px 'Nunito', system-ui, sans-serif;
            transition: filter .15s, background .15s;
        }
        .lgu-skm-btn:hover:not(:disabled) { background: rgba(202, 165, 92, .16); }
        .lgu-skm-btn.main { background: #caa55c; border-color: #caa55c; color: #1d1620; }
        .lgu-skm-btn.main:hover:not(:disabled) { filter: brightness(1.1); }
        .lgu-skm-btn.danger { color: #ff8fa3; border-color: rgba(255, 90, 122, .6); }
        .lgu-skm-btn.danger:hover:not(:disabled) { background: rgba(255, 90, 122, .14); }
        .lgu-skm-btn:disabled { opacity: .42; cursor: not-allowed; }

        /* Блок «Навыки Арены». */
        .lgu-skm-arena { margin-bottom: 12px; padding: 12px 14px; border: 1px solid #3d2f44; border-radius: 10px; background: #1a1420; }
        .lgu-skm-arena-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; padding-bottom: 7px; border-bottom: 1px dashed #3d2f44; }
        .lgu-skm-arena-head > b { color: #ffcf6a; font-size: 14px; }
        .lgu-skm-arena-head > span { color: #9c8fa8; font-size: 12px; }
        .lgu-skm-arena-head > span b { color: #ffcf6a; font-size: 14px; }
        /* v11.6.9: красная подсветка (.over) у жетонов Арены удалена —
           жёсткого лимита жетонов в планировщике нет. */
        .lgu-skm-slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 10px; }
        .lgu-skm-slot { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 2px solid var(--bc, #6b6478); border-radius: 9px; background: rgba(0, 0, 0, .28); }
        .lgu-skm-slot.empty { border-style: dashed; opacity: .85; }
        .lgu-skm-slot-k { color: #c9d2c3; font-size: 11.5px; }
        .lgu-skm-slot select { height: 28px; padding: 0 8px; border: 1px solid #44374a; border-radius: 6px; background: #0f0f15; color: #fff; font: 700 12px 'Nunito', system-ui, sans-serif; }
        .lgu-skm-slot-meta { display: flex; flex-direction: column; gap: 2px; min-height: 30px; }
        .lgu-skm-slot-meta > b { color: #f4f1e4; font-size: 12.5px; }
        .lgu-skm-slot-meta > em { color: #9fb3c8; font-size: 11px; font-style: normal; }
        .lgu-skm-slot-meta > small { color: #8b7f96; font-size: 11.5px; }
        .lgu-skm-ups { display: flex; flex-direction: column; gap: 6px; }
        .lgu-skm-up { border: 1px solid #3d2f44; border-radius: 8px; background: rgba(0, 0, 0, .22); }
        .lgu-skm-up > summary { padding: 7px 10px; cursor: pointer; color: #f4f1e4; font-size: 12.5px; }
        .lgu-skm-up > summary small { color: #9c8fa8; font-size: 11px; }
        .lgu-skm-up[open] > summary { border-bottom: 1px dashed #3d2f44; }
        .lgu-skm-up-rows { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; }
        .lgu-skm-up-row { display: grid; grid-template-columns: 90px 24px 24px auto 24px 52px; align-items: center; gap: 4px; font-size: 12px; }
        .lgu-skm-up-row > span { color: #9c8fa8; }
        .lgu-skm-up-row > b { color: #ffcf6a; text-align: center; font-variant-numeric: tabular-nums; }
        .lgu-skm-up-row > small { color: #8b7f96; font-size: 11px; }
        .lgu-skm-up-row > em { color: #c9d2c3; font-style: normal; text-align: right; white-space: nowrap; }
        .lgu-skm-mini { width: 22px; height: 22px; padding: 0; border-radius: 5px; border: 1px solid #44374a; background: #241c2b; color: #f4f1e4; cursor: pointer; font-size: 12px; line-height: 1; }
        .lgu-skm-mini:hover:not(:disabled) { border-color: #caa55c; color: #ffcf6a; }
        .lgu-skm-mini:disabled { opacity: .35; cursor: not-allowed; }
        .lgu-skm-loads { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .lgu-skm-loadbtn { height: 26px; padding: 0 12px; border-radius: 6px; border: 1px solid #44374a; background: #241c2b; color: #d8c9a8; cursor: pointer; font: 700 12px 'Nunito', system-ui, sans-serif; }
        .lgu-skm-loadbtn:hover { border-color: #caa55c; color: #ffcf6a; }
        .lgu-skm-loadbtn.game { border-color: #caa55c; color: #ffcf6a; }

        /* Сводка. */
        .lgu-skm-summary { padding: 12px 14px; border: 1px solid #3d2f44; border-radius: 10px; background: #1a1420; }
        .lgu-skm-sum-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; padding-bottom: 7px; border-bottom: 1px dashed #3d2f44; }
        .lgu-skm-sum-head > b { color: #ffcf6a; font-size: 14px; }
        .lgu-skm-sum-head > span { color: #9c8fa8; font-size: 11.5px; }
        .lgu-skm-stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 5px 12px; }
        .lgu-skm-stats li { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 4px 8px; border-left: 3px solid var(--bc, #5cc8ff); border-radius: 4px; background: rgba(0, 0, 0, .22); font-size: 12px; }
        .lgu-skm-stats li > span { color: #c9d2c3; }
        .lgu-skm-stats li > b { color: #7ee08a; white-space: nowrap; }
        .lgu-skm-note { margin: 6px 0 0; color: #8b7f96; font-size: 12px; }
        .lgu-skm-error { padding: 18px; color: #ffb3a0; font-size: 13px; text-align: center; }

        /* Вкладка «Экипировка». */
        .lgu-skm-gear { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
        .lgu-skm-gear-col { min-width: 0; padding: 12px; border: 1px solid #3d2f44; border-radius: 10px; background: #1a1420; overflow-x: auto; }
        .lgu-skm-gear-col h3 { margin: 0 0 8px; color: #ffcf6a; font-size: 14px; }

        /* На узких экранах карта и инспектор — в колонку. */
        @media (max-width: 900px) {
            .lgu-skm-stage { grid-template-columns: minmax(0, 1fr); }
            .lgu-skm-inspector { max-height: none; }
        }


    `;
