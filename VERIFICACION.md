# Verificación de la migración a Supabase · 4 de noviembre de 2026

## Resultado actual

El proyecto activo usa Supabase y GitHub Pages. No usa Firebase, Google Cloud Functions ni Blaze. El diseño y los paneles se conservaron.

**No está publicado ni conectado a un proyecto Supabase real todavía.** No se proporcionaron URL ni claves de un proyecto. Las diez contraseñas originales se conservaron fuera del repositorio, pero las cuentas no se han creado en Supabase.

## Comprobaciones ejecutadas

- `npm run build`: TypeScript y Vite compilaron el frontend migrado.
- `npm test`: **34 pruebas pasaron**, distribuidas en cuatro archivos.
- Deno comprobó los tipos de la Edge Function `supabase/functions/command/index.ts`.
- La instalación de dependencias retiró Firebase y sus herramientas y reportó **cero vulnerabilidades** en su auditoría de npm. Este resultado no equivale a una auditoría de seguridad completa.

### Cinco pruebas de dominio

Clasificación, empate inicial en cero, empate de dos carreras, desempate explícito y rechazo de ganador ajeno al empate.

### Diecisiete pruebas PostgreSQL / RLS

La migración SQL se ejecutó sobre **PGlite, PostgreSQL real en WebAssembly**, con roles y tablas de identidad de prueba. Se verificaron:

- Inicialización a cero, sin equipos, con un administrador y exactamente nueve jueces.
- Lectura pública limitada al estado del marcador.
- Privacidad de usuarios, equipos, correos, auditoría y reservas.
- RLS de perfiles, equipos por actividad e historial propio.
- Prohibición de escrituras y RPC de servidor desde el navegador, incluso como administrador.
- Registro de las tres carreras con cuatro integrantes.
- Rechazo de nombres duplicados y cambio de carrera de un equipo existente.
- Rechazo de cuentas sin autorización, administración desde juez y puntuaciones antes de iniciar.
- Registro atómico de 20 puntos con fecha del servidor.
- Rechazo de actividades ajenas y cantidades no habilitadas, sin modificaciones parciales.
- Solicitudes de los nueve jueces y conservación de sus entradas en el motor local.
- Doble envío con UUID sin duplicación y rechazo del mismo UUID con otros datos.
- Anulación mediante movimiento inverso y rechazo de una segunda anulación.
- Reserva de modificación de juez, revocación previa de acceso y límite de nueve plazas.
- Pausa/reanudación.
- Cierre irreversible, bloqueo de nuevas puntuaciones y correcciones, revelación y empate correcto.
- Reconstrucción de los agregados desde todo el libro de eventos.

**Límite:** las transacciones de PGlite se ejecutan en un motor local serializado. Esto comprueba la lógica SQL, pero no una prueba de concurrencia de nueve conexiones de red independientes ni la configuración concreta de Supabase en la nube.

### Siete pruebas de la Edge Function

Se ejecutó el mismo controlador usado por Deno con clientes Auth/RPC de prueba. Se comprobaron falta de sesión, verificación del JWT con Auth, identidad derivada del servidor, rechazo de una décima plaza, orden de revocación/modificación de cuenta, manejo de fallo de Auth sin restaurar permisos y respuestas CORS/método/JSON.

**Límite:** Auth y el transporte RPC se simulan en estas pruebas. Todavía falta verificar Supabase Auth real, las claves del proyecto y el despliegue remoto de la Edge Function.

### Cinco pruebas del cliente

Conversión de filas SQL para la interfaz, recuperación mediante polling y reconexión, serialización de lecturas para evitar sobrescrituras antiguas, indicación de error sin fabricar datos y limpieza de canales/temporizadores al desmontar.

**Límite:** los eventos de red y el canal se simulan localmente. No se afirma una prueba de WebSockets de Supabase ni de desconexión física de un teléfono.

## Matriz del torneo

| Escenario | Evidencia local | Pendiente remoto/manual |
|---|---|---|
| Registrar IMT con cuatro integrantes | SQL pasó | Formulario en navegador |
| Registrar IIS e IIT | SQL pasó | Interfaz conectada |
| Iniciar sesión como juez | Código migrado y controlador comprobado | Supabase Auth real |
| Asignar 20 puntos | Transacción SQL pasó | Edge Function publicada |
| Actualizar el marcador sin recargar | Cliente Realtime implementado y watcher comprobado | Dos pantallas con Supabase Realtime real |
| Puntuación simultánea | Solicitudes de nueve jueces preservadas en motor local | Dos o nueve sesiones de red independientes |
| No perder ni duplicar puntos | Idempotencia y reconstrucción SQL pasaron | Reintento durante pérdida de respuesta real |
| Rechazar usuario no autorizado | SQL y controlador pasaron | Intento contra endpoint remoto |
| Rechazar edición directa del agregado | Grants y RLS pasaron | API pública real del proyecto |
| Corregir con historial | SQL pasó | Actualización en varias pantallas |
| Pausar bloquea puntuación | SQL pasó | Dos dispositivos |
| Finalizar y revelar | SQL y clasificación pasaron | Animación en proyector |
| Abrir GitHub Pages en celular | Workflow preparado | Publicación y teléfono real |
| Desconectar/reconectar | Recuperación local comprobada | Red real |
| Empate no produce campeón arbitrario | SQL y dominio pasaron | Revelación visual |

## Inspección visual

No se realizó una nueva inspección visual ni pruebas de interacción en navegador durante esta migración. La interfaz original se conservó y compiló. No se da por verificado el modo 1920 × 1080, los formularios móviles ni la animación del campeón.

## Antes de usar puntos reales

1. Crear un proyecto Supabase **Free**, sin contratar planes ni complementos.
2. Instalar la migración y verificar RLS/publicación Realtime.
3. Desactivar altas públicas en Authentication y desplegar `command`.
4. Aprovisionar las diez cuentas con el lote privado original.
5. Configurar las dos variables públicas y publicar en GitHub Pages con repositorio público.
6. Ejecutar todos los escenarios pendientes en un entorno de ensayo separado, con dos navegadores y teléfonos reales.
7. Verificar legibilidad y ausencia de scroll en el proyector a 1920 × 1080.
8. Comprobar Usage de Supabase para mantener el evento dentro de las cuotas Free.

Las pruebas anteriores de Firebase pertenecen a la versión anterior y **no se cuentan como evidencia de funcionamiento de Supabase**.
