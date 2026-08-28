"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/* ── Constants ──────────────────────────────────────────────── */
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const TURN_MS = 10000;
const BOT_DELAY_MS = 500;
const SEARCH_DEPTH = 6;
const WIN_SCORE = 10000;

/* ── Bot AI (ported from existing vanilla JS) ───────────────── */
function other(p) { return p === "X" ? "O" : "X"; }

function emptyCells(g) {
  const out = [];
  for (let i = 0; i < 9; i++) if (!g[i]) out.push(i);
  return out;
}

function winnerOf(g) {
  for (const l of LINES) {
    const v = g[l[0]];
    if (v && g[l[1]] === v && g[l[2]] === v) return v;
  }
  return null;
}

function heuristic(g, marks) {
  let s = 0;
  for (const l of LINES) {
    let a = 0, b = 0;
    for (let j = 0; j < 3; j++) {
      if (g[l[j]] === "O") a++;
      else if (g[l[j]] === "X") b++;
    }
    if (a && b) continue;
    if (a === 2) s += 12;
    else if (a === 1) s += 2;
    if (b === 2) s -= 14;
    else if (b === 1) s -= 2;
  }
  return s;
}

function simulateMove(g, marks, player, idx) {
  const ng = g.slice();
  const nm = { X: marks.X.slice(), O: marks.O.slice() };
  ng[idx] = player;
  nm[player].unshift(idx);
  let removed = -1;
  if (nm[player].length > 3) {
    removed = nm[player].pop();
    ng[removed] = null;
  }
  return { g: ng, marks: nm, removed };
}

function search(g, marks, p, depth, alpha, beta) {
  const moves = emptyCells(g);
  if (depth === 0 || moves.length === 0) return heuristic(g, marks);
  const maximizing = p === "O";
  let best = maximizing ? -Infinity : Infinity;
  for (const idx of moves) {
    const { g: ng, marks: nm } = simulateMove(g, marks, p, idx);
    const w = winnerOf(ng);
    const sc = w
      ? (w === "O" ? WIN_SCORE - depth : -(WIN_SCORE - depth))
      : search(ng, nm, other(p), depth - 1, alpha, beta);
    if (maximizing) {
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
    } else {
      if (sc < best) best = sc;
      if (best < beta) beta = sc;
    }
    if (beta <= alpha) break;
  }
  return best;
}

function botPickMove(g, marks) {
  const moves = emptyCells(g);
  if (!moves.length) return -1;
  let bestIdx = moves[0], bestScore = -Infinity;
  for (const idx of moves) {
    const { g: ng, marks: nm } = simulateMove(g, marks, "O", idx);
    const w = winnerOf(ng);
    const sc = w ? WIN_SCORE : search(ng, nm, "X", SEARCH_DEPTH, -Infinity, Infinity);
    const jittered = sc + Math.random() * 0.5;
    if (jittered > bestScore) { bestScore = jittered; bestIdx = idx; }
  }
  return bestIdx;
}

/* ── Component ──────────────────────────────────────────────── */
export default function TictactoeGame({
  multiplayerCode,
  playerName,
  socket: multiplayerSocket,
  roomData,
  gameReadyData,
}) {
  const multiplayerMode = Boolean(multiplayerCode);

  // Game state
  const [grid, setGrid] = useState(Array(9).fill(null));
  const [marks, setMarks] = useState({ X: [], O: [] });
  const [current, setCurrent] = useState("X");
  const [roundOver, setRoundOver] = useState(false);
  const [score, setScore] = useState({ X: 0, O: 0 });
  const [starter, setStarter] = useState("X");
  const [hint, setHint] = useState("MAX 3 MARKS EACH — A 4TH REMOVES YOUR OLDEST");
  const [winLine, setWinLine] = useState(null);
  const [timerPct, setTimerPct] = useState(100);
  const [timerClass, setTimerClass] = useState("");
  const [overlayTitle, setOverlayTitle] = useState("");
  const [overlaySub, setOverlaySub] = useState("");
  const [showOverlay, setShowOverlay] = useState(false);
  const [botMode, setBotMode] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [landingPhase, setLandingPhase] = useState(
    () => (gameReadyData?.players) ? null : null
  ); // null = play, "bot" = bot mode selected

  // Multiplayer-specific
  const [pendingMove, setPendingMove] = useState(false);
  const [multiplayerError, setMultiplayerError] = useState("");
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [multiplayerPlayers, setMultiplayerPlayers] = useState(
    () => (gameReadyData?.players) || []
  );

  const gridRef = useRef(grid);
  gridRef.current = grid;
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const currentRef = useRef(current);
  currentRef.current = current;
  const roundOverRef = useRef(roundOver);
  roundOverRef.current = roundOver;
  const botModeRef = useRef(botMode);
  botModeRef.current = botMode;
  const deadlineRef = useRef(0);
  const tickRef = useRef(null);
  const botTimerRef = useRef(null);
  const scoreRef = useRef(score);
  scoreRef.current = score;
  const starterRef = useRef(starter);
  starterRef.current = starter;

  /* ── Arcade bot mode (postMessage) ── */
  useEffect(() => {
    if (multiplayerMode) return;
    const onMsg = (e) => {
      const d = e.data;
      if (!d || d.type !== "arcade-bot") return;
      setBotMode(Boolean(d.on));
      try { window.parent.postMessage({ type: "arcade-bot-ack" }, "*"); } catch {}
    };
    window.addEventListener("message", onMsg);
    try { window.parent.postMessage({ type: "arcade-bot-ready", game: "tictactoe" }, "*"); } catch {}
    return () => window.removeEventListener("message", onMsg);
  }, [multiplayerMode]);

  /* ── Multiplayer socket listeners ── */
  useEffect(() => {
    if (!multiplayerMode || !multiplayerSocket) return;
    const s = multiplayerSocket;

    const onGameReady = (data) => {
      setMultiplayerPlayers(data.players);
      setLandingPhase(null);
      startRound();
    };

    const onMoveConfirmed = (data) => {
      setPendingMove(false);
      setMultiplayerError("");
      const { move } = data;
      const g = JSON.parse(data.boardState);
      setGrid(g);

      // Rebuild marks from move history — we track them via the server's move data
      // For simplicity, rebuild from the confirmed state
      setMarks((prev) => {
        const nm = { X: prev.X.slice(), O: prev.O.slice() };
        nm[move.player].unshift(move.cellIndex);
        if (nm[move.player].length > 3) nm[move.player].pop();
        if (move.removedCell >= 0) {
          // The removed cell was already cleared in g, just remove from marks
          for (const p of ["X", "O"]) {
            const ri = nm[p].indexOf(move.removedCell);
            if (ri !== -1) nm[p].splice(ri, 1);
          }
        }
        return nm;
      });

      setCurrent(data.turn);
      armTimer();
    };

    const onMoveRejected = (data) => {
      setPendingMove(false);
      setMultiplayerError(data.reason || "Move rejected");
      setTimeout(() => setMultiplayerError(""), 2000);
    };

    const onGameOver = (data) => {
      setRoundOver(true);
      clearInterval(tickRef.current);
      clearTimeout(botTimerRef.current);
      setOverlayTitle(data.winner ? `${data.winner} WINS!` : "DRAW!");
      setOverlaySub(data.reason);
      setShowOverlay(true);
      // Submit score
      try {
        const iWin = data.winner === playerName;
        const isDraw = !data.winner;
        fetch("/api/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: playerName,
            gameType: "tictactoe",
            score: isDraw ? 50 : iWin ? 100 : 10,
            opponentType: "human",
          }),
        }).catch(() => {});
      } catch {}
    };

    const onOpponentDisconnected = () => setOpponentDisconnected(true);
    const onOpponentReconnected = () => setOpponentDisconnected(false);

    s.on("game-ready", onGameReady);
    s.on("move_confirmed", onMoveConfirmed);
    s.on("move-rejected", onMoveRejected);
    s.on("game-over", onGameOver);
    s.on("opponent-disconnected", onOpponentDisconnected);
    s.on("opponent-reconnected", onOpponentReconnected);

    return () => {
      s.off("game-ready", onGameReady);
      s.off("move_confirmed", onMoveConfirmed);
      s.off("move-rejected", onMoveRejected);
      s.off("game-over", onGameOver);
      s.off("opponent-disconnected", onOpponentDisconnected);
      s.off("opponent-reconnected", onOpponentReconnected);
    };
  }, [multiplayerMode, multiplayerSocket, playerName]);

  /* ── Timer ── */
  const armTimer = useCallback(() => {
    clearInterval(tickRef.current);
    deadlineRef.current = Date.now() + TURN_MS;
    tickRef.current = setInterval(() => {
      if (roundOverRef.current) { clearInterval(tickRef.current); return; }
      const left = Math.max(0, deadlineRef.current - Date.now());
      const pct = (left / TURN_MS) * 100;
      setTimerPct(pct);
      setTimerClass(pct <= 20 ? " danger" : pct <= 45 ? " warn" : "");
      if (left === 0) {
        clearInterval(tickRef.current);
        // Forfeit
        if (!multiplayerMode) {
          const loser = currentRef.current;
          endRound(other(loser), loser + " RAN OUT OF TIME!");
        }
      }
    }, 100);
  }, []);

  /* ── Round management ── */
  const startRound = useCallback(() => {
    setGrid(Array(9).fill(null));
    setMarks({ X: [], O: [] });
    setCurrent(starterRef.current);
    currentRef.current = starterRef.current;
    setRoundOver(false);
    roundOverRef.current = false;
    setWinLine(null);
    setShowOverlay(false);
    setPendingMove(false);
    setHint(
      botModeRef.current
        ? "YOU ARE X — 🤖 BOT PLAYS O\nMAX 3 MARKS EACH — A 4TH REMOVES YOUR OLDEST"
        : "MAX 3 MARKS EACH — A 4TH REMOVES YOUR OLDEST\nGET YOUR 3 IN A ROW TO WIN!"
    );
    armTimer();
    // If bot's turn, trigger bot move
    if (botModeRef.current && starterRef.current === "O") {
      maybeBotMove();
    }
  }, [armTimer]);

  const endRound = useCallback((winner, reason) => {
    setRoundOver(true);
    clearInterval(tickRef.current);
    clearTimeout(botTimerRef.current);
    setScore((prev) => {
      const ns = { ...prev, [winner]: prev[winner] + 1 };
      setOverlayTitle(winner + " WINS THE ROUND!");
      setOverlaySub(reason + " SCORE X " + ns.X + " - O " + ns.O);
      return ns;
    });
    setHint("");
    setShowOverlay(true);
    setStarter((prev) => other(prev));
    starterRef.current = other(starterRef.current);
  }, []);

  /* ── Bot move ── */
  const maybeBotMove = useCallback(() => {
    if (!botModeRef.current || roundOverRef.current || currentRef.current !== "O") return;
    clearTimeout(botTimerRef.current);
    botTimerRef.current = setTimeout(() => {
      if (!botModeRef.current || roundOverRef.current || currentRef.current !== "O") return;
      const idx = botPickMove(gridRef.current, marksRef.current);
      if (idx >= 0) placeLocal(idx);
    }, BOT_DELAY_MS);
  }, []);

  /* ── Place move (local / bot mode) ── */
  const placeLocal = useCallback((idx) => {
    if (roundOverRef.current || gridRef.current[idx]) return;

    clearInterval(tickRef.current);
    const g = gridRef.current.slice();
    const m = { X: marksRef.current.X.slice(), O: marksRef.current.O.slice() };
    const p = currentRef.current;

    g[idx] = p;
    m[p].unshift(idx);
    let removed = -1;
    if (m[p].length > 3) {
      removed = m[p].pop();
      g[removed] = null;
    }

    // Win check
    let wonLine = null;
    for (const l of LINES) {
      if (g[l[0]] === p && g[l[1]] === p && g[l[2]] === p) {
        wonLine = l;
        break;
      }
    }

    setGrid(g);
    setMarks(m);

    if (wonLine) {
      setWinLine(wonLine);
      endRound(p, p + " CONNECTS THREE!");
      return;
    }

    setCurrent(other(p));
    currentRef.current = other(p);
    armTimer();
    maybeBotMove();
  }, [armTimer, endRound, maybeBotMove]);

  /* ── Place move (multiplayer) ── */
  const placeMultiplayer = useCallback((idx) => {
    if (pendingMove || roundOverRef.current || gridRef.current[idx]) return;
    if (currentRef.current !== roomData?.yourColor) return;

    setPendingMove(true);
    multiplayerSocket.emit("make-move", {
      code: multiplayerCode,
      move: { cellIndex: idx },
    });
  }, [pendingMove, multiplayerSocket, multiplayerCode, roomData]);

  /* ── Cell click ── */
  const handleCellClick = useCallback((idx) => {
    if (roundOverRef.current) return;
    if (gridRef.current[idx]) return;

    if (multiplayerMode) {
      placeMultiplayer(idx);
    } else {
      if (botModeRef.current && currentRef.current === "O") return;
      placeLocal(idx);
    }
  }, [multiplayerMode, placeMultiplayer, placeLocal]);

  /* ── Rematch / menu (local only) ── */
  const handleRematch = useCallback(() => {
    startRound();
  }, [startRound]);

  const handleMenu = useCallback(() => {
    setLandingPhase(null);
    setGrid(Array(9).fill(null));
    setMarks({ X: [], O: [] });
    setCurrent("X");
    setRoundOver(false);
    setScore({ X: 0, O: 0 });
    setStarter("X");
    setShowOverlay(false);
    setBotMode(false);
    clearInterval(tickRef.current);
    clearTimeout(botTimerRef.current);
  }, []);

  /* ── Cleanup on unmount ── */
  useEffect(() => () => {
    clearInterval(tickRef.current);
    clearTimeout(botTimerRef.current);
  }, []);

  /* ── Landing screen ── */
  if (!multiplayerMode && landingPhase === null && !botMode) {
    return (
      <div className="ttt-wrap">
        <h1 className="ttt-title">TIC-TAC-TOE ∞</h1>
        <div className="ttt-landing">
          <div className="ttt-landing-title">CHOOSE MODE:</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button className="ttt-btn" onClick={() => { botModeRef.current = true; setBotMode(true); setLandingPhase("bot"); startRound(); }}>
              ▶ VS BOT
            </button>
            <button
              className="ttt-btn ttt-btn--alt"
              onClick={async () => {
                try {
                  const res = await fetch("/api/rooms", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ gameType: "tictactoe" }),
                  });
                  const { code, url } = await res.json();
                  // Navigate to the room join page
                  window.location.href = url;
                } catch {}
              }}
            >
              👥 PLAY WITH A FRIEND
            </button>
          </div>
          <div style={{ marginTop: 8, width: "100%", textAlign: "center" }}>
            <div className="ttt-hint" style={{ marginBottom: 8 }}>— OR —</div>
            <input
              className="join-input"
              maxLength={6}
              placeholder="ROOM CODE"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6))}
              onKeyDown={(e) => { if (e.key === "Enter" && joinCode.length === 6) window.location.href = `/play/tictactoe/${joinCode}`; }}
              style={{ width: 180, textAlign: "center", marginBottom: 8, display: "block", margin: "0 auto 8px" }}
            />
            <button
              className="ttt-btn ttt-btn--alt"
              disabled={joinCode.length !== 6}
              onClick={() => { window.location.href = `/play/tictactoe/${joinCode}`; }}
              style={{ opacity: joinCode.length === 6 ? 1 : 0.4 }}
            >
              JOIN BY CODE
            </button>
          </div>
          <div className="ttt-hint">
            VS BOT: CLICK TO PLACE X<br />
            <br />
            MULTIPLAYER: SHARE THE LINK WITH A FRIEND
          </div>
        </div>
      </div>
    );
  }

  /* ── Waiting for multiplayer opponent (shown in join page, but fallback) ── */
  if (multiplayerMode && !multiplayerPlayers.length) {
    return (
      <div className="ttt-wrap">
        <div className="ttt-landing">
          <div className="ttt-landing-title">WAITING FOR OPPONENT...</div>
          <div className="ttt-hint">
            ROOM: {multiplayerCode}<br />
            YOU: {playerName}
          </div>
        </div>
      </div>
    );
  }

  /* ── Main game render ── */
  const cellsFilled = grid.filter((c) => c !== null).length;
  const fadingCell = !roundOver && marks[current].length === 3 ? marks[current][2] : -1;

  const mpWhite = multiplayerPlayers.find((p) => p.color === "X");
  const mpBlack = multiplayerPlayers.find((p) => p.color === "O");

  return (
    <div className="ttt-wrap">
      {/* Opponent disconnected banner */}
      {opponentDisconnected && (
        <div className="ttt-banner ttt-banner--red">
          ⚠ OPPONENT DISCONNECTED — WAITING FOR RECONNECT...
        </div>
      )}
      {multiplayerError && (
        <div className="ttt-banner ttt-banner--red">{multiplayerError}</div>
      )}

      {/* Status bar */}
      <div className="ttt-statusbar">
        <div className="ttt-score">
          <span className="ttt-sx">
            X <span>{score.X}</span>
            {multiplayerMode && mpWhite && <span className="ttt-player-tag">{mpWhite.name}</span>}
          </span>
          <span className="ttt-so">
            O <span>{score.O}</span>
            {multiplayerMode && mpBlack && <span className="ttt-player-tag">{mpBlack.name}</span>}
          </span>
        </div>
        <div className="ttt-turn">
          TURN{" "}
          <span className={current === "X" ? "ttt-who-x" : "ttt-who-o"}>
            {current}
          </span>
        </div>
      </div>

      {/* Timer bar */}
      <div className="ttt-timer-track">
        <div
          className={`ttt-timer-fill${timerClass}`}
          style={{ width: `${timerPct}%` }}
        />
      </div>

      {/* Board */}
      <div className="ttt-board">
        {grid.map((v, i) => (
          <div
            key={i}
            className={`ttt-cell${winLine && winLine.includes(i) ? " ttt-cell--win" : ""}${!roundOver && v && fadingCell === i ? " ttt-cell--fading" : ""}`}
            onClick={() => handleCellClick(i)}
          >
            {v && (
              <span className={v === "X" ? "ttt-mark-x" : "ttt-mark-o"}>
                {v}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Hint */}
      <div className="ttt-hint" style={{ whiteSpace: "pre-line" }}>
        {hint}
      </div>

      {/* Overlay */}
      {showOverlay && (
        <div className="ttt-overlay">
          <div className="ttt-panel">
            <div className="ttt-panel-title">{overlayTitle}</div>
            <div className="ttt-panel-sub">{overlaySub}</div>
            {multiplayerMode ? (
              <button className="ttt-btn" onClick={() => window.location.reload()}>
                REMATCH
              </button>
            ) : (
              <button className="ttt-btn" onClick={handleRematch}>
                NEXT ROUND
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
