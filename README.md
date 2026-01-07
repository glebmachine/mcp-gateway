# MCP Gateway

> **[English version](README.en.md)**

**Открывает локальные MCP-серверы для WSL, Docker и удалённых машин**

## Проблема

Работаешь на удаленном сервере или в контейнере, а MCP для отладки (Playwright, Chrome DevTools и другие) нужны на машине разработчика, и могут работать только через stdio.

## Решение

MCP Gateway запускается на твоей машине и превращают stdio MCP-серверы в HTTP/SSE эндпоинты, доступные по сети.

Ниже все примеры с WSL и Windows (так, как это мой кейс), для других кейсов, с Mac/Docker/RemoteHost нужно будет решить задачу сетевой связанности. При этом весь функционал будет работать схожим образом

```
Windows: MCP Server (stdio) → MCP Gateway (HTTP/SSE) → WSL: Claude Code
```

---

## Установка на машине разработчика

### Быстрый запуск (npx)

```bash
npx mcp-gateway
```

### Или установка глобально

```bash
npm install -g mcp-gateway
npx playwright install   # для Playwright MCP
mcp-gateway              # запуск
```

### Или из исходников (для разработки)

```bash
git clone https://github.com/glebmachine/mcp-gateway.git
cd mcp-gateway
npm install
npx playwright install   # для Playwright MCP
npm run pm2:start        # запуск в фоне
```

---

## Настройка Claude Code в WSL

> **Просто дай этот README Claude Code и скажи "настрой MCP Gateway" — он сам всё сделает.**

<details>
<summary><b>Инструкции для Claude</b> (развернуть)</summary>

### Автоматическая настройка MCP Gateway для Claude Code

Claude, выполни эти команды в WSL для подключения к MCP Gateway на Windows:

```bash
# Определить IP хоста Windows
HOST_IP=$(ip route | grep default | awk '{print $3}')

# Добавить Playwright MCP
claude mcp add playwright -s user -- npx -y mcp-remote "http://${HOST_IP}:8931/sse" --allow-http

# Добавить Chrome DevTools MCP
claude mcp add chrome-devtools -s user -- npx -y mcp-remote "http://${HOST_IP}:8932/sse" --allow-http

# Добавить Mobile MCP
claude mcp add mobile -s user -- npx -y mcp-remote "http://${HOST_IP}:8933/sse" --allow-http

# Опционально: установить mcp-remote глобально для быстрого подключения
npm install -g mcp-remote
```

После выполнения команд перезапусти Claude Code для применения настроек.

</details>

---

## Ручная настройка (если нужно)

### Вариант 1: Команды CLI

```bash
# Узнать IP Windows-хоста
ip route | grep default | awk '{print $3}'

# Добавить серверы (замени <host-ip> на полученный IP)
claude mcp add playwright -s user -- npx -y mcp-remote "http://<host-ip>:8931/sse" --allow-http
claude mcp add chrome-devtools -s user -- npx -y mcp-remote "http://<host-ip>:8932/sse" --allow-http
claude mcp add mobile -s user -- npx -y mcp-remote "http://<host-ip>:8933/sse" --allow-http
```

### Вариант 2: Скачать конфиг

```bash
curl http://$(ip route | grep default | awk '{print $3}'):8930/config.json > .mcp.json
```

---

## Встроенные MCP-серверы

| Сервер | Порт | Возможности |
|--------|------|-------------|
| [Playwright](https://github.com/microsoft/playwright-mcp) | 8931 | Автоматизация браузера, скриншоты, тестирование |
| [Chrome DevTools](https://github.com/anthropics/anthropic-quickstarts/tree/main/mcp-servers/chrome-devtools) | 8932 | Отладка, инспекция DOM, сетевые запросы |
| [Claude Mobile](https://github.com/AlexGladkov/claude-in-mobile) | 8933 | Android (ADB) и iOS Simulator (simctl) |

---

## Добавление своих серверов

Редактируй `config.json`:

```json
{
  "servers": [
    {
      "name": "my-server",
      "command": "node",
      "args": ["path/to/server.js"],
      "port": 8933,
      "enabled": true
    }
  ]
}
```

Перезапусти: `npm run pm2:restart`

---

## Команды управления

```bash
npm run pm2:start    # Запустить
npm run pm2:stop     # Остановить
npm run pm2:restart  # Перезапустить
npm run pm2:logs     # Логи
npm run pm2:status   # Статус
```

---

## Как это работает

```
┌─────────────────────────────────────────────────────────────┐
│                      Windows Host                           │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ Playwright  │    │   Chrome    │    │    Твой     │     │
│  │    MCP      │    │  DevTools   │    │ MCP Server  │     │
│  │   (stdio)   │    │   (stdio)   │    │   (stdio)   │     │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │
│         └──────────────────┼──────────────────┘             │
│                            ▼                                │
│                   ┌─────────────────┐                       │
│                   │   MCP Gateway   │                       │
│                   │   порты 8931+   │                       │
│                   └────────┬────────┘                       │
│                            │                                │
│                   ┌────────┴────────┐                       │
│                   │  Config: 8930   │                       │
│                   └────────┬────────┘                       │
└────────────────────────────┼────────────────────────────────┘
                             │ HTTP/SSE
┌────────────────────────────┼────────────────────────────────┐
│                      WSL Environment                        │
│                            ▼                                │
│                   ┌─────────────────┐                       │
│                   │   Claude Code   │                       │
│                   │   + mcp-remote  │                       │
│                   └─────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Решение проблем

**Gateway не запускается**
```bash
npm run pm2:logs     # Смотри логи
npm start            # Запусти напрямую для отладки
```

**WSL не видит Gateway**
```bash
# Проверь IP
ip route | grep default | awk '{print $3}'

# Проверь соединение
curl http://<host-ip>:8930/
```

**Playwright не работает**
```bash
npx playwright install   # Установи браузеры
```

**Chrome DevTools не подключается**
```
Запусти Chrome с флагом: chrome.exe --remote-debugging-port=9222
```

---

## Требования

- Windows с WSL
- Node.js >= 18
- PM2 (`npm install -g pm2`)

---

## Лицензия

MIT
