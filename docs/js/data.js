// 語彙データの読み込みと結合。
// パスはすべて相対。GitHub Pages のサブディレクトリ公開でも壊れないようにする。

const DEFAULT_BASE = './data/';

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url} の読み込みに失敗しました (${response.status})`);
  return response.json();
}

/**
 * meta.json に列挙されたファイルをすべて読み、1 本の配列に結合して返す。
 */
export async function loadEntries(basePath = DEFAULT_BASE) {
  const meta = await fetchJson(`${basePath}meta.json`);
  const files = [...(meta.files?.words ?? []), ...(meta.files?.phrases ?? [])];
  const chunks = await Promise.all(files.map((file) => fetchJson(`${basePath}${file}`)));

  const entries = [];
  const seenIds = new Set();
  for (const chunk of chunks) {
    for (const entry of chunk) {
      if (seenIds.has(entry.id)) continue;
      seenIds.add(entry.id);
      entries.push(entry);
    }
  }
  return { meta, entries };
}

/** 設定の出題範囲（level / type）で絞り込む。 */
export function filterEntries(entries, settings) {
  const levels = new Set(settings.levels);
  const types = new Set(settings.types);
  return entries.filter((entry) => levels.has(entry.level) && types.has(entry.type));
}

/** id 引きの索引。 */
export function indexById(entries) {
  return new Map(entries.map((entry) => [entry.id, entry]));
}
