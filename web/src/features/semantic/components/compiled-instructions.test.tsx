// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { CompiledInstructions } from './compiled-instructions'
import type { ExecutionInstruction } from '@/shared/contracts'

// Canonical 4-variant program (compiled-instructions-view spec R2) — same
// wire shapes the backend emits (see contracts/execution-program.test.ts).
const instructions: ExecutionInstruction[] = [
  {
    type: 'move_j',
    origin: 'op_1',
    target: { type: 'pose', position: [0, 0, 0], orientation: [0, 0, 0, 1], frame: 'world' },
    profile: { max_velocity: 500, max_acceleration: 1000, max_jerk: null },
  },
  {
    type: 'move_l',
    origin: 'op_2',
    target: { type: 'pose', position: [1, 2, 3], orientation: [0, 0, 0, 1], frame: 'world' },
    profile: { max_velocity: 250, max_acceleration: 500, max_jerk: null },
  },
  { type: 'delay', origin: 'op_3', duration: { secs: 2, nanos: 0 } },
  {
    type: 'set_output',
    origin: 'op_4',
    channel: { name: 'gripper', channel_type: 'digital' },
    value: { Bool: true },
  },
]

afterEach(() => cleanup())

describe('CompiledInstructions (compiled-instructions-view spec R2)', () => {
  it('renders every variant in a readable format, ordered as received', () => {
    render(<CompiledInstructions instructions={instructions} />)

    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      'op_1 move_j → [0, 0, 0]',
      'op_2 move_l → [1, 2, 3]',
      'delay 2.0s',
      'set_output gripper=true',
    ])
  })

  it('tolerates an empty instruction list with a "No instructions" empty state', () => {
    render(<CompiledInstructions instructions={[]} />)

    expect(screen.getByText('No instructions')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('formats fractional durations and non-bool output values', () => {
    render(
      <CompiledInstructions
        instructions={[
          { type: 'delay', origin: 'op_5', duration: { secs: 1, nanos: 500_000_000 } },
          {
            type: 'set_output',
            origin: 'op_6',
            channel: { name: 'vacuum', channel_type: 'analog' },
            value: { Integer: 42 },
          },
        ]}
      />,
    )

    expect(screen.getByText('delay 1.5s')).toBeInTheDocument()
    expect(screen.getByText('set_output vacuum=42')).toBeInTheDocument()
  })
})
