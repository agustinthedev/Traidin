# SQLite storage design

## Decisión y volumen

SQLite es la base local obligatoria: simplifica instalación y operación, mantiene el conjunto de datos portable y soporta varios millones de velas cuando las consultas están indexadas y las escrituras se agrupan. Dos símbolos con dos años de 1m representan aproximadamente 2,1 millones de filas canónicas, más agregados, jobs, gaps, metadata y eventos.

Los precios y cantidades se guardan como texto decimal canónico y se calculan con `decimal.js`; no se usa `REAL` para aritmética financiera. Los timestamps se guardan como epoch-milliseconds UTC. La identidad única es `(exchange, market, symbol, timeframe, open_time)`.

## WAL y conexiones

Al abrir la base se aplican `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, `temp_store=MEMORY`, un cache negativo acotado y `mmap_size`. `NORMAL` evita un fsync extra por transacción manteniendo la durabilidad apropiada de WAL; no equivale a desactivar sincronización. Hay una conexión dedicada de escritura y otra de lectura. Las lecturas del dashboard continúan mientras el writer confirma lotes cortos.

## Coordinación del writer

Todos los productores pasan por `SQLiteWriter`, una cola de prioridad estable:

1. velas live cerradas;
2. reparación de gaps;
3. metadata;
4. jobs y eventos;
5. backfill;
6. reconstrucción de agregados.

Un solo writer ejecuta transacciones, reintenta `SQLITE_BUSY` con espera acotada y expone profundidad, latencias y reintentos. Backfill usa lotes REST de hasta 1.500 y cede entre commits; las reconstrucciones agregadas confirman hasta 500 buckets por lote. Un checkpoint se actualiza sólo después del commit de velas.

## Esquema e índices

Las migraciones versionadas crean `candles`, `backfill_jobs`, `gaps`, `system_events`, `symbol_metadata` y `system_state`. Los índices principales cubren `symbol/timeframe/open_time`, source, completitud, estado de jobs, gaps activos y eventos por tiempo/filtro. Las consultas históricas exigen símbolo, timeframe, rango y límite/offset; no cargan históricos completos al frontend.

## Mantenimiento y backups

La página Database y la API muestran tamaños de DB/WAL, PRAGMAs, integridad y métricas del writer. Las acciones manuales ejecutan checkpoint WAL, `PRAGMA optimize`, `ANALYZE` y backup consistente mediante `VACUUM INTO`. `VACUUM` normal nunca se ejecuta durante ingesta. Los backups usan un directorio configurable y nombre UTC; secretos y `.env` quedan fuera.

## Limitaciones y migración futura

SQLite mantiene un único writer efectivo. Debe reconsiderarse PostgreSQL sólo si aparecen múltiples procesos o hosts escritores, alta disponibilidad, replicación, usuarios concurrentes con escrituras sostenidas, o un volumen/retención que ya no alcance latencias locales aceptables. Esa eventual migración se limita por la capa de repositorios; no forma parte de esta fase.
