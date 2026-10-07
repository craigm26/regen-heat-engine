import json
import subprocess
import sys
import unittest

import heat

CLK = "2026-01-01T00:00:00.000Z"


def run(reqs, raw=None):
    data = raw if raw is not None else "".join(json.dumps(r) + "\n" for r in reqs)
    p = subprocess.run([sys.executable, "driver.py"], input=data.encode("utf-8"), capture_output=True)
    assert p.returncode == 0
    return p.stdout


def one(op, inp, **kw):
    r = {"id": "x", "op": op, "input": inp, "clock": CLK}
    r.update(kw)
    out = heat.handle(json.dumps(r))
    if "audit" in out:
        out["a"] = json.loads(out["audit"])
    return out


class Numbers(unittest.TestCase):  # REQ-CJ-001..005
    def test_num_text(self):
        for x, t in [(5, "5"), (1.5, "1.5"), (0.1 + 0.2, "0.30000000000000004"), (1e20, "100000000000000000000"),
                     (1e21, "1e+21"), (1e-6, "0.000001"), (1e-7, "1e-7"), (1.23e-18, "1.23e-18"), (-0.0, "0"),
                     (-2.5, "-2.5"), (123456789.125, "123456789.125")]:
            self.assertEqual(heat.num_text(x), t)

    def test_fixed(self):
        for x, f, t in [(20.25, 1, "20.3"), (-20.25, 1, "-20.3"), (2.675, 2, "2.67"), (0.125, 2, "0.13"),
                        (-0.04, 1, "-0.0"), (-0.0, 1, "0.0"), (1e21, 2, "1e+21"), (86, 4, "86.0000")]:
            self.assertEqual(heat.fixed(x, f), t)

    def test_canonical(self):
        r = heat.handle('{"id":"c1","op":"canonical","input":{"value":{"b":[1,2.50,1e21],"a":null}}}')
        self.assertEqual(r, {"id": "c1", "result": '{"a":null,"b":[1,2.5,1e+21]}'})
        self.assertNotIn("audit", r)

    def test_escapes(self):
        v = "\"\\\b\f\n\r\t\x1f/\x7f\u2028\U0001F600"
        r = heat.handle(json.dumps({"id": "c", "op": "canonical", "input": {"value": v}}))
        self.assertEqual(r["result"], '"\\"\\\\\\b\\f\\n\\r\\t\\u001f/\x7f\u2028\U0001F600"')
        r = heat.handle('{"id":"c","op":"canonical","input":{"value":"\\ud800x"}}')
        self.assertEqual(r["result"], '"\\ud800x"')

    def test_key_order_utf16(self):
        r = heat.handle(json.dumps({"id": "c", "op": "canonical", "input": {"value": {"\uffee": 1, "\U0001F600": 2}}}))
        self.assertEqual(r["result"], '{"\U0001F600":2,"\uffee":1}')

    def test_numbers_same(self):
        r = heat.handle('{"id":"c","op":"canonical","input":{"value":[20,20.0,2e1]}}')
        self.assertEqual(r["result"], "[20,20,20]")


class WetBulb(unittest.TestCase):
    def test_examples(self):
        for t, rh, s in [(20, 50, "T=20.0°C RH=50% → Tw=13.70°C"),
                         (25, 120, "T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C"),
                         (60, 2.5, "T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=25.97°C")]:
            o = one("wetBulb", {"tempC": t, "rhPercent": rh})
            self.assertEqual(o["a"]["result_summary"], s)

    def test_result_and_clamp(self):
        o = one("wetBulb", {"tempC": 20, "rhPercent": 50})
        self.assertAlmostEqual(o["result"]["wetBulbC"], 13.7, delta=0.01)
        self.assertNotIn("clampedRhPct", o["result"])
        self.assertEqual(o["a"]["constants"]["stull_offset"], -4.686035)
        o = one("wetBulb", {"tempC": 25, "rhPercent": 120})
        self.assertEqual(o["result"]["clampedRhPct"], 100)
        self.assertEqual(o["a"]["constants"]["rh_clamp_max"], 100)
        self.assertEqual(o["a"]["inputs"]["rhPercent"], 120)
        o = one("wetBulb", {"tempC": 80, "rhPercent": 50})  # no T clamp
        self.assertIsNotNone(o["result"])
        self.assertIn("out_of_validity_range", o["a"]["result_summary"])

    def test_invalid(self):
        o = one("wetBulb", {"tempC": "NaN", "rhPercent": "Infinity"})
        self.assertIsNone(o["result"])
        self.assertEqual(o["a"]["result_summary"], "invalid_input:tempC")
        self.assertEqual(o["a"]["inputs"], {"tempC": "NaN", "rhPercent": "Infinity"})
        self.assertEqual(o["a"]["constants"], {})
        o = one("wetBulb", {"tempC": 1, "rhPercent": "-Infinity"})
        self.assertEqual(o["a"]["result_summary"], "invalid_input:rhPercent")

    def test_f(self):
        a = one("wetBulbF", {"tempF": 68, "rhPercent": 50})
        b = one("wetBulb", {"tempC": 20, "rhPercent": 50})
        self.assertEqual(a["audit"], b["audit"])
        self.assertEqual(a["result"], b["result"])
        self.assertEqual(one("wetBulbF", {"tempF": "NaN", "rhPercent": 5})["a"]["result_summary"], "invalid_input:tempC")


class Flags(unittest.TestCase):
    def test_bands(self):
        for w, f in [(79.99, "white"), (80, "green"), (84.9, "green"), (85, "yellow"), (88, "red"), (90, "black")]:
            self.assertEqual(one("flagF", {"wetBulbF": w})["result"]["flag"], f)
        self.assertEqual(one("flagF", {"wetBulbF": 85})["result"], {"flag": "yellow", "flagDartLabel": "high"})

    def test_audit(self):
        a = one("flagF", {"wetBulbF": 250})["a"]
        self.assertEqual(a["result_summary"], "wetBulbF=250 → black (out_of_observed_range)")
        self.assertEqual(a["constants"], {"white_max": 80, "green_max": 85, "yellow_max": 88, "red_max": 90})
        self.assertEqual(a["citation"], "USMC 6200.1E Table 3-1")
        o = one("flagF", {"wetBulbF": "NaN"})
        self.assertIsNone(o["result"])
        self.assertEqual(o["a"]["result_summary"], "invalid_input:wetBulbF")

    def test_c(self):
        self.assertEqual(one("flagC", {"wetBulbC": 26.66666666666666})["result"]["flag"], "white")
        o = one("flagC", {"wetBulbC": 30})
        self.assertEqual(o["a"]["result_summary"], "wetBulbC=30 → wetBulbF=86.0000 → yellow")
        self.assertEqual(len(o["a"]["children"]), 1)
        self.assertEqual(o["a"]["children"][0]["function"], "flagFromWetBulbF")
        o = one("flagC", {"wetBulbC": "-Infinity"})
        self.assertIsNone(o["result"])
        self.assertNotIn("children", o["a"])
        self.assertEqual(o["a"]["result_summary"], "invalid_input:wetBulbC")


class WorkRest(unittest.TestCase):
    def wr(self, flag, acc, w=60):
        return one("workRest", {"flag": flag, "acclimatized": acc, "workMinutesRequested": w})

    def test_table(self):
        o = self.wr("yellow", True)
        self.assertEqual(o["result"], {"workMinutes": 45, "restMinutes": 15, "cyclesUntilReassessRequired": 6,
                                       "ceaseWork": False})
        self.assertEqual(o["a"]["constants"], {"yellow_work_acclim": 45, "yellow_rest_acclim": 15,
                                               "yellow_reassess_cycles": 6})
        o = self.wr("red", False)
        self.assertEqual(o["result"], {"workMinutes": 0, "restMinutes": 0, "cyclesUntilReassessRequired": None,
                                       "ceaseWork": True})
        self.assertEqual(o["a"]["constants"], {})
        self.assertEqual(o["a"]["result_summary"], "red/unacclim → cease_work")
        self.assertEqual(self.wr("yellow", False)["a"]["constants"]["yellow_reassess_cycles_unacclim"], 4)

    def test_summaries(self):
        self.assertEqual(self.wr("black", True)["a"]["result_summary"], "black/acclim → 10w/50r, reassess every cycle")
        self.assertEqual(self.wr("green", True, 0)["a"]["result_summary"],
                         "green/acclim → 50w/10r (non_positive_work_window)")
        self.assertEqual(self.wr("yellow", False)["a"]["result_summary"], "yellow/unacclim → 30w/30r, reassess after 4 cycles")
        self.assertEqual(self.wr("white", False, -1)["result"]["workMinutes"], 50)

    def test_invalid(self):
        o = self.wr("purple", True, "NaN")
        self.assertIsNone(o["result"])
        self.assertEqual(o["a"]["result_summary"], "invalid_input:flag")
        o = self.wr("red", True, "Infinity")
        self.assertEqual(o["a"]["result_summary"], "invalid_input:workMinutesRequested")
        self.assertEqual(o["a"]["inputs"]["workMinutesRequested"], "Infinity")


class Verdict(unittest.TestCase):
    def v(self, pv, pf, cf, alt=False):
        inp = {"priorVerdict": pv, "currentFlag": cf, "hasAlternateAvailable": alt}
        if pf != "missing":
            inp["priorFlag"] = pf
        return one("verdict", inp)

    def test_rules(self):
        o = self.v(None, None, "red")
        self.assertEqual(o["result"], {"verdict": "delay", "changedFromPrior": False, "promotionRule": "FIRST_RUN_DEFAULT"})
        self.assertEqual(o["a"]["result_summary"], "first run, red → delay")
        self.assertEqual(self.v(None, None, "green")["result"]["verdict"], "go")
        o = self.v("delay", "red", "red")
        self.assertEqual(o["a"]["result_summary"], "no_change, red → delay (held)")
        self.assertEqual(self.v("go", "green", "green")["a"]["result_summary"], "no_change, green → go")
        o = self.v("go", "red", "black", True)
        self.assertEqual(o["result"]["verdict"], "alternate")
        self.assertTrue(o["result"]["changedFromPrior"])
        self.assertEqual(o["a"]["result_summary"], "red → black + alternate → alternate")
        o = self.v("delay", "red", "black", False)
        self.assertEqual(o["result"]["promotionRule"], "ESCALATE_TO_DELAY_ON_RED_OR_BLACK")
        self.assertFalse(o["result"]["changedFromPrior"])
        self.assertEqual(o["a"]["result_summary"], "red → black, escalate to delay")
        o = self.v("delay", "red", "green")
        self.assertEqual(o["result"]["verdict"], "go")
        self.assertEqual(o["a"]["result_summary"], "red → green, deescalate to go")
        self.assertEqual(o["a"]["prior_flag"], "red")
        self.assertEqual(o["a"]["next_flag"], "green")
        self.assertEqual(o["a"]["promotion_rule"], "DEESCALATE_TO_GO")
        self.assertEqual(o["a"]["citation"], "Go/delay/alternate promotion matrix")

    def test_null_prior_flag(self):
        o = self.v("go", "missing", "green")
        self.assertEqual(o["result"]["promotionRule"], "DEESCALATE_TO_GO")
        self.assertEqual(o["a"]["result_summary"], "null → green, deescalate to go")
        self.assertIsNone(o["a"]["prior_flag"])
        self.assertIsNone(o["a"]["inputs"]["priorFlag"])

    def test_invalid(self):
        for args, s in [(("go", "red", "pink"), "currentFlag"), (("stop", "pink", "red"), "priorVerdict"),
                        (("go", "pink", "red"), "priorFlag")]:
            o = self.v(*args)
            self.assertIsNone(o["result"])
            self.assertEqual(o["a"]["result_summary"], "invalid_input:" + s)
            self.assertEqual(o["a"]["constants"], {})
            self.assertNotIn("promotion_rule", o["a"])
            self.assertNotIn("next_flag", o["a"])


NWS = r"api\.weather\.gov/.*/observations/latest"
OM = r"api\.open-meteo\.com"


def nws_ok(**kw):
    return {"url_pattern": NWS, "status": 200, "body_json": {"properties": {
        "temperature": {"value": 30}, "relativeHumidity": {"value": 60}, "windSpeed": {"value": 3.1}}}, **kw}


def om_ok():
    return {"url_pattern": OM, "status": 200, "body_json": {"current": {
        "temperature_2m": 25, "relative_humidity_2m": 40, "wind_speed_10m": 2.4}}}


class Cascade(unittest.TestCase):
    def c(self, responses, **inp):
        i = {"lat": 35.5, "lng": -80}
        i.update(inp)
        return one("cascade", i, responses=responses)

    def test_nws(self):
        o = self.c([nws_ok()])
        self.assertEqual(o["result"], {"sample": {"tempC": 30, "rhPercent": 60, "source": "nws",
                                                  "windMps": 0.8611111111111112}})
        a = o["a"]
        self.assertNotIn("fallback_reason", a)
        self.assertEqual(a["source_chain"], ["nws"])
        self.assertEqual(a["sources_tried"], [{"source": "nws", "status": "ok", "duration_ms": 0}])
        self.assertEqual(a["result_summary"], "cascade → nws OK (tempC=30, rhPercent=60)")
        self.assertEqual(a["children"][0]["result_summary"], "nws OK in 0ms")
        self.assertEqual(a["children"][0]["constants"], {"nws_timeout_ms": 5000})
        self.assertEqual(a["constants"], {"nws_timeout_ms": 5000, "open_meteo_timeout_ms": 5000})

    def test_openmeteo_fallbacks(self):
        cases = [([{"url_pattern": NWS, "status": 500}, om_ok()], "nws http_500"),
                 ([{"url_pattern": NWS, "simulate": "timeout"}, om_ok()], "nws timeout"),
                 ([om_ok()], "nws transport_error"),
                 ([{"url_pattern": NWS, "status": 200, "body_text": "zzz"}, om_ok()], "nws parse_error"),
                 ([{"url_pattern": NWS, "status": 200, "body_json": {"properties": {"temperature": {"value": None}}}},
                   om_ok()], "nws missing fields")]
        for resp, fb in cases:
            o = self.c(resp, isoTimestamp="2026-01-01T00:00:00Z")
            a = o["a"]
            self.assertEqual(a["fallback_reason"], fb)
            self.assertEqual(a["result_summary"], "cascade → open-meteo OK (tempC=25, rhPercent=40) after " + fb)
            self.assertEqual(a["source_chain"], ["nws", "open-meteo"])
            self.assertEqual(len(a["children"]), 2)
            self.assertEqual(a["inputs"]["isoTimestamp"], "2026-01-01T00:00:00Z")
            self.assertEqual(a["children"][0]["inputs"], a["inputs"])
            self.assertAlmostEqual(o["result"]["sample"]["windMps"], 2.4 / 3.6)
            self.assertEqual(a["children"][1]["constants"], {"open_meteo_timeout_ms": 5000})
        o = self.c(cases[1][0])
        self.assertEqual(o["a"]["sources_tried"][0], {"source": "nws", "status": "timeout", "duration_ms": 5000,
                                                       "error": "timeout"})
        self.assertEqual(o["a"]["children"][0]["result_summary"], "nws timeout")
        o = self.c(cases[0][0])
        self.assertEqual(o["a"]["sources_tried"][0]["error"], "http_500")
        self.assertEqual(o["a"]["sources_tried"][0]["status"], "error")

    def test_simulated(self):
        o = self.c([{"url_pattern": OM, "status": 200, "body_json": {"current": {"temperature_2m": 1}}}])
        a = o["a"]
        self.assertEqual(o["result"], {"sample": {"tempC": 20, "rhPercent": 50, "source": "simulated"}})
        self.assertEqual(a["source_chain"], ["nws", "open-meteo", "simulated"])
        self.assertEqual(a["fallback_reason"], "all_live_sources_failed")
        self.assertEqual(a["result_summary"], "cascade → simulated (all_live_sources_failed)")
        self.assertEqual(a["constants"]["simulated_temp_c"], 20)
        self.assertEqual(a["sources_tried"][1]["error"], "missing_field:relative_humidity_2m")
        self.assertEqual(a["children"][1]["result_summary"], "open-meteo missing_field:relative_humidity_2m")

    def test_urls_first_match_and_number_text(self):
        resp = [{"url_pattern": r"points/1e-7,100000000000000000000/", "status": 200,
                 "body_json": {"properties": {"temperature": {"value": 1}, "relativeHumidity": {"value": 2}}}},
                nws_ok()]
        o = self.c(resp, lat=1e-7, lng=1e20)
        self.assertEqual(o["result"]["sample"]["tempC"], 1)
        self.assertNotIn("windMps", o["result"]["sample"])
        self.assertEqual(o["a"]["inputs"]["lat"], 1e-7)

    def test_every_record_has_clock_and_version(self):
        a = self.c([])["a"]
        for r in [a] + a["children"]:
            self.assertEqual(r["computed_at"], CLK)
            self.assertEqual(r["spec_version"], "0.2.0")
            self.assertEqual(set(r) - {"children", "source_chain", "sources_tried", "fallback_reason"},
                             {"spec_version", "function", "inputs", "constants", "citation", "result_summary",
                              "computed_at"})


class Driver(unittest.TestCase):
    def test_protocol(self):
        raw = ('{"id":"wb-001","op":"wetBulb","input":{"tempC":20,"rhPercent":50},"clock":"%s"}\n'
               '   \n\n'
               'not json\n'
               '{"id":5,"op":"wetBulb"}\n'
               '{"id":"u","op":"nope"}\n'
               '{"id":"b1","op":"wetBulb","input":{"tempC":true,"rhPercent":50},"clock":"%s"}\n'
               '{"id":"b2","op":"wetBulb","input":{"tempC":1},"clock":"%s"}\n'
               '{"id":"b3","op":"wetBulb","input":{"tempC":1,"rhPercent":1}}\n'
               '{"id":"b4","op":"verdict","input":{"priorVerdict":null,"priorFlag":3,"currentFlag":"red",'
               '"hasAlternateAvailable":false},"clock":"%s"}\n'
               '{"id":"b5","op":"workRest","input":{"flag":"red","acclimatized":1,"workMinutesRequested":1},"clock":"%s"}\n'
               '{"id":"b6","op":"cascade","input":{"lat":1,"lng":2},"clock":"%s"}\n'
               '{"id":"b7","op":"cascade","input":{"lat":1,"lng":2,"isoTimestamp":null},"clock":"%s","responses":[]}\n'
               '{"id":"c1","op":"canonical","input":{"value":"\\u00b0"}}\n') % ((CLK,) * 7)
        out = run(None, raw)
        self.assertNotIn(b"\r", out)
        self.assertTrue(out.endswith(b"\n"))
        lines = out.decode("utf-8").split("\n")[:-1]
        self.assertEqual(len(lines), 12)
        r = [json.loads(l) for l in lines]
        self.assertEqual(r[0]["id"], "wb-001")
        self.assertEqual(json.loads(r[0]["audit"])["result_summary"], "T=20.0°C RH=50% → Tw=13.70°C")
        self.assertEqual(r[1], {"id": None, "error": "bad_request"})
        self.assertEqual(r[2], {"id": None, "error": "bad_request"})
        self.assertEqual(r[3], {"id": "u", "error": "unknown_op"})
        for i in range(4, 11):
            self.assertEqual(r[i]["error"], "bad_request", i)
            self.assertEqual(set(r[i]), {"id", "error"})
        self.assertEqual(r[11], {"id": "c1", "result": '"°"'})

    def test_audit_bytes(self):
        out = run([{"id": "a", "op": "flagF", "input": {"wetBulbF": 85}, "clock": CLK}]).decode()
        audit = json.loads(out)["audit"]
        self.assertEqual(audit,
                         '{"citation":"USMC 6200.1E Table 3-1","computed_at":"%s","constants":{"green_max":85,'
                         '"red_max":90,"white_max":80,"yellow_max":88},"function":"flagFromWetBulbF",'
                         '"inputs":{"wetBulbF":85},"result_summary":"wetBulbF=85 → yellow","spec_version":"0.2.0"}' % CLK)

    def test_clock_echo_and_no_input_ok(self):
        out = run([{"id": "a", "op": "wetBulb", "input": {"tempC": 1, "rhPercent": 1}, "clock": "2030-05-06T07:08:09.123Z"}])
        self.assertIn("2030-05-06T07:08:09.123Z", json.loads(out)["audit"])


if __name__ == "__main__":
    unittest.main()
