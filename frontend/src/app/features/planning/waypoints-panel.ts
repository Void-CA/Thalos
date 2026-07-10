import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlanningStore } from './planning.store';
import type { WaypointModel, WaypointType } from './planning.types';

// ── Helpers ──

interface ValidationResult {
  valid: boolean;
  error: string | null;
}

function validateNumber(s: string): ValidationResult {
  const v = parseFloat(s);
  if (!isFinite(v)) return { valid: false, error: 'Invalid number' };
  return { valid: true, error: null };
}

/**
 * Small color-coded text badge for waypoint type.
 * Matches 3D sphere colors.
 */
const BADGE_STYLE: Record<WaypointType, string> = {
  Start: 'background:#1a3a1a;color:#44cc44;border:1px solid #44cc44',
  Goal:  'background:#3a1a1a;color:#cc4444;border:1px solid #cc4444',
  Via:   'background:#222;color:#888;border:1px solid #555',
};

@Component({
  selector: 'waypoints-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="waypoints-panel">
      <!-- ── Waypoint list ── -->
      @if (waypoints().length === 0) {
        <div class="wp-empty">
          <p>No waypoints. Preview a plan or add one below.</p>
        </div>
      } @else {
        <div class="wp-list">
          @for (wp of waypoints(); track wp.id; let i = $index) {
            <div
              class="wp-row"
              [class.is-selected]="wp.id === selectedId()"
              (click)="selectWp(wp.id)"
            >
              <span class="wp-badge" [style]="badgeStyle(wp.type)">{{ wp.type }}</span>
              <span class="wp-coords">
                {{ fmtPos(wp.position) }}
              </span>
              <div class="wp-row-actions">
                <button
                  class="wp-move-btn"
                  (click)="moveUp($event, i)"
                  [disabled]="i === 0"
                  title="Move Up"
                >▲</button>
                <button
                  class="wp-move-btn"
                  (click)="moveDown($event, i)"
                  [disabled]="i === waypoints().length - 1"
                  title="Move Down"
                >▼</button>
              </div>
            </div>
          }
        </div>
      }

      <!-- ── Properties for selected waypoint ── -->
      @if (selected(); as wp) {
        <div class="wp-props">
          <div class="wp-props__title">Waypoint Properties</div>

          <!-- Position -->
          <div class="wp-field-group">
            <span class="wp-field-label">Position</span>
            <div class="wp-coord-grid">
              <label>
                X
                <input
                  class="wp-input"
                  type="number"
                  step="0.001"
                  [ngModel]="wp.position[0]"
                  (ngModelChange)="updatePos(wp.id, 0, $event)"
                  (blur)="onBlurNum($event)"
                />
              </label>
              <label>
                Y
                <input
                  class="wp-input"
                  type="number"
                  step="0.001"
                  [ngModel]="wp.position[1]"
                  (ngModelChange)="updatePos(wp.id, 1, $event)"
                  (blur)="onBlurNum($event)"
                />
              </label>
              <label>
                Z
                <input
                  class="wp-input"
                  type="number"
                  step="0.001"
                  [ngModel]="wp.position[2]"
                  (ngModelChange)="updatePos(wp.id, 2, $event)"
                  (blur)="onBlurNum($event)"
                />
              </label>
            </div>
          </div>

          <!-- Orientation (Quaternion) -->
          <div class="wp-field-group">
            <span class="wp-field-label">Orientation (w x y z)</span>
            <div class="wp-coord-grid wp-coord-grid--4">
              <label>
                W
                <input
                  class="wp-input"
                  type="number"
                  step="0.001"
                  [ngModel]="wp.orientation[0]"
                  (ngModelChange)="updateOrient(wp.id, 0, $event)"
                />
              </label>
              <label>
                X
                <input
                  class="wp-input"
                  type="number"
                  step="0.001"
                  [ngModel]="wp.orientation[1]"
                  (ngModelChange)="updateOrient(wp.id, 1, $event)"
                />
              </label>
              <label>
                Y
                <input
                  class="wp-input"
                  type="number"
                  step="0.001"
                  [ngModel]="wp.orientation[2]"
                  (ngModelChange)="updateOrient(wp.id, 2, $event)"
                />
              </label>
              <label>
                Z
                <input
                  class="wp-input"
                  type="number"
                  step="0.001"
                  [ngModel]="wp.orientation[3]"
                  (ngModelChange)="updateOrient(wp.id, 3, $event)"
                />
              </label>
            </div>
          </div>

          <!-- Joints -->
          @if (wp.joints.length > 0) {
            <div class="wp-field-group">
              <span class="wp-field-label">Joints</span>
              <div class="wp-coord-grid">
                @for (j of wp.joints; track $index; let ji = $index) {
                  <label>
                    J{{ ji + 1 }}
                    <input
                      class="wp-input"
                      type="number"
                      step="0.01"
                      [ngModel]="wp.joints[ji]"
                      (ngModelChange)="updateJoint(wp.id, ji, $event)"
                    />
                  </label>
                }
              </div>
            </div>
          }

          <!-- Type selector -->
          <div class="wp-field-group">
            <span class="wp-field-label">Type</span>
            <select
              class="wp-select"
              [ngModel]="wp.type"
              (ngModelChange)="updateType(wp.id, $event)"
            >
              <option value="Start">Start</option>
              <option value="Via">Via</option>
              <option value="Goal">Goal</option>
            </select>
          </div>

          <!-- Actions -->
          <div class="wp-actions-row">
            <button class="wp-btn wp-btn--delete" (click)="deleteWp(wp.id)" [disabled]="!canDelete()">
              Delete Waypoint
            </button>
          </div>
        </div>
      }

      <!-- ── Add button ── -->
      <div class="wp-add-row">
        <button class="wp-btn wp-btn--add" (click)="addWp()">
          + Add Waypoint
        </button>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      font-family: monospace;
    }

    .waypoints-panel {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    /* ── Empty state ── */
    .wp-empty {
      text-align: center;
      padding: 1.5rem 0.5rem;
    }
    .wp-empty p {
      margin: 0;
      font-size: 0.75rem;
      color: #aaa;
    }

    /* ── Waypoint rows ── */
    .wp-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .wp-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.3rem 0.4rem;
      border-radius: 3px;
      cursor: pointer;
      transition: background 0.15s;
      background: #1e1e1e;
      border: 1px solid #333;
    }
    .wp-row:hover {
      background: #252525;
    }
    .wp-row.is-selected {
      background: #2a2a2a;
      border-color: #3399ff;
    }

    .wp-badge {
      flex-shrink: 0;
      font-size: 0.6rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.1rem 0.35rem;
      border-radius: 3px;
    }

    .wp-coords {
      flex: 1;
      font-size: 0.72rem;
      color: #ccc;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .wp-row-actions {
      display: flex;
      gap: 2px;
      flex-shrink: 0;
    }

    .wp-move-btn {
      background: transparent;
      border: 1px solid #444;
      color: #888;
      font-size: 0.6rem;
      padding: 0.1rem 0.3rem;
      border-radius: 2px;
      cursor: pointer;
      line-height: 1;
      transition: background 0.15s, color 0.15s;
    }
    .wp-move-btn:hover:not(:disabled) {
      background: #333;
      color: #ddd;
    }
    .wp-move-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }

    /* ── Properties panel ── */
    .wp-props {
      background: #222;
      border: 1px solid #444;
      border-radius: 3px;
      padding: 0.6rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .wp-props__title {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #888;
      margin: 0;
    }

    .wp-field-group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .wp-field-label {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #888;
      font-weight: 600;
    }

    .wp-coord-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.3rem;
    }
    .wp-coord-grid.wp-coord-grid--4 {
      grid-template-columns: repeat(4, 1fr);
    }
    .wp-coord-grid label {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      font-size: 0.65rem;
      color: #999;
    }

    .wp-input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.2rem 0.3rem;
      font-family: monospace;
      font-size: 0.78rem;
      background: #1a1a1a;
      border: 1px solid #444;
      color: #ddd;
      border-radius: 3px;
    }
    .wp-input:focus {
      border-color: #3399ff;
      outline: none;
    }
    .wp-input.ng-invalid {
      border-color: #cc4444;
    }

    .wp-select {
      padding: 0.25rem 0.3rem;
      font-family: monospace;
      font-size: 0.78rem;
      background: #1a1a1a;
      border: 1px solid #444;
      color: #ddd;
      border-radius: 3px;
    }
    .wp-select:focus {
      border-color: #3399ff;
      outline: none;
    }

    /* ── Buttons ── */
    .wp-actions-row {
      display: flex;
      gap: 0.3rem;
      border-top: 1px solid #333;
      padding-top: 0.4rem;
    }

    .wp-btn {
      font-family: monospace;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.35rem 0.5rem;
      border-radius: 3px;
      border: 1px solid #555;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .wp-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .wp-btn--add {
      background: transparent;
      color: #aaa;
      border: 1px dashed #555;
      width: 100%;
    }
    .wp-btn--add:hover {
      background: #252525;
      color: #ddd;
      border-style: solid;
    }

    .wp-btn--delete {
      background: transparent;
      color: #cc4444;
      border-color: #cc444444;
    }
    .wp-btn--delete:hover:not(:disabled) {
      background: #3a1a1a;
    }

    .wp-add-row {
      margin-top: 0.1rem;
    }
  `,
})
export class WaypointsPanel {
  private readonly store = inject(PlanningStore);

  // ── Signals from store ──

  protected readonly waypoints = this.store.waypoints.asReadonly();
  protected readonly selectedId = this.store.selectedWaypointId.asReadonly();

  /** The full selected waypoint model, or null. */
  protected readonly selected = computed(() => {
    const id = this.selectedId();
    if (!id) return null;
    return this.waypoints().find(wp => wp.id === id) ?? null;
  });

  /** Delete is disabled when only 2 waypoints remain. */
  protected readonly canDelete = computed(() => this.waypoints().length > 2);

  // ── Template helpers ──

  protected badgeStyle(type: WaypointType): string {
    return BADGE_STYLE[type];
  }

  protected fmtPos(pos: [number, number, number]): string {
    return `(${pos[0].toFixed(3)}, ${pos[1].toFixed(3)}, ${pos[2].toFixed(3)})`;
  }

  // ── Actions ──

  protected selectWp(id: string): void {
    this.store.selectWaypoint(id);
  }

  protected addWp(): void {
    this.store.addWaypoint('Via', this.selectedId() ?? undefined);
  }

  protected deleteWp(id: string): void {
    this.store.removeWaypoint(id);
  }

  protected moveUp(event: MouseEvent, index: number): void {
    event.stopPropagation();
    if (index > 0) {
      this.store.reorderWaypoint(index, index - 1);
    }
  }

  protected moveDown(event: MouseEvent, index: number): void {
    event.stopPropagation();
    if (index < this.waypoints().length - 1) {
      this.store.reorderWaypoint(index, index + 1);
    }
  }

  protected updatePos(id: string, axis: 0 | 1 | 2, value: number): void {
    if (!isFinite(value)) return;
    const wp = this.waypoints().find(w => w.id === id);
    if (!wp) return;
    const pos: [number, number, number] = [...wp.position];
    pos[axis] = value;
    this.store.updateWaypoint(id, { position: pos });
  }

  protected updateOrient(id: string, component: 0 | 1 | 2 | 3, value: number): void {
    if (!isFinite(value)) return;
    const wp = this.waypoints().find(w => w.id === id);
    if (!wp) return;
    const orient: [number, number, number, number] = [...wp.orientation];
    orient[component] = value;
    this.store.updateWaypoint(id, { orientation: orient });
  }

  protected updateJoint(id: string, jointIndex: number, value: number): void {
    if (!isFinite(value)) return;
    const wp = this.waypoints().find(w => w.id === id);
    if (!wp) return;
    const joints = [...wp.joints];
    joints[jointIndex] = value;
    this.store.updateWaypoint(id, { joints });
  }

  protected updateType(id: string, type: string): void {
    this.store.updateWaypoint(id, { type: type as WaypointType });
  }

  protected onBlurNum(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    if (!input.value || !isFinite(parseFloat(input.value))) {
      input.value = '0';
    }
  }
}
