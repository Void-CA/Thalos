# thalos-runtime

**Pregunta que responde:** ¿Qué hace el robot? ¿Cómo se ejecutan comandos sobre el modelo?

Mantiene el estado mutable del robot (ángulos articulares, robot cargado) y ejecuta comandos (`SetJoints`, `LoadRobot`, `MoveToPosition`, `MoveToPose`). Es la capa que orquesta la cinemática: recibe un comando, lo resuelve contra el modelo de core, y devuelve un snapshot del resultado.

Depende de `thalos-core` para los tipos de dominio y los solvers de IK.

**No debe contener:** HTTP, representaciones visuales, lógica de validación de escenas.
