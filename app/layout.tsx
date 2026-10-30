import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "모아 — 팀의 생각을 모아 다음 행동으로",
  description: "팀의 대화와 약속을 함께 실행할 계획으로 잇는 AI 조장 모아.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
