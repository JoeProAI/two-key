import "server-only";
import { cookies } from "next/headers";
import { DESK_COOKIE, DESK_COOKIE_MAX_AGE_S, cookieUnlocks, unlockCookieFor, type DeskAccess } from "./gate";

export async function readDeskAccess(): Promise<DeskAccess> {
  const jar = await cookies();
  return { unlocked: cookieUnlocks(jar.get(DESK_COOKIE)?.value) };
}

/** Sets the desk cookie when the key matches. Returns whether it did. */
export async function grantDeskAccess(key: string): Promise<boolean> {
  const value = unlockCookieFor(key);
  if (!value) return false;
  const jar = await cookies();
  jar.set(DESK_COOKIE, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DESK_COOKIE_MAX_AGE_S,
  });
  return true;
}
