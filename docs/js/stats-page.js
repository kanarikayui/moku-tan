// 統計画面の DOM 制御。集計そのものは stats.js に置く。

import { loadEntries } from './data.js';
import { summarize, dailySeries } from './stats.js';
import { loadSettings, loadProgress, loadStats } from './storage.js';
import {
  applyStoredTheme,
  formatPercent,
  markCurrentNav,
  recentDateKeys,
  showNotice,
} from './ui.js';

const DIRECTION_LABEL = { en2ja: '英語 → 日本語', ja2en: '日本語 → 英語' };
const TYPE_LABEL = { word: '単語', phrase: '熟語' };
const DAILY_DAYS = 30;

function clearChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function appendSummaryItem(list, term, value) {
  const item = document.createElement('li');
  const wrapper = document.createElement('dl');
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value;
  wrapper.append(dt, dd);
  item.append(wrapper);
  list.append(item);
}

/** 見出し行とデータ行から表を組み立てる。値はすべて textContent で入れる。 */
function renderTable(table, headers, rows, emptyMessage = '記録がありません') {
  clearChildren(table);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach((header, index) => {
    const th = document.createElement('th');
    th.textContent = header;
    if (index > 0) th.className = 'num';
    headRow.append(th);
  });
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = headers.length;
    td.textContent = emptyMessage;
    tr.append(td);
    tbody.append(tr);
  }
  for (const row of rows) {
    const tr = document.createElement('tr');
    row.forEach((cell, index) => {
      const td = document.createElement('td');
      td.textContent = cell;
      if (index > 0) td.className = 'num';
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(tbody);
}

function renderDailyChart(stats) {
  const dateKeys = recentDateKeys(DAILY_DAYS);
  const series = dailySeries(stats, dateKeys);
  const max = Math.max(...series.map((day) => day.asked), 1);
  const chart = document.getElementById('daily-chart');
  clearChildren(chart);

  for (const day of series) {
    const item = document.createElement('li');
    const bar = document.createElement('span');
    bar.className = day.asked > 0 ? 'daily-bar' : 'daily-bar is-empty';
    bar.style.height = day.asked > 0 ? `${(day.asked / max) * 100}%` : '3px';
    bar.title =
      `${day.dateKey} 出題 ${day.asked} / スキップ ${day.skipped} / 正答率 ${formatPercent(day.accuracy)}`;
    item.append(bar);
    chart.append(item);
  }

  document.getElementById('daily-from').textContent = dateKeys[0];
  document.getElementById('daily-to').textContent = dateKeys[dateKeys.length - 1];
  const totalAsked = series.reduce((sum, day) => sum + day.asked, 0);
  const totalCorrect = series.reduce((sum, day) => sum + day.correct, 0);
  document.getElementById('daily-note').textContent =
    totalAsked === 0
      ? 'この 30 日間の記録はまだありません。'
      : `30 日間で ${totalAsked} 問・正答率 ${formatPercent(totalCorrect / totalAsked)}（棒の高さは出題数、最大 ${max} 問）`;
}

async function start() {
  markCurrentNav();

  const settings = loadSettings();
  const progress = loadProgress();
  const stats = loadStats();
  applyStoredTheme(settings.value);

  const notice = document.getElementById('notice');
  if (settings.recovered || progress.recovered || stats.recovered) {
    showNotice(notice, '保存データを読み込めなかったため初期化しました。');
  }

  let entries = [];
  try {
    ({ entries } = await loadEntries());
  } catch (error) {
    console.error(error);
    showNotice(notice, '語彙データを読み込めませんでした。HTTP サーバー経由で開いているか確認してください。');
  }

  const summary = summarize(stats.value, progress.value.entries, entries);

  const summaryList = document.getElementById('summary');
  clearChildren(summaryList);
  appendSummaryItem(summaryList, '総出題数', String(summary.asked));
  appendSummaryItem(summaryList, '総正解数', String(summary.correct));
  appendSummaryItem(summaryList, 'スキップ数', String(summary.skipped));
  appendSummaryItem(summaryList, '通算正答率', formatPercent(summary.accuracy));
  appendSummaryItem(summaryList, '最大連続正解', String(summary.maxStreak));
  appendSummaryItem(summaryList, '学習日数', String(summary.studyDays));

  renderTable(
    document.getElementById('by-direction'),
    ['出題方向', '出題', '正解', 'スキップ', '正答率'],
    summary.byDirection.map((row) => [
      DIRECTION_LABEL[row.direction],
      String(row.asked),
      String(row.correct),
      String(row.skipped ?? 0),
      formatPercent(row.accuracy),
    ]),
  );

  renderDailyChart(stats.value);

  renderTable(
    document.getElementById('by-level'),
    ['難易度', '出題', '正解', '正答率'],
    summary.byLevel.map((row) => [
      `level ${row.key}`,
      String(row.asked),
      String(row.correct),
      formatPercent(row.accuracy),
    ]),
  );

  renderTable(
    document.getElementById('by-type'),
    ['種別', '出題', '正解', '正答率'],
    summary.byType.map((row) => [
      TYPE_LABEL[row.key] ?? row.key,
      String(row.asked),
      String(row.correct),
      formatPercent(row.accuracy),
    ]),
  );

  renderTable(
    document.getElementById('by-tag'),
    ['タグ', '出題', '正解', '正答率'],
    summary.byTag.map((row) => [
      row.key,
      String(row.asked),
      String(row.correct),
      formatPercent(row.accuracy),
    ]),
  );

  renderTable(
    document.getElementById('weak'),
    ['語', '意味', '出題', 'スキップ', '正答率'],
    summary.weak.map((row) => [
      row.entry.en,
      row.entry.ja[0],
      String(row.seen),
      String(row.skipped ?? 0),
      formatPercent(row.accuracy),
    ]),
    '出題 3 回以上の語がまだありません',
  );

  const { seen, total, ratio } = summary.coverage;
  document.getElementById('coverage').textContent =
    total === 0
      ? '語彙データを読み込めていません。'
      : `${total} 件中 ${seen} 件を出題済み（${formatPercent(ratio)}）`;
}

start();
