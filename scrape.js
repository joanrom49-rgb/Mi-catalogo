
import * as cheerio from 'cheerio';
import fs from 'fs';

const BASE = 'https://www.amoramarket.com.mx/fragancias1/';
const MAX_PAGES = 100;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPagina(p, intentos = 3) {
  for (let i = 0; i < intentos; i++) {
    try {
      // Formato exacto de paginación: /fragancias1/page/2/
      const url = p === 1 ? BASE : `${BASE}page/${p}/`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1'
        }
      });

      if (res.ok) return await res.text();
      // Si la página da 404, significa que llegamos al final del catálogo
      if (res.status === 404) {
        console.log(`Fin del catálogo alcanzado en página ${p}.`);
        return null;
      }
      console.log(`Página ${p}: código HTTP ${res.status}, reintentando...`);
    } catch (e) {
      console.log(`Página ${p}: error de red (${e.message}), reintentando...`);
    }
    await esperar(4000 + i * 3000);
  }
  return null;
}

function extraerDePagina(html) {
  const $ = cheerio.load(html);
  const items = [];

  // Abarca selectores de WooCommerce, temas modernos y Magento
  const selectores = [
    'li.product',
    '.product-small',
    '.product-item',
    'li.item.product',
    '.box-product',
    'article.product'
  ].join(', ');

  $(selectores).each((_, el) => {
    const $el = $(el);

    // Enlaces posibles
    const linkEl = $el.find('a.woocommerce-LoopProduct-link, a.product-item-link, a[href*="/producto/"], a[href*="/fragancia/"], a.product-item-photo').first();
    const nameEl = $el.find('.woocommerce-loop-product__title, .product-item-name, h2, h3, .name, .title').first();
    const imgEl = $el.find('img').first();

    let nombre = (nameEl.text() || linkEl.text() || '').trim();
    if (nombre.endsWith('.')) nombre = nombre.slice(0, -1).trim();

    const url = linkEl.attr('href') || $el.find('a').first().attr('href') || '';

    // Extracción de imagen comprobando todos los atributos comunes de lazy loading
    let img = (
      imgEl.attr('data-lazy-src') ||
      imgEl.attr('data-src') ||
      imgEl.attr('data-original') ||
      imgEl.attr('src') ||
      ''
    ).trim();

    if ((!img || img.startsWith('data:')) && imgEl.attr('srcset')) {
      const srcset = imgEl.attr('srcset').split(',')[0].trim().split(' ')[0];
      if (srcset) img = srcset;
    }

    if (!nombre || !url) return;
    if (img.startsWith('data:') || img.includes('placeholder') || img.includes('loader')) img = '';
    if (/^tester\b/i.test(nombre)) return;

    // Extracción de precios
    let precio = null;
    const precioIns = $el.find('ins .amount, [data-price-type="finalPrice"] .price, .special-price .price').first();

    if (precioIns.length) {
      const num = parseFloat(precioIns.text().replace(/,/g, '').replace(/[^0-9.]/g, ''));
      if (!isNaN(num) && num > 0) precio = num;
    }

    if (precio === null) {
      $el.find('.price, .amount').each((_, pEl) => {
        const txt = $(pEl).text();
        const num = parseFloat(txt.replace(/,/g, '').replace(/[^0-9.]/g, ''));
        if (!isNaN(num) && num > 0 && (precio === null || num < precio)) {
          precio = num;
        }
      });
    }

    items.push({ nombre, url, img, precio });
  });

  return items;
}

function calcularPrecioVenta(precioAmora) {
  if (precioAmora == null) return null;
  let margen;
  if (precioAmora < 500) margen = 0.35;
  else if (precioAmora < 1000) margen = 0.30;
  else if (precioAmora < 2000) margen = 0.25;
  else if (precioAmora < 4000) margen = 0.20;
  else margen = 0.15;

  let conMargen = precioAmora * (1 + margen);
  if (precioAmora < 1300) {
    conMargen += 180;
  }
  const redondeado = Math.ceil(conMargen / 10) * 10;
  return redondeado + 150;
}

async function main() {
  const seen = new Set();
  const productos = [];
  let fallosSeguidos = 0;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const html = await fetchPagina(p);

    if (html === null) {
      fallosSeguidos++;
      if (fallosSeguidos >= 2) {
        console.log('Recorrido concluido.');
        break;
      }
      await esperar(2000);
      continue;
    }
    fallosSeguidos = 0;

    const items = extraerDePagina(html);
    let nuevos = 0;

    for (const it of items) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);

      if (it.img) {
        productos.push({
          nombre: it.nombre,
          img: it.img,
          precio_venta: calcularPrecioVenta(it.precio)
        });
        nuevos++;
      }
    }

    console.log(`Página ${p}: +${nuevos} nuevos (acumulados: ${productos.length})`);

    // Si una página devuelve 0 productos nuevos, intentamos una más y si sigue vacía paramos
    if (nuevos === 0 && p > 1) {
      console.log('Sin productos en esta página, verificando la siguiente...');
      await esperar(3000);
      const html2 = await fetchPagina(p + 1);
      if (!html2) break;
      const items2 = extraerDePagina(html2);
      const nuevos2 = items2.filter((it) => !seen.has(it.url)).length;
      if (nuevos2 === 0) break;
    }

    await esperar(2000);
  }

  productos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  let anterior = [];
  try {
    anterior = JSON.parse(fs.readFileSync('products.json', 'utf-8'));
  } catch (e) {
    anterior = [];
  }

  // Si detecta un catálogo sustancial, se actualiza
  if (productos.length === 0) {
    console.log('\n❌ No se obtuvieron productos. Abortando para proteger el catálogo previo.');
    process.exit(1);
  }

  fs.writeFileSync('products.json', JSON.stringify(productos, null, 2));
  console.log(`\n✅ Éxito: ${productos.length} productos exportados a products.json`);
}

main().catch((err) => {
  console.error('Error general durante la ejecución:', err);
  process.exit(1);
});
