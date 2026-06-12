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
// La paginacion (page/pageSize) va EN EL CUERPO. El objeto "query" debe traer
// los filtros que el servidor del ente espera, aunque vayan vacios; si falta
// alguno, su codigo truena. Confirmado: requiere "totalIngresosNetos".
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

// Descarga las declaraciones del ente, pagina por pagina.
// RESILIENTE: si el servidor del ente falla en una pagina (p.ej. su SQL esta
// rota para ciertos registros), esa pagina se ANOTA y se SALTA; no tumba la
// sincronizacion ni pierde lo ya descargado.
export async function fetchDeclaraciones(ente, { since = null, onItems }) {
  const url = ente.baseUrl.replace(/\/$/, "") + ente.declaracionesPath;
  let token = await getToken(ente);
  let page = 1;
  let fetched = 0;
  let totalRows = null;
  let expectedPages = null;
  let prevFirstId = null;
  let reauthed = false;
  let consecutiveFailures = 0;
  let stoppedEarly = false;
  const failedPages = [];

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

    // Pagina con error del servidor del ente: anotar, saltar y seguir.
    if (r.status !== 200) {
      failedPages.push(page);
      consecutiveFailures += 1;
      logger.warn(
        "Pagina con error en el servidor del ente; se omite y se continua",
        {
          ente: ente.nombre,
          page,
          status: r.status,
          detalle: (r.errorText || "").slice(0, 160),
        },
      );
      // Corta-circuitos: si fallan demasiadas paginas seguidas, es falla
      // sistematica del ente; dejamos de insistir para no perder tiempo.
      if (consecutiveFailures >= config.maxConsecutiveFailures) {
        stoppedEarly = true;
        logger.error(
          "Demasiadas paginas seguidas con error; se detiene este ente.",
          {
            ente: ente.nombre,
            fallasSeguidas: consecutiveFailures,
            ultimaPagina: page,
            paginasAprox: expectedPages ?? "?",
          },
        );
        break;
      }
      if (expectedPages != null && page >= expectedPages) break;
      page += 1;
      continue;
    }
    consecutiveFailures = 0;

    const items = extractResults(r.data);
    if (totalRows == null) {
      totalRows = extractTotal(r.data);
      if (totalRows != null)
        expectedPages = Math.ceil(totalRows / config.pageSize);
    }

    // Si la pagina trae el mismo primer registro que la anterior, no avanza.
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

    if (expectedPages != null) {
      if (page >= expectedPages) break;
    } else if (!extractHasNext(r.data, config.pageSize, fetched)) {
      break;
    }

    page += 1;
  }

  if (failedPages.length) {
    logger.warn(
      "Resumen de paginas omitidas por errores del servidor del ente",
      {
        ente: ente.nombre,
        total: failedPages.length,
        paginas: failedPages.slice(0, 50),
      },
    );
  }

  return { fetched, failedPages, stoppedEarly };
}
