# Sources

Where every requirement came from. **Never given to builders.**

## Reference implementation

- Repository: https://github.com/HeatCompass/heat-engine-spec
- Commit: `f621520a0d2628ce54a089b00477affc75a80ce3` (2026-05-28, "Merge pull request #3 from
  HeatCompass/fix/fixture-loader-hosted-dep"); `SPEC_VERSION` `0.1.1`.
- Cloned fresh with `git clone -c core.autocrlf=false` into the workspace's `_reference/`,
  2026-10-07. Built in a copy under `_reference/_build/` (`npm ci && npm run build` in
  `packages/spec-types-ts`).
- License: MIT. Notice, reproduced as required:

  > MIT License
  >
  > Copyright (c) 2026 HeatCompass
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy of this
  > software and associated documentation files (the "Software"), to deal in the Software
  > without restriction, including without limitation the rights to use, copy, modify, merge,
  > publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
  > to whom the Software is furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in all copies or
  > substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
  > INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
  > PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
  > FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  > OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
  > DEALINGS IN THE SOFTWARE.

- Not used: any private repository, including the one holding the design document that the
  reference's verdict citation names. Everything needed from it is restated in the public
  `spec/tier1-foundation/references.md`.

### Files read in full (all at `f621520`)

- `README.md`, `CHANGELOG.md`, `LICENSE`, `CITATION.cff`
- `spec/tier1-foundation/`: `references.md`; all 13 `*.schema.json`; the 4 `*.fixtures.csv`;
  the 6 `cascade-replay/*.json`
- `packages/spec-types-ts/`: `package.json`; `src/index.ts`, `specVersion.ts`, `types.ts`,
  `audit.ts`, `canonicalJson.ts`, `wetbulb.ts`, `flag.ts`, `refugeBreak.ts`, `verdict.ts`,
  `cascade.ts`, `fixtures.ts`; `test/` (all 8 test files); `tools/dump-cascade-audit.mjs`
- `packages/spec-types-dart/`: `pubspec.yaml`, `README.md`, `CHANGELOG.md`,
  `lib/heat_engine_spec.dart`, all of `lib/src/*.dart`; `test/` (all 8 test files, read with
  blank and comment lines stripped); `tool/sync_fixtures.dart`; `analysis_options.yaml`
- `scripts/build-fixtures.py`, `scripts/validate-fixtures.sh` (fixture provenance only)
- Not read (out of scope per brief): release workflow, `scripts/generate-types.sh`,
  `src/generated/**` (derived from the schemas, which were read).

## Requirement provenance

File paths are relative to the reference root, at `f621520`. TS = `packages/spec-types-ts/src`,
Dart = `packages/spec-types-dart/lib/src`.

| Requirement | Source |
|---|---|
| REQ-IF-001…007 | New (D-014). REGEN.json shape from `kit/REGEN.md` § 3. |
| REQ-CJ-001 | TS `canonicalJson.ts:20-23` (`String(n)`); `wetbulb.ts:125-128`, `flag.ts:130-132`, `cascade.ts:287-289` (`formatNum` ≡ `String`); Dart `canonical_json.dart:21-28` (diverges for exponents, D-002) |
| REQ-CJ-002 | TS `wetbulb.ts:85` (`toFixed(1)`, `toFixed(2)`), `flag.ts:115` (`toFixed(4)`); ECMAScript `Number.prototype.toFixed` |
| REQ-CJ-003 | TS `canonicalJson.ts:17-36`; Dart `canonical_json.dart:16-41` |
| REQ-CJ-004 | TS `canonicalJson.ts:19` (`JSON.stringify` on strings); Dart `canonical_json.dart:43-80` (does not escape lone surrogates; TS does) |
| REQ-CJ-005 | New (D-017) |
| REQ-AU-001 | TS `audit.ts:25-42, 59-81`; `spec/tier1-foundation/audit.schema.json`; version D-003 |
| REQ-AU-002 | TS `wetbulb.ts:118-123`, `flag.ts:49,93`, `refugeBreak.ts:85`; Dart `flag.dart:40`; D-007 |
| REQ-AU-003 | `audit.schema.json` `children`; TS `flag.ts:117`, `cascade.ts:125-129` |
| REQ-WB-001 | TS `wetbulb.ts:18-25, 52-65`; `scripts/build-fixtures.py:19-27`; Stull (2011) eq. 1; clamp D-009 |
| REQ-WB-002 | TS `wetbulb.ts:55`; `references.md` § stull-2011 |
| REQ-WB-003 | TS `wetbulb.ts:67-97`; `test/wetbulb-conformance.test.ts:10-17` |
| REQ-WB-004 | TS `wetbulb.ts:37-50`; `test/wetbulb-conformance.test.ts:55-64` |
| REQ-WB-005 | TS `wetbulb.ts:101-108` |
| REQ-FL-001 | TS `flag.ts:21-24, 29-35, 122-128`; `references.md` § usmc-6200-1e; MCO 6200.1E |
| REQ-FL-002 | TS `flag.ts:25-27, 58-78`; `test/flag-conformance.test.ts:52-56` |
| REQ-FL-003 | TS `flag.ts:44-56` |
| REQ-FL-004 | TS `flag.ts:101-103`, `wetbulb.ts:114-116`; D-010 |
| REQ-FL-005 | TS `flag.ts:104-119` |
| REQ-FL-006 | TS `flag.ts:88-100` |
| REQ-WR-001 | TS `refugeBreak.ts:32-53`; `references.md` § usmc-6200-1e-section-3-2; MCO 6200.1E §3.2 |
| REQ-WR-002 | TS `refugeBreak.ts:105-139`; `test/refugeBreak-conformance.test.ts:64-122` |
| REQ-WR-003 | TS `refugeBreak.ts:63-93` |
| REQ-VD-001 | TS `verdict.ts:85-109`; `references.md` § heat-engine-spec-design-doc-2-5 |
| REQ-VD-002 | TS `verdict.ts:117-156`; citation D-004 |
| REQ-VD-003 | TS `verdict.ts:45-83, 159-166` |
| REQ-CA-001 | `packages/spec-types-ts/test/cascade-conformance.test.ts:8-21` (first `url_pattern` regex match wins; unmatched throws; `simulate:"timeout"` throws `timeout`); `cascade-fixtures.schema.json` Response; D-012 |
| REQ-CA-002 | TS `cascade.ts:19-31, 49-95, 162-170`; `references.md` § cascade-*; D-008 |
| REQ-CA-003 | TS `cascade.ts:172-222` |
| REQ-CA-004 | TS `cascade.ts:249-279`; Dart `cascade.dart:298-334`; D-013 |
| REQ-CA-005 | NWS and Open-Meteo documentation (below); D-006 (reference: TS `cascade.ts:257, 277` copies unconverted) |
| REQ-CA-006 | TS `cascade.ts:182-238`; `audit.schema.json` SourceAttempt; D-005 |
| REQ-CA-007 | TS `cascade.ts:97-154` |
| REQ-BU-001…003 | `kit/briefs/heat-engine.md` § Budgets; `kit/REGEN.md` § 5.1 |

## Primary sources

- Stull, R. (2011). *Wet-Bulb Temperature from Relative Humidity and Air Temperature.* J. Appl.
  Meteor. Climatol. 50(11):2267–2269. DOI 10.1175/JAMC-D-11-0143.1. Constants and validity
  range as restated in the reference's `references.md`; the paper itself was not re-fetched.
  Python (`math`) and Node (`Math`) evaluations of the formula agreed bit for bit at
  (20, 50) and (30, 80) on this machine (Python 3.14.2, Node 22.20.0, Windows).
- U.S. Marine Corps Order 6200.1E, Marine Corps Heat Stress Program: flag bands and §3.2
  work/rest matrix, as restated in `references.md`. The order itself was not re-fetched.
- National Weather Service API, https://www.weather.gov/documentation/services-web-api
  (fetched 2026-10-07): documents `/points/{lat},{lon}` and
  `/stations/{stationId}/observations/latest`; no `/points/{lat},{lon}/observations/latest`.
  Live checks, 2026-10-07: `GET https://api.weather.gov/points/37.7749,-122.4194/observations/latest`
  → HTTP 404; `GET https://api.weather.gov/stations/KSFO/observations/latest` → `windSpeed`
  `unitCode` `wmoUnit:km_h-1`, temperature `wmoUnit:degC`, humidity `wmoUnit:percent`.
- Open-Meteo forecast API, https://open-meteo.com/en/docs (fetched 2026-10-07): default
  `wind_speed_unit` is km/h (options ms, mph, kn); default temperature unit °C.
- ECMAScript Language Specification: `Number::toString`, `Number.prototype.toFixed`,
  `JSON.stringify` (well-formed), `Array.prototype.sort` default comparison.

## Extraction checks (brief § Check during extraction)

| # | Hypothesis | Finding | Decision |
|---|---|---|---|
| 1 | How much of the audit to pin | Confirmed: earlier CI compared whole canonical audits across languages. `String(n)` vs Python `repr`: `1e-7`/`1e-07`, `1e20`/`1e+20`; `0.1+0.2` same. `toFixed` vs Python format on exact ties: `0.125` → `0.13`/`0.12`, `20.25` → `20.3`/`20.2`. Key order: JS default sort = UTF-16 code units; Python `sorted` = code points. `undefined` dropping only matters for absent members. | D-001, D-002, D-021 |
| 2 | `duration_ms` not a measurement | Confirmed: TS `cascade.ts:182-221` writes 0 or `timeoutMs`; fixtures assert it. | D-005 |
| 3 | Wind units | Confirmed: both services report km/h by default; reference copies without converting. | D-006 (correct it) |
| 4 | NWS endpoint | Confirmed: path is undocumented and returns 404 live. | D-008 (keep as replay identifier) |
| 5 | Stull validity range | Code clamps RH to [5, 100] (`wetbulb.ts:24-25`, comment line 9); `references.md` and the input schema say 5–99 (schema: "MUST clamp to [5, 99]"). Temperature out of [-20, 50] marks but computes. Non-finite → `result: null`, `invalid_input:<field>`. | D-009 |
| 6 | Flag boundaries and float error | Bands °F, inclusive lower. `((F-32)*5)/9` then `(c*9)/5+32` round-trips exactly at 80, 85, 88, 90. But `26.66666666666666` °C → `79.99999999999999` via `(c*9)/5+32` and `80` via `c*1.8+32`. | D-010; case `flc-02-float-flip` |
| 7 | `expectedFlagDartLabel` | Required by the output schema; trivially pinned. | D-011 (keep) |
| 8 | Tolerance | ±1e-5 °C. Python and Node agree bit for bit on sampled points; drift is not expected from the math. | D-018 |

Additional findings during extraction (not in the brief's list):
- The two earlier implementations disagree on `Infinity` inputs (TS → `null`; Dart → `"Infinity"`). D-007.
- TS treats an Open-Meteo `null` field as present; Dart treats it as missing. D-013.
- TS copies thrown exception text into the audit for transport errors. D-012.
- Dart has no runtime validation of flag or verdict strings (enums); `promoteVerdict` with a
  prior verdict and a null prior flag would throw (`priorFlag!`) in Dart at rules 3–5. D-015.
- The verdict citation names the private design document. D-004.

## Fixtures (copied unchanged; bytes verified by SHA-256 against the clone)

| Suite path | Origin (at `f621520`) | Rows |
|---|---|---|
| `suite/fixtures/wet-bulb.fixtures.csv` | `spec/tier1-foundation/wet-bulb.fixtures.csv` (generated by `scripts/build-fixtures.py`) | 38 |
| `suite/fixtures/flag-mapping.fixtures.csv` | `spec/tier1-foundation/flag-mapping.fixtures.csv` | 20 |
| `suite/fixtures/refuge-break.fixtures.csv` | `spec/tier1-foundation/refuge-break.fixtures.csv` | 10 |
| `suite/fixtures/verdict-promotion.fixtures.csv` | `spec/tier1-foundation/verdict-promotion.fixtures.csv` | 8 |
| `suite/fixtures/cascade-replay/*.json` (6) | `spec/tier1-foundation/cascade-replay/` | 6 |
| `suite/fixtures/schemas/*.schema.json` (13) | `spec/tier1-foundation/*.schema.json` | — |
| `suite/fixtures/references.md` | `spec/tier1-foundation/references.md` (kept so every `source_ref` resolves) | — |

All MIT, © 2026 HeatCompass. The suite checks that every CSV row's `source_ref` resolves to a
`##` heading in `references.md`. Deliberate departures from imported expectations are listed
in `suite/overrides.json`, each with its DECISIONS entry.
