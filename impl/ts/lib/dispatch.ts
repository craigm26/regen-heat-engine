import { canonical } from "./json.ts";
import { serialize, type Out } from "./audit.ts";
import { wetBulb, wetBulbFromF, flagF, flagC, workRest, verdict } from "./ops.ts";
import { cascade } from "./cascade.ts";

class Bad { cat: string; constructor(cat: string) { this.cat = cat; } }
const bad = () => new Bad("bad_request");
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const OPS = ["wetBulb", "wetBulbF", "flagF", "flagC", "workRest", "verdict", "cascade", "canonical"];
const SPECIAL: Record<string, number> = { NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity };

type Inp = Record<string, unknown>;
const has = (o: Inp, k: string) => Object.hasOwn(o, k);

function num(o: Inp, k: string): number {
  const v = has(o, k) ? o[k] : undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string" && Object.hasOwn(SPECIAL, v)) return SPECIAL[v];
  throw bad();
}
function str(o: Inp, k: string): string {
  const v = has(o, k) ? o[k] : undefined;
  if (typeof v !== "string") throw bad();
  return v;
}
function bool(o: Inp, k: string): boolean {
  const v = has(o, k) ? o[k] : undefined;
  if (typeof v !== "boolean") throw bad();
  return v;
}
function strOrNull(o: Inp, k: string, optional: boolean): string | null {
  if (!has(o, k)) { if (optional) return null; throw bad(); }
  const v = o[k];
  if (v === null) return null;
  if (typeof v !== "string") throw bad();
  return v;
}

function run(req: Record<string, unknown>): Record<string, unknown> {
  const id = req.id as string;
  const op = req.op;
  if (typeof op !== "string" || !OPS.includes(op)) throw new Bad("unknown_op");
  if (!isObj(req.input)) throw bad();
  const input = req.input;
  if (op === "canonical") {
    if (!has(input, "value")) throw bad();
    return { id, result: canonical(input.value) };
  }
  const clock = req.clock;
  if (typeof clock !== "string") throw bad();
  let out: Out;
  switch (op) {
    case "wetBulb": out = wetBulb(num(input, "tempC"), num(input, "rhPercent"), clock); break;
    case "wetBulbF": out = wetBulbFromF(num(input, "tempF"), num(input, "rhPercent"), clock); break;
    case "flagF": out = flagF(num(input, "wetBulbF"), clock); break;
    case "flagC": out = flagC(num(input, "wetBulbC"), clock); break;
    case "workRest":
      out = workRest(str(input, "flag"), bool(input, "acclimatized"), num(input, "workMinutesRequested"), clock); break;
    case "verdict": {
      const pv = strOrNull(input, "priorVerdict", false);
      const pf = strOrNull(input, "priorFlag", true);
      out = verdict(pv, pf, str(input, "currentFlag"), bool(input, "hasAlternateAvailable"), clock);
      break;
    }
    default: {
      const lat = num(input, "lat"), lng = num(input, "lng");
      let iso: string | undefined;
      if (has(input, "isoTimestamp")) iso = str(input, "isoTimestamp");
      if (!Array.isArray(req.responses)) throw bad();
      out = cascade(lat, lng, iso, req.responses, clock);
    }
  }
  return { id, result: out.result, audit: serialize(out.audit) };
}

export function handleLine(line: string): string {
  let req: unknown;
  try { req = JSON.parse(line); } catch { req = undefined; }
  if (!isObj(req) || typeof req.id !== "string") return JSON.stringify({ id: null, error: "bad_request" });
  try {
    return JSON.stringify(run(req));
  } catch (e) {
    if (e instanceof Bad) return JSON.stringify({ id: req.id, error: e.cat });
    return JSON.stringify({ id: req.id, error: "bad_request" });
  }
}
