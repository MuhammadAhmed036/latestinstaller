import path from "node:path";
import { PACKAGES_DIR, WORK_DIR, type SystemDef } from "./config";
import { q } from "./host";
import { stemOf, type Pkg } from "./packages";

export const DEPLOY_STEPS = [
  { key: "preflight", label: "Preflight checks" },
  { key: "verify", label: "Verify checksum" },
  { key: "extract", label: "Extract bundle" },
  { key: "locate", label: "Locate entry script" },
  { key: "install", label: "Run installer" },
  { key: "finish", label: "Finish" },
];

const posix = (p: string) => p.replace(/\\/g, "/");

export function buildDeployScript(pkg: Pkg, sys: SystemDef | null, opts: { verify: boolean; cleanup: boolean; answers?: string[]; envPairs?: [string, string][]; extraArgs?: string[] }): string {
  const archive = path.posix.join(posix(PACKAGES_DIR), pkg.file);
  const sidecar = pkg.sidecar ? path.posix.join(posix(PACKAGES_DIR), pkg.sidecar) : "";
  const stem = stemOf(pkg.file);
  const dest = path.posix.join(posix(WORK_DIR), stem);
  const entries = (sys?.entry?.length ? sys.entry : ["install.sh", "deploy.sh"]).map(q).join(" ");
  const statusRun = sys?.ctlCommands?.find((c) => c.cmd === "status")?.run;
  const ctlStatus = sys?.ctl
    ? `[ -x ${q(sys.ctl)} ] && ${q(sys.ctl)} status || true`
    : statusRun
      ? `(cd ${q(sys?.cwd ?? "/")} && ${statusRun}) || true`
      : "true";

  const installCmd = opts.answers?.length
    ? `if [ "$ENTRY" = "deploy.sh" ]; then
  echo "$ bash deploy.sh   (answers from the installer form)"
  printf '%s\\n' ${opts.answers.map(q).join(" ")} | bash "./$ENTRY" ${(sys?.entryArgs ?? []).map(q).join(" ")}
else
  echo "$ bash $ENTRY"
  bash "./$ENTRY"
fi`
    : `echo "$ bash $ENTRY ${[...(sys?.entryArgs ?? []), ...(opts.extraArgs ?? [])].join(" ")}"
bash "./$ENTRY" ${[...(sys?.entryArgs ?? []), ...(opts.extraArgs ?? [])].map(q).join(" ")}`;

  // Stacks that live inside their bundle folder are copied to a permanent location first.
  const stageCmd = sys?.stageDir
    ? `STAGE=${q(sys.stageDir)}
echo "Staging   : $STAGE"
mkdir -p "$STAGE"
cp -a "$TOP"/. "$STAGE"/
TOP="$STAGE"`
    : "";

  // Unattended scripts take their answers from <bundle>/.env, so we write the form values there.
  const envLines = (opts.envPairs ?? []).map(([k, v]) => `setenv "$TOP/.env" ${q(k)} ${q(v)}`).join("\n");
  const envCmd = opts.envPairs?.length
    ? `setenv() {
  local f="$1" tmp; tmp="$(mktemp)"; touch "$f"
  K="$2" V="$3" awk 'BEGIN{k=ENVIRON["K"]; v=ENVIRON["V"]; d=0}
    index($0, k"=")==1 { print k"="v; d=1; next }
    { print }
    END { if (!d) print k"="v }' "$f" >"$tmp"
  cat "$tmp" >"$f"; rm -f "$tmp"
}
echo "Writing configuration to $TOP/.env"
${envLines}
chmod 600 "$TOP/.env"`
    : "";

  const postCmd = sys?.postDeploy
    ? `echo
echo "── post-deploy checks"
( cd ${q(sys.cwd ?? sys.installDir ?? "/")} && bash -c ${q(sys.postDeploy)} ) || echo "post-deploy step did not finish (the deploy itself succeeded)"`
    : "";

  return `
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive TERM=dumb
step() { echo "::step::$1"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

ARCHIVE=${q(archive)}
SIDECAR=${q(sidecar)}
DEST=${q(dest)}
WORK=${q(posix(WORK_DIR))}

step preflight
[ "$(id -u)" -eq 0 ] || fail "host commands are not running as root"
[ -f "$ARCHIVE" ] || fail "bundle not found: $ARCHIVE"
mkdir -p "$WORK"
size=$(stat -c %s "$ARCHIVE")
avail=$(df -PB1 "$WORK" | awk 'NR==2{print $4}')
need=$((size * 3))
echo "Bundle    : $(basename "$ARCHIVE")"
echo "Size      : $((size / 1048576)) MiB"
echo "Free disk : $((avail / 1048576)) MiB at $WORK (need about $((need / 1048576)) MiB)"
[ "$avail" -ge "$need" ] || fail "not enough free disk space"
command -v docker >/dev/null 2>&1 && echo "Docker    : $(docker --version)" || echo "Docker    : not found (the bundle's install.sh may install it)"

step verify
${
  opts.verify
    ? `expected=${q(pkg.expectedSha ?? "")}
if [ -z "$expected" ]; then
  echo "No usable checksum file next to the bundle - verification skipped"
else
  echo "Expected  : $expected"
  echo "Hashing…"
  actual=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)
  echo "Actual    : $actual"
  [ "$expected" = "$actual" ] || fail "CHECKSUM MISMATCH – the file is corrupt or incomplete. Copy it again."
  echo "Checksum OK"
fi`
    : `echo "Skipped by operator (checksum not verified)"`
}

step extract
rm -rf "$DEST"
mkdir -p "$DEST"
echo "Extracting to $DEST (large bundles take a minute)…"
tar -xf "$ARCHIVE" -C "$DEST"
echo "Extracted $(du -sh "$DEST" | cut -f1)"

step locate
TOP=""; ENTRY=""
for c in ${entries}; do
  hit="$(find "$DEST" -maxdepth 3 -type f -name "$c" | awk '{print gsub("/","/"), $0}' | sort -n | head -n1 | cut -d' ' -f2-)"
  if [ -n "$hit" ]; then TOP="$(dirname "$hit")"; ENTRY="$c"; break; fi
done
[ -n "$ENTRY" ] || fail "no entry script (${(sys?.entry ?? ["install.sh", "deploy.sh"]).join(" / ")}) found in the bundle"
echo "Directory : $TOP"
echo "Entry     : $ENTRY"
${stageCmd}

step install
cd "$TOP"
${envCmd}
${installCmd}

step finish
${opts.cleanup ? `echo "Removing extracted files"; rm -rf "$DEST"` : `echo "Extracted files kept at $DEST"`}
${ctlStatus}
${postCmd}
`;
}

export function buildCtlScript(sys: SystemDef, cmd: string, timeoutSec?: number, runCmd?: string): string {
  // Commands defined with "run" are plain shell lines executed in sys.cwd (stacks without a ctl wrapper).
  if (runCmd) {
    const cwd = q(sys.cwd ?? sys.installDir ?? "/");
    return `set -Eeuo pipefail
export TERM=dumb
step() { echo "::step::$1"; }
step run
[ -d ${cwd} ] || { echo "ERROR: ${sys.cwd ?? sys.installDir} not found – is ${sys.name} installed?" >&2; exit 1; }
cd ${cwd}
echo "$ ${runCmd.replace(/["$`\\]/g, "\\$&")}"
${timeoutSec ? `timeout ${Math.floor(timeoutSec)} bash -c ${q(runCmd)} || [ $? -eq 124 ]` : runCmd}
`;
  }
  const ctl = q(sys.ctl!);
  const run = timeoutSec ? `timeout ${Math.floor(timeoutSec)} ${ctl} ${q(cmd)} || [ $? -eq 124 ]` : `${ctl} ${q(cmd)}`;
  return `set -Eeuo pipefail
export TERM=dumb
step() { echo "::step::$1"; }
step run
[ -x ${ctl} ] || { echo "ERROR: ${sys.ctl} not found – is ${sys.name} installed?" >&2; exit 1; }
echo "$ ${sys.ctl!.split("/").pop()} ${cmd}"
${run}
`;
}

export const CTL_STEPS = [{ key: "run", label: "Run command" }];
