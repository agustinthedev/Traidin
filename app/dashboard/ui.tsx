import type { ReactNode } from "react";
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4100";
// API resources are heterogeneous JSON records validated by backend schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRow = Record<string, any>;
export const fmtNum = (value: unknown, max = 2) =>
  Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: max });
export const fmtTime = (value?: string | Date | null) =>
  value
    ? new Date(value).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        fractionalSecondDigits: 3,
      })
    : "—";
export const fmtDate = (value?: string | Date | number | null) =>
  value ? new Date(value).toLocaleString("en-GB", { hour12: false }) : "—";
export const bytes = (value: number) =>
  value < 1024
    ? `${value} B`
    : value < 1_048_576
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1_048_576).toFixed(1)} MB`;
export const localInput = (time: number) =>
  new Date(time - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
export async function apiJson(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok)
    throw new Error((await response.text()) || `HTTP ${response.status}`);
  return response.json();
}
export function StatusDot({ state }: { state: string }) {
  return <i className={`status-dot ${state.toLowerCase()}`} />;
}
export function PageHead({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <small>{eyebrow}</small>
        <h1>{title}</h1>
      </div>
      {aside}
    </div>
  );
}
export function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: string;
}) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}
export function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <strong>NO DATA LOADED</strong>
      <p>{text}</p>
    </div>
  );
}
