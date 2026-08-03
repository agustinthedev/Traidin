import type { Metadata } from "next";
import Dashboard from "../Dashboard";

export const metadata: Metadata = { title: "Strategies | Treidin", description: "Catalog of versioned Strategies and their verification coverage." };
export default function StrategiesPage() { return <Dashboard initialTab="Strategies" />; }
