"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Crown, AlertCircle, Clock, History, Flag } from "lucide-react";
import { Chess } from "chess.js";

const pieceUnicode = {
  wP: "♙",
  wN: "♘",
  wB: "♗",
  wR: "♖",
  wQ: "♕",
  wK: "♔",
  bP: "♟",
  bN: "♞",
  bB: "♝",
  bR: "♜",
  bQ: "♛",
  bK: "♚",
};

export default function ChessGame({
  multiplayerCode,
  playerName,
  socket: multiplayerSocket,
  roomData,
  gameReadyData,
}) {
  const multiplayerMode = Boolean(multiplayerCode);
  const router = useRouter();
  const [landingPhase, setLandingPhase] = useState(
    multiplayerMode ? ((gameReadyData?.players?.length) ? null : "waiting") : null
  );
  // landingPhase: null = bot/local mode (show board), "waiting" = waiting for opponent
  const [showLanding, setShowLanding] = useState(!multiplayerMode);
  const [joinCode, setJoinCode] = useState("");
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [disconnectSecondsLeft, setDisconnectSecondsLeft] = useState(0);
  const disconnectIntervalRef = useRef(null);
  const [multiplayerPlayers, setMultiplayerPlayers] = useState(
    () => (gameReadyData?.players) || []
  );
  const [game, setGame] = useState(new Chess());
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [possibleMoves, setPossibleMoves] = useState([]);
  const [status, setStatus] = useState("Turn: White");
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [moveHistory, setMoveHistory] = useState([]);
  const [capturedPieces, setCapturedPieces] = useState({ white: [], black: [] });
  const [whiteTime, setWhiteTime] = useState(600);
  const [blackTime, setBlackTime] = useState(600);
  const [timerActive, setTimerActive] = useState(false);
  const [drawOffered, setDrawOffered] = useState(false);
  const [drawOfferedBy, setDrawOfferedBy] = useState(null);
  const [botMode, setBotMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pendingMove, setPendingMove] = useState(false);
  const [multiplayerError, setMultiplayerError] = useState("");
  const [multiplayerGameOverMsg, setMultiplayerGameOverMsg] = useState(null);

  const gameRef = useRef(game);
  gameRef.current = game;
  const selectedSquareRef = useRef(null);
  const engineRef = useRef(null);
  const engineReadyRef = useRef(false);
  const botThinkingRef = useRef(false);
  const requestedFenRef = useRef(null);

  const colorName = (c) => (c === "w" ? "White" : "Black");

  // The portal fullscreens the whole iframe, so detect it by viewport size
  // (fullscreenElement is not always reported inside a fullscreened iframe).
  useEffect(() => {
    const check = () => {
      const el = document.fullscreenElement || document.webkitFullscreenElement;
      const nearScreen =
        window.innerWidth >= window.screen.width * 0.9 &&
        window.innerHeight >= window.screen.height * 0.9;
      setIsFullscreen(Boolean(el) || nearScreen);
    };
    check();
    window.addEventListener("resize", check);
    document.addEventListener("fullscreenchange", check);
    document.addEventListener("webkitfullscreenchange", check);
    return () => {
      window.removeEventListener("resize", check);
      document.removeEventListener("fullscreenchange", check);
      document.removeEventListener("webkitfullscreenchange", check);
    };
  }, []);

  const updateStatus = (g = game) => {
    let statusText = "";
    const moveColor = colorName(g.turn());

    if (g.isGameOver()) {
      setTimerActive(false);
      if (g.isCheckmate()) {
        // g.turn() is the side that is checkmated — the LOSER. The winner is
        // the opposite color; naming g.turn() here inverted every result.
        const winnerName = colorName(g.turn() === "w" ? "b" : "w");
        statusText = `Checkmate! - ${winnerName} wins`;
        setGameOver(true);
        setWinner(winnerName);
      } else if (g.isStalemate()) {
        statusText = "Draw - Stalemate";
        setGameOver(true);
        setWinner(null);
      } else if (g.isThreefoldRepetition()) {
        statusText = "Draw - Threefold repetition";
        setGameOver(true);
        setWinner(null);
      } else if (g.isInsufficientMaterial()) {
        statusText = "Draw - Insufficient material";
        setGameOver(true);
        setWinner(null);
      } else if (g.isDraw()) {
        statusText = "Draw";
        setGameOver(true);
        setWinner(null);
      }
    } else {
      statusText = `Turn: ${moveColor}`;
      if (g.isCheck()) {
        statusText += " - Check!";
      }
    }

    setStatus(statusText);
  };

  useEffect(() => {
    if (!timerActive || gameOver) return;

    const interval = setInterval(() => {
      if (game.turn() === "w") {
        setWhiteTime((prev) => {
          if (prev <= 1) {
            setGameOver(true);
            setWinner("Black");
            setStatus("Time out! - Black wins");
            setTimerActive(false);
            return 0;
          }
          return prev - 1;
        });
      } else {
        setBlackTime((prev) => {
          if (prev <= 1) {
            setGameOver(true);
            setWinner("White");
            setStatus("Time out! - White wins");
            setTimerActive(false);
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [timerActive, game, gameOver]);

  // ── Arcade bot mode (toggled from the arcade panel via postMessage) ──
  useEffect(() => {
    // Skip arcade-bot integration when in multiplayer mode
    if (multiplayerMode) return;
    const onMsg = (e) => {
      const d = e.data;
      if (!d || d.type !== "arcade-bot") return;
      setBotMode(Boolean(d.on));
      if (Boolean(d.on)) setShowLanding(false);
      // Acknowledge so the arcade panel knows the toggle was received.
      try {
        window.parent.postMessage({ type: "arcade-bot-ack" }, "*");
      } catch {}
    };
    window.addEventListener("message", onMsg);
    // Tell the arcade panel this game is live, so a bot toggle sent before
    // hydration finished can be re-delivered instead of lost.
    try {
      window.parent.postMessage({ type: "arcade-bot-ready", game: "chess" }, "*");
    } catch {}
    return () => window.removeEventListener("message", onMsg);
  }, [multiplayerMode]);

  // ── Initialize multiplayer round if gameReadyData provided on mount ──
  useEffect(() => {
    if (multiplayerMode && gameReadyData?.players?.length) {
      setMultiplayerPlayers(gameReadyData.players);
      setLandingPhase(null);
      setTimerActive(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Multiplayer: socket event listeners ──
  useEffect(() => {
    if (!multiplayerMode || !multiplayerSocket) return;
    const s = multiplayerSocket;

    const onGameReady = (data) => {
      setMultiplayerPlayers(data.players);
      setLandingPhase(null); // transition to game board
    };

    const onMoveConfirmed = (data) => {
      setPendingMove(false);
      setMultiplayerError("");
      // Build a trial board from the server-confirmed FEN and replay the move
      const g = new Chess(data.boardState);
      // The move was already applied server-side; just use the confirmed FEN
      setGame(g);
      setMoveHistory((prev) => [...prev, data.move.san]);
      updateStatus(g);
      setTimerActive(true);
    };

    const onMoveRejected = (data) => {
      setPendingMove(false);
      setMultiplayerError(data.reason || "Move rejected");
      setTimeout(() => setMultiplayerError(""), 2000);
    };

    const onGameOver = (data) => {
      setGameOver(true);
      setWinner(data.winner);
      setStatus(data.reason);
      setTimerActive(false);
      setMultiplayerGameOverMsg(data);
      // Submit score to server
      try {
        const iWin = data.winner === playerName;
        const isDraw = !data.winner;
        fetch("/api/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: playerName,
            gameType: "chess",
            score: isDraw ? 50 : iWin ? 100 : 10,
            opponentType: "human",
          }),
        }).then(function (res) {
          if (!res.ok) throw new Error("Score save failed");
        }).catch(function () {
          setMultiplayerError("Score could not be saved — leaderboard may be outdated.");
          setTimeout(function () { setMultiplayerError(""); }, 4000);
        });
      } catch {}
    };

    const onOpponentDisconnected = () => {
      setOpponentDisconnected(true);
      setDisconnectSecondsLeft(60);
      disconnectIntervalRef.current = setInterval(() => {
        setDisconnectSecondsLeft((prev) => {
          if (prev <= 1) {
            clearInterval(disconnectIntervalRef.current);
            disconnectIntervalRef.current = null;
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    };
    const onOpponentReconnected = () => {
      if (disconnectIntervalRef.current) {
        clearInterval(disconnectIntervalRef.current);
        disconnectIntervalRef.current = null;
      }
      setOpponentDisconnected(false);
      setDisconnectSecondsLeft(0);
    };
    const onMatchAbandoned = (data) => {
      if (disconnectIntervalRef.current) {
        clearInterval(disconnectIntervalRef.current);
        disconnectIntervalRef.current = null;
      }
      setOpponentDisconnected(false);
      setDisconnectSecondsLeft(0);
      setGameOver(true);
      setStatus("Match abandoned — opponent disconnected");
      setTimerActive(false);
      setMultiplayerGameOverMsg({ winner: null, reason: data?.reason || "Opponent disconnected for too long" });
    };
    const onRoomExpired = () => {
      setGameOver(true);
      setStatus("Room expired");
      setMultiplayerGameOverMsg({ winner: null, reason: "Room expired" });
    };

    s.on("game-ready", onGameReady);
    s.on("move_confirmed", onMoveConfirmed);
    s.on("move-rejected", onMoveRejected);
    s.on("game-over", onGameOver);
    s.on("opponent-disconnected", onOpponentDisconnected);
    s.on("opponent-reconnected", onOpponentReconnected);
    s.on("match-abandoned", onMatchAbandoned);
    s.on("room-expired", onRoomExpired);

    return () => {
      s.off("game-ready", onGameReady);
      s.off("move_confirmed", onMoveConfirmed);
      s.off("move-rejected", onMoveRejected);
      s.off("game-over", onGameOver);
      s.off("opponent-disconnected", onOpponentDisconnected);
      s.off("opponent-reconnected", onOpponentReconnected);
      s.off("match-abandoned", onMatchAbandoned);
      s.off("room-expired", onRoomExpired);
    };
  }, [multiplayerMode, multiplayerSocket, playerName]);

  useEffect(() => () => {
    if (disconnectIntervalRef.current) clearInterval(disconnectIntervalRef.current);
  }, []);

  useEffect(
    () => () => {
      if (engineRef.current) engineRef.current.terminate();
      engineRef.current = null;
      engineReadyRef.current = false;
    },
    []
  );

  const ensureEngine = () => {
    if (engineRef.current) return;
    try {
      const w = new Worker("/stockfish/stockfish-18-lite-single.js");
      w.onmessage = (e) => handleEngineLine(String(e.data));
      w.postMessage("uci");
      engineRef.current = w;
    } catch (err) {
      // Worker unavailable — bot stays off
    }
  };

  const runBotTurn = (g) => {
    if (!engineRef.current || !engineReadyRef.current || botThinkingRef.current) return;
    if (!g || g.isGameOver() || g.turn() !== "b") return;
    const fen = g.fen();
    botThinkingRef.current = true;
    requestedFenRef.current = fen;
    engineRef.current.postMessage("position fen " + fen);
    engineRef.current.postMessage("go depth 12");
  };

  const handleEngineLine = (line) => {
    if (line.startsWith("uciok")) {
      engineRef.current?.postMessage("isready");
    } else if (line.startsWith("readyok")) {
      engineReadyRef.current = true;
      runBotTurn(gameRef.current);
    } else if (line.startsWith("bestmove")) {
      botThinkingRef.current = false;
      const best = line.split(/\s+/)[1];
      if (!best || best === "(none)") return;
      const baseFen = requestedFenRef.current;
      const live = gameRef.current;
      if (!baseFen || live.fen() !== baseFen) {
        // Position changed while the engine thought — ask again for the live one.
        runBotTurn(live);
        return;
      }
      const g = new Chess(baseFen);
      const move = g.move({
        from: best.slice(0, 2),
        to: best.slice(2, 4),
        promotion: best.length > 4 ? best[4] : "q",
      });
      if (move) commitMove(g, move);
    }
  };

  useEffect(() => {
    if (!botMode || gameOver) return;
    ensureEngine();
    if (game.turn() === "b") {
      const t = setTimeout(() => runBotTurn(game), 350);
      return () => clearTimeout(t);
    }
  }, [botMode, game, gameOver]);

  const commitMove = (g, move) => {
    if (!timerActive) {
      setTimerActive(true);
    }

    if (move.captured) {
      setCapturedPieces((prev) => ({
        ...prev,
        [move.color === "w" ? "white" : "black"]: [
          ...prev[move.color === "w" ? "white" : "black"],
          move.captured,
        ],
      }));
    }

    setMoveHistory((prev) => [...prev, move.san]);
    setDrawOffered(false);
    setDrawOfferedBy(null);

    setGame(new Chess(g.fen()));
    selectedSquareRef.current = null;
    setSelectedSquare(null);
    setPossibleMoves([]);
    updateStatus(g);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const selectSquare = (square) => {
    selectedSquareRef.current = square;
    setSelectedSquare(square);
    const moves = game.moves({ square, verbose: true });
    setPossibleMoves(moves.map((m) => m.to));
  };

  const clearSelection = () => {
    selectedSquareRef.current = null;
    setSelectedSquare(null);
    setPossibleMoves([]);
  };

  // Selection is read from selectedSquareRef — updated synchronously in this
  // same tick — so a destination click landing before React re-renders still
  // sees the source square chosen by the first click (rapid double-click race).
  const handleSquareClick = (square) => {
    if (gameOver) return;
    if (botMode && game.turn() === "b") return; // bot owns Black
    if (pendingMove) return; // waiting for server confirmation

    // Multiplayer: only allow moves on your turn
    if (multiplayerMode && roomData) {
      const myColor = roomData.yourColor;
      if (game.turn() !== myColor) return;
    }

    const piece = game.get(square);
    const from = selectedSquareRef.current;

    if (!from) {
      if (piece && piece.color === game.turn()) selectSquare(square);
      return;
    }

    // Attempt the move on a trial board so failed attempts never mutate live
    // state — and commit THAT SAME board, otherwise the move is silently lost.
    const trial = new Chess(game.fen());
    let move = null;
    try {
      move = trial.move({ from, to: square, promotion: "q" });
    } catch (e) {
      move = null;
    }

    if (move) {
      clearSelection();
      if (multiplayerMode && multiplayerSocket) {
        // Send move to server, don't apply locally yet
        setPendingMove(true);
        multiplayerSocket.emit("make-move", {
          code: multiplayerCode,
          move: { from, to: square, promotion: "q" },
        });
      } else {
        commitMove(trial, move);
      }
      return;
    }

    if (piece && piece.color === game.turn()) {
      selectSquare(square); // clicked another own piece — reselect
    } else {
      clearSelection();
    }
  };

  const offerDraw = () => {
    setDrawOffered(true);
    setDrawOfferedBy(game.turn());
  };

  const acceptDraw = () => {
    setGameOver(true);
    setWinner(null);
    setStatus("Draw - Agreed by both players");
    setTimerActive(false);
    setDrawOffered(false);
    setDrawOfferedBy(null);
  };

  const declineDraw = () => {
    setDrawOffered(false);
    setDrawOfferedBy(null);
  };

  const resign = () => {
    if (multiplayerMode && multiplayerSocket) {
      multiplayerSocket.emit("resign", { code: multiplayerCode });
      return;
    }
    const currentPlayer = colorName(game.turn());
    const opponent = colorName(game.turn() === "w" ? "b" : "w");
    setGameOver(true);
    setWinner(opponent);
    setStatus(`${currentPlayer} resigns - ${opponent} wins`);
    setTimerActive(false);
  };

  const resetGame = () => {
    const fresh = new Chess();
    setGame(fresh);
    selectedSquareRef.current = null;
    setSelectedSquare(null);
    setPossibleMoves([]);
    setGameOver(false);
    setWinner(null);
    setMoveHistory([]);
    setCapturedPieces({ white: [], black: [] });
    setWhiteTime(600);
    setBlackTime(600);
    setTimerActive(false);
    setDrawOffered(false);
    setDrawOfferedBy(null);
    updateStatus(fresh);
  };

  const renderSquare = (square, piece, row, col) => {
    const isLight = (row + col) % 2 === 0;
    const isSelected = selectedSquare === square;
    const isPossibleMove = possibleMoves.includes(square);
    const isKingInCheck = game.isCheck() && piece?.type === "k" && piece?.color === game.turn();

    return (
      <button
        key={square}
        onClick={() => handleSquareClick(square)}
        className={`
          aspect-square flex items-center justify-center text-4xl md:text-5xl relative
          transition-all duration-200 font-bold
          ${isLight ? "bg-[#f4f4f4]" : "bg-[#1a1a1a]"}
          ${isSelected ? "ring-4 ring-yellow-400 ring-inset shadow-[inset_0_0_20px_rgba(250,204,21,0.5)]" : ""}
          ${isKingInCheck ? "!bg-red-600 animate-pulse" : ""}
          ${isPossibleMove && !piece ? "after:absolute after:w-5 after:h-5 after:rounded-full after:bg-yellow-400/70 after:shadow-lg" : ""}
          ${isPossibleMove && piece ? "after:absolute after:inset-0 after:border-4 after:border-yellow-400/70 after:rounded-sm" : ""}
          hover:brightness-125 active:scale-95
          ${!gameOver ? "cursor-pointer" : "cursor-not-allowed"}
        `}
        style={{
          textShadow: piece
            ? piece.color === "w"
              ? "0 2px 4px rgba(0,0,0,0.8), 0 0 10px rgba(255,255,255,0.3)"
              : "-1px -1px 0 #f4f4f4, 1px -1px 0 #f4f4f4, -1px 1px 0 #f4f4f4, 1px 1px 0 #f4f4f4, 0 2px 4px rgba(0,0,0,0.5)"
            : "none",
        }}
        disabled={gameOver}
      >
        <span className={piece?.color === "w" ? "text-white" : "text-[#0a0a0a]"}>
          {piece && pieceUnicode[piece.color + piece.type.toUpperCase()]}
        </span>
      </button>
    );
  };

  const renderBoard = () => {
    const board = [];
    const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const ranks = ["8", "7", "6", "5", "4", "3", "2", "1"];

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const square = files[col] + ranks[row];
        const piece = game.get(square);
        board.push(renderSquare(square, piece, row, col));
      }
    }

    return board;
  };

  // ── Landing screen (direct /chess access, not arcade iframe) ──
  if (showLanding && !multiplayerMode) {
    return (
      <div className="chess-screen w-full max-w-6xl mx-auto flex items-center justify-center">
        <div className="chess-panel p-6 text-center" style={{ maxWidth: 480 }}>
          <h2 className="chess-title mb-4">PIXEL CHESS</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
            <button
              className="chess-btn chess-btn--fill"
              onClick={() => { setBotMode(true); setShowLanding(false); }}
            >
              ▶ PLAY VS BOT
            </button>
            <button
              className="chess-btn"
              onClick={async () => {
                try {
                  const res = await fetch("/api/rooms", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ gameType: "chess" }),
                  });
                  const { code, url } = await res.json();
                  router.push(url);
                } catch {}
              }}
            >
              👥 PLAY WITH A FRIEND
            </button>
          <div style={{ marginTop: 8, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 9, opacity: 0.5, marginBottom: 8 }}>— OR —</div>
            <input
              className="join-input"
              maxLength={6}
              placeholder="ROOM CODE"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6))}
              onKeyDown={(e) => { if (e.key === "Enter" && joinCode.length === 6) router.push(`/play/chess/${joinCode}`); }}
              style={{ width: 180, textAlign: "center", marginBottom: 8, display: "block", margin: "0 auto 8px" }}
            />
            <button
              className="chess-btn"
              disabled={joinCode.length !== 6}
              onClick={() => { router.push(`/play/chess/${joinCode}`); }}
              style={{ opacity: joinCode.length === 6 ? 1 : 0.4, width: "auto", padding: "10px 24px" }}
            >
              JOIN BY CODE
            </button>
          </div>
          </div>
          <div className="chess-status-row" style={{ marginTop: 16, opacity: 0.6 }}>
            WASD / ARROWS TO MOVE · CLICK TO SELECT · DRAG TO PLAY
          </div>
        </div>
      </div>
    );
  }

  // ── Multiplayer waiting state ──
  if (multiplayerMode && landingPhase === "waiting") {
    return (
      <div className="chess-screen w-full max-w-6xl mx-auto flex items-center justify-center">
        <div className="chess-panel p-6 text-center" style={{ maxWidth: 480 }}>
          <h2 className="chess-title mb-4">PIXEL CHESS — MULTIPLAYER</h2>
          <div className="chess-status-row" style={{ marginBottom: 16 }}>
            WAITING FOR OPPONENT TO JOIN...
          </div>
          <div className="chess-status-row" style={{ marginBottom: 8 }}>
            ROOM: <span style={{ color: "var(--px-gold)" }}>{multiplayerCode}</span>
          </div>
          <div className="chess-status-row" style={{ marginBottom: 16 }}>
            YOU: <span style={{ color: "var(--px-green)" }}>{playerName}</span>
            {roomData?.yourColor && (
              <> ({roomData.yourColor === "w" ? "White" : "Black"})</>
            )}
          </div>
          <button
            className="chess-btn"
            onClick={() => navigator.clipboard?.writeText(window.location.href)}
          >
            COPY LINK
          </button>
        </div>
      </div>
    );
  }

  // ── Multiplayer: resolved player names for display ──
  const mpWhite = multiplayerPlayers.find((p) => p.color === "w");
  const mpBlack = multiplayerPlayers.find((p) => p.color === "b");

  return (
    <div className={`chess-screen w-full max-w-6xl mx-auto ${isFullscreen ? "chess-fullscreen" : ""}`}>
      <div className="text-center mb-2">
        <h1 className="chess-title text-center mb-2">PIXEL CHESS</h1>
      </div>
      {/* Opponent disconnected banner */}
      {opponentDisconnected && (
        <div className="chess-panel p-3 text-center" style={{ borderColor: "var(--px-red)", marginBottom: 8 }}>
          <span className="chess-status-row" style={{ color: "var(--px-red)" }}>
            ⚠ OPPONENT DISCONNECTED — WAITING FOR RECONNECT...{disconnectSecondsLeft > 0 && (
              <span style={{ marginLeft: 8 }}>({disconnectSecondsLeft}s)</span>
            )}
          </span>
        </div>
      )}
      {/* Multiplayer error flash */}
      {multiplayerError && (
        <div className="chess-panel p-3 text-center" style={{ borderColor: "var(--px-red)", marginBottom: 8 }}>
          <span className="chess-status-row" style={{ color: "var(--px-red)" }}>
            {multiplayerError}
          </span>
        </div>
      )}

      <div className="grid md:grid-cols-[1fr_270px] gap-4 items-start">
        {/* Chess Board */}
        <div className="space-y-4">
          <div className="chess-panel p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="chess-avatar">
                ♚
              </div>
              <div>
                <p className="chess-name">{multiplayerMode && mpBlack ? mpBlack.name : "Black"}</p>
                <div
                  className={`flex items-center gap-2 ${game.turn() === "b" && timerActive ? "chess-clock-active" : "chess-clock-idle"}`}
                >
                  <Clock className="w-4 h-4" />
                  <span className="chess-name">{formatTime(blackTime)}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-1 flex-wrap max-w-[150px] justify-end">
              {capturedPieces.white.map((piece, i) => (
                <span key={i} className="chess-captured">
                  {pieceUnicode["b" + piece.toUpperCase()]}
                </span>
              ))}
            </div>
          </div>

          <div className="chess-panel p-2">
            <div className="w-full chess-board-wrap mx-auto">
              <div className="relative inline-block w-full">
                <div className="flex justify-center mb-2">
                  <div className="grid grid-cols-8 w-[var(--chess-board)]">
                    {["8", "7", "6", "5", "4", "3", "2", "1"].map((rank) => (
                      <div key={`top-${rank}`} className="chess-coord text-center">
                        {rank}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 justify-center">
                  <div className="hidden sm:flex flex-col justify-center">
                    <div className="grid grid-rows-8 h-[var(--chess-board)]">
                      {["a", "b", "c", "d", "e", "f", "g", "h"].map((file) => (
                        <div
                          key={`left-${file}`}
                          className="chess-coord flex items-center justify-center"
                        >
                          {file}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="chess-board-frame relative">
                    <div
                      className="grid grid-cols-8 w-[var(--chess-board)] h-auto aspect-square"
                    >
                      {renderBoard()}
                    </div>
                  </div>

                  <div className="hidden sm:flex flex-col justify-center">
                    <div className="grid grid-rows-8 h-[var(--chess-board)]">
                      {["a", "b", "c", "d", "e", "f", "g", "h"].map((file) => (
                        <div
                          key={`right-${file}`}
                          className="chess-coord flex items-center justify-center"
                        >
                          {file}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex justify-center mt-2">
                  <div className="grid grid-cols-8 w-[var(--chess-board)]">
                    {["8", "7", "6", "5", "4", "3", "2", "1"].map((rank) => (
                      <div key={`bottom-${rank}`} className="chess-coord text-center">
                        {rank}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="chess-panel p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="chess-avatar">
                ♔
              </div>
              <div>
                <p className="chess-name">{multiplayerMode && mpWhite ? mpWhite.name : "White"}</p>
                <div
                  className={`flex items-center gap-2 ${game.turn() === "w" && timerActive ? "chess-clock-active" : "chess-clock-idle"}`}
                >
                  <Clock className="w-4 h-4" />
                  <span className="chess-name">{formatTime(whiteTime)}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-1 flex-wrap max-w-[150px] justify-end">
              {capturedPieces.black.map((piece, i) => (
                <span key={i} className="chess-captured">
                  {pieceUnicode["w" + piece.toUpperCase()]}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Game Info Panel */}
        <div className="space-y-4">
          <div className="chess-panel p-3">
            <h2 className="chess-heading">GAME STATUS</h2>

            <div className="space-y-4">
              {gameOver ? (
                <div className="chess-gameover p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Crown className="w-4 h-4" />
                    <span className="chess-gameover-title">GAME OVER!</span>
                  </div>
                  {winner && (
                    <p className="chess-status-row">
                      Winner: <span className="font-bold">{winner}</span>
                    </p>
                  )}
                  {!winner && <p className="chess-status-row">Draw</p>}
                </div>
              ) : (
                <>
                  <div className="chess-panel p-3">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 chess-clock-active" />
                      <span className="chess-status-row">{status}</span>
                    </div>
                    {botMode && (
                      <div className="chess-bot-badge">
                        🤖 BOT PLAYS BLACK
                      </div>
                    )}
                  </div>

                  {drawOffered && drawOfferedBy !== game.turn() && (
                    <div className="chess-panel p-3">
                      <p className="chess-draw-note">
                        {colorName(drawOfferedBy)} offers draw
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={acceptDraw}
                          className="chess-btn chess-btn--fill"
                        >
                          Accept
                        </button>
                        <button
                          onClick={declineDraw}
                          className="chess-btn"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <button
                      onClick={offerDraw}
                      disabled={drawOffered}
                      className="chess-btn disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Flag className="w-4 h-4 mr-2" />
                      Offer Draw
                    </button>
                    <button
                      onClick={resign}
                      className="chess-btn chess-btn--danger"
                    >
                      Resign
                    </button>
                  </div>
                </>
              )}

              <button
                onClick={resetGame}
                className="chess-btn"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                New Game
              </button>
            </div>
          </div>

          <div className="chess-panel p-3">
            <div className="flex items-center gap-2 mb-2">
              <History className="w-4 h-4 chess-clock-active" />
              <h3 className="chess-heading">MOVE HISTORY</h3>
            </div>
            <div className="chess-movelist">
              {moveHistory.length === 0 ? (
                <p className="chess-empty">NO MOVES YET</p>
              ) : (
                <div>
                  {moveHistory.map((move, index) => {
                    if (index % 2 === 0) {
                      return (
                        <div key={index} className="chess-move-row">
                          <span className="chess-move-num">{Math.floor(index / 2) + 1}.</span>
                          <span>{move}</span>
                          <span>{moveHistory[index + 1] || ""}</span>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
