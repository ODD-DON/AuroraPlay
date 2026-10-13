// Starts a dev server on a fresh, throwaway database for end-to-end tests. Works on Windows, macOS, and Linux.
import { spawn } from "node:child_process";
import fs from "node:fs";

const port = process.argv[2] ?? "3200";
fs.rmSync(".data/e2e", { recursive: true, force: true });
const child = spawn("npx", ["next", "dev", "-p", port], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, RR_PGLITE_DIR: ".data/e2e", RR_INPROCESS_WORKER: "0" },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
