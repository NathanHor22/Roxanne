import { WorkspaceRoute } from "@/components/workspace/WorkspaceRoute";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <WorkspaceRoute mode="live" view="settings" />;
}
