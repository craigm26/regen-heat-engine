# Decisions

Why SPEC.md says what it says. "The earlier implementation" means the two prior
implementations (one TypeScript, one in another language) whose behavior and test fixtures
this spec was extracted from. They were required to produce byte-identical audit records.

## D-001: The whole audit record is pinned, byte for byte
- Source: extraction
- Context: The earlier implementation's main cross-language guarantee was byte-equal
  serialized audit records, including the human-readable `result_summary`. Pinning all of it
  makes the spec nearly as detailed as the code for summaries and number formatting.
- Decision: Pin every audit member, including `result_summary`, the number text rule
  (REQ-CJ-001), fixed-point text (REQ-CJ-002), canonical serialization (REQ-CJ-003,
  REQ-CJ-004), and member presence rules. Leave error message text, stderr and library shape
  open (OPEN-IF-001, OPEN-IF-002, OPEN-IF-004).
- Why: The audit record is what a downstream consumer stores and compares; the summary is
  written as a one-line record intended for spreadsheets and logs. If two implementations may
  differ in it, byte comparison stops being useful. The cost is that the summary formats must
  be spelled out exactly; they are short.
- Alternatives: Pin only the structured members and compare `result_summary` by pattern (as
  some of the earlier tests did); rejected because the earlier cross-language check compared
  whole records.

## D-002: Number text follows ECMAScript, not the host language
- Source: extraction
- Context: Canonical JSON, summaries and request URLs all write numbers as text. The earlier
  implementation used JavaScript's `String(n)` and `toFixed`. Other languages differ:
  Python's `repr` writes `1e-07` and `1e+20` where JavaScript writes `1e-7` and
  `100000000000000000000`; Python's `'%.1f'` rounds exact ties to even (`20.25` → `20.2`)
  where `toFixed` rounds them up (`20.3`). Integer-valued JSON input such as `20` must be
  written `20`, never `20.0`.
- Decision: REQ-CJ-001 and REQ-CJ-002 restate the ECMAScript algorithms. Every number in a
  request is a binary64 value (REQ-IF-006).
- Why: Byte equality across languages needs one rule; the earlier fixtures were produced with
  this one.
- Alternatives: Fixed significant digits everywhere (changes all existing expected bytes).

## D-003: The emitted contract version is 0.2.0, and the suite checks it separately
- Source: extraction
- Context: Audit records carry `spec_version`, the version of the audit/behavior contract.
  The earlier implementation emitted `0.1.1` and its fixtures assert it. This spec changes the
  contract in places (D-004, D-006, D-007, D-012, D-013), so claiming `0.1.1` would be false.
  This is a different number from SPEC.md's own document version (1.0.0), which tracks the
  wording of this document.
- Decision: Emit `"0.2.0"` (REQ-AU-001). Imported fixtures keep their bytes unchanged; the
  suite checks `spec_version` in dedicated cases and substitutes the current value in all
  other byte comparisons.
- Why: Keeps fixture bytes exact while making version mismatches show up as exactly one kind
  of failure.
- Alternatives: Keep `0.1.1` (dishonest about the changes); rewrite the fixtures (loses the
  exact provenance of the imported bytes).

## D-004: Verdict citation is a plain description
- Source: extraction
- Context: The earlier implementation cited an unpublished design document by its project
  name and section number. That document is not public, and its name is not part of this
  spec.
- Decision: `citation` for verdicts is `"Go/delay/alternate promotion matrix"` (REQ-VD-002).
  The five rules are restated in full in REQ-VD-001, which is now the authority.
- Why: A citation should point at something a reader can find. This spec is that something.
- Alternatives: Keep the old string (cites an unavailable document).

## D-005: `duration_ms` is a fixed value, not a measurement
- Source: extraction
- Context: `sources_tried[].duration_ms` looks like elapsed time, but the earlier
  implementation always wrote `0` for ok and error attempts and the timeout budget (5000) for
  timeouts, and its fixtures assert those values. A measured value would break byte equality
  and determinism. The earlier schema described it as "wall-clock time (0 in fixture replay)".
- Decision: Pin the fixed values (REQ-CA-006). The child summary `OK in 0ms` is likewise fixed
  text.
- Why: Audit records must be reproducible from the request alone.
- Alternatives: Rename the field (breaks imported fixtures); make it open (breaks byte
  comparison of every cascade audit).

## D-006: Wind speed is converted from km/h to m/s
- Source: primary source
- Context: The sample's field is `windMps` (metres per second). The earlier implementation
  copied the NWS `windSpeed.value` and Open-Meteo `wind_speed_10m` into it unchanged. NWS
  observations report wind with `unitCode` `wmoUnit:km_h-1` (checked against a live
  observation, 2026-10-07), and Open-Meteo's documented default `wind_speed_unit` is km/h.
  So the earlier values were km/h labelled as m/s.
- Decision: `windMps = value / 3.6` (REQ-CA-005). The imported `nws-success` and
  `nws-missing-falls-to-openmeteo` fixtures' expected `windMps` are overridden in the suite
  (3.1 → 0.8611111111111112, 2.4 → 0.6666666666666666). Wind does not appear in audits.
- Why: A field named for a unit should hold that unit; heat-stress consumers would read it.
- Alternatives: Keep compatibility (wrong by a factor of 3.6); request `wind_speed_unit=ms`
  from Open-Meteo (changes the request URL and still leaves NWS to convert).

## D-007: Non-finite inputs are written as strings in audits
- Source: extraction
- Context: The earlier TypeScript wrote `NaN` inputs as the string `"NaN"` but let `Infinity`
  through, which its serializer then wrote as `null`; the other earlier implementation wrote
  `"Infinity"`. The two disagreed.
- Decision: `"NaN"`, `"Infinity"`, `"-Infinity"` (REQ-AU-002). The driver accepts the same
  three strings as input (REQ-IF-006), since JSON has no non-finite numbers.
- Why: Symmetric, lossless, and matches one of the two earlier behaviors.
- Alternatives: `null` (loses which value it was).

## D-008: The NWS request URL is kept, although it does not exist live
- Source: primary source
- Context: The earlier implementation requests
  `https://api.weather.gov/points/<lat>,<lng>/observations/latest`. The documented NWS API has
  `/points/{lat},{lon}` (which links to stations) and
  `/stations/{stationId}/observations/latest`; the earlier path returns HTTP 404 (checked
  2026-10-07). All replay fixtures match NWS on `api\.weather\.gov/.*/observations/latest`.
- Decision: Keep the URL as the request identifier for replay (REQ-CA-002). Live network
  fetching is outside this spec (OPEN-IF-004); with the real service this source would always
  fail over to Open-Meteo.
- Why: The correct flow needs two extra requests per cascade that no fixture covers, and the
  spec only judges replayed behavior. Recorded so nobody mistakes the URL for a working one.
- Alternatives: Specify the two-step points → stations → observations flow (changes every
  cascade fixture and adds untested surface).

## D-009: RH is clamped to [5, 100], not [5, 99]
- Source: extraction
- Context: Stull's stated validity range is RH 5–99 %; the earlier input schema said
  implementations "MUST clamp to [5, 99]"; the earlier code clamped to [5, 100], and a test
  asserts `RH=120 → 100`. Only temperature gets the `out_of_validity_range` marker.
- Decision: Clamp to [5, 100] (REQ-WB-001); RH in (99, 100] computes without a marker.
- Why: Code and tests agreed and 100 % is a real humidity; the schema sentence was the outlier.
- Alternatives: Clamp to 99 (contradicts the earlier tests); mark RH > 99 as out of range
  (new behavior nobody asked for).

## D-010: Flag bands are in °F, and the °C path uses one exact expression
- Source: extraction, primary source
- Context: MCO 6200.1E defines the bands in °F with inclusive lower bounds. The °C path
  converts first. Floating-point error can move a value across a boundary: for
  `26.66666666666666` °C, `(c*9)/5+32` gives `79.99999999999999` (white) but `c*1.8+32` gives
  `80` (green). At the exact boundary values (80, 85, 88, 90 °F and their °C equivalents
  produced by `((F-32)*5)/9`) both directions round-trip correctly.
- Decision: REQ-FL-004 pins `(wetBulbC * 9) / 5 + 32`; REQ-WB-005 pins
  `((tempF - 32) * 5) / 9`.
- Why: The order of operations is observable at the boundaries.
- Alternatives: Allow a tolerance at boundaries (makes flags ambiguous).

## D-011: `flagDartLabel` stays in the flag result
- Source: extraction
- Context: The earlier flag result carried a second vocabulary (low, moderate, high, extreme,
  critical) for one consumer application. The earlier output schema required it.
- Decision: Keep it (REQ-FL-001). It is a fixed five-entry mapping.
- Why: Cheap, and removing it would break that consumer for no gain.
- Alternatives: Drop it as consumer-specific.

## D-012: A failed replay match is a `transport_error`
- Source: extraction
- Context: When no replay entry matched, the earlier test adapter threw, and the earlier
  implementation copied the exception's message text into `error` and the summary. Message
  text is not a contract.
- Decision: A fixed code `transport_error` (REQ-CA-001, REQ-CA-003).
- Why: Keeps the audit deterministic across languages.
- Alternatives: Pin a message string (arbitrary).

## D-013: A `null` Open-Meteo field counts as missing
- Source: extraction
- Context: For NWS, both earlier implementations treated `null` values as missing. For
  Open-Meteo, the earlier TypeScript only checked for an absent member, so a `null`
  temperature produced a sample with `tempC: null`; the other implementation treated `null`
  as missing.
- Decision: `null` is missing for both sources (REQ-CA-004).
- Why: A sample without a temperature is useless downstream, and NWS already worked this way.
- Alternatives: Keep the TypeScript behavior (produces invalid samples).

## D-014: The driver protocol is new
- Source: extraction
- Context: The earlier implementation was a library; it had no process interface.
- Decision: § 1 defines a JSON-lines driver with two error categories.
- Why: The suite must judge implementations in any language from outside.
- Alternatives: none practical.

## D-015: A prior verdict with no prior flag skips NO_CHANGE and prints `null`
- Source: extraction
- Context: The earlier schema said `priorFlag` should be null only on the first run, but did
  not forbid a non-null `priorVerdict` with a null `priorFlag`. The earlier TypeScript then
  fell through to the later rules and wrote `null` as the prior flag name in the summary; the
  other implementation failed outright.
- Decision: Keep the TypeScript behavior (REQ-VD-001, REQ-VD-002).
- Why: Defined, harmless output beats a crash.
- Alternatives: Treat it as invalid input (new behavior).

## D-016: `workMinutesRequested` is any finite number
- Source: extraction
- Context: The earlier schema typed it as an integer; the earlier code accepted any finite
  number and only used it for the non-positive marker.
- Decision: Any finite number (REQ-WR-002, REQ-WR-003); fractional values are allowed.
- Why: The value does not affect the result.
- Alternatives: Reject non-integers (new failure mode).

## D-017: `canonical` returns no audit
- Source: extraction
- Context: Every computing operation returns `{result, audit}`. The canonical serializer is a
  utility, exposed so the suite can test number and string rules directly.
- Decision: `canonical` responds with `result` only (REQ-CJ-005).
- Why: An audit of the serializer would itself need serializing; nothing consumes it.
- Alternatives: A trivial audit (noise).

## D-018: Wet-bulb tolerance is ±1e-5 °C
- Source: extraction
- Context: The imported wet-bulb fixtures carry `tolerance_c` 0.00001 and expected values to
  six decimals, generated by evaluating the formula in double precision. Stull's own claimed
  accuracy is about ±0.65 °C against observations; the tolerance here is about agreeing on the
  formula, not about meteorology.
- Decision: REQ-WB-001 pins the term order and constants; the suite applies ±1e-5.
- Why: Any faithful double-precision evaluation passes; a wrong constant does not.
- Alternatives: A looser tolerance (would hide a mistyped constant).

## D-019: Malformed requests are errors, invalid values are results
- Source: extraction
- Context: The earlier library returned `invalid_input` audits for non-finite numbers and
  unknown flag names, which are values a caller can legitimately pass. Missing fields and
  wrong JSON types have no library equivalent once a process boundary exists.
- Decision: Missing fields and wrong JSON types are `bad_request` (REQ-IF-007); non-finite
  numbers and unknown flag or verdict strings are `invalid_input` results.
- Why: Keeps the earlier invalid-input audits intact while giving the driver a clean failure
  for garbage.
- Alternatives: Turn everything into `invalid_input` audits (which field names would the audit
  carry for a missing member?).

## D-020: Output bytes are UTF-8 with LF line ends
- Source: extraction
- Context: Summaries contain `°` and `→`. Some runtimes default standard output to a legacy
  code page or write CRLF line ends on Windows.
- Decision: REQ-IF-003.
- Why: The suite reads bytes; the same driver must behave the same on every platform.
- Alternatives: Accept any line ending (hides a platform difference).

## D-021: Object keys sort by UTF-16 code units
- Source: extraction
- Context: The earlier serializers sorted keys with JavaScript's default comparison, which
  compares UTF-16 code units. That differs from code-point order only for keys mixing
  characters above U+FFFF with characters in U+E000–U+FFFF. All keys in audit records are
  ASCII, so it matters only for the `canonical` operation.
- Decision: REQ-CJ-003 pins UTF-16 code unit order.
- Why: One rule, matching the earlier output.
- Alternatives: Code-point order.

## D-022: Spec examples are computed, and the suite checks them
- Source: r01
- Context: REQ-WB-003 gave `tempC 25, rhPercent 120` ⟶ `Tw=25.00°C`. The formula in
  REQ-WB-001 gives `25.05`. The example had been typed by hand. The r01 builder followed the
  formula and recorded the contradiction (C-1).
- Decision: The example now reads `25.05`; the elided third example is filled in (`25.97`).
  The suite now refuses to load if any wet-bulb or flag example in SPEC.md disagrees with its
  own expectations.
- Why: Where an example and a rule disagree, a builder has to guess which one is the spec.
- Alternatives: Remove computed examples (they are the clearest way to show the formats).

## D-023: Malformed replay entries, streaming and odd request bytes are open
- Source: r01
- Context: r01 had to choose behavior for uncompilable `url_pattern`s, replay entries without
  a status, `body_json: null`, non-finite coordinates, whether to answer line by line or at end
  of input, invalid UTF-8 in requests, and duplicate member names (C-2, C-3, C-7, C-8, C-10).
- Decision: OPEN-CA-004, OPEN-IF-005, and OPEN-CA-002 widened to non-finite coordinates.
  Nothing should depend on these.
- Why: Test data and well-formed callers never produce them; pinning them would add rules
  without adding safety.
- Alternatives: Pin each one (longer spec, no consumer).
