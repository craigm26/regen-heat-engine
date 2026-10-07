import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { canonical } from "./canon.ts";
import { handle, run } from "./handler.ts";

const CLOCK = "2026-01-01T00:00:00.000Z";
const req = (op: string, input: any, extra: any = {}) =>
  handle(JSON.stringify({ id: "t", op, input, clock: CLOCK, ...extra }));
const aud = (r: any) => JSON.parse(r.audit);

test("REQ-IF-002/003 driver process: order, blank lines, LF, UTF-8, exit 0", () => {
  const input = `{"id":"1","op":"wetBulb","input":{"tempC":20,"rhPercent":50},"clock":"${CLOCK}"}\r\n\n   \nnot json\n`;
  const p = spawnSync("node", ["driver.ts"], { input });
  assert.equal(p.status, 0);
  const text = p.stdout.toString("utf8");
  assert.ok(!text.includes("\r"));
  const lines = text.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[2], "");
  assert.equal(JSON.parse(lines[0]).id, "1");
  assert.deepEqual(JSON.parse(lines[1]), { id: null, error: "bad_request" });
  assert.ok(JSON.parse(JSON.parse(lines[0]).audit).result_summary.includes("→"));
});

test("REQ-IF-004/005 clock injected, response shape", () => {
  const r = req("wetBulb", { tempC: 20, rhPercent: 50 });
  assert.deepEqual(Object.keys(r).sort(), ["audit", "id", "result"]);
  assert.equal(aud(r).computed_at, CLOCK);
});

test("REQ-IF-006 numbers and non-finite strings", () => {
  const a = handle(`{"id":"a","op":"wetBulb","input":{"tempC":2e1,"rhPercent":50.0},"clock":"${CLOCK}"}`);
  assert.deepEqual(aud(a).inputs, { tempC: 20, rhPercent: 50 });
  const b = req("wetBulb", { tempC: "-Infinity", rhPercent: 50 });
  assert.equal(b.result, null);
  assert.equal(aud(b).inputs.tempC, "-Infinity");
});

test("REQ-IF-007 errors", () => {
  assert.deepEqual(handle("[1]"), { id: null, error: "bad_request" });
  assert.deepEqual(handle('{"op":"x"}'), { id: null, error: "bad_request" });
  assert.deepEqual(handle('{"id":5}'), { id: null, error: "bad_request" });
  assert.deepEqual(handle('{"id":"a","op":"nope","input":5}'), { id: "a", error: "unknown_op" });
  assert.deepEqual(handle('{"id":"a","input":{}}'), { id: "a", error: "unknown_op" });
  assert.deepEqual(handle('{"id":"a","op":"wetBulb"}'), { id: "a", error: "bad_request" });
  assert.deepEqual(handle('{"id":"a","op":"wetBulb","input":{"tempC":1,"rhPercent":1}}'), { id: "a", error: "bad_request" });
  assert.equal(req("wetBulb", { tempC: 1 }).error, "bad_request");
  assert.equal(req("wetBulb", { tempC: true, rhPercent: 1 }).error, "bad_request");
  assert.equal(req("wetBulb", { tempC: "abc", rhPercent: 1 }).error, "bad_request");
  assert.equal(req("workRest", { flag: "red", acclimatized: 1, workMinutesRequested: 1 }).error, "bad_request");
  assert.equal(req("workRest", { flag: 3, acclimatized: true, workMinutesRequested: 1 }).error, "bad_request");
  assert.equal(req("cascade", { lat: 1, lng: 1 }).error, "bad_request");
  assert.equal(req("cascade", { lat: 1, lng: 1 }, { responses: {} }).error, "bad_request");
  assert.equal(run("\n \n"), "");
});

test("REQ-CJ-001/003/004/005 canonical", () => {
  const c = handle('{"id":"c1","op":"canonical","input":{"value":{"b":[1,2.50,1e21],"a":null}}}');
  assert.deepEqual(c, { id: "c1", result: '{"a":null,"b":[1,2.5,1e+21]}' });
  const nums = [5, 1.5, 0.1 + 0.2, 1e20, 1e21, 1e-6, 1e-7, 1.23e-18, -0];
  assert.equal(canonical(nums), "[5,1.5,0.30000000000000004,100000000000000000000,1e+21,0.000001,1e-7,1.23e-18,0]");
  assert.equal(canonical("a\"\\\b\f\n\r\t\u001f/\u007f \ud800😀"), '"a\\"\\\\\\b\\f\\n\\r\\t\\u001f/\u007f \\ud800😀"');
  assert.equal(canonical({ "": 1, "😀": 2 }), '{"😀":2,"":1}');
  assert.equal(canonical({ a: undefined, b: null }), '{"b":null}');
  assert.deepEqual(handle('{"id":"c","op":"canonical","input":{"value":"NaN"}}'), { id: "c", result: '"NaN"' });
  assert.equal(handle('{"id":"c","op":"canonical","input":{}}').error, "bad_request");
});

test("REQ-CJ-002 fixed text", () => {
  const r = (t: number) => aud(req("wetBulb", { tempC: t, rhPercent: 50 })).result_summary;
  assert.ok(r(20.25).startsWith("T=20.3°C"));
  assert.ok(r(-20.25).startsWith("T=-20.3°C"));
  assert.ok(r(-0.04).startsWith("T=-0.0°C"));
  assert.ok(r(-0).startsWith("T=0.0°C"));
});

test("REQ-AU-001/003 audit members and spec_version", () => {
  const a = aud(req("flagC", { wetBulbC: 30 }));
  assert.deepEqual(Object.keys(a).sort(), ["children", "citation", "computed_at", "constants", "function", "inputs", "result_summary", "spec_version"]);
  assert.equal(a.spec_version, "0.2.0");
  assert.equal(a.children[0].computed_at, CLOCK);
  const raw = req("flagC", { wetBulbC: 30 }).audit;
  assert.ok(raw.startsWith('{"children":[{"citation"'));
});

test("REQ-WB-001/003 wetBulb", () => {
  const r = req("wetBulb", { tempC: 20, rhPercent: 50 });
  assert.ok(Math.abs(r.result.wetBulbC - 13.699) < 0.01);
  assert.equal(r.result.clampedRhPct, undefined);
  assert.equal(aud(r).result_summary, "T=20.0°C RH=50% → Tw=13.70°C");
  assert.equal(aud(r).citation, "Stull (2011) eq. 1");
  assert.equal(aud(r).function, "calculateWetBulb");
  const c = req("wetBulb", { tempC: 25, rhPercent: 120 });
  assert.equal(c.result.clampedRhPct, 100);
  assert.equal(aud(c).result_summary, "T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C"); // spec example says 25.00; see CHOICES C-1
  assert.equal(aud(c).constants.rh_clamp_max, 100);
  const lo = req("wetBulb", { tempC: 60, rhPercent: 2.5 });
  assert.ok(aud(lo).result_summary.startsWith("T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw="));
});

test("REQ-WB-002 out of range temperature still computes", () => {
  const r = req("wetBulb", { tempC: -30, rhPercent: 50 });
  assert.ok(r.result.wetBulbC < 0);
  assert.ok(aud(r).result_summary.includes("(out_of_validity_range)"));
});

test("REQ-WB-004 invalid", () => {
  const r = req("wetBulb", { tempC: "NaN", rhPercent: "Infinity" });
  assert.equal(r.result, null);
  assert.equal(aud(r).result_summary, "invalid_input:tempC");
  assert.deepEqual(aud(r).constants, {});
  assert.deepEqual(aud(r).inputs, { tempC: "NaN", rhPercent: "Infinity" });
  assert.equal(aud(req("wetBulb", { tempC: 1, rhPercent: "NaN" })).result_summary, "invalid_input:rhPercent");
});

test("REQ-WB-005 wetBulbF", () => {
  const a = req("wetBulbF", { tempF: 68, rhPercent: 50 });
  const b = req("wetBulb", { tempC: 20, rhPercent: 50 });
  assert.deepEqual(a, b);
  assert.equal(aud(req("wetBulbF", { tempF: "NaN", rhPercent: 50 })).result_summary, "invalid_input:tempC");
});

test("REQ-FL-001/002/003 flagF", () => {
  const f = (w: any) => req("flagF", { wetBulbF: w });
  assert.equal(f(79.99).result.flag, "white");
  assert.deepEqual(f(80).result, { flag: "green", flagDartLabel: "moderate" });
  assert.equal(f(85).result.flag, "yellow");
  assert.equal(f(88).result.flag, "red");
  assert.equal(f(90).result.flagDartLabel, "critical");
  assert.equal(aud(f(85)).result_summary, "wetBulbF=85 → yellow");
  assert.equal(aud(f(250)).result_summary, "wetBulbF=250 → black (out_of_observed_range)");
  assert.deepEqual(aud(f(85)).constants, { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 });
  assert.equal(aud(f(85)).citation, "USMC 6200.1E Table 3-1");
  const bad = f("NaN");
  assert.equal(bad.result, null);
  assert.equal(aud(bad).result_summary, "invalid_input:wetBulbF");
  assert.deepEqual(aud(bad).constants, {});
});

test("REQ-FL-004/005/006 flagC", () => {
  assert.equal(req("flagC", { wetBulbC: 26.66666666666666 }).result.flag, "white");
  const r = req("flagC", { wetBulbC: 30 });
  assert.equal(aud(r).result_summary, "wetBulbC=30 → wetBulbF=86.0000 → yellow");
  assert.equal(aud(r).children.length, 1);
  assert.equal(aud(r).children[0].function, "flagFromWetBulbF");
  const bad = req("flagC", { wetBulbC: "-Infinity" });
  assert.equal(bad.result, null);
  assert.equal(aud(bad).children, undefined);
  assert.equal(aud(bad).result_summary, "invalid_input:wetBulbC");
});

test("REQ-WR-001/002 workRest", () => {
  const w = (flag: string, acc: boolean, m: any = 60) => req("workRest", { flag, acclimatized: acc, workMinutesRequested: m });
  assert.deepEqual(w("yellow", true).result, { workMinutes: 45, restMinutes: 15, cyclesUntilReassessRequired: 6, ceaseWork: false });
  assert.deepEqual(aud(w("yellow", true)).constants, { yellow_work_acclim: 45, yellow_rest_acclim: 15, yellow_reassess_cycles: 6 });
  assert.deepEqual(aud(w("yellow", false)).constants, { yellow_work_unacclim: 30, yellow_rest_unacclim: 30, yellow_reassess_cycles_unacclim: 4 });
  assert.equal(aud(w("yellow", false)).result_summary, "yellow/unacclim → 30w/30r, reassess after 4 cycles");
  assert.deepEqual(w("red", false).result, { workMinutes: 0, restMinutes: 0, cyclesUntilReassessRequired: null, ceaseWork: true });
  assert.deepEqual(aud(w("red", false)).constants, {});
  assert.equal(aud(w("black", false)).result_summary, "black/unacclim → cease_work");
  assert.equal(aud(w("black", true)).result_summary, "black/acclim → 10w/50r, reassess every cycle");
  assert.equal(aud(w("green", true, 0)).result_summary, "green/acclim → 50w/10r (non_positive_work_window)");
  assert.equal(aud(w("red", false, -1)).result_summary, "red/unacclim → cease_work (non_positive_work_window)");
  assert.equal(w("white", false).result.restMinutes, 10);
  assert.equal(aud(w("white", true)).citation, "USMC 6200.1E §3.2");
});

test("REQ-WR-003 workRest invalid", () => {
  const a = req("workRest", { flag: "purple", acclimatized: true, workMinutesRequested: "NaN" });
  assert.equal(a.result, null);
  assert.equal(aud(a).result_summary, "invalid_input:flag");
  assert.equal(aud(a).inputs.workMinutesRequested, "NaN");
  const b = req("workRest", { flag: "red", acclimatized: true, workMinutesRequested: "Infinity" });
  assert.equal(aud(b).result_summary, "invalid_input:workMinutesRequested");
  assert.deepEqual(aud(b).constants, {});
});

test("REQ-VD-001/002 verdict rules", () => {
  const v = (pv: any, pf: any, cf: string, alt = false) =>
    req("verdict", { priorVerdict: pv, ...(pf === undefined ? {} : { priorFlag: pf }), currentFlag: cf, hasAlternateAvailable: alt });
  let r = v(null, null, "red");
  assert.deepEqual(r.result, { verdict: "delay", changedFromPrior: false, promotionRule: "FIRST_RUN_DEFAULT" });
  assert.equal(aud(r).result_summary, "first run, red → delay");
  assert.equal(v(null, null, "yellow").result.verdict, "go");
  r = v("delay", "red", "red");
  assert.equal(r.result.promotionRule, "NO_CHANGE");
  assert.equal(aud(r).result_summary, "no_change, red → delay (held)");
  assert.equal(aud(v("go", "green", "green")).result_summary, "no_change, green → go");
  r = v("go", "red", "black", true);
  assert.deepEqual(r.result, { verdict: "alternate", changedFromPrior: true, promotionRule: "ALTERNATE_AVAILABLE_AT_BLACK" });
  assert.equal(aud(r).result_summary, "red → black + alternate → alternate");
  assert.equal(v("alternate", "black", "black", true).result.promotionRule, "NO_CHANGE");
  r = v("go", "yellow", "red");
  assert.equal(r.result.promotionRule, "ESCALATE_TO_DELAY_ON_RED_OR_BLACK");
  assert.equal(aud(r).result_summary, "yellow → red, escalate to delay");
  assert.equal(v("delay", "red", "black").result.changedFromPrior, false);
  r = v("delay", "red", "green");
  assert.deepEqual(r.result, { verdict: "go", changedFromPrior: true, promotionRule: "DEESCALATE_TO_GO" });
  assert.equal(aud(r).result_summary, "red → green, deescalate to go");
  assert.equal(aud(r).prior_flag, "red");
  assert.equal(aud(r).next_flag, "green");
  assert.equal(aud(r).promotion_rule, "DEESCALATE_TO_GO");
  assert.equal(aud(r).citation, "Go/delay/alternate promotion matrix");
  // missing priorFlag with a prior verdict skips NO_CHANGE
  r = v("go", undefined, "green");
  assert.equal(aud(r).result_summary, "null → green, deescalate to go");
  assert.equal(aud(r).prior_flag, null);
  assert.equal(aud(r).inputs.priorFlag, null);
});

test("REQ-VD-003 verdict invalid", () => {
  const v = (pv: any, pf: any, cf: string) => req("verdict", { priorVerdict: pv, priorFlag: pf, currentFlag: cf, hasAlternateAvailable: false });
  let r = v("bogus", "bogus", "bogus");
  assert.equal(r.result, null);
  assert.equal(aud(r).result_summary, "invalid_input:currentFlag");
  assert.equal(aud(r).prior_flag, undefined);
  assert.deepEqual(aud(r).constants, {});
  assert.equal(aud(v("bogus", "bogus", "red")).result_summary, "invalid_input:priorVerdict");
  assert.equal(aud(v("go", "bogus", "red")).result_summary, "invalid_input:priorFlag");
  assert.equal(aud(v(null, "bogus", "red")).result_summary, "invalid_input:priorFlag");
});

const nwsBody = (t: any, h: any, w?: any) => ({ properties: { temperature: { value: t }, relativeHumidity: { value: h }, ...(w === undefined ? {} : { windSpeed: { value: w } }) } });
const omBody = (t: any, h: any, w?: any) => ({ current: { temperature_2m: t, relative_humidity_2m: h, ...(w === undefined ? {} : { wind_speed_10m: w }) } });
const NWS = "api\\.weather\\.gov/.*/observations/latest";
const OM = "api\\.open-meteo\\.com";
const casc = (responses: any[], input: any = { lat: 38.5, lng: -77 }) => req("cascade", input, { responses });

test("REQ-CA-001/002/004/005/006/007 nws success", () => {
  const r = casc([{ url_pattern: NWS, status: 200, body_json: nwsBody(25, 60, 3.1) }]);
  assert.deepEqual(r.result, { sample: { tempC: 25, rhPercent: 60, source: "nws", windMps: 0.8611111111111112 } });
  const a = aud(r);
  assert.equal(a.result_summary, "cascade → nws OK (tempC=25, rhPercent=60)");
  assert.deepEqual(a.source_chain, ["nws"]);
  assert.deepEqual(a.sources_tried, [{ source: "nws", status: "ok", duration_ms: 0 }]);
  assert.equal(a.fallback_reason, undefined);
  assert.deepEqual(a.constants, { nws_timeout_ms: 5000, open_meteo_timeout_ms: 5000 });
  assert.equal(a.children.length, 1);
  assert.equal(a.children[0].result_summary, "nws OK in 0ms");
  assert.equal(a.children[0].function, "fetchWeatherCascade.nws");
  assert.equal(a.children[0].citation, "api.weather.gov");
  assert.deepEqual(a.children[0].constants, { nws_timeout_ms: 5000 });
  assert.deepEqual(a.inputs, { lat: 38.5, lng: -77 });
  assert.equal(a.citation, "Cascade order: NWS → Open-Meteo → simulated");
});

test("REQ-CA first matching entry wins; no wind omitted; isoTimestamp input", () => {
  const r = casc(
    [{ url_pattern: "weather", status: 200, body_json: nwsBody(1, 2) }, { url_pattern: NWS, status: 500 }],
    { lat: 1, lng: 2, isoTimestamp: "2026-01-01T00:00:00Z" },
  );
  assert.deepEqual(r.result.sample, { tempC: 1, rhPercent: 2, source: "nws" });
  assert.equal(aud(r).inputs.isoTimestamp, "2026-01-01T00:00:00Z");
  assert.equal(aud(r).children[0].inputs.isoTimestamp, "2026-01-01T00:00:00Z");
});

test("REQ-CA-003 fallbacks to open-meteo", () => {
  const om = { url_pattern: OM, status: 200, body_json: omBody(10, 20, 3.6) };
  const cases: [any, string, string, string][] = [
    [{ url_pattern: NWS, simulate: "timeout" }, "nws timeout", "timeout", "nws timeout"],
    [{ url_pattern: NWS, status: 500 }, "nws http_500", "http_500", "nws http_500"],
    [{ url_pattern: NWS, status: 200, body_text: "{bad" }, "nws parse_error", "parse_error", "nws parse_error"],
    [{ url_pattern: NWS, status: 200, body_json: nwsBody(null, 5) }, "nws missing_field:temperature", "missing_field:temperature", "nws missing fields"],
    [{ url_pattern: NWS, status: 200, body_json: nwsBody(5, null) }, "nws missing_field:relativeHumidity", "missing_field:relativeHumidity", "nws missing fields"],
    [{ url_pattern: NWS, status: 200, body_json: [] }, "nws missing_field:temperature", "missing_field:temperature", "nws missing fields"],
    [{ url_pattern: "zzz", status: 200 }, "nws transport_error", "transport_error", "nws transport_error"],
  ];
  for (const [entry, childSummary, err, fb] of cases) {
    const r = casc([entry, om]);
    const a = aud(r);
    assert.equal(r.result.sample.source, "open-meteo");
    assert.equal(r.result.sample.windMps, 1);
    assert.equal(a.children[0].result_summary, childSummary);
    assert.equal(a.sources_tried[0].error, err);
    assert.equal(a.sources_tried[0].duration_ms, err === "timeout" ? 5000 : 0);
    assert.equal(a.sources_tried[0].status, err === "timeout" ? "timeout" : "error");
    assert.equal(a.fallback_reason, fb);
    assert.equal(a.result_summary, `cascade → open-meteo OK (tempC=10, rhPercent=20) after ${fb}`);
    assert.deepEqual(a.source_chain, ["nws", "open-meteo"]);
    assert.equal(a.children[1].result_summary, "open-meteo OK in 0ms");
    assert.deepEqual(a.children[1].constants, { open_meteo_timeout_ms: 5000 });
  }
});

test("REQ-CA simulated fallback and open-meteo errors", () => {
  const r = casc([
    { url_pattern: NWS, status: 404 },
    { url_pattern: OM, status: 200, body_json: omBody(null, 5) },
  ]);
  assert.deepEqual(r.result, { sample: { tempC: 20, rhPercent: 50, source: "simulated" } });
  const a = aud(r);
  assert.equal(a.children[1].result_summary, "open-meteo missing_field:temperature_2m");
  assert.deepEqual(a.source_chain, ["nws", "open-meteo", "simulated"]);
  assert.equal(a.fallback_reason, "all_live_sources_failed");
  assert.equal(a.result_summary, "cascade → simulated (all_live_sources_failed)");
  assert.equal(a.constants.simulated_temp_c, 20);
  assert.equal(a.constants.simulated_rh_percent, 50);
  const b = aud(casc([{ url_pattern: OM, status: 200, body_json: omBody(5, null) }, ]));
  assert.equal(b.children[1].result_summary, "open-meteo missing_field:relative_humidity_2m");
  const c = aud(casc([{ url_pattern: ".", simulate: "timeout" }]));
  assert.deepEqual(c.sources_tried.map((s: any) => s.duration_ms), [5000, 5000]);
  assert.equal(c.children[1].result_summary, "open-meteo timeout");
  const d = aud(casc([]));
  assert.equal(d.children[0].result_summary, "nws transport_error");
});

test("REQ-CA-002 request URLs use number text", () => {
  // pattern only matches when lat/lng are written as number text
  const r = casc([{ url_pattern: "points/1e-7,-0\\.5/", status: 200, body_json: nwsBody(1, 2) }], { lat: 1e-7, lng: -0.5 });
  assert.equal(r.result.sample.source, "nws");
  const o = casc([{ url_pattern: "latitude=0\\.5&longitude=2&current=temperature_2m,relative_humidity_2m,wind_speed_10m$", status: 200, body_json: omBody(1, 2) }], { lat: 0.5, lng: 2 });
  assert.equal(o.result.sample.source, "open-meteo");
});
