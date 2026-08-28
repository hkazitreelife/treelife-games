module.exports = {
  apps: [
    {
      name: "treelife-arcade",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
