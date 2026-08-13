/// @file main.cpp
/// Thalos ESP32 Execution Backend — Firmware Entry Point
///
/// Glue: initialises serial, probes the PCA9685 servo driver on the I2C bus,
/// then loops forever polling the protocol and updating the executor.

#include <Arduino.h>
#include <Wire.h>
#include "protocol.h"
#include "executor.h"
#include "validator.h"
#include "pca9685_driver.h"
#include "servo_driver.h"
#include "servo_hw_config.h"

// ── Global instances ─────────────────────────────────────────────────────

Executor executor;
Validator validator;
Protocol protocol(executor, validator);

PCA9685Driver pca9685;
ServoDriver servo_driver;

// ── Arduino entry points ─────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);

    // Wait for USB serial (ESP32 classic, CP210x USB-UART bridge).
    // On boards without native USB, remove this line.
    while (!Serial) {
        delay(10);
    }

    // ── I2C bus initialization (main.cpp owns the bus) ────────────────
    // PCA9685Driver::begin() takes no parameters and never re-initializes
    // the bus — Wire is a global singleton with a single owner.
    Wire.begin(I2C_SDA, I2C_SCL);

    // ── Probe PCA9685 presence BEFORE configuring it ──────────────────
    // endTransmission() returns 0 on ACK (device present), non-zero on NACK.
    Wire.beginTransmission(PCA9685_ADDR);
    uint8_t probe_err = Wire.endTransmission();

    if (probe_err == 0) {
        Serial.println("PCA9685 found at 0x40");
        pca9685.begin();                    // configure device (MODE1, MODE2, PRESCALE)
        servo_driver.init(pca9685);
        servo_driver.set_enabled(true);     // explicit per design (init also enables)
    } else {
        // Graceful degradation: no PCA9685 → servo writes are no-ops and the
        // rest of the firmware (execution, protocol, samples) keeps working.
        Serial.println("PCA9685 NOT found — servos disabled");
        servo_driver.set_enabled(false);
    }

    // Inject the servo driver into the executor (may be disabled).
    executor.set_servo_driver(&servo_driver);
}

void loop() {
    protocol.poll();
    executor.update(micros());
}
