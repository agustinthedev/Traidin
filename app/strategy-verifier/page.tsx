import type { Metadata } from "next";
import Dashboard from "../Dashboard";

export const metadata: Metadata = { title: "Strategy Verifier | Treidin" };
export default function StrategyVerifierPage() { return <Dashboard initialTab="Strategy Verifier" />; }
