import cron from "node-cron";
import { assertConfig, config } from "./config.js";
import { connect, close } from "./db.js";
import { runSync, releaseRunLock } from "./sync.js";
import { logger } from "./logger.js";

async function main() {
  assertConfig();
  await connect();

  // Apagado limpio en CUALQUIER modo: si cortas con Ctrl+C (SIGINT) o Docker
  // manda SIGTERM, soltamos el candado y cerramos. Asi no queda atascado.
  let shuttingDown = false;
  const shutdown = async (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Apagando", { signal: sig });
    try {
      await releaseRunLock();
    } catch (e) {
      logger.error("No se pudo soltar el candado", { error: e.message });
    }
    try {
      await close();
    } catch {}
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  const runOnce = process.argv.includes("--once");

  if (runOnce) {
    // Modo manual / pruebas: corre una sola vez y termina.
    logger.info("Modo --once: ejecutando una sincronizacion y saliendo.");
    await runSync();
    await close();
    process.exit(0);
  }

  // Modo servicio: queda residente y corre segun el cron.
  if (!cron.validate(config.cron)) {
    throw new Error(`Expresion cron invalida: "${config.cron}"`);
  }
  logger.info("Servicio iniciado", { cron: config.cron, tz: config.timezone });

  cron.schedule(
    config.cron,
    async () => {
      logger.info("Disparo programado");
      try {
        await runSync();
      } catch (err) {
        logger.error("Error en la corrida programada", { error: err.message });
      }
    },
    { timezone: config.timezone },
  );

  if (config.runOnStart) {
    logger.info("SYNC_RUN_ON_START=true: corriendo al arranque");
    runSync().catch((err) =>
      logger.error("Error en corrida inicial", { error: err.message }),
    );
  }
}

main().catch((err) => {
  logger.error("Fallo fatal al iniciar", { error: err.message });
  process.exit(1);
});
