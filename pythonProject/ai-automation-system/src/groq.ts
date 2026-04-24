const GROQ_BASE = "https://api.groq.com/openai/v1";
const MODEL = "llama-3.3-70b-versatile";

export interface GroqExtractResult {
  data: unknown;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export async function groqExtract(systemPrompt: string, input: string, apiKey: string): Promise<unknown> {
  const result = await groqExtractWithUsage(systemPrompt, input, apiKey);
  return result.data;
}

export async function groqExtractWithUsage(
  systemPrompt: string,
  input: string,
  apiKey: string
): Promise<GroqExtractResult> {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input },
      ],
      temperature: 0.1,
      max_tokens: 512,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json() as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
    model: string;
  };
  return {
    data: JSON.parse(data.choices[0].message.content),
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
    model: data.model ?? MODEL,
  };
}
