/*  Pixel Soccer — self-contained retro 2-D top-down soccer.
    Integration contract (matches page.js expectations):
      • Listens for  { type:"arcade-bot", on }         → enable/disable CPU on player 1's side
      • Posts        { type:"arcade-bot-ready", game:"pixel-soccer" }  on load
      • Posts        { type:"arcade-bot-ack" }           on toggle receipt
    ──────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  /* ── canvas & sizing ────────────────────────────────────────── */
  var W = 320, H = 240;            // logical pixels
  var canvas = document.getElementById("game");
  var ctx    = canvas.getContext("2d");
  canvas.width  = W;
  canvas.height = H;

  /* ── palette ────────────────────────────────────────────────── */
  var C = {
    bg:      "#222034",
    pitch:   "#306850",
    lines:   "#F7E26B",
    goal:    "#F7E26B",
    red:     "#D24B4B",
    redDark: "#8C2F2F",
    blue:    "#3B5DC9",
    blueDark:"#253A7A",
    ball:    "#FFFFFF",
    ballDot: "#222034",
    white:   "#FFFFFF",
    black:   "#1A1C2C",
    hud:     "#F7E26B",
    hudBg:   "#1A1C2C",
  };

  /* ── pitch geometry ─────────────────────────────────────────── */
  var PITCH_T  = 28,   PITCH_B = 236;
  var PITCH_L  = 12,   PITCH_R = 308;
  var PITCH_W  = PITCH_R - PITCH_L;
  var PITCH_H  = PITCH_B - PITCH_T;
  var GOAL_W   = 14;
  var GOAL_H   = 64;
  var GOAL_CY  = (PITCH_T + PITCH_B) / 2;
  var GOAL_T   = GOAL_CY - GOAL_H / 2;
  var GOAL_B   = GOAL_CY + GOAL_H / 2;
  var GOAL_LX  = PITCH_L - GOAL_W;          // left goal net
  var GOAL_RX  = PITCH_R;                    // right goal net

  /* ── game constants ─────────────────────────────────────────── */
  var PLAYER_R   = 10;
  var BALL_R     = 6;
  var PLAYER_SPD = 90;               // px/s
  var BALL_FRICTION = 0.985;         // per-frame multiplier
  var KICK_FORCE    = 180;           // px/s impulse
  var KICK_RANGE    = PLAYER_R + BALL_R + 8;
  var KICK_COOLDOWN = 300;           // ms
  var MATCH_TIME    = 120;           // seconds
  var GOAL_PAUSE    = 1500;          // ms freeze after goal
  var KICKOFF_PAUSE = 800;

  /* ── input state ────────────────────────────────────────────── */
  var keys = {};
  window.addEventListener("keydown", function (e) { keys[e.code] = true;  e.preventDefault(); });
  window.addEventListener("keyup",   function (e) { keys[e.code] = false; e.preventDefault(); });

  /* touch state */
  var touchStart = null;
  var touchDir   = { x: 0, y: 0 };
  var tapFrame   = 0;            // frame countdown — if >0, emit a kick
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove",  onTouchMove,  { passive: false });
  canvas.addEventListener("touchend",   onTouchEnd,   { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointerup",   onPointerUp,   { passive: false });

  function canvasCoords(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  function onTouchStart(e) { e.preventDefault(); var t = e.touches[0]; touchStart = canvasCoords(t); }
  function onTouchMove(e) {
    e.preventDefault();
    if (!touchStart) return;
    var t = canvasCoords(e.touches[0]);
    var dx = t.x - touchStart.x, dy = t.y - touchStart.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > 4) { touchDir.x = dx / len; touchDir.y = dy / len; }
  }
  function onTouchEnd(e) { e.preventDefault(); touchStart = null; touchDir.x = 0; touchDir.y = 0; tapFrame = 6; }
  function onPointerDown(e) { if (e.pointerType === "mouse") touchStart = canvasCoords(e); }
  function onPointerUp(e)   { if (e.pointerType === "mouse") { touchStart = null; touchDir.x = 0; touchDir.y = 0; tapFrame = 6; } }

  /* ── game state ─────────────────────────────────────────────── */
  var state = "menu";             // menu | playing | goal | fulltime
  var p1, p2, ball;
  var score = [0, 0];             // [red, blue]
  var timeLeft = MATCH_TIME;
  var stateTimer = 0;             // ms remaining in freeze states
  var lastTime = 0;
  var botMode  = false;           // arcade-bot: CPU controls P1 (red side)
  var cpuMode  = false;           // VS BOT: CPU controls P2 (blue side)
  var goalScorer = -1;            // index of team that just scored
  var aiWantsKick1 = false;       // cpuTick P1 kick intent (normalized path)
  var aiWantsKick2 = false;       // cpuTick P2 kick intent (normalized path)

  /* ── multiplayer state ──────────────────────────────────────── */
  var multiplayerMode = false;
  var mpSocket = null;
  var mpCode = null;
  var mpTeam = -1;         // 0 = P1/red, 1 = P2/blue
  var mpName = "";
  var mpSendTimer = 0;
  var mpSendInterval = 1 / 20;  // 20Hz send rate
  var mpDisconnectTimer = null;  // countdown interval
  var mpDisconnectSeconds = 0;   // seconds remaining

  /* ── arcade-bot protocol ────────────────────────────────────── */
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.type !== "arcade-bot") return;
    botMode = Boolean(d.on);
    if (botMode && state === "menu") startMatch(true);
    try { window.parent.postMessage({ type: "arcade-bot-ack" }, "*"); } catch (_) {}
  });
  try { window.parent.postMessage({ type: "arcade-bot-ready", game: "pixel-soccer" }, "*"); } catch (_) {}

  /* ── multiplayer: URL params + socket ─────────────────────────────── */
  (function initMultiplayer() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get("code");
    if (!code) return;
    multiplayerMode = true;
    mpCode = code;
    mpName = params.get("name") || "PLAYER";
    mpTeam = parseInt(params.get("team"), 10);
    if (mpTeam !== 0 && mpTeam !== 1) mpTeam = 0;
    hideEl("menu");
    state = "playing";
    resetPositions();
    mpSocket = io(window.location.origin, { transports: ["websocket", "polling"] });
    mpSocket.on("connect", function () {
      mpSocket.emit("join-room", { code: mpCode, playerName: mpName });
    });
    mpSocket.on("room-joined", function () {});
    mpSocket.on("game-ready", function () { state = "playing"; });
    mpSocket.on("room-error", function (data) { state = "menu"; showEl("menu"); alert(data.reason || "Room error"); });
    mpSocket.on("soccer-state", function (snap) {
      p1.x=snap.p1.x; p1.y=snap.p1.y; p1.vx=snap.p1.vx; p1.vy=snap.p1.vy; p1.kickCD=snap.p1.kickCD;
      p2.x=snap.p2.x; p2.y=snap.p2.y; p2.vx=snap.p2.vx; p2.vy=snap.p2.vy; p2.kickCD=snap.p2.kickCD;
      ball.x=snap.ball.x; ball.y=snap.ball.y; ball.vx=snap.ball.vx; ball.vy=snap.ball.vy;
      score[0]=snap.score[0]; score[1]=snap.score[1];
      timeLeft=snap.timeLeft; state=snap.state; stateTimer=snap.stateTimer; goalScorer=snap.goalScorer;
    });
    mpSocket.on("soccer-goal", function () {});
    mpSocket.on("soccer-fulltime", function (data) {
      state="fulltime"; stateTimer=500;
      var title=document.getElementById("ft-title"); var scoreEl=document.getElementById("ft-score");
      if(data.score[mpTeam]>data.score[1-mpTeam]) title.textContent="YOU WIN!";
      else if(data.score[mpTeam]<data.score[1-mpTeam]) title.textContent="YOU LOSE!";
      else title.textContent="DRAW!";
      scoreEl.textContent=data.score[0]+" - "+data.score[1]; showEl("fulltime");
      var myS=data.score[mpTeam], oppS=data.score[1-mpTeam];
      var pts=myS>oppS?100:myS===oppS?50:10;
      fetch("/api/scores",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name:mpName,gameType:"pixel-soccer",score:pts,opponentType:"human"})}).then(function(res){ if(!res.ok) throw new Error("Score save failed"); }).catch(function(){ console.warn("[scores] Score could not be saved"); });
    });
    mpSocket.on("game-restart", function (data) {
      var s=data.snapshot;
      p1.x=s.p1.x;p1.y=s.p1.y;p1.vx=0;p1.vy=0;p1.kickCD=s.p1.kickCD;
      p2.x=s.p2.x;p2.y=s.p2.y;p2.vx=0;p2.vy=0;p2.kickCD=s.p2.kickCD;
      ball.x=s.ball.x;ball.y=s.ball.y;ball.vx=0;ball.vy=0;
      score[0]=s.score[0];score[1]=s.score[1];timeLeft=s.timeLeft;state=s.state;goalScorer=s.goalScorer;
      hideEl("fulltime");
    });
    mpSocket.on("opponent-disconnected", function () {
      mpDisconnectSeconds = 60;
      showEl("disconnect");
      var dcEl = document.getElementById("dc-countdown");
      if (dcEl) dcEl.textContent = "Reconnecting in " + mpDisconnectSeconds + "s...";
      mpDisconnectTimer = setInterval(function () {
        mpDisconnectSeconds--;
        if (dcEl) dcEl.textContent = "Reconnecting in " + mpDisconnectSeconds + "s...";
        if (mpDisconnectSeconds <= 0) {
          clearInterval(mpDisconnectTimer);
          mpDisconnectTimer = null;
          hideEl("disconnect");
          state = "fulltime"; stateTimer = 500;
          var title = document.getElementById("ft-title");
          var scoreEl = document.getElementById("ft-score");
          title.textContent = "MATCH ABANDONED";
          scoreEl.textContent = "Opponent disconnected";
          showEl("fulltime");
        }
      }, 1000);
    });
    mpSocket.on("opponent-reconnected", function () {
      if (mpDisconnectTimer) {
        clearInterval(mpDisconnectTimer);
        mpDisconnectTimer = null;
      }
      mpDisconnectSeconds = 0;
      hideEl("disconnect");
    });
    mpSocket.on("match-abandoned", function (data) {
      if (mpDisconnectTimer) {
        clearInterval(mpDisconnectTimer);
        mpDisconnectTimer = null;
      }
      mpDisconnectSeconds = 0;
      hideEl("disconnect");
      state = "fulltime"; stateTimer = 500;
      var title = document.getElementById("ft-title");
      var scoreEl = document.getElementById("ft-score");
      title.textContent = "MATCH ABANDONED";
      scoreEl.textContent = (data && data.reason) || "Opponent disconnected for too long";
      showEl("fulltime");
    });
    mpSocket.on("room-expired", function () { state="menu"; showEl("menu"); });
  })();


  /* ── entities ───────────────────────────────────────────────── */
  function makePlayer(x, y, team) {
    return { x: x, y: y, vx: 0, vy: 0, team: team, kickCD: 0 };
  }
  function makeBall() {
    return { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  }

  function resetPositions() {
    p1 = makePlayer(W / 2 - 50, H / 2, 0);   // red left
    p2 = makePlayer(W / 2 + 50, H / 2, 1);   // blue right
    ball = makeBall();
    p1.kickCD = 0; p2.kickCD = 0;
  }

  function startMatch(cpu) {
    cpuMode = cpu;
    score = [0, 0];
    timeLeft = MATCH_TIME;
    goalScorer = -1;
    resetPositions();
    state = "playing";
    hideEl("menu");
    hideEl("fulltime");
  }

  function showEl(id) { document.getElementById(id).classList.remove("hidden"); }
  function hideEl(id) { document.getElementById(id).classList.add("hidden"); }

  /* ── menu buttons ───────────────────────────────────────────── */
  document.getElementById("btn-vs-bot").addEventListener("click", function () { startMatch(true); });
  document.getElementById("btn-friends").addEventListener("click", function () {
    fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameType: "pixel-soccer" }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      window.location.href = d.url;
    }).catch(function () {});
  });
  document.getElementById("btn-join").addEventListener("click", function () {
    var code = (document.getElementById("join-code-input").value || "").toUpperCase().trim();
    if (code.length >= 4) window.location.href = "/play/pixel-soccer/" + code;
  });
  document.getElementById("join-code-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      var code = this.value.toUpperCase().trim();
      if (code.length >= 4) window.location.href = "/play/pixel-soccer/" + code;
    }
  });
  document.getElementById("btn-rematch").addEventListener("click", function () { startMatch(cpuMode); });
  document.getElementById("btn-dc-menu").addEventListener("click", function () {
    if (mpDisconnectTimer) { clearInterval(mpDisconnectTimer); mpDisconnectTimer = null; }
    mpDisconnectSeconds = 0;
    hideEl("disconnect");
    state = "menu"; showEl("menu");
  });
  document.getElementById("btn-menu").addEventListener("click", function () {
    state = "menu"; showEl("menu"); hideEl("fulltime");
  });

  /* ── collision helpers ──────────────────────────────────────── */
  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function pushCircleOutOfRect(cx, cy, cr, rx, ry, rw, rh) {
    var nx = clamp(cx, rx, rx + rw);
    var ny = clamp(cy, ry, ry + rh);
    var dx = cx - nx, dy = cy - ny;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < cr && d > 0) {
      var push = (cr - d) / d;
      cx += dx * push;
      cy += dy * push;
    }
    return { x: cx, y: cy };
  }

  /* walls — ball bounces off everything except goal mouths */
  function wallBounce(ent, r) {
    /* top / bottom */
    if (ent.y - r < PITCH_T) { ent.y = PITCH_T + r; ent.vy = Math.abs(ent.vy) * 0.6; }
    if (ent.y + r > PITCH_B) { ent.y = PITCH_B - r; ent.vy = -Math.abs(ent.vy) * 0.6; }
    /* left wall — block unless in goal mouth */
    if (ent.x - r < PITCH_L) {
      if (ent.y + r > GOAL_T && ent.y - r < GOAL_B) {
        /* inside goal mouth — let it through for scoring only */
      } else {
        ent.x = PITCH_L + r; ent.vx = Math.abs(ent.vx) * 0.6;
      }
    }
    /* right wall */
    if (ent.x + r > PITCH_R) {
      if (ent.y + r > GOAL_T && ent.y - r < GOAL_B) {
        /* goal mouth */
      } else {
        ent.x = PITCH_R - r; ent.vx = -Math.abs(ent.vx) * 0.6;
      }
    }
  }

  /* ── player-wall collision ──────────────────────────────────── */
  function playerWalls(p) {
    var r = PLAYER_R;
    if (p.y - r < PITCH_T) p.y = PITCH_T + r;
    if (p.y + r > PITCH_B) p.y = PITCH_B - r;
    if (p.x - r < PITCH_L) p.x = PITCH_L + r;
    if (p.x + r > PITCH_R) p.x = PITCH_R - r;
  }

  /* ── goal detection ─────────────────────────────────────────── */
  function checkGoal() {
    /* left goal — ball fully crosses left edge inside goal mouth */
    if (ball.x + BALL_R < PITCH_L && ball.y > GOAL_T && ball.y < GOAL_B) {
      return 1;   // blue scores
    }
    /* right goal */
    if (ball.x - BALL_R > PITCH_R && ball.y > GOAL_T && ball.y < GOAL_B) {
      return 0;   // red scores
    }
    return -1;
  }

  /* ── CPU / Bot AI ───────────────────────────────────────────── */
  /* cpuTick: sets player.vx/vy for movement, returns true if AI wants to kick.
     Kicks are NOT applied here — they go through doKick() at the unified
     kick step, same as human input.  (Normalized kick path.)            */
  function cpuTick(player, target, isPlayer1) {
    /* target is the ball object */
    var dx = target.x - player.x;
    var dy = target.y - player.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var nx = d > 0 ? dx / d : 0;
    var ny = d > 0 ? dy / d : 0;

    /* Positioning logic: stay between ball and own goal, but approach to kick */
    var ownGoalX = isPlayer1 ? PITCH_L + 20 : PITCH_R - 20;

    /* if ball is behind us (closer to own goal), rush to it */
    var ballBehind;
    if (isPlayer1) ballBehind = ball.x < player.x + 20;
    else           ballBehind = ball.x > player.x - 20;

    var tx, ty;
    if (ballBehind || d < 40) {
      /* chase the ball directly */
      tx = ball.x;
      ty = ball.y;
    } else {
      /* cut off: move to a position between ball and own goal, slightly ahead */
      tx = ball.x + (isPlayer1 ? -25 : 25);
      ty = ball.y;
    }

    var ddx = tx - player.x, ddy = ty - player.y;
    var dd = Math.sqrt(ddx * ddx + ddy * ddy);
    if (dd > 2) {
      player.vx = (ddx / dd) * PLAYER_SPD;
      player.vy = (ddy / dd) * PLAYER_SPD;
    } else {
      player.vx = 0; player.vy = 0;
    }

    /* return kick intent — actual kick is handled by doKick() in the unified kick step */
    if (dist(player, ball) < KICK_RANGE && player.kickCD <= 0) {
      return true;
    }
    return false;
  }

  /* ── input → velocity ───────────────────────────────────────── */
  function readInput1() {
    var mx = 0, my = 0;
    if (keys["KeyW"] || keys["ArrowUp"])    my = -1;
    if (keys["KeyS"] || keys["ArrowDown"])  my =  1;
    /* In 2-player mode, P1 uses WASD only; in VS BOT + bot mode, P1 is AI-driven */
    if (!botMode) {
      if (keys["KeyA"] || keys["ArrowLeft"])   mx = -1;
      if (keys["KeyD"] || keys["ArrowRight"])  mx =  1;
    }
    /* touch override for P1 in bot/cpu mode */
    if (touchDir.x !== 0 || touchDir.y !== 0) {
      mx = touchDir.x; my = touchDir.y;
    }
    var len = Math.sqrt(mx * mx + my * my) || 1;
    p1.vx = (mx / len) * PLAYER_SPD;
    p1.vy = (my / len) * PLAYER_SPD;
  }



  function kickInput1() {
    if (botMode) return aiWantsKick1;
    if (tapFrame > 0) return true;   // touch tap
    return !!keys["Space"];
  }


  /* ── kick logic ─────────────────────────────────────────────── */
  function doKick(player, kickDown) {
    if (!kickDown || player.kickCD > 0) return;
    if (dist(player, ball) > KICK_RANGE) return;
    /* direction: from player toward opponent goal center */
    var goalX = player.team === 0 ? PITCH_R : PITCH_L;
    var dx = goalX - ball.x + (Math.random() - 0.5) * 30;
    var dy = GOAL_CY - ball.y + (Math.random() - 0.5) * 30;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    ball.vx = (dx / len) * KICK_FORCE;
    ball.vy = (dy / len) * KICK_FORCE;
    player.kickCD = KICK_COOLDOWN;
  }

  /* ── main tick ──────────────────────────────────────────────── */
  function tick(dt) {
    if (state === "goal" || state === "fulltime") {
      stateTimer -= dt * 1000;
      if (stateTimer <= 0) {
        if (state === "goal") {
          resetPositions();
          state = "playing";
          stateTimer = KICKOFF_PAUSE;
        } else {
          showEl("fulltime");
        }
      }
      return;
    }
    if (state !== "playing") return;

    /* In multiplayer mode, server runs all physics. Only manage touch tap frame. */
    if (multiplayerMode) {
      if (tapFrame > 0) tapFrame--;
      return;
    }

    /* timer */
    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      state = "fulltime";
      stateTimer = 500;
      var title = document.getElementById("ft-title");
      var scoreEl = document.getElementById("ft-score");
      if (score[0] > score[1])      title.textContent = "RED WINS!";
      else if (score[1] > score[0]) title.textContent = "BLUE WINS!";
      else                          title.textContent = "DRAW!";
      scoreEl.textContent = score[0] + " - " + score[1];
      /* Submit VS BOT score to leaderboard */
      if (!multiplayerMode) {
        var myS = score[0], oppS = score[1];
        var pts = myS > oppS ? 100 : myS === oppS ? 50 : 10;
        var botName = (typeof localStorage !== "undefined" && localStorage.getItem("treelife-name")) || "PLAYER";
        fetch("/api/scores", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: botName, gameType: "pixel-soccer", score: pts, opponentType: "bot" })
        }).then(function(res){ if(!res.ok) throw new Error("Score save failed"); })
          .catch(function(){ console.warn("[scores] Bot score could not be saved"); });
      }
      return;
    }

    /* cooldowns */
    p1.kickCD = Math.max(0, p1.kickCD - dt * 1000);
    p2.kickCD = Math.max(0, p2.kickCD - dt * 1000);
    if (tapFrame > 0) tapFrame--;

    /* AI — cpuTick returns kick intent, stored for the unified kick step below */
    if (botMode)   aiWantsKick1 = cpuTick(p1, ball, true);
    else           { readInput1(); aiWantsKick1 = false; }
    if (cpuMode)   aiWantsKick2 = cpuTick(p2, ball, false);

    /* move */
    p1.x += p1.vx * dt; p1.y += p1.vy * dt;
    p2.x += p2.vx * dt; p2.y += p2.vy * dt;
    playerWalls(p1);
    playerWalls(p2);

    /* player-player push apart */
    var pd = dist(p1, p2);
    var minD = PLAYER_R * 2;
    if (pd < minD && pd > 0) {
      var push = (minD - pd) / 2 / pd;
      var dx = p1.x - p2.x, dy = p1.y - p2.y;
      p1.x += dx * push; p1.y += dy * push;
      p2.x -= dx * push; p2.y -= dy * push;
    }

    /* ball physics */
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.vx *= BALL_FRICTION;
    ball.vy *= BALL_FRICTION;
    if (Math.abs(ball.vx) < 0.3) ball.vx = 0;
    if (Math.abs(ball.vy) < 0.3) ball.vy = 0;
    wallBounce(ball, BALL_R);

    /* player-ball collision (nudge) */
    function playerBallBounce(p) {
      var d2 = dist(p, ball);
      var minDist = PLAYER_R + BALL_R;
      if (d2 < minDist && d2 > 0) {
        var nx = (ball.x - p.x) / d2;
        var ny = (ball.y - p.y) / d2;
        ball.x = p.x + nx * minDist;
        ball.y = p.y + ny * minDist;
        /* transfer some velocity */
        ball.vx += p.vx * 0.4;
        ball.vy += p.vy * 0.4;
      }
    }
    playerBallBounce(p1);
    playerBallBounce(p2);

    /* kicks */
    doKick(p1, kickInput1());
    doKick(p2, aiWantsKick2);

    /* goal check */
    var g = checkGoal();
    if (g >= 0) {
      score[g]++;
      goalScorer = g;
      state = "goal";
      stateTimer = GOAL_PAUSE;
    }
  }

  /* ── render ─────────────────────────────────────────────────── */
  function draw() {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    /* pitch */
    ctx.fillStyle = C.pitch;
    ctx.fillRect(PITCH_L, PITCH_T, PITCH_W, PITCH_H);

    /* field markings */
    ctx.strokeStyle = C.lines;
    ctx.lineWidth = 1;
    /* outline */
    ctx.strokeRect(PITCH_L + 0.5, PITCH_T + 0.5, PITCH_W - 1, PITCH_H - 1);
    /* center line */
    ctx.beginPath();
    ctx.moveTo(W / 2, PITCH_T); ctx.lineTo(W / 2, PITCH_B);
    ctx.stroke();
    /* center circle */
    ctx.beginPath();
    ctx.arc(W / 2, (PITCH_T + PITCH_B) / 2, 24, 0, Math.PI * 2);
    ctx.stroke();
    /* center dot */
    ctx.fillStyle = C.lines;
    ctx.fillRect(W / 2 - 2, H / 2 - 2, 4, 4);

    /* goal nets */
    ctx.fillStyle = C.goal;
    /* left net */
    ctx.fillRect(GOAL_LX, GOAL_T, GOAL_W, GOAL_H);
    ctx.strokeStyle = C.black; ctx.lineWidth = 1;
    ctx.strokeRect(GOAL_LX, GOAL_T, GOAL_W, GOAL_H);
    /* right net */
    ctx.fillRect(GOAL_RX, GOAL_T, GOAL_W, GOAL_H);
    ctx.strokeRect(GOAL_RX, GOAL_T, GOAL_W, GOAL_H);
    /* goal lines (opening) */
    ctx.strokeStyle = C.lines; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PITCH_L, GOAL_T); ctx.lineTo(PITCH_L, GOAL_B); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PITCH_R, GOAL_T); ctx.lineTo(PITCH_R, GOAL_B); ctx.stroke();

    /* penalty areas */
    ctx.strokeStyle = C.lines; ctx.lineWidth = 1;
    ctx.strokeRect(PITCH_L + 0.5, GOAL_CY - 32, 40, 64);
    ctx.strokeRect(PITCH_R - 40 + 0.5, GOAL_CY - 32, 40, 64);

    /* net pattern */
    ctx.strokeStyle = "rgba(247,226,107,0.25)"; ctx.lineWidth = 0.5;
    for (var ny = GOAL_T + 4; ny < GOAL_B; ny += 4) {
      ctx.beginPath(); ctx.moveTo(GOAL_LX, ny); ctx.lineTo(GOAL_LX + GOAL_W, ny); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(GOAL_RX, ny); ctx.lineTo(GOAL_RX + GOAL_W, ny); ctx.stroke();
    }
    for (var nx = GOAL_LX + 3; nx < GOAL_LX + GOAL_W; nx += 3) {
      ctx.beginPath(); ctx.moveTo(nx, GOAL_T); ctx.lineTo(nx, GOAL_B); ctx.stroke();
    }
    for (var nx2 = GOAL_RX + 3; nx2 < GOAL_RX + GOAL_W; nx2 += 3) {
      ctx.beginPath(); ctx.moveTo(nx2, GOAL_T); ctx.lineTo(nx2, GOAL_B); ctx.stroke();
    }

    /* players */
    function drawPlayer(p) {
      var c = p.team === 0 ? C.red : C.blue;
      var cd = p.team === 0 ? C.redDark : C.blueDark;
      /* shadow */
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(p.x + 1, p.y + 2, PLAYER_R, PLAYER_R * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      /* body */
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2); ctx.fill();
      /* highlight */
      ctx.fillStyle = cd;
      ctx.beginPath(); ctx.arc(p.x - 1, p.y - 1, PLAYER_R * 0.55, 0, Math.PI * 2); ctx.fill();
      /* direction indicator */
      var ang = Math.atan2(p.vy, p.vx);
      if (Math.abs(p.vx) > 0.5 || Math.abs(p.vy) > 0.5) {
        ctx.fillStyle = C.white;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(ang) * (PLAYER_R - 1), p.y + Math.sin(ang) * (PLAYER_R - 1), 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      /* kick cooldown flash */
      if (p.kickCD > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R + 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (p1) drawPlayer(p1);
    if (p2) drawPlayer(p2);

    /* ball */
    if (ball) {
      ctx.fillStyle = C.ball;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.ballDot;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, 2, 0, Math.PI * 2); ctx.fill();
    }

    /* HUD — scores + timer */
    ctx.fillStyle = C.hudBg;
    ctx.fillRect(0, 0, W, 24);
    ctx.font = "bold 10px 'Courier New', monospace";
    ctx.textAlign = "center";

    /* red score */
    ctx.fillStyle = C.red;
    ctx.fillText(score[0], W / 2 - 30, 16);
    /* dash */
    ctx.fillStyle = C.hud;
    ctx.fillText("-", W / 2, 16);
    /* blue score */
    ctx.fillStyle = C.blue;
    ctx.fillText(score[1], W / 2 + 30, 16);

    /* timer */
    var mins = Math.floor(timeLeft / 60);
    var secs = Math.floor(timeLeft % 60);
    ctx.fillStyle = timeLeft <= 10 ? "#ff4444" : C.hud;
    ctx.fillText(mins + ":" + (secs < 10 ? "0" : "") + secs, W / 2, H - 4);

    /* "GOAL!" flash */
    if (state === "goal") {
      ctx.fillStyle = "rgba(26,28,44,0.55)";
      ctx.fillRect(0, H / 2 - 18, W, 36);
      ctx.font = "bold 16px 'Courier New', monospace";
      ctx.fillStyle = C.hud;
      ctx.textAlign = "center";
      ctx.fillText("GOAL!", W / 2, H / 2 + 6);
      var scorerColor = goalScorer === 0 ? "RED" : "BLUE";
      ctx.font = "bold 8px 'Courier New', monospace";
      ctx.fillStyle = goalScorer === 0 ? C.red : C.blue;
      ctx.fillText(scorerColor + " SCORES!", W / 2, H / 2 + 18);
    }

    /* kickoff flash */
    if (state === "playing" && stateTimer > 0) {
      ctx.fillStyle = "rgba(247,226,107," + (stateTimer / KICKOFF_PAUSE * 0.6) + ")";
      ctx.font = "bold 10px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillText("KICK OFF", W / 2, H / 2 + 4);
    }
  }

  /* ── game loop ──────────────────────────────────────────────── */
  function loop(ts) {
    var dt = Math.min((ts - lastTime) / 1000, 0.05);
    lastTime = ts;
    tick(dt);

    /* Multiplayer: send input to server at 20Hz */
    if (multiplayerMode && mpSocket && mpSocket.connected) {
      mpSendTimer += dt;
      if (mpSendTimer >= mpSendInterval) {
        mpSendTimer = 0;
        var mx = 0, my = 0;
        if (keys["KeyW"] || keys["ArrowUp"])    my = -1;
        if (keys["KeyS"] || keys["ArrowDown"])  my =  1;
        if (keys["KeyA"] || keys["ArrowLeft"])   mx = -1;
        if (keys["KeyD"] || keys["ArrowRight"])  mx =  1;
        if (touchDir.x !== 0 || touchDir.y !== 0) { mx = touchDir.x; my = touchDir.y; }
        var kickDown = (tapFrame > 0) || !!keys["Space"];
        mpSocket.emit("player-input", { code: mpCode, dx: mx, dy: my, kick: kickDown });
      }
    }

    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(function (ts) { lastTime = ts; loop(ts); });
})();
