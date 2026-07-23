/**
 * Estado del proyecto — determina qué capacidades están disponibles.
 *
 * Avanza en un solo sentido (no_robot → robot_loaded → plan_compiled → plan_analyzed)
 * pero puede retroceder: si se recompila el plan, el estado vuelve a `plan_compiled`.
 *
 * `(string & {})` permite extensión futura (executing, execution_complete, etc.)
 * sin romper el contrato.
 */
export type ProjectState =
  | 'no_robot'
  | 'robot_loaded'
  | 'plan_compiled'
  | 'plan_analyzed'
  | (string & {});
