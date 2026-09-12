"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BatteryMedium,
  Check,
  CloudOff,
  Gauge,
  LoaderCircle,
  Mic2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Square,
  Volume2,
  Wifi,
} from "lucide-react";

import {
  advanceLantern,
  createLanternMachine,
  lanternStateLabel,
  type LanternEvent,
  type LanternMachine,
  type LanternState,
} from "@/lib/lantern-state";
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

const statusCopy: Record<LanternState, string> = {
  connecting: "Finding a trusted connection",
  ready: "Say “Ring” or use the main button",
  awaiting_recording_consent: "Has everyone agreed to this recording?",
  recording: "Conversation capture is active",
  paused: "Capture is paused",
  offline_buffering: "Holding a short protected audio buffer",
  finalising: "Closing and checking the audio manifest",
  processing: "The recording is safe. Preparing the recap.",
  report_ready: "The conversation is ready in Roxanne",
  oath_listening: "Green Lantern of Sector 2418, state your oath",
  status_report: "Three conversations. One approval needs you.",
  awaiting_action_confirmation:
    "Nigel, Friday 18 September, 1:00 PM MYT, 45 minutes",
  pending_dashboard_approval: "Prepared in Roxanne. Nothing has been sent.",
  error: "Use the recovery instruction shown below",
};

function futurePrompt(now: Date) {
  return new Date(now.getTime() + 30_000).toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function elapsedLabel(startedAt: string | null, tick: number) {
  if (!startedAt) return "00:00";
  const total = Math.max(0, Math.floor((tick - Date.parse(startedAt)) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function LanternDevicePanel({
  mode,
  integrations,
}: {
  mode: WorkspaceMode;
  integrations: Record<string, boolean>;
}) {
  const [machine, setMachine] = useState<LanternMachine>(() =>
    createLanternMachine("ready"),
  );
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [pairingWorking, setPairingWorking] = useState(false);

  useEffect(() => {
    if (machine.state !== "recording") return;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [machine.state]);

  useEffect(() => {
    if (mode !== "live") {
      setDevices([]);
      setDeviceError(null);
      return;
    }
    const controller = new AbortController();
    const loadDevices = () => {
      void fetch("/api/devices", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const payload = (await response.json().catch(() => ({}))) as {
            devices?: DeviceRecord[];
            error?: string;
          };
          if (!response.ok) {
            throw new Error(payload.error || "Device status is unavailable.");
          }
          setDevices(payload.devices || []);
          setDeviceError(null);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setDeviceError(
              cause instanceof Error ? cause.message : "Device status is unavailable.",
            );
          }
        });
    };
    loadDevices();
    const refresh = window.setInterval(loadDevices, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(refresh);
    };
  }, [mode]);

  const dispatch = (event: LanternEvent) => {
    try {
      setMachine((current) => advanceLantern(current, event));
      setTransitionError(null);
      setTick(Date.now());
    } catch (cause) {
      setTransitionError(
        cause instanceof Error ? cause.message : "That action is not available.",
      );
    }
  };

  const now = () => new Date();
  const startQuick = () => {
    const current = now();
    dispatch({
      type: "BEGIN_QUICK",
      at: current.toISOString(),
      sessionId: makeId("quick"),
      promptId: makeId("consent"),
      promptExpiresAt: futurePrompt(current),
    });
  };
  const startStatus = () =>
    dispatch({
      type: "BEGIN_STATUS",
      at: now().toISOString(),
      sessionId: makeId("report"),
    });
  const answerPrompt = (accepted: boolean) => {
    if (!machine.prompt) return;
    dispatch({
      type:
        machine.prompt.kind === "recording_consent"
          ? "RECORDING_CONSENT"
          : "ACTION_CONFIRMATION",
      at: now().toISOString(),
      promptId: machine.prompt.id,
      accepted,
    });
  };
  const proposeAction = () => {
    const current = now();
    dispatch({
      type: "ACTION_PROPOSED",
      at: current.toISOString(),
      proposalId: makeId("proposal"),
      promptId: makeId("confirmation"),
      promptExpiresAt: futurePrompt(current),
    });
  };

  const createPairing = async () => {
    if (mode === "sample") {
      setPairingCode("24G7N-8R5XQ");
      setPairingExpiresAt(new Date(Date.now() + 10 * 60_000).toISOString());
      return;
    }
    setPairingWorking(true);
    setDeviceError(null);
    try {
      const response = await fetch("/api/devices/pairing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Nathan's Lantern" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        pairing?: { code: string; expiresAt: string };
        error?: string;
      };
      if (!response.ok || !payload.pairing) {
        throw new Error(payload.error || "Pairing could not begin.");
      }
      setPairingCode(payload.pairing.code);
      setPairingExpiresAt(payload.pairing.expiresAt);
    } catch (cause) {
      setDeviceError(
        cause instanceof Error ? cause.message : "Pairing could not begin.",
      );
    } finally {
      setPairingWorking(false);
    }
  };

  const revokeDevice = async (deviceId: string) => {
    setPairingWorking(true);
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
      if (!response.ok || !payload.revoked) {
        throw new Error(payload.error || "Lantern could not be revoked.");
      }
      setDevices((current) => current.filter((device) => device.id !== deviceId));
    } catch (cause) {
      setDeviceError(
        cause instanceof Error ? cause.message : "Lantern could not be revoked.",
      );
    } finally {
      setPairingWorking(false);
    }
  };

  const primaryDevice = devices[0];
  const screenTone = useMemo(() => {
    if (machine.state === "recording") return styles.screenRecording;
    if (machine.state === "offline_buffering" || machine.state === "error")
      return styles.screenWarning;
    if (
      machine.state === "pending_dashboard_approval" ||
      machine.state === "awaiting_action_confirmation"
    )
      return styles.screenApproval;
    return styles.screenReady;
  }, [machine.state]);

  return (
    <section className={styles.layout} aria-label="Lantern device workspace">
      <div className={styles.prototypeNotice}>
        <ShieldCheck />
        <span>
          <strong>
            {mode === "sample" ? "Interactive flow preview" : "Agora capture pilot"}
          </strong>
          {mode === "sample"
            ? "This exercises Lantern’s consent and approval rules. It records no audio and contacts nobody."
            : integrations.agora && integrations.ilmu
              ? "A paired Lantern can capture a 30-second conversation, send it through Agora and Ilmu, and add the recording and recap here automatically."
              : "The capture build is ready. Connect Agora and Ilmu in the server environment before installing it on the Lantern."}
        </span>
      </div>

      <div className={styles.heroGrid}>
        <section className={styles.deviceStage}>
          <div className={`${styles.deviceShell} ${screenTone}`}>
            <div className={styles.deviceTopline}>
              <span>
                <Wifi /> {machine.state === "offline_buffering" ? "Offline" : "MYT"}
              </span>
              <BatteryMedium />
            </div>
            <div className={styles.ring} aria-hidden="true">
              <span />
            </div>
            <div className={styles.screenText}>
              {machine.state === "recording" ? (
                <span className={styles.recLabel}><i /> REC</span>
              ) : null}
              <strong>{lanternStateLabel(machine.state)}</strong>
              <p>{statusCopy[machine.state]}</p>
              {machine.state === "recording" ? (
                <time>{elapsedLabel(machine.recordingStartedAt, tick)}</time>
              ) : null}
              {machine.state === "offline_buffering" ? (
                <time>{machine.bufferedSeconds}s buffered</time>
              ) : null}
            </div>
          </div>
          <div className={styles.hardwareLabel}>
            <span>ZHENGCHEN · ESP32-S3</span>
            <small>240 × 240 screen preview</small>
          </div>
        </section>

        <section className={styles.controlPanel}>
          <header>
            <span className={styles.kicker}>DEVICE FLOW</span>
            <span className={styles.version}>State {machine.version}</span>
          </header>
          <h2>{lanternStateLabel(machine.state)}</h2>
          <p>{statusCopy[machine.state]}</p>

          <div className={styles.controls}>
            {machine.state === "ready" || machine.state === "report_ready" ? (
              <>
                <button className={styles.primary} onClick={startQuick}>
                  <Mic2 /> Start quick meeting
                </button>
                <button className={styles.secondary} onClick={startStatus}>
                  <Radio /> Start status report
                </button>
              </>
            ) : null}
            {machine.state === "awaiting_recording_consent" ? (
              <>
                <button className={styles.primary} onClick={() => answerPrompt(true)}>
                  <Check /> Yes, everyone agreed
                </button>
                <button className={styles.secondary} onClick={() => answerPrompt(false)}>
                  Cancel meeting
                </button>
              </>
            ) : null}
            {machine.state === "recording" ? (
              <>
                <button
                  className={styles.primary}
                  onClick={() => dispatch({ type: "PAUSE", at: now().toISOString() })}
                >
                  <Pause /> Pause capture
                </button>
                <button
                  className={styles.danger}
                  onClick={() => dispatch({ type: "STOP", at: now().toISOString() })}
                >
                  <Square /> We’re done
                </button>
                <button
                  className={styles.textAction}
                  onClick={() => dispatch({ type: "CONNECTION_LOST", at: now().toISOString() })}
                >
                  Simulate connection loss
                </button>
              </>
            ) : null}
            {machine.state === "paused" ? (
              <>
                <button
                  className={styles.primary}
                  onClick={() => dispatch({ type: "RESUME", at: now().toISOString() })}
                >
                  <Play /> Resume
                </button>
                <button
                  className={styles.danger}
                  onClick={() => dispatch({ type: "STOP", at: now().toISOString() })}
                >
                  <Square /> End meeting
                </button>
              </>
            ) : null}
            {machine.state === "offline_buffering" ? (
              <>
                <button
                  className={styles.secondary}
                  onClick={() =>
                    dispatch({
                      type: "BUFFER_UPDATED",
                      at: now().toISOString(),
                      bufferedSeconds: Math.min(30, machine.bufferedSeconds + 5),
                    })
                  }
                >
                  <CloudOff /> Add 5 buffered seconds
                </button>
                <button
                  className={styles.primary}
                  onClick={() => dispatch({ type: "CONNECTION_RESTORED", at: now().toISOString() })}
                >
                  <Wifi /> Restore connection
                </button>
                <button
                  className={styles.danger}
                  onClick={() => dispatch({ type: "STOP", at: now().toISOString() })}
                >
                  <Square /> End safely
                </button>
              </>
            ) : null}
            {machine.state === "finalising" ? (
              <button
                className={styles.primary}
                onClick={() => dispatch({ type: "ARCHIVE_ACCEPTED", at: now().toISOString() })}
              >
                <Check /> Confirm archive received
              </button>
            ) : null}
            {machine.state === "processing" ? (
              <button
                className={styles.primary}
                onClick={() => dispatch({ type: "PROCESSING_COMPLETE", at: now().toISOString() })}
              >
                <LoaderCircle /> Complete mock processing
              </button>
            ) : null}
            {machine.state === "oath_listening" ? (
              <>
                <button
                  className={styles.primary}
                  onClick={() => dispatch({ type: "OATH_RESULT", at: now().toISOString(), accepted: true })}
                >
                  <Volume2 /> Accept completed oath
                </button>
                <button
                  className={styles.secondary}
                  onClick={() => dispatch({ type: "OATH_RESULT", at: now().toISOString(), accepted: false })}
                >
                  End ritual
                </button>
              </>
            ) : null}
            {machine.state === "status_report" ? (
              <>
                <div className={styles.reportCard}>
                  <span>MEETING 2 OF 3</span>
                  <strong>Mr. Chung · Follow-up agreed</strong>
                  <p>Friday, 18 September 2026 · 1:00 PM MYT · 45 minutes</p>
                  <small>n-i-g-e-l-t-a-n-j-c at gmail dot com</small>
                </div>
                <button className={styles.primary} onClick={proposeAction}>
                  Prepare this meeting
                </button>
                <button
                  className={styles.secondary}
                  onClick={() => dispatch({ type: "DISMISS_REPORT", at: now().toISOString() })}
                >
                  Finish report
                </button>
              </>
            ) : null}
            {machine.state === "awaiting_action_confirmation" ? (
              <>
                <button className={styles.primary} onClick={() => answerPrompt(true)}>
                  <Check /> Yes, prepare it
                </button>
                <button className={styles.secondary} onClick={() => answerPrompt(false)}>
                  No, continue report
                </button>
              </>
            ) : null}
            {machine.state === "pending_dashboard_approval" ? (
              <>
                <div className={styles.approvalCard}>
                  <span>WAITING FOR YOU</span>
                  <strong>Nothing has been sent</strong>
                  <p>The exact proposal version now requires dashboard approval.</p>
                </div>
                <button
                  className={styles.primary}
                  onClick={() => dispatch({ type: "DASHBOARD_RESOLVED", at: now().toISOString() })}
                >
                  <Check /> Mark dashboard review complete
                </button>
              </>
            ) : null}
            {machine.state === "error" ? (
              <button
                className={styles.primary}
                onClick={() => dispatch({ type: "RESET", at: now().toISOString() })}
              >
                <RotateCcw /> Return to ready
              </button>
            ) : null}
          </div>
          {transitionError ? <p className={styles.error} role="alert">{transitionError}</p> : null}
        </section>
      </div>

      <div className={styles.infoGrid}>
        <section className={styles.infoCard}>
          <header><Radio /><span>Registered device</span></header>
          <strong>{primaryDevice?.name || "Lantern prototype"}</strong>
          <p>
            {mode === "sample"
              ? "Sample mode uses the exact state rules without reaching providers."
              : deviceError || (primaryDevice ? `Last seen ${primaryDevice.last_seen_at ? new Date(primaryDevice.last_seen_at).toLocaleString("en-MY") : "not yet"}.` : "No registered device is available yet.")}
          </p>
          <span className={styles.detailPill}>
            {primaryDevice
              ? `${lanternStateLabel(primaryDevice.device_state)} · ${primaryDevice.battery_level ?? "—"}% · ${primaryDevice.network_type || "network unknown"}`
              : mode === "sample"
                ? "simulated"
                : "awaiting pairing"}
          </span>
          {mode === "live" && primaryDevice ? (
            <button
              type="button"
              className={styles.cardAction}
              disabled={pairingWorking}
              onClick={() => void revokeDevice(primaryDevice.id)}
            >
              Revoke device access
            </button>
          ) : null}
          {pairingCode ? (
            <div className={styles.pairingCode}>
              <span>PAIRING CODE</span>
              <strong>{pairingCode}</strong>
              <small>
                {mode === "sample"
                  ? "Preview only"
                  : `Expires ${pairingExpiresAt ? new Date(pairingExpiresAt).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" }) : "soon"}`}
              </small>
            </div>
          ) : (
            <button
              type="button"
              className={styles.cardAction}
              disabled={pairingWorking}
              onClick={() => void createPairing()}
            >
              {pairingWorking ? "Creating…" : mode === "sample" ? "Preview pairing" : "Create pairing code"}
            </button>
          )}
        </section>
        <section className={styles.infoCard}>
          <header><Gauge /><span>Hardware build</span></header>
          <strong>Lantern 0.2 capture firmware</strong>
          <p>The ESP32-S3 build is ready for the first provider-connected device test.</p>
          <span className={styles.detailPill}>
            {mode === "sample"
              ? "30-second flow preview"
              : integrations.agora && integrations.ilmu
                ? "Providers ready"
                : "Provider setup required"}
          </span>
        </section>
        <section className={styles.infoCard}>
          <header><Mic2 /><span>Capture contract</span></header>
          <strong>16 kHz mono · Agora Opus</strong>
          <p>The server stamps the exact Malaysia date and time when capture begins.</p>
          <span className={styles.detailPill}>Asia/Kuala_Lumpur</span>
        </section>
        <section className={styles.infoCard}>
          <header><ShieldCheck /><span>Action boundary</span></header>
          <strong>Voice prepares. You approve.</strong>
          <p>A spoken yes cannot contact a client in the first release.</p>
          <span className={styles.detailPill}>Enforced by state</span>
        </section>
      </div>
    </section>
  );
}
