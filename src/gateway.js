#!/usr/bin/env node

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'net';
import { createServer as createHttpServer } from 'http';
import { networkInterfaces } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const CONFIG_PATH = join(ROOT_DIR, 'config.json');
const PID_FILE = join(ROOT_DIR, '.gateway.pid');
const CONFIG_SERVER_PORT = 8930;

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function log(msg, color = 'reset', noTimestamp = false) {
  if (noTimestamp) {
    console.log(`${colors[color]}${msg}${colors.reset}`);
  } else {
    const timestamp = new Date().toISOString().substr(11, 8);
    console.log(`${colors.dim}[${timestamp}]${colors.reset} ${colors[color]}${msg}${colors.reset}`);
  }
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    log(`Failed to load config: ${err.message}`, 'red');
    process.exit(1);
  }
}

// Получить IP адрес хоста для WSL (ищем vEthernet WSL интерфейс или первый подходящий)
function getHostIP() {
  const nets = networkInterfaces();

  // Сначала ищем vEthernet (WSL) - это IP который видит WSL
  for (const name of Object.keys(nets)) {
    if (name.includes('WSL') || name.includes('vEthernet')) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  }

  // Fallback: ищем любой внешний IPv4
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }

  return 'localhost';
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '0.0.0.0');
  });
}

async function checkPortInUse(port) {
  return !(await isPortAvailable(port));
}

class MCPGateway {
  constructor() {
    this.processes = new Map();
    this.config = loadConfig();
    this.configServer = null;
    this.hostIP = getHostIP();
    this.toolsCache = new Map(); // Кэш tools для каждого сервера
  }

  // HTTP сервер для раздачи конфига
  startConfigServer() {
    this.configServer = createHttpServer((req, res) => {
      // CORS для любых запросов
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');

      // Определяем IP из входящего соединения — клиент сам говорит, по какому IP достучался
      const clientSeesHostAs = req.socket.localAddress?.replace(/^::ffff:/, '') || this.hostIP;

      if (req.url === '/config' || req.url === '/config.json' || req.url === '/.mcp.json') {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(this.generateMcpConfig(clientSeesHostAs), null, 2));
      } else if (req.url === '/') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.writeHead(200);
        res.end(`MCP Gateway Config Server

Endpoints:
  GET /config.json - получить конфиг для .mcp.json

Использование в WSL:
  curl http://<HOST_IP>:${CONFIG_SERVER_PORT}/config.json > .mcp.json

Определение IP хоста из WSL:
  ip route | grep default | awk '{print $3}'
`);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    this.configServer.listen(CONFIG_SERVER_PORT, '0.0.0.0', () => {
      log(`Config server: http://${this.hostIP}:${CONFIG_SERVER_PORT}/config.json`, 'green');
    });
  }

  // Прогрев сервера — подключаемся и получаем список tools
  async warmupServer(name, port) {
    const url = `http://localhost:${port}/sse`;
    const maxAttempts = 10;
    const delay = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Пробуем подключиться к SSE endpoint
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'Accept': 'text/event-stream' }
        });
        clearTimeout(timeout);

        if (response.ok) {
          log(`  ${name}: warmed up (attempt ${attempt})`, 'green');

          // Пробуем получить tools через JSON-RPC
          try {
            const toolsResponse = await fetch(`http://localhost:${port}/message`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
                params: {}
              })
            });

            if (toolsResponse.ok) {
              const toolsData = await toolsResponse.json();
              if (toolsData.result?.tools) {
                this.toolsCache.set(name, toolsData.result.tools);
                log(`  ${name}: cached ${toolsData.result.tools.length} tools`, 'dim');
              }
            }
          } catch {
            // tools/list может не поддерживаться, это нормально
          }

          return true;
        }
      } catch (err) {
        if (attempt === maxAttempts) {
          log(`  ${name}: warmup failed after ${maxAttempts} attempts`, 'yellow');
          return false;
        }
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return false;
  }

  async startServer(serverConfig) {
    const { name, command, args, port, enabled, description } = serverConfig;

    if (!enabled) {
      log(`Skipping ${name} (disabled)`, 'yellow');
      return null;
    }

    // Check if port is already in use
    if (await checkPortInUse(port)) {
      log(`Port ${port} already in use for ${name}`, 'yellow');
      return null;
    }

    log(`Starting ${name} on port ${port}...`, 'blue');
    log(`  ${description}`, 'dim');

    // Use supergateway to wrap stdio MCP server as HTTP/SSE
    // Формируем полную команду как строку для shell
    const stdioCommand = `${command} ${args.join(' ')}`;

    // Собираем полную команду для запуска через shell
    const fullCommand = `npx -y supergateway --stdio "${stdioCommand}" --port ${port} --host 0.0.0.0`;

    const proc = spawn(fullCommand, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true
    });

    proc.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          log(`[${name}] ${line}`, 'dim');
        }
      });
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => {
        if (line.trim() && !line.includes('ExperimentalWarning')) {
          log(`[${name}] ${line}`, 'yellow');
        }
      });
    });

    proc.on('exit', (code) => {
      log(`${name} exited with code ${code}`, code === 0 ? 'dim' : 'red');
      this.processes.delete(name);
    });

    proc.on('error', (err) => {
      log(`${name} error: ${err.message}`, 'red');
    });

    this.processes.set(name, { proc, port, config: serverConfig });

    // Wait a bit for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (await checkPortInUse(port)) {
      log(`${name} started successfully on http://localhost:${port}`, 'green');
      return { name, port, status: 'running' };
    } else {
      log(`${name} failed to start`, 'red');
      return { name, port, status: 'failed' };
    }
  }

  async startAll() {
    log('MCP Gateway starting...', 'cyan');
    log(`Config: ${CONFIG_PATH}`, 'dim');
    log(`Host IP: ${this.hostIP}`, 'dim');

    // Start config server
    this.startConfigServer();

    const results = [];
    const enabledServers = this.config.servers.filter(s => s.enabled);

    for (const server of enabledServers) {
      const result = await this.startServer(server);
      if (result) results.push(result);
    }

    // Прогрев серверов — параллельно подключаемся ко всем
    if (results.length > 0) {
      log('', 'reset');
      log('Прогрев серверов...', 'cyan');
      await Promise.all(
        results.map(r => this.warmupServer(r.name, r.port))
      );
    }

    // Save PID info
    const pidInfo = {
      pid: process.pid,
      started: new Date().toISOString(),
      servers: results
    };
    writeFileSync(PID_FILE, JSON.stringify(pidInfo, null, 2));

    log('', 'reset');
    log('='.repeat(60), 'cyan');
    log('MCP Gateway запущен!', 'green');
    log('='.repeat(60), 'cyan');
    log('', 'reset');
    log('Активные серверы:', 'cyan');
    results.forEach(r => {
      log(`  - ${r.name}: port ${r.port}`, 'green');
    });
    log('', 'reset');
    log('='.repeat(60), 'cyan');
    log('Подключение из WSL/Linux:', 'cyan');
    log('='.repeat(60), 'cyan');
    log('', 'reset');
    log('Вариант 1: Команды для Claude Code CLI', 'yellow');
    log('', 'reset');
    enabledServers.forEach(server => {
      log(`  claude mcp add ${server.name} -s user -- npx -y mcp-remote "http://${this.hostIP}:${server.port}/sse" --allow-http`, 'reset', true);
    });
    log('', 'reset');
    log('Вариант 2: Скачать .mcp.json', 'yellow');
    log('', 'reset');
    log(`  curl http://${this.hostIP}:${CONFIG_SERVER_PORT}/config.json > .mcp.json`, 'reset', true);
    log('', 'reset');
    log('После настройки перезапустите Claude Code', 'dim');
    log('', 'reset');
    log('='.repeat(60), 'cyan');
    log('Нажмите Ctrl+C для остановки', 'dim');
    log('='.repeat(60), 'cyan');

    // Handle shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  generateMcpConfig(hostIP = this.hostIP) {
    const enabledServers = this.config.servers.filter(s => s.enabled);

    const mcpConfig = {
      mcpServers: {}
    };

    enabledServers.forEach(server => {
      mcpConfig.mcpServers[server.name] = {
        command: 'npx',
        args: ['-y', 'mcp-remote', `http://${hostIP}:${server.port}/sse`, '--allow-http']
      };
    });

    return mcpConfig;
  }

  async status() {
    if (!existsSync(PID_FILE)) {
      log('MCP Gateway is not running', 'yellow');
      return;
    }

    try {
      const pidInfo = JSON.parse(readFileSync(PID_FILE, 'utf-8'));
      log(`MCP Gateway status (started: ${pidInfo.started})`, 'cyan');

      for (const server of pidInfo.servers) {
        const inUse = await checkPortInUse(server.port);
        const status = inUse ? 'running' : 'stopped';
        const color = inUse ? 'green' : 'red';
        log(`  - ${server.name}: ${status} (port ${server.port})`, color);
      }
    } catch (err) {
      log(`Error reading status: ${err.message}`, 'red');
    }
  }

  shutdown() {
    log('', 'reset');
    log('Shutting down MCP Gateway...', 'yellow');

    // Stop config server
    if (this.configServer) {
      this.configServer.close();
    }

    this.processes.forEach((info, name) => {
      log(`Stopping ${name}...`, 'dim');
      try {
        info.proc.kill('SIGTERM');
      } catch (err) {
        // Process might already be dead
      }
    });

    // Clean up PID file
    try {
      if (existsSync(PID_FILE)) {
        unlinkSync(PID_FILE);
      }
    } catch (err) {
      // Ignore
    }

    log('MCP Gateway stopped', 'green');
    process.exit(0);
  }
}

// CLI handling
const args = process.argv.slice(2);

const gateway = new MCPGateway();

if (args.includes('--status')) {
  gateway.status();
} else if (args.includes('--stop')) {
  // Try to kill existing process
  if (existsSync(PID_FILE)) {
    const pidInfo = JSON.parse(readFileSync(PID_FILE, 'utf-8'));
    try {
      process.kill(pidInfo.pid, 'SIGTERM');
      log('Sent stop signal to gateway', 'green');
    } catch (err) {
      log('Gateway process not found, cleaning up...', 'yellow');
    }
    writeFileSync(PID_FILE, '');
  } else {
    log('Gateway is not running', 'yellow');
  }
} else {
  gateway.startAll();
}
