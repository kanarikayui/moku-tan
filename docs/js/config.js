// アプリ全体の既定値と定数。
// DOM と localStorage には触れない。

/** localStorage のキー接頭辞。 */
export const STORAGE_PREFIX = 'moku-tan:v1:';

/** 保存データのスキーマ版。storage.js の migrate() が判定に使う。 */
export const SCHEMA_VERSION = 1;

/** 1 問あたりの選択肢数（正解 1 + 誤答 3）。スキップはこれに含めない。 */
export const CHOICE_COUNT = 4;

/**
 * 1 問の結果。
 * 'skipped' は出題間隔の扱いを 'wrong' と同じにするが、集計では区別する。
 */
export const RESULT = { CORRECT: 'correct', WRONG: 'wrong', SKIPPED: 'skipped' };

/** 集計で扱う結果の一覧。 */
export const RESULTS = [RESULT.CORRECT, RESULT.WRONG, RESULT.SKIPPED];

/** 出題方向の一覧。設定値の 'random' はこの中から 1 問ごとに選ぶ。 */
export const DIRECTIONS = ['en2ja', 'ja2en'];

/** 難易度帯。 */
export const LEVELS = [1, 2, 3, 4, 5];

/** エントリ種別。 */
export const TYPES = ['word', 'phrase'];

/** 許可する品詞。 */
export const PARTS_OF_SPEECH = ['noun', 'verb', 'adj', 'adv', 'prep', 'phrase'];

/** 設定画面で変更できる再出題間隔の範囲。 */
export const INTERVAL_LIMITS = {
  wrong: { min: 1, max: 100 },
  correct: { min: 2, max: 400 },
};

export const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,
  direction: 'random', // 'en2ja' | 'ja2en' | 'random'
  intervalWrong: 10, // A
  intervalCorrect: 40, // B
  levels: [...LEVELS],
  types: [...TYPES],
  theme: 'auto', // 'auto' | 'light' | 'dark'
};

/** スケジューラの調整値。設定画面からは変更しない。 */
export const SCHEDULER = {
  INTERVAL_GROWTH: 1.6,
  INTERVAL_MAX: 400,
  W_NEW: 12,
  W_BASE: 3,
  MISS_BOOST: 2.0,
  MASTERY_DECAY: 0.45,
  OVERDUE_CAP: 3.0,
  MIN_WEIGHT: 0.05,
  NEW_RATIO_WINDOW: 20,
  NEW_RATIO_LIMIT: 0.6,
  FALLBACK_POOL: 20,
};

/** 日別統計を保持する日数。 */
export const DAILY_RETENTION_DAYS = 60;

/** 統計画面の「苦手な語」の抽出条件。 */
export const WEAK_ENTRY_RULE = { minSeen: 3, limit: 20 };

/**
 * A < B の制約を検証する。破っていれば例外を投げる。
 * 正解語の再出題間隔が不正解語より短いと、間違えた語ほど後回しになってしまう。
 */
export function validateIntervals(intervalWrong, intervalCorrect) {
  if (!Number.isInteger(intervalWrong) || !Number.isInteger(intervalCorrect)) {
    throw new Error('再出題間隔は整数で指定してください');
  }
  if (intervalWrong >= intervalCorrect) {
    throw new Error(
      `再出題間隔は A < B である必要があります (A=${intervalWrong}, B=${intervalCorrect})`,
    );
  }
}

/**
 * 設定値を検査し、エラーメッセージの配列を返す。空配列なら妥当。
 * 設定画面はこの結果を表示し、1 件でもあれば保存しない。
 */
export function collectSettingErrors(settings) {
  const errors = [];
  const { wrong, correct } = INTERVAL_LIMITS;

  if (!['en2ja', 'ja2en', 'random'].includes(settings.direction)) {
    errors.push('出題方向の値が不正です');
  }
  if (
    !Number.isInteger(settings.intervalWrong) ||
    settings.intervalWrong < wrong.min ||
    settings.intervalWrong > wrong.max
  ) {
    errors.push(`不正解語の再出題間隔 A は ${wrong.min}〜${wrong.max} の整数で入力してください`);
  }
  if (
    !Number.isInteger(settings.intervalCorrect) ||
    settings.intervalCorrect < correct.min ||
    settings.intervalCorrect > correct.max
  ) {
    errors.push(
      `正解語の再出題間隔 B は ${correct.min}〜${correct.max} の整数で入力してください`,
    );
  }
  if (errors.length === 0 && settings.intervalWrong >= settings.intervalCorrect) {
    errors.push('A（不正解）は B（正解）より小さい値にしてください');
  }
  if (!Array.isArray(settings.levels) || settings.levels.length === 0) {
    errors.push('出題する難易度を 1 つ以上選んでください');
  }
  if (!Array.isArray(settings.types) || settings.types.length === 0) {
    errors.push('出題する種別（単語 / 熟語）を 1 つ以上選んでください');
  }
  if (!['auto', 'light', 'dark'].includes(settings.theme)) {
    errors.push('テーマの値が不正です');
  }
  return errors;
}

/**
 * 設定からスケジューラ用の設定オブジェクトを組み立てる。
 */
export function schedulerConfig(settings) {
  validateIntervals(settings.intervalWrong, settings.intervalCorrect);
  return {
    ...SCHEDULER,
    intervalWrong: settings.intervalWrong,
    intervalCorrect: settings.intervalCorrect,
  };
}
