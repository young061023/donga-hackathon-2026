import { MemberLogin } from "./member-login";

export function AuthGate({
  returnTo,
  invitation = false,
}: {
  returnTo: string;
  invitation?: boolean;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f4f4ee] px-5 py-10 text-[#20251e]">
      <div aria-hidden="true" className="pointer-events-none absolute -left-36 -top-40 h-[26rem] w-[26rem] rounded-full bg-[#dce7c9] blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 -right-28 h-[32rem] w-[32rem] rounded-full bg-[#e8ded0] blur-3xl" />

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-[#e3e3d8] bg-[#fffefa] shadow-[0_28px_90px_-44px_rgba(40,48,34,.35)] md:min-h-[590px] md:grid-cols-[1.04fr_.96fr]">
        <section className="flex flex-col justify-between bg-[#252c22] p-8 text-white sm:p-12">
          <a href="/" className="flex w-fit items-center gap-3" aria-label="모아 홈">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#d4ed85] text-xl font-bold text-[#252c22]">모</span>
            <span className="text-lg font-semibold tracking-tight">모아</span>
          </a>

          <div className="my-12 max-w-md">
            <p className="text-xs font-semibold tracking-[.24em] text-[#d4ed85]">YOUR TEAM, IN MOTION</p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.18] tracking-tight sm:text-5xl">
              생각을 모아,<br />다음 행동으로.
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-7 text-white/70 sm:text-base">
              흩어진 대화는 함께 실행할 계획으로. 모아가 팀의 아이디어와 약속을 기억하고 다음 단계를 이어줍니다.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[.06] p-5">
            <div className="flex items-center justify-between text-xs text-white/55">
              <span>오늘의 팀 대화</span><span>모아가 정리했어요</span>
            </div>
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3 rounded-xl bg-white/[.07] px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d4ed85] text-sm text-[#252c22]">✓</span>
                <div><p className="text-sm font-medium">발표 자료 초안</p><p className="mt-1 text-xs text-white/55">민지 · 금요일까지</p></div>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-white/[.07] px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f1c8a6] text-sm text-[#252c22]">↗</span>
                <div><p className="text-sm font-medium">다음 모임 시간 투표</p><p className="mt-1 text-xs text-white/55">팀원 확인 후 확정</p></div>
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center p-7 sm:p-12">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eef3df] text-2xl">✳</div>
            {invitation && <p className="mb-3 inline-flex rounded-full bg-[#eef3df] px-3 py-1.5 text-xs font-medium text-[#52643b]">팀 초대 링크로 오셨군요</p>}
            <p className="text-sm font-semibold text-[#758064]">다시 만나 반가워요</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">모아에 로그인</h2>
            <p className="mt-3 text-sm leading-6 text-[#73776d]">
              {invitation
                ? "로그인하면 초대한 팀의 공간으로 이어집니다."
                : "팀의 대화와 다음 할 일을 이어서 확인해 보세요."}
            </p>

            <MemberLogin returnTo={returnTo} />

            <div className="my-8 h-px bg-[#ecece4]" />
            <div className="flex gap-3 rounded-xl bg-[#f5f5ef] p-4">
              <span className="mt-0.5 text-[#65744f]">♧</span>
              <p className="text-xs leading-5 text-[#707469]">팀의 대화와 파일은 초대된 팀원만 볼 수 있어요. 모아는 팀의 결정을 대신하지 않습니다.</p>
            </div>

            <a href="/" className="mt-8 inline-flex text-sm font-medium text-[#62685b] hover:text-[#252c22]">← 모아 소개로 돌아가기</a>
          </div>
        </section>
      </div>
    </main>
  );
}
