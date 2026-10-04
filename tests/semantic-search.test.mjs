import assert from 'node:assert/strict';
import test from 'node:test';
import { cosineSimilarity, selectSemanticMatches, semanticProductText } from '../src/app/core/semantic-search.ts';

test('E5 用に商品文へ passage 接頭辞を付ける', () => {
  assert.equal(semanticProductText({ barcode: '1', name: 'ワイドハイター', brand: '花王' }), 'passage: ワイドハイター ブランド: 花王');
});

test('コサイン類似度はゼロベクトルや次元不一致も安全に扱う', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
  assert.equal(cosineSimilarity([1], [1, 0]), 0);
});

test('関連度が高い商品だけを上位から返す', () => {
  assert.deepEqual(selectSemanticMatches([
    { barcode: 'a', score: 0.87 }, { barcode: 'b', score: 0.84 },
    { barcode: 'c', score: 0.81 }, { barcode: 'd', score: 0.3 },
  ]), ['a', 'b']);
  assert.deepEqual(selectSemanticMatches([{ barcode: 'a', score: 0.79 }]), []);
});
