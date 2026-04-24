import type { Executor, Step, ExecutionContext, StepResult, ToolRegistry, Logger } from './types.js';
import { withRetry, circuitBreaker } from '../../shared/llmops.js';

// ── Step validation ───────────────────────────────────────────────────────

function validateStep(step: Step): { valid: boolean; reason?: string } {
  if (!step.toolName) return { valid: false, reason: "Step missing toolName" };
  if (!step.params || typeof step.params !== "object") return { valid: false, reason: "Step missing params" };
  if (typeof step.index !== "number") return { valid: false, reason: "Step missing index" };
  return { valid: true };
}

function validateOutput(output: unknown, step: Step): { valid: boolean; reason?: string } {
  if (output === undefined || output === null) {
    return { valid: false, reason: `Tool '${step.toolName}' returned null/undefined` };
  }
  return { valid: true };
}

// ── Executor with retry, circuit breaker, step validation ─────────────────

export class ToolExecutor implements Executor {
  constructor(
    private registry: ToolRegistry,
    private logger: Logger,
  ) {}

  async execute(step: Step, context: ExecutionContext): Promise<StepResult> {
    // 1. Validate step structure
    const stepValidation = validateStep(step);
    if (!stepValidation.valid) {
      const error = `Invalid step: ${stepValidation.reason}`;
      this.logger.log({ event: 'step_error', stepIndex: step.index, toolName: step.toolName, message: error });
      return { success: false, error };
    }

    const tool = this.registry.get(step.toolName);
    if (!tool) {
      const error = `Tool not found: ${step.toolName}`;
      this.logger.log({ event: 'step_error', stepIndex: step.index, toolName: step.toolName, message: error });
      return { success: false, error };
    }

    this.logger.log({ event: 'step_start', stepIndex: step.index, toolName: step.toolName, input: step.params });

    try {
      // 2. Execute with circuit breaker + retry + exponential backoff
      const output = await circuitBreaker(
        `tool:${step.toolName}`,
        () => withRetry(
          () => tool.invoke(step.params),
          { maxAttempts: 3, baseDelayMs: 500, label: `tool:${step.toolName}` }
        ),
        { failureThreshold: 5, resetTimeoutMs: 30_000 }
      );

      // 3. Validate output
      const outputValidation = validateOutput(output, step);
      if (!outputValidation.valid) {
        this.logger.log({ event: 'step_error', stepIndex: step.index, toolName: step.toolName, message: outputValidation.reason });
        return { success: false, error: outputValidation.reason };
      }

      this.logger.log({ event: 'step_end', stepIndex: step.index, toolName: step.toolName, output });
      return { success: true, output };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.log({ event: 'step_error', stepIndex: step.index, toolName: step.toolName, message: msg });
      return { success: false, error: msg };
    }
  }
}
