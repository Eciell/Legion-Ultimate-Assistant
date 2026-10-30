    // ============================================================
    // 0.4. АРТ ПРЕДМЕТОВ И ДЕКОРАЦИЯ UI (core/utils-art.js)
    // isRealItemSvg остаётся отдельной функцией: она нужна и как метод
    // Utils.isRealItemSvg, и как локальный хелпер внутри модуля.
    // ============================================================
    // Реальный SVG-арт предмета.
    // Заглушка LGInventory.art / ctx.art = один <rect> с заливкой (коричневый
    // квадрат в .b-lot-art), поэтому требуем:
    //   1) длину ≥ 100 байт (реальные арты заметно больше);
    //   2) <path> ИЛИ ≥ 2 фигуры circle/ellipse/polygon/polyline/line.
    // <rect> без <path> и без других фигур не проходит никогда.
    function isRealItemSvg(svg) {
        if (!svg || typeof svg !== 'string') return false;
        if (svg.length < 100) return false;
        const hasPath = /<path[\s\/>]/i.test(svg);
        const shapes = svg.match(/<(circle|ellipse|polygon|polyline|line)[\s\/>]/gi);
        const shapeCount = shapes ? shapes.length : 0;
        return hasPath || shapeCount >= 2;
    }

    const UtilsArt = {
        isRealItemSvg,
        // SVG арт предмета. Сначала контексты игры (в аукционе это самый
        // надёжный источник), затем библиотека инвентаря. Заглушку-<rect>
        // отсекает isRealItemSvg().
        getItemArtSvg(lot, def) {
            try {
                lot = lot || {};
                const it = { id: lot.i, ...(def || {}), en: +lot.en || 0 };

                // ВАЖНО: в песочнице Tampermonkey (после @grant) window не видит
                // объекты страницы. Используем unsafeWindow (или G), если он доступен.
                const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

                // 1. Контексты игры: аукцион / город / шахта.
                // Вызов каждого контекста изолирован: упавший art() не должен
                // обрывать цепочку и лишать предмет картинки.
                const ctxs = [
                    G.__lgAucContext,
                    G.__lgCityContext,
                    G.__lgMineContext,
                    G.X,        // глобальный арт-резолвер игры
                    G.LGtine,   // запасной глобальный резолвер
                    { art: G.art, owner: G },     // глобальный метод игры
                    { art: G.fig, owner: G },     // запасной
                    { art: G.doodle, owner: G }   // запасной
                ].filter(Boolean);
                for (const ctx of ctxs) {
                    if (!ctx || typeof ctx.art !== 'function') continue;
                    let svg = '';
                    // owner нужен, чтобы G.art() вызывался с this === G
                    try { svg = ctx.art.call(ctx.owner || ctx, it); } catch (e) { svg = ''; }
                    if (isRealItemSvg(svg)) return svg;
                }

                // 2. Фолбэк на библиотеку инвентаря
                const inv = G.LGInventory || G.LGItems || window.LGInventory;
                if (inv && typeof inv.art === 'function') {
                    let svg = '';
                    try { svg = inv.art(it); } catch (e) { svg = ''; }
                    if (isRealItemSvg(svg)) return svg;
                }
            } catch (e) {}
            return '';
        },
        // Арт предмета: реальный SVG → официальная иконка игры → эмодзи.
        // SVG идёт первым: именно так рисует нативный аукцион, и при полном
        // def (slot/look/rarity) LGInventory.art даёт настоящую картинку.
        // Заглушку-<rect> отсекает isRealItemSvg().
        getItemArtHtml(lot, def) {
            lot = lot || {};

            // 1. Настоящий SVG через контексты игры / LGInventory.art.
            // Приоритет над MDDoodle-иконкой: именно так рисует нативный
            // аукцион, и при полном def (slot/look/rarity) SVG гарантирован.
            const svg = this.getItemArtSvg(lot, def);
            if (svg) return svg;

            // 2. Официальная иконка из игры (MDDoodle) — если SVG не получился
            const icon = this.getItemIcon(lot.i);
            if (icon && icon.length > 5) {
                return `<img src="${this.safeUrl(icon)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;display:block;" onerror="this.style.display='none'">`;
            }

            // 3. Эмодзи по слоту/имени
            const slot = (def && def.slot) || '';
            const name = String((def && def.name) || lot.name || lot.i || '').toLowerCase();
            let ico = '📦';
            if (slot === 'weapon') ico = '⚔️';
            else if (slot === 'armor') ico = '🛡️';
            else if (slot === 'shield') ico = '🛡️';
            else if (slot === 'helmet') ico = '🪖';
            else if (slot === 'trinket') ico = '📿';
            else if (slot === 'food') ico = '🍖';
            else if (slot === 'potion') ico = '🧪';
            else if (slot === 'scroll') ico = '📜';
            else if (slot === 'material') ico = '💎';
            else if (/шлем|каск|колпак|шапк|тиар|корон/i.test(name)) ico = '🪖';
            else if (/меч|кинжал|топор|молот|булав|посох|копьё|лук|арбалет|гладиус/i.test(name)) ico = '⚔️';
            else if (/рогатк|снаряд|праща/i.test(name)) ico = '🏹';
            else if (/брон|доспех|латы|мантия|роба|куртка/i.test(name)) ico = '🛡️';
            else if (/щит/i.test(name)) ico = '🛡️';
            else if (/амулет|кольцо|подвеск|оберег/i.test(name)) ico = '📿';
            else if (/вобл|рыб|мясо|хлеб|яблоко|пирог|сыр|корм|еда/i.test(name)) ico = '🐟';
            else if (/зелье|эликсир|напиток/i.test(name)) ico = '🧪';
            else if (/свиток|печать|грамот/i.test(name)) ico = '📜';
            else if (/звезд|сфер|кристалл|камень|руда|слиток/i.test(name)) ico = '💎';
            return `<span style="font-size:22px;line-height:1;user-select:none;">${ico}</span>`;
        },
        // Заменить текст монет на иконки. Идём по текстовым узлам, чтобы
        // не потерять вложенные значения (например, «(цена за штуку)»).
        decorateMoneyText(el) {
            if (!el || el.hasAttribute('data-lg-money')) return;
            el.setAttribute('data-lg-money', '1');

            const doc = el.ownerDocument || document;
            const showText = (typeof NodeFilter !== 'undefined') ? NodeFilter.SHOW_TEXT : 4;
            let walker = null;
            try { walker = doc.createTreeWalker(el, showText, null); } catch (e) { walker = null; }

            if (!walker) {
                const total = this.parseCoinsText(el.textContent || '');
                if (total > 0) el.innerHTML = this.formatCoinsHtml(total);
                return;
            }

            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);

            for (const tn of nodes) {
                const amount = this.parseCoinsText(tn.nodeValue);
                if (amount <= 0) continue;
                const holder = doc.createElement('span');
                holder.innerHTML = this.formatCoinsHtml(amount);
                const coinEl = holder.firstElementChild;
                if (coinEl && tn.parentNode) tn.parentNode.replaceChild(coinEl, tn);
            }
        },
        // Обогатить строки таблицы аукциона: арт + иконки монет.
        // id/имя предмета приходят из data-атрибутов строки (auction.js),
        // data-lg-lot — метка «уже обработано».
        enhanceAuctionRows(container, itemsMap) {
            if (!container) return;
            const rows = container.querySelectorAll('tr:not([data-lg-lot])');
            if (!rows || !rows.length) return;

            rows.forEach(row => {
                row.setAttribute('data-lg-lot', '1');
                const cells = row.querySelectorAll('td');
                if (cells.length < 4) return; // строка «Ничего не найдено»

                const itemCell = cells[0];
                if (itemCell.querySelector('.b-lot-art')) return;

                const itemId = row.getAttribute('data-lot-id') || '';
                const lotName = row.getAttribute('data-lot-name') || '';
                // Полный предмет из itemsMap: {name, slot, look, rarity, ...}.
                // Без slot LGInventory.art падает в <rect fill="#a0703a">, и
                // isRealItemSvg отбрасывает заглушку -> эмодзи.
                const def = (itemsMap && itemId && itemsMap[itemId]) ? { ...itemsMap[itemId] } : { name: lotName };

                const artDiv = document.createElement('div');
                artDiv.className = 'b-lot-art';

                const existingImg = itemCell.querySelector('img');
                if (existingImg && existingImg.src && !existingImg.src.endsWith('/')) {
                    // Иконку игры переносим в арт-бокс (размеры задаёт CSS)
                    const cloned = existingImg.cloneNode(true);
                    try { cloned.removeAttribute('style'); } catch (e) {}
                    artDiv.appendChild(cloned);
                    existingImg.remove();
                } else {
                    if (existingImg) existingImg.remove();
                    artDiv.innerHTML = this.getItemArtHtml({ i: itemId, name: lotName }, def);
                }
                artDiv.title = lotName;

                itemCell.style.display = 'flex';
                itemCell.style.alignItems = 'center';
                itemCell.style.gap = '8px';
                itemCell.insertBefore(artDiv, itemCell.firstChild);

                // Декорируем цены
                for (let i = 2; i <= 4 && i < cells.length; i++) {
                    this.decorateMoneyText(cells[i]);
                }
            });
        },
        // Обогатить лоты в досье игрока (арт + иконки монет).
        // id берём из data-lot кнопки «Купить», имя — из карточки.
        enhanceDossierLots(container, itemsMap) {
            if (!container) return;
            container.querySelectorAll('.dossier-buy-btn').forEach(btn => {
                if (btn.hasAttribute('data-lg-lot')) return;
                btn.setAttribute('data-lg-lot', '1');

                const card = btn.parentElement && btn.parentElement.parentElement;
                if (!card) return;

                const lotId = btn.getAttribute('data-lot') || '';
                const lotName = ((card.querySelector('span[style*="font-weight:bold"], b') || {}).textContent || '').trim();
                const price = +btn.getAttribute('data-price') || 0;

                // data-lot — это id ЛОТА (напр. L2l28g), не id предмета.
                // Находим лот в Players._lastLots, берём l.i (id предмета) и
                // полный def из itemsMap. Без slot LGInventory.art вернёт
                // <rect fill="#a0703a">, и isRealItemSvg() отбросит заглушку.
                let itemId = lotId;
                let def = { name: lotName };
                try {
                    const lots = (typeof Players !== 'undefined' && Array.isArray(Players._lastLots)) ? Players._lastLots : [];
                    const lot = lots.find(x => x && x.id === lotId) || lots.find(x => x && x.i === lotId);
                    if (lot && lot.i) itemId = lot.i;
                    if (itemsMap && itemId && itemsMap[itemId]) def = { ...itemsMap[itemId] };
                } catch (e) {}

                const artSlot = card.querySelector('.b-lot-art');
                if (!artSlot) {
                    const artDiv = document.createElement('div');
                    artDiv.className = 'b-lot-art';

                    const existingImg = card.querySelector('img');
                    if (existingImg && existingImg.src && !existingImg.src.endsWith('/')) {
                        const cloned = existingImg.cloneNode(true);
                        try { cloned.removeAttribute('style'); } catch (e) {}
                        artDiv.appendChild(cloned);
                        existingImg.remove();
                    } else {
                        if (existingImg) existingImg.remove();
                        artDiv.innerHTML = this.getItemArtHtml({ i: itemId, name: lotName }, def);
                    }
                    artDiv.title = lotName;

                    card.insertBefore(artDiv, card.firstChild);
                }

                if (price > 0) {
                    const priceEl = card.querySelector('span[style*="color:#ffd700"]');
                    if (priceEl) priceEl.innerHTML = this.formatCoinsHtml(price);
                }
            });
        },
        getItemName(id, itemsMap = null) {
            if (!id) return '—';
            try {
                if (itemsMap && itemsMap[id]?.name) return itemsMap[id].name;
                const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
                const mdName = G.MDDoodle?.names?.[id] || G.MDDoodle?.names?.cats?.items?.[id]?.name;
                if (mdName) return mdName;
            } catch (e) {}

            const KNOWN_ITEMS = {
                enchant_star: 'Звезда заточки',
                star: 'Звезда',
                sphere: 'Сфера',
                aurus: 'Аурус',
                seal_fire: 'Печать огня',
                seal_water: 'Печать воды',
                seal_earth: 'Печать земли',
                seal_air: 'Печать воздуха',
                scroll_tp: 'Свиток телепортации',
                scroll_res: 'Свиток воскрешения',
                potion_hp: 'Зелье здоровья',
                potion_mp: 'Зелье маны',
                ore_iron: 'Железная руда',
                ore_gold: 'Золотая руда',
                gem_ruby: 'Рубин',
                gem_sapphire: 'Сапфир',
                gem_emerald: 'Изумруд',
                gem_diamond: 'Алмаз'
            };
            if (KNOWN_ITEMS[id]) return KNOWN_ITEMS[id];

            if (typeof id === 'string' && id.includes('_')) {
                return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            }
            return String(id);
        },
        // Умный парсер: определяет слот, редкость и класс по ID предмета.
        // Вынесено из modules/auction.js (v11.6.0, этап 4): мета нужна и арту
        // строк (enhanceAuctionRows/enhanceDossierLots), и сканеру аукциона,
        // поэтому живёт в core рядом с getItemName/getItemIcon.
        // В песочнице window — прокси без игровых объектов, справочник читаем
        // из unsafeWindow (G), как это делает getItemName.
        getItemMeta(id, rarityHint = '') {
            if (!id) return { slot: '', rarity: '', role: '' };

            let item = {};
            try {
                const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
                item = G.MDDoodle?.names?.cats?.items?.[id] || {};
            } catch(e) {}

            let slot = item.slot || '';
            // Приоритет: серверное значение лота → справочник MDDoodle → эвристика по ID
            let rarity = (rarityHint ? String(rarityHint).toLowerCase().trim() : '') || item.rarity || '';
            let role = item.role || '';

            // 1. Определяем слот (тип снаряжения)
            if (!slot) {
                if (id.match(/(sword|club|pitchfork|hatchet|spear|hammer|mace|gladius|bow|crook|staff|censer|axe|spatha|blade|dagger|stiletto|wand|rod|shiv|dirk|kris|fang|scepter|broom|fork)/)) slot = 'weapon';
                else if (id.match(/(lorica|robe|armor|jacket|mantle|cuirass|chainmail|segmentata|shroud|vest|cloak|cassock|jerkin|leathers)/)) slot = 'armor';
                else if (id.match(/(galea|hat|cap|helm|crown|hood|mask|tiara|head|beret|colpak)/)) slot = 'helmet';
                else if (id.match(/(shield|buckler|scutum)/)) slot = 'shield';
                else if (/^seal_/i.test(id) || /печать/i.test(id)) slot = 'scroll';
                else if (id.match(/(amulet|charm|bead|coin|tooth|ring|pendant|seal|halo|lucky|ear|horn|tear)/)) slot = 'trinket';
                else if (id.match(/(potion|apple|pear|pretzel|bread|kvass|cheese|pie|ham|roast|tea|stew|candy|milk)/)) slot = 'food';
                else if (id.match(/(star|sphere|aurus)/)) slot = 'material';
                else if (id.match(/(scroll)/)) slot = 'scroll';
            }

            // 2. Определяем редкость
            if (!rarity) {
                if (id.match(/(legendary|aquila|diana|storm_heart|vesta|orcus|sol_hammer|dragon_scale|star_mantle|triumph|phoenix|mars_horn|hadrian|jack_lantern|laverna|metamorph)/)) rarity = 'legendary';
                else if (id.match(/(epic|_epic)/)) rarity = 'epic';
                else if (id.match(/(rare|mercury|crypt|lich|apollo|gladius|spatha|lorica|galea|scutum|storm_staff|centurion|legate|champion|warhammer|triarius|assassin|retiarius|longbow|sagittarius|ember|elder|gold_censer|tower_shield|hoplite|spiked|stargazer|crested|horned|priest_tiara|wolfpack|frost_bead|praetorian|pontifex|golden_crown|healer_beads)/)) rarity = 'rare';
                else if (id.match(/(uncommon|sharp|bearded|flanged|composite|yew|silver|iron_|chainmail|chain|leather|adept_robe|adept|hunter_cap|hunter|wizard_hat|wizard|segmentata|scale_armor|sage|archer_charm|legion_charm|miner_helmet|iron_galea)/)) rarity = 'uncommon';
                else rarity = 'common';
            }

            // 3. Определяем класс
            if (!role) {
                if (id.match(/(leg_|gladius|spatha|pitchfork|lorica|galea|scutum|hoplite|segmentata|legion|centurion|hatchet|pilum)/)) role = 'legionary';
                else if (id.match(/(arc_|bow|ranger|marksman|hunter_cap|hunter_armor|yew_bow|composite)/)) role = 'archer';
                else if (id.match(/(mag_|staff|crook|wizard|archmage|stargazer|ember|elder|walking_staff)/)) role = 'mage';
                else if (id.match(/(pri_|censer|priest|pontifex|tiara|healer)/)) role = 'priest';
                else if (id.match(/(rog_|dagger|stiletto|assassin|retiarius|kris|dirk|shiv)/)) role = 'rogue';
                else if (id.match(/(nec_|skull|grimoire|bone|dead|proserpina)/)) role = 'necromancer';
                else if (id.match(/(pal_|holymace|sol_hammer|templar|blessed|dawn_plate|apollo)/)) role = 'paladin';
            }

            return { slot, rarity, role };
        },
        // Иконка предмета: официальные каталоги MDDoodle (icons + категории).
        // В значениях каталогов встречаются и строки-URL, и объекты предметов,
        // поэтому путь к картинке нормализуем.
        getItemIcon(id) {
            try {
                if (!id) return '';
                const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
                const C = G.MDDoodle?.CATALOG;
                if (!C) return '';
                const raw = C.icons?.[id] || C.weapons?.[id] || C.armors?.[id] ||
                            C.shields?.[id] || C.hats?.[id] || C.acc?.[id] || '';
                if (!raw) return '';
                if (typeof raw === 'string') return raw;
                return raw.icon || raw.img || raw.src || raw.url || '';
            } catch (e) { return ''; }
        },
    };
    Object.assign(Utils, UtilsArt);

    // ===== fix: приоритет арта из шахты для обеих сборок =====
    // Раньше патч жил в Personal-модуле miner.js, из-за чего в Ultimate
    // __lgMineContext.art не использовался вовсе. Идемпотентен: повторный
    // запуск (или запуск рядом с другим патчем) не плодит обёртки.
    (function patchMineArtResolver() {
        if (Utils.__mineCtxPatched || typeof Utils.getItemArtSvg !== 'function') return;
        Utils.__mineCtxPatched = true;

        const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        const origGetSvg = Utils.getItemArtSvg.bind(Utils);

        Utils.getItemArtSvg = function (lot, def) {
            try {
                const ctx = G.__lgMineContext;
                if (ctx && typeof ctx.art === 'function') {
                    const l = lot || {};
                    const it = { id: l.i, ...(def || {}), en: +l.en || 0 };
                    const svg = ctx.art(it);
                    if (isRealItemSvg(svg)) return svg;
                }
            } catch (e) {}
            return origGetSvg(lot, def);
        };
    })();
