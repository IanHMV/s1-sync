import crypto from 'node:crypto';
import { config } from './config.js';

// Cifrado simetrico autenticado (AES-256-GCM).
// Guardamos las contrasenas/secrets de los entes cifradas, NUNCA en texto plano.
// La llave (SYNC_ENC_KEY) vive solo en el entorno, jamas en la base ni en git.

const ALGO = 'aes-256-gcm';

function getKey() {
  const raw = config.encKey.trim();
  // Aceptamos hex (64 caracteres) o base64.
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }
  if (key.length !== 32) {
    throw new Error('SYNC_ENC_KEY debe representar 32 bytes (hex de 64 chars o base64). Genera una con: npm run genkey');
  }
  return key;
}

// Devuelve un string base64 con el formato: iv(12) | authTag(16) | ciphertext
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return '';
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(payloadB64) {
  if (!payloadB64) return '';
  const key = getKey();
  const buf = Buffer.from(payloadB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
