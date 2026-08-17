/**
 * Scraper del Directorio Nacional de Funcionarios Públicos de gob.pe
 * (gob.pe/funcionariospublicos), que lista funcionarios de TODAS las
 * entidades del Estado, paginado.
 *
 * Complementa a scrape-ministros.js (que solo cubre el gabinete).
 *
 * IMPORTANTE (igual que en scrape-ministros.js): los selectores son un
 * punto de partida sin verificar contra el DOM real, porque este sandbox
 * no tiene salida a gob.pe. Corre con { headless: false } la primera vez
 * y ajusta los selectores marcados con // AJUSTAR según lo que encuentres
 * en el inspector del navegador.
 *
 * Uso:
 *   node scrape-directorio-nacional.js [max_paginas]
 *
 * Salida:
 *   ./output/directorio-nacional.json
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_BASE = 'https://www.gob.pe/funcionariospublicos';
const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'directorio-nacional.json');
const MAX_PAGINAS = parseInt(process.argv[2] || '50', 10); // límite de seguridad

const REAL_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function scrapeDirectorioNacional() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: REAL_USER_AGENT,
    locale: 'es-PE',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  const resultados = [];
  let paginaActual = 1;
  let hayMas = true;

  while (hayMas && paginaActual <= MAX_PAGINAS) {
    // AJUSTAR: patrón real de paginación de gob.pe (puede ser ?page=N,
    // un botón "Cargar más" con scroll infinito, u otro esquema).
    const url = `${URL_BASE}?page=${paginaActual}`;
    console.log(`Página ${paginaActual}: ${url}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (e) {
      console.warn(`Timeout/error en página ${paginaActual}, deteniendo.`);
      break;
    }

    await page.waitForTimeout(1500);

    const cardSelectorCandidates = [
      '.function-card', '.employee-card', 'article', '[class*="card"]',
    ];

    let cards = [];
    for (const selector of cardSelectorCandidates) {
      const found = await page.$$(selector);
      if (found.length > 2) { cards = found; break; }
    }

    if (cards.length === 0) {
      console.log(`Sin tarjetas en página ${paginaActual}, fin del listado (o selector desactualizado).`);
      if (paginaActual === 1) {
        const html = await page.content();
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(OUTPUT_DIR, 'debug-directorio-nacional.html'), html);
        console.error('Se guardó output/debug-directorio-nacional.html para inspección manual.');
      }
      hayMas = false;
      break;
    }

    for (const card of cards) {
      const nombre = await safeText(card, '.name, .full-name, h3, h2');
      const cargo = await safeText(card, '.position, .charge, .role, p');
      const entidad = await safeText(card, '.entity, .institution, [class*="entity"]');
      const entidadUrl = await safeAttr(card, 'a[href*="gob.pe"]', 'href');

      let correo = await safeAttr(card, 'a[href^="mailto:"]', 'href');
      correo = correo ? correo.replace(/^mailto:/i, '').trim() : null;
      if (!correo) {
        const texto = await card.textContent();
        const match = texto && texto.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        correo = match ? match[0] : null;
      }

      if (nombre) {
        resultados.push({
          nombre: nombre.trim(),
          cargo: cargo ? cargo.trim() : null,
          entidad: entidad ? entidad.trim() : null,
          entidad_url: entidadUrl || null,
          tipo: inferirTipo(entidad, cargo),
          correo,
          correo_faltante: !correo,
          telefono: null,
          fuente: url,
          fecha_scrape: new Date().toISOString(),
          estado: 'publicado',
        });
      }
    }

    paginaActual++;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(resultados, null, 2), 'utf-8');

  const sinCorreo = resultados.filter((r) => r.correo_faltante).length;
  console.log(
    `Listo: ${resultados.length} registros en ${OUTPUT_FILE} ` +
    `(${sinCorreo} sin correo detectado).`
  );

  await browser.close();
}

// Clasificación heurística simple — ajustar según lo que realmente
// aparezca en el campo "entidad" de gob.pe.
function inferirTipo(entidad, cargo) {
  const texto = `${entidad || ''} ${cargo || ''}`.toLowerCase();
  if (texto.includes('ministerio')) return 'ministerio';
  if (/sunat|osce|indecopi|ana\b|osiptel|sbs|ositran|osinergmin/.test(texto)) return 'regulador';
  return 'agencia';
}

async function safeText(handle, selector) {
  try {
    const el = await handle.$(selector);
    if (!el) return null;
    return await el.textContent();
  } catch { return null; }
}

async function safeAttr(handle, selector, attr) {
  try {
    const el = await handle.$(selector);
    if (!el) return null;
    return await el.getAttribute(attr);
  } catch { return null; }
}

scrapeDirectorioNacional().catch((err) => {
  console.error('Error en el scraper:', err);
  process.exit(1);
});
