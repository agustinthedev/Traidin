# Treidin Market Data

Primera fase de una plataforma local de datos para Binance USD-M Futures. Recibe velas 1m de BTCUSDT y ETHUSDT, mantiene histórico, repara gaps, genera timeframes superiores y expone un dashboard operativo. La persistencia es exclusivamente SQLite; no requiere PostgreSQL, Docker ni servicios de infraestructura.

## Inicio rápido

Requisitos: Node.js 22.13 o posterior.

```powershell
npm install
Copy-Item .env.example .env
npm run db:migrate
```

En dos terminales:

```powershell
npm run dev:api
npm run dev
```

Backend: `http://127.0.0.1:4100`. El frontend imprime su puerto local al iniciar (normalmente 3000; elige otro si está ocupado). Los streams y endpoints públicos de Binance no requieren credenciales. `BINANCE_API_KEY` y `BINANCE_API_SECRET` son opcionales, se leen sólo en backend y nunca se persisten ni se exponen.

## Comandos

```text
npm test                 pruebas unitarias y SQLite temporal
npm run test:integration integración pública real de Binance
npm run typecheck        validación TypeScript
npm run build            build de producción
npm run perf:sqlite      prueba local de 250.000 velas
npm run db:backup        backup consistente con VACUUM INTO
npm run db:optimize      PRAGMA optimize + ANALYZE
```

La configuración está documentada en [desarrollo local](docs/local-development.md), el diseño en [arquitectura](docs/architecture.md), el almacenamiento en [SQLite storage design](docs/sqlite-storage-design.md), la [prueba de rendimiento](docs/performance-results.md) y la inspección del stream real en [Binance WebSocket payload analysis](docs/binance-websocket-payload-analysis.md).

## Alcance

Incluye ingesta, histórico, calidad, agregación, observabilidad y dashboard. No incluye estrategias, agents, backtesting, paper trading, posiciones ni ejecución de órdenes.
