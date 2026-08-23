import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { RoxanneApp } from "@/components/RoxanneApp";

export default function HomePage() {
  return (
    <LanguageProvider>
      <RoxanneApp />
    </LanguageProvider>
  );
}
