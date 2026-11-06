import fs from "node:fs";
import type { Cond } from "./fields";
import path from "node:path";

export const BASE_DIR = process.env.INSTALLER_BASE_DIR || "/opt/intellivision-installer";
export const PACKAGES_DIR = process.env.PACKAGES_DIR || path.posix.join(BASE_DIR, "packages");
export const WORK_DIR = process.env.WORK_DIR || path.posix.join(BASE_DIR, "work");
export const LOGS_DIR = process.env.LOGS_DIR || path.posix.join(BASE_DIR, "logs");
export const DATA_DIR = process.env.DATA_DIR || path.posix.join(BASE_DIR, "data");
export const TOKEN = process.env.INSTALLER_TOKEN || "";
export const VERSION = process.env.INSTALLER_VERSION || "dev";
/** "host" = nsenter into PID 1 namespaces (container), "local" = plain bash (dev). */
export const EXEC_MODE = process.env.HOST_EXEC || "host";

export type Field = {
  key: string;
  label: string;
  kind: "text" | "port" | "password" | "select";
  options?: { value: string; label: string; hint?: string }[];
  /** Show the field (and send its answer) only when all conditions hold. */
  when?: Cond[];
  /** Omit the field when this key already has a value in the installed .env (the script skips that question). */
  skipIfEnv?: string;
  /** Omit the field when this file exists on the VM (the script skips that question). */
  skipIfFile?: string;
  /** Text shown instead of the field when it is skipped because of skipIfFile. */
  skipNote?: string;
  /** Prefill from a file: group 1 of the regex. */
  prefillFile?: { path: string; regex: string };
  /** .env values that are shipped placeholders and must not be offered as defaults. */
  ignoreValues?: string[];
  envKey?: string;
  default?: string;
  hint?: string;
  pattern?: string;
  patternMsg?: string;
  optional?: boolean;
  placeholder?: string;
  /** args mode: pass this value to the entry script as `<flag> <value>`. */
  flag?: string;
  /** args mode, select fields: the chosen option value IS the argument (e.g. "--https"). Empty value = nothing is passed. */
  asArg?: boolean;
  /** args mode: only pass it when it differs from the installed .env value (an unchanged value on upgrade needs no flag). */
  argIfChanged?: boolean;
  /** Translate the installed .env value into this field's value (e.g. TLS_MODE=off -> "3"). */
  envMap?: Record<string, string>;
  /** Span the full form width. */
  wide?: boolean;
};

export type SystemDef = {
  id: string;
  name: string;
  /** Short label for the top navigation. */
  tab: string;
  description: string;
  /** Regex on the bundle file name. Optional: `detect` finds the bundle by its contents even if it is renamed. */
  match?: string;
  /** Files that must all exist inside the archive (path suffixes). Identifies the bundle whatever its file name is. */
  detect?: string[];
  entry: string[];
  installDir?: string;
  ctl?: string;
  ctlCommands?: { cmd: string; label: string; hint: string; danger?: boolean; timeout?: number; run?: string }[];
  /** Copy the extracted bundle here before running the entry script (for stacks that live in their bundle folder). */
  stageDir?: string;
  /** Extra arguments for the entry script, e.g. ["--yes"]. */
  entryArgs?: string[];
  /** "stdin" = answers piped to the script; "envfile" = KEY=VALUE written to <bundle>/.env, script runs unattended. */
  inputMode?: "stdin" | "envfile" | "args";
  /** Working directory for ctlCommands that use "run". */
  cwd?: string;
  /** Shell snippet run in cwd after the entry script succeeded. Its failure never fails the deploy. */
  postDeploy?: string;
  /** Small "how do I log in" panel shown on the system's tab. */
  loginHint?: { title: string; lines: string[]; command?: string };
  envFile?: string;
  envUpdateCmd?: string;
  /** Questions the entry script asks on stdin, in order. The installer renders them as a form. */
  fields?: Field[];
  /** Fixed answers sent after the fields (e.g. the final "Continue? y"). */
  stdinAfter?: string[];
  /** Answer to give if the script asks to install Docker (only sent when Docker is not ready on the VM). */
  dockerPrompt?: string;
  /** Container whose published ports count as free when checking ports (re-deploys). */
  ownContainer?: string | string[];
  /** Ports the stack uses internally; never offer them. */
  reservedPorts?: number[];
};

function readSystems(file: string): SystemDef[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
    return Array.isArray(parsed.systems) ? (parsed.systems as SystemDef[]) : [];
  } catch {
    return [];
  }
}

/**
 * Built-in systems ship with the image; DATA_DIR/systems.json adds new systems or overrides a built-in
 * one by id, so upgrading the installer never hides systems and local edits survive upgrades.
 */
export function loadSystems(): SystemDef[] {
  const merged = new Map<string, SystemDef>();
  for (const s of readSystems(path.join(process.cwd(), "systems.default.json"))) merged.set(s.id, s);
  for (const s of readSystems(path.join(DATA_DIR, "systems.json"))) merged.set(s.id, s);
  return [...merged.values()];
}
