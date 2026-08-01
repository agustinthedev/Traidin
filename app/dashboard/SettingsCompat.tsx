import { Settings as SettingsPanel } from "./Panels";
import type { AnyRow } from "./ui";

export default function SettingsCompat({ config, health }: { config?: AnyRow; health?: AnyRow | null }) {
  return <SettingsPanel config={config} health={health ?? undefined} />;
}
