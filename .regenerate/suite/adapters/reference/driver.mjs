// Reference adapter driver: JSON lines in, JSON lines out (SPEC § 1.2).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

const local = JSON.parse(readFileSync(new URL('./local.json', import.meta.url), 'utf8'));
const lib = await import(pathToFileURL(local.entry).href);

const FLAGS = ['white', 'green', 'yellow', 'red', 'black'];
class BadRequest extends Error {}
const SPECIAL = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };
const number = (o, k) => {
  if (!(k in o)) throw new BadRequest();
  const v = o[k];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v in SPECIAL) return SPECIAL[v];
  throw new BadRequest();
};
const bool = (o, k) => { if (typeof o[k] !== 'boolean') throw new BadRequest(); return o[k]; };
const str = (o, k) => { if (typeof o[k] !== 'string') throw new BadRequest(); return o[k]; };
const strOrNull = (o, k, optional = false) => {
  if (!(k in o)) { if (optional) return undefined; throw new BadRequest(); }
  if (o[k] !== null && typeof o[k] !== 'string') throw new BadRequest();
  return o[k];
};

function replayAdapter(responses) {
  return async (req) => {
    const m = responses.find((r) => new RegExp(r.url_pattern).test(req.url));
    if (!m) throw new Error(`no replay response for ${req.url}`);
    if (m.simulate === 'timeout') throw new Error('timeout');
    return { status: m.status, body: m.body_json !== undefined ? JSON.stringify(m.body_json) : m.body_text ?? '' };
  };
}

const OPS = {
  wetBulb: (i, ctx) => lib.calculateWetBulb({ tempC: number(i, 'tempC'), rhPercent: number(i, 'rhPercent') }, ctx),
  wetBulbF: (i, ctx) => lib.calculateWetBulbF(number(i, 'tempF'), number(i, 'rhPercent'), ctx),
  flagF: (i, ctx) => lib.flagFromWetBulbF(number(i, 'wetBulbF'), ctx),
  flagC: (i, ctx) => lib.flagFromWetBulbC(number(i, 'wetBulbC'), ctx),
  workRest: (i, ctx) => lib.workRestForFlag({ flag: str(i, 'flag'), acclimatized: bool(i, 'acclimatized'), workMinutesRequested: number(i, 'workMinutesRequested') }, ctx),
  verdict: (i, ctx) => {
    const input = { priorVerdict: strOrNull(i, 'priorVerdict'), currentFlag: str(i, 'currentFlag'), hasAlternateAvailable: bool(i, 'hasAlternateAvailable') };
    const pf = strOrNull(i, 'priorFlag', true);
    if (pf !== undefined) input.priorFlag = pf;
    return lib.promoteVerdict(input, ctx);
  },
  cascade: (i, ctx, rq) => {
    if (!Array.isArray(rq.responses)) throw new BadRequest();
    const input = { lat: number(i, 'lat'), lng: number(i, 'lng') };
    if ('isoTimestamp' in i) input.isoTimestamp = str(i, 'isoTimestamp');
    return lib.fetchWeatherCascade(input, { ...ctx, httpAdapter: replayAdapter(rq.responses) });
  },
};
void FLAGS;

async function handle(line) {
  let rq;
  try { rq = JSON.parse(line); } catch { return { id: null, error: 'bad_request' }; }
  if (rq === null || typeof rq !== 'object' || Array.isArray(rq) || typeof rq.id !== 'string') return { id: null, error: 'bad_request' };
  const id = rq.id;
  if (rq.op === 'canonical') {
    if (rq.input === null || typeof rq.input !== 'object' || Array.isArray(rq.input) || !('value' in rq.input)) return { id, error: 'bad_request' };
    return { id, result: lib.canonicalJson(rq.input.value) };
  }
  if (typeof rq.op !== 'string' || !Object.hasOwn(OPS, rq.op)) return { id, error: 'unknown_op' };
  if (rq.input === null || typeof rq.input !== 'object' || Array.isArray(rq.input) || typeof rq.clock !== 'string') return { id, error: 'bad_request' };
  const clock = rq.clock;
  try {
    const out = await OPS[rq.op](rq.input, { clock: () => new Date(clock) }, rq);
    return { id, result: out.result, audit: lib.canonicalJson(out.audit) };
  } catch (e) {
    if (e instanceof BadRequest) return { id, error: 'bad_request' };
    throw e;
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const out = [];
for await (const line of rl) {
  if (line.trim() === '') continue;
  out.push(JSON.stringify(await handle(line)));
}
process.stdout.write(out.map((l) => l + '\n').join(''));
