    // ============================================================
    // 4.1. МОДУЛЬ: ПЛАНИРОВЩИК ГЕРОЯ
    // Вкладки: Билды (заглушка → BuildSim), Заточка (рабочий калькулятор).
    // ============================================================
    const HeroPlanner = {
        // Таблица заточки (05_Mechanics.md). v11.6.5e: это ФОЛБЭК — если игра
        // уже отдала LG_GAME_DATA.enchant, шансы и цены берутся оттуда
        // (см. enchantChance / enchantPricePct / enchantPriceMin ниже).
        // Бонус заточки (ENCHANT_MULTIPLIERS) и цены попыток (ENCHANT_PRICES /
        // ENCHANT_PRICE_MIN) — общие: GAME_DATA в core/constants.js, чтобы не
        // дублировать их с auction.js.
        ENCH: {
            max: 15,
            // v11.6.5e: шансы после ребаланса (было 95/90/80/70/55/42/30/20/12/7/4/2/1/0.5/0).
            // Индекс = текущий уровень: chance[1] — шанс шага +1 -> +2.
            chance: [0, 100, 95, 90, 80, 70, 60, 50, 40, 32, 25, 20, 16, 12, 9, 6],
            // v11.7 (клиент b62dcb896a): амулет (trinket) официально входит в
            // enchant.slots и точится по общей шкале +0..+15. Список берём из
            // core/constants.js, чтобы не дублировать его с auction.js;
            // живая таблица игры имеет приоритет — см. enchantSlots().
            slots: GAME_DATA.ENCHANT_SLOTS
        },

        /**
         * v11.7: актуальный список затачиваемых слотов.
         *
         * Приоритет у живой таблицы игры (LG_GAME_DATA.enchant.slots — в
         * клиенте b62dcb896a там пять слотов, включая 'trinket'). Если таблицы
         * ещё нет (run-at document-start), отдаём фолбэк ENCH.slots.
         *
         * @returns {string[]} слоты, которые показывает калькулятор
         */
        enchantSlots() {
            const live = liveEnchantSlots();
            return (Array.isArray(live) && live.length) ? live : this.ENCH.slots;
        },

        // ── Режим «С учётом шансов» (стратегии) ──────────────────
        // v11.7.0: переключатель 📊/🧠 удалён — «Итоговая стоимость» всегда
        // ожидаемая, поэтому поле оставлено только для совместимости.
        strategyMode: 'expected', // 'ideal' | 'expected'
        // 11.6.5f: цель заточки (+N) для правой карточки Split-view.
        // null — не выбрана: берём следующий уровень (enchantTargetLevel).
        // Хранится в абсолютных уровнях (+1…+15); при смене предмета цель
        // не сбрасывается — просто зажимается в допустимый диапазон.
        targetLevel: null,
        // v11.7.1: уровень ПРОСМОТРА (0…15) отдельно от цели пути. Игрок может
        // посмотреть статы предмета на +0, +4, +7 и т.д., даже если текущая
        // заточка уже выше: тогда путь curEn -> previewLevel пустой (0 шагов).
        previewLevel: null,
        // v11.7.1: ручной ввод количества ресурсов убран — звёзды и сферы
        // теперь выбираются кнопками ⭐/🌐 в строках уровней, а расход
        // считается автоматически по пути curEn+1…previewLevel.
        userStars: 0,
        userSpheres: 0,
        allocatedStars: {},   // { lv: true }
        allocatedSpheres: {}, // { lv: true }

        // ── v11.7.0: вкладка «👗 Примерка» ───────────────────────
        // Пять слотов экипировки в порядке нативной карточки героя
        // (helmet, weapon, shield, armor, trinket).
        FITTING_SLOTS: [
            { id: 'helmet', name: 'Шлем', icon: '⛑' },
            { id: 'weapon', name: 'Оружие', icon: '⚔️' },
            { id: 'shield', name: 'Щит/оффхенд', icon: '🛡' },
            { id: 'armor', name: 'Броня', icon: '🥋' },
            { id: 'trinket', name: 'Амулет', icon: '📿' }
        ],
        /*
         * v11.7.1: «Индекс билда» — ВНУТРЕННЯЯ оценка Legion Ultimate
         * (Σ stat[k] × POW[k] + 2 за каждый уровень заточки). Это НЕ игровой
         * рейтинг силы «⚔» из карточки героя: тот считает сервер по своим
         * правилам, а в /api/me поля power обычно нет. Индекс нужен только
         * для честного сравнения «Сейчас → Примерка».
         */
        FIT_POW: { atk: 1, mag: 1, def: 1, hp: 0.25, crit: 0.8, critDmg: 0.2, dodge: 0.8, pierce: 0.8, healPow: 0.5, luck: 0.5, resist: 0.5 },
        /* Подписи весов — для подробного title-тултипа индекса. */
        FIT_POW_LABELS: { atk: 'Физ. урон', mag: 'Магия', def: 'Броня', hp: 'Макс. HP', crit: 'Крит', critDmg: 'Сила крита', dodge: 'Уклонение', pierce: 'Пробивание', healPow: 'Сила лечения', luck: 'Удача', resist: 'Сопротивление' },
        /* Потолки вторичных характеристик (xstats.max из game-data.js). */
        FIT_CAPS: { crit: 50, critDmg: 200, dodge: 35, pierce: 75, healPow: 100, luck: 100 },
        /* Состояние примерки: моделируемый класс/уровень, флаг бонусов
           созвездия и выбор по слотам { slotId: { uid, en } }. */
        fitting: { role: '', level: 1, useSkills: false, slots: {} },

        // Стоимость ресурсов (из 05_Mechanics.md). v11.6.5e: ребаланс — 100/300.
        // Это фолбэк: живая цена кузнеца читается из enchant.coins
        // (см. baseResourcePrice), поэтому следующие ребалансы цен не ломают расчёт.
        COST_STAR: 100,
        COST_SPHERE: 300,

        // 11.6.2d: id ресурсов заточки в игре (рынок/аукцион, сумка).
        // Найдено в game-src: site/b-shop.js.txt (плитки материалов лавки) —
        // «Счастливая звезда» = enchant_star, «Сфера сохранения» =
        // enchant_sphere. Это те же id, под которыми предметы лежат на ауке,
        // поэтому по ним можно спросить медиану у нашего сервера.
        MATERIAL_IDS: { star: 'enchant_star', sphere: 'enchant_sphere' },
        // Медианы аука меняются медленно, а Планировщик открывают часто:
        // не чаще одного запроса в 5 минут (кэш живёт в памяти модуля).
        MEDIANS_TTL: 5 * 60 * 1000,
        _mediansAt: 0,
        _mediansPending: null,

        // Округление подтверждено живой игрой: и статы, и цена считаются через
        // Math.round. Все вызовы идут сюда — если поведение изменится, правим здесь.
        enchantStat(base, en, statKey) {
            const bonus = GAME_DATA.ENCHANT_MULTIPLIERS[Math.min(15, +en || 0)] || 0;
            // Для xstat-ов (crit, dodge, pierce и т.д.) бонус заточки делится на 4
            // (enchK=0.25 из game-data.js xstats.enchK). См. app.js:1393 enchStatsN.
            const effective = GAME_DATA.XSTAT_KEYS.has(statKey) ? bonus * GAME_DATA.ENCHANT_K : bonus;
            return Math.round(base * (1 + effective / 100));
        },

        // Обратный вычет заточки (когда сервер не отдал stats0): восстанавливаем
        // базу делением на тот же эффективный множитель, что и в enchantStat,
        // иначе для xstat-ов база получалась бы заниженной в 4 раза.
        enchantBase(stat, en, statKey) {
            const bonus = GAME_DATA.ENCHANT_MULTIPLIERS[Math.min(15, +en || 0)] || 0;
            const effective = GAME_DATA.XSTAT_KEYS.has(statKey) ? bonus * GAME_DATA.ENCHANT_K : bonus;
            const divisor = 1 + effective / 100;
            return divisor > 0 ? Math.round(stat / divisor) : stat;
        },

        /**
         * v11.6.5e: ШАНС УСПЕХА заточки, % (без способов, обычная заточка).
         *
         * Источник — живая таблица игры LG_GAME_DATA.enchant.chance, поэтому
         * ребалансы шансов не требуют правок аддона. Если таблицы ещё нет
         * (run-at document-start, урезанная сборка) — локальный фолбэк
         * ENCH.chance из этого объекта.
         *
         * @param {number} level текущий уровень: chance[level] — шанс шага level -> level+1
         * @returns {number} шанс в процентах
         */
        enchantChance(level) {
            const i = Math.min(15, +level || 0);
            const live = liveEnchantChance(i);
            return Number.isFinite(live) ? live : (this.ENCH.chance[i] || 0);
        },

        // v11.6.5e: цена попытки в % от стоимости предмета — из живой таблицы
        // игры (enchant.price), фолбэк — GAME_DATA.ENCHANT_PRICES.
        enchantPricePct(level) {
            return liveEnchantPricePct(level);
        },

        // v11.6.5e: минимум цены попытки, медь — из живой таблицы игры
        // (enchant.priceMin), фолбэк — GAME_DATA.ENCHANT_PRICE_MIN.
        enchantPriceMin() {
            return liveEnchantPriceMin();
        },

        // Стоимость одной попытки заточки с уровня level, медь.
        enchantCost(itemV, level) {
            const pct = this.enchantPricePct(level);
            return Math.max(this.enchantPriceMin(), Math.round(itemV * pct / 100));
        },

        /**
         * 11.6.5f: цель заточки для правой карточки Split-view.
         *
         * Приоритет: выбранный пользователем targetLevel (клик по строке
         * уровня или пресет +4/+7/+10/+15), иначе следующий уровень curEn + 1.
         *
         * Цель ВСЕГДА впереди текущего уровня и не выше ENCH.max: шаги
         * +1…+curEn уже пройдены, и включать их в «Итоговую стоимость» нельзя.
         * Поэтому targetLevel зажимается в [min(cur+1, max), max] — при
         * curEn = 15 остаётся только 15 (стоимость нулевая).
         *
         * @param {number} curEn текущая заточка предмета
         * @returns {number} целевой уровень (1…15)
         */
        enchantTargetLevel(curEn) {
            const max = this.ENCH.max;
            const cur = Math.min(max, Math.max(0, +curEn || 0));
            const min = Math.min(max, cur + 1);
            const t = +this.targetLevel;
            if (!Number.isFinite(t) || t <= 0) return min;
            return Math.min(max, Math.max(min, Math.round(t)));
        },

        /**
         * v11.7.1: уровень просмотра (0…15) для карточки «Заточка».
         *
         * В отличие от enchantTargetLevel НЕ зажимается вперёд текущей
         * заточки: игрок вправе посмотреть статы предмета на +0…+15.
         * Если уровень не выбран — берём цель пути (curEn + 1).
         *
         * @param {number} curEn текущая заточка предмета
         * @returns {number} уровень просмотра (0…15)
         */
        enchantPreviewLevel(curEn) {
            const max = this.ENCH.max;
            if (this.previewLevel == null) return this.enchantTargetLevel(curEn);
            const raw = Number(this.previewLevel);
            if (!Number.isFinite(raw)) return this.enchantTargetLevel(curEn);
            return Math.min(max, Math.max(0, Math.round(raw)));
        },

        /* ---------------------------------------------------------- */
        /* v11.6.3: штраф экипировки (gearPenalty из lib/game-data.js) */
        /* ---------------------------------------------------------- */

        /**
         * Штраф за один предмет «не для класса».
         *
         * Правила игры (lib/game-data.js: gearPenalty):
         *  - armor −25%, helmet −10%, shield −15% к основному стату;
         *  - магический фокус (slot === 'shield' && gear === 'cloth') —
         *    вторая рука мага/жреца/некроманта: проверяется по cloth-ветке,
         *    поэтому для cloth-классов штрафа нет;
         *  - оффхенд-оружие (slot === 'shield' && role && gear !== 'cloth') —
         *    разрешено только своему классу: штраф, если role !== item.role;
         *  - обычный защитный щит разрешён только legionary/paladin
         *    (CLASS_SHIELD = shieldOk).
         *
         * @param {string} role hero.role
         * @param {object} item предмет из /api/me
         * @returns {{pct:number, bad:boolean, focus:boolean, offhand:boolean, want:string, slot:string}}
         */
        gearPenaltyFor(role, item) {
            const out = { pct: 0, bad: false, focus: false, offhand: false, want: '', slot: '' };
            if (!role || !item) return out;
            const pen = GAME_DATA.GEAR_PEN[item.slot] || 0;
            const want = GAME_DATA.CLASS_GEAR[role] || '';
            const focus = isFocusItem(item);
            const offhand = isOffhandItem(item);
            out.want = want;
            out.focus = focus;
            out.offhand = offhand;
            out.slot = item.slot;
            if (!pen) return out;

            let bad;
            if (item.slot === 'shield') {
                if (offhand) {
                    // Оффхенд — оружие конкретного класса, «чужой» щит тут ни
                    // при чём: сравниваем класс предмета с классом героя.
                    bad = String(item.role).toLowerCase() !== String(role).toLowerCase();
                } else {
                    bad = focus
                        ? (!!want && want !== 'cloth')
                        : !GAME_DATA.CLASS_SHIELD[role];
                }
            } else {
                const g = item.gear || 'any';
                bad = !!want && g !== 'any' && g !== want;
            }
            out.bad = bad;
            out.pct = bad ? pen : 0;
            return out;
        },

        /**
         * Суммарный штраф по списку НАДЕТЫХ предметов с потолком
         * GEAR_PEN_CAP. Возвращает { pct, parts: [{ item, pct }] }.
         */
        gearPenaltyTotal(role, items) {
            const parts = [];
            let pct = 0;
            for (const it of Array.isArray(items) ? items : []) {
                const r = this.gearPenaltyFor(role, it);
                if (!r.bad) continue;
                pct += r.pct;
                parts.push({ item: it, pct: r.pct });
            }
            return { pct: Math.min(GAME_DATA.GEAR_PEN_CAP, pct), parts };
        },

        /* ---------------------------------------------------------- */
        /* v11.7.0: РАСЧЁТ «ПРИМЕРКИ» (вкладка 👗 Примерка)            */
        /* ---------------------------------------------------------- */

        /**
         * Базовые характеристики героя по уровню (1…50).
         *
         * Источник — живая таблица игры G.LGGameData.levelRow(lvl) (строка
         * уровней: hp/atk/mag/def). Если таблицы ещё нет (run-at
         * document-start, урезанная сборка), берём фолбэк аддона:
         *   hp = 15 + 5×lvl, atk/mag = ceil(lvl×0.42), def = floor(lvl×0.24).
         *
         * @param {number} level уровень героя
         * @returns {{hp:number, atk:number, mag:number, def:number}}
         */
        levelBaseStats(level) {
            const lvl = Math.min(50, Math.max(1, Math.round(+level || 1)));
            const fallback = {
                hp: 15 + 5 * lvl,
                atk: Math.ceil(lvl * 0.42),
                mag: Math.ceil(lvl * 0.42),
                def: Math.floor(lvl * 0.24)
            };
            let row = null;
            try {
                const gd = (typeof G !== 'undefined' && G) ? G.LGGameData : null;
                if (gd && typeof gd.levelRow === 'function') row = gd.levelRow(lvl);
            } catch (e) { row = null; }
            // Формат строки уровня может отличаться — берём только числовые
            // поля объекта, всё остальное закрывает фолбэк.
            const pick = (k) => {
                const v = (row && !Array.isArray(row)) ? +row[k] : NaN;
                return (Number.isFinite(v) && v > 0) ? v : fallback[k];
            };
            return { hp: pick('hp'), atk: pick('atk'), mag: pick('mag'), def: pick('def') };
        },

        /**
         * Статы предмета на +0 (без заточки).
         *
         * Приоритет — stats0 из /api/me (точные базы игры). Если его нет —
         * обратный вычет заточки: xstat-ы (crit, dodge, pierce…) теряют
         * ¼ бонуса, поэтому считаем через enchantBase, а не общим делителем.
         *
         * @param {object} item предмет из /api/me
         * @param {number} [curEn] текущая заточка (по умолчанию item.en)
         * @returns {object} { statKey: baseValue }
         */
        itemBaseStats(item, curEn) {
            if (!item) return {};
            if (item.stats0 && Object.keys(item.stats0).length) return item.stats0;
            const en = (curEn === undefined)
                ? +(item.en ?? item.e ?? item.enchant ?? 0)
                : curEn;
            const out = {};
            for (const [k, v] of Object.entries(item.stats || {})) {
                out[k] = this.enchantBase(+v || 0, en, k);
            }
            return out;
        },

        /**
         * Текущие характеристики героя из /api/me: первичные лежат в
         * hero.stats, вторичные — в hero.xs. Индекс билда считается той же
         * формулой, что и у примерки (Σ × POW + 2 за уровень заточки), иначе
         * сравнение «Было → Стало» было бы нечестным. Это не серверный
         * рейтинг ⚔ — см. FIT_POW и powerTooltip().
         *
         * @param {object} h hero из /api/me
         * @returns {{stats:object, power:number, penalty:number, parts:Array, critMul:number, enTotal:number}}
         */
        heroCurrentStats(h) {
            const items = (h && Array.isArray(h.items)) ? h.items.filter(x => x && x.on) : [];
            const src = Object.assign({}, (h && h.stats) || {}, (h && h.xs) || {});
            const stats = {};
            for (const k of Object.keys(this.FIT_POW)) {
                const v = +src[k];
                stats[k] = Number.isFinite(v) ? Math.round(v) : 0;
            }
            let enTotal = 0;
            for (const it of items) enTotal += Math.min(15, Math.max(0, Math.round(+(it.en ?? it.e ?? 0))));
            let power = 0;
            for (const [k, w] of Object.entries(this.FIT_POW)) power += (stats[k] || 0) * w;
            const gp = this.gearPenaltyTotal(h && h.role, items);
            return {
                stats,
                power: Math.round(power + 2 * enTotal),
                penalty: gp.pct,
                parts: gp.parts,
                critMul: 1 + (stats.critDmg || 0) / 100,
                enTotal
            };
        },

        /**
         * v11.7.1: нативный рейтинг силы героя («⚔ 488» в карточке), если
         * сервер его прислал. В /api/me поля power обычно нет — число считает
         * сервер и отдаёт, например, в карточке героя гильдии
         * (/api/guilds/hero, docs/API.md). Поэтому используем его только
         * когда оно реально есть и никогда не подменяем им индекс билда.
         *
         * @param {object} h hero из /api/me
         * @returns {number} рейтинг или 0, если сервер его не передал
         */
        nativeHeroPower(h) {
            const v = +(h && h.power);
            return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
        },

        /**
         * v11.7.1: подробная расшифровка индекса билда для title-тултипа.
         * Показывает каждый вес, вклад заточки и итог, а также честно
         * предупреждает, что это не игровой рейтинг ⚔.
         *
         * @param {object} stats характеристики
         * @param {number} enTotal суммарная заточка надетых вещей
         * @param {number} power посчитанный индекс
         * @param {number} nativePower нативный рейтинг игры (0 — неизвестен)
         * @returns {string} многострочная подсказка
         */
        powerTooltip(stats, enTotal, power, nativePower) {
            const fmt = (v) => String(Math.round((+v || 0) * 10) / 10).replace('.', ',');
            const lines = [
                `Индекс эффективности билда: ${Math.round(+power || 0)}`,
                'Это внутренняя оценка Legion Ultimate для сравнения вариантов, а не рейтинг ⚔ из карточки героя.',
                '',
                'Из чего складывается:'
            ];
            for (const [k, w] of Object.entries(this.FIT_POW)) {
                const v = +(stats && stats[k]) || 0;
                if (!v) continue;
                lines.push(`• ${this.FIT_POW_LABELS[k] || k}: ${v} × ${String(w).replace('.', ',')} = ${fmt(v * w)}`);
            }
            if (+enTotal > 0) lines.push(`• Заточка: ${enTotal} ур. × 2 = ${+enTotal * 2}`);
            lines.push('', `Итого: ${Math.round(+power || 0)}`);
            if (+nativePower > 0) {
                lines.push('', `Рейтинг игры ⚔: ${Math.round(+nativePower)} (пришёл с сервера)`);
            } else {
                lines.push('', 'Рейтинг ⚔ в карточке героя считает сервер по своей формуле; в /api/me это число не передаётся, поэтому здесь показан только индекс билда.');
            }
            return lines.join('\n');
        },

        /**
         * Точный расчёт характеристик «примерки»: база уровня + 5 предметов
         * на выбранной заточке + бонусы созвездия − штраф экипировки.
         *
         * Формулы (совпадают с игрой, app.js:1393 enchStatsN):
         *  - первичные статы предмета: round(base × (1 + bonus/100));
         *  - вторичные (XSTAT_KEYS): round(base × (1 + bonus×0.25/100)) —
         *    enchK = 0.25, иначе крит/уклонение завышались бы вчетверо;
         *  - потолки вторичных: crit 50, critDmg 200, dodge 35, pierce 75,
         *    healPow 100, luck 100;
         *  - штраф экипировки (gearPenalty, максимум 50%) режет mag у
         *    mage/priest/necromancer и atk у остальных классов;
         *  - индекс билда = Σ stat × POW + 2 за каждый уровень заточки
         *    (внутренняя оценка, не рейтинг ⚔ из профиля).
         *
         * @param {string} role класс, для которого считаем
         * @param {number} level уровень героя (1…50)
         * @param {Array<{item:object, en:number}>} equippedItems до 5 записей
         * @param {object|null} skillsBonuses агрегат BuildSim.skillBonuses()
         * @returns {object} { stats, power, penalty, parts, critMul, enTotal, skillsUsed }
         */
        calculateFittingStats(role, level, equippedItems, skillsBonuses) {
            const base = this.levelBaseStats(level);
            // Классовый модификатор HP: маг хрупче, разбойник крепче.
            const hpMod = role === 'mage' ? -12 : (role === 'rogue' ? 10 : 0);
            const stats = {
                hp: base.hp + hpMod,
                atk: base.atk,
                mag: base.mag,
                def: base.def,
                // Базовые вторичные статы героя (xstats.base из game-data.js).
                crit: 8,
                critDmg: 50,
                dodge: 0,
                pierce: 0,
                healPow: 0,
                luck: 0,
                resist: 0
            };

            const entries = (Array.isArray(equippedItems) ? equippedItems : [])
                .filter(e => e && e.item)
                .map(e => ({ item: e.item, en: Math.min(15, Math.max(0, Math.round(+e.en || 0))) }));
            const items = entries.map(e => e.item);

            let enTotal = 0;
            for (const { item, en } of entries) {
                enTotal += en;
                const bonus = GAME_DATA.ENCHANT_MULTIPLIERS[en] || 0;
                const bases = this.itemBaseStats(item);
                for (const [k, raw] of Object.entries(bases || {})) {
                    const v = +raw || 0;
                    if (!v || !(k in stats)) continue;
                    const pct = GAME_DATA.XSTAT_KEYS.has(k)
                        ? bonus * GAME_DATA.ENCHANT_K
                        : bonus;
                    stats[k] += Math.round(v * (1 + pct / 100));
                }
            }

            // Бонусы открытого созвездия: hp/def — плоско, урон — процентом
            // от уже собранного пула, вторичные — пунктами.
            if (skillsBonuses) {
                stats.hp += Math.round(+skillsBonuses.hp || 0);
                stats.def += Math.round(+skillsBonuses.def || 0);
                stats.atk += Math.round(stats.atk * (+skillsBonuses.atkPct || 0) / 100);
                stats.mag += Math.round(stats.mag * (+skillsBonuses.magPct || 0) / 100);
                for (const k of ['crit', 'critDmg', 'dodge', 'pierce', 'healPow', 'luck', 'resist']) {
                    stats[k] += +skillsBonuses[k] || 0;
                }
            }

            // Штраф чужой экипировки: у магов режет магию, у остальных физурон.
            const gp = this.gearPenaltyTotal(role, items);
            if (gp.pct > 0) {
                const key = ['mage', 'priest', 'necromancer'].includes(role) ? 'mag' : 'atk';
                stats[key] = Math.round(stats[key] * (1 - gp.pct / 100));
            }

            for (const k of Object.keys(stats)) stats[k] = Math.round(stats[k] || 0);
            for (const [k, cap] of Object.entries(this.FIT_CAPS)) {
                if (stats[k] > cap) stats[k] = cap;
            }

            let power = 0;
            for (const [k, w] of Object.entries(this.FIT_POW)) power += (stats[k] || 0) * w;

            return {
                stats,
                power: Math.round(power + 2 * enTotal),
                penalty: gp.pct,
                parts: gp.parts,
                critMul: 1 + (stats.critDmg || 0) / 100,
                enTotal,
                skillsUsed: !!skillsBonuses
            };
        },

        /**
         * Выбор примерки -> записи { item, en } для calculateFittingStats().
         * Предметы ищутся в общем пуле (надетое + сумка + склад): uid
         * уникален за счёт префиксов eq-/bg-/st- из open().
         *
         * @param {Array} pool предметы всех локаций
         * @returns {Array<{item:object, en:number}>}
         */
        fittingEntries(pool) {
            const out = [];
            for (const slot of this.FITTING_SLOTS) {
                const sel = this.fitting.slots[slot.id];
                if (!sel || !sel.uid) continue;
                const item = (Array.isArray(pool) ? pool : []).find(x => String(x.uid) === String(sel.uid));
                if (!item) continue;
                out.push({ item, en: Math.min(15, Math.max(0, Math.round(+sel.en || 0))) });
            }
            return out;
        },

        /**
         * Результат примерки для текущего состояния (класс, уровень, слоты,
         * чекбокс «Учитывать бонусы созвездия навыков»).
         *
         * @param {object} h hero из /api/me (фолбэк класса/уровня)
         * @param {Array} pool предметы всех локаций
         * @returns {object} результат calculateFittingStats()
         */
        fittingResult(h, pool) {
            const role = this.fitting.role || (h && h.role) || '';
            const level = this.fitting.level || (h && h.level) || 1;
            let skills = null;
            if (this.fitting.useSkills) {
                try {
                    if (typeof BuildSim !== 'undefined' && BuildSim && typeof BuildSim.skillBonuses === 'function') {
                        skills = BuildSim.skillBonuses();
                    }
                } catch (e) { skills = null; }
            }
            return this.calculateFittingStats(role, level, this.fittingEntries(pool), skills);
        },

        /**
         * 11.6.5f.1: компактный статус экипировки — одна иконка рядом с
         * названием предмета вместо отдельной полосы над таблицей.
         * Полный текст живёт в title (у штрафа — со списком предметов).
         *
         * v11.7.1: в шапке карточки заточки больше НЕ используется — там
         * показывается статус ВЫБРАННОГО предмета (itemIconBadge по gp),
         * иначе плашка по надетым вещам путала при выборе вещи из сумки.
         * Метод оставлен как публичный helper сводки штрафа.
         *
         * @param {string} role класс героя
         * @param {Array} items надетые предметы
         * @returns {string} html
         */
        gearSummaryIcon(role, items) {
            const eff = this.gearPenaltyTotal(role, items);
            if (!eff.parts.length) {
                return '<span class="hp-gear-pill ok" title="Экипировка подходит классу: штрафа нет">✓</span>';
            }
            const list = eff.parts
                .map(p => `${p.item.name || p.item.slot} −${p.pct}%`)
                .join(', ');
            const tip = `Штраф к основному стату: −${eff.pct}% (${list})`;
            return `<span class="hp-gear-pill bad" title="${Utils.escapeHtml(tip)}">⚠</span>`;
        },

        /* ---------------------------------------------------------- */
        /* 11.6.2d: динамические цены ресурсов (медиана аукциона)      */
        /* ---------------------------------------------------------- */

        /**
         * Медиана аукциона по ресурсу заточки: 'star' | 'sphere'.
         * 0 — наблюдений за 72 часа / последние 100 цен нет, сервер не ответил
         * или модуль Auction недоступен (урезанная сборка).
         *
         * Auction объявлен в modules/auction.js, а тот в сборке идёт ПОСЛЕ
         * hero-planner.js: обращаемся к нему только из методов (на момент
         * вызова все константы IIFE уже созданы), а try/catch страхует от
         * TDZ, если функцию дёрнут раньше времени.
         *
         * @param {'star'|'sphere'} kind
         * @returns {number}
         */
        resourceMedian(kind) {
            const id = this.MATERIAL_IDS[kind];
            if (!id) return 0;
            try {
                if (typeof Auction === 'undefined' || !Auction) return 0;
                if (typeof Auction.getMedian !== 'function') return 0;
                return Auction.getMedian(id) || 0;
            } catch (e) {
                return 0;
            }
        },

        /**
         * v11.6.5e: базовая цена ресурса заточки у кузнеца, медь.
         *
         * Живой источник — LG_GAME_DATA.enchant.coins.star / .sphere: игра
         * сама сообщает актуальные цены, поэтому ребаланс 100/300 (и любой
         * следующий) подхватывается без правок аддона. Фолбэк — локальные
         * COST_STAR / COST_SPHERE из этого объекта.
         *
         * @param {'star'|'sphere'} kind
         * @returns {number}
         */
        baseResourcePrice(kind) {
            const live = liveEnchant();
            const v = live && live.coins ? +live.coins[kind] : NaN;
            return (Number.isFinite(v) && v > 0)
                ? v
                : (kind === 'star' ? this.COST_STAR : this.COST_SPHERE);
        },

        /**
         * Цена ресурса заточки в меди.
         *
         * Фолбэк (11.6.2d): если медианы аука нет или она нулевая — берём
         * базовую цену кузнеца (baseResourcePrice, живая таблица игры либо
         * COST_STAR / COST_SPHERE). Ноль в стоимость попытки попасть не
         * может, иначе «Суммарно» занижалось бы.
         *
         * @param {'star'|'sphere'} kind
         * @returns {number}
         */
        resourcePrice(kind) {
            return this.resourceMedian(kind) || this.baseResourcePrice(kind);
        },

        /**
         * Подтянуть медианы звёзды и сферы с нашего сервера
         * (GET /market/medians, см. Auction.fetchMarketMedians).
         *
         * Троттлинг: не чаще раза в MEDIANS_TTL; параллельные вызовы
         * переиспользуют один промис (пользователь может щёлкать по табам).
         * Промис НИКОГДА не реджектится — Планировщик обязан рисоваться и на
         * базовых ценах, когда аукцион молчит.
         *
         * @param {boolean} force игнорировать TTL
         * @returns {Promise<void>}
         */
        refreshMaterialMedians(force = false) {
            if (this._mediansPending) return this._mediansPending;
            if (!force && Date.now() - this._mediansAt < this.MEDIANS_TTL) return Promise.resolve();

            const ids = [this.MATERIAL_IDS.star, this.MATERIAL_IDS.sphere];
            const run = (async () => {
                try {
                    if (typeof Auction === 'undefined' || !Auction) return;
                    if (typeof Auction.fetchMarketMedians !== 'function') return;
                    await Auction.fetchMarketMedians(ids);
                    // Отметку ставим только после успешного ответа: при ошибке
                    // следующий вход в Планировщик повторит запрос.
                    this._mediansAt = Date.now();
                } catch (e) {
                    dbg('[HERO PLANNER] Медианы ресурсов недоступны:', e);
                }
            })();

            // Признак «запрос в полёте» снимаем в микрозадаче, а не в finally:
            // тело могло завершиться СИНХРОННО (например, модуль Auction не
            // подключён), и finally успел бы обнулить поле раньше, чем оно
            // получит ссылку на промис — он залип бы навсегда.
            this._mediansPending = run;
            const clear = () => { this._mediansPending = null; };
            run.then(clear, clear);
            return run;
        },

        /**
         * Бейдж источника цены ресурса для UI:
         *   📈 — цена взята с аукциона (медиана сети за 72 часа / последние 100 цен);
         *   🏪 — базовая цена кузнеца (аукцион не ответил / нет наблюдений).
         * В title — сумма и пояснение, поэтому бейдж работает как тултип.
         *
         * @param {'star'|'sphere'} kind
         * @returns {string} html
         */
        priceBadge(kind) {
            const net = this.resourceMedian(kind);
            if (net > 0) {
                return `<span title="Цена взята с аукциона (медиана сети за 72 часа / последние 100 цен): ${Utils.formatMoney(net)}" style="cursor:help;">`
                    + `📈 <b style="color:#7ad1ff;">${Utils.formatMoney(net)}</b></span>`;
            }
            const base = this.baseResourcePrice(kind);
            return `<span title="Базовые цены (аукцион не отвечает): цена кузнеца ${Utils.formatMoney(base)}" style="cursor:help; color:#999;">`
                + `🏪 ${Utils.formatMoney(base)}</span>`;
        },

        /**
         * Строка цен ресурсов для вкладки «Заточка» (обновляется в renderTable,
         * когда медианы аука пришли с сервера).
         *
         * @returns {string} html
         */
        matsPriceHtml() {
            return `<span>⭐ Счастливая звезда: ${this.priceBadge('star')}</span>`
                + `<span>🌐 Сфера сохранения: ${this.priceBadge('sphere')}</span>`;
        },

        /**
         * v11.7.1: арт предмета для плитки и шапки карточки заточки.
         *
         * Приоритет — нативный рендер игры G.LGInventory.art(it): только он
         * рисует сложные вещи («Нимб из мяты» и прочие легендарки), которые
         * Utils.getItemArtHtml() подменял эмодзи-заглушкой. still() игры
         * применяется, если доступен (как в site/inventory.js).
         * Фолбэк — общий хелпер аддона (SVG -> иконка игры -> эмодзи).
         *
         * @param {object} it предмет из /api/me
         * @returns {string} html
         */
        renderItemArt(it) {
            if (!it) return '📦';
            try {
                const inv = G.LGInventory;
                if (inv && typeof inv.art === 'function') {
                    const rawSvg = inv.art(it);
                    if (rawSvg && rawSvg.startsWith('<svg')) {
                        return (typeof inv.still === 'function') ? inv.still(rawSvg) : rawSvg;
                    }
                }
            } catch (e) {}
            return Utils.getItemArtHtml({ i: it.id ?? it.i, name: it.name }, it);
        },

        init() {
            (document.getElementById(DOM_IDS.btnBuildSim) || document.getElementById('btn-build-sim'))
                ?.addEventListener('click', () => this.open());
        },

        /**
         * Открытие планировщика. initialTab — необязательный id вкладки:
         * 'build' | 'ench'. Устаревший 'arena' перенаправляется на «Билды»
         * (вкладка способностей Арены переехала в созвездие BuildSim).
         */
        async open(initialTab) {
            const wanted = (initialTab === 'arena') ? 'build' : String(initialTab || 'build');
            UI.showModal(`<h2>⚙️ Планировщик Героя <button class="custom-close" id="custom-close-btn">✖</button></h2><div class="loader">Загрузка данных...</div>`);
            try {
                const me = await Utils.fetchApi('/api/me');
                if (!me || !me.ok || !me.hero) throw new Error('Нет героя');
                const h = me.hero;

                // Предметы для заточки. uid сервер отдаёт не всегда: без него все
                // карточки получили бы одинаковый ключ, поэтому отсутствующий uid
                // заменяем синтетическим (с префиксом локации).
                // v11.7: список слотов — из живой таблицы игры (enchant.slots,
                // там есть 'trinket'), поэтому новый ребаланс слотов не ломает
                // фильтр. Фолбэк — GAME_DATA.ENCHANT_SLOTS.
                const enchSlots = this.enchantSlots();
                const mapItems = (arr, prefix) => (arr || [])
                    .filter(it => it && it.slot && enchSlots.includes(it.slot) && it.v > 0)
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

                // 11.6.5f.1: статус экипировки — маленькая иконка в шапке
                // выбранного предмета (раньше была отдельная полоса сверху).
                // v11.7.1: иконка считается по КОНКРЕТНОМУ предмету (gp) внутри
                // renderTable — общая плашка по надетым вещам игрока путала
                // (предмет из сумки мог подходить, а плашка показывала штраф).

                const tabsHtml = `
                    <button class="modal-tab active" data-tab="hero-build">🛡️ Билды</button>
                    <button class="modal-tab" data-tab="hero-ench">⚒️ Заточка</button>
                    <button class="modal-tab" data-tab="hero-fit">👗 Примерка <span class="hp-test-badge">ТЕСТ</span></button>
                `;

                // v11.7.0: вкладки «Билды» и «Заточка» занимают 100% ширины
                // модального окна. Двухколоночная сетка (1fr 320px) с панелью
                // «Характеристики» рендерится строго внутри вкладки «Примерка».
                const contentHtml = `
                    <div class="tab-content active" id="tab-hero-build" style="flex-direction:column; gap:0;">
                        <div id="hp-buildsim-container" style="display:flex; flex-direction:column; flex:1; min-height:0; overflow:auto; padding-bottom:20px;"></div>
                    </div>
                    <div class="tab-content" id="tab-hero-ench" style="flex-direction:column; gap:8px;">
                        <!-- v11.7.0: верхняя полоса переключателя режимов и
                             ценники ⭐/🌐 убраны — кукла слотов и таблица
                             +0…+15 начинаются сразу под шапкой вкладок.
                             Стоимость попытки сразу считается ожидаемой, а
                             цены ресурсов и справка живут справа снизу
                             (см. renderTable). -->

                        <!-- 11.6.5f.1: локации и плитка предметов рядом.
                             Статус экипировки (бывшая полоса «✓ Снаряжение подходит»)
                             теперь иконка рядом с названием предмета — см. renderTable. -->
                        <div class="hp-ench-subbar">
                            <div class="hp-loc-tabs">
                                <button class="hp-loc-btn active" data-loc="equipped" style="background:#caa55c; color:#1d1620; border:none; font-weight:bold; cursor:pointer;">🛡️ Надето</button>
                                <button class="hp-loc-btn" data-loc="bag" style="background:#2a2030; color:#aaa; border:1px solid #44374a; font-weight:bold; cursor:pointer;">🎒 Сумка</button>
                                <button class="hp-loc-btn" data-loc="storage" style="background:#2a2030; color:#aaa; border:1px solid #44374a; font-weight:bold; cursor:pointer;">📦 Склад</button>
                            </div>
                            <div id="hp-item-grid" class="hp-item-grid">
                                <!-- Сюда рендерятся карточки -->
                            </div>
                        </div>

                        <!-- Таблица результатов -->
                        <div id="hp-ench-result" style="flex:1; min-height:0; overflow:auto;">
                            <div style="color:#888; text-align:center; padding:20px;">Выберите предмет.</div>
                        </div>
                    </div>
                    <div class="tab-content" id="tab-hero-fit" style="flex-direction:column; gap:10px;">
                        <div class="hp-fit-layout">
                            <div class="hp-fit-main">
                                <div class="hp-fit-head">
                                    <span class="hp-fit-title">👗 Примерка экипировки <span class="hp-test-badge">ТЕСТ</span></span>
                                </div>
                                <!-- v11.7.0: примерка набора экипировки. Класс и уровень
                                     можно смоделировать, заточка каждого слота — +0…+15. -->
                                <div class="hp-fit-top">
                                    <label class="hp-fit-field">Класс
                                        <select id="hp-fit-role">${Object.entries(GAME_DATA.CLASS_NAMES).map(([id, nm]) => `<option value="${id}">${Utils.escapeHtml(nm)}</option>`).join('')}</select>
                                    </label>
                                    <label class="hp-fit-field">Уровень
                                        <input id="hp-fit-level" type="number" min="1" max="50" step="1">
                                    </label>
                                    <label class="hp-fit-chk" title="Прибавить бонусы открытых узлов созвездия из вкладки «Билды»">
                                        <input id="hp-fit-skills" type="checkbox"> учитывать созвездие
                                    </label>
                                    <button type="button" class="hp-arena-btn" id="hp-fit-reset" title="Вернуть текущие вещи героя">↺ К текущим вещам</button>
                                </div>
                                <div id="hp-fit-rows" class="hp-fit-rows"></div>
                                <div id="hp-fit-foot" class="hp-cost-note">Класс и уровень можно моделировать независимо от героя: заточка выбирается для каждого слота, «↺ К текущим вещам» возвращает надетое. Сравнение с текущими характеристиками — в панели справа.</div>
                            </div>
                            <!-- v11.7.0: боковая панель характеристик и сравнения «Текущий герой → Примерка». -->
                            <aside class="hp-side" id="hp-side"></aside>
                        </div>
                    </div>
                `;

                const modal = UI.showModal(`
                    <h2>⚙️ Планировщик Героя (${Utils.escapeHtml(h.name || '')}) <button class="custom-close" id="custom-close-btn">✖</button></h2>
                    <div class="modal-tabs">${tabsHtml}</div>
                    ${contentHtml}
                `, { customClass: 'hp-planner-modal' });

                // Переключение табов. Скоупим на собственный нав-бар HeroPlanner:
                // после BuildSim.mount() внутри #tab-hero-build появляются свои
                // .modal-tab/.tab-content, и глобальные селекторы сбросили бы их.
                const ownTabs = modal?.querySelector('.modal-tabs');
                // v11.7.0: собственные вкладки HeroPlanner — прямые потомки
                // модалки с классом .tab-content (вкладки BuildSim внутри
                // #tab-hero-build не затрагиваются).
                const ownContents = () => Array.from(modal?.children || []).filter(el => el.classList.contains('tab-content'));
                // 11.6.2d: при входе на вкладку «Заточка» подтягиваем цены
                // звёзды/сферы с аукциона. Реальная реализация — ниже, после
                // renderTable (ей нужно перерисовать таблицу).
                let onEnchTabOpen = () => {};
                const activateTab = (id) => {
                    const btn = ownTabs?.querySelector(`.modal-tab[data-tab="${id}"]`);
                    if (btn) btn.click();
                };
                ownTabs?.querySelectorAll('.modal-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        ownTabs.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                        ownContents().forEach(c => c.classList.remove('active'));
                        tab.classList.add('active');
                        const target = document.getElementById(`tab-${tab.dataset.tab}`);
                        if (target) target.classList.add('active');
                        if (tab.dataset.tab === 'hero-ench') onEnchTabOpen();
                    });
                });
                // initialTab из open() применяем ниже — после того как назначен
                // onEnchTabOpen (иначе первый вход на «Заточку» не подтянет цены).

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

                    // ПРИОРИТЕТ: stats0 (точные базы из игры), иначе обратный
                    // вычет заточки — см. HeroPlanner.itemBaseStats().
                    const baseStats = this.itemBaseStats(item, curEn);
                    const isExpanded = this.ENCH.max;
                    // v11.7.1: уровень ПРОСМОТРА (0…15) отделён от цели пути.
                    // preview <= curEn означает «шагов нет»: карточка просто
                    // показывает статы предмета на выбранном уровне.
                    const preview = this.enchantPreviewLevel(curEn);
                    const hasPath = preview > curEn;
                    const starPrice = this.resourcePrice('star');
                    const spherePrice = this.resourcePrice('sphere');

                    // Компактная подпись стата для колонки «Статы»: убираем
                    // хвостовой «%» из statNames («Крит %» -> «Крит»), значение
                    // показываем числом, как в самой игре.
                    const shortStat = (k) => String(
                        (typeof BuildSim !== 'undefined' && BuildSim.statNames && BuildSim.statNames[k]) || k
                    ).replace(/\s*%$/, '');
                    const statKeys = Object.keys(baseStats || {});
                    // Статы предмета на произвольном уровне заточки (Math.round,
                    // xstat-ы получают ¼ бонуса — см. enchantStat).
                    const statsAt = (lv) => statKeys.length
                        ? statKeys.map(k => `${shortStat(k)} ${this.enchantStat(+baseStats[k] || 0, lv, k)}`).join(' · ')
                        : '—';

                    // ── Правая колонка: таблица уровней +0…+15 ──
                    // v11.7.1: первая строка — база +0, все строки кликабельны:
                    // клик выбирает уровень ПРОСМОТРА (в том числе ниже текущей
                    // заточки), а не только цель впереди.
                    let rows = '';
                    for (let lv = 0; lv <= isExpanded; lv++) {
                        const isBase = lv === 0;
                        const isCur = lv === curEn;
                        const isPreview = lv === preview;

                        // Усилители — только у шагов +1…+15 (у базы шага нет).
                        const useStar = !isBase && !!this.allocatedStars[lv];
                        const useSphere = !isBase && !!this.allocatedSpheres[lv];

                        let chance = 0;
                        let costCell = '—';
                        let chips = '—';
                        let bonusPct = 0;
                        if (!isBase) {
                            chance = this.enchantChance(lv);
                            // ⭐ даёт +25% к шансу — показываем шанс уже с надбавкой.
                            if (useStar) chance += 25;

                            // Отмеченный усилитель входит в стоимость попытки:
                            // колонка «Попытка» показывает реальные траты шага.
                            const attemptCost = this.enchantCost(item.v, lv)
                                + (useStar ? starPrice : 0)
                                + (useSphere ? spherePrice : 0);

                            // 📈 — в стоимость вошёл ресурс, купленный на ауке
                            // (медиана сети). Тултип объясняет источник цены.
                            const aucUsed = (useStar && this.resourceMedian('star') > 0)
                                || (useSphere && this.resourceMedian('sphere') > 0);
                            costCell = `${Utils.formatMoney(attemptCost)}${aucUsed
                                ? ' <span title="Цена включает ресурс с аукциона (медиана сети за 72 часа / последние 100 цен)" style="cursor:help; font-size:11px;">📈</span>'
                                : ''}`;

                            chips = `<button type="button" class="hp-mat-btn star ${useStar ? 'active' : ''}" data-lv="${lv}" title="Счастливая звезда (+25% к шансу, +${Utils.formatMoney(starPrice)})">⭐</button>`
                                + `<button type="button" class="hp-mat-btn sphere ${useSphere ? 'active' : ''}" data-lv="${lv}" title="Сфера сохранения (защита от поломки, +${Utils.formatMoney(spherePrice)})">🌐</button>`;

                            // Бонус заточки на этом уровне (GAME_DATA.ENCHANT_MULTIPLIERS, %)
                            bonusPct = GAME_DATA.ENCHANT_MULTIPLIERS[lv] || 0;
                        }

                        const rowCls = ['hp-ench-row'];
                        if (isCur) rowCls.push('cur');
                        if (isPreview) rowCls.push('preview');

                        rows += `<tr class="${rowCls.join(' ')}" data-lv="${lv}" title="Показать характеристики на +${lv}">
                            <td><b>+${lv}</b>${isBase ? ' <small style="color:#9c8fa8;">(база)</small>' : ''}${isCur ? ' <small style="color:#ffcf6a;">(тек.)</small>' : ''}</td>
                            <td>${isBase ? '—' : Math.min(100, chance) + '%'}</td>
                            <td style="color:#4cc95a; font-weight:bold;">+${bonusPct}%</td>
                            <td>${costCell}</td>
                            <td class="hp-mats-cell">${chips}</td>
                            <td class="hp-ench-stats">${statsAt(lv)}</td>
                        </tr>`;
                    }

                    // ── Левая колонка: карточка уровня просмотра ──
                    // v11.7.0: переключателя режимов больше нет — «Итоговая
                    // стоимость» сразу считается ОЖИДАЕМОЙ (с учётом шансов и
                    // отмеченных ⭐/🌐), а минимум без промахов идёт подписью.
                    let costIdeal = 0;
                    let costExpected = 0;
                    let starsUsed = 0, spheresUsed = 0;
                    let attempts = 0;
                    // v11.7.1: путь всегда вперёд (curEn+1…preview). Если
                    // preview <= curEn, цикл не выполняется — стоимость 0,
                    // а карточка показывает статы выбранного уровня.
                    for (let lv = curEn + 1; lv <= preview; lv++) {
                        const step = this.enchantCost(item.v, lv);
                        costIdeal += step;
                        let stepCost = step;
                        let chance = this.enchantChance(lv);
                        // Ресурсы выбранные кнопками ⭐/🌐 в строках таблицы.
                        if (this.allocatedStars[lv]) { stepCost += starPrice; chance += 25; starsUsed++; }
                        if (this.allocatedSpheres[lv]) { stepCost += spherePrice; spheresUsed++; }
                        // 100 / chance — ожидаемое число попыток на один шаг
                        // (1/p). Сумма по пути даёт матожидание попыток на всю
                        // цель; при 0% шаг бесконечен, поэтому Infinity.
                        attempts += chance > 0 ? 100 / chance : Infinity;
                        costExpected += chance > 0 ? stepCost * (100 / chance) : Infinity;
                    }
                    const costTotalRaw = costExpected;
                    const costTotal = Number.isFinite(costTotalRaw) ? Utils.formatMoney(costTotalRaw) : '∞';
                    const costMin = Number.isFinite(costIdeal) ? Utils.formatMoney(costIdeal) : '∞';
                    const costResources = starsUsed * starPrice + spheresUsed * spherePrice;
                    const attemptsStr = hasPath
                        ? (Number.isFinite(attempts) ? Math.ceil(attempts) : '∞')
                        : '0';
                    const rangeText = hasPath
                        ? `шагов +${curEn + 1}…+${preview}`
                        : (preview === curEn
                            ? 'шагов нет — это текущий уровень'
                            : `шагов нет — +${preview} уже пройден`);

                    // Статы предмета на выбранном уровне: база (+0) -> итог,
                    // прибавка отдельным зелёным числом. v11.7.1: если выбран
                    // уровень ниже текущей заточки, дополнительно показываем
                    // значение на текущей заточке (для сравнения).
                    const statHtml = Object.entries(baseStats).map(([k, base]) => {
                        const b = +base || 0;
                        const fin = this.enchantStat(b, preview, k);
                        const gain = fin - b;
                        const name = (typeof BuildSim !== 'undefined' && BuildSim.statNames && BuildSim.statNames[k]) || k;
                        const safeName = Utils.escapeHtml(name);
                        const curNote = preview !== curEn
                            ? ` <span class="hp-stat-cur" title="Сейчас, на +${curEn}">(+${curEn}: ${this.enchantStat(b, curEn, k)})</span>`
                            : '';
                        // v11.7.1: цвет строго по знаку, а не «зелёный для любого
                        // отличия». Плюс — зелёный, минус — красный, ноль — без бейджа.
                        const gainCls = gain > 0 ? 'up' : (gain < 0 ? 'down' : 'same');
                        const gainTxt = gain > 0 ? `+${gain}` : (gain < 0 ? `−${Math.abs(gain)}` : '');
                        return `<div class="hp-stat-row">
                            <span class="hp-stat-name" title="${safeName}">${safeName}</span>
                            <span class="hp-stat-val">${b} → <b>${fin}</b>${gain !== 0 ? ` <span class="hp-stat-gain ${gainCls}">${gainTxt}</span>` : ''}${curNote}</span>
                        </div>`;
                    }).join('') || '<div class="hp-cost-sub">У предмета нет характеристик.</div>';

                    // Пресеты уровня просмотра. v11.7.1: пройденные уровни
                    // больше НЕ блокируются — их можно смотреть (класс .done
                    // лишь визуально помечает «уже пройдено»).
                    const presets = [0, 4, 7, 10, 15].map(t => {
                        const done = t > 0 && t <= curEn;
                        const active = t === preview;
                        return `<button type="button" class="hp-target-preset${active ? ' active' : ''}${done ? ' done' : ''}"`
                            + ` data-target="${t}" title="Показать +${t}">+${t}</button>`;
                    }).join('');

                    // v11.6.3: штраф/фокус и привязка выбранного предмета.
                    // Фокус (shield + cloth) для магов/жрецов считается по
                    // cloth-ветке — штраф за «щит» им не начисляется.
                    // v11.7: оффхенд-оружие (shield + role) сравнивается с
                    // классом героя напрямую.
                    const gp = this.gearPenaltyFor(h.role, item);
                    const statLabel = ['mage', 'priest', 'necromancer'].includes(h.role) ? 'маг. урона' : 'физ. урона';
                    const offhandFor = (gp.offhand && GAME_DATA.CLASS_NAMES[item.role]) || item.role || '';
                    let gearNote = '';
                    if (gp.bad) {
                        const why = gp.focus ? ' (фокус — только для ткани)'
                            : (gp.offhand && offhandFor ? ` (оффхенд класса «${offhandFor}»)` : '');
                        gearNote = `<div style="font-size:11px; color:#ffb3a0; margin-top:2px;">⚠ Не для вашего класса: −${gp.pct}% ${statLabel}${Utils.escapeHtml(why)}</div>`;
                    } else if (gp.focus) {
                        gearNote = `<div style="font-size:11px; color:#8ff2a0; margin-top:2px;">✦ Магический фокус: вторая рука, штрафа для ткани нет</div>`;
                    } else if (gp.offhand) {
                        gearNote = `<div style="font-size:11px; color:#8ff2a0; margin-top:2px;">⚔ Оффхенд-оружие${offhandFor ? ' класса «' + Utils.escapeHtml(offhandFor) + '»' : ''}: штрафа нет</div>`;
                    }
                    const boundNote = isBoundItem(item)
                        ? `<div style="font-size:11px; color:#ffb3a0; margin-top:2px;">🔒 ${BOUND_LINE}</div>`
                        : '';
                    // v11.7.1: галочка/предупреждение — по ВЫБРАННОМУ предмету
                    // (gp), а не общей плашкой по надетым вещам героя.
                    const itemIconBadge = gp.bad
                        ? `<span class="hp-gear-pill bad" title="Не подходит классу: −${gp.pct}% ${statLabel}">⚠</span>`
                        : `<span class="hp-gear-pill ok" title="Подходит вашему классу">✓</span>`;
                    // Мини-арт предмета в шапке (нативный LGInventory.art).
                    const headArt = this.renderItemArt(item);

                    // Клик по строке/пресету перерисовывает колонки целиком —
                    // сохраняем прокрутку списка уровней, иначе таблица прыгает
                    // наверх при каждом выборе цели. 11.6.5f.1: таблица теперь
                    // скроллится внутри .hp-ench-right, поэтому помним и его.
                    const keepScroll = outEl.scrollTop;
                    const keepTableScroll = outEl.querySelector('.hp-ench-right')?.scrollTop || 0;
                    outEl.innerHTML = `
                        <div style="background:#26202e; border:1px solid #44374a; border-radius:6px; padding:8px 12px; margin-bottom:10px; font-size:12px;">
                            <div class="hp-item-head">
                                <span class="hp-item-head-art">${headArt || '📦'}</span>
                                <div>
                                    <b style="color:#ffcf6a;">${Utils.escapeHtml(item.name)}</b>${itemIconBadge} (v: ${item.v}, тек: +${curEn})${gearNote}${boundNote}
                                </div>
                            </div>
                        </div>
                        <div class="hp-ench-split">
                            <!-- 11.6.5f.1: карточка цели — СЛЕВА (класс .hp-ench-left,
                                 flex 1 1 40%), таблица уровней — СПРАВА (.hp-ench-right). -->
                            <div class="hp-ench-left">
                                <div class="hp-target-head">
                                    <div class="hp-target-title">Просмотр: <b>+${preview}</b></div>
                                    <div class="hp-target-presets">${presets}</div>
                                </div>
                                <div class="hp-target-section">
                                    <div class="hp-target-sub">Характеристики на +${preview}</div>
                                    <div class="hp-stat-grid">${statHtml}</div>
                                </div>
                                <div class="hp-target-section">
                                    <div class="hp-target-sub">Итоговая стоимость (ожидаемо)</div>
                                    <div class="hp-cost-total">${costTotal}</div>
                                    <div class="hp-cost-min">Минимум без промахов: ${costMin}</div>
                                    <div class="hp-cost-sub">${rangeText} · попыток: ${attemptsStr}</div>
                                    <div class="hp-cost-row">⭐ Звёзды: ${starsUsed} шт. · 🌐 Сферы: ${spheresUsed} шт.${costResources > 0
                                        ? ` — ${Utils.formatMoney(costResources)}`
                                        : ''}</div>
                                </div>
                            </div>
                            <div class="hp-ench-rightcol">
                                <div class="hp-ench-right">
                                    <table class="hp-ench-table">
                                        <thead><tr>
                                            <th>Уровень</th>
                                            <th>Шанс</th>
                                            <th>Бонус</th>
                                            <th>Попытка</th>
                                            <th>Усилители</th>
                                            <th>Статы</th>
                                        </tr></thead>
                                        <tbody>${rows}</tbody>
                                    </table>
                                </div>
                                <!-- v11.7.0: компактная справка справа снизу под
                                     таблицей +0…+15 (вместо полосы нотации). -->
                                <div class="hp-ench-hint">
                                    <div class="hp-ench-hint-prices">${this.matsPriceHtml()}</div>
                                    <div>Попытка = <code>max(priceMin, round(v × price% / 100))</code> из живой таблицы <code>LG_GAME_DATA.enchant</code>.</div>
                                    <div>«Ожидаемо» = стоимость шагов ${rangeText} с ⭐/🌐 × матожидание попыток (100 / шанс).</div>
                                    <div>Вторичные статы (крит, уклонение, пробивание…) получают ¼ бонуса заточки (enchK = 0.25).</div>
                                </div>
                            </div>
                        </div>
                    `;
                    outEl.scrollTop = keepScroll;
                    const tableWrap = outEl.querySelector('.hp-ench-right');
                    if (tableWrap) tableWrap.scrollTop = keepTableScroll;

                    // v11.7.1: кнопки-переключатели ресурсов ⭐/🌐. Всплытие
                    // гасим, иначе клик по кнопке сменил бы уровень просмотра.
                    outEl.querySelectorAll('.hp-mat-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const lv = +btn.dataset.lv;
                            if (!Number.isFinite(lv) || lv < 1) return;
                            const map = btn.classList.contains('star') ? this.allocatedStars : this.allocatedSpheres;
                            if (map[lv]) delete map[lv];
                            else map[lv] = true;
                            renderTable();
                        });
                    });

                    // v11.7.1: клик по любой строке +0…+15 выбирает уровень
                    // ПРОСМОТРА (в том числе ниже текущей заточки), а не только
                    // цель впереди. targetLevel держим синхронным.
                    outEl.querySelectorAll('.hp-ench-row').forEach(tr => {
                        tr.addEventListener('click', (e) => {
                            if (e.target.closest('button, input, label')) return;
                            const lv = +tr.dataset.lv;
                            if (!Number.isFinite(lv) || lv < 0) return;
                            this.previewLevel = lv;
                            this.targetLevel = lv;
                            renderTable();
                        });
                    });

                    // Пресеты уровня просмотра (+0/+4/+7/+10/+15).
                    outEl.querySelectorAll('.hp-target-preset').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const lv = +btn.dataset.target;
                            if (!Number.isFinite(lv) || lv < 0) return;
                            this.previewLevel = lv;
                            this.targetLevel = lv;
                            renderTable();
                        });
                    });
                };

                // ============================================================
                // v11.7.0: ВКЛАДКА «👗 ПРИМЕРКА» + ПАНЕЛЬ СТАТОВ
                //
                // Пул примерки — надетое, сумка и склад: uid уникальны за счёт
                // префиксов eq-/bg-/st- из mapItems(), поэтому поиск по строке
                // безопасен.
                // ============================================================
                const fitPool = [];
                for (const key of ['equipped', 'bag', 'storage']) {
                    for (const it of locations[key].items) fitPool.push(it);
                }
                const sideEl = document.getElementById('hp-side');

                // Примерка стартует с ТЕКУЩИХ вещей героя: игрок сразу видит
                // нулевую дельту и меняет только то, что хочет примерить.
                const initFitting = () => {
                    this.fitting = {
                        role: h.role || '',
                        level: Math.min(50, Math.max(1, +h.level || 1)),
                        useSkills: false,
                        slots: {}
                    };
                    for (const slot of this.FITTING_SLOTS) {
                        const it = equipped.find(x => x.slot === slot.id) || null;
                        this.fitting.slots[slot.id] = {
                            uid: it ? String(it.uid) : '',
                            en: it ? Math.min(15, Math.max(0, Math.round(+(it.en ?? it.e ?? 0)))) : 0
                        };
                    }
                    const roleSel = document.getElementById('hp-fit-role');
                    if (roleSel) roleSel.value = this.fitting.role;
                    const lvlInp = document.getElementById('hp-fit-level');
                    if (lvlInp) lvlInp.value = String(this.fitting.level);
                    const chk = document.getElementById('hp-fit-skills');
                    if (chk) chk.checked = false;
                };

                // Порядок строк как в нативной карточке героя: сначала основные
                // характеристики, затем вторичные (третий элемент — единица).
                const SIDE_ROWS = [
                    ['hp', 'Макс. HP', ''], ['atk', 'Физ. урон', ''], ['mag', 'Магия', ''], ['def', 'Броня', ''],
                    ['crit', 'Крит', '%'], ['critDmg', 'Сила крита', '%'], ['dodge', 'Уклонение', '%'],
                    ['pierce', 'Пробивание', '%'], ['healPow', 'Сила лечения', '%'],
                    ['luck', 'Удача', '%'], ['resist', 'Сопротивление', '']
                ];

                /**
                 * Постоянная правая панель: «Текущий герой → Примерка» по всем
                 * характеристикам + боевая мощь, штраф экипировки и множитель
                 * крита (1 + critDmg/100). Δ: +N зелёным, −N красным.
                 */
                const renderSide = () => {
                    if (!sideEl) return;
                    const cur = this.heroCurrentStats(h);
                    let fit = null;
                    try { fit = this.fittingResult(h, fitPool); } catch (e) { fit = null; }
                    const delta = (before, after) => {
                        const d = Math.round((after - before) * 10) / 10;
                        const cls = d > 0 ? 'up' : (d < 0 ? 'down' : 'same');
                        const txt = d > 0 ? `+${d}` : (d < 0 ? `−${Math.abs(d)}` : '±0');
                        return `<span class="hp-side-delta ${cls}">${txt}</span>`;
                    };
                    const statRow = ([k, label, suf]) => {
                        const before = +(cur.stats[k] || 0);
                        const after = fit ? +(fit.stats[k] || 0) : before;
                        return `<div class="hp-side-row"><span class="hp-side-name">${label}</span>`
                            + `<span class="hp-side-vals">${before}${suf} → <b>${after}${suf}</b></span>`
                            + delta(before, after) + '</div>';
                    };
                    const pwBefore = cur.power;
                    const pwAfter = fit ? fit.power : pwBefore;
                    const pen = fit ? fit.penalty : cur.penalty;
                    const critMul = fit ? fit.critMul : cur.critMul;
                    const skillsNote = !this.fitting.useSkills ? ''
                        : (fit && fit.skillsUsed ? ' · 🌟 созвездие учтено' : ' · 🌟 созвездие недоступно');
                    // v11.7.1: нативный рейтинг ⚔ (если сервер его отдал) и
                    // подробная расшифровка индекса билда для title.
                    const nativePw = this.nativeHeroPower(h);
                    const pwTipBefore = this.powerTooltip(cur.stats, cur.enTotal, pwBefore, nativePw);
                    const pwTipAfter = fit ? this.powerTooltip(fit.stats, fit.enTotal, pwAfter, nativePw) : pwTipBefore;
                    const pwTip = `Сейчас:\n${pwTipBefore}` + (fit ? `\n\nПримерка:\n${pwTipAfter}` : '');
                    sideEl.innerHTML = `<div class="hp-side-head">Характеристики</div>
                        <div class="hp-side-cols"><span>Параметр</span><span>Сейчас → Примерка</span><span>Δ</span></div>
                        ${SIDE_ROWS.map(statRow).join('')}
                        <div class="hp-side-sep"></div>
                        <div class="hp-side-row strong" title="${Utils.escapeHtml(pwTip)}"><span class="hp-side-name">Индекс билда <span class="hp-side-info" aria-hidden="true">ⓘ</span></span>`
                        + `<span class="hp-side-vals">${pwBefore} → <b>${pwAfter}</b></span>${delta(pwBefore, pwAfter)}</div>`
                        + (nativePw ? `<div class="hp-side-row" title="Рейтинг силы героя ⚔ из карточки персонажа. Его считает сервер; на индекс билда он не влияет."><span class="hp-side-name">Рейтинг игры ⚔</span><span class="hp-side-vals">${nativePw}</span><span class="hp-side-delta same"></span></div>` : '')
                        + `<div class="hp-side-row"><span class="hp-side-name">Штраф экипировки</span>`
                        + `<span class="hp-side-vals">${pen ? '−' + pen + '%' : 'нет'}</span><span class="hp-side-delta same"></span></div>
                        <div class="hp-side-row"><span class="hp-side-name">Множитель крита</span>`
                        + `<span class="hp-side-vals">×${critMul.toFixed(2)}</span><span class="hp-side-delta same"></span></div>
                        <div class="hp-side-foot">Заточка: Σ +${fit ? fit.enTotal : cur.enTotal} ур. · +2 к индексу за уровень${skillsNote} · индекс ≠ ⚔ в профиле</div>`;
                };

                /**
                 * Строки примерки: слот -> предмет (optgroup по локациям) и
                 * уровень заточки +0…+15. Любое изменение сразу обновляет
                 * боковую панель, таблица заточки не перерисовывается.
                 */
                const renderFit = () => {
                    const rowsEl = document.getElementById('hp-fit-rows');
                    if (!rowsEl) return;
                    rowsEl.innerHTML = this.FITTING_SLOTS.map(slot => {
                        const sel = this.fitting.slots[slot.id] || { uid: '', en: 0 };
                        const groups = ['equipped', 'bag', 'storage'].map(key => {
                            const list = locations[key].items.filter(it => it.slot === slot.id);
                            if (!list.length) return '';
                            const opts = list.map(it => {
                                const on = String(it.uid) === String(sel.uid) ? ' selected' : '';
                                const en = +(it.en ?? it.e ?? 0);
                                const label = `${it.name || '—'}${en > 0 ? ` +${en}` : ''} · ${Utils.formatMoney(it.v || 0)}`;
                                return `<option value="${Utils.escapeHtml(String(it.uid))}"${on}>${Utils.escapeHtml(label)}</option>`;
                            }).join('');
                            return `<optgroup label="${Utils.escapeHtml(locations[key].name)}">${opts}</optgroup>`;
                        }).join('');
                        const enOpts = Array.from({ length: 16 }, (_, i) =>
                            `<option value="${i}"${i === (+sel.en || 0) ? ' selected' : ''}>+${i}</option>`).join('');
                        const chosen = fitPool.find(x => String(x.uid) === String(sel.uid));
                        const gp = chosen ? this.gearPenaltyFor(this.fitting.role, chosen) : null;
                        const warn = (gp && gp.bad)
                            ? `<span class="hp-gear-pill bad" title="Не для класса: −${gp.pct}%">⚠</span>`
                            : '';
                        return `<div class="hp-fit-row">
                            <span class="hp-fit-slot">${slot.icon} ${slot.name}${warn}</span>
                            <select class="hp-fit-item" data-slot="${slot.id}" title="Предмет из надетого, сумки или склада">
                                <option value="">— пусто —</option>${groups}
                            </select>
                            <select class="hp-fit-en" data-slot="${slot.id}" title="Уровень заточки (0…15)">${enOpts}</select>
                        </div>`;
                    }).join('');

                    rowsEl.querySelectorAll('.hp-fit-item').forEach(el => {
                        el.addEventListener('change', () => {
                            const slot = el.dataset.slot;
                            if (!this.fitting.slots[slot]) this.fitting.slots[slot] = { uid: '', en: 0 };
                            this.fitting.slots[slot].uid = el.value;
                            // Перерисовка нужна ради ⚠ «не для класса» у слота.
                            renderFit();
                            renderSide();
                        });
                    });
                    rowsEl.querySelectorAll('.hp-fit-en').forEach(el => {
                        el.addEventListener('change', () => {
                            const slot = el.dataset.slot;
                            if (!this.fitting.slots[slot]) this.fitting.slots[slot] = { uid: '', en: 0 };
                            this.fitting.slots[slot].en = Math.min(15, Math.max(0, +el.value || 0));
                            renderSide();
                        });
                    });
                };

                // ── Управление примеркой: класс, уровень, созвездие, сброс ──
                document.getElementById('hp-fit-role')?.addEventListener('change', (e) => {
                    this.fitting.role = e.target.value || h.role || '';
                    renderFit();   // ⚠ «не для класса» зависит от класса
                    renderSide();
                });
                document.getElementById('hp-fit-level')?.addEventListener('input', (e) => {
                    const lv = Math.min(50, Math.max(1, Math.round(+e.target.value || 1)));
                    this.fitting.level = lv;
                    renderSide();
                });
                // blur возвращает зажатую границу (1…50), если ввели 0 или 99.
                document.getElementById('hp-fit-level')?.addEventListener('blur', (e) => {
                    e.target.value = String(this.fitting.level);
                });
                document.getElementById('hp-fit-skills')?.addEventListener('change', (e) => {
                    this.fitting.useSkills = !!e.target.checked;
                    renderSide();
                });
                document.getElementById('hp-fit-reset')?.addEventListener('click', () => {
                    initFitting();
                    renderFit();
                    renderSide();
                });

                // 11.6.2d: при входе на вкладку «Заточка» тянем цены звёзды и
                // сферы с аукциона и перерисовываем таблицу. Пока ответа нет (или
                // если сервер молчит) в UI стоят базовые цены кузнеца.
                // refreshMaterialMedians троттлит запросы (5 минут) и никогда не
                // реджектится, поэтому .then срабатывает и при ошибке.
                onEnchTabOpen = () => {
                    this.refreshMaterialMedians().then(() => {
                        // Модалку могли закрыть, пока ходили на сервер.
                        if (!outEl || !outEl.isConnected) return;
                        renderTable();
                    });
                };

                // initialTab: 'build' (по умолчанию) | 'fit' | 'ench'; 'arena'
                // уже нормализован в 'build'. «Билды» активны в разметке сразу.
                if (wanted === 'ench' || wanted === 'hero-ench') activateTab('hero-ench');
                else if (wanted === 'fit' || wanted === 'hero-fit') activateTab('hero-fit');

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
                        // v11.7.1: арт берём нативным рендером игры
                        // (LGInventory.art) — он рисует и легендарки вроде
                        // «Нимба из мяты», которые раньше падали в эмодзи.
                        const art = this.renderItemArt(it);
                        const border = isSel ? '2px solid #caa55c' : '1px solid #44374a';
                        const bg = isSel ? 'rgba(202,165,92,0.15)' : '#1e1724';
                        // v11.6.3: 🔒 — легендарка привязана (не передаётся),
                        // ✦ — магический фокус (вторая рука, shield + cloth),
                        // ⚔ — оффхенд-оружие (вторая рука, shield + role).
                        const bound = isBoundItem(it);
                        const focus = isFocusItem(it);
                        const offhand = isOffhandItem(it);
                        const offhandRole = (offhand && GAME_DATA.CLASS_NAMES[it.role]) || it.role || '';
                        const badges = (bound ? `<span title="${BOUND_LINE}" style="position:absolute; top:2px; right:2px; font-size:10px;">🔒</span>` : '')
                            + (focus ? `<span title="Магический фокус" style="position:absolute; top:2px; left:2px; font-size:10px;">✦</span>` : '')
                            + (offhand ? `<span title="Оффхенд-оружие${offhandRole ? ': ' + Utils.escapeHtml(offhandRole) : ''}" style="position:absolute; top:2px; left:2px; font-size:10px;">⚔</span>` : '');
                        const tip = `${it.name}${bound ? ' · ' + BOUND_LINE : ''}${focus ? ' · магический фокус' : ''}${offhand ? ' · оффхенд' + (offhandRole ? ' для класса «' + offhandRole + '»' : '') : ''}`;

                        // 11.6.5f.1: габариты плитки (min-width/padding, 24px арт)
                        // заданы в CSS — .hp-item-grid .hp-item-card/.hp-item-art.
                        // Инлайн оставлен только для цветов выбранного предмета.
                        return `<div class="hp-item-card" data-uid="${Utils.escapeHtml(it.uid)}" title="${Utils.escapeHtml(tip)}" style="position:relative; cursor:pointer; display:flex; flex-direction:column; align-items:center; background:${bg}; border:${border}; border-radius:6px; transition:all 0.15s;">
                            ${badges}
                            <div class="hp-item-art">
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

                // v11.7.0: переключатель «📊 Идеально / 🧠 С учётом шансов»
                // удалён — «Итоговая стоимость» всегда ожидаемая (renderTable),
                // поэтому обработчиков .hp-mode-btn больше нет.

                initFitting();
                renderFit();
                renderSide();
                renderGrid();
                renderTable();

                // 11.6.2d: прогреваем медианы аука сразу при открытии окна —
                // тогда при переключении на «Заточку» цены уже актуальные.
                // Запрос троттлится (MEDIANS_TTL), префетч при ошибке молчит.
                this.refreshMaterialMedians();

            } catch (err) {
                dbg('[HERO PLANNER] Ошибка:', err);
                UI.showModal(`<h2>❌ Ошибка <button class="custom-close" id="custom-close-btn">✖</button></h2><p>${Utils.escapeHtml(err.message)}</p>`);
            }
        }
    };
