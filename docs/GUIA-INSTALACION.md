# Guía de instalación — Visitas IESS Cotocollao (Fase 1, piloto)

Esta guía la sigue usted o TI, paso a paso, con las cuentas institucionales. Ningún paso requiere pagar.
Tiempo estimado: 2 a 3 horas la primera vez.

**Lo que va a quedar funcionando**

| Pieza | Dónde vive | Qué guarda |
| --- | --- | --- |
| Hoja de cálculo + Apps Script | Google Workspace del IESS | Visitas, entregas, alertas, órdenes (todos los datos) |
| Fotos cifradas | Cloudflare R2 (gratis hasta 10 GB) | Solo archivos cifrados; Cloudflare no puede abrirlos |
| App (PWA) | GitHub Pages o un servidor web del IESS | Solo el código de la app, sin datos |
| Avisos | Telegram + correo institucional | Telegram recibe avisos sin datos personales |

Antes de empezar, tenga a mano: una cuenta institucional de Google Workspace, una computadora con Chrome
y, para publicar la app, una cuenta de GitHub (o un servidor web del IESS).

---

## Paso 1. Crear la hoja de cálculo y el servidor (Apps Script)

1. En Google Drive institucional, cree una hoja de cálculo nueva llamada **Visitas IESS Cotocollao**.
2. En la hoja: **Extensiones → Apps Script**. Se abre el editor.
3. En el editor, borre el contenido de `Código.gs` y cámbiele el nombre a `Codigo`.
4. Cree cinco archivos más con el botón **+ → Secuencia de comandos**: `Hojas`, `Reglas`, `Notificar`, `R2`, `Menu`.
   Copie en cada uno el contenido del archivo del mismo nombre de la carpeta `backend/`.
5. **Configuración del proyecto** (ícono de engranaje) → marque **Mostrar el archivo de manifiesto "appsscript.json"**.
   Vuelva al editor, abra `appsscript.json` y reemplace su contenido por el de `backend/appsscript.json`.
6. Guarde (Ctrl + S). Vuelva a la hoja y recárguela: aparece el menú **Visitas IESS**.
7. **Visitas IESS → 1. Configurar hojas**. Google pedirá autorización: acéptela con la cuenta institucional.
   Se crean las pestañas: Config, Usuarios, Dispositivos, Pacientes, Cuidadores, Agenda, Ordenes, Bolsas,
   Preparaciones, Movimientos, Visitas, Eventos, Entregas, Actas, Alertas, Llamadas, Auditoria, Importar_Ordenes.

## Paso 2. Cloudflare R2 (fotos cifradas)

1. Cree una cuenta en cloudflare.com con el correo institucional y active la verificación en dos pasos.
2. En el panel: **R2 Object Storage → Crear bucket**.
   - Nombre: `visitas-iess-fotos`
   - Ubicación: **Sugerencia de ubicación → Norteamérica este (ENAM)**, la más cercana a Ecuador.
   - Cloudflare puede pedir registrar un medio de pago para activar R2, aunque el plan gratuito no cobre. Verifíquelo al crear la cuenta.
3. En el bucket → **Configuración → Política CORS → Agregar**, pegue (cambie la dirección por la de su app, Paso 6):
   ```json
   [{ "AllowedOrigins": ["https://SU-USUARIO.github.io"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3600 }]
   ```
4. **R2 → Administrar tokens de API de R2 → Crear token**: permiso **Lectura y escritura de objetos**, solo para el bucket `visitas-iess-fotos`.
   Anote el **Access Key ID**, el **Secret Access Key** y el **Account ID** (este último aparece en la página de R2).
5. Cuando jurídica defina el plazo de conservación: bucket → **Configuración → Reglas de ciclo de vida** → borrar objetos después de N días.

## Paso 3. Bot de Telegram (avisos sin datos personales)

1. En Telegram, abra el chat con BotFather, envíe `/newbot` y siga las instrucciones. Anote el **token**.
2. Cree un grupo para supervisión, agregue el bot y escriba cualquier mensaje en el grupo.
3. En el navegador abra `https://api.telegram.org/botTOKEN/getUpdates` (reemplace TOKEN). Anote el número `"chat":{"id": …}` (empieza con `-`).

## Paso 4. Guardar las credenciales en Apps Script

En el editor de Apps Script → **Configuración del proyecto → Propiedades del script → Agregar propiedad**:

| Propiedad | Valor |
| --- | --- |
| `R2_ACCOUNT_ID` | Account ID de Cloudflare |
| `R2_BUCKET` | `visitas-iess-fotos` |
| `R2_ACCESS_KEY_ID` | Access Key ID del token R2 |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key del token R2 |
| `TELEGRAM_TOKEN` | Token del bot |
| `TELEGRAM_CHAT_ID` | Número del grupo |

Estas credenciales nunca están en la hoja ni en los teléfonos.

## Paso 5. Llaves de supervisión (para ver las fotos)

1. En una computadora, abra el archivo `tools/generar-llaves.html` con Chrome (doble clic). Funciona sin internet.
2. Escriba una **frase secreta** de al menos 12 caracteres y guárdela en un lugar seguro. **Sin esa frase nadie podrá ver las fotos.**
3. Pulse **Generar llaves** y copie:
   - el primer texto en la pestaña **Config**, fila `LLAVE_PUBLICA`, columna `valor`;
   - el segundo texto en la fila `LLAVE_PRIVADA_CIFRADA`.
4. En **Config**, escriba en `CORREO_ALERTAS` los correos institucionales que recibirán alertas (separados por coma).
   Revise los demás umbrales (geocerca, duración mínima, horario) y ajústelos si hace falta.

## Paso 6. Publicar el servidor y la app

**Servidor (Apps Script):**
1. En el editor: **Implementar → Nueva implementación → tipo: Aplicación web**.
2. Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier usuario**.
   Si su dominio no permite esa opción, TI debe habilitar la publicación de aplicaciones web para esta cuenta.
3. Copie la **URL de la aplicación web** (termina en `/exec`).
4. En la hoja: **Visitas IESS → 2. Instalar activadores** (alertas cada 15 min, cuadre a las 21:00, respaldo a las 23:00).

**App, opción A: GitHub Pages (gratis)**
1. Cree un repositorio en GitHub, por ejemplo `visitas-iess`, y suba todo el contenido de esta carpeta.
   El repositorio puede ser público porque el código no contiene datos ni credenciales.
   GitHub Pages en repositorios privados requiere un plan de pago.
2. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables → New repository variable**: nombre `API_URL`, valor la URL `/exec`.
4. Suba un cambio o use **Actions → Publicar app → Run workflow**. La app queda en `https://SU-USUARIO.github.io/visitas-iess/`.
5. Use esa dirección en la política CORS de R2 (Paso 2.3), solo con `https://SU-USUARIO.github.io` (sin la ruta).

**App, opción B: servidor web del IESS**
En una computadora con Node.js 20 o superior, dentro de la carpeta `app/`:
```
npm install
set VITE_API_URL=https://script.google.com/macros/s/…/exec      (en Mac/Linux: export VITE_API_URL=…)
npm run build
```
Copie el contenido de `app/dist/` al servidor web (debe ser HTTPS; sin HTTPS la cámara y el GPS no funcionan).

## Paso 7. Cargar datos del piloto

| Pestaña | Qué llenar | Nota |
| --- | --- | --- |
| Usuarios | `id` (M1, F1, S1…), `nombre`, `correo`, `rol` (medico, farmacia, supervisor, admin), `activo` = SI | |
| Pacientes | `id`, `codigo_afiliado` (como viene en AS400), `nombre`, `sector`, `direccion`, `lat`/`lon` si se conocen, `qr_codigo` | Si no hay coordenadas, se registran en la primera visita |
| Cuidadores | `id`, `paciente_id`, `nombre`, `cedula`, `parentesco`, `autorizado_controlados` = SI/NO | Solo los autorizados pueden recibir controlados |
| Agenda | `id`, `fecha` (AAAA-MM-DD), `medico_id`, `paciente_id`, `ventana` (mañana/tarde) | |

**Órdenes de AS400 (CSV):**
1. Abra la pestaña **Importar_Ordenes** → **Archivo → Importar → Subir** el CSV → **Reemplazar hoja actual**.
2. **Visitas IESS → Procesar órdenes importadas**. Si el CSV usa otros nombres de columna, ajústelos en Config (`CSV_ORDEN`, `CSV_AFILIADO`, `CSV_MED_CODIGO`, `CSV_MED_NOMBRE`, `CSV_CANTIDAD`, `CSV_DESDE`, `CSV_HASTA`, `CSV_CONTROLADO`, `CSV_RECETA`). El mensaje de error lista las columnas que encontró.
3. Repetirlo cada día no duplica órdenes.

**Tarjetas QR del afiliado:** en `qr_codigo` ponga un código aleatorio por paciente (por ejemplo `=CONCATENAR("IESS-";ALEATORIO.ENTRE(100000;999999))`, luego copie y pegue como valores para fijarlo). Imprima el QR con cualquier generador y entréguelo con el aviso de privacidad. El código no contiene datos del paciente.

## Paso 8. Activar los teléfonos

1. En **Usuarios**, seleccione la fila de la persona → **Visitas IESS → Generar código de activación**. Entregue el código en persona; se usa una sola vez.
2. La persona abre la dirección de la app:
   - Android: en **Chrome** → menú ⋮ → **Instalar app** (o **Agregar a pantalla principal**).
   - iPhone: en **Safari** → botón Compartir → **Agregar a inicio**. En iPhone es obligatorio instalarla para que no se borren los datos.
3. Abre la app instalada, escribe el código, crea su PIN de 6 números y acepta el acuerdo de uso.
4. La primera vez, con wifi, la app descarga el lector de lote (unos 11 MB). Después funciona sin señal.
5. Si un teléfono se pierde: seleccione al usuario → **Desactivar teléfonos del usuario seleccionado**.

## Uso diario

1. **Farmacia** (mañana): elige médico y fecha → prepara una bolsa por paciente: foto de cada caja (la app lee lote y vencimiento), receta especial si es controlado, foto de la bolsa.
2. **Médico**: abre la agenda → **Retirar maletín** (revisa y firma) → en cada domicilio: QR, ubicación, foto suya, foto del lugar, quién recibe, foto de cada caja, firma, foto de la entrega, ubicación y foto de cierre.
3. **Farmacia** (tarde): pestaña **Devoluciones**, cuenta lo que vuelve sin ver lo entregado.
4. **Supervisión**: revisa la pestaña **Alertas** (cambia el estado y escribe la justificación), la pestaña **Llamadas** (verificación telefónica al azar) y el **Visor** de la app para ver fotos.
5. **Controlados**: **Visitas IESS → Reporte de controlados** genera ingresos, egresos y saldos para el registro de farmacia.

## Verificar que todo funciona

1. Abra la URL `/exec` en el navegador: debe responder `{"ok":true,"servicio":"visitas-iess",…}`.
2. Active un teléfono de prueba con un usuario médico ficticio, haga una visita completa en su oficina y revise:
   Visitas (estado realizada), Eventos, Entregas, Actas; y en el Visor, que las fotos se vean.
3. Para desarrolladores: en `app/`, `npm test` ejecuta las pruebas automáticas (cifrado, lectura de lote, firma de enlaces R2 y un recorrido completo del servidor con una hoja simulada).

## Límites conocidos de esta versión

- En iPhone los datos se envían al abrir la app (Safari no envía con la app cerrada). La barra inferior muestra lo pendiente.
- En web no se puede bloquear una app de GPS falso; se detecta por patrones (lecturas idénticas, velocidad imposible, geocerca) y baja el puntaje. La app nativa de Fase 2 sí la detecta.
- La lectura automática de lote depende de la calidad de la impresión; siempre se confirma a mano.
- Guardar fotos cifradas en Cloudflare es una transferencia internacional: requiere aprobación de jurídica antes del piloto.
