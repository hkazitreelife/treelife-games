"use client";
import Link from "next/link";

import { useState, useEffect, useCallback } from "react";
import { io } from "socket.io-client";
import ChessGame from "@/components/chess-game";

export default function ChessJoinClient({ code }) {
  const [name, setName] = useState("");
  const [phase, setPhase] = useState("name"); // name | error | waiting | game
  const [errorMsg, setErrorMsg] = useState("");
  const [socket, setSocket] = useState(null);
  const [roomData, setRoomData] = useState(null);
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
      setRoomData({ ...data, playerName: trimmed });
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

    s.on("match-abandoned", (data) => {
      setPhase("error");
      setErrorMsg(data?.reason || "Match abandoned — opponent disconnected.");
      s.disconnect();
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
          <Link href="/" className="join-btn">
            BACK TO ARCADE
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "name") {
    return (
      <div className="join-screen">
        <div className="join-panel">
          <div className="join-title">PIXEL CHESS — MULTIPLAYER</div>
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
                : `/play/chess/${code}`}
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

  return (
    <ChessGame
      multiplayerCode={code}
      playerName={name.toUpperCase()}
      socket={socket}
      roomData={roomData}
      gameReadyData={gameReadyData}
    />
  );
}
