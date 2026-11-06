"use client";

export default function DeskError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="desk-wrap">
      <header className="bar">
        <p className="brand">Two-Key</p>
        <p className="kicker">INV-2291</p>
      </header>
      <p className="banner" role="alert"><span className="tag">Error</span>The desk could not load this incident. The receipt was not changed.</p>
      <p><button type="button" onClick={reset}>Reload the desk</button></p>
    </main>
  );
}
