"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  CalendarDays,
  Database,
  Headphones,
  MessageCircle,
  QrCode,
  Sparkles,
  Volume2,
} from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";

const integrations = [
  { id: "supabase", label: "Supabase", icon: Database },
  { id: "elevenlabs", label: "Groq Whisper", icon: Headphones },
  { id: "qwen", label: "Qwen", icon: Sparkles },
  { id: "devin", label: "Devin", icon: Activity },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "google", label: "Google Calendar", icon: CalendarDays },
  { id: "agora", label: "Agora", icon: Volume2 },
  { id: "redis", label: "Redis", icon: Database },
] as const;

export function SettingsView({ status }: { status: Record<string, boolean> }) {
  const { dict } = useLanguage();
  const [whatsAppState, setWhatsAppState] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshWhatsApp = async () => {
    try {
      const response = await fetch("/api/whatsapp/status", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as {
        status?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "WhatsApp status failed.");
      setWhatsAppState(payload.status || null);
      setError(null);
    } catch (cause) {
      setWhatsAppState(null);
      if (status.whatsappRelay) {
        setError(cause instanceof Error ? cause.message : dict.errors.network);
      }
    }
  };

  useEffect(() => {
    if (status.whatsappRelay) void refreshWhatsApp();
    // The relay configuration itself changes only when the parent refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.whatsappRelay]);

  const pairWhatsApp = async () => {
    setWorking(true);
    setError(null);
    setQr(null);
    try {
      const response = await fetch("/api/whatsapp/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true, phone: "01154444038" }),
      });
      const payload = await response.json().catch(() => ({})) as {
        code?: string;
        error?: string;
      };
      if (!response.ok || !payload.code) {
        throw new Error(payload.error || "WhatsApp pairing failed.");
      }
      setPairingCode(payload.code);
      await refreshWhatsApp();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : dict.errors.generic);
    } finally {
      setWorking(false);
    }
  };

  const loadQr = async () => {
    setWorking(true);
    setError(null);
    setPairingCode(null);
    try {
      const response = await fetch("/api/whatsapp/qr", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as {
        qr?: string;
        error?: string;
      };
      if (!response.ok || !payload.qr) {
        throw new Error(payload.error || "WhatsApp QR is not ready yet.");
      }
      setQr(payload.qr);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : dict.errors.generic);
    } finally {
      setWorking(false);
    }
  };

  const isWhatsAppConnected = whatsAppState === "connected";

  return (
    <section className="settings-view">
      <header className="view-header"><p className="section-kicker">{dict.nav.settings}</p><h1>{dict.settings.title}</h1></header>
      <div className="settings-sections">
        <section className="settings-card"><div><h2>{dict.settings.language}</h2><p>{dict.settings.languageHint}</p></div><LanguageSwitcher /></section>
        <section><div className="settings-section-title"><h2>{dict.settings.integrations}</h2><p>{dict.settings.integrationsHint}</p></div><div className="integration-grid">
          {integrations.map(({ id, label, icon: Icon }) => {
            const live = id === "whatsapp" ? isWhatsAppConnected : status[id];
            return (
              <div key={id} className="integration-row">
                <span className="integration-row__icon"><Icon /></span>
                <span><strong>{label}</strong><small>{live ? dict.settings.connected : status[id] ? dict.settings.configured : dict.settings.needsSetup}</small></span>
                {id === "google" && !live ? <a className="integration-action" href="/api/google/connect?returnTo=%2Fdashboard%3Fview%3Dsettings">{dict.settings.connect}</a> : null}
                {id === "whatsapp" && status.whatsappRelay && !live ? <button type="button" className="integration-action" disabled={working} onClick={() => void pairWhatsApp()}>{dict.settings.connect}</button> : null}
                <i className={live ? "is-live" : ""} />
              </div>
            );
          })}
        </div></section>
        {status.whatsappRelay && !isWhatsAppConnected ? (
          <section className="settings-card whatsapp-setup">
            <div>
              <h2>{dict.settings.whatsappLink}</h2>
              <p>{dict.settings.whatsappHint}</p>
              {pairingCode ? <strong className="pairing-code">{pairingCode}</strong> : null}
              {error ? <p className="composer__error" role="alert">{error}</p> : null}
            </div>
            <div className="whatsapp-setup__actions">
              <button type="button" className="button button--ghost" disabled={working} onClick={() => void loadQr()}><QrCode />QR</button>
              <button type="button" className="button button--primary" disabled={working} onClick={() => void pairWhatsApp()}><MessageCircle />{working ? dict.common.loading : dict.settings.connect}</button>
              {qr ? <img src={qr} width="180" height="180" alt="WhatsApp pairing QR code" /> : null}
            </div>
          </section>
        ) : null}
        <section className="settings-card"><div><h2>{dict.settings.timezone}</h2><p>{dict.settings.timezoneHint}</p></div><strong>Asia/Kuala_Lumpur</strong></section>
        <section className="settings-card"><div><h2>{dict.settings.account}</h2><p>{dict.settings.accountHint}</p></div><strong>nathanhor2001@gmail.com</strong></section>
      </div>
    </section>
  );
}
