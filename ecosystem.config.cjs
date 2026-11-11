// pm2 config for the keeper on a VPS.
//   npm ci && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
// Needs Node >= 24 (runs the TypeScript sources directly) and a filled .env (see .env.example).
module.exports = {
  apps: [
    {
      name: "nullpoint-keeper",
      cwd: "./apps/keeper",
      script: "src/index.ts",
      node_args: "--env-file=../../.env",
      autorestart: true,
      restart_delay: 10_000,
      max_memory_restart: "300M",
      time: true,
    },
  ],
};
