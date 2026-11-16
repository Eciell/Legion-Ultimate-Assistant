// ==UserScript==
// @name         Guild Stats (Легион)
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Расширенная статистика и 100-балльная аналитика гильдий альянса в игре Легион
// @author       Antigravity
// @match        https://play.multidonate.ru/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /* ========================================================================== */
    /* 1. КОНСТАНТЫ И КОНФИГУРАЦИЯ                                               */
    /* ========================================================================== */

    const CONFIG = {
        STORAGE_KEY: 'LGU_GUILD_STATS_V1',
        MAX_HISTORY_DAYS: 30,                  // 30 снимков истории (по 1 в день)
        DELTA_STALE_MS: 2 * 60 * 60 * 1000,    // 2 часа для устаревания данных гильдии
        AUTO_REFRESH_MS: 10 * 60 * 1000,       // Проверка дельты раз в 10 минут
        LEGION_REFRESH_MS: 2 * 60 * 60 * 1000, // Топ-120 обновлять раз в 2 часа
        AUCTION_CACHE_MS: 5 * 60 * 1000,       // Аукцион не чаще 1 раза в 5 минут
        RAID_POLL_MS: 90 * 1000,               // Текущий рейд опрашивать раз в 90 секунд
        CITYMON_POLL_MS: 60 * 1000,            // Сборы у стен (City Monsters) раз в 60 секунд
        GUILD_LOG_POLL_MS: 5 * 60 * 1000,      // Журнал гильдии строго не чаще 1 раза в 5 минут
        ERROR_BACKOFF_MS: 5 * 60 * 1000,       // При 404 / 429 пауза 5 минут
        PRIORITY_BATCH_SIZE: 20,               // Первые 20 крупных гильдий
        PRIORITY_DELAY_MS: 2500,               // Пауза между запросами топ-20 (~50 сек)
        PRIORITY_JITTER_MS: 400,               // Случайный джиттер ±400 мс
        BG_DELAY_MS: 60 * 1000,                // 1 гильдия в минуту для оставшихся 29 гильдий (~29 минут)
        PAUSE_429_MS: 5 * 60 * 1000,           // 5 минут паузы при 429
        MAX_429_CONSECUTIVE: 3                 // После 3 ошибок 429 подряд — стоп до клика пользователя
    };

    const CLASS_INFO = {
        legionary:   { name: 'Легионер',   icon: '🛡️', color: '#d9534f' },
        archer:      { name: 'Лучник',     icon: '🏹', color: '#5cb85c' },
        mage:        { name: 'Маг',        icon: '🔮', color: '#5bc0de' },
        priest:      { name: 'Жрец',       icon: '✨', color: '#f0ad4e' },
        rogue:       { name: 'Разбойник',  icon: '🗡️', color: '#d8bfd8' },
        necromancer: { name: 'Некромант',  icon: '💀', color: '#b9a2ff' },
        paladin:     { name: 'Паладин',    icon: '☀️', color: '#f3d36b' },
        recruit:     { name: 'Новобранец', icon: '🌱', color: '#a0a0a0' }
    };

    const GUILD_ROLES = {
        leader:  { name: 'Глава',       icon: '👑', order: 1, color: '#ffc94d' },
        lead:    { name: 'Руководство', icon: '⭐', order: 2, color: '#80d8ff' },
        officer: { name: 'Руководство', icon: '⭐', order: 2, color: '#80d8ff' },
        trusted: { name: 'Доверенный',  icon: '🛡️', order: 3, color: '#b9f6ca' },
        novice:  { name: 'Новичок',     icon: '👤', order: 4, color: '#c0c6d8' },
        member:  { name: 'Новичок',     icon: '👤', order: 4, color: '#c0c6d8' }
    };

    const G = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    function isQuotaExceeded(err) {
        return (
            err &&
            (err.code === 22 ||
             err.code === 1014 ||
             err.name === 'QuotaExceededError' ||
             err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
             String(err).includes('quota') ||
             String(err).includes('QuotaExceeded'))
        );
    }

    function showToast(message, type = 'warn') {
        try {
            let container = document.getElementById('lgu-gs-toast');
            if (!container) {
                container = document.createElement('div');
                container.id = 'lgu-gs-toast';
                container.style.cssText = `
                    position: fixed;
                    bottom: 80px;
                    right: 20px;
                    max-width: 340px;
                    background: #2a1f1d;
                    border: 1px solid #ff7b72;
                    color: #ffa198;
                    padding: 10px 16px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 500;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7);
                    z-index: 10000;
                    transition: opacity 0.3s ease, transform 0.3s ease;
                    pointer-events: none;
                    opacity: 0;
                    transform: translateY(10px);
                `;
                document.body.appendChild(container);
            }
            container.textContent = message;
            container.style.opacity = '1';
            container.style.transform = 'translateY(0)';
            if (window._lguToastTimer) clearTimeout(window._lguToastTimer);
            window._lguToastTimer = setTimeout(() => {
                container.style.opacity = '0';
                container.style.transform = 'translateY(10px)';
            }, 4500);
        } catch (e) {
            console.warn('[GuildStats] Toast error:', e);
        }
    }

    /* ========================================================================== */
    /* 2. ХРАНИЛИЩЕ ДАННЫХ (STORAGE ENGINE)                                      */
    /* ========================================================================== */

    class StorageEngine {
        constructor() {
            this._lastSaveAt = 0;
            this._saveTimer = null;
            this._chatDebounceTimer = null;
            this.activeRaid = null;
            this.activeCityMon = [];
            this._seenRaidTimes = new Set();
            this._seenLobbyIds = new Set();
            this._raidBackoffUntil = 0;
            this._citymonBackoffUntil = 0;
            this._logBackoffUntil = 0;
            this.cleanLegacyLocalStorage();
            this.data = this.load();

            // Гарантированное сохранение перед закрытием/перезагрузкой страницы
            try {
                window.addEventListener('beforeunload', () => {
                    this.save(true);
                });
            } catch (e) {}
        }

        cleanLegacyLocalStorage() {
            try {
                if (G.localStorage) {
                    G.localStorage.removeItem(CONFIG.STORAGE_KEY);
                }
            } catch (e) {}
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.removeItem(CONFIG.STORAGE_KEY);
                }
            } catch (e) {}
        }

        defaultState() {
            return {
                version: 2,
                updatedAt: 0,
                lastFullScanAt: 0,
                lastLegionAt: 0,
                lastAuctionAt: 0,
                lastProcessedLogAt: 0,
                lastRaidCheckAt: 0,
                lastCityMonCheckAt: 0,
                lastGuildLogCheckAt: 0,
                myGuildId: null,
                myRole: null,
                allianceLimit: 90,
                guilds: {},
                players: {},
                history: {},
                chatHours: {},
                top120Logins: []
            };
        }

        purgeOldHistoryTo7Days() {
            const cutoff7d = Date.now() - 7 * 86400000;
            if (this.data.history) {
                for (const gid of Object.keys(this.data.history)) {
                    const list = this.data.history[gid];
                    if (Array.isArray(list)) {
                        this.data.history[gid] = list.filter((item) => item.t >= cutoff7d);
                    }
                }
            }
            // Очищаем случайных игроков, не состоящих ни в одной гильдии и не входящих в топ-120
            const validLogins = new Set();
            Object.values(this.data.guilds || {}).forEach((g) => {
                (g.members || []).forEach((m) => validLogins.add(String(m).toLowerCase()));
            });
            (this.data.top120Logins || []).forEach((l) => validLogins.add(String(l).toLowerCase()));

            for (const login of Object.keys(this.data.players || {})) {
                if (!validLogins.has(login)) {
                    delete this.data.players[login];
                }
            }
            this.data.chatHours = {};
        }

        hardResetOnStorageError() {
            console.error('[GuildStats] Ошибка записи в GM_setValue! Выполняется экстренный сброс...');
            showToast('База данных сброшена из-за переполнения', 'err');

            // 1. Полностью очищаем историю и временные данные
            this.data.history = {};
            this.data.chatHours = {};

            // 2. Оставляем только топ-10 самых крупных гильдий
            const guildEntries = Object.entries(this.data.guilds || {});
            guildEntries.sort((a, b) => (+b[1].count || 0) - (+a[1].count || 0));
            const top10 = guildEntries.slice(0, 10);

            const newGuilds = {};
            const keepLogins = new Set();
            for (const [gid, g] of top10) {
                newGuilds[gid] = g;
                (g.members || []).forEach((m) => keepLogins.add(String(m).toLowerCase()));
            }
            this.data.guilds = newGuilds;

            // 3. Оставляем только игроков оставшихся 10 гильдий и топ-120
            (this.data.top120Logins || []).forEach((l) => keepLogins.add(String(l).toLowerCase()));
            for (const login of Object.keys(this.data.players || {})) {
                if (!keepLogins.has(login)) {
                    delete this.data.players[login];
                }
            }

            // 4. Повторная попытка записи с минимальным набором данных
            try {
                const reducedJson = this._serializeState();
                if (typeof GM_setValue === 'function') {
                    GM_setValue(CONFIG.STORAGE_KEY, reducedJson);
                    console.log('[GuildStats] Экстренное сохранение после сброса выполнено успешно.');
                }
            } catch (fatal) {
                console.error('[GuildStats] Фатальная ошибка сохранения даже после экстренного сброса:', fatal);
            }
        }

        load() {
            try {
                let raw = null;
                // Основное и единственное хранилище - GM_getValue (Tampermonkey IndexedDB)
                if (typeof GM_getValue === 'function') {
                    raw = GM_getValue(CONFIG.STORAGE_KEY, null);
                } else {
                    console.warn('[GuildStats] GM_getValue недоступен! Проверьте @grant GM_getValue в заголовках скрипта.');
                }

                // Одноразовая миграция из старого localStorage (если в GM_getValue ещё пусто)
                if (!raw) {
                    try {
                        if (G.localStorage) raw = G.localStorage.getItem(CONFIG.STORAGE_KEY);
                        if (!raw && typeof localStorage !== 'undefined') raw = localStorage.getItem(CONFIG.STORAGE_KEY);
                    } catch (e) {}
                }

                // Принудительно освобождаем место в page localStorage от нашего ключа
                this.cleanLegacyLocalStorage();

                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object') {
                        const state = this.defaultState();
                        state.version = parsed.version || parsed.v || 2;
                        state.updatedAt = parsed.updatedAt || parsed.u || 0;
                        state.lastFullScanAt = parsed.lastFullScanAt || parsed.scan || 0;
                        state.lastLegionAt = parsed.lastLegionAt || parsed.legion || 0;
                        state.lastAuctionAt = parsed.lastAuctionAt || parsed.auc || 0;
                        state.lastProcessedLogAt = parsed.lastProcessedLogAt || parsed.llog || 0;
                        state.lastRaidCheckAt = parsed.lastRaidCheckAt || parsed.lrc_at || 0;
                        state.lastCityMonCheckAt = parsed.lastCityMonCheckAt || parsed.lcm_at || 0;
                        state.lastGuildLogCheckAt = parsed.lastGuildLogCheckAt || parsed.lgl_at || 0;
                        state.myGuildId = parsed.myGuildId || parsed.mg || null;
                        state.myRole = parsed.myRole || parsed.mr || null;
                        state.allianceLimit = parsed.allianceLimit || parsed.limit || 90;
                        state.top120Logins = parsed.top120Logins || parsed.top120 || [];
                        state.history = parsed.history || {};

                        // Восстановление гильдий из сжатых (i, n, tg, lv...) или полных ключей
                        for (const [gid, g] of Object.entries(parsed.guilds || {})) {
                            state.guilds[gid] = {
                                id: String(g.id || g.i || gid),
                                name: g.name || g.n || '',
                                tag: g.tag != null ? g.tag : (g.tg || ''),
                                emblem: g.emblem || g.e || '',
                                level: +(g.level || g.lv || 1),
                                xp: +(g.xp || 0),
                                xpTo: g.xpTo != null ? +g.xpTo : (g.xt != null ? +g.xt : null),
                                count: +(g.count || g.cnt || 0),
                                free: g.free != null ? +g.free : 0,
                                open: g.open != null ? !!g.open : (g.op != null ? !!g.op : true),
                                action: g.action || '',
                                descr: (g.descr || g.d || '').slice(0, 50),
                                members: Array.isArray(g.members || g.m) ? (g.members || g.m) : [],
                                chatMessages24h: +(g.chatMessages24h || g.cm || 0),
                                activeAuctionLots: +(g.activeAuctionLots || g.al || 0),
                                knownLevelsSum: +(g.knownLevelsSum || g.kl || 0),
                                lastRaidAt: +(g.lastRaidAt || g.lra || 0),
                                lastRaidCount: +(g.lastRaidCount || g.lrc || 0),
                                lastRunAt: +(g.lastRunAt || g.lru || 0),
                                updatedAt: +(g.updatedAt || g.u || 0)
                            };
                        }

                        // Восстановление игроков из сжатых (n, t, g, r, j, lv, c) или полных ключей
                        for (const [key, p] of Object.entries(parsed.players || {})) {
                            const login = p.login || p.l || key;
                            state.players[login] = {
                                login: login,
                                name: p.name || p.n || login,
                                tid: p.tid || p.t || '',
                                guildId: p.guildId || p.g || null,
                                guildRole: p.guildRole || p.r || 'novice',
                                joinedAt: p.joinedAt || p.j || 0,
                                level: p.level || p.lv || null,
                                class: p.class || p.c || null,
                                inTop120: state.top120Logins ? state.top120Logins.includes(login) : false,
                                lastRunAt: +(p.lastRunAt || p.lr || 0),
                                runCount: +(p.runCount || p.rc || 0),
                                raidCount: +(p.raidCount || p.rdc || 0),
                                wallCount: +(p.wallCount || p.wc || 0),
                                lastSeenAt: +(p.lastSeenAt || p.ls || 0),
                                msgCount: +(p.msgCount || p.mc || 0),
                                activeAuctionLots: +(p.activeAuctionLots || p.al || 0),
                                updatedAt: p.updatedAt || p.u || Date.now()
                            };
                        }

                        // Ограничиваем историю до 30 записей при загрузке
                        for (const gid of Object.keys(state.history)) {
                            if (Array.isArray(state.history[gid]) && state.history[gid].length > 30) {
                                state.history[gid] = state.history[gid].slice(-30);
                            }
                        }

                        const guildsCount = Object.keys(state.guilds || {}).length;
                        const playersCount = Object.keys(state.players || {}).length;
                        const lastScanMin = state.lastFullScanAt
                            ? Math.floor((Date.now() - state.lastFullScanAt) / 60000)
                            : null;
                        const lastScanStr = lastScanMin != null ? `${lastScanMin} мин назад` : 'никогда';
                        console.log(`[GuildStats] Кэш загружен из GM-хранилища: ${guildsCount} гильдий, ${playersCount} игроков (последний полный скан: ${lastScanStr}).`);
                        return state;
                    }
                }
            } catch (err) {
                console.warn('[GuildStats] Ошибка чтения хранилища:', err);
            }
            console.log('[GuildStats] Кэш пуст, инициализировано новое состояние.');
            return this.defaultState();
        }

        debounceChatSave() {
            if (this._chatDebounceTimer) return;
            this._chatDebounceTimer = setTimeout(() => {
                this._chatDebounceTimer = null;
                this.save();
            }, 15000);
        }

        save(force = false) {
            const now = Date.now();
            const elapsed = now - this._lastSaveAt;

            if (this._saveTimer) {
                clearTimeout(this._saveTimer);
                this._saveTimer = null;
            }

            if (force) {
                if (this._chatDebounceTimer) {
                    clearTimeout(this._chatDebounceTimer);
                    this._chatDebounceTimer = null;
                }
                this._doSave();
                return;
            }

            if (elapsed >= 5000) {
                this._doSave();
            } else {
                const delay = Math.max(500, 5000 - elapsed);
                this._saveTimer = setTimeout(() => {
                    this._saveTimer = null;
                    this._doSave();
                }, delay);
            }
        }

        _serializeState() {
            // Очистка и сжатие состояния перед сохранением
            const cleanGuilds = {};
            for (const [gid, g] of Object.entries(this.data.guilds || {})) {
                cleanGuilds[gid] = {
                    i: String(g.id),
                    n: g.name || '',
                    tg: g.tag || '',
                    e: g.emblem || '',
                    lv: +g.level || 1,
                    xp: +g.xp || 0,
                    xt: g.xpTo != null ? +g.xpTo : null,
                    cnt: +g.count || 0,
                    fr: g.free != null ? +g.free : 0,
                    op: g.open ? 1 : 0,
                    d: (g.descr || '').slice(0, 50), // обрезаем до 50 символов
                    m: Array.isArray(g.members) ? g.members : [],
                    cm: +g.chatMessages24h || 0,      // просто число
                    al: +g.activeAuctionLots || 0,
                    kl: +g.knownLevelsSum || 0,
                    lra: +g.lastRaidAt || 0,
                    lrc: +g.lastRaidCount || 0,
                    lru: +g.lastRunAt || 0,
                    u: g.updatedAt || 0
                };
            }

            const cleanPlayers = {};
            for (const [login, p] of Object.entries(this.data.players || {})) {
                // Сохраняем только реальных участников гильдий или участников топ-120
                if (!p.guildId && !p.inTop120 && !p.level && !p.class) continue;

                const cp = {};
                if (p.name && p.name !== login) cp.n = p.name;
                if (p.tid) cp.t = p.tid;
                if (p.guildId) cp.g = p.guildId;
                if (p.guildRole && p.guildRole !== 'novice') cp.r = p.guildRole;
                if (p.joinedAt) cp.j = p.joinedAt;
                if (p.level) cp.lv = p.level;
                if (p.class) cp.c = p.class;
                if (p.lastRunAt) cp.lr = p.lastRunAt;
                if (p.runCount) cp.rc = p.runCount;
                if (p.raidCount) cp.rdc = p.raidCount;
                if (p.wallCount) cp.wc = p.wallCount;
                if (p.lastSeenAt) cp.ls = p.lastSeenAt;
                if (p.msgCount) cp.mc = p.msgCount;
                if (p.activeAuctionLots) cp.al = p.activeAuctionLots;
                cleanPlayers[login] = cp;
            }

            const cleanHistory = {};
            for (const [gid, list] of Object.entries(this.data.history || {})) {
                if (Array.isArray(list) && list.length > 0) {
                    cleanHistory[gid] = list.slice(-30).map((h) => ({
                        t: h.t,
                        lv: h.lv,
                        xp: h.xp,
                        cnt: h.cnt,
                        chat: h.chat || 0,
                        lots: h.lots || 0
                    }));
                }
            }

            const cleanState = {
                v: this.data.version || 2,
                u: this.data.updatedAt || Date.now(),
                scan: this.data.lastFullScanAt || 0,
                legion: this.data.lastLegionAt || 0,
                auc: this.data.lastAuctionAt || 0,
                mg: this.data.myGuildId || null,
                mr: this.data.myRole || null,
                llog: this.data.lastProcessedLogAt || 0,
                limit: this.data.allianceLimit || 90,
                guilds: cleanGuilds,
                players: cleanPlayers,
                history: cleanHistory,
                top120: this.data.top120Logins || []
            };

            return JSON.stringify(cleanState);
        }

        _doSave() {
            this._lastSaveAt = Date.now();
            try {
                this.data.updatedAt = Date.now();
                const json = this._serializeState();

                // Единственное и основное хранилище - GM_setValue (Tampermonkey IndexedDB)
                if (typeof GM_setValue === 'function') {
                    try {
                        GM_setValue(CONFIG.STORAGE_KEY, json);
                    } catch (err) {
                        this.hardResetOnStorageError();
                    }
                } else {
                    console.warn('[GuildStats] GM_setValue недоступен! Проверьте @grant GM_setValue.');
                    showToast('Предупреждение: GM_setValue недоступен в Tampermonkey', 'warn');
                }

            } catch (err) {
                console.error('[GuildStats] Исключение в _doSave:', err);
                this.hardResetOnStorageError();
            }
        }

        findLogin(identifier) {
            if (!identifier) return null;
            const str = String(identifier).trim().toLowerCase();
            if (this.data.players[str]) return str;
            for (const [login, p] of Object.entries(this.data.players)) {
                if (p.name && p.name.trim().toLowerCase() === str) return login;
            }
            return null;
        }

        getOrCreatePlayer(identifier, defaultGuildId = null) {
            if (!identifier) return null;
            const foundLogin = this.findLogin(identifier);
            if (foundLogin && this.data.players[foundLogin]) {
                const p = this.data.players[foundLogin];
                p.lastRunAt = +(p.lastRunAt || 0);
                p.runCount = +(p.runCount || 0);
                p.raidCount = +(p.raidCount || 0);
                p.wallCount = +(p.wallCount || 0);
                p.lastSeenAt = +(p.lastSeenAt || 0);
                p.msgCount = +(p.msgCount || 0);
                p.activeAuctionLots = +(p.activeAuctionLots || 0);
                return p;
            }
            const cleanId = String(identifier).trim();
            const low = cleanId.toLowerCase();
            const p = {
                login: low,
                name: cleanId,
                tid: '',
                guildId: defaultGuildId || this.data.myGuildId || null,
                guildRole: 'novice',
                joinedAt: 0,
                level: null,
                class: null,
                inTop120: false,
                lastRunAt: 0,
                runCount: 0,
                raidCount: 0,
                wallCount: 0,
                lastSeenAt: 0,
                msgCount: 0,
                activeAuctionLots: 0,
                updatedAt: Date.now()
            };
            this.data.players[low] = p;
            return p;
        }

        updateMyGuildMeta(res) {
            if (res && res.mine && res.mine.member && res.mine.member.guild) {
                this.data.myGuildId = String(res.mine.member.guild);
                this.data.myRole = res.mine.member.role || 'member';
            } else {
                this.data.myGuildId = null;
                this.data.myRole = null;
            }
        }

        updateRaidStatus(res) {
            this.data.lastRaidCheckAt = Date.now();
            if (!res || !res.ok) {
                this.activeRaid = null;
                return;
            }
            this.activeRaid = res;
            if (res.plan && (res.st === 'open' || res.st === 'fight') && Array.isArray(res.joined)) {
                const raidKey = String(res.plan.name || '') + '_' + String(res.plan.at || '');
                if (!this._seenRaidTimes.has(raidKey)) {
                    this._seenRaidTimes.add(raidKey);
                    const now = Date.now();
                    res.joined.forEach((item) => {
                        const ident = typeof item === 'string' ? item : (item.login || item.name);
                        const p = this.getOrCreatePlayer(ident, this.data.myGuildId);
                        if (p) {
                            p.raidCount = (p.raidCount || 0) + 1;
                            p.lastSeenAt = Math.max(p.lastSeenAt || 0, now);
                        }
                    });
                    this.save();
                }
            }
        }

        updateCityMonLobbies(res) {
            this.data.lastCityMonCheckAt = Date.now();
            if (!res || !res.ok || !Array.isArray(res.list)) {
                this.activeCityMon = [];
                return;
            }
            this.activeCityMon = res.list.filter((L) => L.st === 'open');
            const now = Date.now();
            let touched = false;
            res.list.forEach((lobby) => {
                const lobbyId = String(lobby.id || lobby.eid || '');
                if (lobbyId && !this._seenLobbyIds.has(lobbyId)) {
                    this._seenLobbyIds.add(lobbyId);
                    if (Array.isArray(lobby.members)) {
                        lobby.members.forEach((m) => {
                            const ident = typeof m === 'string' ? m : (m.login || m.name);
                            const p = this.getOrCreatePlayer(ident, this.data.myGuildId);
                            if (p) {
                                if (m && typeof m === 'object') {
                                    if (m.name && (!p.name || p.name === p.login)) p.name = m.name;
                                    if (m.level && !p.level) p.level = +m.level;
                                }
                                p.wallCount = (p.wallCount || 0) + 1;
                                p.lastSeenAt = Math.max(p.lastSeenAt || 0, now);
                                touched = true;
                            }
                        });
                    }
                }
            });
            if (touched) this.save();
        }

        processGuildLog(res) {
            this.data.lastGuildLogCheckAt = Date.now();
            if (!res || !res.ok || !Array.isArray(res.log)) return;

            const entries = res.log;
            const lastProcessed = this.data.lastProcessedLogAt || 0;
            let maxAt = lastProcessed;
            let touched = false;
            const myGid = this.data.myGuildId;
            const myGuild = myGid ? this.data.guilds[myGid] : null;

            entries.forEach((e) => {
                const rawAt = +e.at || 0;
                const atMs = rawAt > 1e11 ? rawAt : rawAt * 1000;
                if (atMs > maxAt) maxAt = atMs;
                if (lastProcessed && atMs <= lastProcessed) return;

                if (e.k === 'run') {
                    const d = e.d || {};
                    if (myGuild) {
                        myGuild.lastRunAt = Math.max(myGuild.lastRunAt || 0, atMs);
                    }
                    const members = Array.isArray(d.members) ? d.members : [];
                    members.forEach((m) => {
                        const p = this.getOrCreatePlayer(m, this.data.myGuildId);
                        if (p) {
                            p.runCount = (p.runCount || 0) + 1;
                            p.lastRunAt = Math.max(p.lastRunAt || 0, atMs);
                            p.lastSeenAt = Math.max(p.lastSeenAt || 0, atMs);
                            touched = true;
                        }
                    });
                } else if (e.k === 'raid') {
                    const d = e.d || {};
                    if (myGuild) {
                        myGuild.lastRaidAt = Math.max(myGuild.lastRaidAt || 0, atMs);
                        myGuild.lastRaidCount = +(d.n || 0);
                        touched = true;
                    }
                }
            });

            this.data.lastProcessedLogAt = maxAt;
            if (touched) this.save();
        }

        updateGuildMeta(g) {
            const gid = String(g.id);
            if (!this.data.guilds[gid]) {
                this.data.guilds[gid] = {
                    id: gid,
                    name: g.name || '',
                    tag: g.tag || '',
                    emblem: g.emblem || '',
                    level: +g.level || 1,
                    xp: 0,
                    xpTo: null,
                    count: +g.count || 0,
                    free: g.free != null ? +g.free : 0,
                    open: !!g.open,
                    action: g.action || '',
                    descr: '',
                    members: [],
                    chatMessages24h: 0,
                    activeAuctionLots: 0,
                    knownLevelsSum: 0,
                    updatedAt: 0
                };
            } else {
                const cur = this.data.guilds[gid];
                cur.name = g.name || cur.name;
                cur.tag = g.tag != null ? g.tag : cur.tag;
                cur.emblem = g.emblem || cur.emblem;
                cur.level = +g.level || cur.level;
                cur.count = +g.count || cur.count;
                cur.free = g.free != null ? +g.free : cur.free;
                cur.open = !!g.open;
                cur.action = g.action || cur.action;
            }
        }

        updateGuildDetails(gid, res) {
            gid = String(gid);
            const g = res.guild || {};
            const cur = this.data.guilds[gid] || { id: gid, members: [] };

            cur.name = g.name || cur.name || '';
            cur.tag = g.tag != null ? g.tag : (cur.tag || '');
            cur.emblem = g.emblem || cur.emblem || '';
            cur.descr = g.descr || cur.descr || '';
            cur.level = +g.level || cur.level || 1;
            cur.xp = +g.xp || 0;
            cur.count = +g.count || cur.count || 0;
            cur.open = !!g.open;
            cur.updatedAt = Date.now();

            // Расчет xpTo
            const steps = (res.levels && res.levels.steps) || [];
            const lv = cur.level;
            cur.xpTo = lv - 1 < steps.length ? steps[lv - 1] : null;

            // Обработка участников
            const memberList = res.members || [];
            const memberLogins = [];
            let levelsSum = 0;

            memberList.forEach((m) => {
                const login = String(m.login || m.tid || '').toLowerCase();
                if (!login) return;
                memberLogins.push(login);

                let p = this.data.players[login];
                if (!p) {
                    p = {
                        login: login,
                        name: m.name || m.login || 'Игрок',
                        tid: String(m.tid || ''),
                        guildId: gid,
                        guildRole: m.role || 'novice',
                        joinedAt: +m.joinedAt || 0,
                        level: null,
                        class: null,
                        inTop120: false,
                        lastRunAt: 0,
                        runCount: 0,
                        raidCount: 0,
                        wallCount: 0,
                        lastSeenAt: 0,
                        msgCount: 0,
                        activeAuctionLots: 0,
                        updatedAt: Date.now()
                    };
                    this.data.players[login] = p;
                } else {
                    p.name = m.name || p.name;
                    p.tid = String(m.tid || p.tid);
                    p.guildId = gid;
                    p.guildRole = m.role || p.guildRole;
                    p.joinedAt = +m.joinedAt || p.joinedAt;
                    p.lastRunAt = +(p.lastRunAt || 0);
                    p.runCount = +(p.runCount || 0);
                    p.raidCount = +(p.raidCount || 0);
                    p.wallCount = +(p.wallCount || 0);
                    p.lastSeenAt = +(p.lastSeenAt || 0);
                    p.msgCount = +(p.msgCount || 0);
                    p.activeAuctionLots = +(p.activeAuctionLots || 0);
                    p.updatedAt = Date.now();
                }

                if (this.data.top120Logins.includes(login)) {
                    p.inTop120 = true;
                }
                if (p.level) {
                    levelsSum += p.level;
                }
            });

            cur.members = memberLogins;
            cur.knownLevelsSum = levelsSum;
            this.data.guilds[gid] = cur;

            // Добавление точки истории
            this.recordHistory(gid, cur.level, cur.xp, cur.count, cur.chatMessages24h || 0, cur.activeAuctionLots || 0);
            this.save();
        }

        applyLegionTop(roster) {
            const topLogins = [];
            (roster || []).forEach((item) => {
                const login = String(item.login || '').toLowerCase();
                if (!login) return;
                topLogins.push(login);

                let p = this.data.players[login];
                if (!p) {
                    p = {
                        login: login,
                        name: item.name || item.login,
                        tid: '',
                        guildId: null,
                        guildRole: null,
                        joinedAt: 0,
                        level: +item.level || null,
                        class: item.role || null,
                        inTop120: true,
                        updatedAt: Date.now()
                    };
                    this.data.players[login] = p;
                } else {
                    p.name = item.name || p.name;
                    p.level = +item.level || p.level;
                    p.class = item.role || p.class;
                    p.inTop120 = true;
                    p.updatedAt = Date.now();
                }
            });
            this.data.top120Logins = topLogins;

            // Пересчитываем knownLevelsSum для всех гильдий
            Object.values(this.data.guilds).forEach((g) => {
                let sum = 0;
                (g.members || []).forEach((l) => {
                    const pl = this.data.players[l];
                    if (pl && pl.level) sum += pl.level;
                });
                g.knownLevelsSum = sum;
            });
            this.save();
        }

        processAuctionLots(lots) {
            const sellerCounts = {};
            (lots || []).forEach((lot) => {
                const seller = String(lot.s || '').toLowerCase();
                if (seller) {
                    sellerCounts[seller] = (sellerCounts[seller] || 0) + 1;
                }
            });

            Object.values(this.data.guilds).forEach((g) => {
                let lotSum = 0;
                (g.members || []).forEach((login) => {
                    const l = login.toLowerCase();
                    if (sellerCounts[l]) lotSum += sellerCounts[l];
                });
                g.activeAuctionLots = lotSum;
            });

            // Проставляем количество лотов для участников
            Object.keys(this.data.players).forEach((login) => {
                this.data.players[login].activeAuctionLots = sellerCounts[login] || 0;
            });

            this.data.lastAuctionAt = Date.now();
            this.save();
        }

        recordChatMessage(login, roleClass, name, guildTag) {
            login = String(login || '').toLowerCase();
            if (!login) return;

            // 1. Находим гильдию игрока
            let guildId = null;
            let p = this.data.players[login];
            if (p && p.guildId) {
                guildId = p.guildId;
            } else if (guildTag) {
                const found = Object.values(this.data.guilds).find((g) => (g.tag || '').toLowerCase() === guildTag.toLowerCase());
                if (found) guildId = found.id;
            }

            // 2. Обновляем класс и имя ТОЛЬКО для участников гильдий или известных игроков
            if (roleClass) {
                if (p) {
                    if (!p.class || p.class !== roleClass) {
                        p.class = roleClass;
                        p.updatedAt = Date.now();
                    }
                    if (name && (!p.name || p.name === login)) {
                        p.name = name;
                    }
                    if (!p.guildId && guildId) {
                        p.guildId = guildId;
                    }
                    p.lastSeenAt = Date.now();
                    p.msgCount = (p.msgCount || 0) + 1;
                } else if (guildId) {
                    // Создаем запись только для участников гильдий, чтобы не захламлять память случайными зрителями
                    this.data.players[login] = {
                        login: login,
                        name: name || login,
                        tid: '',
                        guildId: guildId,
                        guildRole: 'novice',
                        joinedAt: 0,
                        level: null,
                        class: roleClass,
                        inTop120: false,
                        lastSeenAt: Date.now(),
                        msgCount: 1,
                        updatedAt: Date.now()
                    };
                }
            }

            // 3. Если гильдия не определена — сообщение в статистику не учитываем
            if (!guildId) return;

            // 4. Регистрируем сообщение в оперативном часовом слоте (in-memory)
            const now = Date.now();
            const curHour = Math.floor(now / 3600000);
            if (!this.data.chatHours) this.data.chatHours = {};
            if (!this.data.chatHours[guildId]) this.data.chatHours[guildId] = {};

            const h = this.data.chatHours[guildId];
            h[curHour] = (h[curHour] || 0) + 1;

            // Удаляем слоты старше 24ч
            const cutoff = curHour - 24;
            for (const key of Object.keys(h)) {
                if (+key < cutoff) delete h[key];
            }

            let total24h = 0;
            for (const cnt of Object.values(h)) {
                total24h += cnt;
            }

            // В объекте гильдии сохраняем строго число, никаких массивов
            if (this.data.guilds[guildId]) {
                this.data.guilds[guildId].chatMessages24h = total24h;
            }

            // Дебаунс сохранения раз в 15 секунд (не спамит диск при чате)
            this.debounceChatSave();
        }

        refreshChat24h() {
            const now = Date.now();
            const curHour = Math.floor(now / 3600000);
            const cutoff = curHour - 24;

            if (!this.data.chatHours) this.data.chatHours = {};

            Object.values(this.data.guilds).forEach((g) => {
                const h = this.data.chatHours[g.id];
                let total = 0;
                if (h) {
                    for (const key of Object.keys(h)) {
                        if (+key < cutoff) delete h[key];
                        else total += h[key];
                    }
                }
                g.chatMessages24h = total;
            });
        }

        recordHistory(gid, level, xp, count, chat, lots) {
            if (!this.data.history[gid]) {
                this.data.history[gid] = [];
            }
            const list = this.data.history[gid];
            const now = Date.now();
            const last = list[list.length - 1];

            // Не спамим историей чаще одного раза в 20 часов (по одной в день), если значения те же
            if (last && now - last.t < 20 * 3600 * 1000 && last.lv === level && last.xp === xp && last.cnt === count) {
                return;
            }

            list.push({
                t: now,
                lv: level,
                xp: xp,
                cnt: count,
                chat: chat || 0,
                lots: lots || 0
            });

            // Ограничить максимум 30 последними записями (удалять самую старую shift)
            while (list.length > 30) {
                list.shift();
            }
        }

        getGuild(id) {
            return this.data.guilds[String(id)] || null;
        }

        getPlayer(login) {
            return this.data.players[String(login || '').toLowerCase()] || null;
        }

        getAllGuildsList() {
            return Object.values(this.data.guilds);
        }

        getAllPlayersList() {
            return Object.values(this.data.players);
        }
    }

    /* ========================================================================== */
    /* 3. СЕТЕВОЙ КЛИЕНТ И КРАУЛЕР (API & CRAWLER)                                */
    /* ========================================================================== */

    class ApiClient {
        static getBasePath() {
            const m = /\/c\/[\w]+/.exec(location.pathname);
            return m ? m[0] : '';
        }

        static async request(path) {
            const url = ApiClient.getBasePath() + path;
            try {
                const res = await fetch(url, { credentials: 'same-origin' });
                if (res.status === 429) {
                    return { ok: false, status: 429, error: 'rate_limited' };
                }
                if (res.status === 404) {
                    return { ok: false, status: 404, error: 'not_found' };
                }
                const json = await res.json();
                return json && typeof json === 'object' ? json : { ok: false, error: 'invalid_json' };
            } catch (e) {
                return { ok: false, error: 'network_error' };
            }
        }

        static async post(path, body) {
            const url = ApiClient.getBasePath() + path;
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body || {}),
                    credentials: 'same-origin'
                });
                if (res.status === 429) {
                    return { ok: false, status: 429, error: 'rate_limited' };
                }
                if (res.status === 404) {
                    return { ok: false, status: 404, error: 'not_found' };
                }
                const json = await res.json();
                return json && typeof json === 'object' ? json : { ok: false, error: 'invalid_json' };
            } catch (e) {
                return { ok: false, error: 'network_error' };
            }
        }

        static fetchGuildsIndex() {
            return ApiClient.request('/api/guilds');
        }

        static fetchLegionTop() {
            return ApiClient.request('/api/legion');
        }

        static fetchGuildDetails(id) {
            return ApiClient.request('/api/guilds/guild?id=' + encodeURIComponent(id));
        }

        static fetchAuction() {
            return ApiClient.request('/api/auction');
        }

        static fetchGuildRaid() {
            return ApiClient.request('/api/guildraid');
        }

        static fetchCityMonLobbies() {
            return ApiClient.post('/api/citymon/act', { op: 'elist' });
        }

        static fetchGuildLog(before = '') {
            return ApiClient.request('/api/guilds/log' + (before ? '?before=' + encodeURIComponent(before) : ''));
        }
    }

    class GuildCrawler {
        constructor(storage, onStatusUpdate) {
            this.storage = storage;
            this.onStatusUpdate = onStatusUpdate;
            this.isScanning = false;
            this.isStoppedPermanently = false;
            this.consecutive429 = 0;
            this.bgQueue = [];
            this.bgTimer = null;
        }

        log(msg, ...args) {
            console.log(`[GuildStats] ${msg}`, ...args);
        }

        warn(msg, ...args) {
            console.warn(`[GuildStats] ${msg}`, ...args);
        }

        sleep(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }

        async startFullCrawl(isManual = false) {
            if (this.isScanning) {
                this.log('Сканирование уже выполняется.');
                return;
            }

            if (this.isStoppedPermanently && !isManual) {
                this.warn('Краулер остановлен из-за частых 429. Ожидание ручного обновления.');
                return;
            }

            this.isStoppedPermanently = false;
            this.isScanning = true;
            this.clearBgTimer();

            try {
                this.notifyStatus('Инициализация: опрос реестра гильдий...', 'busy');

                // 1. Опрос /api/guilds
                const guildsRes = await ApiClient.fetchGuildsIndex();

                if (guildsRes && guildsRes.status === 429) {
                    await this.handle429();
                    return;
                }

                if (!guildsRes || !guildsRes.ok) {
                    this.notifyStatus(`Ошибка загрузки гильдий: ${(guildsRes && guildsRes.error) || 'нет связи'}`, 'err');
                    this.isScanning = false;
                    return;
                }

                this.consecutive429 = 0;

                // Обновляем базовые метаданные всех гильдий из реестра /api/guilds и свою гильдию
                this.storage.updateMyGuildMeta(guildsRes);
                const allGuilds = guildsRes.guilds || [];
                this.storage.data.allianceLimit = guildsRes.limit || 90;
                allGuilds.forEach((g) => this.storage.updateGuildMeta(g));

                // Приоритетно загружаем детальный состав своей гильдии, чтобы знать участников
                if (this.storage.data.myGuildId) {
                    const myGid = this.storage.data.myGuildId;
                    const cachedMyGuild = this.storage.getGuild(myGid);
                    if (!cachedMyGuild || !cachedMyGuild.members || cachedMyGuild.members.length === 0 || isManual) {
                        const myRes = await ApiClient.fetchGuildDetails(myGid);
                        if (myRes && myRes.ok) {
                            this.storage.updateGuildDetails(myGid, myRes);
                        }
                    }
                }

                // Опрос активности своей гильдии (рейд, сборы у стен, журнал)
                await this.pollMyGuildActivities(isManual);

                // 2. Опрос /api/legion (раз в 2 часа или при ручном обновлении)
                const now = Date.now();
                if (isManual || !this.storage.data.lastLegionAt || (now - this.storage.data.lastLegionAt > CONFIG.LEGION_REFRESH_MS)) {
                    this.notifyStatus('Синхронизация топ-120 Легиона...', 'busy');
                    const legionRes = await ApiClient.fetchLegionTop();
                    if (legionRes && legionRes.ok && Array.isArray(legionRes.roster)) {
                        this.storage.applyLegionTop(legionRes.roster);
                        this.storage.data.lastLegionAt = now;
                        this.log(`Топ-120 Легиона обновлен: ${legionRes.roster.length} героев.`);
                    }
                }

                // 3. Опрос /api/auction (строго не чаще 1 раза в 5 минут, даже при ручном обновлении)
                if (!this.storage.data.lastAuctionAt || (now - this.storage.data.lastAuctionAt > CONFIG.AUCTION_CACHE_MS)) {
                    this.notifyStatus('Проверка аукциона гильдий...', 'busy');
                    const aucRes = await ApiClient.fetchAuction();
                    if (aucRes && aucRes.ok && Array.isArray(aucRes.lots)) {
                        this.storage.processAuctionLots(aucRes.lots);
                        this.log(`Аукцион обновлен: ${aucRes.lots.length} активных лотов.`);
                    }
                }

                this.storage.refreshChat24h();
                this.storage.save();

                // 4. Дельта-проверка: вычисляем, какие гильдии действительно требуют детального опроса
                const neededGuilds = [];
                const lastScanAt = this.storage.data.lastFullScanAt || 0;
                const isCacheFresh = (now - lastScanAt) < CONFIG.DELTA_STALE_MS;

                for (const g of allGuilds) {
                    const cached = this.storage.getGuild(g.id);
                    const isNew = !cached || !cached.members || cached.members.length === 0;
                    const countChanged = cached && cached.count !== g.count;
                    const levelChanged = cached && cached.level !== g.level;
                    const isStale = cached && (now - (cached.updatedAt || 0) > CONFIG.DELTA_STALE_MS);

                    // Если кэш свежий (< 2ч) и это не ручной скан — опрашиваем только при реальных изменениях (isNew, countChanged, levelChanged)
                    if (isNew || countChanged || levelChanged || (isManual && isStale) || (!isCacheFresh && isStale)) {
                        neededGuilds.push(g);
                    }
                }

                if (neededGuilds.length === 0) {
                    if (!this.storage.data.lastFullScanAt) {
                        this.storage.data.lastFullScanAt = Date.now();
                        this.storage.save(true);
                    }
                    this.log(`Все данные актуальны (${allGuilds.length} гильдий). Дельта-проверка пройдена без запросов.`);
                    this.notifyStatus(`Все данные актуальны (${allGuilds.length} гильдий).`, 'done');
                    this.isScanning = false;
                    return;
                }

                this.log(`Всего гильдий: ${allGuilds.length}. Требуют обновления: ${neededGuilds.length}.`);

                // 5. Сортировка по count (самые крупные первыми)
                neededGuilds.sort((a, b) => (+b.count || 0) - (+a.count || 0));

                // 6. Разделение: Топ-20 в приоритетный пакет, остальные — в фоновую очередь (1 в минуту)
                const priorityBatch = neededGuilds.slice(0, CONFIG.PRIORITY_BATCH_SIZE);
                this.bgQueue = neededGuilds.slice(CONFIG.PRIORITY_BATCH_SIZE);

                // 7. Обработка приоритетного пакета (топ-20)
                this.log(`Запуск приоритетного пакета: ${priorityBatch.length} гильдий...`);
                let donePriority = 0;

                for (const g of priorityBatch) {
                    if (this.isStoppedPermanently) break;

                    donePriority++;
                    this.notifyStatus(`Сканирование топ-гильдий: ${donePriority} / ${priorityBatch.length} («${g.name}»)...`, 'busy');

                    const jitter = Math.floor((Math.random() * 2 - 1) * CONFIG.PRIORITY_JITTER_MS);
                    await this.sleep(CONFIG.PRIORITY_DELAY_MS + jitter);

                    const res = await ApiClient.fetchGuildDetails(g.id);

                    if (res && res.status === 429) {
                        const shouldContinue = await this.handle429();
                        if (!shouldContinue) return;
                        const retryRes = await ApiClient.fetchGuildDetails(g.id);
                        if (retryRes && retryRes.ok) {
                            this.storage.updateGuildDetails(g.id, retryRes);
                            this.consecutive429 = 0;
                        }
                    } else if (res && res.ok) {
                        this.storage.updateGuildDetails(g.id, res);
                        this.consecutive429 = 0;
                    } else {
                        this.warn(`Ошибка запроса гильдии ${g.name} (${g.id}):`, res);
                    }

                    this.storage.save();
                }

                // 8. Запуск фоновой очереди (1 гильдия в минуту)
                if (this.bgQueue.length > 0 && !this.isStoppedPermanently) {
                    this.log(`Приоритетный пакет завершен. В фоновой очереди: ${this.bgQueue.length} гильдий (1/мин).`);
                    this.notifyStatus(`Топ обновлен. Фоновая очередь: ${this.bgQueue.length} гильдий (1 в мин)...`, 'bg');
                    this.scheduleNextBgItem();
                } else {
                    this.storage.data.lastFullScanAt = Date.now();
                    this.storage.save(true);
                    this.notifyStatus(`Синхронизация завершена (${allGuilds.length} гильдий).`, 'done');
                    this.isScanning = false;
                }

            } catch (err) {
                this.warn('Исключение в ходе краулинга:', err);
                this.notifyStatus('Сбой при обновлении. Проверьте консоль.', 'err');
                this.isScanning = false;
            }
        }

        async handle429() {
            this.consecutive429++;
            this.warn(`Получен HTTP 429! Подряд: ${this.consecutive429} / ${CONFIG.MAX_429_CONSECUTIVE}`);

            if (this.consecutive429 >= CONFIG.MAX_429_CONSECUTIVE) {
                this.isStoppedPermanently = true;
                this.isScanning = false;
                this.clearBgTimer();
                this.notifyStatus('🛑 Остановлено из-за частых 429. Нажмите «Обновить» вручную.', 'err');
                return false;
            }

            this.notifyStatus(`⚠️ Лимит (429). Пауза 5 минут (попытка ${this.consecutive429}/${CONFIG.MAX_429_CONSECUTIVE})...`, 'warn');
            await this.sleep(CONFIG.PAUSE_429_MS);
            return true;
        }

        scheduleNextBgItem() {
            this.clearBgTimer();
            if (this.bgQueue.length === 0 || this.isStoppedPermanently) {
                if (!this.isStoppedPermanently) {
                    this.storage.data.lastFullScanAt = Date.now();
                    this.storage.save(true);
                }
                this.notifyStatus('Все гильдии полностью синхронизированы.', 'done');
                this.isScanning = false;
                return;
            }

            this.bgTimer = setTimeout(async () => {
                if (this.isStoppedPermanently) return;

                const g = this.bgQueue.shift();
                if (!g) {
                    this.scheduleNextBgItem();
                    return;
                }

                this.notifyStatus(`Фоновый сбор (1/мин): «${g.name}» (осталось: ${this.bgQueue.length})...`, 'bg');
                const res = await ApiClient.fetchGuildDetails(g.id);

                if (res && res.status === 429) {
                    this.bgQueue.unshift(g);
                    const cont = await this.handle429();
                    if (cont) this.scheduleNextBgItem();
                    return;
                }

                if (res && res.ok) {
                    this.storage.updateGuildDetails(g.id, res);
                    this.storage.save();
                    this.consecutive429 = 0;
                }

                this.scheduleNextBgItem();
            }, CONFIG.BG_DELAY_MS);
        }

        clearBgTimer() {
            if (this.bgTimer) {
                clearTimeout(this.bgTimer);
                this.bgTimer = null;
            }
        }

        async pollMyGuildActivities(force = false) {
            if (document.hidden && !force) return;
            if (!this.storage.data.myGuildId) return;

            const now = Date.now();

            // 1. Текущий рейд: раз в 90 секунд (или force)
            if (now >= this.storage._raidBackoffUntil && (force || now - (this.storage.data.lastRaidCheckAt || 0) >= CONFIG.RAID_POLL_MS)) {
                const raidRes = await ApiClient.fetchGuildRaid();
                if (raidRes && (raidRes.status === 429 || raidRes.status === 404)) {
                    this.storage._raidBackoffUntil = now + CONFIG.ERROR_BACKOFF_MS;
                    this.warn('Рейд недоступен (' + raidRes.status + '). Пауза 5 минут.');
                } else if (raidRes) {
                    this.storage.updateRaidStatus(raidRes);
                }
            }

            // 2. Сборы у стен (City Monsters): раз в 60 секунд (или force)
            if (now >= this.storage._citymonBackoffUntil && (force || now - (this.storage.data.lastCityMonCheckAt || 0) >= CONFIG.CITYMON_POLL_MS)) {
                const cmRes = await ApiClient.fetchCityMonLobbies();
                if (cmRes && (cmRes.status === 429 || cmRes.status === 404)) {
                    this.storage._citymonBackoffUntil = now + CONFIG.ERROR_BACKOFF_MS;
                    this.warn('Сборы у стен недоступны (' + cmRes.status + '). Пауза 5 минут.');
                } else if (cmRes) {
                    this.storage.updateCityMonLobbies(cmRes);
                }
            }

            // 3. Журнал гильдии: строго не чаще 1 раза в 5 минут (300 000 мс)
            if (now >= this.storage._logBackoffUntil && (force || now - (this.storage.data.lastGuildLogCheckAt || 0) >= CONFIG.GUILD_LOG_POLL_MS)) {
                const logRes = await ApiClient.fetchGuildLog();
                if (logRes && (logRes.status === 429 || logRes.status === 404)) {
                    this.storage._logBackoffUntil = now + CONFIG.ERROR_BACKOFF_MS;
                    this.warn('Журнал гильдии недоступен (' + logRes.status + '). Пауза 5 минут.');
                } else if (logRes) {
                    this.storage.processGuildLog(logRes);
                }
            }
        }

        notifyStatus(text, type = 'info') {
            if (typeof this.onStatusUpdate === 'function') {
                this.onStatusUpdate(text, type);
            }
        }
    }

    /* ========================================================================== */
    /* 4. МОДЕЛЬ 100-БАЛЛЬНОГО РЕЙТИНГА И АНАЛИТИКА                              */
    /* ========================================================================== */

    function computeGuildScores(allGuilds, storage) {
        const allianceLimit = storage.data.allianceLimit || 90;
        const now = Date.now();
        const oneWeekAgo = now - 7 * 86400000;

        // Предварительный расчет метрик по каждой гильдии
        const metaList = allGuilds.map((g) => {
            const members = g.members || [];
            const topMembers = members.map((l) => storage.getPlayer(l)).filter((p) => p && (p.inTop120 || p.level));
            const topCount = topMembers.length;

            let knownLevelsSum = 0;
            topMembers.forEach((p) => { knownLevelsSum += (p.level || 0); });
            const avgTopLevel = topCount > 0 ? (knownLevelsSum / topCount) : 0;

            // Разнообразие классов среди топ-120 (максимум 7 игровых классов)
            const uniqueClasses = new Set(topMembers.map((p) => p.class).filter((c) => c && c !== 'recruit')).size;

            // Средний стаж участников
            let totalDays = 0, countWithJoin = 0;
            members.forEach((l) => {
                const p = storage.getPlayer(l);
                if (p && p.joinedAt) {
                    totalDays += Math.max(0, (now - p.joinedAt) / 86400000);
                    countWithJoin++;
                }
            });
            const avgDaysInGuild = countWithJoin > 0 ? (totalDays / countWithJoin) : 0;

            // Руководство (глава + офицеры)
            let leadersAndLeads = 0;
            members.forEach((l) => {
                const p = storage.getPlayer(l);
                const r = p ? (p.guildRole || '') : '';
                if (r === 'leader' || r === 'lead' || r === 'officer') {
                    leadersAndLeads++;
                }
            });

            // Прирост XP за неделю из снимков истории
            const hist = (storage.data.history && storage.data.history[g.id]) || [];
            let pastXp = g.xp || 0;
            if (hist.length > 0) {
                let bestPt = hist[0];
                for (const pt of hist) {
                    if (pt.t <= oneWeekAgo) {
                        bestPt = pt;
                    }
                }
                pastXp = bestPt.xp || 0;
            }
            const deltaXp = Math.max(0, (g.xp || 0) - pastXp);

            return {
                id: g.id,
                guild: g,
                level: +g.level || 1,
                xp: +g.xp || 0,
                count: +g.count || 0,
                topCount,
                avgTopLevel,
                knownLevelsSum,
                uniqueClasses,
                avgDaysInGuild,
                leadersAndLeads,
                deltaXp,
                chat24h: g.chatMessages24h || 0,
                auctionLots: g.activeAuctionLots || 0
            };
        });

        // Находим максимумы и средние для формул
        let maxLevel = 1, maxXp = 1, maxTopCount = 1;
        let sumDeltaXp = 0, countWithDelta = 0;

        metaList.forEach((m) => {
            if (m.level > maxLevel) maxLevel = m.level;
            if (m.xp > maxXp) maxXp = m.xp;
            if (m.topCount > maxTopCount) maxTopCount = m.topCount;
            if (m.deltaXp > 0) {
                sumDeltaXp += m.deltaXp;
                countWithDelta++;
            }
        });

        const avgDeltaXp = countWithDelta > 0 ? (sumDeltaXp / countWithDelta) : 500;

        // Расчет 11 метрик и 100-балльной оценки
        const results = {};

        metaList.forEach((m) => {
            // 🏆 БЛОК 1: ОСНОВНОЙ (макс 60)
            const ptsLevel = Math.min(20, (m.level / maxLevel) * 20);
            const ptsXp    = maxXp > 0 ? Math.min(15, (m.xp / maxXp) * 15) : 0;
            const ptsCount = Math.min(15, (m.count / allianceLimit) * 15);
            const ptsTop   = maxTopCount > 0 ? Math.min(10, (m.topCount / maxTopCount) * 10) : 0;
            const mainSum  = ptsLevel + ptsXp + ptsCount + ptsTop;

            // 🎯 БЛОК 2: КАЧЕСТВО (макс 25)
            const ptsClasses = Math.min(10, (m.uniqueClasses / 7) * 10);
            const ptsDays    = Math.min(5, (m.avgDaysInGuild / 30) * 5);
            const ptsLeaders = Math.min(5, (m.leadersAndLeads / 3) * 5);
            const ptsAvgLv   = Math.min(5, (m.avgTopLevel / 10) * 5);
            const qualitySum = ptsClasses + ptsDays + ptsLeaders + ptsAvgLv;

            // 📈 БЛОК 3: АКТИВНОСТЬ (макс 15)
            const ptsGrowth  = avgDeltaXp > 0 ? Math.min(5, (m.deltaXp / avgDeltaXp) * 5) : 0;
            const ptsChat    = Math.min(5, (m.chat24h / 100) * 5);
            const ptsLots    = Math.min(5, (m.auctionLots / 10) * 5);
            const activitySum= ptsGrowth + ptsChat + ptsLots;

            const totalScore = Math.min(100, Math.round((mainSum + qualitySum + activitySum) * 10) / 10);

            results[m.id] = {
                meta: m,
                breakdown: {
                    main: {
                        level: +ptsLevel.toFixed(1),
                        xp: +ptsXp.toFixed(1),
                        count: +ptsCount.toFixed(1),
                        top: +ptsTop.toFixed(1),
                        total: +mainSum.toFixed(1)
                    },
                    quality: {
                        classes: +ptsClasses.toFixed(1),
                        days: +ptsDays.toFixed(1),
                        leaders: +ptsLeaders.toFixed(1),
                        avgLv: +ptsAvgLv.toFixed(1),
                        total: +qualitySum.toFixed(1)
                    },
                    activity: {
                        growth: +ptsGrowth.toFixed(1),
                        chat: +ptsChat.toFixed(1),
                        lots: +ptsLots.toFixed(1),
                        total: +activitySum.toFixed(1)
                    },
                    total: totalScore
                }
            };
        });

        return results;
    }

    /* ========================================================================== */
    /* 5. ПАССИВНЫЙ СНИФФЕР ЧАТА (ЧЕРЕЗ G.LGChatOne.onFeed)                       */
    /* ========================================================================== */

    function initPassiveChatSniffer(storage) {
        let attempts = 0;
        const maxAttempts = 50;

        const timer = setInterval(() => {
            attempts++;
            const one = G.LGChatOne;

            if (one && typeof one.onFeed === 'function') {
                if (one.__gsHooked) {
                    clearInterval(timer);
                    return;
                }
                clearInterval(timer);
                one.__gsHooked = true;

                const origOnFeed = one.onFeed;
                one.onFeed = function (room, data) {
                    try {
                        if (data && Array.isArray(data.chat)) {
                            data.chat.forEach((m) => {
                                if (m && m.l) {
                                    storage.recordChatMessage(m.l, m.c, m.n, m.gt);
                                }
                            });
                        }
                    } catch (e) {}
                    return origOnFeed.apply(this, arguments);
                };

                if (typeof one.enterFeed === 'function') {
                    const origEnter = one.enterFeed;
                    one.enterFeed = function (room, data) {
                        try {
                            if (data && Array.isArray(data.chat)) {
                                data.chat.forEach((m) => {
                                    if (m && m.l) {
                                        storage.recordChatMessage(m.l, m.c, m.n, m.gt);
                                    }
                                });
                            }
                        } catch (e) {}
                        return origEnter.apply(this, arguments);
                    };
                }

                console.log('[GuildStats] Пассивный сниффер чата через LGChatOne.onFeed успешно подключен.');
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(timer);
            }
        }, 1200);
    }

    /* ========================================================================== */
    /* 6. ИНТЕРФЕЙС И СТИЛИЗАЦИЯ (UI & STYLES)                                    */
    /* ========================================================================== */

    const CSS_STYLES = `
        #lgu-gs-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(135deg, #1f2430 0%, #151821 100%);
            border: 2px solid #ffc94d;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6), 0 0 10px rgba(255, 201, 77, 0.3);
            color: #ffc94d;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            z-index: 9998;
            display: flex;
            align-items: center;
            justify-content: center;
            user-select: none;
            transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        #lgu-gs-btn:hover {
            transform: scale(1.08);
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.8), 0 0 14px rgba(255, 201, 77, 0.6);
        }
        #lgu-gs-btn.busy {
            border-color: #80d8ff;
            animation: lgu-gs-pulse 1.8s infinite;
        }
        @keyframes lgu-gs-pulse {
            0% { box-shadow: 0 0 0 0 rgba(128, 216, 255, 0.6); }
            70% { box-shadow: 0 0 0 12px rgba(128, 216, 255, 0); }
            100% { box-shadow: 0 0 0 0 rgba(128, 216, 255, 0); }
        }

        #lgu-gs-overlay {
            position: fixed;
            inset: 0;
            background: rgba(8, 10, 15, 0.75);
            backdrop-filter: blur(4px);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #e4e7ee;
        }
        #lgu-gs-modal {
            width: 860px;
            max-width: 95vw;
            height: 640px;
            max-height: 92vh;
            background: #171a23;
            border: 1px solid #363c4e;
            border-radius: 12px;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.85);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .lgu-gs-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 18px;
            background: #1c202d;
            border-bottom: 1px solid #2e3444;
        }
        .lgu-gs-title {
            font-size: 17px;
            font-weight: 700;
            color: #ffc94d;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .lgu-gs-head-acts {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .lgu-gs-head-btn {
            background: #252b3d;
            border: 1px solid #3d465d;
            color: #d1d6e2;
            padding: 5px 12px;
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.15s;
        }
        .lgu-gs-head-btn:hover {
            background: #31384e;
            color: #fff;
            border-color: #ffc94d;
        }
        .lgu-gs-close {
            background: transparent;
            border: none;
            color: #8f98af;
            font-size: 22px;
            cursor: pointer;
            line-height: 1;
            padding: 2px 6px;
        }
        .lgu-gs-close:hover { color: #ff6b6b; }

        .lgu-gs-status-bar {
            padding: 6px 18px;
            font-size: 12px;
            background: #141720;
            border-bottom: 1px solid #242938;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: #9aa3b8;
        }
        .lgu-gs-status-text.busy { color: #80d8ff; }
        .lgu-gs-status-text.err  { color: #ff8a80; }
        .lgu-gs-status-text.warn { color: #ffd180; }
        .lgu-gs-status-text.done { color: #a7ffeb; }

        .lgu-gs-tabs {
            display: flex;
            background: #191c27;
            border-bottom: 1px solid #2e3444;
            padding: 0 14px;
        }
        .lgu-gs-tab {
            padding: 10px 16px;
            font-size: 13px;
            font-weight: 600;
            color: #8f98af;
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            transition: all 0.15s;
        }
        .lgu-gs-tab:hover { color: #fff; }
        .lgu-gs-tab.active {
            color: #ffc94d;
            border-bottom-color: #ffc94d;
        }

        .lgu-gs-body {
            flex: 1;
            overflow-y: auto;
            padding: 14px 18px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .lgu-gs-toolbar {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }
        .lgu-gs-search {
            flex: 1;
            min-width: 200px;
            background: #11131a;
            border: 1px solid #2e3444;
            color: #e4e7ee;
            padding: 7px 12px;
            border-radius: 6px;
            font-size: 13px;
            outline: none;
        }
        .lgu-gs-search:focus { border-color: #ffc94d; }
        .lgu-gs-select {
            background: #11131a;
            border: 1px solid #2e3444;
            color: #e4e7ee;
            padding: 7px 10px;
            border-radius: 6px;
            font-size: 13px;
            outline: none;
            cursor: pointer;
        }

        .lgu-gs-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            text-align: left;
        }
        .lgu-gs-table th {
            background: #1d212d;
            color: #ffc94d;
            padding: 8px 10px;
            font-weight: 600;
            border-bottom: 1px solid #2e3444;
            cursor: pointer;
            user-select: none;
        }
        .lgu-gs-table th:hover { background: #262c3d; }
        .lgu-gs-table td {
            padding: 8px 10px;
            border-bottom: 1px solid #222634;
        }
        .lgu-gs-table tr:hover td {
            background: #1f2331;
            cursor: pointer;
        }

        .lgu-gs-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
        }
        .lgu-gs-badge-gold { background: rgba(255, 201, 77, 0.15); color: #ffc94d; border: 1px solid rgba(255, 201, 77, 0.4); }
        .lgu-gs-badge-green{ background: rgba(167, 255, 235, 0.15); color: #a7ffeb; border: 1px solid rgba(167, 255, 235, 0.4); }
        .lgu-gs-badge-blue { background: rgba(128, 216, 255, 0.15); color: #80d8ff; border: 1px solid rgba(128, 216, 255, 0.4); }
        .lgu-gs-badge-yellow{ background: rgba(255, 213, 79, 0.15); color: #ffd54f; border: 1px solid rgba(255, 213, 79, 0.4); }
        .lgu-gs-badge-gray { background: rgba(143, 152, 175, 0.15); color: #8f98af; border: 1px solid rgba(143, 152, 175, 0.3); }

        /* Оценка: цветовые классы */
        .lgu-gs-score-90 { color: #ffc94d; font-weight: 700; }
        .lgu-gs-score-70 { color: #a7ffeb; font-weight: 700; }
        .lgu-gs-score-50 { color: #ffd54f; font-weight: 600; }
        .lgu-gs-score-0  { color: #8f98af; }

        /* Карточка гильдии */
        .lgu-gs-card-head {
            background: #1c202d;
            border: 1px solid #2e3444;
            border-radius: 8px;
            padding: 14px 16px;
            display: flex;
            gap: 16px;
            align-items: center;
        }
        .lgu-gs-card-meta { flex: 1; }
        .lgu-gs-card-title { font-size: 18px; font-weight: 700; color: #ffc94d; margin-bottom: 4px; }
        .lgu-gs-card-descr { font-size: 12px; color: #9aa3b8; margin-bottom: 8px; font-style: italic; }

        /* Информационные плашки */
        .lgu-gs-info-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-top: 4px;
        }
        .lgu-gs-info-tile {
            background: #141721;
            border: 1px solid #282f42;
            border-radius: 6px;
            padding: 10px;
            text-align: center;
        }
        .lgu-gs-info-tile-val {
            font-size: 16px;
            font-weight: 700;
            color: #ffc94d;
        }
        .lgu-gs-info-tile-lbl {
            font-size: 11px;
            color: #8f98af;
            margin-top: 2px;
        }

        /* 3 блока оценки */
        .lgu-gs-score-blocks {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            background: #1c202d;
            border: 1px solid #2e3444;
            border-radius: 8px;
            padding: 12px;
        }
        .lgu-gs-sblock {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .lgu-gs-sblock-h {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            font-weight: 600;
        }
        .lgu-gs-progress {
            width: 100%;
            height: 6px;
            background: #11131a;
            border-radius: 3px;
            overflow: hidden;
        }
        .lgu-gs-progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #80d8ff, #ffc94d);
        }

        /* Участники */
        .lgu-gs-tier-title {
            font-size: 13px;
            font-weight: 700;
            color: #ffc94d;
            margin: 10px 0 6px 0;
            display: flex;
            align-items: center;
            gap: 6px;
            border-bottom: 1px solid #2e3444;
            padding-bottom: 4px;
        }
        .lgu-gs-mem-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
            gap: 8px;
        }
        .lgu-gs-mem-item {
            background: #1c202d;
            border: 1px solid #272d3d;
            border-radius: 6px;
            padding: 8px 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .lgu-gs-mem-item.top120 {
            border-color: rgba(255, 201, 77, 0.4);
            background: linear-gradient(135deg, #1c202d 0%, #25241f 100%);
        }
        .lgu-gs-mem-info { display: flex; flex-direction: column; gap: 2px; }
        .lgu-gs-mem-name { font-size: 13px; font-weight: 600; color: #fff; }
        .lgu-gs-mem-sub  { font-size: 11px; color: #7f889e; }
        .lgu-gs-mem-level{ font-size: 12px; font-weight: 700; text-align: right; }

        /* Вкладка: Сравнение */
        .lgu-gs-cmp-selects {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        .lgu-gs-cmp-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            margin-top: 10px;
        }
        .lgu-gs-cmp-table th {
            background: #1d212d;
            color: #ffc94d;
            padding: 10px;
            border-bottom: 1px solid #2e3444;
        }
        .lgu-gs-cmp-table td {
            padding: 8px 10px;
            border-bottom: 1px solid #222634;
        }
        .lgu-gs-cmp-win {
            background: rgba(167, 255, 235, 0.12) !important;
            color: #a7ffeb !important;
            font-weight: 700;
        }
        .lgu-gs-cmp-lose {
            background: rgba(255, 138, 128, 0.08) !important;
            color: #ff8a80 !important;
        }
        .lgu-gs-cmp-tie {
            color: #8f98af;
        }

        /* Вкладка: Моя гильдия */
        .lgu-gs-mg-cards {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 8px;
        }
        @media (max-width: 650px) {
            .lgu-gs-mg-cards { grid-template-columns: 1fr; }
        }
        .lgu-gs-mg-card {
            background: #1c202d;
            border: 1px solid #2e3444;
            border-radius: 8px;
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .lgu-gs-mg-card.hot {
            border-color: #ff7b72;
            box-shadow: 0 0 10px rgba(255, 123, 114, 0.25);
        }
        .lgu-gs-mg-card-title {
            font-size: 13px;
            font-weight: 700;
            color: #ffc94d;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .lgu-gs-mg-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            max-height: 90px;
            overflow-y: auto;
        }
        .lgu-gs-mg-chip {
            background: #252b3d;
            border: 1px solid #3d465d;
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 11px;
            color: #d1d6e2;
        }
        .lgu-gs-mg-chip.highlight {
            background: rgba(167, 255, 235, 0.15);
            border-color: #a7ffeb;
            color: #a7ffeb;
            font-weight: 600;
        }
        .lgu-gs-mg-row-active td:first-child {
            border-left: 3px solid #a7ffeb;
        }
        .lgu-gs-mg-row-medium td:first-child {
            border-left: 3px solid #ffd180;
        }
        .lgu-gs-mg-row-sleeping td:first-child {
            border-left: 3px solid #5a6275;
            color: #8f98af;
        }
    `;

    class DashboardUI {
        constructor(storage, crawler) {
            this.storage = storage;
            this.crawler = crawler;
            this.isOpen = false;
            this.activeTab = 'rating'; // rating | card | compare | search
            this.selectedGuildId = null;
            this.compareIdA = null;
            this.compareIdB = null;
            this.searchQuery = '';
            this.filterOnlyOpen = false;
            this.sortKey = 'score'; // score | level | xp | count | top | name
            this.sortAsc = false;
            this.playerQuery = '';
            this.myGuildSearchQuery = '';
            this.myGuildSortKey = 'status';
            this.myGuildSortAsc = false;

            this.injectStyles();
            this.createButton();
        }

        injectStyles() {
            if (document.getElementById('lgu-gs-styles')) return;
            const style = document.createElement('style');
            style.id = 'lgu-gs-styles';
            style.textContent = CSS_STYLES;
            document.head.appendChild(style);
        }

        createButton() {
            if (document.getElementById('lgu-gs-btn')) return;
            const btn = document.createElement('button');
            btn.id = 'lgu-gs-btn';
            btn.innerHTML = '🛡️ GS';
            btn.title = 'Статистика гильдий (Guild Stats)';
            btn.onclick = () => this.toggleModal();
            document.body.appendChild(btn);
            this.btnEl = btn;
        }

        updateStatus(text, type = 'info') {
            if (this.btnEl) {
                this.btnEl.classList.toggle('busy', type === 'busy' || type === 'bg');
            }
            const stEl = document.getElementById('lgu-gs-status');
            if (stEl) {
                stEl.textContent = text;
                stEl.className = 'lgu-gs-status-text ' + type;
            }
        }

        toggleModal() {
            if (this.isOpen) {
                this.closeModal();
            } else {
                this.openModal();
            }
        }

        openModal() {
            if (this.isOpen) return;
            this.isOpen = true;

            const overlay = document.createElement('div');
            overlay.id = 'lgu-gs-overlay';
            overlay.innerHTML = `
                <div id="lgu-gs-modal">
                    <div class="lgu-gs-head">
                        <div class="lgu-gs-title"><span>🛡️</span> Статистика и аналитика гильдий</div>
                        <div class="lgu-gs-head-acts">
                            <button type="button" class="lgu-gs-head-btn" id="lgu-gs-refresh">🔄 Обновить</button>
                            <button type="button" class="lgu-gs-close" id="lgu-gs-close">×</button>
                        </div>
                    </div>
                    <div class="lgu-gs-status-bar">
                        <span id="lgu-gs-status" class="lgu-gs-status-text">База загружена</span>
                        <span id="lgu-gs-time">Обновлено: ${this.storage.data.updatedAt ? new Date(this.storage.data.updatedAt).toLocaleTimeString('ru-RU') : 'пусто'}</span>
                    </div>
                    <div class="lgu-gs-tabs">
                        <button type="button" class="lgu-gs-tab ${this.activeTab === 'myguild' ? 'active' : ''}" data-tab="myguild">🛡️ Моя гильдия</button>
                        <button type="button" class="lgu-gs-tab ${this.activeTab === 'rating' ? 'active' : ''}" data-tab="rating">🏆 Рейтинг гильдий</button>
                        <button type="button" class="lgu-gs-tab ${this.activeTab === 'card' ? 'active' : ''}" data-tab="card">🏰 Карточка гильдии</button>
                        <button type="button" class="lgu-gs-tab ${this.activeTab === 'compare' ? 'active' : ''}" data-tab="compare">⚖️ Сравнение</button>
                        <button type="button" class="lgu-gs-tab ${this.activeTab === 'search' ? 'active' : ''}" data-tab="search">🔍 Поиск игрока</button>
                    </div>
                    <div class="lgu-gs-body" id="lgu-gs-content"></div>
                </div>
            `;

            document.body.appendChild(overlay);
            this.overlayEl = overlay;

            overlay.querySelector('#lgu-gs-close').onclick = () => this.closeModal();
            overlay.querySelector('#lgu-gs-refresh').onclick = () => {
                this.crawler.startFullCrawl(true);
            };
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.closeModal();
            });

            overlay.querySelectorAll('.lgu-gs-tab').forEach((t) => {
                t.onclick = () => {
                    this.activeTab = t.dataset.tab;
                    overlay.querySelectorAll('.lgu-gs-tab').forEach((x) => x.classList.toggle('active', x === t));
                    this.renderTabContent();
                };
            });

            this.escHandler = (e) => {
                if (e.key === 'Escape') this.closeModal();
            };
            document.addEventListener('keydown', this.escHandler);

            this.renderTabContent();
        }

        closeModal() {
            if (!this.isOpen) return;
            this.isOpen = false;
            if (this.escHandler) {
                document.removeEventListener('keydown', this.escHandler);
            }
            if (this.overlayEl) {
                this.overlayEl.remove();
                this.overlayEl = null;
            }
        }

        renderTabContent() {
            const container = document.getElementById('lgu-gs-content');
            if (!container) return;

            if (this.activeTab === 'myguild') {
                this.renderMyGuildTab(container);
            } else if (this.activeTab === 'rating') {
                this.renderRatingTab(container);
            } else if (this.activeTab === 'card') {
                this.renderCardTab(container);
            } else if (this.activeTab === 'compare') {
                this.renderCompareTab(container);
            } else if (this.activeTab === 'search') {
                this.renderSearchTab(container);
            }
        }

        scoreClass(val) {
            if (val >= 90) return 'lgu-gs-score-90';
            if (val >= 70) return 'lgu-gs-score-70';
            if (val >= 50) return 'lgu-gs-score-50';
            return 'lgu-gs-score-0';
        }


        /* ----------------------- Вкладка: Моя гильдия ----------------------- */
        formatRelTime(ms) {
            if (!ms) return 'никогда';
            const elapsed = Date.now() - ms;
            if (elapsed < 0) return 'только что';
            const sec = Math.floor(elapsed / 1000);
            if (sec < 60) return `${sec} сек назад`;
            const min = Math.floor(sec / 60);
            if (min < 60) return `${min} мин назад`;
            const hr = Math.floor(min / 60);
            if (hr < 24) return `${hr} ч назад`;
            const days = Math.floor(hr / 24);
            if (days < 30) return `${days} дн. назад`;
            return new Date(ms).toLocaleDateString('ru-RU');
        }

        getMemberStatus(p) {
            const now = Date.now();
            const lastActive = Math.max(p.lastSeenAt || 0, p.lastRunAt || 0, p.updatedAt || 0);
            const hoursSinceActive = (now - lastActive) / 3600000;
            const msgCount = +p.msgCount || 0;
            const lots = +p.activeAuctionLots || 0;
            const runs = +p.runCount || 0;
            const raids = +p.raidCount || 0;
            const walls = +p.wallCount || 0;
            const totalActivity = msgCount + lots + runs + raids + walls;

            const recentEvent = (p.lastRunAt && (now - p.lastRunAt < 7 * 86400000)) ||
                                (p.lastSeenAt && (now - p.lastSeenAt < 24 * 3600000 && totalActivity >= 5));

            if (hoursSinceActive <= 24 && (totalActivity >= 5 || recentEvent)) {
                return { code: 'active', rank: 3, label: 'Активен', color: '#a7ffeb', badgeClass: 'lgu-gs-badge-green', rowClass: 'lgu-gs-mg-row-active' };
            }
            if (hoursSinceActive <= 48 || msgCount > 0 || totalActivity > 0) {
                return { code: 'medium', rank: 2, label: 'Средний', color: '#ffd180', badgeClass: 'lgu-gs-badge-yellow', rowClass: 'lgu-gs-mg-row-medium' };
            }
            return { code: 'sleeping', rank: 1, label: 'Спящий', color: '#8f98af', badgeClass: 'lgu-gs-badge-gray', rowClass: 'lgu-gs-mg-row-sleeping' };
        }

        renderMyGuildTab(container) {
            const myGid = this.storage.data.myGuildId;
            if (!myGid) {
                container.innerHTML = `
                    <div class="lgu-gs-card" style="text-align:center; padding:50px 20px; display:flex; flex-direction:column; align-items:center; gap:12px;">
                        <div style="font-size:48px;">🛡️</div>
                        <div style="font-size:17px; font-weight:700; color:#ffc94d;">Вы не состоите в гильдии</div>
                        <div style="font-size:13px; color:#8f98af; max-width:440px; line-height:1.5;">
                            Вступите в одну из гильдий альянса, чтобы отслеживать участие согильдийцев в рейдах, вылазках, сборах у стен города и активность в чате.
                        </div>
                    </div>
                `;
                return;
            }

            const g = this.storage.getGuild(myGid) || { id: myGid, name: 'Моя гильдия', tag: '', members: [] };
            const raid = this.storage.activeRaid;
            const cityMon = this.storage.activeCityMon || [];

            // 1. Блок текущих сборов
            const hasRaid = raid && raid.plan && (raid.st === 'open' || raid.st === 'fight');
            const hasCityMon = cityMon.length > 0;

            let gatheringHtml = '';
            if (!hasRaid && !hasCityMon) {
                gatheringHtml = `
                    <div class="lgu-gs-card" style="padding:10px 14px; font-size:12px; color:#8f98af; display:flex; align-items:center; justify-content:space-between;">
                        <span>Сейчас активных сборов нет (рейд завершён или не назначен, сборы у стен не открыты).</span>
                        <span style="font-size:11px; color:#5a6275;">
                            ${g.lastRaidAt ? `Посл. рейд: ${this.formatRelTime(g.lastRaidAt)} (${g.lastRaidCount || 0} уч.)` : ''}
                        </span>
                    </div>
                `;
            } else {
                gatheringHtml = `
                    <div class="lgu-gs-mg-cards">
                        ${hasRaid ? `
                            <div class="lgu-gs-mg-card hot">
                                <div class="lgu-gs-mg-card-title">
                                    <span>⚔️ Рейд: ${raid.plan.name || 'Босс гильдии'}</span>
                                    <span class="lgu-gs-badge ${raid.st === 'fight' ? 'lgu-gs-badge-gold' : 'lgu-gs-badge-green'}">
                                        ${raid.st === 'fight' ? 'Идёт бой' : 'Вход открыт'}
                                    </span>
                                </div>
                                <div style="font-size:12px; color:#d1d6e2; display:flex; justify-content:space-between;">
                                    <span>Начало: ${raid.plan.at ? new Date(raid.plan.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                                    <span>Участников: ${(raid.joined || []).length} ${raid.rules && raid.rules.min ? `/ ${raid.rules.min}` : ''}</span>
                                </div>
                                <div class="lgu-gs-mg-chips">
                                    ${(raid.joined || []).map((j) => {
                                        const name = typeof j === 'string' ? j : (j.name || j.login);
                                        return `<span class="lgu-gs-mg-chip highlight">${name}</span>`;
                                    }).join('')}
                                </div>
                            </div>
                        ` : `
                            <div class="lgu-gs-mg-card">
                                <div class="lgu-gs-mg-card-title">
                                    <span>⚔️ Рейд гильдии</span>
                                    <span class="lgu-gs-badge lgu-gs-badge-gray">Не назначен</span>
                                </div>
                                <div style="font-size:12px; color:#8f98af;">
                                    ${g.lastRaidAt ? `Последний рейд: ${this.formatRelTime(g.lastRaidAt)} (${g.lastRaidCount || 0} уч.)` : 'Рейдов пока не зарегистрировано.'}
                                </div>
                            </div>
                        `}

                        ${hasCityMon ? `
                            <div class="lgu-gs-mg-card">
                                <div class="lgu-gs-mg-card-title">
                                    <span>🛡️ Сборы у стен (${cityMon.length})</span>
                                    <span class="lgu-gs-badge lgu-gs-badge-green">Открыты</span>
                                </div>
                                <div style="display:flex; flex-direction:column; gap:6px;">
                                    ${cityMon.map((L) => `
                                        <div style="font-size:12px; border-bottom:1px solid #242938; padding-bottom:4px;">
                                            <div style="display:flex; justify-content:space-between; color:#e4e7ee; font-weight:600;">
                                                <span>${L.name}</span>
                                                <span>${(L.members || []).length} / ${L.max || 5}</span>
                                            </div>
                                            <div class="lgu-gs-mg-chips" style="margin-top:2px;">
                                                ${(L.members || []).map((m) => {
                                                    const mName = typeof m === 'string' ? m : (m.name || m.login);
                                                    return `<span class="lgu-gs-mg-chip">${mName}</span>`;
                                                }).join('')}
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : `
                            <div class="lgu-gs-mg-card">
                                <div class="lgu-gs-mg-card-title">
                                    <span>🛡️ Сборы у стен города</span>
                                    <span class="lgu-gs-badge lgu-gs-badge-gray">Нет сборов</span>
                                </div>
                                <div style="font-size:12px; color:#8f98af;">
                                    Открытых лобби на элитных монстров сейчас нет.
                                </div>
                            </div>
                        `}
                    </div>
                `;
            }

            // 2. Список участников своей гильдии
            const memberLogins = Array.isArray(g.members) ? g.members : [];
            let activeCnt = 0, mediumCnt = 0, sleepingCnt = 0;

            const memberRows = memberLogins.map((login) => {
                const p = this.storage.getPlayer(login) || {
                    login: login,
                    name: login,
                    guildId: myGid,
                    guildRole: 'novice',
                    joinedAt: 0
                };
                const st = this.getMemberStatus(p);
                if (st.code === 'active') activeCnt++;
                else if (st.code === 'medium') mediumCnt++;
                else sleepingCnt++;

                const days = p.joinedAt ? Math.floor((Date.now() - p.joinedAt) / 86400000) : 0;
                const cInfo = CLASS_INFO[p.class] || { name: '—', icon: '👤', color: '#a0a0a0' };
                const rInfo = GUILD_ROLES[p.guildRole] || { name: 'Новичок', icon: '👤', order: 4, color: '#c0c6d8' };
                const lastSeen = Math.max(p.lastSeenAt || 0, p.lastRunAt || 0, p.updatedAt || 0);

                return {
                    p,
                    login: p.login,
                    name: p.name || p.login,
                    classInfo: cInfo,
                    roleInfo: rInfo,
                    roleOrder: rInfo.order,
                    days,
                    msgCount: +p.msgCount || 0,
                    lots: +p.activeAuctionLots || 0,
                    runs: +p.runCount || 0,
                    raids: +p.raidCount || 0,
                    walls: +p.wallCount || 0,
                    lastRunAt: p.lastRunAt || 0,
                    lastSeen,
                    status: st
                };
            });

            // Фильтрация
            let filtered = memberRows;
            if (this.myGuildSearchQuery) {
                const q = this.myGuildSearchQuery.toLowerCase();
                filtered = filtered.filter((m) =>
                    m.name.toLowerCase().includes(q) || m.login.toLowerCase().includes(q)
                );
            }

            // Сортировка
            filtered.sort((a, b) => {
                let diff = 0;
                if (this.myGuildSortKey === 'status') {
                    diff = b.status.rank - a.status.rank;
                    if (diff === 0) diff = b.lastSeen - a.lastSeen;
                } else if (this.myGuildSortKey === 'name') {
                    diff = a.name.localeCompare(b.name, 'ru');
                } else if (this.myGuildSortKey === 'role') {
                    diff = a.roleOrder - b.roleOrder;
                } else if (this.myGuildSortKey === 'days') {
                    diff = b.days - a.days;
                } else if (this.myGuildSortKey === 'msgCount') {
                    diff = b.msgCount - a.msgCount;
                } else if (this.myGuildSortKey === 'lots') {
                    diff = b.lots - a.lots;
                } else if (this.myGuildSortKey === 'runs') {
                    diff = b.runs - a.runs;
                } else if (this.myGuildSortKey === 'raids') {
                    diff = b.raids - a.raids;
                } else if (this.myGuildSortKey === 'walls') {
                    diff = b.walls - a.walls;
                } else if (this.myGuildSortKey === 'lastSeen') {
                    diff = b.lastSeen - a.lastSeen;
                }
                return this.myGuildSortAsc ? -diff : diff;
            });

            const arrow = (key) => {
                if (this.myGuildSortKey !== key) return '';
                return this.myGuildSortAsc ? ' ▲' : ' ▼';
            };

            container.innerHTML = `
                ${gatheringHtml}

                <div class="lgu-gs-toolbar" style="margin-top:6px;">
                    <input type="text" class="lgu-gs-search" id="lgu-gs-mg-search" placeholder="Поиск согильдийца по нику или логину..." value="${this.myGuildSearchQuery}">
                    
                    <div style="display:flex; align-items:center; gap:6px;">
                        <button type="button" class="lgu-gs-head-btn" id="lgu-gs-mg-refresh" title="Принудительно опросить рейд, сборы у стен и журнал гильдии">🔄 Обновить</button>
                        <button type="button" class="lgu-gs-head-btn" id="lgu-gs-mg-csv" title="Выгрузить активность согильдийцев в CSV-файл (Excel UTF-8 BOM)">📥 Экспорт в CSV</button>
                    </div>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#9aa3b8; padding:2px 2px;">
                    <span>
                        Всего согильдийцев: <b>${memberRows.length}</b> 
                        (🟢 Активных: <b style="color:#a7ffeb;">${activeCnt}</b>, 
                        🟡 Средних: <b style="color:#ffd180;">${mediumCnt}</b>, 
                        ⚪ Спящих: <b style="color:#8f98af;">${sleepingCnt}</b>)
                    </span>
                    <span>
                        ${g.lastRunAt ? `Посл. вылазка гильдии: ${this.formatRelTime(g.lastRunAt)}` : ''}
                    </span>
                </div>

                <div style="flex:1; overflow-y:auto; border:1px solid #2e3444; border-radius:8px;">
                    <table class="lgu-gs-table">
                        <thead>
                            <tr>
                                <th data-mg-sort="name">Игрок${arrow('name')}</th>
                                <th data-mg-sort="role">Ранг${arrow('role')}</th>
                                <th data-mg-sort="days" title="Дней в составе гильдии">Стаж${arrow('days')}</th>
                                <th data-mg-sort="msgCount" title="Сообщений в чате за последние 24 часа">Чат 24ч${arrow('msgCount')}</th>
                                <th data-mg-sort="lots" title="Активных лотов на аукционе">Аукцион${arrow('lots')}</th>
                                <th data-mg-sort="runs" title="Участий в вылазках (из журнала гильдии)">Вылазок${arrow('runs')}</th>
                                <th data-mg-sort="raids" title="Участий в рейдах гильдии">Рейдов${arrow('raids')}</th>
                                <th data-mg-sort="walls" title="Участий в сборах у стен города">Стены${arrow('walls')}</th>
                                <th data-mg-sort="lastSeen" title="Время последнего проявления активности">Посл. активность${arrow('lastSeen')}</th>
                                <th data-mg-sort="status" style="text-align:center;">Статус${arrow('status')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.length === 0 ? `
                                <tr>
                                    <td colspan="10" style="text-align:center; padding:24px; color:#7f889e;">
                                        Согильдийцы не найдены.
                                    </td>
                                </tr>
                            ` : filtered.map((m) => `
                                <tr class="${m.status.rowClass}">
                                    <td>
                                        <div style="display:flex; align-items:center; gap:6px;">
                                            <span style="font-size:14px;" title="${m.classInfo.name}">${m.classInfo.icon}</span>
                                            <div>
                                                <div style="font-weight:600; color:#fff;">${m.name}</div>
                                                <div style="font-size:11px; color:#7f889e;">@${m.login}${m.p.level ? ` · ${m.p.level} ур.` : ''}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <span style="color:${m.roleInfo.color}; font-weight:600; font-size:12px;">
                                            ${m.roleInfo.icon} ${m.roleInfo.name}
                                        </span>
                                    </td>
                                    <td style="font-size:12px; color:#d1d6e2;">
                                        ${m.days ? `${m.days} дн.` : '<span style="color:#7f889e;">сегодня</span>'}
                                    </td>
                                    <td style="font-weight:${m.msgCount > 0 ? '700' : '400'}; color:${m.msgCount > 0 ? '#ffc94d' : '#8f98af'};">
                                        ${m.msgCount}
                                    </td>
                                    <td style="color:${m.lots > 0 ? '#80d8ff' : '#8f98af'};">
                                        ${m.lots}
                                    </td>
                                    <td style="color:${m.runs > 0 ? '#a7ffeb' : '#8f98af'};">
                                        ${m.runs}${m.lastRunAt ? `<div style="font-size:10px; color:#7f889e;">${this.formatRelTime(m.lastRunAt)}</div>` : ''}
                                    </td>
                                    <td style="color:${m.raids > 0 ? '#ff8a80' : '#8f98af'};">
                                        ${m.raids}
                                    </td>
                                    <td style="color:${m.walls > 0 ? '#b9f6ca' : '#8f98af'};">
                                        ${m.walls}
                                    </td>
                                    <td style="font-size:12px; color:#d1d6e2;">
                                        ${this.formatRelTime(m.lastSeen)}
                                    </td>
                                    <td style="text-align:center;">
                                        <span class="lgu-gs-badge ${m.status.badgeClass}">${m.status.label}</span>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            // Обработчики событий
            const searchInput = container.querySelector('#lgu-gs-mg-search');
            if (searchInput) {
                searchInput.oninput = () => {
                    this.myGuildSearchQuery = searchInput.value;
                    this.renderMyGuildTab(container);
                };
            }

            const refreshBtn = container.querySelector('#lgu-gs-mg-refresh');
            if (refreshBtn) {
                refreshBtn.onclick = async () => {
                    refreshBtn.disabled = true;
                    refreshBtn.textContent = '⏳ Опрос...';
                    await this.crawler.pollMyGuildActivities(true);
                    this.renderMyGuildTab(container);
                };
            }

            const csvBtn = container.querySelector('#lgu-gs-mg-csv');
            if (csvBtn) {
                csvBtn.onclick = () => this.exportMyGuildCsv();
            }

            container.querySelectorAll('[data-mg-sort]').forEach((th) => {
                th.onclick = () => {
                    const key = th.dataset.mgSort;
                    if (this.myGuildSortKey === key) {
                        this.myGuildSortAsc = !this.myGuildSortAsc;
                    } else {
                        this.myGuildSortKey = key;
                        this.myGuildSortAsc = false;
                    }
                    this.renderMyGuildTab(container);
                };
            });
        }

        exportMyGuildCsv() {
            const myGid = this.storage.data.myGuildId;
            if (!myGid) return;
            const g = this.storage.getGuild(myGid);
            if (!g) return;

            const headers = [
                'Ник',
                'Логин',
                'Класс',
                'Уровень',
                'Ранг',
                'Стаж (дней)',
                'Сообщений 24ч',
                'Лотов аукциона',
                'Вылазок',
                'Последняя вылазка',
                'Рейдов',
                'Сборов у стен',
                'Последняя активность',
                'Статус'
            ];

            const memberLogins = Array.isArray(g.members) ? g.members : [];
            const rows = memberLogins.map((login) => {
                const p = this.storage.getPlayer(login) || { login, name: login, guildRole: 'novice', joinedAt: 0 };
                const st = this.getMemberStatus(p);
                const days = p.joinedAt ? Math.floor((Date.now() - p.joinedAt) / 86400000) : 0;
                const lastActStr = p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleString('ru-RU') : (p.updatedAt ? new Date(p.updatedAt).toLocaleString('ru-RU') : 'нет данных');
                const lastRunStr = p.lastRunAt ? new Date(p.lastRunAt).toLocaleString('ru-RU') : 'нет';
                const cInfo = CLASS_INFO[p.class] || { name: p.class || '—' };
                const rInfo = GUILD_ROLES[p.guildRole] || { name: p.guildRole || '—' };

                return [
                    `"${(p.name || login).replace(/"/g, '""')}"`,
                    `"${login}"`,
                    `"${cInfo.name}"`,
                    p.level || '—',
                    `"${rInfo.name}"`,
                    days,
                    p.msgCount || 0,
                    p.activeAuctionLots || 0,
                    p.runCount || 0,
                    `"${lastRunStr}"`,
                    p.raidCount || 0,
                    p.wallCount || 0,
                    `"${lastActStr}"`,
                    `"${st.label}"`
                ].join(';');
            });

            const csvContent = '\uFEFF' + headers.join(';') + '\r\n' + rows.join('\r\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `my_guild_activity_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                a.remove();
                URL.revokeObjectURL(url);
            }, 1000);
        }

        /* ----------------------- Вкладка: Рейтинг ----------------------- */
        renderRatingTab(container) {
            const allGuilds = this.storage.getAllGuildsList();
            const scoresMap = computeGuildScores(allGuilds, this.storage);

            const rows = allGuilds.map((g) => {
                const s = scoresMap[g.id] || { breakdown: { total: 0, main: {}, quality: {}, activity: {} }, meta: {} };
                return {
                    g,
                    id: g.id,
                    name: g.name,
                    tag: g.tag,
                    level: +g.level || 1,
                    xp: +g.xp || 0,
                    count: +g.count || 0,
                    open: !!g.open,
                    topCount: s.meta.topCount || 0,
                    avgTopLv: s.meta.avgTopLevel ? s.meta.avgTopLevel.toFixed(1) : '—',
                    score: s.breakdown.total,
                    breakdown: s.breakdown
                };
            });

            // Фильтрация
            let filtered = rows.filter((r) => {
                if (this.filterOnlyOpen && !r.open) return false;
                if (this.searchQuery) {
                    const q = this.searchQuery.toLowerCase();
                    const nMatch = r.name.toLowerCase().includes(q);
                    const tMatch = (r.tag || '').toLowerCase().includes(q);
                    if (!nMatch && !tMatch) return false;
                }
                return true;
            });

            // Сортировка
            filtered.sort((a, b) => {
                let diff = 0;
                if (this.sortKey === 'score') diff = b.score - a.score;
                else if (this.sortKey === 'level') diff = (b.level - a.level) || (b.xp - a.xp);
                else if (this.sortKey === 'xp') diff = b.xp - a.xp;
                else if (this.sortKey === 'count') diff = b.count - a.count;
                else if (this.sortKey === 'top') diff = b.topCount - a.topCount;
                else if (this.sortKey === 'name') diff = a.name.localeCompare(b.name, 'ru');
                return this.sortAsc ? -diff : diff;
            });

            const lim = this.storage.data.allianceLimit || 90;

            container.innerHTML = `
                <div class="lgu-gs-toolbar">
                    <input type="search" class="lgu-gs-search" id="lgu-gs-q" placeholder="Поиск по названию или тегу..." value="${this.searchQuery}">
                    <select class="lgu-gs-select" id="lgu-gs-sort">
                        <option value="score" ${this.sortKey === 'score' ? 'selected' : ''}>По оценке (100 баллов)</option>
                        <option value="level" ${this.sortKey === 'level' ? 'selected' : ''}>По уровню гильдии</option>
                        <option value="xp" ${this.sortKey === 'xp' ? 'selected' : ''}>По опыту гильдии (XP)</option>
                        <option value="count" ${this.sortKey === 'count' ? 'selected' : ''}>По числу участников</option>
                        <option value="top" ${this.sortKey === 'top' ? 'selected' : ''}>По бойцам топ-120</option>
                        <option value="name" ${this.sortKey === 'name' ? 'selected' : ''}>По названию (А-Я)</option>
                    </select>
                    <label style="font-size:12px; color:#d1d6e2; display:flex; align-items:center; gap:5px; cursor:pointer;">
                        <input type="checkbox" id="lgu-gs-only-open" ${this.filterOnlyOpen ? 'checked' : ''}> Только открытые
                    </label>
                </div>
                <div style="flex:1; overflow-y:auto;">
                    <table class="lgu-gs-table">
                        <thead>
                            <tr>
                                <th style="width:36px;">#</th>
                                <th>Гильдия</th>
                                <th>Оценка (100)</th>
                                <th>Уровень</th>
                                <th>Опыт (XP)</th>
                                <th>Состав</th>
                                <th>Топ-120</th>
                                <th>Набор</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.length ? filtered.map((r, i) => `
                                <tr data-gid="${r.id}">
                                    <td style="color:#8f98af;">${i + 1}</td>
                                    <td>
                                        <b>${r.tag ? `<span style="color:#ffc94d;">[${r.tag}]</span> ` : ''}${r.name}</b>
                                    </td>
                                    <td>
                                        <span class="${this.scoreClass(r.score)}">${r.score}</span>
                                        <small style="color:#7f889e; margin-left:4px;" title="О:${r.breakdown.main.total} К:${r.breakdown.quality.total} А:${r.breakdown.activity.total}">
                                            (${r.breakdown.main.total}/${r.breakdown.quality.total}/${r.breakdown.activity.total})
                                        </small>
                                    </td>
                                    <td>
                                        <span class="lgu-gs-badge lgu-gs-badge-gold">Ур. ${r.level}</span>
                                    </td>
                                    <td>
                                        <b>${r.xp.toLocaleString('ru-RU')}</b>
                                    </td>
                                    <td><b>${r.count}</b> <small style="color:#7f889e;">/${lim}</small></td>
                                    <td>
                                        ${r.topCount > 0 ? `<span class="lgu-gs-badge lgu-gs-badge-blue">👑 ${r.topCount}</span>` : '<span style="color:#5a6175;">—</span>'}
                                    </td>
                                    <td>
                                        <span class="lgu-gs-badge ${r.open ? 'lgu-gs-badge-green' : 'lgu-gs-badge-gold'}">
                                            ${r.open ? 'Открыта' : 'По заявке'}
                                        </span>
                                    </td>
                                </tr>
                            `).join('') : `
                                <tr>
                                    <td colspan="8" style="text-align:center; padding:30px; color:#7f889e;">
                                        Ничего не найдено. Нажмите «Обновить» для синхронизации.
                                    </td>
                                </tr>
                            `}
                        </tbody>
                    </table>
                </div>
            `;

            const qInp = container.querySelector('#lgu-gs-q');
            qInp.oninput = () => {
                this.searchQuery = qInp.value;
                this.renderRatingTab(container);
            };

            const sSel = container.querySelector('#lgu-gs-sort');
            sSel.onchange = () => {
                this.sortKey = sSel.value;
                this.renderRatingTab(container);
            };

            const chk = container.querySelector('#lgu-gs-only-open');
            chk.onchange = () => {
                this.filterOnlyOpen = chk.checked;
                this.renderRatingTab(container);
            };

            container.querySelectorAll('tr[data-gid]').forEach((row) => {
                row.onclick = () => {
                    this.selectedGuildId = row.dataset.gid;
                    this.activeTab = 'card';
                    const tabs = document.querySelectorAll('.lgu-gs-tab');
                    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === 'card'));
                    this.renderTabContent();
                };
            });
        }

        /* ----------------------- Вкладка: Карточка гильдии ----------------------- */
        renderCardTab(container) {
            const allGuilds = this.storage.getAllGuildsList();
            if (allGuilds.length === 0) {
                container.innerHTML = `<p style="padding:20px; color:#8f98af;">Данные о гильдиях ещё не собраны. Нажмите «🔄 Обновить».</p>`;
                return;
            }

            if (!this.selectedGuildId || !this.storage.getGuild(this.selectedGuildId)) {
                this.selectedGuildId = allGuilds[0].id;
            }

            const g = this.storage.getGuild(this.selectedGuildId);
            const lim = this.storage.data.allianceLimit || 90;
            const scoresMap = computeGuildScores(allGuilds, this.storage);
            const scoreObj = scoresMap[g.id] || { breakdown: { total: 0, main: {}, quality: {}, activity: {} }, meta: {} };
            const b = scoreObj.breakdown;

            // Расчет ранга гильдии по XP среди всех гильдий
            const sortedByXp = allGuilds.slice().sort((x, y) => (+y.xp || 0) - (+x.xp || 0));
            const xpRank = sortedByXp.findIndex((x) => x.id === g.id) + 1;

            const members = (g.members || []).map((l) => this.storage.getPlayer(l)).filter(Boolean);
            const topMembers = members.filter((m) => m.inTop120 || (m.level != null));

            // Группировка участников по рангам
            const tiers = {
                leader:  { title: '👑 Глава гильдии', list: [] },
                lead:    { title: '⭐ Руководство (Офицеры)', list: [] },
                trusted: { title: '🛡️ Доверенные лица', list: [] },
                novice:  { title: '👤 Новички и рядовые бойцы', list: [] }
            };

            members.forEach((m) => {
                const r = m.guildRole || 'novice';
                const key = (r === 'officer' || r === 'lead') ? 'lead' : (r === 'member' || r === 'novice') ? 'novice' : r;
                if (tiers[key]) tiers[key].list.push(m);
                else tiers.novice.list.push(m);
            });

            // Внутренний ранг по уровню внутри гильдии
            members.slice().sort((a, b) => (b.level || 0) - (a.level || 0) || (b.joinedAt || 0) - (a.joinedAt || 0)).forEach((m, idx) => {
                m.internalRank = idx + 1;
            });

            Object.values(tiers).forEach((t) => {
                t.list.sort((a, b) => (b.level || 0) - (a.level || 0) || (b.joinedAt || 0) - (a.joinedAt || 0));
            });

            container.innerHTML = `
                <div class="lgu-gs-toolbar">
                    <label style="font-size:12px; color:#8f98af;">Выбрать гильдию:</label>
                    <select class="lgu-gs-select" id="lgu-gs-card-select" style="min-width:260px;">
                        ${allGuilds.map((x) => `
                            <option value="${x.id}" ${x.id === g.id ? 'selected' : ''}>
                                ${x.tag ? `[${x.tag}] ` : ''}${x.name} (Ур. ${x.level}, ${x.count} чел.)
                            </option>
                        `).join('')}
                    </select>
                    <button type="button" class="lgu-gs-head-btn" id="lgu-gs-btn-cmp" style="margin-left:auto;">
                        ⚖️ Сравнить с другой
                    </button>
                </div>

                <div class="lgu-gs-card-head">
                    <div style="font-size:36px; padding:10px; background:#11131a; border-radius:8px; border:1px solid #2e3444;">
                        🛡️
                    </div>
                    <div class="lgu-gs-card-meta">
                        <div class="lgu-gs-card-title">
                            ${g.tag ? `[${g.tag}] ` : ''}${g.name}
                            <span class="lgu-gs-badge lgu-gs-badge-gold">Уровень ${g.level}</span>
                            <span class="lgu-gs-badge lgu-gs-badge-blue">Место по XP: #${xpRank}</span>
                            <span class="lgu-gs-badge ${g.open ? 'lgu-gs-badge-green' : 'lgu-gs-badge-gold'}">
                                ${g.open ? 'Открыта' : 'По заявке'}
                            </span>
                        </div>
                        ${g.descr ? `<div class="lgu-gs-card-descr">${g.descr}</div>` : ''}
                        <div class="lgu-gs-info-row">
                            <div class="lgu-gs-info-tile">
                                <div class="lgu-gs-info-tile-val">${g.knownLevelsSum || 0} ур.</div>
                                <div class="lgu-gs-info-tile-lbl">Сумма известных уровней</div>
                            </div>
                            <div class="lgu-gs-info-tile">
                                <div class="lgu-gs-info-tile-val">${g.chatMessages24h || 0}</div>
                                <div class="lgu-gs-info-tile-lbl">Сообщений в чате (24ч)</div>
                            </div>
                            <div class="lgu-gs-info-tile">
                                <div class="lgu-gs-info-tile-val">${g.activeAuctionLots || 0}</div>
                                <div class="lgu-gs-info-tile-lbl">Активных лотов на аукционе</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 100-балльная оценка по 3 блокам -->
                <div class="lgu-gs-score-blocks">
                    <div class="lgu-gs-sblock">
                        <div class="lgu-gs-sblock-h">
                            <span>🏆 Основной</span>
                            <b>${b.main.total} / 60</b>
                        </div>
                        <div class="lgu-gs-progress">
                            <div class="lgu-gs-progress-bar" style="width:${Math.round((b.main.total / 60) * 100)}%;"></div>
                        </div>
                        <small style="font-size:10px; color:#8f98af;">Ур: ${b.main.level} · XP: ${b.main.xp} · Мест: ${b.main.count} · Топ: ${b.main.top}</small>
                    </div>
                    <div class="lgu-gs-sblock">
                        <div class="lgu-gs-sblock-h">
                            <span>🎯 Качество</span>
                            <b>${b.quality.total} / 25</b>
                        </div>
                        <div class="lgu-gs-progress">
                            <div class="lgu-gs-progress-bar" style="width:${Math.round((b.quality.total / 25) * 100)}%;"></div>
                        </div>
                        <small style="font-size:10px; color:#8f98af;">Классы: ${b.quality.classes} · Стаж: ${b.quality.days} · Офицеры: ${b.quality.leaders} · Ср.ур: ${b.quality.avgLv}</small>
                    </div>
                    <div class="lgu-gs-sblock">
                        <div class="lgu-gs-sblock-h">
                            <span>📈 Активность</span>
                            <b>${b.activity.total} / 15</b>
                        </div>
                        <div class="lgu-gs-progress">
                            <div class="lgu-gs-progress-bar" style="width:${Math.round((b.activity.total / 15) * 100)}%;"></div>
                        </div>
                        <small style="font-size:10px; color:#8f98af;">Рост XP: ${b.activity.growth} · Чат: ${b.activity.chat} · Аукцион: ${b.activity.lots}</small>
                    </div>
                </div>

                <div style="flex:1; overflow-y:auto; margin-top:4px;">
                    ${Object.entries(tiers).map(([k, t]) => {
                        if (!t.list.length) return '';
                        return `
                            <div class="lgu-gs-tier-title">
                                <span>${t.title}</span>
                                <span style="font-size:11px; color:#7f889e;">(${t.list.length})</span>
                            </div>
                            <div class="lgu-gs-mem-grid">
                                ${t.list.map((m) => {
                                    const cInfo = CLASS_INFO[m.class] || null;
                                    const days = m.joinedAt ? Math.max(1, Math.floor((Date.now() - m.joinedAt) / 86400000)) : null;
                                    return `
                                        <div class="lgu-gs-mem-item ${m.inTop120 ? 'top120' : ''}">
                                            <div class="lgu-gs-mem-info">
                                                <div class="lgu-gs-mem-name">
                                                    ${cInfo ? `<span title="${cInfo.name}">${cInfo.icon}</span> ` : ''}
                                                    ${m.name || m.login}
                                                    ${m.internalRank ? `<small style="color:#80d8ff; font-size:10px;">#${m.internalRank}</small>` : ''}
                                                </div>
                                                <div class="lgu-gs-mem-sub">
                                                    @${m.login}
                                                    ${days != null ? `· в гильдии ${days} дн.` : ''}
                                                </div>
                                            </div>
                                            <div class="lgu-gs-mem-level">
                                                ${m.level ? `
                                                    <span class="lgu-gs-badge lgu-gs-badge-gold">
                                                        ${m.level} ур.
                                                    </span>
                                                ` : `
                                                    <span style="color:#5a6175;">—</span>
                                                `}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            container.querySelector('#lgu-gs-card-select').onchange = (e) => {
                this.selectedGuildId = e.target.value;
                this.renderCardTab(container);
            };

            container.querySelector('#lgu-gs-btn-cmp').onclick = () => {
                this.compareIdA = this.selectedGuildId;
                this.activeTab = 'compare';
                const tabs = document.querySelectorAll('.lgu-gs-tab');
                tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === 'compare'));
                this.renderTabContent();
            };
        }

        /* ----------------------- Вкладка: Сравнение ----------------------- */
        renderCompareTab(container) {
            const allGuilds = this.storage.getAllGuildsList();
            if (allGuilds.length < 2) {
                container.innerHTML = `<p style="padding:20px; color:#8f98af;">Необходимо минимум 2 гильдии для сравнения. Запустите сбор данных.</p>`;
                return;
            }

            if (!this.compareIdA || !this.storage.getGuild(this.compareIdA)) {
                this.compareIdA = allGuilds[0].id;
            }
            if (!this.compareIdB || !this.storage.getGuild(this.compareIdB) || this.compareIdB === this.compareIdA) {
                this.compareIdB = allGuilds[1] ? allGuilds[1].id : allGuilds[0].id;
            }

            const gA = this.storage.getGuild(this.compareIdA);
            const gB = this.storage.getGuild(this.compareIdB);

            const scoresMap = computeGuildScores(allGuilds, this.storage);
            const sA = scoresMap[gA.id] || { breakdown: { total: 0, main: {}, quality: {}, activity: {} }, meta: {} };
            const sB = scoresMap[gB.id] || { breakdown: { total: 0, main: {}, quality: {}, activity: {} }, meta: {} };

            // Список 11 метрик для сравнения бок-о-бок
            const metrics = [
                { title: '⭐ Итоговая оценка (100)', vA: sA.breakdown.total, vB: sB.breakdown.total, isMain: true },
                { title: 'Уровень гильдии', vA: sA.meta.level, vB: sB.meta.level },
                { title: 'Опыт гильдии (XP)', vA: sA.meta.xp, vB: sB.meta.xp },
                { title: 'Численность участников', vA: sA.meta.count, vB: sB.meta.count },
                { title: 'Бойцов из топ-120 Легиона', vA: sA.meta.topCount, vB: sB.meta.topCount },
                { title: 'Разнообразие классов топов (из 7)', vA: sA.meta.uniqueClasses, vB: sB.meta.uniqueClasses },
                { title: 'Средний стаж участников (дней)', vA: +sA.meta.avgDaysInGuild.toFixed(1), vB: +sB.meta.avgDaysInGuild.toFixed(1) },
                { title: 'Руководство (глава + офицеры)', vA: sA.meta.leadersAndLeads, vB: sB.meta.leadersAndLeads },
                { title: 'Средний уровень топов', vA: +sA.meta.avgTopLevel.toFixed(1), vB: +sB.meta.avgTopLevel.toFixed(1) },
                { title: 'Рост XP за 7 дней', vA: sA.meta.deltaXp, vB: sB.meta.deltaXp },
                { title: 'Сообщений в чате (24ч)', vA: sA.meta.chat24h, vB: sB.meta.chat24h },
                { title: 'Активных лотов на аукционе', vA: sA.meta.auctionLots, vB: sB.meta.auctionLots },
                { title: 'Сумма известных уровней', vA: sA.meta.knownLevelsSum, vB: sB.meta.knownLevelsSum }
            ];

            const cellClass = (a, b) => {
                if (a > b) return 'lgu-gs-cmp-win';
                if (a < b) return 'lgu-gs-cmp-lose';
                return 'lgu-gs-cmp-tie';
            };

            container.innerHTML = `
                <div class="lgu-gs-cmp-selects">
                    <div>
                        <label style="font-size:12px; color:#8f98af;">Гильдия A:</label>
                        <select class="lgu-gs-select" id="lgu-gs-cmp-a" style="width:100%; margin-top:4px;">
                            ${allGuilds.map((x) => `
                                <option value="${x.id}" ${x.id === gA.id ? 'selected' : ''}>
                                    ${x.tag ? `[${x.tag}] ` : ''}${x.name} (Оценка: ${scoresMap[x.id] ? scoresMap[x.id].breakdown.total : 0})
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:12px; color:#8f98af;">Гильдия B:</label>
                        <select class="lgu-gs-select" id="lgu-gs-cmp-b" style="width:100%; margin-top:4px;">
                            ${allGuilds.map((x) => `
                                <option value="${x.id}" ${x.id === gB.id ? 'selected' : ''}>
                                    ${x.tag ? `[${x.tag}] ` : ''}${x.name} (Оценка: ${scoresMap[x.id] ? scoresMap[x.id].breakdown.total : 0})
                                </option>
                            `).join('')}
                        </select>
                    </div>
                </div>

                <div style="flex:1; overflow-y:auto; margin-top:10px;">
                    <table class="lgu-gs-cmp-table">
                        <thead>
                            <tr>
                                <th style="width:40%;">Метрика сравнения</th>
                                <th style="width:30%; text-align:center;">
                                    ${gA.tag ? `[${gA.tag}] ` : ''}${gA.name}
                                </th>
                                <th style="width:30%; text-align:center;">
                                    ${gB.tag ? `[${gB.tag}] ` : ''}${gB.name}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            ${metrics.map((m) => `
                                <tr style="${m.isMain ? 'background:#1a2133; font-weight:700;' : ''}">
                                    <td><b>${m.title}</b></td>
                                    <td class="${cellClass(m.vA, m.vB)}" style="text-align:center;">
                                        ${typeof m.vA === 'number' ? m.vA.toLocaleString('ru-RU') : m.vA}
                                    </td>
                                    <td class="${cellClass(m.vB, m.vA)}" style="text-align:center;">
                                        ${typeof m.vB === 'number' ? m.vB.toLocaleString('ru-RU') : m.vB}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            container.querySelector('#lgu-gs-cmp-a').onchange = (e) => {
                this.compareIdA = e.target.value;
                this.renderCompareTab(container);
            };

            container.querySelector('#lgu-gs-cmp-b').onchange = (e) => {
                this.compareIdB = e.target.value;
                this.renderCompareTab(container);
            };
        }

        /* ----------------------- Вкладка: Поиск игрока ----------------------- */
        renderSearchTab(container) {
            const players = this.storage.getAllPlayersList();
            const q = this.playerQuery.trim().toLowerCase();

            let matched = [];
            if (q.length >= 2) {
                matched = players.filter((p) => {
                    return p.login.toLowerCase().includes(q) || (p.name && p.name.toLowerCase().includes(q));
                }).slice(0, 50);
            }

            container.innerHTML = `
                <div class="lgu-gs-toolbar">
                    <input type="search" class="lgu-gs-search" id="lgu-gs-pq" placeholder="Введите логин или ник персонажа..." value="${this.playerQuery}">
                    <span style="font-size:12px; color:#8f98af;">В базе: ${players.length} участников</span>
                </div>
                <div style="flex:1; overflow-y:auto; margin-top:8px;">
                    ${q.length < 2 ? `
                        <p style="padding:30px; text-align:center; color:#7f889e;">
                            Введите минимум 2 символа ника или Twitch-логина для поиска по всем гильдиям.
                        </p>
                    ` : matched.length === 0 ? `
                        <p style="padding:30px; text-align:center; color:#7f889e;">
                            Игрок «${this.playerQuery}» не найден в составах гильдий.
                        </p>
                    ` : `
                        <div class="lgu-gs-mem-grid">
                            ${matched.map((p) => {
                                const g = p.guildId ? this.storage.getGuild(p.guildId) : null;
                                const cInfo = CLASS_INFO[p.class] || null;
                                const rInfo = GUILD_ROLES[p.guildRole] || GUILD_ROLES.novice;
                                const days = p.joinedAt ? Math.max(1, Math.floor((Date.now() - p.joinedAt) / 86400000)) : null;

                                return `
                                    <div class="lgu-gs-mem-item ${p.inTop120 ? 'top120' : ''}" style="flex-direction:column; align-items:flex-start; gap:6px;">
                                        <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                                            <div class="lgu-gs-mem-name">
                                                ${cInfo ? `<span title="${cInfo.name}">${cInfo.icon}</span> ` : ''}
                                                <b>${p.name || p.login}</b>
                                                <small style="color:#7f889e; font-weight:normal;">(@${p.login})</small>
                                            </div>
                                            <div>
                                                ${p.level ? `
                                                    <span class="lgu-gs-badge lgu-gs-badge-gold">${p.level} ур.</span>
                                                ` : `
                                                    <span style="color:#5a6175;">—</span>
                                                `}
                                            </div>
                                        </div>
                                        <div style="font-size:12px; color:#d1d6e2; display:flex; flex-direction:column; gap:2px; width:100%;">
                                            <div>
                                                Гильдия: 
                                                ${g ? `
                                                    <b style="color:#ffc94d; cursor:pointer;" data-goto-g="${g.id}">
                                                        ${g.tag ? `[${g.tag}] ` : ''}${g.name}
                                                    </b>
                                                ` : '<span style="color:#7f889e;">без гильдии</span>'}
                                            </div>
                                            <div style="display:flex; justify-content:space-between; font-size:11px; color:#7f889e; margin-top:2px;">
                                                <span>Ранг: ${rInfo.icon} ${rInfo.name}</span>
                                                <span>${days != null ? `${days} дн. в гильдии` : ''}</span>
                                            </div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `}
                </div>
            `;

            const pqInp = container.querySelector('#lgu-gs-pq');
            pqInp.oninput = () => {
                this.playerQuery = pqInp.value;
                this.renderSearchTab(container);
            };

            container.querySelectorAll('[data-goto-g]').forEach((el) => {
                el.onclick = () => {
                    this.selectedGuildId = el.dataset.gotoG;
                    this.activeTab = 'card';
                    const tabs = document.querySelectorAll('.lgu-gs-tab');
                    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === 'card'));
                    this.renderTabContent();
                };
            });
        }
    }

    /* ========================================================================== */
    /* 7. ТОЧКА ВХОДА (INIT & STARTUP)                                            */
    /* ========================================================================== */

    function init() {
        console.log('[GuildStats] Инициализация мини-плагина Guild Stats v1.1.0...');

        const storage = new StorageEngine();
        let ui = null;

        const crawler = new GuildCrawler(storage, (statusText, type) => {
            if (ui) ui.updateStatus(statusText, type);
        });

        ui = new DashboardUI(storage, crawler);
        G.__LGU_GuildStats = { storage, crawler, ui };

        // Пассивный сниффер чата
        initPassiveChatSniffer(storage);

        // Первый фоновый запуск через 4 секунды после старта страницы
        setTimeout(() => {
            crawler.startFullCrawl(false);
        }, 4000);

        // Автообновление дельты раз в 10 минут
        setInterval(() => {
            if (!document.hidden && !crawler.isScanning && !crawler.isStoppedPermanently) {
                crawler.startFullCrawl(false);
            }
        }, CONFIG.AUTO_REFRESH_MS);

        // Периодический опрос активности своей гильдии (рейд 90с, стены 60с, лог 300с)
        setInterval(() => {
            if (!document.hidden && !crawler.isScanning && !crawler.isStoppedPermanently) {
                crawler.pollMyGuildActivities(false);
            }
        }, 15000);

        // При возобновлении активности вкладки
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !crawler.isScanning && !crawler.isStoppedPermanently) {
                crawler.pollMyGuildActivities(false);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
