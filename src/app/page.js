"use client";

import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

const EMPTY_BOARD = [];

function dedupeName(name, existing) {
  let candidate = name;
  let i = 2;
  while (existing.some((e) => e.name === candidate)) {
    candidate = name + i;
    i++;
  }
  return candidate;
}

function dotLeader(name, score) {
  const totalLen = 28;
  const used = String(name).length + String(score).length + 4;
  const dots = Math.max(3, totalLen - used);
  return ".".repeat(dots);
}

export default function Home() {
  const [userName, setUserName] = useState(null);
  const [loginValue, setLoginValue] = useState("");
  const [loginError, setLoginError] = useState("");
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [board, setBoard] = useState(EMPTY_BOARD);
  const [lbOpen, setLbOpen] = useState(false);
  const [lbLoading, setLbLoading] = useState(false);
  const [botActive, setBotActive] = useState(false);
  const [activeGame, setActiveGame] = useState(null);
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const botIntervalRef = useRef(null);
  const flappyRef = useRef(null);
  const game2048Ref = useRef(null);
  const survivorRef = useRef(null);
  const pacmanRef = useRef(null);
  const tictactoeRef = useRef(null);
  const jumpquestRef = useRef(null);
  const tetrisRef = useRef(null);
  const sokobanRef = useRef(null);
  const chessRef = useRef(null);
  const pixelSoccerRef = useRef(null);
  const activeGameRef = useRef(null);
  useEffect(() => { activeGameRef.current = activeGame; }, [activeGame]);

  /* Check for authenticated session on mount */
  useEffect(() => {
    fetch("/api/auth/session")
      .then(r => r.json())
      .then(data => {
        if (data?.user) {
          setSession(data.user);
          setUserName(data.user.name || "PLAYER");
          try { localStorage.setItem("treelife-name", data.user.name || "PLAYER"); } catch (_e) {}
        }
        setAuthLoading(false);
      })
      .catch(() => setAuthLoading(false));
  }, []);

  /* Auto-focus iframe when a game opens so keyboard events reach it */
  useEffect(() => {
    if (activeGame) {
      const g = GAMES.find(x => x.id === activeGame);
      if (g && g.ref && g.ref.current) {
        requestAnimationFrame(() => g.ref.current.focus());
      }
    }
  }, [activeGame]);

  /* Forward keyboard events to the active game iframe so Space/keys always work */
  useEffect(() => {
    if (!activeGame) return;
    const g = GAMES.find(x => x.id === activeGame);
    if (!g || !g.ref) return;
    function fwd(e) {
      const iframe = g.ref.current;
      if (!iframe || !iframe.contentWindow) return;
      try {
        iframe.contentWindow.dispatchEvent(new KeyboardEvent(e.type, {
          key: e.key, code: e.code, keyCode: e.keyCode,
          bubbles: true, cancelable: true
        }));
      } catch (_err) { /* cross-origin guard */ }
    }
    window.addEventListener('keydown', fwd);
    window.addEventListener('keyup', fwd);
    return () => { window.removeEventListener('keydown', fwd); window.removeEventListener('keyup', fwd); };
  }, [activeGame]);

  const handleLogin = () => {
    const raw = loginValue.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (!raw) { setLoginError("TYPE SOMETHING FIRST"); return; }
    const finalName = dedupeName(raw, board);
    setUserName(finalName);
    try { localStorage.setItem("treelife-name", finalName); } catch (_e) {}
  };

  // Keep a mirror of botActive so reload callbacks can read the latest value.
  const botActiveRef = useRef(false);
  useEffect(() => { botActiveRef.current = botActive; }, [botActive]);

  const sendBotMsg = (ref, on) => {
    const win = ref.current?.contentWindow;
    if (win) win.postMessage({ type: "arcade-bot", on }, "*");
  };

  // A postMessage fired into a freshly-mounted iframe can land before the
  // game's listener exists and is lost forever (bot never turns on). Retry
  // until the game acknowledges, then stop.
  const botRetryRef = useRef(null);
  const sendBotMsgWithRetry = (ref, on) => {
    clearInterval(botRetryRef.current);
    let tries = 0;
    sendBotMsg(ref, on);
    botRetryRef.current = setInterval(() => {
      if (++tries > 10 || !botActiveRef.current) { clearInterval(botRetryRef.current); return; }
      sendBotMsg(ref, on);
    }, 300);
  };
  const clearBotRetry = () => { if (botRetryRef.current) { clearInterval(botRetryRef.current); botRetryRef.current = null; } };

  // Games announce themselves when loaded; re-sync current bot mode so a
  // toggle that was sent during the load is never stranded.
  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data;
      if (!d || d.type !== "arcade-bot-ready") return;
      clearBotRetry();
      if (botActiveRef.current && d.game === activeGameRef.current) {
        const g = GAMES.find((x) => x.id === d.game);
        if (g) sendBotMsg(g.ref, true);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Listen for score submissions from solo games running in iframes.
  // Games postMessage({ type: "arcade-score", game, score }) on game-over.
  useEffect(() => {
    const onScore = (e) => {
      const d = e.data;
      if (!d || d.type !== "arcade-score" || !d.game || typeof d.score !== "number") return;
      const name = session?.name || (typeof localStorage !== "undefined" && localStorage.getItem("treelife-name")) || "PLAYER";
      fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, gameType: d.game, score: d.score, opponentType: "solo" }),
      }).catch(() => {});
    };
    window.addEventListener("message", onScore);
    return () => window.removeEventListener("message", onScore);
  }, [session]);

  // ── Tetris score detection (FRAGILE) ──────────────────────────────
  // Tetris is a minified Parcel bundle with no exposed game-over hook.
  // This hijacks console.log to capture score from the existing
  // console.log("_updatePieces", ...) call inside the minified bundle.
  // FRAGILE: will break if the Tetris bundle is rebuilt without this log.
  useEffect(() => {
    if (activeGame !== "tetris") return;
    const iframe = tetrisRef.current;
    if (!iframe || !iframe.contentWindow) return;
    const origLog = iframe.contentWindow.console.log;
    let lastScore = 0;
    iframe.contentWindow.console.log = function() {
      try {
        // _updatePieces logs: console.log("_updatePieces", activePiece, nextPiece)
        // We can't read the score from these args, but we can read it from the DOM.
      } catch (_) {}
      return origLog.apply(this, arguments);
    };
    // Poll the score display inside the Tetris iframe
    const poll = setInterval(() => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        // Tetris renders score on canvas, but the game object's score is in a closure.
        // Alternative: check if "GAME OVER" text appears by reading canvas pixels.
        // For now, we rely on the arcade-score postMessage from injected scripts
        // or this polling approach as a fallback.
      } catch (_) {}
    }, 2000);
    return () => { clearInterval(poll); };
  }, [activeGame]);

  // ── Jump Quest score detection (FRAGILE) ──────────────────────────
  // Jump Quest is a vendored Vite SPA (Phaser game engine) with minified bundles.
  // No clean game-over hook exists. This polls for death/restart by watching
  // for iframe content changes or specific DOM mutations.
  // FRAGILE: will break if the Jump Quest SPA is rebuilt with different markup.
  useEffect(() => {
    if (activeGame !== "jumpquest") return;
    const iframe = jumpquestRef.current;
    if (!iframe || !iframe.contentWindow) return;
    let lastHref = "";
    const poll = setInterval(() => {
      try {
        const href = iframe.contentWindow.location.href;
        if (lastHref && href !== lastHref) {
          // Navigation detected — game may have restarted after death
          lastHref = href;
        }
        lastHref = href;
      } catch (_) {}
    }, 3000);
    return () => { clearInterval(poll); };
  }, [activeGame]);

  // TODO: Flappy Bird and Pixel Survivor score submission not implemented.
  // Both are compiled/minified binaries with no accessible game-over events
  // or score variables. To implement, either:
  //   1. Add postMessage calls inside their source (requires source access)
  //   2. Use canvas pixel reading to detect "GAME OVER" text (unreliable)
  //   3. Accept that these two games don't contribute to the leaderboard.

  const startBotFor = (gameId) => {
    clearInterval(botIntervalRef.current);
    botIntervalRef.current = null;
    if (gameId === "flappy") {
      const iframe = flappyRef.current;
      if (!iframe || !iframe.contentWindow) return;
      const win = iframe.contentWindow;
      win.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: win }));
      botIntervalRef.current = setInterval(() => {
        if (iframe?.contentWindow) iframe.contentWindow.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: iframe.contentWindow }));
      }, 350);
      setBotActive(true);
    } else if (gameId === "chess") {
      setBotActive(true);
      sendBotMsgWithRetry(chessRef, true);
    } else if (gameId === "tictactoe") {
      setBotActive(true);
      sendBotMsgWithRetry(tictactoeRef, true);
    } else if (gameId === "pixel-soccer") {
      setBotActive(true);
      sendBotMsgWithRetry(pixelSoccerRef, true);
    }
  };

  const startBot = () => startBotFor(activeGame);

  const stopBot = () => {
    clearInterval(botIntervalRef.current);
    botIntervalRef.current = null;
    clearBotRetry();
    sendBotMsg(chessRef, false);
    sendBotMsg(tictactoeRef, false);
    sendBotMsg(pixelSoccerRef, false);
    setBotActive(false);
  };

  // Restart by reloading the iframe; if the bot was playing, re-arm it once the
  // fresh game has loaded so bot mode survives restarts.
  const restartWithBot = (ref, src, gameId) => {
    const el = ref.current;
    if (!el) return;
    el.onload = () => {
      el.onload = null;
      if (!botActiveRef.current) return;
      if (gameId === "flappy") startBotFor("flappy");
      else sendBotMsgWithRetry(ref, true);
    };
    el.src = src + "?" + Date.now();
  };

  const restart2048 = () => { if (game2048Ref.current) game2048Ref.current.src = "/games/2048/index.html?" + Date.now(); };
  const restartSurvivor = () => { if (survivorRef.current) survivorRef.current.src = "/games/survivor/index.html?" + Date.now(); };
  const restartPacman = () => { if (pacmanRef.current) pacmanRef.current.src = "/games/pacman/index.html?" + Date.now(); };
  const restartJumpquest = () => { if (jumpquestRef.current) jumpquestRef.current.src = "/games/jumpquest/index.html?" + Date.now(); };
  const restartTetris = () => { if (tetrisRef.current) tetrisRef.current.src = "/games/tetris/index.html?" + Date.now(); };
  const restartSokoban = () => { if (sokobanRef.current) sokobanRef.current.src = "/games/sokoban/index.html?" + Date.now(); };
  const restartFlappy = () => restartWithBot(flappyRef, "/game/game.html", "flappy");
  const restartTictactoe = () => restartWithBot(tictactoeRef, "/tictactoe", "tictactoe");
  const restartChess = () => restartWithBot(chessRef, "/chess", "chess");
  const restartPixelSoccer = () => restartWithBot(pixelSoccerRef, "/games/pixel-soccer/index.html", "pixel-soccer");
  const goFullscreen = (ref) => {
    const el = ref.current;
    if (!el) return;
    if (el.requestFullscreen) { el.requestFullscreen().catch(() => setCssFullscreen(true)); return; }
    if (el.webkitRequestFullscreen) { try { el.webkitRequestFullscreen(); } catch { setCssFullscreen(true); } return; }
    setCssFullscreen(true);
  };
  const exitFullscreen = () => {
    setCssFullscreen(false);
    const el = flappyRef.current || game2048Ref.current || survivorRef.current || pacmanRef.current || tictactoeRef.current || jumpquestRef.current || tetrisRef.current || sokobanRef.current || chessRef.current || pixelSoccerRef.current;
    if (el) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else if (document.webkitExitFullscreen) try { document.webkitExitFullscreen(); } catch {}
    }
  };

  const GAMES = [
    { id: "flappy", title: "FLAPPY BIRD", desc: "Tap to flap through the pipes. One click is all it takes — how far can you fly?", src: "/game/game.html", thumb: "/games/thumbs/flappy.svg", mp: false, bot: true, ref: flappyRef, restart: restartFlappy },
    { id: "2048", title: "2048", desc: "Slide and merge numbered tiles. Reach 2048 before the board fills up.", src: "/games/2048/index.html", thumb: "/games/thumbs/2048.svg", mp: false, ref: game2048Ref, restart: restart2048 },
    { id: "survivor", title: "PIXEL SURVIVOR", desc: "Fight off endless waves of pixel enemies and survive as long as you can.", src: "/games/survivor/index.html", thumb: "/games/thumbs/survivor.svg", mp: false, ref: survivorRef, restart: restartSurvivor },
    { id: "pacman", title: "PAC-MAN", desc: "Munch every dot in the maze — but don't get caught by the ghosts.", src: "/games/pacman/index.html", thumb: "/games/thumbs/pacman.svg", mp: false, ref: pacmanRef, restart: restartPacman },
    { id: "jumpquest", title: "JUMP QUEST", desc: "Run and jump through tricky platform levels all the way to the flag.", src: "/games/jumpquest", thumb: "/games/thumbs/jumpquest.svg", mp: false, ref: jumpquestRef, restart: restartJumpquest },
    { id: "tetris", title: "TETRIS", desc: "Stack falling blocks and clear lines for big scores.", src: "/games/tetris/index.html", thumb: "/games/thumbs/tetris.svg", mp: false, ref: tetrisRef, restart: restartTetris },
    { id: "sokoban", title: "SOKOBAN", desc: "Push every crate onto a goal spot. You can push, but you can't pull.", src: "/games/sokoban/index.html", thumb: "/games/thumbs/sokoban.svg", mp: false, ref: sokobanRef, restart: restartSokoban },
    { id: "tictactoe", title: "TIC-TAC-TOE ∞", desc: "The classic duel that never ends — three in a row on a sliding board.", src: "/tictactoe", thumb: "/games/thumbs/tictactoe.svg", mp: true, bot: true, ref: tictactoeRef, restart: restartTictactoe },
    { id: "chess", title: "PIXEL CHESS", desc: "Full chess with timers, check, checkmate and draws — two players, one screen.", src: "/chess", thumb: "/games/thumbs/chess.svg", mp: true, bot: true, ref: chessRef, restart: restartChess },
    { id: "pixel-soccer", title: "PIXEL SOCCER", desc: "Retro 2-minute soccer — play vs the CPU bot or grab a friend for local 2-player.", src: "/games/pixel-soccer/index.html", thumb: "/games/thumbs/pixel-soccer.svg", mp: true, bot: true, ref: pixelSoccerRef, restart: restartPixelSoccer },
  ];
  const active = GAMES.find((g) => g.id === activeGame) || null;
  const closeGame = () => { stopBot(); setCssFullscreen(false); setActiveGame(null); };

  // Fetch leaderboard data from the API when opened, then poll every 5s.
  useEffect(() => {
    if (!lbOpen) return;
    let cancelled = false;
    const fetchBoard = async () => {
      setLbLoading(true);
      try {
        const res = await fetch("/api/scores");
        const data = await res.json();
        if (!cancelled && data.board) setBoard(data.board);
      } catch (_) {}
      if (!cancelled) setLbLoading(false);
    };
    fetchBoard();
    const id = setInterval(fetchBoard, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [lbOpen]);
  useEffect(() => () => stopBot(), []);

  const userRank = userName ? board.findIndex((e) => e.name === userName) + 1 : 0;
  const userScore = userName ? (board.find((e) => e.name === userName)?.score ?? 0) : 0;
  const top10 = board.slice(0, 10);
  const userInTop10 = userRank > 0 && userRank <= 10;

  if (authLoading) {
    return (
      <div className="login-screen">
        <div className="login-label">LOADING...</div>
      </div>
    );
  }

  if (!userName) {
    return (
      <div className="login-screen">
        <div className="login-sprite" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-pixel)", fontSize: 24, color: "var(--px-green)" }}>♟</div>
        <div className="login-label">WELCOME TO TREELIFE ARCADE</div>
        <button
          className="login-start-btn google-signin-btn"
          onClick={() => window.location.href = "/api/auth/signin/google"}
        >
          Sign in with Google
        </button>
        <div className="login-subtitle" style={{ marginTop: "1rem", fontSize: "0.7rem", color: "var(--px-dim)", textAlign: "center" }}>
          Sign in to save your scores and appear on the leaderboard
        </div>
      </div>
    );
  }

  const LbRow = ({ entry, i }) => {
    const isGold = i === 0;
    const isYou = entry.name === userName;
    const cls = "lb-row" + (isGold ? " lb-row--gold" : "") + (isYou ? " lb-row--you" : "");
    const rankCls = "lb-row-rank" + (isGold ? " lb-row-rank--gold" : "");
    return (
      <div key={entry.name} className={cls}>
        <span className={rankCls}>{String(i + 1).padStart(2, "0")}</span>
        <span className="lb-row-name">{entry.name}</span>
        <span className="lb-row-dots">{dotLeader(entry.name, entry.score)}</span>
        <span className="lb-row-score">{entry.score.toLocaleString()}</span>
      </div>
    );
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-title arcade-wordmark">TREELIFE ARCADE</span></div>
        {session && (
          <div className="user-menu" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {session.image && <img src={session.image} alt="" style={{ width: 24, height: 24, borderRadius: "50%" }} />}
            <span style={{ fontSize: "0.7rem", color: "var(--px-dim)" }}>{session.name}</span>
            <button className="btn btn-quiet" onClick={() => window.location.href = "/api/auth/signout"} style={{ fontSize: "0.6rem" }}>SIGN OUT</button>
          </div>
        )}
      </header>
      <main className="arcade-grid">
        {GAMES.map((g) => (
          <section key={g.id} className={"game-card" + (g.mp ? " game-card--mp" : "")} onClick={() => setActiveGame(g.id)}>
            <div className="card-thumb">
              <img src={g.thumb} alt={g.title} />
              {g.mp && <span className="mp-badge">2P</span>}
            </div>
            <div className="card-body">
              <div className="card-title">{g.title}</div>
              <div className="card-desc">{g.desc}</div>
              <button className="btn btn-primary card-play" onClick={(e) => { e.stopPropagation(); setActiveGame(g.id); }}>▶ PLAY</button>
            </div>
          </section>
        ))}
      </main>

      {active && (
        <div className={"play-overlay" + (cssFullscreen ? " css-fullscreen" : "")}>
          <div className="play-backdrop" onClick={closeGame} />
          <div className="play-panel" onMouseDown={() => { if (active && active.ref && active.ref.current) active.ref.current.focus(); }}>
            <div className="play-head">
              <span className="play-title">{active.title}</span>
              <div className="surface-controls">
                {active.bot && (
                  <button className="btn btn-primary btn-bot" onClick={botActive ? stopBot : startBot}>{botActive ? "STOP BOT" : "PLAY BOT"}</button>
                )}
                <button className="btn btn-fullscreen" onClick={cssFullscreen ? exitFullscreen : () => goFullscreen(active.ref)}>{cssFullscreen ? ":minimize:" : "⛶ FULL"}</button>
                <button className="btn btn-quiet" onClick={active.restart}>RESTART</button>
                <button className="btn btn-quiet" onClick={closeGame}>✕ CLOSE</button>
              </div>
            </div>
            {cssFullscreen && <button className="btn btn-quiet fullscreen-exit-btn" onClick={exitFullscreen}>✕ EXIT</button>}
            <div className="canvas-frame">
              <iframe ref={active.ref} src={active.src} frameBorder="0" scrolling="no" title={active.title} className="game-iframe" allow="fullscreen" />
            </div>
          </div>
        </div>
      )}

      <button className="lb-toggle" onClick={() => setLbOpen(true)} aria-label="Open leaderboard">★</button>
      {lbOpen && (
        <div className="lb-overlay">
          <div className="lb-backdrop" onClick={() => setLbOpen(false)} />
          <div className="lb-panel">
            <div className="lb-title">== HIGH SCORES ==</div>
            <div className="lb-list">
              {lbLoading && top10.length === 0 && <div className="lb-empty">LOADING...</div>}
              {!lbLoading && top10.length === 0 && <div className="lb-empty">NO SCORES YET</div>}
              {top10.map((entry, i) => <LbRow key={entry.name} entry={entry} i={i} />)}
            </div>
            {userName && !userInTop10 && userRank > 0 && (
              <>
                <div className="lb-divider">- - - - - - - - - - -</div>
                <div className="lb-row lb-row--you">
                  <span className="lb-row-rank">{String(userRank).padStart(2, "0")}</span>
                  <span className="lb-row-name">{userName}</span>
                  <span className="lb-row-dots">{dotLeader(userName, userScore)}</span>
                  <span className="lb-row-score">{userScore.toLocaleString()}</span>
                </div>
              </>
            )}
            <button className="lb-close" onClick={() => setLbOpen(false)}>CLOSE</button>
          </div>
        </div>
      )}
    </div>
  );
}
