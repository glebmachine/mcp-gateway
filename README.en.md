# MCP Gateway

> **[Русская версия](README.md)**

**Exposes local MCP servers to WSL, Docker, and remote machines**

## The Problem

You're working on a remote server or in a container, but MCP servers for debugging (Playwright, Chrome DevTools, etc.) need to run on your development machine and only work via stdio.

## The Solution

MCP Gateway runs on your machine and transforms stdio MCP servers into HTTP/SSE endpoints accessible over the network.

All examples below use WSL and Windows (my use case). For other scenarios like Mac/Docker/RemoteHost, you'll need to solve network connectivity. The functionality will work the same way.

```
Windows: MCP Server (stdio) → MCP Gateway (HTTP/SSE) → WSL: Claude Code
```

---

## Installation on Developer Machine

```bash
git clone https://github.com/glebm/mcp-gateway.git
cd mcp-gateway
npm install
npx playwright install   # for Playwright MCP
npm run pm2:start        # start in background
```

---

## Configure Claude Code in WSL

> **Just give this README to Claude Code and say "configure MCP Gateway" — it will do everything automatically.**

<details>
<summary><b>Instructions for Claude</b> (expand)</summary>

### Automatic MCP Gateway Setup for Claude Code

Claude, run these commands in WSL to connect to MCP Gateway on Windows:

```bash
# Get Windows host IP
HOST_IP=$(ip route | grep default | awk '{print $3}')

# Add Playwright MCP
claude mcp add playwright -s user -- npx -y mcp-remote "http://${HOST_IP}:8931/sse" --allow-http

# Add Chrome DevTools MCP
claude mcp add chrome-devtools -s user -- npx -y mcp-remote "http://${HOST_IP}:8932/sse" --allow-http

# Add Mobile MCP
claude mcp add mobile -s user -- npx -y mcp-remote "http://${HOST_IP}:8933/sse" --allow-http

# Optional: install mcp-remote globally for faster connections
npm install -g mcp-remote
```

After running these commands, restart Claude Code to apply the settings.

</details>

---

## Manual Setup (if needed)

### Option 1: CLI Commands

```bash
# Get Windows host IP
ip route | grep default | awk '{print $3}'

# Add servers (replace <host-ip> with the IP you got)
claude mcp add playwright -s user -- npx -y mcp-remote "http://<host-ip>:8931/sse" --allow-http
claude mcp add chrome-devtools -s user -- npx -y mcp-remote "http://<host-ip>:8932/sse" --allow-http
claude mcp add mobile -s user -- npx -y mcp-remote "http://<host-ip>:8933/sse" --allow-http
```

### Option 2: Download config

```bash
curl http://$(ip route | grep default | awk '{print $3}'):8930/config.json > .mcp.json
```

---

## Built-in MCP Servers

| Server | Port | Capabilities |
|--------|------|--------------|
| [Playwright](https://github.com/microsoft/playwright-mcp) | 8931 | Browser automation, screenshots, testing |
| [Chrome DevTools](https://github.com/anthropics/anthropic-quickstarts/tree/main/mcp-servers/chrome-devtools) | 8932 | Debugging, DOM inspection, network requests |
| [Claude Mobile](https://github.com/AlexGladkov/claude-in-mobile) | 8933 | Android (ADB) and iOS Simulator (simctl) |

---

## Adding Custom Servers

Edit `config.json`:

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

Restart: `npm run pm2:restart`

---

## Management Commands

```bash
npm run pm2:start    # Start
npm run pm2:stop     # Stop
npm run pm2:restart  # Restart
npm run pm2:logs     # View logs
npm run pm2:status   # Check status
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                      Windows Host                           │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ Playwright  │    │   Chrome    │    │    Your     │     │
│  │    MCP      │    │  DevTools   │    │ MCP Server  │     │
│  │   (stdio)   │    │   (stdio)   │    │   (stdio)   │     │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │
│         └──────────────────┼──────────────────┘             │
│                            ▼                                │
│                   ┌─────────────────┐                       │
│                   │   MCP Gateway   │                       │
│                   │   ports 8931+   │                       │
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

## Troubleshooting

**Gateway won't start**
```bash
npm run pm2:logs     # Check logs
npm start            # Run directly for debugging
```

**WSL can't see Gateway**
```bash
# Check IP
ip route | grep default | awk '{print $3}'

# Test connection
curl http://<host-ip>:8930/
```

**Playwright not working**
```bash
npx playwright install   # Install browsers
```

**Chrome DevTools can't connect**
```
Start Chrome with: chrome.exe --remote-debugging-port=9222
```

---

## Requirements

- Windows with WSL
- Node.js >= 18
- PM2 (`npm install -g pm2`)

---

## License

MIT
