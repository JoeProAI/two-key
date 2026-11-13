import "server-only";

// Every model call in Two-Key goes through OpenRouter (https://openrouter.ai/api/v1/chat/completions).
// Model is chosen per agent by env var; nothing is hardcoded. AGENT_MODE=stub skips the network.
export type AgentRole = "planner" | "wringer";

export type ChatJSON = (role: AgentRole, system: string, user: unknown, env?: NodeJS.ProcessEnv) => Promise<unknown>;

/** Live OpenRouter needs the Runtime Secret and both model names. Nothing here picks a model id.
 *  `AGENT_MODE=stub` forces fixtures, including when the key is set, so `npm run demo` can stay offline.
 *  A missing key forces fixtures even if `AGENT_MODE=llm`: no request is sent.
 *  Vitest stays on fixtures unless the test passes an env with `AGENT_MODE=llm` and the three values. */
export function openRouterReady(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL_PLANNER && env.OPENROUTER_MODEL_WRINGER);
}

export function agentMode(env: NodeJS.ProcessEnv = process.env): "stub" | "llm" {
  if (env.AGENT_MODE === "stub") return "stub";
  if (env.VITEST === "true" && env.AGENT_MODE !== "llm") return "stub";
  if (!openRouterReady(env)) return "stub";
  return "llm";
}

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function missingAgentEnv(env: NodeJS.ProcessEnv): string[] {
  return ["OPENROUTER_API_KEY", "OPENROUTER_MODEL_PLANNER", "OPENROUTER_MODEL_WRINGER"].filter((k) => !env[k]);
}

export interface RawReply { model: string; content: string; served?: string }

/** One chat call. Returns the model's raw text. Some free models refuse `response_format`, so a 400 is retried once without it. */
export async function chatRaw(role: AgentRole, system: string, user: unknown, env: NodeJS.ProcessEnv = process.env): Promise<RawReply> {
  const key = env.OPENROUTER_API_KEY;
  const model = role === "planner" ? env.OPENROUTER_MODEL_PLANNER : env.OPENROUTER_MODEL_WRINGER;
  if (!key || !model) throw new Error(`AGENT_MODE=llm needs OPENROUTER_API_KEY and OPENROUTER_MODEL_${role.toUpperCase()}`);
  const send = (jsonMode: boolean) => fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Two-Key" },
    body: JSON.stringify({
      model,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) },
      ],
    }),
  });
  let res = await send(true);
  if (res.status === 400) res = await send(false);
  if (!res.ok) throw new Error(`OpenRouter ${role} call failed: ${res.status}`);
  const body = (await res.json()) as { model?: string; choices?: { message?: { content?: unknown } }[] };
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error(`OpenRouter ${role} reply had no text`);
  return { model, content, served: typeof body.model === "string" ? body.model : undefined };
}

/** Parses a model reply as one JSON object. Code fences are allowed. Anything else throws, and callers fall back to code. */
export function parseModelJSON(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("model reply is not a JSON object");
  return parsed;
}

export async function chatJSON<T>(role: AgentRole, system: string, user: unknown, env: NodeJS.ProcessEnv = process.env): Promise<T> {
  const reply = await chatRaw(role, system, user, env);
  return parseModelJSON(reply.content) as T;
}
