'use strict';
// What the assessment kit is allowed to print: each check's name with PASS or FAIL, and nothing
// that reveals marks (no score, no counts, no check ids, no expected/actual detail). The full-detail
// output used by the trainer is NOT part of this file and is never shipped to students.

const MESSAGES = {
  start: (url) => `Checking your API at ${url} ...`,
  progress: (attempted, total) => `Running checks: ${attempted} of ${total} attempted`,
  unreachable: (url) => `Cannot reach your server at ${url}`,
  notEmpty: 'Your server is not empty. Restart it so it starts with no data.',
  recorded: 'Submission recorded. Your result has been sent to your trainer.',
  runId: (id) => `Run id: ${id}`,
  pending: 'Your result is saved on this computer but NOT recorded yet. Tell the invigilator, then run npm run submit-pending.',
};

// One line per check, under its group title. BLOCKED is shown as FAIL: it scores nothing either.
function renderChecks(results, groups) {
  const lines = [];
  let group = null;
  for (const r of results) {
    if (r.group !== group) {
      group = r.group;
      const g = groups.find((x) => x.key === group);
      lines.push('', `-- ${g ? g.title : group} --`);
    }
    lines.push(`${r.status === 'PASS' ? 'PASS' : 'FAIL'}  ${r.name}`);
  }
  lines.push('');
  return lines.join('\n');
}

// outcome: { kind: 'aborted', reason, url } | { kind: 'recorded', runId } | { kind: 'pending' } | { kind: 'rejected', message }
function renderStudent(outcome) {
  switch (outcome.kind) {
    case 'aborted':
      return outcome.reason === 'not-empty' ? MESSAGES.notEmpty : MESSAGES.unreachable(outcome.url);
    case 'recorded':
      return `${MESSAGES.recorded}\n${MESSAGES.runId(outcome.runId)}`;
    case 'pending':
      return MESSAGES.pending;
    case 'rejected':
      return outcome.message;
    default:
      return '';
  }
}

module.exports = { MESSAGES, renderStudent, renderChecks };
