import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { JointEditor } from '../../shared/components/joint-editor/joint-editor';
import { PoseInputs, PoseInputsValue } from '../../shared/components/pose-inputs/pose-inputs';
import { SceneApiService } from '../scene/services/scene-api.service';
import { SceneStore } from '../scene/store/scene.store';
import { PlanningStore } from './planning.store';
import { PlanValidationService } from './services/plan-validation.service';
import { NotificationService } from '../../shared/services/notification.service';
import type { MotionPlanRequest, MotionSegmentDto } from '../scene/scene-api.types';
import type { VisualWaypointDto } from '../scene/scene-api.types';
import type { WaypointModel, SegmentModel, SegmentKind } from './planning.types';
import { createSegment } from './planning.types';

const SEGMENT_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
];

@Component({
  selector: 'planning-panel',
  standalone: true,
  imports: [FormsModule, JointEditor, PoseInputs],
  template: `
    <div class="planning-panel">
      <!-- ── Empty state ── -->
      @if (planningStore.segments().length === 0) {
        <div class="planning-panel__empty">
          <p>No segments. Add a motion command to build a program.</p>
        </div>
      }

      <!-- ── Segment list ── -->
      @for (seg of planningStore.segments(); track $index; let i = $index) {
        <div class="planning-panel__segment" [class.is-expanded]="seg.expanded">
          <!-- Header -->
          <div class="planning-panel__seg-header" (click)="toggleSegment(i)">
            <span class="planning-panel__seg-dot" [style.background]="segmentColor(i)"></span>
            <span class="planning-panel__seg-title">
              Segment {{ i + 1 }} — {{ seg.kind === 'movej' ? 'MoveJ' : 'MoveL' }}
            </span>
            <span class="planning-panel__seg-chevron">{{ seg.expanded ? '▼' : '▶' }}</span>
            <button class="planning-panel__seg-remove" (click)="removeSegment($event, i)" title="Remove segment">&times;</button>
          </div>

          <!-- Body -->
          @if (seg.expanded) {
            <div class="planning-panel__seg-body">
              @if (seg.kind === 'movej') {
                <joint-editor
                  [initialValues]="seg.joints"
                  (valueChange)="updateSegmentJoints(i, $event)"
                />
                <label class="planning-panel__field">
                  <span class="planning-panel__field-label">Velocity (optional)</span>
                  <input
                    class="planning-panel__num-input"
                    type="number"
                    step="0.1"
                    min="0.01"
                    [ngModel]="seg.velocityStr"
                    (ngModelChange)="updateField(i, 'velocityStr', $event)"
                    placeholder="default"
                  />
                </label>
              } @else {
                <pose-inputs
                  [value]="segmentToPoseValue(seg)"
                  [showTypeSelector]="false"
                  (valueChange)="updateSegmentPose(i, $event)"
                />
                <label class="planning-panel__field">
                  <span class="planning-panel__field-label">Velocity (optional)</span>
                  <input type="number" step="0.1" min="0.01" class="planning-panel__num-input"
                    [ngModel]="seg.velocityStr" (ngModelChange)="updateField(i, 'velocityStr', $event)" placeholder="default" />
                </label>
              }
            </div>
          }
        </div>
      }

      <!-- ── Add segment buttons ── -->
      <div class="planning-panel__add-row">
        <button class="planning-panel__add-btn" (click)="addSegment('movej')">
          + MoveJ
        </button>
        <button class="planning-panel__add-btn" (click)="addSegment('movel')">
          + MoveL
        </button>
      </div>

      <!-- ── Actions ── -->
      <div class="planning-panel__actions">
        <button
          class="planning-panel__submit"
          (click)="previewPlan()"
          [disabled]="loading() || planningStore.segments().length === 0"
        >
          {{ loading() ? 'Compiling…' : 'Preview' }}
        </button>
      </div>

      <!-- ── Error ── -->
      @if (error()) {
        <div class="planning-panel__error">{{ error() }}</div>
      }
    </div>
  `,
  styleUrl: './planning-panel.scss',
})
export class PlanningPanel {
  private readonly api = inject(SceneApiService);
  private readonly store = inject(SceneStore);
  protected readonly planningStore = inject(PlanningStore);
  private readonly planValidation = inject(PlanValidationService);
  private readonly notifications = inject(NotificationService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  private get dof(): number {
    return this.store.state()?.runtime?.robot.dof ?? 0;
  }

  // ── Segment management ──

  protected addSegment(kind: SegmentKind): void {
    this.planningStore.segments.update(arr => [...arr, createSegment(kind, this.dof)]);
  }

  protected removeSegment(event: MouseEvent, index: number): void {
    event.stopPropagation();
    this.planningStore.segments.update(arr => arr.filter((_, i) => i !== index));
  }

  protected toggleSegment(index: number): void {
    this.planningStore.segments.update(arr => {
      const next = [...arr];
      next[index] = { ...next[index], expanded: !next[index].expanded };
      return next;
    });
  }

  protected updateField(i: number, field: keyof SegmentModel, value: any): void {
    this.planningStore.segments.update(arr => {
      const next = [...arr];
      (next[i] as any)[field] = value;
      return next;
    });
  }

  /** Called by JointEditor when user changes any joint value in a MoveJ segment. */
  protected updateSegmentJoints(segIndex: number, joints: number[]): void {
    this.planningStore.segments.update(arr => {
      const next = [...arr];
      next[segIndex] = { ...next[segIndex], joints };
      return next;
    });
  }

  /** Called by PoseInputs when user changes any input in a MoveL segment. */
  protected updateSegmentPose(i: number, v: PoseInputsValue): void {
    this.planningStore.segments.update(arr => {
      const next = [...arr];
      next[i] = {
        ...next[i],
        txStr: String(v.translation[0]),
        tyStr: String(v.translation[1]),
        tzStr: String(v.translation[2]),
        rotationFormat: v.rotationFormat,
        yawStr: String(v.yprDeg[0]),
        pitchStr: String(v.yprDeg[1]),
        rollStr: String(v.yprDeg[2]),
        qwStr: String(v.quaternion[0]),
        qxStr: String(v.quaternion[1]),
        qyStr: String(v.quaternion[2]),
        qzStr: String(v.quaternion[3]),
      };
      return next;
    });
  }

  /** Convert a SegmentModel's pose fields to PoseInputsValue for initial display. */
  protected segmentToPoseValue(seg: SegmentModel): PoseInputsValue {
    return {
      translation: [
        parseFloat(seg.txStr) || 0,
        parseFloat(seg.tyStr) || 0,
        parseFloat(seg.tzStr) || 0,
      ],
      rotationFormat: seg.rotationFormat,
      yprDeg: [
        parseFloat(seg.yawStr) || 0,
        parseFloat(seg.pitchStr) || 0,
        parseFloat(seg.rollStr) || 0,
      ],
      quaternion: [
        parseFloat(seg.qwStr) || 1,
        parseFloat(seg.qxStr) || 0,
        parseFloat(seg.qyStr) || 0,
        parseFloat(seg.qzStr) || 0,
      ],
    };
  }

  protected segmentColor(index: number): string {
    return SEGMENT_COLORS[index % SEGMENT_COLORS.length];
  }

  // ── Parsing helpers ──

  private parseFloatOpt(s: string): number | undefined {
    const v = parseFloat(s);
    return isFinite(v) ? v : undefined;
  }

  private parseIntOpt(s: string): number | undefined {
    const v = parseInt(s, 10);
    return isFinite(v) ? v : undefined;
  }

  // ── Build the API request ──

  private buildPlanRequest(): MotionPlanRequest {
    const segments: MotionSegmentDto[] = [];

    for (const seg of this.planningStore.segments()) {
      if (seg.kind === 'movej') {
        segments.push({ type: 'movej', target: seg.joints });
      } else {
        const translation: [number, number, number] = [
          this.parseFloatOpt(seg.txStr) ?? 0,
          this.parseFloatOpt(seg.tyStr) ?? 0,
          this.parseFloatOpt(seg.tzStr) ?? 0,
        ];
        const rotation = seg.rotationFormat === 'euler'
          ? {
              kind: 'Ypr' as const,
              value: {
                yaw:   (this.parseFloatOpt(seg.yawStr) ?? 0) * Math.PI / 180,
                pitch: (this.parseFloatOpt(seg.pitchStr) ?? 0) * Math.PI / 180,
                roll:  (this.parseFloatOpt(seg.rollStr) ?? 0) * Math.PI / 180,
              },
            }
          : {
              kind: 'Quaternion' as const,
              value: {
                w: this.parseFloatOpt(seg.qwStr) ?? 1,
                x: this.parseFloatOpt(seg.qxStr) ?? 0,
                y: this.parseFloatOpt(seg.qyStr) ?? 0,
                z: this.parseFloatOpt(seg.qzStr) ?? 0,
              },
            };
        segments.push({ type: 'movel', target: { translation, rotation } });
      }
    }

    return { segments };
  }

  // ── Preview ──

  protected previewPlan(): void {
    if (this.planningStore.segments().length === 0) return;

    // Pre-validate velocity before sending the request
    const velocityError = this.planValidation.preValidateVelocity(this.planningStore.segments());
    if (velocityError) {
      this.planningStore.setSegmentError(velocityError);
      this.error.set(velocityError.message);
      return;
    }

    this.planningStore.clearErrors();
    this.error.set(null);
    this.loading.set(true);

    const request = this.buildPlanRequest();

    this.api.previewPlan(request).subscribe({
      next: res => {
        this.planningStore.clearErrors();
        this.store.applySnapshot(res);
        this.loading.set(false);

        // Feed response waypoints into PlanningStore
        const waypoints = res.active_plan?.visualization?.waypoints;
        if (waypoints && waypoints.length > 0) {
          this.planningStore.setWaypoints(this.mapWaypoints(waypoints));
        }
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);

        if (err.status === 422) {
          const result = this.planValidation.parse(err);
          if (result.segmentIndex !== undefined) {
            this.planningStore.setSegmentError(result);
          }
          this.error.set(result.message);
          this.notifications.error(result.message);
        } else if (err.status === 0) {
          const msg = 'Could not reach Thalos server. Is the backend running on port 3000?';
          this.error.set(msg);
          this.notifications.error(msg);
        } else if (err.status === 504) {
          const msg = 'Request timed out. Check your network connection and try again.';
          this.error.set(msg);
          this.notifications.error(msg);
        } else {
          const msg = err.message ?? 'Plan compilation failed';
          this.error.set(msg);
          // Global interceptor also catches this, but we show it inline too
        }
      },
    });
  }

  /** Map API VisualWaypointDto[] to WaypointModel[] for the PlanningStore. */
  private mapWaypoints(dtos: VisualWaypointDto[]): WaypointModel[] {
    return dtos.map(dto => ({
      id: crypto.randomUUID(),
      position: dto.position,
      orientation: dto.orientation,
      joints: dto.joints,
      type: dto.waypoint_type,
    }));
  }
}
