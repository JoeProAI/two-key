export default function Missing() {
  return (
    <main>
      <header className="mast">
        <p className="brand">Two-Key</p>
        <p className="where">INV-2291</p>
      </header>
      <section className="sheet">
        <div className="mark" data-tone="lock">
          <h1 className="face ink">Missing page</h1>
          <div className="cut" aria-hidden="true"><p className="face light">Missing page</p></div>
        </div>
        <p className="reason">That page is not on this desk.</p>
        <p className="actions"><a className="quiet-link" href="/fixture">Open the mock fixture</a></p>
      </section>
    </main>
  );
}
