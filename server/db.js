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
// busy_timeout: вместо мгновенного SQLITE_BUSY при кратковременной блокировке
// (VACUUM, чекпоинт, параллельная запись) SQLite ждёт до 5 секунд.
db.exec('PRAGMA busy_timeout = 5000;');
// synchronous = NORMAL: в паре с WAL это безопасный компромисс — транзакция
// не делает fsync на каждый коммит, но при падении процесса БД не теряет
// целостность (риск — потеря последних коммитов при отключении питания).
db.exec('PRAGMA synchronous = NORMAL;');
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
-- v11.6.5.1a: индекс под поиск пати по владельцу (getUserActiveParty ищет
-- parties по owner_session, а не sessions по login).
CREATE INDEX IF NOT EXISTS idx_party_owner ON parties(owner_session);
-- v11.6.5.1: подзапрос поиска сессий логина идёт без party_id, поэтому
-- составной idx_party_login здесь не помогает.
CREATE INDEX IF NOT EXISTS idx_session_login ON sessions(login);
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
 * теряя данные. Ретеншн — 72 часа (MARKET_LIMITS.retentionMs), а на предмет
 * хранится не больше MARKET_LIMITS.maxRowsPerItem самых свежих строк.
 * Обе чистки живут в cleanupMarketPrices(): раньше DELETE висел на каждой
 * вставке (POST /market/scan), из-за чего запись ждала тяжёлую операцию.
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

/* ------------------------------------------------------------------ */
/* Целостность индексов (v11.7.1.1)                                    */
/* ------------------------------------------------------------------ */

/**
 * Ошибка, похожая на повреждение индекса/файла БД.
 *
 * bun:sqlite кладёт код в err.code (для сломанного индекса это
 * SQLITE_CORRUPT_INDEX), но текст может прийти и без кода — поэтому
 * проверяем ещё и сообщение («database disk image is malformed»).
 */
function isCorruptIndexError(err) {
    const code = String(err?.code || '');
    const message = String(err?.message || '');
    return code.includes('SQLITE_CORRUPT')
        || /malformed|corrupt/i.test(message);
}

/** Сообщение quick_check, которое лечится пересборкой индексов. */
function isIndexProblemMessage(text) {
    return /index|malformed|corrupt/i.test(String(text || ''));
}

/**
 * Ошибка REINDEX, после которой спасает пересборка users_stats.
 *
 * REINDEX строит UNIQUE-индексы заново из таблицы. Если в таблице/индексе
 * накопились конфликтующие строки (битый UNIQUE-индекс, дубли login), SQLite
 * падает на `UNIQUE constraint failed: users_stats.login` с кодом
 * SQLITE_CONSTRAINT_PRIMARYKEY / SQLITE_CONSTRAINT_UNIQUE. Именно этот случай
 * лечится дедупликацией: копируем таблицу через GROUP BY login и заменяем её.
 */
function isUsersStatsRebuildError(err) {
    const code = String(err?.code || '').toUpperCase();
    const message = String(err?.message || '');
    if (code.includes('SQLITE_CONSTRAINT_PRIMARYKEY')
        || code.includes('SQLITE_CONSTRAINT_UNIQUE')) {
        return true;
    }
    return /users_stats/i.test(message)
        && /constraint|unique|primary|malformed|corrupt/i.test(message);
}

/**
 * Пересборка users_stats с дедупликацией по login — одной транзакцией.
 *
 * Схема новой таблицы совпадает с исходной, поэтому HTTP-слой не замечает
 * подмены. По каждому login берём:
 *   • first_seen — MIN (когда игрока впервые увидели);
 *   • last_seen  — MAX (когда видели последний раз);
 *   • last_version — из самой свежей строки (last_seen DESC, rowid DESC):
 *     при равном last_seen выигрывает более поздняя запись.
 * После DROP старой таблицы её индексы удаляются вместе с ней, поэтому
 * idx_stats_seen пересоздаётся явно в той же транзакции.
 */
const rebuildUsersStatsTx = db.transaction(() => {
    db.exec(`
        DROP TABLE IF EXISTS users_stats_clean;
        CREATE TABLE users_stats_clean (
          login TEXT PRIMARY KEY,
          first_seen INTEGER NOT NULL,
          last_seen INTEGER NOT NULL,
          last_version TEXT
        );
        INSERT INTO users_stats_clean (login, first_seen, last_seen, last_version)
        SELECT login,
               MIN(first_seen),
               MAX(last_seen),
               (
                   SELECT src.last_version
                     FROM users_stats src
                    WHERE src.login = users_stats.login
                    ORDER BY src.last_seen DESC, src.rowid DESC
                    LIMIT 1
               )
          FROM users_stats
         GROUP BY login;
        DROP TABLE users_stats;
        ALTER TABLE users_stats_clean RENAME TO users_stats;
        CREATE INDEX IF NOT EXISTS idx_stats_seen ON users_stats(last_seen);
    `);
});

/**
 * Проверка целостности индексов при старте и безопасный авторемонт.
 *
 * `PRAGMA quick_check` читает только структуру (быстрее full integrity_check)
 * и возвращает «ok» либо строки с описанием проблемы. Повреждённый индекс —
 * это рассинхрон B-дерева индекса с таблицей: данные целы, поэтому `REINDEX;`
 * пересобирает все индексы из таблиц и чинит базу без потери строк.
 *
 * Если REINDEX падает на UNIQUE-конфликте users_stats (битый PRIMARY KEY /
 * дубли login), вместо отказа пересобираем users_stats с дедупликацией
 * (см. rebuildUsersStatsTx): данные сохраняются, дубликаты схлопываются.
 *
 * Функция ничего не бросает: если проблема не про индексы (или ремонт не
 * удался), пишем причину в консоль и работаем дальше — сервер не должен
 * падать на старте из-за диагностики.
 *
 * @returns {boolean} true, если индекс/таблица в порядке или успешно починены
 */
export function ensureIndexesHealthy() {
    const problems = [];
    try {
        const rows = db.query('PRAGMA quick_check').all();
        for (const row of rows) {
            const value = String(Object.values(row)[0] ?? '').trim();
            if (value && value.toLowerCase() !== 'ok') problems.push(value);
        }
    } catch (err) {
        if (!isCorruptIndexError(err)) {
            console.error('[legion-party] quick_check завершился ошибкой:', err);
            return false;
        }
        // Сама проверка упала на «malformed» — считаем это повреждением
        // индекса и пробуем пересборку (REINDEX; ниже).
        problems.push(String(err?.message || err));
    }

    if (!problems.length) return true;

    if (!problems.some(isIndexProblemMessage)) {
        console.error(
            '[legion-party] quick_check нашёл проблемы, REINDEX не поможет:',
            problems.join('; ')
        );
        return false;
    }

    console.warn('[legion-party] quick_check обнаружил повреждение индекса:', problems.join('; '));
    try {
        db.exec('REINDEX;');
        console.log('[legion-party] Выполнен REINDEX после обнаружения повреждения индекса');
        return true;
    } catch (err) {
        console.error('[legion-party] REINDEX после повреждения индекса не удался:', err);

        // REINDEX не смог пересобрать UNIQUE-индекс users_stats (дубли login
        // или битый PK) — чиним таблицу пересборкой с дедупликацией.
        if (!isUsersStatsRebuildError(err)) return false;

        console.warn('[legion-party] Пересборка users_stats с дедупликацией по login...');
        try {
            rebuildUsersStatsTx();
            console.log('[legion-party] Таблица users_stats пересобрана с дедупликацией');
            return true;
        } catch (rebuildErr) {
            console.error('[legion-party] Пересборка users_stats не удалась:', rebuildErr);
            return false;
        }
    }
}

// Стартовая диагностика: чиним индексы до первичной очистки и VACUUM,
// иначе DELETE/чтения из cleanupUsers упадут на сломанном индексе.
ensureIndexesHealthy();

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
// v11.6.5.1a: активная пати логина — только та, где он ВЛАДЕЛЕЦ
// (owner_session указывает на его сессию). Участие в чужой пати создавать
// свою не мешает: клиент умеет держать только одну, но игрок может выйти из
// чужой и собрать свою — сервер это больше не блокирует.
// ORDER BY created_at DESC — на случай, если в базе остались дубли от
// старых версий сервера. Подзапрос по sessions(login) закрыт индексом
// idx_session_login, внешний — idx_party_owner.
const selectActivePartyByLoginStmt = db.query(
    `SELECT * FROM parties
      WHERE owner_session IN (
            SELECT session_id FROM sessions WHERE login = $login
      )
      ORDER BY created_at DESC
      LIMIT 1`
);
// v11.6.5.1: пати-сироты для TTL-чистки: созданы больше 24 часов назад и
// не имеют ни одного обновления party_states за последние 2 часа.
const selectStalePartiesStmt = db.query(
    `SELECT id FROM parties
      WHERE created_at < $stale
        AND id NOT IN (
            SELECT DISTINCT party_id FROM party_states WHERE updated_at > $active
        )`
);
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
// Умная чистка заброшенных аккаунтов (см. cleanupUsers):
//   • last_seen <= $idle     — не заходил 35 дней (30-дневный MAU цел);
//   • last_version != $version при $outdated — старая версия аддона и
//     молчание больше 14 дней, то есть аддон точно заброшен.
// last_version IS NOT NULL обязателен: старые клиенты её не шлют, и NULL != ?
// в SQL дал бы NULL (условие ложно), но проверка делает намерение явным.
const deleteStaleUserStatsStmt = db.query(
    `DELETE FROM users_stats
      WHERE last_seen <= $idle
         OR (last_version IS NOT NULL
             AND last_version != $version
             AND last_seen <= $outdated)`
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

/**
 * Активная пати, которой логин ВЛАДЕЕТ (v11.6.5.1a).
 *
 * «Активная» = в parties осталась строка с owner_session, указывающим на
 * сессию этого логина. Участие в чужой пати (строка в sessions без
 * владения) здесь не учитывается: такой игрок может создать свою пати, а
 * чужую покинет сам или его кикнут.
 * Брошенные пати вычищает cleanupStaleParties() через 24 часа.
 *
 * @param {string} login нормализованный ник (trim + toLowerCase)
 * @returns {{id: string, inviteToken: string, ownerSession: string, createdAt: number, logVersion: number}|null}
 */
export function getUserActiveParty(login) {
    if (!login) return null;
    return mapParty(selectActivePartyByLoginStmt.get({ $login: String(login) }));
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

/**
 * TTL-чистка заброшенных пати (v11.6.5.1).
 *
 * Удаляем пати, созданные больше 24 часов назад, если за последние 2 часа
 * никто из участников не присылал state (party_states.updated_at). Такой
 * «след» остаётся у пати, в которой реально играли, даже если потом все
 * закрыли браузер и забыли нажать «Выйти».
 *
 * Удаление идёт через deletePartyTx, а не одним DELETE FROM parties: на
 * sessions висит FOREIGN KEY на parties, и прямой DELETE упал бы с
 * SQLITE_CONSTRAINT, не удалив ничего. Транзакция чистит states, log,
 * sessions и только потом саму пати.
 *
 * @returns {number} сколько пати удалено (0 при ошибке БД)
 */
export function cleanupStaleParties() {
    const now = Date.now();
    const staleThreshold = now - 24 * 60 * 60 * 1000;
    const activeThreshold = now - 2 * 60 * 60 * 1000;
    try {
        const rows = selectStalePartiesStmt.all({
            $stale: staleThreshold,
            $active: activeThreshold
        });
        for (const row of rows) deletePartyTx(row.id);
        return rows.length;
    } catch (err) {
        console.error('[legion-party] cleanupStaleParties:', err);
        return 0;
    }
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
// 35 дней, а не 30: строка, удалённая на 30-й день, всё ещё могла бы попасть
// в MAU (порог включительный), поэтому берём запас и не искажаем /stats.
const USER_STATS_IDLE_MS = 35 * DAY_MS;
// 14 дней для устаревшей версии: такой пользователь не обновился и давно не
// заходил — держать его строку в users_stats смысла нет.
const USER_STATS_OUTDATED_MS = 14 * DAY_MS;

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

/**
 * Чистка неактивных пользователей (v11.7.1.1).
 *
 * 1) active_users — отметки старше ACTIVE_WINDOW_MS (15 минут): это лишь
 *    «кто сейчас онлайн», история визитов живёт в users_stats.
 * 2) users_stats — заброшенные аккаунты:
 *    • last_seen <= now - 35 дней (30-дневный MAU в /stats не искажается);
 *    • last_version задан, не равен LATEST_VERSION и last_seen <= now - 14 дней.
 *
 * latestVersion приходит из server/index.js: LATEST_VERSION — единственный
 * источник правды о текущей версии аддона, дублировать её в db.js нельзя.
 * Если версия не передана, «устаревшую» ветку не трогаем: без эталона она
 * удалила бы всех, у кого версия отличается от null.
 *
 * @param {string} [latestVersion]
 * @returns {{activeUsers: number, usersStats: number}} сколько строк удалено
 */
export function cleanupUsers(latestVersion) {
    const now = Date.now();
    const result = { activeUsers: 0, usersStats: 0 };
    const version = latestVersion ? String(latestVersion) : null;

    try {
        result.activeUsers = deleteStaleActiveUsersStmt
            .run({ $threshold: now - ACTIVE_WINDOW_MS }).changes;
    } catch (err) {
        console.error('[legion-party] cleanupUsers(active_users):', err);
    }

    if (version) {
        const statsParams = {
            $idle: now - USER_STATS_IDLE_MS,
            $outdated: now - USER_STATS_OUTDATED_MS,
            $version: version
        };
        try {
            result.usersStats = deleteStaleUserStatsStmt.run(statsParams).changes;
        } catch (err) {
            if (!isCorruptIndexError(err)) {
                console.error('[legion-party] cleanupUsers(users_stats):', err);
            } else {
                // Повреждён именно индекс users_stats (SQLITE_CORRUPT_INDEX /
                // malformed). REINDEX таблицы пересобирает её индексы из
                // данных — строки не теряются, — после чего повторяем DELETE
                // ровно один раз. Второй сбой гасим логом: фоновая чистка не
                // должна ронять таймер.
                console.warn(
                    '[legion-party] cleanupUsers(users_stats): повреждён индекс, выполняю REINDEX users_stats'
                );
                try {
                    db.run('REINDEX users_stats;');
                    result.usersStats = deleteStaleUserStatsStmt.run(statsParams).changes;
                    console.log(
                        '[legion-party] Выполнен REINDEX users_stats после обнаружения повреждения индекса'
                    );
                } catch (retryErr) {
                    console.error('[legion-party] cleanupUsers(users_stats) после REINDEX:', retryErr);
                }
            }
        }
    }

    return result;
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
 * Сжатие БД: TRUNCATE-чекпоинт (переносит весь -wal в основной файл и
 * обнуляет журнал) + VACUUM (переписывает data.sqlite без пустых страниц).
 *
 * Запускается при старте сервера и раз в сутки по таймеру. Оба шага в
 * try/catch: обслуживание БД не должно ронять процесс, а на живой базе
 * VACUUM может не получить блокировку — тогда просто повторим в следующий
 * раз. Время выполнения пишем в консоль: по нему видно, насколько раздута
 * база и не пора ли менять расписание.
 *
 * @returns {number|null} длительность в мс или null при ошибке
 */
export function compactDb() {
    const startedAt = Date.now();
    try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        // VACUUM нельзя выполнять внутри транзакции; здесь её нет — вызовы
        // последовательные и вне db.transaction.
        db.exec('VACUUM;');
        const elapsed = Date.now() - startedAt;
        console.log(`[legion-party] VACUUM + wal_checkpoint(TRUNCATE): ${elapsed} мс`);
        return elapsed;
    } catch (err) {
        console.error('[legion-party] Ошибка VACUUM/TRUNCATE-чекпоинта:', err);
        return null;
    }
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
    retentionMs: 72 * 60 * 60 * 1000,
    // Потолок истории на один предмет (v11.7.1.1). Медиана читает максимум 100
    // самых свежих строк (recency_rn <= 100 в buildMedianSql), поэтому 120 —
    // это те же 100 плюс запас: популярные предметы перестают раздувать БД,
    // а результат медианы не меняется.
    maxRowsPerItem: 120
};

// Кэш медиан (v11.6.5.1). Объявлен здесь, а не рядом с getCachedMedians,
// потому что addMarketPrices обязан сбрасывать его при реальной записи
// новых цен и не должен сбрасывать при пустом/полностью дедуплицированном
// батче. cleanupMarketPrices кэш не трогает: он удаляет строки старше окна
// (их SQL и так отсекает по created_at) или излишки сверх 120, которые в
// медиану из 100 свежих не попадают.
const mediansCache = new Map();
const MEDIAN_CACHE_TTL_MS = 60_000;
// Верхняя граница карты: после неё выкидываем протухшие записи.
const MEDIAN_CACHE_MAX_ENTRIES = 2000;

/*
 * Дедупликация сканов (v11.7.1.1): item_id:price -> timestamp последней записи.
 *
 * Один и тот же лот витрины присылают разные игроки (и один и тот же клиент
 * каждые несколько минут), поэтому без фильтра market_prices наполнялся бы
 * одинаковыми снимками. Пара, записанная менее 10 минут назад, повторно не
 * пишется: для медианы это то же наблюдение, а строк в БД в разы меньше.
 * TTL и лимит держат Map в памяти ограниченной: просроченные ключи
 * вычищаются при переполнении, самые старые — тоже (Map хранит порядок
 * вставки).
 */
const MARKET_DEDUP_TTL_MS = 10 * 60 * 1000;
const MARKET_DEDUP_MAX_ENTRIES = 50_000;
const marketDedup = new Map();

/** Удаляет из marketDedup ключи, записанные раньше now - MARKET_DEDUP_TTL_MS. */
function pruneMarketDedup(now) {
    for (const [key, seenAt] of marketDedup) {
        if (now - seenAt >= MARKET_DEDUP_TTL_MS) marketDedup.delete(key);
    }
}

/**
 * Запоминает ключи успешно вставленного батча.
 * Если после чистки просроченных Map всё ещё не влезает в лимит, режем самые
 * старые записи: они истекут раньше всех, потерять их безопасно.
 */
function rememberMarketKeys(keys, now) {
    if (marketDedup.size + keys.length > MARKET_DEDUP_MAX_ENTRIES) {
        pruneMarketDedup(now);
    }
    while (marketDedup.size + keys.length > MARKET_DEDUP_MAX_ENTRIES) {
        const oldest = marketDedup.keys().next();
        if (oldest.done) break;
        marketDedup.delete(oldest.value);
    }
    for (const key of keys) marketDedup.set(key, now);
}

const deleteStaleMarketPricesStmt = db.query(
    'DELETE FROM market_prices WHERE created_at <= $threshold'
);
// Лимит истории на предмет: нумеруем строки каждого «переполненного»
// предмета от свежих к старым (created_at DESC, id DESC — точный порядок,
// который использует медиана) и удаляем всё, что вышло за maxRowsPerItem.
// Подзапрос с HAVING COUNT(*) идёт по индексу
// idx_market_item_created_price и не трогает предметы, у которых строк мало.
const trimMarketPerItemStmt = db.query(
    `DELETE FROM market_prices
      WHERE id IN (
          SELECT id FROM (
              SELECT id,
                     ROW_NUMBER() OVER (
                         PARTITION BY item_id
                         ORDER BY created_at DESC, id DESC
                     ) AS rn
                FROM market_prices
               WHERE item_id IN (
                     SELECT item_id
                       FROM market_prices
                      GROUP BY item_id
                     HAVING COUNT(*) > $max
               )
          ) WHERE rn > $max
      )`
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

// Вставка пачки — одной транзакцией: при сбое посередине не остаётся
// «полуснимка» витрины. Удаление старых строк здесь больше не выполняется:
// иначе каждый POST /market/scan ждал бы тяжёлый DELETE (см.
// cleanupMarketPrices, её зовёт фоновый таймер в server/index.js).
const insertMarketBatchTx = db.transaction((rows) => {
    for (const row of rows) {
        insertMarketPriceStmt.run({ $item: row.id, $price: row.price, $created: row.createdAt });
    }
});

/**
 * Обслуживание market_prices (v11.7.1.1) — вызывается таймером, а не запросом.
 *
 * 1) Удаляет наблюдения старше 72 часов (MARKET_LIMITS.retentionMs).
 * 2) Для предметов с более чем MARKET_LIMITS.maxRowsPerItem (120) строками
 *    удаляет старые излишки, оставляя 120 самых свежих (created_at DESC,
 *    id DESC). Медиана всё равно читает только 100 свежих, так что результат
 *    не меняется, а популярный предмет больше не растёт бесконечно.
 *
 * Ошибки гасим здесь: обслуживание БД не должно ронять процесс, следующий
 * тик просто попробует снова.
 *
 * @returns {number} сколько строк удалено всего
 */
export function cleanupMarketPrices() {
    const now = Date.now();
    try {
        const stale = deleteStaleMarketPricesStmt
            .run({ $threshold: now - MARKET_LIMITS.retentionMs }).changes;
        const excess = trimMarketPerItemStmt
            .run({ $max: MARKET_LIMITS.maxRowsPerItem }).changes;
        return stale + excess;
    } catch (err) {
        console.error('[legion-party] cleanupMarketPrices:', err);
        return 0;
    }
}

/**
 * Массовая запись цен аукциона: валидация + дедупликация + одна транзакция.
 *
 * Мусор внутри пачки пропускаем молча: один битый лот не должен ронять
 * отправку всей пачки (клиент присылает снимок витрины целиком). Цена —
 * целое > 0, id — непустая строка до maxIdLength символов.
 *
 * v11.7.1.1: пары (item_id, price), записанные менее 10 минут назад, повторно
 * не пишутся — разные игроки присылают одни и те же лоты, а для медианы это
 * одно и то же наблюдение. Повторы внутри самой пачки тоже отсекаются.
 *
 * @param {Array<{id: string, price: number}>} items
 * @returns {number} сколько наблюдений реально записано
 */
export function addMarketPrices(items) {
    const list = Array.isArray(items) ? items : [];
    const now = Date.now();
    const rows = [];
    const keys = [];
    const seenInBatch = new Set();

    for (const item of list) {
        if (rows.length >= MARKET_LIMITS.maxLotsPerScan) break;
        if (!item || typeof item !== 'object') continue;
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        const price = Math.trunc(Number(item.price));
        if (!id || id.length > MARKET_LIMITS.maxIdLength) continue;
        if (!Number.isFinite(price) || price <= 0 || price > MARKET_LIMITS.maxPrice) continue;

        // Ключ дедупликации: `${item_id}:${price}`. id предмета — слаг без
        // двоеточий, поэтому склейка не даёт коллизий.
        const key = `${id}:${price}`;
        if (seenInBatch.has(key)) continue;
        const seenAt = marketDedup.get(key);
        if (seenAt !== undefined && now - seenAt < MARKET_DEDUP_TTL_MS) continue;

        seenInBatch.add(key);
        keys.push(key);
        rows.push({ id, price, createdAt: now });
    }

    if (!rows.length) return 0;
    insertMarketBatchTx(rows);
    // Ключи запоминаем только после успешного коммита: если транзакция
    // упала, повторный скан должен попробовать записать те же цены снова.
    rememberMarketKeys(keys, now);
    // Реальная запись меняет медиану — кэш сбрасываем. При пустом батче
    // (return выше) и полностью дедуплицированном (rows.length === 0) кэш
    // остаётся: данных не прибавилось, ответ прежний.
    mediansCache.clear();
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
    // строки старше retentionMs могли ещё не удалиться (cleanupMarketPrices
    // идёт по таймеру раз в 15 минут), а в медиану попадать не должны.
    const threshold = Date.now() - MARKET_LIMITS.retentionMs;
    const rows = getMedianStmt(ids.length).all(...ids, threshold);
    for (const row of rows) {
        const price = Number(row.median);
        out[row.item_id] = Number.isFinite(price) && price > 0 ? price : null;
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* Кэш медиан в памяти (v11.6.5.1)                                     */
/* ------------------------------------------------------------------ */

// Витрина аукциона запрашивает медианы на каждый рендер одним и тем же
// набором id, а CTE с ROW_NUMBER по market_prices — самый тяжёлый запрос
// сервера. 60 секунд кэша снимают почти весь повторный трафик: за это время
// новая цена не успевает стать статистически значимой (окно медианы — 72 ч).
// Сама Map, TTL и лимит объявлены выше (секция MARKET_LIMITS): их использует
// addMarketPrices при сбросе кэша.
//
// Жёсткого лимита на число ключей нет намеренно — за один запрос добавляется
// не больше MARKET_LIMITS.maxIdsPerQuery (200) ключей.

/**
 * Медианы с кэшем в памяти (v11.6.5.1): та же форма ответа, что у getMedians
 * ({id: number|null}), но свежие id считаются в SQL, а повторные — из Map.
 *
 * null тоже кэшируется: «наблюдений нет» — валидный ответ, и повторять
 * тяжёлый запрос ради него бессмысленно.
 *
 * @param {string[]} itemIds
 * @returns {Record<string, number|null>}
 */
export function getCachedMedians(itemIds) {
    const now = Date.now();
    const result = {};
    const missingIds = [];

    for (const id of Array.isArray(itemIds) ? itemIds : []) {
        const cached = mediansCache.get(id);
        if (cached && cached.expiresAt > now) {
            result[id] = cached.median;
        } else {
            missingIds.push(id);
        }
    }

    if (missingIds.length > 0) {
        const fresh = getMedians(missingIds);
        for (const [id, median] of Object.entries(fresh)) {
            mediansCache.set(id, { median, expiresAt: now + MEDIAN_CACHE_TTL_MS });
            result[id] = median;
        }
    }

    // Ленивая чистка: иначе карта растёт от каждого нового предмета навсегда.
    if (mediansCache.size > MEDIAN_CACHE_MAX_ENTRIES) {
        for (const [key, record] of mediansCache) {
            if (record.expiresAt <= now) mediansCache.delete(key);
        }
    }

    return result;
}

