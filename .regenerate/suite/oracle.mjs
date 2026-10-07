// The spec restated as expectations. Written from SPEC.md, not from any implementation.
// Each function returns { result, audit } where audit is a plain object; canon() turns it
// into the canonical text of SPEC § 2.3. Number text (REQ-CJ-001) and fixed-point text
// (REQ-CJ-002) are, by definition, ECMAScript's String(n) and toFixed(f).

export const CONTRACT_VERSION = '0.2.0';

export const num = (x) => String(x); // REQ-CJ-001 (String(-0) === '0')
export const fixed = (x, f) => x.toFixed(f); // REQ-CJ-002

export function canon(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('oracle: non-finite number in canonical value');
    return num(v);
  }
  if (typeof v === 'string') return JSON.stringify(v); // JSON.stringify escapes exactly per REQ-CJ-004
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort(); // UTF-16 code unit order
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

const enc = (x) => (Number.isNaN(x) ? 'NaN' : x === Infinity ? 'Infinity' : x === -Infinity ? '-Infinity' : x);

function audit(fn, inputs, constants, citation, summary, clock, extras = {}) {
  return {
    spec_version: CONTRACT_VERSION,
    function: fn,
    inputs,
    constants,
    citation,
    result_summary: summary,
    computed_at: clock,
    ...extras,
  };
}

// ---- wet-bulb (SPEC § 4)
const STULL = { stull_a: 0.151977, stull_b: 8.313659, stull_c: 1.676331, stull_d: 0.00391838, stull_e: 0.023101, stull_offset: -4.686035 };
const WB_CITE = 'Stull (2011) eq. 1';

export function stull(T, RH) {
  const term1 = T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659));
  const term2 = Math.atan(T + RH);
  const term3 = Math.atan(RH - 1.676331);
  const term4 = 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH);
  return term1 + term2 - term3 + term4 + -4.686035;
}

export function wetBulb(tempC, rhPercent, clock) {
  if (!Number.isFinite(tempC) || !Number.isFinite(rhPercent)) {
    const bad = !Number.isFinite(tempC) ? 'tempC' : 'rhPercent';
    return { result: null, audit: audit('calculateWetBulb', { tempC: enc(tempC), rhPercent: enc(rhPercent) }, {}, WB_CITE, `invalid_input:${bad}`, clock) };
  }
  const RH = rhPercent < 5 ? 5 : rhPercent > 100 ? 100 : rhPercent;
  const clamped = RH !== rhPercent;
  const wetBulbC = stull(tempC, RH);
  const wetBulbF = (wetBulbC * 9) / 5 + 32;
  const result = { wetBulbC, wetBulbF };
  if (clamped) result.clampedRhPct = RH;
  const constants = { ...STULL };
  if (clamped) Object.assign(constants, { rh_clamp_min: 5, rh_clamp_max: 100 });
  const markers = [];
  if (clamped) markers.push('rh_clamped');
  if (tempC < -20 || tempC > 50) markers.push('out_of_validity_range');
  const m = markers.length ? ` (${markers.join(',')})` : '';
  const rh = clamped ? `${num(rhPercent)}→${num(RH)}%` : `${num(RH)}%`;
  const summary = `T=${fixed(tempC, 1)}°C RH=${rh}${m} → Tw=${fixed(wetBulbC, 2)}°C`;
  return { result, audit: audit('calculateWetBulb', { tempC, rhPercent }, constants, WB_CITE, summary, clock) };
}

export const wetBulbF = (tempF, rhPercent, clock) => wetBulb(((tempF - 32) * 5) / 9, rhPercent, clock);

// ---- flags (SPEC § 5)
const FLAG_CITE = 'USMC 6200.1E Table 3-1';
const BOUNDS = { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 };
const LABEL = { white: 'low', green: 'moderate', yellow: 'high', red: 'extreme', black: 'critical' };
export const FLAGS = ['white', 'green', 'yellow', 'red', 'black'];
const band = (w) => (w < 80 ? 'white' : w < 85 ? 'green' : w < 88 ? 'yellow' : w < 90 ? 'red' : 'black');

export function flagF(w, clock) {
  if (!Number.isFinite(w)) {
    return { result: null, audit: audit('flagFromWetBulbF', { wetBulbF: enc(w) }, {}, FLAG_CITE, 'invalid_input:wetBulbF', clock) };
  }
  const flag = band(w);
  const marker = w < -50 || w > 200 ? ' (out_of_observed_range)' : '';
  return {
    result: { flag, flagDartLabel: LABEL[flag] },
    audit: audit('flagFromWetBulbF', { wetBulbF: w }, { ...BOUNDS }, FLAG_CITE, `wetBulbF=${num(w)} → ${flag}${marker}`, clock),
  };
}

export function flagC(c, clock) {
  if (!Number.isFinite(c)) {
    return { result: null, audit: audit('flagFromWetBulbC', { wetBulbC: enc(c) }, {}, FLAG_CITE, 'invalid_input:wetBulbC', clock) };
  }
  const f = (c * 9) / 5 + 32;
  const inner = flagF(f, clock);
  return {
    result: inner.result,
    audit: audit('flagFromWetBulbC', { wetBulbC: c }, { ...BOUNDS }, FLAG_CITE, `wetBulbC=${num(c)} → wetBulbF=${fixed(f, 4)} → ${inner.result.flag}`, clock, { children: [inner.audit] }),
  };
}

// ---- work/rest (SPEC § 6)
const WR_CITE = 'USMC 6200.1E §3.2';
const CELLS = {
  white: [[60, 0, null], [50, 10, null]],
  green: [[50, 10, null], [40, 20, null]],
  yellow: [[45, 15, 6], [30, 30, 4]],
  red: [[30, 30, 4], null],
  black: [[10, 50, 1], null],
};

export function workRest(flag, acclimatized, wmr, clock) {
  if (!FLAGS.includes(flag)) {
    return { result: null, audit: audit('workRestForFlag', { flag, acclimatized, workMinutesRequested: enc(wmr) }, {}, WR_CITE, 'invalid_input:flag', clock) };
  }
  if (!Number.isFinite(wmr)) {
    return { result: null, audit: audit('workRestForFlag', { flag, acclimatized, workMinutesRequested: enc(wmr) }, {}, WR_CITE, 'invalid_input:workMinutesRequested', clock) };
  }
  const branch = acclimatized ? 'acclim' : 'unacclim';
  const cell = CELLS[flag][acclimatized ? 0 : 1];
  let result, constants = {}, summary;
  if (!cell) {
    result = { workMinutes: 0, restMinutes: 0, cyclesUntilReassessRequired: null, ceaseWork: true };
    summary = `${flag}/${branch} → cease_work`;
  } else {
    const [w, r, n] = cell;
    result = { workMinutes: w, restMinutes: r, cyclesUntilReassessRequired: n, ceaseWork: false };
    constants[`${flag}_work_${branch}`] = w;
    constants[`${flag}_rest_${branch}`] = r;
    if (n !== null) constants[acclimatized ? `${flag}_reassess_cycles` : `${flag}_reassess_cycles_unacclim`] = n;
    summary = `${flag}/${branch} → ${w}w/${r}r` + (n === 1 ? ', reassess every cycle' : n !== null ? `, reassess after ${n} cycles` : '');
  }
  if (wmr <= 0) summary += ' (non_positive_work_window)';
  return { result, audit: audit('workRestForFlag', { flag, acclimatized, workMinutesRequested: wmr }, constants, WR_CITE, summary, clock) };
}

// ---- verdict (SPEC § 7)
export const VD_CITE = 'Go/delay/alternate promotion matrix';
const SEV = { white: 0, green: 1, yellow: 2, red: 3, black: 4 };

export function verdict(priorVerdict, priorFlagIn, currentFlag, alt, clock) {
  const priorFlag = priorFlagIn === undefined ? null : priorFlagIn;
  const inputs = { priorVerdict, priorFlag, currentFlag, hasAlternateAvailable: alt };
  const bad = (what) => ({ result: null, audit: audit('promoteVerdict', inputs, {}, VD_CITE, `invalid_input:${what}`, clock) });
  if (!FLAGS.includes(currentFlag)) return bad('currentFlag');
  if (priorVerdict !== null && !['go', 'delay', 'alternate'].includes(priorVerdict)) return bad('priorVerdict');
  if (priorFlag !== null && !FLAGS.includes(priorFlag)) return bad('priorFlag');
  let v, rule, changed, summary;
  const p = priorFlag === null ? 'null' : priorFlag;
  if (priorVerdict === null) {
    v = SEV[currentFlag] >= 3 ? 'delay' : 'go'; rule = 'FIRST_RUN_DEFAULT'; changed = false;
    summary = `first run, ${currentFlag} → ${v}`;
  } else if (priorFlag === currentFlag) {
    v = priorVerdict; rule = 'NO_CHANGE'; changed = false;
    summary = `no_change, ${currentFlag} → ${v}${priorVerdict === 'delay' ? ' (held)' : ''}`;
  } else if (currentFlag === 'black' && alt) {
    v = 'alternate'; rule = 'ALTERNATE_AVAILABLE_AT_BLACK'; changed = priorVerdict !== v;
    summary = `${p} → ${currentFlag} + alternate → alternate`;
  } else if (SEV[currentFlag] >= 3) {
    v = 'delay'; rule = 'ESCALATE_TO_DELAY_ON_RED_OR_BLACK'; changed = priorVerdict !== v;
    summary = `${p} → ${currentFlag}, escalate to delay`;
  } else {
    v = 'go'; rule = 'DEESCALATE_TO_GO'; changed = priorVerdict !== v;
    summary = `${p} → ${currentFlag}, deescalate to go`;
  }
  return {
    result: { verdict: v, changedFromPrior: changed, promotionRule: rule },
    audit: audit('promoteVerdict', inputs, {}, VD_CITE, summary, clock, { prior_flag: priorFlag, next_flag: currentFlag, promotion_rule: rule }),
  };
}

// ---- cascade (SPEC § 8)
const NWS_URL = (lat, lng) => `https://api.weather.gov/points/${num(lat)},${num(lng)}/observations/latest`;
const OM_URL = (lat, lng) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${num(lat)}&longitude=${num(lng)}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`;

function replay(responses, url) {
  const m = responses.find((r) => new RegExp(r.url_pattern).test(url));
  if (!m) return { fail: 'transport_error' };
  if (m.simulate === 'timeout') return { fail: 'timeout' };
  const body = m.body_json !== undefined ? JSON.stringify(m.body_json) : m.body_text ?? '';
  return { status: m.status, body };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const present = (v) => v !== undefined && v !== null;

function parseNws(b) {
  const p = isObj(b) && isObj(b.properties) ? b.properties : {};
  const t = isObj(p.temperature) ? p.temperature.value : undefined;
  const rh = isObj(p.relativeHumidity) ? p.relativeHumidity.value : undefined;
  const ws = isObj(p.windSpeed) ? p.windSpeed.value : undefined;
  if (!present(t)) return { error: 'missing_field:temperature' };
  if (!present(rh)) return { error: 'missing_field:relativeHumidity' };
  const s = { tempC: t, rhPercent: rh, source: 'nws' };
  if (present(ws)) s.windMps = ws / 3.6;
  return s;
}

function parseOm(b) {
  const c = isObj(b) && isObj(b.current) ? b.current : {};
  if (!present(c.temperature_2m)) return { error: 'missing_field:temperature_2m' };
  if (!present(c.relative_humidity_2m)) return { error: 'missing_field:relative_humidity_2m' };
  const s = { tempC: c.temperature_2m, rhPercent: c.relative_humidity_2m, source: 'open-meteo' };
  if (present(c.wind_speed_10m)) s.windMps = c.wind_speed_10m / 3.6;
  return s;
}

export function cascade(input, responses, clock) {
  const inputs = { lat: input.lat, lng: input.lng };
  if (input.isoTimestamp !== undefined) inputs.isoTimestamp = input.isoTimestamp;
  const chain = [], tried = [], children = [];
  const attempt = (source, url, parse, budgetKey) => {
    chain.push(source);
    const r = replay(responses, url);
    let a, sample = null, summary;
    if (r.fail === 'timeout') { a = { source, status: 'timeout', duration_ms: 5000, error: 'timeout' }; summary = `${source} timeout`; }
    else if (r.fail) { a = { source, status: 'error', duration_ms: 0, error: r.fail }; }
    else if (r.status >= 400) { a = { source, status: 'error', duration_ms: 0, error: `http_${r.status}` }; }
    else {
      let parsed, ok = true;
      try { parsed = JSON.parse(r.body); } catch { ok = false; }
      if (!ok) a = { source, status: 'error', duration_ms: 0, error: 'parse_error' };
      else {
        const out = parse(parsed);
        if (out.error) a = { source, status: 'error', duration_ms: 0, error: out.error };
        else { sample = out; a = { source, status: 'ok', duration_ms: 0 }; summary = `${source} OK in 0ms`; }
      }
    }
    if (!summary) summary = `${source} ${a.error}`;
    tried.push(a);
    children.push(audit(`fetchWeatherCascade.${source}`, { ...inputs }, { [budgetKey]: 5000 }, source === 'nws' ? 'api.weather.gov' : 'api.open-meteo.com', summary, clock));
    return { sample, a };
  };
  const fallbackText = (a) =>
    a.status === 'timeout' ? 'nws timeout' : a.error.startsWith('missing_field:') ? 'nws missing fields' : `nws ${a.error}`;
  const constants = { nws_timeout_ms: 5000, open_meteo_timeout_ms: 5000 };
  const top = (sample, summary, reason) =>
    ({ result: { sample }, audit: audit('fetchWeatherCascade', inputs, constants, 'Cascade order: NWS → Open-Meteo → simulated', summary, clock,
      { source_chain: chain, sources_tried: tried, children, ...(reason === undefined ? {} : { fallback_reason: reason }) }) });

  const n = attempt('nws', NWS_URL(input.lat, input.lng), parseNws, 'nws_timeout_ms');
  if (n.sample) return top(n.sample, `cascade → nws OK (tempC=${num(n.sample.tempC)}, rhPercent=${num(n.sample.rhPercent)})`);
  const o = attempt('open-meteo', OM_URL(input.lat, input.lng), parseOm, 'open_meteo_timeout_ms');
  if (o.sample) {
    const fb = fallbackText(n.a);
    return top(o.sample, `cascade → open-meteo OK (tempC=${num(o.sample.tempC)}, rhPercent=${num(o.sample.rhPercent)}) after ${fb}`, fb);
  }
  chain.push('simulated');
  Object.assign(constants, { simulated_temp_c: 20, simulated_rh_percent: 50 });
  return top({ tempC: 20, rhPercent: 50, source: 'simulated' }, 'cascade → simulated (all_live_sources_failed)', 'all_live_sources_failed');
}
