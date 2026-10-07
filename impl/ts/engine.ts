// heat-engine core: operations return { result, audit }; audits are plain objects.
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json | undefined };
type Obj = { [k: string]: any };

export const SPEC_VERSION = "0.2.0";

// ---- canonical JSON (SPEC § 2) ----
export function canonical(v: any): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "string") return JSON.stringify(v); // lowercase \u escapes, lone surrogates escaped
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}

// number as it appears in audit inputs (REQ-AU-002)
export function numIn(x: number): number | string {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "-Infinity";
  return x;
}

export type Out = { result: Json | null; audit: Obj };

function audit(fn: string, inputs: Obj, constants: Obj, citation: string, summary: string, clock: string, extra: Obj = {}): Obj {
  return {
    spec_version: SPEC_VERSION, function: fn, inputs, constants, citation,
    result_summary: summary, computed_at: clock, ...extra,
  };
}

// ---- wet bulb (§ 4) ----
const WB_CITE = "Stull (2011) eq. 1";

export function wetBulb(tempC: number, rhPercent: number, clock: string): Out {
  const inputs = { tempC: numIn(tempC), rhPercent: numIn(rhPercent) };
  if (!Number.isFinite(tempC) || !Number.isFinite(rhPercent)) {
    const bad = !Number.isFinite(tempC) ? "tempC" : "rhPercent";
    return { result: null, audit: audit("calculateWetBulb", inputs, {}, WB_CITE, "invalid_input:" + bad, clock) };
  }
  const T = tempC;
  const RH = Math.min(100, Math.max(5, rhPercent));
  const term1 = T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659));
  const term2 = Math.atan(T + RH);
  const term3 = Math.atan(RH - 1.676331);
  const term4 = 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH);
  const wetBulbC = term1 + term2 - term3 + term4 + (-4.686035);
  const wetBulbF = (wetBulbC * 9) / 5 + 32;
  const clamped = RH !== rhPercent;
  const result: Obj = { wetBulbC, wetBulbF };
  if (clamped) result.clampedRhPct = RH;
  const constants: Obj = {
    stull_a: 0.151977, stull_b: 8.313659, stull_c: 1.676331,
    stull_d: 0.00391838, stull_e: 0.023101, stull_offset: -4.686035,
  };
  if (clamped) { constants.rh_clamp_min = 5; constants.rh_clamp_max = 100; }
  const markers: string[] = [];
  if (clamped) markers.push("rh_clamped");
  if (tempC < -20 || tempC > 50) markers.push("out_of_validity_range");
  const rh = clamped ? `${rhPercent}→${RH}%` : `${RH}%`;
  const summary = `T=${T.toFixed(1)}°C RH=${rh}${markers.length ? " (" + markers.join(",") + ")" : ""} → Tw=${wetBulbC.toFixed(2)}°C`;
  return { result, audit: audit("calculateWetBulb", inputs, constants, WB_CITE, summary, clock) };
}

export function wetBulbFromF(tempF: number, rhPercent: number, clock: string): Out {
  return wetBulb(((tempF - 32) * 5) / 9, rhPercent, clock);
}

// ---- flags (§ 5) ----
export const FLAGS = ["white", "green", "yellow", "red", "black"];
const LABELS: Obj = { white: "low", green: "moderate", yellow: "high", red: "extreme", black: "critical" };
const FLAG_CITE = "USMC 6200.1E Table 3-1";
const FLAG_CONSTS = { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 };

function classify(w: number): string {
  return w < 80 ? "white" : w < 85 ? "green" : w < 88 ? "yellow" : w < 90 ? "red" : "black";
}

export function flagF(w: number, clock: string): Out {
  const inputs = { wetBulbF: numIn(w) };
  if (!Number.isFinite(w)) {
    return { result: null, audit: audit("flagFromWetBulbF", inputs, {}, FLAG_CITE, "invalid_input:wetBulbF", clock) };
  }
  const flag = classify(w);
  const oor = w < -50 || w > 200 ? " (out_of_observed_range)" : "";
  return {
    result: { flag, flagDartLabel: LABELS[flag] },
    audit: audit("flagFromWetBulbF", inputs, { ...FLAG_CONSTS }, FLAG_CITE, `wetBulbF=${w} → ${flag}${oor}`, clock),
  };
}

export function flagC(c: number, clock: string): Out {
  const inputs = { wetBulbC: numIn(c) };
  if (!Number.isFinite(c)) {
    return { result: null, audit: audit("flagFromWetBulbC", inputs, {}, FLAG_CITE, "invalid_input:wetBulbC", clock) };
  }
  const f = (c * 9) / 5 + 32;
  const child = flagF(f, clock);
  const flag = (child.result as Obj | null)?.flag;
  return {
    result: child.result,
    audit: audit("flagFromWetBulbC", inputs, { ...FLAG_CONSTS }, FLAG_CITE,
      `wetBulbC=${c} → wetBulbF=${f.toFixed(4)} → ${flag}`, clock, { children: [child.audit] }),
  };
}

// ---- work/rest (§ 6) ----
// [work, rest, reassess cycles] per flag; null = cease work
const TABLE: Obj = {
  white: [[60, 0, null], [50, 10, null]],
  green: [[50, 10, null], [40, 20, null]],
  yellow: [[45, 15, 6], [30, 30, 4]],
  red: [[30, 30, 4], null],
  black: [[10, 50, 1], null],
};

export function workRest(flag: string, acclimatized: boolean, req: number, clock: string): Out {
  const cite = "USMC 6200.1E §3.2";
  const inputs = { flag, acclimatized, workMinutesRequested: numIn(req) };
  if (!FLAGS.includes(flag)) return { result: null, audit: audit("workRestForFlag", inputs, {}, cite, "invalid_input:flag", clock) };
  if (!Number.isFinite(req)) return { result: null, audit: audit("workRestForFlag", inputs, {}, cite, "invalid_input:workMinutesRequested", clock) };
  const branch = acclimatized ? "acclim" : "unacclim";
  const cell = TABLE[flag][acclimatized ? 0 : 1];
  const tail = req <= 0 ? " (non_positive_work_window)" : "";
  if (cell === null) {
    return {
      result: { workMinutes: 0, restMinutes: 0, cyclesUntilReassessRequired: null, ceaseWork: true },
      audit: audit("workRestForFlag", inputs, {}, cite, `${flag}/${branch} → cease_work${tail}`, clock),
    };
  }
  const [w, r, n] = cell;
  const constants: Obj = { [`${flag}_work_${branch}`]: w, [`${flag}_rest_${branch}`]: r };
  if (n !== null) constants[acclimatized ? `${flag}_reassess_cycles` : `${flag}_reassess_cycles_unacclim`] = n;
  let s = `${flag}/${branch} → ${w}w/${r}r`;
  if (n === 1) s += ", reassess every cycle";
  else if (n !== null) s += `, reassess after ${n} cycles`;
  return {
    result: { workMinutes: w, restMinutes: r, cyclesUntilReassessRequired: n, ceaseWork: false },
    audit: audit("workRestForFlag", inputs, constants, cite, s + tail, clock),
  };
}

// ---- verdict (§ 7) ----
export function verdict(priorVerdict: string | null, priorFlag: string | null, currentFlag: string, alt: boolean, clock: string): Out {
  const cite = "Go/delay/alternate promotion matrix";
  const inputs = { priorVerdict, priorFlag, currentFlag, hasAlternateAvailable: alt };
  const bad = (f: string): Out => ({ result: null, audit: audit("promoteVerdict", inputs, {}, cite, "invalid_input:" + f, clock) });
  if (!FLAGS.includes(currentFlag)) return bad("currentFlag");
  if (priorVerdict !== null && !["go", "delay", "alternate"].includes(priorVerdict)) return bad("priorVerdict");
  if (priorFlag !== null && !FLAGS.includes(priorFlag)) return bad("priorFlag");
  const hot = currentFlag === "red" || currentFlag === "black";
  let v: string, rule: string, summary: string;
  const prior = priorFlag === null ? "null" : priorFlag;
  if (priorVerdict === null) {
    rule = "FIRST_RUN_DEFAULT"; v = hot ? "delay" : "go";
    summary = `first run, ${currentFlag} → ${v}`;
  } else if (priorFlag === currentFlag) {
    rule = "NO_CHANGE"; v = priorVerdict;
    summary = `no_change, ${currentFlag} → ${v}` + (priorVerdict === "delay" ? " (held)" : "");
  } else if (currentFlag === "black" && alt) {
    rule = "ALTERNATE_AVAILABLE_AT_BLACK"; v = "alternate";
    summary = `${prior} → ${currentFlag} + alternate → alternate`;
  } else if (hot) {
    rule = "ESCALATE_TO_DELAY_ON_RED_OR_BLACK"; v = "delay";
    summary = `${prior} → ${currentFlag}, escalate to delay`;
  } else {
    rule = "DEESCALATE_TO_GO"; v = "go";
    summary = `${prior} → ${currentFlag}, deescalate to go`;
  }
  const changed = rule === "FIRST_RUN_DEFAULT" || rule === "NO_CHANGE" ? false : priorVerdict !== v;
  return {
    result: { verdict: v, changedFromPrior: changed, promotionRule: rule },
    audit: audit("promoteVerdict", inputs, {}, cite, summary, clock, { prior_flag: priorFlag, next_flag: currentFlag, promotion_rule: rule }),
  };
}

// ---- cascade (§ 8) ----
export type Replay = { url_pattern: string; status?: number; body_json?: any; body_text?: string; simulate?: string };
type Attempt = { status: "ok" | "timeout" | "error"; error?: string; sample?: Obj };

function fetchReplay(url: string, responses: Replay[]): { kind: "timeout" | "transport" } | { kind: "ok"; status: number; body: string } {
  for (const e of responses) {
    if (!e || typeof e !== "object" || typeof e.url_pattern !== "string") continue;
    let hit = false;
    try { hit = new RegExp(e.url_pattern).test(url); } catch { hit = false; }
    if (!hit) continue;
    if (e.simulate === "timeout") return { kind: "timeout" };
    if (typeof e.status !== "number") return { kind: "transport" };
    const body = e.body_json !== undefined ? JSON.stringify(e.body_json) : typeof e.body_text === "string" ? e.body_text : "";
    return { kind: "ok", status: e.status, body };
  }
  return { kind: "transport" };
}

const present = (x: any) => x !== undefined && x !== null;
const isObj = (x: any) => typeof x === "object" && x !== null && !Array.isArray(x);

function attempt(url: string, responses: Replay[], parse: (b: any) => Attempt): Attempt {
  const r = fetchReplay(url, responses);
  if (r.kind === "timeout") return { status: "timeout", error: "timeout" };
  if (r.kind === "transport") return { status: "error", error: "transport_error" };
  if (r.status >= 400) return { status: "error", error: "http_" + r.status };
  let body: any;
  try { body = JSON.parse(r.body); } catch { return { status: "error", error: "parse_error" }; }
  return parse(body);
}

function mkSample(t: any, rh: any, wind: any, source: string): Obj {
  const s: Obj = { tempC: t, rhPercent: rh, source };
  if (present(wind)) s.windMps = wind / 3.6;
  return s;
}

function parseNws(b: any): Attempt {
  const p = isObj(b) ? b.properties : undefined;
  const g = (k: string) => (isObj(p) && isObj(p[k]) ? p[k].value : undefined);
  if (!present(g("temperature"))) return { status: "error", error: "missing_field:temperature" };
  if (!present(g("relativeHumidity"))) return { status: "error", error: "missing_field:relativeHumidity" };
  return { status: "ok", sample: mkSample(g("temperature"), g("relativeHumidity"), g("windSpeed"), "nws") };
}

function parseOpenMeteo(b: any): Attempt {
  const c = isObj(b) ? b.current : undefined;
  const g = (k: string) => (isObj(c) ? c[k] : undefined);
  if (!present(g("temperature_2m"))) return { status: "error", error: "missing_field:temperature_2m" };
  if (!present(g("relative_humidity_2m"))) return { status: "error", error: "missing_field:relative_humidity_2m" };
  return { status: "ok", sample: mkSample(g("temperature_2m"), g("relative_humidity_2m"), g("wind_speed_10m"), "open-meteo") };
}

export function cascade(lat: number, lng: number, iso: string | undefined, responses: Replay[], clock: string): Out {
  const inputs: Obj = { lat: numIn(lat), lng: numIn(lng) };
  if (iso !== undefined) inputs.isoTimestamp = iso;
  const sources = [
    { name: "nws", cite: "api.weather.gov", constKey: "nws_timeout_ms", parse: parseNws,
      url: `https://api.weather.gov/points/${lat},${lng}/observations/latest` },
    { name: "open-meteo", cite: "api.open-meteo.com", constKey: "open_meteo_timeout_ms", parse: parseOpenMeteo,
      url: `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m` },
  ];
  const children: Obj[] = [], tried: Obj[] = [], chain: string[] = [];
  let sample: Obj | null = null;
  let firstAttempt: Attempt | null = null;
  for (const s of sources) {
    chain.push(s.name);
    const a = attempt(s.url, responses, s.parse);
    if (firstAttempt === null) firstAttempt = a;
    const t: Obj = { source: s.name, status: a.status, duration_ms: a.status === "timeout" ? 5000 : 0 };
    if (a.status !== "ok") t.error = a.error;
    tried.push(t);
    const summary = a.status === "ok" ? `${s.name} OK in 0ms` : a.status === "timeout" ? `${s.name} timeout` : `${s.name} ${a.error}`;
    children.push(audit("fetchWeatherCascade." + s.name, { ...inputs }, { [s.constKey]: 5000 }, s.cite, summary, clock));
    if (a.status === "ok") { sample = a.sample!; break; }
  }
  const constants: Obj = { nws_timeout_ms: 5000, open_meteo_timeout_ms: 5000 };
  const extra: Obj = { source_chain: chain, sources_tried: tried, children };
  let summary: string;
  if (sample === null) {
    chain.push("simulated");
    sample = { tempC: 20, rhPercent: 50, source: "simulated" };
    constants.simulated_temp_c = 20; constants.simulated_rh_percent = 50;
    extra.fallback_reason = "all_live_sources_failed";
    summary = "cascade → simulated (all_live_sources_failed)";
  } else if (sample.source === "nws") {
    summary = `cascade → nws OK (tempC=${sample.tempC}, rhPercent=${sample.rhPercent})`;
  } else {
    const e = firstAttempt!.error!;
    const text = e === "timeout" ? "nws timeout" : e.startsWith("missing_field:") ? "nws missing fields" : "nws " + e;
    extra.fallback_reason = text;
    summary = `cascade → open-meteo OK (tempC=${sample.tempC}, rhPercent=${sample.rhPercent}) after ${text}`;
  }
  return {
    result: { sample },
    audit: audit("fetchWeatherCascade", inputs, constants, "Cascade order: NWS → Open-Meteo → simulated", summary, clock, extra),
  };
}
