    // ============================================================
    // 0.3. СЕТЕВОЙ СЛОЙ (core/utils-api.js)
    // apiPath добавляет префикс /c/<канал>/ (см. docs/API.md),
    // fetchApi ходит через нативные контексты игры с фолбэком на fetch.
    // ============================================================
    const UtilsApi = {
        apiPath(p) {
            if (!p) return API_BASE;
            if (p.startsWith('/c/')) return p;
            return API_BASE + (p.startsWith('/') ? p : '/' + p);
        },
        async fetchApi(path, body, signal) {
            // Те же правила, что и в getItemArtSvg: после @grant объекты игры
            // живут только в unsafeWindow.
            const G = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            const nativeCtx = G.__lgAucContext || G.__lgCityContext || G.__lgMineContext;
            if (nativeCtx && typeof nativeCtx.api === 'function') {
                try {
                    const bodyObj = body ? (typeof body === 'string' ? JSON.parse(body) : body) : undefined;
                    const res = await (bodyObj !== undefined ? nativeCtx.api(path, bodyObj) : nativeCtx.api(path));
                    if (res) {
                        const result = { ok: true, body: res, status: 200 };
                        if (typeof res === 'object' && !Array.isArray(res)) Object.assign(result, res);
                        return result;
                    }
                } catch (e) { /* если упало, идем в обычный fetch */ }
            }

            const url = this.apiPath(path);
            const opts = { credentials: 'same-origin', cache: 'no-store' };
            if (signal) opts.signal = signal;
            if (body) {
                opts.method = 'POST';
                opts.headers = { 'Content-Type': 'application/json' };
                opts.body = JSON.stringify(body);
            }
            try {
                const res = await fetch(url, opts);
                const data = await res.json().catch(() => null);
                const result = {
                    status: res.status,
                    ok: res.ok && (data ? data.ok !== false : true),
                    body: data
                };
                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    Object.assign(result, data);
                }
                return result;
            } catch (err) {
                dbg('fetchApi error:', err);
                return { status: 0, ok: false, body: null, error: err.message };
            }
        },
    };
    Object.assign(Utils, UtilsApi);
