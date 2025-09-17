// deno-lint-ignore-file no-explicit-any
/**
 * Simple Deno bundler for Moddable.
 *
 * - Bundles nats.js core (and internal) + local nuid/nkeys sources into one ESM file
 * - Uses an import map to resolve `@nats-io/nuid` and `@nats-io/nkeys` to submodule sources
 * - Produces: dist/nats-core.moddable.js (default)
 *
 * Usage:
 *   deno run -A bin/bundle-moddable.ts \
 *     --out dist/nats-core.moddable.js \
 *     --entry nats.js/core/src/mod.ts \
 *     --import-map bin/import_map.moddable.json
 *
 * Notes:
 * - Uses `deno bundle` under the hood for Deno v2 compatibility.
 * - Sets DENO_DIR to `.deno_cache` in the project to avoid writes outside workspace.
 */

type ImportMap = { imports?: Record<string, string>; scopes?: Record<string, Record<string, string>> };

function parseArgs(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

async function ensureDir(path: string) {
  const dir = path.replace(/[^/\\]+$/, "");
  if (!dir) return;
  await Deno.mkdir(dir, { recursive: true }).catch(() => {});
}

function stripNodeCompat(code: string): string {
  const requirePattern = /import \{ createRequire \} from "node:module";\s*var __require = createRequire\(import\.meta\.url\);/;
  if (requirePattern.test(code)) {
    code = code.replace(
      requirePattern,
      'var __require = () => { throw new Error("CommonJS require is not supported in this bundle."); };',
    );
    code = code.replace(/typeof __require !== "undefined"/g, "false");
  }
  return code;
}

async function loadImportMap(importMapPath?: string): Promise<{ url?: string; exists: boolean }> {
  if (!importMapPath) return { exists: false };
  const base = new URL("file://" + Deno.cwd() + "/");
  const url = new URL(importMapPath, base).href;
  try {
    await Deno.stat(new URL(url));
    return { url, exists: true };
  } catch {
    return { url, exists: false };
  }
}

// Create a virtual entry that re-exports the selected entry.
function makeVirtualEntry(realEntry: string): string {
  // Keeping it minimal: simply re-export all from the real entry.
  return `export * from "${realEntry}";\n`;
}

async function bundle() {
  const args = parseArgs(Deno.args);
  const out = args.out ?? "dist/nats-core.moddable.js";
  const entry = args.entry ?? "third_party/nats.js/core/src/mod.ts";
  const importMapPath = args["import-map"] ?? "bin/import_map.moddable.json";

  const { url, exists } = await loadImportMap(importMapPath);

  // To keep compatibility with Deno v2, shell out to `deno bundle`.
  const realEntry = new URL(entry, new URL("file://" + Deno.cwd() + "/")).pathname;
  const outPath = new URL(out, new URL("file://" + Deno.cwd() + "/")).pathname;
  await ensureDir(outPath);

  const cmdArgs = [
    "bundle",
    "--no-check",
    ...(exists && url ? ["--import-map", new URL(url).pathname] : []),
    "--output",
    outPath,
    realEntry,
  ];

  const cmd = new Deno.Command("deno", {
    args: cmdArgs,
    env: {
      // keep deno cache local to this repo to avoid permission issues
      DENO_DIR: ".deno_cache",
    },
    stdout: "piped",
    stderr: "piped",
  });
  const res = await cmd.output();
  const stdout = new TextDecoder().decode(res.stdout).trim();
  const stderr = new TextDecoder().decode(res.stderr).trim();
  if (!res.success) {
    console.error(stderr || stdout || "deno bundle failed");
    Deno.exit(res.code ?? 1);
  }
  if (stdout) console.log(stdout);
  try {
    const bundled = await Deno.readTextFile(outPath);
    const patched = stripNodeCompat(bundled);
    if (patched !== bundled) {
      await Deno.writeTextFile(outPath, patched);
    }
  } catch (err) {
    console.warn(`Post-processing skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`Bundled → ${out}`);
}

if (import.meta.main) {
  await bundle();
}
