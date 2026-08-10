// 出題順スケジューラ。
// ★純粋関数モジュール: DOM と localStorage には触れない。
//
// グローバルな出題連番 counter（1 問出すごとに +1）を基準に、
// 各エントリの nextDue（次に出題可能になる counter）を管理する。

/** 1 エントリ分の学習状態の初期値。 */
export function createEntryState() {
  return { seen: 0, correct: 0, wrong: 0, streak: 0, nextDue: 0, lastAskedAt: null };
}

/** セッション（出題連番と直近履歴）の初期値。 */
export function createSession() {
  return { counter: 0, recent: [], newFlags: [] };
}

/** progress から状態を取り出す。未登録なら初期値。 */
export function getState(progress, id) {
  return progress[id] ?? createEntryState();
}

/**
 * 抽選の重みを求める。
 * 未出題語は W_NEW 固定。出題済語は「正答率が低いほど」「超過しているほど」大きく、
 * 連続正解が伸びるほど小さくなる。
 */
export function computeWeight(state, counter, config, newWeight = config.W_NEW) {
  if (state.seen === 0) return newWeight;

  const accuracy = state.correct / state.seen;
  const overdue = Math.max(0, counter - state.nextDue);
  const overdueBoost = 1 + Math.min(overdue / config.intervalWrong, config.OVERDUE_CAP);
  const missFactor = 1 + config.MISS_BOOST * (1 - accuracy);
  const mastery = state.streak >= 3 ? config.MASTERY_DECAY ** (state.streak - 2) : 1;

  return Math.max(config.W_BASE * missFactor * overdueBoost * mastery, config.MIN_WEIGHT);
}

/** 重み付きランダム抽選。 */
export function pickWeighted(items, weights, rng = Math.random) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (items.length === 0 || total <= 0) return null;

  let threshold = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    threshold -= weights[i];
    if (threshold < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * 次に出題するエントリを選ぶ。候補が作れなければ null。
 *
 * 1. 直近 A 問に出したものはリングバッファで無条件に除外（連続出題のハードガード）
 * 2. nextDue <= counter のものを候補にする
 * 3. 候補が空なら nextDue の小さい順に上位 FALLBACK_POOL 件を候補にする
 * 4. 重み付きランダム抽選
 */
export function selectNext(pool, progress, session, config, rng = Math.random) {
  const recent = new Set(session.recent);
  const available = pool.filter((entry) => !recent.has(entry.id));
  if (available.length === 0) return null;

  let candidates = available.filter(
    (entry) => getState(progress, entry.id).nextDue <= session.counter,
  );

  if (candidates.length === 0) {
    candidates = [...available]
      .sort((a, b) => getState(progress, a.id).nextDue - getState(progress, b.id).nextDue)
      .slice(0, config.FALLBACK_POOL);
  }

  const newWeight = newEntryWeight(session, config);
  const weights = candidates.map((entry) =>
    computeWeight(getState(progress, entry.id), session.counter, config, newWeight),
  );

  return pickWeighted(candidates, weights, rng);
}

/**
 * 未出題語の重み。新出語ばかりが続かないよう、
 * 直近 NEW_RATIO_WINDOW 問の未出題率が上限を超えている間は半減させる。
 */
export function newEntryWeight(session, config) {
  const flags = session.newFlags;
  if (flags.length === 0) return config.W_NEW;
  const ratio = flags.filter(Boolean).length / flags.length;
  return ratio > config.NEW_RATIO_LIMIT ? config.W_NEW / 2 : config.W_NEW;
}

/**
 * 1 問出題したあとのセッションを返す。
 * recent は直近 A 問、newFlags は直近 NEW_RATIO_WINDOW 問だけ保持する。
 */
export function advanceSession(session, entryId, wasNew, config) {
  return {
    counter: session.counter + 1,
    recent: [...session.recent, entryId].slice(-config.intervalWrong),
    newFlags: [...session.newFlags, Boolean(wasNew)].slice(-config.NEW_RATIO_WINDOW),
  };
}

/**
 * 回答結果を学習状態に反映した新しい状態を返す。
 *
 * 正解:   streak += 1 / nextDue = counter + min(B * GROWTH^(streak-1), INTERVAL_MAX)
 * 不正解: streak = 0  / nextDue = counter + A
 *
 * counter はこの問題を出題したあとの値（＝この問題を含む出題数）を渡す。
 */
export function applyAnswer(state, isCorrect, counter, config, timestamp = null) {
  if (isCorrect) {
    const streak = state.streak + 1;
    const interval = Math.min(
      Math.round(config.intervalCorrect * config.INTERVAL_GROWTH ** (streak - 1)),
      config.INTERVAL_MAX,
    );
    return {
      seen: state.seen + 1,
      correct: state.correct + 1,
      wrong: state.wrong,
      streak,
      nextDue: counter + interval,
      lastAskedAt: timestamp,
    };
  }

  return {
    seen: state.seen + 1,
    correct: state.correct,
    wrong: state.wrong + 1,
    streak: 0,
    nextDue: counter + config.intervalWrong,
    lastAskedAt: timestamp,
  };
}
