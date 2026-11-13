import type { DocPage } from "./nav";

/** Docs sidebar order. Kept out of the client nav so client code names no provider. */
export const PAGES: DocPage[] = [
  { href: "/docs", label: "Overview", note: "What it is" },
  { href: "/docs/quickstart", label: "Quickstart", note: "Run the proof" },
  { href: "/docs/architecture", label: "Architecture", note: "Two keys, one tap" },
  { href: "/docs/airwallex", label: "Airwallex map", note: "Endpoint to test" },
  { href: "/docs/claims", label: "Claims and limits", note: "Each with a command" },
  { href: "/docs/red-team", label: "Red team", note: "28 attacks" },
  { href: "/docs/evidence", label: "Evidence", note: "Runs on record" },
];
