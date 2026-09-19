"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BatteryMedium,
  CheckCircle2,
  CircleAlert,
  Cpu,
  ExternalLink,
  Gauge,
  HardDrive,
  KeyRound,
  LoaderCircle,
  Radio,
  RefreshCw,
  ShieldCheck,
  Signal,
  Unplug,
  Wifi,
} from "lucide-react";

import { lanternStateLabel, type LanternState } from "@/lib/lantern-state";
import type { WorkspaceMode } from "@/lib/workspace/model";
import styles from "./lantern-device.module.css";

interface DeviceRecord {
  id: string;
  name: string;
  model: string | null;
  firmware_version: string | null;
  last_seen_at: string | null;
  status: string;
  device_state: LanternState;
  state_version: number;
  battery_level: number | null;
  network_type: "wifi" | "cellular" | "offline" | null;
  free_heap_bytes: number | null;
  last_error: string | null;
}

const setupAddress = "http://192.168.4.1/";

function relativeLastSeen(value: string | null) {
  if (!value) return "Waiting for first heartbeat";
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Last seen recently";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Seen just now";
  if (minutes < 60) return `Seen ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Seen ${hours} hr ago`;
  return `Seen ${Math.floor(hours / 24)} day${hours >= 48 ? "s" : ""} ago`;
}

function heapLabel(bytes: number | null) {
  if (bytes == null) return "Not reported";
  return `${Math.max(0, bytes / 1024).toFixed(0)} KB free`;
}

export function LanternDevicePanel({
  mode,
  integrations,
  conversationCount,
}: {
  mode: WorkspaceMode;
  integrations: Record<string, boolean>;
  conversationCount: number;
}) {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [loading, setLoading] = useState(mode === "live");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const loadDevices = useCallback(async (showLoading = false) => {
    if (mode !== "live") {
      setDevices([]);
      setLoading(false);
      return;
    }
    if (showLoading) setLoading(true);
    try {
      const response = await fetch("/api/devices", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        devices?: DeviceRecord[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || "Device status is unavailable.");
      setDevices(payload.devices || []);
      setDeviceError(null);
    } catch (cause) {
      setDeviceError(
        cause instanceof Error ? cause.message : "Device status is unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void loadDevices(true);
    if (mode !== "live") return;
    const refresh = window.setInterval(() => void loadDevices(), 15_000);
    return () => window.clearInterval(refresh);
  }, [loadDevices, mode]);

  const createPairing = async () => {
    setWorking(true);
    setDeviceError(null);
    try {
      const response = await fetch("/api/devices/pairing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "My Lantern" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        pairing?: { code: string; expiresAt: string };
        error?: string;
      };
      if (!response.ok || !payload.pairing)
        throw new Error(payload.error || "Pairing could not begin.");
      setPairingCode(payload.pairing.code);
      setPairingExpiresAt(payload.pairing.expiresAt);
      setDeviceNotice("Pairing code ready. Lantern will advertise its setup Wi-Fi until reconnection finishes.");
    } catch (cause) {
      setDeviceError(
        cause instanceof Error ? cause.message : "Pairing could not begin.",
      );
    } finally {
      setWorking(false);
    }
  };

  const revokeDevice = async (deviceId: string) => {
    setWorking(true);
    setDeviceError(null);
    try {
      const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        revoked?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.revoked)
        throw new Error(payload.error || "Lantern could not be revoked.");
      setDevices((current) => current.filter((device) => device.id !== deviceId));
      setPairingCode(null);
      setDeviceNotice(
        "Access revoked. Keep Lantern powered on for up to 20 seconds while it opens setup mode, then create a new pairing code.",
      );
    } catch (cause) {
      setDeviceError(
        cause instanceof Error ? cause.message : "Lantern could not be revoked.",
      );
    } finally {
      setWorking(false);
    }
  };

  const primaryDevice = devices[0] || null;
  const lastSeen = useMemo(
    () => relativeLastSeen(primaryDevice?.last_seen_at || null),
    [primaryDevice?.last_seen_at],
  );

  if (loading) {
    return (
      <section className={styles.deviceLoading} aria-live="polite">
        <LoaderCircle />
        <p>Checking your Lantern…</p>
      </section>
    );
  }

  if (mode === "sample" || !primaryDevice) {
    return (
      <section className={styles.pairingLayout} aria-label="Lantern setup">
        <div className={styles.pairingIntro}>
          <span className={styles.pairingIcon}><Radio /></span>
          <span className={styles.kicker}>PAIR YOUR LANTERN</span>
          <h2>Connect the recorder once.</h2>
          <p>
            Lantern will remember the workspace and upload completed conversations
            whenever it can reach your 2.4 GHz hotspot.
          </p>
          {mode === "sample" ? (
            <Link className={styles.pairingPrimary} href="/login?next=%2Fdashboard%2Flantern">
              Sign in to pair a device
            </Link>
          ) : pairingCode ? (
            <div className={styles.activePairingCode}>
              <span>ONE-TIME PAIRING CODE</span>
              <strong>{pairingCode}</strong>
              <small>
                Expires {pairingExpiresAt
                  ? new Date(pairingExpiresAt).toLocaleTimeString("en-MY", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "soon"}
              </small>
            </div>
          ) : (
            <button
              className={styles.pairingPrimary}
              disabled={working}
              onClick={() => void createPairing()}
            >
              <KeyRound /> {working ? "Creating…" : "Create pairing code"}
            </button>
          )}
          {deviceNotice && <p className={styles.deviceNotice} role="status">{deviceNotice}</p>}
          {deviceError && <p className={styles.deviceError} role="alert">{deviceError}</p>}
        </div>

        <div className={styles.setupSteps}>
          <header>
            <span className={styles.kicker}>FIRST-TIME SETUP</span>
            <span><Wifi /> 2.4 GHz hotspot</span>
          </header>
          <ol>
            <li>
              <span>1</span>
              <div>
                <strong>Create the pairing code</strong>
                <p>Keep this page open. The code expires and works only once.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Join Lantern-XXXX</strong>
                <p>Wait up to 20 seconds after revoking. If it does not appear, hold the touchscreen for eight seconds to reset locally.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Open the setup page</strong>
                <p>Enter the pairing code. Enter hotspot details on first setup, or leave them blank to keep the saved Wi-Fi.</p>
                <a href={setupAddress} target="_blank" rel="noreferrer">
                  Open 192.168.4.1 <ExternalLink />
                </a>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>Return here when the screen says paired</strong>
                <p>This page will switch to device health after the first heartbeat.</p>
              </div>
            </li>
          </ol>
          <footer>
            <ShieldCheck /> Your hotspot password stays on the Lantern.
          </footer>
        </div>
      </section>
    );
  }

  const deviceHealthy = primaryDevice.status === "online" && !primaryDevice.last_error;

  return (
    <section className={styles.healthLayout} aria-label="Lantern device health">
      <header className={styles.healthHero}>
        <div className={styles.deviceIdentity}>
          <span className={styles.connectedRing}><Radio /></span>
          <div>
            <span className={styles.kicker}>PAIRED DEVICE</span>
            <h2>{primaryDevice.name}</h2>
            <p>{primaryDevice.model || "ESP32-S3 Lantern"} · {lastSeen}</p>
          </div>
        </div>
        <span className={deviceHealthy ? styles.onlineBadge : styles.attentionBadge}>
          {deviceHealthy ? <CheckCircle2 /> : <CircleAlert />}
          {deviceHealthy ? "Online" : primaryDevice.status || "Needs attention"}
        </span>
      </header>

      {deviceError && <p className={styles.deviceError} role="alert">{deviceError}</p>}

      <div className={styles.healthStats}>
        <article>
          <BatteryMedium />
          <span><strong>{primaryDevice.battery_level ?? "—"}%</strong><small>Battery</small></span>
        </article>
        <article>
          <Signal />
          <span><strong>{primaryDevice.network_type || "Unknown"}</strong><small>Connection</small></span>
        </article>
        <article>
          <Gauge />
          <span><strong>{lanternStateLabel(primaryDevice.device_state)}</strong><small>Current state</small></span>
        </article>
        <article>
          <HardDrive />
          <span><strong>{conversationCount}</strong><small>Conversations</small></span>
        </article>
      </div>

      <div className={styles.healthGrid}>
        <section className={styles.deviceDetails}>
          <header>
            <div><span className={styles.kicker}>DEVICE DETAILS</span><h3>Hardware and firmware</h3></div>
            <button aria-label="Refresh device status" disabled={working} onClick={() => void loadDevices(true)}>
              <RefreshCw /> Refresh
            </button>
          </header>
          <dl>
            <div><dt><Cpu /> Firmware</dt><dd>{primaryDevice.firmware_version || "Not reported"}</dd></div>
            <div><dt><Radio /> Model</dt><dd>{primaryDevice.model || "ESP32-S3"}</dd></div>
            <div><dt><HardDrive /> Available memory</dt><dd>{heapLabel(primaryDevice.free_heap_bytes)}</dd></div>
            <div><dt><ShieldCheck /> Device access</dt><dd>Paired to this workspace</dd></div>
          </dl>
          {primaryDevice.last_error && (
            <div className={styles.lastError}>
              <CircleAlert />
              <span><strong>Last device error</strong><p>{primaryDevice.last_error}</p></span>
            </div>
          )}
        </section>

        <aside className={styles.connectionCard}>
          <span className={styles.kicker}>CONNECTIONS</span>
          <h3>Capture services</h3>
          <ul>
            <li><span><i className={integrations.agora ? styles.goodDot : styles.neutralServiceDot} />Agora transcription</span><strong>{integrations.agora ? "Ready" : "Check setup"}</strong></li>
            <li><span><i className={integrations.openai ? styles.goodDot : styles.neutralServiceDot} />OpenAI processing</span><strong>{integrations.openai ? "Ready" : "Check setup"}</strong></li>
            <li><span><i className={styles.goodDot} />Workspace pairing</span><strong>Ready</strong></li>
          </ul>
          <a className={styles.wifiAction} href={setupAddress} target="_blank" rel="noreferrer">
            <Wifi /> Reconfigure Wi-Fi <ExternalLink />
          </a>
          <p>Join the Lantern-XXXX setup network before opening the Wi-Fi page.</p>
        </aside>
      </div>

      <footer className={styles.deviceDangerZone}>
        <div>
          <strong>Remove this Lantern</strong>
          <p>Revoking access stops uploads and makes the device reopen pairing setup when it next contacts Lantern.</p>
        </div>
        <button disabled={working} onClick={() => void revokeDevice(primaryDevice.id)}>
          <Unplug /> {working ? "Removing…" : "Revoke device"}
        </button>
      </footer>
    </section>
  );
}
