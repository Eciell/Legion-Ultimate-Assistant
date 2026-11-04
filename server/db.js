/**
 * Хранилище пати (шаг 1) на bun:sqlite.
 *
 * Все функции синхронные: bun:sqlite не имеет асинхронного API, а запросы
 * здесь короткие (индексы по party_id / session_id), поэтому event loop
 * Bun.serve они не блокируют сколько-нибудь заметно.
 *
 * Идентификаторы:
 *   • partyId      — crypto.randomUUID() (PK, показывается как groupId);
 *   • sessionId    — crypto.randomUUID() (bearer-токен клиента);
 *   • inviteToken  — 16 случайных байт -> 32 hex-символа.
 * Math.random() не используется нигде: предсказуемый токен = чужая пати.
 */
import { Database } from 'bun:sqlite';
import { join } from 'node:path';

// DB_PATH — для тестов и для деплоя (например, /var/lib/legion-party/party.sqlite).
const DB_PATH = process.env.DB_PATH || join(import.meta.dir, 'data.sqlite');

const db = new Database(DB_PATH, { create: true });

// WAL: чтение members не блокируется записью join/kick.
db.exec('PRAGMA journal_mode = WAL;');
// В SQLite внешние ключи по умолчанию выключены — включаем явно,
// иначе FOREIGN KEY sessions -> parties не проверяется.
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  invite_token TEXT NOT NULL,
  owner_session TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  log_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL,
  login TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  member_id TEXT NOT NULL UNIQUE,
  FOREIGN KEY (party_id) REFERENCES parties(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_party_login ON sessions(party_id, login);
CREATE INDEX IF NOT EXISTS idx_party_sessions ON sessions(party_id);
`);

/*
 * Миграция v11.6.0a: member_id отдельно от session_id.
 *
 * session_id — bearer-креденшл клиента, его нельзя отдавать никому (даже
 * владельцу пати). Для UI (кик, «это я») нужен публичный идентификатор
 * участника — им и стал member_id.
 *
 * ALTER TABLE ... ADD COLUMN в SQLite не умеет UNIQUE, поэтому для уже
 * существующей таблицы: 1) добавляем колонку; 2) заполняем UUID у старых
 * строк; 3) накрываем UNIQUE-индексом. На свежей базе колонка и ограничение
 * создаются сразу в CREATE TABLE.
 */
const sessionColumns = db.query('PRAGMA table_info(sessions)').all();
if (!sessionColumns.some((col) => col.name === 'member_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN member_id TEXT');
    const legacyRows = db.query('SELECT session_id FROM sessions').all();
    const fillMemberId = db.query(
        'UPDATE sessions SET member_id = $member WHERE session_id = $session'
    );
    for (const row of legacyRows) {
        fillMemberId.run({ $member: crypto.randomUUID(), $session: row.session_id });
    }
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_session_member ON sessions(member_id);');

// invite_token — первичный ключ входа в пати: дубликат сделал бы join
// неоднозначным, поэтому уникальность гарантирует сама БД, а не код.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_party_invite ON parties(invite_token);');

/* ------------------------------------------------------------------ */
/* Генерация идентификаторов                                           */
/* ------------------------------------------------------------------ */

/** 32 hex-символа из 16 криптослучайных байт. */
export function newInviteToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function newSessionId() {
    return crypto.randomUUID();
}

/* ------------------------------------------------------------------ */
/* Prepared statements                                                 */
/* ------------------------------------------------------------------ */

const insertPartyStmt = db.query(
    `INSERT INTO parties (id, invite_token, owner_session, created_at, log_version)
     VALUES ($id, $token, $session, $created, 0)`
);
const insertSessionStmt = db.query(
    `INSERT INTO sessions (session_id, party_id, login, joined_at, member_id)
     VALUES ($session, $party, $login, $joined, $member)`
);
const selectPartyStmt = db.query('SELECT * FROM parties WHERE id = $id');
const selectPartyByInviteStmt = db.query('SELECT * FROM parties WHERE invite_token = $token');
const selectSessionStmt = db.query('SELECT * FROM sessions WHERE session_id = $session');
const selectSessionByLoginStmt = db.query(
    'SELECT * FROM sessions WHERE party_id = $party AND login = $login'
);
const selectSessionByMemberStmt = db.query(
    'SELECT * FROM sessions WHERE party_id = $party AND member_id = $member'
);
const selectSessionsStmt = db.query(
    'SELECT * FROM sessions WHERE party_id = $party ORDER BY joined_at ASC'
);
const deleteSessionStmt = db.query(
    'DELETE FROM sessions WHERE party_id = $party AND session_id = $session'
);
const deletePartySessionsStmt = db.query('DELETE FROM sessions WHERE party_id = $party');
const deletePartyStmt = db.query('DELETE FROM parties WHERE id = $id');
const updateTokenStmt = db.query(
    'UPDATE parties SET invite_token = $token WHERE id = $id'
);

/* ------------------------------------------------------------------ */
/* Маппинг строк БД -> camelCase для HTTP-слоя                         */
/* ------------------------------------------------------------------ */

function mapParty(row) {
    if (!row) return null;
    return {
        id: row.id,
        inviteToken: row.invite_token,
        ownerSession: row.owner_session,
        createdAt: row.created_at,
        logVersion: row.log_version
    };
}

function mapSession(row) {
    if (!row) return null;
    return {
        sessionId: row.session_id,
        memberId: row.member_id,
        partyId: row.party_id,
        login: row.login,
        joinedAt: row.joined_at
    };
}

/**
 * Нарушение UNIQUE/NOT NULL в SQLite: HTTP-слой превращает такие ошибки
 * в 409 login_taken, а не в 500.
 */
export function isConstraintError(err) {
    const code = String(err?.code || '');
    const message = String(err?.message || '');
    return code.includes('CONSTRAINT') || message.includes('constraint failed');
}

/* ------------------------------------------------------------------ */
/* Партии                                                              */
/* ------------------------------------------------------------------ */

// Партия и её владелец-сессия создаются одной транзакцией: иначе при сбое
// посередине осталась бы партия с owner_session, которого нет в sessions,
// и ротация токена/кик стали бы невозможны.
const createPartyTx = db.transaction((row) => {
    insertPartyStmt.run({
        $id: row.id,
        $token: row.inviteToken,
        $session: row.sessionId,
        $created: row.createdAt
    });
    insertSessionStmt.run({
        $session: row.sessionId,
        $party: row.id,
        $login: row.login,
        $joined: row.createdAt,
        $member: row.memberId
    });
});

/**
 * Создаёт партию; владелец сразу становится её первым участником.
 *
 * invite_token теперь UNIQUE, и теоретическая коллизия (16 случайных байт,
 * но код всё равно обязан её пережить) не должна ронять создание пати:
 * до 3 попыток, каждая следующая — с новым токеном.
 *
 * @returns {{id: string, inviteToken: string, sessionId: string, login: string, createdAt: number}}
 */
export function createParty({ inviteToken, sessionId, login }) {
    const createdAt = Date.now();
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
        const party = {
            id: crypto.randomUUID(),
            inviteToken: attempt === 1 && inviteToken ? inviteToken : newInviteToken(),
            sessionId,
            memberId: crypto.randomUUID(),
            login,
            createdAt
        };
        try {
            createPartyTx(party);
            return party;
        } catch (err) {
            // Пересоздаём только при нарушении UNIQUE (токен/случайный UUID);
            // остальные ошибки (диск, схема) бессмысленно повторять.
            if (!isConstraintError(err)) throw err;
            lastError = err;
        }
    }

    throw lastError;
}

export function getParty(partyId) {
    return mapParty(selectPartyStmt.get({ $id: String(partyId) }));
}

export function getPartyByInvite(inviteToken) {
    return mapParty(selectPartyByInviteStmt.get({ $token: String(inviteToken) }));
}

/** Ротация инвайт-токена. Возвращает установленное значение. */
export function rotateToken(partyId, inviteToken) {
    updateTokenStmt.run({ $token: inviteToken, $id: String(partyId) });
    return inviteToken;
}

/* ------------------------------------------------------------------ */
/* Сессии                                                              */
/* ------------------------------------------------------------------ */

/**
 * Добавляет участника. Нарушение UNIQUE(party_id, login) бросает исключение
 * SQLITE_CONSTRAINT — HTTP-слой превращает его в 409 login_taken.
 *
 * member_id генерируется здесь и НЕ связан с session_id: клиент видит только
 * member_id, а bearer-сессия остаётся секретом своего владельца.
 * @returns {string} memberId нового участника
 */
export function bindSession({ sessionId, partyId, login }) {
    const memberId = crypto.randomUUID();
    insertSessionStmt.run({
        $session: sessionId,
        $party: partyId,
        $login: login,
        $joined: Date.now(),
        $member: memberId
    });
    return memberId;
}

export function getSession(sessionId) {
    if (!sessionId) return null;
    return mapSession(selectSessionStmt.get({ $session: String(sessionId) }));
}

export function getSessionByLogin(partyId, login) {
    return mapSession(selectSessionByLoginStmt.get({
        $party: String(partyId),
        $login: String(login)
    }));
}

/** Публичный идентификатор участника -> его сессия (внутри пати). */
export function getSessionByMemberId(partyId, memberId) {
    if (!memberId) return null;
    return mapSession(selectSessionByMemberStmt.get({
        $party: String(partyId),
        $member: String(memberId)
    }));
}

export function listSessions(partyId) {
    return selectSessionsStmt.all({ $party: String(partyId) }).map(mapSession);
}

/** @returns {boolean} true, если сессия действительно была удалена. */
export function kickSession(partyId, sessionId) {
    const res = deleteSessionStmt.run({ $party: String(partyId), $session: String(sessionId) });
    return res.changes > 0;
}

/** Выход участника: удаляет только его собственную сессию. */
export function removeSession(partyId, sessionId) {
    return kickSession(partyId, sessionId);
}

// Владелец уходит — пати перестаёт существовать. Сначала sessions, потом
// parties: обратный порядок нарушил бы FOREIGN KEY sessions -> parties.
const deletePartyTx = db.transaction((partyId) => {
    deletePartySessionsStmt.run({ $party: partyId });
    deletePartyStmt.run({ $id: partyId });
});

/** Каскадное удаление пати вместе со всеми её сессиями. */
export function deleteParty(partyId) {
    deletePartyTx(String(partyId));
    return true;
}
