const GROQ_BASE = "https://api.groq.com/openai/v1";

export interface GroqChatResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export async function groqChatWithUsage(
  system: string,
  user: string,
  apiKey: string,
  model = "llama-3.3-70b-versatile"
): Promise<GroqChatResult> {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.2,
      max_tokens: 1024,
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json() as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
    model: string;
  };
  return {
    content: data.choices[0].message.content.trim(),
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
    model: data.model ?? model,
  };
}

/** Backward-compat wrapper */
export async function groqChat(
  system: string,
  user: string,
  apiKey: string,
  model = "llama-3.3-70b-versatile"
): Promise<string> {
  const result = await groqChatWithUsage(system, user, apiKey, model);
  return result.content;
}
