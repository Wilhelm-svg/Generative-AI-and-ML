import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { InMemoryLogger } from "./logger.js";
import { InMemoryToolRegistry } from "./toolRegistry.js";
import { StubPlanner } from "./planner.js";
import { ToolExecutor } from "./executor.js";
import { PlanningAgent } from "./agent.js";
import { calculatorTool } from "./tools/calculator.js";
import { searchTool } from "./tools/search.js";
import { httpApiTool } from "./tools/httpApi.js";
import type { Tool, Step, ExecutionContext } from "./types.js";

function makeAgent() {
  const logger = new InMemoryLogger();
  const registry = new InMemoryToolRegistry();
  registry.register(searchTool);
  registry.register(calculatorTool);
  registry.register(httpApiTool);
  const planner = new StubPlanner();
  const executor = new ToolExecutor(registry, logger);
  return new PlanningAgent(planner, executor, logger);
}

// ── Logger ──────────────────────────────────────────────────────────────────

describe("InMemoryLogger", () => {
  it("starts empty", () => {
    const logger = new InMemoryLogger();
    expect(logger.getEntries()).toHaveLength(0);
  });

  it("adds ISO 8601 timestamp to each entry", () => {
    const logger = new InMemoryLogger();
    logger.log({ event: "plan", message: "test" });
    const entry = logger.getEntries()[0];
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("stores multiple entries in order", () => {
    const logger = new InMemoryLogger();
    logger.log({ event: "plan" });
    logger.log({ event: "summary" });
    const entries = logger.getEntries();
    expect(entries[0].event).toBe("plan");
    expect(entries[1].event).toBe("summary");
  });
});

// ── ToolRegistry ─────────────────────────────────────────────────────────────

describe("InMemoryToolRegistry", () => {
  it("returns undefined for unregistered tool", () => {
    const reg = new InMemoryToolRegistry();
    expect(reg.get("missing")).toBeUndefined();
  });

  it("returns registered tool by name", () => {
    const reg = new InMemoryToolRegistry();
    reg.register(searchTool);
    expect(reg.get("search")).toBe(searchTool);
  });
});

// ── StubPlanner ───────────────────────────────────────────────────────────────

describe("StubPlanner", () => {
  it("throws for empty task", async () => {
    const planner = new StubPlanner();
    await expect(planner.plan("")).rejects.toThrow();
  });

  it("returns a plan with steps for valid task", async () => {
    const planner = new StubPlanner();
    const plan = await planner.plan("do something");
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it("steps have monotonically increasing indices starting at 0", async () => {
    const planner = new StubPlanner();
    const plan = await planner.plan("task");
    plan.steps.forEach((s, i) => expect(s.index).toBe(i));
  });
});

// ── ToolExecutor ──────────────────────────────────────────────────────────────

describe("ToolExecutor", () => {
  it("returns failure for unknown tool", async () => {
    const logger = new InMemoryLogger();
    const registry = new InMemoryToolRegistry();
    const executor = new ToolExecutor(registry, logger);
    const step: Step = { index: 0, toolName: "nonexistent", params: {}, description: "" };
    const result = await executor.execute(step, {});
    expect(result.success).toBe(false);
  });

  it("invokes tool and returns success", async () => {
    const logger = new InMemoryLogger();
    const registry = new InMemoryToolRegistry();
    registry.register(calculatorTool);
    const executor = new ToolExecutor(registry, logger);
    const step: Step = { index: 0, toolName: "calculator", params: { expression: "2+2" }, description: "" };
    const result = await executor.execute(step, {});
    expect(result.success).toBe(true);
  });

  it("retries on failure with exponential backoff (up to 3 attempts)", async () => {
    const logger = new InMemoryLogger();
    const registry = new InMemoryToolRegistry();
    let callCount = 0;
    const failingTool: Tool = {
      name: "failing",
      invoke: async () => { callCount++; throw new Error("fail"); },
    };
    registry.register(failingTool);
    const executor = new ToolExecutor(registry, logger);
    const step: Step = { index: 0, toolName: "failing", params: {}, description: "" };
    const result = await executor.execute(step, {});
    expect(result.success).toBe(false);
    expect(callCount).toBe(3); // withRetry: original + 2 retries = 3 total
  });

  it("logs step_start and step_end on success", async () => {
    const logger = new InMemoryLogger();
    const registry = new InMemoryToolRegistry();
    registry.register(searchTool);
    const executor = new ToolExecutor(registry, logger);
    const step: Step = { index: 0, toolName: "search", params: { query: "test" }, description: "" };
    await executor.execute(step, {});
    const events = logger.getEntries().map(e => e.event);
    expect(events).toContain("step_start");
    expect(events).toContain("step_end");
  });
});

// ── PlanningAgent ─────────────────────────────────────────────────────────────

describe("PlanningAgent", () => {
  it("returns success with summary for valid task", async () => {
    const agent = makeAgent();
    const result = await agent.run("search for something");
    expect(result.success).toBe(true);
    expect(result.summary).toBeTruthy();
  });

  it("returns failure for empty task", async () => {
    const agent = makeAgent();
    const result = await agent.run("");
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("logs include a plan entry before step_start (Property 2)", async () => {
    const agent = makeAgent();
    const result = await agent.run("do a task");
    const logs = result.logs;
    const planIdx = logs.findIndex(e => e.event === "plan");
    const firstStepIdx = logs.findIndex(e => e.event === "step_start");
    expect(planIdx).toBeGreaterThanOrEqual(0);
    if (firstStepIdx >= 0) expect(planIdx).toBeLessThan(firstStepIdx);
  });

  it("all log entries have timestamps (Property 9)", async () => {
    const agent = makeAgent();
    const result = await agent.run("task");
    result.logs.forEach(e => {
      expect(e.timestamp).toBeTruthy();
      expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

// ── Property 1: Planner produces non-empty ordered plan ───────────────────────

describe("Property 1: Planner produces non-empty ordered plan", () => {
  it("for any non-empty task, plan has steps with indices starting at 0", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
      async (task) => {
        const planner = new StubPlanner();
        const plan = await planner.plan(task);
        if (plan.steps.length === 0) return false;
        return plan.steps[0].index === 0 &&
          plan.steps.every((s, i) => s.index === i);
      }
    ), { numRuns: 100 });
  });
});

// ── Property 7: Successful execution returns a summary ────────────────────────

describe("Property 7: Successful execution returns a summary", () => {
  it("agent.run() with valid non-whitespace task always returns success=true and non-empty summary", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      async (task) => {
        // Use mock tools that always succeed — no network calls, no retry delays
        const logger = new InMemoryLogger();
        const registry = new InMemoryToolRegistry();
        const mockSearch: Tool = { name: "search", invoke: async () => ({ results: ["mock result"] }) };
        const mockHttp: Tool = { name: "http-api", invoke: async () => ({ status: 200, body: "ok" }) };
        registry.register(mockSearch);
        registry.register(calculatorTool);
        registry.register(mockHttp);
        const planner = new StubPlanner();
        const executor = new ToolExecutor(registry, logger);
        const agent = new PlanningAgent(planner, executor, logger);
        const result = await agent.run(task);
        return result.success === true && typeof result.summary === "string" && result.summary.length > 0;
      }
    ), { numRuns: 20 });
  });
}, 30000);
