# thalos-visual

**Pregunta que responde:** ¿Cómo se representa visualmente el robot? ¿Cómo se valida y compara la escena?

Toma los resultados de cinemática directa y construye una representación visual (`VisualScene`) con segmentos, cilindros, esferas y transformaciones. También incluye validación de escenas y generación de diffs entre estados.

Depende de `thalos-core` para los tipos espaciales (frames, poses).

**No debe contener:** estado mutable, HTTP, comandos de ejecución, solvers de IK.
