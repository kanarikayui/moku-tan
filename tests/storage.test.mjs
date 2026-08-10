import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, STORAGE_PREFIX } from '../docs/js/config.js';

/** localStorage の最小実装。storage.js は globalThis.localStorage を見る。 */
class FakeStorage {
  #map = new Map();

  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }

  setItem(key, value) {
    this.#map.set(key, String(value));
  }

  removeItem(key) {
    this.#map.delete(key);
  }

  key(index) {
    return [...this.#map.keys()][index] ?? null;
  }

  get length() {
    return this.#map.size;
  }
}

globalThis.localStorage = new FakeStorage();

const {
  KEYS,
  loadSettings,
  saveSettings,
  loadProgress,
  saveProgress,
  loadStats,
  saveStats,
  resetStats,
  resetProgress,
  resetAll,
  createProgress,
} = await import('../docs/js/storage.js');

function reset() {
  globalThis.localStorage = new FakeStorage();
}

test('未保存なら既定値を返し、recovered は false', () => {
  reset();
  const { value, recovered } = loadSettings();
  assert.equal(recovered, false);
  assert.deepEqual(value, DEFAULT_SETTINGS);
});

test('破損 JSON を読んだら既定値へフォールバックする', () => {
  reset();
  globalThis.localStorage.setItem(KEYS.settings, '{壊れた JSON');
  const { value, recovered } = loadSettings();
  assert.equal(recovered, true);
  assert.deepEqual(value, DEFAULT_SETTINGS);
});

test('進捗と統計も破損時に既定値へ倒れる', () => {
  reset();
  globalThis.localStorage.setItem(KEYS.progress, 'null');
  globalThis.localStorage.setItem(KEYS.stats, '[1,2,3]');
  assert.equal(loadProgress().recovered, true);
  assert.deepEqual(loadProgress().value, createProgress());
  assert.equal(loadStats().recovered, true);
  assert.equal(loadStats().value.total.asked, 0);
});

test('スキーマ版が未知なら既定値へ倒れる', () => {
  reset();
  globalThis.localStorage.setItem(
    KEYS.settings,
    JSON.stringify({ ...DEFAULT_SETTINGS, schemaVersion: 99 }),
  );
  assert.equal(loadSettings().recovered, true);
});

test('A >= B の設定が保存されていても既定値へ倒れる', () => {
  reset();
  globalThis.localStorage.setItem(
    KEYS.settings,
    JSON.stringify({ ...DEFAULT_SETTINGS, intervalWrong: 50, intervalCorrect: 40 }),
  );
  const { value, recovered } = loadSettings();
  assert.equal(recovered, true);
  assert.equal(value.intervalWrong, DEFAULT_SETTINGS.intervalWrong);
});

test('保存した設定を読み戻せる', () => {
  reset();
  saveSettings({ ...DEFAULT_SETTINGS, direction: 'ja2en', intervalWrong: 5, intervalCorrect: 30 });
  const { value, recovered } = loadSettings();
  assert.equal(recovered, false);
  assert.equal(value.direction, 'ja2en');
  assert.equal(value.intervalWrong, 5);
});

test('未知の level / type は読み込み時に落とされる', () => {
  reset();
  globalThis.localStorage.setItem(
    KEYS.settings,
    JSON.stringify({ ...DEFAULT_SETTINGS, levels: [1, 9], types: ['word', 'unknown'] }),
  );
  const { value } = loadSettings();
  assert.deepEqual(value.levels, [1]);
  assert.deepEqual(value.types, ['word']);
});

test('壊れたエントリ状態は読み飛ばす', () => {
  reset();
  saveProgress({
    schemaVersion: 1,
    counter: 3,
    entries: {
      w0001: { seen: 2, correct: 1, wrong: 1, streak: 0, nextDue: 12, lastAskedAt: null },
      w0002: { seen: 'x' },
    },
  });
  const { value } = loadProgress();
  assert.equal(value.counter, 3);
  assert.ok(value.entries.w0001);
  assert.equal(value.entries.w0002, undefined);
});

test('統計のみ初期化すると進捗と設定は残る', () => {
  reset();
  saveSettings(DEFAULT_SETTINGS);
  saveProgress({ ...createProgress(), counter: 7 });
  saveStats({ ...loadStats().value, total: { asked: 5, correct: 4 } });

  resetStats();
  assert.equal(loadStats().value.total.asked, 0);
  assert.equal(loadProgress().value.counter, 7);
  assert.equal(loadSettings().recovered, false);
});

test('学習進捗の初期化は統計も消すが設定は残す', () => {
  reset();
  saveSettings({ ...DEFAULT_SETTINGS, direction: 'ja2en' });
  saveProgress({ ...createProgress(), counter: 7 });
  saveStats({ ...loadStats().value, total: { asked: 5, correct: 4 } });

  resetProgress();
  assert.equal(loadProgress().value.counter, 0);
  assert.equal(loadStats().value.total.asked, 0);
  assert.equal(loadSettings().value.direction, 'ja2en');
});

test('すべて初期化すると接頭辞付きのキーが消える', () => {
  reset();
  saveSettings(DEFAULT_SETTINGS);
  saveProgress(createProgress());
  saveStats(loadStats().value);
  globalThis.localStorage.setItem('other-app:keep', 'x');

  resetAll();
  assert.equal(globalThis.localStorage.getItem(KEYS.settings), null);
  assert.equal(globalThis.localStorage.getItem(KEYS.progress), null);
  assert.equal(globalThis.localStorage.getItem(KEYS.stats), null);
  assert.equal(globalThis.localStorage.getItem('other-app:keep'), 'x');
});

test('キーは moku-tan:v1: 接頭辞で統一されている', () => {
  for (const key of Object.values(KEYS)) {
    assert.ok(key.startsWith(STORAGE_PREFIX), `${key} に接頭辞がありません`);
  }
});

test('スキップ機能より前の進捗を読んでも skipped は 0 になる', () => {
  reset();
  globalThis.localStorage.setItem(
    KEYS.progress,
    JSON.stringify({
      schemaVersion: 1,
      counter: 5,
      // skipped フィールドが無い旧形式
      entries: { w0001: { seen: 3, correct: 1, wrong: 2, streak: 0, nextDue: 9, lastAskedAt: null } },
    }),
  );
  const { value, recovered } = loadProgress();
  assert.equal(recovered, false);
  assert.equal(value.entries.w0001.skipped, 0);
  assert.equal(value.entries.w0001.wrong, 2);
});

test('スキップ機能より前の統計を読んでも skipped は 0 になる', () => {
  reset();
  globalThis.localStorage.setItem(
    KEYS.stats,
    JSON.stringify({
      schemaVersion: 1,
      total: { asked: 10, correct: 6 },
      byDirection: { en2ja: { asked: 6, correct: 4 }, ja2en: { asked: 4, correct: 2 } },
      daily: {},
      currentStreak: 1,
      maxStreak: 3,
    }),
  );
  const { value, recovered } = loadStats();
  assert.equal(recovered, false);
  assert.equal(value.total.skipped, 0);
  assert.equal(value.total.correct, 6);
  assert.equal(value.byDirection.ja2en.skipped, 0);
});

test('skipped を含む進捗を読み書きできる', () => {
  reset();
  saveProgress({
    schemaVersion: 1,
    counter: 2,
    entries: {
      w0001: { seen: 4, correct: 1, wrong: 1, skipped: 2, streak: 0, nextDue: 12, lastAskedAt: null },
    },
  });
  assert.equal(loadProgress().value.entries.w0001.skipped, 2);
});

test('抽選のガード（recent / newFlags）を保存して読み戻せる', () => {
  reset();
  saveProgress({
    ...createProgress(),
    counter: 12,
    recent: ['w0001', 'w0002', 'w0003'],
    newFlags: [true, false, true],
  });
  const { value, recovered } = loadProgress();
  assert.equal(recovered, false);
  assert.equal(value.counter, 12);
  assert.deepEqual(value.recent, ['w0001', 'w0002', 'w0003']);
  assert.deepEqual(value.newFlags, [true, false, true]);
});

test('recent / newFlags を持たない旧データは空配列で補う', () => {
  reset();
  globalThis.localStorage.setItem(
    KEYS.progress,
    JSON.stringify({ schemaVersion: 1, counter: 4, entries: {} }),
  );
  const { value, recovered } = loadProgress();
  assert.equal(recovered, false);
  assert.equal(value.counter, 4);
  assert.deepEqual(value.recent, []);
  assert.deepEqual(value.newFlags, []);
});

test('recent に文字列以外が混じっていても落として読む', () => {
  reset();
  globalThis.localStorage.setItem(
    KEYS.progress,
    JSON.stringify({
      schemaVersion: 1,
      counter: 1,
      recent: ['w0001', 42, null, 'w0002'],
      newFlags: 'こわれている',
      entries: {},
    }),
  );
  const { value } = loadProgress();
  assert.deepEqual(value.recent, ['w0001', 'w0002']);
  assert.deepEqual(value.newFlags, []);
});

test('学習進捗を初期化すると抽選のガードも消える', () => {
  reset();
  saveProgress({ ...createProgress(), counter: 9, recent: ['w0001'], newFlags: [true] });
  resetProgress();
  const { value } = loadProgress();
  assert.equal(value.counter, 0);
  assert.deepEqual(value.recent, []);
  assert.deepEqual(value.newFlags, []);
});
