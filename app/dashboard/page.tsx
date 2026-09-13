import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { Workspace } from "@/components/workspace/Workspace";
import { createSessionSupabase } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createSessionSupabase();
  const {
    data: { user },
  } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  const displayName =
    typeof user?.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name.trim()
      : typeof user?.user_metadata?.name === "string"
        ? user.user_metadata.name.trim()
        : "";
  const account = user?.email
    ? {
        email: user.email,
        displayName: displayName || null,
      }
    : null;

  return (
    <LanguageProvider>
      <Workspace account={account} />
    </LanguageProvider>
  );
}
