import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent World · Operating Environment",
  description: "World и Command как две проекции одного канонического состояния агентов.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0b1210",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
