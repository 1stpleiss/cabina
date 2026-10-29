// Comprobación de la firma propia de Cabina (Ed25519). La llave privada está solo en el Mac de quien publica
// (ver herramientas/firmar.mjs); aquí va la pública. Con ella la app solo carga la web firmada (web-segura.js)
// y solo instala actualizaciones firmadas (updater.js): aunque alguien entrara en la cuenta de GitHub, no
// podría colar nada. Si algún día cambia la llave, hay que publicar una app nueva y reinstalarla a mano.
const crypto = require('crypto');

const PUBLICA = 'Ma1gzT0Gbizc7qVGhh9h-uE8cBElCqeV2XeC3d6rzYA';
const llave = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: PUBLICA }, format: 'jwk' });

const valida = (datos, firma) => {
  try { return typeof firma === 'string' && crypto.verify(null, Buffer.from(datos), llave, Buffer.from(firma.trim(), 'base64url')); }
  catch { return false; }
};
const huella = (buf, alg = 'sha256') => crypto.createHash(alg).update(buf).digest('base64');

module.exports = { valida, huella };
