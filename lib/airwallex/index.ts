import "server-only";
import type { AirwallexClient } from "./types";
import { createMockClient } from "./mock";
import { createLiveClient } from "./live";

/** AIRWALLEX_MODE=mock (default) needs no keys. live talks to the sandbox. */
export function getAirwallex(env: NodeJS.ProcessEnv = process.env): AirwallexClient {
  return env.AIRWALLEX_MODE === "live" ? createLiveClient(env) : createMockClient();
}
export * from "./types";
