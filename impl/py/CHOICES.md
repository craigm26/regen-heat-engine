## C-1: Malformed replay entries
- Spec reference: OPEN-CA-004
- Situation: missing
- What I chose: An entry that is not an object, lacks a string `url_pattern`, or has an invalid regex is skipped (as if it did not match). A matching entry without a numeric `status` is a transport error. `body_json: null` counts as present (body `null`, so a missing-field error).
- Alternatives: Treat an invalid regex as a bad_request; treat missing status as 200.
- Should the spec pin this? no, already open.

## C-2: Non-finite coordinates
- Spec reference: OPEN-CA-002
- Situation: missing
- What I chose: Written as the strings "NaN"/"Infinity"/"-Infinity" in audit inputs (consistent with REQ-AU-002); the URL contains the same words via number text; no range validation of lat/lng.
- Alternatives: `null`; bad_request.
- Should the spec pin this? no, nothing consumes it.

## C-3: Non-numeric weather values
- Spec reference: OPEN-CA-001
- Situation: missing
- What I chose: A temperature or humidity that is not a number (string, bool, object) counts as a missing field; a non-numeric wind is treated as absent.
- Alternatives: parse_error; coerce strings.
- Should the spec pin this? no.

## C-4: Streaming and bad bytes
- Spec reference: OPEN-IF-005
- Situation: missing
- What I chose: Read all of stdin, decode UTF-8 with replacement for bad bytes, split on LF only, answer all lines at the end. Duplicate JSON members: last wins. Lines split only on `\n` (a trailing `\r` is JSON whitespace).
- Alternatives: Answer line by line.
- Should the spec pin this? no.

## C-5: Responses are written ASCII-escaped
- Spec reference: REQ-IF-003
- Situation: ambiguous
- What I chose: Response lines are JSON written with `\uXXXX` escapes for all non-ASCII (valid UTF-8, since pure ASCII), so lone surrogates in echoed ids cannot break encoding. Parsed values are identical.
- Alternatives: Raw UTF-8 output of `°`/`→`.
- Should the spec pin this? unsure: a byte-level check of the response line would differ; the spec only says the suite compares parsed JSON.

## C-6: Python-specific JSON edge cases
- Spec reference: REQ-IF-001, OPEN-CJ-001
- Situation: missing
- What I chose: Bare `NaN`/`Infinity` JSON literals in a request make the line unparseable (bad_request, id null). Numbers beyond binary64 become infinity; in `canonical` a non-finite number is written `null`. Any unexpected exception while handling becomes `bad_request` with the id.
- Alternatives: Accept the literals.
- Should the spec pin this? no (OPEN-CJ-001 covers it; the literals are not JSON).

## C-7: Extra type strictness
- Spec reference: REQ-IF-007
- Situation: ambiguous
- What I chose: `priorVerdict` is required (must be present, string or null); `priorFlag` may be absent or null. `canonical` needs `input` to be an object containing `value`; otherwise bad_request. `clock` is not format-checked (OPEN-IF-003).
- Alternatives: Treat missing priorVerdict as null.
- Should the spec pin this? no; the table says "string or null" without "optional" so required is the natural reading.

## C-8: flagC overflow
- Spec reference: OPEN-FL-001
- Situation: missing
- What I chose: An infinite converted value is classified by sign (black / white) with a summary built from the clamped child; not tested.
- Alternatives: invalid_input.
- Should the spec pin this? no.

## C-9: Layout
- Spec reference: REQ-IF-001, OPEN-IF-004
- Situation: missing
- What I chose: Library in `heat.py`, tiny `driver.py`; a cascade's `windMps` is `value / 3.6` for any numeric wind; integer JSON numbers in `workMinutesRequested` etc. are carried as floats and written via number text.
- Alternatives: single file.
- Should the spec pin this? no.
