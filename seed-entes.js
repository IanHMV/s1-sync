import { assertConfig } from '../src/config.js';
import { connect, close, entesCol } from '../src/db.js';
import { encrypt } from '../src/crypto.js';
import { logger } from '../src/logger.js';

// =====================================================================
//  EDITA AQUI tus entes (en texto plano). Al correr el script, las
//  credenciales se guardan CIFRADAS en la base; este archivo NO debe
//  subirse a git con datos reales (dejalo como plantilla).
//
//  Correr con:  npm run seed:entes
// =====================================================================
const ENTES = [
  {
    nombre: 'Ente Ejemplo 01',
    activo: true,

    // URL base y ruta del endpoint de declaraciones (de tu Insomnia).
    baseUrl: 'https://apisidepat.auditoriaonlineaosaf.mx',
    declaracionesPath: '/api/auth/v2/declaraciones',

    // URL del login OAuth2.
    tokenUrl: 'https://apisidepat.auditoriaonlineaosaf.mx/api/auth/login',

    // Sincronizacion incremental: dejalo en false hasta CONFIRMAR que la API
    // del ente acepta filtrar por fecha. Si la acepta, pon true y ajusta
    // fechaParam al nombre real del parametro.
    incremental: false,
    fechaParam: 'fechaActualizacion',

    auth: {
      authMode: 'oauth',        // 'oauth' (form-urlencoded) o 'json'
      username: 'pdnuser_004',  // se cifra
      password: 'TU_PASSWORD',  // se cifra
      clientId: '4',            // queda en claro (no es secreto)
      clientSecret: 'TU_CLIENT_SECRET', // se cifra
    },
  },

  // Agrega aqui los entes 2, 3, 4, 5... (y los que vengan despues).
];

async function seed() {
  assertConfig();
  await connect();

  for (const e of ENTES) {
    const doc = {
      nombre: e.nombre,
      activo: e.activo,
      baseUrl: e.baseUrl,
      declaracionesPath: e.declaracionesPath,
      tokenUrl: e.tokenUrl,
      incremental: !!e.incremental,
      fechaParam: e.fechaParam || 'fechaActualizacion',
      auth: {
        authMode: e.auth.authMode || 'oauth',
        clientId: e.auth.clientId,
        usernameEnc: encrypt(e.auth.username),
        passwordEnc: encrypt(e.auth.password),
        clientSecretEnc: encrypt(e.auth.clientSecret),
      },
      updatedAt: new Date(),
    };

    await entesCol().updateOne(
      { nombre: e.nombre },
      { $set: doc, $setOnInsert: { lastSyncAt: null, lastCursor: null } },
      { upsert: true },
    );
    logger.info('Ente guardado (credenciales cifradas)', { ente: e.nombre });
  }

  await close();
  logger.info('Catalogo de entes actualizado.');
  process.exit(0);
}

seed().catch((err) => {
  logger.error('Error al sembrar entes', { error: err.message });
  process.exit(1);
});
