import type { ReactNode } from "react";
import { Anton, Figtree, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Anton({
  subsets: ["latin"],
  variable: "--face-display",
  weight: "400",
});
const body = Figtree({
  subsets: ["latin"],
  variable: "--face-body",
  weight: ["400", "500", "600", "700"],
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--face-mono",
  weight: ["400", "500"],
});

export const metadata = {
  title: "Two-Key | INV-2291",
  description: "Payment incident desk for INV-2291. One plan, one tap, one receipt.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
