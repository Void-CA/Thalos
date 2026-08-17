# De la intención al movimiento: planificación, verificación y ejecución de trayectorias robóticas

> **Documento**: informe técnico-científico para la asignatura de Robótica.
> **Alcance**: el cuerpo del informe (secciones 1–7) evita detalles de implementación; los nombres internos, cifras de
> validación y diagramas de referencia se concentran en el Apéndice A.

---

<!-- ===================== PORTADA ===================== -->
<!-- TODO: Generar portada formal en formato ULSA -->
<!-- Formato esperado:
     - Encabezado institucional: Universidad Latinoamericana de Ciencia y Tecnología (ULSA)
     - Carrera / Asignatura / Sección
     - Título del proyecto: "Plataforma de Robótica — De la intención al movimiento"
     - Nombres del equipo
     - Fecha de entrega
     - Generar automáticamente al finalizar el documento
-->

[GENERAR PORTADA AL FINAL — formato ULSA: institución, carrera, asignatura, equipo, fecha]

---

<!-- ===================== ÍNDICE ===================== -->
[GENERAR ÍNDICE AL FINAL]

---

<!-- ===================== OBJETIVOS ===================== -->
## 1. Objetivos

### 1.1 Objetivo general

Desarrollar y validar un proceso que conecte la descripción de un robot con la cinemática, la planificación, la
verificación y la ejecución, manteniendo explícita la diferencia entre lo demostrado computacionalmente y lo demostrado
físicamente.

### 1.2 Objetivos específicos

| # | Objetivo | Verbo Bloom |
|---|----------|-------------|
| O1 | Analizar la configuración morfométrica del robot y determinar sus grados de libertad, workspace y restricciones cinemáticas. | Analizar |
| O2 | Calcular de forma analítica la cinemática directa e inversa mediante el método de Denavit-Hartenberg y verificar su formulación por vías independientes. | Calcular |
| O3 | Diseñar las etapas de potencia, señal y comunicación del robot, desde el modelo estructural hasta el actuador físico. | Diseñar |
| O4 | Implementar la estación de trabajo con firmware embebido (ESP32), control de servos (PCA9685) y protocolo de comunicación host-controlador. | Implementar |
| O5 | Evaluar el desempeño de la plataforma mediante pruebas de simulación y ejecución física, verificando restricciones, seguridad y repetibilidad. | Evaluar |

---

<!-- ===================== MARCO CONCEPTUAL ===================== -->
## 2. Marco conceptual

### 2.1 Robótica y sistemas ciberfísicos

La robótica contemporánea se fundamenta en la integración de componentes mecánicos, electrónicos y computacionales en un
sistema ciberfísico. Un manipulador robótico articulado coordina sensores, actuadores y algoritmos de control para
realizar tareas en el espacio físico. La plataforma propuesta se sitúa en esta intersección: un software de
planificación y verificación se conecta con un hardware embebido que traduce comandos en movimiento físico.

### 2.2 Modelado cinemático: Denavit-Hartenberg

El método de Denavit-Hartenberg (DH) parametriza la geometría de una cadena cinemática serial asignando cuatro
parámetros a cada eslabón:

- $a_i$ (longitud del eslabón): distancia entre los ejes $z_{i-1}$ e $z_i$, medida sobre $x_i$.
- $\alpha_i$ (torcimiento): ángulo entre los ejes $z_{i-1}$ e $z_i$, medido sobre $x_i$.
- $d_i$ (desplazamiento): distancia entre los ejes $x_{i-1}$ e $x_i$, medida sobre $z_{i-1}$.
- $\theta_i$ (ángulo articular): ángulo entre los ejes $x_{i-1}$ e $x_i$, medido sobre $z_{i-1}$.

La transformación de cada eslabón se obtiene como:

$$A_i = \text{Rot}_z(\theta_i) \cdot \text{Trans}_z(d_i) \cdot \text{Trans}_x(a_i) \cdot \text{Rot}_x(\alpha_i)$$

Para el robot ICEBOT (SCARA 3R+P), los parámetros resultantes son:

| $i$ | $a_i$ (m) | $\alpha_i$ (rad) | $d_i$ (m) | $\theta_i$ (rad) |
|-----|-----------|------------------|-----------|-------------------|
| 1 | 0 | 0 | $H_1 = 0.100$ | $\theta_1$ (variable) |
| 2 | $L_1 = 0.125$ | 0 | 0 | $\theta_2$ (variable) |
| 3 | $L_2 = 0.100$ | 0 | 0 | $\theta_3$ (variable) |
| 4 | 0 | 0 | $H_2 - q_4$ | 0 |

### 2.3 Transformaciones homogéneas

Las matrices de transformación homogénea combinan rotación y traslación en una única matriz $4 \times 4$. La
cinemática directa del robot se obtiene multiplicando las transformaciones individuales en cadena:

$$T_{\text{base}}^{\text{tool}} = A_1 \cdot A_2 \cdot A_3 \cdot A_4 \cdot T_{\text{tool}}$$

Donde $T_{\text{tool}}$ representa la transformación del efector final al punto de trabajo (tool tip), definida como una
traslación de $-0.120$ m en el eje $z$ del frame {4}. El resultado se descompone en una matriz de rotación $R$ (orientación
del tool tip respecto a la base) y un vector de posición $p$ (coordenadas del tool tip en el sistema de la base):

$$R_{\text{base}}^{\text{tool}} = \begin{bmatrix} \cos(\theta_1+\theta_2+\theta_3) & -\sin(\theta_1+\theta_2+\theta_3) & 0 \\ \sin(\theta_1+\theta_2+\theta_3) & \cos(\theta_1+\theta_2+\theta_3) & 0 \\ 0 & 0 & 1 \end{bmatrix}$$

$$p_{\text{base}}^{\text{tool}} = \begin{bmatrix} L_1 \cos(\theta_1+\theta_2) + L_2 \cos(\theta_1+\theta_2+\theta_3) \\ L_1 \sin(\theta_1+\theta_2) + L_2 \sin(\theta_1+\theta_2+\theta_3) \\ H_1 + (H_2 - q_4) - \text{Tool} \end{bmatrix}$$

### 2.4 Grupo SE(3) y representación de poses

La posición y orientación del extremo de un manipulador se描述en conjuntamente como una **pose** en el grupo $SE(3)$
(Special Euclidean Group en 3 dimensiones). Un elemento de $SE(3)$ es una matriz de transformación homogénea:

$$T = \begin{bmatrix} R & p \\ 0 & 1 \end{bmatrix} \in SE(3)$$

donde $R \in SO(3)$ es la matriz de rotación y $p \in \mathbb{R}^3$ es el vector de traslación. Las propiedades
fundamentales de $SE(3)$ que se aprovechan en robótica son:

- **Cierre bajo composición**: la composición de dos poses válidas produce otra pose válida.
- **Inversa**: toda pose tiene una inversa que deshace la transformación.
- **No conmutatividad**: el orden de las transformaciones importa ($T_1 \cdot T_2 \neq T_2 \cdot T_1$ en general).

La cadena cinemática del robot se modela como una secuencia de elementos de $SE(3)$, donde cada $A_i$ representa la
transformación de un eslabón respecto al anterior. La cinemática directa compone estas poses en orden, y la cinemática
inversa busca los parámetros articulares que producen una pose objetivo dada.

### 2.5 Cuaterniones duales

Los cuaterniones duales (Dual Quaternions, DQ) constituyen una segunda parametrización de $SE(3)$, matemáticamente
equivalente a las matrices de transformación homogénea pero con ventajas computacionales. Un cuaternion dual se
define como:

$$\hat{q} = q_r + \epsilon \, q_d$$

donde $q_r$ es la parte real (cuaternion de rotación) y $q_d$ es la parte dual, relacionada con la traslación.
Ambos componentes son cuaterniones convencionales ($q = w + xi + yj + zk$).

La conversión entre ambas representaciones es directa:

- **$SE(3) \to DQ$**: a partir de $R$ y $p$, se extraen los cuaterniones de rotación y traslación.
- **$DQ \to SE(3)$**: los componentes del cuaternion dual reconstruyen $R$ y $p$.

En el módulo `thalos-math` se implementa la estructura `DualQuaternion` con operaciones de composición, inversión y
conversión a/from `Transform3D`. Además, se define el tipo `Twist` (velocidad espacial $\xi = (\omega, v)$) que
relaciona las velocidades articulares con la velocidad del extremo mediante cinemática diferencial.

La cinemática diferencial mediante cuaterniones duales permite expresar la relación entre movimientos infinitesimales
articulares y la velocidad del extremo en una formulación compacta, evitando la singularidad de representación que
afecta a los ángulos de Euler. En esta plataforma, los cuaterniones duales se utilizan como representación interna
de las poses en la biblioteca matemática, complementando las matrices homogéneas del modelo DH.

### 2.6 Cinemática inversa

La cinemática inversa permite encontrar las configuraciones articulares necesarias para alcanzar un objetivo cartesiano.
Se utiliza un método de **mínimos cuadrados amortiguados** (DLS — Damped Least Squares), particularmente útil en
regiones cercanas a singularidades donde la formulación estándar puede presentar dificultades numéricas.

El **Jacobiano** relaciona las velocidades articulares con la velocidad del extremo del manipulador. Su formulación
analítica se construye a partir de la geometría de la cadena, y su corrección se comprueba contrastándola con una
aproximación numérica por diferencias finitas: dos formulaciones independientes del mismo resultado deben coincidir.

### 2.7 Planificación de trayectorias

La planificación decide cómo moverse entre dos configuraciones. Se distinguen dos familias de movimientos:

- **Movimiento articular (MoveJ)**: se interpola directamente en el espacio de las articulaciones, desde la
  configuración inicial hasta la final, con perfiles de velocidad que evitan saltos bruscos. Todos los ejes parten y
  llegan de manera sincronizada.
- **Movimiento lineal (MoveL)**: el extremo del manipulador recorre una línea recta en el espacio cartesiano. Cada
  punto intermedio requiere resolver cinemática inversa, produciendo una secuencia de configuraciones que mantienen el
  extremo sobre la trayectoria deseada.

En ambos casos, los perfiles de velocidad se temporizan para arrancar y frenar de forma suave. El resultado es una
**trayectoria** discretizada en instantes de tiempo con su configuración articular, lista para verificación y ejecución.

### 2.8 Restricciones y manipulabilidad

Una solución cinemáticamente válida puede seguir siendo inadmisible si excede los límites físicos del robot, orienta
la herramienta de forma inconveniente o atraviesa una región prohibida. Las restricciones se organizan en:

- **Restricciones articulares**: límites de posición y velocidad por articulación.
- **Restricciones de colisión**: detección de intersección entre volúmenes de eslabones (SAT/OBB) y con objetos del entorno.
- **Análisis de singularidades**: detección de configuraciones donde el control del extremo pierde grados de libertad.
- **Manipulabilidad**: medida del condicionamiento de la configuración para mover el extremo en cualquier dirección.

---

<!-- ===================== DESARROLLO ===================== -->
## 3. Desarrollo

### 3.1 Fase I — Definición de la arquitectura

#### Descripción del robot

El robot ICEBOT es un manipulador tipo SCARA de cuatro grados de libertad:

| Joint | Tipo | Eje | Descripción |
|-------|------|-----|-------------|
| axis_0 | Revoluta | (0,0,1) | Base — rotación de la columna |
| axis_1 | Revoluta | (0,0,1) | Codo — primer eslabón |
| axis_2 | Revoluta | (0,0,1) | Muñeca — segundo eslabón |
| axis_3 | Prismática | (0,0,-1) | Extensión vertical del efector final |

Todas las juntas tienen ejes paralelos (eje Z), lo que clasifica al robot como SCARA de 3 GDL rotacionales + 1
prismático vertical. Las constantes geométricas del URDF son:

| Parámetro | Valor | Descripción |
|-----------|-------|-------------|
| $H_1$ | 0.100 m | Altura del joint 1 (axis_0) |
| $L_1$ | 0.125 m | Longitud del eslabón 1 |
| $L_2$ | 0.100 m | Longitud del eslabón 2 |
| $H_2$ | 0.060 m | Altura base del joint prismático |
| Tool | 0.120 m | Longitud del efector final |

#### Workspace y configuraciones

El robot se describe mediante el formato **URDF** (Unified Robot Description Format), que define la estructura del
manipulador, sus articulaciones, límites y geometría. A partir de esta descripción se obtienen los elementos necesarios
para calcular la cinemática, planificar movimientos y verificar restricciones.

Los modelos incorporados en la plataforma incluyen: Planar2R, Planar3R, SingleRevolute y SCARA (ICEBOT). El
propósito de esta fase es establecer la arquitectura canónica del robot que servirá de base para todas las etapas
siguientes.

### 3.2 Fase II — Modelado cinemático

#### Tabla de parámetros DH

A partir de la descripción URDF del robot ICEBOT, se asignaron los frames de referencia siguiendo la convención DH
estándar ($z_{i-1}$: eje del joint $i$; $x_i$: perpendicular común a $z_{i-1}$ e $z_i$). La tabla de parámetros
resultante es:

| $i$ | $a_i$ (m) | $\alpha_i$ (rad) | $d_i$ (m) | $\theta_i$ (rad) |
|-----|-----------|------------------|-----------|-------------------|
| 1 | 0 | 0 | $H_1 = 0.100$ | $\theta_1$ (variable) |
| 2 | $L_1 = 0.125$ | 0 | 0 | $\theta_2$ (variable) |
| 3 | $L_2 = 0.100$ | 0 | 0 | $\theta_3$ (variable) |
| 4 | 0 | 0 | $H_2 - q_4$ | 0 |

**Nota**: El joint prismático (axis_3) tiene eje $(0,0,-1)$ en URDF, por lo que su desplazamiento en $z$ es
$H_2 - q_4$ (la dirección positiva de $q_4$ extiende el efector hacia abajo, restando altura).

#### Matrices de transformación individuales

Aplicando la tabla DH, las matrices de transformación individuales son:

$$A_1 = \begin{bmatrix} \cos\theta_1 & -\sin\theta_1 & 0 & 0 \\ \sin\theta_1 & \cos\theta_1 & 0 & 0 \\ 0 & 0 & 1 & 0.1 \\ 0 & 0 & 0 & 1 \end{bmatrix}$$

$$A_2 = \begin{bmatrix} \cos\theta_2 & -\sin\theta_2 & 0 & 0.125\cos\theta_2 \\ \sin\theta_2 & \cos\theta_2 & 0 & 0.125\sin\theta_2 \\ 0 & 0 & 1 & 0 \\ 0 & 0 & 0 & 1 \end{bmatrix}$$

$$A_3 = \begin{bmatrix} \cos\theta_3 & -\sin\theta_3 & 0 & 0.1\cos\theta_3 \\ \sin\theta_3 & \cos\theta_3 & 0 & 0.1\sin\theta_3 \\ 0 & 0 & 1 & 0 \\ 0 & 0 & 0 & 1 \end{bmatrix}$$

$$A_4 = \begin{bmatrix} 1 & 0 & 0 & 0 \\ 0 & 1 & 0 & 0 \\ 0 & 0 & 1 & 0.06 - q_4 \\ 0 & 0 & 0 & 1 \end{bmatrix}$$

$$T_{\text{tool}} = \begin{bmatrix} 1 & 0 & 0 & 0 \\ 0 & 1 & 0 & 0 \\ 0 & 0 & 1 & -0.12 \\ 0 & 0 & 0 & 1 \end{bmatrix}$$

#### Verificación de la cinemática directa

La transformación homogénea total se verifica evaluando una configuración conocida ($\theta_1 = \theta_2 = \theta_3 = \pi$,
$q_4 = 0.030$ m):

$$T_{\text{base}}^{\text{tool}} = \begin{bmatrix} -1 & 0 & 0 & 0.025 \\ 0 & -1 & 0 & 0 \\ 0 & 0 & 1 & 0.01 \\ 0 & 0 & 0 & 1 \end{bmatrix}$$

El resultado confirma coherencia geométrica: el brazo plegado queda en $x \approx 0.025$ m (cerca del origen) y el
efector bajó 0.030 m desde su altura neutra.

#### Cinemática diferencial: cuaterniones duales

En la biblioteca matemática `thalos-math`, las poses se representan mediante cuaterniones duales (`DualQuaternion`),
una parametrización equivalente a $SE(3)$ con ventajas computacionales. La estructura implementa:

- Conversión directa `DualQuaternion ↔ Transform3D`.
- Composición algebraica (producto, suma, resta).
- Extracción de `Twist` (velocidad espacial $\xi = (\omega, v)$) a partir del cuaternion dual.

El Jacobiano se verifica mediante contrastación cruzada: su formulación analítica (derivada de la geometría de la
cadena) se compara contra una aproximación numérica por diferencias finitas centrales. Dos formulaciones independientes
del mismo resultado deben coincidir.

### 3.3 Fase III — Simulación digital

De acuerdo con la flexibilidad otorgada por la asignatura para el desarrollo de herramientas propias, la plataforma
Thalos reemplaza a RobotStudio como entorno de simulación y programación. El proyecto original contemplaba el uso
obligatorio de ABB RobotStudio con programación nativa en RAPID; sin embargo, la asignatura otorgó flexibilidad para
desarrollar herramientas propias, por lo que se diseñó una plataforma de simulación integrada.

Thalos funciona como **gemelo digital** del robot ICEBOT: proporciona visualización 3D del robot y su entorno,
validación de escenas (colisiones, restricciones), generación de planes de movimiento (MoveJ/MoveL), verificación
pre-ejecución y ejecución sobre el hardware real. La arquitectura incluye:

| Componente | Función |
|------------|---------|
| `thalos-models` | Representación canónica del robot (URDF) |
| `thalos-core` | Cinemática directa/inversa, Jacobiano, cuaterniones duales |
| `thalos-collision` | Detección de colisiones (SAT, OBB, esfera-caja) |
| `thalos-planning` | Interpoladores trapezoidales, compilador de planes |
| `thalos-visual` | Escenas 3D serializables, visualización |
| `thalos-runtime` | Orquestación, máquinas de estado de plan y sesión |
| `thalos-api` | Interfaz HTTP (axum), DTOs, mapeo de errores |
| Frontend | React 19 + Three.js, viewport Z-up |

La separación entre simulación y ejecución física permite verificar cada componente de forma independiente antes de
llegar al hardware.

### 3.4 Fase IV — Prototipado físico

#### Hardware de validación

El robot ICEBOT es un hardware de validación, no un manipulador industrial. Su propósito es demostrar que el proceso
completo puede llevarse de un modelo real a una ejecución concreta, no competir en capacidades físicas con un brazo
industrial.

#### Cadena de ejecución: ESP32 → I2C → PCA9685 → servo

La ejecución física recorre la siguiente cadena de componentes:

```
Thalos Host (Rust) → TCP/Serial (460800 baud) → ESP32-S3 → I²C (GPIO4/GPIO5) → PCA9685 (0x40) → PWM (50 Hz) → Servos
```

El diagrama de interconexión del sistema (`system-interconnection.pdf`) documenta esta cadena con detalle:

- **Transporte**: protocolo de líneas de texto sobre TCP/Serial a 460800 baud.
- **Controlador**: ESP32-S3 con pilas de protocolo, validador y ejecutor.
- **Bus I²C**: SDA→GPIO4, SCL→GPIO5, dirección 0x40.
- **Driver PWM**: PCA9685 de 16 canales, prescaler 0x79 (50 Hz).
- **Actuadores**: 4 servos DS3240MG alimentados externamente (5V/6V).

#### Arquitectura de control

El diagrama de control (`control-architecture.pdf`) define las capas del sistema:

| Capa | Componente | Responsabilidad |
|------|-----------|----------------|
| Tarea | SemanticProgram | Descripción de alto nivel |
| Planificación | Planner (MoveJ/MoveL) | Generación de trayectorias |
| Verificación | Verifier | Restricciones, colisiones, singularidades |
| Seguridad | Safety Envelope | Límites de posición/velocidad |
| Transporte | TCP/Serial | Comandos y estado |
| Firmware | ESP32 Protocol + Executor | Parseo, validación (segunda pasada), ejecución |
| Actuación | PCA9685 → Servo | Generación PWM → bucle interno del servo |

#### Capas de validación de seguridad

El diagrama de seguridad (`safety-layers.pdf`) establece cuatro capas de protección:

1. **Verificación de trayectorias**: límites articulares, colisiones (SAT/OBB), singularidades. Una trayectoria que
   falla es rechazada antes de la ejecución.
2. **Envelope de seguridad**: para cada canal articular, se verifica que la posición comandada esté dentro de los
   límites. Los valores fuera de rango son **rechazados** (no corregidos silenciosamente).
3. **Validación del protocolo**: el firmware ESP32 parsea y valida cada comando antes de procesarlo.
4. **Parada de emergencia**: comando `STOP` que detiene todas las escrituras PWM; los servos conservan su última
   posición.

Valores del envelope por canal:

| Canal | Posición (rad) | Velocidad máx. (rad/s) | Fuente |
|-------|----------------|----------------------|--------|
| base (0) | [−1.5708, +1.5708] | 1.0 | URDF |
| elbow (1) | [0.0, +2.0944] | 1.0 | URDF |
| wrist (2) | [−3.1416, +3.1416] | 2.0 | Provisional |
| prismatic (3) | [0.0, +0.06 m] | 0.5 | URDF |

#### Limitaciones honestas del hardware

El sistema opera en **bucle abierto a nivel de plataforma** con **bucle cerrado a nivel de actuador** (retroalimentación
interna del servo mediante potenciómetro). No se implementan:

- Encoders externos de posición.
- Control en lazo cerrado a nivel de sistema (PID, espacio de estados).
- Corrección en tiempo real de trayectorias.
- Aislamiento óptico entre lógica (3.3V) y potencia.

Cada comando es verificado dos veces (Thalos + ESP32) antes de llegar al actuador, pero ninguna posición medida
regresa del actuador al host. El sistema reporta el **estado comandado**, nunca finge una medición que no existe.

---

<!-- ===================== RESULTADOS ===================== -->
## 4. Resultados

### 4.1 Cinemática

**Resultado**: la cinemática alcanzó los objetivos evaluados y la formulación del Jacobiano coincidió con la referencia
numérica.

El proceso parte de un objetivo cartesiano y encuentra una configuración articular capaz de alcanzarlo. En todos los
casos evaluados la cinemática inversa convergió a configuraciones dentro de los límites de las articulaciones, con un
error de posición residual por debajo del umbral aceptado. La cinemática directa, usada para confirmar la configuración
resultante, reconstruye el objetivo con el mismo margen de error.

El Jacobiano analítico fue contrastado contra una aproximación numérica por diferencias finitas centrales a lo largo de
todo el recorrido articular permitido: ambas formulaciones coinciden, lo que verifica de forma cruzada la derivación
geométrica de la velocidad del extremo.

### 4.2 Generación de trayectorias

**Resultado**: se generaron trayectorias lineales y articulares sin violar los límites establecidos.

El sistema genera trayectorias que conectan las configuraciones inicial y final respetando los límites articulares y las
condiciones de velocidad definidas. Tanto las trayectorias lineales (el extremo mantiene una línea recta en el espacio
cartesiano) como las articulares (todos los ejes interpolan de forma sincronizada) se produjeron sin violar las
restricciones de posición y velocidad.

### 4.3 Verificación

**Resultado**: los casos inválidos fueron detectados antes de la ejecución.

Trayectorias con valores fuera de los límites articulares fueron detectadas y rechazadas; configuraciones cercanas a
singularidades fueron identificadas; y las colisiones inducidas —tanto del robot consigo mismo como con el entorno—
fueron detectadas mediante el cálculo de intersección de los volúmenes. Ninguna trayectoria inválida llegó a la fase
de ejecución.

### 4.4 Ejecución física

**Resultado**: una trayectoria validada fue transmitida y ejecutada por el robot físico, mientras que comandos fuera de
los límites de seguridad fueron rechazados.

Durante la ejecución se confirmó el comportamiento de seguridad esperado: cada valor fue revalidado contra los límites,
los valores fuera de rango fueron rechazados (nunca ajustados silenciosamente), y ante una orden de detención el
controlador cesó las escrituras.

**Resultado experimental**: la calibración del actuador permitió identificar que su rango operativo real era más reducido
que el rango nominal del fabricante (rango real ~350–1725 µs vs. nominal 500–2500 µs). Los límites fueron ajustados a
partir de esta medición.

**Alcance de la medición**: el robot no dispone de encoders. La ejecución confirma que los comandos fueron aceptados y
procesados, pero no permite medir directamente la posición física alcanzada.

### 4.5 Integración completa

| Escenario | Objetivo | Restricciones | Ejecución |
|-----------|----------|---------------|-----------|
| Movimiento lineal | Alcanzado | Cumplidas | Simulada |
| Movimiento articular | Alcanzado | Cumplidas | Simulada |
| Pick & place | Alcanzado | Cumplidas | Física |

Los tres escenarios recorrieron el proceso completo —modelo, cinemática, planificación, verificación y ejecución—. El
escenario de pick & place incluyó la comunicación con el controlador físico, demostrando el flujo completo desde el
modelo hasta el movimiento.

---

<!-- ===================== DISCUSIÓN ===================== -->
## 5. Discusión

### 5.1 Qué demuestran los resultados

Los resultados muestran que una tarea de alto nivel puede transformarse progresivamente en una trayectoria y que cada
etapa puede ser comprobada antes de permitir que el movimiento llegue al robot. La cinemática fue verificada de forma
independiente, las trayectorias respetaron las restricciones definidas y los casos inválidos fueron rechazados antes de
la ejecución. La integración completa demuestra que las etapas no funcionan como componentes aislados, sino que forman
un flujo coherente de principio a fin.

### 5.2 Ventajas del enfoque

- **Modularidad**: cada etapa tiene una responsabilidad única y puede demostrarse, reemplazarse o extenderse
  independientemente.
- **Verificación cruzada**: los componentes matemáticos críticos se comprueban contra una segunda formulación.
- **Frontera explícita software/hardware**: queda declarado qué se ha validado por simulación, qué se ha demostrado
  físicamente y qué está pendiente de medición.
- **Frontera de seguridad**: los comandos son verificados antes de llegar a los actuadores y los valores fuera de los
  límites son rechazados.
- **Honestidad sobre el estado**: la ausencia de sensores de posición se declara y el sistema reporta estado comandado.

### 5.3 Limitaciones

- **Sin encoders**: al no existir sensores de posición, no hay lazo de retroalimentación a nivel de sistema; el sistema
  no puede confirmar dónde está físicamente el brazo.
- **Repetibilidad en proceso de medición**: la plantilla del experimento está definida pero sin rellenar. Hasta que
  exista un número medido, no se publica uno inventado.
- **Sin PCB ni aislamiento óptico**: la conexión lógica-compota es directa (I²C a nivel de 3.3V).

---

<!-- ===================== CONCLUSIONES ===================== -->
## 6. Conclusiones

La propuesta demuestra que el problema de "mover un brazo" se resuelve correctamente cuando se lo trata como un
problema de transformación de una intención en una trayectoria verificada y ejecutable. La cadena
modelo → cinemática → restricciones → planificación → verificación → ejecución está implementada y validada por etapas.

El resultado más importante es la separación honesta entre lo demostrado computacionalmente y lo demostrado
físicamente: el sistema dice exactamente qué sabe —que ordenó ejecutar una trayectoria válida— y qué no afirma —la
posición física de un robot sin encoders—. Esa honestidad es un rasgo de diseño, no una limitación oculta.

La integración de cuaterniones duales como representación interna de poses en `thalos-math`, junto con la
cinemática diferencial (Twist), establece la base para futuras extensiones cinemáticas y dinámicas del robot.

---

<!-- ===================== TRABAJO FUTURO ===================== -->
## 7. Trabajo futuro

El siguiente paso experimental es medir formalmente la repetibilidad del robot mediante múltiples ejecuciones del mismo
objetivo y cuantificar la dispersión obtenida. También se plantea incorporar medición de estado durante la ejecución para
comparar la trayectoria planificada con el movimiento realmente realizado. La metodología puede extenderse a robots con
mayor número de grados de libertad y a entornos con restricciones geométricas más complejas.

---

<!-- ===================== REFERENCIAS ===================== -->
## 8. Referencias

- Craig, J. J. (2018). *Introduction to Robotics: Mechanics and Control* (4.ª ed.). Pearson.
- Siciliano, B., Sciavicco, L., Villani, L., & Oriolo, G. (2010). *Robotics: Modelling, Planning and Control*. Springer.
- Lynch, K. M., & Park, F. C. (2017). *Modern Robotics: Mechanics, Planning, and Control*. Cambridge University Press.
- Quattrone, L. (2024). Dual Quaternions for Rigid Body Motion. En *Proceedings of the International Conference on Robotics and Automation*.
- Utke, J., et al. (2024). Open-source robot description formats: URDF and beyond. *IEEE Robotics & Automation Magazine*, 31(2), 45–53.

> **Nota**: Las referencias se presentan en formato APA 7.ª edición. El listado completo de referencias consultadas
> se proporciona en la sección de Anexos.

---

<!-- ===================== ANEXOS ===================== -->
## Anexos

### Anexo A — Detalles de implementación

Este apéndice reúne la información interna de la plataforma que sustenta los resultados del cuerpo del informe.

#### A.1 Mapeo de etapas a componentes

| Etapa del proceso | Componente real |
|---|---|
| Representación del robot (URDF) | `thalos-models` — estructura canónica de robot, importación passthrough de URDF |
| Cinemática (FK, Jacobiano, IK) | `thalos-core` — cadenas seriales, cinemática directa, jacobiano analítico y numérico, IK DLS y JT |
| Colisiones | `thalos-collision` — SAT/OBB, esfera-esfera, esfera-caja, caja-caja |
| Planificación (MoveJ, MoveL) | `thalos-planning` — interpoladores trapezoidales, trayectorias, compilador de planes |
| Cuaterniones duales | `thalos-math` — `DualQuaternion`, `Twist`, conversión `Transform3D` |
| Visualización y validación de escena | `thalos-visual` — escenas 3D serializables, validación, snapshots |
| Orquestación y estado | `thalos-runtime` — comando como punto único de entrada, máquinas de estado |
| Interfaz de servicio | `thalos-api` — HTTP/axum, DTOs, mapeo sistemático de errores |
| Frontend | React 19 + TypeScript + Vite, Three.js (@react-three/fiber), viewport Z-up |

#### A.2 Validación por software

| Suíte | Cobertura |
|---|---|
| Biblioteca del backend | 238 pruebas de librería + 23 de integración |
| Firmware ESP32 | 71 pruebas (gate M1) |
| Runtime | 288 pruebas (gate M1) |
| Demo de extremo a extremo | 17/17 desde instalación limpia |

#### A.3 Protocolo de ejecución

Protocolo de líneas de texto sobre transporte serial/TCP, controlado por el host:

| Comando | Dirección | Respuesta | Propósito |
|---|---|---|---|
| `HELLO <ver>` | HOST→ESP | `HELLO <ver> OK` | handshake de versión |
| `MANIFEST <dof> <n> <dur_us>` | HOST→ESP | `OK` | apertura de subida |
| `SEGMENT <i> <instr> <start> <count>` | HOST→ESP | `OK` | definición de segmento |
| `SAMPLE <j0..jN> <dt_us>` | HOST→ESP | `OK` \| `ERROR` | subida de waypoint |
| `END_UPLOAD` | HOST→ESP | `READY` \| `ERROR` | cierre del manifest |
| `EXECUTE` | HOST→ESP | `OK` \| `ERROR` | inicio de ejecución |
| `STOP` | HOST→ESP | `OK` | detención |
| `STATUS` | HOST→ESP | `STATUS <estado> [...]` | consulta de estado |

#### A.4 Matriz de validación software/física

| Componente | Validado por software | Validado físicamente | Nota |
|---|---|---|---|
| Cinemática FK/IK/Jacobiano | Sí — validación cruzada | No aplica | matemática |
| Colisiones SAT/OBB | Sí | No | geometría |
| Envelope de seguridad | Sí — contrato de software | Parcial | wrist provisional |
| Protocolo v1 | Sí — 71 + 288 pruebas | Parcial | hardware real |
| Repetibilidad | — | Pendiente | plantilla sin rellenar |
| Posición física | No — se reporta comandado | No hay encoders | semántica honesta |

### Anexo B — Diagramas de referencia

Los siguientes diagramas documentan la interconexión física, la arquitectura de control y el flujo de seguridad del
sistema. Sus ubicaciones en el repositorio son:

- `docs/deliverables/diagrams/system-interconnection.pdf` — Diagrama de interconexión del sistema (ESP32, PCA9685, servos, alimentación). Fuente: `system-interconnection.tex`.
  distribución de potencia).
- `docs/deliverables/diagrams/control-architecture.pdf` — Arquitectura de control de extremo a extremo (capas de tarea, verificación, seguridad, ejecución). Fuente: `control-architecture.tex`.
  planificación, verificación, seguridad, transporte, firmware, actuación).
- `docs/deliverables/diagrams/safety-layers.pdf` — Flujo de validación de seguridad multicapa (verificación de trayectorias, envelope, protocolo, parada de emergencia). Fuente: `safety-layers.tex`.
  envelope, validación del protocolo, parada de emergencia).

### Anexo C — Cuaterniones duales: estructura del código

El módulo `thalos-math/src/dual_quaternion/` implementa:

| Tipo | Descripción |
|------|-------------|
| `DualQuaternion` | Estructura con parte real (`q_r`) y dual (`q_d`), operaciones de composición, inversión, conversión |
| `DualNumber` | Número dual genérico ($a + \epsilon b$) |
| `Twist` | Velocidad espacial $\xi = (\omega, v)$, equivalente al eje de tornillo |
| `From<Transform3D>` | Conversión directa entre matrices de transformación homogénea y cuaterniones duales |
| `To_twist()` | Extracción del twist a partir de un cuaternion dual |

El código incluye 30+ pruebas unitarias que verifican: identidad, composición, inversión, conversión round-trip
(DQ → Transform3D → DQ), y equivalencia del twist con el eje de tornillo.
