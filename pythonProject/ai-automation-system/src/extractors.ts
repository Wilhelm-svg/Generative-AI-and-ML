import type { InvoiceData, EmailData, TicketData, StructuredOutput } from "./types.js";
import { groqExtractWithUsage } from "./groq.js";
import { sendAutoReply } from "./email.js";
import { logRequest } from "../../shared/observability.js";

export interface ExtractorInput {
  input_text?: string;
  input_json?: unknown;
}

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";

// ---------------------------------------------------------------------------
// InvoiceExtractor — real LLM extraction
// ---------------------------------------------------------------------------

const INVOICE_SYSTEM = `You are a precise invoice data extractor. Extract ALL information EXACTLY as shown.

CRITICAL NUMBER EXTRACTION RULES - FOLLOW EXACTLY:

WRONG EXAMPLES (DO NOT DO THIS):
❌ "$99.99" → 0.99 (WRONG - missing the 99 before decimal)
❌ "$45.50" → 5.50 (WRONG - missing the 45 before decimal)
❌ "$24.99" → 0.99 (WRONG - missing the 24 before decimal)
❌ "$1,299.99" → 299.99 (WRONG - missing the 1 before comma)

CORRECT EXAMPLES (DO THIS):
✓ "$99.99" → 99.99 (keep ALL digits: 99.99)
✓ "$45.50" → 45.50 (keep ALL digits: 45.50)
✓ "$24.99" → 24.99 (keep ALL digits: 24.99)
✓ "$1,299.99" → 1299.99 (keep ALL digits: 1299.99)
✓ "$1,595.46" → 1595.46 (keep ALL digits: 1595.46)

EXTRACTION PROCESS:
1. Find amount: "$99.99"
2. Remove $ and commas: "99.99"
3. Convert to number: 99.99
4. VERIFY: Count digits in source (2 digits before decimal) = Count digits in result (2 digits before decimal) ✓

FOR LINE ITEMS - EXTRACT EACH AMOUNT COMPLETELY:
Example: "Dell Laptop XPS 15: $1,299.99" → {"description": "Dell Laptop XPS 15", "amount": 1299.99}
Example: "Microsoft Office 365: $99.99" → {"description": "Microsoft Office 365", "amount": 99.99}
Example: "USB-C Hub: $45.50" → {"description": "USB-C Hub", "amount": 45.50}
Example: "Wireless Mouse: $24.99" → {"description": "Wireless Mouse", "amount": 24.99}

Respond with JSON only:
{"vendor":"string","invoice_number":"string","amount":number,"currency":"USD|EUR|GBP","date":"YYYY-MM-DD","line_items":[{"description":"string","amount":number}],"confidence":0.0-1.0}

FINAL VERIFICATION: Before responding, check EVERY amount has the SAME number of digits as the source.`;


export class InvoiceExtractor {
  async extract(input: ExtractorInput): Promise<StructuredOutput> {
    const text = input.input_text ?? JSON.stringify(input.input_json ?? "");

    if (GROQ_API_KEY) {
      try {
        const result = await groqExtractWithUsage(INVOICE_SYSTEM, text, GROQ_API_KEY);
        const raw = result.data as InvoiceData & { confidence?: number };
        const confidence = Math.min(1, Math.max(0, raw.confidence ?? 0.85));
        const { confidence: _, ...data } = raw;
        logRequest({ project: "ai-automation-system", endpoint: "/extract/invoice", latencyMs: 0, tokensIn: result.tokensIn, tokensOut: result.tokensOut, model: result.model, status: "success" }).catch(() => {});
        return { pipeline_type: "invoice_extraction", confidence, data: data as InvoiceData };
      } catch (e) {
        console.error("Groq invoice extraction failed, falling back:", e);
      }
    }

    // Fallback regex
    return this.regexExtract(text);
  }

  private regexExtract(text: string): StructuredOutput {
    const vendor = text.match(/vendor[:\s]+([A-Za-z0-9 &.,'-]+)/i)?.[1]?.trim() ?? "Unknown";
    const amount = parseFloat(text.match(/(?:total|amount)[:\s$€£]*([0-9]+(?:\.[0-9]{1,2})?)/i)?.[1] ?? "0");
    const currency = /€/.test(text) ? "EUR" : /£/.test(text) ? "GBP" : "USD";
    const date = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? new Date().toISOString().slice(0, 10);
    const data: InvoiceData = { vendor, amount, currency, date, line_items: [] };
    return { pipeline_type: "invoice_extraction", confidence: amount > 0 ? 0.6 : 0.3, data };
  }
}

// ---------------------------------------------------------------------------
// EmailClassifier — real LLM classification
// ---------------------------------------------------------------------------

const EMAIL_SYSTEM = `Classify this email. Respond with JSON only:
{"category":"inquiry|complaint|support|spam|other","intent":"question|request|feedback|report|unknown","urgency":"low|medium|high","sender":"email or unknown","summary":"max 100 chars","confidence":0.0-1.0}

URGENCY DETECTION:
- high: Contains words like "urgent", "ASAP", "immediately", "critical", "emergency", "blocking"
- medium: Contains words like "soon", "important", "need help"
- low: Normal requests without urgency indicators`;


export class EmailClassifier {
  async classify(input: ExtractorInput): Promise<StructuredOutput> {
    const text = input.input_text ?? JSON.stringify(input.input_json ?? "");

    if (GROQ_API_KEY) {
      try {
        const result = await groqExtractWithUsage(EMAIL_SYSTEM, text, GROQ_API_KEY);
        const raw = result.data as EmailData & { confidence?: number };
        const confidence = Math.min(1, Math.max(0, raw.confidence ?? 0.85));
        const { confidence: _, ...data } = raw;
        logRequest({ project: "ai-automation-system", endpoint: "/extract/email", latencyMs: 0, tokensIn: result.tokensIn, tokensOut: result.tokensOut, model: result.model, status: "success" }).catch(() => {});

        // Send real auto-reply if sender email is present
        if (data.sender && data.sender.includes("@") && !data.sender.startsWith("unknown")) {
          const emailResult = await sendAutoReply(data.sender, data.category, data.summary).catch(e => {
            console.error("Auto-reply failed:", e);
            return { sent: false, error: String(e) };
          });
          if (!emailResult.sent) {
            console.warn(`[email] Auto-reply not sent to ${data.sender}: ${"error" in emailResult ? emailResult.error : "unknown error"}`);
          } else {
            console.log(`[email] Auto-reply sent to ${data.sender}${("id" in emailResult && emailResult.id) ? ` (id: ${emailResult.id})` : ""}`);
          }
        }

        return { pipeline_type: "email_classification", confidence, data: data as EmailData };
      } catch (e) {
        console.error("Groq email classification failed, falling back:", e);
      }
    }

    // Fallback
    const category = /complaint|refund/i.test(text) ? "complaint" : /support|help/i.test(text) ? "support" : "other";
    const data: EmailData = { category, intent: "unknown", sender: "unknown@example.com", summary: text.slice(0, 100) };
    return { pipeline_type: "email_classification", confidence: 0.5, data };
  }
}

// ---------------------------------------------------------------------------
// TicketCategorizer — real LLM categorization
// ---------------------------------------------------------------------------

const TICKET_SYSTEM = `Categorize this support ticket. Respond with JSON only:
{"category":"billing|technical|account|feature_request|general","priority":"low|medium|high|critical","routing":"billing-team|engineering-team|account-support|product-team|general-support","summary":"max 100 chars","confidence":0.0-1.0}`;

export class TicketCategorizer {
  async categorize(input: ExtractorInput): Promise<StructuredOutput> {
    const text = input.input_text ?? JSON.stringify(input.input_json ?? "");

    if (GROQ_API_KEY) {
      try {
        const result = await groqExtractWithUsage(TICKET_SYSTEM, text, GROQ_API_KEY);
        const raw = result.data as TicketData & { confidence?: number };
        const confidence = Math.min(1, Math.max(0, raw.confidence ?? 0.85));
        const { confidence: _, ...data } = raw;
        logRequest({ project: "ai-automation-system", endpoint: "/extract/ticket", latencyMs: 0, tokensIn: result.tokensIn, tokensOut: result.tokensOut, model: result.model, status: "success" }).catch(() => {});

        // Fire routing webhook if configured, log warning if not
        const webhookUrl = process.env.TICKET_WEBHOOK_URL;
        if (webhookUrl) {
          fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...data, original_text: text.slice(0, 200), routed_at: new Date().toISOString() }),
          })
            .then(r => { if (!r.ok) console.warn(`[ticket] Webhook returned ${r.status}`); else console.log(`[ticket] Routed to ${data.routing} via webhook`); })
            .catch(e => console.error("Ticket routing webhook failed:", e));
        } else {
          console.log(`[ticket] Categorized as ${data.category}/${data.priority} → ${data.routing} (set TICKET_WEBHOOK_URL to enable routing)`);
        }

        return { pipeline_type: "support_ticket_categorization", confidence, data: data as TicketData };
      } catch (e) {
        console.error("Groq ticket categorization failed, falling back:", e);
      }
    }

    // Fallback
    const category = /billing|payment/i.test(text) ? "billing" : /bug|error/i.test(text) ? "technical" : "general";
    const priority: TicketData["priority"] = /urgent|critical/i.test(text) ? "critical" : "medium";
    const data: TicketData = { category, priority, routing: "general-support", summary: text.slice(0, 100) };
    return { pipeline_type: "support_ticket_categorization", confidence: 0.5, data };
  }
}
