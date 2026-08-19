import time
import struct

# I2C config (de servo_hw_config.h)
I2C_ADDR = 0x40
CHANNEL = 14  # elbow = canal 14

# PCA9685 registers
MODE1 = 0x00
PRESCALE = 0xFE
LED0_ON_L = 0x06
STEPS_PER_US = 0.2048  # 4096 / 20000 (50Hz)

def setup_pca9685(bus):
    """Configurar PCA9685 para 50Hz."""
    # Sleep mode
    bus.write_byte_data(I2C_ADDR, MODE1, 0x10)
    time.sleep(0.005)
    # Prescale 0x79 = 121 → 50Hz
    bus.write_byte_data(I2C_ADDR, PRESCALE, 0x79)
    time.sleep(0.005)
    # Wake up: auto-increment + restart
    bus.write_byte_data(I2C_ADDR, MODE1, 0xA0)
    time.sleep(0.005)

def set_pulse_us(bus, channel, pulse_us):
    """Enviar pulso en microsegundos a un canal."""
    steps = int(pulse_us * STEPS_PER_US + 0.5)
    steps = max(0, min(4095, steps))
    reg_on = LED0_ON_L + channel * 4
    # ON=0, OFF=steps
    bus.write_i2c_block_data(I2C_ADDR, reg_on, [0, 0, steps & 0xFF, (steps >> 8) & 0xFF])

def sweep_servo(bus, channel, start_us=300, end_us=2700, step_us=25, delay=0.3):
    """Barrido lento — observar movimiento físico."""
    print(f"Sweeping channel {channel}: {start_us}µs → {end_us}µs (step {step_us}µs)")
    print("Presiona Ctrl+C para detener y guardar")
    
    positions = []
    try:
        for pulse in range(start_us, end_us + 1, step_us):
            set_pulse_us(bus, channel, pulse)
            time.sleep(delay)
            positions.append(pulse)
            print(f"  pulse={pulse}µs  steps={int(pulse * STEPS_PER_US)}")
    except KeyboardInterrupt:
        print("\nDetenido por usuario")
    
    return positions

def find_limits(bus, channel, start_us=300, end_us=2700, step_us=5):
    """Barrido fino para encontrar límites mecánicos."""
    print(f"\nBuscando límites mecánicos en canal {channel}...")
    
    # Encontrar mínimo: barrido de abajo hacia arriba
    min_limit = None
    for pulse in range(start_us, end_us, step_us):
        set_pulse_us(bus, channel, pulse)
        time.sleep(0.1)
        input(f"  pulse={pulse}µs — ¿Se mueve? (s/n/q): ")
        # En producción, esto sería con sensor o medición visual
        # Aquí es interactivo para calibración manual
    
    return min_limit, max_limit

# ── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import smbus2
    bus = smbus2.SMBus(1)  # /dev/i2c-1 en RPi
    
    setup_pca9685(bus)
    
    print("=== Calibración de servo ===")
    print("Canal 14 (elbow)")
    print()
    
    # Paso 1: Barrido amplio para observación
    print("PASO 1: Barrido amplio (observar rango)")
    sweep_servo(bus, CHANNEL, 300, 2700, 50, 0.5)
    
    # Paso 2: Barrido fino con input manual
    print("\nPASO 2: Barrido fino (marcar límites)")
    print("Cuando el servo deje de moverse, escribí 'q'")
    # find_limits(bus, CHANNEL)
    
    # Paso 3: Guardar resultados
    print("\nResultados para safety-envelope.toml:")
    print(f"  joint_min_rad = <-XX° en rad>")
    print(f"  joint_max_rad = <+XX° en rad>")
    print(f"  min_us = <pulse donde empieza a moverse>")
    print(f"  max_us = <pulse donde deja de moverse>")