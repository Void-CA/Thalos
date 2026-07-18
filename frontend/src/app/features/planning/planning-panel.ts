import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { JointEditor } from '../../shared/components/joint-editor/joint-editor';
import { PoseInputs, PoseInputsValue } from '../../shared/components/pose-inputs/pose-inputs';
import { PlanningStore, SegmentKind, SegmentModel } from '../../shared/store/planning.store';
import { SceneApiService } from '../scene/services/scene-api.service';
import { SceneStore } from '../scene/store/scene.store';
import { PlanAnalysisStore } from '../plan-analysis/store/plan-analysis.store';
import type { MotionPlanRequest, MotionSegmentDto } from '../scene/scene-api.types';

const SEGMENT_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];

@Component({
  selector: 'planning-panel',
  standalone: true,
  imports: [FormsModule, JointEditor, PoseInputs],
  template: `
    <div class="planning-panel">
      @if (planning.segments().length === 0) {
        <div class="planning-panel__empty">
          <p>No segments. Add a motion command to build a program.</p>
        </div>
      }

      @for (seg of planning.segments(); track $index; let i = $index) {
        <div class="planning-panel__segment" [class.is-expanded]="seg.expanded">
          <div class="planning-panel__seg-header" (click)="planning.toggleSegment(i)">
            <span class="planning-panel__seg-dot" [style.background]="segmentColor(i)"></span>
            <span class="planning-panel__seg-title">
              Segment {{ i + 1 }} — {{ seg.kind === 'movej' ? 'MoveJ' : 'MoveL' }}
            </span>
            <span class="planning-panel__seg-chevron">{{ seg.expanded ? '▼' : '▶' }}</span>
            <button class="planning-panel__seg-remove" (click)="removeSegment($event, i)" title="Remove segment">&times;</button>
          </div>

          @if (seg.expanded) {
            <div class="planning-panel__seg-body">
              @if (seg.kind === 'movej') {
                <joint-editor
                  [initialValues]="seg.joints"
                  (valueChange)="planning.updateSegmentJoints(i, $event)"
                />
                <label class="planning-panel__field">
                  <span class="planning-panel__field-label">Velocity (optional)</span>
                  <input
                    class="planning-panel__num-input"
                    type="number" step="0.1" min="0.01"
                    [ngModel]="seg.velocityStr"
                    (ngModelChange)="planning.updateField(i, 'velocityStr', $event)"
                    placeholder="default"
                  />
                </label>
              } @else {
                <pose-inputs
                  [value]="segmentToPoseValue(seg)"
                  [showTypeSelector]="false"
                  (valueChange)="onPoseChange(i, $event)"
                />
                <label class="planning-panel__field">
                  <span class="planning-panel__field-label">Velocity (optional)</span>
                  <input type="number" step="0.1" min="0.01" class="planning-panel__num-input"
                    [ngModel]="seg.velocityStr"
                    (ngModelChange)="planning.updateField(i, 'velocityStr', $event)" placeholder="default" />
                </label>
              }
            </div>
          }
        </div>
      }

      <div class="planning-panel__add-row">
        <button class="planning-panel__add-btn" (click)="addSegment('movej')">+ MoveJ</button>
        <button class="planning-panel__add-btn" (click)="addSegment('movel')">+ MoveL</button>
      </div>

      <div class="planning-panel__actions">
        <button
          class="planning-panel__submit"
          (click)="previewPlan()"
          [disabled]="loading() || planning.segments().length === 0"
        >
          {{ loading() ? 'Compiling…' : 'Preview' }}
        </button>
      </div>

      @if (error()) {
        <div class="planning-panel__error">{{ error() }}</div>
      }
    </div>
  `,
  styleUrl: './planning-panel.scss',
})
export class PlanningPanel {
  protected readonly planning = inject(PlanningStore);
  private readonly api = inject(SceneApiService);
  private readonly scene = inject(SceneStore);
  private readonly analysis = inject(PlanAnalysisStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  private get dof(): number {
    return this.scene.state()?.runtime?.robot.dof ?? 0;
  }

  // ── Segment management delegates to store ──

  protected addSegment(kind: SegmentKind): void {
    this.planning.addSegment(kind, this.dof);
  }

  protected removeSegment(event: MouseEvent, index: number): void {
    event.stopPropagation();
    this.planning.removeSegment(index);
  }

  protected onPoseChange(i: number, v: PoseInputsValue): void {
    this.planning.updateSegmentPose(i, v);
  }

  protected segmentColor(index: number): string {
    return SEGMENT_COLORS[index % SEGMENT_COLORS.length];
  }

  // ── Helpers ──

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

  private parseFloatOpt(s: string): number | undefined {
    const v = parseFloat(s);
    return isFinite(v) ? v : undefined;
  }

  // ── Build the API request ──

  private buildPlanRequest(): MotionPlanRequest {
    const segments: MotionSegmentDto[] = [];

    for (const seg of this.planning.segments()) {
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
    if (this.planning.segments().length === 0) return;

    const request = this.buildPlanRequest();

    this.error.set(null);
    this.loading.set(true);

    this.api.previewPlan(request).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: res => {
        this.scene.applySnapshot(res);
        // Defer loading flag to next microtask — evita NG0100
        // cuando el Observable emite sincrónicamente (zoneless).
        queueMicrotask(() => this.loading.set(false));
        // Auto-analyze the freshly compiled plan
        this.analysis.analyzePlan();
      },
      error: (err: Error) => {
        this.error.set(err.message ?? 'Plan compilation failed');
        queueMicrotask(() => this.loading.set(false));
      },
    });
  }
}
