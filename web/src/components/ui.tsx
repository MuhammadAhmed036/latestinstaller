"use client";

import { Check, Copy, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  icon?: React.ReactNode;
};

/** Primary = white (Framer / 21st). Blue is kept for selection and focus, not for buttons. */
export function Button({ variant = "secondary", loading, icon, className, children, disabled, ...rest }: BtnProps) {
  const styles = {
    primary: "bg-fg text-bg hover:bg-[#d9d9d9] border-transparent font-semibold",
    secondary: "bg-transparent text-fg hover:bg-raised border-line-strong",
    ghost: "bg-transparent text-muted hover:text-fg border-transparent",
    danger: "bg-transparent text-danger hover:bg-danger-soft border-danger/40",
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-ctl border px-4 text-[13px] font-medium transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-40",
        styles,
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-panel border border-line bg-surface", className)}>{children}</div>;
}

/** Mono uppercase section marker, as on skills.sh. */
export function SectionLabel({ n, children }: { n?: string; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-3 font-mono text-[11px] font-medium tracking-[0.14em] text-faint uppercase">
      {n && <span className="text-fg">{n}</span>}
      {n && <span className="h-px w-6 bg-line-strong" aria-hidden />}
      {children}
    </h3>
  );
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="max-w-2xl">
      <h1 className="text-[40px] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[48px]">{title}</h1>
      {children && <p className="mt-4 text-[16px] leading-relaxed text-muted">{children}</p>}
    </header>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";
export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: React.ReactNode; children: React.ReactNode }) {
  const t = {
    neutral: "text-muted border-line-strong",
    accent: "text-[#8da6ff] border-accent/50 bg-accent-soft",
    ok: "text-ok border-ok/30 bg-ok-soft",
    warn: "text-warn border-warn/30 bg-warn-soft",
    danger: "text-danger border-danger/30 bg-danger-soft",
  }[tone];
  return (
    <span className={cn("inline-flex h-[18px] items-center gap-1 rounded-[5px] border px-1.5 font-mono text-[10px] font-medium tracking-wide whitespace-nowrap uppercase", t)}>
      {icon}
      {children}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-start gap-3", disabled && "opacity-40")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 disabled:cursor-not-allowed",
          checked ? "bg-accent" : "bg-line-strong",
        )}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform duration-150", checked && "translate-x-4")} />
      </button>
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="text-[12px] text-muted">{hint}</div>}
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-panel border border-line-strong bg-surface"
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <h3 className="text-[17px] font-semibold tracking-tight">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md p-1 text-muted hover:bg-raised hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4 text-[13px] leading-relaxed text-muted">{children}</div>
        <div className="flex justify-end gap-2 px-5 pb-5">{footer}</div>
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden />;
}

/** `$ command` block with copy button (skills.sh style). */
export function CommandBlock({ children, text }: { children: React.ReactNode; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-ctl border border-line-strong bg-surface px-3.5 py-2.5 font-mono text-[12px]">
      <span className="text-faint select-none">$</span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-fg">{children}</code>
      <button
        aria-label="Copy command"
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }}
        className="cursor-pointer text-muted hover:text-fg"
      >
        {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
