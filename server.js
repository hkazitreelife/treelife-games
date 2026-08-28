/*  server.js — Custom Node server: Next.js + socket.io on one HTTP server.
    Run with: node server.js   (replaces `next dev` for multiplayer support) */

const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");
const socketServer = require("./src/lib/socket-server");

const fs = require("fs");
const dev = process.env.NODE_ENV !== "production" && !fs.existsSync(require("path").join(__dirname, ".next", "BUILD_ID"));
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT, 10) || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new Server(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket", "polling"],
  });

  // Wire up room management, move validation, expiry timer
  socketServer.init(io);

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Socket.io attached`);
  });
});
