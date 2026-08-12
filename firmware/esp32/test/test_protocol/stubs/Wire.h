#ifndef THALOS_TEST_STUB_WIRE_H
#define THALOS_TEST_STUB_WIRE_H

// Mock Arduino Wire API for native (host) tests of the Thalos firmware.
//
// Models the subset of the Arduino TwoWire API used by the firmware:
//   - begin(sda, scl) / begin()            (bus init — main.cpp owns the bus)
//   - beginTransmission(addr) / write() / endTransmission()
//   - requestFrom(addr, qty) / available() / read()
//
// Behavioural fidelity for probing:
//   - endTransmission() returns probe_result_ (0 = ACK, device present).
//   - Reads return bytes from a test-seeded read buffer (set_read_data()).
//
// Test inspection:
//   - Every transaction (address + written bytes) is captured in tx_log_
//     IN ORDER, so tests can assert the exact register-write sequence
//     (e.g. the PCA9685 begin() SLEEP → PRESCALE → restart order).
//   - last_tx_addr() / last_tx_data() expose the most recent transaction.

#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

struct WireTransaction {
    uint8_t addr;
    std::vector<uint8_t> data;   // bytes written between beginTransmission/endTransmission
};

class Wire_ {
public:
    // ── Bus init (no-op for tests; pins captured for assertions) ────────
    void begin() {}
    void begin(uint8_t sda, uint8_t scl) {
        begin_sda_ = sda;
        begin_scl_ = scl;
    }

    // ── Write side ──────────────────────────────────────────────────────
    void beginTransmission(uint8_t addr) {
        current_addr_ = addr;
        tx_buffer_.clear();
    }

    size_t write(uint8_t value) {
        tx_buffer_.push_back(value);
        return 1;
    }

    size_t write(const uint8_t* data, size_t n) {
        if (data != nullptr) {
            tx_buffer_.insert(tx_buffer_.end(), data, data + n);
        }
        return n;
    }

    // Returns 0 on ACK (device present), non-zero on NACK (absent).
    uint8_t endTransmission() {
        WireTransaction tx;
        tx.addr = current_addr_;
        tx.data = tx_buffer_;
        tx_log_.push_back(tx);

        last_tx_addr_ = current_addr_;
        last_tx_data_ = tx_buffer_;
        return probe_result_;
    }

    // ── Read side (register reads) ──────────────────────────────────────
    uint8_t requestFrom(uint8_t addr, uint8_t /*quantity*/) {
        read_addr_ = addr;
        return static_cast<uint8_t>(read_buffer_.size());
    }

    int available() const { return static_cast<int>(read_buffer_.size()); }

    int read() {
        if (read_buffer_.empty()) {
            return -1;
        }
        int value = read_buffer_.front();
        read_buffer_.erase(read_buffer_.begin());
        return value;
    }

    // ── Test control ────────────────────────────────────────────────────
    void set_probe_result(uint8_t result) { probe_result_ = result; }

    /// Seed bytes returned by read() after the next requestFrom().
    void set_read_data(std::vector<uint8_t> data) { read_buffer_ = std::move(data); }

    // ── Test inspection ─────────────────────────────────────────────────
    uint8_t last_tx_addr() const { return last_tx_addr_; }
    const std::vector<uint8_t>& last_tx_data() const { return last_tx_data_; }
    const std::vector<WireTransaction>& tx_log() const { return tx_log_; }
    size_t tx_count() const { return tx_log_.size(); }
    uint8_t begin_sda() const { return begin_sda_; }
    uint8_t begin_scl() const { return begin_scl_; }

    /// Clear captured transactions and the read buffer (fresh fixture).
    void clear() {
        tx_log_.clear();
        last_tx_data_.clear();
        read_buffer_.clear();
        tx_buffer_.clear();
    }

private:
    uint8_t current_addr_ = 0;
    std::vector<uint8_t> tx_buffer_;
    uint8_t last_tx_addr_ = 0;
    std::vector<uint8_t> last_tx_data_;
    std::vector<WireTransaction> tx_log_;
    std::vector<uint8_t> read_buffer_ = {0x00};   // default MODE1 read = 0x00
    uint8_t probe_result_ = 0;                     // default: ACK (device present)
    uint8_t begin_sda_ = 0;
    uint8_t begin_scl_ = 0;
    uint8_t read_addr_ = 0;
};

inline Wire_ Wire;

#endif // THALOS_TEST_STUB_WIRE_H
