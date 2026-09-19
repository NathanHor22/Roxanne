import { WorkspaceRoute } from "@/components/workspace/WorkspaceRoute";

export const dynamic = "force-dynamic";

export default function ConversationsPage() {
  return <WorkspaceRoute mode="live" view="conversations" />;
}
