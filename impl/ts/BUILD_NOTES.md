# Build notes

- Build: none (Node 22.18+ runs `.ts` by type stripping). `REGEN.json` has `"build": ""`.
- Test: `node --test` (runs `engine.test.ts`; includes a test that spawns the driver).
- Run: `node driver.ts` — JSON-lines on stdin, responses on stdout.
- Layout: `canon.ts` (number text, canonical JSON), `ops.ts` (operations and audits),
  `handler.ts` (validation/dispatch), `driver.ts` (stdin/stdout).
- Surprise: the REQ-WB-003 example `Tw=25.00` for T=25, RH=120 disagrees with the formula
  (gives 25.05); see CHOICES C-1.
- Only `node`, `mkdir`, `ls` and git commands were available, so files were written with the
  editor tools; no git repository was initialised.
