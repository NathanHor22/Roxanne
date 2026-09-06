import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { Workspace } from "@/components/workspace/Workspace";

export default function DashboardPage() {
  return (
    <LanguageProvider>
      <Workspace />
    </LanguageProvider>
  );
}
