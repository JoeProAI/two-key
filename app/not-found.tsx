export default function Missing() {
  return (
    <main className="desk-wrap">
      <header className="bar">
        <p className="brand">Two-Key</p>
        <p className="kicker">INV-2291</p>
      </header>
      <p className="empty">That page is not on this desk. The public fixture is at /fixture.</p>
      <p><a className="text-link" href="/fixture">Open the public fixture</a></p>
    </main>
  );
}
