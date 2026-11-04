/**
 * HTTP-сервер «Пати» для Legion Ultimate Assistant.
 *
 * Запуск: bun run dev (см. server/README.md).
 *
 * Шаг 1: создание пати, вход по инвайт-токену, список участников, кик,
 * выход и ротация токена.
 * Шаг 2 (v11.6.0b): состояние участников — POST/GET /party/:id/state
 * (HP-панель клиента).
 * Шаг 3 (v11.6.0c): журнал боя — POST/GET /party/:id/log (панель «Журнал»,
 * ретеншн 500 строк на пати).
 *
 * v11.6.0a: вход только через POST /party/join (inviteToken — первичный
 * ключ), memberId отдельно от sessionId, DELETE /party/:id/leave, логины
 * в нижнем регистре.
 *
 * Без CORS: клиент ходит через GM_xmlhttpRequest, который CORS игнорирует.
 * Браузерный fetch к этому серверу не используется, поэтому preflight
 * обрабатывать не нужно (и нечем: OPTIONS отдаст 405).
 */
import {
    addLog,
    bindSession,
    createParty,
    deleteParty,
    getLog,
    getParty,
    getPartyByInvite,
    getSession,
    getSessionByLogin,
    getSessionByMemberId,
    getStates,
    isConstraintError,
    kickSession,
    listSessions,
    newInviteToken,
    newSessionId,
    removeSession,
    rotateToken,
    trimLog,
    upsertState
} from './db.js';

const PORT = Number(process.env.PORT || 8787);

// Логин хранится и сравнивается ТОЛЬКО в нижнем регистре: игра отдаёт ник
// как есть, а две «формы» одного ника заняли бы одно имя дважды.
const LOGIN_RE = /^[a-z0-9_]{1,32}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

// Антибрутфорс на join: 10 попыток в минуту на IP.
const JOIN_LIMIT = 10;
const JOIN_WINDOW_MS = 60_000;

// Тело запроса больше 4 КБ в этом API не бывает — отсекаем мусор.
const MAX_BODY_BYTES = 4096;

// Верхняя граница HP: защита от мусора/переполнения INTEGER в SQLite
// (реальные значения в игре — сотни, не миллионы).
const MAX_HP = 1_000_000;

// Журнал боя (v11.6.0c): только эти типы событий попадают в БД.
const LOG_TYPES = ['quest_start', 'quest_end', 'death', 'heal', 'drop', 'system', 'chat'];
const LOG_TYPES_SET = new Set(LOG_TYPES);
const LOG_TEXT_MAX = 500;
const LOG_DEFAULT_LIMIT = 100;
const LOG_MAX_LIMIT = 200;
const LOG_MAX_ROWS = 500;

/**
 * Ошибка, которую можно безопасно отдать клиенту как JSON.
 *
 * extra — дополнительные поля тела ответа (например, {code:'session_expired'}
 * у 401), чтобы клиент мог отличить протухшую сессию от прочих ошибок.
 */
class HttpError extends Error {
    constructor(status, code, message, extra = null) {
        super(message);
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
}

/** Строгий разбор JSON-тела: не объект / битый JSON -> 400. */
async function readJson(req) {
    let text;
    try {
        text = await req.text();
    } catch (err) {
        throw new HttpError(400, 'bad_json', 'Не удалось прочитать тело запроса');
    }
    if (text.length > MAX_BODY_BYTES) {
        throw new HttpError(413, 'body_too_large', 'Тело запроса слишком большое');
    }
    if (!text.trim()) return {};
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        throw new HttpError(400, 'bad_json', 'Тело запроса должно быть валидным JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new HttpError(400, 'bad_json', 'Тело запроса должно быть JSON-объектом');
    }
    return parsed;
}

/**
 * Валидация и нормализация ника: trim + toLowerCase, затем /^[a-z0-9_]{1,32}$/.
 * Возвращает ту самую строку, которая попадёт в БД и в ответы API.
 */
function normalizeLogin(value) {
    if (typeof value !== 'string') {
        throw new HttpError(400, 'bad_login', 'Ник: 1–32 символа, только a-z, 0-9 и _');
    }
    const login = value.trim().toLowerCase();
    if (!LOGIN_RE.test(login)) {
        throw new HttpError(400, 'bad_login', 'Ник: 1–32 символа, только a-z, 0-9 и _');
    }
    return login;
}

/**
 * HP из тела state-запроса: целое в диапазоне 0..MAX_HP.
 * Возвращает null, если значение не число или вне диапазона —
 * обработчик превращает это в 400 bad_hp.
 */
function toHpInt(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const int = Math.trunc(n);
    return (int < 0 || int > MAX_HP) ? null : int;
}

/**
 * Текст записи журнала: strip HTML-тегов и управляющих символов, затем
 * проверка длины 1..LOG_TEXT_MAX.
 *
 * Эмодзи сохраняются: Array.from идёт по code points, а не по UTF-16
 * суррогатным парам, поэтому один эмодзи = один символ (ТЗ 11.6.0c).
 * Переносы строк оставляем: системные сообщения могут быть многострочными.
 *
 * @returns {string|null} нормализованный текст либо null (невалидный)
 */
function normalizeLogText(value) {
    if (typeof value !== 'string') return null;

    const cleaned = value
        .replace(/<[^>]*>/g, '')                                   // HTML-теги
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // управляющие
        .trim();

    const chars = Array.from(cleaned);
    if (chars.length < 1 || chars.length > LOG_TEXT_MAX) return null;
    return chars.join('');
}

/* ------------------------------------------------------------------ */
/* Rate limit на join                                                  */
/* ------------------------------------------------------------------ */

// ip -> { count, resetAt }. Map живёт в памяти процесса: для одного
// Bun-инстанса этого достаточно, для кластера нужен общий стор (шаг 3+).
const joinAttempts = new Map();

function checkJoinRate(ip) {
    const now = Date.now();

    // Ленивая чистка: иначе Map растёт от каждого нового IP бесконечно.
    if (joinAttempts.size > 5000) {
        for (const [key, rec] of joinAttempts) {
            if (rec.resetAt <= now) joinAttempts.delete(key);
        }
    }

    const rec = joinAttempts.get(ip);
    if (!rec || rec.resetAt <= now) {
        joinAttempts.set(ip, { count: 1, resetAt: now + JOIN_WINDOW_MS });
        return;
    }
    if (rec.count >= JOIN_LIMIT) {
        const retryAfter = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));
        throw new HttpError(429, 'rate_limited', `Слишком много попыток входа, повторите через ${retryAfter} c.`);
    }
    rec.count += 1;
}

/* ------------------------------------------------------------------ */
/* Auth и проверки прав                                                */
/* ------------------------------------------------------------------ */

/** Читает Authorization: Bearer <sessionId> и возвращает сессию. */
function authenticate(req) {
    // code:'session_expired' — сигнал клиенту, что bearer больше не валиден
    // (кик, выход владельца, удалённая пати): локальное состояние надо сбросить.
    const expired = { code: 'session_expired' };

    const header = req.headers.get('authorization') || '';
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match) {
        throw new HttpError(401, 'unauthorized', 'Нужен заголовок Authorization: Bearer <sessionId>', expired);
    }
    const session = getSession(match[1]);
    if (!session) {
        throw new HttpError(401, 'unauthorized', 'Сессия не найдена — войдите в пати заново', expired);
    }
    return session;
}

function requireParty(partyId) {
    const party = getParty(partyId);
    if (!party) throw new HttpError(404, 'party_not_found', 'Пати не найдена');
    return party;
}

function requireMember(session, party) {
    if (session.partyId !== party.id) {
        throw new HttpError(403, 'not_member', 'Сессия не принадлежит этой пати');
    }
}

function requireOwner(session, party) {
    if (session.sessionId !== party.ownerSession) {
        throw new HttpError(403, 'not_owner', 'Действие доступно только владельцу пати');
    }
}

/* ------------------------------------------------------------------ */
/* Обработчики эндпоинтов                                              */
/* ------------------------------------------------------------------ */

// POST /party {login}
async function handleCreateParty(req) {
    const body = await readJson(req);
    const login = normalizeLogin(body.login);

    const sessionId = newSessionId();
    const inviteToken = newInviteToken();
    const party = createParty({ inviteToken, sessionId, login });

    // login обратно не отдаём: клиент и так знает, под кем создал пати,
    // а сервер показывает только то, что сгенерировал сам.
    return json({
        groupId: party.id,
        inviteToken: party.inviteToken,
        sessionId: party.sessionId
    }, 201);
}

// POST /party/join {inviteToken, login}
// inviteToken — первичный ключ входа: groupId больше не нужен ни клиенту,
// ни серверу (id пати клиент получает в ответе).
async function handleJoin(req, server) {
    // Лимит считается до обращения к БД: даже неверные токены упираются в 429.
    const ip = server.requestIP(req)?.address || 'unknown';
    checkJoinRate(ip);

    const body = await readJson(req);
    const rawToken = body.inviteToken;
    if (typeof rawToken !== 'string' || !rawToken.trim()) {
        throw new HttpError(400, 'bad_invite_token', 'inviteToken обязателен');
    }

    // Формат токена намеренно не проверяем: любой мусор просто не найдётся
    // в UNIQUE-индексе и получит 404 — это не даёт оракула «токен валиден,
    // но пати нет».
    const party = getPartyByInvite(rawToken.trim());
    if (!party) {
        throw new HttpError(404, 'party_not_found', 'Пати с таким инвайт-токеном не найдена');
    }

    const login = normalizeLogin(body.login);

    if (getSessionByLogin(party.id, login)) {
        throw new HttpError(409, 'login_taken', 'Этот ник уже занят в пати');
    }

    const sessionId = newSessionId();
    try {
        bindSession({ sessionId, partyId: party.id, login });
    } catch (err) {
        // Гонка двух одновременных join с одним ником: предпроверка прошла,
        // но UNIQUE(party_id, login) сработал на вставке.
        if (isConstraintError(err)) {
            throw new HttpError(409, 'login_taken', 'Этот ник уже занят в пати');
        }
        throw err;
    }

    return json({ groupId: party.id, sessionId });
}

// POST /party/:id/rotate {newInviteToken?}
async function handleRotate(req, partyId) {
    const session = authenticate(req);
    const party = requireParty(partyId);
    requireMember(session, party);
    requireOwner(session, party);

    const body = await readJson(req);
    let token = body.newInviteToken;

    if (token === undefined || token === null || token === '') {
        token = newInviteToken();
    } else if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
        throw new HttpError(400, 'bad_invite_token', 'newInviteToken: 16–64 символа [A-Za-z0-9_-]');
    }

    // TODO(v11.6.0b): invite_token теперь UNIQUE — при совпадении (16 байт,
    // ~2^-128) UPDATE бросит SQLITE_CONSTRAINT, и клиент получит 500.
    // Ретрай, как в createParty(), здесь не сделан: событие исчезающе редкое.
    rotateToken(party.id, token);
    return json({ inviteToken: token });
}

// POST /party/:id/kick {memberId}
async function handleKick(req, partyId) {
    const session = authenticate(req);
    const party = requireParty(partyId);
    requireMember(session, party);
    requireOwner(session, party);

    const body = await readJson(req);
    const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : '';
    if (!memberId) {
        throw new HttpError(400, 'bad_member', 'memberId обязателен');
    }

    // Клиент знает только memberId; session_id резолвится внутри сервера и
    // наружу не уходит.
    const target = getSessionByMemberId(party.id, memberId);
    if (!target) {
        throw new HttpError(404, 'member_not_found', 'Такого участника нет в этой пати');
    }
    if (target.sessionId === session.sessionId) {
        throw new HttpError(400, 'cannot_kick_self', 'Нельзя кикнуть себя');
    }

    kickSession(party.id, target.sessionId);
    return json({ ok: true });
}

// GET /party/:id/members
async function handleMembers(req, partyId) {
    const session = authenticate(req);
    const party = requireParty(partyId);
    requireMember(session, party);

    // sessionId не отдаём никому и никогда: это bearer-креденшл клиента.
    // Для «Кикнуть» и «(вы)» достаточно публичного memberId.
    const members = listSessions(party.id).map((row) => ({
        login: row.login,
        joinedAt: row.joinedAt,
        memberId: row.memberId,
        role: row.sessionId === party.ownerSession ? 'owner' : 'member',
        self: row.sessionId === session.sessionId
    }));

    return json({ members });
}

/*
 * POST /party/:id/state {hp, maxHp}
 *
 * member_id и login берутся из сессии (authenticate), а не из тела: иначе
 * любой участник мог бы перезаписать чужую строку party_states.
 * Ответ короткий ({ok:true}): клиент не ждёт данных, он сразу делает GET.
 */
async function handleStatePost(req, partyId) {
    const session = authenticate(req);
    const party = requireParty(partyId);
    requireMember(session, party);

    const body = await readJson(req);
    const hp = toHpInt(body.hp);
    const maxHp = toHpInt(body.maxHp);
    if (hp === null || maxHp === null || maxHp <= 0) {
        throw new HttpError(400, 'bad_hp', 'hp и maxHp: целые числа, maxHp > 0');
    }

    // Защита от рассинхрона: игра может отдать hpNow больше максимума
    // (бафф/хил в момент опроса) — храним в пределах maxHp, иначе полоска
    // в панели уехала бы за 100%.
    upsertState({
        partyId: party.id,
        memberId: session.memberId,
        login: session.login,
        hp: Math.min(hp, maxHp),
        maxHp
    });

    return json({ ok: true });
}

// GET /party/:id/state -> {states: [{login, hp, maxHp, updatedAt}]}
// member_id не отдаётся: наружу светим только ник и HP (ТЗ 11.6.0b).
async function handleStateGet(req, partyId) {
    const session = authenticate(req);
    const party = requireParty(partyId);
    requireMember(session, party);

    return json({ states: getStates(party.id) });
}

/*
 * POST /party/:id/log {type, text}
 *
 * login берётся из сессии, а не из тела: клиент не должен уметь писать
 * в журнал от чужого имени. type — только из белого списка, text —
 * строка 1..500 символов после стрипа тегов (normalizeLogText).
 */
async function handleLogPost(req, partyId) {
    const session = authenticate(req);
    const party = requireParty(partyId);
    requireMember(session, party);

    const body = await readJson(req);

    if (typeof body.type !== 'string' || !LOG_TYPES_SET.has(body.type)) {
        throw new HttpError(400, 'bad_type', `type: один из ${LOG_TYPES.join(', ')}`);
    }

    const text = normalizeLogText(body.text);
    if (text === null) {
        throw new HttpError(400, 'bad_text', `text: строка 1–${LOG_TEXT_MAX} символов`);
    }

    const id = addLog(party.id, session.login, body.type, text);
    // Ретеншн: журнал пати не растёт бесконечно (ТЗ 11.6.0c, 500 строк).
    trimLog(party.id, LOG_MAX_ROWS);

    return json({ ok: true, id });
}

/*
 * GET /party/:id/log?since=<id>&limit=<n>
 *
 * nextSince — id последней отданной строки, чтобы клиент догружал только
 * новое. Если новых событий нет, since не сдвигается (иначе клиент потерял
 * бы строки, вставленные между запросами).
 */
async function handleLogGet(req, partyId, url) {
    const session = authenticate(req);
    const party = requireParty(partyId);
    requireMember(session, party);

    const rawSince = url.searchParams.get('since');
    let since = 0;
    if (rawSince !== null) {
        since = Number(rawSince);
        if (!Number.isFinite(since) || since < 0) {
            throw new HttpError(400, 'bad_since', 'since: неотрицательное целое число');
        }
        since = Math.trunc(since);
    }

    const rawLimit = url.searchParams.get('limit');
    let limit = rawLimit === null ? LOG_DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isFinite(limit)) {
        throw new HttpError(400, 'bad_limit', `limit: целое число 1..${LOG_MAX_LIMIT}`);
    }
    // Максимум 200 (ТЗ): клиент не должен вытянуть весь журнал одним запросом.
    limit = Math.min(LOG_MAX_LIMIT, Math.max(1, Math.trunc(limit)));

    const events = getLog(party.id, since, limit);
    const nextSince = events.length ? Number(events[events.length - 1].id) : since;

    return json({ events, nextSince });
}

// DELETE /party/:id/leave
async function handleLeave(req, partyId) {
    const session = authenticate(req);
    const party = requireParty(partyId);
    requireMember(session, party);

    // Владелец уносит пати с собой: каскадное удаление всех сессий и пати
    // одной транзакцией (см. deleteParty в db.js).
    if (session.sessionId === party.ownerSession) {
        deleteParty(party.id);
        return json({ ok: true, deleted: 'party' });
    }

    // Обычный участник освобождает только свой ник.
    removeSession(party.id, session.sessionId);
    return json({ ok: true, deleted: 'self' });
}

/* ------------------------------------------------------------------ */
/* Роутер                                                              */
/* ------------------------------------------------------------------ */

const server = Bun.serve({
    port: PORT,
    async fetch(req, srv) {
        try {
            const url = new URL(req.url);
            const parts = url.pathname.split('/').filter(Boolean);

            if (parts[0] !== 'party') {
                throw new HttpError(404, 'not_found', 'Неизвестный маршрут');
            }

            // POST /party
            if (parts.length === 1) {
                if (req.method !== 'POST') {
                    throw new HttpError(405, 'method_not_allowed', 'Ожидается POST /party');
                }
                return await handleCreateParty(req);
            }

            // POST /party/join — вход по inviteToken (groupId больше не нужен).
            if (parts.length === 2 && parts[1] === 'join') {
                if (req.method !== 'POST') {
                    throw new HttpError(405, 'method_not_allowed', 'Ожидается POST /party/join');
                }
                return await handleJoin(req, srv);
            }

            if (parts.length !== 3) {
                throw new HttpError(404, 'not_found', 'Неизвестный маршрут');
            }

            const partyId = decodeURIComponent(parts[1]);
            const action = parts[2];

            // POST /party/:id/join удалён в v11.6.0a: вход теперь только по
            // inviteToken через POST /party/join (см. выше), поэтому запрос
            // проваливается в общий 404.
            if (action === 'rotate') {
                if (req.method !== 'POST') {
                    throw new HttpError(405, 'method_not_allowed', 'Ожидается POST /party/:id/rotate');
                }
                return await handleRotate(req, partyId);
            }
            if (action === 'kick') {
                if (req.method !== 'POST') {
                    throw new HttpError(405, 'method_not_allowed', 'Ожидается POST /party/:id/kick');
                }
                return await handleKick(req, partyId);
            }
            if (action === 'leave') {
                if (req.method !== 'DELETE') {
                    throw new HttpError(405, 'method_not_allowed', 'Ожидается DELETE /party/:id/leave');
                }
                return await handleLeave(req, partyId);
            }
            if (action === 'members') {
                if (req.method !== 'GET') {
                    throw new HttpError(405, 'method_not_allowed', 'Ожидается GET /party/:id/members');
                }
                return await handleMembers(req, partyId);
            }
            // Состояние участников (v11.6.0b): POST — свой hp/maxHp, GET — все.
            if (action === 'state') {
                if (req.method === 'POST') {
                    return await handleStatePost(req, partyId);
                }
                if (req.method === 'GET') {
                    return await handleStateGet(req, partyId);
                }
                throw new HttpError(405, 'method_not_allowed', 'Ожидается GET или POST /party/:id/state');
            }
            // Журнал боя (v11.6.0c): POST — запись, GET — догрузка по since.
            if (action === 'log') {
                if (req.method === 'POST') {
                    return await handleLogPost(req, partyId);
                }
                if (req.method === 'GET') {
                    return await handleLogGet(req, partyId, url);
                }
                throw new HttpError(405, 'method_not_allowed', 'Ожидается GET или POST /party/:id/log');
            }

            throw new HttpError(404, 'not_found', 'Неизвестный маршрут');
        } catch (err) {
            if (err instanceof HttpError) {
                return json({ error: err.code, message: err.message, ...(err.extra || {}) }, err.status);
            }
            console.error('[legion-party] Необработанная ошибка:', err);
            return json({ error: 'internal', message: 'Внутренняя ошибка сервера' }, 500);
        }
    }
});

console.log(`[legion-party] слушаю http://localhost:${server.port}`);
