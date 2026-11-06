import { isAuthed, json, unauthorized } from "@/lib/auth";
import { hasRunningJob, startJob } from "@/lib/jobs";
import { resolvePackage } from "@/lib/packages";
import { DEPLOY_STEPS, buildDeployScript } from "@/lib/scripts";
import { buildAnswers, dockerReady, getSystem, readInstalledEnv, skippedFields } from "@/lib/systems";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as {
    file?: string;
    verify?: boolean;
    cleanup?: boolean;
    values?: Record<string, unknown>;
  };
  const pkg = resolvePackage(body.file ?? "");
  if (!pkg) return json({ error: "Package not found in the packages directory." }, 404);
  if (hasRunningJob()) return json({ error: "Another job is still running. Wait for it to finish." }, 409);
  if (pkg.detecting) return json({ error: "Still identifying this bundle. Try again in a moment." }, 409);
  const sys = getSystem(pkg.system?.id);

  let answers: string[] | undefined;
  let envPairs: [string, string][] | undefined;
  let extraArgs: string[] | undefined;
  if (sys?.fields?.length) {
    const skipped = Object.keys(await skippedFields(sys));
    const a = buildAnswers(sys, body.values ?? {}, skipped, sys.inputMode === "args" ? await readInstalledEnv(sys) : null);
    if ("error" in a) return json({ error: a.error }, 400);
    if (sys.inputMode === "envfile") envPairs = a.envPairs;
    else if (sys.inputMode === "args") extraArgs = a.args;
    else {
      answers = a.answers;
      // The script asks "install Docker now?" first when Docker is missing; answer it so the rest stays aligned.
      if (sys.dockerPrompt && !(await dockerReady())) answers = [sys.dockerPrompt, ...answers];
    }
  }

  const job = startJob({
    kind: "deploy",
    title: sys ? `Deploy ${sys.name}` : "Deploy package",
    subtitle: pkg.file,
    steps: DEPLOY_STEPS,
    script: buildDeployScript(pkg, sys, { verify: body.verify !== false, cleanup: body.cleanup === true, answers, envPairs, extraArgs }),
  });
  return json({ job });
}
