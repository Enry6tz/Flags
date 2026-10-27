# Integrar Flags con un backend existente

Esta guía permite conectar `@e6tz/flags` 0.1.1 con un servidor propio. El SDK consume una proyección booleana; no crea un servidor, tablas, cuentas ni un panel de administración.

[Documentación en el sitio](https://flags.6tz.tech/docs/) · [Referencia de API](../README.md#referencia-de-api) · [npm](https://www.npmjs.com/package/@e6tz/flags)

## Ruta mínima

1. Defina un fallback booleano por cada flag utilizado en la interfaz.
2. Implemente un endpoint `GET` que seleccione y autorice el contexto en el servidor.
3. Devuelva el contrato HTTP descrito abajo, con vigencia calculada en cada respuesta.
4. Habilite la integración en la configuración de la aplicación y llame a `load()` explícitamente.
5. Compruebe expiración, fallos y cambios de sesión antes de habilitarla en producción.

```sh
npm install @e6tz/flags
```

Requiere Node.js 20.9 o posterior. React es opcional; sus adaptadores requieren React 18.3 o 19.

```ts
import { createFlagsClient, createHttpFlagsProvider } from "@e6tz/flags";

type HostConfig = { enabled: boolean; endpoint: string };
const integration: HostConfig = { enabled: false, endpoint: "/api/flags" };
const flags = integration.enabled
  ? createFlagsClient({ provider: createHttpFlagsProvider({ endpoint: integration.endpoint }) })
  : null;

// The host explicitly enables and loads its integration.
if (flags) await flags.load();
const showNewCheckout = flags?.getBooleanValue("new-checkout", false) ?? false;

// When this host context ends:
flags?.dispose();
```

`/api/flags` es una ruta de ejemplo que debe implementar. El ejemplo queda desactivado por defecto. Importar, construir, evaluar, suscribirse o montar los hooks no carga datos.

## Contrato del endpoint

El proveedor HTTP realiza `GET` a una URL HTTP(S) absoluta o una ruta relativa. Rechaza URLs con credenciales, fragmentos y rutas que empiezan con `//`. Usa `Accept: application/json`, `credentials: "omit"`, `cache: "no-store"` y `redirect: "error"`.

El servidor responde con `Content-Type: application/json` y este envelope:

```ts
const response = {
  data: {
    revision: "project-7.production:18",
    validUntil: new Date(Date.now() + 30_000).toISOString(),
    flags: [{ key: "new-checkout", value: true }],
  },
};
```

Calcule `validUntil` al responder, nunca durante una compilación o una migración. La fecha debe ser ISO 8601 UTC con `Z`, futura y a un máximo de 60 segundos del reloj del cliente. Mantenga sincronizados los relojes y reserve margen para latencia; 30 segundos es un ejemplo, no un valor obligatorio.

| Campo o límite | Contrato de 0.1.1 |
| --- | --- |
| `revision` | Entre 1 y 128 caracteres ASCII: letras, números, punto, guion, guion bajo o dos puntos. |
| `validUntil` | Fecha UTC con segundos y, opcionalmente, de 1 a 3 dígitos de milisegundos. |
| `flags` | Hasta 64 entradas con claves únicas y valores booleanos reales, no `"true"`, `1` o `null`. |
| `key` | Entre 1 y 64 caracteres; empieza con letra ASCII y continúa con letras ASCII, números, `_`, `.` o `-`. |
| Cuerpo HTTP | Hasta 64 KiB de JSON UTF-8. |
| Timeout del cliente | 10 segundos por defecto; configurable entre 1 y 60.000 ms. |

No incluya secretos ni reglas administrativas en la respuesta. El cliente descarta campos adicionales. Proyecto y entorno no son campos nuevos del contrato: el servidor los resuelve a partir del contexto autorizado.

## Identidad, permisos y cookies

La aplicación anfitriona implementa autenticación y autorización. Antes de leer flags, derive la identidad de una sesión o credencial verificada y compruebe el acceso al proyecto y entorno. Un identificador recibido del navegador es una solicitud, no una prueba de permiso. Para flags públicos, defina explícitamente qué proyección puede recibir una solicitud anónima.

**El adaptador predeterminado omite las cookies incluso en `/api/flags` del mismo origen.** Una ruta relativa no hereda automáticamente la sesión.

Si su aplicación usa cabeceras, configure `headers` con las credenciales de alcance limitado que emite y renueva su propia aplicación. No coloque tokens administrativos ni secretos de larga duración en el bundle. El callback de cabeceras admite `{signal}` y puede ser asíncrono.

Si ya tiene una sesión por cookies del mismo origen, puede proporcionar este adaptador explícito:

```ts
const provider = createHttpFlagsProvider({
  endpoint: "/api/flags",
  fetch: (url, init) => {
    const target = new URL(url, window.location.origin);
    if (target.origin !== window.location.origin || target.pathname !== "/api/flags") {
      throw new Error("Unexpected flags endpoint");
    }
    return window.fetch(target, { ...init, credentials: "same-origin" });
  },
});
```

Este código pertenece al cliente del navegador, no a un módulo ejecutado durante SSR. Limite siempre el destino que recibe las credenciales. Conserve los controles del servidor y su política de cookies, origen y CORS. Proteja contra CSRF las operaciones de escritura de su administración; CORS, CSRF y un control oculto no sustituyen la autorización.

Los flags controlan presentación o comportamiento del cliente, **no son una barrera de seguridad**. Una operación protegida debe comprobar permisos en el servidor aunque el flag oculte su botón.

## Implementación del servidor

El siguiente pseudocódigo muestra el orden de responsabilidades. `authenticate`, `authorize`, `selectFlags` y `json` son funciones de la aplicación, no exports de Flags.

```text
GET /api/flags
  identity = authenticate(request)        // or an explicitly allowed public policy
  context = resolveHostContext(request, identity)
  authorize(identity, context.project, context.environment, "flags:read")
  projection = selectFlags(context)       // coherent authorized data + revision
  validateKeysBooleansAndLimits(projection.flags)
  return json(200, {
    data: {
      revision: projection.revision,
      validUntil: utcNowPlusSeconds(30),
      flags: projection.flags
    }
  }, { "Cache-Control": "no-store" })
```

Si hay más de 64 flags, defina una proyección autorizada para esa interfaz; el SDK no pagina. Lea valores y revisión de forma coherente para no publicar una revisión con datos de otra actualización. No genere `revision` a partir de información secreta.

### Modelo de datos de referencia

Estas entidades son una posible implementación, **no tablas exigidas por el paquete**:

| Entidad propia | Datos sugeridos | Invariante |
| --- | --- | --- |
| Proyecto y entorno | Referencias a los registros existentes de la aplicación. | La identidad tiene permiso para leer ese contexto. |
| Valor de flag | Proyecto, entorno, clave, booleano, fecha de actualización. | Unicidad de `(project, environment, key)` y clave válida. |
| Revisión de proyección | Proyecto, entorno y revisión pública opaca. | Cambia de forma coherente cuando cambia la proyección. |

Puede usar SQL, un almacén de documentos o configuración del servidor. No necesita crear otro sistema de usuarios. El panel para crear, editar o eliminar flags y sus endpoints de escritura pertenecen a su backend; el SDK únicamente consume la proyección de lectura. Proteja y pruebe esas escrituras por separado.

### Ubicación en Next.js o NestJS

En Next.js App Router, el `GET` puede vivir en `app/api/flags/route.ts`. En NestJS, puede implementarse como una acción `@Get()` de un controlador y delegar la lectura a un servicio. Mantenga validación, autorización y acceso al almacenamiento fuera del componente visual.

Son ubicaciones de adaptación, no módulos incluidos ni comandos instalables. Use la sesión, los permisos y el acceso a datos que ya tiene su aplicación.

## Proveedor propio y almacenamiento local

También puede inyectar un `FlagsProvider`. Devuelve `{revision, validUntil, flags}` directamente, **sin** `{data: ...}`. El envelope sólo pertenece al adaptador HTTP.

```ts
import { createFlagsClient, type FlagsProvider } from "@e6tz/flags";

const provider: FlagsProvider = async ({ signal }) => {
  if (signal.aborted) throw new Error("Request aborted");
  // The host supplies this reader; it is not an SDK export.
  return hostReadProjection();
};
const flags = createFlagsClient({ provider });
// Call load() only after the host enables this integration.
```

Un proveedor basado en `localStorage` sirve como demostración por navegador. Sus datos son modificables por la persona, no se comparten entre dispositivos y pueden perderse o agotar la cuota. No es una fuente de permisos ni una base de datos del servidor. No acceda a `window` o `localStorage` durante SSR.

Para pasar a un backend real, sustituya esa lectura por su proveedor HTTP y conserve la misma proyección, fallbacks y ciclo de vida. No cambie las tres bibliotecas ni replique su lógica de evaluación en el servidor. La persistencia de los cambios administrativos sí necesita una implementación real.

## Ciclo de vida y recuperación

| Acción o situación | Comportamiento |
| --- | --- |
| `load()` | Usa una proyección vigente o consulta el proveedor si no existe. |
| `refresh()` | Solicita una nueva proyección; mientras carga, se usa el fallback. |
| Solicitudes concurrentes de una instancia | Comparten la solicitud en curso. |
| Expiración | Se descartan valores vencidos y se usa el fallback. El temporizador notifica, no hace polling. |
| Timeout, red o formato inválido | Snapshot `unavailable`; no se aplica una proyección vencida. |
| HTTP `429` | `errorCode: RATE_LIMITED`; no hay reintento automático. |
| Otros HTTP no exitosos, incluidos `401` y `403` | `errorCode: REMOTE_UNAVAILABLE`; no se abre un login. |
| Clave ausente | Fallback con motivo `UNKNOWN_KEY` cuando la proyección es válida. |
| `abort()` | Cancela, limpia valores y vuelve a `idle`; permite cargar de nuevo. |
| `dispose()` | Cancela y desconecta definitivamente esa instancia. |

Use `getSnapshot().errorCode` y `getBooleanDetails(key, fallback)` para informar el estado. La aplicación decide cuándo resolver el fallo y llamar a `refresh()`. Descarte la instancia al cerrar sesión o cambiar de identidad, proyecto o entorno. Cree otra para el nuevo contexto; no reutilice valores del contexto anterior. Los hooks React no cargan datos por sí solos y usan el fallback durante SSR.

## Comprobar la integración

Con el servidor propio en ejecución, una credencial de prueba autorizada y una URL local elegida por usted:

```sh
curl --fail-with-body -i \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $FLAGS_TEST_TOKEN" \
  http://localhost:3000/api/flags
```

La cabecera de autorización es un ejemplo de su aplicación, no un mecanismo emitido por Flags. No publique credenciales ni copie una fecha fija en la respuesta. Si usa cookies, pruebe el adaptador de sesión explícito en el navegador además del contrato HTTP.

- [ ] Importar, construir, evaluar y montar hooks no inicia solicitudes.
- [ ] Antes de cargar, sin conexión y después de vencer, cada evaluación usa su fallback.
- [ ] Una respuesta válida respeta claves, booleanos, unicidad, vigencia, revisión y límites.
- [ ] Una respuesta vencida, demasiado grande o con formato inválido no activa flags.
- [ ] Una identidad sin permiso no obtiene proyecciones de otro proyecto o entorno.
- [ ] `401`, `403`, `429`, fallo de red y timeout se muestran sin login ni reintento automáticos.
- [ ] Cambiar de sesión o contexto descarta el cliente anterior; las respuestas tardías no se aplican.
- [ ] Las operaciones protegidas del servidor siguen verificando permisos aunque el cliente cambie el flag.
- [ ] Los cambios del panel administrativo se guardan y se reflejan sólo tras una carga explícita posterior.

## Fuentes y siguientes pasos

El contrato de esta guía corresponde a la versión 0.1.1: [tipos y límites](../src/contracts.ts), [validación](../src/validation.ts) y [adaptador HTTP](../src/http.ts). Para el montaje React, consulte el [README](../README.md#usar-react-o-nextjs).

Las interfaces de [Reports](https://reports.6tz.tech/docs/) y [Toolkit](https://github.com/Enry6tz/Toolkit/blob/main/docs/host-integration.md) tienen contratos distintos. No comparten automáticamente credenciales ni endpoints con Flags.
