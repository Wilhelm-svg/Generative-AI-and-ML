import type { PipelineType } from "./types.js";

const MAX_BYTES = 100 * 1024; // 100 KB

const VALID_PIPELINE_TYPES: PipelineType[] = [
  "invoice_extraction",
  "email_classification",
  "support_ticket_categorization",
];

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ParsedInput {
  pipeline_type: PipelineType;
  input_text?: string;
  input_json?: unknown;
}

export function validateInput(body: unknown): ValidationResult & { parsed?: ParsedInput } {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "Request body must be a JSON object." };
  }

  const obj = body as Record<string, unknown>;

  // Validate pipeline_type
  const pipeline_type = obj["pipeline_type"];
  if (!pipeline_type) {
    return { valid: false, error: "Missing required field: pipeline_type." };
  }
  if (!VALID_PIPELINE_TYPES.includes(pipeline_type as PipelineType)) {
    return {
      valid: false,
      error: `Invalid pipeline_type "${pipeline_type}". Valid values: ${VALID_PIPELINE_TYPES.join(", ")}.`,
    };
  }

  // Require at least one of input_text or input_json
  const input_text = obj["input_text"];
  const input_json = obj["input_json"];

  if (input_text === undefined && input_json === undefined) {
    return { valid: false, error: "Provide either input_text or input_json." };
  }

  // Size check: measure the serialized body
  const bodyStr = JSON.stringify(body);
  const byteSize = Buffer.byteLength(bodyStr, "utf8");
  if (byteSize > MAX_BYTES) {
    return {
      valid: false,
      error: `Input size ${byteSize} bytes exceeds the 100KB limit (${MAX_BYTES} bytes).`,
    };
  }

  return {
    valid: true,
    parsed: {
      pipeline_type: pipeline_type as PipelineType,
      input_text: typeof input_text === "string" ? input_text : undefined,
      input_json: input_json,
    },
  };
}
