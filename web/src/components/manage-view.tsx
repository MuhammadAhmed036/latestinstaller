"use client";

import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type SystemView } from "@/lib/client";
import { JobConsole } from "./job-console";
import { Badge, Button, Modal, Panel, SectionLabel } from "./ui";

export function ManageView({ sys }: { sys: SystemView }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ask, setAsk] = useState<{ cmd: string; label: string } | null>(null);

  async function run(cmd: string) {
    setBusy(true);
    setError("");
    setAsk(null);
    try {
      const r = await api<{ job: { id: string } }>("/api/manage", { method: "POST", json: { system: sys.id, cmd } });
      setJobId(r.job.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!sys.ctlCommands?.length && !sys.envFile) return null;

  return (
    <div className="space-y-12 border-t border-line pt-16">
      <div>
        <h2 className="text-[28px] leading-tight font-semibold tracking-[-0.03em]">Manage</h2>
        <p className="mt-2 text-[14px] text-muted">Control commands and configuration of the installed system.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-ctl border border-danger/40 bg-danger-soft px-4 py-3 text-[13px] text-danger">
          {error}
        </div>
      )}

      {!!sys.ctlCommands?.length && (
        <section>
          <div className="mb-4 flex items-center justify-between gap-4">
            <SectionLabel n="01">Commands</SectionLabel>
            {sys.ctl && <span className="font-mono text-[11px] text-faint">{sys.ctl}</span>}
          </div>
          <div className="overflow-hidden rounded-panel border border-line">
            {sys.ctlCommands.map((c) => (
              <div key={c.cmd} className="flex items-center gap-4 border-b border-line px-5 py-3.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] font-medium">{c.cmd}</span>
                    {c.danger && <Badge tone="warn">changes system</Badge>}
                  </div>
                  <div className="text-[12.5px] text-muted">{c.hint}</div>
                </div>
                <Button disabled={busy} onClick={() => (c.danger ? setAsk({ cmd: c.cmd, label: c.label }) : run(c.cmd))} icon={<Play className="size-3" />} className="h-8">
                  Run
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {jobId && <JobConsole id={jobId} />}

      {sys.envFile && (
        <section>
          <div className="mb-4 flex items-center justify-between gap-4">
            <SectionLabel n="02">Configuration</SectionLabel>
            <span className="font-mono text-[11px] text-faint">{sys.envFile}</span>
          </div>
          <EnvEditor sys={sys} onApply={() => run(sys.envUpdateCmd ?? "restart")} />
        </section>
      )}

      <Modal
        open={!!ask}
        title={ask?.label + "?"}
        onClose={() => setAsk(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsk(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => ask && run(ask.cmd)}>
              {ask?.label}
            </Button>
          </>
        }
      >
        This changes the running system. Services may be briefly unavailable.
      </Modal>
    </div>
  );
}

function EnvEditor({ sys, onApply }: { sys: SystemView; onApply: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [orig, setOrig] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(null);
    setErr("");
    api<{ content: string }>(`/api/manage/env?system=${sys.id}`)
      .then((r) => {
        setText(r.content);
        setOrig(r.content);
      })
      .catch((e) => setErr(e.message));
  }, [sys.id]);

  async function save(apply: boolean) {
    setSaving(true);
    setMsg("");
    try {
      await api("/api/manage/env", { method: "PUT", json: { system: sys.id, content: text } });
      setOrig(text ?? "");
      setMsg("Saved. Previous version kept as .env.bak");
      if (apply) onApply();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const dirty = text !== null && text !== orig;
  if (err) return <Panel className="border-dashed px-6 py-10 text-center text-[13px] text-faint">{err}</Panel>;
  if (text === null) return <div className="h-48 animate-pulse rounded-panel bg-surface" />;
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label=".env contents"
        className="h-72 w-full resize-y rounded-panel border border-line bg-surface p-4 font-mono text-[12.5px] leading-[1.7] focus:border-accent"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button disabled={!dirty} loading={saving} onClick={() => save(false)}>
          Save
        </Button>
        <Button variant="primary" disabled={!dirty} loading={saving} onClick={() => save(true)}>
          Save and apply
        </Button>
        {msg && <span className="text-[13px] text-ok">{msg}</span>}
      </div>
    </div>
  );
}
