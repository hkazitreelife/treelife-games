# Treelife Arcade - Deployment Guide

Single-server deployment for the Treelife Arcade portal.
Written for someone who has not seen this codebase before.

---

## Stack Overview

| Layer | What | Why |
|-------|------|-----|
| Runtime | Node.js (custom server.js, NOT next dev) | Serves Next.js + Socket.IO from one HTTP server. next start does NOT include Socket.IO. |
| Framework | Next.js 16 (React 19) | App router, server components, Tailwind CSS |
| Multiplayer | Socket.IO 4 | Room-code system for Chess, Tic-Tac-Toe, Pixel Soccer |
| Database | PostgreSQL (via pg library) | Leaderboard scores. Schema auto-creates on first request. |
| Process Manager | PM2 | Keeps the server alive across crashes and reboots. |

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18+ (recommended: 20 LTS) | node -v to check |
| npm | 9+ | Ships with Node 18+ |
| PostgreSQL | 12+ (recommended: 14 or 16) | Local or managed (Railway, Supabase, Neon, AWS RDS) |
| PM2 | latest | npm install -g pm2 |
| Nginx or Caddy | latest | Reverse proxy for TLS and WebSocket |
---

## Setup Steps

### 1. Get the code

Unzip the deployment package into a directory on the VPS:

    mkdir -p /opt/treelife-arcade
    cd /opt/treelife-arcade
    unzip treelife-arcade-deploy.zip
    cd portal

### 2. Install dependencies

    npm install

Reads package-lock.json and installs exact dependency versions.

### 3. Create the PostgreSQL database

Connect to Postgres and create the database:

    CREATE DATABASE treelife_arcade;

The treelife_scores table auto-creates on first score submission.
No manual migration needed.

### 4. Create .env.local

Create portal/.env.local (gitignored, never included in the zip):

    DATABASE_URL=postgresql://treelife_user:CHANGE_ME@localhost:5432/treelife_arcade

Replace: treelife_user, CHANGE_ME (a real password), localhost:5432, treelife_arcade.

WARNING: The dev password is the Postgres default. MUST be changed for any VPS deployment.

DATABASE_URL format: postgresql://USERNAME:PASSWORD@HOST:PORT/DATABASE_NAME

### 5. Build the production bundle

    npm run build

Creates .next/ directory. Server auto-detects production mode.

### 6. Start the server

Option A (testing): node server.js

Option B (production, recommended): pm2 start ecosystem.config.js

PM2 commands: pm2 status, pm2 logs treelife-arcade, pm2 restart treelife-arcade, pm2 stop treelife-arcade

Surviving a reboot (Linux): pm2 startup then pm2 save.
---

## Reverse Proxy (Nginx)

The app needs a reverse proxy for TLS and to proxy Socket.IO WebSocket upgrade.

Minimal Nginx config:

    server {
        listen 80;
        server_name your-domain.com;
        location / {
            proxy_pass http://127.0.0.1:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade ;
            proxy_set_header Connection upgrade;
            proxy_set_header Host ;
            proxy_set_header X-Real-IP ;
            proxy_set_header X-Forwarded-For ;
            proxy_set_header X-Forwarded-Proto ;
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }
    }

For HTTPS, install Certbot and run certbot --nginx -d your-domain.com

With Caddy (handles WebSocket automatically): your-domain.com { reverse_proxy localhost:3000 }

---

## How to Verify It Works

1. Health check: curl -i https://your-domain.com/ -> should return HTTP 200
2. Score test: play a game (e.g. 2048), reach game over, check leaderboard shows your score
3. Multiplayer test: Device A creates a room, Device B joins with the code, moves sync in real-time
4. PM2 test: kill the process, wait 5s, confirm PM2 restarted it
---

## Architecture Notes

- server.js is the entry point. It creates an HTTP server serving both Next.js and Socket.IO.
  Do NOT use next start -- it does not attach Socket.IO and multiplayer breaks.
- Room system: Chess, Tic-Tac-Toe, Pixel Soccer use room codes. Rooms expire after 15 min inactivity.
- Score normalization: leaderboard uses (per-game best / global best) * 100, summed across games played.
  A player with one excellent score can outrank a player with many mediocre scores.
- Static games: 2048, Flappy Bird, Tetris, Pac-Man, Sokoban, Jump Quest, Pixel Survivor are
  served from public/games/ as iframes. They communicate scores via postMessage.
- Schema auto-migration: the treelife_scores table creates itself on first use.

---

## Known Gaps

1. Rate limiting on score submissions: /api/scores POST has no rate limiting.
   For office-internal use this is fine. If exposed publicly, add per-IP throttle.

2. Score submission not implemented for 4 games: Tetris, Jump Quest, Flappy Bird,
   Pixel Survivor. These are vendored/compiled binaries without clean game-over hooks.

3. Authentication is name-entry only. No real auth system. For untrusted users,
   this would need proper authentication.

4. Leaderboard is top-10 only. No pagination or per-game breakdown on the frontend.

---

## File Structure

    portal/
    +-- server.js                    # Entry point (Next.js + Socket.IO)
    +-- ecosystem.config.js          # PM2 config
    +-- package.json                 # Dependencies and scripts
    +-- src/
    |   +-- app/
    |   |   +-- page.js              # Landing page (name entry, game grid, leaderboard)
    |   |   +-- api/scores/route.js  # Score submission + leaderboard API
    |   |   +-- play/                # Multiplayer join routes
    |   +-- components/
    |   |   +-- chess-game.jsx       # Chess multiplayer component
    |   |   +-- tictactoe-game.jsx   # Tic-tac-toe multiplayer component
    |   +-- lib/
    |       +-- db.js                # Postgres pool + schema auto-migration
    |       +-- pixel-soccer-engine.js  # Server-authoritative game logic
    |       +-- socket-server.js     # Socket.IO room management
    +-- public/
    |   +-- game/                    # Flappy Bird (compiled)
    |   +-- games/                   # Static game directories
    +-- DEPLOY.md                    # This file
    +-- .env.example                 # Template for .env.local
    +-- .env.local                   # Secrets (NEVER commit or ship in zip)
    +-- .gitignore                   # Git ignore rules
    +-- next.config.mjs              # Next.js config
