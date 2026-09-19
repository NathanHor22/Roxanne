import { WorkspaceRoute } from "@/components/workspace/WorkspaceRoute";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return <WorkspaceRoute mode="live" view="calendar" />;
}
