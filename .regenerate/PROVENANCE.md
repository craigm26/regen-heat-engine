# Provenance

How every version of this program was made. Machine-readable record: `ledger.jsonl`.

## Runs

| Run | Kind | Spec tag | Model | Lang | Outcome | Suite | Own tests | Clean | Notes |
|---|---|---|---|---|---|---|---|---|---|
| r00 | reference | spec-v1.0.0 | — | earlier TS implementation via adapter | finished | 294/336 (n/a 26) | — | — | all 42 failures explained (below) |

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
