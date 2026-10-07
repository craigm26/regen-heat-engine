# regen-heat-engine

Wet-bulb temperature, USMC heat flags, work/rest and go/delay verdicts, rebuilt by agents
from a spec. The spec is the asset; the code is disposable.

## What it does

`heat-engine` is a small calculation library for outdoor heat-stress decisions:

- wet-bulb temperature from air temperature and relative humidity (Stull 2011)
- the U.S. Marine Corps heat flag for a wet-bulb temperature (MCO 6200.1E)
- the work/rest schedule for a flag and acclimatization state (MCO 6200.1E §3.2)
- a go / delay / alternate verdict from the previous and current flag
- current weather through a fallback chain: National Weather Service, then Open-Meteo, then a
  fixed simulated sample

Every operation returns its result together with an audit record (inputs, constants,
citation, a one-line summary, and an injected timestamp). Audit records have a canonical
byte form, so two implementations can be compared exactly.

Each implementation is driven through a JSON-lines process interface:

```sh
cd impl/py && python3 driver.py      # or: cd impl/ts && node driver.ts   (Node 22.18+)
{"id":"1","op":"wetBulb","input":{"tempC":30,"rhPercent":60},"clock":"2026-07-01T12:00:00.000Z"}
```

The operations and their exact outputs are in [`.regenerate/SPEC.md`](.regenerate/SPEC.md).

**Not for live use as is.** The cascade is specified and tested only against replayed HTTP
responses. Neither implementation fetches live weather, and the NWS request URL inherited from
the earlier implementation is not a working endpoint (see DECISIONS D-008).

## Releases

| Language | Folder | Spec tag | Built by run | Suite at tag | Lines |
|---|---|---|---|---|---|
| TypeScript (Node 22.18+, no deps) | `impl/ts/` | `spec-v1.0.2` | r03 | 364/364 | 332 |
| Python (3.11+, stdlib only) | `impl/py/` | `spec-v1.0.2` | r04 | 364/364 | 446 |

`main` carries no newer draft spec. Linux: unverified until the first CI run (all runs so
far were on Windows).

## How it was made, and how to regenerate it

Everything durable lives in [`.regenerate/`](.regenerate/):

- `SPEC.md`: what any implementation must do (42 pinned requirements, 13 deliberately open items)
- `DECISIONS.md`: why, as 25 numbered entries
- `PROMPT.ts.md`, `PROMPT.py.md`: the builder's instructions
- `suite/`: a 364-case test suite that judges any implementation from outside, through the
  driver, in any language (`node .regenerate/suite/run.mjs --impl impl/py`)
- `SOURCES.md`: where every requirement came from (not shown to builders)
- `ledger.jsonl`, `PROVENANCE.md`, `runs/`: every run, failures included
- `tools/`: leak check, transcript audit, scorer, purity check, and the launcher

Nobody edits `impl/` by hand. To regenerate an implementation, a fresh agent gets exactly
`SPEC.md`, `DECISIONS.md` and one `PROMPT.<lang>.md`, in an empty folder, through
`tools/launch-blind.sh` (Claude Code with `--restricted --safe-mode`, a fixed tool allowlist,
no MCP servers, no web tools). Its transcript is audited, its output is scored against the
suite at the spec tag it was given, and every choice it records in `CHOICES.md` is triaged.
Only a run with no failures, no audit violations, and no choices that forced a spec change is
promoted. CI checks that each `impl/<lang>/` tree is exactly the promoted one.

"Blind" means the builder was not shown the earlier implementation. Its model may still have
seen that public code in training. Isolation is by flags plus an audit, not an operating-system
sandbox.

## Credits

- The behavior, fixtures and schemas come from
  [HeatCompass/heat-engine-spec](https://github.com/HeatCompass/heat-engine-spec)
  (MIT, © 2026 HeatCompass), at commit `f621520`. The imported fixtures under
  `.regenerate/suite/fixtures/` are unchanged copies; see `.regenerate/SOURCES.md`.
- The `.regenerate/` layout follows Carson Farmer's
  [iroh-acp-go](https://github.com/carsonfarmer/iroh-acp-go) and
  [iroh-acp-rs](https://github.com/carsonfarmer/iroh-acp-rs).
- The framing (a spec, an evaluation that judges any version, a limit on what the builder
  sees, a record of how each version was made) is from Chad Fowler's
  [regenerative software](https://chadfowler.com/regenerative-software/) writing.
- Primary sources: Stull (2011), DOI 10.1175/JAMC-D-11-0143.1; MCO 6200.1E; the National
  Weather Service and Open-Meteo API documentation.

## License

MIT. See [LICENSE](LICENSE).
