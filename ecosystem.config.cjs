// Configuração do PM2 para o Contribua.
// Uso: pm2 startOrReload ecosystem.config.cjs --env production
module.exports = {
  apps: [
    {
      name: "contribua",
      script: "src/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production"
      },
      time: true
    }
  ]
};
