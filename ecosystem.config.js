// PM2 config dla samego bota Discord
// Uruchomienie: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'kalkulator-bot',
      script: 'src/index.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
    },
  ],
};
