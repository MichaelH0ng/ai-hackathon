// Starts the local "Michael" voice service with `npm run dev`, if this computer has it set up
// (see voice/README.md). Otherwise it waits quietly: Polaris uses a built-in voice instead,
// and the website and API keep running (concurrently stops everything if one process exits).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.VOICE_PYTHON || "/opt/anaconda3/envs/northstar-voice/bin/python";
const needed = [python, path.join(root, "voice", "speaker", "me.pth"), path.join(root, "voice", "vendor", "checkpoints_v2", "converter", "checkpoint.pth")];
const missing = needed.filter((file) => !fs.existsSync(file));

if (missing.length) {
  console.log("Michael voice not set up on this computer (see voice/README.md). Polaris will use a built-in voice.");
  setInterval(() => {}, 1 << 30); // stay alive without using CPU
} else {
  console.log("Starting the Michael voice (first start takes about 10 seconds)…");
  const child = spawn(python, [path.join(root, "voice", "server.py")], { stdio: ["ignore", "inherit", "pipe"] });
  // The model libraries print long warnings on start; show only real errors.
  child.stderr.on("data", (chunk) => {
    for (const line of String(chunk).split("\n")) if (/error|traceback|exception/i.test(line) && !/warning/i.test(line)) console.error(line);
  });
  child.on("exit", (code) => {
    console.log(`Michael voice stopped (code ${code}). Polaris will use a built-in voice until you restart npm run dev.`);
    setInterval(() => {}, 1 << 30);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { child.kill(); process.exit(0); });
}
