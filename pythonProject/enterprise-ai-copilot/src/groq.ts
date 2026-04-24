/**
 * Groq LLM client — uses llama-3.3-70b-versatile (free tier)
 * OpenAI-compatible API — returns content + token usage for observability
 */

const GROQ_BASE = "https://api.groq.com/openai/v1";
const MODEL = "llama-3.3-70b-versatile";

export interface GroqChatResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export async function groqChatWithUsage(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): Promise<GroqChatResult> {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
    model: string;
  };

  return {
    content: data.choices[0].message.content.trim(),
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
    model: data.model ?? MODEL,
  };
}

/** Convenience wrapper — returns just the string (backward compat) */
export async function groqChat(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): Promise<string> {
  const result = await groqChatWithUsage(systemPrompt, userMessage, apiKey);
  return result.content;
}

/**
 * Real embedding using Groq nomic-embed-text-v1_5 (768-dim)
 * Falls back to deterministic hash embedding if API unavailable
 */
export async function groqEmbed(text: string, apiKey: string): Promise<number[]> {
  if (!apiKey) return hashEmbed(text, 768);

  try {
    const res = await fetch(`${GROQ_BASE}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "nomic-embed-text-v1_5",
        input: text,
      }),
    });

    if (res.ok) {
      const data = await res.json() as { data: { embedding: number[] }[] };
      return data.data[0].embedding;
    }
  } catch {
    // fall through to hash embed
  }

  return hashEmbed(text, 768);
}

/** Deterministic fallback embedding when API embeddings unavailable */
function hashEmbed(text: string, dims: number): number[] {
  const vec = new Array(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % dims] += text.charCodeAt(i) / 255;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}
