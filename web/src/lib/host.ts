import { spawn } from "node:child_process";
import { EXEC_MODE } from "./config";

/** Single-quote a value for safe use in a bash command line. */
export function q(v: string): string {
  return "'" + v.replace(/'/g, "'\\''") + "'";
}

function argvFor(script: string): [string, string[]] {
  if (EXEC_MODE === "local") return ["bash", ["-c", script]];
  // Enter mount/uts/ipc/net/pid namespaces of the host's PID 1 => commands run as root on the VM.
  return ["nsenter", ["-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "bash", "-c", script]];
}

export type RunResult = { code: number; stdout: string; stderr: string };

export function runHost(script: string, timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    const [cmd, args] = argvFor(script);
    const child = spawn(/*turbopackIgnore: true*/ cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function spawnHost(script: string, onLine: (line: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const [cmd, args] = argvFor(script);
    const child = spawn(/*turbopackIgnore: true*/ cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    const feed = (d: Buffer) => {
      buf += d.toString("utf8");
      const parts = buf.split(/\r?\n|\r/);
      buf = parts.pop() ?? "";
      for (const p of parts) onLine(p);
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (e) => {
      onLine(`[installer] spawn error: ${e}`);
      resolve(127);
    });
    child.on("close", (code) => {
      if (buf) onLine(buf);
      resolve(code ?? 1);
    });
  });
}
