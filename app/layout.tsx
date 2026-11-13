import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";

const label = localFont({
  src: "./fonts/Archivo-Var.woff2",
  variable: "--face-label",
  weight: "100 900",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
});
const body = localFont({
  src: "./fonts/IBMPlexSans-Variable.ttf",
  variable: "--face-body",
  weight: "400 700",
  display: "swap",
});
const mono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-Medium.ttf", weight: "500", style: "normal" },
  ],
  variable: "--face-mono",
  display: "swap",
});

export const metadata = {
  title: "Two-Key | INV-2291",
  description: "Payment incident desk for INV-2291. One plan, one tap, one receipt.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${label.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
