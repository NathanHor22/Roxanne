"use client";

import { CalendarDays, Database, Sparkles, Volume2 } from "lucide-react";

import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { useLanguage } from "@/components/i18n/LanguageProvider";

const integrations = [
  { id: "supabase", label: "Supabase", icon: Database },
  { id: "openai", label: "OpenAI", icon: Sparkles },
  { id: "agora", label: "Agora", icon: Volume2 },
  { id: "google", label: "Google Calendar", icon: CalendarDays },
] as const;

export function SettingsView({ status }: { status: Record<string, boolean> }) {
  const { dict } = useLanguage();

  return (
    <section className="settings-view">
      <header className="view-header">
        <p className="section-kicker">{dict.nav.settings}</p>
        <h1>{dict.settings.title}</h1>
      </header>
      <div className="settings-sections">
        <section className="settings-card">
          <div>
            <h2>{dict.settings.language}</h2>
            <p>{dict.settings.languageHint}</p>
          </div>
          <LanguageSwitcher />
        </section>

        <section>
          <div className="settings-section-title">
            <h2>{dict.settings.integrations}</h2>
            <p>{dict.settings.integrationsHint}</p>
          </div>
          <div className="integration-grid">
            {integrations.map(({ id, label, icon: Icon }) => {
              const live = Boolean(status[id]);
              return (
                <div key={id} className="integration-row">
                  <span className="integration-row__icon"><Icon /></span>
                  <span>
                    <strong>{label}</strong>
                    <small>
                      {live ? dict.settings.connected : dict.settings.needsSetup}
                    </small>
                  </span>
                  {id === "google" && !live ? (
                    <a
                      className="integration-action"
                      href="/api/google/connect?returnTo=%2Fdashboard%3Fview%3Dsettings"
                    >
                      {dict.settings.connect}
                    </a>
                  ) : null}
                  <i className={live ? "is-live" : ""} />
                </div>
              );
            })}
          </div>
        </section>

        <section className="settings-card">
          <div>
            <h2>{dict.settings.timezone}</h2>
            <p>{dict.settings.timezoneHint}</p>
          </div>
          <strong>Asia/Kuala_Lumpur</strong>
        </section>
        <section className="settings-card">
          <div>
            <h2>{dict.settings.account}</h2>
            <p>{dict.settings.accountHint}</p>
          </div>
          <strong>nathanhor2001@gmail.com</strong>
        </section>
      </div>
    </section>
  );
}
