import type { Logger, LogEntry } from './types.js';

export class InMemoryLogger implements Logger {
  private entries: LogEntry[] = [];

  log(entry: Omit<LogEntry, 'timestamp'>): void {
    this.entries.push({ ...entry, timestamp: new Date().toISOString() });
  }

  getEntries(): LogEntry[] {
    return this.entries;
  }
}
