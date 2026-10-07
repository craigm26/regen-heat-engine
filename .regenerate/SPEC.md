# heat-engine: specification

- Program: `heat-engine`
- Document version: 1.0.0
- Date: 2026-10-07
- Contract version emitted in audits (`spec_version`): `0.2.0` (see D-003)

`heat-engine` is a small calculation library for outdoor heat-stress decisions. It computes
wet-bulb temperature from air temperature and relative humidity (Stull 2011), maps a wet-bulb
temperature to a U.S. Marine Corps heat flag (MCO 6200.1E), looks up the work/rest schedule for
that flag, decides whether an activity should go ahead, be delayed or be moved to an alternate
task, and fetches current weather through a fixed fallback chain (National Weather Service,
then Open-Meteo, then a fixed simulated sample). Every operation returns its result together
with an **audit record**: a tree that says what was computed, from which inputs and constants,
under which citation, and when. Audit records are compared byte for byte, so their serialized
form is part of the contract.

Implementations are judged only from outside, through a line-oriented driver program
(§ Interface). Everything not stated here is open.

Conventions: MUST / MUST NOT are requirements; SHOULD marks an advisory requirement whose
test never fails a run. Requirements have IDs `REQ-<AREA>-<NNN>`. Deliberately unpinned
behavior has IDs `OPEN-<AREA>-<NNN>` (§ Open) and is never tested. "Number" means an IEEE 754
binary64 value (a JavaScript `number`, a Python `float`). Examples use `⟶` to separate input
from output; inside strings, `→` (U+2192) and `°` (U+00B0) are literal characters.

---

## 1. Interface

### 1.1 REGEN.json

**REQ-IF-001.** The implementation folder MUST contain `REGEN.json`, a JSON object with keys
`lang`, `build`, `test` and `driver`. `lang` is `"ts"` or `"py"`. Each of `build`, `test` and
`driver` is either a command string or an object whose keys are Node.js `process.platform`
values (for example `"win32"`) plus a required `"default"` key, each mapping to a command
string. The suite picks the entry for its own platform, else `default`. Example:

```json
{"lang":"py",
 "build":"",
 "test":   {"win32":"py -3 -m unittest -q", "default":"python3 -m unittest -q"},
 "driver": {"win32":"py -3 driver.py",      "default":"python3 driver.py"}}
```

- Commands run with the implementation folder as the working directory.
- `build` and `test` run through the platform shell (cmd.exe on Windows, `/bin/sh` elsewhere).
  An empty `build` string means there is nothing to build.
- `driver` never goes through a shell. The suite splits it on single spaces and starts the
  first word as a program with the remaining words as arguments. It MUST therefore be plain
  space-separated words: no quotes, pipes, redirects, `&&`, or `.cmd` shims such as `npx`.
- Build output, if any, goes in `bin/`.
- The same REGEN.json MUST work on Windows and on Linux; the suite runs on both.

### 1.2 Driver protocol

**REQ-IF-002.** The driver reads requests from standard input and writes responses to standard
output. Each request is one line holding one JSON object. For each non-blank request line the
driver MUST write exactly one response line holding one JSON object, in the same order as the
requests. Blank lines (empty or whitespace only) produce no response. The driver MUST exit
with status 0 after standard input reaches end of file and every response has been written.

**REQ-IF-003.** Standard output MUST be UTF-8. Every response line MUST end with a single
LF (`0x0A`) and MUST NOT contain CR (`0x0D`) anywhere. Nothing other than response lines may
be written to standard output. (Standard error is free; see OPEN-IF-001.)

**REQ-IF-004.** A request has the shape

```
{"id": <string>, "op": <string>, "input": <object>, "clock": <string>, "responses": <array>}
```

- `id` is echoed unchanged in the response.
- `op` names the operation (§ 1.3).
- `input` holds the operation's fields.
- `clock` is required by every operation except `canonical`. It is a UTC timestamp in the
  exact form `YYYY-MM-DDTHH:MM:SS.sssZ` (24 characters). It is the injected clock: every
  `computed_at` in every audit record produced by this request MUST equal it exactly. An
  implementation never reads the wall clock for an audit.
- `responses` appears only on `cascade` requests (§ 8.1).

Example:

```
{"id":"wb-001","op":"wetBulb","input":{"tempC":20,"rhPercent":50},"clock":"2026-01-01T00:00:00.000Z"}
```

**REQ-IF-005.** A successful response for every operation except `canonical` MUST be

```
{"id": <id>, "result": <result object or null>, "audit": <string>}
```

where `audit` is the audit record serialized with the canonical JSON rules of § 2, carried as
a JSON string. `result` is `null` exactly when the operation reports invalid input (each
operation says when). The suite compares `result` as a parsed JSON value (member order does
not matter; numbers compare exactly unless a tolerance is stated) and compares `audit` byte
for byte (after the version substitution described in REQ-AU-001).

**REQ-IF-006.** Numeric input fields accept either a JSON number or one of the three strings
`"NaN"`, `"Infinity"`, `"-Infinity"`, which stand for the corresponding non-finite values.
This is how invalid numeric input reaches the operations. A JSON number in a request MUST be
treated as a binary64 value regardless of how it is written: `20`, `20.0` and `2e1` are the
same input and are serialized identically (`20`).

**REQ-IF-007.** Errors. If a request line cannot be handled, the response MUST be exactly
`{"id": <id>, "error": <category>}` with no other members, and the driver MUST continue with
the next line. Categories:

| Category | When |
|---|---|
| `bad_request` | The line is not a JSON object; `id` is missing or not a string; `input` is missing or not an object; `clock` is missing or not a string when the op needs it; a required input field is missing; an input field has the wrong JSON type (for example a number field holding `true` or `"abc"`, a boolean field holding `1`, a flag field holding a number); `responses` is missing or not an array on `cascade`. |
| `unknown_op` | `op` is missing, not a string, or not one of the operations in § 1.3. |

When the line is not a JSON object, or `id` is missing or not a string, the response `id` is
`null`. Checks happen in the order the table lists them, `unknown_op` before input checks.
Error message text is not part of the contract (OPEN-IF-002); only these two members appear.

### 1.3 Operations

| op | input fields | result |
|---|---|---|
| `wetBulb` | `tempC` (number), `rhPercent` (number) | § 4.1 |
| `wetBulbF` | `tempF` (number), `rhPercent` (number) | § 4.2 |
| `flagF` | `wetBulbF` (number) | § 5.1 |
| `flagC` | `wetBulbC` (number) | § 5.2 |
| `workRest` | `flag` (string), `acclimatized` (boolean), `workMinutesRequested` (number) | § 6 |
| `verdict` | `priorVerdict` (string or null), `priorFlag` (string or null, optional), `currentFlag` (string), `hasAlternateAvailable` (boolean) | § 7 |
| `cascade` | `lat` (number), `lng` (number), `isoTimestamp` (string, optional); plus top-level `responses` | § 8 |
| `canonical` | `value` (any JSON value) | § 2.4 |

Unknown extra members in a request or in `input` are ignored.

---

## 2. Canonical JSON and number text

### 2.1 Number text

**REQ-CJ-001.** Wherever this spec says a number is written "as number text" (canonical JSON,
result summaries, request URLs), a finite number `x` MUST be written exactly as ECMAScript's
`Number::toString(x)` (radix 10) writes it. Restated:

1. If `x` is `+0` or `-0`, write `0`.
2. If `x < 0`, write `-` followed by the text of `-x`.
3. Otherwise let `s` be the shortest string of decimal digits (`k` digits, no trailing zeros
   unless `k = 1`) and `n` an integer such that `s × 10^(n−k)` is the number closest to `x`
   that rounds back to exactly `x`. When several such digit strings of the same length exist,
   take the one whose value is closest to `x`.
4. If `k ≤ n ≤ 21`: write `s` followed by `n − k` zeros.
5. If `0 < n ≤ 21`: write the first `n` digits of `s`, `.`, then the remaining `k − n` digits.
6. If `−6 < n ≤ 0`: write `0.`, then `−n` zeros, then `s`.
7. Otherwise write exponent form: the first digit of `s`; if `k > 1`, `.` and the remaining
   digits; then `e`, then `+` or `-` for the sign of `n − 1`, then `|n − 1|` in decimal.

| x | text |
|---|---|
| 5 | `5` |
| 1.5 | `1.5` |
| 0.1 + 0.2 | `0.30000000000000004` |
| 1e20 | `100000000000000000000` |
| 1e21 | `1e+21` |
| 1e-6 | `0.000001` |
| 1e-7 | `1e-7` |
| 1.23e-18 | `1.23e-18` |
| -0 | `0` |

Note that this is **not** C `%g`, Python `repr` (which gives `1e-07` and `1e+20`), or Java
`Double.toString`.

### 2.2 Fixed-point text

**REQ-CJ-002.** Where this spec says "fixed to `f` places" (`f` = 1, 2 or 4), a finite number
`x` MUST be written as ECMAScript's `Number.prototype.toFixed(f)` writes it:

1. If `|x| ≥ 1e21`, write the number text of `x` (REQ-CJ-001).
2. If `x < 0` (strictly), write `-` followed by the fixed text of `-x`. `-0` is not less than
   zero, so it is written like `+0`.
3. Otherwise let `m` be the integer for which `m / 10^f − x` is closest to zero, using the
   **exact** binary value of `x`. If two integers are equally close (an exact tie), take the
   larger `m`. Write `m` in decimal, left-padded with zeros to at least `f + 1` digits, with a
   `.` inserted before the last `f` digits.

| x | f | text |
|---|---|---|
| 20.25 | 1 | `20.3` (20.25 is exact in binary, so this is a true tie; round up) |
| -20.25 | 1 | `-20.3` |
| 2.675 | 2 | `2.67` (the binary value is just below 2.675) |
| 0.125 | 2 | `0.13` |
| -0.04 | 1 | `-0.0` |
| -0 | 1 | `0.0` |

Note that Python's `format(x, '.1f')` rounds exact ties to even (`20.2`), and so differs.

### 2.3 Serialization

**REQ-CJ-003.** The canonical JSON text of a value has no whitespace outside strings and is
built as follows:

- `null`, `true`, `false` as those words.
- A finite number as number text (REQ-CJ-001).
- A string as `"`, then each UTF-16 code unit escaped as below, then `"`.
- An array as `[`, its elements in order separated by `,`, then `]`.
- An object as `{`, its members separated by `,`, then `}`. Each member is the key written as
  a string, `:`, then the value. Members are ordered by key, ascending, comparing keys as
  sequences of **UTF-16 code units** (not code points). An object member whose value is absent
  is omitted; a member whose value is `null` is written.

**REQ-CJ-004.** String escaping, per UTF-16 code unit `c`:

| c | written as |
|---|---|
| `0x22` `"` | `\"` |
| `0x5C` `\` | `\\` |
| `0x08` | `\b` |
| `0x0C` | `\f` |
| `0x0A` | `\n` |
| `0x0D` | `\r` |
| `0x09` | `\t` |
| any other `c < 0x20` | `\u` and 4 **lowercase** hex digits (`\u001f`) |
| a surrogate code unit (`0xD800`–`0xDFFF`) not part of a valid high-low pair | `\u` and 4 lowercase hex digits (`\ud800`) |
| everything else, including `/`, `0x7F`, U+2028 and valid surrogate pairs | the character itself |

The resulting text is encoded as UTF-8 wherever it is written as bytes.

### 2.4 The `canonical` operation

**REQ-CJ-005.** `canonical` takes `input.value`, any JSON value, and responds
`{"id": <id>, "result": <string>}` where the string is the canonical JSON text of the value
(§ 2.3). It has no `audit` member and needs no `clock`. JSON numbers in `value` are binary64
values (REQ-IF-006); the special strings of REQ-IF-006 are **not** interpreted here (they are
ordinary strings). Example:

```
{"id":"c1","op":"canonical","input":{"value":{"b":[1,2.50,1e21],"a":null}}}
⟶ {"id":"c1","result":"{\"a\":null,\"b\":[1,2.5,1e+21]}"}
```

---

## 3. Audit records

**REQ-AU-001.** Every audit record is a JSON object with these members, always present:

| member | value |
|---|---|
| `spec_version` | the string `"0.2.0"` |
| `function` | the operation's function name (given per operation) |
| `inputs` | an object of the inputs, as each operation specifies |
| `constants` | an object mapping constant names to numbers, as each operation specifies (possibly empty) |
| `citation` | a fixed string per operation |
| `result_summary` | a one-line human-readable string, as each operation specifies |
| `computed_at` | the request's `clock` |

Some operations add further members (`children`, `source_chain`, `sources_tried`,
`fallback_reason`, `prior_flag`, `next_flag`, `promotion_rule`); no other members appear.
Imported fixtures from an earlier contract carry `"spec_version":"0.1.1"`; the suite checks
`spec_version` in dedicated cases and, in all other audit comparisons, replaces the
`spec_version` value in both expected and actual text with the current value before comparing
bytes (D-003).

**REQ-AU-002.** In `inputs`, a non-finite number MUST be written as the string `"NaN"`,
`"Infinity"` or `"-Infinity"` (not as `null`).

**REQ-AU-003.** `children`, where present, is an array of complete audit records (each with
every member of REQ-AU-001 and the same `computed_at`).

---

## 4. Wet-bulb temperature (Stull 2011)

Primary source: Stull, R. (2011), *Wet-Bulb Temperature from Relative Humidity and Air
Temperature*, J. Appl. Meteor. Climatol. 50(11):2267–2269, DOI 10.1175/JAMC-D-11-0143.1.

### 4.1 `wetBulb`

**REQ-WB-001.** For finite `tempC` (T, °C) and `rhPercent`, let `RH` be `rhPercent` clamped to
the closed range [5, 100] (below 5 becomes 5, above 100 becomes 100). Compute, in binary64,
evaluating exactly these terms in this order:

```
term1 = T * atan(0.151977 * sqrt(RH + 8.313659))
term2 = atan(T + RH)
term3 = atan(RH - 1.676331)
term4 = 0.00391838 * RH^1.5 * atan(0.023101 * RH)
wetBulbC = term1 + term2 - term3 + term4 + (-4.686035)
wetBulbF = (wetBulbC * 9) / 5 + 32
```

`RH^1.5` is the library power function with exponent 1.5. The result MUST be
`{"wetBulbC": wetBulbC, "wetBulbF": wetBulbF}`, plus `"clampedRhPct": RH` only when
`RH ≠ rhPercent`. The suite accepts `wetBulbC` within ±1e-5 of the expected value and
`wetBulbF` within ±(1e-5 × 9/5 + 1e-9).

**REQ-WB-002.** Temperatures outside [-20, 50] °C still compute a result (no clamping of T).

**REQ-WB-003.** The audit record for a finite computation:

- `function`: `"calculateWetBulb"`; `citation`: `"Stull (2011) eq. 1"`.
- `inputs`: `{"tempC": tempC, "rhPercent": rhPercent}`, with the values as given (before
  clamping).
- `constants`: `stull_a` 0.151977, `stull_b` 8.313659, `stull_c` 1.676331, `stull_d`
  0.00391838, `stull_e` 0.023101, `stull_offset` -4.686035; when RH was clamped, also
  `rh_clamp_min` 5 and `rh_clamp_max` 100.
- `result_summary`: `T=<T>°C RH=<rh><markers> → Tw=<Tw>°C`, where
  - `<T>` is `tempC` fixed to 1 place (REQ-CJ-002);
  - `<rh>` is `<RH>%` when not clamped, or `<rhPercent>→<RH>%` when clamped, both as number
    text (REQ-CJ-001);
  - `<markers>` is empty, or ` (` + a comma-separated list + `)`: `rh_clamped` when clamped,
    then `out_of_validity_range` when `tempC < -20` or `tempC > 50`;
  - `<Tw>` is `wetBulbC` fixed to 2 places.

Examples:
- `tempC 20, rhPercent 50` ⟶ `T=20.0°C RH=50% → Tw=13.70°C`
- `tempC 25, rhPercent 120` ⟶ `T=25.0°C RH=120→100% (rh_clamped) → Tw=25.00°C`
- `tempC 60, rhPercent 2.5` ⟶ `T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=…`

**REQ-WB-004.** If `tempC` or `rhPercent` is not finite, the result MUST be `null` and the audit
MUST have `function` and `citation` as above, `inputs` with both values (REQ-AU-002),
`constants` `{}`, and `result_summary` `invalid_input:tempC` if `tempC` is not finite,
otherwise `invalid_input:rhPercent`.

### 4.2 `wetBulbF`

**REQ-WB-005.** `wetBulbF` takes `tempF` and `rhPercent`, computes
`tempC = ((tempF - 32) * 5) / 9` in binary64 (this exact expression), and then behaves exactly
as `wetBulb` with that `tempC` and the same `rhPercent`. The result and the audit are those of
`wetBulb` (`function` is `"calculateWetBulb"`; `inputs` holds the converted `tempC`). A
non-finite `tempF` gives a non-finite `tempC` and so `invalid_input:tempC`.

Example: `tempF 68, rhPercent 50` ⟶ same result and audit as `tempC 20, rhPercent 50`.

---

## 5. Heat flags (MCO 6200.1E)

Primary source: U.S. Marine Corps Order 6200.1E, Marine Corps Heat Stress Program. The flag
bands are defined in °F, with inclusive lower bounds:

| flag | wet-bulb °F | label |
|---|---|---|
| `white` | `w < 80` | `low` |
| `green` | `80 ≤ w < 85` | `moderate` |
| `yellow` | `85 ≤ w < 88` | `high` |
| `red` | `88 ≤ w < 90` | `extreme` |
| `black` | `w ≥ 90` | `critical` |

### 5.1 `flagF`

**REQ-FL-001.** For finite `wetBulbF`, the result MUST be
`{"flag": <flag>, "flagDartLabel": <label>}` from the table above. Comparisons are on the
binary64 value as given (`79.99` is white, `80` is green).

**REQ-FL-002.** The audit: `function` `"flagFromWetBulbF"`; `citation`
`"USMC 6200.1E Table 3-1"`; `inputs` `{"wetBulbF": wetBulbF}`; `constants`
`{"white_max":80,"green_max":85,"yellow_max":88,"red_max":90}`; `result_summary`
`wetBulbF=<w> → <flag>` with `<w>` as number text, followed by ` (out_of_observed_range)`
when `wetBulbF < -50` or `wetBulbF > 200`.

Examples: `85` ⟶ `wetBulbF=85 → yellow`; `250` ⟶ `wetBulbF=250 → black (out_of_observed_range)`.

**REQ-FL-003.** For non-finite `wetBulbF` the result MUST be `null`; the audit has the same
`function` and `citation`, `inputs` per REQ-AU-002, `constants` `{}`, and `result_summary`
`invalid_input:wetBulbF`.

### 5.2 `flagC`

**REQ-FL-004.** For finite `wetBulbC`, compute `wetBulbF = (wetBulbC * 9) / 5 + 32` in binary64,
with exactly this expression (not `wetBulbC * 1.8 + 32`, which rounds differently near the
boundaries), then classify as `flagF`. The result MUST be the `flagF` result.

Example: `wetBulbC 26.66666666666666` gives `79.99999999999999` °F, so `white`.

**REQ-FL-005.** The audit: `function` `"flagFromWetBulbC"`; `citation`
`"USMC 6200.1E Table 3-1"`; `inputs` `{"wetBulbC": wetBulbC}`; the same four `constants` as
`flagF`; `result_summary` `wetBulbC=<c> → wetBulbF=<f> → <flag>`, with `<c>` as number text and
`<f>` fixed to 4 places; and `children`: an array of one element, the complete `flagF` audit
record for the converted value.

Example: `30` ⟶ `wetBulbC=30 → wetBulbF=86.0000 → yellow`.

**REQ-FL-006.** For non-finite `wetBulbC` the result MUST be `null`; the audit has `function`
`"flagFromWetBulbC"`, the same `citation`, `inputs` per REQ-AU-002, `constants` `{}`,
`result_summary` `invalid_input:wetBulbC`, and no `children`.

---

## 6. Work/rest (MCO 6200.1E §3.2)

**REQ-WR-001.** For a valid flag, the result MUST be
`{"workMinutes", "restMinutes", "cyclesUntilReassessRequired", "ceaseWork"}` from this table
(minutes per hour; `null` means no scheduled reassessment):

| flag | acclimatized | unacclimatized |
|---|---|---|
| white | 60 / 0, null | 50 / 10, null |
| green | 50 / 10, null | 40 / 20, null |
| yellow | 45 / 15, 6 | 30 / 30, 4 |
| red | 30 / 30, 4 | cease work |
| black | 10 / 50, 1 | cease work |

"Cease work" is `{"workMinutes":0,"restMinutes":0,"cyclesUntilReassessRequired":null,"ceaseWork":true}`;
every other cell has `ceaseWork` false. `workMinutesRequested` does not change the result.

**REQ-WR-002.** The audit: `function` `"workRestForFlag"`; `citation` `"USMC 6200.1E §3.2"`;
`inputs` `{"flag","acclimatized","workMinutesRequested"}` as given. Let `branch` be `acclim`
or `unacclim`.

- `constants`: empty for a cease-work cell. Otherwise `<flag>_work_<branch>` and
  `<flag>_rest_<branch>` with the cell's minutes, and when the cell has a reassessment count,
  `<flag>_reassess_cycles` (acclimatized) or `<flag>_reassess_cycles_unacclim`
  (unacclimatized) with that count. Example (yellow, acclimatized):
  `{"yellow_work_acclim":45,"yellow_rest_acclim":15,"yellow_reassess_cycles":6}`.
- `result_summary`:
  - cease work: `<flag>/<branch> → cease_work`
  - reassessment count 1: `<flag>/<branch> → <w>w/<r>r, reassess every cycle`
  - reassessment count n > 1: `<flag>/<branch> → <w>w/<r>r, reassess after <n> cycles`
  - no reassessment: `<flag>/<branch> → <w>w/<r>r`
  - then, if `workMinutesRequested ≤ 0`, append ` (non_positive_work_window)`.

Examples: `black/acclim → 10w/50r, reassess every cycle`; `green/acclim → 50w/10r (non_positive_work_window)`.

**REQ-WR-003.** Invalid input gives result `null`, `constants` `{}`, and is checked in this
order:
1. `flag` is a string but not one of the five flags ⟶ `result_summary` `invalid_input:flag`,
   `inputs` as given.
2. `workMinutesRequested` is not finite ⟶ `invalid_input:workMinutesRequested`, `inputs` with
   the value per REQ-AU-002.

---

## 7. Verdict promotion

**REQ-VD-001.** The verdict is chosen by the first of these five rules that applies, in this
priority order (severity: white 0, green 1, yellow 2, red 3, black 4):

| # | rule | applies when | verdict | changedFromPrior |
|---|---|---|---|---|
| 1 | `FIRST_RUN_DEFAULT` | `priorVerdict` is null | `delay` if `currentFlag` is red or black, else `go` | false |
| 2 | `NO_CHANGE` | `priorFlag` equals `currentFlag` | `priorVerdict`, unchanged | false |
| 3 | `ALTERNATE_AVAILABLE_AT_BLACK` | `currentFlag` is black and `hasAlternateAvailable` is true | `alternate` | `priorVerdict ≠ verdict` |
| 4 | `ESCALATE_TO_DELAY_ON_RED_OR_BLACK` | `currentFlag` is red or black | `delay` | `priorVerdict ≠ verdict` |
| 5 | `DEESCALATE_TO_GO` | otherwise | `go` | `priorVerdict ≠ verdict` |

The result MUST be `{"verdict", "changedFromPrior", "promotionRule"}` with `promotionRule` the
rule name. A missing `priorFlag` means `null`. A `null` `priorFlag` never equals a flag, so a
non-null `priorVerdict` with a null `priorFlag` skips rule 2.

**REQ-VD-002.** The audit: `function` `"promoteVerdict"`; `citation`
`"Go/delay/alternate promotion matrix"` (D-004); `inputs`
`{"priorVerdict","priorFlag","currentFlag","hasAlternateAvailable"}` (with `priorFlag` `null`
when missing); `constants` `{}`; plus `prior_flag` (the prior flag or `null`), `next_flag`
(`currentFlag`) and `promotion_rule` (the rule name). `result_summary` by rule:

| rule | summary |
|---|---|
| 1 | `first run, <current> → <verdict>` |
| 2 | `no_change, <current> → <verdict>`, then ` (held)` if `priorVerdict` is `delay` |
| 3 | `<prior> → <current> + alternate → alternate` |
| 4 | `<prior> → <current>, escalate to delay` |
| 5 | `<prior> → <current>, deescalate to go` |

`<prior>` is the prior flag name, or the four characters `null` when it is null.

**REQ-VD-003.** Invalid input gives result `null`, `constants` `{}`, `inputs` as given (with
`priorFlag` `null` when missing), no `prior_flag`/`next_flag`/`promotion_rule` members, and is
checked in this order:
1. `currentFlag` not one of the five flags ⟶ `invalid_input:currentFlag`
2. `priorVerdict` non-null and not `go`, `delay` or `alternate` ⟶ `invalid_input:priorVerdict`
3. `priorFlag` non-null and not one of the five flags ⟶ `invalid_input:priorFlag`

---

## 8. Weather cascade

Primary sources: National Weather Service API documentation (api.weather.gov); Open-Meteo
forecast API documentation (open-meteo.com).

### 8.1 Replayed HTTP

**REQ-CA-001.** A `cascade` request carries `responses`, an array of replay entries:

```
{"url_pattern": <string>, "status": <integer>, "body_json": <any JSON>, "body_text": <string>, "simulate": "timeout"}
```

(`body_json`, `body_text` and `simulate` are optional.) The implementation MUST make every HTTP
request of the cascade through these entries and MUST NOT touch the network. For a request
URL, the entry used is the **first** one, in array order, whose `url_pattern`, compiled as a
regular expression (ECMAScript syntax; the patterns used are also valid in Python's `re`), finds
a match anywhere in the URL (unanchored search). Then:

- If no entry matches, the request fails with a **transport error**.
- If the entry has `"simulate": "timeout"`, the request fails with a **timeout**.
- Otherwise the response has status `status` and body: if `body_json` is present, its JSON
  serialization (`JSON.stringify`-equivalent; formatting does not matter because it is only
  parsed); else `body_text`; else the empty string.

### 8.2 Sources and order

**REQ-CA-002.** The cascade tries sources in this order and stops at the first that yields a
sample:

1. `nws`: GET `https://api.weather.gov/points/<lat>,<lng>/observations/latest`
2. `open-meteo`: GET
   `https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lng>&current=temperature_2m,relative_humidity_2m,wind_speed_10m`
3. `simulated`: no request; the sample is `{"tempC":20,"rhPercent":50,"source":"simulated"}`.

`<lat>` and `<lng>` are number text (REQ-CJ-001). Each live source has a timeout budget of
5000 ms (only observable through the audit; see REQ-CA-006). These URLs are request
identifiers for replay matching; see D-008 about the first one.

**REQ-CA-003.** A live source attempt ends in one of these outcomes, checked in this order:

1. timeout ⟶ status `timeout`, error `timeout`
2. transport error ⟶ status `error`, error `transport_error`
3. HTTP status ≥ 400 ⟶ status `error`, error `http_<status>` (e.g. `http_500`)
4. body is not valid JSON ⟶ status `error`, error `parse_error`
5. required field missing ⟶ status `error`, error `missing_field:<name>` (below)
6. otherwise ⟶ status `ok`, and a sample.

**REQ-CA-004.** Parsing `nws`: let `p` be the body's `properties` object. Temperature is
`p.temperature.value` (°C), humidity `p.relativeHumidity.value` (%), wind `p.windSpeed.value`.
If temperature is missing or `null` (including when `properties` or `temperature` is absent or
not an object, or the body is not an object), the error is `missing_field:temperature`; else
if humidity is missing or `null`, `missing_field:relativeHumidity`. The sample is
`{"tempC", "rhPercent", "source":"nws"}`, plus `"windMps"` when wind is present and not null.

Parsing `open-meteo`: let `c` be the body's `current` object. Temperature is
`c.temperature_2m`, humidity `c.relative_humidity_2m`, wind `c.wind_speed_10m`. Missing or
`null` temperature gives `missing_field:temperature_2m`; else missing or `null` humidity gives
`missing_field:relative_humidity_2m`. The sample is `{"tempC", "rhPercent", "source":"open-meteo"}`,
plus `"windMps"` when wind is present and not null.

**REQ-CA-005.** Both services report wind speed in km/h (NWS `wmoUnit:km_h-1`; Open-Meteo's
default `wind_speed_unit`). `windMps` MUST be the reported value divided by 3.6, computed as
`value / 3.6` in binary64. Example: `3.1` ⟶ `0.8611111111111112`. (D-006)

The cascade result is `{"sample": <sample>}`. It is never `null`.

### 8.3 Cascade audit

**REQ-CA-006.** Each attempted live source produces a **child audit**:

- `function` `"fetchWeatherCascade.nws"` or `"fetchWeatherCascade.open-meteo"`;
- `citation` `"api.weather.gov"` or `"api.open-meteo.com"`;
- `inputs` `{"lat", "lng"}` plus `"isoTimestamp"` when the request has it;
- `constants` `{"nws_timeout_ms":5000}` or `{"open_meteo_timeout_ms":5000}`;
- `result_summary`: `<source> OK in 0ms` for an ok attempt, `<source> timeout`, or
  `<source> <error>` (e.g. `nws http_500`, `nws missing_field:temperature`,
  `open-meteo transport_error`).

Each attempt also produces a `sources_tried` entry: `{"source", "status", "duration_ms"}` plus
`"error"` when status is not `ok`. `duration_ms` is **not a measurement**: it is `5000` (the
source's budget) for a timeout and `0` otherwise (D-005).

**REQ-CA-007.** The top-level cascade audit:

- `function` `"fetchWeatherCascade"`; `citation` `"Cascade order: NWS → Open-Meteo → simulated"`;
- `inputs` as for the children;
- `constants` `{"nws_timeout_ms":5000,"open_meteo_timeout_ms":5000}`, plus
  `"simulated_temp_c":20,"simulated_rh_percent":50` when the simulated sample is used;
- `source_chain`: the sources in the order they were reached, including `simulated` when it is
  used (e.g. `["nws","open-meteo"]`);
- `sources_tried`: one entry per live attempt, in order;
- `children`: one child audit per live attempt, in order;
- `fallback_reason`: absent when `nws` succeeded; when `open-meteo` succeeded, the **fallback
  text** below; when the simulated sample is used, `all_live_sources_failed`;
- `result_summary`:
  - `nws` succeeded: `cascade → nws OK (tempC=<t>, rhPercent=<rh>)`
  - `open-meteo` succeeded: `cascade → open-meteo OK (tempC=<t>, rhPercent=<rh>) after <fallback text>`
  - simulated: `cascade → simulated (all_live_sources_failed)`

  with `<t>` and `<rh>` as number text of the sample's values.

The **fallback text** describes the `nws` attempt: `nws timeout`; `nws missing fields` for any
`missing_field:` error; otherwise `nws <error>` (e.g. `nws http_500`, `nws parse_error`,
`nws transport_error`).

---

## 9. Budgets

**REQ-BU-001.** Runtime: TypeScript on Node.js 22.18 or later, run directly by type
stripping (erasable syntax only; no build step); Python 3.11 or later.

**REQ-BU-002.** Dependencies: the language's standard library only. No packages are
installed.

**REQ-BU-003.** Size: at most 800 non-blank lines per implementation. Count non-blank lines in
source files (ts: `.ts .mts .mjs .js`; py: `.py`) under the implementation folder, excluding
test files (`*.test.*`, `*_test.*`, `test_*.py`, and anything under a `test/` or `tests/`
folder).

(The budgets are checked by the scorer, not by suite cases.)

---

## 10. Open

These are deliberately unpinned. Nothing should depend on them, and the suite never tests
them.

- **OPEN-IF-001.** What the driver writes to standard error.
- **OPEN-IF-002.** Any human-readable error text; it never appears in a response.
- **OPEN-IF-003.** Behavior for a `clock` string that is not in the exact 24-character form.
- **OPEN-IF-004.** Library structure: module layout, exported names, internal types, and
  whether a real HTTP client exists. Live network fetching is outside this spec.
- **OPEN-WB-001.** Results when the computation overflows or loses all precision (inputs of
  enormous magnitude); the result and summary for such inputs are unspecified.
- **OPEN-WB-002.** Results more precise than the stated tolerance.
- **OPEN-CJ-001.** Canonical text for JSON numbers outside the binary64 range (e.g. `1e400`).
- **OPEN-CA-001.** Cascade behavior when a field that should be numeric holds a non-numeric,
  non-null value (e.g. a string temperature).
- **OPEN-CA-002.** Validation of `lat`/`lng` ranges.
- **OPEN-CA-003.** The exact request headers or method details beyond "GET this URL".
