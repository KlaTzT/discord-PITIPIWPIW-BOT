module.exports = {
  apps: [
    {
      name: 'pon-attendance-bot',
      script: 'src/index.js',
      autorestart: true,
      watch: false,
      max_restarts: 10,
    },
  ],
};
