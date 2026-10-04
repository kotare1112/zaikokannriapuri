export type SemanticProduct = { barcode: string; name: string; brand: string };
export type ScoredProduct = { barcode: string; score: number };

export function semanticProductText(product: SemanticProduct): string {
  return `passage: ${product.name}${product.brand ? ` ブランド: ${product.brand}` : ''}`;
}

export function cosineSimilarity(first: readonly number[], second: readonly number[]): number {
  if (first.length !== second.length || !first.length) return 0;
  let dot = 0;
  let firstLength = 0;
  let secondLength = 0;
  for (let index = 0; index < first.length; index += 1) {
    dot += first[index] * second[index];
    firstLength += first[index] ** 2;
    secondLength += second[index] ** 2;
  }
  return firstLength && secondLength ? dot / Math.sqrt(firstLength * secondLength) : 0;
}

export function selectSemanticMatches(scored: readonly ScoredProduct[], limit = 8): string[] {
  const ranked = scored.filter((item) => Number.isFinite(item.score))
    .sort((first, second) => second.score - first.score);
  const best = ranked[0]?.score ?? 0;
  if (best < 0.80) return [];
  return ranked.filter((item) => item.score >= 0.80 && item.score >= best - 0.045)
    .slice(0, limit).map((item) => item.barcode);
}
