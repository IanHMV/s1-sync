import { z } from 'zod';

// Validacion ESTRUCTURAL ligera, no exhaustiva.
// Como tu s1-api es de solo lectura, nadie valida despues de nosotros: por eso
// verificamos que el documento traiga la forma minima que tu API espera leer
// (id + metadata + declaracion.situacionPatrimonial). El resto pasa tal cual.
//
// NOTA: si en el futuro quieres validacion completa contra el estandar oficial
// del S1, puedes cargar el JSON Schema publicado por la SESNA y validar con ajv.
// Aqui priorizamos algo robusto y mantenible para los 5 entes actuales.
const envelopeSchema = z.object({
  id: z.string().min(1, 'falta el campo "id" (clave de upsert)'),
  metadata: z.object({
    actualizacion: z.string().optional(),
    institucion: z.string().optional(),
    tipo: z.string().optional(),
  }).passthrough(),
  declaracion: z.object({
    situacionPatrimonial: z.unknown().refine((v) => v != null, 'falta declaracion.situacionPatrimonial'),
  }).passthrough(),
}).passthrough();

export function validateEnvelope(doc) {
  const result = envelopeSchema.safeParse(doc);
  if (result.success) return { ok: true };
  const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  return { ok: false, errors };
}
