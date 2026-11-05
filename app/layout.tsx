import type { ReactNode } from "react";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans, Syne } from "next/font/google";
import "./globals.css";

const display = Syne({ subsets: ["latin"], variable: "--face-display", weight: ["600", "700"] });
const figure = Fraunces({ subsets: ["latin"], variable: "--face-figure" });
const body = IBM_Plex_Sans({ subsets: ["latin"], variable: "--face-body", weight: ["400", "500"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--face-mono" });

export const metadata = {
  title: "Two-Key · INV-2291",
  description: "Payment incident desk. One plan, one tap, one receipt.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${figure.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
