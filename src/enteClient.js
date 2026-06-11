import { getToken } from "./oauth.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// === RESPUESTA DE LA API: { pagination: {...}, results: [...] } ===
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

// === CUERPO DE LA CONSULTA ===
// La paginacion (page/pageSize) va EN EL CUERPO, no en la URL.
// El objeto "query" debe traer los filtros que el servidor del ente espera,
// aunque vayan vacios; si falta alguno, su codigo truena con "Undefined index".
// Confirmado en pruebas con el ente OSAFIG: requiere "totalIngresosNetos".
// Si algun otro ente exigiera mas filtros, se pueden agregar por ente con
// ente.queryExtra (un objeto que se mezcla con este query base).
function buildBody(ente, page, since) {
  const query = { totalIngresosNetos: { min: "", max: "" } };
  if (ente.queryExtra && typeof ente.queryExtra === "object") {
    Object.assign(query, ente.queryExtra);
  }
  if (ente.incremental && since) {
    query[ente.fechaParam || "fechaActualizacion"] = since;
  }
  return { page, pageSize: config.pageSize, query };
}

// POST + lectura del JSON bajo un mismo limite de tiempo, con reintentos.
async function postPage(url, token, body) {
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "*/*",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
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
  const url = ente.baseUrl.replace(/\/$/, "") + ente.declaracionesPath;
  let token = await getToken(ente);
  let page = 1;
  let fetched = 0;
  let totalRows = null;
  let prevFirstId = null;
  let reauthed = false;

  const HARD_MAX_PAGES = 5000; // freno absoluto

  while (page <= HARD_MAX_PAGES) {
    const body = buildBody(ente, page, since);
    logger.info("Solicitando pagina", { ente: ente.nombre, page });

    let r = await postPage(url, token, body);
    if (r.status === 401 && !reauthed) {
      logger.info("Token expirado, re-autenticando", {
        ente: ente.nombre,
        page,
      });
      token = await getToken(ente, { force: true });
      reauthed = true;
      r = await postPage(url, token, body);
    }
    if (r.status !== 200) {
      throw new Error(
        `Consulta fallida en "${ente.nombre}" pagina ${page}: HTTP ${r.status} ${(r.errorText || "").slice(0, 200)}`,
      );
    }

    const items = extractResults(r.data);
    if (totalRows == null) totalRows = extractTotal(r.data);

    // Si la pagina trae el mismo primer registro que la anterior, el servidor
    // no esta avanzando. Cortamos para no dar vueltas en vano.
    const firstId = items[0]?.id ?? null;
    if (page > 1 && firstId != null && firstId === prevFirstId) {
      logger.warn("La pagina no avanza (mismo primer registro). Deteniendo.", {
        ente: ente.nombre,
        page,
        firstId,
      });
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
