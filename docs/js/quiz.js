// 問題生成。誤答選択肢の選定がこのモジュールの中心。
// ★純粋関数モジュール: DOM と localStorage には触れない。

import { CHOICE_COUNT } from './config.js';

/**
 * 訳語の比較用に正規化する。
 * 括弧書き・空白・中黒・読点・末尾の句点を落とす。
 */
export function normalizeJa(text) {
  return String(text ?? '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s　・、,]/g, '')
    .replace(/[。.]+$/, '')
    .trim();
}

/** 英語の比較用に正規化する。大小文字と連続空白を吸収する。 */
export function normalizeEn(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasIntersection(a = [], b = []) {
  const set = new Set(a);
  return b.some((value) => set.has(value));
}

/**
 * 訳語が衝突しているか。
 * すべての訳語の組について、正規化後に一致・前方一致・後方一致のいずれかなら衝突とみなす。
 */
export function jaCollides(jaListA = [], jaListB = []) {
  const listA = jaListA.map(normalizeJa).filter(Boolean);
  const listB = jaListB.map(normalizeJa).filter(Boolean);
  return listA.some((a) =>
    listB.some((b) => a === b || a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a)),
  );
}

/**
 * 候補 `other` を、正解 `answer` の誤答として並べてはいけないか判定する。
 * ここが「どちらも正解ともとれる選択肢」を排除する唯一の関門なので、
 * 候補が足りないときでもこの条件は決して緩めない。
 */
export function isAmbiguousPair(answer, other, direction) {
  if (answer.id === other.id) return true;
  // 1. 意味グループの共有（同義語）
  if (hasIntersection(answer.senses, other.senses)) return true;
  // 2. 語族の共有（派生語）
  if (answer.root && other.root && answer.root === other.root) return true;
  // 3. 明示的な排除指定（どちらの向きでも効く）
  if ((answer.exclude ?? []).includes(other.id)) return true;
  if ((other.exclude ?? []).includes(answer.id)) return true;
  // 4. 訳語の衝突
  if (jaCollides(answer.ja, other.ja)) return true;
  // 5. ja2en では綴りの一致も選択肢の重複になる
  if (direction === 'ja2en' && normalizeEn(answer.en) === normalizeEn(other.en)) return true;
  return false;
}

/** 誤答として使ってよいエントリだけを取り出す。 */
export function collectDistractorCandidates(answer, pool, direction) {
  return pool.filter((other) => !isAmbiguousPair(answer, other, direction));
}

/** Fisher–Yates シャッフル。元の配列は変更しない。 */
export function shuffle(list, rng = Math.random) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 誤答を 3 件選ぶ。足りなければ null を返す（呼び出し側でその問題を捨てる）。
 *
 * 優先度は pos 一致 → type 一致 → level の差が小さい順。
 * 事前にシャッフルしてから安定ソートすることで、同順位内はランダムになる。
 */
export function pickDistractors(answer, pool, direction, rng = Math.random) {
  const candidates = collectDistractorCandidates(answer, pool, direction);
  const needed = CHOICE_COUNT - 1;
  if (candidates.length < needed) return null;

  const ranked = shuffle(candidates, rng).sort((a, b) => {
    const posDiff = Number(b.pos === answer.pos) - Number(a.pos === answer.pos);
    if (posDiff !== 0) return posDiff;
    const typeDiff = Number(b.type === answer.type) - Number(a.type === answer.type);
    if (typeDiff !== 0) return typeDiff;
    return Math.abs(a.level - answer.level) - Math.abs(b.level - answer.level);
  });

  return ranked.slice(0, needed);
}

/** 出題方向に応じた提示文と選択肢ラベルを返す。 */
function labelFor(entry, direction, role) {
  const isPrompt = role === 'prompt';
  if (direction === 'en2ja') return isPrompt ? entry.en : entry.ja[0];
  return isPrompt ? entry.ja[0] : entry.en;
}

/**
 * 1 問分のデータを組み立てる。誤答が揃わなければ null。
 *
 * 返り値の choices は 4 件で、Fisher–Yates で並べ替え済み。
 * 正解位置を補正するロジックは入れない（偏りの補正はしない）。
 */
export function buildQuestion(answer, pool, direction, rng = Math.random) {
  const distractors = pickDistractors(answer, pool, direction, rng);
  if (!distractors) return null;

  const choices = shuffle(
    [
      { id: answer.id, label: labelFor(answer, direction, 'choice'), correct: true },
      ...distractors.map((entry) => ({
        id: entry.id,
        label: labelFor(entry, direction, 'choice'),
        correct: false,
      })),
    ],
    rng,
  );

  return {
    entry: answer,
    direction,
    prompt: labelFor(answer, direction, 'prompt'),
    choices,
    answerIndex: choices.findIndex((choice) => choice.correct),
  };
}

/** 設定の出題方向を、この 1 問で使う向きに解決する。 */
export function resolveDirection(setting, rng = Math.random) {
  if (setting === 'random') return rng() < 0.5 ? 'en2ja' : 'ja2en';
  return setting;
}
