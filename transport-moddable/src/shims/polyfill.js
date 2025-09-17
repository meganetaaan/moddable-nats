/*
 * Aggregated polyfills for Moddable environment
 * - Error.prototype.name setter fix
 * - queueMicrotask shim
 * - setTimeout/setInterval via Timer module
 */

// Error.prototype.name setter fix (from error-shim.js)
Object.defineProperty(Error.prototype, "name", {
  get: function () {
    return Object.getOwnPropertyDescriptor(this, "name")?.value || "Error";
  },
  set: function (value) {
    Object.defineProperty(this, "name", {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  },
  configurable: true,
});

// queueMicrotask shim (from microtask-shim.js)
if (typeof globalThis.queueMicrotask === "undefined") {
  globalThis.queueMicrotask = function (callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Argument must be a function");
    }
    Promise.resolve().then(callback);
  };
}

// Timer shims (from timer-shim.js)
import Timer from "timer";

globalThis.setTimeout = function (callback, delay) {
  return Timer.set(callback, delay || 0);
};

globalThis.setInterval = function (callback, delay) {
  return Timer.repeat(callback, delay || 0);
};

globalThis.clearTimeout = function (timerId) {
  if (timerId) Timer.clear(timerId);
};

globalThis.clearInterval = function (timerId) {
  if (timerId) Timer.clear(timerId);
};

// Text Encoder/Decoder shims
import TextEncoder from "text/encoder"

class PreloadTextEncoder {
  encode(str = "") {
    const codePoints = [];
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 0xD800 || code > 0xDFFF) {
        codePoints.push(code);
      } else if (code >= 0xD800 && code <= 0xDBFF) {
        // high surrogate
        const high = code;
        const low = str.charCodeAt(++i);
        if (low >= 0xDC00 && low <= 0xDFFF) {
          const cp = ((high - 0xD800) << 10) + (low - 0xDC00) + 0x10000;
          codePoints.push(cp);
        } else {
          // unmatched surrogate, insert replacement char
          codePoints.push(0xFFFD);
          i--; // reprocess this code unit
        }
      } else {
        // unmatched low surrogate
        codePoints.push(0xFFFD);
      }
    }
    // encode code points to UTF-8 bytes
    const bytes = [];
    for (let cp of codePoints) {
      if (cp <= 0x7F) {
        bytes.push(cp);
      } else if (cp <= 0x7FF) {
        bytes.push(0xC0 | (cp >> 6));
        bytes.push(0x80 | (cp & 0x3F));
      } else if (cp <= 0xFFFF) {
        bytes.push(0xE0 | (cp >> 12));
        bytes.push(0x80 | ((cp >> 6) & 0x3F));
        bytes.push(0x80 | (cp & 0x3F));
      } else {
        bytes.push(0xF0 | (cp >> 18));
        bytes.push(0x80 | ((cp >> 12) & 0x3F));
        bytes.push(0x80 | ((cp >> 6) & 0x3F));
        bytes.push(0x80 | (cp & 0x3F));
      }
    }
    return new Uint8Array(bytes);
  }
}
const preloadTextEncoder = new PreloadTextEncoder()
const textEncoder = new TextEncoder()
class TextEncoderPolyfill {
  constructor () {
    this.isPreload = true;
  }
  encode(str) {
    if (TextEncoderPolyfill.isPreload) {
      trace('using preload polyfill\n')
      return preloadTextEncoder.encode(str)
    }
    return textEncoder.encode(str)
  }
}
TextEncoderPolyfill.isPreload = true;
globalThis.TextEncoder = TextEncoderPolyfill

import TextDecoder from "text/decoder"
let textDecoder;
class TextDecoderPolyfill {
  decode(u8) {
    if (textDecoder == null) {
      textDecoder = new TextDecoder()
    }
    return textDecoder.decode(u8)
  }
}
globalThis.TextDecoder = TextDecoderPolyfill

// URL shims
import URL from "url"

globalThis.URL = URL
