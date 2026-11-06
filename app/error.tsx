"use client";

export default function DeskError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <header className="mast">
        <p className="brand">Two-Key</p>
        <p className="where">INV-2291</p>
      </header>
      <h1 role="alert"><em className="accent">Not loaded.</em> The desk could not load this incident. The receipt was not changed.</h1>
      <p className="actions"><button type="button" onClick={reset}>Reload the desk</button></p>
    </main>
  );
}
