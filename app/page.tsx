import { Desk } from "./desk";
import { getDeskView } from "@/lib/desk/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Page() {
  const view = await getDeskView();
  return (
    <main>
      <Desk view={view} />
    </main>
  );
}
