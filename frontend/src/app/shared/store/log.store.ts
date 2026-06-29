import { Injectable, signal } from '@angular/core';

export interface LogEntry {
  time: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

const MAX_ENTRIES = 200;

/**
 * In-memory log with history.
 *
 * Captures errors, warnings, and info messages from across the app.
 * Written to by services/components, read by the BottomPanel Log tab.
 */
@Injectable({ providedIn: 'root' })
export class LogStore {
  private readonly entriesSignal = signal<LogEntry[]>([]);

  readonly entries = this.entriesSignal.asReadonly();

  private push(level: LogEntry['level'], msg: string): void {
    this.entriesSignal.update(prev => {
      const next = [
        ...prev,
        { time: new Date().toLocaleTimeString(), level, msg },
      ];
      return next.length > MAX_ENTRIES
        ? next.slice(next.length - MAX_ENTRIES)
        : next;
    });
  }

  info(msg: string): void {
    this.push('info', msg);
  }

  warn(msg: string): void {
    this.push('warn', msg);
  }

  error(msg: string): void {
    this.push('error', msg);
  }

  clear(): void {
    this.entriesSignal.set([]);
  }
}
