#!/usr/bin/env python3
"""Thalos firmware — hardware probe over serial.

Resets the ESP32, captures the boot log (I2C probe result), then confirms
the firmware is alive with HELLO and reports STATUS.

Usage:
    python3 tools/probe.py [--port /dev/ttyUSB0] [--baud 115200]

Safety: safe to run anytime — this script never writes servo pulses.
"""
import argparse
import serial
import time

def main():
    ap = argparse.ArgumentParser(description="Thalos ESP32 probe")
    ap.add_argument("--port", default="/dev/ttyUSB0")
    ap.add_argument("--baud", type=int, default=115200)
    args = ap.parse_args()

    ser = serial.Serial(args.port, args.baud, timeout=0.5)

    # Reset controlado: EN bajo -> reset, EN alto -> boot normal (IO0 alta).
    ser.setDTR(False)
    ser.setRTS(True)
    time.sleep(0.1)
    ser.setRTS(False)
    time.sleep(1.2)

    out = []
    end = time.time() + 5
    while time.time() < end:
        b = ser.read(128)
        if b:
            out.append(b)

    # Handshake y estado.
    ser.write(b"HELLO 1\n")
    end = time.time() + 2
    while time.time() < end:
        b = ser.read(128)
        if b:
            out.append(b)
    ser.write(b"STATUS\n")
    end = time.time() + 2
    while time.time() < end:
        b = ser.read(128)
        if b:
            out.append(b)

    ser.close()
    print("== BOOT / PROBE ==")
    data = b"".join(out).decode("utf-8", "replace")
    print(data if data.strip() else "(sin datos)")

if __name__ == "__main__":
    main()
