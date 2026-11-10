# Hexa Dashboard — MCP-сервер для Claude

Позволяет управлять дашбордом из Claude: смотреть проекты и аналитику, добавлять проекты, логировать часы, менять статусы и настройки.
Работает напрямую с Firestore (`webdev/dashboard`, через REST API), поэтому открытый в браузере дашборд обновляется сразу.

Два варианта запуска с одной и той же логикой (`src/tools.js`):
- **Облако (Cloudflare Worker, `worker.js`)** — коннектор в claude.ai, работает в браузере и в мобильном Claude.
- **Локально (stdio, `server.js`)** — для Claude Code / Claude Desktop.

## Облачный коннектор (claude.ai)

Один раз:

```bash
cd mcp
npm install
npx wrangler login                                  # вход/регистрация в Cloudflare (бесплатно)
npx wrangler deploy                                 # выдаст адрес https://hexa-dashboard-mcp.<аккаунт>.workers.dev
openssl rand -hex 24 | tee /dev/tty | npx wrangler secret put MCP_SECRET   # секрет = пароль в URL, сохрани его
```

Потом в claude.ai → Settings → Connectors → **Add custom connector**:
URL — `https://hexa-dashboard-mcp.<аккаунт>.workers.dev/mcp/<MCP_SECRET>`.
Коннектор сразу доступен и в мобильном приложении.

URL с секретом — это доступ к данным, никому его не показывай. Сменить: снова `wrangler secret put MCP_SECRET` и обновить URL коннектора.
После изменений в коде — `npx wrangler deploy`.

## Локально

**Claude Code** — в корне репо уже лежит `.mcp.json`; при запуске `claude` в этой папке сервер подхватится (подтвердить один раз).
Или глобально: `claude mcp add hexa-dashboard -s user -- node /ПОЛНЫЙ/ПУТЬ/Hexa-dashboard/mcp/server.js`

**Claude Desktop** — Settings → Developer → Edit Config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "hexa-dashboard": {
      "command": "node",
      "args": ["/ПОЛНЫЙ/ПУТЬ/Hexa-dashboard/mcp/server.js"]
    }
  }
}
```
Перезапустить Claude Desktop.

## Инструменты

| Tool | Что делает |
|---|---|
| `get_overview` | настройки, месяцы, итоги, счётчики по статусам |
| `list_projects` | список с фильтрами (клиент, статус, тип, оплата, поиск) + часы/расход/прибыль |
| `get_project` | один проект целиком (по id или домену, можно часть) |
| `add_project` | новый проект |
| `update_project` | изменить поля (статус, доход, месяцы оплаты, реферал…) |
| `log_hours` | часы за месяц (`add` / `set`) |
| `set_extra_income` | доплата за месяц |
| `delete_project` | удалить (требует `confirm: true`) |
| `add_month` | добавить месяц(ы) в конец/начало шкалы |
| `update_settings` | ставка €/ч, курс $/€, сдвиг расходов |
| `monthly_stats` | помесячные доход/расход/прибыль (как во вкладке «Помесячно») |

Записи идут с проверкой `updateTime` (оптимистичная блокировка): если документ одновременно поменяли в браузере, операция повторяется на свежих данных и ничего не затирает. Предохранитель отменяет запись, если операция убрала бы месяцы или больше одного проекта.

Для отладки локальной версии можно указать другой документ: `DASHBOARD_DOC=webdev/xxx` (но правила Firestore сейчас пускают только к `webdev/dashboard`).

## Примеры запросов
- «Сколько я заработал за лето 26?»
- «Запиши 6 часов на zumboo за Окт 26»
- «Новый проект shop.io, клиент ECOM, доход 7000+2000, статус В работе»
- «Какие проекты не оплачены полностью?»
