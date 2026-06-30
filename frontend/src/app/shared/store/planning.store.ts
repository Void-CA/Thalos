import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'thalos-planning';

export type SegmentKind = 'movej' | 'movel';

export interface SegmentModel {
  kind: SegmentKind;
  expanded: boolean;
  joints: number[];
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
  velocityStr: string;
}

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

function loadSegments(): SegmentModel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SegmentModel[];
  } catch {
    return [];
  }
}

function saveSegments(segments: SegmentModel[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(segments));
  } catch {
    // localStorage unavailable
  }
}

/**
 * Persisted motion program segments.
 *
 * Survives mode switches (planning ↔ execution) and page refresh (localStorage).
 */
@Injectable({ providedIn: 'root' })
export class PlanningStore {
  private readonly segmentsSignal = signal<SegmentModel[]>(loadSegments());

  readonly segments = this.segmentsSignal.asReadonly();

  // ── Persistence ──

  private persist(): void {
    saveSegments(this.segmentsSignal());
  }

  // ── Mutations ──

  addSegment(kind: SegmentKind, dof: number): void {
    this.segmentsSignal.update(arr => {
      const next = [...arr, createSegment(kind, dof)];
      saveSegments(next);
      return next;
    });
  }

  removeSegment(index: number): void {
    this.segmentsSignal.update(arr => {
      const next = arr.filter((_, i) => i !== index);
      saveSegments(next);
      return next;
    });
  }

  toggleSegment(index: number): void {
    this.segmentsSignal.update(arr => {
      const next = [...arr];
      next[index] = { ...next[index], expanded: !next[index].expanded };
      return next;
    });
  }

  updateField<K extends keyof SegmentModel>(index: number, field: K, value: SegmentModel[K]): void {
    this.segmentsSignal.update(arr => {
      const next = [...arr];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  updateSegmentJoints(segIndex: number, joints: number[]): void {
    this.segmentsSignal.update(arr => {
      const next = [...arr];
      next[segIndex] = { ...next[segIndex], joints };
      return next;
    });
  }

  updateSegmentPose(
    i: number,
    pose: {
      translation: [number, number, number];
      rotationFormat: 'euler' | 'quaternion';
      yprDeg: [number, number, number];
      quaternion: [number, number, number, number];
    },
  ): void {
    this.segmentsSignal.update(arr => {
      const next = [...arr];
      next[i] = {
        ...next[i],
        txStr: String(pose.translation[0]),
        tyStr: String(pose.translation[1]),
        tzStr: String(pose.translation[2]),
        rotationFormat: pose.rotationFormat,
        yawStr: String(pose.yprDeg[0]),
        pitchStr: String(pose.yprDeg[1]),
        rollStr: String(pose.yprDeg[2]),
        qwStr: String(pose.quaternion[0]),
        qxStr: String(pose.quaternion[1]),
        qyStr: String(pose.quaternion[2]),
        qzStr: String(pose.quaternion[3]),
      };
      return next;
    });
  }

  /** Replace all segments (e.g. when loading from a compiled plan). */
  replaceAll(segments: SegmentModel[]): void {
    this.segmentsSignal.set(segments);
    this.persist();
  }

  /** Remove all segments. */
  clear(): void {
    this.segmentsSignal.set([]);
    this.persist();
  }
}
