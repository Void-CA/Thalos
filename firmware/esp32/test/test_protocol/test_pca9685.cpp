// Thalos firmware — PCA9685Driver unit tests (host, no hardware).
//
// Exercises the real src/pca9685_driver.cpp against the Wire stub
// (test/test_protocol/stubs/Wire.h), which captures every I2C transaction
// in order. Covers the begin() SLEEP/restart sequence, prescale, MODE1/MODE2
// configuration and setPWM register writes with saturation and bounds checks.

#include <Arduino.h>
#include <Wire.h>
#include "unity.h"
#include "pca9685_driver.h"

// ── Helpers ────────────────────────────────────────────────────────────────

static uint16_t off_steps_of(const WireTransaction& tx) {
    // setPWM writes: [reg, onL, onH, offL, offH]
    return static_cast<uint16_t>(tx.data[3] | (tx.data[4] << 8));
}

// ── begin(): device configuration ─────────────────────────────────────────

void test_pca9685_begin_configures_MODE1() {
    Wire.clear();
    PCA9685Driver pca;
    pca.begin();

    // The MODE1 write must leave SLEEP cleared and set RESTART|AI (0xA0),
    // restoring normal operation after the prescale change. Transaction index
    // 3 is the final MODE1 write; begin() emits 5 config writes + 16 channel
    // clears = 21 total.
    TEST_ASSERT_EQUAL(21, (int)Wire.tx_count());
    TEST_ASSERT_EQUAL(0x00, Wire.tx_log()[3].data[0]);
    TEST_ASSERT_EQUAL(0xA0, Wire.tx_log()[3].data[1]);
}

void test_pca9685_begin_configures_MODE2() {
    Wire.clear();
    PCA9685Driver pca;
    pca.begin();

    // MODE2 = 0x04 → OUTDRV=1 (totem-pole output, recommended for servos).
    TEST_ASSERT_EQUAL(0x01, Wire.tx_log()[4].data[0]);
    TEST_ASSERT_EQUAL(0x04, Wire.tx_log()[4].data[1]);
}

void test_pca9685_begin_configures_PRESCALE() {
    Wire.clear();
    PCA9685Driver pca;
    pca.begin();

    // Prescale from servo_config.h (50 Hz → 0x79 nominal; config-derived so
    // frequency experiments never break this test).
    TEST_ASSERT_EQUAL(0xFE, Wire.tx_log()[2].data[0]);
    TEST_ASSERT_EQUAL(PCA9685_PRESCALE, Wire.tx_log()[2].data[1]);
}

void test_pca9685_begin_sequence_order() {
    Wire.clear();
    PCA9685Driver pca;
    pca.begin();

    // begin() MUST follow the SLEEP/restart sequence in this exact order:
    //   0. read MODE1 (transaction: register address only, no value)
    //   1. MODE1 |= SLEEP        (oscillator stopped)
    //   2. PRESCALE = 0x79       (only writable while in SLEEP)
    //   3. MODE1 restored        (SLEEP cleared, RESTART + AI set)
    //   4. MODE2 = 0x04
    //   5-20. clear all 16 output channels (on=0, off=0) — physical safety
    // Total: 5 config writes + 16 channel clears = 21.
    TEST_ASSERT_EQUAL(21, (int)Wire.tx_count());

    // 0: MODE1 read request — single byte (register address), no value.
    TEST_ASSERT_EQUAL(0x40, Wire.tx_log()[0].addr);
    TEST_ASSERT_EQUAL(1, (int)Wire.tx_log()[0].data.size());
    TEST_ASSERT_EQUAL(0x00, Wire.tx_log()[0].data[0]);

    // 1: enter SLEEP.
    TEST_ASSERT_EQUAL(0x00, Wire.tx_log()[1].data[0]);
    TEST_ASSERT_EQUAL(0x10, Wire.tx_log()[1].data[1]);

    // 2: prescale while sleeping (config-derived: 0x79 @50Hz nominal).
    TEST_ASSERT_EQUAL(0xFE, Wire.tx_log()[2].data[0]);
    TEST_ASSERT_EQUAL(PCA9685_PRESCALE, Wire.tx_log()[2].data[1]);

    // 3: restore MODE1 (SLEEP cleared, RESTART|AI).
    TEST_ASSERT_EQUAL(0x00, Wire.tx_log()[3].data[0]);
    TEST_ASSERT_EQUAL(0xA0, Wire.tx_log()[3].data[1]);

    // 4: MODE2.
    TEST_ASSERT_EQUAL(0x01, Wire.tx_log()[4].data[0]);
    TEST_ASSERT_EQUAL(0x04, Wire.tx_log()[4].data[1]);
}

void test_pca9685_begin_clears_all_channels() {
    Wire.clear();
    PCA9685Driver pca;
    pca.begin();

    // begin() MUST clear every output channel (LEDn on=0, off=0 → output LOW)
    // so no servo receives a stale/residual pulse when powered up.
    //
    // Physical-safety rationale: the PCA9685 retains its registers while VCC
    // is applied — even across ESP32 resets or program changes. A leftover
    // pulse on any channel (e.g. written by a previous sketch) moves that
    // servo the moment it is connected. Clearing all 16 channels at begin()
    // guarantees a known, quiet state before any EXECUTE.
    TEST_ASSERT_EQUAL(21, (int)Wire.tx_count());  // 5 config + 16 channel clears
    for (uint8_t ch = 0; ch < 16; ++ch) {
        const WireTransaction& tx = Wire.tx_log()[5 + ch];
        TEST_ASSERT_EQUAL(0x06 + ch * 4, tx.data[0]);           // LEDn_ON_L
        TEST_ASSERT_EQUAL(0, (tx.data[1] | (tx.data[2] << 8))); // on = 0
        TEST_ASSERT_EQUAL(0, (tx.data[3] | (tx.data[4] << 8))); // off = 0
    }
}

// ── setPWM: per-channel register writes ───────────────────────────────────

void test_pca9685_setPWM_channel_0() {
    Wire.clear();
    PCA9685Driver pca;
    pca.setPWM(0, 0, 100);

    TEST_ASSERT_EQUAL(1, (int)Wire.tx_count());
    const WireTransaction& tx = Wire.tx_log()[0];
    TEST_ASSERT_EQUAL(0x40, tx.addr);
    // LED0_ON_L = 0x06: [reg, onL, onH, offL, offH].
    TEST_ASSERT_EQUAL(0x06, tx.data[0]);
    TEST_ASSERT_EQUAL(0x00, tx.data[1]);
    TEST_ASSERT_EQUAL(0x00, tx.data[2]);
    TEST_ASSERT_EQUAL(100 & 0xFF, tx.data[3]);
    TEST_ASSERT_EQUAL(100 >> 8, tx.data[4]);
}

void test_pca9685_setPWM_channel_3() {
    Wire.clear();
    PCA9685Driver pca;
    pca.setPWM(3, 0, 512);

    TEST_ASSERT_EQUAL(1, (int)Wire.tx_count());
    const WireTransaction& tx = Wire.tx_log()[0];
    TEST_ASSERT_EQUAL(0x06 + 3 * 4, tx.data[0]);   // LED3_ON_L
    TEST_ASSERT_EQUAL(0, (tx.data[1] | (tx.data[2] << 8)));
    TEST_ASSERT_EQUAL(512, (tx.data[3] | (tx.data[4] << 8)));
}

void test_pca9685_setPWM_channel_15() {
    Wire.clear();
    PCA9685Driver pca;
    pca.setPWM(15, 4095, 4095);

    TEST_ASSERT_EQUAL(1, (int)Wire.tx_count());
    const WireTransaction& tx = Wire.tx_log()[0];
    TEST_ASSERT_EQUAL(0x06 + 15 * 4, tx.data[0]);  // LED15_ON_L
    TEST_ASSERT_EQUAL(4095, (tx.data[1] | (tx.data[2] << 8)));
    TEST_ASSERT_EQUAL(4095, (tx.data[3] | (tx.data[4] << 8)));
}

// ── setPWM: constraints ───────────────────────────────────────────────────

void test_pca9685_setPWM_off_greater_than_4095_constrained() {
    Wire.clear();
    PCA9685Driver pca;
    pca.setPWM(0, 5000, 5000);   // 12-bit saturation: 5000 → 4095

    TEST_ASSERT_EQUAL(1, (int)Wire.tx_count());
    const WireTransaction& tx = Wire.tx_log()[0];
    TEST_ASSERT_EQUAL(4095, (tx.data[1] | (tx.data[2] << 8)));
    TEST_ASSERT_EQUAL(4095, (tx.data[3] | (tx.data[4] << 8)));
}

void test_pca9685_setPWM_invalid_channel_no_crash() {
    Wire.clear();
    PCA9685Driver pca;
    pca.setPWM(16, 0, 512);     // out of range (0-15) → no-op
    pca.setPWM(255, 0, 512);    // out of range → no-op

    TEST_ASSERT_EQUAL(0, (int)Wire.tx_count());
}

// NOTE: no main() here — PlatformIO links all test_*.cpp files of the
// test_protocol group into ONE binary; the Unity main() lives in test_main.cpp
// and registers every test case (including these) via RUN_TEST.
