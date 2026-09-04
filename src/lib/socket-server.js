/*  lib/socket-server.js
    Shared singleton: io instance, in-memory rooms Map, event handlers, expiry timer.
    Imported by server.js (to attach io) and by API routes (to access rooms).           */

const { Chess } = require("chess.js");
const soccerEngine = require("./pixel-soccer-engine");
const { decode } = require("next-auth/jwt");

/* ── room code generator ─────────────────────────────────────── */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function generateCode(len = 6) {
  let code = "";
  for (let i = 0; i < len; i++)
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}

/* ── singleton state ─────────────────────────────────────────── */
if (!globalThis.__treelifeIo) globalThis.__treelifeIo = null;
let _io = globalThis.__treelifeIo;
// Use globalThis so the Map is shared across the main process AND
// Next.js API-route worker threads (they each get their own module copy).
if (!globalThis.__treelifeRooms) globalThis.__treelifeRooms = new Map();
const rooms = globalThis.__treelifeRooms; // code → RoomState

/* ── RoomState factory ───────────────────────────────────────── */
function makeRoom(gameType) {
  const now = Date.now();
  if (gameType === "chess") {
    const chess = new Chess();
    return {
      gameType,
      players: [],
      boardState: chess.fen(),
      turn: "w",
      moveHistory: [],
      createdAt: now,
      lastActivity: now,
    };
  }
  if (gameType === "pixel-soccer") {
    return {
      gameType,
      players: [],
      soccerState: soccerEngine.createRoom(),
      createdAt: now,
      lastActivity: now,
    };
  }
  // tictactoe
  return {
    gameType,
    players: [],
    boardState: JSON.stringify([null, null, null, null, null, null, null, null, null]),
    turn: "X",
    moveHistory: [],
    createdAt: now,
    lastActivity: now,
  };
}

/* ── Move validators ─────────────────────────────────────────── */
function validateChessMove(boardState, move) {
  try {
    const chess = new Chess(boardState);
    const result = chess.move(move);
    if (!result) return { ok: false, reason: "Illegal move" };
    return {
      ok: true,
      newFen: chess.fen(),
      san: result.san,
      turn: chess.turn(),
      isGameOver: chess.isGameOver(),
      isCheckmate: chess.isCheckmate(),
      isStalemate: chess.isStalemate(),
      isDraw: chess.isDraw(),
      isThreefoldRepetition: chess.isThreefoldRepetition(),
      isInsufficientMaterial: chess.isInsufficientMaterial(),
      winner: chess.isCheckmate()
        ? chess.turn() === "w"
          ? "b"
          : "w"
        : null,
    };
  } catch {
    return { ok: false, reason: "Illegal move" };
  }
}

function validateTttMove(boardState, move, player) {
  // move = { cellIndex: number }
  const board = JSON.parse(boardState);
  const idx = move.cellIndex;
  if (typeof idx !== "number" || idx < 0 || idx > 8)
    return { ok: false, reason: "Invalid cell" };
  if (board[idx] !== null) return { ok: false, reason: "Cell occupied" };

  // Apply move with sliding rule
  const newBoard = board.slice();
  newBoard[idx] = player;
  // Track marks per player — derive from moveHistory
  return { ok: true, newBoard: newBoard, cellIndex: idx, player };
}

/*  Full TTT state validation — called with full room state so we
    can enforce the sliding-mark rule and detect wins.            */
function applyTttMove(room, player, cellIndex) {
  const board = JSON.parse(room.boardState);
  if (board[cellIndex] !== null)
    return { ok: false, reason: "Cell occupied" };
  if (room.turn !== player)
    return { ok: false, reason: "Not your turn" };

  // Derive marks arrays from move history
  const marks = { X: [], O: [] };
  for (const mh of room.moveHistory) {
    marks[mh.player].push(mh.cellIndex);
  }

  const newBoard = board.slice();
  newBoard[cellIndex] = player;

  // Sliding rule: if player already has 3 marks, remove oldest
  const playerMarks = marks[player];
  let removedCell = -1;
  if (playerMarks.length >= 3) {
    removedCell = playerMarks[0]; // oldest
    newBoard[removedCell] = null;
  }
  playerMarks.push(cellIndex);
  if (playerMarks.length > 3) playerMarks.shift();

  // Win check
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  let winner = null;
  let winLine = null;
  for (const line of LINES) {
    if (
      newBoard[line[0]] === player &&
      newBoard[line[1]] === player &&
      newBoard[line[2]] === player
    ) {
      winner = player;
      winLine = line;
      break;
    }
  }

  // Draw check: all cells filled (after sliding)
  const cellsFilled = newBoard.filter((c) => c !== null).length;
  const isDraw = !winner && cellsFilled === 9;

  const nextTurn = player === "X" ? "O" : "X";

  return {
    ok: true,
    newBoardState: JSON.stringify(newBoard),
    removedCell,
    cellIndex,
    player,
    nextTurn,
    winner,
    winLine,
    isDraw,
    isGameOver: !!winner || isDraw,
  };
}

/* ── Socket event wiring ─────────────────────────────────────── */
function wireEvents(io) {
  // Middleware: authenticate socket via HTTP-only NextAuth session cookie
  io.use(async (socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) {
      // Allow anonymous connections for backward compatibility
      socket.user = null;
      return next();
    }

    // Parse the authjs.session-token cookie
    const match = cookieHeader.match(/(?:^|;\s*)authjs\.session-token=([^;]*)/);
    if (!match) {
      socket.user = null;
      return next();
    }

    try {
      const payload = await decode({
        token: match[1],
        secret: process.env.NEXTAUTH_SECRET,
      });

      if (payload && payload.sub) {
        // Verify user exists in our database
        const { getPool } = require("./db");
        const pool = getPool();
        const { rows } = await pool.query(
          "SELECT id, name, email, image FROM treelife_users WHERE id = $1",
          [payload.sub]
        );
        socket.user = rows.length > 0 ? rows[0] : null;
      } else {
        socket.user = null;
      }
    } catch (err) {
      console.error("[socket] auth error:", err.message);
      socket.user = null;
    }
    next();
  });

  io.on("connection", (socket) => {
    console.log(`[socket] connected: ${socket.id}${socket.user ? " (auth: " + socket.user.name + ")" : " (anon)"}`);

    /* ── join-room ── */
    socket.on("join-room", ({ code, playerName }) => {
      if (!code || !playerName) return;
      const room = rooms.get(code);
      if (!room) {
        socket.emit("room-error", { reason: "Room not found or full." });
        return;
      }

      // Check if this is a reconnection (name matches existing player)
      const existingIdx = room.players.findIndex(
        (p) => p.name === playerName
      );
      if (existingIdx !== -1) {
        // Reconnect: reassign socket id
        room.players[existingIdx].id = socket.id;
        socket.join(code);
        socket.emit("room-joined", {
          players: room.players.map((p) => ({
            name: p.name,
            color: p.color,
          })),
          boardState: room.boardState,
          turn: room.turn,
          yourColor: room.players[existingIdx].color,
          moveHistory: room.moveHistory,
        });
        // Notify opponent
        const other = room.players.find((p) => p.id !== socket.id);
        if (other) io.to(other.id).emit("opponent-reconnected");
        // Clear disconnect timeout if it was running
        if (room._disconnectTimeout) {
          clearTimeout(room._disconnectTimeout);
          room._disconnectTimeout = null;
        }
        room.lastActivity = Date.now();
        return;
      }

      // New player: check slot
      if (room.players.length >= 2) {
        socket.emit("room-error", { reason: "Room not found or full." });
        return;
      }

      /* ── pixel-soccer: assign team + wire engine ── */
      if (room.gameType === "pixel-soccer") {
        const team = room.players.length;  // 0=red/P1, 1=blue/P2
        room.players.push({ id: socket.id, name: playerName, color: team === 0 ? "red" : "blue" });
        socket.join(code);
        room.lastActivity = Date.now();

        // Wire socket ID into the engine state
        if (team === 0) room.soccerState._p1Socket = socket.id;
        else            room.soccerState._p2Socket = socket.id;

        socket.emit("room-joined", {
          players: room.players.map((p) => ({ name: p.name, color: p.color })),
          team: team,
          yourColor: team === 0 ? "red" : "blue",
        });

        // Both players in → start the server tick loop
        if (room.players.length === 2) {
          startSoccerTick(code, room, io);
          for (const p of room.players) {
            io.to(p.id).emit("game-ready", {
              players: room.players.map((pp) => ({ name: pp.name, color: pp.color })),
            });
          }
        }
        return;  // skip chess/ttt emit below
      }

      const color =
        room.gameType === "chess"
          ? room.players.length === 0
            ? "w"
            : "b"
          : room.players.length === 0
            ? "X"
            : "O";

      room.players.push({ id: socket.id, name: playerName, color });
      socket.join(code);
      room.lastActivity = Date.now();

      socket.emit("room-joined", {
        players: room.players.map((p) => ({ name: p.name, color: p.color })),
        boardState: room.boardState,
        turn: room.turn,
        yourColor: color,
        moveHistory: room.moveHistory,
      });

      // If both players are now connected, notify both that game is ready
      if (room.players.length === 2) {
        for (const p of room.players) {
          io.to(p.id).emit("game-ready", {
            players: room.players.map((pp) => ({
              name: pp.name,
              color: pp.color,
            })),
          });
        }
      }
    });

    /* ── make-move (chess) ── */
    socket.on("make-move", ({ code, move }) => {
      const room = rooms.get(code);
      if (!room) return;
      room.lastActivity = Date.now();

      const player = room.players.find((p) => p.id === socket.id);
      if (!player) return;

      if (room.gameType === "chess") {
        // Verify it's this player's turn
        const currentTurn =
          room.turn === "w"
            ? room.players.find((p) => p.color === "w")
            : room.players.find((p) => p.color === "b");
        if (!currentTurn || currentTurn.id !== socket.id) {
          socket.emit("move-rejected", { reason: "Not your turn" });
          return;
        }

        const result = validateChessMove(room.boardState, move);
        if (!result.ok) {
          socket.emit("move-rejected", { reason: result.reason });
          return;
        }

        room.boardState = result.newFen;
        room.turn = result.turn;
        room.moveHistory.push({
          san: result.san,
          player: player.color,
        });

        io.to(code).emit("move_confirmed", {
          move: { san: result.san, ...move },
          boardState: result.newFen,
          turn: result.turn,
          moveIndex: room.moveHistory.length - 1,
          playerName: player.name,
        });

        if (result.isGameOver) {
          let winnerName = null;
          let reason = "Draw";
          if (result.isCheckmate) {
            winnerName = room.players.find(
              (p) => p.color === result.winner
            )?.name;
            reason = "Checkmate";
          } else if (result.isStalemate) {
            reason = "Stalemate";
          } else if (result.isThreefoldRepetition) {
            reason = "Threefold repetition";
          } else if (result.isInsufficientMaterial) {
            reason = "Insufficient material";
          } else if (result.isDraw) {
            reason = "Draw";
          }
          io.to(code).emit("game-over", {
            winner: winnerName,
            reason,
            gameOver: true,
          });
        }
      } else if (room.gameType === "tictactoe") {
        // move = { cellIndex }
        if (room.turn !== player.color) {
          socket.emit("move-rejected", { reason: "Not your turn" });
          return;
        }

        const result = applyTttMove(room, player.color, move.cellIndex);
        if (!result.ok) {
          socket.emit("move-rejected", { reason: result.reason });
          return;
        }

        room.boardState = result.newBoardState;
        room.turn = result.nextTurn;
        room.moveHistory.push({
          cellIndex: result.cellIndex,
          player: result.player,
          removedCell: result.removedCell,
        });

        io.to(code).emit("move_confirmed", {
          move: {
            cellIndex: result.cellIndex,
            player: result.player,
            removedCell: result.removedCell,
          },
          boardState: result.newBoardState,
          turn: result.nextTurn,
          moveIndex: room.moveHistory.length - 1,
          playerName: player.name,
        });

        if (result.isGameOver) {
          let winnerName = null;
          if (result.winner) {
            winnerName = room.players.find(
              (p) => p.color === result.winner
            )?.name;
          }
          io.to(code).emit("game-over", {
            winner: winnerName,
            reason: result.winner
              ? `${result.winner} connects three!`
              : "Draw",
            gameOver: true,
          });
        }
      }
    });


    /* ── pixel-soccer: player input ── */
    socket.on("player-input", ({ code, dx, dy, kick }) => {
      const room = rooms.get(code);
      if (!room || room.gameType !== "pixel-soccer") return;
      room.lastActivity = Date.now();
      soccerEngine.applyInput(room.soccerState, socket.id, { dx: dx || 0, dy: dy || 0, kick: !!kick });
    });

    /* ── pixel-soccer: start/restart game ── */
    socket.on("soccer-start", ({ code }) => {
      const room = rooms.get(code);
      if (!room || room.gameType !== "pixel-soccer") return;
      if (room.players.length < 2) return;
      // Reset the engine state
      room.soccerState = soccerEngine.createRoom();
      if (room.players[0]) room.soccerState._p1Socket = room.players[0].id;
      if (room.players[1]) room.soccerState._p2Socket = room.players[1].id;
      io.to(code).emit("game-restart", { snapshot: soccerEngine.getSnapshot(room.soccerState) });
    });

    /* ── resign ── */
    socket.on("resign", ({ code }) => {
      const room = rooms.get(code);
      if (!room) return;
      const player = room.players.find((p) => p.id === socket.id);
      if (!player) return;
      const opponent = room.players.find((p) => p.id !== socket.id);
      io.to(code).emit("game-over", {
        winner: opponent?.name || null,
        reason: `${player.name} resigned`,
        gameOver: true,
      });
      rooms.delete(code);
    });

    /* ── disconnect ── */
    socket.on("disconnect", () => {
      for (const [code, room] of rooms) {
        const idx = room.players.findIndex((p) => p.id === socket.id);
        if (idx !== -1) {
          const other = room.players.find((p) => p.id !== socket.id);
          if (other) {
            io.to(other.id).emit("opponent-disconnected");
            // Start 60s reconnect timeout
            room._disconnectTimeout = setTimeout(() => {
              io.to(other.id).emit("match-abandoned", {
                reason: "Opponent disconnected for too long",
              });
              // Stop soccer tick if running
              if (room.soccerState && room.soccerState._tickInterval) {
                clearInterval(room.soccerState._tickInterval);
                room.soccerState._tickInterval = null;
              }
              rooms.delete(code);
            }, 60_000);
          }
          break;
        }
      }
    });
  });
}


/* ── Pixel Soccer server tick loop (60 fps) ─────────────────── */
function startSoccerTick(code, room, io) {
  // Stop any existing tick
  if (room.soccerState._tickInterval) clearInterval(room.soccerState._tickInterval);
  const TICK_DT = 1 / 20;
  room.soccerState._tickInterval = setInterval(() => {
    const events = soccerEngine.tick(room.soccerState, TICK_DT);
    // Broadcast snapshot to all players in the room
    io.to(code).emit("soccer-state", soccerEngine.getSnapshot(room.soccerState));
    // Handle events
    for (const ev of events) {
      if (ev.type === "goal") {
        io.to(code).emit("soccer-goal", { scorer: ev.scorer, score: ev.score });
      } else if (ev.type === "fulltime") {
        io.to(code).emit("soccer-fulltime", { score: room.soccerState.score });
        // Stop the tick loop
        clearInterval(room.soccerState._tickInterval);
        room.soccerState._tickInterval = null;
      }
    }
  }, 50);
  console.log("[soccer] tick loop started for room " + code);
}

/* ── Room expiry timer ───────────────────────────────────────── */
function startExpiryTimer() {
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (now - room.lastActivity > 15 * 60 * 1000) {
        console.log(`[rooms] expiring room ${code}`);
        for (const p of room.players) {
          _io?.to(p.id).emit("room-expired");
        }
        // Stop soccer tick if running
        if (room.soccerState && room.soccerState._tickInterval) {
          clearInterval(room.soccerState._tickInterval);
          room.soccerState._tickInterval = null;
        }
        rooms.delete(code);
      }
    }
  }, 60_000);
}

/* ── Initialization (called by server.js) ────────────────────── */
function init(io) {
  _io = io;
  globalThis.__treelifeIo = io;
  wireEvents(io);
  startExpiryTimer();
}

module.exports = {
  init,
  rooms,
  generateCode,
  makeRoom,
  applyTttMove,
  validateChessMove,
  soccerEngine,
};
