#!/usr/bin/env node
/**
 * build-cli.mjs
 *
 * Bundles the Gravio scanner + its transitive sources into a single
 * self-contained ESM file users can download and run directly:
 *
 *   curl -fsSL https://gravio.dev/cli/gravio.mjs -o gravio.mjs
 *   node gravio.mjs --once
 *
 * Output: src/web/cli/gravio.mjs (committed to the repo and served by
 * the static-file fallback in src/server.mjs).
 *
 * Uses esbuild (devDependency). Zero runtime deps because the scanner
 * itself only imports Node built-ins.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "scripts", "gravio-scan.mjs");
const OUT_DIR = path.join(ROOT, "src", "web", "cli");
const OUT_FILE = path.join(OUT_DIR, "gravio.mjs");

fs.mkdirSync(OUT_DIR, { recursive: true });

const BANNER = `// Gravio CLI — bundled distribution.
// Source: https://github.com/your-org/gravio · https://gravio.dev
// Run:    node gravio.mjs --once
`;

await build({
  entryPoints: [ENTRY],
  outfile: OUT_FILE,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  // Keep Node built-ins external — they're available wherever Node runs.
  external: ["node:*"],
  banner: { js: BANNER },
  legalComments: "none",
  minify: false,
  sourcemap: false,
  logLevel: "info",
});

const stats = fs.statSync(OUT_FILE);
console.log(`✓ Wrote ${path.relative(ROOT, OUT_FILE)} (${(stats.size / 1024).toFixed(1)} KB)`);
