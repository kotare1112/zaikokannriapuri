import type { InventoryItem } from '../models/inventory-item';

type SearchableItem = Pick<InventoryItem, 'name' | 'barcode' | 'brand' | 'storeName'>;

type Genre = {
  label: string;
  aliases: readonly string[];
  products: readonly string[];
  excludes: readonly string[];
  brandProducts?: readonly string[];
  rejects?: readonly string[];
};

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/[\u30a1-\u30f6]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/\s+/gu, '');
}

const rawGenres: readonly Genre[] = [
  {
    label: '麺類',
    aliases: ['麺', '麺類', 'めん', 'めん類', '麺系', 'ヌードル類'],
    products: [
      '麺', 'めん', 'ヌードル', 'パスタ', 'スパゲッティ', 'スパゲティ', 'マカロニ',
      'ラーメン', 'うどん', 'そば', '蕎麦', 'そうめん', '素麺', 'ひやむぎ', '冷麦',
      '春雨', 'はるさめ', 'マロニー', 'ビーフン', '焼きそば', 'ちゃんぽん',
      '冷麺', 'きしめん', 'ほうとう', 'にゅうめん', 'spaghetti', 'pasta',
    ],
    excludes: [
      '麺つゆ', 'めんつゆ', 'そばつゆ', 'うどんつゆ', 'パスタソース',
      'スパゲッティソース', 'ラーメンスープ', '焼きそばソース',
    ],
  },
  {
    label: '飲み物',
    aliases: ['飲み物', '飲物', '飲料', 'ドリンク'],
    products: [
      '飲料', 'ドリンク', 'コーラ', 'サイダー', 'ジュース', 'コーヒー',
      '紅茶', '緑茶', '麦茶', 'ウーロン茶', '烏龍茶', 'ほうじ茶', '牛乳',
      '豆乳', '炭酸水', '天然水', 'ミネラルウォーター', 'スムージー',
    ],
    excludes: ['お茶漬け', '麦茶ポット', '飲料用ボトル'],
  },
  {
    label: 'お菓子',
    aliases: ['お菓子', '菓子', 'おやつ', 'スナック'],
    products: [
      '菓子', 'スナック', 'チョコ', 'クッキー', 'ビスケット', 'ポテトチップス',
      'キャンディ', '飴', 'グミ', 'せんべい', '煎餅', 'キャラメル',
      'ポップコーン', 'プリン', 'ゼリー',
    ],
    excludes: [],
  },
  {
    label: '洗剤・洗浄用品',
    aliases: ['洗剤', 'せんざい', '洗浄剤', '洗浄用品'],
    products: [
      '洗剤', '漂白', '柔軟剤', 'しみ抜き', 'シミ抜き', '洗濯せっけん',
      '食器洗い', '除菌クリーナー', 'ワイドハイター', 'ハイター',
      'オキシクリーン', 'アリエール', 'アタック', 'ナノックス',
      'ボールド', 'エマール', 'ソフラン', 'レノア', 'キュキュット',
      'マジックリン', 'カビキラー', 'ウタマロ', 'ジョイコンパクト',
    ],
    brandProducts: [
      'ワイドハイター', 'ハイター', 'オキシクリーン', 'アリエール',
      'アタック', 'ナノックス', 'ボールド', 'エマール', 'ソフラン',
      'レノア', 'キュキュット', 'マジックリン', 'カビキラー', 'ウタマロ',
    ],
    excludes: [],
    rejects: [
      '洗剤用ボトル', '空ボトル', '詰め替え容器', '洗剤ケース',
      '洗濯ネット', '洗濯ばさみ', '食器用スポンジ',
    ],
  },
];

const genres: readonly Genre[] = rawGenres.map((genre) => ({
  ...genre,
  aliases: genre.aliases.map(normalizeSearchText),
  products: genre.products.map(normalizeSearchText),
  excludes: genre.excludes.map(normalizeSearchText),
  brandProducts: genre.brandProducts?.map(normalizeSearchText),
  rejects: genre.rejects?.map(normalizeSearchText),
}));

function findGenre(query: string): Genre | undefined {
  const normalized = normalizeSearchText(query);
  return genres.find((genre) => genre.aliases.includes(normalized));
}

export function searchGenreLabel(query: string): string | null {
  return findGenre(query)?.label ?? null;
}

export function createInventorySearchMatcher(query: string, reading = ''): (item: SearchableItem) => boolean {
  const genre = findGenre(query);
  if (genre) {
    return (item) => {
      const originalName = normalizeSearchText(item.name);
      if (genre.rejects?.some((term) => originalName.includes(term))) return false;
      const name = genre.excludes.reduce(
        (remaining, term) => remaining.replaceAll(term, ''),
        originalName,
      );
      if (genre.products.some((term) => name.includes(term))) return true;
      const brand = normalizeSearchText(item.brand);
      return !!brand && (genre.brandProducts?.some((term) => brand.includes(term)) ?? false);
    };
  }

  const keywords = [query, reading].map(normalizeSearchText).filter(Boolean);
  if (!keywords.length) return () => true;
  return (item) => {
    const text = normalizeSearchText([item.name, item.barcode, item.brand, item.storeName].join(' '));
    return keywords.some((keyword) => text.includes(keyword));
  };
}
