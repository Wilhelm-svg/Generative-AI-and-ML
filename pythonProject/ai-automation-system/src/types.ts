export type PipelineType =
  | "invoice_extraction"
  | "email_classification"
  | "support_ticket_categorization";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface Job {
  job_id: string;         // UUID
  pipeline_type: PipelineType;
  status: JobStatus;
  created_at: string;     // ISO 8601
  input_text?: string;
  input_json?: unknown;
  result?: StructuredOutput;
  error?: string;
}

export interface StructuredOutput {
  pipeline_type: PipelineType;
  confidence: number;     // 0.0 – 1.0
  data: InvoiceData | EmailData | TicketData;
}

export interface InvoiceData {
  vendor: string;
  amount: number;
  currency: string;
  date: string;
  line_items: { description: string; amount: number }[];
}

export interface EmailData {
  category: string;
  intent: string;
  sender: string;
  summary: string;
}

export interface TicketData {
  category: string;
  priority: "low" | "medium" | "high" | "critical";
  routing: string;
  summary: string;
}
