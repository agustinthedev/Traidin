import WebSocket from "ws";
import { createServer, type Server } from "node:http";

type ParentConfig =
  | { type: "start"; symbols: string[]; baseUrl: string }
  | { type: "stop" };

let stopped = false;
let socket: WebSocket | undefined;
const lastMessageAt = new Map<string, number>();
const latestCandles = new Map<string, { raw: string; receivedAt: number }>();
let snapshotServer: Server | undefined;

function send(message: Record<string, unknown>) {
  if (process.send) process.send(message);
}

function connect(symbols: string[], baseUrl: string) {
  if (stopped) return;
  const url = new URL(baseUrl);
  url.searchParams.set("streams", symbols.map((symbol) => `${symbol.toLowerCase()}@kline_1m`).join("/"));
  const nextSocket = new WebSocket(url, { handshakeTimeout: 15_000 });
  socket = nextSocket;
  nextSocket.on("open", () => {
    const now = Date.now();
    for (const symbol of symbols) {
      lastMessageAt.set(symbol, now);
      send({ type: "connected", symbol });
    }
  });
  nextSocket.on("message", (data) => {
    const receivedAt = Date.now();
    const raw = data.toString();
    try {
      const payload = JSON.parse(raw) as { data?: { k?: { s?: string } } };
      const symbol = payload.data?.k?.s;
      if (!symbol || !symbols.includes(symbol)) return;
      lastMessageAt.set(symbol, receivedAt);

      // Keep the newest mutable candle here. The parent polls a compact
      // snapshot, preventing high-rate WebSocket traffic from filling IPC.
      latestCandles.set(symbol, { raw, receivedAt });
    } catch {
      // Invalid frames are rejected in the parent normalizer when surfaced.
    }
  });
  nextSocket.on("error", (error) => send({ type: "error", symbol: symbols.join(","), message: error.message, code: (error as { code?: string }).code }));
  nextSocket.on("close", (code) => {
    if (socket !== nextSocket) return;
    socket = undefined;
    for (const symbol of symbols) send({ type: "disconnected", symbol, code });
    if (!stopped) setTimeout(() => connect(symbols, baseUrl), 1_000);
  });
}

function startSnapshotServer(symbols: string[], baseUrl: string) {
  snapshotServer = createServer((request, response) => {
    if (request.url !== "/snapshot") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ candles: [...latestCandles.entries()].map(([symbol, candle]) => ({ symbol, ...candle })) }));
  });
  snapshotServer.listen(0, "127.0.0.1", () => {
    const address = snapshotServer?.address();
    if (!address || typeof address === "string") return;
    send({ type: "ready", port: address.port });
    connect(symbols, baseUrl);
  });
}

const watchdog = setInterval(() => {
  const now = Date.now();
  for (const [symbol, last] of lastMessageAt) {
    if (socket?.readyState === WebSocket.OPEN && now - last > 15_000) {
      send({ type: "stale", symbol, idleMs: now - last });
      socket.terminate();
      break;
    }
  }
}, 3_000);

process.on("message", (message: ParentConfig) => {
  if (message.type === "start") {
    startSnapshotServer(message.symbols, message.baseUrl);
  }
  if (message.type === "stop") {
    stopped = true;
    clearInterval(watchdog);
    socket?.terminate();
    snapshotServer?.close();
    process.exit(0);
  }
});
