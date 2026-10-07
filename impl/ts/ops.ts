// The operations of heat-engine (SPEC §§ 4-8). Each returns { result, audit }.
import { numText as nt, fixed } from "./canon.ts";

const SPEC_VERSION = "0.2.0";
const FLAGS = ["white", "green", "yellow", "red", "black"];

// Non-finite numbers are written as strings inside audits (REQ-AU-002).
export function aud(x: any): any {
  if (typeof x === "number" && !Number.isFinite(x)) return Number.isNaN(x) ? "NaN" : x > 0 ? "Infinity" : "-Infinity";
  return x;
}

function audit(fn: string, citation: string, inputs: any, constants: any, summary: string, clock: string, extra: any = {}): any {
  return { spec_version: SPEC_VERSION, function: fn, inputs, constants, citation, result_summary: summary, computed_at: clock, ...extra };
}

// ---- wet bulb ----
const WB_CIT = "Stull (2011) eq. 1";

export function wetBulb(i: any, clock: string): any {
  const T: number = i.tempC;
  const rhIn: number = i.rhPercent;
  const inputs = { tempC: aud(T), rhPercent: aud(rhIn) };
  if (!Number.isFinite(T) || !Number.isFinite(rhIn)) {
    const bad = !Number.isFinite(T) ? "tempC" : "rhPercent";
    return { result: null, audit: audit("calculateWetBulb", WB_CIT, inputs, {}, "invalid_input:" + bad, clock) };
  }
  const RH = rhIn < 5 ? 5 : rhIn > 100 ? 100 : rhIn;
  const term1 = T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659));
  const term2 = Math.atan(T + RH);
  const term3 = Math.atan(RH - 1.676331);
  const term4 = 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH);
  const wbC = term1 + term2 - term3 + term4 + -4.686035;
  const wbF = (wbC * 9) / 5 + 32;
  const clamped = RH !== rhIn;
  const result: any = { wetBulbC: wbC, wetBulbF: wbF };
  if (clamped) result.clampedRhPct = RH;
  const constants: any = { stull_a: 0.151977, stull_b: 8.313659, stull_c: 1.676331, stull_d: 0.00391838, stull_e: 0.023101, stull_offset: -4.686035 };
  if (clamped) { constants.rh_clamp_min = 5; constants.rh_clamp_max = 100; }
  const markers: string[] = [];
  if (clamped) markers.push("rh_clamped");
  if (T < -20 || T > 50) markers.push("out_of_validity_range");
  const rhText = clamped ? `${nt(rhIn)}→${nt(RH)}%` : `${nt(RH)}%`;
  const mk = markers.length ? ` (${markers.join(",")})` : "";
  const summary = `T=${fixed(T, 1)}°C RH=${rhText}${mk} → Tw=${fixed(wbC, 2)}°C`;
  return { result, audit: audit("calculateWetBulb", WB_CIT, inputs, constants, summary, clock) };
}

export function wetBulbFOp(i: any, clock: string): any {
  return wetBulb({ tempC: ((i.tempF - 32) * 5) / 9, rhPercent: i.rhPercent }, clock);
}

// ---- flags ----
const FL_CIT = "USMC 6200.1E Table 3-1";
const FL_CONST = { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 };

function classify(w: number): [string, string] {
  if (w < 80) return ["white", "low"];
  if (w < 85) return ["green", "moderate"];
  if (w < 88) return ["yellow", "high"];
  if (w < 90) return ["red", "extreme"];
  return ["black", "critical"];
}

export function flagF(i: any, clock: string): any {
  const w: number = i.wetBulbF;
  const inputs = { wetBulbF: aud(w) };
  if (!Number.isFinite(w)) return { result: null, audit: audit("flagFromWetBulbF", FL_CIT, inputs, {}, "invalid_input:wetBulbF", clock) };
  const [flag, label] = classify(w);
  const oor = w < -50 || w > 200 ? " (out_of_observed_range)" : "";
  return {
    result: { flag, flagDartLabel: label },
    audit: audit("flagFromWetBulbF", FL_CIT, inputs, { ...FL_CONST }, `wetBulbF=${nt(w)} → ${flag}${oor}`, clock),
  };
}

export function flagC(i: any, clock: string): any {
  const c: number = i.wetBulbC;
  const inputs = { wetBulbC: aud(c) };
  if (!Number.isFinite(c)) return { result: null, audit: audit("flagFromWetBulbC", FL_CIT, inputs, {}, "invalid_input:wetBulbC", clock) };
  const f = (c * 9) / 5 + 32;
  const inner = flagF({ wetBulbF: f }, clock);
  const summary = `wetBulbC=${nt(c)} → wetBulbF=${fixed(f, 4)} → ${inner.result.flag}`;
  return { result: inner.result, audit: audit("flagFromWetBulbC", FL_CIT, inputs, { ...FL_CONST }, summary, clock, { children: [inner.audit] }) };
}

// ---- work / rest ----
// [work, rest, reassess] per flag; acclimatized then unacclimatized; null = cease work
const WR: any = {
  white: [[60, 0, null], [50, 10, null]],
  green: [[50, 10, null], [40, 20, null]],
  yellow: [[45, 15, 6], [30, 30, 4]],
  red: [[30, 30, 4], null],
  black: [[10, 50, 1], null],
};

export function workRest(i: any, clock: string): any {
  const { flag, acclimatized, workMinutesRequested: req } = i;
  const inputs = { flag, acclimatized, workMinutesRequested: aud(req) };
  const cit = "USMC 6200.1E §3.2";
  if (!FLAGS.includes(flag)) return { result: null, audit: audit("workRestForFlag", cit, inputs, {}, "invalid_input:flag", clock) };
  if (!Number.isFinite(req)) return { result: null, audit: audit("workRestForFlag", cit, inputs, {}, "invalid_input:workMinutesRequested", clock) };
  const branch = acclimatized ? "acclim" : "unacclim";
  const cell = WR[flag][acclimatized ? 0 : 1];
  const tail = req <= 0 ? " (non_positive_work_window)" : "";
  if (!cell) {
    return {
      result: { workMinutes: 0, restMinutes: 0, cyclesUntilReassessRequired: null, ceaseWork: true },
      audit: audit("workRestForFlag", cit, inputs, {}, `${flag}/${branch} → cease_work${tail}`, clock),
    };
  }
  const [w, r, n] = cell;
  const constants: any = { [`${flag}_work_${branch}`]: w, [`${flag}_rest_${branch}`]: r };
  let summary = `${flag}/${branch} → ${w}w/${r}r`;
  if (n !== null) {
    constants[acclimatized ? `${flag}_reassess_cycles` : `${flag}_reassess_cycles_unacclim`] = n;
    summary += n === 1 ? ", reassess every cycle" : `, reassess after ${n} cycles`;
  }
  return {
    result: { workMinutes: w, restMinutes: r, cyclesUntilReassessRequired: n, ceaseWork: false },
    audit: audit("workRestForFlag", cit, inputs, constants, summary + tail, clock),
  };
}

// ---- verdict ----
export function verdict(i: any, clock: string): any {
  const { priorVerdict, currentFlag, hasAlternateAvailable } = i;
  const priorFlag = i.priorFlag === undefined ? null : i.priorFlag;
  const inputs = { priorVerdict, priorFlag, currentFlag, hasAlternateAvailable };
  const cit = "Go/delay/alternate promotion matrix";
  const bad = (n: string) => ({ result: null, audit: audit("promoteVerdict", cit, inputs, {}, "invalid_input:" + n, clock) });
  if (!FLAGS.includes(currentFlag)) return bad("currentFlag");
  if (priorVerdict !== null && !["go", "delay", "alternate"].includes(priorVerdict)) return bad("priorVerdict");
  if (priorFlag !== null && !FLAGS.includes(priorFlag)) return bad("priorFlag");
  const hot = currentFlag === "red" || currentFlag === "black";
  let rule: string, v: string, changed: boolean, summary: string;
  if (priorVerdict === null) {
    rule = "FIRST_RUN_DEFAULT"; v = hot ? "delay" : "go"; changed = false;
    summary = `first run, ${currentFlag} → ${v}`;
  } else if (priorFlag === currentFlag) {
    rule = "NO_CHANGE"; v = priorVerdict; changed = false;
    summary = `no_change, ${currentFlag} → ${v}` + (priorVerdict === "delay" ? " (held)" : "");
  } else if (currentFlag === "black" && hasAlternateAvailable) {
    rule = "ALTERNATE_AVAILABLE_AT_BLACK"; v = "alternate"; changed = priorVerdict !== v;
    summary = `${priorFlag} → ${currentFlag} + alternate → alternate`;
  } else if (hot) {
    rule = "ESCALATE_TO_DELAY_ON_RED_OR_BLACK"; v = "delay"; changed = priorVerdict !== v;
    summary = `${priorFlag} → ${currentFlag}, escalate to delay`;
  } else {
    rule = "DEESCALATE_TO_GO"; v = "go"; changed = priorVerdict !== v;
    summary = `${priorFlag} → ${currentFlag}, deescalate to go`;
  }
  return {
    result: { verdict: v, changedFromPrior: changed, promotionRule: rule },
    audit: audit("promoteVerdict", cit, inputs, {}, summary, clock, { prior_flag: priorFlag, next_flag: currentFlag, promotion_rule: rule }),
  };
}

// ---- cascade ----
function replay(responses: any[], url: string): any {
  for (const e of responses) {
    if (e === null || typeof e !== "object" || typeof e.url_pattern !== "string") continue;
    let re: RegExp;
    try { re = new RegExp(e.url_pattern); } catch { continue; }
    if (!re.test(url)) continue;
    if (e.simulate === "timeout") return { timeout: true };
    const body = "body_json" in e ? JSON.stringify(e.body_json) : typeof e.body_text === "string" ? e.body_text : "";
    return { status: typeof e.status === "number" ? e.status : 200, body };
  }
  return { transport: true };
}

const present = (x: any) => x !== undefined && x !== null;
const obj = (x: any) => (x !== null && typeof x === "object" && !Array.isArray(x) ? x : {});

function attempt(responses: any[], url: string, parse: (b: any) => any): any {
  const r = replay(responses, url);
  if (r.timeout) return { status: "timeout", error: "timeout" };
  if (r.transport) return { status: "error", error: "transport_error" };
  if (r.status >= 400) return { status: "error", error: "http_" + nt(r.status) };
  let body: any;
  try { body = JSON.parse(r.body); } catch { return { status: "error", error: "parse_error" }; }
  const p = parse(body);
  return p.error ? { status: "error", error: p.error } : { status: "ok", sample: p.sample };
}

function sampleOf(source: string, t: any, rh: any, wind: any): any {
  const s: any = { tempC: t, rhPercent: rh, source };
  if (present(wind) && typeof wind === "number") s.windMps = wind / 3.6;
  return s;
}

export function cascade(i: any, clock: string, responses: any[]): any {
  const { lat, lng, isoTimestamp } = i;
  const inputs: any = { lat: aud(lat), lng: aud(lng) };
  if (isoTimestamp !== undefined) inputs.isoTimestamp = isoTimestamp;
  const sources = [
    {
      name: "nws", cit: "api.weather.gov", cname: "nws_timeout_ms",
      url: `https://api.weather.gov/points/${nt(lat)},${nt(lng)}/observations/latest`,
      parse: (b: any) => {
        const p = obj(b).properties;
        const t = obj(obj(p).temperature).value, h = obj(obj(p).relativeHumidity).value;
        if (!present(t)) return { error: "missing_field:temperature" };
        if (!present(h)) return { error: "missing_field:relativeHumidity" };
        return { sample: sampleOf("nws", t, h, obj(obj(p).windSpeed).value) };
      },
    },
    {
      name: "open-meteo", cit: "api.open-meteo.com", cname: "open_meteo_timeout_ms",
      url: `https://api.open-meteo.com/v1/forecast?latitude=${nt(lat)}&longitude=${nt(lng)}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`,
      parse: (b: any) => {
        const c = obj(obj(b).current);
        if (!present(c.temperature_2m)) return { error: "missing_field:temperature_2m" };
        if (!present(c.relative_humidity_2m)) return { error: "missing_field:relative_humidity_2m" };
        return { sample: sampleOf("open-meteo", c.temperature_2m, c.relative_humidity_2m, c.wind_speed_10m) };
      },
    },
  ];
  const chain: string[] = [], tried: any[] = [], children: any[] = [];
  let sample: any = null, nwsError: string | null = null;
  for (const s of sources) {
    chain.push(s.name);
    const a = attempt(responses, s.url, s.parse);
    const entry: any = { source: s.name, status: a.status, duration_ms: a.status === "timeout" ? 5000 : 0 };
    if (a.status !== "ok") entry.error = a.error;
    tried.push(entry);
    const summary = a.status === "ok" ? `${s.name} OK in 0ms` : `${s.name} ${a.error}`;
    children.push(audit("fetchWeatherCascade." + s.name, s.cit, inputs, { [s.cname]: 5000 }, summary, clock));
    if (s.name === "nws") nwsError = a.error ?? null;
    if (a.status === "ok") { sample = a.sample; break; }
  }
  const constants: any = { nws_timeout_ms: 5000, open_meteo_timeout_ms: 5000 };
  let summary: string, fallback: string | undefined;
  if (sample === null) {
    chain.push("simulated");
    sample = { tempC: 20, rhPercent: 50, source: "simulated" };
    constants.simulated_temp_c = 20; constants.simulated_rh_percent = 50;
    fallback = "all_live_sources_failed";
    summary = "cascade → simulated (all_live_sources_failed)";
  } else {
    const base = `cascade → ${sample.source} OK (tempC=${nt(sample.tempC)}, rhPercent=${nt(sample.rhPercent)})`;
    if (sample.source === "nws") summary = base;
    else {
      const e = nwsError as string;
      fallback = e === "timeout" ? "nws timeout" : e.startsWith("missing_field:") ? "nws missing fields" : "nws " + e;
      summary = `${base} after ${fallback}`;
    }
  }
  return {
    result: { sample },
    audit: audit("fetchWeatherCascade", "Cascade order: NWS → Open-Meteo → simulated", inputs, constants, summary, clock, {
      source_chain: chain, sources_tried: tried, children, fallback_reason: fallback,
    }),
  };
}
