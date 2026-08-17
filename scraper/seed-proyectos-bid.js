/**
 * Siembra (una sola vez, no es parte del scraper semanal) los proyectos
 * del portafolio BID Perú en la colección "proyectos_bid" de Firestore.
 * Esto alimenta el <select> del panel admin para cargar Coordinadores
 * y Equipo Clave sin tener que escribir el nombre del proyecto a mano.
 *
 * No crea "autoridades" (personas) — solo el catálogo de proyectos.
 *
 * Uso:
 *   node seed-proyectos-bid.js
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

async function main() {
  const proyectos = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'proyectos-bid.json'), 'utf-8')
  );

  const ref = db.collection('proyectos_bid');
  let creados = 0;

  for (const p of proyectos) {
    const id = p.proyecto.toLowerCase(); // ej. "pe-l1224"
    await ref.doc(id).set({
      ...p,
      fecha_carga: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    creados++;
  }

  console.log(`Listo: ${creados} proyectos sembrados en la colección "proyectos_bid".`);
}

main().catch((err) => {
  console.error('Error sembrando proyectos:', err);
  process.exit(1);
});
