import { getToken } from "./oauth.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// === PUNTO A VERIFICAR CON TU ENTE ===
// El estandar PDN envuelve la respuesta en { pagination: {...}, results: [...] }.
function extractResults(payload) {
  return payload.results || payload.data || payload.declaraciones || [];
}
function extractTotal(payload) {
  return (
    payload?.pagination?.totalRows ??
    payload?.pagination?.total ??
    payload?.totalRows ??
    null
  );
}
function extractHasNext(payload, pageSize, fetchedSoFar) {
  if (typeof payload?.pagination?.hasNextPage === "boolean")
    return payload.pagination.hasNextPage;
  const total = extractTotal(payload);
  if (total != null) return fetchedSoFar < total;
  return extractResults(payload).length >= pageSize;
}

// Paginacion en la URL (?page=1&pageSize=100). Este endpoint NO acepta cuerpo.
function buildQueryString(ente, page, since) {
  const qs = new URLSearchParams({
    page: String(page),
    pageSize: String(config.pageSize),
  });
  if (ente.incremental && since)
    qs.set(ente.fechaParam || "fechaActualizacion", since);
  return qs.toString();
}

// Hace el POST y lee el JSON bajo UN MISMO limite de tiempo, con reintentos.
// Asi una respuesta lenta o colgada no deja el proceso esperando para siempre.
async function postPage(url, token) {
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Accept: "*/*", Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (res.status === 401) {
        clearTimeout(timer);
        return { status: 401 };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        clearTimeout(timer);
        if (res.status >= 500 && attempt < config.maxRetries) {
          logger.warn("Reintentando (error del servidor)", {
            url,
            attempt: attempt + 1,
            status: res.status,
          });
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        return { status: res.status, errorText: text };
      }
      const data = await res.json();
      clearTimeout(timer);
      return { status: 200, data };
    } catch (err) {
      clearTimeout(timer);
      if (attempt < config.maxRetries) {
        logger.warn("Reintentando (red/timeout)", {
          url,
          attempt: attempt + 1,
          error: err.message,
        });
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  return { status: 0, errorText: "sin respuesta" };
}

// Descarga TODAS las declaraciones del ente, pagina por pagina, con visibilidad
// (avisa cada pagina) y frenos de seguridad contra cuelgues y bucles.
export async function fetchDeclaraciones(ente, { since = null, onItems }) {
  const base = ente.baseUrl.replace(/\/$/, "") + ente.declaracionesPath;
  let token = await getToken(ente);
  let page = 1;
  let fetched = 0;
  let totalRows = null;
  let prevFirstId = null;
  let reauthed = false;

  const HARD_MAX_PAGES = 5000; // freno absoluto: jamas mas paginas que esto

  while (page <= HARD_MAX_PAGES) {
    const url = `${base}?${buildQueryString(ente, page, since)}`;
    logger.info("Solicitando pagina", { ente: ente.nombre, page });

    let r = await postPage(url, token);
    if (r.status === 401 && !reauthed) {
      logger.info("Token expirado, re-autenticando", {
        ente: ente.nombre,
        page,
      });
      token = await getToken(ente, { force: true });
      reauthed = true;
      r = await postPage(url, token);
    }
    if (r.status !== 200) {
      throw new Error(
        `Consulta fallida en "${ente.nombre}" pagina ${page}: HTTP ${r.status} ${(r.errorText || "").slice(0, 200)}`,
      );
    }

    const items = extractResults(r.data);
    if (totalRows == null) totalRows = extractTotal(r.data);

    // Si la pagina trae el mismo primer registro que la anterior, el servidor
    // esta ignorando ?page (no avanza). Cortamos para no dar vueltas en vano.
    const firstId = items[0]?.id ?? null;
    if (page > 1 && firstId != null && firstId === prevFirstId) {
      logger.warn(
        "La pagina no avanza (mismo primer registro); el servidor ignora ?page. Deteniendo.",
        {
          ente: ente.nombre,
          page,
          firstId,
        },
      );
      break;
    }
    prevFirstId = firstId;

    if (items.length === 0) break;

    fetched += items.length;
    await onItems(items);

    logger.info("Pagina recibida", {
      ente: ente.nombre,
      page,
      recibidas: items.length,
      acumuladas: fetched,
      total: totalRows ?? "?",
    });

    if (totalRows != null) {
      if (fetched >= totalRows) break;
    } else if (!extractHasNext(r.data, config.pageSize, fetched)) {
      break;
    }

    page += 1;
  }

  return { fetched, pages: page };
}
