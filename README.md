# Flags

Consulta flags booleanos desde un proveedor configurable, con fallback obligatorio en cada evaluación.
Este paquete tiene su propia versión e instalación. El núcleo funciona sin React ni otros productos.

## Integrar en una aplicación anfitriona

Flags, Reports y Toolkit son bibliotecas para integrar en una aplicación existente.
No incluyen una aplicación alojada, cuentas de usuario ni un servidor de administración.
Comparten el modelo de integración explícita, no una API idéntica.

| Responsabilidad | Aplicación anfitriona | Flags |
| --- | --- | --- |
| Activación | Mantener la integración remota desactivada por defecto y habilitarla explícitamente. | No iniciar solicitudes al importar, construir el cliente o montar los hooks. |
| Identidad y permisos | Implementar login, autenticación, autorización y gestión de secretos en el servidor. | No crear credenciales ni iniciar sesiones. |
| Configuración | Seleccionar proyecto, entorno, proveedor, endpoint y flags autorizados. | Validar las proyecciones recibidas y exigir un fallback en cada evaluación. |
| Ciclo de vida | Elegir cuándo cargar, refrescar y descartar cada cliente. | Aplicar timeout, vencimiento y cancelación; descartar respuestas tardías. |

Para integrar Flags:

1. Define el fallback local de cada flag antes de habilitar el acceso remoto.
2. Implementa el endpoint o proveedor en tu aplicación; consulta el [contrato HTTP](#contrato-http).
3. Autoriza el proyecto y entorno en el servidor antes de seleccionar los flags de la respuesta.
4. Configura el proveedor y llama a `load()` solo cuando la integración esté habilitada.
5. Al cerrar sesión o cambiar de usuario, proyecto o entorno, descarta el cliente anterior con `dispose()`.

El interruptor de activación pertenece a la aplicación anfitriona; no es una opción del paquete.
Sin integración remota, la aplicación conserva sus fallbacks locales.
Un cliente configurado permanece en `idle` hasta una carga explícita.
Importar Flags, consultar valores, suscribirse o montar sus hooks no inicia login, solicitudes ni polling.
El temporizador de vencimiento tampoco refresca datos.

## Instalar y conectar

Instala el paquete público desde npm con Node.js 20.9 o posterior:

```sh
npm install @e6tz/flags
```

También puedes instalar las fuentes del repositorio independiente con Git disponible:

```sh
npm install github:Enry6tz/Flags#main
```

La instalación desde GitHub compila las fuentes con `prepare`. El paquete instalado conserva el nombre `@e6tz/flags` y los imports que aparecen en esta documentación.

También podés instalar el archivo de la versión entregada o generado con `npm pack`:

```sh
npm install ./e6tz-flags-0.1.1.tgz
```

Configura explícitamente un proveedor compatible después de habilitar la integración en la aplicación.
Este ejemplo no crea un proveedor ni hace solicitudes con la configuración inicial:

```ts
import { createFlagsClient, createHttpFlagsProvider } from "@e6tz/flags";

type HostFlagsConfig = { enabled: boolean; endpoint?: string };
const integration: HostFlagsConfig = { enabled: false };

const flags = integration.enabled && integration.endpoint
  ? createFlagsClient({ provider: createHttpFlagsProvider({ endpoint: integration.endpoint }) })
  : null;

try {
  if (flags) await flags.load();
  const enabled = flags?.getBooleanValue("new-checkout", false) ?? false;
  console.log(enabled);
} finally {
  flags?.dispose();
}
```

`false` es la decisión de tu aplicación cuando falta un valor remoto válido.
También podés usar `true` como fallback. Omitirlo produce un error de validación.
`getBooleanDetails(key, fallback).source` distingue `remote` de `fallback` cuando existe un cliente.
Para habilitar el ejemplo, la aplicación debe proporcionar `enabled: true` y su propio `endpoint`.
Conserva el cliente mientras lo necesites y llama a `dispose()` al finalizar su ciclo de vida.

Construir el cliente y consultar un flag no inicia solicitudes.
`load()` consulta el proveedor cuando falta una proyección vigente.
`refresh()` solicita una nueva proyección. Las llamadas concurrentes comparten la misma solicitud.
La aplicación elige cuándo cargar o refrescar los flags.

## Usar React o Next.js

Instala React 18.3 o 19 para usar `@e6tz/flags/react`.
El hook `useFlag(client,key,fallback)` devuelve los detalles de la evaluación.
`useFlagsSnapshot(client)` devuelve el estado del proveedor.
Los hooks no cargan datos automáticamente. En el servidor, `useFlag` usa el fallback para permitir una hidratación estable.

Este componente React, también utilizable en Next.js, mantiene la integración desactivada por defecto.
La aplicación proporciona `flagsEnabled`, `endpoint` e `integrationKey` mediante su propia configuración.
`integrationKey` debe cambiar al cambiar de usuario, proyecto o entorno; no debe contener secretos.
La clave de React desmonta el cliente anterior, cuyo efecto cancela solicitudes y lo descarta.
Cada instancia se crea dentro del efecto que la descarta, también en React Strict Mode.

```tsx
"use client";

import { useEffect, useState } from "react";
import { createFlagsClient, createHttpFlagsProvider, type FlagsClient } from "@e6tz/flags";
import { useFlag } from "@e6tz/flags/react";

function Checkout({ client }: { client: FlagsClient }) {
  const flag = useFlag(client, "new-checkout", false);
  return <p>{flag.value ? "New checkout" : "Standard checkout"}</p>;
}

type CheckoutProps = {
  flagsEnabled?: boolean;
  endpoint?: string;
  integrationKey: string;
};

export function CheckoutAvailable({ flagsEnabled = false, endpoint, integrationKey }: CheckoutProps) {
  if (!flagsEnabled || !endpoint) return <p>Standard checkout</p>;
  return <ConnectedCheckout key={`${integrationKey}:${endpoint}`} endpoint={endpoint} />;
}

function ConnectedCheckout({ endpoint }: { endpoint: string }) {
  const [client, setClient] = useState<FlagsClient | null>(null);

  useEffect(() => {
    const flags = createFlagsClient({
      provider: createHttpFlagsProvider({ endpoint }),
    });
    setClient(flags);
    void flags.load();
    return () => flags.dispose();
  }, [endpoint]);

  return client ? <Checkout client={client} /> : <p>Standard checkout</p>;
}
```

El ejemplo usa el adaptador HTTP sin cookies. Si el endpoint requiere autenticación,
configura el transporte de la aplicación según las siguientes indicaciones.

## Referencia de API

| Export | Contrato |
| --- | --- |
| `createFlagsClient({provider,timeoutMs?,now?})` | Crea una instancia sin iniciar solicitudes. Timeout predeterminado: 10 segundos. |
| `getBooleanValue(key,fallback)` | Devuelve un booleano. Requiere un fallback booleano explícito. |
| `getBooleanDetails(key,fallback)` | Devuelve `{key,value,source,reason,revision}`. |
| `load()` / `refresh()` | Devuelve el snapshot tras la solicitud o usa la proyección vigente cuando corresponde. |
| `getSnapshot()` / `subscribe(observer)` | Estado observable. `subscribe` devuelve la función de desconexión. |
| `abort()` | Cancela la solicitud actual, elimina valores y vuelve a `idle`. Permite cargar de nuevo. |
| `dispose()` | Cancela solicitudes, elimina valores y desconecta definitivamente la instancia. |
| `createHttpFlagsProvider({endpoint,headers?,fetch?})` | Adapta el contrato HTTP. `headers` admite un callback síncrono o asíncrono con `{signal}`. |

Los estados son `idle`, `loading`, `ready`, `expired`, `unavailable` y `disposed`.
Cada snapshot contiene `{state,value,errorCode,expiresAt}`.
Los motivos de evaluación son `REMOTE`, `UNKNOWN_KEY`, `NOT_READY`, `EXPIRED`, `UNAVAILABLE` y `DISPOSED`.

Los flags vencidos dejan de aplicarse inmediatamente al consultar el estado.
El cliente también notifica el vencimiento a suscriptores mediante un temporizador local.
Ese temporizador no hace solicitudes. `dispose()` lo elimina.
Los errores de red, formatos inválidos, cancelación y respuestas tardías nunca sustituyen el fallback por datos vencidos.
Una nueva solicitud usa el fallback hasta recibir su proyección válida.

### Errores y recuperación

| Situación | Resultado para la aplicación |
| --- | --- |
| Proveedor o timeout inválido al construir el cliente | Se lanza `FlagsError` con `INVALID_PROVIDER` o `INVALID_TIMEOUT`. |
| Endpoint inválido al construir el adaptador HTTP | Se lanza `FlagsError` con `INVALID_ENDPOINT`. |
| Clave o fallback inválido al evaluar | Se lanza `FlagsError` con `INVALID_FLAG_ARGUMENT`. |
| Proveedor rechazado, timeout, fallo HTTP o respuesta inválida | `load()` o `refresh()` devuelve un snapshot `unavailable`; las evaluaciones usan el fallback. |
| HTTP `429` | `errorCode` es `RATE_LIMITED`. |
| Otro HTTP no exitoso, incluidos `401` y `403` | `errorCode` es `REMOTE_UNAVAILABLE`; no se inicia login. |
| Datos vencidos o clave desconocida | Se usa el fallback con motivo `EXPIRED` o `UNKNOWN_KEY`, respectivamente. |

Consulta `getSnapshot().errorCode` y `getBooleanDetails()` para decidir cómo informar el estado.
La biblioteca no reintenta automáticamente ni implementa polling.
La aplicación decide si llama a `refresh()` después de resolver el fallo o actualizar su autorización.
`abort()` limpia el estado y permite volver a cargar; `dispose()` es definitivo para esa instancia.

### Contrato HTTP

El endpoint es una URL HTTP(S) absoluta o una ruta relativa al mismo origen.
El servidor anfitrión debe aceptar `GET` y devolver JSON con `Content-Type: application/json`.
Debe autenticar la solicitud cuando corresponda y autorizar el proyecto, entorno y flags antes de responder.
No debe confiar en un identificador de proyecto enviado por el navegador como prueba de autorización.
CORS y la validación de origen no sustituyen esas comprobaciones.
El endpoint solo entrega proyecciones booleanas, no secretos ni configuración administrativa.
El proveedor HTTP usa `credentials: "omit"`, `cache: "no-store"` y `redirect: "error"`.
Esto excluye las cookies de sesión incluso con una ruta relativa al mismo origen.

Si se requiere autenticación, la aplicación debe proporcionar explícitamente sus cabeceras mediante `headers`,
o implementar un `FlagsProvider` o adaptador `fetch` con el transporte de sesión que haya autorizado.
Limita ese transporte al endpoint controlado por la aplicación; no envíes credenciales a URLs arbitrarias.
La autenticación, renovación y revocación de credenciales siguen siendo responsabilidad de la aplicación.
No generes credenciales en el navegador ni incluyas tokens administrativos en el bundle.
Las cabeceras del cliente y los flags recibidos son accesibles al usuario del navegador.

```json
{
  "data": {
    "revision": "revision-12",
    "validUntil": "2026-10-22T12:00:30.000Z",
    "flags": [
      { "key": "new-checkout", "value": true }
    ]
  }
}
```

`validUntil` es una fecha ISO 8601 UTC futura, a un máximo de 60 segundos del reloj del cliente.
El servidor debe emitirla en cada respuesta con su reloj sincronizado.
La fecha del JSON anterior ilustra el formato; no debe copiarse como una fecha fija.
Por ejemplo, el servidor puede calcular `new Date(Date.now() + 30_000).toISOString()` al responder.
`revision` identifica la proyección que publica el servidor; no añade permisos al cliente.
El proyecto y entorno se seleccionan en la aplicación anfitriona, no mediante campos adicionales del contrato.
La proyección admite hasta 64 claves únicas. Cada clave empieza con una letra ASCII.
Los caracteres restantes pueden ser letras ASCII, números, punto, guion o guion bajo, hasta 64 caracteres en total.
`revision` admite entre 1 y 128 caracteres ASCII: letras, números, punto, guion, guion bajo o dos puntos.
La respuesta JSON admite hasta 64 KiB. El cliente descarta cualquier campo adicional.

Los flags sólo controlan la presentación o el comportamiento del cliente.
Un booleano de feature flag no es una barrera de seguridad.
El servidor de la aplicación debe comprobar los permisos de cada operación, aunque la interfaz la oculte.
El paquete no identifica visitantes ni envía eventos, exposición, cookies, campañas o sesiones.

### Inyectar otro proveedor

```ts
import { createFlagsClient, type FlagsProvider } from "@e6tz/flags";

const provider: FlagsProvider = async ({ signal }) => {
  const response = await fetch("/my-flags", { signal, credentials: "omit" });
  if (!response.ok) throw new Error("Flag delivery failed");
  const payload: unknown = await response.json();
  return payload;
};

const flags = createFlagsClient({ provider });
```

El proveedor devuelve `{revision,validUntil,flags}` directamente, sin el envelope HTTP.
El núcleo valida todos los datos externos como `unknown`.
Aplica timeout y descarta respuestas tardías aunque el proveedor ignore la señal de aborto.

## Desarrollar este paquete

Cloná el repositorio independiente y ejecutá:

```sh
git clone https://github.com/Enry6tz/Flags.git
cd Flags
npm install
npm run typecheck
npm test
npm run test:package
npm pack
```

`npm install` compila automáticamente por medio de `prepare`; `npm run build` permite repetir la compilación.
`npm pack` genera `e6tz-flags-0.1.1.tgz`, que puede instalarse en otra aplicación por su ruta local.
`npm run test:package` instala el tarball en una aplicación temporal externa, verifica el núcleo sin React, sus tipos y el adaptador con React. La carpeta temporal se informa al finalizar para su limpieza. GitHub Actions ejecuta tipos, tests y esta comprobación en Node.js 22 y 24.
La compilación genera JavaScript ESM y declaraciones con imports `.js` compatibles con NodeNext.
El export raíz no importa React. Cada versión se empaqueta sin depender de fuentes del monorepo.

Flags se distribuye bajo la [licencia MIT](LICENSE), incluida en el paquete.
