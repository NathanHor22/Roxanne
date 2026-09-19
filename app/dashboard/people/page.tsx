import { WorkspaceRoute } from "@/components/workspace/WorkspaceRoute";

export const dynamic = "force-dynamic";

export default function PeoplePage() {
  return <WorkspaceRoute mode="live" view="people" />;
}
