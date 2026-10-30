"use client";
import { useState, type FormEvent } from "react";
export function MemberLogin({ returnTo }: { returnTo: string }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: register ? "register" : "login", email: data.get("email"), password: data.get("password"), name: data.get("name"), returnTo }) });
      const result = await response.json() as { error?: string; returnTo: string };
      if (!response.ok) { setError(result.error || "로그인에 실패했습니다."); return; }
      window.location.assign(result.returnTo);
    } catch { setError("서버에 연결하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  const inputClass = "mt-2 w-full rounded-xl border border-[#d9ddcf] bg-white px-4 py-3 text-sm text-[#252c22] focus:outline-none focus:ring-2 focus:ring-[#758064]";
  return <form onSubmit={submit} className="mt-7 space-y-4">
    {register && <label className="block text-sm font-medium">이름<input name="name" autoComplete="name" required maxLength={60} className={inputClass} /></label>}
    <label className="block text-sm font-medium">이메일<input name="email" type="email" autoComplete="email" required maxLength={254} className={inputClass} /></label>
    <label className="block text-sm font-medium">비밀번호<input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={10} maxLength={128} className={inputClass} /></label>
    {register && <p className="text-xs text-[#73776d]">비밀번호는 10자 이상 입력해 주세요.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button disabled={busy} className="w-full rounded-xl bg-[#252c22] px-5 py-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "처리 중…" : register ? "가입하고 시작하기" : "로그인"}</button>
    <button type="button" disabled={busy} onClick={() => { setRegister(!register); setError(""); }} className="w-full text-center text-sm text-[#52643b] underline">{register ? "이미 계정이 있나요? 로그인" : "처음 오셨나요? 회원가입"}</button>
  </form>;
}
