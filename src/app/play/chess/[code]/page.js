import ChessJoinClient from "./join-client";

export default async function ChessJoinPage({ params }) {
  const { code } = await params;
  return <ChessJoinClient code={code?.toUpperCase()} />;
}
