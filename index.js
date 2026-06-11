import cron from 'node-cron';
import { assertConfig, config } from './config.js';
import { connect, close } from './db.js';
import { runSync } from './sync.js';
import { logger } from './logger.js';

async function main() {
  assertConfig();
  await connect();

  const runOnce = process.argv.includes('--once');

  if (runOnce) {
    // Modo manual / pruebas: corre una sola vez y termina.
    logger.info('Modo --once: ejecutando una sincronizacion y saliendo.');
    await runSync();
    await close();
    process.exit(0);
  }

  // Modo servicio: queda residente y corre segun el cron.
  if (!cron.validate(config.cron)) {
    throw new Error(`Expresion cron invalida: "${config.cron}"`);
  }
  logger.info('Servicio iniciado', { cron: config.cron, tz: config.timezone });

  cron.schedule(config.cron, async () => {
    logger.info('Disparo programado');
    try {
      await runSync();
    } catch (err) {
      logger.error('Error en la corrida programada', { error: err.message });
    }
  }, { timezone: config.timezone });

  if (config.runOnStart) {
    logger.info('SYNC_RUN_ON_START=true: corriendo al arranque');
    runSync().catch((err) => logger.error('Error en corrida inicial', { error: err.message }));
  }

  // Apagado limpio cuando Docker manda SIGTERM/SIGINT.
  const shutdown = async (sig) => {
    logger.info('Apagando', { signal: sig });
    await close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Fallo fatal al iniciar', { error: err.message });
  process.exit(1);
});
