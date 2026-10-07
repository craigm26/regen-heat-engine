## C-1: Wet-bulb example value 25.00 contradicts the formula
- Spec reference: REQ-WB-003 (example `tempC 25, rhPercent 120`), REQ-WB-001
- Situation: contradictory
- What I chose: Follow the formula exactly as written in REQ-WB-001. For T=25, RH=100 it yields Tw=25.05, so the summary is `... → Tw=25.05°C`, not the example's `25.00`.
- Alternatives: Special-case or round to match the example (no consistent rule produces it, and 20/50 → 13.70 matches the formula).
- Should the spec pin this? yes, the example should be corrected (or marked as abbreviated).

## C-2: Invalid regex in `url_pattern`
- Spec reference: REQ-CA-001
- Situation: missing
- What I chose: An entry whose pattern does not compile (or that is not an object / has no string `url_pattern`) is skipped, as if it never matched.
- Alternatives: `bad_request`; transport error.
- Should the spec pin this? no, test data would not use it.

## C-3: Replay entry without a numeric `status`
- Spec reference: REQ-CA-001
- Situation: missing
- What I chose: A matching entry whose `status` is absent or not a number responds with status 200.
- Alternatives: treat as transport error; `bad_request`.
- Should the spec pin this? no.

## C-4: `isoTimestamp` null or wrong type
- Spec reference: REQ-IF-007, § 1.3
- Situation: ambiguous
- What I chose: Optional string; if present it must be a string, otherwise `bad_request` (so `null` is rejected). Same for `priorFlag`, except `null` is accepted there as the spec says.
- Alternatives: treat `null` as absent.
- Should the spec pin this? unsure; a client might send `null` for "none".

## C-5: Order of checks between `input`, `clock` and fields
- Spec reference: REQ-IF-007
- Situation: ambiguous
- What I chose: id → op (`unknown_op`) → `input` object → `clock` (non-canonical ops) → fields in schema order → `responses` (cascade). All yield the same `bad_request`, so order is unobservable except against `unknown_op`.
- Alternatives: none significant.
- Should the spec pin this? no.

## C-6: Non-numeric (non-null) sample values in cascade
- Spec reference: OPEN-CA-001
- Situation: missing (deliberately open)
- What I chose: Values pass through unchanged; a non-numeric wind value is omitted from the sample instead of producing `windMps`.
- Alternatives: report missing_field / parse error.
- Should the spec pin this? no, already open.

## C-7: Input parsing and transport details
- Spec reference: REQ-IF-002, REQ-IF-003
- Situation: missing
- What I chose: Whole stdin is read, then all lines are processed and written at EOF (not streamed). Lines are split on LF only; a trailing CR is ordinary JSON whitespace. Invalid UTF-8 bytes become U+FFFD. Duplicate JSON keys: last wins. Non-finite number in `canonical` (e.g. `1e400`) is written `null`.
- Alternatives: stream per line.
- Should the spec pin this? no.

## C-8: `body_json` presence
- Spec reference: REQ-CA-001
- Situation: ambiguous
- What I chose: `body_json` counts as present when the key exists, even if its value is `null` (body then is `null`, which parses OK and has missing fields).
- Alternatives: fall through to `body_text` on null.
- Should the spec pin this? unsure.

## C-9: `required` field `value` for canonical
- Spec reference: REQ-CJ-005
- Situation: ambiguous
- What I chose: `input.value` must exist as a key (JSON `null` is fine); otherwise `bad_request`.
- Alternatives: treat missing as null.
- Should the spec pin this? no.

## C-10: Non-finite `lat`/`lng` in cascade
- Spec reference: OPEN-CA-002, REQ-AU-002
- Situation: missing
- What I chose: Accepted; written in inputs as `"NaN"` etc. and in URLs via `String()` (`NaN`, `Infinity`).
- Alternatives: invalid input.
- Should the spec pin this? no.
