# thalos-core

**Pregunta que responde:** ¿Qué es un robot? ¿Cómo se modela matemáticamente?

Contiene las definiciones fundamentales del dominio: tipos geométricos (vectores, transformaciones rígidas, cuaterniones), cinemática directa e inversa, modelos de robot, articulaciones, y el grafo espacial de frames.

No depende de ningún otro crate del proyecto. Es la base sobre la que todo lo demás se construye.

**No debe contener:** estado mutable, HTTP, escenas visuales, lógica de ejecución.
