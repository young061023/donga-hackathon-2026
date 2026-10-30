import { safeReturn } from "../../lib/session";
import { AuthGate } from "../components/auth-gate";

export const dynamic = "force-dynamic";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ join?: string; return_to?: string }>;
}) {
  const { join, return_to } = await searchParams;
  const returnTo = join
    ? `/app/?join=${encodeURIComponent(join)}`
    : safeReturn(return_to);

  return <AuthGate returnTo={returnTo} invitation={Boolean(join)} />;
}
