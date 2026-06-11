// Convierte un item tal como lo entrega la API del ente al documento que
// guardamos en s1-api.declaraciones.
//
// El estandar PDN es el mismo de los dos lados, asi que esto es casi un
// passthrough. Lo unico importante:
//   - Conservamos id, metadata y declaracion (la forma que tu s1-api lee).
//   - Quitamos cualquier _id que venga del origen: el _id lo asigna TU Mongo.
//   - NO agregamos campos extra al documento, para no arriesgar que tu s1-api
//     (solo lectura, no lo controlamos) tropiece con campos desconocidos.
export function toStoredDoc(item) {
  const { _id, ...rest } = item || {};
  return {
    id: rest.id,
    metadata: rest.metadata,
    declaracion: rest.declaracion,
  };
}

// Saca la fecha de actualizacion para el cursor incremental (si aplica).
export function getActualizacion(item) {
  return item?.metadata?.actualizacion || null;
}
