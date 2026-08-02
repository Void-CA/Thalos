import { usePipelineStatus } from './use-pipeline-status'

/** Compact indicator: `Robot ✓ Scene ✓ Task ✓ Compile ✓ Plan ✓ Execute`. */
export function PipelineStatus() {
  const stages = usePipelineStatus()

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {stages.map((stage) => (
        <span
          key={stage.name}
          className="inline-flex items-center gap-1 text-[10px] font-medium"
          title={stage.message}
        >
          {stage.pass ? (
            <span className="text-green-500">✓</span>
          ) : stage.pending ? (
            <span className="text-muted-foreground">•</span>
          ) : (
            <span className="text-red-400">✗</span>
          )}
          <span
            className={
              stage.pass
                ? 'text-green-500'
                : stage.pending
                  ? 'text-muted-foreground'
                  : 'text-red-400'
            }
          >
            {stage.name}
          </span>
        </span>
      ))}
    </div>
  )
}
