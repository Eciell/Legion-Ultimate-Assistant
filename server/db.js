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
import { resolve, join } from 'node:path';

// DB_PATH — для тестов и для деплоя (например, /var/lib/legion-party/party.sqlite).
// v11.6.1-extra: относительный путь из env резолвим от cwd процесса — иначе
// такой путь уезжает в рабочий каталог systemd/контейнера и файл БД
// появляется там, где его никто не ищет (в т.ч. при скачивании базы).
const DB_PATH = process.env.DB_PATH ? resolve(process.env.DB_PATH) : join(import.meta.dir, 'data.sqlite');

const db = new Database(DB_PATH, { create: true });

// Печатаем фактический путь и cwd: без этого непонятно, какую именно базу
// открыл процесс (важно для деплоя и для диагностики «пустой» data.sqlite).
console.log(`[legion-party] SQLite подключен: ${DB_PATH} (cwd: ${process.cwd()})`);

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
 * party_states (v11.6.0b) — последнее известное HP каждого участника.
 *
 * PK (party_id, member_id), а не login: member_id публичный и неизменный,
 * а ник в пати теоретически может быть пересоздан. Колонка login хранится
 * для отдачи в GET /party/:id/state — member_id наружу не отдаём (ТЗ 11.6.0b),
 * поэтому JOIN с sessions даёт актуальный ник без раскрытия идентификатора.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS party_states (
  party_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  login TEXT NOT NULL,
  hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (party_id, member_id)
);
`);

/*
 * party_log (v11.6.0c) — журнал боя пати.
 *
 * Отдельная таблица, а не JSON в parties: клиент догружает только новые
 * строки (id > since), а индекс (party_id, id) делает эту выборку дешёвой.
 * created_at — Date.now() сервера, клиент показывает по нему HH:MM.
 * Ретеншн — trimLog(partyId, 500) после каждой вставки (ТЗ 11.6.0c).
 */
db.exec(`
CREATE TABLE IF NOT EXISTS party_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id TEXT NOT NULL,
  login TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_party ON party_log(party_id, id);
`);

/*
 * active_users (v11.6.0g-3) — «кто сейчас играет с аддоном».
 *
 * Клиент раз в 30 с шлёт POST /heartbeat {login}, сервер переписывает
 * last_seen. GET /users отдаёт только тех, кто отметился за последние
 * ACTIVE_WINDOW_MS (15 минут), а строки старше окна удаляет
 * cleanupActiveUsers(). PRIMARY KEY по login: один игрок = одна строка,
 * история визитов здесь не нужна.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS active_users (
  login TEXT PRIMARY KEY,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_active_seen ON active_users(last_seen);
`);

/*
 * users_stats (v11.6.0g-5) — «когда видели игрока» + версия аддона.
 *
 * active_users живёт только окном онлайна (15 минут) и чистится, поэтому
 * для DAU/MAU нужна отдельная таблица: строка на логин хранится постоянно,
 * first_seen пишется один раз, last_seen/last_version перезаписываются
 * каждым heartbeat (POST /heartbeat {login, version}).
 */
db.exec(`
CREATE TABLE IF NOT EXISTS users_stats (
  login TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  last_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_stats_seen ON users_stats(last_seen);
`);

/*
 * market_prices (v11.6.2c.1) — цены аукциона, которые присылают клиенты.
 *
 * Строка = одно наблюдение «предмет стоил N меди в момент created_at».
 * Медиана считается по этим наблюдениям (см. getMedians), поэтому храним
 * сырые цены, а не готовую статистику: так можно менять окно/алгоритм, не
 * теряя данные. Ретеншн — 72 часа (MARKET_LIMITS.retentionMs), старые строки
 * удаляются прямо в addMarketPrices(): отдельный таймер не нужен, сканер и
 * так пишет каждые несколько минут.
 *
 * id — произвольная строка (id предмета игры, например wood_club).
 *
 * Индексы (v11.6.5d). Оба «горячих» запроса идут по
 * WHERE item_id IN (...) AND created_at > ?, поэтому вместо старого
 * idx_market_item(item_id) держим два:
 *   • idx_market_created — для DELETE ... WHERE created_at <= ? (ретеншн);
 *   • idx_market_item_created_price — покрывает выборку медианы целиком:
 *     равенство по item_id, диапазон по created_at и price прямо из индекса
 *     (в таблицу за ценами можно не ходить).
 * Старый индекс удаляем явно: CREATE INDEX IF NOT EXISTS на уже развёрнутой
 * базе его бы не тронул, и он остался бы мёртвым грузом на каждой записи.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS market_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  price INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
DROP INDEX IF EXISTS idx_market_item;
CREATE INDEX IF NOT EXISTS idx_market_created ON market_prices(created_at);
CREATE INDEX IF NOT EXISTS idx_market_item_created_price ON market_prices(item_id, created_at DESC, price);
`);

// Окно «онлайн»: heartbeat реже (30 с), так что 15 минут прощает до 30
// пропущенных тиков (сон ноутбука, лаг вкладки, перезагрузка страницы).
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

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

// Сбрасываем схему таблиц из WAL в основной файл data.sqlite,
// чтобы при скачивании база не была пустой.
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

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
// UPSERT по PK (party_id, member_id): один участник = одна строка.
const upsertStateStmt = db.query(
    `INSERT INTO party_states (party_id, member_id, login, hp, max_hp, updated_at)
     VALUES ($party, $member, $login, $hp, $maxHp, $updated)
     ON CONFLICT(party_id, member_id) DO UPDATE SET
       login = excluded.login,
       hp = excluded.hp,
       max_hp = excluded.max_hp,
       updated_at = excluded.updated_at`
);
// JOIN с sessions отсекает стейты ушедших/кикнутых участников: их строки
// удаляются ниже, но JOIN гарантирует корректность даже на старых базах.
const selectStatesStmt = db.query(
    `SELECT st.login AS login,
            st.hp AS hp,
            st.max_hp AS max_hp,
            st.updated_at AS updated_at
       FROM party_states st
       JOIN sessions s
         ON s.party_id = st.party_id AND s.member_id = st.member_id
      WHERE st.party_id = $party
      ORDER BY s.joined_at ASC`
);
// member_id резолвится из session_id здесь же: клиент присылает только bearer.
const deleteSessionStateStmt = db.query(
    `DELETE FROM party_states
      WHERE party_id = $party
        AND member_id = (SELECT member_id FROM sessions
                          WHERE party_id = $party AND session_id = $session)`
);
const deletePartyStatesStmt = db.query('DELETE FROM party_states WHERE party_id = $party');
const deletePartyLogStmt = db.query('DELETE FROM party_log WHERE party_id = $party');

// --- Журнал боя (v11.6.0c) -----------------------------------------
const insertLogStmt = db.query(
    `INSERT INTO party_log (party_id, login, type, text, created_at)
     VALUES ($party, $login, $type, $text, $created)`
);
// Инкрементальная догрузка: только строки новее since, в порядке появления.
const selectLogSinceStmt = db.query(
    `SELECT * FROM party_log
      WHERE party_id = $party AND id > $since
      ORDER BY id ASC
      LIMIT $limit`
);
// Первичная загрузка: последние N строк, но отдаём их по возрастанию id,
// иначе панель журнала отрисовалась бы «с конца».
const selectLogLatestStmt = db.query(
    `SELECT * FROM (
        SELECT * FROM party_log
         WHERE party_id = $party
         ORDER BY id DESC
         LIMIT $limit
     ) ORDER BY id ASC`
);
// Ретеншн: оставляем max последних строк пати, остальное удаляем.
const trimLogStmt = db.query(
    `DELETE FROM party_log
      WHERE party_id = $party
        AND id NOT IN (
            SELECT id FROM party_log
             WHERE party_id = $party
             ORDER BY id DESC
             LIMIT $max
        )`
);

// --- Пользователи аддона (v11.6.0g-3) -------------------------------
// INSERT OR REPLACE по PK login: повторный heartbeat просто обновляет время.
const upsertActiveUserStmt = db.query(
    'INSERT OR REPLACE INTO active_users (login, last_seen) VALUES ($login, $seen)'
);
// Строго `>`: строка, которой ровно 15 минут, уже считается протухшей
// (cleanupActiveUsers удаляет её тем же условием `<=`).
const selectActiveUsersStmt = db.query(
    'SELECT login FROM active_users WHERE last_seen > $threshold ORDER BY login ASC'
);
const deleteStaleActiveUsersStmt = db.query(
    'DELETE FROM active_users WHERE last_seen <= $threshold'
);

// --- Статистика (v11.6.0g-5) ----------------------------------------
// UPSERT по PK login: first_seen пишется только при первой вставке
// (впервые увидели игрока), last_seen/last_version обновляются каждым
// heartbeat с валидной version.
const upsertUserStatsStmt = db.query(
    `INSERT INTO users_stats (login, first_seen, last_seen, last_version)
     VALUES ($login, $seen, $seen, $version)
     ON CONFLICT(login) DO UPDATE SET
       last_seen = excluded.last_seen,
       last_version = excluded.last_version`
);
// DAU и MAU считаются одним запросом с разным порогом: индекс idx_stats_seen
// делает COUNT по диапазону дешёвым даже на десятках тысяч строк.
const countStatsSinceStmt = db.query(
    'SELECT COUNT(*) AS n FROM users_stats WHERE last_seen >= $threshold'
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

/** Строка party_states -> camelCase. member_id намеренно не отдаётся. */
function mapState(row) {
    if (!row) return null;
    return {
        login: row.login,
        hp: row.hp,
        maxHp: row.max_hp,
        updatedAt: row.updated_at
    };
}

/** Строка party_log -> camelCase для HTTP-слоя. */
function mapLog(row) {
    if (!row) return null;
    return {
        id: row.id,
        login: row.login,
        type: row.type,
        text: row.text,
        createdAt: row.created_at
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
    const params = { $party: String(partyId), $session: String(sessionId) };
    // Сначала стейт (member_id резолвится из ещё живой сессии), потом саму
    // сессию: иначе подзапрос вернёт NULL и строка party_states останется.
    deleteSessionStateStmt.run(params);
    const res = deleteSessionStmt.run(params);
    return res.changes > 0;
}

/** Выход участника: удаляет только его собственную сессию. */
export function removeSession(partyId, sessionId) {
    return kickSession(partyId, sessionId);
}

// Владелец уходит — пати перестаёт существовать. Сначала sessions, потом
// parties: обратный порядок нарушил бы FOREIGN KEY sessions -> parties.
const deletePartyTx = db.transaction((partyId) => {
    deletePartyStatesStmt.run({ $party: partyId });
    // party_log не связан FOREIGN KEY с parties (автоочистка не сработала бы),
    // поэтому чистим явно — иначе журнал пережил бы удалённую пати.
    deletePartyLogStmt.run({ $party: partyId });
    deletePartySessionsStmt.run({ $party: partyId });
    deletePartyStmt.run({ $id: partyId });
});

/** Каскадное удаление пати вместе со всеми её сессиями. */
export function deleteParty(partyId) {
    deletePartyTx(String(partyId));
    return true;
}

/* ------------------------------------------------------------------ */
/* Состояние участников (шаг 2, v11.6.0b)                              */
/* ------------------------------------------------------------------ */

/**
 * Сохраняет последнее известное HP участника (UPSERT по party_id+member_id).
 *
 * member_id и login берёт HTTP-слой из сессии (auth middleware), а не из
 * тела запроса: иначе клиент мог бы перезаписать чужую строку.
 *
 * @param {{partyId: string, memberId: string, login: string, hp: number, maxHp: number}} row
 * @returns {{login: string, hp: number, maxHp: number, updatedAt: number}}
 */
export function upsertState({ partyId, memberId, login, hp, maxHp }) {
    const updatedAt = Date.now();
    upsertStateStmt.run({
        $party: String(partyId),
        $member: String(memberId),
        $login: String(login),
        $hp: Math.trunc(hp),
        $maxHp: Math.trunc(maxHp),
        $updated: updatedAt
    });
    return { login: String(login), hp: Math.trunc(hp), maxHp: Math.trunc(maxHp), updatedAt };
}

/**
 * Все стейты пати в порядке присоединения (см. ORDER BY в selectStatesStmt).
 * member_id в ответ не попадает — клиенту он не нужен.
 * @returns {Array<{login: string, hp: number, maxHp: number, updatedAt: number}>}
 */
export function getStates(partyId) {
    return selectStatesStmt.all({ $party: String(partyId) }).map(mapState);
}

/* ------------------------------------------------------------------ */
/* Журнал боя (шаг 3, v11.6.0c)                                        */
/* ------------------------------------------------------------------ */

/**
 * Добавляет запись в журнал пати.
 *
 * login и type приходят из HTTP-слоя уже проверенными (login — из сессии,
 * type — из белого списка): БД здесь ничего не угадывает.
 *
 * @param {string} partyId
 * @param {string} login
 * @param {string} type  quest_start|quest_end|death|heal|heal_cast|damage|drop|system|chat
 * @param {string} text  1–500 символов
 * @returns {number} id вставленной строки
 */
export function addLog(partyId, login, type, text) {
    const res = insertLogStmt.run({
        $party: String(partyId),
        $login: String(login),
        $type: String(type),
        $text: String(text),
        $created: Date.now()
    });
    // bun:sqlite возвращает bigint для AUTOINCREMENT на больших id — наружу
    // отдаём обычный number: JSON.stringify(BigInt) бросает исключение.
    return Number(res.lastInsertRowid);
}

/**
 * Записи пати новее sinceId (по возрастанию id).
 * Если sinceId не задан (0/null/undefined) — последние `limit` строк:
 * это первичная загрузка журнала (ТЗ 11.6.0c).
 *
 * @param {string} partyId
 * @param {number} [sinceId]
 * @param {number} [limit]
 * @returns {Array<{id: number, login: string, type: string, text: string, createdAt: number}>}
 */
export function getLog(partyId, sinceId = 0, limit = 100) {
    const max = Math.max(1, Math.trunc(Number(limit) || 100));
    const since = Math.max(0, Math.trunc(Number(sinceId) || 0));

    const rows = since > 0
        ? selectLogSinceStmt.all({ $party: String(partyId), $since: since, $limit: max })
        : selectLogLatestStmt.all({ $party: String(partyId), $limit: max });

    return rows.map(mapLog);
}

/**
 * Ретеншн журнала: оставляет `maxRows` последних записей пати.
 * Вызывается после addLog (ТЗ: maxRows = 500).
 *
 * @param {string} partyId
 * @param {number} [maxRows]
 * @returns {number} сколько строк удалено
 */
export function trimLog(partyId, maxRows = 500) {
    const max = Math.max(1, Math.trunc(Number(maxRows) || 500));
    return trimLogStmt.run({ $party: String(partyId), $max: max }).changes;
}

/* ------------------------------------------------------------------ */
/* Пользователи аддона (v11.6.0g-3)                                    */
/* ------------------------------------------------------------------ */

/**
 * Отметка «я в игре с аддоном» (POST /heartbeat).
 *
 * login приходит из HTTP-слоя уже нормализованным (trim + toLowerCase),
 * поэтому здесь только приведение к строке: БД не угадывает формат.
 *
 * @param {string} login
 * @returns {number} записанный last_seen (Date.now() сервера)
 */
export function updateHeartbeat(login) {
    const seen = Date.now();
    upsertActiveUserStmt.run({ $login: String(login), $seen: seen });
    return seen;
}

/**
 * Логины, отметившиеся за последние ACTIVE_WINDOW_MS (15 минут).
 * Порядок алфавитный (ORDER BY login) — клиенту стабильнее сравнивать наборы.
 *
 * @returns {string[]}
 */
export function getActiveUsers() {
    return selectActiveUsersStmt
        .all({ $threshold: Date.now() - ACTIVE_WINDOW_MS })
        .map((row) => row.login);
}

/**
 * Удаляет протухшие отметки (last_seen <= now - 15 мин).
 * Вызывается из GET /users перед выборкой, чтобы таблица не росла.
 *
 * @returns {number} сколько строк удалено
 */
export function cleanupActiveUsers() {
    return deleteStaleActiveUsersStmt.run({ $threshold: Date.now() - ACTIVE_WINDOW_MS }).changes;
}

/* ------------------------------------------------------------------ */
/* Статистика аддона (v11.6.0g-5)                                      */
/* ------------------------------------------------------------------ */

// Окна DAU/MAU. Порог включительный (>=): игрок, отметившийся ровно сутки
// назад, ещё считается «активным за 24 часа».
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Запись в users_stats: «этот логин видели, версия аддона — такая».
 *
 * login приходит из HTTP-слоя уже нормализованным (trim + toLowerCase).
 * version необязателен: клиенты до 11.6.0g-5 его не шлют — тогда в
 * last_version остаётся прежнее значение (NULL при первой вставке).
 *
 * @param {string} login
 * @param {string|null} [version]
 * @returns {number} записанный last_seen (Date.now() сервера)
 */
export function updateUserStats(login, version) {
    const seen = Date.now();
    upsertUserStatsStmt.run({
        $login: String(login),
        $seen: seen,
        $version: version ? String(version) : null
    });
    return seen;
}

/**
 * Счётчики для GET /stats.
 *
 * online — окно active_users (15 минут, тот же порог, что у GET /users),
 * dau/mau — количество логинов в users_stats с last_seen за 24 часа и за
 * 30 дней. Считаем COUNT в SQLite, а не в JS: таблица живёт годами.
 *
 * @returns {{online: number, dau: number, mau: number}}
 */
export function getStats() {
    const now = Date.now();
    return {
        online: getActiveUsers().length,
        dau: countStatsSinceStmt.get({ $threshold: now - DAY_MS }).n,
        mau: countStatsSinceStmt.get({ $threshold: now - 30 * DAY_MS }).n
    };
}

/* ------------------------------------------------------------------ */
/* Обслуживание WAL (v11.6.1-extra)                                    */
/* ------------------------------------------------------------------ */

/**
 * Мягкий чекпоинт WAL: переносит готовые страницы из -wal в основной файл,
 * не блокируя читателей и не обрывая активные транзакции.
 *
 * Вызывается по таймеру (раз в 5 минут, см. server/index.js) и при остановке
 * сервера. PASSIVE выбран специально: он не ждёт читателей, поэтому не может
 * подвесить event loop Bun. Ошибки гасим здесь же — обслуживание БД не должно
 * ронять процесс.
 */
export function checkpointDb() {
    try { db.exec('PRAGMA wal_checkpoint(PASSIVE);'); }
    catch (err) { console.error('[legion-party] Ошибка wal_checkpoint:', err); }
}

/**
 * Корректное закрытие БД: TRUNCATE-чекпоинт переносит ВСЕ страницы из -wal
 * в data.sqlite и обнуляет журнал, после чего соединение закрывается.
 *
 * Нужен для graceful shutdown: без него последние записи остаются в
 * data.sqlite-wal, и скачанный файл data.sqlite выглядит устаревшим.
 */
export function closeDb() {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); db.close(); }
    catch (err) { console.error('[legion-party] Ошибка при закрытии БД:', err); }
}

/* ------------------------------------------------------------------ */
/* Аукцион: сканер цен (v11.6.2c.1)                                    */
/* ------------------------------------------------------------------ */

/**
 * Ограничения сканера. Экспортируются, чтобы HTTP-слой (server/index.js)
 * валидировал ровно те же числа: иначе клиент получал бы 200 на пачку,
 * которую БД потом молча обрезала бы.
 */
export const MARKET_LIMITS = {
    // Записей за один POST /market/scan (клиент присылает снимок витрины).
    maxLotsPerScan: 500,
    // id за один GET /market/medians (столько же кладёт клиент в запрос).
    maxIdsPerQuery: 200,
    // Длина id предмета: в игре это короткие слаги (wood_club), 64 — с запасом.
    maxIdLength: 64,
    // Верхняя граница цены: защита от мусора и переполнения INTEGER в SQLite.
    maxPrice: 1_000_000_000,
    // Окно статистики: наблюдения старше 72 часов удаляются (v11.6.5d:
    // было 7 дней — столько истории медиане не нужно, а таблица росла).
    retentionMs: 72 * 60 * 60 * 1000
};

const deleteStaleMarketPricesStmt = db.query(
    'DELETE FROM market_prices WHERE created_at <= $threshold'
);
const insertMarketPriceStmt = db.query(
    'INSERT INTO market_prices (item_id, price, created_at) VALUES ($item, $price, $created)'
);

/*
 * Медиана считается в SQL (v11.6.2c.1, переписана на CTE в v11.6.5d).
 *
 * Два уровня, чтобы запрос не зависел от объёма истории:
 *   1) recent — по каждому предмету нумеруем наблюдения от свежих к старым
 *      (ROW_NUMBER по created_at DESC) и берём только первые 100: старая
 *      цена не должна тянуть медиану, даже если формально она ещё в окне
 *      ретеншна. Параметр created_at > ? отсекает то, что addMarketPrices
 *      ещё не успел удалить.
 *   2) ranked — уже из этих ≤100 строк нумеруем цены по возрастанию и берём
 *      центральные: нечётное количество — одна строка ((cnt+1)/2 ==
 *      (cnt+2)/2), чётное — две, их среднее и даёт AVG.
 *
 * Деление целочисленное (SQLite: INTEGER / INTEGER -> INTEGER), поэтому
 * дробных номеров строк не бывает. Порядок параметров: сначала id списка
 * IN (?, ?, …), затем порог времени. Оконные функции есть в SQLite с 3.25,
 * Bun 1.4 несёт 3.4x.
 */
const buildMedianSql = (count) => `
    WITH recent AS (
        SELECT item_id,
               price,
               ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY created_at DESC) AS recency_rn
          FROM market_prices
         WHERE item_id IN (${new Array(count).fill('?').join(', ')})
           AND created_at > ?
    ),
    ranked AS (
        SELECT item_id,
               price,
               ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY price) AS rn,
               COUNT(*)     OVER (PARTITION BY item_id)                AS cnt
          FROM recent
         WHERE recency_rn <= 100
    )
    SELECT item_id,
           CAST(ROUND(AVG(price)) AS INTEGER) AS median
      FROM ranked
     WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)
     GROUP BY item_id
`;

// Кэш подготовленных запросов по числу id: список IN (?, ?, …) нельзя связать
// массивом, а пересобирать statement на каждый запрос — лишняя работа.
const medianStmtCache = new Map();

function getMedianStmt(count) {
    let stmt = medianStmtCache.get(count);
    if (!stmt) {
        stmt = db.query(buildMedianSql(count));
        medianStmtCache.set(count, stmt);
    }
    return stmt;
}

// Очистка старых наблюдений и вставка пачки — одной транзакцией: при сбое
// посередине пачки не остаётся «полуснимка» витрины.
const insertMarketBatchTx = db.transaction((rows, threshold) => {
    deleteStaleMarketPricesStmt.run({ $threshold: threshold });
    for (const row of rows) {
        insertMarketPriceStmt.run({ $item: row.id, $price: row.price, $created: row.createdAt });
    }
});

/**
 * Массовая запись цен аукциона: одна транзакция + очистка записей старше
 * 72 часов (MARKET_LIMITS.retentionMs, v11.6.5d).
 *
 * Мусор внутри пачки пропускаем молча: один битый лот не должен ронять
 * отправку всей пачки (клиент присылает снимок витрины целиком). Цена —
 * целое > 0, id — непустая строка до maxIdLength символов.
 *
 * @param {Array<{id: string, price: number}>} items
 * @returns {number} сколько наблюдений реально записано
 */
export function addMarketPrices(items) {
    const list = Array.isArray(items) ? items : [];
    const now = Date.now();
    const rows = [];

    for (const item of list) {
        if (rows.length >= MARKET_LIMITS.maxLotsPerScan) break;
        if (!item || typeof item !== 'object') continue;
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        const price = Math.trunc(Number(item.price));
        if (!id || id.length > MARKET_LIMITS.maxIdLength) continue;
        if (!Number.isFinite(price) || price <= 0 || price > MARKET_LIMITS.maxPrice) continue;
        rows.push({ id, price, createdAt: now });
    }

    if (!rows.length) return 0;
    insertMarketBatchTx(rows, now - MARKET_LIMITS.retentionMs);
    return rows.length;
}

/**
 * Медианы по предметам: последние ≤100 наблюдений в окне ретеншна (72 ч).
 *
 * Возвращает объект ровно по запрошенным id: null означает «наблюдений нет»
 * (клиент по null просто не показывает тултип). Пустой список -> {}.
 *
 * @param {string[]} itemIds
 * @returns {Record<string, number|null>}
 */
export function getMedians(itemIds) {
    const ids = [];
    for (const raw of Array.isArray(itemIds) ? itemIds : []) {
        const id = typeof raw === 'string' ? raw.trim() : '';
        if (!id || id.length > MARKET_LIMITS.maxIdLength) continue;
        if (ids.includes(id)) continue;
        ids.push(id);
        if (ids.length >= MARKET_LIMITS.maxIdsPerQuery) break;
    }

    const out = {};
    for (const id of ids) out[id] = null;
    if (!ids.length) return out;

    // Порог времени передаём в SQL, а не полагаемся на фоновую чистку:
    // строки старше retentionMs могли ещё не удалиться (DELETE идёт только
    // при следующем /market/scan), а в медиану попадать не должны.
    const threshold = Date.now() - MARKET_LIMITS.retentionMs;
    const rows = getMedianStmt(ids.length).all(...ids, threshold);
    for (const row of rows) {
        const price = Number(row.median);
        out[row.item_id] = Number.isFinite(price) && price > 0 ? price : null;
    }
    return out;
}
