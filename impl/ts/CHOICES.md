## C-1: Non-finite lat/lng in cascade
- Spec reference: OPEN-CA-002
- Situation: missing
- What I chose: Audit inputs use the REQ-AU-002 strings; the URL uses JS number text (`NaN`, `Infinity`); no validation of ranges.
- Alternatives: null in inputs; bad_request.
- Should the spec pin this? no, it is already open.

## C-2: Malformed replay entries
- Spec reference: OPEN-CA-004
- Situation: missing
- What I chose: An invalid regex counts as no match; an entry without a numeric `status` that matches is a transport error; `body_json: null` is serialized as `null` (valid JSON, so a missing_field error); entries that are not objects are skipped.
- Alternatives: crash; bad_request.
- Should the spec pin this? no.

## C-3: Non-numeric weather field values
- Spec reference: OPEN-CA-001
- Situation: missing
- What I chose: Any non-null value counts as present and is copied as is; wind is divided by 3.6 whatever its type.
- Alternatives: treat non-numbers as missing.
- Should the spec pin this? no.

## C-4: Output buffering and input decoding
- Spec reference: OPEN-IF-005
- Situation: missing
- What I chose: Read all of stdin, then write all responses at once. Lines are split on LF; a trailing CR is ordinary JSON whitespace. Duplicate request keys: the last one wins (JSON.parse).
- Alternatives: stream line by line.
- Should the spec pin this? no.

## C-5: Which fields may be null
- Spec reference: REQ-IF-007, § 1.3
- Situation: ambiguous
- What I chose: `priorVerdict` is required but may be null; `priorFlag` is optional and may be null; `isoTimestamp` is optional and null gives bad_request; `input` as an array is bad_request; a `canonical` request without `value` is bad_request.
- Alternatives: allow null isoTimestamp.
- Should the spec pin this? unsure; "optional string field holding null" vs priorFlag "string or null, optional" is easy to misread.

## C-6: Non-finite numbers in canonical output
- Spec reference: REQ-CJ-003, OPEN-CJ-001
- Situation: missing
- What I chose: Written as `null` (only reachable via 1e400 input).
- Alternatives: error.
- Should the spec pin this? no.

## C-7: Invalid-input precedence with non-finite workMinutesRequested
- Spec reference: REQ-WR-003
- Situation: ambiguous
- What I chose: With a bad flag and a non-finite `workMinutesRequested`, the flag error wins (as the order says) and inputs still show the string form.
- Alternatives: none really.
- Should the spec pin this? no.

## C-8: Only the first cascade failure feeds fallback text
- Spec reference: REQ-CA-007
- Situation: ambiguous
- What I chose: The fallback text is built from the nws attempt, which is always the first attempt, whenever open-meteo succeeds.
- Alternatives: none.
- Should the spec pin this? no.

## C-9: clock
- Spec reference: OPEN-IF-003
- Situation: missing
- What I chose: Any string is accepted and echoed without validation.
- Alternatives: bad_request on malformed form.
- Should the spec pin this? no.
