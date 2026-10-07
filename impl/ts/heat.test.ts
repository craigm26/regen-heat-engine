import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const CLOCK = "2026-01-01T00:00:00.000Z";

function run(reqs: any[], raw?: string): { lines: string[]; status: number | null; raw: Buffer } {
  const input = raw ?? reqs.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n";
  const p = spawnSync(process.execPath, [join(dir, "driver.ts")], { input, cwd: dir });
  const text = p.stdout.toString("utf8");
  return { lines: text.split("\n").slice(0, -1), status: p.status, raw: p.stdout };
}
function call(op: string, input: any, extra: any = {}): any {
  const { lines } = run([{ id: "x", op, input, clock: CLOCK, ...extra }]);
  assert.strictEqual(lines.length, 1);
  return JSON.parse(lines[0]);
}
function audit(r: any): any { return JSON.parse(r.audit); }

test("REQ-IF-002/003: ordering, blanks, LF, utf8, exit 0", () => {
  const r = run([
    { id: "1", op: "flagF", input: { wetBulbF: 85 }, clock: CLOCK }, "", "   ",
    { id: "2", op: "wetBulb", input: { tempC: 20, rhPercent: 50 }, clock: CLOCK },
  ]);
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(r.lines.map((l) => JSON.parse(l).id), ["1", "2"]);
  assert.ok(!r.raw.includes(13));
  assert.ok(r.raw.toString("utf8").includes("°C"));
  assert.ok(r.raw.includes(Buffer.from("°", "utf8")));
});

test("REQ-IF-004/006: clock echoed, numeric forms", () => {
  const r = run([`{"id":"a","op":"wetBulb","input":{"tempC":2e1,"rhPercent":50.0},"clock":"${CLOCK}"}`]);
  const a = audit(JSON.parse(r.lines[0]));
  assert.strictEqual(a.computed_at, CLOCK);
  assert.deepStrictEqual(a.inputs, { tempC: 20, rhPercent: 50 });
});

test("REQ-IF-005/007: errors", () => {
  const r = run([
    "not json", "[1]", { op: "wetBulb" }, { id: 5, op: "x" },
    { id: "a" }, { id: "b", op: "nope", input: 1 },
    { id: "c", op: "wetBulb", clock: CLOCK },
    { id: "d", op: "wetBulb", input: { tempC: true, rhPercent: 1 }, clock: CLOCK },
    { id: "e", op: "wetBulb", input: { tempC: "abc", rhPercent: 1 }, clock: CLOCK },
    { id: "f", op: "wetBulb", input: { tempC: 1, rhPercent: 1 } },
    { id: "g", op: "wetBulb", input: { tempC: 1 }, clock: CLOCK },
    { id: "h", op: "workRest", input: { flag: "red", acclimatized: 1, workMinutesRequested: 1 }, clock: CLOCK },
    { id: "i", op: "flagF", input: { wetBulbF: 1 } },
    { id: "j", op: "verdict", input: { priorVerdict: null, priorFlag: 3, currentFlag: "red", hasAlternateAvailable: true }, clock: CLOCK },
    { id: "k", op: "cascade", input: { lat: 1, lng: 2, isoTimestamp: null }, clock: CLOCK, responses: [] },
    { id: "l", op: "cascade", input: { lat: 1, lng: 2 }, clock: CLOCK },
  ]);
  const o = r.lines;
  assert.strictEqual(o[0], '{"error":"bad_request","id":null}');
  assert.strictEqual(o[1], '{"error":"bad_request","id":null}');
  assert.strictEqual(o[2], '{"error":"bad_request","id":null}');
  assert.strictEqual(o[3], '{"error":"bad_request","id":null}');
  assert.deepStrictEqual(JSON.parse(o[4]), { id: "a", error: "unknown_op" });
  assert.deepStrictEqual(JSON.parse(o[5]), { id: "b", error: "unknown_op" });
  for (let i = 6; i < o.length; i++) assert.strictEqual(JSON.parse(o[i]).error, "bad_request", String(i));
  assert.strictEqual(Object.keys(JSON.parse(o[6])).length, 2);
});

test("REQ-CJ-001..005: canonical", () => {
  const c = (value: any) => call("canonical", { value }, { clock: undefined }).result;
  assert.strictEqual(c({ b: [1, 2.5, 1e21], a: null }), '{"a":null,"b":[1,2.5,1e+21]}');
  assert.strictEqual(c(1e-7), "1e-7");
  assert.strictEqual(c(1e-6), "0.000001");
  assert.strictEqual(c(1e20), "100000000000000000000");
  assert.strictEqual(c(-0), "0");
  assert.strictEqual(c("a\"\\\b\f\n\r\t\u001f/\u007f\u2028"), '"a\\"\\\\\\b\\f\\n\\r\\t\\u001f/\u007f\u2028"');
  assert.strictEqual(c("NaN"), '"NaN"');
  // lone surrogate, via raw text
  const r = run([], '{"id":"s","op":"canonical","input":{"value":"\\ud800x\\ud83d\\ude00"}}\n');
  assert.strictEqual(JSON.parse(r.lines[0]).result, '"\\ud800x\u{1f600}"');
  // key order by code units: U+FFFF-range char sorts after surrogate pair
  const r2 = run([], '{"id":"s","op":"canonical","input":{"value":{"\\uffff":1,"\\ud83d\\ude00":2}}}\n');
  assert.strictEqual(JSON.parse(r2.lines[0]).result, '{"\u{1f600}":2,"\uffff":1}');
});

test("REQ-CJ-002: toFixed rules via summaries", () => {
  const s = (t: number) => audit(call("wetBulb", { tempC: t, rhPercent: 50 })).result_summary;
  assert.ok(s(20.25).startsWith("T=20.3°C"));
  assert.ok(s(-20.25).startsWith("T=-20.3°C"));
  assert.ok(s(-0.04).startsWith("T=-0.0°C"));
  assert.ok(s(-0).startsWith("T=0.0°C"));
});

test("REQ-WB-001..005: wet bulb", () => {
  let r = call("wetBulb", { tempC: 20, rhPercent: 50 });
  assert.ok(Math.abs(r.result.wetBulbC - 13.7) < 0.01);
  assert.strictEqual(r.result.clampedRhPct, undefined);
  let a = audit(r);
  assert.strictEqual(a.result_summary, "T=20.0°C RH=50% → Tw=13.70°C");
  assert.strictEqual(a.function, "calculateWetBulb");
  assert.strictEqual(a.citation, "Stull (2011) eq. 1");
  assert.deepStrictEqual(Object.keys(a.constants).sort(),
    ["stull_a", "stull_b", "stull_c", "stull_d", "stull_e", "stull_offset"]);
  assert.strictEqual(a.spec_version, "0.2.0");
  r = call("wetBulb", { tempC: 25, rhPercent: 120 });
  assert.strictEqual(r.result.clampedRhPct, 100);
  a = audit(r);
  assert.strictEqual(a.result_summary, "T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C");
  assert.strictEqual(a.constants.rh_clamp_min, 5);
  assert.strictEqual(a.constants.rh_clamp_max, 100);
  r = call("wetBulb", { tempC: 60, rhPercent: 2.5 });
  assert.strictEqual(audit(r).result_summary, "T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=25.97°C");
  r = call("wetBulb", { tempC: -30, rhPercent: 50 });
  assert.ok(r.result !== null);
  assert.ok(audit(r).result_summary.includes("(out_of_validity_range)"));
  // invalid
  r = call("wetBulb", { tempC: "NaN", rhPercent: "Infinity" });
  assert.strictEqual(r.result, null);
  a = audit(r);
  assert.deepStrictEqual(a.inputs, { tempC: "NaN", rhPercent: "Infinity" });
  assert.deepStrictEqual(a.constants, {});
  assert.strictEqual(a.result_summary, "invalid_input:tempC");
  assert.strictEqual(audit(call("wetBulb", { tempC: 1, rhPercent: "-Infinity" })).result_summary, "invalid_input:rhPercent");
  // wetBulbF
  const f = call("wetBulbF", { tempF: 68, rhPercent: 50 });
  const c = call("wetBulb", { tempC: 20, rhPercent: 50 });
  assert.deepStrictEqual(f, c);
  assert.strictEqual(audit(call("wetBulbF", { tempF: "NaN", rhPercent: 5 })).result_summary, "invalid_input:tempC");
});

test("REQ-FL-001..006: flags", () => {
  const f = (w: any) => call("flagF", { wetBulbF: w });
  assert.deepStrictEqual(f(79.99).result, { flag: "white", flagDartLabel: "low" });
  assert.deepStrictEqual(f(80).result, { flag: "green", flagDartLabel: "moderate" });
  assert.strictEqual(f(85).result.flag, "yellow");
  assert.strictEqual(f(88).result.flag, "red");
  assert.deepStrictEqual(f(90).result, { flag: "black", flagDartLabel: "critical" });
  let a = audit(f(85));
  assert.strictEqual(a.result_summary, "wetBulbF=85 → yellow");
  assert.strictEqual(a.citation, "USMC 6200.1E Table 3-1");
  assert.deepStrictEqual(a.constants, { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 });
  assert.strictEqual(audit(f(250)).result_summary, "wetBulbF=250 → black (out_of_observed_range)");
  assert.strictEqual(audit(f(-51)).result_summary, "wetBulbF=-51 → white (out_of_observed_range)");
  const n = f("NaN");
  assert.strictEqual(n.result, null);
  a = audit(n);
  assert.deepStrictEqual([a.inputs, a.constants, a.result_summary], [{ wetBulbF: "NaN" }, {}, "invalid_input:wetBulbF"]);

  const c = call("flagC", { wetBulbC: 26.66666666666666 });
  assert.strictEqual(c.result.flag, "white");
  const c30 = call("flagC", { wetBulbC: 30 });
  a = audit(c30);
  assert.strictEqual(a.function, "flagFromWetBulbC");
  assert.strictEqual(a.result_summary, "wetBulbC=30 → wetBulbF=86.0000 → yellow");
  assert.strictEqual(a.children.length, 1);
  assert.strictEqual(a.children[0].function, "flagFromWetBulbF");
  assert.strictEqual(a.children[0].inputs.wetBulbF, 86);
  const bad = call("flagC", { wetBulbC: "-Infinity" });
  assert.strictEqual(bad.result, null);
  a = audit(bad);
  assert.strictEqual(a.children, undefined);
  assert.strictEqual(a.result_summary, "invalid_input:wetBulbC");
  assert.deepStrictEqual(a.inputs, { wetBulbC: "-Infinity" });
});

test("REQ-WR-001..003: work/rest", () => {
  const w = (flag: string, acc: boolean, req = 60) => call("workRest", { flag, acclimatized: acc, workMinutesRequested: req });
  assert.deepStrictEqual(w("white", true).result, { workMinutes: 60, restMinutes: 0, cyclesUntilReassessRequired: null, ceaseWork: false });
  assert.deepStrictEqual(w("yellow", false).result, { workMinutes: 30, restMinutes: 30, cyclesUntilReassessRequired: 4, ceaseWork: false });
  assert.deepStrictEqual(w("red", false).result, { workMinutes: 0, restMinutes: 0, cyclesUntilReassessRequired: null, ceaseWork: true });
  assert.strictEqual(w("black", false).result.ceaseWork, true);
  assert.strictEqual(w("black", true).result.workMinutes, 10);
  assert.strictEqual(w("green", false, 1).result.restMinutes, 20);
  let a = audit(w("yellow", true));
  assert.deepStrictEqual(a.constants, { yellow_work_acclim: 45, yellow_rest_acclim: 15, yellow_reassess_cycles: 6 });
  assert.strictEqual(a.result_summary, "yellow/acclim → 45w/15r, reassess after 6 cycles");
  assert.strictEqual(a.citation, "USMC 6200.1E §3.2");
  assert.deepStrictEqual(audit(w("yellow", false)).constants,
    { yellow_work_unacclim: 30, yellow_rest_unacclim: 30, yellow_reassess_cycles_unacclim: 4 });
  assert.strictEqual(audit(w("black", true)).result_summary, "black/acclim → 10w/50r, reassess every cycle");
  assert.strictEqual(audit(w("green", true, 0)).result_summary, "green/acclim → 50w/10r (non_positive_work_window)");
  a = audit(w("red", false, -5));
  assert.deepStrictEqual(a.constants, {});
  assert.strictEqual(a.result_summary, "red/unacclim → cease_work (non_positive_work_window)");
  let r = w("purple", true, "NaN" as any);
  assert.strictEqual(r.result, null);
  assert.strictEqual(audit(r).result_summary, "invalid_input:flag");
  r = w("red", true, "NaN" as any);
  a = audit(r);
  assert.strictEqual(a.result_summary, "invalid_input:workMinutesRequested");
  assert.strictEqual(a.inputs.workMinutesRequested, "NaN");
  assert.deepStrictEqual(a.constants, {});
});

test("REQ-VD-001..003: verdict", () => {
  const v = (pv: any, pf: any, cf: string, alt = false) => {
    const input: any = { priorVerdict: pv, currentFlag: cf, hasAlternateAvailable: alt };
    if (pf !== undefined) input.priorFlag = pf;
    return call("verdict", input);
  };
  let r = v(null, null, "red");
  assert.deepStrictEqual(r.result, { verdict: "delay", changedFromPrior: false, promotionRule: "FIRST_RUN_DEFAULT" });
  assert.strictEqual(audit(r).result_summary, "first run, red → delay");
  assert.strictEqual(v(null, undefined, "green").result.verdict, "go");
  assert.deepStrictEqual(audit(v(null, undefined, "green")).inputs.priorFlag, null);
  r = v("delay", "red", "red");
  assert.deepStrictEqual(r.result, { verdict: "delay", changedFromPrior: false, promotionRule: "NO_CHANGE" });
  assert.strictEqual(audit(r).result_summary, "no_change, red → delay (held)");
  assert.strictEqual(audit(v("go", "green", "green")).result_summary, "no_change, green → go");
  r = v("go", "yellow", "black", true);
  assert.deepStrictEqual(r.result, { verdict: "alternate", changedFromPrior: true, promotionRule: "ALTERNATE_AVAILABLE_AT_BLACK" });
  let a = audit(r);
  assert.strictEqual(a.result_summary, "yellow → black + alternate → alternate");
  assert.deepStrictEqual([a.prior_flag, a.next_flag, a.promotion_rule], ["yellow", "black", "ALTERNATE_AVAILABLE_AT_BLACK"]);
  assert.strictEqual(a.citation, "Go/delay/alternate promotion matrix");
  r = v("delay", "red", "black");
  assert.deepStrictEqual(r.result, { verdict: "delay", changedFromPrior: false, promotionRule: "ESCALATE_TO_DELAY_ON_RED_OR_BLACK" });
  assert.strictEqual(audit(r).result_summary, "red → black, escalate to delay");
  r = v("delay", "red", "yellow");
  assert.deepStrictEqual(r.result, { verdict: "go", changedFromPrior: true, promotionRule: "DEESCALATE_TO_GO" });
  assert.strictEqual(audit(r).result_summary, "red → yellow, deescalate to go");
  // D-015
  r = v("go", null, "red");
  assert.strictEqual(r.result.promotionRule, "ESCALATE_TO_DELAY_ON_RED_OR_BLACK");
  assert.strictEqual(audit(r).result_summary, "null → red, escalate to delay");
  // invalid
  r = v("go", "bad", "bad");
  assert.strictEqual(r.result, null);
  a = audit(r);
  assert.strictEqual(a.result_summary, "invalid_input:currentFlag");
  assert.strictEqual(a.prior_flag, undefined);
  assert.deepStrictEqual(a.constants, {});
  assert.strictEqual(audit(v("maybe", "bad", "red")).result_summary, "invalid_input:priorVerdict");
  assert.strictEqual(audit(v("go", "bad", "red")).result_summary, "invalid_input:priorFlag");
});

const NWS = { url_pattern: "api\\.weather\\.gov/.*/observations/latest", status: 200,
  body_json: { properties: { temperature: { value: 22.5 }, relativeHumidity: { value: 40 }, windSpeed: { value: 3.1 } } } };
const OM = { url_pattern: "api\\.open-meteo\\.com", status: 200,
  body_json: { current: { temperature_2m: 18, relative_humidity_2m: 60, wind_speed_10m: 2.4 } } };
const casc = (responses: any[], input: any = { lat: 38.9, lng: -77.04 }) => call("cascade", input, { responses });

test("REQ-CA-001..007: cascade", () => {
  let r = casc([NWS, OM]);
  assert.deepStrictEqual(r.result, { sample: { tempC: 22.5, rhPercent: 40, source: "nws", windMps: 0.8611111111111112 } });
  let a = audit(r);
  assert.strictEqual(a.result_summary, "cascade → nws OK (tempC=22.5, rhPercent=40)");
  assert.strictEqual(a.fallback_reason, undefined);
  assert.deepStrictEqual(a.source_chain, ["nws"]);
  assert.deepStrictEqual(a.sources_tried, [{ source: "nws", status: "ok", duration_ms: 0 }]);
  assert.deepStrictEqual(a.constants, { nws_timeout_ms: 5000, open_meteo_timeout_ms: 5000 });
  assert.strictEqual(a.children[0].function, "fetchWeatherCascade.nws");
  assert.strictEqual(a.children[0].result_summary, "nws OK in 0ms");
  assert.deepStrictEqual(a.children[0].constants, { nws_timeout_ms: 5000 });
  assert.strictEqual(a.children[0].computed_at, CLOCK);
  assert.strictEqual(a.citation, "Cascade order: NWS → Open-Meteo → simulated");

  // timeout then open-meteo
  r = casc([{ url_pattern: "weather\\.gov", simulate: "timeout", status: 200 }, OM], { lat: 1, lng: 2, isoTimestamp: "t" });
  assert.deepStrictEqual(r.result.sample, { tempC: 18, rhPercent: 60, source: "open-meteo", windMps: 0.6666666666666666 });
  a = audit(r);
  assert.strictEqual(a.fallback_reason, "nws timeout");
  assert.strictEqual(a.result_summary, "cascade → open-meteo OK (tempC=18, rhPercent=60) after nws timeout");
  assert.deepStrictEqual(a.sources_tried, [
    { source: "nws", status: "timeout", duration_ms: 5000, error: "timeout" },
    { source: "open-meteo", status: "ok", duration_ms: 0 }]);
  assert.strictEqual(a.children[0].result_summary, "nws timeout");
  assert.deepStrictEqual(a.children[1].inputs, { lat: 1, lng: 2, isoTimestamp: "t" });

  // missing fields
  const miss = { ...NWS, body_json: { properties: { temperature: { value: null } } } };
  a = audit(casc([miss, OM]));
  assert.strictEqual(a.fallback_reason, "nws missing fields");
  assert.strictEqual(a.children[0].result_summary, "nws missing_field:temperature");
  a = audit(casc([{ ...NWS, body_json: { properties: { temperature: { value: 1 } } } }, OM]));
  assert.strictEqual(a.children[0].result_summary, "nws missing_field:relativeHumidity");

  // http error, parse error, transport; all fail -> simulated
  a = audit(casc([{ url_pattern: "weather", status: 500 }, OM]));
  assert.strictEqual(a.fallback_reason, "nws http_500");
  a = audit(casc([{ url_pattern: "weather", status: 200, body_text: "{oops" }, OM]));
  assert.strictEqual(a.fallback_reason, "nws parse_error");
  a = audit(casc([OM]));
  assert.strictEqual(a.fallback_reason, "nws transport_error");

  r = casc([{ url_pattern: "meteo", status: 200, body_json: { current: { temperature_2m: 1, relative_humidity_2m: null } } }]);
  assert.deepStrictEqual(r.result, { sample: { tempC: 20, rhPercent: 50, source: "simulated" } });
  a = audit(r);
  assert.deepStrictEqual(a.source_chain, ["nws", "open-meteo", "simulated"]);
  assert.strictEqual(a.fallback_reason, "all_live_sources_failed");
  assert.strictEqual(a.result_summary, "cascade → simulated (all_live_sources_failed)");
  assert.deepStrictEqual(a.constants, { nws_timeout_ms: 5000, open_meteo_timeout_ms: 5000, simulated_temp_c: 20, simulated_rh_percent: 50 });
  assert.strictEqual(a.sources_tried.length, 2);
  assert.strictEqual(a.children[1].result_summary, "open-meteo missing_field:relative_humidity_2m");
  assert.strictEqual(a.children[0].result_summary, "nws transport_error");

  // first matching entry wins; URL contents
  r = casc([{ url_pattern: "latitude=1e-7&longitude=0&", status: 200, body_json: OM.body_json }], { lat: 1e-7, lng: -0 });
  assert.strictEqual(r.result.sample.source, "open-meteo");
  // no wind -> no windMps
  r = casc([{ ...NWS, body_json: { properties: { temperature: { value: 1 }, relativeHumidity: { value: 2 }, windSpeed: { value: null } } } }]);
  assert.deepStrictEqual(r.result.sample, { tempC: 1, rhPercent: 2, source: "nws" });
});

test("REQ-AU-001/003: audit members only", () => {
  const a = audit(call("workRest", { flag: "white", acclimatized: true, workMinutesRequested: 1 }));
  assert.deepStrictEqual(Object.keys(a).sort(),
    ["citation", "computed_at", "constants", "function", "inputs", "result_summary", "spec_version"]);
});

test("REQ-IF-005: audit is canonical text", () => {
  const r = call("flagF", { wetBulbF: 85 });
  assert.strictEqual(r.audit,
    '{"citation":"USMC 6200.1E Table 3-1","computed_at":"2026-01-01T00:00:00.000Z","constants":{"green_max":85,"red_max":90,"white_max":80,"yellow_max":88},"function":"flagFromWetBulbF","inputs":{"wetBulbF":85},"result_summary":"wetBulbF=85 → yellow","spec_version":"0.2.0"}');
});
