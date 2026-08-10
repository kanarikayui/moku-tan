// localStorage の読み書きとマイグレーション。
// 破損データを読んだときは既定値へフォールバックし、recovered=true を返す。

import {
  STORAGE_PREFIX,
  SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  LEVELS,
  TYPES,
  RESULTS,
} from './config.js';
import { createStats } from './stats.js';

export const KEYS = {
  settings: `${STORAGE_PREFIX}settings`,
  progress: `${STORAGE_PREFIX}progress`,
  stats: `${STORAGE_PREFIX}stats`,
};

/** localStorage が使えない環境（プライベートモード等）向けの代替。 */
const memoryStore = new Map();

const fallbackStorage = {
  getItem: (key) => (memoryStore.has(key) ? memoryStore.get(key) : null),
  setItem: (key, value) => memoryStore.set(key, value),
  removeItem: (key) => memoryStore.delete(key),
  key: (index) => [...memoryStore.keys()][index] ?? null,
  get length() {
    return memoryStore.size;
  },
};

/** 実際に使うストレージを返す。テストからは globalThis.localStorage を差し替える。 */
function store() {
  try {
    const candidate = globalThis.localStorage;
    if (candidate) {
      candidate.getItem(`${STORAGE_PREFIX}__probe`);
      return candidate;
    }
  } catch {
    // アクセス自体が例外になる環境ではメモリへ退避する
  }
  return fallbackStorage;
}

function readRaw(key) {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    store().setItem(key, value);
    return true;
  } catch {
    // 容量超過などで書けない場合も、アプリは動作を続ける
    return false;
  }
}

/**
 * 空の学習進捗。
 * recent / newFlags は抽選のガードで、ブラウザを更新しても続きから出題するために保存する。
 */
export function createProgress() {
  return { schemaVersion: SCHEMA_VERSION, counter: 0, recent: [], newFlags: [], entries: {} };
}

/**
 * 旧スキーマを現行版へ変換する。
 * v1 が初版なので現状は素通し。将来の版はここに分岐を足す。
 */
export function migrate(kind, value) {
  if (!value || typeof value !== 'object') return null;
  if (value.schemaVersion === SCHEMA_VERSION) return value;
  if (typeof value.schemaVersion !== 'number') return null;
  // 未知の（より新しい）版は読まずに既定値へ倒す
  if (value.schemaVersion > SCHEMA_VERSION) return null;
  return { ...value, schemaVersion: SCHEMA_VERSION };
}

/**
 * JSON を読み、検証して返す。
 * 未保存なら recovered=false、破損していれば recovered=true で既定値を返す。
 */
function load(kind, key, createDefault, normalize) {
  const raw = readRaw(key);
  if (raw === null) return { value: createDefault(), recovered: false };

  try {
    const parsed = JSON.parse(raw);
    const migrated = migrate(kind, parsed);
    if (!migrated) return { value: createDefault(), recovered: true };
    const normalized = normalize(migrated);
    if (!normalized) return { value: createDefault(), recovered: true };
    return { value: normalized, recovered: false };
  } catch {
    return { value: createDefault(), recovered: true };
  }
}

function normalizeSettings(value) {
  const merged = { ...DEFAULT_SETTINGS, ...value, schemaVersion: SCHEMA_VERSION };
  if (!['en2ja', 'ja2en', 'random'].includes(merged.direction)) return null;
  if (!Number.isInteger(merged.intervalWrong) || !Number.isInteger(merged.intervalCorrect)) {
    return null;
  }
  if (merged.intervalWrong >= merged.intervalCorrect) return null;
  merged.levels = Array.isArray(merged.levels)
    ? merged.levels.filter((level) => LEVELS.includes(level))
    : [];
  merged.types = Array.isArray(merged.types)
    ? merged.types.filter((type) => TYPES.includes(type))
    : [];
  if (merged.levels.length === 0) merged.levels = [...LEVELS];
  if (merged.types.length === 0) merged.types = [...TYPES];
  if (!['auto', 'light', 'dark'].includes(merged.theme)) merged.theme = DEFAULT_SETTINGS.theme;
  return merged;
}

function normalizeProgress(value) {
  if (typeof value.entries !== 'object' || value.entries === null) return null;
  if (!Number.isFinite(value.counter)) return null;
  const entries = {};
  for (const [id, state] of Object.entries(value.entries)) {
    if (!state || typeof state !== 'object') continue;
    const seen = Number(state.seen);
    const correct = Number(state.correct);
    const wrong = Number(state.wrong);
    const streak = Number(state.streak);
    const nextDue = Number(state.nextDue);
    if (![seen, correct, wrong, streak, nextDue].every(Number.isFinite)) continue;
    entries[id] = {
      seen,
      correct,
      wrong,
      // skipped はスキップ機能より前に保存された進捗には無いので 0 で補う
      skipped: Number.isFinite(Number(state.skipped)) ? Number(state.skipped) : 0,
      streak,
      nextDue,
      lastAskedAt: typeof state.lastAskedAt === 'string' ? state.lastAskedAt : null,
      // lastResult を持たない旧データや未知の値は null にする
      lastResult: RESULTS.includes(state.lastResult) ? state.lastResult : null,
    };
  }
  // recent / newFlags を持たない旧データは空配列で補う
  return {
    schemaVersion: SCHEMA_VERSION,
    counter: value.counter,
    recent: Array.isArray(value.recent) ? value.recent.filter((id) => typeof id === 'string') : [],
    newFlags: Array.isArray(value.newFlags) ? value.newFlags.map(Boolean) : [],
    entries,
  };
}

function normalizeStats(value) {
  const base = createStats();
  if (!value.total || typeof value.total !== 'object') return null;
  const directions = value.byDirection ?? {};
  // skipped が無い旧データは 0 として読む
  return {
    ...base,
    total: {
      asked: Number(value.total.asked) || 0,
      correct: Number(value.total.correct) || 0,
      skipped: Number(value.total.skipped) || 0,
    },
    byDirection: {
      en2ja: {
        asked: Number(directions.en2ja?.asked) || 0,
        correct: Number(directions.en2ja?.correct) || 0,
        skipped: Number(directions.en2ja?.skipped) || 0,
      },
      ja2en: {
        asked: Number(directions.ja2en?.asked) || 0,
        correct: Number(directions.ja2en?.correct) || 0,
        skipped: Number(directions.ja2en?.skipped) || 0,
      },
    },
    daily: value.daily && typeof value.daily === 'object' ? value.daily : {},
    currentStreak: Number(value.currentStreak) || 0,
    maxStreak: Number(value.maxStreak) || 0,
  };
}

export function loadSettings() {
  return load('settings', KEYS.settings, () => ({ ...DEFAULT_SETTINGS }), normalizeSettings);
}

export function saveSettings(settings) {
  return writeRaw(KEYS.settings, JSON.stringify({ ...settings, schemaVersion: SCHEMA_VERSION }));
}

export function loadProgress() {
  return load('progress', KEYS.progress, createProgress, normalizeProgress);
}

export function saveProgress(progress) {
  return writeRaw(KEYS.progress, JSON.stringify({ ...progress, schemaVersion: SCHEMA_VERSION }));
}

export function loadStats() {
  return load('stats', KEYS.stats, createStats, normalizeStats);
}

export function saveStats(stats) {
  return writeRaw(KEYS.stats, JSON.stringify({ ...stats, schemaVersion: SCHEMA_VERSION }));
}

/** 統計のみ初期化する。出題間隔（progress）は残す。 */
export function resetStats() {
  try {
    store().removeItem(KEYS.stats);
  } catch {
    // 失敗しても続行する
  }
}

/** 学習進捗と統計を初期化する。設定は残す。 */
export function resetProgress() {
  try {
    store().removeItem(KEYS.progress);
    store().removeItem(KEYS.stats);
  } catch {
    // 失敗しても続行する
  }
}

/** moku-tan:v1: の全キーを削除する。 */
export function resetAll() {
  const target = store();
  const keys = [];
  try {
    for (let i = 0; i < target.length; i += 1) {
      const key = target.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) target.removeItem(key);
  } catch {
    // 失敗しても続行する
  }
}
