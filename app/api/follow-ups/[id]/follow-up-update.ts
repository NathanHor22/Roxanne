import { z } from "zod";

const paramsSchema = z.object({ id: z.string().trim().min(1).max(120) });
const bodySchema = z.object({
  status: z.enum(["pending", "completed"]),
}).strict();

export function parseFollowUpPatch(id: unknown, body: unknown) {
  return {
    id: paramsSchema.parse({ id }).id,
    status: bodySchema.parse(body).status,
  };
}

export function localFollowUpPatchResult(
  id: string,
  status: "pending" | "completed",
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
