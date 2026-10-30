import { chatGPTSignOutPath, getChatGPTUser } from "./chatgpt-auth";
import { AuthGate } from "./components/auth-gate";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) {
    return <AuthGate returnTo="/" />;
  }

  const signOutPath = encodeURIComponent(chatGPTSignOutPath("/login/"));
  return <main className="fixed inset-0 bg-[#f6f6f1]"><iframe title="모아 서비스 소개" src={`/landing.html?signout=${signOutPath}`} className="h-full w-full border-0" /></main>;
}
