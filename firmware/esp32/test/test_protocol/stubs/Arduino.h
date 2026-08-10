#ifndef THALOS_TEST_STUB_ARDUINO_H
#define THALOS_TEST_STUB_ARDUINO_H

// Minimal Arduino API stub for host (native) testing of the Thalos firmware.
//
// Covers ONLY the subset of the Arduino API used by src/protocol.cpp,
// src/validator.cpp and src/executor.cpp. Everything is header-only and
// inline so it can be shared across translation units without ODR issues.
//
// Notable behaviours (kept faithful to Arduino for probing):
//   - String::toFloat() / toInt() are SILENT: garbage parses to 0, matching
//     Arduino's strtod/strtol-based implementation.
//   - Serial.readStringUntil('\n') consumes bytes up to but not including
//     the terminator.

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#define F(x) (x)

// ── Time ──────────────────────────────────────────────────────────────────
// Programmable clocks: tests set g_millis/g_micros directly for determinism.

inline unsigned long g_millis = 0;
inline unsigned long g_micros = 0;

inline unsigned long millis() { return g_millis; }
inline unsigned long micros() { return g_micros; }
inline void delay(unsigned long) {}

// ── Minimal String (subset used by the firmware) ─────────────────────────

class String {
public:
    String() {}
    String(const char* s) : s_(s ? s : "") {}
    String(const String&) = default;
    String& operator=(const String&) = default;

    String& operator=(const char* s) {
        s_ = s ? s : "";
        return *this;
    }

    String(unsigned long v) : s_(std::to_string(v)) {}
    String(unsigned int v) : s_(std::to_string(v)) {}
    String(long v) : s_(std::to_string(v)) {}
    String(int v) : s_(std::to_string(v)) {}
    String(float v, int decimals) { formatFloat(v, decimals); }
    String(double v, int decimals) { formatFloat(v, decimals); }

    const char* c_str() const { return s_.c_str(); }
    std::size_t length() const { return s_.size(); }

    void trim() {
        std::size_t a = s_.find_first_not_of(" \t\r\n");
        if (a == std::string::npos) {
            s_.clear();
            return;
        }
        std::size_t b = s_.find_last_not_of(" \t\r\n");
        s_ = s_.substr(a, b - a + 1);
    }

    bool startsWith(const char* prefix) const {
        if (!prefix) return false;
        return s_.rfind(prefix, 0) == 0;
    }

    bool equals(const char* other) const { return s_ == (other ? other : ""); }

    void toCharArray(char* buf, std::size_t len) const {
        if (!buf || len == 0) return;
        std::size_t n = s_.size();
        if (n >= len) n = len - 1;
        std::memcpy(buf, s_.data(), n);
        buf[n] = '\0';
    }

    // Faithful to Arduino: silently 0 on garbage (used by the toFloat probe).
    float toFloat() const {
        return static_cast<float>(std::strtod(s_.c_str(), nullptr));
    }
    long toInt() const { return std::strtol(s_.c_str(), nullptr, 10); }

    String& operator+=(const char* p) {
        s_ += p ? p : "";
        return *this;
    }
    String& operator+=(char c) {
        s_ += c;
        return *this;
    }
    String& operator+=(const String& other) {
        s_ += other.s_;
        return *this;
    }

    bool operator==(const String& other) const { return s_ == other.s_; }
    bool operator==(const char* other) const { return s_ == (other ? other : ""); }

    // Test convenience accessor.
    const std::string& std() const { return s_; }

private:
    void formatFloat(double value, int decimals) {
        char buf[64];
        std::snprintf(buf, sizeof(buf), "%.*f", decimals, value);
        s_ = buf;
    }

    std::string s_;
};

// ── Serial stub ───────────────────────────────────────────────────────────
// Input: tests push bytes/lines via feedLine()/feed(). readStringUntil('\n')
// consumes them. Output: print/println accumulate into out_ for assertions.

class Serial_ {
public:
    void begin(unsigned long) {}

    std::size_t available() const { return in_.size(); }

    String readStringUntil(char terminator) {
        std::size_t idx = in_.find(terminator);
        if (idx == std::string::npos) {
            String result(in_.c_str());
            in_.clear();
            return result;
        }
        String result(in_.substr(0, idx).c_str());
        in_.erase(0, idx + 1);
        return result;
    }

    void print(const String& s) { out_ += s.c_str(); }
    void print(const char* s) { out_ += s ? s : ""; }
    void print(char c) { out_ += c; }
    void print(int v) { out_ += std::to_string(v); }
    void print(unsigned long v) { out_ += std::to_string(v); }
    void print(float v) {
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%f", v);
        out_ += buf;
    }

    void println() { out_ += '\n'; }
    void println(const String& s) { out_ += s.c_str(); out_ += '\n'; }
    void println(const char* s) {
        out_ += s ? s : "";
        out_ += '\n';
    }
    void println(int v) { out_ += std::to_string(v); out_ += '\n'; }
    void println(unsigned long v) { out_ += std::to_string(v); out_ += '\n'; }

    void flush() {}

    // ── Test control ────────────────────────────────────────────────────
    void clearInput() { in_.clear(); }
    void clearOutput() { out_.clear(); }
    void feedLine(const char* line) {
        in_ += line ? line : "";
        in_ += '\n';
    }
    const std::string& output() const { return out_; }

private:
    std::string in_;
    std::string out_;
};

inline Serial_ Serial;

#endif // THALOS_TEST_STUB_ARDUINO_H
