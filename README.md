# Flags

Consultá flags booleanos desde un proveedor configurable, con fallback obligatorio en cada evaluación.
Este paquete tiene su propia versión e instalación. El núcleo funciona sin React ni otros productos.

## Instalar y conectar

El nombre previsto en npm es `@e6tz/flags`; la publicación pública está pendiente. Una vez publicado, se instalará con `npm install @e6tz/flags`.
Instalá las fuentes del repositorio independiente con Node.js 20.9 o posterior y Git disponibles:

```sh
npm install github:Enry6tz/Flags#main
```

La instalación desde GitHub compila las fuentes con `prepare`. El paquete instalado conserva el nombre `@e6tz/flags` y los imports que aparecen en esta documentación.

También podés instalar el archivo de la versión entregada o generado con `npm pack`:

```sh
npm install ./e6tz-flags-0.1.1.tgz
```

Configurá un proveedor compatible que entregue el contrato HTTP documentado más abajo.

```ts
import { createFlagsClient, createHttpFlagsProvider } from "@e6tz/flags";

const flags = createFlagsClient({
  provider: createHttpFlagsProvider({
    endpoint: "https://flags.example/api/flags",
  }),
});

await flags.load();
const enabled = flags.getBooleanValue("new-checkout", false);
const details = flags.getBooleanDetails("new-checkout", false);
```

`false` es la decisión de tu aplicación cuando falta un valor remoto válido.
También podés usar `true` como fallback. Omitirlo produce un error de validación.
`details.source` distingue `remote` de `fallback`.

Construir el cliente y consultar un flag no inicia solicitudes.
`load()` consulta el proveedor cuando falta una proyección vigente.
`refresh()` solicita una nueva proyección. Las llamadas concurrentes comparten la misma solicitud.
La aplicación elige cuándo cargar o refrescar los flags.

## Usar React o Next.js

Instalá React 18.3 o 19 para usar `@e6tz/flags/react`.
El hook `useFlag(client,key,fallback)` devuelve los detalles de la evaluación.
`useFlagsSnapshot(client)` devuelve el estado del proveedor.
Los hooks no cargan datos automáticamente. En el servidor, `useFlag` usa el fallback para permitir una hidratación estable.

Este componente Next.js crea cada instancia dentro del efecto que la descarta.
Admite la repetición de efectos de React Strict Mode.

```tsx
"use client";

import { useEffect, useState } from "react";
import { createFlagsClient, createHttpFlagsProvider, type FlagsClient } from "@e6tz/flags";
import { useFlag } from "@e6tz/flags/react";

function Checkout({ client }: { client: FlagsClient }) {
  const flag = useFlag(client, "new-checkout", false);
  return <p>{flag.value ? "Nuevo checkout" : "Checkout habitual"}</p>;
}

export function CheckoutDisponible() {
  const [client, setClient] = useState<FlagsClient | null>(null);

  useEffect(() => {
    const flags = createFlagsClient({
      provider: createHttpFlagsProvider({
        endpoint: "https://flags.example/api/flags",
      }),
    });
    setClient(flags);
    void flags.load();
    return () => flags.dispose();
  }, []);

  return client ? <Checkout client={client} /> : <p>Checkout habitual</p>;
}
```

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

### Contrato HTTP

El endpoint es una URL HTTP(S) absoluta o una ruta relativa al mismo origen.
Tu servidor debe aceptar `GET` y validar el origen autorizado cuando corresponda.
El endpoint público sólo entrega proyecciones booleanas. No uses tokens administrativos en el navegador.
El proveedor HTTP usa `credentials: "omit"`, `cache: "no-store"` y `redirect: "error"`.

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
La proyección admite hasta 64 claves únicas. Cada clave empieza con una letra ASCII.
Los caracteres restantes pueden ser letras ASCII, números, punto, guion o guion bajo, hasta 64 caracteres en total.
`revision` admite entre 1 y 128 caracteres ASCII: letras, números, punto, guion, guion bajo o dos puntos.
La respuesta JSON admite hasta 64 KiB. El cliente descarta cualquier campo adicional.

Los flags sólo controlan la presentación o el comportamiento del cliente.
El servidor de tu aplicación debe comprobar los permisos de cada operación.
El paquete no identifica visitantes ni envía eventos, exposición, cookies, campañas o sesiones.

### Inyectar otro proveedor

```ts
import { createFlagsClient, type FlagsProvider } from "@e6tz/flags";

const provider: FlagsProvider = async ({ signal }) => {
  const response = await fetch("/my-flags", { signal });
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
