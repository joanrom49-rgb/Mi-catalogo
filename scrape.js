import * as cheerio from 'cheerio';
import fs from 'fs';

const BASE = 'https://amoramarket.com.mx/fragancias.html';
const MAX_PAGES = 120;

async function scrapePage(p) {
  const res = await fetch(`${BASE}?p=${p}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CatalogBot/1.0; +https://github.com)' }
  });
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);
  const items = [];

  $('.product-item, li.item.product').each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find('a.product-item-link, a.product-item-photo').first();
    const nameEl = $el.find('.product-item-link, .product-item-name').first();
    const imgEl = $el.find('img').first();

    let nombre = (nameEl.text() || linkEl.text() || '').trim();
    if (nombre.endsWith('.')) nombre = nombre.slice(0, -1).trim();
    const url = linkEl.attr('href') || '';
    let img = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-original') || '';

    if (!nombre || !url) return;
    if (img.startsWith('data:') || img.includes('loader')) img = '';

    // Precio: tomamos el más bajo de todos los ".price" encontrados
    // (si hay precio rebajado, el rebajado siempre es menor que el tachado)
    let precio = null;
    $el.find('.price').each((_, priceEl) => {
      const txt = $(priceEl).text();
      const num = parseFloat(txt.replace(/[^0-9.]/g, ''));
      if (!isNaN(num) && num > 0 && (precio === null || num < precio)) {
        precio = num;
      }
    });

    items.push({ nombre, url, img, precio });
  });

  return items;
}

// Margen escalonado: más % en fragancias baratas, menos en las caras
function calcularPrecioVenta(precioAmora){
  if (precioAmora == null) return null;
  let margen;
  if (precioAmora < 500) margen = 0.35;
  else if (precioAmora < 1000) margen = 0.30;
  else if (precioAmora < 2000) margen = 0.25;
  else if (precioAmora < 4000) margen = 0.20;
  else margen = 0.15;

  const conMargen = precioAmora * (1 + margen);
  return Math.ceil(conMargen / 10) * 10; // redondea hacia arriba al $10
}

async function main() {
  const seen = new Set();
  const productos = [];

  for (let p = 1; p <= MAX_PAGES; p++) {
    const items = await scrapePage(p);
    if (!items || items.length === 0) break;

    let nuevos = 0;
    for (const it of items) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      if (it.img) {
        productos.push({
          nombre: it.nombre,
          img: it.img,
          precio_venta: calcularPrecioVenta(it.precio)
        }); // solo guardamos los que sí tienen foto
      }
      nuevos++;
    }

    console.log(`Página ${p}: +${nuevos} (total ${productos.length})`);
    if (nuevos === 0 && p > 1) break;
    await new Promise((r) => setTimeout(r, 600));
  }

  // Orden alfabético
  productos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  fs.writeFileSync('products.json', JSON.stringify(productos, null, 2));
  console.log(`\n✅ Listo: ${productos.length} productos guardados en products.json`);
}

main().catch((err) => {
  console.error('Error durante el scraping:', err);
  process.exit(1);
});
