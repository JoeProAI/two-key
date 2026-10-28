import { AirwallexError, type AirwallexClient, type TransferStatus } from "./types";

type DriveClient = Pick<AirwallexClient, "getTransfer" | "simulateTransferTransition">;

export interface TransferDrive {
  hops: string[];
  finalStatus: string;
  /** True when a GET right after FAILED already showed CANCELLED, before an explicit CANCELLED call. */
  autoCancelled: boolean;
}

/**
 * Sandbox only. Walks a transfer to FAILED and then CANCELLED.
 *
 * Direct FAILED from SCHEDULED or PROCESSING returned 500 `operation_failed` on the sandbox
 * (2026-10-27). PROCESSING -> SENT -> FAILED worked, and the following GET was already
 * CANCELLED (failed transfers are cancelled within seconds). An explicit CANCELLED call on
 * an already-CANCELLED transfer also returned 500, so that call is skipped once the GET
 * shows CANCELLED.
 */
export async function driveFailedThenCancelled(
  awx: DriveClient,
  id: string,
  failureType: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<TransferDrive> {
  const hops: string[] = [];
  let current = (await awx.getTransfer(id)).status;
  if (current === "CANCELLED") {
    return { hops: ["already CANCELLED"], finalStatus: current, autoCancelled: false };
  }

  if (current === "SCHEDULED" || current === "OVERDUE") {
    for (let i = 0; i < 5 && (current === "SCHEDULED" || current === "OVERDUE"); i++) {
      await sleep(1000);
      current = (await awx.getTransfer(id)).status;
      hops.push(`poll=${current}`);
    }
  }
  if (current === "SCHEDULED" || current === "OVERDUE") await step(awx, id, failureType, "PROCESSING", () => current, (s) => { current = s; }, hops);
  if (current === "SCHEDULED" || current === "PROCESSING" || current === "OVERDUE") {
    await step(awx, id, failureType, "SENT", () => current, (s) => { current = s; }, hops);
  }
  if (current !== "FAILED" && current !== "CANCELLED") {
    await step(awx, id, failureType, "FAILED", () => current, (s) => { current = s; }, hops);
  }

  let read = await awx.getTransfer(id);
  current = read.status;
  if (current === "CANCELLED") {
    hops.push("read-back=CANCELLED");
    return { hops, finalStatus: current, autoCancelled: true };
  }
  if (current !== "FAILED") {
    throw new AirwallexError(`transfer ${id} ended ${current} before CANCELLED`, 409);
  }
  try {
    const cancelled = await awx.simulateTransferTransition(id, "CANCELLED");
    hops.push(`FAILED->CANCELLED=${cancelled.status}`);
    current = cancelled.status;
  } catch (err) {
    read = await awx.getTransfer(id);
    hops.push(`FAILED->CANCELLED=error:${read.status}`);
    if (read.status !== "CANCELLED") throw err;
    current = read.status;
  }
  if (current !== "CANCELLED") {
    read = await awx.getTransfer(id);
    current = read.status;
  }
  if (current !== "CANCELLED") throw new AirwallexError(`transfer ${id} ended ${current}`, 409);
  return { hops, finalStatus: current, autoCancelled: false };
}

async function step(
  awx: DriveClient,
  id: string,
  failureType: string,
  next: TransferStatus,
  readCurrent: () => string,
  writeCurrent: (status: TransferStatus) => void,
  hops: string[],
) {
  const from = readCurrent();
  if (from === "FAILED" || from === "CANCELLED" || from === next) return;
  try {
    const updated = await awx.simulateTransferTransition(id, next, next === "FAILED" ? failureType : undefined);
    hops.push(`${from}->${next}=${updated.status}`);
    writeCurrent(updated.status);
  } catch (err) {
    const again = await awx.getTransfer(id);
    hops.push(`${from}->${next}=error:${again.status}`);
    if (again.status !== from) {
      writeCurrent(again.status);
      return;
    }
    throw err;
  }
}
