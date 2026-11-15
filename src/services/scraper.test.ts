import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractProduct, parsePrice } from './scraper.js';

test('parsePrice — formatos brasileiros e americanos', () => {
  assert.equal(parsePrice('R$ 1.234,56'), 1234.56);
  assert.equal(parsePrice('1.234,56'), 1234.56);
  assert.equal(parsePrice('R$ 199,90'), 199.9);
  assert.equal(parsePrice('199,90'), 199.9);
  assert.equal(parsePrice('$1,234.56'), 1234.56);
  assert.equal(parsePrice('1234.56'), 1234.56);
  assert.equal(parsePrice('R$ 10'), 10);
  // milhar sem decimais: 1.234 => 1234 (preços não têm 3 casas decimais)
  assert.equal(parsePrice('1.234'), 1234);
  assert.equal(parsePrice('sem preço'), null);
  assert.equal(parsePrice('R$ 0,00'), null);
});

test('extrai de JSON-LD (Schema.org Product)', () => {
  const html = `
    <html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org",
         "@type":"Product",
         "name":"Fone Bluetooth XYZ",
         "image":["https://loja.com/fone.jpg"],
         "description":"Fone com ANC",
         "offers":{"@type":"Offer","price":"199.90","priceCurrency":"BRL"}}
      </script>
    </head><body>conteúdo irrelevante</body></html>`;
  assert.deepEqual(extractProduct(html), {
    name: 'Fone Bluetooth XYZ',
    price: 199.9,
    currency: 'BRL',
    imageUrl: 'https://loja.com/fone.jpg',
    description: 'Fone com ANC',
  });
});

test('extrai de meta tags (og:price:amount, com itemprop como parte da mesma estratégia)', () => {
  const html = `
    <html><head>
      <meta property="og:title" content="Mouse Gamer Pro - LojaX">
      <meta property="og:image" content="https://loja.com/mouse.jpg">
      <meta property="product:price:amount" content="89,90">
      <meta property="product:price:currency" content="BRL">
    </head><body>x</body></html>`;
  assert.deepEqual(extractProduct(html), {
    name: 'Mouse Gamer Pro - LojaX',
    price: 89.9,
    currency: 'BRL',
    imageUrl: 'https://loja.com/mouse.jpg',
    description: undefined,
  });
});

test('extrai por heurística CSS (data-price / classe .price*) quando não há JSON-LD nem meta', () => {
  const html = `
    <html><head>
      <title>Teclado Mecânico RGB</title>
      <meta property="og:image" content="https://loja.com/teclado.jpg">
    </head><body>
      <div class="old-price">R$ 499,90</div>
      <div data-price="R$ 349,90"></div>
    </body></html>`;
  const result = extractProduct(html);
  assert.equal(result?.price, 349.9);
  assert.equal(result?.currency, 'BRL');
  assert.equal(result?.name, 'Teclado Mecânico RGB');
  // deve preferir o attr data-price sobre o primeiro texto com R$ da página
  assert.notEqual(result?.price, 499.9);
});

test('retorna null quando nenhuma estratégia acha preço', () => {
  const html = `<html><head><title>Página de erro</title></head><body>Produto não encontrado</body></html>`;
  assert.equal(extractProduct(html), null);
});
