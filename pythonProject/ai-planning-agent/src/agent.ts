import type { Agent, AgentResult, Planner, Executor, Logger } from './types.js';

export class PlanningAgent implements Agent {
  constructor(
    private planner: Planner,
    private executor: Executor,
    private logger: Logger,
  ) {}

  async run(task: string): Promise<AgentResult> {
    // Plan
    let plan;
    try {
      plan = await this.planner.plan(task);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error, logs: this.logger.getEntries() };
    }

    // Log the plan
    this.logger.log({ event: 'plan', message: `Plan with ${plan.steps.length} step(s)`, output: plan });

    // Execute steps in order
    let context: { previousResult?: unknown } = {};
    for (const step of plan.steps) {
      const result = await this.executor.execute(step, context);
      if (!result.success) {
        this.logger.log({ event: 'summary', message: `Failed at step ${step.index}: ${result.error}` });
        return {
          success: false,
          error: result.error,
          failedStep: step.index,
          logs: this.logger.getEntries(),
        };
      }
      context = { previousResult: result.output };
    }

    const summary = `Completed ${plan.steps.length} step(s) successfully. Last output: ${JSON.stringify(context.previousResult)}`;
    this.logger.log({ event: 'summary', message: summary });

    return {
      success: true,
      summary,
      logs: this.logger.getEntries(),
    };
  }
}
