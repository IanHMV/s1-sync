import { fetchWithRetry } from './http.js';
import { getToken } from './oauth.js';
import { config } from './config.js';
import { logger } from './logger.js';

// === PUNTO A VERIFICAR CON TU ENTE ===
// El estandar PDN envuelve la respuesta en { pagination: {...}, results: [...] }.
// Si tu ente responde con otros nombres (p.ej. "data" en vez de "results"),
// ajusta extractResults / extractHasNext / extractTotal aqui.
// Tip: ya tienes Insomnia pegandole a este endpoint; mira la respuesta real
// y confirma estos tres puntos.
function extractResults(payload) {
  return payload.results || payload.data || payload.declaraciones || [];
}
function extractTotal(payload) {
  return payload?.pagination?.totalRows ?? payload?.pagination?.total ?? payload?.totalRows ?? null;
}
function extractHasNext(payload, page, pageSize, fetchedSoFar) {
  if (typeof payload?.pagination?.hasNextPage === 'boolean') return payload.pagination.hasNextPage;
  const total = extractTotal(payload);
  if (total != null) return fetchedSoFar < total;
  // Si no hay metadatos de paginacion, asumimos que no hay mas cuando la pagina
  // vino incompleta.
  return extractResults(payload).length >= pageSize;
}

// Arma el cuerpo del POST de consulta. Incluye el filtro incremental por fecha
// SOLO si el ente lo soporta (ente.incremental === true).
function buildQueryBody(ente, page, since) {
  const body = { page, pageSize: config.pageSize };
  if (ente.incremental && since) {
    // El nombre del parametro de fecha depende de la API del ente.
    const field = ente.fechaParam || 'fechaActualizacion';
    body[field] = since;
  }
  return body;
}

// Descarga TODAS las declaraciones del ente, pagina por pagina.
// onItems(items) se llama por cada pagina para procesarla en streaming
// (no acumulamos todo en memoria).
export async function fetchDeclaraciones(ente, { since = null, onItems }) {
  const url = ente.baseUrl.replace(/\/$/, '') + ente.declaracionesPath;
  let token = await getToken(ente);
  let page = 1;
  let fetched = 0;
  let reauthed = false;

  while (true) {
    const doRequest = async () =>
      fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(buildQueryBody(ente, page, since)),
      });

    let res = await doRequest();

    // Token expirado a mitad del paginado: re-autenticamos una vez y reintentamos.
    if (res.status === 401 && !reauthed) {
      logger.info('Token expirado, re-autenticando', { ente: ente.nombre, page });
      token = await getToken(ente, { force: true });
      reauthed = true;
      res = await doRequest();
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Consulta fallida en "${ente.nombre}" pagina ${page}: HTTP ${res.status} ${text.slice(0, 200)}`);
    }

    const payload = await res.json();
    const items = extractResults(payload);
    fetched += items.length;

    if (items.length) await onItems(items);

    if (!extractHasNext(payload, page, config.pageSize, fetched) || items.length === 0) break;
    page += 1;
  }

  return { fetched, pages: page };
}
