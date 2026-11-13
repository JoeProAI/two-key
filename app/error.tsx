"use client";

export default function DeskError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <header className="mast">
        <p className="brand">Two-Key</p>
        <p className="mock">MOCK. No real money moves.</p>
      </header>
      <section className="money">
        <h1>Not loaded</h1>
        <p className="lead">The desk could not load this incident. The receipt was not changed.</p>
        <p className="actions"><button type="button" onClick={reset}>Reload the desk</button></p>
      </section>
    </main>
  );
}
