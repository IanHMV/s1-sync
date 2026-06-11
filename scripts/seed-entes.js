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
    baseUrl: "http://apisidepat.auditoriaenlineaosaf.mx",
    declaracionesPath: "/api/auth/v2/declaraciones",

    // URL del login OAuth2.
    tokenUrl: "http://apisidepat.auditoriaenlineaosaf.mx/api/auth/login",

    // Sincronizacion incremental: dejalo en false hasta CONFIRMAR que la API
    // del ente acepta filtrar por fecha. Si la acepta, pon true y ajusta
    // fechaParam al nombre real del parametro.
    incremental: false,
    fechaParam: "fechaActualizacion",

    auth: {
      authMode: "oauth", // 'oauth' (form-urlencoded) o 'json'
      username: "pdnuser_004", // se cifra
      password: "secret_pdnuser_004", // se cifra
      clientId: "4", // queda en claro (no es secreto)
      clientSecret:
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6IjcwNmZjNjM3YjUxNTQ1NTkwN2ZkNjkzMTJiNDA5YWJiOTZjMjUzNmU0YWM1NDQyZjBlOGRjODZhMTc0ZDI5ZThmNDdkNjM5YzU0YjhmM2M0In0.eyJhdWQiOiIxIiwianRpIjoiNzA2ZmM2MzdiNTE1NDU1OTA3ZmQ2OTMxMmI0MDlhYmI5NmMyNTM2ZTRhYzU0NDJmMGU4ZGM4NmExNzRkMjllOGY0N2Q2MzljNTRiOGYzYzQiLCJpYXQiOjE3NDg4ODU2NDMsIm5iZiI6MTc0ODg4NTY0MywiZXhwIjoxNzgwNDIxNjQzLCJzdWIiOiI0Iiwic2NvcGVzIjpbXX0.QFQy8DwjiBsu2x4wYuGc_CZFjBdBe5U-hw92OS8w9abWZIRN3R017oQpIrTq4Ff26TFrrxuHv8FbSgjljkPmQKqzCL3EJPE3hR3gtjJii3DM35W7hWKrrzeUILaBAOY4jt0tyJmLgqv7eguRobeQxrUxdZ-m5hrsfjKxzSQgrG5knO-lO-fsrND9WhSVnfUdQXwGAbEPv2wOaIyesQBzRKOe7W1dQNlrSUYNAgZ_XiWQqwqrL3Ygarp-7llgZQBvngKSk3Nc-CoQiQ8dKzQcgFAzIaMwCgJ7EzEblXQZyYf7NqotgfmJ1xT0gWttUAKrcE0NcxChZlBcDbll_EBXtlSt_jFY_pjocjUW9wXH3n8tpT5Nz-XUJQb7Hj8I3xFpwrAhHxv1tFImV0WM1Kq9yVXSopCgCR83RabjxOBGACxQu1eCZ5XY4L1FHD-VBk4BuCDG19Y-CpH9ZdlFne1MM1h1WqQxLhDujatJHGkiCaXi7ON1CfGM18r2AEMocOUEXTYgm_72A89EqgPCIIS2HtJNsB33mez1lCoobXXPbmZsjEXTyq9dt3V0Ink2XQjEUE7rYOQWxWjeihDVu9tplvQkHCokatZYAyX5jH8o0p-JNycY42LVVOBej2I7GDmFt-GuHsG3LCIsmZ9gR7TtxzjaLAhkSFPGTqdFL_7aVnc", // se cifra
    },
  },
  {
    nombre: "VDA",
    activo: true,

    // URL base y ruta del endpoint de declaraciones (de tu Insomnia).
    baseUrl: "https://dcapi.hvda.mx",
    declaracionesPath: "/api/auth/v2/declaraciones",

    // URL del login OAuth2.
    tokenUrl: "https://dcapi.hvda.mx/api/auth/login",

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
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6IjI4NWYxZWIxMGEwYzFlZWQ4OTEyZTNiM2ZiNDQyNGY5ZjViMGIxZmE0NWY2MTVkMGJmNTM5OGU3ZjI5ZjJkMTQwMDE1ODQ0MTE0YTRhY2RkIn0.eyJhdWQiOiIxIiwianRpIjoiMjg1ZjFlYjEwYTBjMWVlZDg5MTJlM2IzZmI0NDI0ZjlmNWIwYjFmYTQ1ZjYxNWQwYmY1Mzk4ZTdmMjlmMmQxNDAwMTU4NDQxMTRhNGFjZGQiLCJpYXQiOjE3ODA1OTc3OTUsIm5iZiI6MTc4MDU5Nzc5NSwiZXhwIjoxODEyMTMzNzk1LCJzdWIiOiIxIiwic2NvcGVzIjpbXX0.ClQ0SngUBgCsXbHc7eUg7OXpZaSSZotl7pM-EyfRb1EXOfHYAkY5YxdEYepbL7Td5baj9WeVYCuEyMu8-RGWuieE8zHM5axgWzuqPd-baF1zYXqNcAF5fqYhtqHzIuqfSdufPXbgXEUlPHuEyIhm5MTQ3bUcGMQ5o-ap2mQb7MPStdZnzua8m2hCayr1qFrIz04DVfUk7AzpN2hT1wQPr8FFX5JdPNGAhmzZMw-pPLCMiZjCaVzy_OYVFZNFSDHR6Z-ud_6-ZNIwpxfYDnqE4QmHxBNoL2Dgfc5GnPIS_ZTnBIG1uC7dDdo_aqrDckyEKhkD_AuFSvDhrqHnG2dPL9-S6s4QBq4QhQ4UgCmY_1fRsI28GhyFbkTaHqUEj-P_nOLP8cw0S5kmLxTXVNxtAzGBrD_48CBcSwB5RLoAeIKA4akc_atHlMCCaTET6vDGfaLfYvBUDKHwu1qYlKGXIBTm9SzFM6oGljoMFuCo76eaOe9mfmghTp7MHCv8xetxL2o_noeZjPtnPRM2iSxt0mAxFCVzSuoHitYA9V-BXwtiyijhutjeUpOT0n5QkRgGQNL50rb9B-K_XngIdSwPDk8kTy5wIEeNpmVgtrjmyBwLbfnQAxyjWxzS2KdxuqjIJiqWFVoSV-tkwlfk1IxOZya8DePcNqNvEOd5yJh6dfM", // se cifra
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
