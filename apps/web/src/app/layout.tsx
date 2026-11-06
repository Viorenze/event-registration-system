import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Event Registration System",
  description: "Multi-tenant event registration system",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
