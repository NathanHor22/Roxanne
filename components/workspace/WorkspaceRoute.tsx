import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import type { WorkspaceMode } from "@/lib/workspace/model";
import { Workspace, type WorkspaceView } from "./Workspace";

export async function WorkspaceRoute({
  mode,
  view,
  conversationId,
}: {
  mode: WorkspaceMode;
  view: WorkspaceView;
  conversationId?: string;
}) {
  const user = await getAuthenticatedLanternUser();
  const account = user?.email
    ? {
        email: user.email,
        displayName: user.displayName,
      }
    : null;

  return (
    <LanguageProvider>
      <Workspace
        account={account}
        initialMode={mode}
        initialView={view}
        initialConversationId={conversationId}
      />
    </LanguageProvider>
  );
}
