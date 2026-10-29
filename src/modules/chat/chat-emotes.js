    // ============================================================
    // 7.1 МОДУЛЬ: ЧАТ — 7TV эмоуты
    // ============================================================
    // Вынесено из modules/chat.js (v11.6.0, этап 2 декомпозиции).
    // Слой-миксин: ChatEmotes.SevenTV пробрасывается в Chat.SevenTV,
    // а load()/loadSize() вызываются из Chat.init().

    // 7TV: глобальные смайлики в чате
    //
    // Сайт отдаёт CSP `connect-src 'self'` и `img-src 'self' data: blob:`,
    // поэтому:
    //   • JSON эмоутов тянем через GM_xmlhttpRequest (обходит CSP);
    //   • картинки грузим блобом и подставляем blob:-URL (разрешён img-src).
    // UI стороннего аддона не копируем — только рендер смайликов.
    // ============================================================
    const SevenTV = {
        API_URL: 'https://7tv.io/v3/emote-sets/global',
        IVR_URL: 'https://api.ivr.fi/v2/twitch/user?login=',
        CHANNEL_API_URL: 'https://7tv.io/v3/users/twitch/',
        DEFAULT_CHANNEL: 'zakvielchannel',
        CHANNEL_KEY: 'LEGION_7TV_CHANNEL',
        channel: 'zakvielchannel',   // текущий канал (переопределяется из localStorage)
        _reloadQueued: false,
        _cacheEpoch: 0,

        // Размеры смайлов: применяются через CSS-переменную --t7-h.
        SIZES: {
            s: { h: '1.3em', label: 'S' },
            m: { h: '1.9em', label: 'M' },
            l: { h: '2.6em', label: 'L' },
            x: { h: '3.4em', label: 'XL' }
        },
        size: 'm',
        SIZE_KEY: 'LEGION_7TV_SIZE',

        applySize() {
            const conf = this.SIZES[this.size] || this.SIZES.m;
            const docs = [document];
            // Виджет может быть вынесен в PiP-окно — переменную нужно задать и там.
            try {
                if (typeof Chat !== 'undefined' && Chat._popoutWin && Chat._popoutWin.document) {
                    docs.push(Chat._popoutWin.document);
                }
            } catch (e) {}
            docs.forEach(doc => {
                try {
                    if (doc && doc.documentElement) {
                        doc.documentElement.style.setProperty('--t7-h', conf.h);
                    }
                } catch (e) {}
            });
        },

        loadSize() {
            try {
                const saved = localStorage.getItem(this.SIZE_KEY);
                if (saved && this.SIZES[saved]) this.size = saved;
            } catch (e) {}
            this.applySize();
        },
        // 1×1 прозрачный GIF: заглушка до подгрузки блоба (data: разрешён CSP).
        PLACEHOLDER: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        emotes: new Map(),      // name -> { url }
        blobUrls: new Map(),    // name -> blob: URL
        pending: new Map(),     // name -> Promise<string|null>
        loaded: false,
        loading: false,

        requestJson(url) {
            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest === 'function') {
                    GM_xmlhttpRequest({
                        method: 'GET', url, timeout: 15000,
                        onload: (r) => {
                            if (r.status < 200 || r.status >= 300) return reject(new Error('HTTP ' + r.status));
                            try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); }
                        },
                        onerror: () => reject(new Error('network error')),
                        ontimeout: () => reject(new Error('timeout'))
                    });
                    return;
                }
                // Без @grant запрос, скорее всего, заблокирует CSP сайта;
                // оставляем fetch как совместимый фолбэк для других менеджеров.
                fetch(url).then(r => r.json()).then(resolve, reject);
            });
        },

        requestBlob(url) {
            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest === 'function') {
                    GM_xmlhttpRequest({
                        method: 'GET', url, responseType: 'blob', timeout: 15000,
                        onload: (r) => {
                            if (r.status < 200 || r.status >= 300 || !r.response) {
                                return reject(new Error('HTTP ' + r.status));
                            }
                            resolve(r.response);
                        },
                        onerror: () => reject(new Error('network error')),
                        ontimeout: () => reject(new Error('timeout'))
                    });
                    return;
                }
                fetch(url, { mode: 'cors' })
                    .then(r => r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status)))
                    .then(resolve, reject);
            });
        },

        async load(force = false) {
            if (this.loading) {
                // Перезагрузка во время текущей загрузки — выполним после неё.
                if (force) this._reloadQueued = true;
                return;
            }
            if (this.loaded && !force) return;

            this.loading = true;
            this._resetCaches();

            let count = 0;
            try {
                // 1. Глобальный набор 7TV.
                const dataGlobal = await this.requestJson(this.API_URL);
                count += this._addEmotes(dataGlobal && dataGlobal.emotes);

                // 2. Набор канала: ник → Twitch ID (api.ivr.fi) → emote_set (7tv.io).
                let saved = '';
                try { saved = localStorage.getItem(this.CHANNEL_KEY) || ''; } catch (e) {}
                this.channel = String(saved || this.channel || this.DEFAULT_CHANNEL).trim().toLowerCase();

                if (this.channel) {
                    try {
                        const user = await this.requestJson(this.IVR_URL + encodeURIComponent(this.channel));
                        const id = user && user[0] && user[0].id;
                        if (id) {
                            const dataChan = await this.requestJson(this.CHANNEL_API_URL + encodeURIComponent(id));
                            const set = dataChan && dataChan.emote_set;
                            count += this._addEmotes(set && set.emotes);
                        }
                    } catch (chanErr) {
                        console.warn('[7TV] Не удалось загрузить канал', this.channel, chanErr);
                    }
                }

                this.loaded = count > 0;
                dbg(`[7TV] Загружено ${this.emotes.size} эмоутов (канал: ${this.channel}).`);
            } catch (e) {
                console.error('[7TV] Ошибка загрузки:', e);
            } finally {
                this.loading = false;
                if (this.loaded) {
                    // Смайлики пришли после первого рендера — обновим открытый чат.
                    try {
                        if (typeof Chat !== 'undefined' && Chat.widget) Chat.renderMessages();
                    } catch (e) {}
                }
                if (this._reloadQueued) {
                    this._reloadQueued = false;
                    this.load(true);
                }
            }
        },

        // Сброс кэша эмоутов/картинок (смена канала или force-перезагрузка).
        _resetCaches() {
            this._cacheEpoch = (this._cacheEpoch || 0) + 1;
            this.emotes.clear();
            for (const url of this.blobUrls.values()) {
                try { URL.revokeObjectURL(url); } catch (e) {}
            }
            this.blobUrls.clear();
            this.pending.clear();
        },

        _addEmotes(emoteList) {
            if (!Array.isArray(emoteList)) return 0;
            let added = 0;
            emoteList.forEach(e => {
                const host = e && e.data && e.data.host;
                if (!host || !host.url || !e.name || e.name === '__proto__') return;
                const files = (host.files || []).filter(f => f && f.format === 'WEBP' && f.name);
                const preferred = files.find(f => f.name === '2x.webp') || files[0];
                this.emotes.set(e.name, { url: 'https:' + host.url + '/' + (preferred ? preferred.name : '2x.webp') });
                added++;
            });
            return added;
        },

        replaceEmotes(rawText) {
            if (!rawText) return '';
            // replaceEmotes — единственная точка экранирования текста сообщения.
            const text = String(rawText);
            if (!this.emotes.size) return Utils.escapeHtml(text);

            return text.split(/([^\p{L}\p{N}_]+)/u).map(part => {
                if (!part) return '';
                // Смайлом считается только целое слово; пунктуация/пробелы/эмодзи
                // отделяются как разделители и экранируются как обычный текст.
                if (!/^[\p{L}\p{N}_]+$/u.test(part) || !this.emotes.has(part)) return Utils.escapeHtml(part);
                const name = Utils.escapeHtml(part);
                return `<img class="t7-emote" data-t7="${name}" src="${this.PLACEHOLDER}" title="${name}" alt="${name}" loading="lazy">`;
            }).join('');
        },

        // После вставки HTML: меняем заглушки на blob:-URL смайликов.
        decorate(root) {
            if (!root || typeof root.querySelectorAll !== 'function' || !this.emotes.size) return;
            root.querySelectorAll('img.t7-emote[data-t7]').forEach(img => {
                const name = img.getAttribute('data-t7');
                if (!name) return;
                const ready = this.blobUrls.get(name);
                if (ready) { img.src = ready; return; }
                if (img.getAttribute('data-t7-loading') === '1') return;
                img.setAttribute('data-t7-loading', '1');
                this.getBlobUrl(name).then(url => {
                    img.removeAttribute('data-t7-loading');
                    if (url) img.src = url;
                    else if (img.parentNode) img.replaceWith((img.ownerDocument || document).createTextNode(name));
                });
            });
        },

        getBlobUrl(name) {
            if (this.blobUrls.has(name)) return Promise.resolve(this.blobUrls.get(name));
            if (this.pending.has(name)) return this.pending.get(name);
            const emote = this.emotes.get(name);
            if (!emote || !emote.url) return Promise.resolve(null);

            const epoch = this._cacheEpoch;
            const task = this.requestBlob(emote.url).then(blob => {
                const url = URL.createObjectURL(blob);
                // Пока грузили, канал/набор могли перезагрузить — старый блоб не кэшируем.
                if (epoch !== this._cacheEpoch) {
                    try { URL.revokeObjectURL(url); } catch (e) {}
                    return null;
                }
                this.blobUrls.set(name, url);
                return url;
            }).catch(e => {
                dbg('[7TV] Не удалось загрузить эмоут', name, e);
                return null;
            }).finally(() => this.pending.delete(name));

            this.pending.set(name, task);
            return task;
        }
    };

    // Слой чата: 7TV-эмоуты (склейка — см. chat/chat.js).
    const ChatEmotes = { SevenTV };
