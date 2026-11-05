import { Desk } from "./desk";
import { readDeskAccess } from "@/lib/desk/access";
import { getDeskView } from "@/lib/desk/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Page({ searchParams }: { searchParams: Promise<{ desk?: string }> }) {
  const [access, params] = await Promise.all([readDeskAccess(), searchParams]);
  const view = await getDeskView(access, { keyMissed: params.desk === "miss" });
  return (
    <main>
      <Desk view={view} />
    </main>
  );
}
