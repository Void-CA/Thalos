import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SceneApiService } from '../scene/services/scene-api.service';
import { SceneStore } from '../scene/store/scene.store';
import type { MotionPlanRequest, MotionSegmentDto } from '../scene/scene-api.types';

type SegmentKind = 'movej' | 'movel';

interface SegmentModel {
  kind: SegmentKind;
  expanded: boolean;
  // MoveJ
  joints: number[];
  // MoveL
  txStr: string;
  tyStr: string;
  tzStr: string;
  rotationFormat: 'euler' | 'quaternion';
  yawStr: string;
  pitchStr: string;
  rollStr: string;
  qwStr: string;
  qxStr: string;
  qyStr: string;
  qzStr: string;
  frameIdStr: string;
  // Common
  velocityStr: string;
}

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

function createSegment(kind: SegmentKind, dof: number): SegmentModel {
  return {
    kind,
    expanded: true,
    joints: new Array(dof).fill(0),
    txStr: '0.3',
    tyStr: '0',
    tzStr: '0',
    rotationFormat: 'euler',
    yawStr: '0',
    pitchStr: '0',
    rollStr: '0',
    qwStr: '1',
    qxStr: '0',
    qyStr: '0',
    qzStr: '0',
    frameIdStr: '',
    velocityStr: '',
  };
}

@Component({
  selector: 'planning-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="planning-panel">
      <!-- ── Empty state ── -->
      @if (segments().length === 0) {
        <div class="planning-panel__empty">
          <p>No segments. Add a motion command to build a program.</p>
        </div>
      }

      <!-- ── Segment list ── -->
      @for (seg of segments(); track $index; let i = $index) {
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
                <!-- ── MoveJ controls ── -->
                @if (jointNames().length > 0) {
                  <div class="planning-panel__joint-grid">
                    @for (name of jointNames(); track $index; let ji = $index) {
                      <label>
                        <span class="planning-panel__joint-label">{{ name }}</span>
                        <input
                          type="number"
                          step="0.01"
                          class="planning-panel__num-input"
                          [ngModel]="seg.joints[ji]"
                          (ngModelChange)="updateJoint(i, ji, $event)"
                        />
                      </label>
                    }
                  </div>
                }
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
                <!-- ── MoveL controls ── -->
                <div class="planning-panel__coord-grid">
                  <label>X
                    <input type="number" step="0.01" class="planning-panel__num-input"
                      [ngModel]="seg.txStr" (ngModelChange)="updateField(i, 'txStr', $event)" />
                  </label>
                  <label>Y
                    <input type="number" step="0.01" class="planning-panel__num-input"
                      [ngModel]="seg.tyStr" (ngModelChange)="updateField(i, 'tyStr', $event)" />
                  </label>
                  <label>Z
                    <input type="number" step="0.01" class="planning-panel__num-input"
                      [ngModel]="seg.tzStr" (ngModelChange)="updateField(i, 'tzStr', $event)" />
                  </label>
                </div>

                <!-- Rotation format -->
                <div class="segmented" role="radiogroup" aria-label="Rotation format">
                  <button
                    type="button"
                    role="radio"
                    class="segmented__btn"
                    [class.is-active]="seg.rotationFormat === 'euler'"
                    (click)="updateField(i, 'rotationFormat', 'euler')"
                  >Euler</button>
                  <button
                    type="button"
                    role="radio"
                    class="segmented__btn"
                    [class.is-active]="seg.rotationFormat === 'quaternion'"
                    (click)="updateField(i, 'rotationFormat', 'quaternion')"
                  >Quaternion</button>
                </div>

                @if (seg.rotationFormat === 'euler') {
                  <div class="planning-panel__coord-grid">
                    <label>Yaw °
                      <input type="number" step="1" class="planning-panel__num-input"
                        [ngModel]="seg.yawStr" (ngModelChange)="updateField(i, 'yawStr', $event)" />
                    </label>
                    <label>Pitch °
                      <input type="number" step="1" class="planning-panel__num-input"
                        [ngModel]="seg.pitchStr" (ngModelChange)="updateField(i, 'pitchStr', $event)" />
                    </label>
                    <label>Roll °
                      <input type="number" step="1" class="planning-panel__num-input"
                        [ngModel]="seg.rollStr" (ngModelChange)="updateField(i, 'rollStr', $event)" />
                    </label>
                  </div>
                } @else {
                  <div class="planning-panel__coord-grid planning-panel__coord-grid--quat">
                    <label>W
                      <input type="number" step="0.01" class="planning-panel__num-input"
                        [ngModel]="seg.qwStr" (ngModelChange)="updateField(i, 'qwStr', $event)" />
                    </label>
                    <label>X
                      <input type="number" step="0.01" class="planning-panel__num-input"
                        [ngModel]="seg.qxStr" (ngModelChange)="updateField(i, 'qxStr', $event)" />
                    </label>
                    <label>Y
                      <input type="number" step="0.01" class="planning-panel__num-input"
                        [ngModel]="seg.qyStr" (ngModelChange)="updateField(i, 'qyStr', $event)" />
                    </label>
                    <label>Z
                      <input type="number" step="0.01" class="planning-panel__num-input"
                        [ngModel]="seg.qzStr" (ngModelChange)="updateField(i, 'qzStr', $event)" />
                    </label>
                  </div>
                }

                <label class="planning-panel__field">
                  <span class="planning-panel__field-label">Frame ID (optional)</span>
                  <input type="number" step="1" min="0" class="planning-panel__num-input"
                    [ngModel]="seg.frameIdStr" (ngModelChange)="updateField(i, 'frameIdStr', $event)" placeholder="0" />
                </label>

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
          [disabled]="loading() || segments().length === 0"
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

  protected readonly segments = signal<SegmentModel[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly jointNames = computed(() => {
    const r = this.store.state()?.runtime;
    return r?.robot.joints.map((j, i) => j.name || `J${i + 1}`) ?? [];
  });

  private get dof(): number {
    return this.store.state()?.runtime?.robot.dof ?? 0;
  }

  // ── Segment management ──

  protected addSegment(kind: SegmentKind): void {
    this.segments.update(arr => [...arr, createSegment(kind, this.dof)]);
  }

  protected removeSegment(event: MouseEvent, index: number): void {
    event.stopPropagation();
    this.segments.update(arr => arr.filter((_, i) => i !== index));
  }

  protected toggleSegment(index: number): void {
    this.segments.update(arr => {
      const next = [...arr];
      next[index] = { ...next[index], expanded: !next[index].expanded };
      return next;
    });
  }

  protected updateField(i: number, field: keyof SegmentModel, value: any): void {
    this.segments.update(arr => {
      const next = [...arr];
      (next[i] as any)[field] = value;
      return next;
    });
  }

  protected updateJoint(segIndex: number, jointIndex: number, value: number): void {
    this.segments.update(arr => {
      const next = [...arr];
      const joints = [...next[segIndex].joints];
      joints[jointIndex] = value;
      next[segIndex] = { ...next[segIndex], joints };
      return next;
    });
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

    for (const seg of this.segments()) {
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
    if (this.segments().length === 0) return;

    const request = this.buildPlanRequest();

    this.error.set(null);
    this.loading.set(true);

    this.api.previewPlan(request).subscribe({
      next: res => {
        this.store.applySnapshot(res);
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message ?? 'Plan compilation failed');
        this.loading.set(false);
      },
    });
  }
}
