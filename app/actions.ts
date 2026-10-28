"use server";

import { revalidatePath } from "next/cache";
import { approveSession, cleanApprover, noteDeskError, openPlan, publicError, replaySession } from "@/lib/desk/session";

async function settle(run: () => Promise<void>) {
  try {
    await run();
  } catch (e) {
    noteDeskError(publicError(e));
  }
  revalidatePath("/");
}

export async function planDesk() {
  await settle(() => openPlan());
}

export async function approveDesk(formData: FormData) {
  const who = cleanApprover(String(formData.get("approver") ?? ""));
  await settle(() => approveSession(who));
}

export async function replayDesk(formData: FormData) {
  const who = cleanApprover(String(formData.get("approver") ?? ""));
  await settle(() => replaySession(who));
}
