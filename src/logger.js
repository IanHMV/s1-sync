import { config } from './config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

// Emite una linea JSON por evento. Asi tus drivers de logs de Docker
// (o cualquier agregador) lo pueden parsear sin esfuerzo.
function emit(level, msg, extra) {
  if (LEVELS[level] > threshold) return;
  const line = { ts: new Date().toISOString(), level, msg, ...extra };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(JSON.stringify(line) + '\n');
}

export const logger = {
  error: (msg, extra) => emit('error', msg, extra),
  warn: (msg, extra) => emit('warn', msg, extra),
  info: (msg, extra) => emit('info', msg, extra),
  debug: (msg, extra) => emit('debug', msg, extra),
};
