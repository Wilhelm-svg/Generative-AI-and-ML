/**
 * Integration tests — predict → store → retrieve round trip
 * Validates: Requirements 1.1, 4.1
 */

import { describe, it, expect, beforeEach } from "vitest";
import http from "http";
import { createServer } from "./server";
import { InMemoryPredictionStore } from "./store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: { "Content-Type": "application/json" },
    };

    const req = http.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: raw });
        }
      });
    });

    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

const VALID_RECORD = {
  fields: {
    tenure: 24,
    MonthlyCharges: 65.5,
    TotalCharges: 1572,
    SeniorCitizen: 0,
    Partner: "Yes",
    Dependents: "No",
    PhoneService: "Yes",
    MultipleLines: "No",
    InternetService: "DSL",
    OnlineSecurity: "No",
    OnlineBackup: "No",
    DeviceProtection: "No",
    TechSupport: "No",
    StreamingTV: "No",
    StreamingMovies: "No",
    Contract: "Month-to-month",
    PaperlessBilling: "Yes",
    PaymentMethod: "Electronic check",
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("REST API integration", () => {
  let server: http.Server;

  beforeEach(async () => {
    // Fresh store + server for each test — no shared state
    const freshStore = new InMemoryPredictionStore();
    server = createServer(freshStore);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  it("POST /predict returns 200 with label, confidence, explanation, recommendation", async () => {
    const { status, data } = await request(server, "POST", "/predict", VALID_RECORD);
    const d = data as Record<string, unknown>;

    expect(status).toBe(200);
    expect(typeof d.id).toBe("string");
    expect(["Churn", "No Churn"]).toContain(d.label);
    expect(typeof d.confidence).toBe("number");
    expect(d.confidence).toBeGreaterThanOrEqual(0);
    expect(d.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(d.explanation)).toBe(true);
    expect((d.explanation as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect(typeof d.recommendation).toBe("string");
    expect((d.recommendation as string).length).toBeGreaterThan(0);

    server.close();
  });

  it("POST /predict returns 400 for missing required fields", async () => {
    const { status, data } = await request(server, "POST", "/predict", {
      fields: { age: 35 }, // missing tenure, balance, numProducts
    });
    const d = data as Record<string, unknown>;

    expect(status).toBe(400);
    expect(d.error).toBe("MISSING_FIELDS");
    expect(Array.isArray(d.missing)).toBe(true);

    server.close();
  });

  it("predict → store → GET /predictions round trip", async () => {
    await request(server, "POST", "/predict", VALID_RECORD);

    const { status, data } = await request(server, "GET", "/predictions");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect((data as unknown[]).length).toBe(1);

    server.close();
  });

  it("predict → GET /predictions/:id retrieves the correct record", async () => {
    const { data: pred } = await request(server, "POST", "/predict", VALID_RECORD);
    const id = (pred as Record<string, unknown>).id as string;

    const { status, data } = await request(server, "GET", `/predictions/${id}`);
    expect(status).toBe(200);
    expect((data as Record<string, unknown>).id).toBe(id);

    server.close();
  });

  it("GET /predictions/:id returns 404 for unknown id", async () => {
    const { status } = await request(server, "GET", "/predictions/does-not-exist");
    expect(status).toBe(404);

    server.close();
  });

  it("GET /predictions?label= filters by label", async () => {
    // Submit two records
    await request(server, "POST", "/predict", VALID_RECORD);
    await request(server, "POST", "/predict", VALID_RECORD);

    const { data: all } = await request(server, "GET", "/predictions");
    const allPreds = all as Array<Record<string, unknown>>;

    if (allPreds.length > 0) {
      const firstLabel = allPreds[0].label as string;
      const { data: filtered } = await request(server, "GET", `/predictions?label=${encodeURIComponent(firstLabel)}`);
      const filteredPreds = filtered as Array<Record<string, unknown>>;
      expect(filteredPreds.every((p) => p.label === firstLabel)).toBe(true);
    }

    server.close();
  });

  it("GET /insights returns empty + message when fewer than 10 records", async () => {
    const { status, data } = await request(server, "GET", "/insights");
    const d = data as Record<string, unknown>;

    expect(status).toBe(200);
    expect(Array.isArray(d.insights)).toBe(true);
    expect((d.insights as unknown[]).length).toBe(0);
    expect(typeof d.message).toBe("string");

    server.close();
  });

  it("GET /insights returns at least 3 insights after 10 predictions", async () => {
    for (let i = 0; i < 10; i++) {
      await request(server, "POST", "/predict", VALID_RECORD);
    }

    const { status, data } = await request(server, "GET", "/insights");
    const d = data as Record<string, unknown>;

    expect(status).toBe(200);
    expect(Array.isArray(d.insights)).toBe(true);
    expect((d.insights as unknown[]).length).toBeGreaterThanOrEqual(3);

    server.close();
  });
});
