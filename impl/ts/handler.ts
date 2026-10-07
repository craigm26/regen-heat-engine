// Request validation and dispatch (SPEC § 1.2-1.3).
import { canonical } from "./canon.ts";
import * as ops from "./ops.ts";

const NONFINITE: any = { NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity };
const BAD = Symbol("bad");

// field kinds: num, bool, str, strnull, any; a trailing "?" marks an optional field
function coerce(kind: string, v: any, has: boolean): any {
  if (!has) return kind.endsWith("?") ? undefined : BAD;
  switch (kind.replace("?", "")) {
    case "num":
      if (typeof v === "number") return v;
      return typeof v === "string" && Object.hasOwn(NONFINITE, v) ? NONFINITE[v] : BAD;
    case "bool": return typeof v === "boolean" ? v : BAD;
    case "str": return typeof v === "string" ? v : BAD;
    case "strnull": return v === null || typeof v === "string" ? v : BAD;
    default: return v;
  }
}

const SCHEMA: any = {
  wetBulb: { fn: ops.wetBulb, f: { tempC: "num", rhPercent: "num" } },
  wetBulbF: { fn: ops.wetBulbFOp, f: { tempF: "num", rhPercent: "num" } },
  flagF: { fn: ops.flagF, f: { wetBulbF: "num" } },
  flagC: { fn: ops.flagC, f: { wetBulbC: "num" } },
  workRest: { fn: ops.workRest, f: { flag: "str", acclimatized: "bool", workMinutesRequested: "num" } },
  verdict: { fn: ops.verdict, f: { priorVerdict: "strnull", priorFlag: "strnull?", currentFlag: "str", hasAlternateAvailable: "bool" } },
  cascade: { fn: ops.cascade, f: { lat: "num", lng: "num", isoTimestamp: "str?" } },
  canonical: { f: { value: "any" } },
};

export function handle(line: string): any {
  let req: any;
  try { req = JSON.parse(line); } catch { return { id: null, error: "bad_request" }; }
  if (req === null || typeof req !== "object" || Array.isArray(req)) return { id: null, error: "bad_request" };
  if (typeof req.id !== "string") return { id: null, error: "bad_request" };
  const id = req.id;
  if (typeof req.op !== "string" || !Object.hasOwn(SCHEMA, req.op)) return { id, error: "unknown_op" };
  const bad = { id, error: "bad_request" };
  const spec = SCHEMA[req.op];
  const input = req.input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return bad;
  if (req.op !== "canonical" && typeof req.clock !== "string") return bad;
  const norm: any = {};
  for (const [k, kind] of Object.entries<string>(spec.f)) {
    const v = coerce(kind, input[k], Object.hasOwn(input, k));
    if (v === BAD) return bad;
    if (v !== undefined) norm[k] = v;
  }
  if (req.op === "canonical") return { id, result: canonical(norm.value) };
  if (req.op === "cascade" && !Array.isArray(req.responses)) return bad;
  const out = spec.fn(norm, req.clock, req.responses);
  return { id, result: out.result, audit: canonical(out.audit) };
}

export function run(text: string): string {
  let out = "";
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    out += JSON.stringify(handle(line)) + "\n";
  }
  return out;
}
