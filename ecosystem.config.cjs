// pm2 config for the agents on a VPS: one process per network, each with its own env file.
//   npm ci && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
// Needs Node >= 24 (runs the TypeScript sources directly), .env and .env.mainnet (see .env.example),
// and .keys/ copied from the owner's machine.
const agent = (name, envFile) => ({
  name,
  cwd: "./apps/agent",
  // pm2's own loader require()s the script, which can't load an ES module with top-level await,
  // so pm2 starts this node binary directly, the same as `npm run agent`.
  script: process.execPath,
  args: [`--env-file=../../${envFile}`, "src/index.ts"],
  interpreter: "none",
  autorestart: true,
  restart_delay: 10_000,
  max_memory_restart: "300M",
  time: true,
});

module.exports = {
  apps: [agent("nullpoint-agent-testnet", ".env"), agent("nullpoint-agent-mainnet", ".env.mainnet")],
};
