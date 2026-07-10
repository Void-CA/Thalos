import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlanningStore, segmentsToMotionRequest } from './planning.store';
import { ModeStore } from '../../shared/store/mode.store';
import { SceneApiService } from '../scene/services/scene-api.service';
import { SceneStore } from '../scene/store/scene.store';
import { NotificationService } from '../../shared/services/notification.service';
import { PlanValidationService } from './services/plan-validation.service';
import { HttpErrorResponse } from '@angular/common/http';
import type { MotionPlanRequest } from '../scene/scene-api.types';
import type { SegmentModel } from './planning.types';

type NotificationType = 'success' | 'error';

/**
 * Plan Management Panel — accordion component for creating, duplicating, renaming,
 * deleting, exporting, importing, and reproducing motion plans.
 *
 * All data flows through PlanningStore: read from store signals, write through store methods.
 * Follows the same standalone component pattern as execution-panel.ts.
 */
@Component({
  selector: 'plan-management-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="plan-mgmt-panel">
      <!-- ── Notification toast ── -->
      @if (notification(); as n) {
        <div
          class="plan-mgmt__toast"
          [class.toast--success]="n.type === 'success'"
          [class.toast--error]="n.type === 'error'"
        >
          {{ n.message }}
        </div>
      }

      <!-- ── Create plan inline form ── -->
      @if (showCreateInput()) {
        <div class="plan-mgmt__inline-form">
          <input
            class="plan-mgmt__input"
            type="text"
            placeholder="Plan name"
            [ngModel]="createNameValue()"
            (ngModelChange)="createNameValue.set($event)"
            (keydown.enter)="confirmCreate()"
            (keydown.escape)="cancelCreate()"
            autofocus
          />
          <button class="plan-mgmt__btn plan-mgmt__btn--primary" (click)="confirmCreate()">Create</button>
          <button class="plan-mgmt__btn plan-mgmt__btn--cancel" (click)="cancelCreate()">Cancel</button>
        </div>
      }

      <!-- ── Rename inline form ── -->
      @if (renamePlanId(); as rid) {
        <div class="plan-mgmt__inline-form">
          <input
            class="plan-mgmt__input"
            type="text"
            [ngModel]="renameValue()"
            (ngModelChange)="renameValue.set($event)"
            (keydown.enter)="confirmRename()"
            (keydown.escape)="cancelRename()"
            autofocus
          />
          <button class="plan-mgmt__btn plan-mgmt__btn--primary" (click)="confirmRename()">Save</button>
          <button class="plan-mgmt__btn plan-mgmt__btn--cancel" (click)="cancelRename()">Cancel</button>
        </div>
      }

      <!-- ── Delete confirmation ── -->
      @if (deleteConfirmPlanId(); as did) {
        <div class="plan-mgmt__confirm">
          <p class="plan-mgmt__confirm-text">
            Delete plan '<strong>{{ getPlanName(did) }}</strong>'?
          </p>
          <div class="plan-mgmt__confirm-actions">
            <button class="plan-mgmt__btn plan-mgmt__btn--danger" (click)="confirmDelete(did)">Delete</button>
            <button class="plan-mgmt__btn plan-mgmt__btn--cancel" (click)="cancelDelete()">Cancel</button>
          </div>
        </div>
      }

      <!-- ── Action bar ── -->
      <div class="plan-mgmt__actions">
        <button class="plan-mgmt__btn" (click)="startCreate()">+ New Plan</button>
        @if (activePlan()) {
          <button class="plan-mgmt__btn" (click)="duplicateActive()">Duplicate</button>
          <button class="plan-mgmt__btn" (click)="startRename()">Rename</button>
          <button class="plan-mgmt__btn plan-mgmt__btn--danger" (click)="startDelete()">Delete</button>
        }
      </div>

      <!-- ── Plan list (sorted by updatedAt desc) ── -->
      @if (sortedPlans().length === 0) {
        <p class="plan-mgmt__empty">No saved plans. Create one to get started.</p>
      } @else {
        <div class="plan-mgmt__list">
          @for (plan of sortedPlans(); track plan.id) {
            <div
              class="plan-mgmt__item"
              [class.is-active]="plan.id === store.activePlanId()"
              (click)="store.selectPlan(plan.id)"
            >
              <span class="plan-mgmt__item-indicator">
                {{ plan.id === store.activePlanId() ? '●' : '○' }}
              </span>
              <div class="plan-mgmt__item-info">
                <span class="plan-mgmt__item-name">{{ plan.name }}</span>
                <span class="plan-mgmt__item-meta">
                  {{ plan.segments.length }} segs
                  @if (plan.waypoints.length > 0) {
                    · {{ plan.waypoints.length }} wpts
                  }
                  · {{ formatDate(plan.updatedAt) }}
                </span>
              </div>
            </div>
          }
        </div>
      }

      <!-- ── Active plan info ── -->
      @if (activePlan(); as p) {
        <div class="plan-mgmt__info">
          <div class="plan-mgmt__info-row">
            <span class="plan-mgmt__info-label">Segments</span>
            <span class="plan-mgmt__info-value">{{ p.segments.length }}</span>
          </div>
          <div class="plan-mgmt__info-row">
            <span class="plan-mgmt__info-label">Waypoints</span>
            <span class="plan-mgmt__info-value">{{ p.waypoints.length }}</span>
          </div>
          <div class="plan-mgmt__info-row">
            <span class="plan-mgmt__info-label">Created</span>
            <span class="plan-mgmt__info-value">{{ formatDateTime(p.createdAt) }}</span>
          </div>
          <div class="plan-mgmt__info-row">
            <span class="plan-mgmt__info-label">Updated</span>
            <span class="plan-mgmt__info-value">{{ formatDateTime(p.updatedAt) }}</span>
          </div>
        </div>
      }

      <!-- ── Export / Import section ── -->
      <div class="plan-mgmt__section">
        <div class="plan-mgmt__file-actions">
          <button
            class="plan-mgmt__btn"
            [disabled]="!activePlan()"
            (click)="exportPlan()"
          >
            Download JSON
          </button>
          <button class="plan-mgmt__btn" (click)="fileInput.click()">Import JSON</button>
          <input
            #fileInput
            type="file"
            accept=".json,application/json"
            (change)="importPlan($event)"
            hidden
          />
        </div>
      </div>

      <!-- ── Reproduce / Execute ── -->
      <div class="plan-mgmt__reproduce">
        <button
          class="plan-mgmt__btn plan-mgmt__btn--execute"
          [disabled]="!canReproduce() || reproduceLoading()"
          [title]="reproduceTooltip()"
          (click)="reproducePlan()"
        >
          {{ reproduceLoading() ? 'Compiling…' : '▶ Reproduce' }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .plan-mgmt-panel {
      font-family: monospace;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    /* ── Toast notification ── */

    .plan-mgmt__toast {
      font-size: 0.72rem;
      padding: 0.35rem 0.6rem;
      border-radius: 3px;
      animation: toastIn 0.2s ease-out;
    }

    .toast--success {
      background: #1a3a1a;
      color: #44cc44;
      border: 1px solid #2a5a2a;
    }

    .toast--error {
      background: #3a1a1a;
      color: #cc4444;
      border: 1px solid #5a2a2a;
    }

    @keyframes toastIn {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ── Inline form (create / rename) ── */

    .plan-mgmt__inline-form {
      display: flex;
      gap: 0.35rem;
      align-items: center;
    }

    .plan-mgmt__input {
      flex: 1;
      font-family: monospace;
      font-size: 0.75rem;
      padding: 0.3rem 0.45rem;
      border-radius: 3px;
      border: 1px solid #555;
      background: #1a1a1a;
      color: #ddd;
      outline: none;
    }

    .plan-mgmt__input:focus {
      border-color: #33ccff;
    }

    /* ── Delete confirmation ── */

    .plan-mgmt__confirm {
      background: #2a1a1a;
      border: 1px solid #5a2a2a;
      border-radius: 3px;
      padding: 0.5rem 0.6rem;
    }

    .plan-mgmt__confirm-text {
      margin: 0 0 0.4rem;
      font-size: 0.78rem;
      color: #ddd;
    }

    .plan-mgmt__confirm-actions {
      display: flex;
      gap: 0.35rem;
    }

    /* ── Action bar ── */

    .plan-mgmt__actions {
      display: flex;
      gap: 0.35rem;
      flex-wrap: wrap;
    }

    /* ── Buttons ── */

    .plan-mgmt__btn {
      font-family: monospace;
      font-size: 0.7rem;
      padding: 0.25rem 0.5rem;
      border-radius: 3px;
      border: 1px solid #555;
      background: #222;
      color: #ddd;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      white-space: nowrap;
    }

    .plan-mgmt__btn:hover:not(:disabled) {
      background: #333;
    }

    .plan-mgmt__btn:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .plan-mgmt__btn--primary {
      border-color: #33ccff;
      color: #33ccff;
    }
    .plan-mgmt__btn--primary:hover:not(:disabled) {
      background: #1a2a3a;
    }

    .plan-mgmt__btn--danger {
      border-color: #cc4444;
      color: #cc4444;
    }
    .plan-mgmt__btn--danger:hover:not(:disabled) {
      background: #3a1a1a;
    }

    .plan-mgmt__btn--cancel {
      border-color: #888;
      color: #888;
    }
    .plan-mgmt__btn--cancel:hover:not(:disabled) {
      background: #2a2a2a;
    }

    .plan-mgmt__btn--execute {
      border-color: #44cc44;
      color: #44cc44;
      font-size: 0.75rem;
      padding: 0.35rem 0.8rem;
    }
    .plan-mgmt__btn--execute:hover:not(:disabled) {
      background: #1a3a1a;
    }

    /* ── Plan list ── */

    .plan-mgmt__empty {
      text-align: center;
      font-size: 0.75rem;
      opacity: 0.5;
      margin: 0.5rem 0;
    }

    .plan-mgmt__list {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      max-height: 240px;
      overflow-y: auto;
    }

    .plan-mgmt__item {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.45rem;
      border-radius: 3px;
      cursor: pointer;
      transition: background 0.12s;
      border: 1px solid transparent;
    }

    .plan-mgmt__item:hover {
      background: #2a2a2a;
    }

    .plan-mgmt__item.is-active {
      background: #1a2a3a;
      border-color: #33ccff;
    }

    .plan-mgmt__item-indicator {
      font-size: 0.65rem;
      color: #33ccff;
      width: 0.8rem;
      text-align: center;
      flex-shrink: 0;
    }

    .plan-mgmt__item:not(.is-active) .plan-mgmt__item-indicator {
      color: #555;
    }

    .plan-mgmt__item-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .plan-mgmt__item-name {
      font-size: 0.78rem;
      font-weight: 600;
      color: #ddd;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .plan-mgmt__item-meta {
      font-size: 0.62rem;
      opacity: 0.5;
    }

    /* ── Active plan info ── */

    .plan-mgmt__info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      border-top: 1px solid #333;
      padding-top: 0.5rem;
    }

    .plan-mgmt__info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.72rem;
    }

    .plan-mgmt__info-label {
      opacity: 0.6;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 0.65rem;
    }

    .plan-mgmt__info-value {
      font-weight: 600;
    }

    /* ── File actions ── */

    .plan-mgmt__section {
      border-top: 1px solid #333;
      padding-top: 0.5rem;
    }

    .plan-mgmt__file-actions {
      display: flex;
      gap: 0.35rem;
    }

    /* ── Reproduce ── */

    .plan-mgmt__reproduce {
      border-top: 1px solid #333;
      padding-top: 0.5rem;
      text-align: center;
    }
  `,
})
export class PlanManagementPanel {
  readonly store = inject(PlanningStore);
  private readonly modeStore = inject(ModeStore);
  private readonly api = inject(SceneApiService);
  private readonly sceneStore = inject(SceneStore);
  private readonly planValidation = inject(PlanValidationService);
  private readonly notifications = inject(NotificationService);

  // ── UI state signals ──

  protected readonly notification = signal<{ type: NotificationType; message: string } | null>(null);
  protected readonly showCreateInput = signal(false);
  protected readonly createNameValue = signal('');
  protected readonly renamePlanId = signal<string | null>(null);
  protected readonly renameValue = signal('');
  protected readonly deleteConfirmPlanId = signal<string | null>(null);
  protected readonly reproduceLoading = signal(false);
  private notificationTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Computed ──

  /** The currently active plan, or null. */
  protected readonly activePlan = computed(() => {
    const id = this.store.activePlanId();
    if (!id) return null;
    return this.store.plans().find(p => p.id === id) ?? null;
  });

  /** All plans sorted by most recently updated first. */
  protected readonly sortedPlans = computed(() => {
    return [...this.store.plans()].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  });

  /** True when the reproduce button should be enabled. */
  protected readonly canReproduce = computed(() => {
    const plan = this.activePlan();
    return !!plan && plan.segments.length > 0;
  });

  /** Tooltip text for the reproduce button. */
  protected readonly reproduceTooltip = computed(() => {
    if (!this.activePlan()) return 'Select a plan first';
    if (this.activePlan()!.segments.length === 0) return 'Add at least one segment before reproducing';
    return '';
  });

  // ── Helpers ──

  protected getPlanName(id: string): string {
    return this.store.plans().find(p => p.id === id)?.name ?? 'unknown';
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString();
  }

  protected formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  // ── Notification ──

  private showNotification(type: NotificationType, message: string): void {
    if (this.notificationTimer) clearTimeout(this.notificationTimer);
    this.notification.set({ type, message });
    this.notificationTimer = setTimeout(() => this.notification.set(null), 3000);
  }

  // ── Create ──

  protected startCreate(): void {
    this.showCreateInput.set(true);
    this.createNameValue.set('');
  }

  protected confirmCreate(): void {
    const name = this.createNameValue().trim() || undefined;
    this.store.createPlan(name);
    this.showCreateInput.set(false);

    const created = this.store.plans().find(p => p.id === this.store.activePlanId());
    const label = created?.name ?? '';
    this.showNotification('success', `Plan '${label}' created`);
  }

  protected cancelCreate(): void {
    this.showCreateInput.set(false);
  }

  // ── Duplicate ──

  protected duplicateActive(): void {
    const id = this.store.activePlanId();
    if (!id) return;
    const copy = this.store.duplicatePlan(id);
    if (copy) {
      this.showNotification('success', `Duplicated as '${copy.name}'`);
    }
  }

  // ── Rename ──

  protected startRename(): void {
    const id = this.store.activePlanId();
    const plan = this.activePlan();
    if (!id || !plan) return;
    this.renamePlanId.set(id);
    this.renameValue.set(plan.name);
  }

  protected confirmRename(): void {
    const id = this.renamePlanId();
    const name = this.renameValue().trim();
    if (!id || !name) return;
    this.store.renamePlan(id, name);
    this.renamePlanId.set(null);
    this.showNotification('success', `Plan renamed to '${name}'`);
  }

  protected cancelRename(): void {
    this.renamePlanId.set(null);
  }

  // ── Delete ──

  protected startDelete(): void {
    this.deleteConfirmPlanId.set(this.store.activePlanId());
  }

  protected confirmDelete(id: string): void {
    this.store.deletePlan(id);
    this.deleteConfirmPlanId.set(null);
    this.showNotification('success', 'Plan deleted');
  }

  protected cancelDelete(): void {
    this.deleteConfirmPlanId.set(null);
  }

  // ── Export ──

  protected exportPlan(): void {
    const id = this.store.activePlanId();
    if (!id) return;

    const blob = this.store.exportPlanJson(id);
    if (!blob) return;

    const plan = this.activePlan();
    const filename = plan ? `${plan.name}.json` : 'plan.json';
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();

    URL.revokeObjectURL(url);
    this.showNotification('success', `Plan exported as '${filename}'`);
  }

  // ── Import ──

  protected importPlan(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Basic file-type guard
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      this.showNotification('error', 'Invalid plan file. Must be a JSON file.');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const result = this.store.importPlanJson(text);
      if (result) {
        this.showNotification('success', `Plan '${result.name}' imported`);
      } else {
        this.showNotification('error', 'Invalid plan file. Could not parse.');
      }
      input.value = '';
    };
    reader.onerror = () => {
      this.showNotification('error', 'Failed to read file.');
      input.value = '';
    };
    reader.readAsText(file);
  }

  // ── Reproduce / Execute ──

  /**
   * Compiles the active plan via the API and switches to execution mode.
   * The user can then press Start in the Execution panel.
   */
  protected reproducePlan(): void {
    const plan = this.activePlan();
    if (!plan || plan.segments.length === 0) return;

    this.reproduceLoading.set(true);

    // Convierte SegmentModel[] (modelo UI) → MotionSegmentDto[] (formato API)
    const request = segmentsToMotionRequest(plan.segments as SegmentModel[]);

    this.api.previewPlan(request).subscribe({
      next: (res) => {
        this.sceneStore.applySnapshot(res);
        this.modeStore.setMode('execution');
        this.reproduceLoading.set(false);
        this.showNotification('success', `Plan '${plan.name}' sent to execution`);
        this.notifications.success(`Plan '${plan.name}' sent to execution`);
      },
      error: (err: HttpErrorResponse) => {
        this.reproduceLoading.set(false);

        if (err.status === 422) {
          const result = this.planValidation.parse(err);
          if (result.segmentIndex !== undefined) {
            this.store.setSegmentError(result);
          }
          this.showNotification('error', result.message);
          this.notifications.error(result.message);
        } else if (err.status === 0) {
          const msg = 'Could not reach Thalos server. Is the backend running on port 3000?';
          this.showNotification('error', msg);
          this.notifications.error(msg);
        } else if (err.status === 504) {
          const msg = 'Request timed out. Check your network connection and try again.';
          this.showNotification('error', msg);
          this.notifications.error(msg);
        } else {
          const msg = err.message ?? 'Failed to compile plan for execution';
          this.showNotification('error', msg);
          this.notifications.error(msg);
        }
      },
    });
  }
}
