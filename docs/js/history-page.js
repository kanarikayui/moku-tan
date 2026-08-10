// 履歴画面の DOM 制御。抽出は stats.js の recentEntries に任せる。

import { HISTORY_LIMIT, RESULT } from './config.js';
import { loadEntries } from './data.js';
import { recentEntries } from './stats.js';
import { loadSettings, loadProgress } from './storage.js';
import { applyStoredTheme, formatPercent, markCurrentNav, showNotice } from './ui.js';

const RESULT_BADGE = {
  [RESULT.CORRECT]: { className: 'is-correct', label: '○ 正解' },
  [RESULT.WRONG]: { className: 'is-wrong', label: '× 不正解' },
  [RESULT.SKIPPED]: { className: 'is-skipped', label: '－ スキップ' },
};

const POS_LABEL = {
  noun: '名詞',
  verb: '動詞',
  adj: '形容詞',
  adv: '副詞',
  prep: '前置詞',
  phrase: '熟語',
};

const FILTER_LABEL = { all: '', wrong: '不正解だった', skipped: 'スキップした' };

const dom = {
  notice: document.getElementById('notice'),
  count: document.getElementById('history-count'),
  list: document.getElementById('history'),
  filters: [...document.querySelectorAll('.filter')],
};

const state = { progress: {}, entries: [], filter: 'all' };

function clearChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function appendLine(parent, className, text, lang) {
  const line = document.createElement('p');
  line.className = className;
  line.textContent = text;
  if (lang) line.lang = lang;
  parent.append(line);
  return line;
}

/** 1 語分のカード。語・訳・例文と、直前の結果や成績を出す。 */
function buildCard(row) {
  const { entry } = row;
  const item = document.createElement('li');
  item.className = 'history-item';

  const head = document.createElement('div');
  head.className = 'history-head';

  const word = document.createElement('span');
  word.className = 'history-word';
  word.textContent = entry.en;
  word.lang = 'en';
  head.append(word);

  if (row.lastResult && RESULT_BADGE[row.lastResult]) {
    const badge = document.createElement('span');
    badge.className = `history-badge ${RESULT_BADGE[row.lastResult].className}`;
    badge.textContent = RESULT_BADGE[row.lastResult].label;
    head.append(badge);
  }
  item.append(head);

  const meta = document.createElement('p');
  meta.className = 'history-meta';
  meta.textContent = [
    POS_LABEL[entry.pos] ?? entry.pos,
    `level ${entry.level}`,
    `出題 ${row.seen} 回`,
    `正答率 ${formatPercent(row.accuracy)}`,
    row.skipped > 0 ? `スキップ ${row.skipped} 回` : null,
  ]
    .filter(Boolean)
    .join(' / ');
  item.append(meta);

  appendLine(item, 'history-meaning', entry.ja.join('、'), 'ja');

  if (entry.example) {
    appendLine(item, 'history-example-en', entry.example.en, 'en');
    appendLine(item, 'history-example-ja', entry.example.ja, 'ja');
  }

  return item;
}

function render() {
  const result = state.filter === 'all' ? null : state.filter;
  const rows = recentEntries(state.progress, state.entries, { limit: HISTORY_LIMIT, result });

  clearChildren(dom.list);
  for (const row of rows) dom.list.append(buildCard(row));

  const label = FILTER_LABEL[state.filter];
  if (rows.length === 0) {
    dom.count.textContent = label
      ? `${label}語はまだありません。`
      : 'まだ出題した語がありません。出題画面から始めてください。';
    return;
  }
  dom.count.textContent = label
    ? `${label}語を新しい順に ${rows.length} 件`
    : `直近に出題した語を新しい順に ${rows.length} 件（最大 ${HISTORY_LIMIT} 件）`;
}

function selectFilter(filter) {
  state.filter = filter;
  for (const button of dom.filters) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  }
  render();
}

async function start() {
  markCurrentNav();

  const settings = loadSettings();
  const progress = loadProgress();
  applyStoredTheme(settings.value);
  state.progress = progress.value.entries;

  if (settings.recovered || progress.recovered) {
    showNotice(dom.notice, '保存データを読み込めなかったため初期化しました。');
  }

  for (const button of dom.filters) {
    button.addEventListener('click', () => selectFilter(button.dataset.filter));
  }

  try {
    ({ entries: state.entries } = await loadEntries());
  } catch (error) {
    console.error(error);
    showNotice(dom.notice, '語彙データを読み込めませんでした。HTTP サーバー経由で開いているか確認してください。');
  }

  render();
}

start();
