// 統計の集計。
// ★純粋関数モジュール: DOM と localStorage には触れない。
// 「今日の日付」も外から dateKey として受け取る。

import {
  SCHEMA_VERSION,
  DAILY_RETENTION_DAYS,
  DIRECTIONS,
  WEAK_ENTRY_RULE,
  RESULT,
} from './config.js';

/** 統計の初期値。 */
export function createStats() {
  return {
    schemaVersion: SCHEMA_VERSION,
    total: { asked: 0, correct: 0, skipped: 0 },
    byDirection: {
      en2ja: { asked: 0, correct: 0, skipped: 0 },
      ja2en: { asked: 0, correct: 0, skipped: 0 },
    },
    daily: {},
    currentStreak: 0,
    maxStreak: 0,
  };
}

/** 日別統計を新しい順に retention 件だけ残す（ISO 日付は辞書順＝時系列順）。 */
export function pruneDaily(daily, retention = DAILY_RETENTION_DAYS) {
  const keys = Object.keys(daily).sort();
  const kept = keys.slice(-retention);
  return Object.fromEntries(kept.map((key) => [key, daily[key]]));
}

/**
 * 1 問分の結果を反映した新しい統計を返す。
 * スキップは正解として数えないため正答率を下げるが、
 * 誤答と区別できるよう skipped にも計上する。
 */
export function recordResult(stats, { direction, result, dateKey }) {
  const point = result === RESULT.CORRECT ? 1 : 0;
  const skip = result === RESULT.SKIPPED ? 1 : 0;
  const day = stats.daily[dateKey] ?? { asked: 0, correct: 0, skipped: 0 };
  const currentStreak = point ? stats.currentStreak + 1 : 0;
  const directionKey = DIRECTIONS.includes(direction) ? direction : DIRECTIONS[0];
  const forDirection = stats.byDirection[directionKey];

  return {
    ...stats,
    total: {
      asked: stats.total.asked + 1,
      correct: stats.total.correct + point,
      skipped: (stats.total.skipped ?? 0) + skip,
    },
    byDirection: {
      ...stats.byDirection,
      [directionKey]: {
        asked: forDirection.asked + 1,
        correct: forDirection.correct + point,
        skipped: (forDirection.skipped ?? 0) + skip,
      },
    },
    daily: pruneDaily({
      ...stats.daily,
      [dateKey]: {
        asked: day.asked + 1,
        correct: day.correct + point,
        skipped: (day.skipped ?? 0) + skip,
      },
    }),
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, currentStreak),
  };
}

/** 正答率。出題数 0 のときは null を返し、画面側で「—」を出す。 */
export function accuracy(asked, correct) {
  if (!asked) return null;
  return correct / asked;
}

/**
 * progress を任意のキーで束ねて正答率を出す。
 * keyFn は 1 エントリから 1 つまたは複数のキーを返す（tags 用）。
 */
export function accuracyBy(progress, entries, keyFn) {
  const buckets = new Map();
  for (const entry of entries) {
    const state = progress[entry.id];
    if (!state || state.seen === 0) continue;
    const keys = [keyFn(entry)].flat().filter((key) => key !== undefined && key !== null);
    for (const key of keys) {
      const bucket = buckets.get(key) ?? { key, asked: 0, correct: 0 };
      bucket.asked += state.seen;
      bucket.correct += state.correct;
      buckets.set(key, bucket);
    }
  }
  return [...buckets.values()].map((bucket) => ({
    ...bucket,
    accuracy: accuracy(bucket.asked, bucket.correct),
  }));
}

/** 学習カバレッジ（1 回以上出題したエントリ数 / 全収録数）。 */
export function coverage(progress, entries) {
  const seen = entries.filter((entry) => (progress[entry.id]?.seen ?? 0) > 0).length;
  return { seen, total: entries.length, ratio: entries.length ? seen / entries.length : 0 };
}

/** 苦手な語。出題 minSeen 回以上のうち、正答率の低い順。 */
export function weakEntries(progress, entries, rule = WEAK_ENTRY_RULE) {
  return entries
    .map((entry) => ({ entry, state: progress[entry.id] }))
    .filter(({ state }) => state && state.seen >= rule.minSeen)
    .map(({ entry, state }) => ({
      entry,
      seen: state.seen,
      correct: state.correct,
      skipped: state.skipped ?? 0,
      accuracy: state.correct / state.seen,
    }))
    .sort((a, b) => a.accuracy - b.accuracy || b.seen - a.seen)
    .slice(0, rule.limit);
}

/** 指定した日付キーの並びで日別統計を取り出す（グラフ描画用）。 */
export function dailySeries(stats, dateKeys) {
  return dateKeys.map((dateKey) => {
    const day = stats.daily[dateKey] ?? { asked: 0, correct: 0, skipped: 0 };
    return {
      dateKey,
      asked: day.asked,
      correct: day.correct,
      skipped: day.skipped ?? 0,
      accuracy: accuracy(day.asked, day.correct),
    };
  });
}

/** 統計画面に出す値を一括で求める。 */
export function summarize(stats, progress, entries) {
  return {
    asked: stats.total.asked,
    correct: stats.total.correct,
    skipped: stats.total.skipped ?? 0,
    accuracy: accuracy(stats.total.asked, stats.total.correct),
    maxStreak: stats.maxStreak,
    studyDays: Object.keys(stats.daily).length,
    byDirection: DIRECTIONS.map((direction) => ({
      direction,
      ...stats.byDirection[direction],
      accuracy: accuracy(stats.byDirection[direction].asked, stats.byDirection[direction].correct),
    })),
    byLevel: accuracyBy(progress, entries, (entry) => entry.level).sort((a, b) => a.key - b.key),
    byType: accuracyBy(progress, entries, (entry) => entry.type),
    byTag: accuracyBy(progress, entries, (entry) => entry.tags ?? []).sort(
      (a, b) => b.asked - a.asked,
    ),
    coverage: coverage(progress, entries),
    weak: weakEntries(progress, entries),
  };
}
