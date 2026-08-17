/**
 * Sube los registros scrapeados directo a la colección pública
 * "autoridades" (sin aprobación manual). Cada escritura queda registrada
 * en "historial_cambios" para poder auditar o revertir si algo salió mal,
 * pero no bloquea la publicación.
 *
 * Requiere la variable de entorno FIREBASE_SERVICE_ACCOUNT con el JSON
 * de la cuenta de servicio (como string), pensado para usarse como
 * GitHub Secret.
 *
 * Uso:
 *   node upload-to-firestore.js ./output/ministros.json
 */

const fs = require('fs');
const admin = require('firebase-admin');

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Uso: node upload-to-firestore.js <ruta-al-json>');
  process.exit(1);
}

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) {
  console.error('Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
});

const db = admin.firestore();

async function main() {
  const scraped = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  console.log(`${scraped.length} registros scrapeados a procesar...`);

  const autoridadesRef = db.collection('autoridades');
  const historialRef = db.collection('historial_cambios');

  let nuevos = 0;
  let actualizados = 0;
  let sinCambios = 0;

  for (const registro of scraped) {
    // Clave de match simple: cargo + entidad. Ajustar si hay mejores IDs
    // (ej. DNI, si en algún momento se captura de una fuente confiable).
    const idCandidato = normalizarId(`${registro.cargo}-${registro.entidad_url || registro.entidad || ''}`);

    const existente = await autoridadesRef.doc(idCandidato).get();
    const actual = existente.exists ? existente.data() : null;

    const cambioDetectado =
      !actual ||
      actual.nombre !== registro.nombre ||
      actual.telefono !== registro.telefono ||
      actual.correo !== registro.correo;

    if (!cambioDetectado) {
      sinCambios++;
      continue;
    }

    await autoridadesRef.doc(idCandidato).set({
      ...registro,
      estado: 'publicado',
      fecha_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    });

    await historialRef.add({
      autoridad_id: idCandidato,
      tipo: actual ? 'actualizacion' : 'nuevo',
      anterior: actual,
      nuevo: registro,
      fecha: admin.firestore.FieldValue.serverTimestamp(),
      publicado_automaticamente: true,
    });

    actual ? actualizados++ : nuevos++;
  }

  console.log(
    `Hecho. Nuevos: ${nuevos} | Actualizados: ${actualizados} | Sin cambios: ${sinCambios}\n` +
    `Todo publicado directo. Revisa la colección "historial_cambios" si necesitas auditar o revertir algo.`
  );
}

function normalizarId(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 200);
}

main().catch((err) => {
  console.error('Error subiendo a Firestore:', err);
  process.exit(1);
});
