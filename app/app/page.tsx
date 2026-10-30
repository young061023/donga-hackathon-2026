import { getChatGPTUser } from "../chatgpt-auth";
import { AuthGate } from "../components/auth-gate";

export const dynamic = "force-dynamic";

export default async function Workspace({ searchParams }: { searchParams: Promise<{ join?: string }> }) {
  const { join } = await searchParams;
  const user = await getChatGPTUser();
  if (!user) {
    const returnTo = join ? `/app/?join=${encodeURIComponent(join)}` : "/app/";
    return <AuthGate returnTo={returnTo} invitation={Boolean(join)} />;
  }

  const joinQuery = join ? `?join=${encodeURIComponent(join)}` : "";
  return <main className="fixed inset-0 bg-[#f7f8f5]"><iframe title="모아 팀 협업 공간" src={`/app.html${joinQuery}`} className="h-full w-full border-0" /></main>;
}
