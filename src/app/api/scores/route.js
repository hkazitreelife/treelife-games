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
    "2048", "chess", "flappy", "tetris", "pacman",
    "sokoban", "jumpquest", "pixel-soccer", "survivor", "tictactoe",
  ];
  if (!VALID_GAME_TYPES.includes(gameType)) {
    return NextResponse.json(
      { error: "Invalid gameType. Allowed: " + VALID_GAME_TYPES.join(", ") },
      { status: 400 }
    );
  }

  if (typeof score !== "number" || score < 0 || !Number.isFinite(score)) {
    return NextResponse.json(
      { error: "Score must be a non-negative number." },
      { status: 400 }
    );
  }

  const VALID_OPPONENT_TYPES = ["human", "bot", "solo"];
  if (!VALID_OPPONENT_TYPES.includes(opponentType)) {
    return NextResponse.json(
      { error: "Invalid opponentType. Allowed: " + VALID_OPPONENT_TYPES.join(", ") },
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
        opponentType,
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
    `WITH user_best AS (
       SELECT name, game_id, MAX(score) AS best
       FROM treelife_scores
       GROUP BY name, game_id
     ),
     game_max AS (
       SELECT game_id, MAX(score) AS max_score
       FROM treelife_scores
       GROUP BY game_id
     ),
     normalized AS (
       SELECT ub.name, ub.game_id,
         ROUND((ub.best::numeric / gm.max_score) * 100, 1) AS normalized_score
       FROM user_best ub
       JOIN game_max gm ON ub.game_id = gm.game_id
       WHERE gm.max_score > 0
     )
     SELECT name, ROUND(SUM(normalized_score), 1) AS score
     FROM normalized
     GROUP BY name
     ORDER BY score DESC
     LIMIT 10`
  );

  return NextResponse.json({ board: rows });
}
