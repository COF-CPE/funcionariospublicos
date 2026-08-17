/**
 * Intenta descargar y parsear el directorio del MEF por Unidad Ejecutora
 * (directorio_DTRI_por_unidad_ejecutora.xlsx) y emparejar cada fila con
 * uno de los 40 proyectos BID de proyectos-bid.json, para extraer un
 * posible nombre de Coordinador/contacto.
 *
 * INCIERTO A PROPÓSITO: no se pudo verificar la estructura real de este
 * archivo (columnas, si trae nombres de coordinador o solo datos
 * administrativos) porque mef.gob.pe no era accesible desde el sandbox
 * donde se escribió este script. La primera corrida real (en GitHub
 * Actions, que sí tiene internet completo) es la primera vez que este
 * código ve el archivo de verdad.
 *
 * Si falla o no encuentra columnas útiles, guarda el archivo crudo en
 * output/mef-directorio-raw.xlsx y un volcado de columnas en
 * output/mef-directorio-columnas.json para poder ajustar el mapeo
 * manualmente después.
 *
 * Uso:
 *   node scrape-mef-directorio.js
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const URL_DIRECTORIO_MEF =
  'https://www.mef.gob.pe/contenidos/rec_publicos/documentos/directorio_DTRI_por_unidad_ejecutora.xlsx';
const OUTPUT_DIR = path.join(__dirname, 'output');
const RAW_FILE = path.join(OUTPUT_DIR, 'mef-directorio-raw.xlsx');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'coordinadores-ue-bid.json');

async function descargarArchivo(url, destino) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} descargando ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(destino, buffer);
  return buffer;
}

// Heurística para encontrar la columna de nombre de contacto, sin saber
// de antemano cómo se llama exactamente en el archivo real.
function encontrarColumna(headers, candidatos) {
  const normalizados = headers.map((h) => (h || '').toString().toLowerCase().trim());
  for (const candidato of candidatos) {
    const idx = normalizados.findIndex((h) => h.includes(candidato));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

async function main() {
  console.log(`Descargando ${URL_DIRECTORIO_MEF} ...`);
  let buffer;
  try {
    buffer = await descargarArchivo(URL_DIRECTORIO_MEF, RAW_FILE);
  } catch (e) {
    console.error('No se pudo descargar el directorio del MEF:', e.message);
    console.error('Revisa output/ (si algo se alcanzó a guardar) o la URL manualmente.');
    process.exit(0); // no rompe el workflow completo por esto
  }

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const nombreHoja = workbook.SheetNames[0];
  const hoja = workbook.Sheets[nombreHoja];
  const filas = XLSX.utils.sheet_to_json(hoja, { defval: null });

  if (filas.length === 0) {
    console.error('El archivo se descargó pero no se pudo leer ninguna fila.');
    process.exit(0);
  }

  const headers = Object.keys(filas[0]);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'mef-directorio-columnas.json'),
    JSON.stringify({ hoja: nombreHoja, columnas: headers, filas_totales: filas.length, primera_fila: filas[0] }, null, 2)
  );
  console.log('Columnas encontradas:', headers);

  // AJUSTAR según lo que muestre mef-directorio-columnas.json en la
  // primera corrida real.
  const colUnidadEjecutora = encontrarColumna(headers, ['unidad ejecutora', 'unidad_ejecutora', 'ue']);
  const colNombreContacto = encontrarColumna(headers, ['sectorista', 'coordinador', 'responsable', 'nombre', 'titular', 'jefe']);
  const colCorreo = encontrarColumna(headers, ['correo', 'email']);
  const colTelefono = encontrarColumna(headers, ['telefono', 'teléfono', 'celular']);

  if (!colUnidadEjecutora || !colNombreContacto) {
    console.error(
      'No se pudo identificar automáticamente las columnas de Unidad ' +
      'Ejecutora y/o nombre de contacto. Revisa output/mef-directorio-columnas.json ' +
      'y ajusta encontrarColumna() con los nombres reales.'
    );
    process.exit(0);
  }

  const proyectos = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'proyectos-bid.json'), 'utf-8')
  );

  const resultados = [];

  for (const fila of filas) {
    const nombreUE = (fila[colUnidadEjecutora] || '').toString().trim();
    const nombreContacto = (fila[colNombreContacto] || '').toString().trim();
    if (!nombreUE || !nombreContacto) continue;

    // Emparejamiento simple por coincidencia parcial de texto contra el
    // nombre de cada proyecto. Ajustar si da falsos positivos/negativos.
    const proyectoCoincidente = proyectos.find((p) =>
      normalizar(p.nombre).includes(normalizar(nombreUE).slice(0, 25)) ||
      normalizar(nombreUE).includes(normalizar(p.nombre).slice(0, 25))
    );

    if (!proyectoCoincidente) continue;

    resultados.push({
      nombre: nombreContacto,
      cargo: 'Contacto MEF (Sectorista) — no es el equipo de la Unidad Ejecutora',
      entidad: `${proyectoCoincidente.proyecto} — ${proyectoCoincidente.nombre}`,
      tipo: 'ue_bid',
      correo: colCorreo ? (fila[colCorreo] || null) : null,
      correo_faltante: !colCorreo || !fila[colCorreo],
      telefono: colTelefono ? (fila[colTelefono] || null) : null,
      fuente: URL_DIRECTORIO_MEF,
      fecha_scrape: new Date().toISOString(),
      estado: 'publicado',
    });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(resultados, null, 2), 'utf-8');
  console.log(
    `Listo: ${resultados.length} contactos emparejados con proyectos BID ` +
    `(de ${filas.length} filas totales en el directorio MEF).`
  );
}

function normalizar(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

main().catch((err) => {
  console.error('Error en el scraper del MEF:', err);
  process.exit(0); // no rompe el resto del workflow
});
