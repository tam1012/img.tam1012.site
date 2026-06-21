import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IMG Studio",
  description: "AI Image Generator",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
