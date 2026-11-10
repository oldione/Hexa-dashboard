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

**После обновления инструментов переподключи коннектор** (Settings → Connectors → коннектор → Disconnect / Connect, либо выключи и включи его в чате). claude.ai запоминает список и параметры инструментов в момент подключения и не видит новые, пока коннектор не переподключён.

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

## Инструменты (схема v2)

| Tool | Что делает |
|---|---|
| `get_overview` | настройки, курсы месяцев, справочники, итоги (выставлено / получено / долг / часы / расход / прибыль) |
| `list_projects` | проекты с фильтрами (заказчик, тип, статус, оплата, происхождение, `hasDebt`, период) |
| `get_project` | карточка: деньги, build/support, dev/cost, часы по месяцам с описаниями, счета, поступления |
| `add_project` / `update_project` | проект без денег (обязательны site, client); заказчик и тип — из справочника, новое значение только с `createClient` / `createType` |
| `delete_project` | удалить вместе с часами/счетами/поступлениями (`confirm: true`) |
| `log_hours` | запись часов: `kind` dev/cost, `rate`, `note`, `phase`; `mode=set` заменяет все записи месяца |
| `update_hours` / `delete_hours` | поправить / удалить одну запись по id (фаза вручную, описание, ставка) |
| `add_invoice` / `update_invoice` / `delete_invoice` | выставить / изменить / отменить / удалить счёт (USD или EUR; EUR → USD по курсу месяца выставления) |
| `add_payment` / `delete_payment` | поступление в USDT, привязка к счёту, автозакрытие счёта |
| `set_extra_income` | доплата за месяц (оплаченный счёт + поступление) |
| `list_invoices` | счета с фильтрами по статусу, заказчику, проекту, периоду |
| `client_summary` | сводка по заказчикам; чужие проекты отдельно |
| `receivables` | кто и сколько должен, возраст долга (`client`, `minAge`) |
| `monthly_stats` | по месяцам: курс, выставлено, получено, расход build/support, прибыль |
| `data_issues` | список проблем: `code`, проект, пояснение, сумма/часы (`code` — фильтр) |
| `set_month_rate` | фактический курс $/€ месяца |
| `add_month` / `update_settings` | шкала месяцев; ставки `rate` / `costRate`, общий курс, задержка |

Расчёты — в общем `../core.js`, тот же файл использует дашборд.

## Примеры запросов
- «Сколько должен Banking?»
- «Запиши 4 часа на gearmikey за Ноя 26 — обновление плагинов»
- «Запиши 51 час себестоимости на key-hub за Окт 26: фронт и дизайн»
- «Выставь счёт key-hub на 160€ за поддержку»
- «Пришли 2101 по key-hub»
- «Что не так с данными?»
