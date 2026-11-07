import { Desk } from "../desk";
import { fixtureBeat, loadFixture } from "@/lib/desk/fixture";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BEATS: { id: string; label: string }[] = [
  { id: "incident", label: "Incident" },
  { id: "blocked", label: "Checker blocked" },
  { id: "planned", label: "Revised plan" },
  { id: "refused", label: "Changed terms" },
  { id: "failed", label: "Simulation failed" },
  { id: "paid", label: "Simulated payment" },
  { id: "replay", label: "Replay check" },
];

export default async function FixturePage({ searchParams }: { searchParams: Promise<{ beat?: string }> }) {
  const params = await searchParams;
  const beat = fixtureBeat(params.beat);
  const view = await loadFixture(beat);
  const demo = (
    <details className="demo">
      <summary>Demo controls</summary>
      <nav aria-label="Fixture beats">
        {BEATS.map((item) => (
          <a key={item.id} href={`/fixture?beat=${item.id}`} aria-current={item.id === beat ? "page" : undefined}>{item.label}</a>
        ))}
        <a href="/fixture/receipt">Receipt JSON</a>
      </nav>
    </details>
  );
  return (
    <main>
      <Desk view={view} demo={demo} />
    </main>
  );
}
