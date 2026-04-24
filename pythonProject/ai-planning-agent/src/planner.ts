import type { Planner, Plan } from './types.js';
import { groqChatWithUsage } from './groq.js';
import { logRequest } from '../../shared/observability.js';

const SYSTEM = `You are a task planner. Given a task, break it into steps using available tools.
Available tools: search (params: {query}), calculator (params: {expression}), http-api (params: {url, method, body?})

YOU MUST RESPOND WITH VALID JSON ONLY - NO EXPLANATIONS, NO MARKDOWN, NO EXTRA TEXT.

Response format (COPY THIS EXACTLY):
{"steps":[{"index":0,"toolName":"calculator","params":{"expression":"2+2"},"description":"Calculate 2 + 2"}]}

Rules:
- Use 1-3 steps maximum (prefer 1 step when possible)
- Each step must use exactly one tool
- toolName must be one of: search, calculator, http-api
- index starts at 0 and increments by 1
- params must be a valid JSON object with the correct fields for the tool

CRITICAL - Tool Selection Rules:
- For ANY mathematical calculation, ALWAYS use calculator tool DIRECTLY
- NEVER use search for math - the calculator handles ALL expressions
- The calculator can handle: +, -, *, /, ^, (), %, complex nested expressions
- Only use search for information that requires web lookup (facts, current data, definitions)

Examples (RESPOND EXACTLY LIKE THESE):
Task: "Calculate 25 + 37"
{"steps":[{"index":0,"toolName":"calculator","params":{"expression":"25+37"},"description":"Calculate 25 + 37"}]}

Task: "Calculate (100 / 4) + 25 * 2"
{"steps":[{"index":0,"toolName":"calculator","params":{"expression":"(100/4)+25*2"},"description":"Calculate the expression"}]}

Task: "Search for Python version"
{"steps":[{"index":0,"toolName":"search","params":{"query":"latest Python version"},"description":"Search for Python version"}]}

Task: "Fetch data from https://httpbin.org/json"
{"steps":[{"index":0,"toolName":"http-api","params":{"url":"https://httpbin.org/json","method":"GET"},"description":"Fetch JSON data"}]}

REMEMBER: Respond with ONLY the JSON object, nothing else. No markdown, no code blocks, no explanations.`;

export class LLMPlanner implements Planner {
  constructor(private apiKey: string, private model = "llama-3.3-70b-versatile") {}

  async plan(task: string): Promise<Plan> {
    if (!task?.trim()) throw new Error('Task must be a non-empty string');

    const result = await groqChatWithUsage(SYSTEM, `Task: ${task}`, this.apiKey, this.model);
    const raw = result.content;

    // Debug: Log raw LLM response
    console.log('[PLANNER] Raw LLM response:', raw.substring(0, 500));

    // Log token usage
    logRequest({
      project: "ai-planning-agent",
      endpoint: "/plan",
      latencyMs: 0,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      model: result.model,
      status: "success",
    }).catch(() => {});

    // Extract JSON from response (handle markdown code blocks)
    // Try to find JSON between code blocks first
    let jsonStr = raw.trim();
    console.log('[PLANNER] Extracting JSON from raw response...');
    
    // Remove any markdown code blocks
    const codeBlockMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
      console.log('[PLANNER] Found JSON in code block');
    } else if (jsonStr.startsWith('{') && jsonStr.includes('}')) {
      // Response is likely pure JSON - find the complete JSON object
      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
        console.log('[PLANNER] Extracted JSON from response (first { to last })');
      }
    } else {
      // Try to extract JSON object with proper nesting support
      const jsonMatch = raw.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
        console.log('[PLANNER] Extracted JSON with nested regex');
      }
    }

    let parsed: Plan;
    try {
      parsed = JSON.parse(jsonStr) as Plan;
      console.log('[PLANNER] Successfully parsed plan:', JSON.stringify(parsed));
    } catch (err) {
      console.error('[PLANNER] JSON parse failed:', err);
      console.error('[PLANNER] Attempted to parse:', jsonStr.substring(0, 300));
      
      // Last resort: try to find any valid JSON object
      const allMatches = raw.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
      if (allMatches && allMatches.length > 0) {
        // Try each match until one parses successfully
        for (const match of allMatches) {
          try {
            parsed = JSON.parse(match) as Plan;
            if (parsed.steps && Array.isArray(parsed.steps)) {
              console.log('[PLANNER] Found valid plan in fallback match');
              break;
            }
          } catch {
            continue;
          }
        }
        if (!parsed!) {
          throw new Error(`Failed to parse LLM JSON after trying all matches. Raw: ${raw.substring(0, 200)}`);
        }
      } else {
        throw new Error(`LLM returned no valid JSON. Raw response: ${raw.substring(0, 200)}`);
      }
    }
    if (!parsed.steps?.length) throw new Error('LLM returned an empty plan');

    // Ensure indices are correct
    parsed.steps = parsed.steps.map((s, i) => ({ ...s, index: i }));
    return parsed;
  }
}

// Kept for tests
export class StubPlanner implements Planner {
  async plan(task: string): Promise<Plan> {
    if (!task?.trim()) throw new Error('Task must be a non-empty string');
    return {
      steps: [
        { index: 0, toolName: 'search', params: { query: task }, description: `Search: ${task}` },
        { index: 1, toolName: 'http-api', params: { url: 'https://httpbin.org/get', method: 'GET' }, description: 'Fetch result' },
      ],
    };
  }
}
