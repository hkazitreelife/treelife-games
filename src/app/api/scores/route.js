import { NextResponse } from "next/server";
import { getPool, ensureSchema } from "@/lib/db";

export async function POST(request) {
  await ensureSchema();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }
  const { name, gameType, score, opponentType } = body;

  if (!name || !gameType || typeof score !== "number") {
    return NextResponse.json(
      { error: "Missing required fields: name, gameType, score" },
      { status: 400 }
    );
  }

  const VALID_GAME_TYPES = [
    "2048", "chess", "flappy-bird", "tetris", "pacman",
    "sokoban", "jumpquest", "pixel-soccer", "survivor", "tictactoe",
  ];
  if (!VALID_GAME_TYPES.includes(gameType)) {
    return NextResponse.json(
      { error: "Invalid gameType. Allowed: " + VALID_GAME_TYPES.join(", ") },
      { status: 400 }
    );
  }

  if (typeof score !== "number" || score < 0 || score > 100 || !Number.isFinite(score)) {
    return NextResponse.json(
      { error: "Score must be a number between 0 and 100." },
      { status: 400 }
    );
  }

  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO treelife_scores (name, game_id, score, opponent_type)
       VALUES ($1, $2, $3, $4)`,
      [
        String(name).slice(0, 20),
        String(gameType).slice(0, 30),
        Math.round(score),
        opponentType === "human" ? "human" : "bot",
      ]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[scores] POST failed:", err.message);
    return NextResponse.json(
      { error: "Failed to save score. Please try again." },
      { status: 500 }
    );
  }
}

export async function GET() {
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT name, SUM(score) AS score
     FROM treelife_scores
     GROUP BY name
     ORDER BY score DESC
     LIMIT 10`
  );

  return NextResponse.json({ board: rows });
}
