import type { ReactNode } from "react";
import { DocsNav } from "./nav";
import { REPO } from "./kit";
import { PAGES } from "./pages";

export const metadata = {
  title: "Two-Key docs",
  description: "How Two-Key fixes a failed supplier payment without paying twice, and the command that proves each claim.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="docs">
      <a className="skip" href="#doc">Skip to the page</a>
      <header className="mast docs-mast">
        <p className="brand"><a href="/docs">Two-Key <span>docs</span></a></p>
        <p className="mock">MOCK desk. No real money moves.</p>
        <p className="mast-links">
          <a href="/fixture">Desk fixture</a>
          <a href={REPO}>GitHub</a>
        </p>
      </header>
      <div className="docs-body">
        <aside className="docs-side">
          <DocsNav pages={PAGES} />
        </aside>
        <main id="doc" className="doc">
          {children}
        </main>
      </div>
    </div>
  );
}
