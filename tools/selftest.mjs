#!/usr/bin/env node
/* Headless Bot vs Bot selftest for Robot Fight.
   Serves the game (or reuses python3 -m http.server 8765), injects tools/selftest-hook.js
   via CDP when the URL has ?selftest=1, runs N fights, writes JSON + Markdown reports.
   Does not edit game source. */
import { spawn } from 'child_process';
import { createServer } from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = fs.existsSync(path.join(process.cwd(), 'js', 'game.js'))
  ? process.cwd()
  : path.resolve(here, '..');

function parseArgs(argv) {
  const o = {
    fights: 3,
    timeScale: 3,
    port: 8765,
    cdp: 9341,
    root: defaultRoot,
    out: path.join(here, 'selftest-reports'),
    timeoutMs: 8 * 60 * 1000,
    fightTimeoutMs: 150 * 1000,
    gfx: 'low',
    hdri: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--fights' || a === '-n') o.fights = Math.max(1, +next() || 3);
    else if (a === '--time-scale' || a === '--timescale') o.timeScale = Math.max(1, Math.min(8, +next() || 3));
    else if (a === '--port') o.port = +next() || o.port;
    else if (a === '--cdp') o.cdp = +next() || o.cdp;
    else if (a === '--root') o.root = path.resolve(next());
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '--timeout') o.timeoutMs = (+next() || 120) * 1000;
    else if (a === '--gfx') o.gfx = next();
    else if (a === '--hdri') o.hdri = true;
    else if (a === '--no-hdri') o.hdri = false;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (/^\d+$/.test(a)) o.fights = Math.max(1, +a);
    else rest.push(a);
  }
  o.rest = rest;
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function fetchText(url, ms = 1500) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function ensureServer(port, root) {
  const url = `http://127.0.0.1:${port}/`;
  const probe = await fetchText(url + 'index.html');
  if (probe.ok && /game\.js|Robot Fight|data-mode/.test(probe.text || '')) {
    return { started: false, url, proc: null, port };
  }
  let use = port;
  if (probe.ok || !(await portFree(port))) {
    for (let p = port + 1; p < port + 20; p++) {
      if (await portFree(p)) { use = p; break; }
    }
  }
  const proc = spawn('python3', ['-m', 'http.server', String(use), '--bind', '127.0.0.1'], {
    cwd: root,
    stdio: 'ignore',
  });
  for (let i = 0; i < 30; i++) {
    await sleep(150);
    const again = await fetchText(`http://127.0.0.1:${use}/index.html`);
    if (again.ok) return { started: true, url: `http://127.0.0.1:${use}/`, proc, port: use };
  }
  throw new Error('http.server did not start on port ' + use);
}

async function waitJson(port, tries = 40) {
  for (let i = 0; i < tries; i++) {
    await sleep(200);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (r.ok) return await r.json();
    } catch (_) {}
  }
  throw new Error('Chrome CDP did not come up on port ' + port);
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pend = new Map();
    this.console = [];
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id != null && this.pend.has(m.id)) {
        const fn = this.pend.get(m.id);
        this.pend.delete(m.id);
        fn(m);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params && m.params.exceptionDetails;
        this.console.push({
          type: 'exception',
          text: (d && (d.exception && d.exception.description || d.text)) || 'exception',
          t: Date.now(),
        });
      }
      if (m.method === 'Runtime.consoleAPICalled') {
        const typ = m.params && m.params.type;
        if (typ === 'error' || typ === 'warning') {
          const args = (m.params.args || []).map((a) => a.value || a.description || a.unserializableValue || '').join(' ');
          this.console.push({ type: typ, text: args, t: Date.now() });
        }
      }
    });
  }
  async open() {
    if (this.ws.readyState === 1) return;
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', () => rej(new Error('CDP websocket error')), { once: true });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        this.pend.delete(id);
        rej(new Error('CDP timeout: ' + method));
      }, 20000);
      this.pend.set(id, (m) => {
        clearTimeout(t);
        if (m.error) rej(new Error(method + ': ' + JSON.stringify(m.error)));
        else res(m);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      return { __err: (d.exception && d.exception.description) || d.text };
    }
    const out = r.result && r.result.result;
    return out ? out.value : undefined;
  }
  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

function clickExpr(sel) {
  return `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return 0; b.click(); return 1; })()`;
}

function formatReport(data) {
  const lines = [];
  const t = data.totals || {};
  const atk = t.attacks || {};
  lines.push('# Robot Fight selftest');
  lines.push('');
  lines.push(`- When: ${data.startedAtLocal || data.startedAt}`);
  lines.push(`- Command: \`${data.command}\``);
  lines.push(`- Fights requested: ${data.fightsRequested}, completed: ${data.fightsCompleted}`);
  lines.push(`- Time scale: ${data.timeScale}`);
  lines.push(`- URL: ${data.url}`);
  lines.push(`- Hook patch in js/game.js: none (hook injected via CDP; \`window.__rfTest\` on \`?selftest=1\`)`);
  lines.push('');
  lines.push('## Fights');
  lines.push('');
  for (const f of data.fights || []) {
    const atkS = Object.entries(f.attacks || {}).map(([k, v]) => `${k} ${v.landed}/${v.thrown} landed (${v.whiff} whiff)`).join(', ') || 'no attacks';
    lines.push(`- Fight ${f.index} (round ${f.roundIndex ?? '?'}): length ${f.length}s game, winner ${f.winner ?? 'draw'}, end ${f.endReason}${f.koAt != null ? `, KO at ${f.koAt}s` : ''}. ${atkS}. down ${JSON.stringify(f.downDurations)}, get-up ${JSON.stringify(f.getupDurations)}.`);
  }
  if (!(data.fights || []).length) lines.push('- (no completed fights)');
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  const attackLines = Object.entries(atk).map(([k, v]) => {
    const n = v.thrown || 0;
    const wr = n ? ((v.whiff / n) * 100).toFixed(0) : '0';
    return `${k}: thrown ${v.thrown}, landed ${v.landed}, whiff ${v.whiff} (${wr}%)`;
  });
  lines.push(`- Attacks: ${attackLines.join('; ') || 'none'}`);
  lines.push(`- Hits with no defender reaction: ${t.noReaction || 0}`);
  lines.push(`- Attack spam (gap < ${(data.thresholds && data.thresholds.spamGap) || 0.3}s): ${t.spam || 0}`);
  lines.push(`- Attacks on a downed opponent: ${t.attackDowned || 0}`);
  const downD = (t.downEvents || []).map((e) => e.dur);
  const getupD = (t.getupEvents || []).map((e) => e.dur);
  lines.push(`- Time down (s): n=${downD.length}${downD.length ? `, sum=${sum(downD).toFixed(2)}, max=${Math.max(...downD).toFixed(2)}` : ''}`);
  lines.push(`- Get-up durations (s): n=${getupD.length}${getupD.length ? `, sum=${sum(getupD).toFixed(2)}, max=${Math.max(...getupD).toFixed(2)}` : ''}`);
  lines.push(`- KO times (game s): ${(t.koEvents || []).map((e) => `${e.id}@${(+e.t).toFixed(2)}`).join(', ') || 'none'}`);
  lines.push(`- Fight lengths (game s): ${(data.fights || []).map((f) => f.length).join(', ') || 'none'}`);
  lines.push(`- Feet samples flagged (|err| > 3 cm): ${t.footFlags || 0} / ${t.footSamples || 0} (max above ${(t.footMaxAbove || 0).toFixed(3)} m, max below ${(t.footMaxBelow || 0).toFixed(3)} m)`);
  lines.push(`- Root slide flags: ${t.slideFlags || 0} (max speed ${(t.slideMaxSpeed || 0).toFixed(3)} m/s)`);
  lines.push(`- Torso interpenetration flags (dist < ${(data.thresholds && data.thresholds.torsoMin) || 0.72} m): ${t.interpenFlags || 0} (min dist ${t.interpenMinDist == null ? 'n/a' : (+t.interpenMinDist).toFixed(3)} m)`);
  lines.push(`- Ragdoll hover flags (clearance > ${(data.thresholds && data.thresholds.ragHover) || 0.08} m): ${t.ragHoverFlags || 0} (max ${(t.ragHoverMax || 0).toFixed(3)} m)`);
  lines.push(`- Stuck states: ${t.stuck || 0}`);
  lines.push(`- Console errors/warnings: ${data.consoleErrors.length}`);
  for (const e of data.consoleErrors.slice(0, 12)) lines.push(`  - [${e.type}] ${String(e.text).slice(0, 240)}`);
  lines.push('');
  lines.push('## Flags ranked by count');
  lines.push('');
  const ranked = data.rankedFlags || [];
  if (!ranked.length) lines.push('- none');
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    lines.push(`${i + 1}. ${r.name}: ${r.count}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  lines.push('');
  if (data.error) {
    lines.push('## Harness error');
    lines.push('');
    lines.push(data.error);
    lines.push('');
  }
  return lines.join('\n');
}

function sum(a) { return a.reduce((s, x) => s + (+x || 0), 0); }

function rankFlags(totals, fights) {
  const t = totals || {};
  const rows = [
    { name: 'feet vs matTop ±3 cm (standing)', count: t.footFlags || 0, detail: `max above ${(t.footMaxAbove || 0).toFixed(3)} m, max below ${(t.footMaxBelow || 0).toFixed(3)} m` },
    { name: 'root sliding (idle/attack clip)', count: t.slideFlags || 0, detail: `max ${(t.slideMaxSpeed || 0).toFixed(3)} m/s` },
    { name: 'torso interpenetration', count: t.interpenFlags || 0, detail: `min dist ${t.interpenMinDist == null ? 'n/a' : (+t.interpenMinDist).toFixed(3)} m` },
    { name: 'whiffs', count: Object.values(t.attacks || {}).reduce((s, v) => s + (v.whiff || 0), 0), detail: Object.entries(t.attacks || {}).map(([k, v]) => `${k} ${v.whiff}/${v.thrown}`).join(', ') },
    { name: 'hits with no defender reaction', count: t.noReaction || 0, detail: '' },
    { name: 'attack spam (gap < 0.3 s)', count: t.spam || 0, detail: '' },
    { name: 'attacking a downed opponent', count: t.attackDowned || 0, detail: '' },
    { name: 'ragdoll hover above mat', count: t.ragHoverFlags || 0, detail: `max ${(t.ragHoverMax || 0).toFixed(3)} m` },
    { name: 'stuck states', count: t.stuck || 0, detail: '' },
    { name: 'console errors/warnings', count: 0, detail: '' },
  ];
  return rows;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) {
    console.log(`Usage: node tools/selftest.mjs [N] [options]
  N, --fights N        Number of Bot vs Bot fights (default 3)
  --time-scale S       Game/shell clock multiplier (default 3)
  --port PORT          http.server port (default 8765; reused if already serving)
  --cdp PORT           Chrome remote-debugging port (default 9341)
  --root DIR           Game root (default: cwd or parent of tools/)
  --out DIR            Report directory (default: tools/selftest-reports)
  --gfx low|high       Test-profile graphics (default low)
  --hdri / --no-hdri   Test-profile HDRI (default off)
  --timeout SEC        Overall wall timeout (default 480)`);
    process.exit(0);
  }

  const hookPath = path.join(here, 'selftest-hook.js');
  if (!fs.existsSync(hookPath)) throw new Error('missing ' + hookPath);
  const hookSrc = fs.readFileSync(hookPath, 'utf8');
  const command = `node tools/selftest.mjs ${opt.fights} --time-scale ${opt.timeScale}`;

  let server, chrome, cdp, weStartedChrome = false, exit = 0;
  const startedAt = new Date();
  const tz = 'America/Los_Angeles';
  const startedAtLocal = startedAt.toLocaleString('en-US', { timeZone: tz }) + ' PT';

  const out = {
    startedAt: startedAt.toISOString(),
    startedAtLocal,
    command,
    fightsRequested: opt.fights,
    fightsCompleted: 0,
    timeScale: opt.timeScale,
    url: '',
    thresholds: null,
    fights: [],
    totals: {},
    consoleErrors: [],
    rankedFlags: [],
    hookPatch: 'none',
  };

  const profile = fs.mkdtempSync('/tmp/rf-selftest-chrome-');

  try {
    server = await ensureServer(opt.port, opt.root);
    out.url = server.url + '?selftest=1';
    console.log('serve', server.started ? 'started' : 'reused', server.url);

    chrome = spawn('google-chrome', [
      '--headless=new',
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--mute-audio',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      `--remote-debugging-port=${opt.cdp}`,
      `--user-data-dir=${profile}`,
      '--window-size=400,225',
      'about:blank',
    ], { stdio: 'ignore' });
    weStartedChrome = true;
    chrome.on('exit', (code) => { if (weStartedChrome) console.log('chrome exit', code); });

    const list = await waitJson(opt.cdp);
    const page = list.find((t) => t.type === 'page') || list[0];
    if (!page || !page.webSocketDebuggerUrl) throw new Error('no CDP page target');
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 225, deviceScaleFactor: 1, mobile: false });

    const boot = `
      window.__rfTestConfig = { timeScale: ${JSON.stringify(opt.timeScale)} };
      try {
        localStorage.setItem('rf_gfx', ${JSON.stringify(opt.gfx)});
        localStorage.setItem('rf_hdri', ${opt.hdri ? "'1'" : "'0'"});
        localStorage.setItem('rf_vol_master', '0');
        localStorage.setItem('rf_vol_sfx', '0');
        localStorage.setItem('rf_vol_crowd', '0');
      } catch (e) {}
      ${hookSrc}
    `;
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: boot });
    await cdp.send('Page.navigate', { url: out.url });

    let ready = false;
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      const typ = await cdp.ev('typeof window.__rfMeasureFeet');
      const hook = await cdp.ev('typeof window.__rfTest');
      const snap = hook === 'object' ? await cdp.ev('window.__rfTest && window.__rfTest.snapshot && window.__rfTest.snapshot()') : null;
      if (i % 6 === 0) console.log('load', typ, hook, snap && snap.ready, snap && snap.phase);
      if (typ === 'function' && snap && snap.ready) { ready = true; break; }
      if (typ === 'function' && hook === 'object') {
        // fighters may appear a moment after the measure hook
        if (snap && (snap.p1 || snap.ready)) { ready = true; break; }
      }
    }
    if (!ready) throw new Error('timed out waiting for game + __rfTest (model load?)');
    console.log('ready');

    const clk = async (sel) => cdp.ev(clickExpr(sel));
    // Title → main → Bot vs Bot → Start. Retry a few times; the title card can lag.
    for (let i = 0; i < 10; i++) {
      const screen = await cdp.ev('window.RFShell && RFShell.state && RFShell.state.screen');
      if (screen === 'title' || screen === 'boot') await clk('[data-act=start]');
      else if (screen === 'main') await clk('[data-mode=watch]');
      else if (screen === 'select') { await clk('[data-act=go]'); break; }
      else if (screen === 'fight') break;
      await sleep(400);
    }
    // If still not in a watch fight, try the public shell call with a roster CPU.
    await sleep(600);
    let snap = await cdp.ev('window.__rfTest.snapshot()');
    if (!snap || snap.mode !== 'watch') {
      const started = await cdp.ev(`(() => {
        const S = window.RFShell;
        if (!S || !S.startMatch || !S.ROSTER) return 'no-shell';
        const o = S.ROSTER[0];
        S.startMatch({
          mode: 'watch',
          p1: { name: 'Blue CPU', label: 'CPU', paint: { primary: '#2f74ff', accent: '#dfe6ff' } },
          p2: { name: o.name, label: o.name + ' · CPU', paint: { primary: o.primary, accent: o.accent } },
          opp: o,
        });
        return 'started';
      })()`);
      console.log('startMatch', started);
    }
    const armed = await cdp.ev('window.__rfTest.arm && window.__rfTest.arm()');
    console.log('armed', armed, await cdp.ev('window.__rfTest.snapshot()'));

    const t0 = Date.now();
    let lastLog = 0;
    while (Date.now() - t0 < opt.timeoutMs) {
      snap = await cdp.ev('window.__rfTest.snapshot()');
      if (snap && snap.__err) throw new Error(snap.__err);
      const done = (snap && snap.fightsDone) || 0;
      if (Date.now() - lastLog > 4000) {
        lastLog = Date.now();
        const cur = snap && snap.current;
        console.log(
          't+' + ((Date.now() - t0) / 1000).toFixed(0) + 's',
          'done=' + done,
          'phase=' + (snap && snap.phase),
          'screen=' + (snap && snap.screen),
          'shell=' + (snap && snap.shellPhase),
          cur ? ('fight ' + cur.index + ' @ ' + cur.gameTime + 's') : '',
          snap && snap.p1 && (snap.p1.state + '/' + snap.p2.state + ' hp ' + Math.round(snap.p1.hp) + '/' + Math.round(snap.p2.hp)),
        );
      }
      if (done >= opt.fights) break;

      // After a full match (best of 3) the results screen needs Rematch to get more fights.
      if (snap && snap.screen === 'results' && done < opt.fights) {
        const n = await clk('[data-act=rematch]');
        console.log('rematch click', n, 'done', done);
        await sleep(800);
      }

      // Safety: if a single fight stalls past the wall budget, stop.
      if (snap && snap.current && !snap.current.ended) {
        // gameTime at scale 3, 90s fight ~ 30s wall; allow 150s wall from start of this wait via overall timeout.
      }
      await sleep(250);
    }

    const raw = await cdp.ev('window.__rfTest.report()');
    if (!raw || raw.__err) throw new Error('report failed: ' + JSON.stringify(raw));
    out.thresholds = raw.thresholds;
    out.timeScale = raw.timeScale || opt.timeScale;
    out.fights = raw.fights || [];
    out.fightsCompleted = out.fights.length;
    out.totals = raw.totals || {};
    out.consoleErrors = cdp.console.slice();
    const ranked = rankFlags(out.totals, out.fights);
    ranked.find((r) => r.name.startsWith('console')).count = out.consoleErrors.length;
    out.rankedFlags = ranked.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
    if (out.fightsCompleted < opt.fights) {
      out.error = `completed ${out.fightsCompleted} of ${opt.fights} fights before timeout or stop`;
      exit = 1;
    }
  } catch (e) {
    out.error = String(e && e.stack || e);
    exit = 1;
    console.error(out.error);
    if (cdp) out.consoleErrors = cdp.console.slice();
  }

  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const dir = path.join(opt.out, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, 'report.json');
  const mdPath = path.join(dir, 'report.md');
  const md = formatReport(out);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  fs.writeFileSync(mdPath, md);
  const latestJson = path.join(opt.out, 'latest.json');
  const latestMd = path.join(opt.out, 'latest.md');
  fs.writeFileSync(latestJson, JSON.stringify(out, null, 2));
  fs.writeFileSync(latestMd, md);
  console.log('wrote', jsonPath);
  console.log('wrote', mdPath);
  console.log(md);

  if (cdp) cdp.close();
  if (weStartedChrome && chrome && chrome.pid) {
    weStartedChrome = false;
    try { process.kill(chrome.pid, 'SIGTERM'); } catch (_) {}
  }
  if (server && server.proc && server.proc.pid) {
    try { process.kill(server.proc.pid, 'SIGTERM'); } catch (_) {}
  }
  process.exit(exit);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
