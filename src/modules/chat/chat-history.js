    // ============================================================
    // 7.2 МОДУЛЬ: ЧАТ — история и кэш сообщений
    // ============================================================
    // Вынесено из modules/chat.js (v11.6.0, этап 2 декомпозиции).
    // Слой-миксин: методы рассчитывают на this === Chat, поэтому
    // вливаются через Object.assign(Chat, ChatHistory).

    const ChatHistory = {
        // Ключ localStorage, куда пишется кэш последних 200 сообщений.
        STORAGE_KEY: 'LEGION_CHAT_HISTORY',
        // Флаг «история уже подтянута» — loadHistory() выполняется один раз.
        historyLoaded: false,
        // Статусы из /api/city/enter (заполняются в loadHistory).
        muted: false,
        mod: null,
        ign: new Set(),

        saveToStorage(author, text, role, isSystem, channel = null, k = null, aw = null, rank = null, id = null) {
            try {
                const history = this.loadFromStorage();
                history.push({ author, text, role, isSystem, channel, k, aw, rank, id, ts: Date.now() });
                const trimmed = history.length > 200 ? history.slice(-200) : history;
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(trimmed));
            } catch (e) { /* quota */ }
        },

        loadFromStorage() {
            try {
                const raw = localStorage.getItem(this.STORAGE_KEY);
                if (!raw) return [];
                const arr = JSON.parse(raw);
                return Array.isArray(arr) ? arr : [];
            } catch (e) { return []; }
        },

        // Своё сообщение кэшируем/обновляем. Ответ на отправку и эхо из потока —
        // это один и тот же объект (общий ts), поэтому запись ищется по нему:
        // эхо дописывает в localStorage id, aw и rank, не плодя дублей.
        cacheOwnMessage(msg) {
            if (!msg || !msg.text) return;
            try {
                const channel = msg.channel || 'city';
                const ts = msg.ts || Date.now();
                const entry = {
                    author: msg.author, text: msg.text, role: msg.role, isSystem: !!msg.isSystem,
                    channel: msg.channel, k: msg.k, aw: msg.aw, rank: msg.rank,
                    id: msg.id || null, ts
                };
                const history = this.loadFromStorage();
                const idx = history.findIndex(h => h && h.ts === ts && h.text === msg.text
                    && (h.author || '') === (msg.author || '')
                    && (h.channel || 'city') === channel);
                if (idx >= 0) {
                    history[idx] = { ...history[idx], ...entry };
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
                    return;
                }
                history.push(entry);
                const trimmed = history.length > 200 ? history.slice(-200) : history;
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(trimmed));
            } catch (e) {}
        },

        async loadHistory() {
            if (this.historyLoaded) return;
            this.historyLoaded = true;

            const cached = this.loadFromStorage();
            if (cached.length > 0) {
                cached.forEach(m => {
                    if (!this.messages.some(cur => (cur.id && cur.id === m.id) || (cur.author === m.author && cur.text === m.text && cur.channel === m.channel))) {
                        this.messages.push({ author: m.author, text: m.text, role: m.role, rank: m.rank, isSystem: m.isSystem, channel: m.channel, k: m.k, aw: m.aw, id: m.id || null, ts: m.ts });
                    }
                });
            }

            try {
                const res = await Utils.fetchApi('/api/city/enter', {});
                const data = res?.body || res;

                // Флаги мута / модерации / игнора из ответа сервера
                if (data && data.ok) {
                    if (data.chatMe) {
                        if ('muted' in data.chatMe) this.muted = data.chatMe.muted;
                        if ('mod' in data.chatMe && data.chatMe.mod !== 'own') this.mod = data.chatMe.mod;
                    }
                    if (Array.isArray(data.ign)) this.ign = new Set(data.ign);
                }

                if (data && data.ok && Array.isArray(data.chat)) {
                    data.chat.forEach(m => {
                        const parsed = Utils.extractChatFields(m);
                        if (!parsed.text) return;
                        const ch = parsed.channel || 'city';
                        // Не дублируем то, что уже есть в this.messages: по id ИЛИ по автору+тексту
                        const existing = this.messages.find(cur =>
                            (parsed.id && cur.id && cur.id === parsed.id) ||
                            (!cur._pending && cur.author === parsed.author && cur.text === parsed.text &&
                                (cur.channel || 'city') === ch)
                        );
                        if (existing) {
                            // Кэш мог быть сохранён без титула/статуса — дополняем из истории сервера
                            if (parsed.aw && !existing.aw) existing.aw = parsed.aw;
                            if (parsed.rank && !existing.rank) existing.rank = parsed.rank;
                            return;
                        }
                        this.handleIncoming(parsed.author, parsed.text, true, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to, parsed.rank);
                    });
                }
            } catch (e) {
                dbg('Не удалось стянуть историю города', e);
            }

            this.renderMessages();
        },

        async syncMe() {
            try {
                const res = await Utils.fetchApi('/api/me');
                const me = res?.hero || res?.body?.hero;
                if (me) {
                    // LG_CH/ME живут в page-context — читаем через G, без хардкода ника.
                    this.myNick = me.name || G.LG_CH?.name || G.ME?.user?.name || null;
                    this.myRole = me.class || me.sk?.c || 'legionary';
                }
            } catch (e) {}
        },
    };
