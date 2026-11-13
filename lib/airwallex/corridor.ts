import "server-only";
import { missingSandboxEnv, sandboxOrigin } from "./live";

export interface CorridorStatus {
  ran: false;
  reason: string;
  missing: string[];
  host: string | null;
  steps: string[];
}

const STEPS = [
  "Observe a simulated transfer move SENT to FAILED, then read it back as CANCELLED.",
  "Create one FX quote and one conversion. The receipt keeps the sandbox ids.",
  "Create one replacement transfer on a new request_id. Do not reuse the failed id.",
];

/**
 * Describes the sandbox corridor and refuses to call the provider.
 * A parent run with credentials and an explicit write flag is still not performed here.
 */
export function corridorStatus(env: NodeJS.ProcessEnv = process.env): CorridorStatus {
  const missing = missingSandboxEnv(env);
  let host: string | null = null;
  try {
    host = sandboxOrigin(env.AIRWALLEX_BASE_URL);
  } catch (e) {
    return { ran: false, reason: (e as Error).message, missing, host: null, steps: STEPS };
  }
  if (missing.length) {
    return {
      ran: false,
      reason: "Sandbox credentials are absent. No provider call was made and no id was invented.",
      missing,
      host,
      steps: STEPS,
    };
  }
  return {
    ran: false,
    reason: "Credentials are present, but this build does not send sandbox writes. A parent run has to do that on purpose.",
    missing,
    host,
    steps: STEPS,
  };
}
