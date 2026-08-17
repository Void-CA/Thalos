// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { PoseInputs, yprToQuaternion, quaternionToYpr } from './pose-inputs'
import type { PoseDef } from '@/shared/contracts'

const identity: PoseDef = { position: [0, 0, 0], orientation: [1, 0, 0, 0] }

afterEach(() => cleanup())

describe('yprToQuaternion — YPR (degrees) → unit quaternion [w,x,y,z] (design D5)', () => {
  it('converts yaw 45° → [0.924, 0, 0.383, 0] (spec R1)', () => {
    const q = yprToQuaternion(45, 0, 0)
    expect(q[0]).toBeCloseTo(0.924, 3)
    expect(q[1]).toBeCloseTo(0, 6)
    expect(q[2]).toBeCloseTo(0, 6)
    expect(q[3]).toBeCloseTo(0.383, 3)
  })

  it('converts yaw 90° → [0.707, 0, 0.707, 0] (spec R2 add scenario)', () => {
    const q = yprToQuaternion(90, 0, 0)
    expect(q[0]).toBeCloseTo(0.707, 3)
    expect(q[3]).toBeCloseTo(0.707, 3)
  })

  it('keeps the quaternion unit within ±1e-6 for any YPR input (spec R1 norm)', () => {
    const cases: Array<[number, number, number]> = [
      [45, 0, 0],
      [0, 45, 0],
      [0, 0, 45],
      [30, 45, 60],
      [-90, 15, -120],
      [0, 0, 0],
    ]
    for (const [yaw, pitch, roll] of cases) {
      const [w, x, y, z] = yprToQuaternion(yaw, pitch, roll)
      expect(Math.abs(w * w + x * x + y * y + z * z - 1)).toBeLessThanOrEqual(1e-6)
    }
  })

  it('identity: yaw 0, pitch 0, roll 0 → [1, 0, 0, 0]', () => {
    expect(yprToQuaternion(0, 0, 0)).toEqual([1, 0, 0, 0])
  })
})

describe('quaternionToYpr — quaternion [w,x,y,z] → YPR degrees (display round-trip)', () => {
  it('round-trips the identity quaternion to 0/0/0', () => {
    expect(quaternionToYpr([1, 0, 0, 0])).toEqual({ yaw: 0, pitch: 0, roll: 0 })
  })

  it('round-trips a yaw-90° quaternion to yaw 90°', () => {
    const e = quaternionToYpr(yprToQuaternion(90, 0, 0))
    expect(e.yaw).toBeCloseTo(90, 6)
    expect(e.pitch).toBeCloseTo(0, 6)
    expect(e.roll).toBeCloseTo(0, 6)
  })
})

describe('PoseInputs component (spec R1)', () => {
  it('calls onChange with the converted quaternion when Yaw is edited to 45°', () => {
    const onChange = vi.fn()
    render(<PoseInputs pose={identity} onChange={onChange} idPrefix="obj-1" />)
    fireEvent.change(screen.getByLabelText('obj-1 Yaw'), { target: { value: '45' } })
    const pose = onChange.mock.calls[0][0] as PoseDef
    expect(pose.orientation[0]).toBeCloseTo(0.924, 3)
    expect(pose.orientation[1]).toBeCloseTo(0, 6)
    expect(pose.orientation[2]).toBeCloseTo(0, 6)
    expect(pose.orientation[3]).toBeCloseTo(0.383, 3)
  })

  it('preserves the other axes when editing a single YPR axis', () => {
    const onChange = vi.fn()
    render(<PoseInputs pose={identity} onChange={onChange} idPrefix="obj-1" />)
    fireEvent.change(screen.getByLabelText('obj-1 Pitch'), { target: { value: '30' } })
    const pose = onChange.mock.calls[0][0] as PoseDef
    const [w, x, y, z] = pose.orientation
    expect(Math.abs(w * w + x * x + y * y + z * z - 1)).toBeLessThanOrEqual(1e-6)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(0.259, 3) // sin(15°) — pure pitch-30° rotation about Y
    expect(z).toBeCloseTo(0, 6)
  })

  it('calls onChange with the edited position when X changes', () => {
    const onChange = vi.fn()
    render(<PoseInputs pose={identity} onChange={onChange} idPrefix="obj-1" />)
    fireEvent.change(screen.getByLabelText('obj-1 X'), { target: { value: '1.5' } })
    expect(onChange.mock.calls[0][0]).toEqual({ position: [1.5, 0, 0], orientation: [1, 0, 0, 0] })
  })

  it('displays the stored orientation as YPR degrees', () => {
    render(
      <PoseInputs
        pose={{ position: [1.5, 0.3, 0.5], orientation: yprToQuaternion(45, 0, 0) }}
        onChange={() => {}}
        idPrefix="obj-1"
      />,
    )
    expect(screen.getByLabelText('obj-1 Yaw')).toHaveValue(45)
    expect(screen.getByLabelText('obj-1 Pitch')).toHaveValue(0)
    expect(screen.getByLabelText('obj-1 Roll')).toHaveValue(0)
  })
})

describe('PoseInputs — dense grid layout (R4, R5)', () => {
  it('R4 — no user-edited numeric input uses the cramped w-10/w-11 width classes', () => {
    render(<PoseInputs pose={identity} onChange={() => {}} idPrefix="obj-1" />)
    const inputs = screen.getAllByRole('spinbutton')
    // Prove the collection is non-empty before the negative assertion loop.
    expect(inputs.length).toBeGreaterThan(0)
    for (const input of inputs) {
      expect(input.className).not.toMatch(/w-1[01]/)
    }
  })

  it('R5 — position and orientation fields render 3-per-row grid groups within the panel', () => {
    render(<PoseInputs pose={identity} onChange={() => {}} idPrefix="obj-1" />)
    const position = screen.getByRole('group', { name: 'obj-1 position' })
    expect(position.className).toMatch(/grid/)
    expect(within(position).getAllByRole('spinbutton')).toHaveLength(3)
    const orientation = screen.getByRole('group', { name: 'obj-1 orientation' })
    expect(orientation.className).toMatch(/grid/)
    expect(within(orientation).getAllByRole('spinbutton')).toHaveLength(3)
  })
})
