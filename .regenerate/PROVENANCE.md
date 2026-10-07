# Provenance

How every version of this program was made. Machine-readable record: `ledger.jsonl`.

## Runs

| Run | Kind | Spec tag | Model | Lang | Outcome | Suite | Own tests | Clean | Notes |
|---|---|---|---|---|---|---|---|---|---|
| r00 | reference | spec-v1.0.0 | — | earlier TS implementation via adapter | finished | 294/336 (n/a 26) | — | — | all 42 failures explained (below) |
| r01 | blind | spec-v1.0.0 | claude-sonnet-5-5 | ts | finished | 362/362 | 22/22 | no | C-1 clarify: a spec example was wrong; 19 turns, 3.4 min, $0.60 |
| r00.1 | reference | spec-v1.0.1 | — | earlier TS implementation | finished | 294/336 (n/a 26) | — | — | same 42 explained failures |
| r02 | blind | spec-v1.0.1 | claude-sonnet-5-5 | ts | finished | 362/362 | 14/14 | no | C-1 clarify: REQ-IF-007 check order contradicted itself; 16 turns, 2.8 min, $0.49 |
| r00.2 | reference | spec-v1.0.2 | — | earlier TS implementation | finished | 294/336 (n/a 28) | — | — | same 42 explained failures |
| r03 | blind | spec-v1.0.2 | claude-sonnet-5-5 | ts | finished | 364/364 | 12/12 | **yes** | first clean run; 18 turns, 3.1 min, $0.44 |
| r04 | blind | spec-v1.0.2 | claude-sonnet-5-5 | py | finished | 364/364 | 27/27 | **yes** | second language clean; 13 turns, 2.5 min, $0.43 |

Published 2026-10-07 after CI run 37678655768 on `main` (`c53a191`, ubuntu-latest, Node 22,
Python 3.11) passed: purity ok for both trees; auditor self-test 15/15; ts own tests 12/12 and
suite 364/364; py own tests 27/27 and suite 364/364.

## r00: the suite against the earlier implementation

Ran 2026-10-07 on Windows, Node v22.20.0, against the earlier TypeScript implementation at
`f621520` built from source, through `suite/adapters/reference/`. 362 cases; 26 are n/a for
the reference because they test the new driver protocol and folder checks (REGEN class (e)).

All 42 failures are deliberate:

| Class | Decision | Failing cases | What differs |
|---|---|---|---|
| (b) spec choice | D-003 | 7 (`ver-*`) | emits `spec_version` 0.1.1; spec emits 0.2.0 |
| (b) spec choice | D-004 | 21 (every verdict audit) | verdict citation names an unpublished document |
| (c) corrected | D-006 | 4 (`nws-success`, `nws-missing-falls-to-openmeteo`, `ca-x06`, `ca-x10` results) | wind in km/h reported as `windMps` |
| (c) corrected | D-007 | 5 (`*-inf*`, `wr-x06`) | `Infinity` inputs serialized as `null` |
| (c) corrected | D-012 | 3 (`ca-x01`, `ca-x02`, `ca-x14` audits) | replay miss writes exception text into the audit |
| (c) corrected | D-013 | 2 (`ca-x04`) | Open-Meteo `null` temperature accepted as a sample |

Everything else passed, including all 38 wet-bulb fixture rows (results and full audits),
all 20 flag rows, all 10 work/rest rows, the 6 imported cascade audits byte for byte (after
version substitution), the boundary float-flip case, the `toFixed` tie cases, and all
canonical-JSON cases. That last part is unsurprising: the earlier implementation is
JavaScript, and the number rules are JavaScript's.

Suite bugs found while building r00 (class (a), fixed before the run was recorded):
1. The oracle self-check compared imported cascade audits after substituting the version only
   at the top level, not in `children`.
2. REQ-IF-005 had no case (caught by the traceability check); the version cases now cite it.

## What each run taught

- **r00.** The earlier TypeScript code and its own tests agree with each other, but its schema
  text, its two implementations and the external APIs disagree in six places (D-004, D-006,
  D-007, D-009, D-012, D-013). Four of those changed spec behavior. None is in the math.
- **r01.** A TypeScript build passed every case on the first try. The only finding was a
  documentation error I had introduced: a summary example typed rather than computed
  (`Tw=25.00` where the formula gives `25.05`). The builder followed the formula and logged
  the contradiction. Examples are now checked against the oracle when the suite loads.
- **r02.** A second TypeScript build, laid out differently, also passed every case. Its one
  real finding was again in the prose: a sentence about error-check order that contradicted
  itself. Rescored against spec-v1.0.2's suite (two new error cases), r01 and r02 both pass
  364/364.
- **r03.** The first clean TypeScript run: every recorded choice was already open or already
  pinned. Across three TypeScript builds, the open replay edge cases got different answers each
  time and the suite never noticed, as intended.
- **r04.** The Python build reimplemented ECMAScript number text and `toFixed` tie rounding
  from the spec's restated algorithms and passed every case written to catch Python's
  defaults. Both languages are clean on spec-v1.0.2.
