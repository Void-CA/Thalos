# De la intención al movimiento: planificación, verificación y ejecución de trayectorias robóticas

> **Documento**: informe científico-técnico de divulgación para feria de ciencia y tecnología. **Propósito**: responder
> qué problema de robótica resuelve la propuesta, cómo lo resuelve y qué evidencia existe de que funciona. **Alcance**: el
> cuerpo del informe (secciones 1–8) evita detalles de implementación; los nombres internos y las cifras exactas de
> validación se concentran en el Apéndice A.

---

## 1. Introducción

### 1.1 Problema

Programar un robot para alcanzar una posición no consiste únicamente en encontrar una configuración final. El movimiento
debe respetar los límites físicos del robot, evitar configuraciones problemáticas y producir una trayectoria que pueda
ejecutarse de manera segura.

Un brazo puede, en principio, alcanzar un punto del espacio. En la práctica, el recorrido que lo lleva hasta allí puede
atravesar una región prohibida, exigir una velocidad que el actuador no puede sostener o transitar por una zona singular
donde el control del extremo se vuelve inestable. El problema real no es "mover un motor", sino transformar una
intención —"tomar el objeto y colocarlo allí"— en una secuencia de movimientos que sea a la vez correcta y ejecutable.
Entre ambas hay un salto: de la **tarea de alto nivel** a la **configuración ejecutable** que la satisface respetando el
modelo del robot.

### 1.2 Motivación

El proyecto propone una plataforma capaz de transformar una tarea de alto nivel en una trayectoria verificable y
posteriormente ejecutable sobre un robot real o simulado. La idea es que ninguna de las etapas del proceso sea una caja
negra: la descripción del robot, el razonamiento sobre su movimiento y la comunicación con el hardware físico deben
poder inspeccionarse y demostrarse por separado.

### 1.3 Objetivo

**Objetivo general.** Desarrollar y validar un proceso que conecte la descripción de un robot con la cinemática, la
planificación, la verificación y la ejecución, manteniendo explícita la diferencia entre lo demostrado
computacionalmente y lo demostrado físicamente.

**Objetivos específicos.**

- Representar un robot real mediante un modelo estructural estándar.
- Resolver la cinemática del robot y verificar su formulación.
- Generar trayectorias que respeten los límites y las restricciones del
sistema.
- Verificar cada trayectoria antes de su ejecución (límites, singularidades,
colisiones).
- Ejecutar trayectorias sobre un robot físico con una frontera de seguridad
explícita entre el comando lógico y la escritura al actuador.
- Documentar de manera honesta qué se ha validado por simulación y qué se ha
demostrado por medición física.

---

## 2. Fundamentos

### 2.1 Cinemática robótica

La cinemática describe el movimiento sin considerar las fuerzas que lo producen. La **cinemática directa** calcula la
posición y orientación del extremo del manipulador a partir de los ángulos de sus articulaciones; se resuelve
componiendo secuencialmente las transformaciones geométricas de cada eslabón a lo largo de la cadena del robot.

La **cinemática inversa** permite encontrar las configuraciones articulares necesarias para alcanzar un objetivo
cartesiano. Se utiliza un método de **mínimos cuadrados amortiguados**, particularmente útil en regiones donde el
problema puede presentar dificultades numéricas. La formulación del **Jacobiano** se verifica de manera independiente
mediante diferencias finitas, reduciendo el riesgo de errores en una parte crítica del cálculo.

El **Jacobiano** relaciona las velocidades articulares con la velocidad del extremo del manipulador. Su formulación
analítica se construye a partir de la geometría de la cadena, y su corrección se comprueba contrastándola con una
aproximación numérica por diferencias finitas: dos formulaciones independientes del mismo resultado deben coincidir.

### 2.2 Planificación de movimiento

La planificación decide *cómo* moverse entre dos configuraciones. Se distinguen dos familias de movimientos.

- **Movimiento articular**: se interpola directamente en el espacio de las
articulaciones, desde la configuración inicial hasta la final, con perfiles de velocidad que evitan saltos bruscos.
Todos los ejes parten y llegan de manera sincronizada.
- **Movimiento lineal**: el extremo del manipulador debe recorrer una línea
recta en el espacio cartesiano. Como la recta se recorre punto a punto, cada punto intermedio requiere resolver
cinemática inversa, de modo que el resultado es una secuencia de configuraciones que mantienen el extremo sobre la
trayectoria deseada.

En ambos casos el resultado es una **trayectoria**: una secuencia de configuraciones articulares con su temporización,
lista para ser verificada y ejecutada.

### 2.3 Restricciones y seguridad

Una solución cinemáticamente válida puede seguir siendo inadmisible: puede exigir que una articulación supere su
recorrido físico, orientar la herramienta de forma inconveniente o hacer pasar el brazo por un lugar que ocupa otro
objeto. Por eso el movimiento se valida mediante restricciones articulares, de orientación y de posición: una
trayectoria solo puede considerarse válida cuando satisface simultáneamente las condiciones físicas y geométricas
definidas para el robot.

La **detección de colisiones** comprueba si los volúmenes que representan los eslabones y los objetos del entorno se
intersectan, usando formas geométricas simples para representar cada cuerpo, y distingue entre colisiones del robot
consigo mismo y colisiones con el entorno. Se complementa con el análisis de **singularidades** —configuraciones donde
el control del extremo pierde grados de libertad— y con medidas de **manipulabilidad** que indican cuán bien
condicionada está la configuración para mover el extremo en cualquier dirección.

### 2.4 Ejecución de trayectorias

Una vez verificada, la trayectoria debe convertirse en movimiento físico. El paso del dominio lógico al dominio del
actuador atraviesa un controlador embebido que recibe la trayectoria, la valida nuevamente y la traduce a señales de
modulación de ancho de pulso (PWM) para los servos.

La ejecución introduce una diferencia importante respecto a la simulación: un error computacional puede convertirse en
un movimiento físico. Por ello, antes de llegar al actuador, los comandos vuelven a comprobarse contra los límites de
seguridad del robot. Un valor inválido se rechaza en lugar de corregirse silenciosamente.

Un aspecto central es la distinción entre **estado comandado y estado medido**. Cuando el robot carece de sensores de
posición (encoders), el sistema sabe qué ordenó ejecutar, pero no puede afirmar dónde está físicamente el brazo. Un
sistema honesto reporta lo primero y nunca finge lo segundo.

---

## 3. Propuesta de solución

### 3.1 Del objetivo a una trayectoria verificable

La solución parte de una tarea que describe qué se desea hacer y la transforma progresivamente en movimiento. Primero se
interpreta el objetivo, después se calcula una configuración del robot capaz de alcanzarlo, se genera una trayectoria
entre los estados inicial y final y, antes de ejecutarla, se comprueba que el movimiento sea compatible con las
restricciones físicas y geométricas del robot. El proceso puede resumirse como:

```text
Tarea → Cinemática → Planificación → Verificación → Ejecución
```

Esta separación permite que un movimiento no sea considerado válido simplemente porque "llega" al objetivo. También debe
demostrar que puede recorrer el camino hasta él sin violar las condiciones establecidas.

### 3.2 Representación del robot

El proceso parte de una descripción estructural del robot. El robot se describe mediante **URDF** (Unified Robot
Description Format), un formato ampliamente utilizado en robótica para representar la estructura del manipulador, sus
articulaciones, límites y geometría. A partir de esta descripción se obtienen los elementos necesarios para calcular la
cinemática, planificar movimientos y verificar restricciones.

### 3.3 Generación de movimiento

Sobre la representación del robot, el proceso genera el movimiento entre configuraciones mediante **interpolación**: se
divide el recorrido en pasos intermedios y se temporizan con **perfiles de velocidad** que arrancan y frenan de forma
suave, evitando cambios abruptos. El resultado es una **trayectoria** discretizada en instantes de tiempo con su
configuración articular, lista para ser evaluada.

### 3.4 Verificación de trayectorias

Antes de ejecutar cualquier trayectoria se comprueba que satisfaga todas las condiciones de admisibilidad: que ninguna
articulación supere sus **límites** físicos, que la trayectoria no atraviese configuraciones **singulares**, que no
exista **colisión** entre los eslabones ni con el entorno, y que las posiciones y orientaciones resultantes cumplan las
**restricciones cartesianas** definidas para la tarea. Una trayectoria que falla alguna de estas comprobaciones no se
ejecuta; se rechaza explícitamente y se puede replanificar.

### 3.5 Ejecución

La trayectoria verificada se ejecuta en tres niveles crecientes de cercanía al hardware:

1. **Simulación**: reproducción del movimiento sobre el modelo cinemático,
sin actuadores físicos.
2. **Controlador**: el plan se comunica a un controlador embebido que
revalida cada valor y lo convierte en señales PWM para los actuadores.
3. **Robot físico**: los actuadores mueven el brazo real.

En los niveles 2 y 3, los comandos se comprueban nuevamente contra los límites de seguridad del robot antes de llegar al
actuador: un valor inválido se rechaza en lugar de corregirse silenciosamente.

```text
[FOTO REAL DEL ROBOT ICEBOT — insertar imagen]
```

---

## 4. Metodología experimental

### 4.1 Robots y escenarios

La experimentación se realizó sobre una plataforma que permite pasar del modelo a la ejecución sobre un robot real. El
robot empleado es un manipulador de validación de cuatro grados de libertad —base, codo, muñeca y una articulación
prismática— con actuadores servo alimentados externamente. Es importante subrayar que este robot es un **hardware de
validación**, no un manipulador industrial: su propósito es demostrar que el proceso completo puede llevarse de un
modelo real a una ejecución concreta, no competir en capacidades físicas con un brazo industrial.

Se definieron tres escenarios de creciente complejidad:

- **Movimiento lineal**: el extremo debe recorrer una trayectoria recta en el
plano de trabajo.
- **Movimiento articular**: el brazo debe desplazarse entre configuraciones
articulares definidas.
- **Pick & place**: una tarea compuesta de acercamiento, toma, traslado y
colocación de un objeto.

El movimiento lineal permite comprobar que el extremo sigue la trayectoria cartesiana solicitada. El movimiento
articular permite verificar la generación y sincronización de movimientos entre articulaciones. Finalmente, el escenario
pick & place integra las etapas anteriores en una tarea compuesta y permite llevar el proceso hasta el robot físico.

### 4.2 Casos de prueba

La validación experimental cubrió trayectorias lineales y articulares, restricciones de velocidad y posición, cinemática
inversa y ejecución mediante el controlador físico. Se incluyeron, además, pruebas deliberadas de verificación:
trayectorias con valores fuera de los límites articulares, en configuraciones cercanas a singularidades y con colisiones
inducidas, para confirmar que el proceso las detecta y las rechaza.

### 4.3 Criterios de evaluación

Cada etapa del proceso se evalúa mediante una pregunta experimental concreta:

| Etapa | Pregunta experimental |
|---|---|
| Cinemática | ¿El robot puede alcanzar el objetivo calculado? |
| Planificación | ¿La trayectoria conecta los estados sin violar límites? |
| Verificación | ¿Los movimientos inválidos son detectados antes de ejecutarse? |
| Ejecución | ¿El controlador rechaza comandos inseguros? |

### 4.4 Procedimiento experimental

1. Modelar el robot a partir de su descripción estructural.
2. Definir la tarea en términos de un objetivo geométrico.
3. Resolver la cinemática y verificar su formulación por dos vías.
4. Generar la trayectoria.
5. Verificar la trayectoria contra restricciones y colisiones.
6. Reproducir la ejecución en simulación.
7. Ejecutar sobre el robot físico y registrar la secuencia de estado
comandado.
8. Comparar lo planeado con lo ejecutado y documentar tanto lo verificado
por simulación como lo demostrado físicamente.

---

## 5. Resultados

### 5.1 Cinemática

**Resultado:** la cinemática alcanzó los objetivos evaluados y la formulación del Jacobiano coincidió con la referencia
numérica.

El proceso parte de un objetivo cartesiano y encuentra una configuración articular capaz de alcanzarlo. En todos los
casos evaluados la cinemática inversa convergió a configuraciones dentro de los límites de las articulaciones, con un
error de posición residual por debajo del umbral aceptado. La cinemática directa, usada para confirmar la configuración
resultante, reconstruye el objetivo con el mismo margen de error.

El **Jacobiano analítico** fue contrastado contra una aproximación **numérica** por diferencias finitas centrales a lo
largo de todo el recorrido articular permitido: ambas formulaciones coinciden, lo que verifica de forma cruzada la
derivación geométrica de la velocidad del extremo. El sistema no confía en una implementación aislada de un componente
matemático crítico; lo comprueba contra una segunda formulación independiente.

### 5.2 Generación de trayectorias

**Resultado:** se generaron trayectorias lineales y articulares sin violar los límites establecidos.

El sistema genera trayectorias que conectan las configuraciones inicial y final respetando los límites articulares y las
condiciones de velocidad definidas. Tanto las trayectorias **lineales** (el extremo mantiene una línea recta en el
espacio cartesiano) como las **articulares** (todos los ejes interpolan de forma sincronizada) se produjeron sin violar
las restricciones de posición y velocidad establecidas para cada articulación. Los perfiles de velocidad temporizados
evitan cambios abruptos, y la densidad de puntos de la trayectoria es suficiente para que el movimiento resulte
continuo.

### 5.3 Verificación

**Resultado:** los casos inválidos fueron detectados antes de la ejecución.

La etapa de verificación cumplió su función en todos los casos inválidos diseñados: trayectorias con valores fuera de
los límites articulares fueron detectadas y rechazadas; configuraciones cercanas a singularidades fueron identificadas;
y las colisiones inducidas —tanto del robot consigo mismo como con el entorno— fueron detectadas mediante el cálculo de
intersección de los volúmenes que representan los eslabones. Ninguna trayectoria inválida llegó a la fase de ejecución.

### 5.4 Ejecución física

**Resultado:** una trayectoria validada fue transmitida y ejecutada por el robot físico, mientras que comandos fuera de
los límites de seguridad fueron rechazados.

La trayectoria verificada se transmitió al controlador físico, que la convirtió en señales PWM para los actuadores.
Durante la ejecución se confirmó el comportamiento de seguridad esperado:

- cada valor recibido fue revalidado contra los **límites de seguridad** por
articulación;
- los valores fuera de los límites fueron **rechazados**, nunca ajustados en
silencio, y rechazarlos no produjo ningún movimiento del actuador;
- ante una orden de detención, el controlador cesa las escrituras y los
actuadores conservan su última posición.

**Resultado experimental.** La calibración del actuador permitió identificar que su rango operativo real era más
reducido que el rango nominal indicado por el fabricante. Los límites utilizados por el sistema fueron ajustados a
partir de esta medición.

**Alcance de la medición.** El robot utilizado no dispone de encoders. Por tanto, la ejecución confirma que los comandos
fueron aceptados y procesados por el controlador, pero no permite medir directamente la posición física alcanzada por el
brazo.

### 5.5 Integración completa

| Escenario | Objetivo | Restricciones | Ejecución |
|---|---|---|---|
| Movimiento lineal | Alcanzado | Cumplidas | Simulada |
| Movimiento articular | Alcanzado | Cumplidas | Simulada |
| Pick & place | Alcanzado | Cumplidas | Física |

Los tres escenarios definidos recorrieron el proceso completo —modelo, cinemática, planificación, verificación y
ejecución— con el resultado de la tabla anterior. El escenario de pick & place incluyó la comunicación con el
controlador físico: la trayectoria planificada y verificada fue ejecutada sobre el robot real, y el flujo completo desde
el modelo hasta el movimiento físico se reprodujo de manera consistente.

---

## 6. Discusión

### 6.1 Qué demuestran los resultados

Los resultados muestran que una tarea de alto nivel puede transformarse progresivamente en una trayectoria y que cada
etapa puede ser comprobada antes de permitir que el movimiento llegue al robot. La cinemática fue verificada de forma
independiente, las trayectorias respetaron las restricciones definidas y los casos inválidos fueron rechazados antes de
la ejecución. La prueba más significativa es la integración completa: una tarea compuesta de pick & place pudo recorrer
el proceso desde el modelo del robot hasta la ejecución física. Esto demuestra que las etapas no funcionan únicamente
como componentes aislados, sino que pueden formar un flujo coherente de principio a fin.

### 6.2 Ventajas del enfoque

- **Modularidad**: cada etapa del proceso tiene una responsabilidad única y
puede demostrarse, reemplazarse o extenderse de forma independiente.
- **Verificación cruzada de la cinemática**: los componentes matemáticos
críticos se comprueban contra una segunda formulación, no por confianza en una implementación aislada.
- **Frontera explícita software/hardware**: queda declarado qué se ha
validado por simulación, qué se ha demostrado físicamente y qué está pendiente de medición.
- **Frontera de seguridad**: los comandos son verificados nuevamente antes de
llegar a los actuadores y los valores fuera de los límites son rechazados.
- **Honestidad sobre el estado**: la ausencia de sensores de posición se
declara y el sistema reporta estado comandado, nunca finge una medición.

### 6.3 Limitaciones

- **Sin encoders**: al no existir sensores de posición, no hay lazo de
retroalimentación; el sistema no puede confirmar dónde está físicamente el brazo.
- **Repetibilidad en proceso de medición**: la repetibilidad física del robot
se define mediante un experimento formal (repetir diez veces el comando de un mismo punto, medir cada aterrizaje con
regla y calibre, y comparar la dispersión contra la tolerancia de la tarea). Esa **medición sigue pendiente**: la
plantilla del experimento está definida pero sin rellenar, y la decisión de aprobación corresponde al operador. Hasta
que exista un número medido, no se publica uno inventado.

---

## 7. Conclusiones

La propuesta demuestra que el problema de "mover un brazo" se resuelve correctamente cuando se lo trata como un problema
de transformación de una intención en una trayectoria verificada y ejecutable. La cadena modelo → cinemática →
restricciones → planificación → verificación → ejecución está implementada y validada por etapas: la cinemática se
comprueba cruzando dos formulaciones independientes; las trayectorias respetan límites y perfiles de velocidad; las
configuraciones inválidas se detectan y rechazan antes de ejecutarse; y la ejecución sobre el robot físico atraviesa una
frontera de seguridad explícita.

El resultado más importante es la separación honesta entre lo demostrado computacionalmente y lo demostrado físicamente:
el sistema dice exactamente qué sabe —que ordenó ejecutar una trayectoria válida— y qué no afirma —la posición física de
un robot sin encoders—. Esa honestidad es un rasgo de diseño, no una limitación oculta, y convierte al robot de
validación en una implementación física de referencia del proceso completo.

---

## 8. Trabajo futuro

El siguiente paso experimental es medir formalmente la repetibilidad del robot mediante múltiples ejecuciones del mismo
objetivo y cuantificar la dispersión obtenida. Esto permitirá determinar qué precisión física puede garantizarse, algo
que actualmente no puede establecerse debido a la ausencia de sensores de posición. También se plantea incorporar
medición de estado durante la ejecución para comparar la trayectoria planificada con el movimiento realmente realizado y
estudiar las diferencias entre ambos. Finalmente, la misma metodología puede extenderse a robots con mayor número de
grados de libertad y a entornos con restricciones geométricas más complejas.

---

## Apéndice A — Detalles de implementación

Este apéndice reúne la información interna de la plataforma que sustenta los resultados del cuerpo del informe. Se
organiza como mapeo de etapas a componentes, cifras de validación, protocolo, envelope de seguridad y matriz de
validación software/física.

### A.1 Mapeo de etapas a componentes

| Etapa del proceso | Componente real |
|---|---|
| Representación del robot (URDF) | `thalos-models` — estructura canónica de robot, importación passthrough de URDF |
| Cinemática (FK, Jacobiano, IK) | `thalos-core` — cadenas seriales, cinemática directa, jacobiano analítico y numérico, IK DLS y JT |
| Colisiones | `thalos-collision` — SAT/OBB, esfera-esfera, esfera-caja, caja-caja |
| Planificación (MoveJ, MoveL) | `thalos-planning` — interpoladores trapezoidales, trayectorias, compilador de planes |
| Visualización y validación de escena | `thalos-visual` — escenas 3D serializables, validación, snapshots |
| Orquestación y estado | `thalos-runtime` — comando como punto único de entrada, máquinas de estado de plan y sesión |
| Interfaz de servicio | `thalos-api` — HTTP/axum, DTOs, mapeo sistemático de errores |
| Frontend | React 19 + TypeScript + Vite, Three.js (@react-three/fiber), viewport Z-up |

Modelos incorporados: Planar2R, Planar3R, SingleRevolute y SCARA.

### A.2 Validación por software

| Suíte | Cobertura |
|---|---|
| Biblioteca del backend | 238 pruebas de librería + 23 de integración (migración Z-up completa, FK por snapshots) |
| Firmware ESP32 | 71 pruebas (gate M1, sin cambios de aserciones) |
| Runtime | 288 pruebas (gate M1, sin cambios de aserciones) |
| Demo de extremo a extremo | 17/17 desde instalación limpia (compilar → planificar → ejecutar) |

### A.3 Protocolo de ejecución v1

Protocolo de líneas de texto sobre transporte serial/TCP, controlado por el host:

| Comando | Dirección | Respuesta | Propósito |
|---|---|---|---|
| `HELLO <ver>` | HOST→ESP | `HELLO <ver> OK` | handshake de versión |
| `MANIFEST <dof> <n> <dur_us>` | HOST→ESP | `OK` | apertura de subida |
| `SEGMENT <i> <instr> <start> <count>` | HOST→ESP | `OK` | definición de segmento (`movej`/`movel`) |
| `SAMPLE <j0..jN> <dt_us>` | HOST→ESP | `OK` \| `ERROR` | subida de waypoint (validado en parse) |
| `SAMPLE <ts_us> <j0..jN>` | ESP→HOST | — | recolección de traza |
| `END_UPLOAD` | HOST→ESP | `READY` \| `ERROR` | cierre del manifest (validación completa) |
| `EXECUTE` | HOST→ESP | `OK` \| `ERROR` | inicio de ejecución |
| `STOP` | HOST→ESP | `OK` | detención (hold-by-inaction) |
| `STATUS` | HOST→ESP | `STATUS <estado> [...]` | consulta de estado |
| `SAMPLES <count>` | HOST→ESP | `OK` + `SAMPLE ...` ×count | descarga de traza |

Máquina de estados del firmware: Idle → Handshaking → Receiving → Ready → Executing, con latching en `ERROR` hasta
recuperación vía `STOP`.

### A.4 Envelope de seguridad

La configuración de seguridad se mantiene en una fuente canónica (`config/safety-envelope.toml`) y se utiliza para
generar las representaciones necesarias para el firmware y el backend (C++ y Rust), con un gate de paridad en CI.
Valores por canal:

| Canal | Posición (rad) | Pulso (µs) | Velocidad máx. (rad/s) | Fuente |
|---|---|---|---|---|
| base (0) | [−1.5708, +1.5708] | [350, 1650] | 1.0 | URDF / Configured |
| elbow (1) | [0.0, +2.0944] | [350, 2050] | 1.0 | URDF / Configured |
| wrist (2) | [−3.1416, +3.1416] | [300, 2600] | 2.0 | Temporary |
| prismatic (3) | [0.0, +0.06] | [500, 2500] | 0.5 | URDF / Configured |

Nota: los campos "rad" del canal prismático (3) contienen metros (actuador lineal). `Temporary` = provisional, no
validado físicamente; no lleva peso de enforcement hasta medición real. El mapeo rad→pulso es un mapa lineal explícito y
documentado.

### A.5 Calibración física (joint 0, servo DS3240MG)

| Hallazgo | Medición |
|---|---|
| Rango real de pulso del DS3240MG | ~350–1725 µs (nominal 500–2500 µs) |
| Configuración final de pulso del joint 0 | 350/1650 µs (margen bajo el umbral de reinicio ~1725 µs) |
| Configuración final de límite articular del joint 0 | ±1.5708 rad |
| Recorrido de reinicio (reset sweep) | confirmado por comportamiento por encima de ~1725 µs |
| Frecuencia PWM de producción | 50 Hz (333 Hz no cambia el recorrido) |
| Desbalance por horn mal montado | corregido re-centrando el horn |

### A.6 Matriz de validación software/física

| Componente | Validado por software | Validado físicamente | Nota |
|---|---|---|---|
| Cinemática FK/IK/Jacobiano | Sí — validación cruzada analítica/numérica | No aplica | matemática |
| Colisiones SAT/OBB | Sí | No | geometría |
| Análisis de workspace | Sí | No | geometría |
| Protocolo v1 (parse, validación, estados) | Sí — 71 firmware + 288 runtime | Sí (parcial) | intercambio en hardware real |
| Envelope de seguridad (rechazo, no clamp) | Sí — contrato de software | No (wrist) | la wrist es Temporary |
| Envelope de posición base (0) | Sí | Sí — calibrado por medición | |
| Envelope de elbow (1) y prismatic (3) | Sí | Parcial — procedimiento definido, medición pendiente por canal | |
| Envelope de muñeca (2) | No (Temporary, sin peso de enforcement) | No | requiere medición real |
| Repetibilidad (GATE A) | — | Pendiente | plantilla sin rellenar |
| Posición física del robot | No — se reporta comandado, nunca medido | No hay encoders | semántica honesta |

### A.7 Referencias del repositorio

- `docs/summary/thalos-technical-summary.md` — arquitectura, cinemática,
colisiones, workspace, runtime.
- `docs/architecture/protocol/esp32-execution.md` — protocolo de ejecución, contrato de
seguridad, semántica comandado/medido.
- `docs/execution/robot/repeatability-feasibility.md` — plantilla del experimento de
repetibilidad (GATE A, medición pendiente).
- `docs/calibration.md` — flujo de calibración y modelo de autoridad del
envelope.
- `firmware/esp32/tools/README.md` — herramientas de validación de hardware,
lecciones de calibración, mapeo de canales.
- `config/safety-envelope.toml` — envelope de seguridad canónico de fuente
única.
- `docs/adr/ADR-0001-z-up-canonical-coordinates.md` — sistema de coordenadas
canónico Z-up.
