// ==UserScript==
// @name         7TV в чате Multidonate Play
// @namespace    https://play.multidonate.ru/
// @version      3.0
// @description  Эмоуты 7TV в чате: кнопка 7TV, ник стримера, размер, список эмоутов, быстрый кеш
// @match        https://play.multidonate.ru/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      7tv.io
// @connect      cdn.7tv.app
// @connect      api.ivr.fi
// @run-at       document-idle
// @author       ProCto_Fliy
// @icon         https://cdn.7tv.app/emote/01F71VQYHR000D3ZZ6Q11NR7TV/2x.webp
// @homepageURL  https://github.com/mykhailkot-pixel/Legion7TV
// @updateURL    https://raw.githubusercontent.com/mykhailkot-pixel/Legion7TV/raw/refs/heads/main/7tv-multidonate.user.js
// @downloadURL  https://raw.githubusercontent.com/mykhailkot-pixel/Legion7TV/raw/refs/heads/main/7tv-multidonate.user.js
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const CACHE_TTL = 60 * 60 * 1000;
    const SIZES = {
        s: { h: '1.3em', n: 2, label: 'S' },
        m: { h: '1.9em', n: 2, label: 'M' },
        l: { h: '2.6em', n: 3, label: 'L' },
        x: { h: '3.4em', n: 3, label: 'XL' }
    };

    const pageChan = (() => {
        const m = /\/c\/([\w]+)/.exec(location.pathname);
        return m ? m[1].toLowerCase() : '';
    })();

    const S = { nick: pageChan, size: 'm' };
    const EM = {};
    let status = '';
    let loadToken = 0;

    /* ---------- сеть (GM_xmlhttpRequest обходит CSP сайта) ---------- */
    const ALLOWED = ['7tv.io', 'cdn.7tv.app', 'api.ivr.fi'];
    const urlOk = (url) => {
        try { const u = new URL(url); return u.protocol === 'https:' && ALLOWED.includes(u.hostname); }
        catch { return false; }
    };
    const gm = (url, responseType) => new Promise((resolve, reject) => {
        if (!urlOk(url)) return reject(new Error('url not allowed'));
        GM_xmlhttpRequest({
            method: 'GET', url, responseType, timeout: 20000,
            onload: (r) => (r.status >= 200 && r.status < 300) ? resolve(r) : reject(new Error(url + ' -> ' + r.status)),
            onerror: reject, ontimeout: reject
        });
    });
    const getJson = async (url) => JSON.parse((await gm(url)).responseText);
    const getBuf = async (url) => {
        const r = await gm(url, 'blob');
        const type = (r.response && r.response.type) || 'image/webp';
        const buf = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = rej;
            fr.readAsArrayBuffer(r.response);
        });
        return new Blob([buf], { type });
    };

    /* ---------- настройки ---------- */
    const store = {
        get: (k) => { try { return GM_getValue(k, undefined); } catch { return undefined; } },
        set: (k, v) => { try { GM_setValue(k, v); } catch {} }
    };

    /* ---------- кеш картинок: IndexedDB + blob: URL + очередь ---------- */
    const DB = (() => {
        let p;
        const open = () => p || (p = new Promise((res) => {
            try {
                const r = indexedDB.open('t7img', 1);
                r.onupgradeneeded = () => r.result.createObjectStore('i');
                r.onsuccess = () => res(r.result);
                r.onerror = () => res(null);
            } catch { res(null); }
        }));
        const tx = async (mode, fn) => {
            const db = await open();
            if (!db) return undefined;
            return new Promise((res) => {
                try {
                    const t = db.transaction('i', mode);
                    const rq = fn(t.objectStore('i'));
                    t.oncomplete = () => res(rq && rq.result);
                    t.onerror = t.onabort = () => res(undefined);
                } catch { res(undefined); }
            });
        };
        return {
            get: (k) => tx('readonly', (s) => s.get(k)),
            set: (k, v) => tx('readwrite', (s) => s.put(v, k))
        };
    })();

    const Q = { hi: [], lo: [], run: 0, max: 8 };
    function pump() {
        while (Q.run < Q.max) {
            const j = Q.hi.shift() || Q.lo.shift();
            if (!j) return;
            Q.run++;
            j.fn().then(j.res, j.rej).finally(() => { Q.run--; pump(); });
        }
    }
    const enqueue = (fn, hi) => new Promise((res, rej) => { (hi ? Q.hi : Q.lo).push({ fn, res, rej }); pump(); });

    const imgCache = new Map();   // url -> Promise<blob: URL>
    function fetchImg(url, hi) {
        if (imgCache.has(url)) return imgCache.get(url);
        const p = (async () => {
            let blob = await DB.get(url);
            if (!blob) {
                blob = await enqueue(() => getBuf(url), hi);
                DB.set(url, blob);
            }
            return URL.createObjectURL(blob);
        })();
        p.catch(() => imgCache.delete(url));
        imgCache.set(url, p);
        return p;
    }

    /* ---------- стили ---------- */
    const style = document.createElement('style');
    style.textContent = `
        .t7-w{display:inline-block;position:relative;vertical-align:middle;line-height:0}
        .t7-e{height:var(--t7-h,1.9em);width:auto;min-width:var(--t7-h,1.9em);vertical-align:middle;display:inline-block}
        .t7-e:not([src]),.t7-zw:not([src]){visibility:hidden}
        .t7-zw{position:absolute;left:50%;bottom:0;transform:translateX(-50%);height:100%;width:auto;pointer-events:none}

        .t7-btn{flex:none;margin-left:4px;padding:0 8px;min-height:28px;border:1px solid rgba(255,255,255,.25);
            border-radius:6px;background:rgba(145,70,255,.9);color:#fff;font:700 11px/1 system-ui,sans-serif;cursor:pointer}
        .t7-btn:hover{background:rgb(165,100,255)}

        .t7-pop{position:fixed;z-index:2147483000;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;
            padding:10px;background:#1b1b24;color:#eee;border:1px solid rgba(255,255,255,.18);border-radius:10px;
            box-shadow:0 8px 28px rgba(0,0,0,.55);font:13px/1.3 system-ui,sans-serif}
        .t7-pop *{box-sizing:border-box}
        .t7-pop [hidden]{display:none!important}
        .t7-pop button{font:inherit;cursor:pointer}
        .t7-h{display:flex;justify-content:space-between;align-items:center;font-size:15px}
        .t7-x{background:none;border:0;color:#ccc;font-size:20px;line-height:1;padding:0 4px}
        .t7-nf{display:flex;gap:6px;align-items:flex-end}
        .t7-nf label{flex:1;display:flex;flex-direction:column;gap:3px;font-size:11px;color:#aaa}
        .t7-pop input[type=text],.t7-pop input[type=search]{width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.2);
            background:#0f0f15;color:#fff;font:13px system-ui,sans-serif}
        .t7-nf button{padding:6px 10px;border-radius:6px;border:0;background:#9146ff;color:#fff}
        .t7-st{font-size:11px;color:#aaa;min-height:1.3em}
        .t7-sz{display:flex;align-items:center;gap:8px;font-size:12px;color:#aaa}
        .t7-szb{display:flex;gap:4px}
        .t7-szb button{min-width:34px;padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:#0f0f15;color:#ddd}
        .t7-szb button[aria-pressed=true]{background:#9146ff;border-color:#9146ff;color:#fff}
        .t7-gr{flex:1;min-height:140px;overflow-y:auto;overscroll-behavior:contain}
        .t7-sh{margin:6px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#aaa}
        .t7-gw{display:flex;flex-wrap:wrap;gap:2px}
        .t7-it{width:40px;height:40px;padding:3px;border:0;border-radius:6px;background:transparent;display:inline-flex;align-items:center;justify-content:center}
        .t7-it:hover,.t7-it:focus-visible{background:rgba(255,255,255,.14)}
        .t7-it img{max-width:100%;max-height:100%;object-fit:contain}
        .t7-emp{padding:16px 4px;color:#aaa;text-align:center}`;
    document.head.appendChild(style);

    /* ---------- загрузка списка эмоутов ---------- */
    function addSet(map, set, isGlobal) {
        for (const e of (set && set.emotes) || []) {
            const host = e.data && e.data.host;
            if (!host || !host.url || e.name === '__proto__') continue;
            const files = (host.files || []).filter((f) => f.format === 'WEBP').map((f) => f.name);
            map[e.name] = {
                base: 'https:' + host.url,
                f: files.length ? files : ['1x.webp', '2x.webp'],
                zw: !!(e.data.flags & 256),
                g: isGlobal
            };
        }
    }

    async function loadEmotes(nick, force) {
        const key = 't7c2:' + nick;
        if (!force) {
            const c = store.get(key);
            if (c) return { map: c.map, msg: c.msg, stale: Date.now() - c.at >= CACHE_TTL };
        }
        const map = {};
        let err = '';
        try { addSet(map, await getJson('https://7tv.io/v3/emote-sets/global'), true); }
        catch (e) { err = 'глобальные не загрузились'; console.warn('[7TV]', e); }

        let chanMsg = '';
        if (!nick) {
            chanMsg = 'укажи ник стримера';
        } else {
            try {
                const u = await getJson('https://api.ivr.fi/v2/twitch/user?login=' + encodeURIComponent(nick));
                const id = u && u[0] && u[0].id;
                if (!id) chanMsg = 'Twitch-канал «' + nick + '» не найден';
                else {
                    const user = await getJson('https://7tv.io/v3/users/twitch/' + id);
                    const set = user && user.emote_set;
                    if (set && set.emotes && set.emotes.length) addSet(map, set, false);
                    else chanMsg = 'у канала нет эмоутов 7TV';
                }
            } catch (e) {
                chanMsg = 'эмоуты канала не загрузились (нет аккаунта 7TV или сервис недоступен)';
                console.warn('[7TV]', e);
            }
        }

        const names = Object.keys(map);
        const nc = names.filter((n) => !map[n].g).length;
        let msg = `Канал: ${nc} · глобальные: ${names.length - nc}`;
        if (chanMsg) msg += ' · ' + chanMsg;
        if (err) msg += ' · ' + err;
        if (names.length && !chanMsg && !err) store.set(key, { at: Date.now(), map, msg });
        return { map, msg, stale: false };
    }

    function setStatus(t) {
        status = t;
        const e = pop && pop.querySelector('.t7-st');
        if (e) e.textContent = t;
    }

    async function reload(force) {
        const my = ++loadToken;
        if (force) setStatus('Загрузка…');
        const { map, msg, stale } = await loadEmotes(S.nick, force);
        if (my !== loadToken) return;
        for (const k of Object.keys(EM)) delete EM[k];
        Object.assign(EM, map);
        setStatus(msg);
        rescanAll();
        renderGrid();
        if (stale) reload(true);   // старый список уже показан, свежий подтянется фоном
    }

    /* ---------- подстановка эмоутов в сообщения ---------- */
    const has = (m, k) => Object.prototype.hasOwnProperty.call(m, k);

    function urlFor(em, n) {
        let best = null;
        for (const f of em.f) {
            const l = parseInt(f, 10);
            if (l <= n && (best === null || l > parseInt(best, 10))) best = f;
        }
        return em.base + '/' + (best || em.f[0]);
    }

    function makeImg(name, em, cls) {
        const img = document.createElement('img');
        img.className = cls;
        img.alt = name;
        img.title = name;
        img.addEventListener('load', () => stickFrom(img));   // ширина эмоута могла поменять перенос строк
        fetchImg(urlFor(em, SIZES[S.size].n), true).then(
            (d) => { img.src = d; },
            (e) => { console.warn('[7TV] картинка не загрузилась', name, e); img.replaceWith(document.createTextNode(name)); }
        );
        return img;
    }

    function processSpan(sp) {
        const src = sp.dataset.t7o != null ? sp.dataset.t7o : sp.textContent;
        const parts = src.split(/(\s+)/);
        if (!parts.some((p) => has(EM, p))) {
            if (sp.dataset.t7o != null) { sp.textContent = src; delete sp.dataset.t7o; }
            return;
        }
        sp.dataset.t7o = src;

        const frag = document.createDocumentFragment();
        let lastWrap = null;
        for (const p of parts) {
            const em = has(EM, p) ? EM[p] : null;
            if (em && em.zw && lastWrap) { lastWrap.appendChild(makeImg(p, em, 't7-zw')); continue; }
            if (em) {
                const w = document.createElement('span');
                w.className = 't7-w';
                w.appendChild(makeImg(p, em, 't7-e'));
                frag.appendChild(w);
                lastWrap = w;
                continue;
            }
            if (/^\s+$/.test(p)) {
                if (lastWrap) { frag.appendChild(document.createTextNode(p)); continue; }
            } else if (p) {
                lastWrap = null;
            }
            if (p) frag.appendChild(document.createTextNode(p));
        }
        sp.textContent = '';
        sp.appendChild(frag);
    }

    function processLi(li) {
        if (li.dataset.t7) return;
        li.dataset.t7 = '1';
        if (li.classList.contains('cy-chat-sys') || li.classList.contains('cy-chat-ev') || li.classList.contains('cy-chat-0')) return;
        const spans = li.querySelectorAll(':scope > span:not([class])');
        const sp = spans[spans.length - 1];
        if (sp) processSpan(sp);
    }

    const scan = () => {
        const fresh = document.querySelectorAll('.cy-chat-l li:not([data-t7])');
        if (!fresh.length) return;
        fresh.forEach(processLi);
        stickEnds();   // строки стали выше от эмоутов - возвращаем ленту вниз, если она была внизу
    };

    /* ---------- не даём ленте «уползать» вверх, когда эмоуты увеличивают строки ---------- */
    // scroll не всплывает, поэтому ловим в capture-фазе; программный рост высоты событие scroll не вызывает,
    // так что флаг отражает только то, где ленту оставил пользователь (или игра)
    document.addEventListener('scroll', (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains('cy-chat-l')){
            t.dataset.t7end = (t.scrollHeight - t.scrollTop - t.clientHeight < 40) ? '1' : '0';
        }
    }, true);

    function stickEnds() {
        document.querySelectorAll('.cy-chat-l').forEach((l) => {
            if (l.dataset.t7end !== '0') l.scrollTop = l.scrollHeight;
        });
    }
    function stickFrom(el) {
        const l = el.closest && el.closest('.cy-chat-l');
        if (l && l.dataset.t7end !== '0') l.scrollTop = l.scrollHeight;
    }

    function rescanAll() {
        document.querySelectorAll('.cy-chat-l li[data-t7]').forEach((li) => { delete li.dataset.t7; });
        scan();
    }

    const applySize = () => document.documentElement.style.setProperty('--t7-h', SIZES[S.size].h);

    /* ---------- окошко ---------- */
    let pop = null, anchor = null, io = null;

    function parseNick(v) {
        v = String(v || '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
        const i = v.lastIndexOf('/');
        if (i >= 0) v = v.slice(i + 1);
        v = v.replace(/^@/, '');
        return /^[a-z0-9_]{1,25}$/.test(v) ? v : '';
    }

    function chatInput() {
        const f = anchor && anchor.closest('form');
        return f && f.querySelector('input[type=text]');
    }

    function insertEmote(name) {
        const inp = chatInput();
        if (!inp || inp.disabled) return;
        const v = inp.value;
        const a = inp.selectionStart != null ? inp.selectionStart : v.length;
        const b = inp.selectionEnd != null ? inp.selectionEnd : a;
        const pre = v.slice(0, a), post = v.slice(b);
        const add = (pre && !/\s$/.test(pre) ? ' ' : '') + name + (/^\s/.test(post) ? '' : ' ');
        const nv = pre + add + post;
        if (inp.maxLength > 0 && nv.length > inp.maxLength) return;
        inp.value = nv;
        const pos = (pre + add).length;
        try { inp.setSelectionRange(pos, pos); } catch {}
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        if (!matchMedia('(pointer: coarse)').matches) inp.focus({ preventScroll: true });
    }

    function onVis(entries) {
        for (const en of entries) {
            if (!en.isIntersecting) continue;
            const el = en.target;
            io.unobserve(el);
            const em = EM[el.dataset.name];
            if (!em || el.dataset.l) continue;
            el.dataset.l = '1';
            fetchImg(urlFor(em, 1), false).then((d) => { el.firstChild.src = d; }, () => {});
        }
    }

    function filterGrid() {
        if (!pop) return;
        const q = pop.querySelector('.t7-q').value.trim().toLowerCase();
        pop.querySelectorAll('.t7-gw').forEach((w) => {
            let vis = 0;
            w.childNodes.forEach((b) => {
                const show = !q || b.dataset.name.toLowerCase().includes(q);
                b.hidden = !show;
                if (show) vis++;
            });
            w.hidden = !vis;
            w.previousElementSibling.hidden = !vis;
        });
    }

    function renderGrid() {
        if (!pop) return;
        const gr = pop.querySelector('.t7-gr');
        io.disconnect();
        gr.textContent = '';
        const names = Object.keys(EM).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const sec = (title, list) => {
            if (!list.length) return;
            const h = document.createElement('div');
            h.className = 't7-sh';
            h.textContent = `${title} · ${list.length}`;
            const w = document.createElement('div');
            w.className = 't7-gw';
            for (const n of list) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 't7-it';
                b.dataset.name = n;
                b.title = n;
                b.setAttribute('aria-label', n);
                const im = document.createElement('img');
                im.alt = '';
                im.decoding = 'async';
                b.appendChild(im);
                w.appendChild(b);
                io.observe(b);
            }
            gr.append(h, w);
        };
        sec('Канал', names.filter((n) => !EM[n].g));
        sec('Глобальные', names.filter((n) => EM[n].g));
        if (!names.length) {
            const d = document.createElement('div');
            d.className = 't7-emp';
            d.textContent = 'Эмоутов пока нет';
            gr.appendChild(d);
        }
        filterGrid();
    }

    function place() {
        if (!pop || !anchor || !anchor.isConnected) return;
        const r = anchor.getBoundingClientRect();
        const w = Math.min(340, innerWidth - 16);
        pop.style.width = w + 'px';
        pop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
        const above = r.top, below = innerHeight - r.bottom;
        if (above >= 300 || above > below) {
            pop.style.top = 'auto';
            pop.style.bottom = (innerHeight - r.top + 8) + 'px';
            pop.style.maxHeight = Math.min(520, Math.max(200, above - 16)) + 'px';
        } else {
            pop.style.bottom = 'auto';
            pop.style.top = (r.bottom + 8) + 'px';
            pop.style.maxHeight = Math.min(520, Math.max(200, below - 16)) + 'px';
        }
    }

    function onOutside(e) {
        if (pop && !pop.contains(e.target) && !(anchor && anchor.contains(e.target))) closePop();
    }
    function onKey(e) {
        if (e.key === 'Escape' && pop) {
            e.stopPropagation();
            const a = anchor;
            closePop();
            if (a && a.isConnected) a.focus({ preventScroll: true });
        }
    }

    function closePop() {
        if (!pop) return;
        pop.remove();
        pop = null;
        if (io) io.disconnect();
        io = null;
        document.removeEventListener('pointerdown', onOutside, true);
        document.removeEventListener('keydown', onKey, true);
        removeEventListener('resize', place);
    }

    function markSize() {
        pop.querySelectorAll('[data-sz]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sz === S.size)));
    }

    function openPop(btn) {
        anchor = btn;
        pop = document.createElement('div');
        pop.className = 't7-pop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Эмоуты 7TV');
        pop.innerHTML = `
            <div class="t7-h"><b>7TV</b><button type="button" class="t7-x" aria-label="Закрыть">×</button></div>
            <form class="t7-nf">
                <label>Ник стримера на Twitch<input type="text" class="t7-nick" maxlength="80" autocomplete="off" spellcheck="false"></label>
                <button type="submit">Загрузить</button>
            </form>
            <div class="t7-st" role="status"></div>
            <div class="t7-sz"><span>Размер</span><div class="t7-szb">${Object.keys(SIZES).map((k) => `<button type="button" data-sz="${k}" aria-pressed="false">${SIZES[k].label}</button>`).join('')}</div></div>
            <input type="search" class="t7-q" placeholder="Поиск эмоутов" autocomplete="off" aria-label="Поиск эмоутов">
            <div class="t7-gr"></div>`;
        ['keydown', 'keyup', 'keypress'].forEach((t) => pop.addEventListener(t, (e) => e.stopPropagation()));

        const nickInp = pop.querySelector('.t7-nick');
        nickInp.value = S.nick;
        nickInp.placeholder = pageChan || 'например, zakvielchannel';

        pop.querySelector('.t7-x').onclick = () => { closePop(); anchor && anchor.focus({ preventScroll: true }); };
        pop.querySelector('.t7-nf').addEventListener('submit', (e) => {
            e.preventDefault();
            const raw = nickInp.value.trim();
            const n = raw ? parseNick(raw) : pageChan;
            if (raw && !n) { setStatus('Неверный ник: нужны латинские буквы, цифры и _'); return; }
            S.nick = n;
            nickInp.value = n;
            store.set('t7nick:' + pageChan, n);
            reload(true);
        });
        pop.querySelector('.t7-szb').addEventListener('click', (e) => {
            const b = e.target.closest('[data-sz]');
            if (!b || b.dataset.sz === S.size) return;
            S.size = b.dataset.sz;
            store.set('t7size', S.size);
            applySize();
            markSize();
            rescanAll();
        });
        pop.querySelector('.t7-q').addEventListener('input', filterGrid);

        const gr = pop.querySelector('.t7-gr');
        gr.addEventListener('click', (e) => {
            const b = e.target.closest('.t7-it');
            if (b) insertEmote(b.dataset.name);
        });
        io = new IntersectionObserver(onVis, { root: gr, rootMargin: '120px' });

        document.body.appendChild(pop);
        markSize();
        setStatus(status);
        renderGrid();
        place();
        document.addEventListener('pointerdown', onOutside, true);
        document.addEventListener('keydown', onKey, true);
        addEventListener('resize', place);
    }

    function togglePop(btn) {
        if (pop && anchor === btn) closePop();
        else { closePop(); openPop(btn); }
    }

    /* ---------- кнопка «7TV» в форме чата ---------- */
    function ensureButtons() {
        document.querySelectorAll('form.cy-chat-f').forEach((f) => {
            if (f.querySelector('.t7-btn')) return;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 't7-btn';
            b.textContent = '7TV';
            b.title = 'Эмоуты 7TV';
            b.setAttribute('aria-label', 'Эмоуты 7TV');
            b.setAttribute('aria-haspopup', 'dialog');
            b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); togglePop(b); });
            const sub = f.querySelector('button[type=submit]');
            if (sub) sub.after(b); else f.appendChild(b);
        });
        if (pop && anchor && !anchor.isConnected) closePop();
    }

    /* ---------- запуск ---------- */
    function init() {
        const sz = store.get('t7size');
        if (SIZES[sz]) S.size = sz;
        S.nick = store.get('t7nick:' + pageChan) || pageChan;
        applySize();

        let queued = false;
        const schedule = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; ensureButtons(); scan(); });
        };
        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
        ensureButtons();

        reload(false);
    }

    init();
})();