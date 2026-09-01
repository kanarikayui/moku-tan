import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, collectSettingErrors } from '../docs/js/config.js';

test('既定の設定は検証を通る', () => {
  assert.deepEqual(collectSettingErrors(DEFAULT_SETTINGS), []);
});

test('正解時の説明表示は既定で off', () => {
  assert.equal(DEFAULT_SETTINGS.reviewOnCorrect, false);
});

test('正解時の説明表示は on にしても検証を通る', () => {
  assert.deepEqual(collectSettingErrors({ ...DEFAULT_SETTINGS, reviewOnCorrect: true }), []);
});

test('正解時の説明表示が真偽値でなければ保存させない', () => {
  const errors = collectSettingErrors({ ...DEFAULT_SETTINGS, reviewOnCorrect: 'true' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /正解時の表示設定/);
});
