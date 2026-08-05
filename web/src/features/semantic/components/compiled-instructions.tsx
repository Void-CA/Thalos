import type {
  DurationDto,
  ExecutionInstruction,
  OutputValue,
} from '@/shared/contracts'

/** Seconds with 1 decimal — `{secs: 2, nanos: 0}` → `"2.0"`, `{secs: 1,
 *  nanos: 500_000_000}` → `"1.5"`. */
function formatDuration(duration: DurationDto): string {
  return (duration.secs + duration.nanos / 1_000_000_000).toFixed(1)
}

/** `[x, y, z]` position literal. */
function formatPosition(position: [number, number, number]): string {
  return `[${position.join(', ')}]`
}

/** Externally-tagged OutputValue: `{Bool: true}` → `"true"`, `{Integer: 42}`
 *  → `"42"`, `{Float: 3.14}` → `"3.14"`. */
function formatOutputValue(value: OutputValue): string {
  if ('Bool' in value) return String(value.Bool)
  if ('Integer' in value) return String(value.Integer)
  return String(value.Float)
}

/** Readable single-line form per variant: `op_2 move_l → [x,y,z]`,
 *  `delay 2.0s`, `set_output gripper=true`. */
function formatInstruction(instr: ExecutionInstruction): string {
  switch (instr.type) {
    case 'move_j':
    case 'move_l':
      return `${instr.origin} ${instr.type} → ${formatPosition(instr.target.position)}`
    case 'delay':
      return `delay ${formatDuration(instr.duration)}s`
    case 'set_output':
      return `set_output ${instr.channel.name}=${formatOutputValue(instr.value)}`
  }
}

/**
 * CompiledInstructions — readable list of the compiled motion_program
 * (compiled-instructions-view spec R2). Pure read-only view of
 * `result.motion_program.instructions`; renders each variant in a human
 * readable format preserving order, and tolerates an empty instruction list
 * (task-editor.test.tsx mocks `instructions: []` — no error is thrown).
 */
export function CompiledInstructions({
  instructions,
}: {
  instructions: ExecutionInstruction[]
}) {
  if (instructions.length === 0) {
    return <p className="text-muted-foreground">No instructions</p>
  }

  return (
    <ol className="space-y-0.5 list-none">
      {instructions.map((instr, i) => (
        <li key={i} className="font-mono text-muted-foreground">
          {formatInstruction(instr)}
        </li>
      ))}
    </ol>
  )
}
