#!/usr/bin/env node
// 語彙データの検証。違反が 1 件でもあれば非ゼロ終了する。
//
//   node tools/validate-data.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEVELS, TYPES, PARTS_OF_SPEECH, CHOICE_COUNT, DIRECTIONS } from '../docs/js/config.js';
import { collectDistractorCandidates, normalizeJa, normalizeEn } from '../docs/js/quiz.js';

/** 補足文の上限。長いと出題画面で読み切れないので目安として切る。 */
const NOTE_MAX_LENGTH = 120;

/** 任意の補足。書かれている場合だけ origin と同じ体裁を求める。 */
const OPTIONAL_NOTES = ['family', 'contrast', 'trivia'];

/** origin のすぐ下に並ぶため、同じ文を繰り返してはいけない項目。 */
const NO_ORIGIN_OVERLAP = ['contrast', 'trivia'];

/** エラーメッセージで使う、画面上の見出しと同じ呼び名。 */
const NOTE_LABEL = { family: '語族', contrast: '使い分け', trivia: '豆知識' };

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/data');

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(dataDir, relativePath), 'utf8'));
}

/** meta.json に列挙された全ファイルを読み、エントリと出所を返す。 */
export async function loadAllEntries() {
  const meta = await readJson('meta.json');
  const files = [...(meta.files?.words ?? []), ...(meta.files?.phrases ?? [])];
  const entries = [];
  const sources = new Map();
  for (const file of files) {
    const chunk = await readJson(file);
    if (!Array.isArray(chunk)) throw new Error(`${file} は配列ではありません`);
    for (const entry of chunk) {
      entries.push(entry);
      if (!sources.has(entry.id)) sources.set(entry.id, file);
    }
  }
  return { meta, entries, sources };
}

/** 補足文に共通の体裁（長さ・末尾の句点・括弧）を見る。 */
function checkNoteFormat(text, where, errors) {
  if (text.length > NOTE_MAX_LENGTH) {
    errors.push(`${where} が長すぎます (${text.length} 文字)`);
  } else if (/[。]$/.test(text)) {
    errors.push(`${where} の末尾に句点を付けないでください`);
  }
  // 補足は全角括弧で統一する。半角が混じると行内で字面が崩れる
  if (/[()]/.test(text)) {
    errors.push(`${where} に半角括弧が混じっています`);
  }
  const open = (text.match(/（/g) ?? []).length;
  const close = (text.match(/）/g) ?? []).length;
  if (open !== close) {
    errors.push(`${where} の括弧が閉じていません (（${open} 個 / ）${close} 個)`);
  }
}

/**
 * 任意の補足は origin のすぐ下に並ぶ。
 * 同じ文を繰り返すと画面で二度読ませることになるので、重なりを弾く。
 */
function checkOriginOverlap(entry, field, label, where, errors) {
  const split = (text) =>
    new Set(
      text
        .split(/[。．]/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 8),
    );
  const origin = split(entry.origin ?? '');
  for (const clause of split(entry[field])) {
    if (origin.has(clause)) {
      errors.push(`${where}: ${label}の「${clause}」が由来と同じ文です`);
    }
  }
}

/**
 * family は `語（訳）／ 語（訳）` の形で書く。
 * 括弧の中が英字だけだと訳の書き忘れなので、画面に出る前に落とす。
 */
function checkFamilyFormat(text, where, errors) {
  const glosses = [...text.matchAll(/（([^）]*)）/g)].map((match) => match[1]);
  if (glosses.length === 0) {
    errors.push(`${where}: 語族は 語（訳） の形で書いてください`);
    return;
  }
  for (const gloss of glosses) {
    if (!/[^\x00-\x7f]/.test(gloss)) {
      errors.push(`${where}: 語族の「${gloss}」に日本語の訳がありません`);
    }
  }
}

function checkRequiredFields(entry, errors) {
  const where = entry.id ?? '(id なし)';
  if (typeof entry.id !== 'string' || !/^[wp]\d{4}$/.test(entry.id)) {
    errors.push(`${where}: id は w0001 / p0001 の形式にしてください`);
  }
  if (!TYPES.includes(entry.type)) errors.push(`${where}: type が不正です (${entry.type})`);
  if (typeof entry.en !== 'string' || entry.en.trim() === '') {
    errors.push(`${where}: en が空です`);
  }
  if (!Array.isArray(entry.ja) || entry.ja.length === 0 || entry.ja.some((ja) => !ja?.trim())) {
    errors.push(`${where}: ja は 1 つ以上の非空文字列にしてください`);
  }
  if (!PARTS_OF_SPEECH.includes(entry.pos)) errors.push(`${where}: pos が不正です (${entry.pos})`);
  if (!LEVELS.includes(entry.level)) errors.push(`${where}: level が 1〜5 の範囲外です`);
  if (!Array.isArray(entry.senses) || entry.senses.length === 0) {
    errors.push(`${where}: senses は 1 つ以上必要です`);
  } else if (entry.senses.some((sense) => !/^[a-z]+(-[a-z]+)+$/.test(sense))) {
    errors.push(`${where}: senses は英小文字とハイフンで書いてください (${entry.senses.join(', ')})`);
  }
  if (entry.type === 'word' && !entry.root) errors.push(`${where}: 単語には root が必要です`);
  if (!entry.example?.en?.trim() || !entry.example?.ja?.trim()) {
    errors.push(`${where}: example の en / ja が必要です`);
  }
  if (Array.isArray(entry.ja) && entry.ja.some((ja) => /[。]$/.test(ja))) {
    errors.push(`${where}: 訳語の末尾に句点を付けないでください`);
  }
  // ipa と origin は全件そろっている。欠けたまま追加されないよう必須にする
  if (typeof entry.ipa !== 'string' || !/^\/[^/]+\/$/.test(entry.ipa)) {
    errors.push(`${where}: ipa はスラッシュで囲んで必ず入れてください (${entry.ipa})`);
  }
  if (typeof entry.origin !== 'string' || entry.origin.trim() === '') {
    errors.push(`${where}: origin が空です`);
  } else {
    checkNoteFormat(entry.origin, `${where}: origin`, errors);
  }
  // family と contrast は書ける語にだけ入れる。無い語は画面にも出さない
  for (const field of OPTIONAL_NOTES) {
    if (entry[field] === undefined) continue;
    if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
      errors.push(`${where}: ${field} が空です。書けないなら項目ごと省いてください`);
      continue;
    }
    checkNoteFormat(entry[field], `${where}: ${field}`, errors);
    if (field === 'family') checkFamilyFormat(entry[field], where, errors);
    if (NO_ORIGIN_OVERLAP.includes(field)) {
      checkOriginOverlap(entry, field, NOTE_LABEL[field], where, errors);
    }
  }
}

function checkDuplicates(entries, errors) {
  const byId = new Map();
  const byEn = new Map();
  const byPrimaryJa = new Map();

  for (const entry of entries) {
    if (byId.has(entry.id)) errors.push(`${entry.id}: id が重複しています`);
    byId.set(entry.id, entry);

    const en = normalizeEn(entry.en);
    if (byEn.has(en)) errors.push(`${entry.id}: en "${entry.en}" が ${byEn.get(en)} と重複しています`);
    byEn.set(en, entry.id);

    const ja = normalizeJa(entry.ja?.[0] ?? '');
    if (byPrimaryJa.has(ja)) {
      errors.push(
        `${entry.id}: 代表訳 "${entry.ja[0]}" が ${byPrimaryJa.get(ja)} と完全一致しています` +
          '（senses の付け忘れの可能性）',
      );
    }
    byPrimaryJa.set(ja, entry.id);
  }
  return byId;
}

function checkExcludeRefs(entries, byId, errors) {
  for (const entry of entries) {
    for (const id of entry.exclude ?? []) {
      if (!byId.has(id)) errors.push(`${entry.id}: exclude の参照先 ${id} が存在しません`);
      if (id === entry.id) errors.push(`${entry.id}: exclude に自分自身を含めています`);
    }
  }
}

/** 各エントリについて、両方向で誤答候補が 3 件以上あるかを調べる。 */
function checkDistractorAvailability(entries, errors) {
  const needed = CHOICE_COUNT - 1;
  for (const entry of entries) {
    for (const direction of DIRECTIONS) {
      const candidates = collectDistractorCandidates(entry, entries, direction);
      if (candidates.length < needed) {
        errors.push(
          `${entry.id} (${entry.en}): ${direction} の誤答候補が ${candidates.length} 件しかありません` +
            `（${needed} 件必要）`,
        );
      }
    }
  }
}

/** 発音記号と由来の整備状況を数える。欠落自体は checkRequiredFields がエラーにする。 */
function checkEnrichment(entries) {
  const withIpa = entries.filter((entry) => entry.ipa).length;
  const withOrigin = entries.filter((entry) => entry.origin).length;
  const withFamily = entries.filter((entry) => entry.family).length;
  const withContrast = entries.filter((entry) => entry.contrast).length;
  const withTrivia = entries.filter((entry) => entry.trivia).length;
  return { withIpa, withOrigin, withFamily, withContrast, withTrivia, total: entries.length };
}

function checkMetaProgress(meta, entries, warnings) {
  const counts = { words: 0, phrases: 0 };
  for (const entry of entries) {
    if (entry.type === 'word') counts.words += 1;
    if (entry.type === 'phrase') counts.phrases += 1;
  }
  for (const kind of ['words', 'phrases']) {
    const recorded = meta.progress?.[kind]?.current;
    if (recorded !== counts[kind]) {
      warnings.push(
        `meta.json の progress.${kind}.current (${recorded}) が実データ (${counts[kind]}) と一致しません`,
      );
    }
  }
  return counts;
}

async function main() {
  const { meta, entries } = await loadAllEntries();
  const errors = [];
  const warnings = [];

  for (const entry of entries) checkRequiredFields(entry, errors);
  const byId = checkDuplicates(entries, errors);
  checkExcludeRefs(entries, byId, errors);
  if (errors.length === 0) checkDistractorAvailability(entries, errors);
  const counts = checkMetaProgress(meta, entries, warnings);
  const enrichment = checkEnrichment(entries);

  console.log(`収録数: 単語 ${counts.words} 件 / 熟語 ${counts.phrases} 件`);
  console.log(
    `発音記号: ${enrichment.withIpa} / ${enrichment.total} 件　` +
      `由来: ${enrichment.withOrigin} / ${enrichment.total} 件`,
  );
  console.log(
    `語族: ${enrichment.withFamily} 件　使い分け: ${enrichment.withContrast} 件　` +
      `豆知識: ${enrichment.withTrivia} 件（いずれも任意項目）`,
  );
  for (const warning of warnings) console.warn(`警告: ${warning}`);

  if (errors.length > 0) {
    console.error(`\n検証エラー ${errors.length} 件:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('検証エラーはありません。');
}

await main();
