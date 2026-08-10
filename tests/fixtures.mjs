// テスト用の最小データと、決定的な乱数生成器。

/** 線形合同法。シードを固定すれば毎回同じ列を返す。 */
export function seededRandom(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function entry(id, overrides = {}) {
  return {
    id,
    type: 'word',
    en: id,
    ja: [id],
    pos: 'verb',
    level: 1,
    tags: [],
    root: id,
    senses: [`${id}-sense`],
    example: { en: `${id} example`, ja: `${id} の例文` },
    ...overrides,
  };
}

/**
 * 誤答除外条件をひととおり踏む小さなプール。
 *  a1        : 正解に使う基準エントリ
 *  syn       : a1 と senses を共有する同義語
 *  derived   : a1 と root を共有する派生語
 *  jaPrefix  : a1 の訳語と前方一致する訳語を持つ
 *  excluded  : a1 の exclude に入っている
 *  sameEn    : a1 と綴りが同じ（大小文字違い）
 *  ok1..ok4  : どの条件にも触れない正常な誤答候補
 */
export function buildPool() {
  const a1 = entry('a1', {
    en: 'allocate',
    ja: ['割り当てる'],
    root: 'alloc',
    senses: ['assign-distribute'],
    exclude: ['excluded'],
  });

  return [
    a1,
    entry('syn', { en: 'assign', ja: ['配分する'], root: 'assign', senses: ['assign-distribute'] }),
    entry('derived', {
      en: 'allocation',
      ja: ['配置'],
      pos: 'noun',
      root: 'alloc',
      senses: ['allocation-sense'],
    }),
    entry('jaPrefix', {
      en: 'apportion',
      ja: ['割り当てる作業'],
      root: 'apportion',
      senses: ['apportion-sense'],
    }),
    entry('excluded', { en: 'distribute', ja: ['分配する'], root: 'distrib', senses: ['dist-sense'] }),
    entry('sameEn', { en: 'Allocate', ja: ['取り置く'], root: 'reserve', senses: ['reserve-sense'] }),
    entry('ok1', { en: 'postpone', ja: ['延期する'], root: 'postpon', senses: ['postpone-delay'] }),
    entry('ok2', { en: 'confirm', ja: ['確認する'], root: 'confirm', senses: ['confirm-verify'] }),
    entry('ok3', { en: 'recruit', ja: ['採用する'], root: 'recruit', senses: ['recruit-hire'] }),
    entry('ok4', { en: 'renovate', ja: ['改装する'], root: 'renovat', senses: ['renovate-remodel'] }),
  ];
}

/** 任意の件数の正常なエントリを作る（スケジューラのテスト用）。 */
export function buildPlainPool(count) {
  return Array.from({ length: count }, (_, index) => {
    const id = `e${String(index).padStart(3, '0')}`;
    return entry(id, { senses: [`${id}-sense`], root: id });
  });
}

export { entry };
