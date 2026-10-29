    // ============================================================
    // 7. МОДУЛЬ: ЧАТ
    // ============================================================
    // ============================================================
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

    const Chat = {
        widget: null,
        badge: null,
        unreadCount: 0,
        historyLoaded: false,
        disabled: localStorage.getItem('LEGION_CHAT_DISABLED') === 'true',
        _popoutWin: null,
        _origWidgetStyles: null,
        // Куда вернуть виджет после закрытия PiP: родной парент, сосед и исходные классы.
        _origWidgetParent: null,
        _origWidgetNextSibling: null,
        _origWidgetClasses: null,
        _origWidgetHadOpen: false,
        isOpen() {
            return !!(this._popoutWin || (this.widget && this.widget.classList.contains('open')));
        },
        getChannelLogin() {
            try {
                const m = location.pathname.match(/\/c\/([^/?#]+)/i);
                if (m && m[1]) return m[1].toLowerCase().trim();
                const paramC = new URL(location.href).searchParams.get('c');
                if (paramC && !/^\d+$/.test(paramC)) return paramC.toLowerCase().trim();
            } catch (e) {}
            return '';
        },
        isStreamerMessage(msg) {
            if (!msg || !msg.author) return false;
            const author = String(msg.author).toLowerCase().trim();
            const chLogin = this.getChannelLogin();
            if (!chLogin) return false;
            const chBase = chLogin.replace(/channel$/i, '');
            const authorBase = author.replace(/channel$/i, '');
            return author === chLogin || author === chBase || authorBase === chBase || authorBase === chLogin;
        },
        isMentionedMessage(msg) {
            if (!msg || !msg.text || !this.myNick) return false;
            const myNick = String(this.myNick).trim();
            if (!myNick || myNick.length < 2) return false;
            if (msg.author && String(msg.author).toLowerCase() === myNick.toLowerCase()) return false;
            const text = String(msg.text).toLowerCase();
            const lowerNick = myNick.toLowerCase();
            return text.includes('@' + lowerNick) || text.includes(lowerNick);
        },
        setDisabled(val) {
            this.disabled = !!val;
            try {
                localStorage.setItem('LEGION_CHAT_DISABLED', String(this.disabled));
            } catch (e) {}
            if (this.disabled) {
                this.stopBackgroundLiveListener();
                if (this.isOpen()) {
                    this.close();
                }
                UI.showToast('🚫 Перехват чата отключен');
            } else {
                UI.showToast('💬 Перехват чата включен');
                this.startBackgroundLiveListener();
            }
        },
        STORAGE_KEY: 'LEGION_CHAT_HISTORY',
        activeMainTab: 'city',
        activeSubTab: 'general',
        dmTarget: null, // Ник собеседника, с которым сейчас открыт диалог во вкладке ЛС
        get activeTab() {
            if (this.activeMainTab === 'mine' || this.activeMainTab === 'dm') return this.activeMainTab;
            return this.activeSubTab;
        },
        set activeTab(val) {
            if (val === 'mine' || val === 'dm') {
                this.activeMainTab = val;
            } else {
                this.activeMainTab = 'city';
                this.activeSubTab = val;
            }
        },
        messages: [], // Массив всех сообщений
        myNick: window.LG_CH?.name || 'eciell',
        myRole: 'legionary',
        currentMineId: 'home',
        cooldownUntil: 0,
        // Статусы из /api/city/enter
        muted: false,
        mod: null,
        ign: new Set(),
        _toastTimer: null,
        _liveES: null,
        _livePollTimer: null,
        _liveRunning: false,
        _liveConnecting: false,
        _livePollDelay: 2500,

        getMineId() {
            return this.currentMineId 
                || (location.search.match(/[?&]c=([^&]+)/)?.[1]) 
                || 'home';
        },

        async syncMe() {
            try {
                const res = await Utils.fetchApi('/api/me');
                const me = res?.hero || res?.body?.hero;
                if (me) {
                    this.myNick = me.name || window.LG_CH?.name || 'eciell';
                    this.myRole = me.class || me.sk?.c || 'legionary';
                }
            } catch (e) {}
        },

        showError(msg) {
            let toast = document.getElementById('chat-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'chat-toast';
                toast.style.cssText = 'position:absolute;top:45px;left:10px;right:10px;background:#ff5a7a;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;text-align:center;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,0.5);transition:opacity 0.3s;';
                this.widget.appendChild(toast);
            }
            toast.textContent = msg;
            toast.style.opacity = '1';
            toast.style.display = 'block';
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => {
                if (toast) {
                    toast.style.opacity = '0';
                    setTimeout(() => { if (toast) toast.style.display = 'none'; }, 300);
                }
            }, 2000);
        },

        isInMine() {
            return !!document.querySelector('.mn-world') ||
                   !!document.querySelector('.mn-screen') ||
                   !!document.querySelector('.mn-heroes') ||
                   (location.pathname.includes('/mine') && location.search.includes('sid='));
        },

        updateInputState() {
            const inp = this.widget?.querySelector('#chat-input') || document.getElementById('chat-input');
            const sendBtn = this.widget?.querySelector('#chat-send') || document.getElementById('chat-send');

            // Если открыт PiP, принудительно разрешаем ввод
            if (this._popoutWin) {
                if (inp) { inp.disabled = false; inp.placeholder = 'Написать сообщение...'; }
                if (sendBtn) sendBtn.disabled = false;
                return;
            }

            const inMine = this.isInMine();

            if (this.activeMainTab === 'mine' && !inMine) {
                if (inp) {
                    inp.disabled = true;
                    inp.placeholder = 'Доступно только в шахте';
                    inp.value = '';
                }
                if (sendBtn) sendBtn.disabled = true;
            } else if (this.activeMainTab === 'dm') {
                if (this.dmTarget) {
                    if (inp) {
                        inp.disabled = false;
                        inp.placeholder = `Написать ${this.dmTarget}...`;
                    }
                    if (sendBtn) sendBtn.disabled = false;
                } else {
                    if (inp) {
                        inp.disabled = true;
                        inp.placeholder = 'Выберите диалог в списке «✉️ ЛС»';
                        inp.value = '';
                    }
                    if (sendBtn) sendBtn.disabled = true;
                }
            } else if (this.activeMainTab === 'city' && this.activeSubTab === 'ach') {
                if (inp) {
                    inp.disabled = true;
                    inp.placeholder = 'Чат достижений (только чтение)';
                    inp.value = '';
                }
                if (sendBtn) sendBtn.disabled = true;
            } else {
                if (inp) {
                    inp.disabled = false;
                    const phMap = {
                        general: 'Написать в чат города...',
                        trade: 'Написать в торговлю...',
                        mine: 'Написать в чат шахты...'
                    };
                    inp.placeholder = phMap[this.activeTab] || 'Написать сообщение...';
                }
                if (sendBtn) sendBtn.disabled = false;
            }
        },

        init() {
            if (this.widget) return;
            this.widget = document.createElement('div');
            this.widget.className = `${DOM_IDS.chatWidget} chat-widget`;
            this.widget.id = DOM_IDS.chatWidget;
            this.widget.innerHTML = `
                <div class="chat-top-bar" id="chat-drag-handle">
                    <div class="chat-main-tabs">
                        <button class="chat-main-tab active" data-main-tab="city" type="button">🏙️ Город</button>
                        <button class="chat-main-tab" data-main-tab="mine" type="button">⛏️ Шахта</button>
                        <button class="chat-main-tab" data-main-tab="dm" type="button">✉️ ЛС</button>
                    </div>
                    <span class="chat-close" id="chat-close-btn" title="Закрыть">✖</span>
                </div>
                <div class="chat-sub-tabs" id="chat-sub-tabs">
                    <button class="chat-sub-tab active" data-sub-tab="general" type="button">Общий</button>
                    <button class="chat-sub-tab" data-sub-tab="trade" type="button">Торговля</button>
                    <button class="chat-sub-tab" data-sub-tab="ach" type="button">Достижения</button>
                </div>
                <div class="chat-messages" id="chat-messages"></div>
                <div class="chat-input-area">
                    <input type="text" class="chat-input" id="chat-input" placeholder="Написать в чат города..." maxlength="200">
                    <button class="chat-send" id="chat-send" type="button">➤</button>
                </div>`;
            document.body.appendChild(this.widget);
            this.badge = document.getElementById(DOM_IDS.chatBadge) || document.getElementById('chat-badge');

            (document.getElementById(DOM_IDS.btnChatToggle) || document.getElementById('btn-chat-toggle'))?.addEventListener('click', () => this.toggle());
            (document.getElementById(DOM_IDS.btnPopout) || document.getElementById('btn-popout'))?.addEventListener('click', () => this.popoutChat());

            // Делегирование событий на самом виджете: гарантирует работу и в основном окне, и в PiP окне
            this.widget.addEventListener('click', (e) => {
                const target = e.target?.closest ? e.target : (e.target?.parentElement || e.target);
                if (!target || !target.closest) return;

                if (target.closest('#chat-close-btn') || target.closest('.chat-close')) {
                    e.preventDefault();
                    this.close();
                    return;
                }

                if (target.closest('#chat-send') || target.closest('.chat-send')) {
                    e.preventDefault();
                    this.send();
                    return;
                }

                const mainTab = target.closest('.chat-main-tab');
                if (mainTab) {
                    e.preventDefault();
                    this.widget.querySelectorAll('.chat-main-tab').forEach(t => t.classList.remove('active'));
                    mainTab.classList.add('active');
                    this.activeMainTab = mainTab.getAttribute('data-main-tab') || 'city';
                    const subTabsRow = this.widget.querySelector('#chat-sub-tabs');
                    if (subTabsRow) {
                        subTabsRow.style.display = this.activeMainTab === 'city' ? 'flex' : 'none';
                    }
                    this.updateInputState();
                    this.renderMessages();
                    return;
                }

                const subTab = target.closest('.chat-sub-tab');
                if (subTab) {
                    e.preventDefault();
                    this.widget.querySelectorAll('.chat-sub-tab').forEach(t => t.classList.remove('active'));
                    subTab.classList.add('active');
                    this.activeSubTab = subTab.getAttribute('data-sub-tab') || 'general';
                    this.updateInputState();
                    this.renderMessages();
                    return;
                }
            });

            const inp = this.widget.querySelector('#chat-input');
            if (inp) {
                inp.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.send();
                    }
                });
            }

            this.setupDrag();
            this.syncMe();
        },

        setupDrag() {
            const handle = this.widget?.querySelector('#chat-drag-handle') || document.getElementById('chat-drag-handle');
            if (!handle) return;
            let dragging = false, offX = 0, offY = 0;
            handle.addEventListener('pointerdown', (e) => {
                // Если чат вынесен в отдельное PiP-окно, перетаскивание внутри виджета отключаем
                if (this._popoutWin) return;

                const target = e.target?.closest ? e.target : (e.target?.parentElement || e.target);
                if (!target || !target.closest) return;

                // Проверка: клик по кнопке, вкладке, скроллбару или инпуту отменяет перетаскивание
                if (
                    target.closest('button') ||
                    target.closest('.chat-tab') ||
                    target.closest('.chat-main-tab') ||
                    target.closest('.chat-sub-tab') ||
                    target.closest('.chat-close') ||
                    target.closest('input, textarea, select')
                ) {
                    return;
                }

                // Проверка клика по полосе прокрутки
                if (e.offsetX > handle.clientWidth || e.offsetY > handle.clientHeight) {
                    return;
                }

                dragging = true;
                try { handle.setPointerCapture(e.pointerId); } catch (_) {}
                const r = this.widget.getBoundingClientRect();
                offX = e.clientX - r.left;
                offY = e.clientY - r.top;
                this.widget.style.left = r.left + 'px';
                this.widget.style.top = r.top + 'px';
                this.widget.style.right = 'auto';
                this.widget.style.bottom = 'auto';
            });
            handle.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                this.widget.style.left = (e.clientX - offX) + 'px';
                this.widget.style.top = (e.clientY - offY) + 'px';
            });
            const stopDrag = (e) => {
                if (!dragging) return;
                dragging = false;
                try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
            };
            handle.addEventListener('pointerup', stopDrag);
            handle.addEventListener('pointercancel', stopDrag);

            // 7TV: размер смайлов + глобальные/канальные эмоуты.
            SevenTV.loadSize();
            SevenTV.load();

            // Настройка Twitch-канала для эмоутов 7TV.
            const btn7tv = document.getElementById('btn-7tv-settings');
            if (btn7tv) {
                btn7tv.addEventListener('click', () => this.open7tvSettings());
            }
        },

        open7tvSettings() {
            const modal = UI.showModal(`
                <h2>🎭 Настройки 7TV <button class="custom-close" id="custom-close-btn">✖</button></h2>
                <div style="padding: 10px;">
                    <div style="font-size: 13px; color: #aaa; margin-bottom: 15px;">
                        Введите Twitch-ник канала, эмоуты которого хотите видеть (например, zakvielchannel).
                    </div>
                    <input type="text" id="t7-channel-input" class="search-bar" style="width: 100%; margin-bottom: 15px;" value="${Utils.escapeHtml(SevenTV.channel)}" placeholder="Ник на Twitch">
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:15px; border-top:1px solid #333; padding-top:15px;">
                        <span style="font-size:13px; color:#aaa;">Размер:</span>
                        <div style="display:flex; gap:5px;">
                            ${Object.entries(SevenTV.SIZES).map(([key, conf]) => `
                                <button class="t7-size-btn" data-size="${key}" style="padding:5px 12px; border-radius:6px; border:1px solid ${SevenTV.size === key ? '#9146ff' : '#444'}; background:${SevenTV.size === key ? '#9146ff' : '#111'}; color:#fff; cursor:pointer; font-weight:bold;">
                                    ${conf.label}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    <button id="t7-save-btn" style="width: 100%; padding: 10px; background: #caa55c; color: #1d1620; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">Сохранить и загрузить</button>
                </div>
            `, { compact: true });

            const input = modal?.querySelector('#t7-channel-input');
            const saveBtn = modal?.querySelector('#t7-save-btn');
            if (!input || !saveBtn) return;

            // Мгновенная смена размера смайлов + сохранение в localStorage.
            modal.querySelectorAll('.t7-size-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    SevenTV.size = btn.dataset.size;
                    try {
                        localStorage.setItem(SevenTV.SIZE_KEY, SevenTV.size);
                    } catch (e) {
                        dbg('[7TV] Не удалось сохранить размер', e);
                    }
                    SevenTV.applySize();

                    // Обновляем визуал кнопок
                    modal.querySelectorAll('.t7-size-btn').forEach(b => {
                        const isActive = b.dataset.size === SevenTV.size;
                        b.style.border = isActive ? '1px solid #9146ff' : '1px solid #444';
                        b.style.background = isActive ? '#9146ff' : '#111';
                    });
                });
            });

            saveBtn.addEventListener('click', async () => {
                const nick = String(input.value || '').trim().toLowerCase();
                const nextChannel = nick || SevenTV.DEFAULT_CHANNEL;

                // Канал не изменился — просто закрываем окно, без запросов к API.
                if (nextChannel === SevenTV.channel) {
                    UI.closeModals();
                    return;
                }

                // Канал изменился — сохраняем и принудительно перезагружаем набор.
                try {
                    localStorage.setItem(SevenTV.CHANNEL_KEY, nick);
                } catch (e) {
                    dbg('[7TV] Не удалось сохранить канал', e);
                }
                SevenTV.channel = nextChannel;
                UI.closeModals();
                UI.showToast('Загрузка эмоутов канала...');
                await SevenTV.load(true); // Принудительная перезагрузка
                this.renderMessages();    // Перерисовать чат (если открыт)
                UI.showToast(`Эмоуты обновлены (${SevenTV.emotes.size} шт)`);
            });
        },

        toggle() {
            if (this.disabled) {
                UI.showToast('🚫 Перехват чата отключен в меню 🐱', true);
                return;
            }
            const open = this.widget.classList.toggle('open');
            if (open) {
                this.unreadCount = 0;
                this.updateBadge();
                this.updateInputState();
                this.startBackgroundLiveListener();
                const inp = this.widget?.querySelector('#chat-input') || document.getElementById('chat-input');
                if (inp && !inp.disabled) inp.focus();
                if (this.activeTab === 'mine') {
                    const box = this.widget?.querySelector('#chat-messages') || document.getElementById('chat-messages');
                    if (box) box.scrollTop = box.scrollHeight;
                } else {
                    if (!this.historyLoaded) this.loadHistory();
                    else {
                        const box = this.widget?.querySelector('#chat-messages') || document.getElementById('chat-messages');
                        if (box) box.scrollTop = box.scrollHeight;
                    }
                }
            } else {
                this.stopBackgroundLiveListener();
            }
        },

        // Открыть диалог с игроком прямо в виджете (используется кликабельными тостами ЛС)
        openDM(nick) {
            if (!nick) return;
            if (!this.widget) this.init();

            this.dmTarget = nick;

            // Открываем виджет, если он свернут (в PiP-окне класс .open уже стоит)
            if (!this.widget.classList.contains('open')) {
                this.toggle(); // toggle сам выставит .open и сфокусирует инпут
            }

            // Переключаем главную вкладку на ЛС
            this.activeMainTab = 'dm';

            // Синхронизируем UI (подсветка вкладок, поле ввода)
            const mainTabs = this.widget.querySelectorAll('.chat-main-tab');
            mainTabs.forEach(t => {
                t.classList.toggle('active', t.getAttribute('data-main-tab') === 'dm');
            });
            const subTabsRow = this.widget.querySelector('#chat-sub-tabs');
            if (subTabsRow) subTabsRow.style.display = 'none';

            // Диалог открыт — снимаем счётчик непрочитанных
            if (typeof Players !== 'undefined' && typeof Players.clearUnreadDM === 'function') {
                Players.clearUnreadDM(nick);
            }

            this.updateInputState();
            this.renderMessages();
        },

        close() { 
            if (this._popoutWin) {
                try { this._popoutWin.close(); } catch(e) {}
                this._popoutWin = null;
                this.widget.classList.remove('open');
                this.stopBackgroundLiveListener();
                return;
            }
            this.widget.classList.remove('open'); 
            this.stopBackgroundLiveListener();
        },

        async popoutChat() {
            if (this.disabled) {
                UI.showToast('🚫 Чат отключен в настройках FAB', true);
                return;
            }

            if (this._popoutWin) {
                if (!this._popoutWin.closed) {
                    try { this._popoutWin.focus(); } catch (e) {}
                    return;
                }
                // Окно закрылось без pagehide (kill процесса) — сбрасываем ссылку
                this._popoutWin = null;
            }

            try {
                let win = null;

                // 1. Проверяем API documentPictureInPicture
                if (window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function') {
                    // Не открывать второй PiP, если первый уже висит
                    if (window.documentPictureInPicture.window) {
                        try { window.documentPictureInPicture.window.focus(); } catch (e) {}
                        this._popoutWin = window.documentPictureInPicture.window;
                        SevenTV.applySize();
                        return;
                    }
                    try {
                        win = await window.documentPictureInPicture.requestWindow({ width: 350, height: 500 });
                    } catch (pipErr) {
                        dbg('documentPictureInPicture error:', pipErr);
                        // Не падаем в window.open молча — это источник about:blank.
                        UI.showToast('PiP недоступен: ' + (pipErr.message || 'unknown'), true);
                        return;
                    }
                }

                // 2. Резервный путь только если PiP API вообще нет (не Chrome)
                if (!win) {
                    try {
                        win = window.open('', 'LegionChatPopout', 'width=350,height=500,resizable=yes,scrollbars=no');
                    } catch (e) {}
                }

                if (!win) {
                    UI.showToast('Не удалось открыть окно чата', true);
                    return;
                }

                this._popoutWin = win;

                // 3. Копируем все CSS стили в новое окно
                try {
                    [...document.styleSheets].forEach(sheet => {
                        try {
                            if (sheet.href) {
                                const link = win.document.createElement('link');
                                link.rel = 'stylesheet';
                                link.href = sheet.href;
                                win.document.head.appendChild(link);
                            } else if (sheet.cssRules) {
                                const style = win.document.createElement('style');
                                for (const rule of sheet.cssRules) {
                                    style.appendChild(win.document.createTextNode(rule.cssText));
                                }
                                win.document.head.appendChild(style);
                            }
                        } catch (e) {}
                    });

                    document.querySelectorAll('style').forEach(s => {
                        try {
                            const style = win.document.createElement('style');
                            style.textContent = s.textContent;
                            win.document.head.appendChild(style);
                        } catch (e) {}
                    });

                    const baseStyle = win.document.createElement('style');
                    baseStyle.textContent = `
                        html, body {
                            color-scheme: dark;
                            color: #f7eadf;
                            background: #1a1418;
                            margin: 0;
                            padding: 0;
                            width: 100%;
                            height: 100%;
                            overflow: hidden;
                            font-family: 'Nunito', sans-serif;
                        }
                        .chat-widget {
                            display: flex !important;
                            flex-direction: column !important;
                            height: 100% !important;
                            width: 100% !important;
                            overflow: hidden !important;
                        }
                        .chat-top-bar, .chat-sub-tabs {
                            flex-shrink: 0 !important;
                        }
                        .chat-messages {
                            flex: 1 1 0% !important; /* Жестко задаем базовый размер 0, чтобы контейнер сжимался */
                            min-height: 0 !important;
                            overflow-y: auto !important;
                            display: flex !important;
                            flex-direction: column !important;
                        }
                        .chat-input-area {
                            flex-shrink: 0 !important;
                            background: #111;
                            border-top: 1px solid #333;
                            padding: 10px;
                            display: flex;
                            gap: 5px;
                        }
                    `;
                    win.document.head.appendChild(baseStyle);
                    win.document.title = '💬 Чат Legion';
                } catch (e) {
                    dbg('Error copying styles to popout window:', e);
                }

                // Размер смайлов 7TV задаётся CSS-переменной — переносим её в PiP.
                SevenTV.applySize();

                // 4. Запоминаем родной парент и позицию — вернуть нужно туда, а не в body.
                this._origWidgetParent = this.widget.parentNode;
                this._origWidgetNextSibling = this.widget.nextSibling;
                this._origWidgetClasses = this.widget.className;
                this._origWidgetHadOpen = this.widget.classList.contains('open');

                // Сохраняем исходные стили виджета (все свойства, которые меняем в PiP-режиме)
                this._origWidgetStyles = {
                    position: this.widget.style.position || '',
                    top: this.widget.style.top || '',
                    left: this.widget.style.left || '',
                    bottom: this.widget.style.bottom || '',
                    right: this.widget.style.right || '',
                    width: this.widget.style.width || '',
                    height: this.widget.style.height || '',
                    maxWidth: this.widget.style.maxWidth || '',
                    maxHeight: this.widget.style.maxHeight || '',
                    minWidth: this.widget.style.minWidth || '',
                    minHeight: this.widget.style.minHeight || '',
                    borderRadius: this.widget.style.borderRadius || '',
                    border: this.widget.style.border || '',
                    boxShadow: this.widget.style.boxShadow || '',
                    display: this.widget.style.display || '',
                    flexDirection: this.widget.style.flexDirection || '',
                    overflow: this.widget.style.overflow || ''
                };

                // 5. Переносим виджет в body нового окна (растягиваем на всё окно PiP)
                this.widget.style.position = 'relative';
                this.widget.style.top = '0';
                this.widget.style.left = '0';
                this.widget.style.bottom = 'auto';
                this.widget.style.right = 'auto';
                this.widget.style.width = '100%';
                this.widget.style.height = '100%'; // Важно
                this.widget.style.maxWidth = '100%';
                this.widget.style.maxHeight = '100%'; // Важно
                this.widget.style.minWidth = '0'; // Важно
                this.widget.style.minHeight = '0'; // Важно
                this.widget.style.borderRadius = '0';
                this.widget.style.border = 'none';
                this.widget.style.boxShadow = 'none';
                this.widget.style.display = 'flex';
                this.widget.style.flexDirection = 'column';
                this.widget.style.overflow = 'hidden';
                this.widget.classList.add('open');

                win.document.body.appendChild(this.widget);

                // 6. Обработчик возврата виджета при закрытии окна
                const returnWidget = () => {
                    if (!this._popoutWin) return;
                    this._popoutWin = null;
                    const orig = this._origWidgetStyles || {};
                    const parent = this._origWidgetParent;
                    const nextSibling = this._origWidgetNextSibling;
                    if (this.widget) {
                        // Возврат строго в родной парент (не в body). Иначе виджет теряет
                        // контекст позиционирования и растягивает страницу.
                        if (parent && parent.isConnected) {
                            if (nextSibling && nextSibling.parentNode === parent) {
                                parent.insertBefore(this.widget, nextSibling);
                            } else {
                                parent.appendChild(this.widget);
                            }
                        } else if (document.body) {
                            document.body.appendChild(this.widget);
                        }
                        // Снимаем все inline-стили, затем накатываем сохранённые
                        this.widget.removeAttribute('style');
                        Object.assign(this.widget.style, orig);
                        // Восстанавливаем классы: убираем .open, если его не было
                        if (!this._origWidgetHadOpen) this.widget.classList.remove('open');
                        // Если он был .open — оставляем; иначе класс .open не должен появиться
                    }
                    this._origWidgetStyles = null;
                    this._origWidgetParent = null;
                    this._origWidgetNextSibling = null;
                    this._origWidgetClasses = null;
                    this.renderMessages();
                    this.updateInputState();
                };

                win.addEventListener('pagehide', returnWidget);
                win.addEventListener('unload', returnWidget);

                this.startBackgroundLiveListener();
                this.renderMessages();
                this.updateInputState();
                UI.showToast('📺 Чат вынесен в отдельное окно');
            } catch (err) {
                dbg('Popout chat failed:', err);
                UI.showToast('Ошибка при открытии окна чата', true);
            }
        },

        updateBadge() {
            const badges = document.querySelectorAll('#' + DOM_IDS.chatBadge + ', #' + DOM_IDS.fabChatBadge + ', #chat-badge, #fab-chat-badge');
            badges.forEach(b => {
                if (this.unreadCount > 0) {
                    b.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
                    b.style.display = 'block';
                } else {
                    b.style.display = 'none';
                }
            });
        },

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

        getRoleMeta(role, isSystem) {
            if (isSystem) return { icon: '🏆', color: '#f0ad4e' }; // Для летописи/достижений
            const map = {
                'necromancer': { icon: '💀', color: '#b9a2ff' },
                'paladin': { icon: '🔨', color: '#f3d36b' },
                'priest': { icon: '✨', color: '#f0ad4e' },
                'mage': { icon: '🔮', color: '#5bc0de' },
                'rogue': { icon: '🗡️', color: '#d8bfd8' },
                'archer': { icon: '🏹', color: '#5cb85c' },
                'legionary': { icon: '🛡️', color: '#d9534f' },
            };
            return map[role] || { icon: '👤', color: '#ffcf6a' };
        },

        // Главная функция приема сообщений (§2.3 дедуп по id + дедуп своих исходящих)
        handleIncoming(author, text, isMine = false, isHistory = false, id = null, seq = null, role = null, isSystem = false, aw = null, channel = null, k = null, to = null, rank = null) {
            if (!text) return;

            // Перехват и фильтрация ЛС (не добавлять в общий чат)
            if (channel === 'dm' || k === 'dm') {
                if (typeof Players !== 'undefined' && Players.handleIncomingDM) {
                    Players.handleIncomingDM(author, text, to);
                }
                // Если этот диалог сейчас открыт во вкладке «✉️ ЛС» — считаем прочитанным.
                // Перерисовку выполняет Players.refreshUnreadDMViews() -> Chat.renderMessages().
                if (typeof Players !== 'undefined' && this.activeMainTab === 'dm' && this.dmTarget) {
                    const myNick = (this.myNick || '').toLowerCase();
                    const isSelf = (author === 'Я') || (!!myNick && String(author || '').toLowerCase() === myNick);
                    const peer = isSelf ? (to || '') : (author || '');
                    if (peer && String(peer).toLowerCase() === String(this.dmTarget).toLowerCase()) {
                        Players.clearUnreadDM(peer);
                    }
                }
                return;
            }

            // 1. Если сообщение с таким ID уже есть и оно НЕ в статусе pending — это повтор из поллинга, пропускаем
            if (id && this.messages.slice(-100).some(m => m.id === id && !m._pending)) {
                return;
            }

            // 2. Дедупликация и сопоставление своих исходящих сообщений (_pending)
            const isSelf = author === this.myNick || (this.myNick && author && author.toLowerCase() === this.myNick.toLowerCase());
            if (isSelf) {
                let pendingMsg = null;
                for (let i = this.messages.length - 1; i >= 0; i--) {
                    const m = this.messages[i];
                    const authorMatch = m.author === author || m.author === this.myNick;
                    const textMatch = m.text === text;
                    // Pending-сообщение наше собственное: канал эха может отличаться
                    // (мы в шахте, а отправили в город), поэтому для _pending канал
                    // не проверяем — он останется тем, куда мы реально отправили.
                    const channelMatch = !channel || !m.channel || m.channel === channel || m._pending;
                    if (authorMatch && textMatch && channelMatch && (m._pending || (id && m.id === id))) {
                        pendingMsg = m;
                        break;
                    }
                }
                if (pendingMsg) {
                    pendingMsg._pending = false;
                    if (id && !pendingMsg.id) pendingMsg.id = id;
                    if (seq && !pendingMsg.seq) pendingMsg.seq = seq;
                    if (role && !pendingMsg.role) pendingMsg.role = role;
                    if (rank && !pendingMsg.rank) pendingMsg.rank = rank;
                    if (aw && !pendingMsg.aw) pendingMsg.aw = aw;
                    // НЕ ПЕРЕЗАПИСЫВАЕМ КАНАЛ, если он уже задан (например, 'city')
                    // Эхо может прийти как 'mine', если мы в шахте, но мы знаем, куда отправили.
                    if (!pendingMsg.channel && channel) pendingMsg.channel = channel;
                    // Своё сообщение тоже должно попасть в кэш: сюда мы приходим
                    // на эхо сервера, а основная ветка ниже уже пропускается.
                    if (!isHistory) this.cacheOwnMessage(pendingMsg);
                    this.renderMessages();
                    return;
                }
            }

            // 3. Дедупликация сообщений без ID (по автору и тексту за последние 8 секунд)
            if (!isHistory && !isMine && !id) {
                if (this.messages.slice(-25).some(m => m.author === author && m.text === text && (m.channel === channel || !m.channel || !channel) && Date.now() - m.ts < 8000)) return;
            }

            const msgObj = { author, text, role, rank, isSystem, id, seq, aw, channel, k, to, ts: Date.now() };
            this.messages.push(msgObj);

            // Сохраняем в кэш только живые сообщения
            if (!isHistory) this.saveToStorage(author, text, role, isSystem, channel, k, aw, rank, id);

            // Обновляем UI
            if (!isHistory) {
                this.renderMessages();
                // Скролл вниз выполняет renderMessages() и только если пользователь
                // уже был внизу — иначе чтение истории не прерывается.
                if (!this.isOpen() && !isMine && !isSelf) {
                    this.unreadCount++;
                    this.updateBadge();
                }
            }
        },

        // Клик по нику автора: вставляем «@Ник » в поле ввода
        insertMention(nick) {
            if (!nick) return;
            const inp = this.widget?.querySelector('#chat-input') || document.getElementById('chat-input');
            if (!inp || inp.disabled) return;
            const mention = '@' + nick + ' ';
            const val = inp.value || '';
            let start = typeof inp.selectionStart === 'number' ? inp.selectionStart : val.length;
            let end = typeof inp.selectionEnd === 'number' ? inp.selectionEnd : val.length;
            if (start > val.length) start = val.length;
            if (end > val.length) end = val.length;
            inp.value = val.slice(0, start) + mention + val.slice(end);
            const pos = start + mention.length;
            try { inp.setSelectionRange(pos, pos); } catch (e) {}
            inp.focus();
        },

        // Все диалоги ЛС: ключи LEGION_DM_HISTORY_* в localStorage
        getDMDialogs() {
            const dialogs = [];
            const myNick = (this.myNick || '').toLowerCase();
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const storageKey = localStorage.key(i);
                    if (!storageKey || !storageKey.startsWith('LEGION_DM_HISTORY_')) continue;
                    const nickKey = storageKey.slice('LEGION_DM_HISTORY_'.length);
                    if (!nickKey) continue;
                    let history = [];
                    try {
                        const rawHistory = JSON.parse(localStorage.getItem(storageKey) || '[]');
                        if (Array.isArray(rawHistory)) history = rawHistory;
                    } catch (e) { history = []; }
                    const last = history[history.length - 1] || null;
                    let peerNick = nickKey;
                    if (last) {
                        // Ник собеседника — участник диалога, совпадающий с ключом хранилища
                        const candidates = [last.from, last.to].filter(Boolean);
                        const matched = candidates.find(n => String(n).toLowerCase() === nickKey);
                        peerNick = matched || ((last.from && String(last.from).toLowerCase() !== myNick) ? last.from : (last.to || nickKey));
                    }
                    const unread = (typeof Players !== 'undefined' && typeof Players.getUnreadDM === 'function')
                        ? Players.getUnreadDM(nickKey) : 0;
                    dialogs.push({ key: nickKey, nick: peerNick || nickKey, last, ts: (last && last.ts) || 0, unread });
                }
            } catch (e) {}
            return dialogs.sort((a, b) => ((b.unread > 0) ? 1 : 0) - ((a.unread > 0) ? 1 : 0) || (b.ts - a.ts));
        },

        // Список диалогов во вкладке «✉️ ЛС»
        renderDMDialogList(box) {
            const ownerDoc = box.ownerDocument || document;
            const dialogs = this.getDMDialogs();
            box.innerHTML = '';
            if (dialogs.length === 0) {
                box.innerHTML = `<div style="color:#888; text-align:center; padding:25px 15px; font-style:italic;">Диалогов пока нет.<br><span style="font-size:12px;">Откройте Досье игрока или напишите «/w Ник текст».</span></div>`;
                return;
            }
            dialogs.forEach(d => {
                const row = ownerDoc.createElement('div');
                row.className = 'chat-dialog-row';
                row.setAttribute('data-nick', d.nick);
                row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 10px; background:#26202e; border:1px solid #44374a; border-radius:6px; margin-bottom:6px; cursor:pointer;';
                const preview = d.last ? String(d.last.text || '').slice(0, 45) : '';
                const unreadBadge = d.unread > 0
                    ? `<span style="background:#ff3b5c; color:#fff; font-size:10px; font-weight:bold; padding:1px 6px; border-radius:10px;">${d.unread}</span>`
                    : '';
                row.innerHTML = `
                    <div style="min-width:0;">
                        <div style="font-weight:bold; color:#f7eadf; font-size:13px;">${Utils.escapeHtml(d.nick)}</div>
                        <div style="color:#aaa; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${Utils.escapeHtml(preview)}</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        <span style="color:#8899aa; font-size:10px;">${Utils.escapeHtml((d.last && d.last.time) || '')}</span>
                        ${unreadBadge}
                    </div>`;
                row.addEventListener('click', () => {
                    // Диалог открывается прямо в виджете, нативный чат игры не трогаем
                    if (typeof Players !== 'undefined' && typeof Players.clearUnreadDM === 'function') {
                        Players.clearUnreadDM(d.nick);
                    }
                    this.dmTarget = d.nick;
                    this.updateInputState();
                    this.renderMessages();
                });
                box.appendChild(row);
            });
        },

        // Функция отрисовки (вызывается при клике на вкладки и приходе новых сообщений)
        renderMessages() {
            const box = this.widget?.querySelector('#chat-messages') || document.getElementById('chat-messages');
            if (!box) return;

            // Запоминаем позицию ДО очистки: если пользователь читает историю,
            // новый рендер не должен утаскивать его вниз.
            const wasAtBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 50;
            const prevScrollTop = box.scrollTop;
            const prevDmBox = box.querySelector('.chat-dm-messages');
            const dmWasAtBottom = prevDmBox ? (prevDmBox.scrollHeight - prevDmBox.scrollTop - prevDmBox.clientHeight) < 50 : true;
            const dmPrevScrollTop = prevDmBox ? prevDmBox.scrollTop : 0;

            box.innerHTML = '';

            // Вкладка «✉️ ЛС»: либо открытый диалог, либо список всех диалогов
            if (this.activeMainTab === 'dm') {
                if (this.dmTarget) {
                    const ownerDoc = box.ownerDocument || document;

                    // Шапка диалога
                    box.innerHTML = `<div style="padding: 5px 10px; border-bottom: 1px solid #44374a; display: flex; justify-content: space-between; align-items: center; background: #2a2030; flex-shrink: 0;">
                        <span style="font-weight: bold; color: #ffcf6a;">Диалог с ${Utils.escapeHtml(this.dmTarget)}</span>
                        <button id="dm-back-btn" style="background: none; border: 1px solid #ff8fa3; color: #ff8fa3; border-radius: 4px; padding: 2px 6px; cursor: pointer; font-size: 11px;">Назад</button>
                    </div>`;

                    // Контейнер для сообщений
                    const msgContainer = ownerDoc.createElement('div');
                    msgContainer.className = 'chat-dm-messages';
                    msgContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 10px; overflow-y: auto; flex: 1;';
                    box.appendChild(msgContainer);

                    // Загружаем историю (используем метод из Players)
                    const history = Players.getDMHistory(this.dmTarget);
                    const myNick = (this.myNick || '').toLowerCase();

                    if (history.length === 0) {
                        msgContainer.innerHTML = `<div style="text-align:center; color:#888; font-style:italic; margin:auto;">История пуста...</div>`;
                    } else {
                        history.forEach(m => {
                            const isMe = (m.from || '').toLowerCase() === myNick || m.from === 'Я';
                            const div = ownerDoc.createElement('div');
                            div.style.cssText = `align-self: ${isMe ? 'flex-end' : 'flex-start'}; max-width: 80%; background: ${isMe ? '#1d3827' : '#282030'}; border: 1px solid ${isMe ? '#2e5d3e' : '#4d3a5a'}; border-radius: 8px; padding: 6px 10px; color: #fff; word-break: break-word;`;
                            div.innerHTML = `<div style="font-size:13px; line-height:1.4;">${SevenTV.replaceEmotes(m.text)}</div><div style="font-size:10px; color:#aaa; text-align:right; margin-top:2px;">${Utils.escapeHtml(m.time || '')}</div>`;
                            msgContainer.appendChild(div);
                        });
                        SevenTV.decorate(msgContainer);
                        // Вниз — только если пользователь и так был внизу.
                        if (dmWasAtBottom) msgContainer.scrollTop = msgContainer.scrollHeight;
                        else msgContainer.scrollTop = dmPrevScrollTop;
                    }

                    // Обработчик кнопки "Назад"
                    box.querySelector('#dm-back-btn').onclick = () => {
                        this.dmTarget = null;
                        this.updateInputState();
                        this.renderMessages();
                    };
                } else {
                    this.renderDMDialogList(box);
                }
                return; // Важно: выходим, чтобы не рендерить общий чат
            }

            // Заглушка, если игрок находится в городе (§ Задача 2 & 4)
            if (this.activeMainTab === 'mine' && !this.isInMine()) {
                box.innerHTML = `
                    <div style="color:#aaa; text-align:center; padding:35px 15px; font-style:italic; line-height:1.6;">
                        <span style="font-size:32px; display:block; margin-bottom:8px;">⛏️</span>
                        <b style="color:#ffcf6a; font-size:14px;">Вы находитесь в городе.</b><br>
                        Чат шахты доступен только во время нахождения в шахте.
                    </div>`;
                return;
            }

            const filtered = this.messages.filter(m => {
                // ЛС отображаются отдельно — во вкладке «✉️ ЛС»
                if (m.k === 'dm') return false;

                const isMineMsg = m.channel === 'mine' || m.room === 'mine' || m.ch === 'mine';

                // Вкладка «Шахта»
                if (this.activeMainTab === 'mine') {
                    return !m.isSystem && isMineMsg;
                }

                // Вкладки города (Общий / Торговля / Достижения)
                if (isMineMsg) return false; // в городе сообщения шахты не показываем

                if (this.activeSubTab === 'general') {
                    // Общий: всё, что не торговля и не система
                    return !m.isSystem && m.k !== 'tr';
                }
                if (this.activeSubTab === 'trade') {
                    // Торговля: СТРОГО только серверный/локальный флаг 'tr'
                    return !m.isSystem && m.k === 'tr';
                }
                if (this.activeSubTab === 'ach') {
                    return m.isSystem;
                }
                return true;
            });

            const ownerDoc = box.ownerDocument || document;

            filtered.slice(-150).forEach(m => {
                const meta = this.getRoleMeta(m.role, m.isSystem);
                const div = ownerDoc.createElement('div');
                div.className = 'chat-msg' + (m._pending ? ' pending' : '');

                const isStreamer = !m.isSystem && this.isStreamerMessage(m);
                const isMention = !m.isSystem && this.isMentionedMessage(m);

                if (isStreamer) div.classList.add('streamer-msg');
                if (isMention) div.classList.add('mention-msg');

                const streamerBadge = isStreamer 
                    ? `<span style="background:#ffd700; color:#1d1620; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:4px; margin-right:4px;">👑 Стример</span>` 
                    : '';
                const mentionBadge = isMention 
                    ? `<span style="background:#f7768e; color:#fff; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:4px; margin-right:4px;">🔔 Упоминание</span>` 
                    : '';

                let formattedText = (typeof SevenTV !== 'undefined' && SevenTV.replaceEmotes)
                    ? SevenTV.replaceEmotes(m.text)
                    : Utils.escapeHtml(m.text);
                if (isMention && this.myNick) {
                    const escNick = Utils.escapeRegex(Utils.escapeHtml(this.myNick));
                    const reg = new RegExp(`(@?${escNick})`, 'gi');
                    // Подсвечиваем ник только в текстовых узлах, не задевая атрибуты img эмоутов.
                    formattedText = formattedText.split(/(<[^>]*>)/).map(part =>
                        part.startsWith('<') ? part : part.replace(reg, '<mark style="background:rgba(247,118,142,0.35);color:#ff757f;padding:1px 3px;border-radius:3px;">$1</mark>')
                    ).join('');
                }

                const authorNick = m.author || '';

                // Бейдж титула (aw) перед ником автора
                let awardBadge = '';
                const aw = m.aw;
                if (Array.isArray(aw) && aw.length > 0 && aw[0] && typeof aw[0] === 'object') {
                    const award = aw[0];
                    awardBadge = `<span class="chat-award-badge" title="${Utils.escapeHtml(award.d || '')}" style="display:inline-block; background:rgba(202,165,92,0.15); border:1px solid #caa55c; color:#ffcf6a; font-size:10px; font-weight:bold; padding:1px 6px; border-radius:10px; margin-right:6px; vertical-align:middle;">${Utils.escapeHtml(award.i || '')} ${Utils.escapeHtml(award.n || '')}</span>`;
                }

                // Щиток модератора: сервер отдаёт статус отдельно от класса
                // (r: "mod"), поэтому рисуем его перед иконкой класса.
                const modBadge = m.rank === 'mod'
                    ? `<span class="chat-mod-badge" title="Модератор" style="display:inline-block; background:rgba(255, 207, 106, 0.15); border:1px solid #caa55c; color:#ffcf6a; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:4px; margin-right:4px; vertical-align:middle;">⚖️ Модер</span>`
                    : '';

                const authorHtml = `<span class="chat-author nick-clickable" data-nick="${Utils.escapeHtml(authorNick)}" title="Кликните, чтобы упомянуть" style="color: ${meta.color || '#ffcf6a'} !important; cursor: pointer;">${Utils.escapeHtml(authorNick)}</span>`;

                if (m.k === 'dm') {
                    div.innerHTML = `
                        <span style="background:#007bff; color:#fff; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:4px; margin-right:4px;">✉️ ЛС для ${Utils.escapeHtml(m.to || '')}</span>
                        ${modBadge}${awardBadge}${authorHtml}
                        <span class="chat-text" style="color: #6edff6 !important;">${formattedText}</span>
                    `;
                } else if (m.isSystem) {
                    div.innerHTML = `
                        ${modBadge}<span class="chat-role-icon">${meta.icon}</span>
                        <span class="chat-author" style="color: ${meta.color || '#ffcf6a'} !important;">${Utils.escapeHtml(m.author)}</span>
                        <span class="chat-text" style="color: #aaa !important; font-style: italic;">${formattedText}</span>
                    `;
                } else {
                    div.innerHTML = `
                        ${streamerBadge}${mentionBadge}${awardBadge}${modBadge}<span class="chat-role-icon">${meta.icon}</span>
                        ${authorHtml}
                        <span class="chat-envelope">✉️</span>
                        <span class="chat-text" style="color: #f7eadf !important;">${formattedText}</span>
                    `;
                }
                const nickEl = div.querySelector('.nick-clickable');
                if (nickEl) {
                    nickEl.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.insertMention(nickEl.getAttribute('data-nick'));
                    });
                }
                box.appendChild(div);
            });

            // 7TV-смайлики: подгружаем blob:-картинки для вставленных img.t7-emote.
            SevenTV.decorate(box);

            if (filtered.length === 0) {
                box.innerHTML = `<div style="color:#888; text-align:center; padding:20px; font-style:italic;">(Здесь пока пусто...)</div>`;
            }

            // Автоскролл: если пользователь был внизу ИЛИ последнее сообщение наше
            // (своё только что отправленное не должно «пропадать» под краем).
            const lastMsg = filtered[filtered.length - 1];
            const lastIsMine = lastMsg && (lastMsg._pending || lastMsg.author === this.myNick || (this.myNick && String(lastMsg.author || '').toLowerCase() === this.myNick.toLowerCase()));

            if (wasAtBottom || lastIsMine) {
                box.scrollTop = box.scrollHeight;
            } else {
                box.scrollTop = prevScrollTop;
            }
        },

        async send() {
            const input = this.widget?.querySelector('#chat-input') || document.getElementById('chat-input');
            if (!input) return;
            const rawText = input.value.trim();
            if (!rawText) return;

            // Открыт диалог во вкладке «✉️ ЛС» — отправляем ЛС прямо из виджета
            if (this.activeMainTab === 'dm' && this.dmTarget) {
                if (typeof Players === 'undefined' || typeof Players.sendDM !== 'function') {
                    this.showError('Отправка ЛС недоступна');
                    return;
                }
                input.value = '';
                const ok = await Players.sendDM(this.dmTarget, rawText);
                if (ok) {
                    this.renderMessages(); // Перерисовываем историю с новым сообщением
                } else {
                    input.value = rawText; // Возвращаем текст, если ошибка
                }
                return; // Выходим, чтобы не отправлять в общий чат
            }

            if (this.activeTab === 'ach') {
                this.showError('Вкладка достижений только для чтения');
                return;
            }
            if (this.activeMainTab === 'dm') {
                this.showError('Выберите диалог в списке «✉️ ЛС»');
                return;
            }
            if (this.cooldownUntil && Date.now() < this.cooldownUntil) {
                this.showError('Подождите перед отправкой...');
                return;
            }

            // ЛС: /w nick text, /dm nick text, /whisper nick text.
            // «@nick текст» — это НЕ ЛС, а обычное сообщение в общий чат (упоминание).
            const dmMatch = rawText.match(/^\/(?:w|dm|whisper)\s+(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+(.*))?$/i);

            let isMine = false;
            let mineId = null;
            let toUser = null;
            let cleanText = rawText;

            if (dmMatch) {
                toUser = (dmMatch[1] || dmMatch[2] || dmMatch[3] || '').trim();
                cleanText = (dmMatch[4] || '').trim();
                if (!toUser || !cleanText) {
                    this.showError('Формат: /w Ник сообщение');
                    return;
                }
            } else if (this.activeMainTab === 'mine') {
                if (!this.isInMine()) {
                    this.showError('Чат шахты доступен только в шахте');
                    return;
                }
                isMine = true;
                mineId = this.getMineId() || 'home';
            }

            input.value = '';
            const channel = dmMatch ? 'city' : (isMine ? 'mine' : 'city');

            const local = { 
                author: this.myNick, 
                text: dmMatch ? cleanText : rawText, 
                to: toUser,
                k: dmMatch ? 'dm' : (!isMine && this.activeSubTab === 'trade' ? 'tr' : undefined),
                role: this.myRole, 
                isSystem: false, 
                id: null, 
                seq: null, 
                channel,
                ts: Date.now(), 
                _pending: true 
            };
            this.messages.push(local);
            this.renderMessages();

            // 3. ПРОГРЕВ СЕССИИ: если отправляем в город (или ЛС), находясь в шахте
            if (!isMine && this.isInMine()) {
                try {
                    // ВАЖНО: используем чистый fetch, так как Utils.fetchApi возьмет контекст ШАХТЫ,
                    // и прогрев улетит не туда, дав 409 при отправке в город.
                    await fetch('/api/city/enter', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({})
                    });
                } catch (warmErr) {
                    dbg('City session warmup failed:', warmErr);
                }
            }

            try {
                let res;
                let data = null;
                let nativeOk = null;
                let lastError = null;
                if (dmMatch) {
                    const payload = { text: cleanText, to: toUser, k: 'dm' }; // k: 'dm' обязателен!

                    // 1. Пытаемся использовать нативный контекст города (как в прошлой версии)
                    const nativeCtx = window.__lgCityContext || window.LGCity;
                    if (nativeCtx && typeof nativeCtx.api === 'function') {
                        try {
                            const nativeData = await nativeCtx.api('/api/city/say', payload);
                            if (nativeData && typeof nativeData === 'object') {
                                data = nativeData;
                                nativeOk = nativeData.ok !== false;
                            }
                        } catch (err) {
                            dbg('Native DM send failed, fallback to fetch:', err);
                        }
                    }

                    // 2. Фолбэк: обычный fetch (как в прошлой версии)
                    if (!data) {
                        res = await fetch('/api/city/say', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'same-origin',
                            body: JSON.stringify(payload)
                        });
                        data = await res.json().catch(() => null);
                        if (!res.ok) {
                            nativeOk = false;
                        }
                    }
                } else if (isMine) {
                    // Чат шахты — только c=, без apiPath / location.origin / credentials / cache
                    res = await fetch(`/api/mine/chat/say?c=${encodeURIComponent(mineId)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: rawText })
                    });
                } else if (this.activeSubTab === 'trade') {
                    // Торговля
                    res = await fetch('/api/city/say', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: rawText, k: 'tr' })
                    });
                } else {
                    // Общий чат
                    res = await fetch('/api/city/say', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: rawText })
                    });
                }

                if (!data) {
                    data = await res.json().catch(() => null);
                }

                const httpOk = nativeOk !== null ? nativeOk : !!(res && res.ok);
                if (!httpOk || (data && data.ok === false)) {
                    // откат
                    this.messages = this.messages.filter(m => m !== local);
                    input.value = rawText;
                    this.renderMessages();
                    const errMsg = (data && (data.error || data.err)) || lastError || (res ? `HTTP ${res.status}` : 'Ошибка сети');
                    this.showError(errMsg);
                    if ((res && res.status === 429) || /не так быстро/i.test(errMsg)) {
                        this.cooldownUntil = Date.now() + 5000;
                    }
                    return;
                }

                // Успешная отправка
                local._pending = false;
                if (data) {
                    const msg = data.msg || data;
                    if (msg.id) local.id = msg.id;
                    if (msg.s) local.seq = msg.s;

                    // ЗАЩИТА: обновляем ник только если пришло поле l (login).
                    // Поле n (name/титул) игнорируем, иначе можно стать "Первопроходцем".
                    if (msg.l && typeof msg.l === 'string' && msg.l.length >= 2) {
                        this.myNick = msg.l;
                        local.author = this.myNick;
                    }
                    if (Array.isArray(data.m) && data.m.length > 0) {
                        this.processMineMessages(data.m);
                    }
                }
                // Гарантируем сохранение своего сообщения в кэш: эхо из потока
                // может не прийти вовсе либо прийти с чужим каналом.
                this.cacheOwnMessage(local);
                this.renderMessages();

                // Если это было ЛС, сохраняем в историю диалогов игрока
                if (dmMatch && toUser) {
                    if (typeof Players !== 'undefined' && typeof Players.saveDMMessage === 'function') {
                        const myNick = this.myNick || 'Я';
                        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        Players.saveDMMessage(toUser, {
                            from: myNick,
                            to: toUser,
                            text: cleanText,
                            time: timeStr,
                            ts: Date.now()
                        });
                        if (Players.currentDMPeer && Players.currentDMPeer.toLowerCase() === toUser.toLowerCase()) {
                            Players.renderDMMessages(toUser);
                        }
                    }
                }
            } catch (e) {
                this.messages = this.messages.filter(m => m !== local);
                input.value = rawText;
                this.renderMessages();
                this.showError('Сбой сети');
            }
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
                        this.handleIncoming(parsed.author, parsed.text, false, true, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to, parsed.rank);
                    });
                }
            } catch (e) {
                dbg('Не удалось стянуть историю города', e);
            }

            this.renderMessages();
        },

        processMineMessages(list) {
            if (!list) return;
            const chats = Utils.extractChatDeep(list);
            let added = false;
            chats.forEach(m => {
                const parsed = Utils.extractChatFields(m);
                if (parsed.text) {
                    this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, 'mine', parsed.k, parsed.to, parsed.rank);
                    added = true;
                }
            });
            if (added) this.renderMessages();
        },

        processRawMessages(msgs) {
            if (!msgs || !Array.isArray(msgs)) return;
            msgs.forEach(m => {
                const { author, text, id, seq, role, rank, isSystem, aw, channel } = Utils.extractChatFields(m);
                if (!text) return;
                this.handleIncoming(author || 'Игрок', text, false, false, id, seq, role, isSystem, aw, channel, null, null, rank);
            });
        },

        // Определяем канал живого потока: город или шахта
        resolveLiveChannel(data) {
            try {
                const d = (data && (data.body || data.data || data)) || null;
                if (d) {
                    if (d.chatRoom === 'city' || d.town) return 'city';
                    if (d.chatRoom === 'mine' || d.mine) return 'mine';
                }
            } catch (e) {}
            return this.isInMine() ? 'mine' : 'city';
        },

        async startBackgroundLiveListener() {
            if (this.disabled || this._liveConnecting) return;

            // Защита от дублирования: живой поток уже открыт или подключается.
            if (this._liveES && (this._liveES.readyState === 0 || this._liveES.readyState === 1)) return;
            // Уже идёт fetch-поллинг — второй цикл не запускаем.
            if (this._liveRunning && !this._liveES && this._livePollTimer) return;

            // Старое закрытое соединение закрываем перед созданием нового.
            if (this._liveES) {
                try { this._liveES.close(); } catch (e) {}
                this._liveES = null;
            }
            this._liveRunning = true;
            this._liveConnecting = true;

            const sid = new URL(location.href).searchParams.get('sid');
            const livePath = '/api/live' + (sid ? `?sid=${encodeURIComponent(sid)}` : '');
            // EventSource должен подключаться к /api/live без префикса канала:
            // Utils.apiPath() добавляет /c/<канал>/ и ломает поток.
            const url = livePath;

            const startPollingFallback = () => {
                if (!this._liveRunning || this._livePollTimer) return;
                this._liveConnecting = false; // EventSource не создаётся — уходим в поллинг
                dbg('Starting live fetch polling fallback...');
                const poll = async () => {
                    if (!this._liveRunning) return;
                    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                    const timeoutId = controller ? setTimeout(() => controller.abort(), 3000) : null;
                    let hasPayload = false;
                    try {
                        const curSid = new URL(location.href).searchParams.get('sid');
                        // Поллинг идёт на тот же чистый /api/live, что и EventSource (без /c/<канал>/)
                        const pollUrl = '/api/live' + (curSid ? `?sid=${encodeURIComponent(curSid)}` : '');
                        const res = await fetch(pollUrl, {
                            signal: controller ? controller.signal : undefined,
                            credentials: 'same-origin',
                            cache: 'no-store'
                        });
                        const text = await res.text();
                        let data = null;
                        try { data = JSON.parse(text); } catch (e) {}

                        // Если пришел поток SSE строками "data: {...}"
                        if (!data && text && text.includes('data:')) {
                            hasPayload = true;
                            const lines = text.split('\n');
                            for (const line of lines) {
                                if (line.startsWith('data:')) {
                                    try {
                                        const lineData = JSON.parse(line.slice(5).trim());
                                        const lineLoc = this.resolveLiveChannel(lineData);
                                        Utils.updateOnlinePlayers(lineData, lineLoc);
                                        Utils.processIncomingDMs(lineData);
                                        const chats = Utils.extractChatDeep(lineData);
                                        chats.forEach(m => {
                                            const parsed = Utils.extractChatFields(m);
                                            if (parsed.text) {
                                                this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, lineLoc, parsed.k, parsed.to, parsed.rank);
                                            }
                                        });
                                    } catch (err) {}
                                }
                            }
                        } else if (data) {
                            hasPayload = true;
                            const pollLoc = this.resolveLiveChannel(data);
                            Utils.updateOnlinePlayers(data, pollLoc);
                            Utils.processIncomingDMs(data);
                            if (data.c) this.currentMineId = data.c;
                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, pollLoc, parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                            }
                        }
                    } catch (e) {
                        dbg('Live poll error / abort:', e);
                    } finally {
                        // Бэкофф: пустые ответы не должны долбить /api/live каждые 2.5 с.
                        this._livePollDelay = hasPayload
                            ? 2500
                            : Math.min(30000, Math.max(2500, (this._livePollDelay || 2500) * 2));
                        if (timeoutId) clearTimeout(timeoutId);
                    }
                    if (this._liveRunning) {
                        this._livePollTimer = setTimeout(poll, this._livePollDelay);
                    }
                };
                poll();
            };

            try {
                if (typeof EventSource !== 'undefined') {
                    const es = new EventSource(url, { withCredentials: true, _customLive: true });
                    this._liveES = es;
                    this._liveConnecting = false;

                    es.onopen = () => console.log('Live Connected!');

                    const handleData = (raw) => {
                        try {
                            let data = raw;
                            if (typeof data === 'string') {
                                try { data = JSON.parse(data); } catch(e) {}
                            }
                            const esLoc = this.resolveLiveChannel(data);
                            Utils.updateOnlinePlayers(data, esLoc);
                            Utils.processIncomingDMs(data);
                            if (data && data.c) this.currentMineId = data.c;
                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        this.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, esLoc, parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                            }
                        } catch (err) {
                            dbg('Live ES data error:', err);
                        }
                    };

                    es.onmessage = (e) => handleData(e.data);
                    // 'message' обрабатывается onmessage выше — второй раз не вешаем
                    ['chat', 'mine', 'live', 'event', 'update'].forEach(ev => {
                        try { es.addEventListener(ev, (e) => handleData(e.data)); } catch(e) {}
                    });

                    es.onerror = (e) => {
                        dbg('Live EventSource error, switching to fetch polling:', e);
                        try { es.close(); } catch(err) {}
                        this._liveES = null;

                        // Сбрасываем TTL для всех sse-записей (делаем их «протухшими»)
                        if (window.__lgOnlinePlayers) {
                            const now = Date.now();
                            for (const [nick, info] of window.__lgOnlinePlayers.entries()) {
                                if (info && info.src === 'sse') {
                                    // Сдвигаем timestamp в прошлое — они больше не считаются свежими
                                    info.ts = now - 200000; // больше TTL_CITY (180000)
                                }
                            }
                        }

                        // Триггерим перерисовку списка игроков, если он открыт
                        if (typeof Players !== 'undefined' && Players.onOnlinePlayersUpdated) {
                            try { Players.onOnlinePlayersUpdated(); } catch(e) {}
                        }

                        startPollingFallback();
                    };
                } else {
                    startPollingFallback();
                }
            } catch (e) {
                dbg('Live EventSource init failed:', e);
                this._liveConnecting = false;
                startPollingFallback();
            }
        },

        stopBackgroundLiveListener() {
            this._liveRunning = false;
            this._liveConnecting = false;
            this._livePollDelay = 2500;
            if (this._liveES) {
                try { this._liveES.close(); } catch(e) {}
                this._liveES = null;
            }
            if (this._livePollTimer) {
                clearTimeout(this._livePollTimer);
                this._livePollTimer = null;
            }
        },

        interceptEventSource() {
            if (this._esIntercepted) return;
            // @grant переводит Tampermonkey в sandbox: window — это прокси,
            // поэтому конструктор на странице патчим через unsafeWindow (G).
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const OrigES = pageWin.EventSource || window.EventSource;
            if (!OrigES || OrigES.__lgChatProxied) return;
            this._esIntercepted = true;
            const self = this;
            class ESProxy extends OrigES {
                constructor(...args) {
                    super(...args);
                    if (args[1]?._customLive) return;
                    const url = String(args[0] || '');
                    const isLive = url.includes('/api/live');
                    const isMine = isLive || url.includes('/api/mine/');

                    const handler = (e) => {
                        try {
                            let data = e.data;
                            if (typeof data === 'string') {
                                try { data = JSON.parse(data); } catch(err) {}
                            }
                            let loc = 'city';
                            if (isLive && data) {
                                const d = data.body || data.data || data;
                                // Используем общий метод, который понимает контекст
                                loc = self.resolveLiveChannel(d);
                            } else {
                                loc = isMine ? 'mine' : 'city';
                            }
                            // Перехват игроков для модуля «Друзья» (работает всегда)
                            Utils.updateOnlinePlayers(data, loc);
                            Utils.processIncomingDMs(data);

                            // Если перехват отключен — ничего не парсим (закрытый виджет не помеха).
                            if (self.disabled) return;

                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        const ch = parsed.channel || (loc === 'mine' ? 'mine' : 'city');
                                        Chat.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                            }
                        } catch (err) {
                            dbg('ES intercept error:', err);
                        }
                    };

                    this.addEventListener('message', handler);
                    // 'message' обрабатывается строкой выше — второй раз не вешаем
                    ['city', 'chat', 'say', 'init', 'mine', 'live', 'event', 'update'].forEach(ev => {
                        try { this.addEventListener(ev, handler); } catch(e) {}
                    });
                }
            }
            try { ESProxy.__lgChatProxied = true; } catch (e) {}
            try { pageWin.EventSource = ESProxy; } catch (e) {}
            if (pageWin !== window) { try { window.EventSource = ESProxy; } catch (e) {} }
        },

        interceptWebSocket() {
            if (this._wsIntercepted) return;
            // См. interceptEventSource: патчим конструктор страницы (unsafeWindow).
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const OrigWS = pageWin.WebSocket || window.WebSocket;
            if (!OrigWS || OrigWS.__lgChatProxied) return;
            this._wsIntercepted = true;
            const self = this;
            class WSProxy extends OrigWS {
                constructor(...args) {
                    super(...args);
                    const url = String(args[0] || '');
                    const isLive = url.includes('/api/live');
                    const isMine = isLive || url.includes('/api/mine/');

                    this.addEventListener('message', async (e) => {
                        try {
                            let data = e.data;
                            if (typeof Blob !== 'undefined' && data instanceof Blob) {
                                try {
                                    const text = await data.text();
                                    try { data = JSON.parse(text); } catch(err) { data = text; }
                                } catch (err) {}
                            } else if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
                                try {
                                    const text = new TextDecoder().decode(data);
                                    try { data = JSON.parse(text); } catch(err) { data = text; }
                                } catch (err) {}
                            } else if (typeof data === 'string') {
                                try { data = JSON.parse(data); } catch(err) {}
                            }

                            let loc = 'city';
                            if (isLive && data) {
                                const d = data.body || data.data || data;
                                // Используем общий метод, который понимает контекст
                                loc = self.resolveLiveChannel(d);
                            } else {
                                loc = isMine ? 'mine' : 'city';
                            }
                            // Перехват игроков для модуля «Друзья» (работает всегда)
                            Utils.updateOnlinePlayers(data, loc);
                            Utils.processIncomingDMs(data);

                            // Если перехват отключен — ничего не парсим.
                            // При закрытом виджете сообщения всё равно нужны (счётчик непрочитанных).
                            if (self.disabled) return;

                            // 1. Извлекаем сообщения через глубокий парсер extractChatDeep
                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        const ch = parsed.channel || (loc === 'mine' ? 'mine' : 'city');
                                        Chat.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, ch, parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                                return;
                            }

                            // 2. Строка вида Author: text
                            if (typeof data === 'string' && data.includes(':')) {
                                const i = data.indexOf(':');
                                const a = data.slice(0, i).trim();
                                const t = data.slice(i + 1).trim();
                                if (a && t && t.length < 500) {
                                    Chat.handleIncoming(a, t, false, false, null, null, null, false, null, loc);
                                }
                            }
                        } catch (err) {
                            dbg('WS intercept error:', err);
                        }
                    });
                }
            }
            try { WSProxy.__lgChatProxied = true; } catch (e) {}
            try { pageWin.WebSocket = WSProxy; } catch (e) {}
            if (pageWin !== window) { try { window.WebSocket = WSProxy; } catch (e) {} }
        },

        interceptFetch() {
            if (this._fetchIntercepted) return;
            // См. interceptEventSource: в sandbox патчим fetch страницы (unsafeWindow).
            const pageWin = (typeof G !== 'undefined' && G) ? G : window;
            const origFetch = pageWin.fetch || window.fetch;
            if (!origFetch || origFetch.__lgChatProxied) return;
            this._fetchIntercepted = true;
            const self = this;
            const wrappedFetch = async function(...args) {
                const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
                const res = await origFetch.apply(this, args);

                // Задача 3: Ранний выход при отправке сообщений (не клонировать и не парсить)
                if (url.includes('/api/city/say') || url.includes('/api/mine/chat/say')) {
                    return res;
                }

                // 0. Перехват живого потока, игроков онлайн и входящих ЛС (работает всегда)
                const isLive = url.includes('/api/live');
                if (url.includes('/api/city/') || url.includes('/api/mine/') || isLive) {
                    res.clone().json().then(data => {
                        if (data) {
                            const loc = url.includes('/api/mine/') ? 'mine' : (isLive ? self.resolveLiveChannel(data) : 'city');

                            // Задача 2 & Задача 4: общее количество и топ-игроки шахты из /api/mine/state
                            if (url.includes('/api/mine/state')) {
                                const d = data.body || data.data || data;
                                if (d) {
                                    if (typeof d.here === 'number') {
                                        window.__lgMineTotalHere = d.here;
                                    } else if (d.st && typeof d.st.here === 'number') {
                                        window.__lgMineTotalHere = d.st.here;
                                    }
                                    const topList = d.st?.top || d.top;
                                    if (Array.isArray(topList)) {
                                        const now = Date.now();
                                        topList.forEach(item => {
                                            const nick = (typeof item === 'string')
                                                ? item.trim()
                                                : (item && (item[0] || item.l || item.login || item.nick || item.name || item.n));
                                            if (nick && typeof nick === 'string' && nick.trim().length >= 2 && nick.trim().toLowerCase() !== 'me') {
                                                window.__lgOnlinePlayers.set(nick.trim().toLowerCase(), { loc: 'mine', ts: now });
                                            }
                                        });
                                    }
                                }
                            }

                            Utils.updateOnlinePlayers(data, loc);
                            Utils.processIncomingDMs(data);

                            // Чат живого потока разбираем только при включённом перехвате.
                            if (isLive && !self.disabled) {
                                if (data.c) self.currentMineId = data.c;
                                const chats = Utils.extractChatDeep(data);
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        self.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, loc, parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                            }
                        }
                    }).catch(() => {});
                }

                try {
                    // 1. Отслеживание ID текущей шахты для навигации
                    if (url.includes('/api/mine/')) {
                        const mMatch = url.match(/[?&]c=([^&]+)/);
                        if (mMatch) {
                            try { self.currentMineId = decodeURIComponent(mMatch[1]); } catch(e){}
                        }
                    }

                    // 2. Профиль персонажа (/api/me)
                    if (url.includes('/api/me')) {
                        res.clone().json().then(data => {
                            const hero = data?.hero || data?.body?.hero || data?.me;
                            if (hero) {
                                window.__lgHero = hero;
                                if (hero.name) self.myNick = hero.name;
                                if (hero.class) self.myRole = hero.class;
                                const hud = document.getElementById(DOM_IDS.playerHud) || document.getElementById('legion-player-hud');
                                if (hud && hud.style.display !== 'none' && typeof UI !== 'undefined' && UI.renderPlayerHudContent) {
                                    UI.renderPlayerHudContent(hud, hero);
                                }
                            }
                        }).catch(() => {});
                    }

                    // Парсим чат всегда, если перехват не отключён.
                    // Закрытый виджет не помеха: сообщения нужны для счётчика непрочитанных.
                    if (self.disabled) {
                        return res;
                    }

                    // 4. Состояние шахты и вход в шахту (сообщения чата шахты в data.chat.chat или data.m)
                    if (url.includes('/api/mine/state') || url.includes('/api/mine/enter') || url.includes('/api/mine/chat')) {
                        res.clone().json().then(data => {
                            if (!data || !data.ok) return;
                            if (data.c) self.currentMineId = data.c;
                            const chats = Utils.extractChatDeep(data);
                            if (chats.length > 0) {
                                chats.forEach(m => {
                                    const parsed = Utils.extractChatFields(m);
                                    if (parsed.text) {
                                        self.handleIncoming(parsed.author || 'Игрок', parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, 'mine', parsed.k, parsed.to, parsed.rank);
                                    }
                                });
                            }
                        }).catch(() => {});
                    }

                    // 5. Вход в город (история чата города)
                    if (url.includes('/api/city/enter')) {
                        res.clone().json().then(data => {
                            if (data && data.ok && data.chat && Array.isArray(data.chat)) {
                                setTimeout(() => {
                                    data.chat.forEach(m => {
                                        const parsed = Utils.extractChatFields(m);
                                        if (parsed.text) {
                                            self.handleIncoming(parsed.author, parsed.text, false, false, parsed.id, parsed.seq, parsed.role, parsed.isSystem, parsed.aw, parsed.channel || 'city', parsed.k, parsed.to, parsed.rank);
                                        }
                                    });
                                }, 100);
                            }
                        }).catch(() => {});
                    }
                } catch(e) {}

                return res;
            };
            try { wrappedFetch.__lgChatProxied = true; } catch (e) {}
            try { pageWin.fetch = wrappedFetch; } catch (e) {}
            if (pageWin !== window) { try { window.fetch = wrappedFetch; } catch (e) {} }
        }
    };

    // Экспорт 7TV для отладки: window.__LEGION__.Chat.SevenTV
    Chat.SevenTV = SevenTV;

