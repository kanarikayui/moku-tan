// 各画面で共有する小さな UI ヘルパー。

/** テーマを <html data-theme> に反映する。'auto' のときは属性を外して OS 設定に従う。 */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }
}

/** 保存済みのテーマを、設定を読み込む前に反映する（画面のちらつきを減らす）。 */
export function applyStoredTheme(settings) {
  applyTheme(settings.theme);
}

/** 正答率の表示。出題数 0 のときは「—」。 */
export function formatPercent(ratio) {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

/** ローカル時刻での YYYY-MM-DD。 */
export function toDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 今日から遡って days 日分の日付キーを、古い順に返す。 */
export function recentDateKeys(days, today = new Date()) {
  const keys = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    keys.push(toDateKey(date));
  }
  return keys;
}

/** 画面上部の通知欄にメッセージを出す。 */
export function showNotice(element, message) {
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
}

/** 現在のページに対応するナビゲーションリンクへ印を付ける。 */
export function markCurrentNav() {
  const current = location.pathname.split('/').pop() || 'index.html';
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.getAttribute('href') === `./${current}`) {
      link.setAttribute('aria-current', 'page');
    }
  }
}
