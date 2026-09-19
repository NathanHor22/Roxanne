import { WorkspaceRoute } from "@/components/workspace/WorkspaceRoute";

export const dynamic = "force-dynamic";

export default function LanternPage() {
  return <WorkspaceRoute mode="live" view="device" />;
}
