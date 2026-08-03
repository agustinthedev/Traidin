import type { Metadata } from "next";
import Dashboard from "../../../Dashboard";

export const metadata: Metadata = { title: "Research Run | Strategy Lab | Treidin" };
export default async function ResearchRunPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Dashboard initialTab="Strategy Lab" initialResearchRunId={id} />; }
