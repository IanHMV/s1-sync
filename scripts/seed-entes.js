import { assertConfig } from "../src/config.js";
import { connect, close, entesCol } from "../src/db.js";
import { encrypt } from "../src/crypto.js";
import { logger } from "../src/logger.js";

// =====================================================================
//  EDITA AQUI tus entes (en texto plano). Al correr el script, las
//  credenciales se guardan CIFRADAS en la base; este archivo NO debe
//  subirse a git con datos reales (dejalo como plantilla).
//
//  Correr con:  npm run seed:entes
// =====================================================================
const ENTES = [
  {
    nombre: "OSAFIG",
    activo: true,

    // URL base y ruta del endpoint de declaraciones (de tu Insomnia).
    baseUrl: "https://apisidepat.cuauhtemoc-col.gob.mx",
    declaracionesPath: "/api/auth/v2/declaraciones",

    // URL del login OAuth2.
    tokenUrl: "https://apisidepat.cuauhtemoc-col.gob.mx/api/auth/login",

    // Sincronizacion incremental: dejalo en false hasta CONFIRMAR que la API
    // del ente acepta filtrar por fecha. Si la acepta, pon true y ajusta
    // fechaParam al nombre real del parametro.
    incremental: false,
    fechaParam: "fechaActualizacion",

    auth: {
      authMode: "oauth", // 'oauth' (form-urlencoded) o 'json'
      username: "pdnuser_001", // se cifra
      password: "secret_pdnuser_001", // se cifra
      clientId: "1", // queda en claro (no es secreto)
      clientSecret:
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6IjQ5ZWE2ZTU5YzYzYmE1M2MwYjI2YmFiZWJlYzVhMTY5NTc0OTI3Zjg0ZDQ0MzdiNzg1YWFhNGU0YTU4NWI1Y2RlMWFkODliZmJlNGU5YjQ1In0.eyJhdWQiOiIxIiwianRpIjoiNDllYTZlNTljNjNiYTUzYzBiMjZiYWJlYmVjNWExNjk1NzQ5MjdmODRkNDQzN2I3ODVhYWE0ZTRhNTg1YjVjZGUxYWQ4OWJmYmU0ZTliNDUiLCJpYXQiOjE3ODA5Mzg0NjAsIm5iZiI6MTc4MDkzODQ2MCwiZXhwIjoxODEyNDc0NDYwLCJzdWIiOiIxIiwic2NvcGVzIjpbXX0.eDqysyp0V8dbQRN6UCJZq8gJLCF_wbFPGFQtlTUy2VtkmBgBM4c8zQk2murpZMclR3DhzFwGKLyqsuRLhkeMnZiUQ-LSjhT6gEKBZdxG0EXcAeo6ztLatsNEENzd9iFy2LapfdAcvHPgcE6FlibbF0jupAMF2qSUrOjxK32MS_1lpPfI_IrkVAPkWWx2OnngtJvievbnpBpV0SVhLW0CQxyZ-JLnPWqhdsQSyhNBaHxZ617rTwr8uurIPpOabJ5pdZo9QRPBlX3Oh_s6Z7s1Om9hECd2-zGx0l0YoaY_sBnDM4T02xB7ygXl8IKY-KLnTDdRz3ce4TeEvqwJmwph7kqGDzmuvXYKoVFLmR7PjZN0cMZuBbuyvtTbElSY46XYk4UX4m4TSjdHs68jvTg28CyUHuBG1j-gkdFRqoE3bMnW1xf9Z9vO84ObJVkxtsHW6JV3MEUZNdD0aV2ZVgHN1pz0-QWHWewsQmNzFyPYkmO5UvQWrKvcgMyf2-7hpCtLSV5YgRhZrjO1MQCl1h3V_sXL4ayT0-8T8-YCSyP5nQnip1pwaCwut4C72PCb4Fksr6tZAkllhZgLwe9FJBNRo5P-UKTjLXs15edRuLDGKD-Zm9jH_vQr5BVdmiqZ4a63dReIE0CbdH1nC5YnOuPp-FnxeEM_rURw2EVxTiphCqY", // se cifra
    },
  },

  // Agrega aqui los entes 2, 3, 4, 5... (y los que vengan despues).
];

async function seed() {
  assertConfig();
  await connect();

  for (const e of ENTES) {
    const doc = {
      nombre: e.nombre,
      activo: e.activo,
      baseUrl: e.baseUrl,
      declaracionesPath: e.declaracionesPath,
      tokenUrl: e.tokenUrl,
      incremental: !!e.incremental,
      fechaParam: e.fechaParam || "fechaActualizacion",
      auth: {
        authMode: e.auth.authMode || "oauth",
        clientId: e.auth.clientId,
        usernameEnc: encrypt(e.auth.username),
        passwordEnc: encrypt(e.auth.password),
        clientSecretEnc: encrypt(e.auth.clientSecret),
      },
      updatedAt: new Date(),
    };

    await entesCol().updateOne(
      { nombre: e.nombre },
      { $set: doc, $setOnInsert: { lastSyncAt: null, lastCursor: null } },
      { upsert: true },
    );
    logger.info("Ente guardado (credenciales cifradas)", { ente: e.nombre });
  }

  await close();
  logger.info("Catalogo de entes actualizado.");
  process.exit(0);
}

seed().catch((err) => {
  logger.error("Error al sembrar entes", { error: err.message });
  process.exit(1);
});
