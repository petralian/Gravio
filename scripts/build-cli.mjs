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
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "scripts", "gravio-scan.mjs");
const OUT_DIR = path.join(ROOT, "src", "web", "cli");
const OUT_FILE = path.join(OUT_DIR, "gravio.mjs");
const MANIFEST_FILE = path.join(OUT_DIR, "manifest.json");

fs.mkdirSync(OUT_DIR, { recursive: true });

/** Inject the version at build time so the CLI can self-update. */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const CLI_VERSION_STRING = pkg.version ?? "0.0.0";
const SOURCE_REPO_URL = (() => {
  if (typeof process.env.GRAVIO_SOURCE_REPO_URL === "string" && process.env.GRAVIO_SOURCE_REPO_URL.trim()) {
    return process.env.GRAVIO_SOURCE_REPO_URL.trim();
  }
  if (typeof pkg.repository === "string" && pkg.repository.trim()) {
    return pkg.repository.trim();
  }
  if (pkg.repository && typeof pkg.repository.url === "string" && pkg.repository.url.trim()) {
    return pkg.repository.url.trim();
  }
  return "https://github.com/your-org/gravio";
})();

const BANNER = `// Gravio CLI — bundled distribution.
// Source: https://github.com/your-org/gravio · https://gravio.dev
// Run:    node gravio.mjs --once
// Build:  esbuild bundle (minified), no obfuscation.
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
  // Inject the version constant so the CLI knows its own version at runtime.
  define: { GRAVIO_CLI_VERSION: JSON.stringify(CLI_VERSION_STRING) },
  legalComments: "none",
  minify: true,
  sourcemap: false,
  logLevel: "info",
});

const stats = fs.statSync(OUT_FILE);
console.log(`✓ Wrote ${path.relative(ROOT, OUT_FILE)} (${(stats.size / 1024).toFixed(1)} KB)`);

const cliBytes = fs.readFileSync(OUT_FILE);
const sha256 = crypto.createHash("sha256").update(cliBytes).digest("hex");
const builtAt = new Date().toISOString();

const manifest = {
  schemaVersion: 1,
  generatedAt: builtAt,
  source: {
    repositoryUrl: SOURCE_REPO_URL,
    buildScript: "scripts/build-cli.mjs",
  },
  cli: {
    path: "/cli/gravio.mjs",
    version: CLI_VERSION_STRING,
    builtAt,
    sizeBytes: stats.size,
    sha256,
  },
  integrity: {
    algorithm: "sha256",
    checksumField: "cli.sha256",
  },
  signature: {
    algorithm: "none",
    detachedSignatureUrl: null,
    publicKeyUrl: null,
    note: "Detached signatures are not published yet. Verify checksum against this manifest.",
  },
  guarantees: {
    auth: [
      "CLI accepts token from GRAVIO_TOKEN/GRAVIO_API_KEY env vars or saved local auth state.",
      "CLI warns when --token is used because argv may leak into shell history.",
      "Server validates token via /api/me before scan publish is attempted.",
    ],
    dataRead: [
      "Project file and directory names/structure for configured scan signals.",
      "Git metadata (tracked files, commit/reference status) needed for quality checks.",
      "Project config metadata (package manifests, lock files, CI config, docs signals).",
    ],
    dataNotRead: [
      "CLI does not read .env secret values for upload payload construction.",
      "CLI does not transmit full source code file contents as part of published run payloads.",
    ],
    dataTransmitted: [
      "Scan signal summary payload to /api/scan-evaluate over HTTPS.",
      "Encrypted run envelope (AES-256-GCM) to /api/publish over HTTPS.",
      "Optional scan artifact summary to /api/scans/artifact over HTTPS.",
    ],
    encryption: [
      "Run payload is encrypted client-side before publish.",
      "Envelope modes include api-key-derived key, passphrase-derived key, or raw one-time key.",
    ],
  },
};

fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`✓ Wrote ${path.relative(ROOT, MANIFEST_FILE)} (${sha256.slice(0, 12)}...)`);
