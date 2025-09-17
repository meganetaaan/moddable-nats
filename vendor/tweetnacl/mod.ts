// Minimal ESM wrapper around the vendored TweetNaCl distribution.
// The upstream sources expose their API via `module.exports` or the
// global `self.nacl`. We import the UMD build and re-export the global
// so Deno/Moddable can resolve `tweetnacl` without pulling from npm.

import naclFast from "../../third_party/tweetnacl-js/nacl-fast.js";

const globalScope = globalThis as Record<string, unknown>;
if (globalScope.self === undefined) {
  globalScope.self = globalScope;
}

// Capture the CommonJS export in case it doesn't write to `self`.
// deno-lint-ignore no-explicit-any
const naclModule = (naclFast as unknown) ?? globalScope.nacl;

if (!naclModule) {
  throw new Error("Failed to initialize TweetNaCl global");
}

if (!globalScope.nacl) {
  globalScope.nacl = naclModule;
}

export default globalScope.nacl as typeof naclModule;
