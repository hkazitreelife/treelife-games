import SoccerJoinClient from "./join-client";

export default async function SoccerJoinPage({ params }) {
  const { code } = await params;
  return <SoccerJoinClient code={code?.toUpperCase()} />;
}
