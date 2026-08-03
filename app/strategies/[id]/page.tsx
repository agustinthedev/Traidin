import type { Metadata } from "next";
import Dashboard from "../../Dashboard";

export const metadata: Metadata = { title: "Strategy | Treidin" };
export default async function StrategyPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Dashboard initialTab="Strategies" initialStrategyId={id} />; }
