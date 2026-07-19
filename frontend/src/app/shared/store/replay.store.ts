import { Injectable, signal } from '@angular/core';

/**
 * Tracks the current replay session state.
 * Shared between SessionBrowser (who starts replays) and StatusBar (who shows controls).
 */
@Injectable({ providedIn: 'root' })
export class ReplayStore {
  /** Whether a replay is currently active. */
  readonly isReplay = signal(false);
  /** The session ID being replayed. */
  readonly sessionId = signal<number | null>(null);
  /** Seek position 0–100. */
  readonly seekPos = signal(0);

  startReplay(sessionId: number): void {
    this.isReplay.set(true);
    this.sessionId.set(sessionId);
    this.seekPos.set(0);
  }

  stopReplay(): void {
    this.isReplay.set(false);
    this.sessionId.set(null);
    this.seekPos.set(0);
  }

  setSeekPos(pct: number): void {
    this.seekPos.set(pct);
  }
}
