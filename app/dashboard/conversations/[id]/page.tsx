import { WorkspaceRoute } from "@/components/workspace/WorkspaceRoute";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <WorkspaceRoute
      mode="live"
      view="calendar"
      conversationId={id}
    />
  );
}
