    // ============================================================
    // 0.4. ОБЩИЕ ХЕЛПЕРЫ АДДОНА (core/utils.js)
    //
    // v11.7.0: файл заменил core/utils-chat.js — подсистема чата полностью
    // вырезана из проекта. Здесь остались только те хелперы, которые нужны
    // другим модулям:
    //   copyText()          — копирование текста в буфер обмена;
    //   insertToQuestChat() — вставка команды в поле чата похода (#qSayIn).
    //
    // Потребители: modules/combat-assistant.js (кликабельный бейдж команды и
    // кнопка «Вставить») и modules/party.js (кнопка «❤» — лечение союзника).
    // Подключается после utils-api.js: Utils уже объявлен в constants.js.
    // ============================================================
    const UtilsCommon = {
        /**
         * Копирование текста в буфер обмена.
         *
         * Порядок: Clipboard API (нужен secure context и разрешение браузера),
         * затем фолбэк через скрытую textarea + document.execCommand('copy').
         *
         * @param {string} text текст для копирования
         * @returns {Promise<boolean>} true — текст попал в буфер
         */
        copyText(text) {
            const value = String(text == null ? '' : text);

            // Фолбэк для браузеров/контекстов без navigator.clipboard.
            const legacyCopy = () => {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = value;
                    ta.setAttribute('readonly', '');
                    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
                    document.body.appendChild(ta);
                    ta.select();
                    ta.setSelectionRange(0, value.length);
                    let ok = false;
                    try { ok = document.execCommand('copy'); } catch (e) {}
                    ta.remove();
                    return ok;
                } catch (e) {
                    return false;
                }
            };

            try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    return navigator.clipboard.writeText(value).then(() => true, legacyCopy);
                }
            } catch (e) {}

            return Promise.resolve(legacyCopy());
        },

        /**
         * Вставка текста в поле команды похода (#qSayIn, см. site/quest.js).
         *
         * Игра блокирует вставку: noPaste на paste/drop + beforeinput
         * insertFromPaste. Поэтому значение пишем нативным сеттером из
         * цепочки прототипов самого элемента (realm-safe: не зависит от
         * песочницы Tampermonkey) и вручную шлём input/change.
         * Автоотправки нет: команду отправляет игрок по Enter.
         *
         * @param {string} text команда, например «удар» или «лечить @ник»
         * @returns {boolean} true — вставлено в поле; false — поля нет
         */
        insertToQuestChat(text) {
            const value = String(text == null ? '' : text);
            const input = document.querySelector('#qSayIn, .q-sayi, .q-say input');
            if (!input) return false;

            try {
                input.focus();
                let proto = Object.getPrototypeOf(input);
                let desc = null;
                while (proto && !desc) {
                    desc = Object.getOwnPropertyDescriptor(proto, 'value');
                    proto = Object.getPrototypeOf(proto);
                }
                if (desc && desc.set) desc.set.call(input, value);
                else input.value = value;

                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                if (typeof input.setSelectionRange === 'function') {
                    input.setSelectionRange(value.length, value.length);
                }
            } catch (e) {
                try { input.value = value; } catch (e2) { return false; }
            }

            return true;
        },

        /**
         * Трекер онлайна игроков (город/шахта).
         *
         * Раньше жил в core/utils-chat.js. Наполняет window.__lgOnlinePlayers
         * записями { loc, ts, firstSeen, src }; читают modules/players.js
         * («Разведка») и modules/arena.js (свежесть состава). Никаких
         * сообщений чата здесь нет — только логины из ответов игры.
         *
         * @param {*} raw              ответ API/SSE (объект, массив или список)
         * @param {string|null} defaultLoc 'city' | 'mine' | null
         * @param {string} src         источник ('sse' | 'api')
         * @returns {boolean} true — карта изменилась
         */
        updateOnlinePlayers(raw, defaultLoc = null, src = 'sse') {
            if (!raw) return false;
            let updated = false;
            const now = Date.now();
            if (!window.__lgOnlinePlayers || typeof window.__lgOnlinePlayers.set !== 'function') {
                window.__lgOnlinePlayers = new Map();
            }

            const extractNick = (item) => {
                if (!item) return null;
                if (typeof item === 'string') return item.trim();
                if (Array.isArray(item)) {
                    const first = item[0];
                    if (typeof first === 'string') return first.trim();
                    if (first && typeof first === 'object') {
                        const l = first.l || first.login || first.name || first.nick;
                        if (typeof l === 'string') return l.trim();
                    }
                }
                if (typeof item === 'object') {
                    const l = item.l || item.login || item.nick || item.name || item.n;
                    if (typeof l === 'string') return l.trim();
                }
                return null;
            };

            const processList = (list, loc) => {
                if (!Array.isArray(list)) return;
                list.forEach(item => {
                    const nick = extractNick(item);
                    if (nick && nick.length >= 2 && nick.length <= 30 && nick.toLowerCase() !== 'me') {
                        // 11.6.6c: firstSeen — время первого обнаружения сессии.
                        // Пауза больше 5 минут считается новым заходом: SSE-события
                        // города/шахты обновляют ts постоянно, так что «тишина»
                        // означает выход игрока (трекер онлайна аддона).
                        const nickKey = nick.toLowerCase();
                        const prev = window.__lgOnlinePlayers.get(nickKey);
                        const firstSeen = (prev && (now - prev.ts < 300_000)) ? (prev.firstSeen || prev.ts) : now;
                        window.__lgOnlinePlayers.set(nickKey, { loc, ts: now, firstSeen, src });
                        updated = true;
                    }
                });
            };

            const checkObject = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                const d = obj.body || obj.data || obj;
                const forceCity = d.chatRoom === 'city' || !!d.town;
                const forceMine = d.chatRoom === 'mine';

                if (d.a && Array.isArray(d.a)) {
                    processList(d.a, forceCity ? 'city' : ((defaultLoc === 'mine') ? 'mine' : 'city'));
                }
                if (d.m && Array.isArray(d.m)) {
                    processList(d.m, forceCity ? 'city' : ((defaultLoc === 'city') ? 'city' : 'mine'));
                }
                if (d.others && Array.isArray(d.others)) {
                    processList(d.others, forceCity ? 'city' : (forceMine ? 'mine' : (defaultLoc || 'city')));
                }
                if (d.town && typeof d.town === 'object') {
                    if (Array.isArray(d.town.others)) processList(d.town.others, 'city');
                    if (Array.isArray(d.town.a)) processList(d.town.a, 'city');
                    if (Array.isArray(d.town.players)) processList(d.town.players, 'city');
                    if (Array.isArray(d.town.p)) processList(d.town.p, 'city');
                }
                if (d.players && Array.isArray(d.players)) {
                    processList(d.players, forceCity ? 'city' : (forceMine ? 'mine' : (defaultLoc || 'city')));
                }
                if (d.heroes && Array.isArray(d.heroes)) {
                    processList(d.heroes, forceCity ? 'city' : ((defaultLoc === 'city') ? 'city' : 'mine'));
                }
                if (d.st && typeof d.st === 'object') {
                    if (Array.isArray(d.st.top)) processList(d.st.top, 'mine');
                    if (typeof d.st.here === 'number') window.__lgMineTotalHere = d.st.here;
                }
                if (Array.isArray(d.top)) {
                    processList(d.top, 'mine');
                }
                if (typeof d.here === 'number') {
                    window.__lgMineTotalHere = d.here;
                }
            };

            if (Array.isArray(raw)) {
                raw.forEach(checkObject);
            } else {
                checkObject(raw);
            }

            return updated;
        }
    };
    Object.assign(Utils, UtilsCommon);
