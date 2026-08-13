# Thalos firmware — hardware validation tools

Scripts Python para probar el firmware en hardware real por serial.
Solo dependen de `pyserial`:

```bash
pip install pyserial
```

## Seguridad (leer antes de mover nada)

1. **Probar UN servo a la vez**: dejar conectado al PCA9685 solo el servo del
   canal que se quiere probar. El firmware escribe siempre los 4 canales,
   pero solo responde el que está enchufado.
2. **Sostener el brazo** en el primer `EXECUTE`: el primer waypoint puede
   saltar al neutro del mapeo (0 rad → ~1500 us).
3. **Alimentación externa** para los servos (nunca el pin 5V del ESP32),
   con GND común entre fuente, PCA9685 y ESP32.
4. La calibración de rango se hace SIEMPRE con el servo **desacoplado** del
   mecanismo. Nunca forzar contra el tope interno (daña el engranaje).

## Mapeo de canales (config/safety-envelope.toml — fuente unica)

| Joint | Articulación | Canal PCA9685 |
|-------|--------------|---------------|
| 0 | Base (revolute ±1.57 rad) | 15 |
| 1 | Codo/hombro (revolute ±2.09 rad) | 14 |
| 2 | Muñeca (revolute ±3.14 rad) | 13 |
| 3 | Prismático (0–0.06 rad, ¡ultra-sensible!) | 12 |

## Uso

```bash
# 1. Verificar que el ESP32 habla y que el PCA9685 responde en 0x40
python3 tools/probe.py

# 2. Mover un servo (plan denso = suave; plan grueso = saltos)
#    Rango pequeño la primera vez, sostener el brazo.
python3 tools/move_joint.py --joint 0 --range 0.2 --dt-ms 1000   # lento
python3 tools/move_joint.py --joint 0 --range 0.2 --dt-ms 100 --step 0.02  # suave

# 3. Calibrar el rango de pulso REAL de un servo (desacoplado)
#    Escribe PULSE_MIN_US / PULSE_MAX_US en config/safety-envelope.toml
python3 tools/calibrate.py --joint 0

# 3b. Servo MONTADO (no se puede desacoplar): hallar el limite SEGURO del
#     mecanismo, paso a paso, parando ante el primer stall.
#     Escribe JOINT_MIN_RAD / JOINT_MAX_RAD en config/safety-envelope.toml
python3 tools/limit_finder.py --joint 1 --step 0.02 --hold-ms 1500

# 4. Suite de tests host (sin hardware)
pio test -e native
```

## Servo montado: calibración segura del límite

Con el servo acoplado al brazo NO se mide el tope interno del servo (eso
requiere stall, que daña el engranaje). Se mide el **límite seguro del
mecanismo**, que es el que importa para operar:

1. **Fase 1 (a mano)**: servo sin señal (libre), mover la articulación a mano
   hasta sus topes mecánicos reales. Cero riesgo eléctrico.
2. **Fase 2 (limit_finder.py)**: pasos de ~0.02 rad con pausa larga, mano en
   el brazo para sentir el stall. Al primer zumbido/resistencia → parar esa
   dirección. Nunca dejar en stall más de 2 segundos.
3. El propio `limit_finder.py` escribe los límites hallados en
   `JOINT_MIN_RAD/MAX_RAD` de `config/safety-envelope.toml` — después de
   calibrar, regenerar con `python3 tools/generate_safety_config.py` y
   verificar con `python3 tools/check_safety_parity.py` para que el clamp del
   firmware proteja el brazo.

## Lecciones de calibración (base, DS3240MG — 2026-08-11/12)

Lo que aprendimos calibrando el joint 0, para no repetir el viaje:

1. **El rango de pulso REAL del servo es más chico que el nominal.** El
   DS3240MG responde solo a ~350–1725 µs (no 500–2500). Su "180°" no se
   alcanza — varianza de fabricación de servos chinos de alto torque. El
   mapeo debe usar el rango medido, o el servo satura antes.

2. **Pulsos fuera de rango → "recorrido de reinicio".** Mandar más de
   ~1725 µs hace que el servo pierda la referencia y haga un barrido
   completo de inicialización. Es la confirmación por comportamiento del
   límite. El clamp del firmware nunca debe emitir esos pulsos.

3. **El calibrate mide el mapeo, no el servo, si el clamp corta.** El
   calibrate convierte pulso→rad con el mapeo actual y el firmware clamp de
   vuelta — si `SERVO_PULSE_MIN/MAX_US` es más angosto que el rango real,
   reporta los límites del MAPEO. Medir con mapeo amplio temporal
   (300–2600 µs), después fijar el rango real con margen.

4. **La frecuencia no cambia el recorrido.** 50 Hz vs 333 Hz: resultado
   idéntico. 50 Hz es el valor de producción (los MG90S no sobreviven
   333 Hz y el PCA9685 tiene UNA frecuencia para los 16 canales).

5. **Rango asimétrico ≠ mecanismo asimétrico.** El desbalance
   (+0.40 / -1.5 rad) era el HORN mal montado, no la estructura.
   Re-centrar el horn (servo en pulso medio, brazo en su centro visual)
   restauró el recorrido balanceado.

**Config final del joint 0**: pulso 350–1650 µs (margen bajo el umbral de
reinicio), joints ±3.14 rad (mapea todo el rango útil del servo).

## Flujo de validación recomendado

1. `probe.py` → el PCA9685 debe responder `found at 0x40`.
2. `move_joint.py --joint 0 --range 0.15 --dt-ms 1000` → primer movimiento.
3. Aumentar densidad (`--dt-ms 100`) → verificar suavidad.
4. Repetir por canal 1, 2 y 3 (cada uno solo, con su rango conservador).
5. `calibrate.py` por cada servo → regenerar: `python3 tools/generate_safety_config.py`.
6. Recién después: trayectoria completa desde el backend/UI.
