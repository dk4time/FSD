'use strict';
// Admin dashboard: plain JS, no build step. The browser's Basic-auth login covers every fetch.

const GROUPS = ['create', 'readOne', 'list', 'update', 'patch', 'delete', 'pagination', 'filter', 'search', 'sort', 'combined', 'http'];
const GROUP_MAX = { create: 14, readOne: 8, list: 8, update: 10, patch: 10, delete: 8, pagination: 12, filter: 10, search: 8, sort: 6, combined: 4, http: 2 };
const state = { students: [], sortKey: 'registrationNumber', sortDir: 1, open: null, tab: 'students', slots: [], clockOffset: 0, editing: null };

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (t) => (t ? new Date(t).toLocaleString() : '');
const scoreCls = (s) => (s === 100 ? 's100' : s < 40 ? 'slow' : '');
const shortDevice = (d) => (d ? `laptop ${String(d).slice(0, 8)}` : '');

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

function table(el, cols, rows, onRow) {
  el.querySelector('thead').innerHTML = '<tr>' + cols.map((c) => `<th data-key="${c.key}">${esc(c.label)}${state.sortKey === c.key && el.id === 'students' ? (state.sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr>';
  el.querySelector('tbody').innerHTML = rows
    .map((r, i) => `<tr data-i="${i}">` + cols.map((c) => `<td class="${c.num ? 'num' : ''} ${c.cls ? c.cls(r) : ''}">${c.html ? c.html(r) : esc(r[c.key])}</td>`).join('') + '</tr>')
    .join('');
  if (onRow) el.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => onRow(rows[Number(tr.dataset.i)])));
}

const STUDENT_COLS = [
  { key: 'registrationNumber', label: 'Registration' },
  { key: 'name', label: 'Name' },
  { key: 'section', label: 'Section' },
  { key: 'slot', label: 'Slot' },
  { key: 'assignedSet', label: 'Set' },
  { key: 'best', label: 'Best', num: true, cls: (r) => scoreCls(r.best) },
  { key: 'latest', label: 'Latest', num: true, cls: (r) => scoreCls(r.latest) },
  { key: 'attempts', label: 'Attempts', num: true },
  { key: 'lastRunAt', label: 'Last run', html: (r) => esc(fmtTime(r.lastRunAt)) },
];

function renderStudents() {
  const q = $('#q').value.trim().toLowerCase();
  const rows = state.students
    .filter((s) => !q || [s.registrationNumber, s.name, s.section, s.slot, s.assignedSet].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => {
      const x = a[state.sortKey];
      const y = b[state.sortKey];
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x || '').localeCompare(String(y || ''));
      return c * state.sortDir;
    });
  table($('#students'), STUDENT_COLS, rows, (r) => openStudent(r.registrationNumber));
}

function groupCells(g) {
  return GROUPS.map((k) => `<td class="num">${g && g[k] !== undefined ? g[k] : ''}</td>`).join('');
}

async function openStudent(reg) {
  state.open = reg;
  const d = await api(`api/students/${encodeURIComponent(reg)}`);
  const best = d.student && d.student.assessment ? d.student.assessment.best : null;
  const head = '<tr><th>When</th><th>Mode</th><th>Set</th><th>Score</th><th>Blocked</th>' + GROUPS.map((g) => `<th title="${g}">${g.slice(0, 4)}<br><span class="muted">/${GROUP_MAX[g]}</span></th>`).join('') + '<th>Seed</th><th>IP / note</th><th></th></tr>';
  const row = (r, isTrainer) => {
    const suspicious = isTrainer && best !== null && Math.abs(r.score - best) >= 10;
    return `<tr><td>${esc(fmtTime(r.receivedAt))}</td><td>${isTrainer ? 'trainer re-run' : 'student'}</td><td>${esc(r.setId)}</td>` +
      `<td class="num ${scoreCls(r.score)} ${suspicious ? 'flag' : ''}">${r.score}${suspicious ? ' ⚠' : ''}</td><td class="num">${r.blocked}</td>${groupCells(r.groupScores)}` +
      `<td>${esc(r.seed)}</td><td>${esc(isTrainer ? r.note : [r.clientIp, shortDevice(r.deviceId)].filter(Boolean).join(' · '))}</td>` +
      `<td><button class="btn danger" data-del="${esc(r.runId)}">Delete run</button></td></tr>`;
  };
  $('#detail').innerHTML =
    `<div class="panel"><h3>${esc(reg)} <span class="muted">set ${esc(d.student ? d.student.assignedSet : '')}, best ${best === null ? '-' : best}</span></h3>` +
    `<p>${d.laptop ? `Registered laptop: <b>${esc(shortDevice(d.laptop.deviceId))}</b> <span class="muted">since ${esc(fmtTime(d.laptop.boundAt))} from ${esc(d.laptop.ip)}</span> <button class="btn" id="reset-laptop">Reset laptop</button>` : '<span class="muted">No laptop registered yet (bound at the first login with the right PIN).</span>'}</p>` +
    `<p class="muted">Trainer re-runs sit next to the student's own runs. A re-run that differs from the student's best by 10 or more is marked ⚠.</p>` +
    `<div class="wrap"><table>${head}${d.trainerRuns.map((r) => row(r, true)).join('')}${d.runs.map((r) => row(r, false)).join('')}</table></div>` +
    `<p><button class="btn danger" id="del-student">Delete this student and all their runs</button> <button class="btn" id="close-detail">Close</button></p></div>`;
  $('#detail').querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`Delete run ${b.dataset.del}?`)) return;
      await api(`api/runs/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' });
      await refresh();
      openStudent(reg);
    }),
  );
  if ($('#reset-laptop')) {
    $('#reset-laptop').addEventListener('click', async () => {
      if (!confirm(`Reset the registered laptop for ${reg}? Their next login (with the right PIN) registers the laptop they use then.`)) return;
      await api(`api/students/${encodeURIComponent(reg)}/reset-laptop`, { method: 'POST' });
      openStudent(reg);
    });
  }
  $('#del-student').addEventListener('click', async () => {
    if (!confirm(`Delete ${reg} and every assessment run they submitted?`)) return;
    await api(`api/students/${encodeURIComponent(reg)}`, { method: 'DELETE' });
    $('#detail').innerHTML = '';
    state.open = null;
    refresh();
  });
  $('#close-detail').addEventListener('click', () => {
    $('#detail').innerHTML = '';
    state.open = null;
  });
}

function renderStrip(s) {
  const max = Math.max(1, ...s.distribution.map((d) => d.count));
  $('#strip').innerHTML =
    `<div class="tile"><b>${s.started}</b><span>students started${s.rosterSize ? ` of ${s.rosterSize}` : ''}</span></div>` +
    `<div class="tile"><b>${s.averageBest}</b><span>average best score</span></div>` +
    `<div class="tile"><b>${s.perfect}</b><span>scored 100</span></div>` +
    `<div class="tile"><div class="dist">${s.distribution.map((d) => `<div title="${d.from}-${d.to}: ${d.count}" style="height:${(d.count / max) * 100}%"></div>`).join('')}</div><span>best-score distribution 0 → 100</span></div>`;
}

async function renderTrainer() {
  const rows = await api('api/trainer-runs');
  table(
    $('#trainer'),
    [
      { key: 'registrationNumber', label: 'Registration' },
      { key: 'setId', label: 'Set' },
      { key: 'score', label: 'Score', num: true, cls: (r) => scoreCls(r.score) },
      { key: 'blocked', label: 'Blocked', num: true },
      { key: 'receivedAt', label: 'Time', html: (r) => esc(fmtTime(r.receivedAt)) },
      { key: 'note', label: 'Note' },
      { key: 'serverUrl', label: 'Server URL' },
    ],
    rows,
    (r) => r.registrationNumber && (switchTab('students'), openStudent(r.registrationNumber)),
  );
}

async function renderNotStarted(summary) {
  if (!summary.rosterSize) {
    $('#ns-note').textContent = 'Upload a roster CSV (reg,name,section) to see who has not started.';
    table($('#notstarted'), [], []);
    return;
  }
  const rows = await api('api/not-started');
  $('#ns-note').textContent = `${rows.length} of ${summary.rosterSize} students on the roster have no assessment run yet.`;
  table($('#notstarted'), [{ key: 'registrationNumber', label: 'Registration' }, { key: 'name', label: 'Name' }, { key: 'section', label: 'Section' }, { key: 'slot', label: 'Slot' }], rows);
}

// ---- slots ----------------------------------------------------------------------------------
// The countdowns tick every second in the browser against the server's clock (state.clockOffset), so they
// reach zero when the server starts refusing; a countdown that reaches zero reloads the slots.
const AMBER_MS = 10 * 60000;
const RED_MS = 60000;
const EXTEND_MINUTES = 10;
const serverNow = () => Date.now() + state.clockOffset;
const fmtWhen = (t) => (t ? new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const pad2 = (n) => String(n).padStart(2, '0');

function fmtLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400);
  const hms = `${pad2(Math.floor((s % 86400) / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
  return d ? `${d}d ${hms}` : hms;
}

// datetime-local wants local time "YYYY-MM-DDTHH:MM"
const toLocalInput = (t) => {
  if (!t) return '';
  const d = new Date(t);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// the state now, by the server's clock (the stored state can be up to 10 s old)
function liveState(r) {
  if (r.state === 'closed') return 'closed';
  const now = serverNow();
  if (r.closesAt && now >= new Date(r.closesAt).getTime()) return 'ended';
  if (r.opensAt && now < new Date(r.opensAt).getTime()) return 'scheduled';
  return 'open';
}

const countdown = (to, kind) => `<b class="cd" data-to="${esc(new Date(to).toISOString())}" data-kind="${kind}"></b>`;

function statusHtml(r) {
  const st = liveState(r);
  if (st === 'open') {
    return r.closesAt ? `<span class="open">Open</span> · closes in ${countdown(r.closesAt, 'close')}` : '<span class="open">Open</span> · <span class="cd-amber">no closing time</span>';
  }
  if (st === 'scheduled') return `<span class="sched">Scheduled</span> · opens in ${countdown(r.opensAt, 'open')}`;
  if (st === 'ended') return '<span class="closed">Closed</span> <span class="muted">(closing time passed)</span>';
  return '<span class="closed">Closed</span>';
}

function windowHtml(r) {
  if (state.editing === r.slot) {
    return `<label class="muted">Opens <input type="datetime-local" id="edit-opens" value="${esc(toLocalInput(r.state === 'closed' ? null : r.opensAt))}"></label> ` +
      `<label class="muted">Closes <input type="datetime-local" id="edit-closes" value="${esc(toLocalInput(r.state === 'closed' ? null : r.closesAt))}"></label> ` +
      '<button class="btn" data-act="save">Save</button> <button class="btn" data-act="cancel">Cancel</button>' +
      '<div class="muted">Leave Opens empty to open now; leave Closes empty for no closing time.</div>';
  }
  if (r.state === 'closed') return '<span class="muted">—</span>';
  return `${r.opensAt ? esc(fmtWhen(r.opensAt)) : 'now'} → ${r.closesAt ? esc(fmtWhen(r.closesAt)) : '<span class="muted">no closing time</span>'}`;
}

function actionsHtml(r) {
  if (!r.slot) return '';
  const st = liveState(r);
  const b = (act, label, cls = '') => `<button class="btn ${cls}" data-act="${act}">${label}</button>`;
  const out = [];
  if (st === 'closed' || st === 'ended') out.push(b('open', 'Open now'), b('edit', 'Schedule…'));
  if (st === 'scheduled') out.push(b('open', 'Open now'), b('edit', 'Edit window'));
  if (st === 'open') out.push(b('edit', 'Edit window'));
  if ((st === 'open' || st === 'ended') && r.closesAt) out.push(b('extend', `+${EXTEND_MINUTES} min`));
  if (st === 'open' || st === 'scheduled') out.push(b('close', st === 'scheduled' ? 'Cancel schedule' : 'Close now', 'danger'));
  out.push(`<a class="btn" href="api/pin-slips?slot=${encodeURIComponent(r.slot)}" target="_blank" rel="noopener">PIN slips</a>`);
  return out.join(' ');
}

function renderSlots() {
  const rows = state.slots;
  table(
    $('#slots'),
    [
      { key: 'slot', label: 'Slot', html: (r) => (r.slot ? esc(r.slot) : '<span class="muted">(no slot: re-upload their roster CSV)</span>') },
      { key: 'students', label: 'Students', num: true },
      { key: 'started', label: 'Submitted', num: true },
      { key: 'state', label: 'Status', html: statusHtml },
      { key: 'window', label: 'Window', html: windowHtml },
      { key: 'actions', label: '', html: actionsHtml },
    ],
    rows,
  );
  $('#slots').querySelectorAll('tbody tr').forEach((tr) => {
    const r = rows[Number(tr.dataset.i)];
    tr.querySelectorAll('button[data-act]').forEach((btn) => btn.addEventListener('click', () => slotAction(r, btn.dataset.act)));
  });
  tick();
}

function renderBanner() {
  const live = state.slots.filter((r) => r.slot && ['open', 'scheduled'].includes(liveState(r)));
  $('#slot-banner').classList.toggle('hidden', !live.length);
  $('#slot-banner').innerHTML = live
    .map((r) => {
      const st = liveState(r);
      const text = st === 'scheduled' ? `opens in ${countdown(r.opensAt, 'open')}` : r.closesAt ? `closes in ${countdown(r.closesAt, 'close')}` : '<span class="cd-amber">open, no closing time</span>';
      return `<button class="chip" data-slot="${esc(r.slot)}">${st === 'scheduled' ? '🟡' : '🟢'} <b>${esc(r.slot)}</b> ${text}</button>`;
    })
    .join('');
  $('#slot-banner').querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => switchTab('slots')));
  tick();
}

// updates every countdown on the page; one that has reached zero reloads the slots (once)
let reloading = false;
function tick() {
  let due = false;
  document.querySelectorAll('.cd').forEach((el) => {
    const left = new Date(el.dataset.to).getTime() - serverNow();
    el.textContent = fmtLeft(left);
    el.classList.toggle('cd-red', el.dataset.kind === 'close' && left <= RED_MS);
    el.classList.toggle('cd-amber', el.dataset.kind === 'close' && left > RED_MS && left <= AMBER_MS);
    if (left <= 0) due = true;
  });
  if (due && !reloading) {
    reloading = true;
    loadSlots().finally(() => (reloading = false));
  }
}

async function loadSlots() {
  const d = await api('api/slots');
  state.clockOffset = new Date(d.now).getTime() - Date.now();
  state.slots = d.slots;
  renderBanner();
  // leave the table alone while a window is being edited, so the refresh does not wipe what is typed
  if (state.tab === 'slots' && !state.editing) renderSlots();
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = isError ? 'show error' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), isError ? 7000 : 4000);
}

const describeWindow = (d) =>
  d.state === 'scheduled' ? `opens ${fmtWhen(d.opensAt)}${d.closesAt ? `, closes ${fmtWhen(d.closesAt)}` : ''}` : d.closesAt ? `open, closes ${fmtWhen(d.closesAt)}` : 'open, no closing time';

async function postSlot(path, body) {
  return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function slotAction(r, act) {
  const slot = r.slot;
  const url = `api/slots/${encodeURIComponent(slot)}`;
  if (act === 'edit') {
    state.editing = slot;
    renderSlots();
    $('#edit-closes').focus();
    return;
  }
  if (act === 'cancel') {
    state.editing = null;
    renderSlots();
    return;
  }
  if (act === 'close' && !confirm(`${liveState(r) === 'scheduled' ? 'Cancel the schedule of' : 'Close'} ${slot}? Its students can no longer log in or submit.`)) return;
  let body = null;
  if (act === 'save') {
    const val = (id) => ($(id).value ? new Date($(id).value).toISOString() : null);
    const opensAt = val('#edit-opens');
    const closesAt = val('#edit-closes');
    if (closesAt && new Date(closesAt) <= new Date(serverNow())) return toast('The closing time has already passed. Pick a later time.', true);
    if (opensAt && closesAt && new Date(opensAt) >= new Date(closesAt)) return toast('The closing time must be after the opening time.', true);
    body = { open: true, opensAt, closesAt };
  }
  $('#slots').querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    let d;
    if (act === 'save') d = await postSlot(url, body);
    // Open now keeps a closing time that is still ahead
    if (act === 'open') d = await postSlot(url, { open: true, opensAt: null, closesAt: r.closesAt && new Date(r.closesAt).getTime() > serverNow() ? r.closesAt : null });
    if (act === 'close') d = await postSlot(url, { open: false });
    if (act === 'extend') d = await postSlot(`${url}/extend`, { minutes: EXTEND_MINUTES });
    state.editing = null;
    toast(act === 'close' ? `${slot} is closed.` : act === 'extend' ? `${slot} extended: closes ${fmtWhen(d.closesAt)}.` : `${slot}: ${describeWindow(d)}.`);
  } catch (e) {
    toast(`Could not update ${slot}: ${e.message}`, true);
  } finally {
    await loadSlots().catch(() => {});
    // a failed save keeps the form (and what was typed) open: just enable its buttons again
    if (state.editing) $('#slots').querySelectorAll('button').forEach((btn) => (btn.disabled = false));
    else renderSlots();
  }
}

async function renderConflicts() {
  const rows = await api('api/laptop-conflicts');
  $('#lc-note').textContent = rows.length
    ? `${rows.length} rejected login(s). Each one was refused: check with the student, and use Reset laptop on the student only for a genuine laptop change.`
    : 'No rejected logins. A login is rejected when a registration number is used from a second laptop, or a laptop is used for a second registration number.';
  table(
    $('#conflicts'),
    [
      { key: 'at', label: 'When', html: (r) => esc(fmtTime(r.at)) },
      { key: 'registrationNumber', label: 'Registration' },
      { key: 'kind', label: 'What happened' },
      { key: 'otherRegistrationNumber', label: 'Laptop belongs to' },
      { key: 'deviceId', label: 'Laptop', html: (r) => esc(shortDevice(r.deviceId)) },
      { key: 'clientIp', label: 'IP' },
    ],
    rows,
    (r) => (switchTab('students'), openStudent(r.registrationNumber)),
  );
}

async function refresh() {
  try {
    const [students, summary] = await Promise.all([api('api/students'), api('api/summary'), loadSlots()]);
    state.students = students;
    renderStrip(summary);
    renderStudents();
    if (state.tab === 'trainer') await renderTrainer();
    if (state.tab === 'notstarted') await renderNotStarted(summary);
    if (state.tab === 'conflicts') await renderConflicts();
    $('#updated').textContent = `updated ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    $('#updated').textContent = `refresh error: ${e.message}`;
  }
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  for (const t of ['students', 'slots', 'trainer', 'notstarted', 'conflicts']) $(`#tab-${t}`).classList.toggle('hidden', t !== tab);
  refresh();
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$('#q').addEventListener('input', renderStudents);
$('#students thead').addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (!th) return;
  if (state.sortKey === th.dataset.key) state.sortDir *= -1;
  else {
    state.sortKey = th.dataset.key;
    state.sortDir = 1;
  }
  renderStudents();
});
$('#roster').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const guess = file.name.replace(/\.csv$/i, '').replace(/^roster-/i, '').replace(/[^A-Za-z0-9._-]/g, '-');
  const slot = (prompt('Slot (assessment session) for these students, one name per session, e.g. sist-15-10-26-fn:', guess) || '').trim();
  if (!slot) {
    e.target.value = '';
    return;
  }
  try {
    const r = await api(`api/roster?slot=${encodeURIComponent(slot)}`, { method: 'POST', headers: { 'content-type': 'text/csv' }, body: await file.text() });
    alert(`Roster imported: ${r.imported} students in slot ${r.slot}. Open the slot in the Slots tab when the session starts.`);
  } catch (err) {
    alert(`Roster upload problem: ${err.message}`);
  }
  e.target.value = '';
  refresh();
});

refresh();
setInterval(refresh, 10000);
setInterval(tick, 1000);
