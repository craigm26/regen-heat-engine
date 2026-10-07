# Build notes

- Requires Node.js 22.18+ (runs `.ts` directly by type stripping). No build step, no dependencies.
- Test: `node --test` (all tests in `heat.test.ts`).
- Run: `node driver.ts`, then send one JSON request per line on stdin.
- Layout: `driver.ts` (stdin/stdout), `lib/dispatch.ts` (validation and routing), `lib/ops.ts`
  (wet bulb, flags, work/rest, verdict), `lib/cascade.ts` (replayed HTTP cascade), `lib/json.ts`
  (canonical JSON), `lib/audit.ts` (audit record helper).
- Notes: JavaScript's `String(x)`, `toFixed` and `JSON.stringify` already match the spec's
  number and string rules (REQ-CJ-001/002/004), so they are used directly. Only `node ...`
  commands were available, so files were written with the file tool and no git repo was created.
