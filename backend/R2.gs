/**
 * Enlaces firmados (AWS Signature V4, modo "query") para Cloudflare R2.
 * Las credenciales de R2 viven solo en Propiedades del script; nunca llegan al teléfono.
 *
 * Propiedades requeridas: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 */

function r2Credenciales_() {
  const p = PropertiesService.getScriptProperties();
  const c = {
    cuenta: p.getProperty('R2_ACCOUNT_ID'),
    bucket: p.getProperty('R2_BUCKET'),
    accessKey: p.getProperty('R2_ACCESS_KEY_ID'),
    secretKey: p.getProperty('R2_SECRET_ACCESS_KEY')
  };
  if (!c.cuenta || !c.bucket || !c.accessKey || !c.secretKey) {
    throw new Error('Faltan las credenciales de R2 en Propiedades del script.');
  }
  return c;
}

/** Codificación RFC 3986 que exige SigV4. */
function sigv4Codificar_(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

function bytesAHex_(bytes) {
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function sha256Hex_(texto) {
  return bytesAHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8));
}

function hmac_(llaveBytes, texto) {
  return Utilities.computeHmacSha256Signature(Utilities.newBlob(texto).getBytes(), llaveBytes);
}

/**
 * Genera una URL firmada.
 * @param {Object} o { cuenta, bucket, accessKey, secretKey, metodo, clave, expira (s), ahora (Date) }
 */
function r2UrlFirmada_(o) {
  const host = o.host || (o.cuenta + '.r2.cloudflarestorage.com');
  const ahora = o.ahora || new Date();
  const iso = ahora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // AAAAMMDDTHHMMSSZ
  const fecha = iso.slice(0, 8);
  const region = o.region || 'auto';
  const alcance = fecha + '/' + region + '/s3/aws4_request';
  const ruta = o.ruta || ('/' + o.bucket + '/' + o.clave.split('/').map(sigv4Codificar_).join('/'));

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': o.accessKey + '/' + alcance,
    'X-Amz-Date': iso,
    'X-Amz-Expires': String(o.expira || 900),
    'X-Amz-SignedHeaders': 'host'
  };
  const consulta = Object.keys(params).sort().map(function (k) {
    return sigv4Codificar_(k) + '=' + sigv4Codificar_(params[k]);
  }).join('&');

  const solicitudCanonica = [o.metodo, ruta, consulta, 'host:' + host, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const textoAFirmar = ['AWS4-HMAC-SHA256', iso, alcance, sha256Hex_(solicitudCanonica)].join('\n');

  let llave = hmac_(Utilities.newBlob('AWS4' + o.secretKey).getBytes(), fecha);
  llave = hmac_(llave, region);
  llave = hmac_(llave, 's3');
  llave = hmac_(llave, 'aws4_request');
  const firma = bytesAHex_(hmac_(llave, textoAFirmar));

  return 'https://' + host + ruta + '?' + consulta + '&X-Amz-Signature=' + firma;
}

/** Valida que la clave sea un objeto de la app: f/AAAA-MM/<uuid>.bin */
function r2ClaveValida_(clave) {
  return /^f\/\d{4}-\d{2}\/[0-9a-f-]{36}\.bin$/.test(String(clave));
}
