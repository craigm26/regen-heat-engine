# Build notes

- Build: none (Node 22.18+ runs `.ts` by type stripping).
- Test: `node --test` (tests in `heat.test.ts` spawn `driver.ts` as a child process).
- Run: `node driver.ts`, which reads JSON lines on stdin and writes JSON lines on stdout.
- Layout: `engine.ts` holds the operations and canonical JSON. `driver.ts` holds the protocol and request validation.
- Number text and `toFixed` come straight from ECMAScript, which is what the spec restates, so no custom formatting code is needed.
- Surprises:
  - The `[MODULE_TYPELESS_PACKAGE_JSON]` warning goes to stderr in tests. It is harmless, and adding a `package.json` is not allowed.
  - My first cascade test wrongly included an NWS entry. NWS is always tried first, so it answered the request.
  - I avoided `import.meta.main` because it may not exist in every 22.x release, so `driver.ts` always runs its main.
