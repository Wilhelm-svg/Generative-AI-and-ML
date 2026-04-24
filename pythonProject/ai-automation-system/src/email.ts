/**
 * Real email sending via Resend API
 * Used by the email_classification pipeline to send auto-replies
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";

export interface EmailResult {
  sent: boolean;
  id?: string;
  error?: string;
}

const AUTO_REPLY_TEMPLATES: Record<string, { subject: string; body: (summary: string) => string }> = {
  complaint: {
    subject: "We've received your complaint — we're on it",
    body: (summary) => `Thank you for reaching out. We've received your complaint and a member of our team will respond within 24 hours.\n\nYour message: "${summary}"\n\nWe apologise for any inconvenience caused.\n\nBest regards,\nCustomer Support Team`,
  },
  support: {
    subject: "Support request received",
    body: (summary) => `Thank you for contacting support. We've logged your request and will get back to you shortly.\n\nYour request: "${summary}"\n\nExpected response time: 4-8 business hours.\n\nBest regards,\nSupport Team`,
  },
  inquiry: {
    subject: "Thanks for your inquiry",
    body: (summary) => `Thank you for your inquiry. Our sales team will be in touch within 1 business day.\n\nYour inquiry: "${summary}"\n\nBest regards,\nSales Team`,
  },
  spam: {
    subject: "Unsubscribe confirmed",
    body: () => `You have been unsubscribed from our mailing list. No further emails will be sent.\n\nBest regards,\nEmail Team`,
  },
  other: {
    subject: "Message received",
    body: (summary) => `Thank you for your message. We'll review it and respond if needed.\n\nYour message: "${summary}"\n\nBest regards,\nTeam`,
  },
};

export async function sendAutoReply(
  to: string,
  category: string,
  summary: string
): Promise<EmailResult> {
  if (!RESEND_API_KEY) {
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  // Route to the configured recipient (Resend free tier requires a verified address)
  const recipient = process.env.EMAIL_RECIPIENT ?? "noreply@example.com";
  const template = AUTO_REPLY_TEMPLATES[category] ?? AUTO_REPLY_TEMPLATES["other"];

  console.log(`[email] DEBUG: Sending email TO: ${recipient} (original sender was: ${to})`);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "AI Automation <onboarding@resend.dev>",
      to: [recipient],
      subject: `[Auto-Reply to ${to}] ${template.subject}`,
      text: `This is an auto-reply that would normally go to: ${to}\n\n${template.body(summary)}`,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { sent: false, error: err };
  }

  const data = await res.json() as { id: string };
  return { sent: true, id: data.id };
}
