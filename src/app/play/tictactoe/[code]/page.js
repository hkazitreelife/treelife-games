import TictactoeJoinClient from "./join-client";

export default async function TictactoeJoinPage({ params }) {
  const { code } = await params;
  return <TictactoeJoinClient code={code?.toUpperCase()} />;
}
