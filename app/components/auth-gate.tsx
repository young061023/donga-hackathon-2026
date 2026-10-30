import { chatGPTSignInPath } from "../chatgpt-auth";

function EntryIcon({ name, className = "" }: { name: string; className?: string }) {
  return <svg className={`entry-icon ${className}`} width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href={`/icons/lucide/sprite.svg?v=1.65.0#${name}`} /></svg>;
}

export function AuthGate({ returnTo, invitation = false }: { returnTo: string; invitation?: boolean }) {
  return (
    <>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap" />
      <link rel="stylesheet" href="/entry.css?v=teamplay-1" />
      <main className="entry-page entry-login">
        <header className="entry-header">
          <a className="entry-brand" href="/" aria-label="팀플이냐 팀킬이냐 홈"><span className="entry-brand-mark"><EntryIcon name="network" /></span><span>팀플이냐 팀킬이냐</span></a>
          <a className="entry-header-link" href="/landing.html">어떤 서비스인가요? <EntryIcon name="arrow-up-right" /></a>
        </header>

        <div className="entry-login-main">
          <section className="entry-login-copy">
            <p className="entry-eyebrow">팀 프로젝트를 위한 작은 회의실</p>
            <h1>조별 과제,<br /><span className="entry-highlight">같이 끝내자.</span></h1>
            <p className="entry-lead">의견은 한곳에, 할 일은 분명하게.<br />다음 모임까지 챙기는 우리 팀의 공간이에요.</p>
          </section>
          <div className="entry-login-preview">
            <div className="entry-task-paper" aria-label="팀 공간 예시">
              <div className="entry-paper-head"><strong>이번 주 팀플</strong><span>화면 예시 · 4명</span></div>
              <div className="entry-paper-row"><span className="entry-paper-check done"><EntryIcon name="check" /></span><span className="entry-paper-task">자료 조사 정리하기<small>의견과 참고 자료 함께 확인</small></span><span className="entry-paper-owner">지민</span><span className="entry-paper-state done">완료</span></div>
              <div className="entry-paper-row"><span className="entry-paper-check" /><span className="entry-paper-task">발표 자료 초안 만들기<small>다음 모임에서 같이 살펴보기</small></span><span className="entry-paper-owner">수아</span><span className="entry-paper-state">진행 중</span></div>
              <div className="entry-paper-row"><span className="entry-paper-calendar"><EntryIcon name="calendar-days" /></span><span className="entry-paper-task">다음 모임 시간 정하기<small>가능한 시간에 한 표씩</small></span><span className="entry-paper-owner">모두</span><span className="entry-paper-state">투표 중</span></div>
            </div>
            <div className="entry-login-tools"><span>팀 대화</span><i /><span>생각 지도</span><i /><span>할 일</span><i /><span>모임 일정</span></div>
          </div>

          <section className="entry-login-card" aria-labelledby="entry-login-title">
            {invitation && <p className="entry-invitation">팀에서 초대했어요</p>}
            <span className="entry-card-mark"><EntryIcon name="circle-user-round" /></span>
            <h2 id="entry-login-title">우리 팀 회의실로<br />들어가볼까요?</h2>
            <p className="entry-card-description">{invitation ? "로그인하면 초대받은 팀에 참여할 수 있어요." : "팀의 대화와 할 일을 이어서 확인하세요."}</p>
            <a className="entry-login-button" href={chatGPTSignInPath(returnTo)} target="_top"><span>ChatGPT 계정으로 로그인</span><EntryIcon name="arrow-up-right" /></a>
            <p className="entry-signin-note">기존 ChatGPT 계정으로 이용할 수 있어요.</p>
            <div className="entry-private-note"><EntryIcon name="check" /><p>팀의 대화와 파일은<br />초대된 팀원끼리 확인해요.</p></div>
            <a className="entry-card-about" href="/landing.html">먼저 둘러보기 <EntryIcon name="arrow-up-right" /></a>
          </section>
        </div>

        <footer className="entry-login-footer"><span>팀플이냐 팀킬이냐</span><p>이번 팀플은, 같이 해보자.</p></footer>
      </main>
    </>
  );
}
