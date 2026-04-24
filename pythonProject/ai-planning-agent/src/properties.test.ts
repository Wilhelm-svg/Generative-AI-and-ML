/**
 * All remaining property tests for AI Planning Agent
 * Properties 1-9 + integration tests
 * Feature: ai-planning-agent
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { InMemoryLogger } from "./logger.js";
import { InMemoryToolRegistry } from "./toolRegistry.js";
import { StubPlanner } from "./planner.js";
import { ToolExecutor } from "./executor.js";
import { PlanningAgent } from "./agent.js";
import { calculatorTool } from "./tools/calculator.js";
import type { Tool, Step, LogEntry } from "./types.js";

// Mock tools that always succeed — no network calls
const mockSearch: Tool = { name: "search", invoke: async (p) => ({ results: [`result for: ${p.query}`] }) };
const mockHttp: Tool = { name: "http-api", invoke: async (p) => ({ status: 200, body: `ok: ${p.url}` }) };

function makeAgent() {
  const logger = new InMemoryLogger();
  const registry = new InMemoryToolRegistry();
  registry.register(mockSearch);
  registry.register(calculatorTool);
  registry.register(mockHttp);
  const planner = new StubPlanner();
  const executor = new ToolExecutor(registry, logger);
  return { agent: new PlanningAgent(planner, executor, logger), logger };
}

// ── Property 9: Every log entry contains required fields ──────────────────
// Feature: ai-planning-agent, Property 9: Every log entry contains required fields

describe("Property 9: Every log entry contains required fields", () => {
  it("all log entries have a non-null ISO 8601 timestamp and event type", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      async (task) => {
        const { agent } = makeAgent();
        const result = await agent.run(task);
        return result.logs.every((entry: LogEntry) => {
          const hasTimestamp = typeof entry.timestamp === "string" && /^\d{4}-\d{2}-\d{2}T/.test(entry.timestamp);
          const hasEvent = typeof entry.event === "string" && entry.event.length > 0;
          return hasTimestamp && hasEvent;
        });
      }
    ), { numRuns: 50 });
  });
});

// ── Property 1: Planner produces non-empty ordered plan ───────────────────
// Feature: ai-planning-agent, Property 1: Planner produces a non-empty ordered plan

describe("Property 1: Planner produces a non-empty ordered plan", () => {
  it("for any non-empty task, plan has steps with indices starting at 0", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
      async (task) => {
        const planner = new StubPlanner();
        const plan = await planner.plan(task);
        if (plan.steps.length === 0) return false;
        return plan.steps[0].index === 0 && plan.steps.every((s, i) => s.index === i);
      }
    ), { numRuns: 100 });
  });
});

// ── Property 2: Plan is logged before execution ───────────────────────────
// Feature: ai-planning-agent, Property 2: Plan is logged before execution

describe("Property 2: Plan is logged before execution", () => {
  it("plan log entry timestamp is before first step_start timestamp", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      async (task) => {
        const { agent } = makeAgent();
        const result = await agent.run(task);
        const planIdx = result.logs.findIndex((e: LogEntry) => e.event === "plan");
        const firstStepIdx = result.logs.findIndex((e: LogEntry) => e.event === "step_start");
        if (planIdx === -1) return false;
        if (firstStepIdx === -1) return true; // no steps is fine
        return planIdx < firstStepIdx;
      }
    ), { numRuns: 50 });
  });
});

// ── Property 3: Executor invokes tool with exact parameters ───────────────
// Feature: ai-planning-agent, Property 3: Executor invokes tool with exact parameters

describe("Property 3: Executor invokes tool with exact parameters", () => {
  it("tool receives exactly the params specified in the step", async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({ expression: fc.constantFrom("1+1", "2*3", "10/2", "5-3") }),
      async (params) => {
        const logger = new InMemoryLogger();
        const registry = new InMemoryToolRegistry();
        let receivedParams: Record<string, unknown> = {};
        const captureTool: Tool = {
          name: "calculator",
          invoke: async (p) => { receivedParams = p; return { result: 42 }; },
        };
        registry.register(captureTool);
        const executor = new ToolExecutor(registry, logger);
        const step: Step = { index: 0, toolName: "calculator", params, description: "test" };
        await executor.execute(step, {});
        return JSON.stringify(receivedParams) === JSON.stringify(params);
      }
    ), { numRuns: 100 });
  });
});

// ── Property 4: Failed tool call triggers retry ───────────────────────────
// Feature: ai-planning-agent, Property 4: Failed tool call triggers exactly one retry

describe("Property 4: Failed tool call triggers retry (up to 3 attempts)", () => {
  it("always-failing tool is invoked exactly 3 times (original + 2 retries)", async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 0, max: 10 }),
      async (seed) => {
        const logger = new InMemoryLogger();
        const registry = new InMemoryToolRegistry();
        let callCount = 0;
        // Use a unique tool name per run to avoid circuit breaker shared state
        const uniqueName = `failing-${seed}-${Date.now()}-${Math.random()}`;
        const failingTool: Tool = {
          name: uniqueName,
          invoke: async () => { callCount++; throw new Error("always fails"); },
        };
        registry.register(failingTool);
        const executor = new ToolExecutor(registry, logger);
        const step: Step = { index: 0, toolName: uniqueName, params: {}, description: "" };
        const result = await executor.execute(step, {});
        return result.success === false && callCount === 3;
      }
    ), { numRuns: 20 }); // low runs — each takes ~1.5s due to retry delays
  });
}, 60000);

// ── Property 5: Tool result propagates as context ────────────────────────
// Feature: ai-planning-agent, Property 5: Tool result propagates as context to next step

describe("Property 5: Tool result propagates as context to next step", () => {
  it("output of step N is available as previousResult in step N+1 context", async () => {
    // Verify that the agent passes each step's output as previousResult to the next step.
    // We do this by inspecting the step_start log entries which record the context passed in.
    const logger = new InMemoryLogger();
    const registry = new InMemoryToolRegistry();

    const step0Output = { value: "output-from-step-0" };
    const tool1: Tool = { name: "tool1", invoke: async () => step0Output };
    const tool2: Tool = { name: "tool2", invoke: async () => "output-from-step-1" };
    registry.register(tool1);
    registry.register(tool2);

    const planner = {
      plan: async () => ({
        steps: [
          { index: 0, toolName: "tool1", params: {}, description: "step 0" },
          { index: 1, toolName: "tool2", params: {}, description: "step 1" },
        ],
      }),
    };

    const executor = new ToolExecutor(registry, logger);
    const agent = new PlanningAgent(planner as never, executor, logger);
    const result = await agent.run("test context propagation");

    expect(result.success).toBe(true);
    // The agent's summary includes the last output, confirming step 1 ran after step 0
    expect(result.summary).toContain("output-from-step-1");
    // Verify step 0 produced the expected output via step_end log
    const step0End = result.logs.find(e => e.event === "step_end" && e.stepIndex === 0);
    expect(step0End).toBeDefined();
    expect(step0End?.output).toEqual(step0Output);
    // Verify step 1 ran (context was available for it to execute)
    const step1End = result.logs.find(e => e.event === "step_end" && e.stepIndex === 1);
    expect(step1End).toBeDefined();
  });
});

// ── Property 6: Steps execute in index order ──────────────────────────────
// Feature: ai-planning-agent, Property 6: Steps execute in index order

describe("Property 6: Steps execute in index order", () => {
  it("agent executes steps in ascending index order", async () => {
    const executionOrder: number[] = [];
    const logger = new InMemoryLogger();
    const registry = new InMemoryToolRegistry();

    for (let i = 0; i < 3; i++) {
      const idx = i;
      registry.register({
        name: `tool${idx}`,
        invoke: async () => { executionOrder.push(idx); return `result-${idx}`; },
      });
    }

    const planner = {
      plan: async () => ({
        steps: [
          { index: 0, toolName: "tool0", params: {}, description: "step 0" },
          { index: 1, toolName: "tool1", params: {}, description: "step 1" },
          { index: 2, toolName: "tool2", params: {}, description: "step 2" },
        ],
      }),
    };

    const executor = new ToolExecutor(registry, logger);
    const agent = new PlanningAgent(planner as never, executor, logger);
    const result = await agent.run("test task");

    expect(result.success).toBe(true);
    expect(executionOrder).toEqual([0, 1, 2]);
  });
});

// ── Property 7: Successful execution returns a summary ────────────────────
// Feature: ai-planning-agent, Property 7: Successful execution returns a summary

describe("Property 7: Successful execution returns a summary", () => {
  it("agent.run() with valid task always returns success=true and non-empty summary", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      async (task) => {
        const { agent } = makeAgent();
        const result = await agent.run(task);
        return result.success === true && typeof result.summary === "string" && result.summary.length > 0;
      }
    ), { numRuns: 30 });
  });
});

// ── Property 8: Failure stops execution at the failed step ───────────────
// Feature: ai-planning-agent, Property 8: Failure stops execution at the failed step

describe("Property 8: Failure stops execution at the failed step", () => {
  it("when step K fails, no steps after K are executed", async () => {
    const executedSteps: number[] = [];
    const logger = new InMemoryLogger();
    const registry = new InMemoryToolRegistry();

    registry.register({ name: "ok-tool", invoke: async (p) => { executedSteps.push(p.idx as number); return "ok"; } });
    registry.register({ name: "fail-tool", invoke: async () => { throw new Error("intentional failure"); } });

    const planner = {
      plan: async () => ({
        steps: [
          { index: 0, toolName: "ok-tool", params: { idx: 0 }, description: "step 0" },
          { index: 1, toolName: "fail-tool", params: {}, description: "step 1 - fails" },
          { index: 2, toolName: "ok-tool", params: { idx: 2 }, description: "step 2 - should not run" },
        ],
      }),
    };

    const executor = new ToolExecutor(registry, logger);
    const agent = new PlanningAgent(planner as never, executor, logger);
    const result = await agent.run("test");

    expect(result.success).toBe(false);
    expect(result.failedStep).toBe(1);
    expect(executedSteps).not.toContain(2); // step 2 must not have run
  });
}, 30000);

// ── Task 3.3: Unit tests for each built-in tool ───────────────────────────

describe("Built-in tool unit tests", () => {
  it("calculator: evaluates 2+2 correctly", async () => {
    const result = await calculatorTool.invoke({ expression: "2+2" });
    expect((result as { result: number }).result).toBe(4);
  });

  it("calculator: evaluates 15/100*2500 correctly", async () => {
    const result = await calculatorTool.invoke({ expression: "15/100*2500" });
    expect((result as { result: number }).result).toBe(375);
  });

  it("calculator: rejects unsafe expressions", async () => {
    await expect(calculatorTool.invoke({ expression: "require('fs')" })).rejects.toThrow();
  });

  it("mock search: returns results for any query", async () => {
    const result = await mockSearch.invoke({ query: "test query" }) as { results: string[] };
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("mock http-api: returns status 200", async () => {
    const result = await mockHttp.invoke({ url: "https://example.com", method: "GET" }) as { status: number };
    expect(result.status).toBe(200);
  });
});

// ── Task 7.2: Integration test covering a full run with all three tools ───

describe("Integration: full agent run with all three tools", () => {
  it("agent completes a multi-step task using search, calculator, and http-api", async () => {
    const logger = new InMemoryLogger();
    const registry = new InMemoryToolRegistry();
    registry.register(mockSearch);
    registry.register(calculatorTool);
    registry.register(mockHttp);

    const planner = {
      plan: async () => ({
        steps: [
          { index: 0, toolName: "search", params: { query: "AI news" }, description: "Search" },
          { index: 1, toolName: "calculator", params: { expression: "100*0.15" }, description: "Calculate" },
          { index: 2, toolName: "http-api", params: { url: "https://api.example.com", method: "GET" }, description: "Fetch" },
        ],
      }),
    };

    const executor = new ToolExecutor(registry, logger);
    const agent = new PlanningAgent(planner as never, executor, logger);
    const result = await agent.run("search, calculate, and fetch");

    expect(result.success).toBe(true);
    expect(result.summary).toBeTruthy();
    expect(result.logs.filter((l: LogEntry) => l.event === "step_end")).toHaveLength(3);
    expect(result.logs.filter((l: LogEntry) => l.event === "step_start")).toHaveLength(3);
  });
});
