import { MongoClient } from 'mongodb';
import { config } from './config.js';
import { logger } from './logger.js';

let client;
let s1Db;
let syncDb;

export async function connect() {
  if (client) return;
  client = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: 10000,
  });
  await client.connect();
  s1Db = client.db(config.s1DbName);
  syncDb = client.db(config.syncDbName);

  // Indices SOLO en nuestra base de metadatos (no tocamos la coleccion de tu s1-api).
  await syncDb.collection('entes').createIndex({ activo: 1 });
  await syncDb.collection('sync_runs').createIndex({ enteId: 1, startedAt: -1 });
  await syncDb.collection('locks').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  logger.info('Conexion a Mongo establecida', { s1Db: config.s1DbName, syncDb: config.syncDbName });
}

export async function close() {
  if (client) await client.close();
  client = undefined;
}

export const declaracionesCol = () => s1Db.collection(config.declaracionesCollection);
export const entesCol = () => syncDb.collection('entes');
export const runsCol = () => syncDb.collection('sync_runs');
const locksCol = () => syncDb.collection('locks');

// Candado simple basado en Mongo para que no corran dos sincronizaciones a la vez
// (por ejemplo, si el cron dispara mientras una corrida manual sigue activa).
// Usa un TTL: si el proceso muere, el candado expira solo.
export async function acquireLock(name, ttlSeconds = 3600) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  try {
    await locksCol().insertOne({ _id: name, acquiredAt: now, expiresAt });
    return true;
  } catch (err) {
    if (err.code === 11000) return false; // ya existe -> hay otra corrida activa
    throw err;
  }
}

export async function releaseLock(name) {
  await locksCol().deleteOne({ _id: name });
}
