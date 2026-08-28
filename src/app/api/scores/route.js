import { NextResponse } from "next/server";
import { getPool, ensureSchema } from "@/lib/db";

export async function POST(request) {
  await ensureSchema();
  const body = await request.json();
  const { name, gameType, score, opponentType } = body;

  if (!name || !gameType || typeof score !== "number") {
    return NextResponse.json(
      { error: "Missing required fields: name, gameType, score" },
      { status: 400 }
    );
  }

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
