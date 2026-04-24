/**
 * Shared Evaluation Framework — RAGAS-style metrics + LLM-as-judge
 * Covers: groundedness, answer relevance, precision@k, recall@k, hallucination detection
 */
export declare function scoreGroundedness(question: string, answer: string, context: string, apiKey: string): Promise<{
    score: number;
    reasoning: string;
}>;
export declare function scoreAnswerRelevance(question: string, answer: string, apiKey: string): Promise<{
    score: number;
    reasoning: string;
}>;
export declare function detectHallucination(answer: string, context: string, apiKey: string): Promise<{
    hallucinated: boolean;
    confidence: number;
    reasoning: string;
}>;
export declare function precisionAtK(retrieved: string[], relevant: string[], k: number): number;
export declare function recallAtK(retrieved: string[], relevant: string[], k: number): number;
export interface RAGEvalResult {
    groundedness: number;
    answerRelevance: number;
    hallucinated: boolean;
    hallucinationConfidence: number;
    reasoning: {
        groundedness: string;
        answerRelevance: string;
        hallucination: string;
    };
}
export declare function evaluateRAG(question: string, answer: string, context: string, apiKey: string): Promise<RAGEvalResult>;
export declare function saveEvalResult(project: string, evalType: string, query: string, response: string, result: Partial<RAGEvalResult>): Promise<void>;
export declare function getEvalSummary(project: string): Promise<Record<string, unknown>>;
//# sourceMappingURL=evaluation.d.ts.map