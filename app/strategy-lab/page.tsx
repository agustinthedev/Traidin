import type { Metadata } from "next";
import Dashboard from "../Dashboard";

export const metadata: Metadata = { title: "Strategy Lab | Treidin", description: "Constrained, reproducible strategy research." };
export default function StrategyLabPage() { return <Dashboard initialTab="Strategy Lab" />; }
