import { z } from "zod";
import { scheduleDetailsSchema } from "@/lib/workspace/model";

const paramsSchema = z.object({ id: z.string().trim().min(1).max(120) });
const bodySchema = z.object({
  status: z.enum(["pending", "completed", "dismissed"]).optional(),
  schedule: scheduleDetailsSchema.optional(),
}).strict().refine((value) => value.status !== undefined || value.schedule !== undefined, "An update is required.");

export function parseFollowUpPatch(id: unknown, body: unknown) {
  return {
    id: paramsSchema.parse({ id }).id,
    ...bodySchema.parse(body),
  };
}

export function localFollowUpPatchResult(
  id: string,
  status: "pending" | "completed" | "dismissed",
  now = new Date(),
) {
  return {
    ok: true as const,
    id,
    status,
    completedAt: status === "completed" ? now.toISOString() : null,
    persisted: false as const,
  };
}
