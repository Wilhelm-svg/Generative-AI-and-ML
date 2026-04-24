import { ToolCall, ToolResult, ToolName } from "./types.js";

export interface UserPermissions {
  userId: string;
  allowedTools: ToolName[];
}

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";

async function sendRealEmail(params: Record<string, unknown>): Promise<ToolResult> {
  const to = (params["to"] as string);
  const subject = (params["subject"] as string) || "Message from AI Copilot";
  const body = (params["body"] as string) || (params["message"] as string) || "No content provided.";

  if (!to || !to.includes("@")) {
    return { success: false, message: "Missing or invalid 'to' email address." };
  }

  if (!RESEND_API_KEY) {
    return { success: false, message: "RESEND_API_KEY not configured — email sending is disabled." };
  }

  const fromEmail = "onboarding@resend.dev";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `AI Copilot <${fromEmail}>`,
      to: [to],
      subject,
      text: body,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { success: false, message: `Email failed: ${err}` };
  }

  const data = await res.json() as { id: string };
  return { success: true, message: `Email sent successfully (id: ${data.id}) to ${to}` };
}

async function writeDbRecord(params: Record<string, unknown>): Promise<ToolResult> {
  // Write to PostgreSQL when DATABASE_URL is set, otherwise fall back to db.json
  if (process.env.DATABASE_URL) {
    try {
      const { getDb } = await import("../../shared/db.js");
      const db = getDb();
      await db.query(
        `INSERT INTO copilot_records (data, created_at) VALUES ($1::jsonb, NOW())`,
        [JSON.stringify({ ...params, timestamp: new Date().toISOString() })]
      );
      return { success: true, message: `Record written to PostgreSQL successfully.` };
    } catch (err) {
      // Fall through to db.json if DB is unavailable
      console.warn(`[write_db_record] PostgreSQL unavailable, falling back to db.json: ${(err as Error).message}`);
    }
  }

  // Fallback: local db.json for dev without a database
  const { readFileSync, writeFileSync, existsSync } = await import("fs");
  const dbPath = "./db.json";
  const records: unknown[] = existsSync(dbPath)
    ? JSON.parse(readFileSync(dbPath, "utf-8"))
    : [];
  records.push({ ...params, timestamp: new Date().toISOString() });
  writeFileSync(dbPath, JSON.stringify(records, null, 2));
  return { success: true, message: `Record written to db.json (${records.length} total records)` };
}

export async function executeToolCall(
  call: ToolCall,
  permissions: UserPermissions
): Promise<ToolResult> {
  if (call.userId !== permissions.userId) {
    return { success: false, message: "Permission denied: user mismatch" };
  }

  if (!permissions.allowedTools.includes(call.tool)) {
    return {
      success: false,
      message: `Permission denied: user does not have permission to use tool "${call.tool}"`,
    };
  }

  switch (call.tool) {
    case "send_email":
      return sendRealEmail(call.params);

    case "write_db_record":
      return writeDbRecord(call.params);

    default: {
      const unknown = call.tool as string;
      return { success: false, message: `Unknown tool: "${unknown}"` };
    }
  }
}
