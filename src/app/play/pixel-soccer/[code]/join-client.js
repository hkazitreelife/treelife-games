"use client";

import { useState, useEffect, useCallback } from "react";
import { io } from "socket.io-client";

export default function SoccerJoinClient({ code }) {
  const [name, setName] = useState("");
  const [phase, setPhase] = useState("name"); // name | error | waiting | game
  const [errorMsg, setErrorMsg] = useState("");
  const [socket, setSocket] = useState(null);
  const [team, setTeam] = useState(-1);
  const [gameReadyData, setGameReadyData] = useState(null);

  useEffect(() => {
    if (!code) {
      setPhase("error");
      setErrorMsg("No room code provided.");
    }
  }, [code]);

  const handleJoin = useCallback(() => {
    const trimmed = name.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (!trimmed) {
      setErrorMsg("TYPE SOMETHING FIRST");
      return;
    }

    const s = io(window.location.origin, {
      transports: ["websocket", "polling"],
    });

    s.on("connect", () => {
      s.emit("join-room", { code, playerName: trimmed });
    });

    s.on("room-joined", (data) => {
      const myTeam = data.team != null ? data.team : (data.players.length === 1 ? 0 : 1);
      setTeam(myTeam);
      setSocket(s);
      setPhase(data.players.length === 2 ? "game" : "waiting");
    });

    s.on("room-error", (data) => {
      setPhase("error");
      setErrorMsg(data.reason || "Room not found or full.");
      s.disconnect();
    });

    s.on("game-ready", (data) => {
      setGameReadyData(data);
      setPhase("game");
    });

    s.on("connect_error", () => {
      setPhase("error");
      setErrorMsg("Could not connect to server.");
    });

    setPhase("waiting");
  }, [name, code]);

  if (phase === "error") {
    return (
      <div className="join-screen">
        <div className="join-panel">
          <div className="join-title">ROOM NOT FOUND OR FULL</div>
          <div className="join-sub">{errorMsg}</div>
          <a href="/" className="join-btn">
            BACK TO ARCADE
          </a>
        </div>
      </div>
    );
  }

  if (phase === "name") {
    return (
      <div className="join-screen">
        <div className="join-panel">
          <div className="join-title">PIXEL SOCCER — MULTIPLAYER</div>
          <div className="join-sub">
            ROOM CODE: <span className="join-code">{code}</span>
          </div>
          <div className="join-label">ENTER YOUR NAME</div>
          <div className="join-input-wrap">
            <input
              className="join-input"
              maxLength={12}
              autoFocus
              value={name}
              onChange={(e) => {
                setErrorMsg("");
                setName(
                  e.target.value
                    .replace(/[^a-zA-Z0-9]/g, "")
                    .slice(0, 12)
                );
              }}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            />
          </div>
          <div className="join-error">{errorMsg}</div>
          <button className="join-btn" onClick={handleJoin}>
            &gt; JOIN GAME &lt;
          </button>
        </div>
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div className="join-screen">
        <div className="join-panel">
          <div className="join-title">WAITING FOR OPPONENT...</div>
          <div className="join-sub">
            SHARE THIS LINK:
            <br />
            <span className="join-code">
              {typeof window !== "undefined"
                ? window.location.href
                : `/play/pixel-soccer/${code}`}
            </span>
          </div>
          <button
            className="join-btn"
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href);
            }}
          >
            COPY LINK
          </button>
          <div className="join-sub" style={{ marginTop: 16, opacity: 0.6 }}>
            ROOM: {code} &middot; YOU: {name.toUpperCase()}
          </div>
        </div>
      </div>
    );
  }

  /* phase === "game" — render the pixel-soccer iframe with multiplayer params */
  const iframeSrc = `/games/pixel-soccer/index.html?code=${code}&name=${encodeURIComponent(name.toUpperCase())}&team=${team}`;

  return (
    <div style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#222034" }}>
      <div style={{ position: "relative", width: "min(96vw, calc((100vh - 40px) * 4 / 3))", aspectRatio: "4 / 3", border: "4px solid #F7E26B", background: "#1A1C2C" }}>
        <iframe
          src={iframeSrc}
          style={{ width: "100%", height: "100%", border: "none" }}
          allow="autoplay"
        />
      </div>
      <div style={{ color: "#F7E26B", fontFamily: "'Press Start 2P', monospace", fontSize: "8px", marginTop: 8, opacity: 0.5 }}>
        ROOM: {code} &middot; YOU: {name.toUpperCase()} ({team === 0 ? "RED" : "BLUE"})
      </div>
    </div>
  );
}
