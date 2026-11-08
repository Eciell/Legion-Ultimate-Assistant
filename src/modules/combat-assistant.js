    // ============================================================
    // 6.6. МОДУЛЬ: БОЕВОЙ АССИСТЕНТ (modules/combat-assistant.js)
    //
    // Подсказки по механикам боссов в походе (патч 11.6.2b): раз в секунду
    // читает состояние похода штатным геттером игры LGQuest._view()
    // (структура — docs/API.md, раздел «Объект состояния похода»).
    // Вывод — поверх экрана: либо красный баннер «НЕ ПИШИ!», либо готовая
    // команда с кнопкой «Вставить в чат».
    //
    // Подключается после core/ui.js и modules/pocket-city.js (SHARED_MODULES
    // в build.js). Игровые объекты берём из G (core/constants.js — это
    // unsafeWindow): после @grant window — песочница, LGQuest в ней не виден.
    // ============================================================
    const CombatAssistant = {
        _el: null,
        _timer: null,
        // Подпись текущей отрисовки: защита от мерцания на каждом тике.
        _currentState: null,

        init() {
            // Повторный init (перезапуск скрипта) не должен плодить таймеры.
            if (this._el) return;
            this._el = document.createElement('div');
            this._el.id = 'lg-combat-assistant';
            document.body.appendChild(this._el);
            this._timer = setInterval(() => this._tick(), 1000);
        },

        // Гасим интервал и DOM при перезапуске скрипта (см. shutdown в main.js),
        // иначе старый таймер продолжал бы тикать рядом с новым.
        destroy() {
            if (this._timer) clearInterval(this._timer);
            this._timer = null;
            if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
            this._el = null;
            this._currentState = null;
        },

        _tick() {
            // Тумблер в настройках аддона (ключ LEGION_COMBAT_ASSIST, дефолт — вкл).
            const enabled = localStorage.getItem('LEGION_COMBAT_ASSIST') !== 'false';
            if (!enabled) {
                this._clear();
                return;
            }

            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const quest = pageWin.LGQuest;
            if (!quest || typeof quest._view !== 'function') {
                this._clear();
                return;
            }

            try {
                const q = quest._view();
                // Ассистент нужен только полноправному участнику похода:
                // party = 'q' (очередь), 'ghost' (призрак), 'out' — не наш бой.
                if (!q || !q.on || q.party !== 'in') {
                    this._clear();
                    return;
                }

                this._render(this._evaluate(q));
            } catch (e) {
                console.warn('[LGU] CombatAssistant error:', e);
            }
        },

        /**
         * Решение по текущему состоянию похода.
         * Порядок приоритетов: смерть -> запрет ввода -> механики -> обычный ход.
         *
         * @param {object} q состояние похода из LGQuest._view()
         * @returns {{action: 'IDLE'|'SILENCE'|'COMMAND', text?: string, hint?: string}}
         */
        _evaluate(q) {
            // 1. Смерть героя. Проверки повторяют deadIn() из site/quest.js:
            //    обычный бой — b.hp === 0 ("dead"), босс — bg.in и bg.my <= 0.
            const isDead = (q.b && q.b.st !== 'end' && q.b.hp === 0) ||
                           (q.bg && q.bg.st !== 'end' && q.bg.in && !(q.bg.my > 0));
            if (isDead) return { action: 'IDLE' };

            // 2. Газ в ловушке: писать нельзя, пока он не рассеется.
            if (q.tr && q.tr.gas && (q.tr.st === 'act' || q.tr.st === 'wait')) {
                return { action: 'SILENCE', text: 'ГАЗ! НЕ ПИШИ!' };
            }

            // 3. Режим тишины босса. Логика 1:1 с sayHush() из site/quest.js:
            //    финт (mech.fake), семейство 'silence' (кроме M94/M55 — там
            //    молчать не нужно) и текстовая подсказка «не пиши / молчите».
            const M = q.bg && q.bg.mech;
            if (M) {
                if (M.fake === true) {
                    return { action: 'SILENCE', text: 'ФИНТ! НЕ ПИШИ!' };
                }
                const silentFam = M.fam === 'silence' && M.id !== 'M94' && M.id !== 'M55';
                const silentTip = /ничего не пиш|молчите|не пишите/i.test(M.tip || '');
                if (silentFam || silentTip) {
                    return { action: 'SILENCE', text: 'ТИШИНА! НЕ ПИШИ!' };
                }
            }

            // 3.1. Финт/тишина на телеграфе обычного боя (docs/API.md: tele.fake,
            //      tele.hush). Писать слово в этом случае запрещено.
            if (q.b && q.b.tele && (q.b.tele.fake === true || q.b.tele.hush === true)) {
                return { action: 'SILENCE', text: 'ФИНТ! НЕ ПИШИ!' };
            }

            // 4. Фонари Джека-Фонарщика: hw.lan.lit — 6 фонарей, false = погас.
            //    Команда зажигает один фонарь, поэтому берём первый погасший.
            if (q.bg && q.bg.hw && q.bg.hw.lan && Array.isArray(q.bg.hw.lan.lit)) {
                const offIdx = q.bg.hw.lan.lit.map((v, i) => (v ? 0 : i + 1)).filter(Boolean);
                if (offIdx.length > 0) {
                    return { action: 'COMMAND', text: `зажечь ${offIdx[0]}`, hint: 'Погас фонарь' };
                }
            }

            // 5. Укус волка: bite — кусаемые площадки, area — своя площадка.
            //    Прыгаем на свободную И достижимую площадку: соседей берём из
            //    zn.a = [[номер, соседи, полигон]] — та же схема, что в zonesHtml().
            if (q.bg && Array.isArray(q.bg.bite) && q.bg.area) {
                if (q.bg.bite.includes(q.bg.area)) {
                    const Z = q.bg.zn || {};
                    const gone = Array.isArray(Z.gone) ? Z.gone : [];
                    const zones = Array.isArray(Z.a) ? Z.a : [];
                    const myRow = zones.find(a => Array.isArray(a) && a[0] === q.bg.area);
                    const neighbours = (myRow && Array.isArray(myRow[1])) ? myRow[1] : [];
                    const safe = zones
                        .map(a => (Array.isArray(a) ? a[0] : 0))
                        .filter(z => z && z !== q.bg.area && !q.bg.bite.includes(z) && !gone.includes(z));
                    const reachable = neighbours.length ? safe.filter(z => neighbours.includes(z)) : safe;
                    const target = reachable.length ? reachable[0] : safe[0];
                    if (target) {
                        return { action: 'COMMAND', text: `прыжок ${target}`, hint: 'Укус волка! Прыгай' };
                    }
                }
            }

            // 6. Крылья (механика HPG10): у каждого крыла своя квота got/need.
            //    Если на своём крыле квота набрана, а на другом — нет,
            //    перепрыгиваем в первое недобранное крыло (W.z — площадки крыла).
            if (q.bg && M && M.id === 'HPG10' && q.bg.wings) {
                const W = q.bg.wings;
                const wingsZ = Array.isArray(W.z) ? W.z : [];
                const myWingIdx = q.bg.area
                    ? wingsZ.findIndex(z => Array.isArray(z) && z.includes(q.bg.area))
                    : -1;
                if (myWingIdx >= 0 && (W.got?.[myWingIdx] || 0) >= (W.need?.[myWingIdx] || 0)) {
                    const openWingIdx = wingsZ.findIndex((z, i) => (W.got?.[i] || 0) < (W.need?.[i] || 0));
                    const target = openWingIdx >= 0 ? (wingsZ[openWingIdx] || [])[0] : null;
                    if (target) {
                        return { action: 'COMMAND', text: `прыжок ${target}`, hint: 'Крыло закрыто! Смени позицию' };
                    }
                }
            }

            // 7. Осадные орудия и приспешники: adds = [[имя, count, hpRatio]].
            //    count = 0 — осадное орудие/ворота (бьётся без номера),
            //    count > 0 — приспешники («удар ИМЯ N»); hpRatio <= 0 — уже добит.
            if (q.bg && Array.isArray(q.bg.adds)) {
                const alive = q.bg.adds.filter(a => Array.isArray(a) && a[2] > 0);
                const siege = alive.find(a => !(+a[1] > 0));
                if (siege) return { action: 'COMMAND', text: `удар ${siege[0]}`, hint: 'Цель осады' };
                const mob = alive.find(a => +a[1] > 0);
                if (mob) return { action: 'COMMAND', text: `удар ${mob[0]} 1`, hint: 'Убей приспешника' };
            }

            // 8. Телеграф в обычном бою: слово парирования (b.tele.word).
            //    'tele2' в текущем клиенте не встречается, оставлен на всякий случай.
            if (q.b && (q.b.st === 'tele' || q.b.st === 'tele2') && q.b.tele && q.b.tele.word) {
                return { action: 'COMMAND', text: q.b.tele.word, hint: 'Ответ на телеграф' };
            }

            // 9. Напоминание о своём ходе (b.turn пуст — ход в раунде не сделан).
            if (q.b && q.b.st === 'party' && !q.b.turn) {
                return { action: 'COMMAND', text: 'удар', hint: 'Твой ход' };
            }

            return { action: 'IDLE' };
        },

        _clear() {
            if (this._el && this._el.innerHTML) this._el.innerHTML = '';
            // Сбрасываем подпись: иначе после паузы та же команда не отрисуется.
            this._currentState = null;
        },

        /**
         * Вставка подсказки в поле команды похода.
         *
         * v11.6.2b.1: сама логика (нативный сеттер value + input/change,
         * обход запрета вставки в quest.js) вынесена в общий хелпер
         * core/utils-chat.js — он же нужен кнопке «❤» в модуле пати.
         */
        _insert(text) {
            if (typeof Utils === 'undefined' || typeof Utils.insertToQuestChat !== 'function') return;
            const inserted = Utils.insertToQuestChat(text);
            // Если поля нет — хелпер уже показал тост про копирование в буфер.
            if (inserted && typeof UI !== 'undefined' && UI.showToast) {
                UI.showToast(`Вставлено: ${text} — Enter, чтобы отправить`);
            }
        },

        _render(res) {
            if (!this._el) return;
            if (!res || res.action === 'IDLE') {
                this._clear();
                return;
            }

            const esc = (s) => (typeof Utils !== 'undefined' && Utils.escapeHtml ? Utils.escapeHtml(s) : String(s == null ? '' : s));

            if (res.action === 'SILENCE') {
                // Баннер перерисовываем только при смене текста (антимерцание),
                // но ГАЗ -> ФИНТ -> ТИШИНА обязаны подменять друг друга.
                const sign = `silence|${res.text}`;
                if (this._currentState === sign) return;
                this._currentState = sign;
                this._el.innerHTML = `<div class="lg-combat-banner">${esc(res.text)}</div>`;
                return;
            }

            if (res.action === 'COMMAND') {
                // Не перерисовывать, если состояние не изменилось.
                const sign = `${res.hint || ''}|${res.text}`;
                if (this._currentState === sign) return;
                this._currentState = sign;

                this._el.innerHTML = `
                    <div class="lg-combat-suggest">
                        <div>
                            <div style="font-size:12px; opacity:0.8;">${esc(res.hint || '')}</div>
                            <div style="color:#ffcf6a;">${esc(res.text)}</div>
                        </div>
                        <button class="lg-combat-btn" id="lg-combat-insert">Вставить в чат</button>
                    </div>
                `;

                const btn = this._el.querySelector('#lg-combat-insert');
                if (btn) btn.onclick = () => this._insert(res.text);
            }
        }
    };

    // Для доступа из консоли страницы: window аддона — песочница, поэтому
    // публикуем в page-context через G (unsafeWindow), как это делает main.js.
    try {
        const caWin = (typeof G !== 'undefined' && G) ? G : window;
        caWin.LegionCombatAssistant = CombatAssistant;
    } catch (e) {}
