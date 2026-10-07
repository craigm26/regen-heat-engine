# STATUS

- Project: heat-engine (brief: kit/briefs/heat-engine.md)
- Phase: 8 (publish gate) - WAITING FOR CRAIG TO TYPE `publish`
- Released: ts r03 and py r04 at spec-v1.0.2 (promoted; purity ok; CI script passes locally on Windows)
- Blind runs used: 4 of 6
- Running processes: none
- History scrubbed of local sandbox paths and a private repo name (filter-branch; spec, suite and
  impl object ids unchanged). Pre-scrub backup bundle in the session scratchpad only.
- Linux: unverified (wsl not tried; needs Craig's OK)
- Python versions: impl/py passes its own tests and the spec-v1.0.2 suite (364/364) on 3.14.2 and
  3.12.10 (Windows). 3.11 is unverified: the local 3.11 registration points at a missing
  C:\Python311\python.exe. CI runs 3.11.
- Next step: on `publish`, run the gate commands in order; CI on main must pass before the
  visibility change.
