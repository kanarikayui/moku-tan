import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStats,
  recordResult,
  accuracy,
  accuracyBy,
  coverage,
  weakEntries,
  dailySeries,
  pruneDaily,
  summarize,
} from '../docs/js/stats.js';
import { RESULT } from '../docs/js/config.js';
import { entry } from './fixtures.mjs';

function record(stats, direction, isCorrect, dateKey = '2026-08-10') {
  const result = isCorrect ? RESULT.CORRECT : RESULT.WRONG;
  return recordResult(stats, { direction, result, dateKey });
}

function skip(stats, direction, dateKey = '2026-08-10') {
  return recordResult(stats, { direction, result: RESULT.SKIPPED, dateKey });
}

test('総計と方向別集計が正しい', () => {
  let stats = createStats();
  stats = record(stats, 'en2ja', true);
  stats = record(stats, 'en2ja', false);
  stats = record(stats, 'ja2en', true);
  stats = record(stats, 'ja2en', true);

  assert.deepEqual(stats.total, { asked: 4, correct: 3, skipped: 0 });
  assert.deepEqual(stats.byDirection.en2ja, { asked: 2, correct: 1, skipped: 0 });
  assert.deepEqual(stats.byDirection.ja2en, { asked: 2, correct: 2, skipped: 0 });
});

test('日別集計が日付ごとに分かれる', () => {
  let stats = createStats();
  stats = record(stats, 'en2ja', true, '2026-08-09');
  stats = record(stats, 'en2ja', false, '2026-08-10');
  stats = record(stats, 'ja2en', true, '2026-08-10');

  assert.deepEqual(stats.daily['2026-08-09'], { asked: 1, correct: 1, skipped: 0 });
  assert.deepEqual(stats.daily['2026-08-10'], { asked: 2, correct: 1, skipped: 0 });
});

test('最大連続正解が記録される', () => {
  let stats = createStats();
  for (const result of [true, true, true, false, true, true]) {
    stats = record(stats, 'en2ja', result);
  }
  assert.equal(stats.maxStreak, 3);
  assert.equal(stats.currentStreak, 2);
});

test('recordResult は元の統計を変更しない', () => {
  const before = createStats();
  const after = record(before, 'en2ja', true);
  assert.equal(before.total.asked, 0);
  assert.equal(after.total.asked, 1);
});

test('日別集計は保持日数を超えると古いものから消える', () => {
  const daily = {};
  for (let day = 1; day <= 10; day += 1) {
    daily[`2026-08-${String(day).padStart(2, '0')}`] = { asked: 1, correct: 1 };
  }
  const pruned = pruneDaily(daily, 3);
  assert.deepEqual(Object.keys(pruned), ['2026-08-08', '2026-08-09', '2026-08-10']);
});

test('正答率は出題数 0 のとき null', () => {
  assert.equal(accuracy(0, 0), null);
  assert.equal(accuracy(4, 3), 0.75);
});

const entries = [
  entry('a', { level: 1, type: 'word', tags: ['finance'] }),
  entry('b', { level: 1, type: 'word', tags: ['finance', 'hr'] }),
  entry('c', { level: 3, type: 'phrase', pos: 'phrase', tags: ['hr'] }),
];

const progress = {
  a: { seen: 4, correct: 2, wrong: 2, streak: 0, nextDue: 0, lastAskedAt: null },
  b: { seen: 2, correct: 2, wrong: 0, streak: 2, nextDue: 0, lastAskedAt: null },
  c: { seen: 5, correct: 1, wrong: 4, streak: 0, nextDue: 0, lastAskedAt: null },
};

test('難易度別・種別の正答率を集計できる', () => {
  const byLevel = accuracyBy(progress, entries, (item) => item.level);
  assert.deepEqual(
    byLevel.find((row) => row.key === 1),
    { key: 1, asked: 6, correct: 4, accuracy: 4 / 6 },
  );

  const byType = accuracyBy(progress, entries, (item) => item.type);
  assert.deepEqual(
    byType.find((row) => row.key === 'phrase'),
    { key: 'phrase', asked: 5, correct: 1, accuracy: 0.2 },
  );
});

test('タグ別集計は 1 エントリを複数のタグに数える', () => {
  const byTag = accuracyBy(progress, entries, (item) => item.tags);
  const finance = byTag.find((row) => row.key === 'finance');
  const hr = byTag.find((row) => row.key === 'hr');
  assert.deepEqual(finance, { key: 'finance', asked: 6, correct: 4, accuracy: 4 / 6 });
  assert.deepEqual(hr, { key: 'hr', asked: 7, correct: 3, accuracy: 3 / 7 });
});

test('未出題のエントリは集計に含まれない', () => {
  const byLevel = accuracyBy({ a: progress.a }, entries, (item) => item.level);
  assert.equal(byLevel.length, 1);
  assert.equal(byLevel[0].asked, 4);
});

test('カバレッジは出題済み件数を数える', () => {
  assert.deepEqual(coverage({ a: progress.a }, entries), { seen: 1, total: 3, ratio: 1 / 3 });
  assert.deepEqual(coverage({}, entries), { seen: 0, total: 3, ratio: 0 });
});

test('苦手な語は出題 3 回以上を正答率の低い順に並べる', () => {
  const weak = weakEntries(progress, entries, { minSeen: 3, limit: 20 });
  assert.deepEqual(
    weak.map((row) => row.entry.id),
    ['c', 'a'],
  );
  assert.equal(weak[0].accuracy, 0.2);
});

test('日別グラフ用の系列は指定日を欠かさず返す', () => {
  let stats = createStats();
  stats = record(stats, 'en2ja', true, '2026-08-10');
  const series = dailySeries(stats, ['2026-08-09', '2026-08-10']);
  assert.deepEqual(series[0], {
    dateKey: '2026-08-09',
    asked: 0,
    correct: 0,
    skipped: 0,
    accuracy: null,
  });
  assert.deepEqual(series[1], {
    dateKey: '2026-08-10',
    asked: 1,
    correct: 1,
    skipped: 0,
    accuracy: 1,
  });
});

test('summarize が画面表示に必要な値を揃える', () => {
  let stats = createStats();
  stats = record(stats, 'en2ja', true);
  stats = record(stats, 'ja2en', false);
  const summary = summarize(stats, progress, entries);

  assert.equal(summary.asked, 2);
  assert.equal(summary.accuracy, 0.5);
  assert.equal(summary.studyDays, 1);
  assert.deepEqual(
    summary.byDirection.map((row) => row.direction),
    ['en2ja', 'ja2en'],
  );
  assert.deepEqual(
    summary.byLevel.map((row) => row.key),
    [1, 3],
  );
  assert.equal(summary.coverage.total, 3);
});

test('スキップは出題数に入るが正解には数えない', () => {
  let stats = createStats();
  stats = record(stats, 'en2ja', true);
  stats = skip(stats, 'en2ja');
  assert.deepEqual(stats.total, { asked: 2, correct: 1, skipped: 1 });
  assert.equal(stats.byDirection.en2ja.skipped, 1);
  assert.equal(accuracy(stats.total.asked, stats.total.correct), 0.5);
});

test('スキップで連続正解が切れる', () => {
  let stats = createStats();
  stats = record(stats, 'en2ja', true);
  stats = record(stats, 'en2ja', true);
  stats = skip(stats, 'en2ja');
  assert.equal(stats.currentStreak, 0);
  assert.equal(stats.maxStreak, 2);
});

test('日別集計にもスキップが入る', () => {
  let stats = createStats();
  stats = skip(stats, 'ja2en', '2026-08-10');
  assert.deepEqual(stats.daily['2026-08-10'], { asked: 1, correct: 0, skipped: 1 });
  assert.equal(dailySeries(stats, ['2026-08-10'])[0].skipped, 1);
});

test('summarize がスキップ総数を返す', () => {
  const stats = skip(createStats(), 'en2ja');
  assert.equal(summarize(stats, {}, []).skipped, 1);
});
