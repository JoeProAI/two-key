import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ledgerBackend } from "../ledger/remote";

/** Hackathon gate for the desk. One shared key (DESK_APPROVE_SECRET) set on the server.
 *  The browser gets an httpOnly cookie holding an HMAC of the key, never the key itself.
 *  open: fixture desk with no shared ledger and no key set. Anyone can try the demo.
 *  locked / unlocked: a key is set. Plan, approve, replay and the ledger read need the cookie.
 *  unconfigured: Convex is wired but no key is set. The shared ledger stays closed. */
export type GateState = "open" | "locked" | "unlocked" | "unconfigured";

export interface DeskAccess {
  unlocked: boolean;
}

export const DESK_COOKIE = "two_key_desk";
export const DESK_COOKIE_MAX_AGE_S = 60 * 60 * 12;

export class DeskLockedError extends Error {}

function deskSecret(env: NodeJS.ProcessEnv): string {
  return env.DESK_APPROVE_SECRET ?? "";
}

function tokenFor(value: string): string {
  return createHmac("sha256", "two-key-desk-v1").update(value).digest("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Used by the failure matrix. A caller with no cookie is rejected when a desk key is set, and nothing is sent. */
export function anonymousDeskRejected(): boolean {
  const env = { ...process.env, DESK_APPROVE_SECRET: "matrix-desk-key" } as NodeJS.ProcessEnv;
  if (gateState({ unlocked: false }, env) !== "locked") return false;
  try {
    assertDeskAccess({ unlocked: false }, env);
    return false;
  } catch (e) {
    return e instanceof DeskLockedError;
  }
}

export function gateState(access: DeskAccess, env: NodeJS.ProcessEnv = process.env): GateState {
  const secret = deskSecret(env);
  if (!secret) return ledgerBackend(env) === "convex" ? "unconfigured" : "open";
  return access.unlocked ? "unlocked" : "locked";
}

/** The cookie value for a correct key, or null. Compares HMACs so the check is constant time. */
export function unlockCookieFor(key: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = deskSecret(env);
  if (!secret || !key) return null;
  const expected = tokenFor(secret);
  return same(tokenFor(key), expected) ? expected : null;
}

export function cookieUnlocks(value: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = deskSecret(env);
  return Boolean(secret && value) && same(value!, tokenFor(secret));
}

export function assertDeskAccess(access: DeskAccess, env: NodeJS.ProcessEnv = process.env): void {
  const state = gateState(access, env);
  if (state === "locked") throw new DeskLockedError("Unlock the desk with the desk key first.");
  if (state === "unconfigured") throw new DeskLockedError("This desk has no desk key set on the server, so the shared ledger stays closed.");
}
