/**
 * Optional language-model adapter. Off by default: the product runs entirely on
 * deterministic rules. If OLLAMA_URL is set (e.g. http://localhost:11434), text
 * such as the briefing can be reworded by a local model. The model never computes
 * numbers — it only rephrases text that already contains them, and the output is
 * rejected if any figure from the source text goes missing.
 */

const OLLAMA_URL = process.env.OLLAMA_URL?.replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1";

export function aiStatus() {
  return OLLAMA_URL
    ? { engine: "ollama" as const, model: OLLAMA_MODEL, label: `Local LLM (${OLLAMA_MODEL}) for wording · rules for all numbers` }
    : { engine: "rules" as const, model: null, label: "Rule-based engine (deterministic, no LLM configured)" };
}

function figures(text: string): string[] {
  return text.match(/₹[\d.,]+\s?(?:Cr|L|K)?|\d+(?:\.\d+)?[%×]/g) ?? [];
}

export async function rephrase(text: string, instruction: string): Promise<{ text: string; engine: string }> {
  if (!OLLAMA_URL) return { text, engine: "rules" };
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        prompt: `${instruction}\nKeep every number, currency amount and percentage exactly as written. Do not add facts.\n\nText:\n${text}`,
      }),
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const out = ((await res.json()) as { response?: string }).response?.trim();
    if (!out) throw new Error("Empty response");
    const missing = figures(text).filter((f) => !out.includes(f));
    if (missing.length) return { text, engine: "rules (LLM output rejected: altered figures)" };
    return { text: out, engine: `ollama:${OLLAMA_MODEL}` };
  } catch (e) {
    return { text, engine: `rules (LLM unavailable: ${(e as Error).message})` };
  }
}
