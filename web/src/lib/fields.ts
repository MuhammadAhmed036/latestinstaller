/** Pure helpers shared by the server (answer building) and the browser (form rendering). */
export type Cond = { key: string; in?: string[]; notEmpty?: boolean };

export type FieldLike = { key: string; when?: Cond[] };

/** A field is shown (and its answer sent) only if it was not skipped and all its conditions hold. */
export function isVisible(f: FieldLike, values: Record<string, string | undefined>, skipped: readonly string[] = []): boolean {
  if (skipped.includes(f.key)) return false;
  return (f.when ?? []).every((c) => {
    const v = (values[c.key] ?? "").trim();
    if (c.notEmpty) return v !== "";
    if (c.in) return c.in.includes(v);
    return true;
  });
}
