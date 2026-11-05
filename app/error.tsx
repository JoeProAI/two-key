"use client";

export default function DeskError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="desk-wrap">
      <p className="kicker">Payment ops</p>
      <h1>Two-Key</h1>
      <p className="banner" role="alert">The desk could not load this incident. The receipt was not changed.</p>
      <button type="button" className="ghost" onClick={reset}>Reload the desk</button>
    </main>
  );
}
