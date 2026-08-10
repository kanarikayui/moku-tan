// 出題画面の DOM 制御。
// ロジックは quiz.js / scheduler.js に置き、ここは状態の受け渡しと描画に徹する。

import { schedulerConfig, CHOICE_COUNT, RESULT } from './config.js';
import { loadEntries, filterEntries } from './data.js';
import { buildQuestion, resolveDirection } from './quiz.js';
import {
  createSession,
  getState,
  selectNext,
  advanceSession,
  applyResult,
} from './scheduler.js';
import { recordResult } from './stats.js';
import { loadSettings, loadProgress, saveProgress, loadStats, saveStats } from './storage.js';
import { applyStoredTheme, formatPercent, markCurrentNav, showNotice, toDateKey } from './ui.js';

const DIRECTION_LABEL = {
  en2ja: '英語 → 日本語',
  ja2en: '日本語 → 英語',
};

/** 誤答が揃わないエントリを引いたときの、1 問あたりの再抽選上限。 */
const RESELECT_LIMIT = 12;

/**
 * 正解したときに次の問題へ移るまでの待ち時間 (ms)。
 * 0 にすると、答えたタップがそのまま次の問題の選択肢に当たってしまう。
 * 正解の印を一瞬見せる目的も兼ねる。
 */
const CORRECT_ADVANCE_DELAY = 300;

const dom = {
  notice: document.getElementById('notice'),
  todayAsked: document.getElementById('today-asked'),
  todayCorrect: document.getElementById('today-correct'),
  todaySkipped: document.getElementById('today-skipped'),
  todayAccuracy: document.getElementById('today-accuracy'),
  directionLabel: document.getElementById('direction-label'),
  prompt: document.getElementById('prompt'),
  choices: document.getElementById('choices'),
  feedback: document.getElementById('feedback'),
  next: document.getElementById('next'),
  quiz: document.getElementById('quiz'),
};

const state = {
  settings: null,
  config: null,
  pool: [],
  progress: null,
  stats: null,
  session: createSession(),
  question: null,
  answered: false,
  advanceTimer: null,
};

/**
 * ヘッダーは保存済みの日別統計から描く。
 * 画面の状態を持たないので、ブラウザを更新しても数字が 0 に戻らない。
 */
function renderTodayBar() {
  const today = state.stats.daily[toDateKey()] ?? { asked: 0, correct: 0, skipped: 0 };
  dom.todayAsked.textContent = String(today.asked);
  dom.todayCorrect.textContent = String(today.correct);
  dom.todaySkipped.textContent = String(today.skipped ?? 0);
  dom.todayAccuracy.textContent = formatPercent(today.asked ? today.correct / today.asked : null);
}

function clearChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

const VERDICT = {
  [RESULT.CORRECT]: { className: 'is-correct', label: '○ 正解' },
  [RESULT.WRONG]: { className: 'is-wrong', label: '× 不正解' },
  [RESULT.SKIPPED]: { className: 'is-skipped', label: '－ スキップ' },
};

/**
 * 正解のときは判定だけを出してすぐ次へ進む。
 * 語の意味を確かめたいのは答えられなかったときなので、
 * 不正解とスキップでは詳細を出して手を止める。
 */
function renderFeedback(result) {
  const { entry } = state.question;
  clearChildren(dom.feedback);

  const verdict = document.createElement('p');
  verdict.className = `verdict ${VERDICT[result].className}`;
  verdict.textContent = VERDICT[result].label;
  dom.feedback.append(verdict);

  if (result === RESULT.CORRECT) return;

  const headword = document.createElement('p');
  headword.className = 'feedback-headword';
  headword.textContent = entry.en;
  dom.feedback.append(headword);

  const meaning = document.createElement('p');
  meaning.className = 'feedback-meaning';
  meaning.textContent = entry.ja.join('、');
  dom.feedback.append(meaning);

  if (entry.example) {
    const exampleEn = document.createElement('p');
    exampleEn.className = 'feedback-example-en';
    exampleEn.textContent = entry.example.en;
    const exampleJa = document.createElement('p');
    exampleJa.className = 'feedback-example-ja';
    exampleJa.textContent = entry.example.ja;
    dom.feedback.append(exampleEn, exampleJa);
  }
}

function renderQuestion() {
  const { question } = state;
  dom.directionLabel.textContent = DIRECTION_LABEL[question.direction];
  dom.prompt.textContent = question.prompt;
  dom.prompt.lang = question.direction === 'en2ja' ? 'en' : 'ja';

  clearChildren(dom.choices);
  question.choices.forEach((choice, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.dataset.index = String(index);

    const key = document.createElement('span');
    key.className = 'choice-key';
    key.textContent = String(index + 1);

    const label = document.createElement('span');
    label.className = 'choice-label';
    label.textContent = choice.label;
    label.lang = question.direction === 'en2ja' ? 'ja' : 'en';

    button.append(key, label);
    button.addEventListener('click', () => resolve(choice.correct ? RESULT.CORRECT : RESULT.WRONG, index));
    item.append(button);
    dom.choices.append(item);
  });

  dom.choices.append(buildSkipItem(question.choices.length));

  clearChildren(dom.feedback);
  dom.next.hidden = true;
  state.answered = false;
}

/** 4 択の下に置くスキップ。答えを選ばずに意味を確認したいときに押す。 */
function buildSkipItem(choiceCount) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'choice is-skip';

  const key = document.createElement('span');
  key.className = 'choice-key';
  key.textContent = String(choiceCount + 1);

  const label = document.createElement('span');
  label.className = 'choice-label';
  label.textContent = 'スキップ（答えを見る）';

  button.append(key, label);
  button.addEventListener('click', () => resolve(RESULT.SKIPPED));
  item.append(button);
  return item;
}

/**
 * 回答後に選択肢へ印を付け、押せないようにする。
 * スキップのときは selectedIndex が null なので、正解の印だけが付く。
 */
function markChoices(selectedIndex) {
  const buttons = dom.choices.querySelectorAll('.choice');
  buttons.forEach((button, index) => {
    button.disabled = true;
    const choice = state.question.choices[index];
    if (!choice) return; // 末尾のスキップボタン
    if (choice.correct) button.classList.add('is-correct');
    if (index === selectedIndex && !choice.correct) button.classList.add('is-wrong');
  });
}

/**
 * 1 問の結果を確定させる。
 * result が 'skipped' のときは selectedIndex を渡さない。
 */
function resolve(result, selectedIndex = null) {
  if (state.answered || !state.question) return;
  state.answered = true;

  const entry = state.question.entry;
  const timestamp = new Date().toISOString();

  const previous = getState(state.progress.entries, entry.id);
  state.progress.entries[entry.id] = applyResult(
    previous,
    result,
    state.session.counter,
    state.config,
    timestamp,
  );
  // 出題連番と抽選のガードを保存し、更新後も同じ続きから出題できるようにする
  state.progress.counter = state.session.counter;
  state.progress.recent = state.session.recent;
  state.progress.newFlags = state.session.newFlags;
  saveProgress(state.progress);

  state.stats = recordResult(state.stats, {
    direction: state.question.direction,
    result,
    dateKey: toDateKey(),
  });
  saveStats(state.stats);

  markChoices(selectedIndex);
  renderFeedback(result);
  renderTodayBar();

  if (result === RESULT.CORRECT) {
    // 正解なら止めずに次へ。ボタンは出さない。
    state.advanceTimer = globalThis.setTimeout(nextQuestion, CORRECT_ADVANCE_DELAY);
    return;
  }

  // 不正解とスキップは意味を確認できるよう、押すまで止める
  dom.next.hidden = false;
  dom.next.focus();
}

/**
 * 次の 1 問を用意する。
 * 誤答が 3 件揃わないエントリは捨てて引き直し、ID を console.warn に出す。
 */
function nextQuestion() {
  if (state.advanceTimer !== null) {
    globalThis.clearTimeout(state.advanceTimer);
    state.advanceTimer = null;
  }

  const unusable = new Set();
  for (let attempt = 0; attempt < RESELECT_LIMIT; attempt += 1) {
    const pool = state.pool.filter((entry) => !unusable.has(entry.id));
    const entry = selectNext(pool, state.progress.entries, state.session, state.config);
    if (!entry) break;

    const direction = resolveDirection(state.settings.direction);
    const question = buildQuestion(entry, state.pool, direction);
    if (!question) {
      console.warn(`誤答候補が不足したため出題を見送りました: ${entry.id} (${entry.en})`);
      unusable.add(entry.id);
      continue;
    }

    const wasNew = getState(state.progress.entries, entry.id).seen === 0;
    state.session = advanceSession(state.session, entry.id, wasNew, state.config);
    state.question = question;
    renderQuestion();
    return;
  }

  state.question = null;
  dom.quiz.hidden = true;
  showNotice(
    dom.notice,
    `出題できる問題がありません。設定画面で出題範囲を広げるか、語彙データを確認してください（選択肢は ${CHOICE_COUNT} 件必要です）。`,
  );
}

function handleKeydown(event) {
  if (event.target instanceof HTMLElement && event.target.tagName === 'INPUT') return;
  // 押しっぱなしの自動リピートで、次の問題まで答えてしまうのを防ぐ
  if (event.repeat) return;

  if (!state.answered && /^[1-5]$/.test(event.key)) {
    const index = Number(event.key) - 1;
    const choices = state.question?.choices ?? [];
    if (index < choices.length) {
      event.preventDefault();
      resolve(choices[index].correct ? RESULT.CORRECT : RESULT.WRONG, index);
    } else if (index === choices.length && choices.length > 0) {
      event.preventDefault();
      resolve(RESULT.SKIPPED);
    }
    return;
  }
  // 「次へ」は不正解のときだけ出る。正解時は自動で進むので受け付けない
  if (!dom.next.hidden && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    nextQuestion();
  }
}

async function start() {
  markCurrentNav();

  const settings = loadSettings();
  const progress = loadProgress();
  const stats = loadStats();

  state.settings = settings.value;
  state.progress = progress.value;
  state.stats = stats.value;
  applyStoredTheme(state.settings);

  if (settings.recovered || progress.recovered || stats.recovered) {
    showNotice(dom.notice, '保存データを読み込めなかったため初期化しました。');
  }

  // 語彙データの読み込みに失敗しても、今日の成績だけは見せる
  renderTodayBar();

  try {
    state.config = schedulerConfig(state.settings);
  } catch (error) {
    console.warn(error);
    showNotice(dom.notice, '再出題間隔の設定が不正だったため既定値に戻しました。');
    state.settings = { ...state.settings, intervalWrong: 10, intervalCorrect: 40 };
    state.config = schedulerConfig(state.settings);
  }

  let entries;
  try {
    ({ entries } = await loadEntries());
  } catch (error) {
    console.error(error);
    dom.quiz.hidden = true;
    showNotice(dom.notice, '語彙データを読み込めませんでした。HTTP サーバー経由で開いているか確認してください。');
    return;
  }

  state.pool = filterEntries(entries, state.settings);
  // 前回の続きから。直近 A 問のリングバッファも戻すので、更新直後に同じ語は出ない
  state.session = {
    ...createSession(),
    counter: state.progress.counter,
    recent: state.progress.recent,
    newFlags: state.progress.newFlags,
  };

  dom.next.addEventListener('click', () => nextQuestion());
  document.addEventListener('keydown', handleKeydown);
  nextQuestion();
}

start();
