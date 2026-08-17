/**
 * Scraper de gob.pe/pcm/ministros usando un navegador headless real
 * (Playwright) en vez de un fetch simple, porque gob.pe bloquea requests
 * sin navegador (responde 418).
 *
 * IMPORTANTE: los selectores de abajo son un punto de partida razonable
 * basado en el patrón típico de las páginas de gob.pe, pero no pudieron
 * verificarse contra el DOM real (el sandbox donde se escribió este script
 * no tiene salida a gob.pe). La primera vez que lo corras:
 *
 *   1. Ejecuta con { headless: false } para ver el navegador en acción.
 *   2. Si extractedData sale vacío o mal, abre el inspector (F12) en
 *      gob.pe/pcm/ministros y ajusta los selectores marcados con // AJUSTAR.
 *
 * Uso:
 *   npm install
 *   node scrape-ministros.js
 *
 * Salida:
 *   ./output/ministros.json
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_MINISTROS = 'https://www.gob.pe/pcm/ministros';
const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'ministros.json');

// Headers que ayudan a parecer un navegador real y no un bot
const REAL_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function scrapeMinistros() {
  const browser = await chromium.launch({
    headless: true, // cambia a false para depurar visualmente
  });

  const context = await browser.newContext({
    userAgent: REAL_USER_AGENT,
    locale: 'es-PE',
    viewport: { width: 1366, height: 900 },
  });

  const page = await context.newPage();

  console.log(`Cargando ${URL_MINISTROS} ...`);
  await page.goto(URL_MINISTROS, { waitUntil: 'networkidle', timeout: 60000 });

  // Espera a que el contenido dinámico cargue (gob.pe usa carga por JS)
  await page.waitForTimeout(2000);

  // AJUSTAR: selector del contenedor de cada tarjeta de ministro.
  // Punto de partida típico en gob.pe: artículos/tarjetas dentro de una lista.
  const cardSelectorCandidates = [
    '.function-card',
    '.employee-card',
    'article',
    '.director-card',
    '[class*="card"]',
  ];

  let cards = [];
  for (const selector of cardSelectorCandidates) {
    const found = await page.$$(selector);
    if (found.length > 3) {
      console.log(`Usando selector "${selector}" (${found.length} tarjetas encontradas)`);
      cards = found;
      break;
    }
  }

  if (cards.length === 0) {
    // Fallback: guarda el HTML completo para inspección manual
    const html = await page.content();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'debug-page.html'), html);
    console.error(
      'No se encontraron tarjetas con los selectores conocidos.\n' +
      'Se guardó el HTML completo en output/debug-page.html para que ' +
      'inspecciones la estructura real y ajustes los selectores.'
    );
    await browser.close();
    return;
  }

  const resultados = [];

  for (const card of cards) {
    // AJUSTAR: estos selectores son relativos a cada tarjeta
    const nombre = await safeText(card, '.name, .full-name, h3, h2');
    const cargo = await safeText(card, '.position, .charge, .role, p');
    const telefono = await safeText(card, '.phone, [class*="phone"]');
    const entidadUrl = await safeAttr(card, 'a[href*="gob.pe"]', 'href');

    // Correo: primero intenta el link mailto: (más confiable), y si no
    // existe, busca un patrón de email en todo el texto de la tarjeta.
    let correo = await safeAttr(card, 'a[href^="mailto:"]', 'href');
    correo = correo ? correo.replace(/^mailto:/i, '').trim() : null;

    if (!correo) {
      const textoCompleto = await card.textContent();
      // Solo minúsculas: los correos de gob.pe son siempre en minúsculas,
      // y así se corta antes de arrastrar texto pegado como "...gob.peVer".
      const match = textoCompleto && textoCompleto.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
      correo = match ? match[0] : null;
    }

    if (nombre) {
      resultados.push({
        nombre: nombre.trim(),
        cargo: cargo ? cargo.trim() : null,
        entidad: derivarEntidad(cargo),
        tipo: 'ministerio',
        telefono: telefono ? telefono.trim() : null,
        correo: correo,
        correo_faltante: !correo, // flag para que el panel de revisión lo resalte
        entidad_url: entidadUrl || null,
        fuente: URL_MINISTROS,
        fecha_scrape: new Date().toISOString(),
        estado: 'publicado',
      });
    }
  }

  const sinCorreo = resultados.filter((r) => r.correo_faltante).length;
  if (sinCorreo > 0) {
    console.warn(`Aviso: ${sinCorreo} de ${resultados.length} registros no tienen correo detectado.`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(resultados, null, 2), 'utf-8');

  console.log(`Listo: ${resultados.length} registros guardados en ${OUTPUT_FILE}`);

  await browser.close();
}

function derivarEntidad(cargo) {
  if (!cargo) return null;
  const texto = cargo.trim();
  if (/^Presidente del Consejo de Ministros/i.test(texto)) {
    return 'Presidencia del Consejo de Ministros';
  }
  const match = texto.match(/^Ministr[oa] (de|del) (.+)$/i);
  if (match) {
    return `Ministerio ${match[1]} ${match[2]}`;
  }
  return texto; // fallback: usa el cargo tal cual si no calza el patrón
}

async function safeText(handle, selector) {
  try {
    const el = await handle.$(selector);
    if (!el) return null;
    return await el.textContent();
  } catch {
    return null;
  }
}

async function safeAttr(handle, selector, attr) {
  try {
    const el = await handle.$(selector);
    if (!el) return null;
    return await el.getAttribute(attr);
  } catch {
    return null;
  }
}

scrapeMinistros().catch((err) => {
  console.error('Error en el scraper:', err);
  process.exit(1);
});
