import WebSocket from "ws";

type ParentConfig =
  | { type: "start"; symbols: string[]; baseUrl: string }
  | { type: "snapshot" }
  | { type: "stop" };

let stopped = false;
const sockets = new Map<string, WebSocket>();
const lastMessageAt = new Map<string, number>();
const latestCandles = new Map<string, { raw: string; receivedAt: number }>();

function send(message: Record<string, unknown>) {
  if (process.send) process.send(message);
}

function connect(symbol: string, baseUrl: string) {
  if (stopped) return;
  const url = new URL(baseUrl);
  url.searchParams.set("streams", `${symbol.toLowerCase()}@kline_1m`);
  const socket = new WebSocket(url, { handshakeTimeout: 15_000 });
  sockets.set(symbol, socket);
  socket.on("open", () => {
    lastMessageAt.set(symbol, Date.now());
    send({ type: "connected", symbol });
  });
  socket.on("message", (data) => {
    const receivedAt = Date.now();
    const raw = data.toString();
    lastMessageAt.set(symbol, receivedAt);

    // Keep the newest mutable candle here. The parent polls a compact
    // snapshot, preventing high-rate WebSocket traffic from filling IPC.
    latestCandles.set(symbol, { raw, receivedAt });
  });
  socket.on("error", (error) => send({ type: "error", symbol, message: error.message, code: (error as { code?: string }).code }));
  socket.on("close", (code) => {
    if (sockets.get(symbol) !== socket) return;
    sockets.delete(symbol);
    send({ type: "disconnected", symbol, code });
    if (!stopped) setTimeout(() => connect(symbol, baseUrl), 1_000);
  });
}

const watchdog = setInterval(() => {
  const now = Date.now();
  for (const [symbol, socket] of sockets) {
    const last = lastMessageAt.get(symbol) ?? now;
    if (socket.readyState === WebSocket.OPEN && now - last > 15_000) {
      send({ type: "stale", symbol, idleMs: now - last });
      socket.terminate();
    }
  }
}, 3_000);

process.on("message", (message: ParentConfig) => {
  if (message.type === "start") {
    for (const symbol of message.symbols) connect(symbol, message.baseUrl);
  }
  if (message.type === "snapshot") {
    send({ type: "snapshot", candles: [...latestCandles.entries()].map(([symbol, candle]) => ({ symbol, ...candle })) });
  }
  if (message.type === "stop") {
    stopped = true;
    clearInterval(watchdog);
    for (const socket of sockets.values()) socket.terminate();
    process.exit(0);
  }
});
