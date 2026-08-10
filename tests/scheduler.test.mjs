import test from 'node:test';
import assert from 'node:assert/strict';

import { SCHEDULER, schedulerConfig, validateIntervals, DEFAULT_SETTINGS } from '../docs/js/config.js';
import {
  createEntryState,
  createSession,
  applyAnswer,
  advanceSession,
  selectNext,
  computeWeight,
  pickWeighted,
  newEntryWeight,
} from '../docs/js/scheduler.js';
import { buildPlainPool, seededRandom } from './fixtures.mjs';

const config = { ...SCHEDULER, intervalWrong: 10, intervalCorrect: 40 };

test('A >= B は例外になる', () => {
  assert.throws(() => validateIntervals(40, 40), /A < B/);
  assert.throws(() => validateIntervals(50, 40), /A < B/);
  assert.doesNotThrow(() => validateIntervals(10, 40));
});

test('既定の設定は A < B を満たす', () => {
  assert.ok(DEFAULT_SETTINGS.intervalWrong < DEFAULT_SETTINGS.intervalCorrect);
  assert.doesNotThrow(() => schedulerConfig(DEFAULT_SETTINGS));
});

test('不正解語は A 問後に再出題できるようになる', () => {
  const state = applyAnswer(createEntryState(), false, 100, config);
  assert.equal(state.nextDue, 110);
  assert.equal(state.streak, 0);
  assert.equal(state.wrong, 1);
});

test('正解語は B 問後に再出題できるようになる', () => {
  const state = applyAnswer(createEntryState(), true, 100, config);
  assert.equal(state.nextDue, 140);
  assert.equal(state.streak, 1);
  assert.equal(state.correct, 1);
});

test('連続正解で間隔が指数的に伸び、上限で頭打ちになる', () => {
  let state = createEntryState();
  const intervals = [];
  for (let i = 0; i < 8; i += 1) {
    const before = state;
    state = applyAnswer(before, true, 0, config);
    intervals.push(state.nextDue);
  }
  assert.deepEqual(intervals.slice(0, 3), [40, 64, 102]);
  for (let i = 1; i < intervals.length; i += 1) {
    assert.ok(intervals[i] >= intervals[i - 1], '間隔が縮んでいます');
  }
  assert.equal(intervals[intervals.length - 1], config.INTERVAL_MAX);
});

test('不正解で連続正解の記録がリセットされる', () => {
  let state = applyAnswer(createEntryState(), true, 0, config);
  state = applyAnswer(state, true, 0, config);
  assert.equal(state.streak, 2);
  state = applyAnswer(state, false, 200, config);
  assert.equal(state.streak, 0);
  assert.equal(state.nextDue, 210);
});

test('直近 A 問に出した語は選ばれない', () => {
  const pool = buildPlainPool(30);
  const progress = {};
  let session = createSession();
  const rng = seededRandom(42);

  const asked = [];
  for (let i = 0; i < 60; i += 1) {
    const entry = selectNext(pool, progress, session, config, rng);
    assert.ok(entry, '出題対象が見つかりませんでした');
    assert.ok(
      !session.recent.includes(entry.id),
      `直近 ${config.intervalWrong} 問に出た語が再出題されました: ${entry.id}`,
    );
    session = advanceSession(session, entry.id, true, config);
    progress[entry.id] = applyAnswer(
      progress[entry.id] ?? createEntryState(),
      true,
      session.counter,
      config,
    );
    asked.push(entry.id);
  }

  // 連続する A 問の窓の中に同じ ID が 2 回現れないこと
  for (let i = 0; i + config.intervalWrong < asked.length; i += 1) {
    const window = asked.slice(i, i + config.intervalWrong + 1);
    assert.equal(new Set(window).size, window.length, `窓 ${i} に重複があります`);
  }
});

test('間違えた語は正解した語より早く戻ってくる', () => {
  const pool = buildPlainPool(60);
  const progress = {};
  let session = createSession();
  const rng = seededRandom(7);

  // 1 巡目: e000 だけ不正解、他は正解
  for (let i = 0; i < 50; i += 1) {
    const entry = selectNext(pool, progress, session, config, rng);
    session = advanceSession(session, entry.id, true, config);
    const isCorrect = entry.id !== 'e000';
    progress[entry.id] = applyAnswer(
      progress[entry.id] ?? createEntryState(),
      isCorrect,
      session.counter,
      config,
    );
  }

  const wrongState = progress.e000;
  if (wrongState) {
    const correctStates = Object.entries(progress)
      .filter(([id]) => id !== 'e000')
      .map(([, state]) => state);
    const median = correctStates.map((state) => state.nextDue).sort((a, b) => a - b)[
      Math.floor(correctStates.length / 2)
    ];
    assert.ok(
      wrongState.nextDue < median,
      `不正解語の再出題が遅すぎます (${wrongState.nextDue} vs ${median})`,
    );
  }
});

test('未出題語の重みが出題済語より大きい', () => {
  const unseen = createEntryState();
  const mastered = { seen: 5, correct: 5, wrong: 0, streak: 5, nextDue: 100, lastAskedAt: null };
  assert.ok(computeWeight(unseen, 100, config) > computeWeight(mastered, 100, config));
});

test('正答率が低い語ほど重みが大きい', () => {
  const weak = { seen: 4, correct: 1, wrong: 3, streak: 0, nextDue: 50, lastAskedAt: null };
  const strong = { seen: 4, correct: 4, wrong: 0, streak: 1, nextDue: 50, lastAskedAt: null };
  assert.ok(computeWeight(weak, 50, config) > computeWeight(strong, 50, config));
});

test('超過した語ほど重みが大きいが、上限で頭打ちになる', () => {
  const state = { seen: 3, correct: 2, wrong: 1, streak: 0, nextDue: 100, lastAskedAt: null };
  const slight = computeWeight(state, 105, config);
  const heavy = computeWeight(state, 200, config);
  const extreme = computeWeight(state, 10000, config);
  assert.ok(heavy > slight);
  assert.equal(heavy, extreme);
});

test('未出題語が一定割合で出題される', () => {
  const pool = buildPlainPool(80);
  const progress = {};
  let session = createSession();
  const rng = seededRandom(123);

  let newCount = 0;
  const total = 100;
  for (let i = 0; i < total; i += 1) {
    const entry = selectNext(pool, progress, session, config, rng);
    const wasNew = (progress[entry.id]?.seen ?? 0) === 0;
    if (wasNew) newCount += 1;
    session = advanceSession(session, entry.id, wasNew, config);
    progress[entry.id] = applyAnswer(
      progress[entry.id] ?? createEntryState(),
      true,
      session.counter,
      config,
    );
  }
  assert.ok(newCount >= 40, `未出題語の出題が少なすぎます: ${newCount}/${total}`);
  assert.ok(newCount <= 80, `未出題語が上限を超えました: ${newCount}`);
});

test('未出題が続きすぎると新出語の重みが半減する', () => {
  const flooded = { counter: 20, recent: [], newFlags: Array.from({ length: 20 }, () => true) };
  const mixed = { counter: 20, recent: [], newFlags: Array.from({ length: 20 }, (_, i) => i < 5) };
  const unseen = createEntryState();
  assert.equal(computeWeight(unseen, 20, config, config.W_NEW / 2), config.W_NEW / 2);
  // newFlags の割合に応じて selectNext が渡す重みが変わる
  assert.equal(newEntryWeight(flooded, config), config.W_NEW / 2);
  assert.equal(newEntryWeight(mixed, config), config.W_NEW);
});

test('候補がすべて未来でもフォールバックで 1 件返る', () => {
  const pool = buildPlainPool(5);
  const progress = Object.fromEntries(
    pool.map((entry) => [entry.id, { ...createEntryState(), seen: 1, correct: 1, nextDue: 999 }]),
  );
  const session = createSession();
  const entry = selectNext(pool, progress, session, config, seededRandom(1));
  assert.ok(entry, 'フォールバックが働いていません');
});

test('出題対象がなければ null を返す', () => {
  assert.equal(selectNext([], {}, createSession(), config, seededRandom(1)), null);
});

test('pickWeighted は重みの大きい方をより多く選ぶ', () => {
  const rng = seededRandom(5);
  let first = 0;
  for (let i = 0; i < 1000; i += 1) {
    if (pickWeighted(['a', 'b'], [9, 1], rng) === 'a') first += 1;
  }
  assert.ok(first > 820 && first < 970, `偏りが想定外です: ${first}/1000`);
});
