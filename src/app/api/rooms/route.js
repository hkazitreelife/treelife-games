import { NextResponse } from "next/server";
import { rooms, generateCode, makeRoom } from "@/lib/socket-server";

export async function POST(request) {
  const body = await request.json();
  const { gameType } = body;

  if (gameType !== "chess" && gameType !== "tictactoe" && gameType !== "pixel-soccer") {
    return NextResponse.json(
      { error: "Invalid gameType. Must be 'chess' or 'tictactoe'." },
      { status: 400 }
    );
  }

  const code = generateCode(6);
  const room = makeRoom(gameType);
  rooms.set(code, room);

  return NextResponse.json({
    code,
    url: `/play/${gameType}/${code}`,
  });
}
