#!/usr/bin/env node
// Spec suite runner. Node standard library only.
//   node .regenerate/suite/run.mjs --impl <dir> [--json report.json] [--reference]
// --reference: the implementation is the reference adapter; cases marked n/a for it are
// excluded from X/Y. Prints `passed X/Y (advisory A/B, skipped S, n/a N)`; exits 0 only if
// every non-advisory case passed and traceability holds.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import { buildCases, csv } from './cases.mjs';
import { CONTRACT_VERSION } from './oracle.mjs';

const SUITE = import.meta.dirname;
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const IMPL = opt('--impl') && resolve(opt('--impl'));
const JSON_OUT = opt('--json');
const AS_REFERENCE = args.includes('--reference');
const ONLY = opt('--only'); // substring filter, for debugging
if (!IMPL) { console.error('usage: run.mjs --impl <dir> [--json report.json] [--reference]'); process.exit(2); }

// ---------- traceability
const specPath = join(SUITE, '..', 'SPEC.md');
const spec = readFileSync(specPath, 'utf8');
const definedReqs = new Set([...spec.matchAll(/\*\*(REQ-[A-Z]+-\d{3})\.\*\*/g)].map((m) => m[1]));
const openIds = new Set([...spec.matchAll(/\*\*(OPEN-[A-Z]+-\d{3})\.\*\*/g)].map((m) => m[1]));
const cases = buildCases().filter((c) => !ONLY || c.id.includes(ONLY));
const trace = [];
const ids = new Set();
for (const c of cases) {
  if (ids.has(c.id)) trace.push(`duplicate case id ${c.id}`);
  ids.add(c.id);
  if (!c.reqs?.length) trace.push(`case ${c.id} cites no REQ`);
  for (const r of c.reqs ?? []) {
    if (openIds.has(r) || r.startsWith('OPEN-')) trace.push(`case ${c.id} cites open item ${r}`);
    else if (!definedReqs.has(r)) trace.push(`case ${c.id} cites unknown ${r}`);
  }
}
if (!ONLY) for (const r of definedReqs) if (!cases.some((c) => c.reqs.includes(r))) trace.push(`${r} has no case`);
// every fixture source_ref resolves to a heading in references.md
const refHeads = new Set([...readFileSync(join(SUITE, 'fixtures', 'references.md'), 'utf8').matchAll(/^## (\S+)/gm)].map((m) => m[1]));
for (const f of readdirSync(join(SUITE, 'fixtures')).filter((n) => n.endsWith('.fixtures.csv')))
  for (const row of csv(f)) if (!refHeads.has(row.source_ref)) trace.push(`${f} ${row.id}: source_ref ${row.source_ref} unresolved`);
if (trace.length) { console.error('TRACEABILITY FAILED:\n  ' + trace.join('\n  ')); process.exit(2); }

// ---------- REGEN.json
const pick = (v) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : v[process.platform] ?? v.default ?? '');
let regen = null, regenErr = null;
try { regen = JSON.parse(readFileSync(join(IMPL, 'REGEN.json'), 'utf8')); } catch (e) { regenErr = String(e.message); }

function shell(cmd) {
  const r = spawnSync(cmd, { cwd: IMPL, shell: true, encoding: 'utf8', timeout: 600000 });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

let buildFailed = null;
if (regen && pick(regen.build).trim()) {
  const b = shell(pick(regen.build));
  if (b.code !== 0) buildFailed = `build exited ${b.code}: ${b.out.slice(-500)}`;
}

// ---------- run batches
function runDriver(lines) {
  return new Promise((done) => {
    const words = pick(regen?.driver).split(' ').filter(Boolean);
    if (!words.length) return done({ code: null, stdout: Buffer.alloc(0), stderr: 'no driver command', spawnError: true });
    let child;
    try {
      child = spawn(words[0], words.slice(1), { cwd: IMPL, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return done({ code: null, stdout: Buffer.alloc(0), stderr: String(e), spawnError: true });
    }
    const out = [], err = [];
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => { clearTimeout(timer); done({ code: null, stdout: Buffer.concat(out), stderr: String(e), spawnError: true }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }); });
    child.stdin.on('error', () => {});
    child.stdin.end(lines.join('\n') + '\n');
  });
}

const lineText = (l) => (typeof l === 'string' ? l : JSON.stringify(l));
const batches = new Map();
for (const c of cases) {
  if (!c.batch) continue;
  if (AS_REFERENCE && c.na?.includes('reference')) continue;
  const key = c.lines ? `${c.batch}:${c.id}` : c.batch;
  if (!batches.has(key)) batches.set(key, { lines: c.lines ?? [], index: new Map(), custom: !!c.lines });
  const b = batches.get(key);
  if (!b.custom && c.line !== undefined) {
    const t = lineText(c.line);
    if (!b.index.has(t)) { b.index.set(t, b.lines.length); b.lines.push(t); }
  }
  c._batch = key;
}
const batchOut = new Map();
if (regen && !buildFailed) {
  for (const [key, b] of batches) {
    const r = await runDriver(b.lines);
    const text = r.stdout.toString('utf8');
    const parts = text.split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    const parsed = parts.map((p) => { try { return JSON.parse(p); } catch { return undefined; } });
    batchOut.set(key, { ...r, text, parts, parsed, expectedCount: b.lines.filter((l) => l.trim() !== '').length, b });
  }
}

// ---------- checks
const sameJson = (a, b, tol = {}, path = '') => {
  if (typeof a === 'number' && typeof b === 'number') {
    const key = path.split('.').pop();
    return tol[key] !== undefined ? Math.abs(a - b) <= tol[key] : a === b;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join('\0') !== kb.join('\0')) return false;
  return ka.every((k) => sameJson(a[k], b[k], tol, `${path}.${k}`));
};
const VER = /"spec_version":"\d+\.\d+\.\d+"/g;
const normVer = (s) => s.replace(VER, `"spec_version":"${CONTRACT_VERSION}"`);

function staticCheck(test) {
  if (!regen) return `REGEN.json unreadable: ${regenErr}`;
  const words = pick(regen.driver).split(' ');
  if (test === 'regen') {
    for (const k of ['lang', 'build', 'test', 'driver']) if (!(k in regen)) return `REGEN.json lacks ${k}`;
    if (!['ts', 'py'].includes(regen.lang)) return `lang ${regen.lang}`;
    for (const k of ['build', 'test', 'driver']) {
      const v = regen[k];
      if (typeof v !== 'string' && !(v && typeof v === 'object' && typeof v.default === 'string')) return `${k} must be a string or an object with "default"`;
    }
    for (const v of [regen.driver, ...(typeof regen.driver === 'object' ? Object.values(regen.driver) : [])])
      if (typeof v === 'string' && /["'|<>&;]|\.cmd\b|\bnpx\b/.test(v)) return `driver is not plain words: ${v}`;
    return null;
  }
  if (test === 'runtime') {
    if (regen.lang === 'ts') return pick(regen.build).trim() ? 'ts must run by type stripping (no build step)' : words[0] === 'node' ? null : `ts driver starts with ${words[0]}`;
    return ['py', 'python', 'python3'].includes(words[0]) ? null : `py driver starts with ${words[0]}`;
  }
  const files = [];
  const walk = (d, rel = '') => {
    for (const n of readdirSync(d)) {
      if (['node_modules', '.git', 'bin', '__pycache__'].includes(n)) continue;
      const p = join(d, n), r = rel ? `${rel}/${n}` : n;
      if (statSync(p).isDirectory()) walk(p, r); else files.push(r);
    }
  };
  walk(IMPL);
  const exts = regen.lang === 'ts' ? ['.ts', '.mts', '.mjs', '.js'] : ['.py'];
  const isTest = (r) => /(^|\/)(test|tests)\//.test(r) || /\.test\./.test(basename(r)) || /_test\./.test(basename(r)) || /^test_.*\.py$/.test(basename(r));
  const src = files.filter((r) => exts.includes(extname(r)) && !isTest(r));
  if (test === 'loc') {
    const n = src.reduce((s, r) => s + readFileSync(join(IMPL, r), 'utf8').split(/\r?\n/).filter((l) => l.trim()).length, 0);
    return n <= 800 ? null : `${n} non-blank source lines > 800`;
  }
  if (test === 'deps') {
    if (existsSync(join(IMPL, 'node_modules'))) return 'node_modules present';
    if (existsSync(join(IMPL, 'package.json'))) {
      const p = JSON.parse(readFileSync(join(IMPL, 'package.json'), 'utf8'));
      for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])
        if (p[k] && Object.keys(p[k]).length) return `package.json has ${k}`;
    }
    if (regen.lang === 'ts') {
      for (const r of files.filter((f) => exts.includes(extname(f)))) {
        const t = readFileSync(join(IMPL, r), 'utf8');
        for (const m of t.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g))
          if (!/^(\.|node:)/.test(m[1])) return `${r} imports ${m[1]}`;
      }
      return null;
    }
    const py = `import ast,sys,os\nloc={os.path.splitext(f)[0] for r,_,fs in os.walk('.') for f in fs if f.endswith('.py')}|{d for d in os.listdir('.') if os.path.isdir(d)}\nbad=set()\nfor r,_,fs in os.walk('.'):\n  for f in fs:\n    if f.endswith('.py'):\n      t=ast.parse(open(os.path.join(r,f),encoding='utf-8').read())\n      for n in ast.walk(t):\n        ms=[a.name for a in n.names] if isinstance(n,ast.Import) else ([n.module] if isinstance(n,ast.ImportFrom) and n.module and n.level==0 else [])\n        for m in ms:\n          top=m.split('.')[0]\n          if top not in sys.stdlib_module_names and top not in loc: bad.add(top)\nprint(','.join(sorted(bad)))`;
    const r = spawnSync(words[0], [...words.slice(1, -1), '-c', py], { cwd: IMPL, encoding: 'utf8' });
    if (r.status !== 0) return `import scan failed: ${(r.stderr ?? '').slice(-200)}`;
    return r.stdout.trim() ? `non-stdlib imports: ${r.stdout.trim()}` : null;
  }
  return `unknown static test ${test}`;
}

const results = [];
for (const c of cases) {
  if (AS_REFERENCE && c.na?.includes('reference')) { results.push({ id: c.id, reqs: c.reqs, status: 'n/a' }); continue; }
  let why = null;
  try {
    if (c.check.kind === 'static') why = staticCheck(c.check.test);
    else if (!regen) why = `REGEN.json unreadable: ${regenErr}`;
    else if (buildFailed) why = buildFailed;
    else {
      const o = batchOut.get(c._batch);
      if (o.spawnError) why = `driver did not start: ${o.stderr}`;
      else if (c.check.kind === 'stdout') {
        const t = c.check.test;
        if (t === 'utf8') { try { new TextDecoder('utf-8', { fatal: true }).decode(o.stdout); } catch { why = 'stdout is not valid UTF-8'; } }
        else if (t === 'lf') { if (o.stdout.includes(0x0d)) why = 'stdout contains CR'; else if (o.stdout.length && o.stdout[o.stdout.length - 1] !== 0x0a) why = 'last line not LF-terminated'; }
        else if (t === 'count') { if (o.parts.length !== o.expectedCount) why = `${o.parts.length} response lines for ${o.expectedCount} requests`; else {
          const reqIds = o.b.lines.map((l) => { try { return JSON.parse(l).id; } catch { return null; } });
          const bad = o.parsed.findIndex((p, i) => !p || p.id !== reqIds[i]);
          if (bad >= 0) why = `response ${bad} id ${o.parsed[bad]?.id} != request id ${reqIds[bad]}`;
        } }
        else if (t === 'exit0') { if (o.code !== 0) why = `driver exit ${o.code}`; }
        else if (t === 'blank') { const ids2 = o.parsed.map((p) => p?.id); if (ids2.join(',') !== 'blank-1,blank-2') why = `responses ${JSON.stringify(ids2)}`; }
        else if (t === 'continue') {
          if (o.parsed.length !== 2 || !sameJson(o.parsed[0], { id: null, error: 'bad_request' }) || o.parsed[1]?.result?.flag !== 'red') why = `responses ${o.parts.join(' | ').slice(0, 300)}`;
        }
      } else {
        const idx = o.b.index.get(lineText(c.line));
        const resp = o.parsed[idx];
        if (o.parts.length !== o.expectedCount && resp === undefined) why = `no response (driver exit ${o.code}; ${o.parts.length}/${o.expectedCount} lines; stderr: ${o.stderr.slice(-300)})`;
        else if (!resp || typeof resp !== 'object') why = `unparseable response line: ${String(o.parts[idx]).slice(0, 200)}`;
        else if (c.check.kind === 'error') {
          if (!sameJson(resp, { id: c.check.id, error: c.check.category })) why = `got ${JSON.stringify(resp).slice(0, 300)}`;
        } else if (c.check.kind === 'canonical') {
          if ('audit' in resp) why = 'canonical response has an audit member';
          else if (resp.result !== c.check.text) why = `got ${JSON.stringify(resp.result)} want ${JSON.stringify(c.check.text)}`;
        } else if ('error' in resp) why = `error response ${JSON.stringify(resp)}`;
        else if (c.check.kind === 'result') {
          if (!('result' in resp)) why = 'no result member';
          else if (!sameJson(resp.result, c.check.value, c.check.tol ?? {})) why = `result ${JSON.stringify(resp.result)} want ${JSON.stringify(c.check.value)}`;
        } else if (c.check.kind === 'audit') {
          if (typeof resp.audit !== 'string') why = 'audit is not a string';
          else if (normVer(resp.audit) !== normVer(c.check.text)) why = `audit\n      got  ${resp.audit}\n      want ${c.check.text}`;
        } else if (c.check.kind === 'version') {
          if (typeof resp.audit !== 'string') why = 'audit is not a string';
          else {
            const vs = [...resp.audit.matchAll(VER)].map((m) => m[0]);
            if (!vs.length || vs.some((v) => v !== `"spec_version":"${CONTRACT_VERSION}"`)) why = `versions ${vs.join(' ')}`;
          }
        }
      }
    }
  } catch (e) { why = `runner exception: ${e.stack}`; }
  results.push({ id: c.id, reqs: c.reqs, status: why ? 'fail' : 'pass', why: why ?? undefined, advisory: !!c.advisory });
}

const counted = results.filter((r) => r.status !== 'n/a' && !r.advisory);
const passed = counted.filter((r) => r.status === 'pass').length;
const adv = results.filter((r) => r.advisory && r.status !== 'n/a');
const na = results.filter((r) => r.status === 'n/a').length;
const failing = counted.filter((r) => r.status === 'fail');
console.log(`passed ${passed}/${counted.length} (advisory ${adv.filter((r) => r.status === 'pass').length}/${adv.length}, skipped 0, n/a ${na})`);
for (const f of failing) console.log(`  FAIL ${f.id} [${f.reqs.join(', ')}]\n      ${f.why}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({
  passed, total: counted.length, advisory: `${adv.filter((r) => r.status === 'pass').length}/${adv.length}`, skipped: 0, na,
  failing: failing.map((f) => ({ case: f.id, reqs: f.reqs, why: f.why })), results,
}, null, 1));
process.exit(failing.length ? 1 : 0);
