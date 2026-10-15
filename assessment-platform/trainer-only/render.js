'use strict';
// Full-detail trainer output. Lives only in trainer-only/ and is never shipped to students.
const { summarize, GROUPS } = require('../core/engine');

function renderTrainer(run, cfg, extra = {}) {
  const lines = [];
  lines.push(`Set ${cfg.setId} - ${cfg.title}  (${run.serverUrl}/api/${cfg.resource})`);
  if (run.status === 'ABORTED') {
    lines.push(
      run.abortReason === 'not-empty'
        ? 'ABORTED: Restart your server so it starts with no data (the list already returned records).'
        : `ABORTED: cannot reach ${run.serverUrl}/api/${cfg.resource}`,
    );
    lines.push(`Seed: ${run.seed}`);
    return lines.join('\n');
  }
  lines.push('');
  let group = null;
  for (const r of run.results) {
    if (r.group !== group) {
      group = r.group;
      lines.push(`-- ${GROUPS.find((g) => g.key === group).title} --`);
    }
    lines.push(`${r.status.padEnd(7)} ${r.id}  ${r.name}`);
    if (r.status !== 'PASS' && r.detail) {
      if (r.detail.request) lines.push(`          sent:     ${r.detail.request}`);
      lines.push(`          expected: ${r.detail.expected}`);
      lines.push(`          got:      ${r.detail.actual}`);
    }
  }
  const s = summarize(run.results);
  lines.push('');
  lines.push(`Score: ${s.score} / ${run.results.length}  (passed ${s.passed}, failed ${s.failed}, blocked ${s.blocked})`);
  lines.push('');
  lines.push('Group                 Passed');
  for (const g of Object.values(s.groups)) {
    if (g.total) lines.push(`${g.title.padEnd(22)}${String(g.passed).padStart(3)} / ${g.total}`);
  }
  lines.push('');
  if (extra.runId) lines.push(`Run id: ${extra.runId}`);
  lines.push(`Seed: ${run.seed}   (repeat with --seed ${run.seed})`);
  return lines.join('\n');
}

module.exports = { renderTrainer };
