# 모아 (Moa)

팀 채팅과 브레인스토밍에서 의견, 결정, 일정, 할 일을 모아 다음 행동으로 이어주는 협업 서비스입니다.

## 기술 구성

- Next.js 호환 앱: Vinext + React
- API 및 서버: Cloudflare Workers
- 데이터: Cloudflare D1 + Drizzle ORM
- 과제 사진·파일: Cloudflare R2
- 로그인: ChatGPT 계정 인증 (Sites SIWC)

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run dev
```

## 배포 빌드

```sh
npm run build
```

Sites 환경에서는 `.openai/hosting.json`이 D1/R2 바인딩 이름과 사이트 프로젝트를 지정하고, `drizzle/`에는 데이터베이스 마이그레이션이 들어 있습니다. 인증 및 데이터 바인딩은 배포 환경에서 설정합니다. 비밀 키는 `.env` 또는 `.dev.vars` 파일에 두고 저장소에 커밋하지 마세요.
