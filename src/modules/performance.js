    // ============================================================
    // 6.6. МОДУЛЬ: PERFORMANCE (modules/performance.js)
    //
    // Оптимизация памяти. Журнал событий игры (<li class="jr-e">) растёт и
    // никогда не чистится: в долгой сессии DOM доходит до 200к+ узлов, из-за
    // чего страница начинает заметно лагать. Модуль по таймеру удаляет старые
    // записи и оставляет только последние KEEP_LAST.
    //
    // ВАЖНО: трогаем ТОЛЬКО li.jr-e. FPS, глобальные анимации, интерфейс игры
    // и любые другие узлы не затрагиваются — никакого «общего» сборщика мусора.
    //
    // Выключено по умолчанию (opt-in): настройка хранится в localStorage и
    // переживает перезагрузку. Подключается после core/ui.js (SHARED_MODULES
    // в build.js): UI.showToast зовётся по клику, на этапе загрузки зависимостей
    // нет — как у остальных модулей.
    // ============================================================
    const Performance = {
        // Сколько последних записей журнала оставляем в DOM.
        KEEP_LAST: 50,
        // Период проверки, мс. Проверка дешёвая (один querySelectorAll без
        // записи в DOM, пока узлов <= KEEP_LAST), поэтому чистим раз в секунду:
        // так журнал не успевает разрастись даже при плотном потоке событий.
        CHECK_INTERVAL: 1000,
        // Ключ настройки в localStorage ('true' / 'false').
        STORAGE_KEY: 'LG_PERF_CLEANUP',

        enabled: false,
        _interval: null,

        init() {
            this.enabled = localStorage.getItem(this.STORAGE_KEY) === 'true';
            // silent = true: при загрузке страницы тост не нужен, иначе он
            // всплывал бы каждый раз при входе в игру без действий игрока.
            if (this.enabled) this.enable(true);
        },

        toggle() {
            this.enabled = !this.enabled;
            localStorage.setItem(this.STORAGE_KEY, this.enabled);
            if (this.enabled) this.enable();
            else this.disable();
            return this.enabled;
        },

        enable(silent = false) {
            // Защита от двойного интервала (например, повторный toggle/init).
            if (this._interval) return;
            this._interval = setInterval(() => this.cleanup(), this.CHECK_INTERVAL);
            if (!silent) UI.showToast('🧹 Чистка журнала ВКЛ (Оставляем 50 последних)');
        },

        disable() {
            if (this._interval) {
                clearInterval(this._interval);
                this._interval = null;
            }
            UI.showToast('🧹 Чистка журнала ВЫКЛ');
        },

        /**
         * Удаляет из журнала все записи, кроме последних KEEP_LAST.
         *
         * querySelectorAll отдаёт статичный NodeList в порядке документа,
         * поэтому индексы [0 .. length - KEEP_LAST) — самые старые узлы.
         * NodeList статичный, так что remove() по ходу цикла индексы не сдвигает.
         *
         * @returns {number} сколько узлов удалено за этот проход
         */
        cleanup() {
            try {
                const logs = document.querySelectorAll('li.jr-e');
                const excess = logs.length - this.KEEP_LAST;
                if (excess <= 0) return 0;

                for (let i = 0; i < excess; i++) logs[i].remove();
                dbg(`[PERF] Журнал очищен: удалено ${excess}, осталось ${this.KEEP_LAST}`);
                return excess;
            } catch (e) {
                dbg('[PERF] Ошибка очистки:', e);
                return 0;
            }
        }
    };
