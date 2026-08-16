import * as cheerio from 'cheerio';
import fs from 'fs';

const BASE = 'https://amoramarket.com.mx/fragancias.html';
const MAX_PAGES = 100;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPagina(p, intentos = 3) {
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(`${BASE}?p=${p}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CatalogBot/1.0; +https://github.com)' }
      });
      if (res.ok) return await res.text();
      console.log(`Página ${p}: respuesta ${res.status}, reintentando...`);
    } catch (e) {
      console.log(`Página ${p}: error de red, reintentando...`);
    }
    await esperar(4000 + i * 3000);
  }
  return null;
}

function extraerDePagina(html) {
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
    if (/^tester\b/i.test(nombre)) return; // excluye testers (traen marca de agua de Amora en la foto)

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
// + $180 de envío si el producto no alcanza el mínimo de envío gratis de Amora ($1,300)
function calcularPrecioVenta(precioAmora){
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
  return Math.ceil(conMargen / 10) * 10; // redondea hacia arriba al $10
}

async function main() {
  const seen = new Set();
  const productos = [];
  let fallosSeguidos = 0;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const html = await fetchPagina(p);

    if (html === null) {
      fallosSeguidos++;
      console.log(`Página ${p}: no se pudo cargar tras varios intentos.`);
      if (fallosSeguidos >= 4) break;
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
      }
      nuevos++;
    }

    console.log(`Página ${p}: +${nuevos} (total ${productos.length})`);

    if (nuevos === 0 && p > 1) {
      console.log('Sin productos nuevos, verificando una vez más antes de parar...');
      await esperar(3000);
      const html2 = await fetchPagina(p + 1);
      if (html2 === null) break;
      const items2 = extraerDePagina(html2);
      const nuevos2 = items2.filter((it) => !seen.has(it.url)).length;
      console.log(`Página ${p + 1}: +${nuevos2} (verificación)`);
      if (nuevos2 === 0) break;
    }

    await esperar(1500);
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
