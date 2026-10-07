// Number text, fixed-point text and canonical JSON (SPEC § 2).
export function numText(x: number): string {
  return String(x);
}

export function fixed(x: number, f: number): string {
  return x.toFixed(f);
}

export function canonical(v: any): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? numText(v) : "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}
