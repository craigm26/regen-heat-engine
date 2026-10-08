# Rebuilding a heat-stress calculator from its spec

## 1. What this is

This repository holds a specification for a small heat-stress library, a test suite that
judges any implementation of it from the outside, and two implementations (TypeScript and
Python) that were written by agents who were shown only the specification. The code under
`impl/` is output. The files under `.regenerate/` are the thing I maintain.

The layout follows Carson Farmer's `.regenerate/` convention
([iroh-acp-go](https://github.com/carsonfarmer/iroh-acp-go)).
The idea that a regenerable system needs four things (a spec, an evaluation that can judge any
version, a limit on what the builder sees, and a record of how each version was made) is from
Chad Fowler's [writing on regenerative software](https://chadfowler.com/regenerative-software/).

One caveat applies everywhere below. "Blind" means the builder was not shown the earlier
implementation. The model behind it may well have seen that public code in training. The
transcripts show no sign of it (none of the 7 project identifiers appears in any of the four
blind transcripts), but absence of a signal is not proof.

## 2. Why this program

Most of what makes this program correct comes from outside its code: a 2011 paper (Stull's
wet-bulb formula), a Marine Corps order (the heat flag bands and the work/rest matrix), and two
public weather APIs. The earlier implementation, HeatCompass/heat-engine-spec, already had a
spec folder, CSV fixtures, and two implementations held to byte-equal audit output. That made it
the cheapest place to run the whole loop end to end.

## 3. What I wrote down

At the released tag, `spec-v1.0.2`:

- **SPEC.md**: 42 pinned requirements and 13 deliberately open items, in 622 lines (4,612 words).
- **DECISIONS.md**: 25 numbered entries (2,527 words), each saying what forced a decision and
  what else was possible.
- **The suite**: 364 cases, every one citing at least one requirement. The runner refuses to
  start if a requirement has no case, a case cites an unknown ID, or a case cites an open item.
  It also refuses to start if any computed example in SPEC.md disagrees with its own
  expectations (added after r01; see below). Its fixtures are the earlier project's 38 wet-bulb,
  20 flag, 10 work/rest and 8 verdict rows and 6 cascade replays, copied byte for byte.

For comparison, the earlier TypeScript source is 1,007 non-blank lines and the Dart source
1,355 (both counting comments and type declarations, and excluding the fixture loaders and
generated types). The released implementations are 332
(TypeScript) and 446 (Python) non-blank lines. The spec is longer than either.

## 4. Rebuilding it blind

Every run is in `.regenerate/ledger.jsonl`. All blind runs used Claude Code with
`--restricted --safe-mode`, a fixed tool allowlist and no MCP servers, and model
`claude-sonnet-5-5`.

| Run | Lang | Spec tag | Suite at tag | Own tests | Lines | Turns | Minutes | Cost | Clean |
|---|---|---|---|---|---|---|---|---|---|
| r00 | reference | 1.0.0 | 294/336 (26 n/a) | — | — | — | — | — | — |
| r01 | ts | 1.0.0 | 362/362 | 22/22 | 320 | 19 | 3.4 | $0.60 | no |
| r02 | ts | 1.0.1 | 362/362 | 14/14 | 352 | 16 | 2.8 | $0.49 | no |
| r03 | ts | 1.0.2 | 364/364 | 12/12 | 332 | 18 | 3.1 | $0.44 | yes |
| r04 | py | 1.0.2 | 364/364 | 27/27 | 446 | 13 | 2.5 | $0.43 | yes |

r01 and r02 passed every case and still were not promotable: each recorded one choice that
showed the spec itself was wrong or self-contradictory, and a run is only clean if none of its
choices forces a spec change. r03 and r04 were promoted.

## 5. What extraction found

Before any rebuild, I checked the brief's hypotheses against the reference code and the primary
sources, then ran the suite against the earlier implementation (r00). All 42 of its failures
are deliberate: 28 from choices this spec makes differently (a new contract version, and a
verdict citation that no longer names an unpublished design document) and 14 where this spec
corrects the earlier behavior. None of the 42 is in the math.

The corrections:

- **Wind units.** The sample field is `windMps`. NWS reports wind as `wmoUnit:km_h-1` (checked
  on a live observation) and Open-Meteo's default is km/h. The earlier code copied both
  unconverted. The spec divides by 3.6 (D-006).
- **The NWS endpoint.** The earlier code requests `/points/{lat},{lng}/observations/latest`,
  which the NWS documentation does not list and which returns 404. I kept the URL only as the
  name that replay fixtures match on and made live fetching out of scope (D-008). This is the
  finding I would most want the upstream project to hear.
- **Infinity.** The two earlier implementations disagreed: TypeScript serialized an infinite
  input as `null`, the Dart one as `"Infinity"` (D-007).
- **A replay miss** wrote the exception's message text into the audit record (D-012), and an
  Open-Meteo `null` temperature produced a sample with `tempC: null` in TypeScript but not in
  Dart (D-013).

Two of the brief's hypotheses held up exactly. `duration_ms` is a constant, not a measurement
(D-005). And float error at the flag boundaries is real: `26.66666666666666` °C becomes
`79.99999999999999` °F (white) by `(c*9)/5+32` but `80` (green) by `c*1.8+32`, so the spec pins
the expression (D-010).

## 6. What the rebuilds found

- **Unwritten choices.** Each build recorded 9 or 10. Most were about inputs no caller sends:
  an uncompilable replay pattern, a replay entry without a status, `body_json: null`,
  non-finite coordinates. They became open items (D-023, D-025). The three TypeScript builds
  answered "replay entry without a status" as 200 once and as a transport error twice; the suite
  did not notice, which is what open means.
- **Contradictions.** r02 found that REQ-IF-007 said error checks run "in the order the table
  lists them" (which put `bad_request` first) and also "`unknown_op` before input checks". It
  chose the intended reading; a literal one would have failed a case. Rewritten as three
  numbered steps (D-024).
- **Reference quirks.** None reached the builders as a question: every quirk was settled in
  DECISIONS before r01.
- **Documentation errors.** r01 found that my own example for clamped humidity said
  `Tw=25.00°C` where the formula gives `25.05`. I had typed it instead of computing it. The
  builder followed the formula and logged the contradiction (D-022). The suite now checks every
  computed example in the spec at load time.
- **Silent divergences** (a suite failure the builder did not notice): none, in four runs.

The tooling had its own failures, all in the transcript auditor: three times it reported
violations that were not there (a heredoc body, a regex in an inline script, a fragment of a
`sed` substitution), and it was reading only the first line of a wrapped identifier list. Each
was fixed, every transcript was re-audited with the final version (all blind runs: 0
violations), and `tools/audit-selftest.mjs` now holds those cases.

The brief predicted that "the knowledge the implementation remembers is mostly not the math"
but formatting, units, clocks and the fallback chain. Extraction bore that out: every r00
failure and every decision that changed behavior was about units, serialization, or how the
cascade fails. The rebuilds did not stumble on any of it, including the Python run, which
reimplemented ECMAScript number text and `toFixed` tie rounding with exact arithmetic because
SPEC.md spells both out as algorithms with examples.

## 7. How much to write down

The main call was whether to pin the audit record byte for byte, including the human-readable
summary line (D-001). I did, because the earlier project's own cross-language check did, and
because a stored record is only comparable if every implementation writes it the same way. The
cost is visible: section 2 of SPEC.md alone (number text, fixed-point text, serialization
and escaping) is 811 of its 4,612 words, and each operation's summary format adds more. Those
are rules a JavaScript implementation gets for free and a Python one has to rebuild. Both builders got it right on the first try, which suggests the length bought
something.

Prefer-open worked in the other direction. Every choice the builders raised that nothing could
depend on became an open item instead of a rule; the open list grew from 10 to 13 while the
pinned list stayed at 42.

## 8. What it cost

Four blind runs, all `claude-sonnet-5-5`: 66 turns, 11.8 minutes of builder time and $1.96 in
total, as reported by each transcript's final line. That excludes the orchestrating session
that extracted the spec, built the suite and scored the runs, which took far longer and is not
in the ledger. Two of the six allowed
runs were left unused.

## 9. The checklist

| # | Property | Evidence | Holds |
|---|---|---|---|
| P1 | `.regenerate/` is the asset; `impl/` is disposable | Layout | yes |
| P2 | Every file under `impl/<lang>/` came from a logged blind run | `purity-check.mjs` against the promotion entries for r03 and r04 | yes |
| P3 | The suite judges from outside only, in any language | `suite/run.mjs` talks only to the driver; runs in TypeScript and Python | yes |
| P4 | The suite ran against the reference first; every failure explained | Ledger `r00`, `r00.1`, `r00.2`; PROVENANCE | yes |
| P5 | Promoted builders saw only the three files, passed the leak check, clean audit | `launch-blind.sh`, leak check before each launch, `meta/audit.json` (0 violations) | yes |
| P6 | Promoted implementations come from clean runs on their tag | `runs/r03.md`, `runs/r04.md`; ledger `clean: true` | yes |
| P7 | Every run is in the ledger, failures included | `ledger.jsonl`: r00–r00.2, r01–r04, two rescores, two promotions | yes |
| P8 | Every number here traces to the ledger or a run file | This document | yes |

All builds and scoring ran on Windows. The first CI run on `ubuntu-latest` (Node 22, Python
3.11) passed both implementations' own tests and the suite at `spec-v1.0.2`, 364/364 each.

## 10. What's next

- Offer the earlier project the two findings that matter outside this repo: the NWS endpoint
  and the wind units. Drafts only; nothing has been sent.
- Run a third language, or a weaker model, against the same tag.
