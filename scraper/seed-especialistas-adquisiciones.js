/**
 * Siembra (una sola vez) los Especialistas en Adquisiciones reales de las
 * Unidades Ejecutoras BID, provistos directamente por el equipo (no
 * scrapeados). Publica directo en "autoridades" con tipo: "ue_bid" y
 * cargo fijo "Especialista en Adquisiciones".
 *
 * Uso:
 *   node seed-especialistas-adquisiciones.js
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) {
  console.error('Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
});

const db = admin.firestore();

function normalizarId(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 200);
}

async function main() {
  const registros = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'especialistas-adquisiciones.json'), 'utf-8')
  );

  const ref = db.collection('autoridades');
  let creados = 0;

  for (const r of registros) {
    const cargo = 'Especialista en Adquisiciones';
    const id = normalizarId(`${cargo}-${r.entidad}-${r.nombre}`);
    await ref.doc(id).set({
      nombre: r.nombre,
      cargo,
      entidad: r.entidad,
      tipo: 'ue_bid',
      correo: r.correo || null,
      correo_faltante: !r.correo,
      telefono: null,
      fuente: 'carga_manual_equipo',
      estado: 'publicado',
      fecha_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    });
    creados++;
  }

  console.log(`Listo: ${creados} especialistas en adquisiciones sembrados.`);
}

main().catch((err) => {
  console.error('Error sembrando especialistas:', err);
  process.exit(1);
});
