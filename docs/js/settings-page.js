// 設定画面の DOM 制御。

import { LEVELS, TYPES, collectSettingErrors, DEFAULT_SETTINGS } from './config.js';
import {
  loadSettings,
  saveSettings,
  resetStats,
  resetProgress,
  resetAll,
} from './storage.js';
import { applyTheme, markCurrentNav, showNotice } from './ui.js';

const TYPE_LABEL = { word: '単語', phrase: '熟語' };
const LEVEL_HINT = {
  1: '〜470',
  2: '〜600',
  3: '〜730',
  4: '〜860',
  5: '900〜',
};

const dom = {
  form: document.getElementById('settings-form'),
  errors: document.getElementById('errors'),
  notice: document.getElementById('notice'),
  direction: document.getElementById('direction'),
  intervalWrong: document.getElementById('interval-wrong'),
  intervalCorrect: document.getElementById('interval-correct'),
  levels: document.getElementById('levels'),
  types: document.getElementById('types'),
  theme: document.getElementById('theme'),
};

function clearChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

/** チェックボックス群を組み立てる。 */
function renderCheckboxes(container, name, values, labelOf, checkedValues) {
  clearChildren(container);
  for (const value of values) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = name;
    input.value = String(value);
    input.checked = checkedValues.includes(value);
    const text = document.createElement('span');
    text.textContent = labelOf(value);
    label.append(input, text);
    container.append(label);
  }
}

function fillForm(settings) {
  dom.direction.value = settings.direction;
  dom.intervalWrong.value = String(settings.intervalWrong);
  dom.intervalCorrect.value = String(settings.intervalCorrect);
  dom.theme.value = settings.theme;
  renderCheckboxes(
    dom.levels,
    'levels',
    LEVELS,
    (level) => `level ${level}（${LEVEL_HINT[level]}）`,
    settings.levels,
  );
  renderCheckboxes(dom.types, 'types', TYPES, (type) => TYPE_LABEL[type], settings.types);
}

function readForm() {
  const checked = (name) =>
    [...dom.form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);

  return {
    ...DEFAULT_SETTINGS,
    direction: dom.direction.value,
    intervalWrong: Number.parseInt(dom.intervalWrong.value, 10),
    intervalCorrect: Number.parseInt(dom.intervalCorrect.value, 10),
    levels: checked('levels').map(Number),
    types: checked('types'),
    theme: dom.theme.value,
  };
}

function renderErrors(errors) {
  clearChildren(dom.errors);
  for (const message of errors) {
    const item = document.createElement('li');
    item.textContent = message;
    dom.errors.append(item);
  }
}

function handleSubmit(event) {
  event.preventDefault();
  const settings = readForm();
  const errors = collectSettingErrors(settings);
  renderErrors(errors);

  if (errors.length > 0) {
    dom.notice.hidden = true;
    return;
  }

  saveSettings(settings);
  applyTheme(settings.theme);
  showNotice(dom.notice, '設定を保存しました。');
}

/** 確認ダイアログを挟んで初期化を実行する。 */
function confirmAndRun(message, action, doneMessage) {
  if (!globalThis.confirm(message)) return;
  action();
  showNotice(dom.notice, doneMessage);
}

function start() {
  markCurrentNav();

  const { value: settings, recovered } = loadSettings();
  applyTheme(settings.theme);
  fillForm(settings);

  if (recovered) {
    showNotice(dom.notice, '保存データを読み込めなかったため初期化しました。');
  }

  dom.form.addEventListener('submit', handleSubmit);

  document.getElementById('reset-stats').addEventListener('click', () => {
    confirmAndRun(
      '統計のみを初期化します。出題間隔（学習進捗）は残ります。よろしいですか？',
      resetStats,
      '統計を初期化しました。',
    );
  });

  document.getElementById('reset-progress').addEventListener('click', () => {
    confirmAndRun(
      '学習進捗と統計を初期化します。設定は残ります。よろしいですか？',
      resetProgress,
      '学習進捗と統計を初期化しました。',
    );
  });

  document.getElementById('reset-all').addEventListener('click', () => {
    confirmAndRun(
      'このアプリの保存データをすべて削除します。よろしいですか？',
      () => {
        resetAll();
        fillForm({ ...DEFAULT_SETTINGS });
        applyTheme(DEFAULT_SETTINGS.theme);
      },
      'すべての保存データを初期化しました。',
    );
  });
}

start();
