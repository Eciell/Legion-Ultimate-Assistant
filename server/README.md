# Legion Party Server (шаг 1 / v11.6.0a)

Сервер «Пати» для аддона Legion Ultimate Assistant. Runtime — [Bun](https://bun.sh) (нужен `Bun.serve` и `bun:sqlite`).

## Запуск локально

```bash
cd server
bun install          # зависимостей нет, но команда безопасна
bun run dev          # PORT=8787 по умолчанию, bun --watch
```

## Переменные окружения

- `CTRLFREE_PORT` — порт, который выдаёт платформа хостинга (`legion.ctrlfree.host`); **приоритетнее** `PORT`.
- `PORT` — порт HTTP-сервера при локальном запуске (по умолчанию `8787`).
- `DB_PATH` — путь к файлу SQLite (по умолчанию `server/data.sqlite`, режим WAL).

Сервер всегда слушает `0.0.0.0` (v11.6.0e): иначе платформа и клиенты аддона
не видят его снаружи. Прод-адрес клиента — `https://legion.ctrlfree.host`
(`Party.DEFAULT_BASE_URL`), локальный остаётся `http://localhost:8787`.

## Примеры (curl)

```bash
# создать пати: в ответе groupId, inviteToken, sessionId (login не возвращается)
curl -s -X POST localhost:8787/party -H 'Content-Type: application/json' -d '{"login":"test"}'

# войти в пати по inviteToken (groupId не нужен)
curl -s -X POST localhost:8787/party/join -H 'Content-Type: application/json' \
  -d '{"inviteToken":"<inviteToken>","login":"friend"}'

# список участников (Bearer — sessionId своего клиента)
curl -s localhost:8787/party/<groupId>/members -H 'Authorization: Bearer <sessionId>'

# кик по публичному memberId (только владелец)
curl -s -X POST localhost:8787/party/<groupId>/kick \
  -H 'Authorization: Bearer <ownerSessionId>' -H 'Content-Type: application/json' \
  -d '{"memberId":"<memberId>"}'

# выход: участник удаляет свою сессию (deleted: self),
# владелец — всю пати каскадом (deleted: party)
curl -s -X DELETE localhost:8787/party/<groupId>/leave -H 'Authorization: Bearer <sessionId>'
```

## Эндпоинты

`POST /party`, `POST /party/join`, `POST /party/:id/rotate`, `POST /party/:id/kick`,
`GET /party/:id/members`, `DELETE /party/:id/leave`.

- `POST /party/:id/join` **удалён** в v11.6.0a — вход только по `inviteToken`.
- `GET /party/:id/members` отдаёт `{login, joinedAt, memberId, role, self}`;
  `sessionId` не возвращается никому (это bearer-креденшл).
- Логины хранятся в нижнем регистре (`/^[a-z0-9_]{1,32}$/`).

Синхронизация состояния, журнал и хил — шаг 2, их здесь нет.
