import type { Metadata } from "next";
import Dashboard from "../Dashboard";

export const metadata: Metadata = { title: "Strategy Builder | Treidin", description: "Create or edit versioned strategies manually." };
export default function StrategyBuilderPage() { return <Dashboard initialTab="Strategy Builder" />; }
