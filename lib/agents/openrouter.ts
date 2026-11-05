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

export async function chatJSON<T>(role: AgentRole, system: string, user: unknown, env: NodeJS.ProcessEnv = process.env): Promise<T> {
  const key = env.OPENROUTER_API_KEY;
  const model = role === "planner" ? env.OPENROUTER_MODEL_PLANNER : env.OPENROUTER_MODEL_WRINGER;
  if (!key || !model) throw new Error(`AGENT_MODE=llm needs OPENROUTER_API_KEY and OPENROUTER_MODEL_${role.toUpperCase()}`);
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Two-Key" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${role} call failed: ${res.status}`);
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  return JSON.parse(body.choices[0].message.content) as T;
}
