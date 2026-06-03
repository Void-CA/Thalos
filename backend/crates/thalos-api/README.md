# thalos-api

**Pregunta que responde:** ¿Cómo se comunica el mundo exterior con el sistema?

Es la capa de transporte: recibe requests HTTP, deserializa JSON en DTOs, convierte DTOs a comandos de dominio, los envía al runtime, y devuelve la respuesta serializada.

Depende de `thalos-runtime` para ejecutar comandos y de `thalos-visual` para construir la escena visual a partir del snapshot.

**No debe contener:** solvers de IK, cinemática, tipos geométricos (Vector3, Quaternion, Transform3D), lógica de validación de escenas. Su única responsabilidad es orquestar la conversión entre el mundo HTTP/JSON y los comandos de dominio.
