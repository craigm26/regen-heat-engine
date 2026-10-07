import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { handleLine } from "./lib/dispatch.ts";

const CLOCK = "2026-01-01T00:00:00.000Z";
function call(op: string, input: unknown, extra: Record<string, unknown> = {}) {
  const r = JSON.parse(handleLine(JSON.stringify({ id: "x", op, input, clock: CLOCK, ...extra })));
  if (typeof r.audit === "string") r.a = JSON.parse(r.audit);
  return r;
}
const summary = (r: any) => r.a.result_summary;

test("REQ-CJ canonical: numbers, keys, escapes", () => {
  const r = JSON.parse(handleLine('{"id":"c1","op":"canonical","input":{"value":{"b":[1,2.50,1e21,1e-7,-0,1e20],"a":null}}}'));
  assert.deepStrictEqual(r, { id: "c1", result: '{"a":null,"b":[1,2.5,1e+21,1e-7,0,100000000000000000000]}' });
  const s = JSON.parse(handleLine(JSON.stringify({ id: "c2", op: "canonical", input: { value: "a\u001f\"\\/\u007f\ud800" } })));
  assert.strictEqual(s.result, '"a\\u001f\\"\\\\/\u007f\\ud800"');
  const k = JSON.parse(handleLine(JSON.stringify({ id: "c3", op: "canonical", input: { value: { "￿": 1, "😀": 2 } } })));
  assert.strictEqual(k.result, '{"😀":2,"￿":1}');
});

test("REQ-CJ-002 fixed text via summaries", () => {
  assert.strictEqual(summary(call("wetBulb", { tempC: 20.25, rhPercent: 50 })).startsWith("T=20.3°C"), true);
  assert.strictEqual(summary(call("wetBulb", { tempC: -0.04, rhPercent: 50 })).startsWith("T=-0.0°C"), true);
});

test("REQ-WB wet bulb examples", () => {
  const a = call("wetBulb", { tempC: 20, rhPercent: 50 });
  assert.strictEqual(summary(a), "T=20.0°C RH=50% → Tw=13.70°C");
  assert.ok(Math.abs(a.result.wetBulbC - 13.699) < 0.01);
  assert.strictEqual(a.a.spec_version, "0.2.0");
  assert.strictEqual(a.a.computed_at, CLOCK);
  assert.strictEqual(summary(call("wetBulb", { tempC: 25, rhPercent: 120 })), "T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C");
  const c = call("wetBulb", { tempC: 60, rhPercent: 2.5 });
  assert.strictEqual(summary(c), "T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=25.97°C");
  assert.strictEqual(c.result.clampedRhPct, 5);
  assert.strictEqual(c.a.constants.rh_clamp_max, 100);
  assert.ok(!("clampedRhPct" in a.result));
  const n = call("wetBulb", { tempC: "NaN", rhPercent: "Infinity" });
  assert.strictEqual(n.result, null);
  assert.strictEqual(summary(n), "invalid_input:tempC");
  assert.strictEqual(n.a.inputs.rhPercent, "Infinity");
  assert.deepStrictEqual(n.a.constants, {});
  assert.strictEqual(summary(call("wetBulb", { tempC: 1, rhPercent: "-Infinity" })), "invalid_input:rhPercent");
  assert.ok(call("wetBulb", { tempC: 80, rhPercent: 50 }).result);
});

test("REQ-WB-005 wetBulbF", () => {
  const f = call("wetBulbF", { tempF: 68, rhPercent: 50 });
  assert.deepStrictEqual(f.result, call("wetBulb", { tempC: 20, rhPercent: 50 }).result);
  assert.strictEqual(f.a.function, "calculateWetBulb");
  assert.strictEqual(summary(call("wetBulbF", { tempF: "NaN", rhPercent: 50 })), "invalid_input:tempC");
});

test("REQ-FL flagF", () => {
  assert.strictEqual(call("flagF", { wetBulbF: 79.99 }).result.flag, "white");
  assert.deepStrictEqual(call("flagF", { wetBulbF: 80 }).result, { flag: "green", flagDartLabel: "moderate" });
  assert.strictEqual(call("flagF", { wetBulbF: 85 }).result.flag, "yellow");
  assert.strictEqual(call("flagF", { wetBulbF: 88 }).result.flag, "red");
  assert.strictEqual(call("flagF", { wetBulbF: 90 }).result.flagDartLabel, "critical");
  assert.strictEqual(summary(call("flagF", { wetBulbF: 85 })), "wetBulbF=85 → yellow");
  assert.strictEqual(summary(call("flagF", { wetBulbF: 250 })), "wetBulbF=250 → black (out_of_observed_range)");
  const n = call("flagF", { wetBulbF: "NaN" });
  assert.strictEqual(n.result, null);
  assert.strictEqual(summary(n), "invalid_input:wetBulbF");
  assert.deepStrictEqual(call("flagF", { wetBulbF: 85 }).a.constants, { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 });
});

test("REQ-FL flagC", () => {
  assert.strictEqual(call("flagC", { wetBulbC: 26.66666666666666 }).result.flag, "white");
  const r = call("flagC", { wetBulbC: 30 });
  assert.strictEqual(summary(r), "wetBulbC=30 → wetBulbF=86.0000 → yellow");
  assert.strictEqual(r.a.children.length, 1);
  assert.strictEqual(r.a.children[0].function, "flagFromWetBulbF");
  const n = call("flagC", { wetBulbC: "-Infinity" });
  assert.strictEqual(n.result, null);
  assert.strictEqual(n.a.children, undefined);
  assert.strictEqual(n.a.inputs.wetBulbC, "-Infinity");
});

test("REQ-WR work/rest", () => {
  const y = call("workRest", { flag: "yellow", acclimatized: true, workMinutesRequested: 60 });
  assert.deepStrictEqual(y.result, { workMinutes: 45, restMinutes: 15, cyclesUntilReassessRequired: 6, ceaseWork: false });
  assert.deepStrictEqual(y.a.constants, { yellow_work_acclim: 45, yellow_rest_acclim: 15, yellow_reassess_cycles: 6 });
  assert.strictEqual(summary(y), "yellow/acclim → 45w/15r, reassess after 6 cycles");
  const yu = call("workRest", { flag: "yellow", acclimatized: false, workMinutesRequested: 60 });
  assert.strictEqual(yu.a.constants.yellow_reassess_cycles_unacclim, 4);
  assert.strictEqual(summary(call("workRest", { flag: "black", acclimatized: true, workMinutesRequested: 5 })), "black/acclim → 10w/50r, reassess every cycle");
  assert.strictEqual(summary(call("workRest", { flag: "green", acclimatized: true, workMinutesRequested: 0 })), "green/acclim → 50w/10r (non_positive_work_window)");
  const c = call("workRest", { flag: "red", acclimatized: false, workMinutesRequested: -1 });
  assert.deepStrictEqual(c.result, { workMinutes: 0, restMinutes: 0, cyclesUntilReassessRequired: null, ceaseWork: true });
  assert.deepStrictEqual(c.a.constants, {});
  assert.strictEqual(summary(c), "red/unacclim → cease_work (non_positive_work_window)");
  assert.strictEqual(summary(call("workRest", { flag: "white", acclimatized: false, workMinutesRequested: 1 })), "white/unacclim → 50w/10r");
  const b = call("workRest", { flag: "pink", acclimatized: true, workMinutesRequested: "NaN" });
  assert.strictEqual(b.result, null);
  assert.strictEqual(summary(b), "invalid_input:flag");
  const w = call("workRest", { flag: "red", acclimatized: true, workMinutesRequested: "Infinity" });
  assert.strictEqual(summary(w), "invalid_input:workMinutesRequested");
  assert.strictEqual(w.a.inputs.workMinutesRequested, "Infinity");
});

test("REQ-VD verdict rules", () => {
  const v = (pv: any, pf: any, cf: any, alt = false) => {
    const input: any = { priorVerdict: pv, currentFlag: cf, hasAlternateAvailable: alt };
    if (pf !== undefined) input.priorFlag = pf;
    return call("verdict", input);
  };
  let r = v(null, null, "red");
  assert.deepStrictEqual(r.result, { verdict: "delay", changedFromPrior: false, promotionRule: "FIRST_RUN_DEFAULT" });
  assert.strictEqual(summary(r), "first run, red → delay");
  assert.strictEqual(v(null, undefined, "green").result.verdict, "go");
  r = v("delay", "red", "red");
  assert.strictEqual(summary(r), "no_change, red → delay (held)");
  assert.strictEqual(r.a.prior_flag, "red");
  assert.strictEqual(summary(v("go", "green", "green")), "no_change, green → go");
  r = v("delay", "red", "black", true);
  assert.deepStrictEqual(r.result, { verdict: "alternate", changedFromPrior: true, promotionRule: "ALTERNATE_AVAILABLE_AT_BLACK" });
  assert.strictEqual(summary(r), "red → black + alternate → alternate");
  r = v("go", "yellow", "red");
  assert.strictEqual(summary(r), "yellow → red, escalate to delay");
  assert.strictEqual(r.a.next_flag, "red");
  assert.strictEqual(r.a.promotion_rule, "ESCALATE_TO_DELAY_ON_RED_OR_BLACK");
  assert.strictEqual(v("delay", "red", "green").result.promotionRule, "DEESCALATE_TO_GO");
  assert.strictEqual(summary(v("delay", "red", "green")), "red → green, deescalate to go");
  r = v("go", undefined, "yellow");
  assert.strictEqual(summary(r), "null → yellow, deescalate to go");
  assert.strictEqual(r.result.changedFromPrior, false);
  assert.strictEqual(r.a.prior_flag, null);
  r = v("go", null, "red");
  assert.strictEqual(r.result.changedFromPrior, true);
});

test("REQ-VD-003 verdict invalid input order", () => {
  const mk = (pv: any, pf: any, cf: any) => call("verdict", { priorVerdict: pv, priorFlag: pf, currentFlag: cf, hasAlternateAvailable: false });
  let r = mk("zzz", "nope", "nope");
  assert.strictEqual(summary(r), "invalid_input:currentFlag");
  assert.strictEqual(r.result, null);
  assert.strictEqual(r.a.promotion_rule, undefined);
  assert.strictEqual(summary(mk("zzz", "nope", "red")), "invalid_input:priorVerdict");
  assert.strictEqual(summary(mk("go", "nope", "red")), "invalid_input:priorFlag");
});

const NWS = { url_pattern: "api\\.weather\\.gov/.*/observations/latest" };
const OM = { url_pattern: "api\\.open-meteo\\.com" };
const cas = (responses: unknown[], input: any = { lat: 40.5, lng: -74 }) => call("cascade", input, { responses });

test("REQ-CA nws success and wind conversion", () => {
  const r = cas([{ ...NWS, status: 200, body_json: { properties: { temperature: { value: 25 }, relativeHumidity: { value: 60 }, windSpeed: { value: 3.1 } } } }]);
  assert.deepStrictEqual(r.result, { sample: { tempC: 25, rhPercent: 60, source: "nws", windMps: 0.8611111111111112 } });
  assert.strictEqual(summary(r), "cascade → nws OK (tempC=25, rhPercent=60)");
  assert.deepStrictEqual(r.a.source_chain, ["nws"]);
  assert.deepStrictEqual(r.a.sources_tried, [{ source: "nws", status: "ok", duration_ms: 0 }]);
  assert.strictEqual(r.a.fallback_reason, undefined);
  assert.strictEqual(r.a.children[0].result_summary, "nws OK in 0ms");
  assert.deepStrictEqual(r.a.children[0].constants, { nws_timeout_ms: 5000 });
  assert.strictEqual(r.a.children[0].citation, "api.weather.gov");
  assert.deepStrictEqual(r.a.inputs, { lat: 40.5, lng: -74 });
});

test("REQ-CA fallbacks", () => {
  const omBody = { current: { temperature_2m: 18, relative_humidity_2m: 70, wind_speed_10m: 2.4 } };
  let r = cas([{ ...NWS, status: 200, body_json: { properties: { temperature: { value: null } } } }, { ...OM, status: 200, body_json: omBody }], { lat: 1, lng: 2, isoTimestamp: "t" });
  assert.strictEqual(summary(r), "cascade → open-meteo OK (tempC=18, rhPercent=70) after nws missing fields");
  assert.strictEqual(r.a.fallback_reason, "nws missing fields");
  assert.strictEqual(r.result.sample.windMps, 0.6666666666666666);
  assert.strictEqual(r.a.children[0].result_summary, "nws missing_field:temperature");
  assert.strictEqual(r.a.children[0].inputs.isoTimestamp, "t");
  assert.deepStrictEqual(r.a.sources_tried[0], { source: "nws", status: "error", duration_ms: 0, error: "missing_field:temperature" });
  r = cas([{ ...NWS, simulate: "timeout" }, { ...OM, status: 200, body_json: omBody }]);
  assert.strictEqual(r.a.fallback_reason, "nws timeout");
  assert.deepStrictEqual(r.a.sources_tried[0], { source: "nws", status: "timeout", duration_ms: 5000, error: "timeout" });
  r = cas([{ ...NWS, status: 500 }, { ...OM, status: 200, body_text: "{{" }]);
  assert.strictEqual(summary(r), "cascade → simulated (all_live_sources_failed)");
  assert.strictEqual(r.a.children[0].result_summary, "nws http_500");
  assert.strictEqual(r.a.children[1].result_summary, "open-meteo parse_error");
  assert.deepStrictEqual(r.a.source_chain, ["nws", "open-meteo", "simulated"]);
  assert.deepStrictEqual(r.a.constants, { nws_timeout_ms: 5000, open_meteo_timeout_ms: 5000, simulated_temp_c: 20, simulated_rh_percent: 50 });
  assert.deepStrictEqual(r.result, { sample: { tempC: 20, rhPercent: 50, source: "simulated" } });
  r = cas([]);
  assert.strictEqual(r.a.children[0].result_summary, "nws transport_error");
  assert.strictEqual(r.a.children[1].result_summary, "open-meteo transport_error");
  r = cas([{ ...NWS, status: 404 }, { ...OM, status: 200, body_json: { current: { temperature_2m: 1 } } }]);
  assert.strictEqual(r.a.children[1].result_summary, "open-meteo missing_field:relative_humidity_2m");
  r = cas([{ ...NWS, status: 404 }, { ...OM, status: 200, body_json: omBody }]);
  assert.strictEqual(r.a.fallback_reason, "nws http_404");
});

test("REQ-CA-001 first matching entry wins, URL uses number text", () => {
  const r = cas([{ url_pattern: "points/1e-7,2/", status: 500 }, { ...NWS, status: 200, body_json: { properties: { temperature: { value: 1 }, relativeHumidity: { value: 2 } } } }], { lat: 1e-7, lng: 2 });
  assert.strictEqual(r.a.children[0].result_summary, "nws http_500");
});

test("REQ-IF errors", () => {
  const e = (s: string) => JSON.parse(handleLine(s));
  assert.deepStrictEqual(e("[1]"), { id: null, error: "bad_request" });
  assert.deepStrictEqual(e("nope"), { id: null, error: "bad_request" });
  assert.deepStrictEqual(e('{"id":5,"op":"x"}'), { id: null, error: "bad_request" });
  assert.deepStrictEqual(e('{"id":"a","op":"zzz"}'), { id: "a", error: "unknown_op" });
  assert.deepStrictEqual(e('{"id":"a"}'), { id: "a", error: "unknown_op" });
  assert.deepStrictEqual(e('{"id":"a","op":"wetBulb"}'), { id: "a", error: "bad_request" });
  assert.deepStrictEqual(e('{"id":"a","op":"wetBulb","input":{"tempC":1,"rhPercent":2}}'), { id: "a", error: "bad_request" });
  assert.deepStrictEqual(e(`{"id":"a","op":"wetBulb","input":{"tempC":true,"rhPercent":2},"clock":"${CLOCK}"}`), { id: "a", error: "bad_request" });
  assert.deepStrictEqual(e(`{"id":"a","op":"wetBulb","input":{"tempC":"abc","rhPercent":2},"clock":"${CLOCK}"}`), { id: "a", error: "bad_request" });
  assert.deepStrictEqual(e(`{"id":"a","op":"workRest","input":{"flag":1,"acclimatized":true,"workMinutesRequested":1},"clock":"${CLOCK}"}`), { id: "a", error: "bad_request" });
  assert.deepStrictEqual(e(`{"id":"a","op":"workRest","input":{"flag":"red","acclimatized":1,"workMinutesRequested":1},"clock":"${CLOCK}"}`), { id: "a", error: "bad_request" });
  assert.deepStrictEqual(e(`{"id":"a","op":"cascade","input":{"lat":1,"lng":2},"clock":"${CLOCK}"}`), { id: "a", error: "bad_request" });
});

test("REQ-IF-002/003/006 driver process", () => {
  const input = [
    '{"id":"1","op":"wetBulb","input":{"tempC":2e1,"rhPercent":50.0},"clock":"' + CLOCK + '"}',
    "   ",
    "",
    "garbage\r",
    '{"id":"2","op":"canonical","input":{"value":1}}',
  ].join("\r\n") + "\n";
  const out = execFileSync(process.execPath, ["driver.ts"], { input }).toString("utf8");
  assert.ok(!out.includes("\r"));
  assert.ok(out.endsWith("\n"));
  const lines = out.split("\n").slice(0, -1);
  assert.strictEqual(lines.length, 3);
  const r = JSON.parse(lines[0]);
  assert.strictEqual(r.id, "1");
  assert.ok(r.audit.includes('"inputs":{"rhPercent":50,"tempC":20}'));
  assert.ok(r.audit.includes("T=20.0°C"));
  assert.deepStrictEqual(JSON.parse(lines[1]), { id: null, error: "bad_request" });
  assert.deepStrictEqual(JSON.parse(lines[2]), { id: "2", result: "1" });
});
