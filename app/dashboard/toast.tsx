"use client";

import { useEffect, useState } from "react";

export type ToastTone = "loading" | "success" | "error" | "info";
type ToastInput = { id?: string; tone: ToastTone; title: string; message?: string };
type Toast = ToastInput & { id: string };
const EVENT_NAME = "treidin:toast";
let sequence = 0;

export function notifyToast(input: ToastInput) {
  const id = input.id ?? `toast-${Date.now()}-${++sequence}`;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<Toast>(EVENT_NAME, { detail: { ...input, id } }));
  }
  return id;
}

export function ToastViewport() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const receive = (event: Event) => {
      const toast = (event as CustomEvent<Toast>).detail;
      setToasts((current) => [toast, ...current.filter((item) => item.id !== toast.id)].slice(0, 4));
    };
    window.addEventListener(EVENT_NAME, receive);
    return () => window.removeEventListener(EVENT_NAME, receive);
  }, []);

  useEffect(() => {
    const timers = toasts.filter((toast) => toast.tone !== "loading").map((toast) =>
      window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), toast.tone === "error" ? 7000 : 4500),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [toasts]);

  return <aside className="toast-viewport" aria-live="polite" aria-label="Action status">{toasts.map((toast) => <div className={`toast toast-${toast.tone}`} key={toast.id} role={toast.tone === "error" ? "alert" : "status"}><span className="toast-icon" aria-hidden>{toast.tone === "loading" ? "…" : toast.tone === "success" ? "✓" : toast.tone === "error" ? "!" : "i"}</span><div><strong>{toast.title}</strong>{toast.message && <p>{toast.message}</p>}</div><button aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}>×</button></div>)}</aside>;
}
