# INGEGAMES 2026 · versión 2 · Supabase Free + GitHub Pages

Aplicación para SEIMT × SEIIS, Tec de Monterrey Campus León. Evento: **5 de noviembre de 2026, 15:00–17:00, Árbol de la Fraternidad**.

## Qué cambió

Se conservó la interfaz React: marcador, equipos, paneles, animaciones y Casco de Oro. Se sustituyó completamente el backend activo por Supabase Authentication, PostgreSQL con RLS, Realtime y una Edge Function. No se utiliza Firebase ni Cloud Functions de Google, ni se requiere Blaze. No hay dependencias Firebase en el paquete actual.

**El código está preparado, pero el proyecto Supabase y el despliegue público aún no están configurados.** No se han creado las diez cuentas en Supabase. No hay datos de prueba en producción.

## Publicar sin presupuesto

- Usa una organización y proyecto de **Supabase Free**. No selecciones Pro, complementos, dominios personalizados ni servicios adicionales de pago.
- Usa un repositorio **público** en GitHub Free y la dirección gratuita `https://USUARIO.github.io/ingegames-2026/`.
- No se necesita contratar dominio, SMTP, servidor, Firebase ni una computadora encendida para servir el backend.
- Supabase Free tiene límites. La página oficial consultada el 4/11/2026 incluye 500 000 invocaciones mensuales de Edge Functions, 200 conexiones simultáneas y 2 millones de mensajes Realtime. Esto no significa capacidad ilimitada ni garantiza rendimiento sin probar.
- Mientras permanezcas en Free, Supabase indica que no cobra; si se exceden cuotas pueden aplicarse restricciones del servicio. No cambies a un plan de pago para resolver un límite sin autorización del organizador.
- GitHub Pages gratuito requiere un repositorio público. **El código podrá ser público, las contraseñas y claves administrativas nunca.**

Referencias oficiales: [Supabase Pricing](https://supabase.com/pricing), [control de costos](https://supabase.com/docs/guides/platform/cost-control), [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## Instalación local

Usa Node.js 24 LTS (24.12 o posterior):

```powershell
npm ci
npm test
npm run build
npm run dev
```

Las pruebas SQL usan PostgreSQL real en WebAssembly mediante PGlite; no requieren Docker, Java, Firebase, cuentas remotas ni servicios de pago. No sustituyen las pruebas de Supabase Auth, WebSockets o concurrencia real en la nube.

Para comprobar la Edge Function con Deno instalado: `npm run check:edge`. Alternativa sin instalación global: `npx --yes --package=deno deno check --node-modules-dir=manual supabase/functions/command/index.ts`.

## 1. Crear el proyecto gratuito

1. En [Supabase](https://supabase.com/dashboard), crea una organización **Free** y un proyecto llamado `ingegames-2026`.
2. Elige la región cercana disponible y guarda la contraseña de la base de datos en un lugar privado. No es la contraseña del administrador de la aplicación.
3. En la configuración/API del proyecto copia la URL `https://REF.supabase.co` y la clave **publishable** que empieza con `sb_publishable_`.
4. En Authentication habilita Email/Password y **desactiva el registro de usuarios nuevos**. Las cuentas se crearán con la API administrativa del servidor. No habilites login anónimo.
5. Configura Site URL como `https://USUARIO.github.io/ingegames-2026/`. Si necesitas una lista de Redirect URLs, añade esa URL y la URL local de desarrollo. El flujo de contraseña no usa OAuth ni requiere SMTP.

## 2. Instalar la base de datos

En SQL Editor de tu proyecto vacío, pega y ejecuta **una sola vez** el contenido completo de:

```text
supabase/migrations/202611040001_ingegames.sql
```

El archivo crea tablas, índices, funciones transaccionales, políticas RLS, permisos y publicaciones Realtime. Inicializa el marcador a cero, sin equipos y con estado **NO INICIADO**, y reserva nueve plazas deshabilitadas hasta aprovisionar las cuentas.

No ejecutes la migración sobre una base con una instalación existente ni borres tablas para volver a correrla. No crea reinicios automáticos ni elimina resultados.

Comprueba en Database → Replication/Publications que `supabase_realtime` incluya:

```text
public_state
users
teams
score_events
judge_slots
```

No publiques `judge_locks`, `admin_audit` ni `event_settings`.

**Alternativa con CLI:** usa `npx supabase login`, `npx supabase link --project-ref REF` y `npx supabase db push`. Elige Editor o CLI, no ambos para la misma instalación inicial. La contraseña de base de datos se introduce de forma privada cuando la herramienta la solicita.

## 3. Desplegar el backend gratuito

Desde la carpeta del proyecto:

```powershell
npx supabase login
npx supabase link --project-ref TU_REF
npx supabase functions deploy command
```

La función es `supabase/functions/command/index.ts`. `supabase/config.toml` mantiene `verify_jwt = true`; además el código consulta `Auth.getUser(jwt)` antes de ejecutar comandos.

El servidor obtiene `SUPABASE_URL` y las claves administrativas de los secretos que Supabase inyecta en su entorno. Soporta `SUPABASE_SECRET_KEYS` y, como alternativa, `SUPABASE_SERVICE_ROLE_KEY`. No deben copiarse al frontend. Véase [variables de Edge Functions](https://supabase.com/docs/guides/functions/secrets).

La URL resultante tendrá esta forma:

```text
https://TU_REF.supabase.co/functions/v1/command
```

No se requiere desplegar un servidor Node ni mantener la CLI abierta después de publicar.

## 4. Crear el administrador y los nueve jueces

Se conservaron las diez contraseñas originales en la carpeta privada externa:

```text
..\tmp\ingegames-accesos-privados\ACCESOS-PRIVADOS.txt
..\tmp\ingegames-accesos-privados\cuentas.json
```

**Esos archivos no están en el ZIP ni deben subirse a GitHub.** Si trabajas desde otra computadora, transfiérelos por un medio privado. Cada juez recibe solo su cuenta; nunca el archivo completo.

El lote tiene primero al administrador y luego a los nueve jueces. Los identificadores `admin@ingegames2026.invalid` y `juez01` a `juez09` con ese dominio tienen formato de correo, pero **no son buzones reales**. El aprovisionador confirma las cuentas mediante la API administrativa, sin enviar correos. Si el proveedor rechaza un identificador o necesitas recuperación por correo, usa correos reales y conserva las contraseñas originales.

En la configuración de API de Supabase copia la **clave secret** administrativa para usarla solo en una terminal local. El siguiente ejemplo la lee sin dejar el valor escrito en el comando ni imprimirlo:

```powershell
$env:SUPABASE_URL = 'https://TU_REF.supabase.co'
$privateKey = Read-Host 'Pega la clave secret de Supabase' -AsSecureString
$env:SUPABASE_SECRET_KEY = [System.Net.NetworkCredential]::new('', $privateKey).Password
Get-Content -Raw -LiteralPath '..\tmp\ingegames-accesos-privados\cuentas.json' | node scripts/provision-accounts.mjs
Remove-Item Env:SUPABASE_SECRET_KEY
```

No cambies el nombre de esa variable a `VITE_...`. No guardes la clave en `.env.local`, capturas, GitHub Variables, el ZIP o el chat.

El aprovisionador:

- Crea exactamente diez identidades Auth: un administrador y nueve jueces.
- Conserva las contraseñas del lote, sin generarlas nuevamente ni imprimirlas.
- Crea las cuentas inicialmente bloqueadas; una ejecución parcial no crea permisos privados de aplicación.
- Permite reanudar el mismo lote si la creación inicial se interrumpe antes de terminar.
- Habilita los perfiles de forma atómica al final y nunca reinicia un evento existente.
- Asigna ping pong a jueces 1/5/9, futbolito a 2/6, videojuegos a 3/7 y mesa a 4/8.

El administrador puede modificar nombre, correo, contraseña, actividades y habilitación de cada juez desde el panel. La creación inicial de las diez identidades se realiza con el script; no hay altas públicas ni una décima plaza de juez.

El administrador tiene control completo dentro de la aplicación, no permisos automáticos sobre facturación, la organización Supabase ni la cuenta GitHub.

## 5. Conectar y probar React

Copia `.env.example` a `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://TU_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_TU_CLAVE_PUBLICA
VITE_BASE_PATH=/ingegames-2026/
```

Estas son las únicas credenciales necesarias para el navegador: una URL y una clave pública. La compilación rechaza claves que no tengan prefijo publishable para prevenir usar accidentalmente una clave administrativa en esa variable.

Ejecuta `npm run dev` y abre la dirección impresa, normalmente:

```text
http://127.0.0.1:5173/ingegames-2026/
```

Las rutas son:

```text
/#/                 Marcador público
/#/?present=1       Proyección
/#/login            Acceso
/#/judge            Juez
/#/admin            Administración
```

El marcador empieza en cero. No se generan equipos ficticios ni puntuaciones de demostración. Las puntuaciones residen exclusivamente en PostgreSQL. Supabase puede conservar la sesión de autenticación en el navegador; eso no convierte el almacenamiento local en fuente de verdad de los puntos.

## 6. Publicar en GitHub Pages sin pagar

1. Crea un repositorio **público** llamado `ingegames-2026` en GitHub Free.
2. Sube solo el contenido de esta carpeta, incluyendo `.github` y el lockfile. No subas `node_modules`, `.env.local` ni archivos privados. No subas la carpeta `tmp` del espacio de trabajo.
3. Usa la rama `main`.
4. En Settings → Secrets and variables → Actions → **Variables**, crea:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
5. En Settings → Pages → Build and deployment selecciona **GitHub Actions**.
6. Haz push a `main` o ejecuta el workflow GitHub Pages. Compila, ejecuta las pruebas locales y publica `dist`.
7. Abre `https://USUARIO.github.io/ingegames-2026/`.

El workflow calcula la ruta con el nombre del repositorio. Si utilizas un repositorio raíz llamado `USUARIO.github.io`, cambia `VITE_BASE_PATH` del workflow a `/`.

**GitHub Pages solo aloja archivos estáticos.** La base de datos y Edge Function siguen funcionando en Supabase Free. Publicar React no instala la base de datos ni despliega la función; completa los pasos anteriores.

## Arquitectura y seguridad

```text
React / GitHub Pages
  ├─ Supabase Auth: acceso Email/Password
  ├─ PostgreSQL SELECT: datos permitidos por RLS
  ├─ Supabase Realtime: avisos de cambios y recarga de datos
  └─ Edge Function command
       ├─ Auth.getUser: verifica el JWT del usuario
       ├─ SQL command: valida permisos y modifica puntos atómicamente
       └─ Gestión de jueces: revoca permisos → cambia Auth → confirma perfil
```

Se conservan las seis acciones `judge`, `team`, `score`, `adjust`, `reverse` y `settings`.

- Las tablas no admiten escrituras desde los roles del navegador, ni siquiera desde el administrador.
- Las funciones SQL de escritura solo admiten ejecución mediante el rol administrativo del servidor. Un usuario autenticado no puede invocar `command` directamente por RPC.
- La Edge Function deriva la identidad de la sesión validada; ignora cualquier intento de suministrar otra identidad en el JSON.
- La función SQL vuelve a consultar el perfil habilitado y las actividades asignadas. Un juez no puede cambiar roles ni puntuar actividades ajenas.
- Un bloqueo de fila sobre `public_state` serializa puntuaciones y cambios del torneo. Historial, equipo y agregado se actualizan en una única transacción PostgreSQL.
- `operationId` es un UUID único. Una solicitud idéntica puede reintentarse sin duplicar; reutilizar el ID con otro contenido se rechaza.
- Las anulaciones conservan el original e insertan el movimiento inverso. Para reconstruir el marcador, suma **todas** las entradas, incluidas las negativas; no excluyas además el original marcado `reversed_by`.
- Finalizar congela puntos, ajustes y anulaciones. La revelación es independiente. Un empate requiere declaración compartida o desempate externo justificado.
- El público solo lee `public_state`: no recibe nombres de integrantes ni correos de jueces. Los jueces ven sus equipos asignados y su propio historial. Los correos de cuentas son solo de administración.
- Los cambios de cuenta revocan primero el permiso del juez. Si Auth falla, permanece deshabilitado y se puede reintentar. Una reserva impide cambios simultáneos sobre la misma plaza.

## Operación y conectividad

1. Registra equipos con cuatro integrantes y sus actividades.
2. Verifica asignaciones de los nueve jueces.
3. Abre el marcador en el proyector y activa presentación/F11.
4. Inicia el torneo desde administración.
5. Cada juez selecciona actividad, equipo, puntos y confirma.
6. Corrige mediante anulación justificada y nuevo ajuste, conservando auditoría.
7. Finaliza y congela; activa la revelación cuando corresponda frente al público.
8. Exporta el CSV.

El cliente combina Realtime con una lectura de recuperación cada 15 segundos y al reconectar. Cada nueva suscripción vuelve a consultar datos; las respuestas antiguas no deben sobrescribir revisiones nuevas. La detección de una red degradada puede tardar y requiere prueba en dispositivos reales.

No se encolan puntos fuera de línea. Una respuesta perdida puede corresponder a una operación ya confirmada en el servidor; el juez conserva el UUID pendiente y reintenta la misma operación para verificarla. No se muestra éxito antes de que el backend lo confirme.

## Estructura

```text
src/main.tsx                 Interfaz conservada y hooks Supabase
src/supabase.ts              Auth, consultas, Realtime y comandos
src/domain.ts                Tipos y clasificación
src/styles.css               Diseño, móvil y proyección
supabase/migrations/         Esquema, RLS, funciones e inicialización
supabase/functions/command/  Edge Function y controlador comprobable
supabase/config.toml         Configuración local/función
scripts/provision-accounts.mjs
tests/database.test.ts       Pruebas PostgreSQL/RLS
tests/edge.test.ts           Sesión, identidad y coordinación Auth
tests/domain.test.ts         Clasificación y empates
.github/workflows/pages.yml
.env.example
VERIFICACION.md
```

La versión anterior de Firebase se conservó fuera del proyecto activo en `../tmp/ingegames-firebase-backup`. No forma parte del nuevo ZIP ni debe desplegarse junto a Supabase.

## Pruebas pendientes antes del evento

Consulta `VERIFICACION.md`. No uses las pruebas anteriores de Firebase como evidencia de que Supabase ya funciona en producción. Verifica inicio de sesión real, Realtime entre pantallas, nueve dispositivos, reconexión, RLS, pausa, correcciones y cierre sobre un proyecto gratuito de ensayo. Conserva producción sin puntos de prueba para el evento.
