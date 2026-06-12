import "dotenv/config";

// Construye la URI de conexion a Mongo a partir de variables sueltas.
// El servicio usa estas credenciales para DOS bases:
//   - La base del S1 (donde vive la coleccion 'declaraciones' que lee tu s1-api)
//   - La base de metadatos del sync (catalogo de entes + bitacora)
// Por eso el usuario debe tener permiso de lectura/escritura en ambas
// (lo mas simple es el usuario root de Mongo; lo ideal es un usuario dedicado).
function buildMongoUri() {
  const user = encodeURIComponent(process.env.SYNC_MONGO_USER || "");
  const pass = encodeURIComponent(process.env.SYNC_MONGO_PASS || "");
  const host = process.env.SYNC_MONGO_HOST || "s1-database";
  const port = process.env.SYNC_MONGO_PORT || "27017";
  const authSource = process.env.SYNC_MONGO_AUTHDB || "admin";
  return `mongodb://${user}:${pass}@${host}:${port}/?authSource=${authSource}`;
}

export const config = {
  mongoUri: buildMongoUri(),

  // Base y coleccion DESTINO (la que lee tu s1-api; no la inventamos, viene de tu Compass)
  s1DbName: process.env.S1_DB_NAME || "s1-api",
  declaracionesCollection: process.env.S1_COLLECTION || "declaraciones",

  // Base de metadatos del propio sync (separada para no ensuciar la base del S1)
  syncDbName: process.env.SYNC_DB_NAME || "s1-sync",

  // Llave de cifrado para las credenciales de los entes (32 bytes en hex o base64).
  // Genera una con: npm run genkey
  encKey: process.env.SYNC_ENC_KEY || "",

  // Programacion. '0 3 1,16 * *' = 3:00 am los dias 1 y 16 (aprox. cada 15 dias, predecible).
  cron: process.env.SYNC_CRON || "0 3 1,16 * *",
  timezone: process.env.SYNC_TZ || "America/Mexico_City",

  // Si es 'true', corre una sincronizacion al arrancar (util para la primera carga).
  runOnStart: String(process.env.SYNC_RUN_ON_START || "false") === "true",

  // Paginado y resiliencia
  pageSize: Number(process.env.SYNC_PAGE_SIZE || 100),
  httpTimeoutMs: Number(process.env.SYNC_HTTP_TIMEOUT_MS || 30000),
  maxRetries: Number(process.env.SYNC_MAX_RETRIES || 3),
  // Si fallan esta cantidad de paginas SEGUIDAS, se asume falla sistematica del
  // ente y se deja de insistir (evita perder mucho tiempo reintentando en vano).
  maxConsecutiveFailures: Number(
    process.env.SYNC_MAX_CONSECUTIVE_FAILURES || 5,
  ),
  upsertBatchSize: Number(process.env.SYNC_UPSERT_BATCH || 500),

  logLevel: process.env.SYNC_LOG_LEVEL || "info",
};

export function assertConfig() {
  const missing = [];
  if (!process.env.SYNC_MONGO_USER) missing.push("SYNC_MONGO_USER");
  if (!process.env.SYNC_MONGO_PASS) missing.push("SYNC_MONGO_PASS");
  if (!config.encKey) missing.push("SYNC_ENC_KEY");
  if (missing.length) {
    throw new Error(
      `Faltan variables de entorno obligatorias: ${missing.join(", ")}`,
    );
  }
}
