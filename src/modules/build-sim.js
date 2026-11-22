    // ============================================================
    // 4. МОДУЛЬ: ПЛАНИРОВЩИК БИЛДОВ — РАДИАЛЬНОЕ СОЗВЕЗДИЕ
    //
    // Новая система навыков игры (reference/LegionFrontSRC/site/skillmap.js):
    //   GET /api/skills        -> classes[].map = { P, E } — геометрия созвездия;
    //                             classes[].branches[].nodes[] — метаданные узлов;
    //   GET /api/skmap?cls=ID  -> состояние игрока (st.n/a/eq/s), лимиты
    //                             (step, classOpen), способности Арены (ab.br[]).
    //
    // ВАЖНО (античит/CSP): это ПЕСОЧНИЦА. POST /api/skmap/act не отправляется,
    // window.fetch/LGMine.open/LGMine.onEvent не патчатся. Действия меняют
    // только локальный объект sandbox — очки и жетоны игрока не тратятся.
    // ============================================================
    const BuildSim = {
        /* Имена классов (использует core/ui.js для карточки профиля). */
        classNames: { recruit: 'Новобранец', legionary: 'Легионер', archer: 'Лучник', mage: 'Маг', priest: 'Жрец', rogue: 'Разбойник', necromancer: 'Некромант', paladin: 'Паладин' },

        /* Цвета кнопок классов (нативный экран игры, как раньше). */
        classColors: { recruit: '#d7d3c8', legionary: '#ff7b7b', archer: '#7bff7b', mage: '#7bbaff', priest: '#ffcf4a', rogue: '#d4aaff', necromancer: '#7c52cc', paladin: '#ffdf7b' },
        classTextColors: { necromancer: '#fff' },

        /* Человеческие названия статов (использует hero-planner.js). */
        statNames: { hp: 'Макс. HP', atk: 'Физ. урон', mag: 'Магия', def: 'Броня', crit: 'Крит %', critDmg: 'Сила крита', dodge: 'Уклонение', pierce: 'Пробивание', healPow: 'Сила лечения', luck: 'Удача', resist: 'Сопротивление' },

        /* fx-ключи -> подписи в сводке «Что дают открытые навыки».
           v11.7.1: знаки «%» и «+» в подписях НЕ дублируются — суффикс и знак
           значения добавляет statList() (item.sign/item.suf). */
        fxNames: { melee: 'Физ. урон', magic: 'Магия', hp: 'Макс. здоровье', def: 'Броня', healPow: 'Сила лечения', healIn: 'Входящее лечение', crit: 'Шанс крита', critDmg: 'Сила крита', skel: 'Урон скелетов', skelT: 'Время скелетов', leech: 'Вампиризм', block: 'Снижение получаемого урона', dodge: 'Уклонение', lead: 'Урон по боссам', first: 'Урон в 1-й ход', dmg: 'Весь урон', pierce: 'Пробивание брони', resist: 'Шанс избежать яда и тины', healCrit: 'Шанс сильного лечения', regen: 'Регенерация', low: 'Урон при низком HP', ranged: 'Урон луком', poison: 'Отрава', steal: 'Кража', loot: 'Добыча', skelN: 'Скелетов', volley: 'Залп', shieldBlock: 'Снижение урона со щитом', trapDodge: 'Избегание ловушек', steady: 'Промах→удар', cleave: 'Замах', cleaveBoss: 'Замах по боссу', penBoss: 'Бронебой по боссу', drain: 'Вытягивание', hex: 'Проклятие', holy: 'По нежити', poisonT: 'Время отравы', abNext: 'Удар после умения', angel: 'Ангел-хранитель', backFoe: 'Урон по дальней линии', banner: 'Знамя когорты', breakHeal: 'Лечение при разбитом щите', burnChain: 'Цепной огонь', burnFoe: 'Урон по горящим', chillFoe: 'Урон по ознобу', chillProc: 'Шанс озноба', coverNb: 'Прикрытие соседа', critBleed: 'Кровотечение при крите', critBlind: 'Ослепление при крите', critBurn: 'Поджог при крите', critPierceWard: 'Крит сквозь щиты', dmgHeal: 'Лечение от урона', dodgeNext: 'Выстрел после уклонения', firstTeam: 'Урон команды в 1-й ход', guardAura: 'Аура защиты стойки', healNext: 'Удар после лечения', healRegen: 'Регенерация после лечения', healSplash: 'Всплеск лечения', highFoe: 'Урон по здоровым', highSelf: 'Урон при высоком HP', huntMark: 'Охотничья метка', killHit: 'Добивание врага', lastStand: 'Последний рубеж', lineCut: 'Защита соратников по линии', lowHeal: 'Лечение раненых', multiLow: 'Залп по раненым', overShield: 'Щит избытка лечения', phoenixHeart: 'Сердце феникса', ricochet: 'Рикошет выстрела', sameFoe: 'Пристрелка', shieldDmg: 'Урон под щитом', shieldUp: 'Прочность накладываемых щитов', startShield: 'Стартовый барьер', startWard: 'Стартовый оберег', taunt: 'Провокация', thorns: 'Шипы на щите', trap: 'Капкан', underShield: 'Защита под щитом', weakFoe: 'Урон по ослабленным', winter: 'Вечная зима' },

        /* v11.7.1: fx-ключи-механики (1 = эффект включён). Это НЕ числовые
           бонусы: «Ангел-хранитель +1%» или «Последний рубеж +2%» — ложь.
           Такие узлы описываются полным текстом node.text, а в сводке
           «Что дают открытые навыки» они не участвуют. */
        fxFlags: { angel: 1, lastStand: 1, phoenixHeart: 1, winter: 1, critPierceWard: 1, killHit: 1 },

        /* v11.7.1: единицы fx-значений для сводки. По умолчанию «%»;
           исключения — плоские пункты, штуки и секунды (как в текстах). */
        fxUnits: { def: '', critDmg: '', skelN: ' шт.', skelT: ' сек.' },

        /* Категории прокачки способностей Арены (как в /api/skmap: ab.br[].next). */
        ARENA_KINDS: [['lv', 'Ступень'], ['pow', 'Мощь'], ['eff', 'Эффект'], ['dur', 'Длительность']],
        ARENA_KIND_DEFAULT_MAX: { lv: 5, pow: 3, eff: 3, dur: 3 },
        /* Фолбэк-шкала цены шага (когда сервер не прислал next для этой ступени). */
        ARENA_COST: { lv: [1, 3, 7, 15, 25], pow: [2, 5, 10], eff: [2, 5, 10], dur: [2, 5, 10] },

        /* Ключи хранилища пресетов. */
        BUILD_KEY: 'lgu_saved_builds_v2',
        LEGACY_BUILD_KEY: 'LEGION_SAVED_BUILDS',

        /* Палитра веток (bi % 3) — как в skillmap.css (--bc-0..2). */
        BRANCH_COLORS: ['#5cc8ff', '#ff9466', '#c4a0ff'],

        /* ------------------------------------------------------------
         * Состояние модуля (память страницы)
         * ---------------------------------------------------------- */
        skillsCache: null,   // ответ GET /api/skills
        skmapCache: {},      // clsId -> ответ GET /api/skmap?cls=…
        sandbox: {},         // clsId -> { nodes, abilities, eq, up }
        savedBuilds: {},     // clsId -> [{ name, at, data }]
        hero: null,          // последний /api/me.hero (имя, уровень, статы)

        _skmapPending: {},   // clsId -> Promise (дедупликация запросов)
        _root: null,         // контейнер HeroPlanner (#hp-buildsim-container)
        _els: {},            // кэш элементов оболочки
        _cls: '',            // активный класс
        _tab: 'map',         // 'map' | 'gear'
        _sel: null,          // выбранный узел/ромб/'hub'
        _hover: null,        // узел под курсором
        _view: { s: 1, x: 0, y: 0 },
        _pan: null,
        _hashCode: '',       // код из ссылки #build=…
        _savedLoaded: false,
        _needLegacyMigration: false,
        _buildIndex: null,   // выбранный пресет в списке
        _buildName: '',
        /* ------------------------------------------------------------
         * Иконки (собственный компактный набор, viewBox 0 0 24 24).
         * ---------------------------------------------------------- */
        SKILL_ICONS: {
            sword: '<path d="M19.5 4.5 20 4l-.5 4.5L9.5 18.5l-4-4zM7.5 16.5l-3 3M4 15l5 5"/>',
            shield: '<path d="M12 3.5l7 2.8v5.1c0 4.6-3 7.8-7 9.6-4-1.8-7-5-7-9.6V6.3z"/>',
            bow: '<path d="M6 3c6 3 9 9 6 18M6 3l12 18M14 5h5v5M19 5 9 15"/>',
            spark: '<path d="M12 2.5l1.8 6.2 6.2 1.8-6.2 1.8L12 18.5l-1.8-6.2L4 10.5l6.2-1.8z"/>',
            fire: '<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.6 3-5.8 3.6-9.5 2 1.5 3 3.4 3.2 5.3 1-1 1.6-2.4 1.6-3.8 2.7 2.2 4.6 5 4.6 8 0 3.4-2.5 6-6 6z"/>',
            frost: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
            heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
            cross: '<path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>',
            skull: '<path d="M12 3.5a7.5 7.5 0 0 0-4.5 13.5v3h9v-3A7.5 7.5 0 0 0 12 3.5z"/><circle cx="9.3" cy="11.5" r="1.6"/><circle cx="14.7" cy="11.5" r="1.6"/>',
            star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
            bolt: '<path d="M13.5 2.5 5.5 13.5h6l-1.5 8 8-11h-6z"/>',
            crown: '<path d="M3.5 18.5h17M4.5 18.5 3.5 7l5 4 3.5-6 3.5 6 5-4-1 11.5z"/>',
            wind: '<path d="M3 8.5h11a3 3 0 1 0-3-3M3 12.5h15a3 3 0 1 1-3 3M3 16.5h8"/>',
            eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
            dagger: '<path d="M14.5 3.5 16 5l-7.5 9-2-2zM6.5 12l-2.5 2.5 2 2 2.5-2.5M5 15.5l-1.5 1.5 3 3L8 18.5M15 13.5l5 5"/>',
            vial: '<path d="M9.5 3.5h5M10.5 3.5v5L6 17a2.6 2.6 0 0 0 2.3 3.5h7.4A2.6 2.6 0 0 0 18 17l-4.5-8.5v-5M8 14.5h8"/>',
            sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
            drop: '<path d="M12 3.5s-6 6.6-6 10.6a6 6 0 0 0 12 0c0-4-6-10.6-6-10.6z"/>',
            coin: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.6-.9-1.5-1.3-2.5-1.3-1.5 0-2.5.8-2.5 1.9 0 2.7 5.2 1.3 5.2 4 0 1.1-1.1 1.9-2.7 1.9-1.1 0-2.1-.5-2.6-1.4M12 6.5v1.7M12 15.8v1.7"/>',
            leaf: '<path d="M4 20c8 0 16-4 16-16C10 4 4 10 4 20zM8 16c2-4 5-6 9-8"/>',
            hex: '<path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z"/>',
            tri: '<path d="M12 4l8 16H4z"/>',
            clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
            diam: '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>'
        },
        SOLID_ICONS: ['sword', 'shield', 'heart', 'cross', 'star', 'bolt', 'crown', 'fire', 'spark', 'leaf', 'hex', 'tri', 'diam', 'drop'],
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
        CLASS_ICONS: { legionary: 'sword', archer: 'bow', mage: 'spark', priest: 'cross', rogue: 'dagger', necromancer: 'skull', paladin: 'sun', gear: 'shield', recruit: 'diam' },
        /* Сопоставление id ветки и иконки (фолбэк, если у узла нет fx). */
        BRANCH_ICONS: { blade: 'sword', shield: 'shield', bow: 'bow', arcane: 'spark', fire: 'fire', frost: 'frost', holy: 'sun', light: 'sun', shadow: 'skull', dark: 'skull', blood: 'drop', life: 'heart', nature: 'leaf', poison: 'vial', wind: 'wind', might: 'crown', grace: 'cross' },

        /* Экранирование HTML/SVG-текста. */
        esc(v) { return Utils.escapeHtml(String(v == null ? '' : v)); },

        _iconPaths(key) { return this.SKILL_ICONS[key] || this.SKILL_ICONS.diam; },

        /* Иконка как самостоятельный <svg> (сайдбар, инспектор). */
        _svg(key) {
            const known = this.SKILL_ICONS[key] ? key : 'diam';
            const solid = this.SOLID_ICONS.indexOf(known) >= 0 ? ' so' : '';
            return `<svg class="lgu-skm-i${solid}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${this._iconPaths(known)}</svg>`;
        },

        /* Иконка как вложенный <svg> внутри группы созвездия. */
        _iconMarkup(key, size) {
            const s = size || 26;
            const known = this.SKILL_ICONS[key] ? key : 'diam';
            return `<svg x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${this._iconPaths(known)}</svg>`;
        },

        iconKeyOf(node, branch) {
            if (!node) return 'diam';
            const fxKeys = Object.keys(node.fx || {});
            if (fxKeys.some(k => k.indexOf('cd_') === 0)) return 'clock';
            if (node.kind === 'cap') return 'crown';
            if (node.kind === 'act') return 'bolt';
            if (node.kind === 'ctl') return 'star';
            for (const k of fxKeys) {
                for (const [re, icon] of this.FX_ICONS) if (re.test(k)) return icon;
            }
            const bid = branch && branch.id;
            if (bid && this.BRANCH_ICONS[bid]) return this.BRANCH_ICONS[bid];
            if (node.icon && this.SKILL_ICONS[node.icon]) return node.icon;
            return 'diam';
        },
        getNodeSvg(node, branch) { return this._svg(this.iconKeyOf(node, branch)); },
        getClassSvg(clsId) { return this._svg(this.CLASS_ICONS[clsId] || 'diam'); },

        isSkipFx(key) { return SKIP_FX_PREFIXES.some(p => key.indexOf(p) === 0); },

        /**
         * Коэффициент перевода сырого fx во вторичную характеристику.
         *
         * В игре resist/pierce лежат в fx «сырыми» и переводятся в статы через
         * LGGameData.xstats.fromFx (обычно 0.5: fx 60 -> +30). Без множителя
         * подсказки и сводка показывали удвоенные значения (+60 вместо +30).
         */
        xstatFromFx() {
            const src = (typeof G !== 'undefined' && G && G.LGGameData && G.LGGameData.xstats)
                ? G.LGGameData.xstats.fromFx
                : null;
            const base = { resist: 0.5, pierce: 0.5 };
            if (!src || typeof src !== 'object') return base;
            return { ...base, ...src };
        },

        /**
         * Текст навыка с подстановкой значений fx за текущий ранг.
         *
         * Шаблон берётся из node.text (как в игре, site/skills.js: txt()).
         * Числовые fx умножаются на ранг; для resist/pierce подставляется
         * «сырое» значение — в текстах это ШАНС избежать яда/тины и процент
         * игнорируемой брони, а не пункты характеристики. Поэтому ложное
         * «характеристика "Сопротивление" +N» больше НЕ дописывается:
         * иначе нода «Чистота» (шанс 40%) выглядела как +40% сопротивления.
         *
         * Макросы cleaveBoss/penBoss/critX считаются на лету — их нет в fx
         * (см. kv() в reference/LegionFrontSRC/site/skills.js).
         *
         * @param {object} node узел из /api/skills
         * @param {number} rank ранг (1…max)
         * @returns {string} готовое описание
         */
        formatNodeText(node, rank) {
            if (!node) return '';
            const r = Math.max(1, +rank || 1);
            const fx = node.fx || {};
            const has = (k) => Object.prototype.hasOwnProperty.call(fx, k);
            const fmt = (val) => {
                const n = Math.round((+val || 0) * 10) / 10;
                return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
            };

            // В игре крит считается от ×1,5, когда у героя есть вторичные
            // статы (XON в site/skills.js), иначе от ×2.
            const xd = (typeof G !== 'undefined' && G && G.LGGameData && G.LGGameData.xstats) || null;
            const hasXs = !!(this.hero && this.hero.xs && Object.keys(this.hero.xs).length);
            const critBase = (hasXs && xd && +(xd.base || {}).critDmg > 0)
                ? 1 + (+xd.base.critDmg / 100)
                : 2;
            const hasText = !!node.text;
            const rawText = hasText ? String(node.text) : this.describeFx(fx, r);

            let out = rawText
                .replace(hasXs ? /×2 → ×/ : /$^/, () => `×${fmt(critBase)} → ×`)
                .replace(/\{(\w+)\}/g, (match, key) => {
                    if (key === 'critX') return fmt(critBase + (fx.critDmg || 0) * r / 100);
                    if (key === 'cleaveBoss') return fmt((fx.cleave || 0) * r * 0.4);
                    if (key === 'penBoss') return fmt((fx.pierce || 0) * r / 20);
                    if (has(key)) return fmt(fx[key] * r);
                    return match;
                });

            // Примечания — только для эффектов, которых НЕТ в шаблоне.
            // Если {resist}/{pierce} уже подставлены, текст игры самодостаточен
            // и дублировать их «характеристиками» не нужно.
            const notes = [];
            if (hasText && has('resist') && !/\{resist\}/.test(rawText)) {
                notes.push(`шанс избежать яда и тины +${fmt(fx.resist * r)}%`);
            }
            if (hasText && has('pierce') && !/\{pierce\}/.test(rawText)) {
                const scale = +this.xstatFromFx().pierce;
                notes.push(`характеристика «Пробивание» +${fmt(fx.pierce * r * (isFinite(scale) ? scale : 1))}%`);
            }
            if (notes.length) out += ' · ' + notes.join(' · ');

            return out;
        },

        /**
         * v11.7.1: запасное описание узла, если игра не прислала node.text.
         * Собирает только числовые бонусы; механики-флаги пропускает.
         *
         * @param {object} fx карта эффектов узла
         * @param {number} rank ранг
         * @returns {string}
         */
        describeFx(fx, rank) {
            const r = Math.max(1, +rank || 1);
            const parts = [];
            for (const [k, v] of Object.entries(fx || {})) {
                if (this.isSkipFx(k) || this.fxFlags[k] || !isFinite(+v) || !this.fxNames[k]) continue;
                const unit = (k in this.fxUnits) ? this.fxUnits[k] : '%';
                const val = Math.round(+v * r * 10) / 10;
                parts.push(`${this.fxNames[k]} +${String(val).replace('.', ',')}${unit}`);
            }
            return parts.join(' · ');
        },

        /** Кнопка BuildSim больше не нужна (её ведёт HeroPlanner), но init
         *  остаётся точкой входа из main.js. */
        init() { /* ничего не регистрируем: песочница монтируется в HeroPlanner */ },

        /* ------------------------------------------------------------
         * Данные класса / графа
         * ---------------------------------------------------------- */
        classList() {
            const list = (this.skillsCache && Array.isArray(this.skillsCache.classes)) ? this.skillsCache.classes : [];
            return list.filter(c => c && c.id && c.map && c.map.P);
        },

        clsData(cls) {
            const id = cls || this._cls;
            return this.classList().find(c => c.id === id) || null;
        },

        mapP() {
            const C = this.clsData();
            return (C && C.map && C.map.P) || {};
        },

        mapE() {
            const C = this.clsData();
            return (C && C.map && Array.isArray(C.map.E)) ? C.map.E : [];
        },

        /** Координаты узла: 'hub' — всегда центр (0,0). */
        pointOf(id) {
            if (id === 'hub') return { x: 0, y: 0 };
            const p = this.mapP()[id];
            return (p && isFinite(+p.x) && isFinite(+p.y)) ? { x: +p.x, y: +p.y } : null;
        },

        branchOf(id, cls) {
            const C = this.clsData(cls);
            if (!C) return null;
            for (const B of (C.branches || [])) {
                for (const n of (B.nodes || [])) if (n.id === id) return B;
            }
            return null;
        },

        nodeOf(id, cls) {
            const C = this.clsData(cls);
            if (!C) return null;
            for (const B of (C.branches || [])) {
                for (const n of (B.nodes || [])) if (n.id === id) return n;
            }
            return null;
        },

        /** Метаданные способности Арены: ключ «ветка:ab» / «ветка:ult». */
        abOf(key, cls) {
            const parts = String(key || '').split(':');
            if (parts.length !== 2) return null;
            const bid = parts[0], kind = parts[1];
            if (kind !== 'ab' && kind !== 'ult') return null;
            const V = this.skmapCache[cls || this._cls];
            const list = (V && V.ab && Array.isArray(V.ab.br)) ? V.ab.br : [];
            const br = list.find(x => x && x.id === bid);
            if (br && br[kind]) return br[kind];
            const C = this.clsData(cls);
            const B = C && (C.branches || []).find(b => b && b.id === bid);
            return (B && B[kind]) ? B[kind] : null;
        },

        branchIndex(bid) {
            const C = this.clsData();
            return C ? (C.branches || []).findIndex(b => b && b.id === bid) : -1;
        },

        branchColor(bi) {
            const i = Math.abs((+bi || 0) % 3);
            return this.BRANCH_COLORS[i];
        },

        /* ------------------------------------------------------------
         * Правила графа (повторяют skillmap.js)
         * ---------------------------------------------------------- */

        /** Соседи по рёбрам созвездия; рёбра 'q' (молнии похода) не считаются. */
        nbrs(id) {
            const out = [];
            for (const e of this.mapE()) {
                if (!e || e.length < 2 || e[3] === 'q') continue;
                if (e[0] === id) out.push(e[1]);
                else if (e[1] === id) out.push(e[0]);
            }
            return out;
        },

        _isOpen(st, id) {
            if (id === 'hub') return true;
            const s = st || this.state();
            return (+((s.nodes || {})[id]) > 0) || !!((s.abilities || {})[id]);
        },

        /** Все открытые узлы (для проверки связности/счётчиков). */
        _openedIds(st, skipId) {
            const out = [];
            for (const [id, r] of Object.entries((st && st.nodes) || {})) {
                if (+r > 0 && id !== skipId) out.push(id);
            }
            for (const [key, v] of Object.entries((st && st.abilities) || {})) {
                if (v && key !== skipId) out.push(key);
            }
            return out;
        },

        _reachable(allowed) {
            const seen = new Set(['hub']);
            const queue = ['hub'];
            while (queue.length) {
                const u = queue.pop();
                for (const v of this.nbrs(u)) {
                    if (allowed.has(v) && !seen.has(v)) { seen.add(v); queue.push(v); }
                }
            }
            return seen;
        },

        /**
         * Проверка ПКМ/«−»: узел можно закрыть, только если ни один из
         * оставшихся открытых узлов не потеряет связь с центром ('hub').
         */
        _canRemove(st, id) {
            const before = this._reachable(new Set(['hub'].concat(this._openedIds(st))));
            const after = this._reachable(new Set(['hub'].concat(this._openedIds(st, id))));
            for (const other of this._openedIds(st, id)) {
                if (before.has(other) && !after.has(other)) return false;
            }
            return true;
        },

        canOpen(st, id) {
            if (this._isOpen(st, id)) return false;
            return this.nbrs(id).some(nb => this._isOpen(st, nb));
        },

        openedCount(st) {
            const s = st || this.state();
            let n = 0;
            for (const r of Object.values(s.nodes || {})) if (+r > 0) n++;
            for (const v of Object.values(s.abilities || {})) if (v) n++;
            return n;
        },

        /** Молния похода активна, если открыт её узел-хозяин (p.host) либо
         *  смежный узел по ребру 'q'. */
        questActive(st, id) {
            const P = this.mapP();
            const key = String(id).indexOf('q:') === 0 ? String(id) : 'q:' + id;
            const p = P[key];
            if (p && p.host && this._isOpen(st, p.host)) return true;
            for (const e of this.mapE()) {
                if (!e || e[3] !== 'q') continue;
                if (e[0] === key && this._isOpen(st, e[1])) return true;
                if (e[1] === key && this._isOpen(st, e[0])) return true;
            }
            return false;
        },

        /* ------------------------------------------------------------
         * Песочница: состояние класса
         * ---------------------------------------------------------- */
        _blankState() {
            return { nodes: {}, abilities: {}, eq: { ab: '', ult: '' }, up: {} };
        },

        state(cls) {
            const id = cls || this._cls;
            if (!this.sandbox[id]) this.sandbox[id] = this._blankState();
            return this.sandbox[id];
        },

        _snapshot(st) {
            return {
                nodes: Object.assign({}, st.nodes || {}),
                abilities: Object.assign({}, st.abilities || {}),
                eq: { ab: (st.eq && st.eq.ab) || '', ult: (st.eq && st.eq.ult) || '' },
                up: JSON.parse(JSON.stringify(st.up || {}))
            };
        },

        /* ------------------------------------------------------------
         * Стоимость и балансы
         * ---------------------------------------------------------- */
        /** Цена следующей ступени пассивного узла (жетоны ⟡). */
        stepCost(rank) {
            const V = this.skmapCache[this._cls];
            const arr = (V && Array.isArray(V.step) && V.step.length) ? V.step : [3, 4, 5, 6];
            const i = Math.min(arr.length - 1, Math.max(0, (+rank || 1) - 1));
            return +arr[i] || (+rank || 1) + 2;
        },

        /**
         * Лимит очков плана — максимум уровня игры (skillsCache.maxLevel,
         * фолбэк 50 SP). Это НЕ текущий запас героя (skmap.pts): песочница
         * позволяет спланировать билд на весь максимум, а запас героя
         * показывается рядом как справочный ориентир.
         */
        spLimit() {
            const max = +((this.skillsCache && this.skillsCache.maxLevel) || 0);
            return (isFinite(max) && max > 0) ? max : MAX_POINTS;
        },

        spentSP(st) {
            const s = st || this.state();
            let n = 0;
            for (const r of Object.values(s.nodes || {})) if (+r > 0) n++;
            for (const v of Object.values(s.abilities || {})) if (v) n++;
            return n;
        },

        spFree(st) { return Math.max(0, this.spLimit() - this.spentSP(st)); },

        tokenBalance() {
            const V = this.skmapCache[this._cls];
            if (V && isFinite(+V.n)) return Math.max(0, +V.n);
            const ab = this.hero && this.hero.sk && this.hero.sk.ab;
            return ab ? Math.max(0, +ab.n || 0) : 0;
        },

        /** Потрачено жетонов планом: ступени узлов (rank >= 2) + прокачка Арены. */
        tokensSpent(st) {
            const s = st || this.state();
            let sum = 0;
            // Открытие узла — 1 SP; каждая ступень с 1 на 2, с 2 на 3… стоит
            // stepCost(текущий ранг) — ровно как в skillmap.js (plus()).
            for (const [, r] of Object.entries(s.nodes || {})) {
                for (let k = 1; k < (+r || 0); k++) sum += this.stepCost(k);
            }
            for (const [key, up] of Object.entries(s.up || {})) {
                if (!s.abilities[key]) continue;
                for (const [kind] of this.ARENA_KINDS) {
                    const base = kind === 'lv' ? 1 : 0;
                    sum += this._upPathCost(key, kind, base, +((up || {})[kind]) || 0);
                }
            }
            return sum;
        },

        abMax(kind) {
            const V = this.skmapCache[this._cls];
            const m = V && V.ab && V.ab.max;
            const v = m ? +m[kind] : 0;
            return (isFinite(v) && v > 0) ? v : (this.ARENA_KIND_DEFAULT_MAX[kind] || 1);
        },

        _normUp(up) {
            const src = up || {};
            return {
                lv: Math.max(1, +src.lv || 0),
                pow: Math.max(0, +src.pow || 0),
                eff: Math.max(0, +src.eff || 0),
                dur: Math.max(0, +src.dur || 0)
            };
        },

        /** Цена одного шага прокачки: next из /api/skmap у текущего уровня игры,
         *  иначе — фолбэк-шкала ARENA_COST. */
        _stepUpCost(key, kind, from) {
            const meta = this.abOf(key);
            const game = (meta && meta.up) ? (+meta.up[kind] || 0) : 0;
            if (meta && meta.next && +meta.next[kind] > 0 && (+from || 0) === game) return +meta.next[kind];
            const table = this.ARENA_COST[kind] || [];
            // v11.7.1: ступень способности ('lv') начинается с 1, а pow/eff/dur
            // — с 0. Поэтому для 'lv' индекс шкалы = шаг-1, иначе первый шаг
            // (1 -> 2) брал цену второй ступени и завышал план на 1 жетон.
            const idx = kind === 'lv' ? Math.max(0, (+from || 1) - 1) : (+from || 0);
            return +table[idx] || (+from || 0) + 2;
        },

        _upPathCost(key, kind, from, to) {
            let sum = 0;
            for (let v = +from || 0; v < (+to || 0); v++) sum += this._stepUpCost(key, kind, v);
            return sum;
        },

        /* ------------------------------------------------------------
         * Сеть: кэш /api/skills и /api/skmap
         * ---------------------------------------------------------- */
        async ensureSkills(force) {
            if (this.skillsCache && !force) return this.skillsCache;
            const res = await Utils.fetchApi('/api/skills');
            const d = (res && Array.isArray(res.classes)) ? res : (res && res.body) || null;
            if (!d || d.ok === false || !Array.isArray(d.classes)) {
                throw new Error((d && d.error) || (res && res.error) || 'нет данных о навыках');
            }
            this.skillsCache = d;
            return d;
        },

        async ensureSkmap(cls, force) {
            const id = cls || this._cls;
            if (!id) return null;
            if (this.skmapCache[id] && !force) return this.skmapCache[id];
            if (this._skmapPending[id] && !force) return this._skmapPending[id];
            const p = Utils.fetchApi('/api/skmap?cls=' + encodeURIComponent(id)).then((res) => {
                const d = (res && res.cls && res.st) ? res : (res && res.body && res.body.cls ? res.body : null);
                if (!d) throw new Error((res && res.error) || (res && res.body && res.body.error) || 'карта навыков не загрузилась');
                this.skmapCache[id] = d;
                return d;
            }).catch((err) => {
                dbg('[BUILD SIM] skmap:', err);
                throw err;
            }).finally(() => { delete this._skmapPending[id]; });
            this._skmapPending[id] = p;
            return p;
        },

        /* ------------------------------------------------------------
         * Монтирование в HeroPlanner (#hp-buildsim-container)
         * ---------------------------------------------------------- */
        async mount(container) {
            if (!container) return;
            this._root = container;
            this._sel = null;
            this._hover = null;
            this._tab = 'map';
            this._buildIndex = null;
            this._buildName = '';
            this._view = { s: 1, x: 0, y: 0 };
            this.loadSavedBuilds();
            const hash = window.location.hash || '';
            this._hashCode = hash.indexOf('#build=') >= 0 ? this._extractBuildCode(hash) : '';
            container.innerHTML = '<div class="loader">Загрузка созвездия навыков…</div>';
            try {
                await this.ensureSkills();
                if (!this.hero) {
                    const me = await Utils.fetchApi('/api/me');
                    if (me && me.ok && me.hero) this.hero = me.hero;
                }
                if (this._needLegacyMigration) {
                    this._migrateLegacyBuilds();
                    this._needLegacyMigration = false;
                }
                const list = this.classList();
                if (!list.length) throw new Error('карта навыков недоступна (нет map.P)');

                let initial = '';
                if (this._hashCode) {
                    initial = this.decodeBuild(this._hashCode);
                    if (initial) UI.showToast('📥 Билд загружен из ссылки!');
                    else UI.showToast('❌ Неверный формат кода билда', true);
                    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* noop */ }
                }
                const h = this.hero || {};
                const heroCls = h.role || h.class || h.c || (h.sk && h.sk.c) || '';
                const start = initial || (heroCls && list.some(c => c.id === heroCls) ? heroCls : list[0].id);

                this._renderShell();
                this._wire();
                await this.selectClass(start);
            } catch (err) {
                dbg('[BUILD SIM] mount:', err);
                container.innerHTML = `<div class="lgu-skm-error">⚠ ${this.esc(err.message || 'не удалось загрузить карту навыков')}</div>`;
            }
        },

        _renderShell() {
            const root = this._root;
            if (!root) return;
            root.innerHTML = `
                <div class="sim-layout lgu-skm-layout">
                    <div class="sim-sidebar" id="lgu-skm-side"></div>
                    <div class="sim-main-content" id="lgu-skm-main">
                        <div class="sim-top-bar lgu-skm-bar" id="lgu-skm-bar">
                            <div class="lgu-skm-res" title="Очки навыков плана">
                                <em>Очки навыков (SP):</em> <b id="lgu-skm-sp">0</b>
                                <small id="lgu-skm-sp-note"></small>
                            </div>
                            <div class="lgu-skm-res" title="Жетоны навыков, потраченные планом (⟡)">
                                <em>Жетоны (⟡):</em> <b id="lgu-skm-tok">0</b>
                                <small id="lgu-skm-tok-note"></small>
                            </div>
                            <span class="sim-bar-sep"></span>
                            <select id="lgu-skm-build-list" class="lgu-skm-build-list" data-build="select" aria-label="Сохранённые билды"></select>
                            <input id="lgu-skm-build-name" class="sim-save-name" type="text" maxlength="40" placeholder="Название билда" aria-label="Название билда">
                            <button type="button" class="sim-save-btn" data-act="save" title="Сохранить билд">💾</button>
                            <button type="button" class="sim-del-btn" data-act="delete" title="Удалить выбранный билд">🗑️</button>
                            <button type="button" class="sim-share-btn" data-act="share" title="Скопировать ссылку на билд">📤</button>
                            <button type="button" class="sim-import-btn" data-act="import" title="Импорт кода/ссылки">📥</button>
                            <button type="button" class="sim-keep-btn" data-act="reset" title="Сбросить план к состоянию игры">⟲</button>
                        </div>
                        <div class="lgu-skm-hero" id="lgu-skm-hero"></div>
                        <div class="lgu-skm-stage" id="lgu-skm-stage">
                            <div class="lgu-skm-map" id="lgu-skm-map">
                                <svg class="lgu-skm-svg" id="lgu-skm-svg" viewBox="-600 -600 1200 1200" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Созвездие навыков">
                                    <rect class="lgu-skm-bg" x="-600" y="-600" width="1200" height="1200"></rect>
                                    <g id="lgu-skm-world"></g>
                                </svg>
                                <div class="lgu-skm-zoom">
                                    <button type="button" data-act="zoom-in" aria-label="Приблизить">＋</button>
                                    <button type="button" data-act="zoom-out" aria-label="Отдалить">－</button>
                                    <button type="button" data-act="zoom-reset" aria-label="Сбросить вид">⌂</button>
                                </div>
                            </div>
                            <aside class="lgu-skm-inspector" id="lgu-skm-insp"></aside>
                        </div>
                        <div class="lgu-skm-arena" id="lgu-skm-arena"></div>
                        <div class="lgu-skm-summary" id="lgu-skm-summary"></div>
                        <div class="lgu-skm-gear" id="lgu-skm-gear" hidden></div>
                    </div>
                </div>`;
            const q = (s) => root.querySelector(s);
            this._els = {
                side: q('#lgu-skm-side'), main: q('#lgu-skm-main'), bar: q('#lgu-skm-bar'),
                sp: q('#lgu-skm-sp'), spNote: q('#lgu-skm-sp-note'),
                tok: q('#lgu-skm-tok'), tokNote: q('#lgu-skm-tok-note'),
                buildList: q('#lgu-skm-build-list'), name: q('#lgu-skm-build-name'),
                hero: q('#lgu-skm-hero'), stage: q('#lgu-skm-stage'), map: q('#lgu-skm-map'),
                svg: q('#lgu-skm-svg'), world: q('#lgu-skm-world'),
                insp: q('#lgu-skm-insp'), arena: q('#lgu-skm-arena'),
                summary: q('#lgu-skm-summary'), gear: q('#lgu-skm-gear')
            };
            this._wireMap();
        },

        /* ------------------------------------------------------------
         * Выбор класса
         * ---------------------------------------------------------- */
        async selectClass(cls) {
            const list = this.classList();
            if (!cls || !list.some(c => c.id === cls)) return;
            const needGame = !this.sandbox[cls];
            this._cls = cls;
            this._tab = 'map';
            this._sel = null;
            this._hover = null;
            this._view = { s: 1, x: 0, y: 0 };
            this.renderSidebar();
            this.renderHero();
            if (this._els.world) this._els.world.innerHTML = '<text class="lgu-skm-wait" x="0" y="0" text-anchor="middle">Загрузка карты класса…</text>';
            try {
                await this.ensureSkmap(cls);
            } catch (err) {
                if (this._els.world) {
                    this._els.world.innerHTML = `<text class="lgu-skm-wait bad" x="0" y="0" text-anchor="middle">⚠ ${this.esc(err.message || 'карта не загрузилась')}</text>`;
                }
            }
            if (this._cls !== cls) return;
            if (needGame || !this.sandbox[cls]) this.loadFromGame(null, true);
            this._buildIndex = null;
            this._buildName = '';
            this.renderAll();
        },

        /* ------------------------------------------------------------
         * Состояние игры -> песочница
         * ---------------------------------------------------------- */
        loadFromGame(index, silent) {
            const cls = this._cls;
            const V = this.skmapCache[cls];
            if (!V) {
                if (!silent) UI.showToast('Состояние игры ещё не загружено', true);
                return false;
            }
            if (!this.sandbox[cls]) this.sandbox[cls] = this._blankState();
            const st = this.sandbox[cls];

            if (index !== null && index !== undefined) {
                const set = (V.st && Array.isArray(V.st.s)) ? V.st.s[+index] : null;
                if (!set) {
                    if (!silent) UI.showToast('Этот набор пуст', true);
                    return false;
                }
                st.eq = { ab: (set.eq && set.eq.ab) || '', ult: (set.eq && set.eq.ult) || '' };
                const P = this.mapP();
                for (const kind of ['ab', 'ult']) {
                    const key = st.eq[kind];
                    if (key && P[key] && P[key].ab && key.slice(-(kind.length + 1)) === ':' + kind) st.abilities[key] = 1;
                    else st.eq[kind] = '';
                }
                if (!silent) UI.showToast(`📥 Загружен «${set.nm || 'набор'}»`);
            } else {
                const fresh = this._blankState();
                const srcN = (V.st && V.st.n) || {};
                for (const [id, r] of Object.entries(srcN)) {
                    const node = this.nodeOf(id, cls);
                    if (!node || !(+r > 0)) continue;
                    fresh.nodes[id] = Math.max(1, Math.min(+r, +node.max || 1));
                }
                const srcA = (V.st && V.st.a) || {};
                const P = this.clsData(cls).map.P;
                for (const key of Object.keys(srcA)) {
                    if (srcA[key] && P[key] && P[key].ab) fresh.abilities[key] = 1;
                }
                fresh.eq = { ab: (V.st && V.st.eq && V.st.eq.ab) || '', ult: (V.st && V.st.eq && V.st.eq.ult) || '' };
                for (const kind of ['ab', 'ult']) {
                    const key = fresh.eq[kind];
                    if (!key || !P[key] || !fresh.abilities[key]) fresh.eq[kind] = '';
                }
                for (const br of ((V.ab && V.ab.br) || [])) {
                    if (!br || !br.id) continue;
                    if (br.ab) fresh.up[br.id + ':ab'] = this._normUp(br.ab.up);
                    if (br.ult) fresh.up[br.id + ':ult'] = this._normUp(br.ult.up);
                }
                this.sandbox[cls] = fresh;
                if (!silent) UI.showToast('📥 Загружено текущее состояние героя');
            }
            this._buildIndex = null;
            this._buildName = '';
            this._sel = null;
            this.renderAll();
            return true;
        },

        /** Санитизация внешнего билда: неизвестные узлы/ранги/слоты отбрасываем,
         *  «висящие» острова (без связи с hub) удаляем. */
        _sanitizeBuild(cls, data) {
            const st = this._blankState();
            const C = this.clsData(cls);
            if (!C) return st;
            const P = (C.map && C.map.P) || {};
            const src = data || {};
            for (const [id, r] of Object.entries(src.nodes || {})) {
                const o = P[id];
                const node = this.nodeOf(id, cls);
                if (!o || o.ab || o.q || !node) continue;
                const rank = Math.max(1, Math.min(Math.floor(+r) || 0, +node.max || 1));
                if (rank > 0) st.nodes[id] = rank;
            }
            for (const key of Object.keys(src.abilities || {})) {
                const o = P[key];
                if (o && o.ab && src.abilities[key]) st.abilities[key] = 1;
            }
            const eq = src.eq || {};
            for (const kind of ['ab', 'ult']) {
                const key = String(eq[kind] || '');
                if (key && st.abilities[key] && key.slice(-(kind.length + 1)) === ':' + kind) st.eq[kind] = key;
            }
            for (const [key, up] of Object.entries(src.up || {})) {
                if (!st.abilities[key]) continue;
                const kind = key.split(':')[1];
                const max = this._abMaxFor(kind, cls);
                const u = this._normUp(up);
                st.up[key] = {
                    lv: Math.min(max, Math.max(1, u.lv)),
                    pow: Math.min(max, u.pow),
                    eff: Math.min(max, u.eff),
                    dur: Math.min(max, u.dur)
                };
            }
            const prevCls = this._cls;
            this._cls = cls;
            this._fixState(cls, st);
            this._cls = prevCls;
            return st;
        },

        /** Лимит категории прокачки для конкретного класса (до загрузки skmap). */
        _abMaxFor(kind, cls) {
            const V = this.skmapCache[cls || this._cls];
            const m = V && V.ab && V.ab.max;
            const v = m ? +m[kind] : 0;
            return (isFinite(v) && v > 0) ? v : (this.ARENA_KIND_DEFAULT_MAX[kind] || 1);
        },

        /** Удаляет открытые узлы, потерявшие связь с 'hub', и чистит слоты. */
        _fixState(cls, st) {
            const reach = this._reachable(new Set(['hub'].concat(this._openedIds(st))));
            for (const [id, r] of Object.entries(st.nodes || {})) {
                if (+r > 0 && !reach.has(id)) delete st.nodes[id];
            }
            for (const key of Object.keys(st.abilities || {})) {
                if (st.abilities[key] && !reach.has(key)) delete st.abilities[key];
            }
            for (const kind of ['ab', 'ult']) {
                const key = st.eq[kind];
                if (key && (!st.abilities[key] || key.slice(-(kind.length + 1)) !== ':' + kind)) st.eq[kind] = '';
            }
        },

        /* ------------------------------------------------------------
         * Общая перерисовка
         * ---------------------------------------------------------- */
        renderAll() {
            if (!this._root || !this._els.world) return;
            this.renderSidebar();
            this.renderHero();
            this.renderBar();
            this.renderMap();
            this.renderInspector();
            this.renderArena();
            this.renderSummary();
            this.renderGear();
            this._updateVisibility();
        },

        _updateVisibility() {
            const gear = this._tab === 'gear';
            const set = (el, hide) => { if (el) el.hidden = hide; };
            set(this._els.bar, gear);
            set(this._els.hero, gear);
            set(this._els.stage, gear);
            set(this._els.arena, gear);
            set(this._els.summary, gear);
            set(this._els.gear, !gear);
        },

        renderSidebar() {
            const el = this._els.side;
            if (!el) return;
            const list = this.classList();
            let html = `<button type="button" class="modal-tab sim-tab${this._tab === 'gear' ? ' active' : ''}" data-tab="gear">${this.getClassSvg('gear')}Экипировка</button>`;
            html += '<div class="sim-sidebar-sep"></div>';
            for (const c of list) {
                const color = this.classColors[c.id] || '#caa55c';
                const text = this.classTextColors[c.id] || '#12100e';
                const active = this._tab !== 'gear' && c.id === this._cls;
                html += `<button type="button" class="modal-tab sim-tab${active ? ' active' : ''}" data-class="${this.esc(c.id)}" style="--c:${color};--ct:${text}">${this.getClassSvg(c.id)}${this.esc(this.classNames[c.id] || c.name || c.id)}</button>`;
            }
            el.innerHTML = html;
        },

        renderHero() {
            const el = this._els.hero;
            if (!el) return;
            const C = this.clsData();
            const V = this.skmapCache[this._cls] || {};
            const h = this.hero || {};
            const name = h.name || (G.ME && G.ME.user && (G.ME.user.name || G.ME.user.login)) || 'Игрок';
            const lvl = h.lvl || h.level || h.l || (V.lvl || 1);
            const clsName = this.classNames[this._cls] || (C && C.name) || this._cls;
            const opened = this.openedCount();
            const classOpen = +(V.classOpen || 0);
            // classOpen — ПОРОГ открытия умения класса, а не лимит очков:
            // пока порог не взят, показываем прогресс; после — строго
            // «открыто», без дроби (7/3): перебора здесь быть не может.
            const hubOn = classOpen > 0 && opened >= classOpen;
            const hubPill = hubOn
                ? `<span class="lgu-skm-pill hub-on status" title="Порог ${classOpen} открытых узлов класса пройден">✦ Умение класса открыто</span>`
                : `<span class="lgu-skm-pill status" title="Нужно открыть узлов класса: ${classOpen || '—'}">До умения класса: ${opened} / ${classOpen || '—'}</span>`;
            el.innerHTML = `
                <span class="lgu-skm-avat" style="--c:${(C && C.color) || this.classColors[this._cls] || '#ffd24a'}">${this.getClassSvg(this._cls)}</span>
                <span class="lgu-skm-who"><b>${this.esc(name)}</b><small>${this.esc(clsName)} · ${this.esc(lvl)} ур.</small></span>
                ${hubPill}`;
        },

        renderBar() {
            const E = this._els;
            if (!E.sp || !this._els.world) return;
            const st = this.state();
            const V = this.skmapCache[this._cls] || {};
            const sp = this.spentSP(st);
            const limit = this.spLimit();
            E.sp.textContent = String(sp);
            // Перелимит — только выход за максимум уровня игры. Запас героя
            // (skmap.pts) ниже этого максимума — норма, а не ошибка билда.
            E.sp.classList.toggle('over', sp > limit);
            const heroPts = +(V.pts || (this.hero && this.hero.pts) || 0);
            E.spNote.textContent = `/ ${limit}${heroPts > 0 ? ` · у героя: ${heroPts}` : ''}`;
            E.sp.title = `План: ${sp} из ${limit} SP (максимум уровня игры)`
                + (heroPts > 0 ? ` · у героя сейчас ${heroPts} SP` : '');

            // Жёсткого лимита жетонов в планировщике НЕТ: остаток героя
            // (skmap.n) показываем рядом как справочный ориентир — точно так же,
            // как «у героя: N» у очков навыков. Поэтому .over здесь не ставим:
            // план дороже текущего запаса — не ошибка, а «докупить жетоны».
            const tok = this.tokensSpent(st);
            const heroTok = this.tokenBalance();
            E.tok.textContent = String(tok);
            E.tok.classList.remove('over');
            E.tokNote.textContent = `· у героя: ${heroTok}`;
            E.tok.title = 'Потрачено жетонов планом: ступени пассивных узлов + прокачка способностей Арены'
                + (heroTok > 0 ? ` · у героя сейчас ${heroTok} ⟡` : '');

            const list = this.savedBuilds[this._cls] || [];
            if (E.buildList) {
                E.buildList.innerHTML = '<option value="">— сохранённые билды —</option>'
                    + list.map((b, i) => `<option value="${i}">${this.esc(b.name)}</option>`).join('');
                E.buildList.value = (this._buildIndex !== null && list[this._buildIndex]) ? String(this._buildIndex) : '';
            }
            if (E.name && document.activeElement !== E.name) E.name.value = this._buildName || '';
        },

        /* ------------------------------------------------------------
         * SVG-карта созвездия
         * ---------------------------------------------------------- */
        /** Рёбра: открытая связь — яркая, доступная — пунктир, прочая — тусклая. */
        _mapEdges(st, C) {
            const P = C.map.P;
            const pt = (id) => id === 'hub' ? { x: 0, y: 0 } : P[id];
            let out = '';
            for (const e of (Array.isArray(C.map.E) ? C.map.E : [])) {
                if (!e || e.length < 2) continue;
                const a = e[0], b = e[1], bi = +e[2] || 0, q = e[3] === 'q';
                const A = pt(a), B = pt(b);
                if (!A || !B) continue;
                let state = '';
                if (q) state = this.questActive(st, b) ? ' on' : '';
                else if (this._isOpen(st, a) && this._isOpen(st, b)) state = ' on';
                else if ((this._isOpen(st, a) && this.canOpen(st, b)) || (this._isOpen(st, b) && this.canOpen(st, a))) state = ' avail';
                out += `<line class="lgu-skm-edge${state}${q ? ' q' : ''}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" style="--bc:${this.branchColor(bi)}"></line>`;
            }
            return out;
        },

        /** Центр: подсвечен, когда открыто >= classOpen узлов класса.
         *  classOpen — порог (а не лимит очков), поэтому после порога
         *  вместо дроби «5/3» рисуем «✦»: перебора здесь быть не может. */
        _mapHub(st, C, V) {
            const classOpen = +(V.classOpen || 0);
            const opened = this.openedCount(st);
            const on = classOpen > 0 && opened >= classOpen;
            const label = on ? '✦' : `${opened}/${classOpen || '—'}`;
            return `<g class="lgu-skm-hub${on ? ' on' : ''}${this._sel === 'hub' ? ' sel' : ''}" data-hub="1" style="--c:${this.esc(C.color || '#ffd24a')}">
                    <circle r="36"></circle>
                    ${this._iconMarkup(this.CLASS_ICONS[this._cls] || 'diam', 40)}
                    <text class="lgu-skm-hubcnt" y="60" text-anchor="middle">${label}</text>
                </g>`;
        },

        /** Узлы: круги пассивов, ромбы способностей, капсулы молний. */
        _mapNodes(st, C) {
            const P = C.map.P;
            let out = '';
            for (const [id, o] of Object.entries(P)) {
                if (!o) continue;
                const x = +o.x, y = +o.y;
                if (!isFinite(x) || !isFinite(y)) continue;
                const bc = this.esc(this.branchColor(+o.bi || 0));

                if (o.q) {
                    const on = this.questActive(st, id);
                    const qid = String(o.q || id).replace(/^q:/, '');
                    const act = ((C.actions || []).find(a => a && a.id === qid)) || null;
                    out += `<g class="lgu-skm-q${on ? ' on' : ''}" data-q="${this.esc(qid)}" transform="translate(${x},${y})">
                        <title>${this.esc(act ? `⚡ ${act.name || act.word || qid}: ${act.text || ''}` : '⚡ Умение похода')}</title>
                        <rect x="-16" y="-14" width="32" height="28" rx="14"></rect>
                        <text y="6" text-anchor="middle">⚡</text>
                    </g>`;
                    continue;
                }

                if (o.ab) {
                    const key = id;
                    const meta = this.abOf(key) || {};
                    const opened = !!st.abilities[key];
                    const equipped = st.eq.ab === key || st.eq.ult === key;
                    const can = this.canOpen(st, key);
                    const kind = key.split(':')[1];
                    const lv = opened ? ((st.up[key] && st.up[key].lv) || 1) : 0;
                    out += `<g class="lgu-skm-ab${opened ? ' has' : ''}${equipped ? ' eq' : ''}${can ? ' can' : ''}${this._sel === key ? ' sel' : ''}" data-ab="${this.esc(key)}" transform="translate(${x},${y})" style="--bc:${bc}">
                        <title>${this.esc(`${meta.name || key} · ${kind === 'ab' ? 'способность (3-й ход)' : 'ульта (5-й ход)'}`)}</title>
                        <rect class="shape" x="-21" y="-21" width="42" height="42" rx="7" transform="rotate(45)"></rect>
                        <text class="glyph" y="7" text-anchor="middle">${this.esc(meta.icon || (kind === 'ult' ? '★' : '◆'))}</text>
                        ${opened ? `<text class="badge" y="38" text-anchor="middle">${lv}</text>` : ''}
                    </g>`;
                    continue;
                }

                const node = this.nodeOf(id);
                if (!node) continue;
                const max = Math.max(1, +node.max || 1);
                const rank = Math.min(max, +st.nodes[id] || 0);
                const can = !rank && this.canOpen(st, id);
                const branch = this.branchOf(id);
                const cap = node.kind === 'cap';
                const rr = cap ? 28 : 24;
                out += `<g class="lgu-skm-node${rank ? ' has' : ''}${can ? ' can' : ''}${cap ? ' cap' : ''}${this._sel === id ? ' sel' : ''}" data-node="${this.esc(id)}" transform="translate(${x},${y})" style="--bc:${bc}">
                    <title>${this.esc(`${node.name}${rank ? ` · ${rank}/${max}` : ''}`)}</title>
                    <circle r="${rr}"></circle>
                    ${this._iconMarkup(this.iconKeyOf(node, branch), cap ? 28 : 24)}
                    <text class="rank" y="${rr + 15}" text-anchor="middle">${rank}/${max}</text>
                </g>`;
            }
            return out;
        },

        /** Подписи веток на радиусе R = 450, углы [-90, 30, 150]. */
        _mapLabels(st, C) {
            const ANG = [-90, 30, 150];
            let out = '';
            (C.branches || []).slice(0, 3).forEach((B, bi) => {
                const a = ANG[bi] * Math.PI / 180;
                const x = Math.round(Math.cos(a) * 450);
                const y = Math.round(Math.sin(a) * 450 + (Math.sin(a) < 0 ? -62 : 62));
                const total = (B.nodes || []).length;
                const done = (B.nodes || []).filter(n => this._isOpen(st, n.id)).length;
                out += `<g class="lgu-skm-blab" transform="translate(${x},${y})" style="--bc:${this.esc(this.branchColor(bi))}">
                    <text text-anchor="middle"><tspan class="nm">${this.esc(B.name || B.id)}</tspan><tspan class="cnt" x="0" dy="18">${done}/${total}</tspan></text>
                </g>`;
            });
            return out;
        },

        renderMap() {
            const world = this._els.world;
            if (!world) return;
            const C = this.clsData();
            if (!C || !C.map || !C.map.P) {
                world.innerHTML = '<text class="lgu-skm-wait bad" x="0" y="0" text-anchor="middle">Карта этого класса пока не готова</text>';
                return;
            }
            const st = this.state();
            const V = this.skmapCache[this._cls] || {};
            world.innerHTML = this._mapEdges(st, C)
                + this._mapHub(st, C, V)
                + this._mapNodes(st, C)
                + this._mapLabels(st, C);
            this._applyView();
        },

        /* ------------------------------------------------------------
         * Зум/пан карты
         * ---------------------------------------------------------- */
        _applyView() {
            const world = this._els.world;
            if (!world) return;
            const v = this._view;
            world.setAttribute('transform', `translate(${v.x.toFixed(2)} ${v.y.toFixed(2)}) scale(${v.s.toFixed(4)})`);
        },

        resetView() {
            this._view = { s: 1, x: 0, y: 0 };
            this._applyView();
        },

        /** Координаты курсора -> система viewBox (с учётом текущего transform). */
        _toWorld(clientX, clientY) {
            const svg = this._els.svg;
            if (!svg || typeof svg.createSVGPoint !== 'function') return { x: 0, y: 0 };
            const pt = svg.createSVGPoint();
            pt.x = clientX;
            pt.y = clientY;
            const m = svg.getScreenCTM();
            if (!m) return { x: 0, y: 0 };
            const p = pt.matrixTransform(m.inverse());
            return { x: (p.x - this._view.x) / this._view.s, y: (p.y - this._view.y) / this._view.s };
        },

        zoomAt(factor, clientX, clientY) {
            const svg = this._els.svg;
            if (!svg) return;
            let cx = clientX, cy = clientY;
            if (cx == null || cy == null) {
                const r = svg.getBoundingClientRect();
                cx = r.left + r.width / 2;
                cy = r.top + r.height / 2;
            }
            const p = this._toWorld(cx, cy);
            const s0 = this._view.s;
            const s1 = Math.min(3, Math.max(0.35, s0 * factor));
            this._view.x += p.x * (s0 - s1);
            this._view.y += p.y * (s0 - s1);
            this._view.s = s1;
            this._applyView();
        },

        _wireMap() {
            const map = this._els.map;
            if (!map || map.__lguSkmWired) return;
            map.__lguSkmWired = true;

            map.addEventListener('wheel', (e) => {
                // Зум колесом — ТОЛЬКО над самой картой созвездия. Над кнопками
                // масштаба и вне SVG колесо не перехватываем: там оно должно
                // прокручивать вкладку к «Навыкам Арены» и сводке статов.
                if (!e.deltaY) return;
                if (e.target.closest && e.target.closest('.lgu-skm-zoom')) return;
                const svg = this._els.svg;
                if (!svg || (e.target !== svg && !(e.target.closest && e.target.closest('#lgu-skm-svg')))) return;
                e.preventDefault();
                this.zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY);
            }, { passive: false });

            map.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                if (e.target.closest && e.target.closest('[data-node],[data-ab],[data-hub],button')) return;
                const r = this._els.svg.getBoundingClientRect();
                this._pan = {
                    id: e.pointerId, x: e.clientX, y: e.clientY,
                    vx: this._view.x, vy: this._view.y, s: this._view.s,
                    k: (Math.min(r.width, r.height) / 1200) || 1
                };
                map.classList.add('dragging');
                try { map.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
            });

            map.addEventListener('pointermove', (e) => {
                const p = this._pan;
                if (!p || p.id !== e.pointerId) return;
                this._view.x = p.vx + (e.clientX - p.x) / (p.k * p.s);
                this._view.y = p.vy + (e.clientY - p.y) / (p.k * p.s);
                this._applyView();
            });

            const stopPan = (e) => {
                if (!this._pan || this._pan.id !== e.pointerId) return;
                this._pan = null;
                map.classList.remove('dragging');
                try { map.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
            };
            map.addEventListener('pointerup', stopPan);
            map.addEventListener('pointercancel', stopPan);
        },

        /* ------------------------------------------------------------
         * Делегирование событий внутри оболочки
         * ---------------------------------------------------------- */
        _wire() {
            const root = this._root;
            if (!root || root.__lguSkmWired) return;
            root.__lguSkmWired = true;

            root.addEventListener('click', (e) => {
                const t = e.target;
                if (!t || !t.closest) return;

                const clsBtn = t.closest('[data-class]');
                if (clsBtn) { this.selectClass(clsBtn.dataset.class); return; }
                if (t.closest('[data-tab="gear"]')) {
                    this._tab = 'gear';
                    this.renderSidebar();
                    this._updateVisibility();
                    this.renderGear();
                    return;
                }

                const act = t.closest('[data-act]');
                if (act) { this._onAction(act.dataset.act, act.dataset); return; }
                if (t.closest('.lgu-skm-inspector')) return;

                const ab = t.closest('[data-ab]');
                if (ab) { this._onAbilityClick(ab.dataset.ab); return; }
                const nd = t.closest('[data-node]');
                if (nd) { this._onNodeClick(nd.dataset.node); return; }
                if (t.closest('[data-hub]')) {
                    this._sel = this._sel === 'hub' ? null : 'hub';
                    this.renderMap();
                    this.renderInspector();
                    return;
                }
                if (t.closest('.lgu-skm-map')) {
                    this._sel = null;
                    this.renderMap();
                    this.renderInspector();
                }
            });

            root.addEventListener('contextmenu', (e) => {
                const t = e.target;
                const unit = t && t.closest && t.closest('[data-ab],[data-node]');
                if (!unit) return;
                e.preventDefault();
                this._closeUnit(unit.dataset.ab || unit.dataset.node);
            });

            root.addEventListener('change', (e) => {
                const t = e.target;
                if (!t || !t.dataset) return;
                if (t.dataset.build === 'select') { this.loadBuild(+t.value); return; }
                if (t.dataset.eqSlot) {
                    const slot = t.dataset.eqSlot;
                    const st = this.state();
                    const key = t.value || '';
                    st.eq[slot] = (key && st.abilities[key]) ? key : '';
                    this.renderMap();
                    this.renderArena();
                    this.renderInspector();
                }
            });

            root.addEventListener('input', (e) => {
                const t = e.target;
                if (t && t.id === 'lgu-skm-build-name') this._buildName = t.value;
            });

            root.addEventListener('mouseover', (e) => {
                const t = e.target;
                if (!t || !t.closest || t.closest('.lgu-skm-inspector')) return;
                const u = t.closest('[data-node],[data-ab],[data-hub]');
                if (!u) return;
                const id = u.dataset.node || u.dataset.ab || (u.dataset.hub ? 'hub' : '');
                if (!id || this._hover === id) return;
                this._hover = id;
                this.renderInspector();
            });

            root.addEventListener('mouseout', (e) => {
                const t = e.target;
                if (!t || !t.closest) return;
                const u = t.closest('[data-node],[data-ab],[data-hub]');
                if (!u) return;
                if (e.relatedTarget && u.contains(e.relatedTarget)) return;
                const id = u.dataset.node || u.dataset.ab || (u.dataset.hub ? 'hub' : '');
                if (this._hover === id) {
                    this._hover = null;
                    this.renderInspector();
                }
            });
        },

        _onAction(act, ds) {
            switch (act) {
                case 'zoom-in': this.zoomAt(1.2); break;
                case 'zoom-out': this.zoomAt(1 / 1.2); break;
                case 'zoom-reset': this.resetView(); break;
                case 'plus': this._openOrStep(ds.id); break;
                case 'minus': this._closeUnit(ds.id); break;
                case 'equip': this._equip(ds.id); break;
                case 'sel-clear': this._sel = null; this.renderMap(); this.renderInspector(); break;
                case 'save': this.saveCurrentBuild(this._cls, this._buildName); break;
                case 'delete': this.deleteSelectedBuild(); break;
                case 'share': this.shareBuild(this._cls); break;
                case 'import': this.importBuild(); break;
                case 'reset': this.resetSandbox(); break;
                case 'load-game': this.loadFromGame(null); break;
                case 'load-set': this.loadFromGame(+ds.i); break;
                case 'up-plus': this._bumpUp(ds.key, ds.kind, 1); break;
                case 'up-minus': this._bumpUp(ds.key, ds.kind, -1); break;
                default: break;
            }
        },

        _onNodeClick(id) {
            const o = this.mapP()[id];
            if (!o || o.q) return;
            this._sel = id;
            this._openOrStep(id);
        },

        _onAbilityClick(key) {
            const st = this.state();
            this._sel = key;
            if (!this._isOpen(st, key)) this._openAbility(key);
            else this._equip(key);
        },

        /** ЛКМ по узлу: закрытый — открыть (1 SP), открытый — ступень (+1 ⟡). */
        _openOrStep(id) {
            const st = this.state();
            const o = this.mapP()[id];
            if (!o || o.q) return;
            if (o.ab) { this._openAbility(id); return; }
            const node = this.nodeOf(id);
            if (!node) return;
            const max = Math.max(1, +node.max || 1);
            const rank = +st.nodes[id] || 0;

            if (rank <= 0) {
                if (this.spFree(st) <= 0) {
                    UI.showToast('Свободных очков навыков нет', true);
                    this.renderInspector();
                    return;
                }
                if (!this.nbrs(id).some(nb => this._isOpen(st, nb))) {
                    UI.showToast('Узел не соединён с открытым — начните с соседнего', true);
                    this.renderInspector();
                    return;
                }
                st.nodes[id] = 1;
            } else if (rank < max) {
                const cost = this.stepCost(rank);
                if (this.tokensSpent(st) + cost > this.tokenBalance()) {
                    UI.showToast(`План превышает баланс жетонов: +${cost} ⟡`, true);
                }
                st.nodes[id] = rank + 1;
            } else {
                UI.showToast('Узел уже на максимуме');
                this.renderInspector();
                return;
            }
            this.renderAll();
        },

        /** Открытие ромба способности Арены (1 SP) + автогнездо. */
        _openAbility(key) {
            const st = this.state();
            if (this._isOpen(st, key)) return;
            if (this.spFree(st) <= 0) {
                UI.showToast('Свободных очков навыков нет', true);
                this.renderInspector();
                return;
            }
            if (!this.nbrs(key).some(nb => this._isOpen(st, nb))) {
                UI.showToast('Способность не соединена с открытым узлом', true);
                this.renderInspector();
                return;
            }
            st.abilities[key] = 1;
            const kind = String(key).split(':')[1];
            const meta = this.abOf(key);
            if ((kind === 'ab' || kind === 'ult') && !st.eq[kind]) st.eq[kind] = key;
            if (!st.up[key]) st.up[key] = this._normUp(meta && meta.up);
            this.renderAll();
        },

        _equip(key) {
            const st = this.state();
            if (!st.abilities[key]) return;
            const kind = String(key).split(':')[1];
            if (kind !== 'ab' && kind !== 'ult') return;
            st.eq[kind] = st.eq[kind] === key ? '' : key;
            this.renderMap();
            this.renderArena();
            this.renderInspector();
        },

        /** ПКМ / «−»: ступень вниз, а с rank 1 — закрытие с проверкой связности. */
        _closeUnit(id) {
            const st = this.state();
            const o = this.mapP()[id];
            if (!o || o.q) return;
            if (o.ab) {
                if (!st.abilities[id]) return;
                if (!this._canRemove(st, id)) {
                    UI.showToast('Нельзя закрыть: останутся узлы без связи с центром', true);
                    return;
                }
                delete st.abilities[id];
                if (st.eq.ab === id) st.eq.ab = '';
                if (st.eq.ult === id) st.eq.ult = '';
                this.renderAll();
                return;
            }
            const rank = +st.nodes[id] || 0;
            if (!rank) return;
            if (rank > 1) { st.nodes[id] = rank - 1; this.renderAll(); return; }
            if (!this._canRemove(st, id)) {
                UI.showToast('Нельзя закрыть: останутся узлы без связи с центром', true);
                return;
            }
            delete st.nodes[id];
            this.renderAll();
        },

        _bumpUp(key, kind, delta) {
            const st = this.state();
            if (!st.abilities[key] || !kind) return;
            const max = this.abMax(kind);
            const meta = this.abOf(key);
            const u = st.up[key] || (st.up[key] = this._normUp(meta && meta.up));
            const cur = +u[kind] || 0;
            const floor = kind === 'lv' ? 1 : 0;
            const next = Math.max(floor, Math.min(max, cur + delta));
            if (next === cur) return;
            if (delta > 0) {
                const cost = this._stepUpCost(key, kind, cur);
                UI.showToast(`⟡ ${cost} — шаг плана (жетоны не тратятся)`);
            }
            u[kind] = next;
            this.renderArena();
            this.renderBar();
            this.renderSummary();
        },

        resetSandbox() {
            const cls = this._cls;
            if (!cls) return;
            this.sandbox[cls] = this._blankState();
            if (this.skmapCache[cls]) this.loadFromGame(null, true);
            this._sel = null;
            this._buildIndex = null;
            this._buildName = '';
            this.renderAll();
            UI.showToast('⟲ План сброшен к состоянию игры');
        },

        /* ------------------------------------------------------------
         * Инспектор узла/способности/центра
         * ---------------------------------------------------------- */
        renderInspector() {
            const el = this._els.insp;
            if (!el) return;
            const id = this._sel || this._hover;
            const C = this.clsData();
            const st = this.state();
            const V = this.skmapCache[this._cls] || {};
            const head = (title, sub) => `<div class="lgu-skm-ins-head"><b>${this.esc(title)}</b><small>${this.esc(sub || '')}</small>${this._sel ? '<button type="button" class="lgu-skm-ins-x" data-act="sel-clear" aria-label="Закрыть">✕</button>' : ''}</div>`;

            if (!id) {
                el.innerHTML = `<div class="lgu-skm-hint">
                    <b>Как читать созвездие</b>
                    <p><i class="dot"></i>Круг — пассивный навык: работает и в походе, и на Арене.</p>
                    <p><i class="diamond"></i>Ромб — способность Арены (3-й или 5-й ход).</p>
                    <p><i class="bolt">⚡</i>Молния — умение похода у узла-хозяина.</p>
                    <p>ЛКМ — открыть/усилить, ПКМ — ступень вниз или закрыть.</p>
                    <p class="muted">Изменения в игру не отправляются.</p>
                </div>`;
                return;
            }

            if (id === 'hub') {
                const act = ((C && C.actions) || []).find(a => a && a.unlock && a.unlock.mastery != null) || null;
                const need = +(V.classOpen || 0);
                const opened = this.openedCount(st);
                const on = need > 0 && opened >= need;
                // classOpen — порог открытия, лимита очков в игре нет, поэтому
                // после порога показываем «открыто», а не дробь «5/3».
                const progress = on
                    ? `Порог ${need} пройден · открыто узлов: <b>${opened}</b>`
                    : `Прогресс: <b>${opened}</b> / ${need || '—'}`;
                el.innerHTML = `<div class="lgu-skm-ins hub">
                    ${head(this.classNames[this._cls] || (C && C.name) || this._cls, 'Центральное умение класса')}
                    <div class="lgu-skm-ins-kind">${on ? '✅ умение открыто' : `🔒 нужно открытых узлов: ${need || '—'}`}</div>
                    <div class="lgu-skm-ins-rank">${progress}</div>
                    <p class="lgu-skm-ins-fx">${this.esc(act ? (act.text || '') : 'Умение класса открывается по мере изучения созвездия.')}</p>
                    ${(act && need > 0) ? `<div class="lgu-skm-ins-cost">Стоимость: <b>бесплатно</b> после ${need} узлов</div>` : ''}
                </div>`;
                return;
            }

            const o = this.mapP()[id];
            if (!o) {
                el.innerHTML = `<div class="lgu-skm-ins">${head('Узел не найден', 'Карта класса обновилась')}</div>`;
                return;
            }

            if (o.q) {
                const qid = String(o.q || id).replace(/^q:/, '');
                const act = ((C && C.actions) || []).find(a => a && a.id === qid) || null;
                const on = this.questActive(st, id);
                const host = (this.mapP()[id] || {}).host;
                const hostNode = host ? this.nodeOf(host) : null;
                el.innerHTML = `<div class="lgu-skm-ins q">
                    ${head(act ? `⚡ ${act.name || act.word || qid}` : `⚡ ${qid}`, 'Умение похода')}
                    <div class="lgu-skm-ins-kind">${on ? 'Активно' : 'Не активно'}${hostNode ? ` · хозяин: ${this.esc(hostNode.name)}` : ''}</div>
                    <p class="lgu-skm-ins-fx">${this.esc(act ? (act.text || '') : 'Дополнительное действие героя в походе.')}</p>
                    <p class="lgu-skm-ins-next">Молния загорается автоматически, когда открыт узел-хозяин.</p>
                </div>`;
                return;
            }

            if (o.ab) {
                const kind = String(id).split(':')[1];
                const meta = this.abOf(id) || {};
                const bi = this.branchIndex(String(id).split(':')[0]);
                const bc = this.branchColor(bi);
                const opened = !!st.abilities[id];
                const equipped = st.eq[kind] === id;
                const can = this.canOpen(st, id);
                const up = st.up[id] || this._normUp(meta.up);
                const max = this.abMax('lv');
                const lvl = Math.min(max, +up.lv || 1);
                const costNext = opened && lvl < max ? this._stepUpCost(id, 'lv', lvl) : 0;
                const need = kind === 'ult' ? +(V.ab && V.ab.ultLvl) : +(V.ab && V.ab.abLvl);
                const heroLvl = +(V.lvl || 0);
                const nodeList = (meta.nodes && typeof meta.nodes === 'object')
                    ? `<ul class="lgu-skm-ins-nodes">${this.ARENA_KINDS.map(([k, label]) => `<li><span>${label}</span><b>${this.esc(meta.nodes[k] || '—')}</b></li>`).join('')}</ul>`
                    : '';
                el.innerHTML = `<div class="lgu-skm-ins ab" style="--bc:${bc}">
                    ${head(meta.name || id, kind === 'ab' ? 'Способность · 3-й ход' : 'Ульта · 5-й ход')}
                    <div class="lgu-skm-ins-kind">Ромб · ${opened ? `ступень ${lvl}` : 'не открыта'}${equipped ? ' · в гнезде' : ''}</div>
                    <p class="lgu-skm-ins-fx">${this.esc(meta.text || 'Способность Арены.')}</p>
                    ${need && heroLvl && heroLvl < need ? `<p class="lgu-skm-ins-next warn">В бою сработает с ${need} уровня героя (сейчас ${heroLvl}).</p>` : ''}
                    ${nodeList}
                    <div class="lgu-skm-ins-cost">${opened ? (costNext ? `Ступень ${lvl + 1}: <b>${costNext} ⟡</b>` : 'Прокачка на максимуме') : 'Открыть: <b>1 SP</b>'}</div>
                    <div class="lgu-skm-ins-btns">
                        <button type="button" class="lgu-skm-btn main" data-act="plus" data-id="${this.esc(id)}"${(!opened && !can) ? ' disabled' : ''}>${opened ? '+' : 'Открыть'}</button>
                        <button type="button" class="lgu-skm-btn" data-act="equip" data-id="${this.esc(id)}"${opened ? '' : ' disabled'}>${equipped ? 'Убрать из гнезда' : 'В слот Арены'}</button>
                        <button type="button" class="lgu-skm-btn danger" data-act="minus" data-id="${this.esc(id)}"${opened ? '' : ' disabled'}>${opened ? '−' : 'Закрыть'}</button>
                    </div>
                    ${(!opened && !can) ? '<p class="lgu-skm-ins-next">Сначала откройте соседний узел, соединённый линией.</p>' : ''}
                </div>`;
                return;
            }

            const node = this.nodeOf(id);
            if (!node) {
                el.innerHTML = `<div class="lgu-skm-ins">${head('Узел не найден', 'Карта класса обновилась')}</div>`;
                return;
            }
            const branch = this.branchOf(id);
            const bi = branch ? (C.branches || []).indexOf(branch) : 0;
            const bc = this.branchColor(bi);
            const max = Math.max(1, +node.max || 1);
            const rank = Math.min(max, +st.nodes[id] || 0);
            const can = !rank && this.canOpen(st, id);
            const curText = this.formatNodeText(node, Math.max(1, rank));
            const nextText = rank < max ? this.formatNodeText(node, rank + 1) : '';
            const noSp = !rank && this.spFree(st) <= 0;
            el.innerHTML = `<div class="lgu-skm-ins nd" style="--bc:${bc}">
                ${head(node.name || id, branch ? branch.name : 'Ветка')}
                <div class="lgu-skm-ins-kind">Круг · пассивный навык${node.kind === 'cap' ? ' · вершина ветки' : ''}</div>
                <div class="lgu-skm-ins-rank">Ступень <b>${rank}</b> из ${max}</div>
                <p class="lgu-skm-ins-fx">${this.esc(curText || 'Постоянный бонус героя.')}</p>
                ${(nextText && nextText !== curText) ? `<p class="lgu-skm-ins-next">Следующая ступень: ${this.esc(nextText)}</p>` : ''}
                <div class="lgu-skm-ins-cost">${rank ? (rank < max ? `Ступень ${rank + 1}: <b>${this.stepCost(rank)} ⟡</b>` : 'Максимальная ступень') : 'Открыть: <b>1 SP</b>'}</div>
                <div class="lgu-skm-ins-btns">
                    <button type="button" class="lgu-skm-btn main" data-act="plus" data-id="${this.esc(id)}"${(!rank && (!can || noSp)) || rank >= max ? ' disabled' : ''}>${rank ? '+' : 'Открыть'}</button>
                    <button type="button" class="lgu-skm-btn danger" data-act="minus" data-id="${this.esc(id)}"${rank ? '' : ' disabled'}>${rank > 1 ? '−' : 'Закрыть'}</button>
                </div>
                ${(!rank && !can) ? '<p class="lgu-skm-ins-next">Сначала откройте соседний узел, соединённый линией.</p>' : ''}
                ${noSp ? '<p class="lgu-skm-ins-next warn">Свободных очков навыков нет.</p>' : ''}
            </div>`;
        },

        /* ------------------------------------------------------------
         * Блок «Навыки Арены»: два гнезда + прокачка параметров
         * ---------------------------------------------------------- */
        renderArena() {
            const el = this._els.arena;
            if (!el) return;
            const st = this.state();
            const V = this.skmapCache[this._cls] || {};
            const keys = Object.keys(st.abilities || {}).filter(k => st.abilities[k]);
            const byKind = (kind) => keys.filter(k => k.slice(-(kind.length + 1)) === ':' + kind);

            const options = (kind) => '<option value="">— пусто —</option>' + byKind(kind).map((k) => {
                const m = this.abOf(k) || {};
                return `<option value="${this.esc(k)}"${st.eq[kind] === k ? ' selected' : ''}>${this.esc(m.name || k)}</option>`;
            }).join('');

            const slot = (kind) => {
                const key = st.eq[kind] || '';
                const meta = key ? (this.abOf(key) || {}) : null;
                const up = key ? (st.up[key] || this._normUp(meta && meta.up)) : null;
                const bc = key ? this.branchColor(this.branchIndex(key.split(':')[0])) : '#6b6478';
                return `<div class="lgu-skm-slot${key ? '' : ' empty'}" style="--bc:${bc}">
                    <span class="lgu-skm-slot-k">${kind === 'ab' ? 'Способность (3-й ход)' : 'Ульта (5-й ход)'}</span>
                    <select data-eq-slot="${kind}" aria-label="${kind === 'ab' ? 'Способность 3-го хода' : 'Ульта 5-го хода'}">${options(kind)}</select>
                    <div class="lgu-skm-slot-meta">${key
                        ? `<b>${this.esc(meta.name || key)}</b>${up ? `<em>Ступень ${up.lv} · Мощь ${up.pow} · Эффект ${up.eff} · Длит. ${up.dur}</em>` : ''}`
                        : '<small>Гнездо пусто — откройте ромб на карте.</small>'}</div>
                </div>`;
            };

            let ups = '';
            for (const key of keys) {
                const meta = this.abOf(key) || {};
                if (!st.up[key]) st.up[key] = this._normUp(meta.up);
                const u = st.up[key];
                const kind = key.split(':')[1];
                const rows = this.ARENA_KINDS.map(([k, label]) => {
                    const max = this.abMax(k);
                    const val = +u[k] || 0;
                    const cost = val < max ? this._stepUpCost(key, k, val) : 0;
                    const floor = k === 'lv' ? 1 : 0;
                    return `<div class="lgu-skm-up-row">
                        <span>${label}</span>
                        <button type="button" class="lgu-skm-mini" data-act="up-minus" data-key="${this.esc(key)}" data-kind="${k}"${val <= floor ? ' disabled' : ''} aria-label="Уменьшить ${label}">−</button>
                        <b>${val}</b><small>/ ${max}</small>
                        <button type="button" class="lgu-skm-mini" data-act="up-plus" data-key="${this.esc(key)}" data-kind="${k}"${val >= max ? ' disabled' : ''} aria-label="Увеличить ${label}">+</button>
                        <em>${cost ? cost + ' ⟡' : '—'}</em>
                    </div>`;
                }).join('');
                ups += `<details class="lgu-skm-up"${(st.eq.ab === key || st.eq.ult === key) ? ' open' : ''}>
                    <summary>${this.esc(meta.name || key)} <small>${kind === 'ab' ? '3-й ход' : '5-й ход'}</small></summary>
                    <div class="lgu-skm-up-rows">${rows}</div>
                </details>`;
            }

            const sets = (V.st && Array.isArray(V.st.s)) ? V.st.s : [];
            const setBtns = sets.slice(0, 3).map((s, i) => {
                const nm = (s && s.nm) || ('Набор ' + (i + 1));
                const eq = (s && s.eq) || {};
                const tip = [eq.ab ? (this.abOf(eq.ab) || {}).name : '', eq.ult ? (this.abOf(eq.ult) || {}).name : '']
                    .filter(Boolean).join(' + ') || 'набор пуст';
                return `<button type="button" class="lgu-skm-loadbtn" data-act="load-set" data-i="${i}" title="${this.esc(tip)}">${this.esc(nm)}</button>`;
            }).join('');

            const tok = this.tokensSpent(st);
            el.innerHTML = `<div class="lgu-skm-arena-head">
                    <b>Навыки Арены</b>
                    <span>Потрачено жетонов: <b>${tok}</b> ⟡</span>
                </div>
                <div class="lgu-skm-slots">${slot('ab')}${slot('ult')}</div>
                <div class="lgu-skm-ups">${ups || '<p class="lgu-skm-note">Открытых способностей Арены нет — откройте ромб на карте.</p>'}</div>
                <div class="lgu-skm-loads">
                    <button type="button" class="lgu-skm-loadbtn game" data-act="load-game">Из игры</button>
                    ${setBtns || '<small class="lgu-skm-note">Наборы игры недоступны</small>'}
                </div>`;
        },

        /* ------------------------------------------------------------
         * Сводка «Что дают открытые навыки» (аналог statList() из skillmap.js)
         * ---------------------------------------------------------- */
        statList() {
            const C = this.clsData();
            if (!C) return [];
            const st = this.state();
            const map = new Map();
            const out = [];
            (C.branches || []).forEach((B, bi) => {
                (B.nodes || []).forEach((n) => {
                    const r = Math.min(Math.max(1, +n.max || 1), +st.nodes[n.id] || 0);
                    if (!r) return;
                    // v11.7.1: сводка строится по ВСЕМ fx узла, а не только по
                    // тексту, начинающемуся с «Название +N%». Так вершины
                    // веток и ноды с несколькими эффектами больше не теряются.
                    for (const [fk, fv] of Object.entries(n.fx || {})) {
                        if (this.isSkipFx(fk) || this.fxFlags[fk] || !isFinite(+fv) || !+fv) continue;
                        let label = this.fxNames[fk];
                        // Неизвестный ключ не выдумываем: лучше пропустить,
                        // чем показать «+1%» вместо описания механики.
                        if (!label) continue;
                        // Ключ resist двузначный: в большинстве узлов это шанс
                        // избежать яда/тины, но в отдельных ветках — настоящая
                        // характеристика «Сопротивление». Смотрим на текст узла,
                        // чтобы не путать эти механики.
                        const ntext = String(n.text || '').toLowerCase();
                        if (fk === 'resist') {
                            label = /сопротивлен/.test(ntext) ? 'Сопротивление' : 'Шанс избежать яда и тины';
                        } else if (fk === 'pierce' && !/брон/.test(ntext)) {
                            label = 'Пробивание';
                        }
                        // Значение — как в тексте узла (fx × ранг), без пересчёта
                        // в пункты характеристики: resist здесь — шанс избежать
                        // яда/тины, pierce — процент игнорируемой брони.
                        const amount = +fv * r;
                        const key = 'fx:' + fk + ':' + label;
                        const hit = map.get(key);
                        if (hit) { hit.v += amount; hit.names.push(n.name); continue; }
                        const unit = (fk in this.fxUnits) ? this.fxUnits[fk] : '%';
                        const item = { label, sign: '+', suf: unit, v: amount, color: this.branchColor(bi), names: [n.name] };
                        map.set(key, item);
                        out.push(item);
                    }
                });
            });
            return out;
        },

        renderSummary() {
            const el = this._els.summary;
            if (!el) return;
            const list = this.statList();
            const V = this.skmapCache[this._cls] || {};
            const opened = this.openedCount();
            const need = +(V.classOpen || 0);
            const hubOn = need > 0 && opened >= need;
            const fmt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
            const body = list.length
                ? `<ul class="lgu-skm-stats">${list.map(x => `<li style="--bc:${x.color}" title="${this.esc(x.names.join(', '))}"><span>${this.esc(x.label)}</span><b>${x.sign}${fmt(x.v)}${x.suf}</b></li>`).join('')}</ul>`
                : '<p class="lgu-skm-note">Пока ничего не открыто.</p>';
            el.innerHTML = `<div class="lgu-skm-sum-head">
                    <b>Что дают открытые навыки</b>
                    <span>${hubOn ? '✅ умение класса открыто' : `до умения класса: ${Math.max(0, need - opened)} узл.`}</span>
                </div>${body}`;
        },

        /**
         * v11.7.0: числовые бонусы открытых узлов созвездия — для вкладки
         * «👗 Примерка» планировщика героя.
         *
         * statList() собирает ТЕКСТОВУЮ сводку («Физ. урон +15%»), а здесь
         * нужен агрегат в единицах характеристик героя:
         *   hp / def          — плоские значения (fx узла);
         *   atkPct / magPct   — проценты к физ./маг. урону (fx melee / magic);
         *   crit, critDmg, dodge, pierce, healPow, luck, resist — пункты.
         *
         * resist/pierce в fx лежат «сырыми», поэтому переводятся через
         * fromFx (обычно 0.5) — так же, как в игре и в примечаниях
         * formatNodeText(). Пропускаются служебные ключи (ctl_/act_/cd_).
         *
         * @returns {object|null} null — созвездие не загружено или пусто
         */
        skillBonuses() {
            const C = this.clsData();
            if (!C || !this._cls) return null;
            const st = this.state();
            const fromFx = this.xstatFromFx();
            // fx-ключ -> поле агрегата. Всё остальное (урон по боссам, залпы,
            // лечение и т.п.) на статы героя напрямую не влияет и опускается.
            const MAP = {
                melee: 'atkPct', magic: 'magPct', hp: 'hp', def: 'def',
                crit: 'crit', critDmg: 'critDmg', dodge: 'dodge', pierce: 'pierce',
                healPow: 'healPow', luck: 'luck', resist: 'resist'
            };
            const out = {
                hp: 0, def: 0, atkPct: 0, magPct: 0,
                crit: 0, critDmg: 0, dodge: 0, pierce: 0,
                healPow: 0, luck: 0, resist: 0
            };
            let any = false;
            (C.branches || []).forEach((B) => {
                (B.nodes || []).forEach((n) => {
                    const r = Math.min(Math.max(1, +n.max || 1), +st.nodes[n.id] || 0);
                    if (!r) return;
                    for (const [fk, fv] of Object.entries(n.fx || {})) {
                        const key = MAP[fk];
                        if (!key || this.isSkipFx(fk) || !isFinite(+fv)) continue;
                        const scale = isFinite(+fromFx[fk]) ? +fromFx[fk] : 1;
                        out[key] += (+fv) * r * scale;
                        any = true;
                    }
                });
            });
            return any ? out : null;
        },

        /* ------------------------------------------------------------
         * Вкладка «Экипировка» (статы героя + сравнение с сумкой)
         * ---------------------------------------------------------- */
        renderGear() {
            const el = this._els.gear;
            if (!el || this._tab !== 'gear') return;
            const h = this.hero;
            if (!h) { el.innerHTML = '<p class="lgu-skm-note">Данные героя не загружены.</p>'; return; }
            const items = Array.isArray(h.items) ? h.items : [];
            const equipped = items.filter(x => x && x.on && x.slot);
            const bag = items.filter(x => x && !x.on && x.slot);
            const statRows = Object.entries(h.stats || {}).map(([k, v]) => `<tr><td>${this.esc(this.statNames[k] || k)}</td><td>${this.esc(v)}</td></tr>`).join('');
            const bagRows = bag.map((item) => {
                const cur = equipped.find(x => x.slot === item.slot);
                const keys = new Set([].concat(Object.keys(item.stats || {}), Object.keys((cur && cur.stats) || {})));
                const changes = [];
                keys.forEach((k) => {
                    const nv = (item.stats && item.stats[k]) || 0;
                    const ov = (cur && cur.stats && cur.stats[k]) || 0;
                    const diff = nv - ov;
                    if (diff === 0) return;
                    // v11.7.1: строгий знак. Раньше .stat-line b всегда был
                    // зелёным, и отрицательные изменения (−1, −10, −63)
                    // выглядели как бонус. Теперь + / − / 0 — разными классами.
                    const cls = diff > 0 ? 'stat-up' : (diff < 0 ? 'stat-down' : 'stat-eq');
                    changes.push(`<div class="stat-line"><span>${this.esc(this.statNames[k] || k)}</span><b class="${cls}">${diff > 0 ? '+' : ''}${diff}</b></div>`);
                });
                return `<tr><td><b>${this.esc(item.name || '—')}</b><br><small>${this.esc(item.slot)}</small></td><td>${changes.join('') || '<span class="stat-eq">без изменений</span>'}</td></tr>`;
            }).join('');
            el.innerHTML = `<div class="lgu-skm-gear-col">
                    <h3>Текущие статы</h3>
                    <table><thead><tr><th>Параметр</th><th>Значение</th></tr></thead><tbody>${statRows || '<tr><td colspan="2">—</td></tr>'}</tbody></table>
                </div>
                <div class="lgu-skm-gear-col">
                    <h3>Сравнение с сумкой</h3>
                    <table><thead><tr><th>Вещь (слот)</th><th>Изменение статов</th></tr></thead><tbody>${bagRows || '<tr><td colspan="2">Сумка пуста</td></tr>'}</tbody></table>
                </div>`;
        },

        /* ------------------------------------------------------------
         * Пресеты билдов: GM_setValue / GM_getValue + мягкая миграция
         * со старого localStorage-ключа LEGION_SAVED_BUILDS.
         * ---------------------------------------------------------- */
        loadSavedBuilds() {
            if (this._savedLoaded) return;
            this._savedLoaded = true;
            let raw = null;
            try {
                raw = (typeof GM_getValue === 'function') ? GM_getValue(this.BUILD_KEY, '') : localStorage.getItem(this.BUILD_KEY);
            } catch (err) { dbg('[BUILD SIM] GM_getValue:', err); }
            if (!raw) {
                try { raw = localStorage.getItem(this.BUILD_KEY); } catch (err) { /* noop */ }
            }
            if (raw) {
                try {
                    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    const builds = (d && d.builds) ? d.builds : d;
                    if (builds && typeof builds === 'object' && !Array.isArray(builds)) this.savedBuilds = builds;
                } catch (err) { dbg('[BUILD SIM] разбор пресетов:', err); }
            } else {
                this._needLegacyMigration = true;
            }
        },

        _persistBuilds() {
            const payload = JSON.stringify({ v: 2, builds: this.savedBuilds });
            try {
                if (typeof GM_setValue === 'function') GM_setValue(this.BUILD_KEY, payload);
                else localStorage.setItem(this.BUILD_KEY, payload);
            } catch (err) {
                dbg('[BUILD SIM] сохранение пресетов:', err);
                try { localStorage.setItem(this.BUILD_KEY, payload); } catch (e) { /* noop */ }
            }
        },

        /**
         * Однократный перенос старых билдов { cls: [{ name, skills }] } из
         * localStorage в новый формат. Совпавшие nodeId переносятся, остальные
         * (старое дерево) отбрасываются; если не совпало ничего — тост.
         */
        _migrateLegacyBuilds() {
            let old = null;
            try { old = JSON.parse(localStorage.getItem(this.LEGACY_BUILD_KEY) || 'null'); } catch (err) { old = null; }
            if (!old || typeof old !== 'object' || Array.isArray(old)) return;
            let migrated = 0;
            let skipped = 0;
            for (const [cls, list] of Object.entries(old)) {
                if (!Array.isArray(list) || !this.clsData(cls)) continue;
                if (!this.savedBuilds[cls]) this.savedBuilds[cls] = [];
                for (const b of list) {
                    if (!b || !b.skills || typeof b.skills !== 'object') continue;
                    const nodes = {};
                    for (const [id, r] of Object.entries(b.skills)) {
                        const node = this.nodeOf(id, cls);
                        if (!node) continue;
                        const rank = Math.max(1, Math.min(Math.floor(+r) || 0, +node.max || 1));
                        if (rank > 0) nodes[id] = rank;
                    }
                    if (!Object.keys(nodes).length) { skipped++; continue; }
                    this.savedBuilds[cls].push({
                        name: b.name || 'Старый билд',
                        at: Date.now(),
                        legacy: true,
                        data: { nodes, abilities: {}, eq: { ab: '', ult: '' }, up: {} }
                    });
                    migrated++;
                }
            }
            this._persistBuilds();
            if (migrated) UI.showToast(`📦 Перенесено старых билдов: ${migrated}`);
            else if (skipped) UI.showToast('⚠ Старые билды несовместимы с новым деревом', true);
        },

        saveCurrentBuild(clsId, name) {
            const cls = clsId || this._cls;
            const nm = String(name == null ? '' : name).trim();
            if (!cls) return false;
            if (!nm) {
                UI.showToast('Введите название билда', true);
                return false;
            }
            const list = this.savedBuilds[cls] || (this.savedBuilds[cls] = []);
            const entry = { name: nm, at: Date.now(), data: this._snapshot(this.state(cls)) };
            const i = list.findIndex(b => b && b.name === nm);
            if (i >= 0) list[i] = entry;
            else list.push(entry);
            this._buildIndex = i >= 0 ? i : list.length - 1;
            this._buildName = nm;
            this._persistBuilds();
            this.renderBar();
            UI.showToast('💾 Билд сохранён');
            return true;
        },

        loadBuild(index) {
            const list = this.savedBuilds[this._cls] || [];
            const item = list[+index];
            if (!item) return false;
            this.sandbox[this._cls] = this._sanitizeBuild(this._cls, item.data);
            this._buildIndex = +index;
            this._buildName = item.name || '';
            this._sel = null;
            this.renderAll();
            UI.showToast(`📥 Билд «${item.name}» загружен`);
            return true;
        },

        deleteSelectedBuild() {
            const list = this.savedBuilds[this._cls] || [];
            if (this._buildIndex === null || !list[this._buildIndex]) {
                UI.showToast('Сначала выберите билд в списке', true);
                return;
            }
            const name = list[this._buildIndex].name;
            list.splice(this._buildIndex, 1);
            this._buildIndex = null;
            this._persistBuilds();
            this.renderBar();
            UI.showToast(`🗑️ Билд «${name}» удалён`);
        },

        /* ------------------------------------------------------------
         * Коды билдов: B2:<url-safe base64>
         * ---------------------------------------------------------- */
        _extractBuildCode(input) {
            const s = String(input == null ? '' : input).trim();
            const marker = '#build=';
            const i = s.indexOf(marker);
            const raw = i >= 0 ? s.slice(i + marker.length) : s;
            return raw.split('&')[0].trim();
        },

        _channel() {
            const m = String(API_BASE || '').match(/^\/c\/([^/]+)/);
            if (m) return m[1];
            const p = String(location.pathname || '').match(/^\/c\/([^/]+)/);
            if (p) return p[1];
            const u = G.ME && G.ME.user;
            return (u && (u.login || u.name)) || '';
        },

        encodeBuild(clsId) {
            const cls = clsId || this._cls;
            const st = this.state(cls);
            try {
                const payload = {
                    v: 2,
                    c: cls,
                    n: st.nodes || {},
                    a: st.abilities || {},
                    eq: { ab: (st.eq && st.eq.ab) || '', ult: (st.eq && st.eq.ult) || '' },
                    up: st.up || {}
                };
                const json = JSON.stringify(payload);
                return 'B2:' + btoa(encodeURIComponent(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            } catch (err) {
                dbg('[BUILD SIM] encodeBuild:', err);
                return '';
            }
        },

        _decodePayload(b64) {
            const s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/');
            const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
            const text = atob(s + pad);
            let json = text;
            try { json = decodeURIComponent(text); } catch (err) { /* старый формат без %-кодирования */ }
            return JSON.parse(json);
        },

        /**
         * Разбор кода билда:
         *   B2:<base64> — новый формат { v:2, c, n, a, eq, up };
         *   <base64>    — старый формат { cls, sk } (мягкая совместимость).
         * Возвращает id класса, в который применён билд, либо ''.
         */
        decodeBuild(code) {
            const raw = this._extractBuildCode(code);
            if (!raw) return '';
            let payload = null;
            let legacy = false;
            try {
                if (raw.slice(0, 3) === 'B2:') {
                    payload = this._decodePayload(raw.slice(3));
                } else {
                    const d = this._decodePayload(raw);
                    if (d && d.sk && typeof d.sk === 'object') {
                        legacy = true;
                        payload = { v: 1, c: d.cls || d.c || '', sk: d.sk };
                    }
                }
            } catch (err) {
                dbg('[BUILD SIM] decodeBuild:', err);
                payload = null;
            }
            if (!payload || typeof payload !== 'object') return '';

            const cls = String(payload.c || this._cls || '');
            if (!this.clsData(cls)) {
                UI.showToast('Код от неизвестного класса', true);
                return '';
            }

            let data;
            if (legacy) {
                const nodes = {};
                const all = Object.keys(payload.sk || {});
                let matched = 0;
                for (const id of all) {
                    const node = this.nodeOf(id, cls);
                    if (!node) continue;
                    nodes[id] = Math.max(1, Math.min(Math.floor(+payload.sk[id]) || 0, +node.max || 1));
                    matched++;
                }
                if (!matched) {
                    UI.showToast('Код от старого дерева несовместим с созвездием', true);
                    return '';
                }
                data = { nodes, abilities: {}, eq: { ab: '', ult: '' }, up: {} };
                if (matched < all.length) UI.showToast(`⚠ Перенесено узлов: ${matched} из ${all.length}`);
            } else {
                if (+payload.v !== 2) {
                    UI.showToast('Неподдерживаемая версия кода билда', true);
                    return '';
                }
                data = { nodes: payload.n, abilities: payload.a, eq: payload.eq, up: payload.up };
            }

            this.sandbox[cls] = this._sanitizeBuild(cls, data);
            this._cls = cls;
            this._buildIndex = null;
            this._buildName = '';
            this._sel = null;
            return cls;
        },

        shareBuild(clsId) {
            const code = this.encodeBuild(clsId);
            if (!code) {
                UI.showToast('Не удалось собрать код билда', true);
                return '';
            }
            const ch = this._channel();
            const url = `https://legiongame.gg/c/${ch}#build=${code}`;
            this._copy(url);
            return url;
        },

        _copy(text) {
            const value = String(text == null ? '' : text);
            const manual = () => window.prompt('Скопируйте ссылку на билд:', value);
            try {
                if (typeof GM_setClipboard === 'function') {
                    GM_setClipboard(value);
                    UI.showToast('📋 Ссылка на билд скопирована');
                    return;
                }
            } catch (err) { dbg('[BUILD SIM] GM_setClipboard:', err); }
            try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    navigator.clipboard.writeText(value)
                        .then(() => UI.showToast('📋 Ссылка на билд скопирована'), manual);
                    return;
                }
            } catch (err) { dbg('[BUILD SIM] clipboard:', err); }
            manual();
        },

        importBuild() {
            const code = window.prompt('Вставьте код билда (B2:…) или ссылку с #build=…', '');
            if (!code) return false;
            const cls = this.decodeBuild(code);
            if (!cls) {
                UI.showToast('❌ Неверный код билда', true);
                return false;
            }
            this._tab = 'map';
            this.selectClass(cls);
            UI.showToast('📥 Билд импортирован');
            return true;
        }
    };

