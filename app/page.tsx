import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { Workspace } from "@/components/workspace/Workspace";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getAuthenticatedLanternUser();
  const account = user?.email
    ? {
        email: user.email,
        displayName: user.displayName,
      }
    : null;

  return (
    <LanguageProvider>
      <Workspace account={account} initialMode="sample" />
    </LanguageProvider>
  );
}
