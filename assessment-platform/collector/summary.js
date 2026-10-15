'use strict';
// Server-side scoring (never trusts client totals) and the per-student summary.

const GROUP_OF = { C: 'create', R: 'readOne', L: 'list', U: 'update', P: 'patch', D: 'delete', G: 'pagination', F: 'filter', S: 'search', O: 'sort', X: 'combined', H: 'http' };
const GROUP_KEYS = ['create', 'readOne', 'list', 'update', 'patch', 'delete', 'pagination', 'filter', 'search', 'sort', 'combined', 'http'];

function computeScores(tests) {
  const groupScores = Object.fromEntries(GROUP_KEYS.map((k) => [k, 0]));
  let passed = 0;
  let failed = 0;
  let blocked = 0;
  for (const t of tests) {
    if (t.status === 'PASS') {
      passed++;
      groupScores[GROUP_OF[t.id[0]]]++;
    } else if (t.status === 'BLOCKED') blocked++;
    else failed++;
  }
  return { score: passed, passed, failed, blocked, groupScores };
}

// Rebuilds students/<reg> from the runs collection (simple and robust at this scale).
// Students enter their set in the kit (npm run whoami, -- --change to correct it). The student's set is
// the set of their latest run, and best / latest / attempts count only runs of that set, so runs made
// under a wrong set do not mix into the summary (they stay in the run history).
async function rebuildStudent(db, reg, assignedSet) {
  const runs = db.collection('runs');
  const lastRun = await runs.find({ registrationNumber: reg, mode: 'assessment' }).sort({ receivedAt: -1 }).limit(1).next();
  const setId = assignedSet || (lastRun && lastRun.setId);
  const [agg] = lastRun
    ? await runs
        .aggregate([
          { $match: { registrationNumber: reg, mode: 'assessment', setId } },
          { $sort: { receivedAt: 1 } },
          {
            $group: {
              _id: '$registrationNumber',
              attempts: { $sum: 1 },
              latest: { $last: '$score' },
              lastRunAt: { $last: '$receivedAt' },
              best: { $top: { sortBy: { score: -1, receivedAt: 1 }, output: { score: '$score', runId: '$runId', groupScores: '$groupScores' } } },
            },
          },
        ])
        .toArray()
    : [];
  if (!agg) {
    await db.collection('students').deleteOne({ _id: reg });
    return null;
  }
  const doc = {
    assignedSet: setId,
    assessment: {
      best: agg.best.score,
      latest: agg.latest,
      attempts: agg.attempts,
      bestRunId: agg.best.runId,
      lastRunAt: agg.lastRunAt,
      bestGroupScores: agg.best.groupScores,
    },
    updatedAt: new Date(),
  };
  await db.collection('students').updateOne({ _id: reg }, { $set: doc }, { upsert: true });
  return { _id: reg, ...doc };
}

module.exports = { computeScores, rebuildStudent, GROUP_KEYS, GROUP_OF };
