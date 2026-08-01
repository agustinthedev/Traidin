# Desarrollo y operación local

## Configuración

Copiar `.env.example` a `.env`. `DATABASE_URL` acepta la forma `sqlite:///./data/trading-platform.db`; el directorio se crea automáticamente. `SYMBOLS` y `AGGREGATED_TIMEFRAMES` son listas configurables. REST/WS, timeouts, backoff, batch size, retención, host/puerto, logs y backup también se controlan por variables documentadas en el ejemplo.

Las credenciales son opcionales. Sólo el backend puede leerlas; el frontend recibe únicamente banderas configurado/no configurado. Pino redacta cabeceras y nombres sensibles. No se guardan claves en SQLite y no hay endpoints de órdenes.

## Ejecución sin Docker

```powershell
npm install
Copy-Item .env.example .env
npm run db:migrate
npm run dev:api
```

En otra terminal ejecutar `npm run dev`. El backend aplica migraciones en cada apertura, verifica integridad, consulta REST/metadata, recupera jobs interrumpidos, busca continuidad reciente y conecta el stream público de klines.

## Flujos

- Live: las actualizaciones abiertas permanecen en memoria; sólo `x=true` se valida, escribe idempotentemente y emite `CANDLE_CLOSED`/`CANDLE_PERSISTED`.
- Histórico: pagina en orden cronológico, confirma lotes, guarda checkpoint post-commit y admite pausa, cancelación, reintento y recuperación tras restart.
- Gaps: compara timestamps alineados, deduplica rangos, descarga sólo faltantes con source `REST_GAP_REPAIR` y recalcula agregados afectados.
- Agregación: 1m cerrado es canónico. Se construyen 5m, 15m, 1h, 4h, 1d y 1w en UTC. Día inicia 00:00 UTC; 4h se alinea a 00/04/08/12/16/20; semana inicia lunes 00:00 UTC. Un bucket con minutos faltantes se marca incompleto y dispara repair.

## Jobs, health y rate limits

Los jobs `RUNNING`/`CANCELLING` vuelven a `PENDING` al arrancar y retoman desde su checkpoint. El adapter corrige clock skew con `/time`, registra headers de peso, aplica timeout y exponential backoff con jitter. Health combina aplicación, SQLite, writer, REST, WebSocket, persistencia, histórico, repair, agregación y SSE; gaps recientes o stream estancado degradan el estado.

## Migraciones y mantenimiento

Las migraciones están en `server/db/migrations` y se registran en `schema_migrations`. No se deben modificar migraciones aplicadas: agregar una nueva versión. Use `npm run db:backup` antes de cambios importantes, `npm run db:optimize` para mantenimiento seguro y la página Database para checkpoint/backup. El archivo DB, WAL, backups de desarrollo y `.env` están ignorados por Git.

## Verificación

Ejecutar `npm run typecheck`, `npm test`, `npm run test:integration` y `npm run build`. `npm run perf:sqlite` crea una base ignorada en `data/performance`, inserta 250.000 velas en bulk, intercala escrituras live/lecturas y reporta throughput, latencias, tamaño, idempotencia y locks. Si el backend está en 4100 también mide respuestas de health durante la carga.
