import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePriceCheck, type ProductSnapshot } from './price-checker.js';

const product: ProductSnapshot = {
  id: '00000000-0000-0000-0000-000000000000',
  user_id: 'user-1',
  source_url: 'https://loja.com/produto',
  name: 'Produto X',
  currency: 'BRL',
  current_price: 100,
  scrape_failures: 0,
};

test('preço igual: não grava histórico', () => {
  assert.deepEqual(decidePriceCheck(100, product), { action: 'unchanged' });
});

test('queda: grava histórico e notifica', () => {
  assert.deepEqual(decidePriceCheck(89.9, product), { action: 'record-drop', newPrice: 89.9 });
});

test('alta: grava histórico mas sem push', () => {
  assert.deepEqual(decidePriceCheck(120, product), { action: 'record-rise', newPrice: 120 });
});

test('falhas de scraping: unavailable só na 5ª falha consecutiva', () => {
  for (let failures = 0; failures < 4; failures++) {
    assert.deepEqual(
      decidePriceCheck(null, { ...product, scrape_failures: failures }),
      { action: 'scrape-failed', unavailable: false },
      `com ${failures} falhas anteriores não deveria marcar unavailable`,
    );
  }
  assert.deepEqual(
    decidePriceCheck(null, { ...product, scrape_failures: 4 }),
    { action: 'scrape-failed', unavailable: true },
  );
  assert.deepEqual(
    decidePriceCheck(null, { ...product, scrape_failures: 10 }),
    { action: 'scrape-failed', unavailable: true },
  );
});
