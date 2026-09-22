import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import type { WorkspaceMode } from "@/lib/workspace/model";
import { Workspace, type WorkspaceView } from "./Workspace";
import { getServerSupabase } from "@/lib/supabase/server";
import { validTimezone } from "@/lib/quipus-profile";
import { Suspense } from "react";

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
  const profile = user ? await getServerSupabase()?.from("profiles").select("name,timezone").eq("id", user.id).maybeSingle() : null;
  const account = user?.email
    ? {
        email: user.email,
        displayName: profile?.data?.name || user.displayName,
        timezone: validTimezone(profile?.data?.timezone),
      }
    : null;

  return (
    <LanguageProvider>
      <Suspense fallback={<div role="status">Opening Quipus…</div>}><Workspace
        account={account}
        initialMode={mode}
        initialView={view}
        initialConversationId={conversationId}
      /></Suspense>
    </LanguageProvider>
  );
}
