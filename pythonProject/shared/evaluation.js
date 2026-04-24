/**
 * Shared Evaluation Framework — RAGAS-style metrics + LLM-as-judge
 * Covers: groundedness, answer relevance, precision@k, recall@k, hallucination detection
 */
import { getDb } from "./db.js";
const GROQ_BASE = "https://api.groq.com/openai/v1";
// ── LLM Judge ─────────────────────────────────────────────────────────────
async function llmJudge(prompt, apiKey) {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: "llama-3.1-8b-instant", // Use small model for evaluation (cost-aware)
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            max_tokens: 256,
        }),
    });
    if (!res.ok)
        throw new Error(`LLM judge failed: ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content.trim();
}
// ── Groundedness Score ────────────────────────────────────────────────────
// Measures: does the answer only contain claims supported by the context?
export async function scoreGroundedness(question, answer, context, apiKey) {
    const prompt = `You are an evaluation judge. Score the groundedness of an answer.

QUESTION: ${question}
CONTEXT: ${context.slice(0, 2000)}
ANSWER: ${answer}

Groundedness measures whether every claim in the answer is supported by the context.
Score from 0.0 to 1.0 where:
- 1.0 = all claims fully supported by context
- 0.5 = some claims supported, some not
- 0.0 = answer contradicts or ignores context

Respond with JSON only: {"score": 0.0-1.0, "reasoning": "brief explanation"}`;
    try {
        const raw = await llmJudge(prompt, apiKey);
        const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
        return { score: Math.min(1, Math.max(0, parsed.score ?? 0.5)), reasoning: parsed.reasoning ?? "" };
    }
    catch {
        return { score: 0.5, reasoning: "Evaluation failed" };
    }
}
// ── Answer Relevance Score ────────────────────────────────────────────────
// Measures: does the answer actually address the question?
export async function scoreAnswerRelevance(question, answer, apiKey) {
    const prompt = `You are an evaluation judge. Score how relevant this answer is to the question.

QUESTION: ${question}
ANSWER: ${answer}

Score from 0.0 to 1.0 where:
- 1.0 = answer directly and completely addresses the question
- 0.5 = answer partially addresses the question
- 0.0 = answer is off-topic or doesn't address the question

Respond with JSON only: {"score": 0.0-1.0, "reasoning": "brief explanation"}`;
    try {
        const raw = await llmJudge(prompt, apiKey);
        const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
        return { score: Math.min(1, Math.max(0, parsed.score ?? 0.5)), reasoning: parsed.reasoning ?? "" };
    }
    catch {
        return { score: 0.5, reasoning: "Evaluation failed" };
    }
}
// ── Hallucination Detection ───────────────────────────────────────────────
export async function detectHallucination(answer, context, apiKey) {
    const prompt = `You are a fact-checking judge. Determine if this answer contains hallucinations.

CONTEXT (ground truth): ${context.slice(0, 2000)}
ANSWER: ${answer}

A hallucination is any claim in the answer that:
1. Contradicts the context
2. Introduces facts not present in the context
3. Makes up specific details (names, numbers, dates) not in the context

Respond with JSON only: {"hallucinated": true/false, "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;
    try {
        const raw = await llmJudge(prompt, apiKey);
        const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
        return {
            hallucinated: parsed.hallucinated ?? false,
            confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
            reasoning: parsed.reasoning ?? "",
        };
    }
    catch {
        return { hallucinated: false, confidence: 0.5, reasoning: "Evaluation failed" };
    }
}
// ── Retrieval Metrics ─────────────────────────────────────────────────────
export function precisionAtK(retrieved, relevant, k) {
    const topK = retrieved.slice(0, k);
    const hits = topK.filter(id => relevant.includes(id)).length;
    return hits / k;
}
export function recallAtK(retrieved, relevant, k) {
    if (relevant.length === 0)
        return 0;
    const topK = retrieved.slice(0, k);
    const hits = topK.filter(id => relevant.includes(id)).length;
    return hits / relevant.length;
}
export async function evaluateRAG(question, answer, context, apiKey) {
    const [groundedness, relevance, hallucination] = await Promise.all([
        scoreGroundedness(question, answer, context, apiKey),
        scoreAnswerRelevance(question, answer, apiKey),
        detectHallucination(answer, context, apiKey),
    ]);
    return {
        groundedness: groundedness.score,
        answerRelevance: relevance.score,
        hallucinated: hallucination.hallucinated,
        hallucinationConfidence: hallucination.confidence,
        reasoning: {
            groundedness: groundedness.reasoning,
            answerRelevance: relevance.reasoning,
            hallucination: hallucination.reasoning,
        },
    };
}
// ── Persist Evaluation Results ────────────────────────────────────────────
export async function saveEvalResult(project, evalType, query, response, result) {
    try {
        const db = getDb();
        await db.query(`INSERT INTO eval_results (project, eval_type, query, response, groundedness, answer_relevance, hallucination, judge_reasoning)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
            project, evalType, query, response,
            result.groundedness ?? null,
            result.answerRelevance ?? null,
            result.hallucinated ?? null,
            JSON.stringify(result.reasoning ?? {}),
        ]);
    }
    catch (e) {
        console.error("[eval] Failed to save eval result:", e);
    }
}
// ── Get Evaluation Summary ────────────────────────────────────────────────
export async function getEvalSummary(project) {
    const db = getDb();
    const result = await db.query(`SELECT
       COUNT(*)::int                          AS total_evals,
       AVG(groundedness)::numeric(4,3)        AS avg_groundedness,
       AVG(answer_relevance)::numeric(4,3)    AS avg_answer_relevance,
       COUNT(*) FILTER (WHERE hallucination)::int AS hallucination_count,
       ROUND(100.0 * COUNT(*) FILTER (WHERE hallucination) / NULLIF(COUNT(*),0), 1) AS hallucination_rate_pct
     FROM eval_results
     WHERE project = $1`, [project]);
    return result.rows[0];
}
//# sourceMappingURL=evaluation.js.map