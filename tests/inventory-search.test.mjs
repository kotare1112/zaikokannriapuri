import assert from 'node:assert/strict';
import test from 'node:test';
import { createInventorySearchMatcher, isSearchGenreExcluded, searchGenreLabel } from '../src/app/core/inventory-search.ts';

const item = (name, barcode = '4901234567890', brand = '') => ({ name, barcode, brand, storeName: '' });

test('麺のジャンル検索で表記の異なる食品を見つけ、関連しない調味料は除く', () => {
  const matches = createInventorySearchMatcher('麺');
  assert.equal(searchGenreLabel('メン類'), '麺類');
  assert.equal(matches(item('スパゲッティ 500g')), true);
  assert.equal(matches(item('マロニー 100g')), true);
  assert.equal(matches(item('ポポロスパ7 1.6mm 500g')), true);
  assert.equal(matches(item('はるさめ')), true);
  assert.equal(matches(item('うどん')), true);
  assert.equal(matches(item('パスタソース')), false);
  assert.equal(matches(item('麺つゆ')), false);
  assert.equal(matches(item('うどん 麺つゆ付き')), true);
  assert.equal(matches(item('コーラ')), false);
  assert.equal(isSearchGenreExcluded('麺', item('パスタソース')), true);
  assert.equal(isSearchGenreExcluded('麺', item('ポポロスパ7')), false);
});

test('他のジャンルも商品名で判定し、ブランド名だけでは誤判定しない', () => {
  assert.equal(createInventorySearchMatcher('飲み物')(item('コーラ 500ml')), true);
  assert.equal(createInventorySearchMatcher('飲料')(item('お茶漬け')), false);
  assert.equal(createInventorySearchMatcher('おやつ')(item('チョコクッキー')), true);
  assert.equal(createInventorySearchMatcher('麺')(item('麦茶', '4901234567890', '麺屋')), false);
});

test('スパゲッティとパスタなど別の呼び方でも同じ種類を検索できる', () => {
  const spaghetti = createInventorySearchMatcher('スパゲッティ');
  assert.equal(searchGenreLabel('スパゲッティ'), 'パスタ類');
  assert.equal(spaghetti(item('パスタ 500g')), true);
  assert.equal(spaghetti(item('ポポロスパ7 1.6mm 500g')), true);
  assert.equal(spaghetti(item('ペンネ 200g')), true);
  assert.equal(spaghetti(item('ラーメン')), false);
  assert.equal(spaghetti(item('パスタソース')), false);
  assert.equal(createInventorySearchMatcher('パスタ')(item('スパゲティ 500g')), true);
  assert.equal(createInventorySearchMatcher('春雨')(item('マロニー 100g')), true);
  assert.equal(createInventorySearchMatcher('炭酸飲料')(item('コーラ 500ml')), true);
  assert.equal(createInventorySearchMatcher('漂白剤')(item('ワイドハイター 500ml')), true);
  assert.equal(isSearchGenreExcluded('スパゲッティ', item('パスタソース')), true);
});

test('洗剤から漂白剤や製品ブランドも見つけ、容器などの雑貨は除く', () => {
  const matches = createInventorySearchMatcher('洗剤');
  assert.equal(searchGenreLabel('センザイ'), '洗剤・洗浄用品');
  assert.equal(matches(item('ワイドハイター EXパワー 500ml')), true);
  assert.equal(matches(item('衣類用酸素系漂白剤')), true);
  assert.equal(matches(item('キュキュット 240ml')), true);
  assert.equal(matches(item('EXパワー 500ml', '4901234567890', 'ワイドハイター')), true);
  assert.equal(matches(item('洗剤用ボトル')), false);
  assert.equal(matches(item('ワイドハイター専用 空ボトル')), false);
  assert.equal(matches(item('コーラ 500ml')), false);
});

test('通常の文字・JAN・漢字の読み検索はこれまでどおり動く', () => {
  assert.equal(createInventorySearchMatcher('マロニー')(item('マロニー')), true);
  assert.equal(createInventorySearchMatcher('490123')(item('コーラ')), true);
  assert.equal(createInventorySearchMatcher('めん', 'めん')(item('素麺')), true);
  assert.equal(createInventorySearchMatcher('乾麺', 'かんめん')(item('かんめん')), true);
  assert.equal(createInventorySearchMatcher('')(item('コーラ')), true);
});
