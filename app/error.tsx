"use client";

export default function DeskError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <header className="mast">
        <p className="brand">Two-Key</p>
        <p className="where">INV-2291</p>
      </header>
      <section className="sheet">
        <div className="mark" data-tone="fail">
          <h1 className="face ink">Not loaded</h1>
          <div className="cut" aria-hidden="true"><p className="face light">Not loaded</p></div>
        </div>
        <p className="reason">The desk could not load this incident. The receipt was not changed.</p>
        <p className="actions"><button type="button" onClick={reset}>Reload the desk</button></p>
      </section>
    </main>
  );
}
