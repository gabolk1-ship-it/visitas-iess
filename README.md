# Visitas IESS Cotocollao — Fase 1 (piloto)

Registro de visitas domiciliarias y entrega de medicamentos fuera del dispensario, con evidencia verificable,
funcionamiento sin conexión, alertas y hoja de seguimiento. Todo con servicios gratuitos.

**Para instalar:** siga `docs/GUIA-INSTALACION.md`.

## Estructura

```
backend/        Servidor en Google Apps Script (se pega en la hoja de cálculo)
  Codigo.gs       API v1: activar, config, agenda, farmacia_dia, sync, firmar, visor
  Hojas.gs        Pestañas, encabezados, lectura/escritura idempotente
  Reglas.gs       Antifraude, puntaje de confianza, validación de entregas, cuadre, reporte de controlados
  Notificar.gs    Alertas, Telegram (sin datos personales), correo, resumen diario
  R2.gs           Enlaces firmados (AWS SigV4) para Cloudflare R2
  Menu.gs         Menú de la hoja: códigos de activación, importar CSV de AS400, activadores, respaldo
app/            Aplicación web instalable (React + TypeScript + Vite)
  src/lib/        Cifrado, almacenamiento local, GPS, OCR, cola de sincronización, API
  src/pantallas/  Activación, agenda, retiro, visita, farmacia, visor de supervisión
  pruebas/        Pruebas automáticas (npm test) y recorrido completo en navegador
tools/          generar-llaves.html: crea las llaves de supervisión sin internet
docs/           Guía de instalación
.github/        Publicación automática en GitHub Pages
```

## Cómo se protege la evidencia

- **Foto solo en vivo:** la app captura del visor de la cámara; no existe opción de galería ni de subir archivos. Se bloquean computadoras y cámaras virtuales.
- **Sello y huella:** cada foto lleva fecha, hora, coordenadas y código de visita impresos, y su SHA-256 se registra para detectar reutilización.
- **GPS en vivo:** varias lecturas sin caché; el servidor marca lecturas idénticas, velocidad imposible, salida de geocerca, mismo punto para varios pacientes y reloj desfasado.
- **Cifrado de extremo a extremo de las fotos:** AES-256 por foto, llave envuelta con RSA-OAEP 3072 de supervisión. El teléfono no puede reabrirlas; Cloudflare y Apps Script solo ven datos cifrados. Se descifran en el navegador de supervisión con la frase secreta.
- **Datos locales cifrados** con una llave derivada del PIN; bloqueo por inactividad; borrado al enviar.
- **Entregas:** solo lo que está en la orden activa de AS400; lote y vencimiento leídos por OCR en farmacia y en el domicilio; bloqueo de vencidos y cantidades mayores; controlados solo a receptores autorizados; cuadre diario por lote.

## Pruebas

```
cd app
npm install
npm test
```

Incluye: cifrado y descifrado, lectura de lote y vencimiento, firma SigV4 comparada con el ejemplo oficial de AWS,
y un recorrido completo del servidor (activación, preparación, retiro, visitas, GPS simulado, foto reutilizada,
descuadre de controlados, reporte, visor e importación del CSV) sobre una hoja simulada.
