import { fetchWithRetry } from './http.js';
import { decrypt } from './crypto.js';
import { logger } from './logger.js';

// Cache de tokens en memoria, por ente, valido solo durante el proceso.
const tokenCache = new Map(); // enteId -> { token, expiresAt }

// === PUNTO A VERIFICAR CON TU ENTE ===
// La imagen de Insomnia muestra "Resource Owner Password Credentials" con las
// credenciales "In Request Body". Eso, en el estandar OAuth2, es un POST
// application/x-www-form-urlencoded con grant_type=password.
// Si tu endpoint /api/auth/login espera JSON en su lugar, configura el ente con
// authMode: 'json' (ver scripts/seed-entes.js).
async function requestToken(ente) {
  const username = decrypt(ente.auth.usernameEnc);
  const password = decrypt(ente.auth.passwordEnc);
  const clientId = ente.auth.clientId;
  const clientSecret = decrypt(ente.auth.clientSecretEnc);

  let body;
  let headers;
  if (ente.auth.authMode === 'json') {
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify({
      grant_type: 'password',
      username,
      password,
      client_id: clientId,
      client_secret: clientSecret,
    });
  } else {
    headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const params = new URLSearchParams({
      grant_type: 'password',
      username,
      password,
      client_id: String(clientId ?? ''),
      client_secret: clientSecret ?? '',
    });
    body = params.toString();
  }

  const res = await fetchWithRetry(ente.tokenUrl, { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Auth fallida en ente "${ente.nombre}": HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();

  // El estandar OAuth devuelve access_token / expires_in. Algunos sistemas usan
  // accessToken / token. Cubrimos las variantes mas comunes.
  const token = data.access_token || data.accessToken || data.token;
  if (!token) {
    throw new Error(`No se encontro el token en la respuesta de "${ente.nombre}". Revisa el formato de la respuesta.`);
  }
  const expiresInSec = Number(data.expires_in || data.expiresIn || 3300); // ~55 min por defecto
  return { token, expiresAt: Date.now() + expiresInSec * 1000 };
}

// Devuelve un token valido para el ente. Si force=true, ignora la cache (para
// re-autenticar cuando una peticion devolvio 401 a mitad del paginado).
export async function getToken(ente, { force = false } = {}) {
  const cached = tokenCache.get(ente._id?.toString());
  if (!force && cached && cached.expiresAt - Date.now() > 60000) {
    return cached.token;
  }
  logger.debug('Solicitando token OAuth', { ente: ente.nombre });
  const fresh = await requestToken(ente);
  tokenCache.set(ente._id?.toString(), fresh);
  return fresh.token;
}
