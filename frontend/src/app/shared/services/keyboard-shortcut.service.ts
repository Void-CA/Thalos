import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Semantic keyboard actions — no UI coupling.
 */
export type KeyboardAction =
  | { type: 'set-mode'; mode: 'analysis' | 'planning' | 'execution' }
  | { type: 'execution-toggle' }
  | { type: 'execution-cancel' }
  | { type: 'preview-plan' }
  | { type: 'undo' }
  | { type: 'redo' };

/**
 * Global keyboard shortcut service.
 *
 * Emits semantic actions on a Subject. Components subscribe.
 * No direct coupling between key events and stores.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardShortcutService implements OnDestroy {
  readonly actions$ = new Subject<KeyboardAction>();

  private readonly handler = (e: KeyboardEvent) => {
    this.onKeyDown(e);
  };

  constructor() {
    document.addEventListener('keydown', this.handler);
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.handler);
    this.actions$.complete();
  }

  private onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const ctrl = e.ctrlKey || e.metaKey;

    switch (e.code) {
      case 'Digit1':
        e.preventDefault();
        this.actions$.next({ type: 'set-mode', mode: 'analysis' });
        break;
      case 'Digit2':
        e.preventDefault();
        this.actions$.next({ type: 'set-mode', mode: 'planning' });
        break;
      case 'Digit3':
        e.preventDefault();
        this.actions$.next({ type: 'set-mode', mode: 'execution' });
        break;
      case 'Space':
        e.preventDefault();
        this.actions$.next({ type: 'execution-toggle' });
        break;
      case 'Escape':
        e.preventDefault();
        this.actions$.next({ type: 'execution-cancel' });
        break;
      case 'Enter':
        if (ctrl) {
          e.preventDefault();
          this.actions$.next({ type: 'preview-plan' });
        }
        break;
      case 'KeyZ':
        if (ctrl && !e.shiftKey) {
          e.preventDefault();
          this.actions$.next({ type: 'undo' });
        } else if (ctrl && e.shiftKey) {
          e.preventDefault();
          this.actions$.next({ type: 'redo' });
        }
        break;
    }
  }
}
