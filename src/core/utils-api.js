// ============================================================
// 0.3. СЕТЕВОЙ СЛОЙ (core/utils-api.js)
// ============================================================
const UtilsApi = (() => {
    const G = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

    return {
        apiPath(p) {
            const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || G;
            const base = (win && win.LG_BASE) || (typeof location !== 'undefined' ? location.pathname.match(/^\/c\/[^/]+/)?.[0] : '') || API_BASE || '';
            if (!p) return base;
            if (p.startsWith('/c/')) return p;
            return base + (p.startsWith('/') ? p : '/' + p);
        },
        async fetchApi(path, body, signal) {
            // Поддержка обоих форматов:
            // 1) Utils.fetchApi(path, payload, signal) — payload как тело POST-запроса
            // 2) Utils.fetchApi(path, { method, headers, body, signal }) — явные опции fetch
            let method = 'GET';
            let headers = {};
            let requestBody = undefined;
            let reqSignal = signal;

            const isOptionsObj = body && typeof body === 'object' && ('method' in body || 'body' in body || 'headers' in body);
            if (isOptionsObj) {
                method = body.method || (body.body ? 'POST' : 'GET');
                headers = Object.assign({}, body.headers);
                requestBody = typeof body.body === 'object' ? JSON.stringify(body.body) : body.body;
                if (body.signal) reqSignal = body.signal;
            } else if (body !== undefined && body !== null) {
                method = 'POST';
                headers = { 'Content-Type': 'application/json' };
                requestBody = typeof body === 'string' ? body : JSON.stringify(body);
            }

            // Нативные контексты игры
            const nativeCtx = G.__lgAucContext || G.X;
            if (nativeCtx && typeof nativeCtx.api === 'function') {
                try {
                    let nativePayload = undefined;
                    if (isOptionsObj) {
                        nativePayload = body.body ? (typeof body.body === 'string' ? JSON.parse(body.body) : body.body) : undefined;
                    } else if (body !== undefined && body !== null) {
                        nativePayload = typeof body === 'string' ? JSON.parse(body) : body;
                    }
                    const res = await (nativePayload !== undefined ? nativeCtx.api(path, nativePayload) : nativeCtx.api(path));
                    if (res) {
                        const result = { ok: true, body: res, data: res, status: 200 };
                        if (typeof res === 'object' && !Array.isArray(res)) Object.assign(result, res);
                        return result;
                    }
                } catch (e) { /* если упало, идем в обычный fetch */ }
            }

            const url = this.apiPath(path);
            const opts = { credentials: 'same-origin', cache: 'no-store' };
            if (reqSignal) opts.signal = reqSignal;
            if (method) opts.method = method;
            if (Object.keys(headers).length) opts.headers = headers;
            if (requestBody !== undefined) {
                opts.body = requestBody;
                if (!opts.headers) opts.headers = {};
                if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
            }

            try {
                // v11.7.0: используем win.fetch (пропатченный страницей fetch с префиксом канала)
                // с фолбэком на нативный fetch песочницы Tampermonkey.
                const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || G;
                const fetchFn = (win && typeof win.fetch === 'function') ? win.fetch.bind(win) : fetch;
                const res = await fetchFn(url, opts);
                const data = await res.json().catch(() => null);
                const result = {
                    status: res.status,
                    ok: res.ok && (data ? data.ok !== false : true),
                    body: data,
                    data: data
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
})();
Object.assign(Utils, UtilsApi);
