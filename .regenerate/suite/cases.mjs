// Builds the suite's case list. Each case:
//   { id, reqs: [REQ ids], batch, line: <request object or raw string>, check, na?: [...] }
// check is one of:
//   { kind: 'result', value, tol? }        parsed `result` equals value (tol: {field: abs})
//   { kind: 'audit', text }                `audit` equals text after version substitution
//   { kind: 'version' }                    `audit` carries "spec_version":"<CONTRACT_VERSION>"
//   { kind: 'error', category }            response is exactly {id, error: category}
//   { kind: 'canonical', text }            `result` equals text and there is no `audit`
//   { kind: 'stdout', test }               a check over the whole batch's raw stdout
//   { kind: 'static', test }               a check over the implementation folder
// `na: ['reference']` marks behavior the reference has no equivalent for (REGEN class (e)).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as O from './oracle.mjs';

const FIX = join(import.meta.dirname, 'fixtures');
const CLOCK = '2026-05-26T17:00:00.000Z';
const OVERRIDES = JSON.parse(readFileSync(join(import.meta.dirname, 'overrides.json'), 'utf8'));

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export const csv = (name) => parseCsv(readFileSync(join(FIX, name), 'utf8'));

const req = (id, op, input, extra = {}) => ({ id, op, input, clock: CLOCK, ...extra });
// Wire encoding of a possibly non-finite number (REQ-IF-006).
const w = (x) => (Number.isNaN(x) ? 'NaN' : x === Infinity ? 'Infinity' : x === -Infinity ? '-Infinity' : x);

// SPEC.md's computed examples must agree with the oracle (D-022). Throws if not.
export function checkSpecExamples() {
  const spec = readFileSync(join(import.meta.dirname, '..', 'SPEC.md'), 'utf8');
  const bad = [];
  let n = 0;
  for (const m of spec.matchAll(/^- `tempC (\S+), rhPercent (\S+)` ⟶ `([^`]+)`/gm)) {
    n++;
    const got = O.wetBulb(Number(m[1]), Number(m[2]), CLOCK).audit.result_summary;
    if (got !== m[3]) bad.push(`wetBulb ${m[1]},${m[2]}: spec says ${m[3]}, oracle ${got}`);
  }
  for (const m of spec.matchAll(/`(-?[\d.]+)` ⟶ `(wetBulb[FC]=[^`]+)`/g)) {
    n++;
    const e = m[2].startsWith('wetBulbF') ? O.flagF(Number(m[1]), CLOCK) : O.flagC(Number(m[1]), CLOCK);
    if (e.audit.result_summary !== m[2]) bad.push(`flag ${m[1]}: spec says ${m[2]}, oracle ${e.audit.result_summary}`);
  }
  if (n < 6) bad.push(`only ${n} examples found; the example patterns no longer match SPEC.md`);
  if (bad.length) throw new Error('SPEC.md examples disagree with the oracle:\n  ' + bad.join('\n  '));
  return n;
}

export function buildCases() {
  checkSpecExamples();
  const cases = [];
  // An op case: one request, one result check, one audit check.
  const op = (id, batch, line, expected, reqsResult, reqsAudit, opts = {}) => {
    cases.push({ id: `${id}/result`, reqs: reqsResult, batch, line, check: { kind: 'result', value: expected.result, tol: opts.tol }, na: opts.na });
    cases.push({ id: `${id}/audit`, reqs: reqsAudit, batch, line, check: { kind: 'audit', text: O.canon(expected.audit) }, na: opts.naAudit ?? opts.na });
  };
  const WBTOL = { wetBulbC: 1e-5, wetBulbF: 1e-5 * 9 / 5 + 1e-9 };

  // ---------- wet-bulb: imported fixture rows (expected numbers from the CSV, audit from the oracle)
  for (const r of csv('wet-bulb.fixtures.csv')) {
    const T = Number(r.temp_c), RH = Number(r.rh_percent);
    const exp = O.wetBulb(T, RH, CLOCK);
    exp.result = { wetBulbC: Number(r.expected_wet_bulb_c), wetBulbF: Number(r.expected_wet_bulb_f) };
    const tol = { wetBulbC: Number(r.tolerance_c), wetBulbF: Number(r.tolerance_c) * 9 / 5 + 1e-9 };
    op(r.id, 'wb', req(r.id, 'wetBulb', { tempC: T, rhPercent: RH }), exp, ['REQ-WB-001'], ['REQ-WB-003', 'REQ-CJ-002'], { tol });
  }
  // ---------- wet-bulb: targeted cases
  const wb = (id, T, RH, reqsR, reqsA) =>
    op(id, 'wb', req(id, 'wetBulb', { tempC: w(T), rhPercent: w(RH) }), O.wetBulb(T, RH, CLOCK), reqsR, reqsA, { tol: WBTOL });
  wb('wb-x01-rh-high-clamp', 25, 120, ['REQ-WB-001'], ['REQ-WB-003']);
  wb('wb-x02-rh-low-clamp', 30, 2.5, ['REQ-WB-001'], ['REQ-WB-003']);
  wb('wb-x03-rh-99.5-no-clamp', 25, 99.5, ['REQ-WB-001'], ['REQ-WB-003']);
  wb('wb-x04-temp-60', 60, 50, ['REQ-WB-002'], ['REQ-WB-003']);
  wb('wb-x05-temp-minus-30', -30, 50, ['REQ-WB-002'], ['REQ-WB-003']);
  wb('wb-x06-both-markers', 60, 2.5, ['REQ-WB-001', 'REQ-WB-002'], ['REQ-WB-003']);
  wb('wb-x07-tie-20.25', 20.25, 50, ['REQ-WB-001'], ['REQ-WB-003', 'REQ-CJ-002']);
  wb('wb-x08-tie-neg-20.25', -20.25, 50, ['REQ-WB-002'], ['REQ-WB-003', 'REQ-CJ-002']);
  wb('wb-x09-fraction-rh', 22.5, 33.3, ['REQ-WB-001'], ['REQ-WB-003', 'REQ-CJ-001']);
  wb('wb-x10-neg-zero-temp', -0, 50, ['REQ-WB-001'], ['REQ-WB-003', 'REQ-CJ-001', 'REQ-CJ-002']);
  wb('wb-x11-small-neg-temp', -0.04, 50, ['REQ-WB-001'], ['REQ-WB-003', 'REQ-CJ-002']);
  wb('wb-x12-nan-temp', NaN, 50, ['REQ-WB-004'], ['REQ-WB-004', 'REQ-AU-002']);
  wb('wb-x13-nan-rh', 20, NaN, ['REQ-WB-004'], ['REQ-WB-004', 'REQ-AU-002']);
  wb('wb-x14-inf-temp', Infinity, 50, ['REQ-WB-004'], ['REQ-WB-004', 'REQ-AU-002']);
  wb('wb-x15-neg-inf-rh', 20, -Infinity, ['REQ-WB-004'], ['REQ-WB-004', 'REQ-AU-002']);
  wb('wb-x16-both-nan', NaN, NaN, ['REQ-WB-004'], ['REQ-WB-004']);
  // integer-valued numbers written in other JSON spellings are the same input (REQ-IF-006)
  cases.push({ id: 'wb-x17-spelling/audit', reqs: ['REQ-IF-006', 'REQ-CJ-001'], batch: 'wb',
    line: '{"id":"wb-x17-spelling","op":"wetBulb","input":{"tempC":2.0e1,"rhPercent":50.000},"clock":"' + CLOCK + '"}',
    check: { kind: 'audit', text: O.canon(O.wetBulb(20, 50, CLOCK).audit) } });
  // wetBulbF
  const wbf = (id, F, RH, reqsR, reqsA) =>
    op(id, 'wb', req(id, 'wetBulbF', { tempF: w(F), rhPercent: w(RH) }), O.wetBulbF(F, RH, CLOCK), reqsR, reqsA, { tol: WBTOL });
  wbf('wbf-01-68F', 68, 50, ['REQ-WB-005'], ['REQ-WB-005']);
  wbf('wbf-02-100F', 100, 40, ['REQ-WB-005'], ['REQ-WB-005']);
  wbf('wbf-03-fraction', 91.3, 65, ['REQ-WB-005'], ['REQ-WB-005', 'REQ-CJ-001']);
  wbf('wbf-04-nan', NaN, 50, ['REQ-WB-005'], ['REQ-WB-005', 'REQ-AU-002']);
  wbf('wbf-05-hot-clamped', 130, 3, ['REQ-WB-005'], ['REQ-WB-005']);

  // ---------- flags: imported rows
  for (const r of csv('flag-mapping.fixtures.csv')) {
    const W = Number(r.wet_bulb_f);
    const exp = O.flagF(W, CLOCK);
    exp.result = { flag: r.expected_flag, flagDartLabel: r.expected_flag_dart_label };
    op(r.id, 'fl', req(r.id, 'flagF', { wetBulbF: W }), exp, ['REQ-FL-001'], ['REQ-FL-002', 'REQ-CJ-001']);
  }
  const ff = (id, W, reqsR, reqsA) => op(id, 'fl', req(id, 'flagF', { wetBulbF: w(W) }), O.flagF(W, CLOCK), reqsR, reqsA);
  ff('fl-x01-observed-high', 250, ['REQ-FL-001'], ['REQ-FL-002']);
  ff('fl-x02-observed-low', -60, ['REQ-FL-001'], ['REQ-FL-002']);
  ff('fl-x03-observed-edge-200', 200, ['REQ-FL-001'], ['REQ-FL-002']);
  ff('fl-x04-tiny', 1e-7, ['REQ-FL-001'], ['REQ-FL-002', 'REQ-CJ-001']);
  ff('fl-x05-huge', 1e21, ['REQ-FL-001'], ['REQ-FL-002', 'REQ-CJ-001']);
  ff('fl-x06-just-under-80', 79.99999999999999, ['REQ-FL-001'], ['REQ-FL-002', 'REQ-CJ-001']);
  ff('fl-x07-nan', NaN, ['REQ-FL-003'], ['REQ-FL-003', 'REQ-AU-002']);
  ff('fl-x08-inf', Infinity, ['REQ-FL-003'], ['REQ-FL-003', 'REQ-AU-002']);
  const fc = (id, C, reqsR, reqsA) => op(id, 'fl', req(id, 'flagC', { wetBulbC: w(C) }), O.flagC(C, CLOCK), reqsR, reqsA);
  fc('flc-01-30C', 30, ['REQ-FL-004'], ['REQ-FL-005']);
  fc('flc-02-float-flip', 26.66666666666666, ['REQ-FL-004'], ['REQ-FL-005', 'REQ-CJ-002']);
  for (const F of [80, 85, 88, 90]) {
    const C = ((F - 32) * 5) / 9;
    fc(`flc-b${F}-exact-boundary`, C, ['REQ-FL-004'], ['REQ-FL-005', 'REQ-CJ-001']);
    fc(`flc-b${F}-below`, C - 1e-9, ['REQ-FL-004'], ['REQ-FL-005']);
  }
  fc('flc-03-negative', -12.5, ['REQ-FL-004'], ['REQ-FL-005']);
  fc('flc-04-nan', NaN, ['REQ-FL-006'], ['REQ-FL-006', 'REQ-AU-002']);
  fc('flc-05-neg-inf', -Infinity, ['REQ-FL-006'], ['REQ-FL-006', 'REQ-AU-002']);

  // ---------- work/rest: imported rows
  for (const r of csv('refuge-break.fixtures.csv')) {
    const acc = r.acclimatized === 'true';
    const exp = O.workRest(r.flag, acc, Number(r.work_minutes_requested), CLOCK);
    exp.result = {
      workMinutes: Number(r.expected_work_minutes),
      restMinutes: Number(r.expected_rest_minutes),
      cyclesUntilReassessRequired: r.expected_cycles_until_reassess_required === '' ? null : Number(r.expected_cycles_until_reassess_required),
      ceaseWork: r.expected_cease_work === 'true',
    };
    op(r.id, 'wr', req(r.id, 'workRest', { flag: r.flag, acclimatized: acc, workMinutesRequested: Number(r.work_minutes_requested) }), exp, ['REQ-WR-001'], ['REQ-WR-002']);
  }
  const wr = (id, flag, acc, m, reqsR, reqsA) =>
    op(id, 'wr', req(id, 'workRest', { flag, acclimatized: acc, workMinutesRequested: w(m) }), O.workRest(flag, acc, m, CLOCK), reqsR, reqsA);
  wr('wr-x01-zero-window', 'green', true, 0, ['REQ-WR-001'], ['REQ-WR-002']);
  wr('wr-x02-negative-window-cease', 'black', false, -15, ['REQ-WR-001'], ['REQ-WR-002']);
  wr('wr-x03-fractional-window', 'yellow', false, 37.5, ['REQ-WR-001'], ['REQ-WR-002']);
  wr('wr-x04-bad-flag', 'purple', true, 60, ['REQ-WR-003'], ['REQ-WR-003']);
  wr('wr-x05-nan-window', 'green', true, NaN, ['REQ-WR-003'], ['REQ-WR-003', 'REQ-AU-002']);
  wr('wr-x06-bad-flag-and-nan', 'Red', false, NaN, ['REQ-WR-003'], ['REQ-WR-003', 'REQ-AU-002']);

  // ---------- verdict: imported rows
  for (const r of csv('verdict-promotion.fixtures.csv')) {
    const pv = r.prior_verdict === '' ? null : r.prior_verdict;
    const pf = r.prior_flag === '' ? null : r.prior_flag;
    const alt = r.has_alternate_available === 'true';
    const exp = O.verdict(pv, pf, r.current_flag, alt, CLOCK);
    exp.result = { verdict: r.expected_verdict, changedFromPrior: r.expected_changed_from_prior === 'true', promotionRule: r.expected_promotion_rule };
    op(r.id, 'vd', req(r.id, 'verdict', { priorVerdict: pv, priorFlag: pf, currentFlag: r.current_flag, hasAlternateAvailable: alt }), exp, ['REQ-VD-001'], ['REQ-VD-002']);
  }
  const vd = (id, pv, pf, cf, alt, reqsR, reqsA, omitPrior = false) => {
    const input = { priorVerdict: pv, currentFlag: cf, hasAlternateAvailable: alt };
    if (!omitPrior) input.priorFlag = pf;
    op(id, 'vd', req(id, 'verdict', input), O.verdict(pv, omitPrior ? undefined : pf, cf, alt, CLOCK), reqsR, reqsA);
  };
  vd('vd-x01-first-run-red-alt', null, null, 'red', true, ['REQ-VD-001'], ['REQ-VD-002']);
  vd('vd-x02-first-run-black-alt', null, null, 'black', true, ['REQ-VD-001'], ['REQ-VD-002']);
  vd('vd-x03-no-change-alternate-held', 'alternate', 'black', 'black', false, ['REQ-VD-001'], ['REQ-VD-002']);
  vd('vd-x04-black-to-black-no-change', 'delay', 'black', 'black', true, ['REQ-VD-001'], ['REQ-VD-002']);
  vd('vd-x05-escalate-already-delay', 'delay', 'red', 'black', false, ['REQ-VD-001'], ['REQ-VD-002']);
  vd('vd-x06-alternate-to-alternate', 'alternate', 'red', 'black', true, ['REQ-VD-001'], ['REQ-VD-002']);
  vd('vd-x07-deescalate-go-to-go', 'go', 'green', 'yellow', true, ['REQ-VD-001'], ['REQ-VD-002']);
  vd('vd-x08-prior-without-flag', 'go', null, 'green', false, ['REQ-VD-001'], ['REQ-VD-002']);
  vd('vd-x09-prior-flag-missing', 'delay', null, 'red', false, ['REQ-VD-001'], ['REQ-VD-002'], true);
  vd('vd-x10-bad-current', 'go', 'green', 'purple', false, ['REQ-VD-003'], ['REQ-VD-003']);
  vd('vd-x11-bad-prior-verdict', 'maybe', 'green', 'red', false, ['REQ-VD-003'], ['REQ-VD-003']);
  vd('vd-x12-bad-prior-flag', 'go', 'orange', 'red', false, ['REQ-VD-003'], ['REQ-VD-003']);
  vd('vd-x13-bad-order', 'maybe', 'orange', 'purple', false, ['REQ-VD-003'], ['REQ-VD-003']);

  // ---------- cascade: imported replay scenarios (expected bytes from the fixture files, with overrides)
  for (const f of readdirSync(join(FIX, 'cascade-replay')).filter((n) => n.endsWith('.json')).sort()) {
    const file = JSON.parse(readFileSync(join(FIX, 'cascade-replay', f), 'utf8'));
    for (const row of file.rows) {
      const ov = OVERRIDES.cascade[row.id] ?? {};
      const expectedResult = ov.expectedResult ?? row.expectedResult;
      const line = { id: row.id, op: 'cascade', input: row.input, clock: row.ctx.clock_iso, responses: row.ctx.responses };
      cases.push({ id: `${row.id}/result`, reqs: ['REQ-CA-001', 'REQ-CA-002', 'REQ-CA-003', 'REQ-CA-004', ...(ov.reqs ?? [])], batch: 'ca', line,
        check: { kind: 'result', value: expectedResult } });
      cases.push({ id: `${row.id}/audit`, reqs: ['REQ-CA-006', 'REQ-CA-007', 'REQ-AU-003'], batch: 'ca', line,
        check: { kind: 'audit', text: O.canon(row.expectedAudit) } });
      // Self-check: the oracle must agree with the imported expected audit (else the suite is wrong).
      const mine = O.cascade(row.input, row.ctx.responses, row.ctx.clock_iso);
      const nv = (t) => t.replace(/"spec_version":"\d+\.\d+\.\d+"/g, `"spec_version":"${O.CONTRACT_VERSION}"`);
      if (nv(O.canon(mine.audit)) !== nv(O.canon(row.expectedAudit))) throw new Error(`oracle disagrees with imported fixture ${row.id}`);
      if (O.canon(mine.result) !== O.canon(expectedResult)) throw new Error(`oracle result disagrees with ${row.id} (after overrides)`);
    }
  }
  const NWS_PAT = 'api\\.weather\\.gov/.*/observations/latest';
  const OM_PAT = 'api\\.open-meteo\\.com/.*';
  const nwsOk = (t, rh, ws) => ({ url_pattern: NWS_PAT, status: 200, body_json: { properties: { temperature: { value: t }, relativeHumidity: { value: rh }, ...(ws === undefined ? {} : { windSpeed: { value: ws } }) } } });
  const ca = (id, input, responses, reqsR, reqsA) => {
    const line = { id, op: 'cascade', input, clock: CLOCK, responses };
    const exp = O.cascade(input, responses, CLOCK);
    cases.push({ id: `${id}/result`, reqs: reqsR, batch: 'ca', line, check: { kind: 'result', value: exp.result } });
    cases.push({ id: `${id}/audit`, reqs: reqsA, batch: 'ca', line, check: { kind: 'audit', text: O.canon(exp.audit) } });
  };
  const SF = { lat: 37.7749, lng: -122.4194 };
  ca('ca-x01-nws-unmatched', SF, [{ url_pattern: OM_PAT, status: 200, body_json: { current: { temperature_2m: 18, relative_humidity_2m: 40 } } }],
    ['REQ-CA-001', 'REQ-CA-003'], ['REQ-CA-006', 'REQ-CA-007']);
  ca('ca-x02-nothing-matches', SF, [], ['REQ-CA-001', 'REQ-CA-002'], ['REQ-CA-006', 'REQ-CA-007']);
  ca('ca-x03-nws-timeout', SF, [{ url_pattern: NWS_PAT, status: 200, simulate: 'timeout' }, { url_pattern: OM_PAT, status: 200, body_json: { current: { temperature_2m: 30.5, relative_humidity_2m: 55.5 } } }],
    ['REQ-CA-003'], ['REQ-CA-006', 'REQ-CA-007']);
  ca('ca-x04-om-null-temp', SF, [{ url_pattern: NWS_PAT, status: 503, body_text: '' }, { url_pattern: OM_PAT, status: 200, body_json: { current: { temperature_2m: null, relative_humidity_2m: 40 } } }],
    ['REQ-CA-004'], ['REQ-CA-006', 'REQ-CA-007']);
  ca('ca-x05-om-missing-rh', SF, [{ url_pattern: NWS_PAT, status: 404, body_text: 'not found' }, { url_pattern: OM_PAT, status: 200, body_json: { current: { temperature_2m: 21 } } }],
    ['REQ-CA-004'], ['REQ-CA-006', 'REQ-CA-007']);
  ca('ca-x06-nws-missing-rh', SF, [nwsOk(25, null), { url_pattern: OM_PAT, status: 200, body_json: { current: { temperature_2m: 24, relative_humidity_2m: 61, wind_speed_10m: 10.8 } } }],
    ['REQ-CA-004', 'REQ-CA-005'], ['REQ-CA-006', 'REQ-CA-007']);
  ca('ca-x07-nws-no-properties', SF, [{ url_pattern: NWS_PAT, status: 200, body_json: { type: 'Feature' } }, { url_pattern: OM_PAT, status: 200, body_text: '[1,2' }],
    ['REQ-CA-004', 'REQ-CA-003'], ['REQ-CA-006', 'REQ-CA-007']);
  ca('ca-x08-nws-body-null', SF, [{ url_pattern: NWS_PAT, status: 200, body_text: 'null' }, { url_pattern: OM_PAT, status: 200, simulate: 'timeout' }],
    ['REQ-CA-004'], ['REQ-CA-006', 'REQ-CA-007']);
  ca('ca-x09-nws-wind-null', SF, [nwsOk(31.25, 70, null)], ['REQ-CA-004', 'REQ-CA-005'], ['REQ-CA-007']);
  ca('ca-x10-nws-wind-kmh', SF, [nwsOk(19, 80, 25)], ['REQ-CA-005'], ['REQ-CA-007']);
  ca('ca-x11-iso-timestamp', { lat: 1, lng: 2, isoTimestamp: '2026-05-26T16:00:00.000Z' }, [nwsOk(25, 50)], ['REQ-CA-002'], ['REQ-CA-006', 'REQ-CA-007']);
  ca('ca-x12-status-399-parses', SF, [{ url_pattern: NWS_PAT, status: 399, body_json: { properties: { temperature: { value: 10 }, relativeHumidity: { value: 90 } } } }],
    ['REQ-CA-003'], ['REQ-CA-007']);
  // URL text: exact patterns that only match if <lat>,<lng> use number text (REQ-CJ-001)
  ca('ca-x13-url-number-text', { lat: 40, lng: -1e-7 }, [
    { url_pattern: '^https://api\\.weather\\.gov/points/40,-1e-7/observations/latest$', status: 200, body_json: { properties: { temperature: { value: 15 }, relativeHumidity: { value: 45 } } } },
  ], ['REQ-CA-002', 'REQ-CJ-001'], ['REQ-CA-007']);
  ca('ca-x14-om-url-exact', { lat: 51.5, lng: 0 }, [
    { url_pattern: '^https://api\\.open-meteo\\.com/v1/forecast\\?latitude=51\\.5&longitude=0&current=temperature_2m,relative_humidity_2m,wind_speed_10m$', status: 200, body_json: { current: { temperature_2m: 12.5, relative_humidity_2m: 77 } } },
  ], ['REQ-CA-002'], ['REQ-CA-007']);
  ca('ca-x15-first-match-wins', SF, [
    { url_pattern: 'weather', status: 500, body_text: 'x' },
    { url_pattern: NWS_PAT, status: 200, body_json: { properties: { temperature: { value: 25 }, relativeHumidity: { value: 50 } } } },
    { url_pattern: OM_PAT, status: 200, body_json: { current: { temperature_2m: 26, relative_humidity_2m: 51 } } },
  ], ['REQ-CA-001'], ['REQ-CA-007']);

  // ---------- canonical
  const cj = (id, value, reqs, raw) => {
    const line = raw ?? { id, op: 'canonical', input: { value } };
    cases.push({ id, reqs, batch: 'cj', line, check: { kind: 'canonical', text: O.canon(value) } });
  };
  cj('cj-01-sort-nested', { b: 1, a: { z: [3, 1, 2], y: null } }, ['REQ-CJ-003', 'REQ-CJ-005']);
  cj('cj-02-numbers', [5, 1.5, 0.30000000000000004, 1e20, 1e21, 1e-6, 1e-7, 1.23e-18, -2.5e-9, 123456789012345680000], ['REQ-CJ-001', 'REQ-CJ-005']);
  cj('cj-03-neg-zero', -0, ['REQ-CJ-001'], '{"id":"cj-03-neg-zero","op":"canonical","input":{"value":-0.0}}');
  cj('cj-04-int-spelling', [20, 1e21, 0.5], ['REQ-CJ-001'], '{"id":"cj-04-int-spelling","op":"canonical","input":{"value":[20.0,1000000000000000000000,5e-1]}}');
  cj('cj-05-escapes', 'q"b\\s/\b\f\n\r\t\u0001\u001f\u007f é°→', ['REQ-CJ-004']);
  cj('cj-06-lone-surrogate', 'a\ud800b\udfffc😀', ['REQ-CJ-004'], '{"id":"cj-06-lone-surrogate","op":"canonical","input":{"value":"a\\ud800b\\udfffc\\ud83d\\ude00"}}');
  cj('cj-07-utf16-key-order', { '￿': 1, '😀': 2, 'Z': 3, 'a': 4, '_': 5 }, ['REQ-CJ-003']);
  cj('cj-08-scalars', [true, false, null, '', [], {}], ['REQ-CJ-003']);
  cj('cj-09-special-strings-literal', { x: 'NaN', y: 'Infinity' }, ['REQ-CJ-005']);
  cj('cj-10-whitespace-input', { k: [1, { j: 2 }] }, ['REQ-CJ-003'], '{ "id" : "cj-10-whitespace-input" , "op":"canonical", "input": { "value" : { "k" : [ 1 , { "j" : 2 } ] } } }');

  // ---------- version (one per audited op)
  for (const [id, line] of [
    ['ver-wetBulb', req('ver-wetBulb', 'wetBulb', { tempC: 20, rhPercent: 50 })],
    ['ver-wetBulbF', req('ver-wetBulbF', 'wetBulbF', { tempF: 68, rhPercent: 50 })],
    ['ver-flagF', req('ver-flagF', 'flagF', { wetBulbF: 85 })],
    ['ver-flagC', req('ver-flagC', 'flagC', { wetBulbC: 30 })],
    ['ver-workRest', req('ver-workRest', 'workRest', { flag: 'red', acclimatized: true, workMinutesRequested: 60 })],
    ['ver-verdict', req('ver-verdict', 'verdict', { priorVerdict: null, priorFlag: null, currentFlag: 'white', hasAlternateAvailable: false })],
    ['ver-cascade', { id: 'ver-cascade', op: 'cascade', input: { lat: 1, lng: 2 }, clock: CLOCK, responses: [] }],
  ]) cases.push({ id, reqs: ['REQ-AU-001', 'REQ-IF-005'], batch: 'ver', line, check: { kind: 'version' } });
  // the clock is echoed exactly (not "now")
  op('clk-01-other-clock', 'ver', { id: 'clk-01-other-clock', op: 'flagF', input: { wetBulbF: 70 }, clock: '1999-12-31T23:59:59.999Z' },
    O.flagF(70, '1999-12-31T23:59:59.999Z'), ['REQ-FL-001'], ['REQ-IF-004', 'REQ-AU-001']);

  // ---------- interface: errors, blank lines, bytes, exit (new protocol: n/a for the reference)
  const NA = ['reference'];
  const err = (id, line, category, reqs = ['REQ-IF-007']) => cases.push({ id, reqs, batch: 'if', line, check: { kind: 'error', category, id: typeof line === 'string' ? null : line.id }, na: NA });
  err('if-err-not-json', '{not json', 'bad_request');
  err('if-err-array', '[1,2]', 'bad_request');
  err('if-err-no-id', '{"op":"flagF","input":{"wetBulbF":80},"clock":"' + CLOCK + '"}', 'bad_request');
  err('if-err-unknown-op', { id: 'if-err-unknown-op', op: 'heatIndex', input: {}, clock: CLOCK }, 'unknown_op');
  err('if-err-missing-op', { id: 'if-err-missing-op', input: {}, clock: CLOCK }, 'unknown_op');
  err('if-err-unknown-op-before-input', { id: 'if-err-unknown-op-before-input', op: 'nope' }, 'unknown_op');
  err('if-err-no-input', { id: 'if-err-no-input', op: 'flagF', clock: CLOCK }, 'bad_request');
  err('if-err-no-clock', { id: 'if-err-no-clock', op: 'flagF', input: { wetBulbF: 80 } }, 'bad_request');
  err('if-err-missing-field', { id: 'if-err-missing-field', op: 'wetBulb', input: { tempC: 20 }, clock: CLOCK }, 'bad_request');
  err('if-err-number-is-bool', { id: 'if-err-number-is-bool', op: 'flagF', input: { wetBulbF: true }, clock: CLOCK }, 'bad_request');
  err('if-err-number-is-text', { id: 'if-err-number-is-text', op: 'flagF', input: { wetBulbF: '80' }, clock: CLOCK }, 'bad_request');
  err('if-err-bool-is-number', { id: 'if-err-bool-is-number', op: 'workRest', input: { flag: 'red', acclimatized: 1, workMinutesRequested: 60 }, clock: CLOCK }, 'bad_request');
  err('if-err-flag-is-number', { id: 'if-err-flag-is-number', op: 'verdict', input: { priorVerdict: null, currentFlag: 3, hasAlternateAvailable: false }, clock: CLOCK }, 'bad_request');
  err('if-err-cascade-no-responses', { id: 'if-err-cascade-no-responses', op: 'cascade', input: { lat: 1, lng: 2 }, clock: CLOCK }, 'bad_request');
  cases.push({ id: 'if-special-strings-accepted', reqs: ['REQ-IF-006'], batch: 'if', line: req('if-special-strings-accepted', 'flagC', { wetBulbC: '-Infinity' }),
    check: { kind: 'audit', text: O.canon(O.flagC(-Infinity, CLOCK).audit) }, na: NA });
  cases.push({ id: 'if-extra-members-ignored', reqs: ['REQ-IF-004'], batch: 'if', line: { ...req('if-extra-members-ignored', 'flagF', { wetBulbF: 86, note: 'x' }), trace: true },
    check: { kind: 'result', value: { flag: 'yellow', flagDartLabel: 'high' } }, na: NA });
  // whole-batch byte checks on the main wet-bulb batch (summaries contain ° and →)
  cases.push({ id: 'if-bytes-utf8', reqs: ['REQ-IF-003'], batch: 'wb', check: { kind: 'stdout', test: 'utf8' }, na: NA });
  cases.push({ id: 'if-bytes-lf-only', reqs: ['REQ-IF-003'], batch: 'wb', check: { kind: 'stdout', test: 'lf' }, na: NA });
  cases.push({ id: 'if-order-and-count', reqs: ['REQ-IF-002'], batch: 'wb', check: { kind: 'stdout', test: 'count' }, na: NA });
  cases.push({ id: 'if-exit-zero', reqs: ['REQ-IF-002'], batch: 'wb', check: { kind: 'stdout', test: 'exit0' }, na: NA });
  cases.push({ id: 'if-blank-lines', reqs: ['REQ-IF-002'], batch: 'blank', check: { kind: 'stdout', test: 'blank' }, na: NA,
    lines: ['', '   ', JSON.stringify(req('blank-1', 'flagF', { wetBulbF: 81 })), '\t', JSON.stringify(req('blank-2', 'flagF', { wetBulbF: 91 }))] });
  cases.push({ id: 'if-error-then-continue', reqs: ['REQ-IF-007', 'REQ-IF-002'], batch: 'cont', check: { kind: 'stdout', test: 'continue' }, na: NA,
    lines: ['garbage', JSON.stringify(req('cont-1', 'flagF', { wetBulbF: 89 }))] });
  // static checks over the implementation folder (scorer-side budgets, n/a for the reference adapter)
  for (const [id, reqs, test] of [
    ['st-regen-json', ['REQ-IF-001'], 'regen'],
    ['st-runtime', ['REQ-BU-001'], 'runtime'],
    ['st-no-deps', ['REQ-BU-002'], 'deps'],
    ['st-line-budget', ['REQ-BU-003'], 'loc'],
  ]) cases.push({ id, reqs, batch: null, check: { kind: 'static', test }, na: NA });
  return cases;
}
