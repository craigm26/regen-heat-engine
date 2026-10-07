## C-1: Check order for unknown_op vs. bad_request
- Spec reference: REQ-IF-007
- Situation: contradictory
- What I chose: Non-object line / bad `id` first (id null), then `unknown_op`, then `input` object, then `clock`, then field checks, then `responses` (cascade).
- Alternatives: Strictly table order (bad_request rows before unknown_op).
- Should the spec pin this? no, the text "unknown_op before input checks" is clear enough; the table wording is just loose.

## C-2: `canonical` with missing `input.value`
- Spec reference: REQ-CJ-005, REQ-IF-007
- Situation: ambiguous
- What I chose: A missing `value` member is `bad_request`; explicit `null` is a valid value.
- Alternatives: Treat missing as null.
- Should the spec pin this? no.

## C-3: `isoTimestamp` of wrong type or null
- Spec reference: § 1.3
- Situation: ambiguous
- What I chose: Present but not a string (including `null`) is `bad_request`; absent means omitted.
- Alternatives: Treat `null` as absent.
- Should the spec pin this? unsure; a client may send null for "optional".

## C-4: Malformed replay entries
- Spec reference: OPEN-CA-004
- Situation: missing
- What I chose: Entries that are not objects or lack a string `url_pattern`, or whose pattern fails to compile, never match. A matching entry without a numeric `status` is a transport error. `body_json: null` falls through to `body_text`/empty.
- Alternatives: Treat as bad_request.
- Should the spec pin this? no (already open).

## C-5: Non-numeric cascade sample values, non-finite lat/lng
- Spec reference: OPEN-CA-001, OPEN-CA-002
- Situation: missing
- What I chose: Values pass through unchecked; non-finite lat/lng are accepted as numbers (URLs use `String(x)`, audit inputs hold raw numbers, which serialize as `null`).
- Alternatives: Validate and reject.
- Should the spec pin this? no (already open).

## C-6: Flag conversion overflow in flagC
- Spec reference: REQ-FL-004
- Situation: missing
- What I chose: If `wetBulbC` is finite but converts to a non-finite °F value, the result is the null from the child `flagF` and the summary uses `invalid_input` as the flag name.
- Alternatives: Treat as invalid wetBulbC.
- Should the spec pin this? no, only reachable with ~1e308 inputs.

## C-7: Driver output timing and blank-line splitting
- Spec reference: OPEN-IF-005, REQ-IF-002
- Situation: ambiguous
- What I chose: Read all stdin, split on LF, answer everything at end of input in one write. CR in a line is treated as whitespace by JSON parsing; whitespace-only lines are skipped.
- Alternatives: Stream line by line.
- Should the spec pin this? no.

## C-8: Out-of-range JSON numbers
- Spec reference: OPEN-CJ-001
- Situation: missing
- What I chose: `1e400` parses to Infinity; in `canonical` it is written `null`; as an operation input it is treated as non-finite (inputs shown as "Infinity").
- Alternatives: bad_request.
- Should the spec pin this? no (open).

## C-9: Extra verdict/input type details
- Spec reference: REQ-IF-007, § 1.3
- Situation: ambiguous
- What I chose: `priorVerdict` is required (missing is bad_request); `priorFlag` missing or null both mean null; non-string non-null `priorFlag`/`priorVerdict` is bad_request.
- Alternatives: Treat missing `priorVerdict` as null.
- Should the spec pin this? yes, "string or null" without "optional" for priorVerdict is easy to misread.

## C-10: Only 3xx statuses and `status` handling
- Spec reference: REQ-CA-003
- Situation: missing
- What I chose: Statuses below 400 (including 1xx/3xx) are treated as success and the body is parsed.
- Alternatives: Treat non-2xx as errors.
- Should the spec pin this? no.
