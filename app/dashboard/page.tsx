import { WorkspaceRoute } from "@/components/workspace/WorkspaceRoute";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  return <WorkspaceRoute mode="live" view="overview" />;
}
