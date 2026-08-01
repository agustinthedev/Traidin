import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = {
  title: "Traidin Market Data",
  description: "Binance USDⓈ-M market data operations terminal",
};

export default function Home() { return <Dashboard />; }
