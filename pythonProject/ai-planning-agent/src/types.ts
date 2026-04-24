// Core interfaces for the AI Planning Agent

// ── Log ──────────────────────────────────────────────────────────────────────

export interface LogEntry {
  timestamp: string; // ISO 8601
  event: 'plan' | 'step_start' | 'step_end' | 'step_error' | 'summary';
  stepIndex?: number;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  message?: string;
}

export interface Logger {
  log(entry: Omit<LogEntry, 'timestamp'>): void;
  getEntries(): LogEntry[];
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export interface Step {
  index: number;
  toolName: string;
  params: Record<string, unknown>;
  description: string;
}

export interface Plan {
  steps: Step[];
}

export interface Planner {
  plan(task: string): Promise<Plan>;
}

// ── Execution ─────────────────────────────────────────────────────────────────

export interface ExecutionContext {
  previousResult?: unknown;
}

export interface StepResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface Executor {
  execute(step: Step, context: ExecutionContext): Promise<StepResult>;
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export interface Tool {
  name: string;
  invoke(params: Record<string, unknown>): Promise<unknown>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export interface AgentResult {
  success: boolean;
  summary?: string;
  error?: string;
  failedStep?: number;
  logs: LogEntry[];
}

export interface Agent {
  run(task: string): Promise<AgentResult>;
}
