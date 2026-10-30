import { AuthGate } from "../components/auth-gate";

export const dynamic = "force-dynamic";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ join?: string }>;
}) {
  const { join } = await searchParams;
  const returnTo = join
    ? `/app/?join=${encodeURIComponent(join)}`
    : "/app/";

  return <AuthGate returnTo={returnTo} invitation={Boolean(join)} />;
}
