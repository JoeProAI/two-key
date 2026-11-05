import type { ReactNode } from "react";
import { Fraunces, IBM_Plex_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], variable: "--face-display" });
const body = Source_Serif_4({ subsets: ["latin"], variable: "--face-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--face-mono" });

export const metadata = {
  title: "Two-Key · INV-2291",
  description: "Payment ops desk for the failed Northwind Steel transfer.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
