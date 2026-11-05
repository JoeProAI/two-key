"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { grantDeskAccess, readDeskAccess } from "@/lib/desk/access";
import { DeskLockedError } from "@/lib/desk/gate";
import { approveSession, cleanApprover, noteDeskError, openPlan, publicError, replaySession } from "@/lib/desk/session";

async function settle(run: () => Promise<void>) {
  try {
    await run();
  } catch (e) {
    // A locked caller does not get to write an error onto the shared desk.
    if (!(e instanceof DeskLockedError)) noteDeskError(publicError(e));
  }
  revalidatePath("/");
}

export async function planDesk() {
  const access = await readDeskAccess();
  await settle(() => openPlan(access));
}

export async function approveDesk(formData: FormData) {
  const access = await readDeskAccess();
  const who = cleanApprover(String(formData.get("approver") ?? ""));
  await settle(() => approveSession(who, access));
}

export async function replayDesk(formData: FormData) {
  const access = await readDeskAccess();
  const who = cleanApprover(String(formData.get("approver") ?? ""));
  await settle(() => replaySession(who, access));
}

export async function unlockDesk(formData: FormData) {
  const ok = await grantDeskAccess(String(formData.get("deskKey") ?? ""));
  revalidatePath("/");
  redirect(ok ? "/" : "/?desk=miss");
}
