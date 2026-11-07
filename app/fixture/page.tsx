import { Desk } from "../desk";
import { fixtureBeat, loadFixture } from "@/lib/desk/fixture";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BEATS: { id: string; label: string }[] = [
  { id: "incident", label: "Incident" },
  { id: "blocked", label: "Blocked" },
  { id: "planned", label: "Plan" },
  { id: "failed", label: "Failed send" },
  { id: "paid", label: "Paid once" },
  { id: "replay", label: "Replay" },
];

export default async function FixturePage({ searchParams }: { searchParams: Promise<{ beat?: string }> }) {
  const params = await searchParams;
  const beat = fixtureBeat(params.beat);
  const view = await loadFixture(beat);
  return (
    <main>
      <nav className="beats" aria-label="Fixture beats">
        <span className="beats-label">Fixture</span>
        {BEATS.map((item) => (
          <a key={item.id} href={`/fixture?beat=${item.id}`} aria-current={item.id === beat ? "page" : undefined}>{item.label}</a>
        ))}
        <a href="/fixture/receipt">Receipt JSON</a>
      </nav>
      <Desk view={view} />
    </main>
  );
}
