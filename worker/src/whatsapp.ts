import { createHash } from "node:crypto";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type ConnectionState,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import type { DeliveryStore, PostgresAuthStore } from "./database.js";
import { RequestError, assertAllowedRecipient } from "./protocol.js";
import { readDocument, reportRecipient, type DocumentPayload } from "./media.js";

const baileysLogger = pino({ level: "silent" });
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const DELIVERY_LEASE_MS = 120_000;
const DELIVERY_HEARTBEAT_MS = 30_000;

export type WhatsAppStatus =
  | "starting"
  | "qr_ready"
  | "connected"
  | "disconnected"
  | "logged_out"
  | "error";

export interface WhatsAppSnapshot {
  status: WhatsAppStatus;
  phone: string | null;
  since: string | null;
  qrAvailable: boolean;
  reconnectAttempt: number;
}

export interface SendResult {
  id: string;
  duplicate: boolean;
  to: string;
}

function disconnectStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const output = (error as { output?: { statusCode?: unknown } }).output;
  return typeof output?.statusCode === "number" ? output.statusCode : undefined;
}

function providerMessageId(workspaceKey: string, idempotencyKey: string): string {
  // Reusing this ID makes a retry after "sent but DB update failed" safe at WhatsApp too.
  const hash = createHash("sha256")
    .update(`${workspaceKey}\0${idempotencyKey}`)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
  return `ROXANNE${hash}`;
}

export class WhatsAppWorker {
  private socket: WASocket | null = null;
  private status: WhatsAppStatus = "disconnected";
  private qrDataUrl: string | null = null;
  private connectedPhone: string | null = null;
  private connectedSince: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectPromise: Promise<void> | null = null;
  private intentionalClose = false;
  private generation = 0;
  private readonly inFlight = new Map<string, Promise<SendResult>>();

  constructor(
    private readonly authStore: PostgresAuthStore,
    private readonly deliveryStore: DeliveryStore,
    private readonly workspaceKey: string,
  ) {}

  snapshot(): WhatsAppSnapshot {
    return {
      status: this.status,
      phone: this.connectedPhone,
      since: this.connectedSince,
      qrAvailable: this.qrDataUrl !== null,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  getQr(): string | null {
    return this.qrDataUrl;
  }

  start(): Promise<void> {
    if (this.socket || this.connectPromise) return this.connectPromise ?? Promise.resolve();
    this.intentionalClose = false;
    this.clearReconnectTimer();
    this.connectPromise = this.connect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    this.status = "starting";

    try {
      const { state, saveCreds } = await this.authStore.load();
      const latest = await fetchLatestBaileysVersion().catch(() => ({
        version: undefined,
        isLatest: false,
      }));
      if (generation !== this.generation || this.intentionalClose) return;

      const socket = makeWASocket({
        ...(latest.version ? { version: latest.version } : {}),
        auth: state,
        logger: baileysLogger,
        printQRInTerminal: false,
        browser: ["Lantern", "Desktop", "0.1.0"],
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });
      this.socket = socket;

      socket.ev.on("creds.update", () => {
        if (generation !== this.generation || this.intentionalClose) return;
        void saveCreds().catch((error: unknown) => {
          console.error("[whatsapp] could not persist credentials", error);
        });
      });
      socket.ev.on("connection.update", (update) => {
        void this.handleConnectionUpdate(update, socket, generation);
      });
    } catch (error) {
      if (generation !== this.generation || this.intentionalClose) return;
      this.status = "error";
      this.socket = null;
      console.error("[whatsapp] connection initialization failed", error);
      this.scheduleReconnect(generation);
    }
  }

  private async handleConnectionUpdate(
    update: Partial<ConnectionState>,
    socket: WASocket,
    generation: number,
  ): Promise<void> {
    if (generation !== this.generation || socket !== this.socket) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
        if (
          generation === this.generation &&
          socket === this.socket &&
          this.status !== "connected"
        ) {
          this.qrDataUrl = dataUrl;
          this.status = "qr_ready";
        }
      } catch (error) {
        console.error("[whatsapp] QR generation failed", error);
      }
    }

    if (connection === "open") {
      this.status = "connected";
      this.qrDataUrl = null;
      this.reconnectAttempt = 0;
      this.connectedPhone = socket.user?.id?.split(":")[0]?.replace(/\D/gu, "") || null;
      this.connectedSince = new Date().toISOString();
      console.info("[whatsapp] connected");
      return;
    }

    if (connection !== "close") return;
    this.socket = null;
    this.qrDataUrl = null;
    this.connectedPhone = null;
    this.connectedSince = null;
    const loggedOut =
      disconnectStatusCode(lastDisconnect?.error) === DisconnectReason.loggedOut;
    this.status = loggedOut ? "logged_out" : "disconnected";

    if (loggedOut) {
      this.intentionalClose = true;
      await this.authStore.clear().catch((error: unknown) => {
        console.error("[whatsapp] could not clear logged-out credentials", error);
      });
      console.warn("[whatsapp] linked device logged out; scan a new QR or request a pairing code");
      return;
    }
    if (!this.intentionalClose) this.scheduleReconnect(generation);
  }

  private scheduleReconnect(closedGeneration: number): void {
    if (this.intentionalClose || this.reconnectTimer) return;
    const attempt = this.reconnectAttempt++;
    const exponential = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    const delay = exponential + Math.floor(Math.random() * 1_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalClose || closedGeneration !== this.generation) return;
      void this.start();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  async requestPairingCode(input: unknown): Promise<{ code: string; phone: string }> {
    const phone = assertAllowedRecipient(input);
    if (this.status === "connected") {
      throw new RequestError(409, "WhatsApp is already connected.");
    }
    await this.start();
    if (!this.socket) {
      throw new RequestError(503, "WhatsApp is still starting; retry in a moment.");
    }
    const rawCode = await this.socket.requestPairingCode(phone);
    const code = rawCode.length === 8 ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}` : rawCode;
    return { code, phone };
  }

  async send(
    toInput: unknown,
    text: string,
    idempotencyKey: string,
    report?: { approved: true; document?: DocumentPayload },
  ): Promise<SendResult> {
    const existing = this.inFlight.get(idempotencyKey);
    if (existing) {
      const result = await existing;
      return { ...result, duplicate: true };
    }

    const operation = this.sendOnce(toInput, text, idempotencyKey, report);
    this.inFlight.set(idempotencyKey, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(idempotencyKey);
    }
  }

  private async sendOnce(
    toInput: unknown,
    text: string,
    idempotencyKey: string,
    report?: { approved: true; document?: DocumentPayload },
  ): Promise<SendResult> {
    const to = report?.approved ? reportRecipient(toInput) : assertAllowedRecipient(toInput);
    const claim = await this.deliveryStore.claim(idempotencyKey, DELIVERY_LEASE_MS);
    if (claim.status === "completed") {
      return { id: claim.providerMessageId, duplicate: true, to };
    }
    if (claim.status === "in_progress") {
      throw new RequestError(
        409,
        `This delivery is already in progress. Retry in ${Math.max(1, Math.ceil(claim.retryAfterMs / 1_000))} seconds.`,
      );
    }

    if (!this.socket || this.status !== "connected") {
      await this.deliveryStore.release(
        idempotencyKey,
        claim.leaseToken,
        "whatsapp_not_connected",
      );
      throw new RequestError(503, "WhatsApp is not connected. Pair it before sending.");
    }

    const reservedId = providerMessageId(this.workspaceKey, idempotencyKey);
    let stopped = false;
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (stopped || renewing) return;
      renewing = true;
      void this.deliveryStore
        .renew(idempotencyKey, claim.leaseToken, DELIVERY_LEASE_MS)
        .then((renewed) => {
          if (!stopped && !renewed) {
            console.warn("[whatsapp] delivery lease is no longer owned by this process");
          }
        })
        .catch((error: unknown) => {
          console.error("[whatsapp] delivery lease renewal failed", error);
        })
        .finally(() => {
          renewing = false;
        });
    }, DELIVERY_HEARTBEAT_MS);
    heartbeat.unref();

    try {
      const sent = await this.socket.sendMessage(
        `${to}@s.whatsapp.net`,
        report?.document ? { document: await readDocument(report.document), mimetype: report.document.mimeType, fileName: report.document.fileName } : { text },
        { messageId: reservedId },
      );
      const id = sent?.key.id || reservedId;
      const completed = await this.deliveryStore.complete(
        idempotencyKey,
        claim.leaseToken,
        id,
      );
      if (!completed) {
        throw new Error("Lost the delivery lease before completion was recorded.");
      }
      return { id, duplicate: false, to };
    } catch (error) {
      await this.deliveryStore
        .release(idempotencyKey, claim.leaseToken, "delivery_failed")
        .catch((releaseError: unknown) => {
          console.error("[whatsapp] could not release failed delivery lease", releaseError);
        });
      throw error;
    } finally {
      stopped = true;
      clearInterval(heartbeat);
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    ++this.generation; // Makes the current socket's close event stale.
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        await socket.logout();
      } catch {
        // Clearing the durable auth below is the authoritative unlink operation.
      }
    }
    await this.authStore.clear();
    this.status = "disconnected";
    this.qrDataUrl = null;
    this.connectedPhone = null;
    this.connectedSince = null;
    this.reconnectAttempt = 0;
  }

  shutdown(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    ++this.generation;
    try {
      this.socket?.end(undefined);
    } catch {
      // Process shutdown is best effort; persisted auth remains for the restart.
    }
    this.socket = null;
  }
}
