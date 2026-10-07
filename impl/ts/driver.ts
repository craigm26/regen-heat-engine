// JSON-lines driver (SPEC § 1.2). Run: node driver.ts
import { canonical, wetBulb, wetBulbFromF, flagF, flagC, workRest, verdict, cascade } from "./engine.ts";

class Bad extends Error {}

const SPECIAL: Record<string, number> = { NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity };
const isObj = (x: any) => typeof x === "object" && x !== null && !Array.isArray(x);
const has = (o: any, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function num(i: any, k: string): number {
  const v = has(i, k) ? i[k] : undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string" && has(SPECIAL, v)) return SPECIAL[v];
  throw new Bad();
}
function str(i: any, k: string): string {
  if (has(i, k) && typeof i[k] === "string") return i[k];
  throw new Bad();
}
function bool(i: any, k: string): boolean {
  if (has(i, k) && typeof i[k] === "boolean") return i[k];
  throw new Bad();
}
function strOrNull(i: any, k: string, optional: boolean): string | null {
  if (!has(i, k)) { if (optional) return null; throw new Bad(); }
  if (i[k] === null || typeof i[k] === "string") return i[k];
  throw new Bad();
}

const OPS = new Set(["wetBulb", "wetBulbF", "flagF", "flagC", "workRest", "verdict", "cascade", "canonical"]);

function handle(line: string): string {
  let req: any;
  try { req = JSON.parse(line); } catch { req = undefined; }
  if (!isObj(req) || typeof req.id !== "string") return canonical({ id: null, error: "bad_request" });
  const id = req.id;
  if (typeof req.op !== "string" || !OPS.has(req.op)) return canonical({ id, error: "unknown_op" });
  try {
    const i = req.input;
    if (!isObj(i)) throw new Bad();
    if (req.op === "canonical") {
      if (!has(i, "value")) throw new Bad();
      return canonical({ id, result: canonical(i.value) });
    }
    const clock = req.clock;
    if (typeof clock !== "string") throw new Bad();
    let out;
    switch (req.op) {
      case "wetBulb": out = wetBulb(num(i, "tempC"), num(i, "rhPercent"), clock); break;
      case "wetBulbF": out = wetBulbFromF(num(i, "tempF"), num(i, "rhPercent"), clock); break;
      case "flagF": out = flagF(num(i, "wetBulbF"), clock); break;
      case "flagC": out = flagC(num(i, "wetBulbC"), clock); break;
      case "workRest": out = workRest(str(i, "flag"), bool(i, "acclimatized"), num(i, "workMinutesRequested"), clock); break;
      case "verdict":
        out = verdict(strOrNull(i, "priorVerdict", false), strOrNull(i, "priorFlag", true), str(i, "currentFlag"),
          bool(i, "hasAlternateAvailable"), clock);
        break;
      default: {
        const lat = num(i, "lat"), lng = num(i, "lng");
        let iso: string | undefined;
        if (has(i, "isoTimestamp")) iso = str(i, "isoTimestamp");
        if (!Array.isArray(req.responses)) throw new Bad();
        out = cascade(lat, lng, iso, req.responses, clock);
      }
    }
    return canonical({ id, result: out.result, audit: canonical(out.audit) });
  } catch (e) {
    if (e instanceof Bad) return canonical({ id, error: "bad_request" });
    throw e;
  }
}

async function main() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  const outLines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    outLines.push(handle(line) + "\n");
  }
  process.stdout.write(Buffer.from(outLines.join(""), "utf8"));
}

await main();
