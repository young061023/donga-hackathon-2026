import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "팀플이냐 팀킬이냐 | 팀 프로젝트를 한곳에서",
  description: "팀의 대화, 할 일과 모임 일정을 한곳에서 정리하는 팀 프로젝트 공간.",
  icons: {
    icon: "/favicon.svg?v=teamplay",
    shortcut: "/favicon.svg?v=teamplay",
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
