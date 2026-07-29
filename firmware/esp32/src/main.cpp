/// @file main.cpp
/// Thalos ESP32 Execution Backend — Firmware Entry Point
///
/// Minimal glue: initialises serial, then loops forever polling the
/// protocol and updating the executor.

#include <Arduino.h>
#include "protocol.h"
#include "executor.h"
#include "validator.h"

// ── Global instances ─────────────────────────────────────────────────────

Executor executor;
Validator validator;
Protocol protocol(executor, validator);

// ── Arduino entry points ─────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);

    // Wait for USB serial (native USB on ESP32-S3).
    // On boards without native USB, remove this line.
    while (!Serial) {
        delay(10);
    }
}

void loop() {
    protocol.poll();
    executor.update(micros());
}
