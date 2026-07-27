import { create } from 'zustand'

export type SegmentKind = 'movej' | 'movel'

export interface SegmentModel {
  kind: SegmentKind
  expanded: boolean
  joints: number[]
  txStr: string
  tyStr: string
  tzStr: string
  rotationFormat: 'euler' | 'quaternion'
  yawStr: string
  pitchStr: string
  rollStr: string
  qwStr: string
  qxStr: string
  qyStr: string
  qzStr: string
  velocityStr: string
}

const STORAGE_KEY = 'thalos-planning'

function createSegment(kind: SegmentKind, dof: number): SegmentModel {
  return {
    kind,
    expanded: true,
    joints: new Array(dof).fill(0),
    txStr: '0.3', tyStr: '0', tzStr: '0',
    rotationFormat: 'euler',
    yawStr: '0', pitchStr: '0', rollStr: '0',
    qwStr: '1', qxStr: '0', qyStr: '0', qzStr: '0',
    velocityStr: '',
  }
}

function loadSegments(): SegmentModel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as SegmentModel[]
  } catch { return [] }
}

function save(segments: SegmentModel[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(segments)) } catch { /* noop */ }
}

interface PlanningState {
  segments: SegmentModel[]

  addSegment: (kind: SegmentKind, dof: number) => void
  removeSegment: (index: number) => void
  toggleSegment: (index: number) => void
  updateField: <K extends keyof SegmentModel>(index: number, field: K, value: SegmentModel[K]) => void
  updateSegmentJoints: (segIndex: number, joints: number[]) => void
  updateSegmentPose: (i: number, pose: {
    translation: [number, number, number]
    rotationFormat: 'euler' | 'quaternion'
    yprDeg: [number, number, number]
    quaternion: [number, number, number, number]
  }) => void
  clear: () => void
}

export const usePlanningStore = create<PlanningState>((set) => ({
  segments: loadSegments(),

  addSegment: (kind, dof) => set((s) => {
    const next = [...s.segments, createSegment(kind, dof)]
    save(next)
    return { segments: next }
  }),

  removeSegment: (index) => set((s) => {
    const next = s.segments.filter((_, i) => i !== index)
    save(next)
    return { segments: next }
  }),

  toggleSegment: (index) => set((s) => {
    const next = s.segments.map((seg, i) =>
      i === index ? { ...seg, expanded: !seg.expanded } : seg,
    )
    save(next)
    return { segments: next }
  }),

  updateField: (index, field, value) => set((s) => {
    const next = s.segments.map((seg, i) =>
      i === index ? { ...seg, [field]: value } : seg,
    )
    save(next)
    return { segments: next }
  }),

  updateSegmentJoints: (segIndex, joints) => set((s) => {
    const next = s.segments.map((seg, i) =>
      i === segIndex ? { ...seg, joints } : seg,
    )
    save(next)
    return { segments: next }
  }),

  updateSegmentPose: (i, pose) => set((s) => {
    const next = s.segments.map((seg, idx) =>
      idx === i ? {
        ...seg,
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
      } : seg,
    )
    save(next)
    return { segments: next }
  }),

  clear: () => {
    save([])
    return { segments: [] }
  },
}))
