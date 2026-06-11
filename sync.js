import {
  declaracionesCol, entesCol, runsCol, acquireLock, releaseLock,
} from './db.js';
import { fetchDeclaraciones } from './enteClient.js';
import { validateEnvelope } from './validator.js';
import { toStoredDoc, getActualizacion } from './transform.js';
import { config } from './config.js';
import { logger } from './logger.js';

const LOCK_NAME = 's1-sync-run';

// Hace upsert de un lote por la clave natural "id" (NO por _id).
// upsert:true => si la declaracion ya existe la actualiza; si no, la inserta.
// Esto es lo que evita duplicados en cada corrida quincenal.
async function upsertBatch(docs) {
  if (!docs.length) return 0;
  const ops = docs.map((doc) => ({
    updateOne: {
      filter: { id: doc.id },
      update: { $set: doc },
      upsert: true,
    },
  }));
  const res = await declaracionesCol().bulkWrite(ops, { ordered: false });
  return (res.upsertedCount || 0) + (res.modifiedCount || 0);
}

async function syncEnte(ente) {
  const run = {
    enteId: ente._id,
    enteNombre: ente.nombre,
    startedAt: new Date(),
    finishedAt: null,
    status: 'running',
    fetched: 0,
    upserted: 0,
    invalid: 0,
    errors: [],
  };
  const { insertedId: runId } = await runsCol().insertOne(run);
  logger.info('Sincronizando ente', { ente: ente.nombre, incremental: !!ente.incremental });

  let maxActualizacion = ente.lastCursor || null;
  let buffer = [];

  const flush = async () => {
    if (!buffer.length) return;
    run.upserted += await upsertBatch(buffer);
    buffer = [];
  };

  try {
    const since = ente.incremental ? ente.lastCursor : null;

    const { fetched } = await fetchDeclaraciones(ente, {
      since,
      onItems: async (items) => {
        for (const item of items) {
          const doc = toStoredDoc(item);
          const check = validateEnvelope(doc);
          if (!check.ok) {
            run.invalid += 1;
            // Registramos hasta 20 ejemplos de error para no inflar la bitacora.
            if (run.errors.length < 20) {
              run.errors.push({ id: doc.id ?? '(sin id)', motivo: check.errors.join('; ') });
            }
            continue;
          }
          const fecha = getActualizacion(item);
          if (fecha && (!maxActualizacion || fecha > maxActualizacion)) maxActualizacion = fecha;
          buffer.push(doc);
          if (buffer.length >= config.upsertBatchSize) await flush();
        }
      },
    });
    run.fetched = fetched;
    await flush();

    // Guardamos el cursor (fecha mas reciente vista) para la proxima corrida
    // incremental, y la fecha de ultima sincronizacion.
    await entesCol().updateOne(
      { _id: ente._id },
      { $set: { lastSyncAt: new Date(), lastCursor: maxActualizacion } },
    );

    run.status = run.invalid > 0 ? 'completed_with_warnings' : 'completed';
  } catch (err) {
    run.status = 'failed';
    run.errors.push({ id: '(general)', motivo: err.message });
    logger.error('Fallo la sincronizacion del ente', { ente: ente.nombre, error: err.message });
  } finally {
    run.finishedAt = new Date();
    await runsCol().updateOne({ _id: runId }, { $set: run });
    logger.info('Ente finalizado', {
      ente: ente.nombre, status: run.status, fetched: run.fetched, upserted: run.upserted, invalid: run.invalid,
    });
  }
  return run;
}

// Corrida completa: recorre todos los entes activos, aislando fallos
// (si uno truena, los demas continuan).
export async function runSync() {
  const got = await acquireLock(LOCK_NAME, 3600);
  if (!got) {
    logger.warn('Ya hay una sincronizacion en curso; se omite esta ejecucion.');
    return;
  }

  const startedAt = Date.now();
  try {
    const entes = await entesCol().find({ activo: true }).toArray();
    logger.info('Inicio de sincronizacion', { entes: entes.length });

    const summary = [];
    for (const ente of entes) {
      const run = await syncEnte(ente); // secuencial: gentil con las APIs de origen
      summary.push({ ente: ente.nombre, status: run.status, fetched: run.fetched, upserted: run.upserted });
    }

    logger.info('Sincronizacion terminada', {
      duracionSeg: Math.round((Date.now() - startedAt) / 1000),
      resumen: summary,
    });
  } finally {
    await releaseLock(LOCK_NAME);
  }
}
