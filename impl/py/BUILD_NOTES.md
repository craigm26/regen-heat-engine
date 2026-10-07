# Build notes

- Build: none (`build` is empty in REGEN.json). Python 3.11+, standard library only.
- Test: `py -3 -m unittest -q` (Windows) or `python3 -m unittest -q` (Linux), run in this folder. 27 tests, all passing.
- Run: `py -3 driver.py` / `python3 driver.py`, JSON lines on stdin, JSON lines on stdout.
- Files: `heat.py` (all logic), `driver.py` (stdin/stdout loop), `test_heat.py`.

Surprises:
- Python's `repr`, `format(.1f)` differ from ECMAScript number text and `toFixed`; `num_text` and `fixed` reimplement the ES rules (exact `Fraction` arithmetic for ties).
- Object keys sort by UTF-16 code units, done by comparing UTF-16-BE encodings.
- Only py/python/mkdir/ls/git commands were allowed, so no shell tooling was used.
- No git repository was initialised (not requested as a deliverable).
