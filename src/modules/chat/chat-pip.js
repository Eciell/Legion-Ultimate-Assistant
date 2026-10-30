    // ============================================================
    // 7.4 МОДУЛЬ: ЧАТ — PiP-окно, рендер и отправка
    // ============================================================
    // Вынесено из modules/chat.js (v11.6.0, этап 2 декомпозиции).
    // Слой-миксин: единственное место, где живёт DOM чата (окно PiP,
    // documentPictureInPicture). Рендер ленты и отправка сообщений.
    // this внутри методов — это Chat (Object.assign в chat/chat.js).

    const ChatPip = {
        widget: null,
        _popoutWin: null,
        // Документ PiP-окна. С v11.5.3 это единственное место, где живёт DOM чата:
        // обычный (встроенный) виджет удалён, за него отвечает плагин Legion7TV.
        _pipDoc: null,
        _origWidgetStyles: null,
        // Наследие встроенного виджета (возврат в родной парент). // TODO: REMOVE
        _origWidgetParent: null,
        _origWidgetNextSibling: null,
        _origWidgetClasses: null,
        _origWidgetHadOpen: false,
        cooldownUntil: 0,
        _toastTimer: null,

        // Корень чата: всегда берём актуальный DOM из документа PiP-окна.
        // this.widget может ссылаться на отсоединённый (detached) узел, поэтому
        // поиск идёт по документу, а не по сохранённой ссылке.
        _pipRoot() {
            if (this._pipDoc && this.isOpen()) {
                return this._pipDoc.querySelector('.chat-pip') || this._pipDoc.body;
            }
            return null;
        },

        // Поиск элемента чата (инпут, кнопка, лента сообщений) внутри PiP-документа.
        _pipEl(selector) {
            const root = this._pipRoot();
            return root ? root.querySelector(selector) : null;
        },

        // Синхронизация подсветки вкладок с this.activeMainTab / this.activeSubTab.
        // Ищем по всему документу PiP-окна, а не только внутри this.widget: если
        // ссылка на виджет устарела (окно пересоздано), поиск по документу всё равно
        // найдёт реальные вкладки и снимет лишние active.
        _syncTabs(doc) {
            const d = doc || this._pipDoc || (this.widget && this.widget.ownerDocument) || null;
            if (!d || typeof d.querySelectorAll !== 'function') return;

            const mainKey = (t) => t.getAttribute('data-main-tab')
                || (t.dataset && t.dataset.tab) || 'city';
            const subKey = (t) => t.getAttribute('data-sub-tab')
                || (t.dataset && t.dataset.tab) || 'general';

            d.querySelectorAll('.chat-main-tab').forEach(t => {
                t.classList.toggle('active', mainKey(t) === this.activeMainTab);
            });
            d.querySelectorAll('.chat-sub-tab').forEach(t => {
                t.classList.toggle('active', subKey(t) === this.activeSubTab);
            });

            // Суб-вкладки (Общий/Торговля/Достижения) относятся только к городу.
            const subTabsRow = typeof d.getElementById === 'function'
                ? d.getElementById('chat-sub-tabs')
                : d.querySelector('#chat-sub-tabs');
            if (subTabsRow) subTabsRow.style.display = this.activeMainTab === 'city' ? 'flex' : 'none';
        },

        showError(msg) {
            // Встроенного виджета больше нет: тост живёт внутри PiP-окна,
            // а если оно закрыто — показываем обычный тост аддона.
            const root = this._pipRoot();
            if (!root) {
                UI.showToast(msg, true);
                return;
            }
            const doc = root.ownerDocument || document;
            let toast = doc.getElementById('chat-toast');
            if (!toast) {
                toast = doc.createElement('div');
                toast.id = 'chat-toast';
                toast.style.cssText = 'position:absolute;top:45px;left:10px;right:10px;background:#ff5a7a;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;text-align:center;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,0.5);transition:opacity 0.3s;';
                root.appendChild(toast);
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

        updateInputState() {
            const inp = this._pipEl('#chat-input');
            const sendBtn = this._pipEl('#chat-send');

            // Чат живёт только в PiP-окне, поэтому состояние ввода считаем
            // по активной вкладке (город / торговля / шахта / ЛС).
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

        // DOM чата собирается только внутри документа PiP-окна.
        // В основной документ виджет больше не вставляется.
        _buildWidget(doc) {
            const docRef = doc || document;
            const widget = docRef.createElement('div');
            widget.className = 'chat-pip';
            // Важно: id НЕ должен совпадать с DOM_IDS.chatWidget — на этот id
            // в styles.js висят стили встроенного виджета (opacity:0, position:fixed).
            widget.id = 'chat-pip';
            widget.style.cssText = 'position:relative; display:flex; flex-direction:column; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; background:#1d1620; color:#f7eadf;';
            widget.innerHTML = `
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
            this.widget = widget;

            // Делегирование событий: клики по вкладкам/кнопкам внутри PiP-окна.
            widget.addEventListener('click', (e) => {
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
                    // Ищем вкладки в документе PiP-окна, а не в this.widget:
                    // после пересоздания окна ссылка на виджет может быть устаревшей.
                    const tabDoc = this._pipDoc || (this.widget && this.widget.ownerDocument) || mainTab.ownerDocument;
                    this.activeMainTab = mainTab.getAttribute('data-main-tab')
                        || (mainTab.dataset && mainTab.dataset.tab) || 'city';
                    if (tabDoc) {
                        tabDoc.querySelectorAll('.chat-main-tab').forEach(t => t.classList.remove('active'));
                    }
                    mainTab.classList.add('active');
                    this._syncTabs(tabDoc);
                    this.updateInputState();
                    this.renderMessages();
                    return;
                }

                const subTab = target.closest('.chat-sub-tab');
                if (subTab) {
                    e.preventDefault();
                    const tabDoc = this._pipDoc || (this.widget && this.widget.ownerDocument) || subTab.ownerDocument;
                    this.activeSubTab = subTab.getAttribute('data-sub-tab')
                        || (subTab.dataset && subTab.dataset.tab) || 'general';
                    if (tabDoc) {
                        tabDoc.querySelectorAll('.chat-sub-tab').forEach(t => t.classList.remove('active'));
                    }
                    subTab.classList.add('active');
                    this._syncTabs(tabDoc);
                    this.updateInputState();
                    this.renderMessages();
                    return;
                }
            });

            const inp = this.widget.querySelector('#chat-input');
            if (inp) {
                // keydown вместо keypress: keypress не срабатывает для части
                // раскладок/методов ввода и помечен как deprecated.
                inp.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.send();
                    }
                });
            }

            // Восстанавливаем активные вкладки: DOM пересоздаётся при каждом открытии PiP,
            // а состояние (город/шахта/ЛС, общий/торговля/достижения) хранится в полях.
            // Передаём сам виджет: он ещё не вставлен в документ, и querySelectorAll
            // по документу его вкладок не найдёт (по элементу — найдёт).
            this._syncTabs(widget);

            this.setupDrag();
            this.syncMe();
            return widget;
        },

        setupDrag() {
            // Виджет теперь живёт только внутри PiP-окна и растянут на всё окно,
            // поэтому перетаскивание не нужно. Код оставлен на случай возврата
            // обычного виджета. // TODO: REMOVE
            if (this._popoutWin) return;

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

            // 7TV (размер смайлов, загрузка эмоутов, кнопка настроек канала)
            // перенесён в init(): он нужен PiP-чату даже при закрытом окне.
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

        // Открыть ЛС с игроком в вынесенном чате (используется тостами ЛС).
        async openDM(nick) {
            if (!nick) return;
            if (this.disabled) {
                UI.showToast('🚫 Чат отключен в настройках FAB', true);
                return;
            }

            this.dmTarget = nick;

            // Переключаем главную вкладку на ЛС
            this.activeMainTab = 'dm';

            // Виджет живёт только в PiP-окне: если оно закрыто — открываем.
            if (!this._pipRoot()) await this.popoutChat();
            if (!this._pipRoot()) return;

            // Синхронизируем UI (подсветка вкладок, поле ввода)
            this._syncTabs();

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
            }
            // DOM чата живёт в PiP-окне и умирает вместе с ним.
            this._popoutWin = null;
            this._pipDoc = null;
            this.widget = null;
            // ВАЖНО: stopBackgroundLiveListener() здесь НЕ вызываем. Фоновый
            // слушатель запущен специально, чтобы ловить непрочитанные ЛС/чат при
            // закрытом PiP. Останавливает его только shutdown() в main.js.
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
                // Окно закрылось без pagehide (kill процесса) — сбрасываем ссылки
                this._popoutWin = null;
                this._pipDoc = null;
                this.widget = null;
            }

            try {
                let win = null;

                // 1. Проверяем API documentPictureInPicture
                if (window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function') {
                    // Не открывать второй PiP, если первый уже висит
                    if (window.documentPictureInPicture.window) {
                        const existing = window.documentPictureInPicture.window;
                        try { existing.focus(); } catch (e) {}
                        this._popoutWin = existing;
                        this._pipDoc = existing.document;
                        // Если DOM чата в окне почему-то потерялся — собираем заново.
                        if (!this._pipRoot()) {
                            try { existing.document.body.appendChild(this._buildWidget(existing.document)); } catch (e) {}
                        }
                        SevenTV.applySize();
                        this.unreadCount = 0;
                        this.updateBadge();
                        this.renderMessages();
                        this.updateInputState();
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
                this._pipDoc = win.document;

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
                        .chat-pip {
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

                // 4. DOM чата собираем сразу в документе PiP-окна:
                //    в основной странице встроенного виджета больше нет (v11.5.3).
                const widget = this._buildWidget(win.document);
                win.document.body.appendChild(widget);

                // 5. Очистка ссылок при закрытии окна: DOM чата умирает вместе с PiP,
                //    возвращать его в основную страницу больше не нужно.
                const cleanupPip = () => {
                    if (!this._popoutWin) return;
                    this._popoutWin = null;
                    this._pipDoc = null;
                    this.widget = null;
                    // Фоновый слушатель не останавливаем: он должен продолжать
                    // считать непрочитанные сообщения после закрытия PiP.
                };

                win.addEventListener('pagehide', cleanupPip);
                win.addEventListener('unload', cleanupPip);

                this.startBackgroundLiveListener();

                // Открыли чат — счётчик непрочитанных сбрасываем.
                this.unreadCount = 0;
                this.updateBadge();

                // История (кэш localStorage + /api/city/enter) нужна, чтобы PiP
                // открывался уже с сообщениями. loadHistory сам вызовет renderMessages.
                this.loadHistory();
                this.renderMessages();
                this.updateInputState();
                UI.showToast('📺 Чат вынесен в отдельное окно');
            } catch (err) {
                dbg('Popout chat failed:', err);
                UI.showToast('Ошибка при открытии окна чата', true);
            }
        },

        // Клик по нику автора: вставляем «@Ник » в поле ввода
        insertMention(nick) {
            if (!nick) return;
            const inp = this._pipEl('#chat-input');
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
            // Лента сообщений живёт в документе PiP-окна: если окно закрыто,
            // рендерить некуда — сообщения просто копятся в this.messages.
            // ВАЖНО: контейнер должен браться из актуального документа PiP-окна.
            // this.widget может указывать на устаревший (detached) DOM.
            const box = (this._pipDoc && this._pipDoc.querySelector('#chat-messages')) || this._pipEl('#chat-messages');
            if (!box) return;

            // Подсветка вкладок всегда соответствует activeMainTab/activeSubTab:
            // раньше active-класс мог накапливаться сразу на нескольких вкладках.
            this._syncTabs();

            // Окно чата открыто (контейнер найден) — непрочитанных быть не должно.
            // Гасим счётчик прямо здесь: он копился, если инкремент успевал
            // пройти до/во время открытия PiP.
            if (this.unreadCount !== 0) {
                this.unreadCount = 0;
                this.updateBadge();
            }

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
            const input = this._pipEl('#chat-input');
            if (!input) return;
            const rawText = input.value.trim();
            if (!rawText) return;

            // Открыт диалог во вкладке «✉️ ЛС» — отправляем ЛС прямо из виджета
            if (this.activeMainTab === 'dm' && this.dmTarget) {
                // Сначала проверяем, не команда ли это /w: иначе в текст сообщения
                // уйдёт «/w Ник привет» целиком, и собеседник получит команду как текст.
                const dmCmd = rawText.match(/^\/(?:w|dm|whisper)\s+(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+(.*))?$/i);
                const actualText = dmCmd ? (dmCmd[4] || '').trim() : rawText;
                if (!actualText) {
                    this.showError('Формат: /w Ник сообщение');
                    return;
                }
                if (typeof Players === 'undefined' || typeof Players.sendDM !== 'function') {
                    this.showError('Отправка ЛС недоступна');
                    return;
                }
                input.value = '';
                const ok = await Players.sendDM(this.dmTarget, actualText);
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

                    // 1. Пытаемся использовать нативный контекст города (как в прошлой версии).
                    // Контекст — объект страницы, в песочнице доступен только через G.
                    const nativeCtx = G.__lgCityContext || G.LGCity;
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
    };
