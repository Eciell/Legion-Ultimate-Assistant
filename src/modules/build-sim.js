    // ============================================================
    // 4. МОДУЛЬ: ПЛАНИРОВЩИК БИЛДОВ
    // ============================================================
    const BuildSim = {
        skillsCache: null,
        simulatedSkills: {},
        savedBuilds: {}, // { [clsId]: [{ name, skills }] } — сохранённые в localStorage билды по классам
        _currentBuildName: '', // имя последнего сохранённого/загруженного билда (для будущих фич UI)
        _currentBuildNames: {}, // { [clsId]: name } — активный билд каждого класса (нужен для кнопки «Удалить»)
        _autoLoadClass: null, // класс, чей билд пришёл ссылкой #build=… (вкладку открываем после создания табов)
        _tooltipTimer: null, // setTimeout hover-тултипа узла (500 мс, ТЗ 11.6.1e)
        _tooltipState: null, // { clsId, nodeId, mode: 'hover'|'click' } — что сейчас показано
        // v11.6.3: режим навыков из hero.sk.md. 'shared' — один общий пул
        // очков по уровню героя в игре, но планировщик его игнорирует.
        // v11.6.5b.3: лимита по пулу героя больше нет вообще — полей
        // availablePoints / pointsLimit / heroLevel в объекте не осталось,
        // чтобы ограничение нельзя было случайно вернуть. maxPts() === 50.
        // 'class' (и старый 'hero') — прежняя модель, тот же лимит.
        skillMode: 'class',
        // v11.6.5b.1: вложенные ранги героя из hero.sk.t ({ [clsId]: { [nodeId]: rank } }).
        // Нужны кнопке «От вложенного» (режим keep).
        nativeSkills: {},
        ownerClass: '', // класс, в чьё дерево уже вложены общие очки (только зелёная метка ✓)
        _nativeSkillsWarm: null, // промис прогрева ленивого LGSkills (не блокирует UI)

        statNames: { hp: 'Макс. HP', atk: 'Физ. урон', mag: 'Магия', def: 'Броня', crit: 'Крит %', critDmg: 'Сила крита', dodge: 'Уклонение', pierce: 'Пробивание', healPow: 'Сила лечения', luck: 'Удача', resist: 'Сопротивление' },
        fxNames: { melee: 'Физ. урон %', magic: 'Магия %', hp: 'Макс. HP %', def: 'Броня', healPow: 'Сила лечения %', healIn: 'Вх. лечение %', crit: 'Крит %', critDmg: 'Сила крита', skel: 'Урон скелетов %', skelT: 'Время скелетов', leech: 'Вампиризм %', block: 'Снижение урона %', dodge: 'Уклонение %', lead: 'Урон по боссам %', first: 'Урон 1-й ход %', dmg: 'Весь урон %', pierce: 'Пробивание %', resist: 'Сопротивление', healCrit: 'Крит лечения %', regen: 'Регенерация %', low: 'Урон при низком HP %', a_siyanie: 'Сияние +%', a_obereg: 'Оберег +%', a_dlan: 'Длань +%', a_aura: 'Аура +%', aura: 'Аура −урон %', a_svet: 'Свет +%', a_vspyshka: 'Вспышка +%', a_oznob: 'Озноб +%', a_pricel: 'Прицел +%', a_grad: 'Град +%', a_natisk: 'Натиск +%', a_stoyka: 'Стойка +%', a_vspinu: 'Вспину +%', a_yad: 'Яд +%', a_vytyanut: 'Вытянуть +%', a_podnyat: 'Поднять +%', poison: 'Отрава %', steal: 'Кража %', loot: 'Добыча %', skelN: 'Скелетов +', volley: 'Залп +%', shieldBlock: 'Щит блок %', trapDodge: 'Ловушки %', steady: 'Промах→удар %', cleave: 'Замах %', cleaveBoss: 'Замах по боссу %', penBoss: 'Бронебой по боссу %', drain: 'Вытягивание %', hex: 'Проклятие +%', holy: 'По нежити +%', poisonT: 'Время отравы',
            // v11.6.5b: новые ключи ребаланса — проклятие и кулдауны действий.
            a_proklyat: 'Проклятие +%',
            cd_proklyat: 'КД Проклятия',
            cd_natisk: 'КД Натиска',
            cd_grad: 'КД Града',
            cd_vspyshka: 'КД Вспышки',
            cd_obereg: 'КД Оберега',
            cd_siyanie: 'КД Сияния',
            cd_oznob: 'КД Озноба',
            cd_yad: 'КД Яда',
            cd_vspinu: 'КД Вспину',
            cd_podnyat: 'КД Поднять',
            cd_vytyanut: 'КД Вытянуть',
            cd_dlan: 'КД Длани',
            cd_aura: 'КД Ауры' },
        classNames: { recruit: 'Новобранец', legionary: 'Легионер', archer: 'Лучник', mage: 'Маг', priest: 'Жрец', rogue: 'Разбойник', necromancer: 'Некромант', paladin: 'Паладин' },
        /*
         * Цвета кнопок классов — из нативного экрана игры (ТЗ 11.6.1d, скрин 4).
         * Значение кладётся в CSS-переменную --c таба класса: неактивный таб —
         * цветная рамка/текст на тёмной подложке, активный — заливка цветом.
         * recruit в нативном списке не подсвечивался — нейтральный серо-золотой.
         */
        classColors: { recruit: '#d7d3c8', legionary: '#ff7b7b', archer: '#7bff7b', mage: '#7bbaff', priest: '#ffcf4a', rogue: '#d4aaff', necromancer: '#7c52cc', paladin: '#ffdf7b' },

        /*
         * Цвет текста НА заливке цвета класса (активный таб, ТЗ 11.6.1e).
         * Правило контраста: светлая заливка (Жрец, Паладин, Разбойник #d4aaff) —
         * тёмный текст #12100e; тёмная заливка (Некромант #7c52cc) — белый.
         * Кладётся в CSS-переменную --ct (значение по умолчанию — тёмное).
         */
        classTextColors: { necromancer: '#fff' },

        /*
         * Словарь нативных SVG-иконок игры (viewBox 0 0 24 24, stroke=currentColor).
         * Источник: reference/LegionFrontSRC/site/skills.js (объекты NI и BI + DIAM).
         * Ключи иконок веток совпадают с id веток из /api/skills (blade, shield, ...)
         * и используются как fallback, когда у навыка нет подходящей fx-иконки.
         */
        SKILL_ICONS: {
            // --- Иконки навыков (NI) ---
            sword: '<path d="M19.5 4.5 20 4l-.5 4.5L9.5 18.5l-4-4zM7.5 16.5l-3 3M4 15l5 5"/>',
            shield: '<path d="M12 3.5l7 2.8v5.1c0 4.6-3 7.8-7 9.6-4-1.8-7-5-7-9.6V6.3z"/>',
            bow: '<path d="M6 3c6 3 9 9 6 18M6 3l12 18M14 5h5v5M19 5 9 15"/>',
            spark: '<path d="M12 2.5l1.8 6.2 6.2 1.8-6.2 1.8L12 18.5l-1.8-6.2L4 10.5l6.2-1.8z"/><path d="M19 17l.8 2.2 2.2.8-2.2.8L19 23"/>',
            fire: '<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.6 3-5.8 3.6-9.5 2 1.5 3 3.4 3.2 5.3 1-1 1.6-2.4 1.6-3.8 2.7 2.2 4.6 5 4.6 8 0 3.4-2.5 6-6 6z"/>',
            frost: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
            heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
            cross: '<path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>',
            skull: '<path d="M12 3.5a7.5 7.5 0 0 0-4.5 13.5v3h9v-3A7.5 7.5 0 0 0 12 3.5z"/><circle cx="9.3" cy="11.5" r="1.6"/><circle cx="14.7" cy="11.5" r="1.6"/><path d="M10.5 20.5v-2M13.5 20.5v-2"/>',
            star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
            bolt: '<path d="M13.5 2.5 5.5 13.5h6l-1.5 8 8-11h-6z"/>',
            crown: '<path d="M3.5 18.5h17M4.5 18.5 3.5 7l5 4 3.5-6 3.5 6 5-4-1 11.5z"/>',
            wind: '<path d="M3 8.5h11a3 3 0 1 0-3-3M3 12.5h15a3 3 0 1 1-3 3M3 16.5h8"/>',
            eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
            dagger: '<path d="M14.5 3.5 16 5l-7.5 9-2-2zM6.5 12l-2.5 2.5 2 2 2.5-2.5M5 15.5l-1.5 1.5 3 3L8 18.5"/><path d="M15 13.5l5 5"/>',
            vial: '<path d="M9.5 3.5h5M10.5 3.5v5L6 17a2.6 2.6 0 0 0 2.3 3.5h7.4A2.6 2.6 0 0 0 18 17l-4.5-8.5v-5M8 14.5h8"/>',
            sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
            drop: '<path d="M12 3.5s-6 6.6-6 10.6a6 6 0 0 0 12 0c0-4-6-10.6-6-10.6z"/>',
            coin: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.6-.9-1.5-1.3-2.5-1.3-1.5 0-2.5.8-2.5 1.9 0 2.7 5.2 1.3 5.2 4 0 1.1-1.1 1.9-2.7 1.9-1.1 0-2.1-.5-2.6-1.4M12 6.5v1.7M12 15.8v1.7"/>',
            // v11.6.3: иконки из обновлённого skills.js (CHECK подтверждения,
            // «часы» для cd_*, геометрические заглушки и точки/столбики).
            check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
            clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2.5"/>',
            leaf: '<path d="M5 19c0-8 5-13.5 14-14 .5 9-5 14-13 14z"/><path d="M5 19l8-8"/>',
            ring: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/>',
            hex: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/>',
            tri: '<path d="M12 4l8.5 15h-17z"/>',
            sq: '<rect x="5" y="5" width="14" height="14" rx="2.5"/>',
            dots: '<circle cx="8" cy="8" r="2.6"/><circle cx="16" cy="8" r="2.6"/><circle cx="12" cy="16" r="2.6"/>',
            bars: '<path d="M6 19V11M12 19V6M18 19v-5"/>',
            // --- Иконки веток (BI): ключ = id ветки из /api/skills ---
            blade: '<path d="M19.5 4.5 20 4l-.5 4.5L9.5 18.5l-4-4zM7.5 16.5l-3 3M4 15l5 5"/>',
            veteran: '<path d="M8 3h8l-1.5 6h-5zM12 9v3"/><circle cx="12" cy="16.5" r="4.2"/><path d="M12 14.6l.7 1.4 1.5.2-1.1 1 .3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1 1.5-.2z"/>',
            aim: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
            hunt: '<path d="M5 19 19 5M15 5h4v4M5 15l4 4M7 13l4 4"/><path d="M6 6c5-2 10 3 12 12"/>',
            shade: '<path d="M4 10.5c3-1.5 5.5-1.5 8 0s5 1.5 8 0M4 14.5c3-1.5 5.5-1.5 8 0s5 1.5 8 0M7 6.5c2-1 3.5-1 5 0s3 1 5 0"/>',
            lore: '<path d="M5 4.5h10.5a2 2 0 0 1 2 2V19.5H7a2 2 0 0 1-2-2zM5 17.5a2 2 0 0 1 2-2h10.5M9 8.5h5M9 11.5h4"/>',
            mercy: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>',
            faith: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
            wrath: '<path d="M13.5 2.5 5.5 13.5h6l-1.5 8 8-11h-6z"/>',
            blades: '<path d="M14.5 3.5 16 5l-7.5 9-2-2zM6.5 12l-2.5 2.5 2 2 2.5-2.5M5 15.5l-1.5 1.5 3 3L8 18.5"/><path d="M15 13.5l5 5"/>',
            venom: '<path d="M9.5 3.5h5M10.5 3.5v5L6 17a2.6 2.6 0 0 0 2.3 3.5h7.4A2.6 2.6 0 0 0 18 17l-4.5-8.5v-5M8 14.5h8"/>',
            shadow: '<path d="M15.5 4.5A8 8 0 1 0 19.5 16 6.5 6.5 0 0 1 15.5 4.5z"/>',
            bones: '<path d="M12 3.5a7.5 7.5 0 0 0-4.5 13.5v3h9v-3A7.5 7.5 0 0 0 12 3.5z"/><circle cx="9.3" cy="11.5" r="1.6"/><circle cx="14.7" cy="11.5" r="1.6"/>',
            life: '<path d="M12 3.5s-6 6.6-6 10.6a6 6 0 0 0 12 0c0-4-6-10.6-6-10.6z"/>',
            dark: '<path d="M9 21h6M10 21V11h4v10M12 11V8"/><path d="M12 8c-1.6-1.2-1.6-3 0-4.5 1.6 1.5 1.6 3.3 0 4.5z"/>',
            light: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
            grace: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>',
            bulwark: '<path d="M12 3.5l7 2.8v5.1c0 4.6-3 7.8-7 9.6-4-1.8-7-5-7-9.6V6.3z"/><path d="M12 7v10M8 11h8"/>',
            // Ромб-заглушка (DIAM) для неизвестных веток и классов.
            diam: '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>'
        },
        // Иконки, которые в игре заливаются полупрозрачно (нативный класс .so).
        // v11.6.3: список синхронизирован с SOLID из skills.js.
        SOLID_ICONS: ['sword', 'shield', 'heart', 'cross', 'star', 'bolt', 'crown', 'fire', 'spark', 'leaf', 'hex', 'tri', 'diam', 'sq', 'drop'],
        // fx-ключ -> иконка; порядок важен: срабатывает первое совпадение (FXI из skills.js).
        FX_ICONS: [
            [/^(melee|dmg|cleave|first|a_natisk|cd_natisk)$/, 'sword'],
            [/^(def|block|shieldBlock|resist|a_stoyka)$/, 'shield'],
            [/^(ranged|volley|pierce|a_pricel|a_grad|cd_grad)$/, 'bow'],
            [/^(magic|crit|critDmg|a_vspyshka|cd_vspyshka)$/, 'spark'],
            [/^(hp|regen|leech|healIn)$/, 'heart'],
            [/^(healPow|healCrit|a_obereg|cd_obereg|a_siyanie|cd_siyanie)$/, 'cross'],
            [/^(low|lastStand)$/, 'skull'],
            [/^(dodge|trapDodge)$/, 'wind'],
            [/^(steady|lead)$/, 'eye'],
            [/^(a_oznob|cd_oznob)$/, 'frost'],
            [/^(poison|poisonT|a_yad|cd_yad)$/, 'vial'],
            [/^(steal|loot)$/, 'coin'],
            [/^(a_vspinu|cd_vspinu)$/, 'dagger'],
            [/^(skel|skelT|skelN|a_podnyat|cd_podnyat)$/, 'skull'],
            [/^(drain|a_vytyanut|cd_vytyanut)$/, 'drop'],
            [/^(hex|a_proklyat|cd_proklyat)$/, 'fire'],
            [/^(holy|a_svet)$/, 'sun'],
            [/^(aura|a_dlan|cd_dlan|cd_aura)$/, 'cross']
        ],
        // Иконка класса для табов (CLI из skills.js); «Экипировка» — щит.
        CLASS_ICONS: { legionary: 'sword', archer: 'bow', mage: 'spark', priest: 'cross', rogue: 'dagger', necromancer: 'skull', paladin: 'sun', gear: 'shield' },
        // Горизонтальные позиции узлов внутри яруса (XS из skills.js).
        TIER_X: { 1: [50], 2: [28, 72], 3: [18, 50, 82], 4: [14, 38, 62, 86] },
        // SVG из словаря: solid-иконки заливаются полупрозрачно (нативный класс .so).
        _svg(key) {
            const known = this.SKILL_ICONS[key] ? key : 'diam';
            const solid = this.SOLID_ICONS.includes(known) ? ' so' : '';
            return `<svg class="sim-svg${solid}" viewBox="0 0 24 24" aria-hidden="true">${this.SKILL_ICONS[known]}</svg>`;
        },

        // Ключ иконки навыка: kind -> первый fx -> иконка ветки (iconOf из skills.js).
        iconKeyOf(node, branch) {
            if (!node) return 'diam';
            // v11.6.5b: нативное правило iconOf — навык с кулдауном (cd_*)
            // рисуется «часами» раньше любых проверок kind, даже если у него
            // есть другой fx-ключ или он является капом ветки.
            const hasCd = Object.keys(node.fx || {}).some(k => k.startsWith('cd_'));
            if (hasCd) return 'clock';
            if (node.kind === 'cap') return 'crown';
            if (node.kind === 'act') return 'bolt';
            if (node.kind === 'ctl') return 'star';
            for (const k of Object.keys(node.fx || {})) {
                for (const [re, icon] of this.FX_ICONS) if (re.test(k)) return icon;
            }
            const bid = branch && branch.id;
            return (bid && this.SKILL_ICONS[bid]) ? bid : 'diam';
        },

        getNodeSvg(node, branch) { return this._svg(this.iconKeyOf(node, branch)); },
        getBranchSvg(branch) {
            const bid = branch && branch.id;
            return this._svg((bid && this.SKILL_ICONS[bid]) ? bid : 'diam');
        },
        getClassSvg(clsId) { return this._svg(this.CLASS_ICONS[clsId] || 'diam'); },

        // Горизонталь узла в ярусе: нативные XS для 1-4 узлов, иначе равномерно.
        xFor(count, index) {
            const xs = this.TIER_X[count];
            if (xs && xs[index] !== undefined) return xs[index];
            return Math.round((100 * (index + 1)) / (count + 1));
        },
        isSkipFx(key) { return SKIP_FX_PREFIXES.some(p => key.startsWith(p)); },

        // Текст навыка с подстановкой значений из node.fx (там прибавка за 1 ранг).
        // Для неизученного навыка (rank 0) показываем значения 1-го ранга.
        //
        // v11.6.5b: игра ввела макросы ребаланса {cleaveBoss}, {penBoss}, {critX},
        // которых нет в node.fx — сервер их не присылает, значения считаются на
        // лету при отрисовке текста (см. kv() в reference/LegionFrontSRC/site/skills.js).
        formatNodeText(node, rank) {
            if (!node.text) return '';
            const r = Math.max(1, rank); // Если ранг 0, показываем значение для 1-го ранга
            const fx = node.fx || {};
            // Красивое форматирование: 1.2 -> "1.2", 3.0 -> "3"
            const fmt = (val) => Number.isInteger(val) ? val.toString() : val.toFixed(1).replace('.0', '');
            return node.text.replace(/\{(\w+)\}/g, (match, key) => {
                /*
                 * Вычисляемые макросы ребаланса (в fx их нет, поэтому проверяются
                 * ДО стандартной подстановки fx[key] * r):
                 *   cleaveBoss — 40% от «Замаха» за ранг: урон по боссу;
                 *   penBoss    — «Пробивание» / 20 за ранг: бронебой по боссу;
                 *   critX      — множитель крита: база ×2 + Сила крита / 100 за ранг.
                 */
                if (key === 'cleaveBoss') return fmt((fx.cleave || 0) * r * 0.4);
                if (key === 'penBoss') return fmt((fx.pierce || 0) * r / 20);
                if (key === 'critX') return fmt(2 + (fx.critDmg || 0) * r / 100);
                if (fx[key] !== undefined) {
                    return fmt(fx[key] * r);
                }
                return match; // Если ключа нет в fx, оставляем как есть (или можно '?')
            });
        },

        init() {
            // Кнопка теперь принадлежит HeroPlanner — см. src/modules/hero-planner.js.
            // BuildSim остаётся как модуль и открывается из таба «Билды».
            // Клик вне узла/тултипа закрывает тултип навыка (ТЗ 11.6.1d).
            document.addEventListener('click', (e) => {
                // Клики внутри тултипа (кнопки +/−, крестик) и по узлу обрабатывают
                // свои слушатели — здесь их не трогаем, иначе тултип закроется раньше.
                const t = e.target;
                if (t && t.closest && (t.closest('.sim-tooltip') || t.closest('.sim-node'))) return;
                // Старые карточки .sim-card (до v11.6.1d) могли остаться в DOM — чистим.
                document.querySelectorAll('.sim-card').forEach(c => c.remove());
                this.hideTooltip();
            });
        },

        async open() {
            // sim-modal: отдельный класс модалки — в styles.js ему поднята max-height
            // до 95vh, чтобы дерево навыков влезало целиком без внутреннего скролла.
            const modal = UI.showModal(`<h2>🧮 Планировщик билдов <button class="custom-close" id="custom-close-btn">✖</button></h2><div id="buildsim-modal-body" style="display:flex; flex-direction:column; flex:1; min-height:0;"></div>`, { customClass: 'sim-modal' });
            const body = modal.querySelector('#buildsim-modal-body');
            if (body) await this.mount(body);
        },

        // ------------------------------------------------------------
        // v11.6.3: ленивый LGSkills и режим общих очков (sk.md).
        // ------------------------------------------------------------

        /**
         * Прогрев нативного дерева навыков.
         *
         * В новом клиенте skills.js грузится лениво (`lazy('skills')` из
         * app.js) и до открытия вкладки «Навыки» window.LGSkills === undefined.
         * Свой каталог мы всё равно берём из /api/skills, поэтому прогрев —
         * необязательный фон: он нужен лишь затем, чтобы нативная вкладка
         * героя не оставалась пустой после открытия аддона.
         *
         * ВАЖНО: lazy() в app.js — локальная функция IIFE и наружу не
         * экспортируется. Сначала проверяем G.lazy (на случай, если клиент
         * её всё-таки отдаст), а при отсутствии молчим: данные уже пришли
         * через Utils.fetchApi('/api/skills').
         */
        warmNativeSkills() {
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            try {
                if (pageWin.LGSkills) return Promise.resolve(true);
                if (this._nativeSkillsWarm) return this._nativeSkillsWarm;
                if (typeof pageWin.lazy === 'function') {
                    this._nativeSkillsWarm = Promise.resolve(pageWin.lazy('skills'))
                        .catch(() => false)
                        .finally(() => { this._nativeSkillsWarm = null; });
                    return this._nativeSkillsWarm;
                }
            } catch (e) {
                dbg('[BUILD SIM] прогрев LGSkills не удался:', e);
            }
            return Promise.resolve(false);
        },

        /**
         * Режим очков навыков из /api/me -> hero.sk.
         *
         * Игра в shared-режиме разрешает вложение только в одно дерево, но
         * ПЛАНИРОВЩИК — песочница: он не зависит от текущих вложений игры.
         * v11.6.5b.3: из метода убраны пул очков героя (availablePoints) и
         * лимит (pointsLimit) — планирование всегда до maxPts() === 50,
         * в том числе для класса-владельца (ownerClass).
         * ownerClass остаётся только ради зелёной метки ✓ в сайдбаре.
         */
        readSkillMode(hero) {
            const sk = (hero && hero.sk) || {};
            this.skillMode = sk.md || 'class';
            this.ownerClass = '';
            this.nativeSkills = (sk.t && typeof sk.t === 'object' && !Array.isArray(sk.t)) ? sk.t : {};
            if (this.skillMode === 'shared') this.ownerClass = this.ownerOf(sk);
            return { mode: this.skillMode, limit: this.maxPts(), owner: this.ownerClass };
        },

        /**
         * v11.6.5b.3: лимит очков плана (maxPts из ТЗ).
         *
         * Всегда MAX_POINTS (50) — в любом режиме и для любого класса,
         * включая класс-владельца общих очков (ownerClass). Симулятор не
         * зависит от того, сколько очков уже вложено в игре. Ползунка в UI
         * нет: очки вкладываются только кнопками «+» / «−».
         */
        maxPts() {
            return MAX_POINTS;
        },

        // Класс, в чьё дерево уже вложены общие очки (ownerOf из skills.js):
        // первый класс sk.t, у которого есть ранг > 0.
        ownerOf(sk) {
            if (!sk || sk.md !== 'shared' || !sk.t) return '';
            for (const [cls, ranks] of Object.entries(sk.t)) {
                if (ranks && Object.values(ranks).some(r => +r > 0)) return cls;
            }
            return '';
        },

        async mount(container) {
            if (!container) return;
            // Ссылка вида …#build=<код> — обмен билдами без сервера. Код читаем
            // сразу, а ПРИМЕНЯЕМ ниже, после сброса simulatedSkills: иначе
            // импортированные навыки затёрлись бы пустым объектом.
            // Посторонний хэш (не от билда) игнорируем — иначе показывали бы
            // ложное «неверный формат кода».
            const hash = window.location.hash || '';
            const hashBuildCode = hash.includes('#build=') ? this._extractBuildCode(hash) : '';
            // Сохранённые билды поднимаем до парсинга /api/me и /api/skills,
            // чтобы UI успел отрисовать список «Мои билды» при первом renderTree.
            this.loadSavedBuilds();
            // v11.6.3: нативное дерево грузится лениво. Прогрев — фоном,
            // результат не ждём: каталог навыков берём из /api/skills.
            this.warmNativeSkills();
            // Тултип узла от прошлой сессии не должен «воскресать» при повторном
            // открытии модалки (state хранится на объекте BuildSim).
            this.hideTooltip();
            // Очки при каждом открытии начинаются с нуля (this.simulatedSkills = {}),
            // поэтому и «активного» билда нет: кнопка «Удалить» до выбора/загрузки
            // честно попросит выбрать билд.
            this._currentBuildNames = {};
            this._currentBuildName = '';
            container.innerHTML = `<div class="loader">Загрузка данных...</div>`;
            try {
                const me = await Utils.fetchApi('/api/me');
                if (!me || !me.ok || !me.hero) throw new Error('Нет героя');
                // v11.6.3: режим очков читаем ДО decodeBuild — импорт из
                // ссылки ограничен тем же лимитом, что и ручное вложение.
                this.readSkillMode(me.hero);
                if (!this.skillsCache) this.skillsCache = await Utils.fetchApi('/api/skills');
                if (!this.skillsCache || !this.skillsCache.classes) throw new Error('Нет данных о навыках');

                this.simulatedSkills = {};
                // Билд из ссылки применяем поверх пустой симуляции (код прочитан
                // в начале mount — до сброса применять было нельзя).
                if (hashBuildCode) {
                    this._autoLoadClass = this.decodeBuild(hashBuildCode);
                    if (this._autoLoadClass) UI.showToast('📥 Билд загружен из ссылки!');
                    else UI.showToast('❌ Неверный формат кода билда', true);
                    // Хэш убираем: иначе перезагрузка страницы снова перезапишет
                    // текущую симуляцию тем же билдом.
                    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}
                }
                const h = me.hero;
                const equipped = h.items.filter(x => x.on);
                const bag = h.items.filter(x => !x.on && x.wearable);
                const allClasses = (this.skillsCache.classes || []).filter(c => c.branches && c.branches.length > 0);

                // Табы классов: slim-сайдбар слева (v11.6.3b). Кнопки остаются
                // .modal-tab.sim-tab[data-tab] — обработчики кликов ниже и
                // автозагрузка билда из ссылки (_autoLoadClass) ищут по классу
                // и потому подхватывают новую разметку без изменений.
                let tabsHtml = `<button class="modal-tab sim-tab active" data-tab="gear">${this.getClassSvg('gear')}Экипировка</button>`;
                // Разделитель между системной вкладкой «Экипировка» и классами.
                tabsHtml += `<div class="sim-sidebar-sep"></div>`;
                allClasses.forEach(c => {
                    // --c: цвет класса из classColors (стили таба — в styles.js);
                    // --ct: цвет текста на заливке (classTextColors, ТЗ 11.6.1e).
                    const color = this.classColors[c.id] || '#caa55c';
                    const textColor = this.classTextColors[c.id] || '#12100e';
                    // v11.6.5b.2: замки с классов сняты — все деревья
                    // кликабельны всегда. Осталась только метка ✓ у класса,
                    // в который уже вложены общие очки (аналог .skc-ow).
                    const owned = this.skillMode === 'shared' && this.ownerClass === c.id;
                    const tabBadge = owned
                        ? '<span class="sim-tab-own" title="Очки навыков вложены в этот класс">✓</span>'
                        : '';
                    tabsHtml += `<button class="modal-tab sim-tab" data-tab="${c.id}" style="--c:${color};--ct:${textColor}">${this.getClassSvg(c.id)}${this.classNames[c.id] || c.name || c.id}${tabBadge}</button>`;
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
                                    <!-- Верхняя панель: одна строка 38px (очки / билды / обмен). -->
                                    <div class="sim-top-bar">
                                        <div class="sim-free-pts">Свободно: <b id="free-${c.id}">0</b> / ${this.maxPts()}</div>
                                        <div class="sim-bar-sep"></div>
                                        <button class="sim-save-btn" data-save="${c.id}" title="Сохранить билд">Сохранить</button>
                                        <button class="sim-share-btn" data-share="${c.id}" title="Поделиться билдом">Поделиться</button>
                                        <button class="sim-import-btn" data-import="${c.id}" title="Импортировать билд">Импорт</button>
                                        <button class="sim-keep-btn" data-keep="${c.id}" title="От того, что уже вложено: взять очки, вложенные в игре, и планировать остальные до ${this.maxPts()}">⟲ Вложено</button>
                                        <div class="sim-bar-sep"></div>
                                        <select id="load-select-${c.id}" class="sim-load-select" title="Мои билды">
                                            <option value="">— Мои билды —</option>
                                        </select>
                                        <button class="sim-del-btn" data-del="${c.id}" title="Удалить выбранный билд">🗑️</button>
                                        <button class="sim-reset-btn" data-reset="${c.id}" title="Сбросить все навыки">Сбросить всё</button>
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

                // v11.6.3b: двухоконный лейкаут — сайдбар классов слева, дерево
                // и панель статов справа. Кнопки остались .modal-tab.sim-tab
                // с data-tab, поэтому обработчики ниже и автозагрузка билда из
                // ссылки (.modal-tab[data-tab=…]) находят их внутри <aside>.
                container.innerHTML = `
                    <div class="sim-layout">
                        <aside class="sim-sidebar">
                            ${tabsHtml}
                        </aside>
                        <main class="sim-main-content">
                            ${contentHtml}
                        </main>
                    </div>
                `;

                container.querySelectorAll('.modal-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        // Тултип узла относится к дереву текущей вкладки — прячем его
                        // при переключении класса (ТЗ 11.6.1d).
                        this.hideTooltip();
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

                // Билд из ссылки: программно открываем вкладку его класса, чтобы
                // симуляция сразу отрисовалась (клик по табу зовёт renderTree).
                if (this._autoLoadClass) {
                    const autoTab = container.querySelector(`.modal-tab[data-tab="${this._autoLoadClass}"]`);
                    this._autoLoadClass = null;
                    if (autoTab) autoTab.click();
                }
            } catch (err) {
                dbg('[BUILD SIM] Ошибка монтирования:', err);
                container.innerHTML = `<div style="color:#ff5a7a; text-align:center; padding:20px;">Ошибка: ${err.message}</div>`;
            }
        },

        resetBuild(clsId) {
            this.simulatedSkills[clsId] = {};
            // ТЗ 11.6.1d, п. 2.1: «Сбросить всё» НЕ должно подставлять последний
            // сохранённый билд. Забываем активный билд класса — тогда renderTree()
            // вернёт <select> к плейсхолдеру «— Мои билды —», а не к старой записи.
            this._setCurrentBuild(clsId, '');
            this.hideTooltip();
            this.renderTree(clsId);
            document.querySelectorAll('.sim-card').forEach(c => c.remove());
        },

        /**
         * v11.6.5b.1: кнопка «⟲ Вложено» (режим keep, «от того, что уже вложено»).
         *
         * Берёт ранги, которые УЖЕ вложены в игре (hero.sk.t[clsId]), кладёт
         * их в симуляцию и оставляет свободными остальные очки до целевого
         * лимита плана (maxPts, до 50) — их план и добирает кнопками +.
         * Правила зависимостей/тиров проверять не нужно: ранги пришли из
         * валидного состояния игры.
         */
        keepNativeBuild(clsId) {
            const ranks = (this.nativeSkills && this.nativeSkills[clsId]) || {};
            const clean = {};
            let total = 0;
            Object.entries(ranks).forEach(([nodeId, rank]) => {
                const r = Math.floor(Number(rank));
                if (!Number.isFinite(r) || r <= 0) return;
                clean[nodeId] = r;
                total += r;
            });
            if (!total) {
                UI.showToast('В этом дереве нет вложенных очков — начинаем с чистого плана', true);
                return;
            }
            this.simulatedSkills[clsId] = clean;
            // Это не сохранённый билд: «🗑️» не должен целиться в localStorage.
            this._setCurrentBuild(clsId, '');
            this.hideTooltip();
            this.renderTree(clsId);
            UI.showToast(`⟲ Взято из игры: ${total} ${this._pointsWord(total)} · свободно до ${this.maxPts()}`);
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

        // ------------------------------------------------------------
        // Инлайн-имя билда (патч 11.6.2a).
        // Панель .sim-top-bar — одна строка 38px, поэтому вместо window.prompt()
        // на месте кнопки «Сохранить» появляется пара «input + OK»
        // (CSS .sim-top-bar .sim-save-name: высота 28px, шрифт 12px).
        // Кнопку не удаляем, а прячем: её обработчик привязывается в renderTree()
        // (.onclick идемпотентно), а Enter / Esc / клик вне панели возвращают
        // разметку в исходное состояние.
        // ------------------------------------------------------------
        showSaveInline(clsId) {
            const saveBtn = document.querySelector(`.sim-save-btn[data-save="${clsId}"]`);
            if (!saveBtn) return;
            const bar = saveBtn.parentElement;
            // Повторный клик по «Сохранить» не должен плодить вторую пару.
            const existing = bar ? bar.querySelector('.sim-save-name') : null;
            if (existing) { existing.focus(); return; }

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'sim-save-name';
            input.placeholder = 'Название билда';
            input.maxLength = 40;
            input.value = (this._currentBuildNames && this._currentBuildNames[clsId]) || 'Мой билд';

            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'sim-save-ok';
            okBtn.textContent = 'OK';
            okBtn.title = 'Сохранить билд';

            saveBtn.style.display = 'none';
            // Порядок: «Сохранить» (скрыта) → input → OK.
            saveBtn.insertAdjacentElement('afterend', okBtn);
            saveBtn.insertAdjacentElement('afterend', input);

            const close = () => {
                document.removeEventListener('pointerdown', onOutside, true);
                input.remove();
                okBtn.remove();
                saveBtn.style.display = '';
            };

            const commit = () => {
                const name = (input.value || '').trim();
                if (!name) {
                    UI.showToast('Введите имя билда', true);
                    input.focus();
                    return;
                }
                // Сначала убираем пару, потом рендерим: renderTree() перерисовывает
                // дерево и список «Мои билды», панель должна быть как обычно.
                close();
                if (this.saveCurrentBuild(clsId, name)) {
                    UI.showToast('💾 Билд сохранен');
                    this.renderTree(clsId);
                }
            };

            const onOutside = (e) => {
                if (bar && !bar.contains(e.target)) close();
            };

            okBtn.onclick = commit;
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    close();
                }
            });
            // pointerdown, а не click: иначе клик по узлу дерева успел бы
            // отработать (очки/тултип) раньше, чем закроется панель.
            document.addEventListener('pointerdown', onOutside, true);

            input.focus();
            input.select();
        },

        // ------------------------------------------------------------
        // Обмен билдами без сервера: код в Base64 + ссылка #build=<код>.
        // Формат: { cls: '<класс>', sk: { <nodeId>: <ранг> } } → JSON →
        // encodeURIComponent (гарантирует ASCII, иначе btoa бросит исключение)
        // → Base64 → URL-safe: '+' → '-', '/' → '_', паддинг '=' срезан.
        // ------------------------------------------------------------
        encodeBuild(clsId) {
            const skills = this.simulatedSkills[clsId] || {};
            try {
                const json = JSON.stringify({ cls: clsId, sk: skills });
                return btoa(encodeURIComponent(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            } catch (e) {
                dbg('[BUILD SIM] Ошибка кодирования билда:', e);
                return '';
            }
        },

        // Код приходит извне (ссылка от другого игрока), поэтому декодируем
        // с проверками: известный класс, целые ранги в пределах node.max,
        // сумма очков не больше целевого лимита плана (maxPts, до 50).
        // Возвращает id класса, к которому относится билд, либо null.
        decodeBuild(code) {
            if (!code || typeof code !== 'string') return null;
            try {
                let b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
                // В ссылке паддинг срезан, а atob в части окружений требует
                // длину, кратную 4 — восстанавливаем.
                const pad = b64.length % 4;
                if (pad) b64 += '='.repeat(4 - pad);

                const data = JSON.parse(decodeURIComponent(atob(b64)));
                if (!data || typeof data !== 'object') return null;
                const cls = data.cls;
                const sk = data.sk;
                if (typeof cls !== 'string' || !sk || typeof sk !== 'object' || Array.isArray(sk)) return null;

                // Класс обязан быть в /api/skills — чужой код не подсунет произвольный clsId.
                const classes = (this.skillsCache && Array.isArray(this.skillsCache.classes)) ? this.skillsCache.classes : [];
                const clsData = classes.find(c => c.id === cls);
                if (!clsData) return null;

                // Допустимые узлы и максимумы рангов — из дерева этого класса.
                const nodeMax = new Map();
                (clsData.branches || []).forEach(b => (b.nodes || []).forEach(n => nodeMax.set(n.id, n.max || 1)));

                const clean = {};
                let total = 0;
                Object.entries(sk).forEach(([nodeId, rank]) => {
                    const max = nodeMax.get(nodeId);
                    if (!max) return;                  // узел не из этого дерева — пропускаем
                    const r = Math.floor(Number(rank));
                    if (!Number.isFinite(r) || r <= 0) return;
                    clean[nodeId] = Math.min(r, max);
                    total += clean[nodeId];
                });

                // «Перекачанный» билд (больше очков, чем даёт игра) не принимаем.
                // v11.6.3: лимит зависит от режима.
                // v11.6.5b.1: в shared план считается до MAX_POINTS (maxPts),
                // а не до уровня героя — иначе импорт плана на 50 не проходил.
                if (total > this.maxPts()) return null;

                this.simulatedSkills[cls] = clean;
                // Импорт — не сохранённый билд: «🗑️» не должен целиться
                // в запись из localStorage с тем же именем.
                this._setCurrentBuild(cls, '');
                return cls;
            } catch (e) {
                return null;
            }
        },

        // Достаём код из ссылки (#build=…), «голого» кода или текста с ссылкой.
        _extractBuildCode(input) {
            const raw = String(input || '').trim();
            const marker = '#build=';
            const idx = raw.indexOf(marker);
            // После кода в хэше могут идти другие параметры: #build=<код>&a=b
            return idx >= 0 ? raw.slice(idx + marker.length).split(/[&#\s]/)[0] : raw;
        },

        // «📤 Поделиться»: собираем ссылку с кодом билда и копируем в буфер.
        shareBuild(clsId) {
            const skills = this.simulatedSkills[clsId] || {};
            if (!Object.keys(skills).length) {
                UI.showToast('Сначала распределите очки навыков', true);
                return;
            }
            const code = this.encodeBuild(clsId);
            if (!code) { UI.showToast('Не удалось создать код билда', true); return; }

            // Код кладём в хэш: такой адрес не уходит на сервер игры и не
            // ломает SPA-роутинг (в отличие от query-параметра).
            const url = `${location.origin}${location.pathname}#build=${code}`;
            // clipboard.writeText доступен только в secure context и может быть
            // запрещён настройками браузера — тогда показываем окно для копирования.
            const fallback = () => window.prompt('Скопируйте ссылку на билд:', url);
            try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    navigator.clipboard.writeText(url)
                        .then(() => UI.showToast('📋 Ссылка на билд скопирована в буфер'))
                        .catch(fallback);
                } else {
                    fallback();
                }
            } catch (e) {
                fallback();
            }
        },

        // «📥 Импорт»: принимаем и ссылку целиком, и «голый» код.
        importBuild(clsId) {
            const input = window.prompt('Вставьте ссылку или код билда:');
            if (!input) return;

            const loadedCls = this.decodeBuild(this._extractBuildCode(input));
            if (!loadedCls) { UI.showToast('❌ Неверный формат кода билда', true); return; }

            UI.showToast('📥 Билд успешно импортирован!');
            if (loadedCls !== clsId) {
                // Билд другого класса — открываем его вкладку (клик сам зовёт
                // renderTree). Ищем внутри модалки планировщика: .modal-tab
                // используется и другими окнами аддона (аукцион, симулятор).
                const root = document.getElementById('buildsim-modal-body') || document;
                const tab = root.querySelector(`.modal-tab[data-tab="${loadedCls}"]`);
                if (tab) tab.click();
                else this.renderTree(loadedCls);
            } else {
                this.renderTree(clsId);
            }
        },

        yFor(req) {
            if (Y_MAP[req] !== undefined) return Y_MAP[req];
            // Произвольный req: линейно между нижним (0) и верхним (30) ярусом.
            return BH - BOT - Math.round(((req || 0) / 30) * 4 * TH);
        },

        // Русская форма слова «очко» для плашки гейта яруса (патч 11.6.2a):
        // 1 очко / 2 очка / 5 очков / 11 очков / 21 очко.
        _pointsWord(n) {
            const abs = Math.abs(n || 0);
            const tail100 = abs % 100;
            const tail10 = abs % 10;
            if (tail100 >= 11 && tail100 <= 14) return 'очков';
            if (tail10 === 1) return 'очко';
            if (tail10 >= 2 && tail10 <= 4) return 'очка';
            return 'очков';
        },

        changeSkill(clsId, nodeId, delta, maxRank, preNode, branchReq, branchIds, event) {
            if (event) event.stopPropagation();
            if (!this.simulatedSkills[clsId]) this.simulatedSkills[clsId] = {};
            const simTree = this.simulatedSkills[clsId];
            const current = simTree[nodeId] || 0;
            if (delta > 0) {
                // v11.6.5b.2: блокировка чужих деревьев в shared снята —
                // планировщик симулирует план на любой класс.
                // v11.6.5b.3: ни availablePoints, ни ownerClass здесь не
                // участвуют — лимит строго maxPts() (50) для любого класса.
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
                // Считаем только очки ТЕКУЩЕГО ПЛАНА (simTree), а не вложения игры.
                if (spent >= this.maxPts()) return;
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
            // renderTree() пересоздаёт узлы и прячет тултип, поэтому запоминаем его
            // состояние до перерисовки и восстанавливаем после (ТЗ 11.6.1d).
            const tipState = this._tooltipState ? { ...this._tooltipState } : null;
            this.renderTree(clsId);
            if (tipState && tipState.clsId === clsId && tipState.nodeId === nodeId) {
                this.showNodeTooltip(clsId, nodeId, tipState.mode === 'click');
            }
        },

        renderTree(clsId) {
            const clsData = this.skillsCache.classes.find(c => c.id === clsId);
            if (!clsData) return;
            // v11.6.3: перед рендером дерева убеждаемся, что нативный LGSkills
            // не остался в ленивом состоянии. Прогрев идемпотентен и нашу
            // отрисовку не блокирует (данные уже есть из /api/skills).
            this.warmNativeSkills();
            const container = document.getElementById(`tree-${clsId}`);
            if (!container) return;
            // Число колонок-веток как в нативном дереве (--nb), обычно 3.
            container.style.setProperty('--nb', String((clsData.branches || []).length || 3));

            if (!this.simulatedSkills[clsId]) this.simulatedSkills[clsId] = {};
            const simTree = this.simulatedSkills[clsId];
            let spent = 0; Object.values(simTree).forEach(v => spent += v);
            const freeEl = document.getElementById(`free-${clsId}`);
            // v11.6.5b.3: «Свободно: X / 50» = 50 минус сумма ВСЕХ очков
            // текущего плана. Вложения игры (hero.sk.t) и ownerClass в расчёт
            // не входят — полоска одинаково считается для любого класса.
            if (freeEl) freeEl.textContent = this.maxPts() - spent;

            let html = '';
            const simStats = {};

            clsData.branches.forEach(branch => {
                const nodes = branch.nodes || [];
                let branchPoints = 0;
                nodes.forEach(n => { branchPoints += (simTree[n.id] || 0); });

                // Раскладка ярусов: узлы одного req стоят на одной горизонтали (XS из игры).
                const tiers = new Map();
                nodes.forEach(n => {
                    if (!tiers.has(n.req)) tiers.set(n.req, []);
                    tiers.get(n.req).push(n);
                });
                const xMap = new Map();
                tiers.forEach(list => list.forEach((n, i) => xMap.set(n.id, this.xFor(list.length, i))));

                const topY = this.yFor(30);      // верхний ярус (req 30)
                const rootY = this.yFor(0) + 40; // ствол начинается под нижним узлом
                // Открытый ярус: максимальный req, набранный в ветке (req 0 открыт всегда).
                const openReq = [30, 20, 10, 5, 0].reduce((acc, req) => (req > acc && branchPoints >= req ? req : acc), 0);

                // Ствол: тёмная основа, пройденная часть цветом ветки, закрытая — пунктиром.
                let lines = `<path class="tk-bg" d="M50 ${rootY} V${topY}"/>`
                    + `<path class="tk-on" d="M50 ${rootY} V${this.yFor(openReq)}"/>`
                    + (openReq < 30 ? `<path class="tk-off" d="M50 ${this.yFor(openReq)} V${topY}"/>` : '');

                // Замочки ярусов (патч 11.6.2a, отступ пересчитан в 11.6.2a.1) —
                // аналог .skg нативного дерева. Плашка висит на стволе между ярусами,
                // показываем её только для ЗАКРЫТЫХ ярусов и пишем ОСТАТОК.
                // Геометрия при TH = 135 и кружке 54px (48 + 2×3):
                //   низ верхнего узла  ≈ y + 73  (кружок 54 + ранги 11 + подпись 2×14)
                //   верх кружка ниже   = y + TH − 27 = y + 108
                // центр свободной полосы ≈ y + 91…92 = y + (48 + TH) / 2 — та же
                // нативная формула, при TH = 135 она даёт 92px.
                // Плашка ~21px высотой целиком ложится в полосу 81…103 и не наезжает
                // ни на подпись навыка, ни на кружок следующего яруса.
                let gates = '';
                [...tiers.keys()].filter(req => req > 0).sort((a, b) => b - a).forEach(req => {
                    if (branchPoints >= req) return; // ярус уже открыт — замок не нужен
                    const gy = this.yFor(req) + Math.round((48 + TH) / 2);
                    const need = req - branchPoints;
                    const tip = `Откроется при ${req} ${this._pointsWord(req)} в ветке «${Utils.escapeHtml(branch.name)}» (сейчас ${branchPoints})`;
                    gates += `<div class="sim-gate" data-req="${req}" style="top:${gy}px" title="${tip}">🔒 <span>${need} ${this._pointsWord(need)}</span></div>`;
                });

                // Отводы к боковым узлам — кривые Безье; prereq — прямые линии.
                nodes.forEach(node => {
                    const rank = simTree[node.id] || 0;
                    const x = xMap.get(node.id);
                    const y = this.yFor(node.req);
                    const shut = branchPoints < node.req || (node.pre && !(simTree[node.pre] > 0));

                    if (x !== 50) {
                        const tw = rank > 0 ? 'tw on' : (shut ? 'tw' : 'tw op');
                        lines += `<path class="${tw}" d="M50 ${y + 40} Q50 ${y} ${x} ${y}"/>`;
                    }
                    if (node.pre) {
                        const parent = nodes.find(n => n.id === node.pre);
                        if (parent) {
                            const px = xMap.get(parent.id);
                            const cls = rank > 0 ? 'pre on' : ((simTree[parent.id] || 0) > 0 ? 'pre op' : 'pre');
                            lines += `<path class="${cls}" d="M${px} ${this.yFor(parent.req)} L${x} ${y}"/>`;
                        }
                    }
                });

                html += `<div class="sim-branch">
                    <div class="sim-branch-header">${this.getBranchSvg(branch)}<div class="sim-branch-title">${branch.name}</div><div class="sim-branch-pts" title="Очков в ветке">${branchPoints}</div></div>
                    <div class="sim-in" style="height:${BH}px">
                        <svg class="sim-lines" viewBox="0 0 100 ${BH}" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${gates}`;

                nodes.forEach(node => {
                    const rank = simTree[node.id] || 0;
                    const locked = branchPoints < node.req || (node.pre && !(simTree[node.pre] > 0));
                    const maxed = rank >= node.max;

                    if (rank > 0 && node.fx) {
                        for (const [k, v] of Object.entries(node.fx)) {
                            if (this.isSkipFx(k)) continue;
                            simStats[k] = (simStats[k] || 0) + (v * rank);
                        }
                    }

                    let ranksHtml = '';
                    for (let i = 0; i < node.max; i++) ranksHtml += `<i class="${i < rank ? 'filled' : ''}"></i>`;

                    // Состояния как в нативном дереве: lock / has / max / can (available).
                    const state = (locked ? ' locked' : '')
                        + (rank > 0 ? ' has' : '')
                        + (maxed ? ' maxed' : '')
                        + (!locked && !maxed ? ' available' : '');
                    const x = xMap.get(node.id);
                    const y = this.yFor(node.req);

                    html += `<div class="sim-node${state}"
                        data-cls="${clsId}" data-node="${node.id}"
                        style="left:${x}%;top:${y}px">
                        <div class="sim-node-icon">${this.getNodeSvg(node, branch)}</div>
                        <div class="sim-node-ranks">${ranksHtml}</div>
                        <div class="sim-node-name">${node.name}</div>
                    </div>`;
                });
                html += `</div></div>`;
            });

            container.innerHTML = html;

            container.querySelectorAll('.sim-node').forEach(el => {
                const nodeCls = el.dataset.cls;
                const nodeId = el.dataset.node;

                // Наведение: через 500 мс показываем тултип ТОЛЬКО с текстом.
                el.addEventListener('mouseenter', () => {
                    this._clearTooltipTimer();
                    this._tooltipTimer = setTimeout(() => {
                        this._tooltipTimer = null;
                        this.showNodeTooltip(nodeCls, nodeId, false);
                    }, 500);
                });

                // Мышь ушла раньше таймера — отменяем; висящий hover-тултип прячем.
                el.addEventListener('mouseleave', () => {
                    this._clearTooltipTimer();
                    if (this._tooltipState && this._tooltipState.mode === 'hover') this.hideTooltip();
                });

                // Клик: тултип с кнопками +/−; повторный клик по тому же узлу закрывает.
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const st = this._tooltipState;
                    if (st && st.mode === 'click' && st.clsId === nodeCls && st.nodeId === nodeId) {
                        this.hideTooltip();
                        return;
                    }
                    this._clearTooltipTimer();
                    this.showNodeTooltip(nodeCls, nodeId, true);
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

            if (sel && saveBtn && delBtn) {
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

                // Патч 11.6.2a: вместо window.prompt() — инлайн-поле имени прямо
                // в верхней панели (см. BuildSim.showSaveInline выше).
                saveBtn.onclick = () => this.showSaveInline(clsId);

                sel.onchange = () => {
                    // Плейсхолдер «— Мои билды —» = пустое дерево (ТЗ 11.6.1d, п. 2.2):
                    // раньше выбор дефолтного пункта ничего не делал и билд оставался.
                    if (sel.value === '') {
                        this.resetBuild(clsId);
                        return;
                    }
                    // Выбор в списке сразу загружает билд и делает его активным;
                    // sel.value после renderTree выставит преселект выше.
                    this.loadBuild(clsId, +sel.value);
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

            // --- Обмен билдами: «📤 Поделиться» / «📥 Импорт» ---
            // Кнопки статичны в .sim-top-bar (вне #tree-…), поэтому .onclick
            // переназначаем идемпотентно — как у кнопок сохранения выше.
            const shareBtn = document.querySelector(`.sim-share-btn[data-share="${clsId}"]`);
            if (shareBtn) shareBtn.onclick = () => this.shareBuild(clsId);

            const importBtn = document.querySelector(`.sim-import-btn[data-import="${clsId}"]`);
            if (importBtn) importBtn.onclick = () => this.importBuild(clsId);

            // v11.6.5b.1: «⟲ От вложенного» — план от текущих очков героя.
            const keepBtn = document.querySelector(`.sim-keep-btn[data-keep="${clsId}"]`);
            if (keepBtn) keepBtn.onclick = () => this.keepNativeBuild(clsId);

            // Перерисовка пересоздала узлы — старый тултип невалиден (позиция
            // устарела). changeSkill() при необходимости покажет его заново.
            this.hideTooltip();
        },

        // ------------------------------------------------------------
        // Тултип узла навыка (ТЗ 11.6.1d).
        // Один общий DOM-элемент .sim-tooltip на окно планировщика:
        //   • наведение 500 мс → только текст (без кнопок);
        //   • клик по узлу      → текст + кнопки «− Убрать» / «+ Вложить»;
        //   • повторный клик по тому же узлу / клик вне дерева → закрыть.
        // Элемент — прямой ребёнок .custom-modal (НЕ внутри .sim-tree-wrap),
        // поэтому overflow дерева его не обрезает. position: absolute, а не fixed:
        // модалка таскается и теряет transform, absolute же всегда считается
        // от её padding-box (модалка position: fixed), т.е. координаты стабильны.
        // ------------------------------------------------------------
        _clearTooltipTimer() {
            if (this._tooltipTimer) {
                clearTimeout(this._tooltipTimer);
                this._tooltipTimer = null;
            }
        },

        _getTooltip() {
            const body = document.getElementById('buildsim-modal-body');
            const host = (body && body.closest('.custom-modal')) || document.body;
            let tip = host.querySelector('.sim-tooltip');
            // Элемент должен быть один: остатки от прошлых модалок удаляем.
            document.querySelectorAll('.sim-tooltip').forEach(t => { if (t !== tip) t.remove(); });
            if (!tip) {
                tip = document.createElement('div');
                tip.className = 'sim-tooltip';
                host.appendChild(tip);
            }
            return tip;
        },

        hideTooltip() {
            this._clearTooltipTimer();
            this._tooltipState = null;
            document.querySelectorAll('.sim-tooltip').forEach(tip => {
                tip.classList.remove('on');
                tip.innerHTML = '';
            });
            document.querySelectorAll('.sim-node.sim-node-active').forEach(n => n.classList.remove('sim-node-active'));
        },

        // Ставим тултип рядом с узлом: справа, если влезает, иначе слева;
        // по вертикали — от верхней кромки узла, с прижатием к краям экрана.
        _positionTooltip(tip, nodeEl) {
            const host = tip.parentElement || document.body;
            const nRect = nodeEl.getBoundingClientRect();
            const vw = window.innerWidth || 1280;
            const vh = window.innerHeight || 720;
            const gap = 12, edge = 8;
            const w = tip.offsetWidth || 280;
            const h = tip.offsetHeight || 160;

            let x = nRect.right + gap;
            if (x + w > vw - edge) x = nRect.left - w - gap; // справа не влезает — слева
            x = Math.max(edge, Math.min(x, vw - w - edge));

            let y = nRect.top - 10;
            y = Math.max(edge, Math.min(y, vh - h - edge));

            // Пересчёт из системы окна в систему родителя.
            // v11.6.2a.3: в реальном UI планировщик живёт в #hp-buildsim-container
            // (HeroPlanner), #buildsim-modal-body отсутствует — тултип крепится
            // к document.body (см. _getTooltip), поэтому base = 0 и прокрутка
            // дерева его координаты не смещает.
            // Компенсация scrollLeft/scrollTop остаётся страховкой на случай,
            // если host окажется скроллящимся контейнером.
            const hRect = host.getBoundingClientRect();
            const inBody = host === document.body;
            const baseX = inBody ? 0 : hRect.left + host.clientLeft - (host.scrollLeft || 0);
            const baseY = inBody ? 0 : hRect.top + host.clientTop - (host.scrollTop || 0);

            tip.style.left = Math.round(x - baseX) + 'px';
            tip.style.top = Math.round(y - baseY) + 'px';
        },

        showNodeTooltip(clsId, nodeId, withControls) {
            const classes = (this.skillsCache && Array.isArray(this.skillsCache.classes)) ? this.skillsCache.classes : [];
            const clsData = classes.find(c => c.id === clsId);
            if (!clsData) return;
            const branch = (clsData.branches || []).find(b => (b.nodes || []).some(n => n.id === nodeId));
            if (!branch) return;
            const node = branch.nodes.find(n => n.id === nodeId);
            if (!node) return;

            // renderTree() пересоздаёт узлы — позиционируемся от актуального элемента.
            const treeEl = document.getElementById(`tree-${clsId}`);
            const nodeEl = treeEl ? Array.from(treeEl.querySelectorAll('.sim-node'))
                .find(el => el.dataset.node === nodeId) : null;
            if (!nodeEl) return; // вкладка закрыта — привязываться не к чему

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

            const tip = this._getTooltip();
            tip.dataset.cls = clsId;
            tip.dataset.node = nodeId;
            tip.classList.add('on');
            tip.innerHTML = `
                ${withControls ? '<div class="sim-tooltip-close" title="Закрыть">✖</div>' : ''}
                <h4>${Utils.escapeHtml(node.name)} <span>${rank}/${node.max}</span></h4>
                <div class="desc">${this.formatNodeText(node, rank)}</div>
                ${reqText ? `<div class="req">${reqText}</div>` : ''}
                ${withControls ? `<div class="controls">
                    <button type="button" data-action="minus" ${rank === 0 ? 'disabled' : ''}>− Убрать</button>
                    <button type="button" data-action="plus" ${maxed || locked ? 'disabled' : ''}>+ Вложить</button>
                </div>` : ''}`;

            // Позиция — после вставки контента: нужны реальные offsetWidth/Height.
            this._positionTooltip(tip, nodeEl);

            document.querySelectorAll('.sim-node.sim-node-active').forEach(n => n.classList.remove('sim-node-active'));
            nodeEl.classList.add('sim-node-active');

            const closeBtn = tip.querySelector('.sim-tooltip-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.hideTooltip();
                });
            }

            // stopPropagation обязателен: иначе клик по кнопке всплывёт до document
            // и тултип закроется раньше, чем отработает changeSkill().
            tip.querySelectorAll('button[data-action]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const delta = btn.dataset.action === 'plus' ? 1 : -1;
                    this.changeSkill(clsId, node.id, delta, node.max, node.pre || null, node.req || 0, branchIds, e);
                });
            });

            this._tooltipState = { clsId, nodeId, mode: withControls ? 'click' : 'hover' };
        },

        // Алиас для старых вызовов: карточка .sim-card заменена общим тултипом
        // (ТЗ 11.6.1d). Поведение как у клика по узлу — с кнопками +/−.
        showNodeCard(clsId, nodeId, event) {
            if (event) { event.stopPropagation(); event.preventDefault(); }
            this._clearTooltipTimer();
            this.showNodeTooltip(clsId, nodeId, true);
        }
    };
