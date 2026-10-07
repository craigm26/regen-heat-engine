"""heat-engine: wet-bulb, heat flags, work/rest, verdicts, weather cascade, canonical JSON."""
import json
import math
import re
from decimal import Decimal
from fractions import Fraction

SPEC_VERSION = "0.2.0"
FLAGS = ("white", "green", "yellow", "red", "black")
LABELS = {"white": "low", "green": "moderate", "yellow": "high", "red": "extreme", "black": "critical"}
SPECIAL = {"NaN": float("nan"), "Infinity": float("inf"), "-Infinity": float("-inf")}


class BadRequest(Exception):
    pass


# ---------- number text and canonical JSON ----------

def num_text(x):
    x = float(x)
    if x != x:
        return "NaN"
    if x == 0:
        return "0"
    if x < 0:
        return "-" + num_text(-x)
    if x == math.inf:
        return "Infinity"
    sign, digits, exp = Decimal(repr(x)).as_tuple()
    s = "".join(map(str, digits))
    stripped = s.rstrip("0")
    exp += len(s) - len(stripped)
    s = stripped
    k = len(s)
    n = k + exp
    if k <= n <= 21:
        return s + "0" * (n - k)
    if 0 < n <= 21:
        return s[:n] + "." + s[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + s
    e = n - 1
    out = s[0] + ("." + s[1:] if k > 1 else "")
    return out + "e" + ("+" if e >= 0 else "-") + str(abs(e))


def fixed(x, f):
    if abs(x) >= 1e21:
        return num_text(x)
    if x < 0:
        return "-" + fixed(-x, f)
    m = math.floor(Fraction(x) * 10 ** f + Fraction(1, 2))
    t = str(m).rjust(f + 1, "0")
    return t[:-f] + "." + t[-f:]


def _esc(s):
    out = ['"']
    for ch in s:
        c = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif c in (8, 12, 10, 13, 9):
            out.append({8: "\\b", 12: "\\f", 10: "\\n", 13: "\\r", 9: "\\t"}[c])
        elif c < 0x20 or 0xD800 <= c <= 0xDFFF:
            out.append("\\u%04x" % c)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def canon(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        v = float(v)
        return num_text(v) if math.isfinite(v) else "null"
    if isinstance(v, str):
        return _esc(v)
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(canon(i) for i in v) + "]"
    keys = sorted((k for k in v if v[k] is not _ABSENT), key=lambda k: k.encode("utf-16-be", "surrogatepass"))
    return "{" + ",".join(_esc(k) + ":" + canon(v[k]) for k in keys) + "}"


_ABSENT = object()


# ---------- audit helpers ----------

def ninp(x):
    """Number as an audit input: non-finite becomes its string."""
    if isinstance(x, float) and not math.isfinite(x):
        return "NaN" if x != x else ("Infinity" if x > 0 else "-Infinity")
    return x


def audit(fn, inputs, constants, citation, summary, clock, **extra):
    a = {"spec_version": SPEC_VERSION, "function": fn, "inputs": inputs, "constants": constants,
         "citation": citation, "result_summary": summary, "computed_at": clock}
    a.update(extra)
    return a


# ---------- field extraction ----------

def f_num(inp, k):
    v = inp.get(k, _ABSENT)
    if isinstance(v, bool) or v is _ABSENT:
        raise BadRequest(k)
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str) and v in SPECIAL:
        return SPECIAL[v]
    raise BadRequest(k)


def f_str(inp, k, nullable=False, optional=False):
    v = inp.get(k, _ABSENT)
    if v is _ABSENT:
        if optional:
            return None
        raise BadRequest(k)
    if v is None and nullable:
        return None
    if not isinstance(v, str):
        raise BadRequest(k)
    return v


def f_bool(inp, k):
    v = inp.get(k, _ABSENT)
    if not isinstance(v, bool):
        raise BadRequest(k)
    return v


# ---------- wet bulb ----------

WB_CIT = "Stull (2011) eq. 1"


def wet_bulb(t, rh_in, clock):
    if not math.isfinite(t) or not math.isfinite(rh_in):
        bad = "tempC" if not math.isfinite(t) else "rhPercent"
        return None, audit("calculateWetBulb", {"tempC": ninp(t), "rhPercent": ninp(rh_in)}, {},
                           WB_CIT, "invalid_input:" + bad, clock)
    rh = min(max(rh_in, 5.0), 100.0)
    clamped = rh != rh_in
    term1 = t * math.atan(0.151977 * math.sqrt(rh + 8.313659))
    term2 = math.atan(t + rh)
    term3 = math.atan(rh - 1.676331)
    term4 = 0.00391838 * math.pow(rh, 1.5) * math.atan(0.023101 * rh)
    wc = term1 + term2 - term3 + term4 + (-4.686035)
    wf = (wc * 9) / 5 + 32
    res = {"wetBulbC": wc, "wetBulbF": wf}
    consts = {"stull_a": 0.151977, "stull_b": 8.313659, "stull_c": 1.676331,
              "stull_d": 0.00391838, "stull_e": 0.023101, "stull_offset": -4.686035}
    if clamped:
        res["clampedRhPct"] = rh
        consts["rh_clamp_min"] = 5
        consts["rh_clamp_max"] = 100
    markers = []
    if clamped:
        markers.append("rh_clamped")
    if t < -20 or t > 50:
        markers.append("out_of_validity_range")
    rh_txt = (num_text(rh_in) + "→" + num_text(rh) if clamped else num_text(rh)) + "%"
    mk = " (" + ",".join(markers) + ")" if markers else ""
    summ = "T=%s°C RH=%s%s → Tw=%s°C" % (fixed(t, 1), rh_txt, mk, fixed(wc, 2))
    return res, audit("calculateWetBulb", {"tempC": t, "rhPercent": rh_in}, consts, WB_CIT, summ, clock)


def op_wetbulb(inp, clock):
    return wet_bulb(f_num(inp, "tempC"), f_num(inp, "rhPercent"), clock)


def op_wetbulbf(inp, clock):
    tf = f_num(inp, "tempF")
    rh = f_num(inp, "rhPercent")
    return wet_bulb(((tf - 32) * 5) / 9, rh, clock)


# ---------- flags ----------

FL_CIT = "USMC 6200.1E Table 3-1"
FL_CONST = {"white_max": 80, "green_max": 85, "yellow_max": 88, "red_max": 90}


def classify(w):
    if w < 80:
        return "white"
    if w < 85:
        return "green"
    if w < 88:
        return "yellow"
    if w < 90:
        return "red"
    return "black"


def flag_f(w, clock):
    if not math.isfinite(w):
        return None, audit("flagFromWetBulbF", {"wetBulbF": ninp(w)}, {}, FL_CIT, "invalid_input:wetBulbF", clock)
    fl = classify(w)
    summ = "wetBulbF=%s → %s" % (num_text(w), fl)
    if w < -50 or w > 200:
        summ += " (out_of_observed_range)"
    return ({"flag": fl, "flagDartLabel": LABELS[fl]},
            audit("flagFromWetBulbF", {"wetBulbF": w}, dict(FL_CONST), FL_CIT, summ, clock))


def op_flagf(inp, clock):
    return flag_f(f_num(inp, "wetBulbF"), clock)


def op_flagc(inp, clock):
    c = f_num(inp, "wetBulbC")
    if not math.isfinite(c):
        return None, audit("flagFromWetBulbC", {"wetBulbC": ninp(c)}, {}, FL_CIT, "invalid_input:wetBulbC", clock)
    f = (c * 9) / 5 + 32
    res, child = flag_f(f, clock)
    if res is None:  # overflow (OPEN-FL-001): treat as extreme
        res, child = flag_f(1e300 if f > 0 else -1e300, clock)
    summ = "wetBulbC=%s → wetBulbF=%s → %s" % (num_text(c), fixed(f, 4) if math.isfinite(f) else num_text(f), res["flag"])
    return res, audit("flagFromWetBulbC", {"wetBulbC": c}, dict(FL_CONST), FL_CIT, summ, clock, children=[child])


# ---------- work/rest ----------

WR_TABLE = {
    "white": ((60, 0, None), (50, 10, None)),
    "green": ((50, 10, None), (40, 20, None)),
    "yellow": ((45, 15, 6), (30, 30, 4)),
    "red": ((30, 30, 4), None),
    "black": ((10, 50, 1), None),
}


def op_workrest(inp, clock):
    flag = f_str(inp, "flag")
    acc = f_bool(inp, "acclimatized")
    req = f_num(inp, "workMinutesRequested")
    cit = "USMC 6200.1E §3.2"
    if flag not in WR_TABLE:
        return None, audit("workRestForFlag", {"flag": flag, "acclimatized": acc, "workMinutesRequested": ninp(req)},
                           {}, cit, "invalid_input:flag", clock)
    if not math.isfinite(req):
        return None, audit("workRestForFlag", {"flag": flag, "acclimatized": acc, "workMinutesRequested": ninp(req)},
                           {}, cit, "invalid_input:workMinutesRequested", clock)
    inputs = {"flag": flag, "acclimatized": acc, "workMinutesRequested": req}
    branch = "acclim" if acc else "unacclim"
    cell = WR_TABLE[flag][0 if acc else 1]
    if cell is None:
        res = {"workMinutes": 0, "restMinutes": 0, "cyclesUntilReassessRequired": None, "ceaseWork": True}
        consts = {}
        summ = "%s/%s → cease_work" % (flag, branch)
    else:
        w, r, n = cell
        res = {"workMinutes": w, "restMinutes": r, "cyclesUntilReassessRequired": n, "ceaseWork": False}
        consts = {"%s_work_%s" % (flag, branch): w, "%s_rest_%s" % (flag, branch): r}
        if n is not None:
            consts[flag + ("_reassess_cycles" if acc else "_reassess_cycles_unacclim")] = n
        summ = "%s/%s → %dw/%dr" % (flag, branch, w, r)
        if n == 1:
            summ += ", reassess every cycle"
        elif n is not None:
            summ += ", reassess after %d cycles" % n
    if req <= 0:
        summ += " (non_positive_work_window)"
    return res, audit("workRestForFlag", inputs, consts, cit, summ, clock)


# ---------- verdict ----------

def op_verdict(inp, clock):
    pv = f_str(inp, "priorVerdict", nullable=True)
    pf = f_str(inp, "priorFlag", nullable=True, optional=True)
    cf = f_str(inp, "currentFlag")
    alt = f_bool(inp, "hasAlternateAvailable")
    inputs = {"priorVerdict": pv, "priorFlag": pf, "currentFlag": cf, "hasAlternateAvailable": alt}
    cit = "Go/delay/alternate promotion matrix"
    bad = None
    if cf not in FLAGS:
        bad = "currentFlag"
    elif pv is not None and pv not in ("go", "delay", "alternate"):
        bad = "priorVerdict"
    elif pf is not None and pf not in FLAGS:
        bad = "priorFlag"
    if bad:
        return None, audit("promoteVerdict", inputs, {}, cit, "invalid_input:" + bad, clock)
    hi = cf in ("red", "black")
    prior = "null" if pf is None else pf
    if pv is None:
        rule, v, ch = "FIRST_RUN_DEFAULT", ("delay" if hi else "go"), False
        summ = "first run, %s → %s" % (cf, v)
    elif pf == cf:
        rule, v, ch = "NO_CHANGE", pv, False
        summ = "no_change, %s → %s" % (cf, v) + (" (held)" if pv == "delay" else "")
    elif cf == "black" and alt:
        rule, v = "ALTERNATE_AVAILABLE_AT_BLACK", "alternate"
        ch = pv != v
        summ = "%s → %s + alternate → alternate" % (prior, cf)
    elif hi:
        rule, v = "ESCALATE_TO_DELAY_ON_RED_OR_BLACK", "delay"
        ch = pv != v
        summ = "%s → %s, escalate to delay" % (prior, cf)
    else:
        rule, v = "DEESCALATE_TO_GO", "go"
        ch = pv != v
        summ = "%s → %s, deescalate to go" % (prior, cf)
    return ({"verdict": v, "changedFromPrior": ch, "promotionRule": rule},
            audit("promoteVerdict", inputs, {}, cit, summ, clock, prior_flag=pf, next_flag=cf, promotion_rule=rule))


# ---------- cascade ----------

class Timeout(Exception):
    pass


class Transport(Exception):
    pass


def replay(responses, url):
    for e in responses:
        if not isinstance(e, dict) or not isinstance(e.get("url_pattern"), str):
            continue
        try:
            if not re.search(e["url_pattern"], url):
                continue
        except re.error:
            continue
        if e.get("simulate") == "timeout":
            raise Timeout()
        st = e.get("status")
        if isinstance(st, bool) or not isinstance(st, (int, float)):
            raise Transport()
        if "body_json" in e:
            body = json.dumps(e["body_json"])
        else:
            body = e.get("body_text", "")
            if not isinstance(body, str):
                body = ""
        return int(st), body
    raise Transport()


def _dig(o, *path):
    for p in path:
        if not isinstance(o, dict):
            return None
        o = o.get(p)
    return o


def _isnum(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def parse_sample(source, body):
    if source == "nws":
        t = _dig(body, "properties", "temperature", "value")
        h = _dig(body, "properties", "relativeHumidity", "value")
        w = _dig(body, "properties", "windSpeed", "value")
        names = ("temperature", "relativeHumidity")
    else:
        t = _dig(body, "current", "temperature_2m")
        h = _dig(body, "current", "relative_humidity_2m")
        w = _dig(body, "current", "wind_speed_10m")
        names = ("temperature_2m", "relative_humidity_2m")
    if not _isnum(t):
        return None, "missing_field:" + names[0]
    if not _isnum(h):
        return None, "missing_field:" + names[1]
    s = {"tempC": float(t), "rhPercent": float(h), "source": source}
    if _isnum(w):
        s["windMps"] = float(w) / 3.6
    return s, None


def attempt(source, url, responses):
    try:
        status, body = replay(responses, url)
    except Timeout:
        return None, "timeout"
    except Transport:
        return None, "transport_error"
    if status >= 400:
        return None, "http_%d" % status
    try:
        parsed = json.loads(body, parse_float=float, parse_int=float, parse_constant=_nc)
    except (ValueError, RecursionError):
        return None, "parse_error"
    return parse_sample(source, parsed)


def _nc(c):
    raise ValueError(c)


def op_cascade(inp, clock, responses):
    lat = f_num(inp, "lat")
    lng = f_num(inp, "lng")
    iso = f_str(inp, "isoTimestamp", optional=True)
    inputs = {"lat": ninp(lat), "lng": ninp(lng)}
    if iso is not None:
        inputs["isoTimestamp"] = iso
    urls = [
        ("nws", "https://api.weather.gov/points/%s,%s/observations/latest" % (num_text(lat), num_text(lng)),
         "api.weather.gov", {"nws_timeout_ms": 5000}),
        ("open-meteo", "https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s"
         "&current=temperature_2m,relative_humidity_2m,wind_speed_10m" % (num_text(lat), num_text(lng)),
         "api.open-meteo.com", {"open_meteo_timeout_ms": 5000}),
    ]
    children, tried, chain = [], [], []
    sample = None
    errors = {}
    for source, url, cit, consts in urls:
        chain.append(source)
        sample, err = attempt(source, url, responses)
        entry = {"source": source, "status": "ok" if sample else ("timeout" if err == "timeout" else "error"),
                 "duration_ms": 5000 if err == "timeout" else 0}
        if err:
            entry["error"] = err
            errors[source] = err
        tried.append(entry)
        summ = source + (" OK in 0ms" if sample else " " + err)
        children.append(audit("fetchWeatherCascade." + source, dict(inputs), consts, cit, summ, clock))
        if sample:
            break
    top_consts = {"nws_timeout_ms": 5000, "open_meteo_timeout_ms": 5000}
    extra = {}
    if sample is None:
        chain.append("simulated")
        sample = {"tempC": 20.0, "rhPercent": 50.0, "source": "simulated"}
        top_consts["simulated_temp_c"] = 20
        top_consts["simulated_rh_percent"] = 50
        extra["fallback_reason"] = "all_live_sources_failed"
        summ = "cascade → simulated (all_live_sources_failed)"
    else:
        base = "cascade → %s OK (tempC=%s, rhPercent=%s)" % (sample["source"], num_text(sample["tempC"]),
                                                              num_text(sample["rhPercent"]))
        if sample["source"] == "nws":
            summ = base
        else:
            e = errors["nws"]
            fb = "nws missing fields" if e.startswith("missing_field:") else "nws " + e
            extra["fallback_reason"] = fb
            summ = base + " after " + fb
    a = audit("fetchWeatherCascade", inputs, top_consts, "Cascade order: NWS → Open-Meteo → simulated", summ,
              clock, source_chain=chain, sources_tried=tried, children=children, **extra)
    return {"sample": sample}, a


# ---------- request handling ----------

OPS = {"wetBulb": op_wetbulb, "wetBulbF": op_wetbulbf, "flagF": op_flagf, "flagC": op_flagc,
       "workRest": op_workrest, "verdict": op_verdict, "cascade": None, "canonical": None}


def _no_const(c):
    raise ValueError(c)


def handle(line):
    try:
        req = json.loads(line, parse_float=float, parse_int=float, parse_constant=_no_const)
    except Exception:
        return {"id": None, "error": "bad_request"}
    if not isinstance(req, dict) or not isinstance(req.get("id"), str):
        return {"id": None, "error": "bad_request"}
    rid = req["id"]
    op = req.get("op")
    if not isinstance(op, str) or op not in OPS:
        return {"id": rid, "error": "unknown_op"}
    try:
        inp = req.get("input")
        if not isinstance(inp, dict):
            raise BadRequest("input")
        if op == "canonical":
            if "value" not in inp:
                raise BadRequest("value")
            return {"id": rid, "result": canon(inp["value"])}
        clock = req.get("clock")
        if not isinstance(clock, str):
            raise BadRequest("clock")
        if op == "cascade":
            resp = req.get("responses")
            if not isinstance(resp, list):
                raise BadRequest("responses")
            result, a = op_cascade(inp, clock, resp)
        else:
            result, a = OPS[op](inp, clock)
        return {"id": rid, "result": result, "audit": canon(a)}
    except BadRequest:
        return {"id": rid, "error": "bad_request"}
    except Exception:
        return {"id": rid, "error": "bad_request"}


def dumps(resp):
    return json.dumps(resp, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
