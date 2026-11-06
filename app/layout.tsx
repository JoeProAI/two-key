import type { ReactNode } from "react";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Archivo({ subsets: ["latin"], variable: "--face-display", weight: ["500", "700", "800"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--face-mono", weight: ["400", "500"] });

export const metadata = {
  title: "Two-Key | INV-2291",
  description: "Payment incident desk for INV-2291. One plan, one tap, one receipt.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
