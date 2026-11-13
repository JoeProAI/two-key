import { fixtureBeat, fixtureCsv, fixturePack } from "@/lib/desk/fixture";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const beat = fixtureBeat(url.searchParams.get("beat") ?? "paid");
  if (url.searchParams.get("format") === "csv") {
    return new Response(await fixtureCsv(beat), {
      headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const pack = await fixturePack(beat);
  return Response.json(pack, { headers: { "cache-control": "no-store" } });
}
