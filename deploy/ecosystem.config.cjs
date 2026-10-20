// ChimpHouse's room server under pm2 (docs/deploy.md, option 1): use this OR the systemd unit.
//   npm install -g pm2
//   pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup   (pm2 startup prints one command to run)
//   pm2 logs chimphouse-room
//
// Fork mode and ONE instance: the house keeps the lift and the shared screens in that
// process's memory, so a second instance (or pm2's cluster mode) would be a second, separate
// house with visitors split between them.
module.exports = {
  apps: [
    {
      name: "chimphouse-room",
      script: "server/dist/server/main.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      // pm2's stop is a SIGTERM; the server needs a few seconds to say goodbye, then pm2 kills it
      kill_timeout: 15000,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
        // the website's address, no slash at the end; several: separate with commas
        CHIMPHOUSE_ROOM_ORIGINS: "https://house.example.com",
        CHIMPHOUSE_ROOM_HOST: "127.0.0.1",
        CHIMPHOUSE_ROOM_PORT: "2567",
      },
    },
  ],
};
