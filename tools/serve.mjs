#!/usr/bin/env node
// ローカル確認用の静的サーバー。docs/ を配信する。
//
//   node tools/serve.mjs [ポート番号]
//
// python3 -m http.server は Cache-Control を返さないため、ブラウザが
// main.js や style.css を再検証せずに使い回してしまう。古い JS のまま
// 新しいデータを読むと「意味は出るのに発音記号と由来だけ出ない」のような、
// 原因の分かりにくい食い違いが起きる。ここでは no-store を必ず付けて、
// 変更が常にそのまま画面へ出るようにする。

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
const port = Number(process.argv[2] ?? 8000);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

/**
 * URL を docs/ 配下の実ファイルへ解決する。
 * docs/ の外へ出る経路は解決しない（.. を含む URL への保険）。
 */
function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function send(response, status, body, contentType) {
  response.writeHead(status, {
    'Content-Type': contentType,
    // 開発中は常に最新を読ませる。キャッシュ由来の食い違いを持ち込まない
    'Cache-Control': 'no-store, must-revalidate',
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const target = resolvePath(request.url ?? '/');
  if (!target) {
    send(response, 403, '403 Forbidden', 'text/plain; charset=utf-8');
    return;
  }

  try {
    const info = await stat(target);
    const file = info.isDirectory() ? path.join(target, 'index.html') : target;
    const body = await readFile(file);
    const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream';
    send(response, 200, body, type);
  } catch {
    send(response, 404, '404 Not Found', 'text/plain; charset=utf-8');
  }
});

server.listen(port, () => {
  console.log(`docs/ を配信しています → http://localhost:${port}/`);
  console.log('キャッシュは無効（Cache-Control: no-store）。Ctrl+C で終了します。');
});
