import WebSocket from "ws";

type ParentConfig = { type: "start"; symbols: string[]; baseUrl: string } | { type: "stop" };

let stopped = false;
const sockets = new Map<string, WebSocket>();
const lastMessageAt = new Map<string, number>();
const pendingCandles = new Map<string, { raw: string; receivedAt: number }>();
const candleInFlight = new Set<string>();

function send(message: Record<string, unknown>) {
  if (process.send) process.send(message);
}

function flushCandle(symbol: string) {
  if (candleInFlight.has(symbol)) return;
  const candle = pendingCandles.get(symbol);
  if (!candle) return;
  pendingCandles.delete(symbol);
  if (!process.send) return;
  candleInFlight.add(symbol);
  // Do not enqueue an unbounded series of IPC frames. The callback means the
  // previous frame has left this process; meanwhile pendingCandles retains
  // only the most recent mutable state for this symbol.
  process.send({ type: "candle", symbol, ...candle }, undefined, undefined, () => {
    candleInFlight.delete(symbol);
    flushCandle(symbol);
  });
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

    // Binance can publish many mutable updates for the same open candle per
    // second. The parent only needs the newest state, so coalesce them before
    // crossing the IPC boundary. A completed candle is never delayed.
    pendingCandles.set(symbol, { raw, receivedAt });
    try {
      const payload = JSON.parse(raw) as { data?: { k?: { x?: boolean } }; k?: { x?: boolean } };
      if (payload.data?.k?.x || payload.k?.x) flushCandle(symbol);
    } catch {
      flushCandle(symbol);
    }
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

const flushTimer = setInterval(() => {
  for (const symbol of pendingCandles.keys()) flushCandle(symbol);
}, 1_000);

process.on("message", (message: ParentConfig) => {
  if (message.type === "start") {
    for (const symbol of message.symbols) connect(symbol, message.baseUrl);
  }
  if (message.type === "stop") {
    stopped = true;
    clearInterval(watchdog);
    clearInterval(flushTimer);
    for (const socket of sockets.values()) socket.terminate();
    process.exit(0);
  }
});
