// 出題画面の DOM 制御。
// ロジックは quiz.js / scheduler.js に置き、ここは状態の受け渡しと描画に徹する。

import { schedulerConfig, CHOICE_COUNT } from './config.js';
import { loadEntries, filterEntries } from './data.js';
import { buildQuestion, resolveDirection } from './quiz.js';
import {
  createSession,
  getState,
  selectNext,
  advanceSession,
  applyAnswer,
} from './scheduler.js';
import { recordAnswer } from './stats.js';
import { loadSettings, loadProgress, saveProgress, loadStats, saveStats } from './storage.js';
import { applyStoredTheme, formatPercent, markCurrentNav, showNotice, toDateKey } from './ui.js';

const DIRECTION_LABEL = {
  en2ja: '英語 → 日本語',
  ja2en: '日本語 → 英語',
};

/** 誤答が揃わないエントリを引いたときの、1 問あたりの再抽選上限。 */
const RESELECT_LIMIT = 12;

const dom = {
  notice: document.getElementById('notice'),
  sessionAsked: document.getElementById('session-asked'),
  sessionCorrect: document.getElementById('session-correct'),
  sessionAccuracy: document.getElementById('session-accuracy'),
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
  sessionCount: { asked: 0, correct: 0 },
};

function renderSessionBar() {
  const { asked, correct } = state.sessionCount;
  dom.sessionAsked.textContent = String(asked);
  dom.sessionCorrect.textContent = String(correct);
  dom.sessionAccuracy.textContent = formatPercent(asked ? correct / asked : null);
}

function clearChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function renderFeedback(isCorrect) {
  const { entry } = state.question;
  clearChildren(dom.feedback);

  const verdict = document.createElement('p');
  verdict.className = `verdict ${isCorrect ? 'is-correct' : 'is-wrong'}`;
  verdict.textContent = isCorrect ? '○ 正解' : '× 不正解';
  dom.feedback.append(verdict);

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
    button.addEventListener('click', () => answer(index));
    item.append(button);
    dom.choices.append(item);
  });

  clearChildren(dom.feedback);
  dom.next.hidden = true;
  state.answered = false;
}

/** 回答後に選択肢へ正誤の印を付け、押せないようにする。 */
function markChoices(selectedIndex) {
  const buttons = dom.choices.querySelectorAll('.choice');
  buttons.forEach((button, index) => {
    button.disabled = true;
    const choice = state.question.choices[index];
    if (choice.correct) button.classList.add('is-correct');
    if (index === selectedIndex && !choice.correct) button.classList.add('is-wrong');
  });
}

function answer(selectedIndex) {
  if (state.answered || !state.question) return;
  state.answered = true;

  const isCorrect = state.question.choices[selectedIndex].correct;
  const entry = state.question.entry;
  const timestamp = new Date().toISOString();

  const previous = getState(state.progress.entries, entry.id);
  state.progress.entries[entry.id] = applyAnswer(
    previous,
    isCorrect,
    state.session.counter,
    state.config,
    timestamp,
  );
  state.progress.counter = state.session.counter;
  saveProgress(state.progress);

  state.stats = recordAnswer(state.stats, {
    direction: state.question.direction,
    isCorrect,
    dateKey: toDateKey(),
  });
  saveStats(state.stats);

  state.sessionCount.asked += 1;
  if (isCorrect) state.sessionCount.correct += 1;

  markChoices(selectedIndex);
  renderFeedback(isCorrect);
  renderSessionBar();
  dom.next.hidden = false;
  dom.next.focus();
}

/**
 * 次の 1 問を用意する。
 * 誤答が 3 件揃わないエントリは捨てて引き直し、ID を console.warn に出す。
 */
function nextQuestion() {
  const skipped = new Set();
  for (let attempt = 0; attempt < RESELECT_LIMIT; attempt += 1) {
    const pool = state.pool.filter((entry) => !skipped.has(entry.id));
    const entry = selectNext(pool, state.progress.entries, state.session, state.config);
    if (!entry) break;

    const direction = resolveDirection(state.settings.direction);
    const question = buildQuestion(entry, state.pool, direction);
    if (!question) {
      console.warn(`誤答候補が不足したため出題を見送りました: ${entry.id} (${entry.en})`);
      skipped.add(entry.id);
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

  if (!state.answered && /^[1-4]$/.test(event.key)) {
    const index = Number(event.key) - 1;
    if (index < (state.question?.choices.length ?? 0)) {
      event.preventDefault();
      answer(index);
    }
    return;
  }
  if (state.answered && (event.key === 'Enter' || event.key === ' ')) {
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
  state.session = { ...createSession(), counter: state.progress.counter };

  renderSessionBar();
  dom.next.addEventListener('click', () => nextQuestion());
  document.addEventListener('keydown', handleKeydown);
  nextQuestion();
}

start();
