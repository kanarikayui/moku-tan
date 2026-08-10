import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDistractorCandidates,
  pickDistractors,
  buildQuestion,
  isAmbiguousPair,
  jaCollides,
  normalizeJa,
  shuffle,
} from '../docs/js/quiz.js';
import { buildPool, seededRandom, entry } from './fixtures.mjs';

const pool = buildPool();
const answer = pool.find((item) => item.id === 'a1');
const byId = (id) => pool.find((item) => item.id === id);

test('同義語（senses 共有）は誤答候補に入らない', () => {
  assert.equal(isAmbiguousPair(answer, byId('syn'), 'en2ja'), true);
});

test('派生語（root 共有）は誤答候補に入らない', () => {
  assert.equal(isAmbiguousPair(answer, byId('derived'), 'en2ja'), true);
});

test('訳語が前方一致する語は誤答候補に入らない', () => {
  assert.equal(isAmbiguousPair(answer, byId('jaPrefix'), 'en2ja'), true);
});

test('exclude に指定した語は誤答候補に入らない', () => {
  assert.equal(isAmbiguousPair(answer, byId('excluded'), 'en2ja'), true);
});

test('exclude は逆方向にも効く', () => {
  const a = entry('x', { exclude: [] });
  const b = entry('y', { exclude: ['x'] });
  assert.equal(isAmbiguousPair(a, b, 'en2ja'), true);
});

test('ja2en では綴りが同じ語を誤答にしない', () => {
  assert.equal(isAmbiguousPair(answer, byId('sameEn'), 'ja2en'), true);
  assert.equal(isAmbiguousPair(answer, byId('sameEn'), 'en2ja'), false);
});

test('正常な候補だけが残る', () => {
  const candidates = collectDistractorCandidates(answer, pool, 'ja2en');
  assert.deepEqual(
    candidates.map((item) => item.id).sort(),
    ['ok1', 'ok2', 'ok3', 'ok4'],
  );
});

test('候補が足りないときは除外条件を緩めず null を返す', () => {
  const narrow = [answer, byId('syn'), byId('derived'), byId('ok1'), byId('ok2')];
  const candidates = collectDistractorCandidates(answer, narrow, 'en2ja');
  assert.equal(candidates.length, 2);
  assert.equal(pickDistractors(answer, narrow, 'en2ja', seededRandom(1)), null);
});

test('誤答は 3 件で、正解自身は含まない', () => {
  const distractors = pickDistractors(answer, pool, 'en2ja', seededRandom(7));
  assert.equal(distractors.length, 3);
  assert.ok(!distractors.some((item) => item.id === answer.id));
});

test('誤答は品詞の一致を優先する', () => {
  const target = entry('t', { pos: 'noun', root: 't', senses: ['t-sense'], ja: ['名詞語'] });
  const nouns = ['n1', 'n2', 'n3'].map((id) =>
    entry(id, { pos: 'noun', root: id, senses: [`${id}-sense`], ja: [`名詞${id}`] }),
  );
  const verbs = ['v1', 'v2', 'v3'].map((id) =>
    entry(id, { pos: 'verb', root: id, senses: [`${id}-sense`], ja: [`動詞${id}`] }),
  );
  const distractors = pickDistractors(target, [target, ...verbs, ...nouns], 'en2ja', seededRandom(3));
  assert.deepEqual(
    distractors.map((item) => item.id).sort(),
    ['n1', 'n2', 'n3'],
  );
});

test('選択肢は 4 件で、正解がちょうど 1 件含まれる', () => {
  const question = buildQuestion(answer, pool, 'en2ja', seededRandom(11));
  assert.equal(question.choices.length, 4);
  assert.equal(question.choices.filter((choice) => choice.correct).length, 1);
  assert.equal(question.choices[question.answerIndex].id, answer.id);
});

test('en2ja は英語を提示し、ja2en は日本語を提示する', () => {
  const enToJa = buildQuestion(answer, pool, 'en2ja', seededRandom(5));
  assert.equal(enToJa.prompt, 'allocate');
  const jaToEn = buildQuestion(answer, pool, 'ja2en', seededRandom(5));
  assert.equal(jaToEn.prompt, '割り当てる');
});

test('正解位置が 4 箇所に分散する', () => {
  const counts = [0, 0, 0, 0];
  const rng = seededRandom(2024);
  for (let i = 0; i < 400; i += 1) {
    const question = buildQuestion(answer, pool, 'en2ja', rng);
    counts[question.answerIndex] += 1;
  }
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 400);
  for (const count of counts) {
    assert.ok(count > 60, `位置の偏りが大きすぎます: ${counts.join(', ')}`);
  }
});

test('normalizeJa は括弧書きと記号を落とす', () => {
  assert.equal(normalizeJa('割り当てる（配分）'), '割り当てる');
  assert.equal(normalizeJa(' 交渉する・談判する '), '交渉する談判する');
});

test('jaCollides は後方一致も衝突とみなす', () => {
  assert.equal(jaCollides(['立ち会う'], ['会う']), true);
  assert.equal(jaCollides(['提出する'], ['解決する']), false);
});

test('shuffle は元の配列を変更しない', () => {
  const source = [1, 2, 3, 4, 5];
  const result = shuffle(source, seededRandom(9));
  assert.deepEqual(source, [1, 2, 3, 4, 5]);
  assert.deepEqual([...result].sort(), source);
});
