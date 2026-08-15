# Presentación Robótica — "¿Cómo funciona Thalos como sistema robótico?"

> **Audiencia**: jurado de defensa / evaluación del proyecto de robótica. **Propósito**: demostrar la plataforma de
> ingeniería — no vender un robot. **Contraparte**: `docs/deliverables/presentations/ia-como-decide.md` — la misma plataforma leída
> desde la IA.

---

## Tesis central

> Thalos es una plataforma de ingeniería que conecta la descripción de un robot con cinemática, restricciones,
> planificación y ejecución, manteniendo explícita la frontera entre simulación, software y hardware físico.

La palabra clave es **ingeniería**. No se compite con robots industriales por capacidades físicas; se demuestra una
arquitectura.

---

## 1. El problema: no es "mover un servo"

Pasar de:

> "quiero que el robot haga Pick → Place"

a:

> "¿qué configuración del robot satisface esa tarea, respeta restricciones, tiene una trayectoria válida y puede
> ejecutarse?"

Ese salto — de intención a configuración ejecutable — justifica toda la arquitectura.

---

## 2. El modelo: URDF → SerialChain → FK / IK

Empezar con `URDF`: joints, links, límites, frames, geometría. Thalos lo convierte en una cadena serial (`SerialChain`)
y opera sobre ella:

```text
URDF → SerialChain → FK / IK
```

Sistema de coordenadas canónico **Z-up** en todo FK/IK/planning/workspace (ADR-0001); separación flange/TCP (ADR-0002);
8 modelos incluidos (Planar2R, Planar3R, SCARA, Manipulator3DOF, Manipulator6DOF, etc.) y URDF import.

**El icebot es perfecto acá — y no hay que esconderlo:**

> "El icebot no pretende representar un manipulador industrial. Es un hardware de validación para demostrar que el
> pipeline puede pasar de un modelo robótico real a una ejecución concreta."

Eso neutraliza la objeción de "robot chico": el modelo es el objeto de la plataforma, no su límite.

---

## 3. La cinemática: verificación, no fe

Evidencia ya existente:

- FK por composición secuencial de transformaciones;
- Jacobiano analítico (producto cruz `zᵢ × (pₑ − pᵢ)`);
- Jacobiano numérico (diferencias finitas centrales);
- **validación cruzada** entre ambos;
- IK: Damped Least Squares (robusto cerca de singularidades) y Jacobian
Transpose (más rápido, menos preciso).

El punto no es enseñar las ecuaciones. Es:

> "No confiamos en una implementación aislada; verificamos componentes matemáticos críticos contra una segunda
> formulación."

Eso suena técnicamente fuerte y es verificable por el jurado.

---

## 4. Restricciones y planificación: válido ≠ admisible

```text
IK → constraints → collision → planning
```

Una solución cinemáticamente válida puede seguir siendo inadmisible:

- límites articulares (`JointLimit`);
- conos de orientación (`OrientationCone`);
- cajas cartesianas (`CartesianBox`);
- colisiones SAT / OBB (esfera-esfera, esfera-caja, caja-caja);
- singularidades;
- manipulabilidad (índice de Yoshikawa);
- análisis de workspace por Monte Carlo (semilla determinista, alcanzabilidad).

Mismo principio que en la presentación de IA, leído desde la robótica:

> La planificación no solamente busca llegar al objetivo; busca llegar respetando el modelo y sus restricciones.

---

## 5. Ejecución: la frontera software / hardware

```text
MotionProgram → ExecutionPlan → Runtime → Transport → ESP32
```

Recién acá aparece el hardware. Mantener explícita la frontera:

**software validated** — cinemática, planning, colisión, análisis (tests: 238 unit + 23 integración; demo smoke 17/17).

**physically validated** — lo que el hardware realmente demostró:

- protocolo ESP32 v1: `HELLO → MANIFEST → SEGMENT → SAMPLE → END_UPLOAD → EXECUTE`;
- PCA9685 (0x40, 16 canales), canales [15, 14, 13, 12];
- **safety envelope de fuente única** (`config/safety-envelope.toml`) con
artefactos generados (`servo_safety.h`, `safety_envelope_generated.rs`);
- rechazo, no clamp: una muestra fuera del envelope se **rechaza**, nunca se
ajusta silenciosamente;
- el firmware es "la última barrera entre un comando de wire y una escritura
física al actuador";
- **sin encoders ni sensores de posición** → Thalos reporta estado *comandado*,
nunca *medido* (lenguaje honesto, no cosmético);
- calibración real (joint 0, DS3240MG): pulso real ~350–1650 µs contra el
nominal 500–2500 µs — varianza de fabricación medida, no asumida.

---

## 6. El icebot deja de ser una debilidad

Hacerlo explícito:

> "El objetivo de esta demostración no es probar que este robot tiene prestaciones industriales. Es probar que la
> plataforma puede modelar un robot real, razonar sobre su cinemática y restricciones, generar una ejecución y comunicarla
> a hardware, sin acoplar la inteligencia del sistema a un robot específico."

El icebot pasa de ser "el robot pequeño que tenemos" a **una implementación física de referencia del pipeline**.

Y la evidencia física honesta (GATE A de repeatability, N=10, medición manual con regla, `radial RMS < tolerancia de la
tarea` → GO/NO-GO) documenta qué se midió, qué no se midió y cuáles son los límites del hardware — más peso que agregar
otra capacidad al software.

---

## 7. Donde convergen ambas presentaciones

Las dos narrativas llegan al mismo sistema desde lados opuestos:

### IA
**¿Por qué elegir esta trayectoria?**

```text
Evidence → Analysis → Alternatives → Decision → Explanation
```

### Robótica
**¿Cómo llegamos físicamente a esa trayectoria?**

```text
Robot model → Kinematics → Constraints → Planning → Runtime → Hardware
```

Punto de unión:

```text
                    THALOS
                      │
             ┌────────┴────────┐
             │                 │
          ROBOTICS              AI
             │                 │
       "Can it work?"     "Why this one?"
             │                 │
       FK / IK / limits   Analysis / ranking
       planning / runtime alternatives / policy
             │                 │
             └────────┬────────┘
                      │
               Executable plan
                      │
                   Robot
```

Esa separación evita que el proyecto parezca una colección arbitraria de features: **es un sistema con dos preguntas,
una respuesta común**.

---

## 8. Mensaje final

> Thalos demuestra una arquitectura completa que conecta modelos robóticos, cinemática, restricciones, planificación y
> ejecución, manteniendo explícita la diferencia entre lo validado computacionalmente y lo validado físicamente.

Y, cerrando la pareja con la presentación de IA:

> **"El objetivo no es ocultar la complejidad del robot, sino hacerla explícita, analizable y trazable."**

---

## Anexo A — Datos verificados (citar con fuente)

| Dato | Valor | Fuente |
|------|-------|--------|
| Sistema de coordenadas | Z-up canónico (FK/IK/planning/URDF/Three.js) | `docs/summary/thalos-technical-summary.md:212-217`, ADR-0001 |
| Modelos incluidos | 8 (Planar2R…SphericalPolarRRP) | `thalos-technical-summary.md:1` |
| FK/Jacobiano | analítico + numérico con validación cruzada | `thalos-technical-summary.md:87` |
| IK | DLS (robusto) + JT (rápido) | `thalos-technical-summary.md:90-92` |
| Colisión | SAT/OBB, esfera-esfera/caja-caja | `thalos-technical-summary.md:136` |
| Workspace | Monte Carlo determinista, alcanzabilidad, Yoshikawa | `thalos-technical-summary.md:142-147` |
| Envelope | TOML fuente única + artefactos generados, rechazo-no-clamp | `config/safety-envelope.toml`, `docs/calibration.md` |
| Protocolo ESP32 | v1, HELLO/MANIFEST/SEGMENT/SAMPLE/END_UPLOAD/EXECUTE | `docs/architecture/protocol/esp32-execution.md:15-55` |
| Sin encoders | estado *comandado*, nunca *medido* | `esp32-execution.md` |
| Calibración joint 0 | pulso 350–1650 µs (nominal 500–2500), ±1.5708 rad | `firmware/esp32/tools/README.md:101-102`, `config/safety-envelope.toml` |
| Repeatability | GATE A: N=10, medición manual, `radial RMS < tolerancia` | `docs/execution/robot/repeatability-feasibility.md` |
| Tests | 238 lib + 23 integración; demo smoke 17/17 | `thalos-technical-summary.md`, `docs/demo-smoke-test.md` |

## Anexo B — Frases y trampas

- **Usar**: "plataforma de ingeniería", "hardware de validación", "frontera
software/hardware", "comandado vs medido", "rechazo, no clamp".
- **Evitar**: "robot autónomo", "controlador industrial", "precisión de X mm"
sin medirla, "simulador físico" (no lo es — no hay dinámica/fuerzas).
- Si preguntan por ROS 2: Thalos es una capa intermedia de representación y
análisis, no un framework de control en tiempo real — puede integrarse.
- Si preguntan por la precisión: mostrar el GATE A — medido o NO-GO, nunca
inventado.
- La separación software-validated / physically-validated es la columna
vertebral: no mezclar ambas.
