module.exports = {
  apps: [{
    name: 'mcp-gateway',
    script: 'src/gateway.js',
    cwd: __dirname,
    interpreter: 'node',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1000,
    env: {
      NODE_ENV: 'production'
    },
    // Logging
    log_file: './logs/gateway.log',
    out_file: './logs/gateway-out.log',
    error_file: './logs/gateway-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    // Startup
    wait_ready: true,
    listen_timeout: 10000
  }]
};
