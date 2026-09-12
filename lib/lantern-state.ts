import { z } from "zod";

export const lanternStateSchema = z.enum([
  "connecting",
  "ready",
  "awaiting_recording_consent",
  "recording",
  "paused",
  "offline_buffering",
  "finalising",
  "processing",
  "report_ready",
  "oath_listening",
  "status_report",
  "awaiting_action_confirmation",
  "pending_dashboard_approval",
  "error",
]);

export type LanternState = z.infer<typeof lanternStateSchema>;
export type LanternMode = "quick" | "status" | null;

export interface LanternPrompt {
  id: string;
  kind: "recording_consent" | "action_confirmation";
  expiresAt: string;
}

export interface LanternMachine {
  state: LanternState;
  version: number;
  mode: LanternMode;
  sessionId: string | null;
  prompt: LanternPrompt | null;
  recordingStartedAt: string | null;
  consentConfirmedAt: string | null;
  bufferedSeconds: number;
  resumeState: "recording" | "paused" | null;
  proposalId: string | null;
  lastError: string | null;
}

export const lanternMachineSchema = z
  .object({
    state: lanternStateSchema,
    version: z.number().int().nonnegative(),
    mode: z.enum(["quick", "status"]).nullable(),
    sessionId: z.string().nullable(),
    prompt: z
      .object({
        id: z.string(),
        kind: z.enum(["recording_consent", "action_confirmation"]),
        expiresAt: z.string().datetime({ offset: true }),
      })
      .strict()
      .nullable(),
    recordingStartedAt: z.string().datetime({ offset: true }).nullable(),
    consentConfirmedAt: z.string().datetime({ offset: true }).nullable(),
    bufferedSeconds: z.number().min(0).max(30),
    resumeState: z.enum(["recording", "paused"]).nullable(),
    proposalId: z.string().nullable(),
    lastError: z.string().nullable(),
  })
  .strict()
  .superRefine((machine, context) => {
    const quickStates: LanternState[] = [
      "awaiting_recording_consent",
      "recording",
      "paused",
      "offline_buffering",
      "finalising",
      "processing",
    ];
    const statusStates: LanternState[] = [
      "oath_listening",
      "status_report",
      "awaiting_action_confirmation",
      "pending_dashboard_approval",
    ];
    if (quickStates.includes(machine.state) && machine.mode !== "quick") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quick state requires quick mode.",
      });
    }
    if (statusStates.includes(machine.state) && machine.mode !== "status") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Status state requires status mode.",
      });
    }
    if (
      [...quickStates, ...statusStates].includes(machine.state) &&
      !machine.sessionId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Active state requires a session ID.",
      });
    }
    const expectedPrompt =
      machine.state === "awaiting_recording_consent"
        ? "recording_consent"
        : machine.state === "awaiting_action_confirmation"
          ? "action_confirmation"
          : null;
    if (
      (expectedPrompt && machine.prompt?.kind !== expectedPrompt) ||
      (!expectedPrompt && machine.prompt !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Prompt does not match Lantern state.",
      });
    }
    if (machine.state !== "offline_buffering" && machine.resumeState !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only an offline session can have a resume state.",
      });
    }
  });

const timestamp = z.string().datetime({ offset: true });
const identifier = z.string().trim().min(1).max(120);

export const lanternEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CONNECTED"),
    at: timestamp,
  }),
  z.object({
    type: z.literal("BEGIN_QUICK"),
    at: timestamp,
    sessionId: identifier,
    promptId: identifier,
    promptExpiresAt: timestamp,
  }),
  z.object({
    type: z.literal("RECORDING_CONSENT"),
    at: timestamp,
    promptId: identifier,
    accepted: z.boolean(),
  }),
  z.object({ type: z.literal("PAUSE"), at: timestamp }),
  z.object({ type: z.literal("CAPTURE_STARTED"), at: timestamp }),
  z.object({ type: z.literal("RESUME"), at: timestamp }),
  z.object({ type: z.literal("STOP"), at: timestamp }),
  z.object({ type: z.literal("ARCHIVE_ACCEPTED"), at: timestamp }),
  z.object({ type: z.literal("PROCESSING_COMPLETE"), at: timestamp }),
  z.object({ type: z.literal("DISMISS_REPORT"), at: timestamp }),
  z.object({
    type: z.literal("BEGIN_STATUS"),
    at: timestamp,
    sessionId: identifier,
  }),
  z.object({
    type: z.literal("OATH_RESULT"),
    at: timestamp,
    accepted: z.boolean(),
  }),
  z.object({
    type: z.literal("ACTION_PROPOSED"),
    at: timestamp,
    proposalId: identifier,
    promptId: identifier,
    promptExpiresAt: timestamp,
  }),
  z.object({
    type: z.literal("ACTION_CONFIRMATION"),
    at: timestamp,
    promptId: identifier,
    accepted: z.boolean(),
  }),
  z.object({
    type: z.literal("DASHBOARD_RESOLVED"),
    at: timestamp,
  }),
  z.object({ type: z.literal("CONNECTION_LOST"), at: timestamp }),
  z.object({ type: z.literal("CONNECTION_RESTORED"), at: timestamp }),
  z.object({
    type: z.literal("BUFFER_UPDATED"),
    at: timestamp,
    bufferedSeconds: z.number().min(0).max(30),
  }),
  z.object({
    type: z.literal("FAIL"),
    at: timestamp,
    message: z.string().trim().min(1).max(500),
  }),
  z.object({ type: z.literal("RESET"), at: timestamp }),
]);

export type LanternEvent = z.infer<typeof lanternEventSchema>;

export class LanternTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LanternTransitionError";
  }
}

export function createLanternMachine(
  initialState: "connecting" | "ready" = "connecting",
): LanternMachine {
  return {
    state: initialState,
    version: 0,
    mode: null,
    sessionId: null,
    prompt: null,
    recordingStartedAt: null,
    consentConfirmedAt: null,
    bufferedSeconds: 0,
    resumeState: null,
    proposalId: null,
    lastError: null,
  };
}

function resetToReady(machine: LanternMachine): LanternMachine {
  return {
    ...createLanternMachine("ready"),
    version: machine.version + 1,
  };
}

function requireState(
  machine: LanternMachine,
  event: LanternEvent,
  ...states: LanternState[]
) {
  if (!states.includes(machine.state)) {
    throw new LanternTransitionError(
      `${event.type} is not allowed while Lantern is ${machine.state}.`,
    );
  }
}

function validatePrompt(
  machine: LanternMachine,
  event: Extract<
    LanternEvent,
    { type: "RECORDING_CONSENT" | "ACTION_CONFIRMATION" }
  >,
  kind: LanternPrompt["kind"],
) {
  if (
    !machine.prompt ||
    machine.prompt.kind !== kind ||
    machine.prompt.id !== event.promptId
  ) {
    throw new LanternTransitionError(
      "This response does not belong to the active Lantern prompt.",
    );
  }
  if (Date.parse(event.at) > Date.parse(machine.prompt.expiresAt)) {
    throw new LanternTransitionError(
      "The Lantern confirmation prompt has expired.",
    );
  }
}

/**
 * Authoritative provider-independent Lantern session state.
 * Speech recognition may create events, but it cannot skip these transitions.
 */
export function advanceLantern(
  machine: LanternMachine,
  input: LanternEvent,
): LanternMachine {
  const event = lanternEventSchema.parse(input);
  const next = { ...machine, version: machine.version + 1 };

  switch (event.type) {
    case "CONNECTED":
      requireState(machine, event, "connecting");
      return { ...next, state: "ready", lastError: null };
    case "BEGIN_QUICK":
      requireState(machine, event, "ready", "report_ready");
      if (Date.parse(event.promptExpiresAt) <= Date.parse(event.at)) {
        throw new LanternTransitionError("Consent prompt must expire in the future.");
      }
      return {
        ...next,
        state: "awaiting_recording_consent",
        mode: "quick",
        sessionId: event.sessionId,
        prompt: {
          id: event.promptId,
          kind: "recording_consent",
          expiresAt: event.promptExpiresAt,
        },
        recordingStartedAt: null,
        consentConfirmedAt: null,
        bufferedSeconds: 0,
        resumeState: null,
        proposalId: null,
        lastError: null,
      };
    case "RECORDING_CONSENT":
      requireState(machine, event, "awaiting_recording_consent");
      validatePrompt(machine, event, "recording_consent");
      if (!event.accepted) return resetToReady(machine);
      return {
        ...next,
        state: "recording",
        prompt: null,
        recordingStartedAt: event.at,
        consentConfirmedAt: event.at,
      };
    case "CAPTURE_STARTED":
      requireState(machine, event, "recording");
      if (machine.recordingStartedAt !== machine.consentConfirmedAt) {
        throw new LanternTransitionError("Capture start has already been stamped.");
      }
      return { ...next, recordingStartedAt: event.at };
    case "PAUSE":
      requireState(machine, event, "recording");
      return { ...next, state: "paused" };
    case "RESUME":
      requireState(machine, event, "paused");
      return { ...next, state: "recording" };
    case "STOP":
      requireState(machine, event, "recording", "paused", "offline_buffering");
      return {
        ...next,
        state: "finalising",
        prompt: null,
        resumeState: null,
      };
    case "ARCHIVE_ACCEPTED":
      requireState(machine, event, "finalising");
      return { ...next, state: "processing", bufferedSeconds: 0 };
    case "PROCESSING_COMPLETE":
      requireState(machine, event, "processing");
      return {
        ...next,
        state: "report_ready",
        mode: null,
        sessionId: null,
        prompt: null,
      };
    case "DISMISS_REPORT":
      requireState(
        machine,
        event,
        "report_ready",
        "status_report",
        "pending_dashboard_approval",
      );
      return resetToReady(machine);
    case "BEGIN_STATUS":
      requireState(machine, event, "ready", "report_ready");
      return {
        ...next,
        state: "oath_listening",
        mode: "status",
        sessionId: event.sessionId,
        prompt: null,
        recordingStartedAt: null,
        consentConfirmedAt: null,
        bufferedSeconds: 0,
        resumeState: null,
        proposalId: null,
        lastError: null,
      };
    case "OATH_RESULT":
      requireState(machine, event, "oath_listening");
      return event.accepted
        ? { ...next, state: "status_report" }
        : resetToReady(machine);
    case "ACTION_PROPOSED":
      requireState(machine, event, "status_report", "report_ready");
      if (Date.parse(event.promptExpiresAt) <= Date.parse(event.at)) {
        throw new LanternTransitionError("Action prompt must expire in the future.");
      }
      return {
        ...next,
        state: "awaiting_action_confirmation",
        proposalId: event.proposalId,
        prompt: {
          id: event.promptId,
          kind: "action_confirmation",
          expiresAt: event.promptExpiresAt,
        },
      };
    case "ACTION_CONFIRMATION":
      requireState(machine, event, "awaiting_action_confirmation");
      validatePrompt(machine, event, "action_confirmation");
      return event.accepted
        ? { ...next, state: "pending_dashboard_approval", prompt: null }
        : { ...next, state: "status_report", prompt: null, proposalId: null };
    case "DASHBOARD_RESOLVED":
      requireState(machine, event, "pending_dashboard_approval");
      return { ...next, state: "status_report", proposalId: null };
    case "CONNECTION_LOST":
      requireState(machine, event, "recording", "paused", "ready");
      if (machine.state === "ready") {
        return { ...next, state: "connecting" };
      }
      return {
        ...next,
        state: "offline_buffering",
        resumeState: machine.state === "paused" ? "paused" : "recording",
      };
    case "CONNECTION_RESTORED":
      requireState(machine, event, "connecting", "offline_buffering");
      if (machine.state === "offline_buffering") {
        return {
          ...next,
          state: machine.resumeState || "recording",
          resumeState: null,
          bufferedSeconds: 0,
        };
      }
      return { ...next, state: "ready" };
    case "BUFFER_UPDATED":
      requireState(machine, event, "offline_buffering");
      return { ...next, bufferedSeconds: event.bufferedSeconds };
    case "FAIL":
      return {
        ...next,
        state: "error",
        prompt: null,
        lastError: event.message,
      };
    case "RESET":
      return resetToReady(machine);
  }
}

export function lanternStateLabel(state: LanternState): string {
  return {
    connecting: "Connecting",
    ready: "Ready",
    awaiting_recording_consent: "Waiting for consent",
    recording: "Recording",
    paused: "Paused",
    offline_buffering: "Connection lost",
    finalising: "Saving conversation",
    processing: "Preparing recap",
    report_ready: "Recap ready",
    oath_listening: "Listening for oath",
    status_report: "Status report",
    awaiting_action_confirmation: "Confirm meeting details",
    pending_dashboard_approval: "Approval waiting",
    error: "Needs attention",
  }[state];
}
