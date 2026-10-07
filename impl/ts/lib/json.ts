// Canonical JSON (REQ-CJ-001..004). JS built-ins already implement the required rules.
export function numText(x: number): string {
  return String(x);
}

export function fixed(x: number, f: number): string {
  return x.toFixed(f);
}

export function canonical(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? numText(v) : "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map((e) => (e === undefined ? "null" : canonical(e))).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}
