    // ============================================================
    // 6.6. МОДУЛЬ: БОЕВОЙ АССИСТЕНТ (modules/combat-assistant.js)
    //
    // Подсказки по механикам боссов в походе (патч 11.6.2b): раз в секунду
    // читает состояние похода штатным геттером игры LGQuest._view()
    // (структура — docs/API.md, раздел «Объект состояния похода»).
    // Вывод — поверх экрана: предупреждение «ничего не пиши» без кнопок либо
    // кликабельный бейдж с командой и кнопкой «Вставить».
    //
    // v11.7.0: автоотправки POST /api/qsay здесь нет и не было — аддон только
    // копирует команду в буфер и/или подставляет её в #qSayIn нативным
    // сеттером (обход noPaste). Отправляет игрок сам по Enter. Тот же тик
    // показывает баннер сбора отряда с кнопкой «Присоединиться» (qact join).
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
                if (!q || !q.on) {
                    this._clear();
                    return;
                }

                // 11.7.0: сбор отряда. Баннер с кнопкой «Присоединиться» видят
                // все, кто ещё не в отряде; как только party станет 'in'/'q'
                // или истечёт таймер — баннер уходит сам.
                if (this._gatherActive(q)) {
                    this._renderGather(q);
                    return;
                }

                // Подсказки нужны только полноправному участнику похода:
                // party = 'q' (очередь), 'ghost' (призрак), 'out' — не наш бой.
                if (q.party !== 'in') {
                    this._clear();
                    return;
                }

                this._render(this._evaluate(q));
            } catch (e) {
                console.warn('[LGU] CombatAssistant error:', e);
            }
        },

        /**
         * Идёт ли сбор отряда и мы ещё не внутри.
         *
         * Условия из ТЗ 11.7.0: фаза `gather` с живым таймером (или q.k ===
         * 'gather' без таймера) и party не 'in'/'q'/'ghost'.
         */
        _gatherActive(q) {
            if (!q) return false;
            if (q.party === 'in' || q.party === 'q' || q.party === 'ghost') return false;
            const until = +(q.gather && q.gather.until) || 0;
            if (until > Date.now()) return true;
            // k === 'gather' без until — «сбор идёт», обратного отсчёта нет.
            return (q.k === 'gather' || q.kind === 'gather') && !until;
        },

        /**
         * Баннер сбора с таймером MM:SS и кнопкой «Присоединиться».
         * Перерисовывается только при смене фазы/дедлайна, а текст таймера
         * обновляется каждый тик — кнопку при этом не пересоздаём.
         */
        _renderGather(q) {
            if (!this._el) return;
            const until = +(q.gather && q.gather.until) || 0;
            const hw = !!(q.gather && q.gather.hw);
            const sign = `gather|${until}|${hw}|${q.k || q.kind || ''}`;

            if (this._currentState !== sign) {
                this._currentState = sign;
                this._el.innerHTML = `
                    <div class="lg-combat-gather">
                        <div class="lg-combat-gather-head">${hw ? '🌀 Сбор у портала Изнанки' : '⚔️ Идёт сбор в поход'}</div>
                        <div class="lg-combat-gather-timer" id="lg-gather-timer">--:--</div>
                        <button type="button" class="lg-combat-btn" id="lg-gather-join">Присоединиться</button>
                    </div>
                `;
                const btn = this._el.querySelector('#lg-gather-join');
                if (btn) btn.addEventListener('click', () => this._joinQuest(btn));
            }

            this._updateGatherTimer(until);
        },

        /** Обратный отсчёт MM:SS до q.gather.until. */
        _updateGatherTimer(until) {
            if (!this._el) return;
            const el = this._el.querySelector('#lg-gather-timer');
            if (!el) return;
            if (!until) {
                el.textContent = 'сбор идёт';
                return;
            }
            const left = Math.max(0, until - Date.now());
            // ceil: на последней секунде показываем 00:01, а не 00:00 раньше времени.
            const total = Math.ceil(left / 1000);
            const mm = String(Math.floor(total / 60)).padStart(2, '0');
            const ss = String(total % 60).padStart(2, '0');
            el.textContent = `${mm}:${ss}`;
        },

        /**
         * Вступление в отряд: POST /api/qact { k: 'join' } через Utils.fetchApi.
         * Кнопка блокируется на время запроса, результат — тостом.
         * Автоотправки команд в чат здесь нет: только действие игры qact.
         */
        async _joinQuest(btn) {
            if (!btn || btn.disabled) return;
            const label = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Вступаем...';

            const toast = (msg, isError) => {
                if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(msg, !!isError);
            };

            let ok = false;
            let errText = '';
            try {
                const res = (typeof Utils !== 'undefined' && typeof Utils.fetchApi === 'function')
                    ? await Utils.fetchApi('/api/qact', { k: 'join' })
                    : null;
                ok = !!res && res.ok !== false;
                errText = (res && (res.body?.error || res.body?.err || res.error)) || '';
            } catch (e) {
                errText = (e && e.message) || '';
            }

            if (ok) {
                toast('✅ Заявка на вступление отправлена', false);
                // Баннер уходит сразу: следующий тик увидит party === 'in'/'q'.
                this._clear();
                return;
            }

            toast(`Не удалось вступить: ${errText || 'ошибка сервера'}`, true);
            if (btn.isConnected) {
                btn.disabled = false;
                btn.textContent = label || 'Присоединиться';
            }
        },

        /**
         * Смерть героя: обычный бой — b.hp === 0, босс — bg.in и bg.my <= 0.
         * Проверки повторяют deadIn() из site/quest.js.
         */
        _isDead(q) {
            return (q.b && q.b.st !== 'end' && q.b.hp === 0) ||
                   (q.bg && q.bg.st !== 'end' && q.bg.in && !(q.bg.my > 0));
        },

        /**
         * Предупреждение о дебаффе отряда из нового состояния похода.
         *
         * После неудачного привала игра пишет v.wk = [локаций_осталось,
         * %_снижения_урона]. Пока первый элемент > 0, весь урон отряда
         * снижен — предупреждаем игрока рядом с подсказкой.
         *
         * @param {object} q состояние похода из LGQuest._view()
         * @returns {string} '' или готовая строка предупреждения
         */
        _weaknessHint(q) {
            // v.wk — вложенный снимок, но часть клиентов отдаёт wk на верхнем
            // уровне; поддерживаем оба варианта, чтобы не зависеть от версии.
            const wk = (q && (q.wk || (q.v && q.v.wk))) || null;
            if (!Array.isArray(wk) || !(+wk[0] > 0)) return '';
            const locs = +wk[0];
            const pct = +wk[1] || 0;
            return `Урон снижен на ${pct}% (${locs} лок.)`;
        },

        /**
         * Решение по текущему состоянию похода + предупреждение о дебаффе.
         *
         * Оборачивает _evaluateCore: к hint добавляется строка про v.wk.
         * Если других подсказок нет (IDLE), показываем отдельную заметку,
         * чтобы ослабление не терялось между ходами.
         *
         * @param {object} q состояние похода из LGQuest._view()
         * @returns {{action: 'IDLE'|'NOTE'|'SILENCE'|'COMMAND', text?: string, hint?: string}}
         */
        _evaluate(q) {
            const res = this._evaluateCore(q);
            const warn = this._weaknessHint(q);
            if (!warn) return res;
            if (res && res.action === 'IDLE') return this._isDead(q) ? res : { action: 'NOTE', text: warn };
            if (!res) return { action: 'NOTE', text: warn };
            res.hint = res.hint ? `${warn} · ${res.hint}` : warn;
            return res;
        },

        /**
         * Решение по текущему состоянию похода.
         * Порядок приоритетов: смерть -> запрет ввода -> механики -> обычный ход.
         *
         * @param {object} q состояние похода из LGQuest._view()
         * @returns {{action: 'IDLE'|'SILENCE'|'COMMAND', text?: string, hint?: string}}
         */
        _evaluateCore(q) {
            // 1. Смерть героя.
            if (this._isDead(q)) return { action: 'IDLE' };

            // 2. Газ в ловушке: писать нельзя, пока он не рассеется.
            if (q.tr && q.tr.gas && (q.tr.st === 'act' || q.tr.st === 'wait')) {
                return { action: 'SILENCE', text: '⚠️ ФИНТ / ТИШИНА — ничего не пиши!' };
            }

            // 3. Режим тишины босса. Логика 1:1 с sayHush() из site/quest.js:
            //    финт (mech.fake), семейство 'silence' (кроме M94/M55 — там
            //    молчать не нужно) и текстовая подсказка «не пиши / молчите».
            const M = q.bg && q.bg.mech;
            if (M) {
                if (M.fake === true) {
                    return { action: 'SILENCE', text: '⚠️ ФИНТ / ТИШИНА — ничего не пиши!' };
                }
                const silentFam = M.fam === 'silence' && M.id !== 'M94' && M.id !== 'M55';
                const silentTip = /ничего не пиш|молчите|не пишите/i.test(M.tip || '');
                if (silentFam || silentTip) {
                    return { action: 'SILENCE', text: '⚠️ ФИНТ / ТИШИНА — ничего не пиши!' };
                }
            }

            // 3.1. Финт/тишина на телеграфе обычного боя (docs/API.md: tele.fake,
            //      tele.hush). Писать слово в этом случае запрещено.
            if (q.b && q.b.tele && (q.b.tele.fake === true || q.b.tele.hush === true)) {
                return { action: 'SILENCE', text: '⚠️ ФИНТ / ТИШИНА — ничего не пиши!' };
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
         * Копирование команды в буфер обмена (клик по бейджу).
         * Подпись бейджа кратко меняется на «Скопировано ✓».
         */
        _copyCmd(el, text) {
            const restore = () => {
                if (!el || !el.isConnected) return;
                el.textContent = text;
                el.classList.remove('copied');
            };
            const done = () => {
                if (!el || !el.isConnected) return;
                el.textContent = 'Скопировано ✓';
                el.classList.add('copied');
                setTimeout(restore, 1200);
            };
            const fail = () => {
                if (typeof UI !== 'undefined' && UI.showToast) {
                    UI.showToast(`Не удалось скопировать. Текст: ${text}`, true);
                }
            };

            if (typeof Utils === 'undefined' || typeof Utils.copyText !== 'function') {
                fail();
                return;
            }
            Utils.copyText(text).then(ok => (ok ? done() : fail()), fail);
        },

        /**
         * Вставка подсказки в поле команды похода.
         *
         * v11.6.2b.1: логика (нативный сеттер value + input/change, обход
         * запрета вставки quest.js) вынесена в общий хелпер core/utils.js —
         * он же нужен кнопке «❤» в модуле пати. Автоотправки нет: игрок жмёт
         * Enter сам.
         *
         * @returns {boolean} true — текст оказался в поле ввода
         */
        _insert(text) {
            if (typeof Utils === 'undefined' || typeof Utils.insertToQuestChat !== 'function') return false;
            const inserted = Utils.insertToQuestChat(text);
            if (inserted && typeof UI !== 'undefined' && UI.showToast) {
                UI.showToast(`Вставлено: ${text} — Enter, чтобы отправить`);
            }
            return inserted;
        },

        _render(res) {
            if (!this._el) return;
            if (!res || res.action === 'IDLE') {
                this._clear();
                return;
            }

            const esc = (s) => (typeof Utils !== 'undefined' && Utils.escapeHtml ? Utils.escapeHtml(s) : String(s == null ? '' : s));

            if (res.action === 'NOTE') {
                // v11.6.3: дебафф ослабления (v.wk) без активной подсказки —
                // показываем отдельную жёлтую заметку, а не баннер «НЕ ПИШИ».
                const sign = `note|${res.text}`;
                if (this._currentState === sign) return;
                this._currentState = sign;
                this._el.innerHTML = `<div class="lg-combat-note">⚠️ ${esc(res.text)}</div>`;
                return;
            }

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

                const cmd = String(res.text == null ? '' : res.text);
                // Команда — кликабельный бейдж (копирование в буфер) и кнопка
                // «Вставить» (нативный сеттер #qSayIn). Автоотправки нет.
                this._el.innerHTML = `
                    <div class="lg-combat-suggest">
                        <div class="lg-combat-info">
                            <div class="lg-combat-hint">${esc(res.hint || '')}</div>
                            <button type="button" class="lg-combat-cmd" data-copy-cmd="${esc(cmd)}" title="Нажми, чтобы скопировать">${esc(cmd)}</button>
                        </div>
                        <button type="button" class="lg-combat-btn" data-insert-cmd="${esc(cmd)}">Вставить</button>
                    </div>
                `;

                const copyBtn = this._el.querySelector('[data-copy-cmd]');
                if (copyBtn) copyBtn.addEventListener('click', () => this._copyCmd(copyBtn, cmd));

                const insertBtn = this._el.querySelector('[data-insert-cmd]');
                if (insertBtn) insertBtn.addEventListener('click', () => {
                    if (!this._insert(cmd) && typeof UI !== 'undefined' && UI.showToast) {
                        UI.showToast('Поле команды похода не найдено', true);
                    }
                });
            }
        }
    };

    // Для доступа из консоли страницы: window аддона — песочница, поэтому
    // публикуем в page-context через G (unsafeWindow), как это делает main.js.
    try {
        const caWin = (typeof G !== 'undefined' && G) ? G : window;
        caWin.LegionCombatAssistant = CombatAssistant;
    } catch (e) {}
