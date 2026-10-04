/// <reference lib="webworker" />

import { cosineSimilarity, selectSemanticMatches, semanticProductText, type SemanticProduct } from './semantic-search';

type SearchRequest = { requestId: number; query: string; products: SemanticProduct[] };
type Extractor = Awaited<ReturnType<typeof loadExtractor>>;

let extractorPromise: Promise<Extractor> | undefined;
const productVectors = new Map<string, number[]>();
let latestRequestId = 0;

async function loadExtractor() {
  const { pipeline } = await import('@huggingface/transformers');
  return pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    device: 'wasm',
    dtype: 'q8',
    revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  });
}

function getExtractor(): Promise<Extractor> {
  extractorPromise ??= loadExtractor().catch((error: unknown) => {
    extractorPromise = undefined;
    throw error;
  });
  return extractorPromise;
}

async function embed(extractor: Extractor, text: string): Promise<number[]> {
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function search({ requestId, query, products }: SearchRequest): Promise<void> {
  try {
    const extractor = await getExtractor();
    if (requestId !== latestRequestId) return;
    const queryVector = await embed(extractor, `query: ${query}`);
    const scores = [];
    for (const product of products) {
      if (requestId !== latestRequestId) return;
      const productText = semanticProductText(product);
      let vector = productVectors.get(productText);
      if (!vector) {
        vector = await embed(extractor, productText);
        productVectors.set(productText, vector);
      }
      scores.push({ barcode: product.barcode, score: cosineSimilarity(queryVector, vector) });
    }
    if (requestId === latestRequestId) {
      postMessage({ type: 'result', requestId, barcodes: selectSemanticMatches(scores) });
    }
  } catch (error) {
    if (requestId !== latestRequestId) return;
    console.error('Semantic inventory search failed:', error);
    postMessage({ type: 'error', requestId });
  }
}

addEventListener('message', (event: MessageEvent<SearchRequest>) => {
  latestRequestId = event.data.requestId;
  void search(event.data);
});
