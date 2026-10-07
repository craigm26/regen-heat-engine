# Reference adapter

Makes the earlier implementation (built outside this repo) speak the suite's driver
protocol, so the suite can run against it (`r00`). It contains no code from that
implementation; it imports the built package named in `local.json`:

```json
{ "entry": "<absolute path to the built package's dist/index.js>" }
```

`local.json` is gitignored. Run: `node .regenerate/suite/run.mjs --impl .regenerate/suite/adapters/reference --reference`.

The adapter only translates between the protocol and the library. It does not repair
behavior. Unmatched replay URLs throw the same message the earlier project's own test harness
threw, so the earlier error handling is exercised as it was.
