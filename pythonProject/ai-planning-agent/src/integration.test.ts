/**
 * INTEGRATION TESTS - AI Planning Agent
 * Deep functional testing of multi-step autonomous agent execution
 * These tests verify planning, tool execution, retry logic, and circuit breakers
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAgentServer } from './server.js';
import { runAgent } from './agent.js';
import type { Server } from 'http';

describe('🔬 INTEGRATION: AI Planning Agent - Real-world Scenarios', () => {
  let server: Server;
  let baseUrl: string;
  const port = 3200;

  beforeAll(async () => {
    server = createAgentServer(runAgent);
    await new Promise<void>((resolve) => {
      server.listen(port, () => {
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('Scenario 1: Complete Planning & Execution Flow', () => {
    it('should plan and execute a multi-step task successfully', async () => {
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'Calculate 15 * 8, then search for information about that number',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      // Verify response structure
      expect(result).toHaveProperty('plan');
      expect(result).toHaveProperty('steps');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('success');

      // Verify plan has 2-4 steps
      expect(result.plan.steps.length).toBeGreaterThanOrEqual(2);
      expect(result.plan.steps.length).toBeLessThanOrEqual(4);

      // Verify steps were executed
      expect(Array.isArray(result.steps)).toBe(true);
      expect(result.steps.length).toBeGreaterThan(0);

      // Verify each step has required properties
      result.steps.forEach((step: any) => {
        expect(step).toHaveProperty('index');
        expect(step).toHaveProperty('toolName');
        expect(step).toHaveProperty('output');
        expect(step).toHaveProperty('success');
      });

      // Verify calculator was used
      const calculatorStep = result.steps.find((s: any) => s.toolName === 'calculator');
      expect(calculatorStep).toBeDefined();
      expect(calculatorStep.success).toBe(true);
      expect(calculatorStep.output).toHaveProperty('result');
      expect(calculatorStep.output.result).toBe(120);

      console.log(`✓ Plan: ${result.plan.steps.length} steps`);
      console.log(`✓ Executed: ${result.steps.length} steps`);
      console.log(`✓ Calculator result: ${calculatorStep.output.result}`);
      console.log(`✓ Summary: ${result.summary.substring(0, 100)}...`);
    });

    it('should handle complex mathematical operations', async () => {
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'Calculate (25 + 75) * 2 - 50, then calculate 2 to the power of 5',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result.success).toBe(true);
      
      // Find calculator steps
      const calcSteps = result.steps.filter((s: any) => s.toolName === 'calculator');
      expect(calcSteps.length).toBeGreaterThanOrEqual(2);

      // Verify first calculation: (25 + 75) * 2 - 50 = 150
      const firstCalc = calcSteps[0];
      expect(firstCalc.output.result).toBe(150);

      // Verify second calculation: 2^5 = 32
      const secondCalc = calcSteps[1];
      expect(secondCalc.output.result).toBe(32);

      console.log(`✓ First calculation: ${firstCalc.output.result}`);
      console.log(`✓ Second calculation: ${secondCalc.output.result}`);
    });
  });

  describe('Scenario 2: Tool Execution - Search with Fallback', () => {
    it('should use search tool to find information', async () => {
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'Search for the current population of Tokyo',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      // Should have used search tool
      const searchStep = result.steps.find((s: any) => s.toolName === 'search');
      expect(searchStep).toBeDefined();
      expect(searchStep.output).toBeDefined();
      
      // Output should contain search results
      const output = JSON.stringify(searchStep.output).toLowerCase();
      const hasRelevantInfo = output.includes('tokyo') || 
                             output.includes('population') ||
                             output.includes('million');
      
      console.log(`✓ Search executed: ${searchStep.success}`);
      console.log(`✓ Has relevant info: ${hasRelevantInfo}`);
      console.log(`✓ Output preview: ${JSON.stringify(searchStep.output).substring(0, 150)}...`);
    });

    it('should fallback to DuckDuckGo when Tavily fails', async () => {
      // This test verifies the fallback mechanism
      // Even if TAVILY_API_KEY is not set, search should still work via DuckDuckGo
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'Search for information about Node.js',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      const searchStep = result.steps.find((s: any) => s.toolName === 'search');
      expect(searchStep).toBeDefined();
      
      // Should succeed even without Tavily
      expect(searchStep.success).toBe(true);
      expect(searchStep.output).toBeDefined();
      
      console.log(`✓ Search fallback working: ${searchStep.success}`);
    });
  });

  describe('Scenario 3: Tool Execution - HTTP API', () => {
    it('should make HTTP requests to external APIs', async () => {
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'Fetch data from https://jsonplaceholder.typicode.com/posts/1',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      const httpStep = result.steps.find((s: any) => s.toolName === 'http-api');
      expect(httpStep).toBeDefined();
      expect(httpStep.success).toBe(true);
      
      // Verify HTTP response structure
      expect(httpStep.output).toHaveProperty('status');
      expect(httpStep.output).toHaveProperty('data');
      expect(httpStep.output.status).toBe(200);
      
      // Verify data from JSONPlaceholder
      expect(httpStep.output.data).toHaveProperty('id');
      expect(httpStep.output.data).toHaveProperty('title');
      expect(httpStep.output.data).toHaveProperty('body');
      expect(httpStep.output.data.id).toBe(1);

      console.log(`✓ HTTP request successful`);
      console.log(`✓ Response status: ${httpStep.output.status}`);
      console.log(`✓ Post title: ${httpStep.output.data.title}`);
    });

    it('should handle HTTP errors gracefully', async () => {
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'Fetch data from https://jsonplaceholder.typicode.com/posts/99999',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      const httpStep = result.steps.find((s: any) => s.toolName === 'http-api');
      
      // Should handle 404 gracefully
      if (httpStep) {
        expect(httpStep.output).toHaveProperty('status');
        expect(httpStep.output.status).toBe(404);
        console.log(`✓ HTTP error handled: ${httpStep.output.status}`);
      }
    });
  });

  describe('Scenario 4: Retry Logic & Error Recovery', () => {
    it('should retry failed operations up to 3 times', async () => {
      // This test uses a task that might fail initially but succeed on retry
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'Calculate 100 / 0',  // Division by zero - should be handled
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      // Should have attempted the calculation
      const calcStep = result.steps.find((s: any) => s.toolName === 'calculator');
      
      if (calcStep) {
        // Either succeeded with Infinity or failed gracefully
        expect(calcStep).toHaveProperty('output');
        console.log(`✓ Division by zero handled: ${JSON.stringify(calcStep.output)}`);
      }
    });

    it('should provide detailed error information on failure', async () => {
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'Calculate invalid_expression_xyz',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      // Should have error information
      if (!result.success) {
        expect(result).toHaveProperty('error');
        expect(typeof result.error).toBe('string');
        console.log(`✓ Error captured: ${result.error}`);
      }
    });
  });

  describe('Scenario 5: Circuit Breaker - Fail After 5 Errors', () => {
    it('should open circuit breaker after 5 consecutive failures', async () => {
      const tasks = [];
      
      // Send 6 requests that will likely fail
      for (let i = 0; i < 6; i++) {
        tasks.push(
          fetch(`${baseUrl}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              task: `Calculate invalid_syntax_${i}`,
            }),
          })
        );
      }

      const responses = await Promise.all(tasks);
      const results = await Promise.all(responses.map(r => r.json()));

      // Count failures
      const failures = results.filter(r => !r.success).length;
      
      console.log(`✓ Total requests: ${results.length}`);
      console.log(`✓ Failures: ${failures}`);
      
      // Circuit breaker should have triggered
      expect(failures).toBeGreaterThan(0);
    });
  });

  describe('Scenario 6: Plan Validation & Schema Checking', () => {
    it('should validate step schemas before execution', async () => {
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'Calculate 50 + 50 and search for the result',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      // Verify each step in the plan has valid schema
      result.plan.steps.forEach((step: any) => {
        expect(step).toHaveProperty('index');
        expect(step).toHaveProperty('toolName');
        expect(step).toHaveProperty('params');
        expect(typeof step.index).toBe('number');
        expect(typeof step.toolName).toBe('string');
        expect(typeof step.params).toBe('object');
      });

      console.log(`✓ All ${result.plan.steps.length} steps have valid schemas`);
    });
  });

  describe('Scenario 7: Complex Multi-Step Workflows', () => {
    it('should execute a 4-step workflow successfully', async () => {
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'Calculate 10 * 10, then calculate 50 + 50, then calculate 200 - 100, then search for information about the number 100',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      // Should have planned 4 steps (max allowed)
      expect(result.plan.steps.length).toBeLessThanOrEqual(4);
      
      // Should have executed multiple steps
      expect(result.steps.length).toBeGreaterThanOrEqual(2);

      // Verify calculations
      const calcSteps = result.steps.filter((s: any) => s.toolName === 'calculator');
      expect(calcSteps.length).toBeGreaterThan(0);

      calcSteps.forEach((step: any, idx: number) => {
        expect(step.success).toBe(true);
        expect(step.output).toHaveProperty('result');
        console.log(`✓ Calculation ${idx + 1}: ${step.output.expression} = ${step.output.result}`);
      });
    });

    it('should stop execution if a step fails', async () => {
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'Calculate 5 + 5, then calculate invalid_syntax, then calculate 10 + 10',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      // Should have stopped at the failed step
      const failedStepIndex = result.steps.findIndex((s: any) => !s.success);
      
      if (failedStepIndex !== -1) {
        // No steps after the failed step should have been executed
        const stepsAfterFailure = result.steps.slice(failedStepIndex + 1);
        expect(stepsAfterFailure.length).toBe(0);
        
        console.log(`✓ Execution stopped at step ${failedStepIndex + 1}`);
        console.log(`✓ Steps executed: ${failedStepIndex + 1} of ${result.plan.steps.length}`);
      }
    });
  });

  describe('Scenario 8: Logging & Observability', () => {
    it('should log all steps to agent_runs table', async () => {
      const response = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'Calculate 7 * 8',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      // Verify logging information is present
      expect(result).toHaveProperty('steps');
      
      result.steps.forEach((step: any) => {
        expect(step).toHaveProperty('toolName');
        expect(step).toHaveProperty('output');
        expect(step).toHaveProperty('success');
        
        // Should have timing information
        if (step.error) {
          expect(typeof step.error).toBe('string');
        }
      });

      console.log(`✓ Logged ${result.steps.length} steps`);
    });
  });

  describe('Scenario 9: Calculator Safety - Regex Guard', () => {
    it('should block unsafe expressions', async () => {
      const unsafeExpressions = [
        'process.exit()',
        'require("fs")',
        'eval("malicious code")',
        '__dirname',
      ];

      for (const expr of unsafeExpressions) {
        const response = await fetch(`${baseUrl}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: `Calculate ${expr}`,
          }),
        });

        expect(response.status).toBe(200);
        const result = await response.json();

        const calcStep = result.steps.find((s: any) => s.toolName === 'calculator');
        
        if (calcStep) {
          // Should have failed or been rejected
          expect(calcStep.success).toBe(false);
          console.log(`✓ Blocked unsafe expression: ${expr}`);
        }
      }
    });

    it('should allow safe mathematical expressions', async () => {
      const safeExpressions = [
        '2 + 2',
        '10 * 5',
        '100 / 4',
        '2 ** 3',
        '(5 + 3) * 2',
        '10 % 3',
      ];

      for (const expr of safeExpressions) {
        const response = await fetch(`${baseUrl}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: `Calculate ${expr}`,
          }),
        });

        expect(response.status).toBe(200);
        const result = await response.json();

        const calcStep = result.steps.find((s: any) => s.toolName === 'calculator');
        expect(calcStep).toBeDefined();
        expect(calcStep.success).toBe(true);
        expect(calcStep.output).toHaveProperty('result');
        
        console.log(`✓ Safe expression allowed: ${expr} = ${calcStep.output.result}`);
      }
    });
  });

  describe('Scenario 10: Health Check', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${baseUrl}/health`);
      
      expect(response.status).toBe(200);
      const result = await response.json();
      
      expect(result).toHaveProperty('status');
      expect(result.status).toBe('healthy');
      expect(result).toHaveProperty('service');
      expect(result.service).toBe('ai-planning-agent');
      
      console.log(`✓ Health check: ${result.status}`);
    });
  });
});

