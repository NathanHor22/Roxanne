import pg from "pg";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { readFileSync } from "node:fs";
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { BufferJSON, initAuthCreds, proto } from "@whiskeysockets/baileys";

const { Pool } = pg;
const SUPABASE_ROOT_CA = readFileSync(
  new URL("../certs/prod-ca-2021.crt", import.meta.url),
  "utf8",
);

export type DatabasePool = InstanceType<typeof Pool>;

const encode = (value: unknown): string => JSON.stringify(value, BufferJSON.replacer);
const decode = (value: string): unknown => JSON.parse(value, BufferJSON.reviver);
const AUTH_ENVELOPE_PREFIX = "roxanne-auth:v1:";

function authKey(key: string): string {
  return `auth:${key}`;
}

/** AES-256-GCM envelope encryption with row identity bound as authenticated data. */
export class AuthValueCipher {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly workspaceKey: string,
  ) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("WhatsApp auth encryption key must contain at least 32 bytes.");
    }
    this.key = createHash("sha256")
      .update("roxanne-whatsapp-auth\0", "utf8")
      .update(secret, "utf8")
      .digest();
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(AUTH_ENVELOPE_PREFIX);
  }

  encrypt(dataKey: string, plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.additionalData(dataKey));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${AUTH_ENVELOPE_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
  }

  decrypt(dataKey: string, storedValue: string): string {
    // Migration 001 stored JSON directly. load() rewrites every such row in one
    // transaction before returning auth state; accepting it here enables that migration.
    if (!this.isEncrypted(storedValue)) return storedValue;

    const parts = storedValue.slice(AUTH_ENVELOPE_PREFIX.length).split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) {
      throw new Error("Stored WhatsApp auth value has an invalid encrypted envelope.");
    }
    try {
      const iv = Buffer.from(parts[0]!, "base64url");
      const tag = Buffer.from(parts[1]!, "base64url");
      const ciphertext = Buffer.from(parts[2]!, "base64url");
      if (iv.length !== 12 || tag.length !== 16) throw new Error("invalid envelope");
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(this.additionalData(dataKey));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        "utf8",
      );
    } catch {
      throw new Error(
        "Could not decrypt stored WhatsApp auth. Verify WHATSAPP_AUTH_ENCRYPTION_KEY has not changed.",
      );
    }
  }

  private additionalData(dataKey: string): Buffer {
    return Buffer.from(`${this.workspaceKey}\0${dataKey}`, "utf8");
  }
}

export function createDatabasePool(databaseUrl: string): DatabasePool {
  const connectionUrl = new URL(databaseUrl);
  // pg-connection-string turns sslmode=require into its own TLS object, which
  // would discard the project CA supplied below. Remove URL-level TLS options
  // and enforce verified TLS explicitly for every worker connection.
  connectionUrl.searchParams.delete("sslmode");
  connectionUrl.searchParams.delete("sslcert");
  connectionUrl.searchParams.delete("sslkey");
  connectionUrl.searchParams.delete("sslrootcert");

  const pool = new Pool({
    connectionString: connectionUrl.toString(),
    ssl: {
      ca: SUPABASE_ROOT_CA,
      rejectUnauthorized: true,
    },
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    query_timeout: 10_000,
    application_name: "roxanne-whatsapp-worker",
  });
  pool.on("error", (error) => {
    // A checked-out client error reaches its caller; this catches idle-client failures.
    console.error("[database] unexpected pool error", error);
  });
  return pool;
}

export class PostgresAuthStore {
  private credentialWrites: Promise<void> = Promise.resolve();
  private readonly cipher: AuthValueCipher;

  constructor(
    private readonly pool: DatabasePool,
    private readonly workspaceKey: string,
    authEncryptionKey: string,
  ) {
    this.cipher = new AuthValueCipher(authEncryptionKey, workspaceKey);
  }

  private async encryptLegacyRows(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<{ data_key: string; data_value: string }>(
        `select data_key, data_value
           from public.roxanne_whatsapp_auth
          where workspace_key = $1 and data_key like 'auth:%'
          for update`,
        [this.workspaceKey],
      );
      for (const row of result.rows) {
        if (this.cipher.isEncrypted(row.data_value)) continue;
        // Validate the old serialization before replacing it.
        decode(row.data_value);
        await client.query(
          `update public.roxanne_whatsapp_auth
              set data_value = $3, updated_at = now()
            where workspace_key = $1 and data_key = $2`,
          [
            this.workspaceKey,
            row.data_key,
            this.cipher.encrypt(row.data_key, row.data_value),
          ],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async read(key: string): Promise<unknown | null> {
    const result = await this.pool.query<{ data_value: string }>(
      `select data_value
         from public.roxanne_whatsapp_auth
        where workspace_key = $1 and data_key = $2`,
      [this.workspaceKey, authKey(key)],
    );
    return result.rows[0]
      ? decode(
          this.cipher.decrypt(authKey(key), result.rows[0].data_value),
        )
      : null;
  }

  private async write(key: string, value: unknown): Promise<void> {
    await this.pool.query(
      `insert into public.roxanne_whatsapp_auth
         (workspace_key, data_key, data_value, updated_at)
       values ($1, $2, $3, now())
       on conflict (workspace_key, data_key)
       do update set data_value = excluded.data_value, updated_at = now()`,
      [
        this.workspaceKey,
        authKey(key),
        this.cipher.encrypt(authKey(key), encode(value)),
      ],
    );
  }

  private queueCredentialWrite(creds: AuthenticationCreds): Promise<void> {
    // EventEmitter callbacks cannot be awaited. Serialize snapshots so a slower
    // old write can never overwrite a newer credential update.
    const snapshot = encode(creds);
    const operation = this.credentialWrites
      .catch(() => undefined)
      .then(async () => {
        await this.pool.query(
          `insert into public.roxanne_whatsapp_auth
             (workspace_key, data_key, data_value, updated_at)
           values ($1, $2, $3, now())
           on conflict (workspace_key, data_key)
           do update set data_value = excluded.data_value, updated_at = now()`,
          [
            this.workspaceKey,
            authKey("creds"),
            this.cipher.encrypt(authKey("creds"), snapshot),
          ],
        );
      });
    this.credentialWrites = operation;
    return operation;
  }

  private async remove(key: string): Promise<void> {
    await this.pool.query(
      `delete from public.roxanne_whatsapp_auth
        where workspace_key = $1 and data_key = $2`,
      [this.workspaceKey, authKey(key)],
    );
  }

  async load(): Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
  }> {
    await this.encryptLegacyRows();
    const creds =
      ((await this.read("creds")) as AuthenticationCreds | null) ?? initAuthCreds();

    return {
      state: {
        creds,
        keys: {
          get: async (type, ids) => {
            const wanted = ids.map((id) => authKey(`${type}-${id}`));
            if (wanted.length === 0) return {};
            const result = await this.pool.query<{
              data_key: string;
              data_value: string;
            }>(
              `select data_key, data_value
                 from public.roxanne_whatsapp_auth
                where workspace_key = $1 and data_key = any($2::text[])`,
              [this.workspaceKey, wanted],
            );
            const values = new Map(
              result.rows.map((row) => [row.data_key, row.data_value]),
            );
            const output: Record<string, unknown> = {};
            for (const id of ids) {
              const raw = values.get(authKey(`${type}-${id}`));
              if (!raw) continue;
              let value = decode(
                this.cipher.decrypt(authKey(`${type}-${id}`), raw),
              );
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
              }
              output[id] = value;
            }
            return output as { [id: string]: SignalDataTypeMap[typeof type] };
          },
          set: async (data) => {
            const tasks: Array<Promise<void>> = [];
            for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
              const values = data[category];
              if (!values) continue;
              for (const id of Object.keys(values)) {
                const value = values[id];
                const key = `${category}-${id}`;
                tasks.push(value ? this.write(key, value) : this.remove(key));
              }
            }
            await Promise.all(tasks);
          },
        },
      },
      // Baileys mutates creds in place, so save the latest snapshot per update.
      saveCreds: () => this.queueCredentialWrite(creds),
    };
  }

  async clear(): Promise<void> {
    // Drain already-emitted credential updates before deleting, otherwise an
    // old queued write could resurrect a session after explicit logout.
    await this.credentialWrites.catch(() => undefined);
    await this.pool.query(
      `delete from public.roxanne_whatsapp_auth
        where workspace_key = $1 and data_key like 'auth:%'`,
      [this.workspaceKey],
    );
  }
}

export class DeliveryStore {
  constructor(
    private readonly pool: DatabasePool,
    private readonly workspaceKey: string,
  ) {}

  async claim(
    idempotencyKey: string,
    leaseMs: number,
  ): Promise<
    | { status: "acquired"; leaseToken: string }
    | { status: "completed"; providerMessageId: string }
    | { status: "in_progress"; retryAfterMs: number }
  > {
    const leaseToken = randomUUID();
    const claimed = await this.pool.query<{ lease_token: string }>(
      `insert into public.whatsapp_delivery_keys
         (workspace_key, idempotency_key, provider_message_id, lease_token,
          lease_expires_at, attempt_count, updated_at)
       values ($1, $2, null, $3, now() + ($4::integer * interval '1 millisecond'), 1, now())
       on conflict (workspace_key, idempotency_key) do update
         set lease_token = excluded.lease_token,
             lease_expires_at = excluded.lease_expires_at,
             attempt_count = public.whatsapp_delivery_keys.attempt_count + 1,
             last_error = null,
             updated_at = now()
       where public.whatsapp_delivery_keys.provider_message_id is null
         and (public.whatsapp_delivery_keys.lease_expires_at is null
              or public.whatsapp_delivery_keys.lease_expires_at <= now())
       returning lease_token`,
      [this.workspaceKey, idempotencyKey, leaseToken, leaseMs],
    );
    if (claimed.rowCount === 1 && claimed.rows[0]?.lease_token === leaseToken) {
      return { status: "acquired", leaseToken };
    }

    const current = await this.pool.query<{
      provider_message_id: string | null;
      lease_expires_at: Date | string | null;
    }>(
      `select provider_message_id, lease_expires_at
         from public.whatsapp_delivery_keys
        where workspace_key = $1 and idempotency_key = $2`,
      [this.workspaceKey, idempotencyKey],
    );
    const row = current.rows[0];
    if (row?.provider_message_id) {
      return { status: "completed", providerMessageId: row.provider_message_id };
    }
    const expiresAt = row?.lease_expires_at
      ? new Date(row.lease_expires_at).getTime()
      : Date.now() + 1_000;
    return {
      status: "in_progress",
      retryAfterMs: Math.max(250, expiresAt - Date.now()),
    };
  }

  async renew(
    idempotencyKey: string,
    leaseToken: string,
    leaseMs: number,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update public.whatsapp_delivery_keys
          set lease_expires_at = now() + ($4::integer * interval '1 millisecond'),
              updated_at = now()
        where workspace_key = $1 and idempotency_key = $2
          and lease_token = $3 and provider_message_id is null`,
      [this.workspaceKey, idempotencyKey, leaseToken, leaseMs],
    );
    return result.rowCount === 1;
  }

  async complete(
    idempotencyKey: string,
    leaseToken: string,
    providerMessageId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update public.whatsapp_delivery_keys
          set provider_message_id = $4,
              lease_token = null,
              lease_expires_at = null,
              last_error = null,
              completed_at = now(),
              updated_at = now()
        where workspace_key = $1 and idempotency_key = $2
          and lease_token = $3 and provider_message_id is null`,
      [this.workspaceKey, idempotencyKey, leaseToken, providerMessageId],
    );
    return result.rowCount === 1;
  }

  async release(
    idempotencyKey: string,
    leaseToken: string,
    reason: string,
  ): Promise<void> {
    await this.pool.query(
      `update public.whatsapp_delivery_keys
          set lease_token = null,
              lease_expires_at = null,
              last_error = $4,
              updated_at = now()
        where workspace_key = $1 and idempotency_key = $2
          and lease_token = $3 and provider_message_id is null`,
      [this.workspaceKey, idempotencyKey, leaseToken, reason.slice(0, 200)],
    );
  }
}
