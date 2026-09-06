import { env } from "../env";
import type { ExtractionContext } from "../meeting-schema";
import type { TranscriptSegment } from "../types";
import { extractWithIlmu } from "./ilmu";
import { extractMeetingInsights } from "./qwen";

/** Capture providers share one extraction boundary. Configured Ilmu errors never
 * turn into fixture content or silently route private transcripts elsewhere. */
export function extractConversationInsights(
  transcript: TranscriptSegment[],
  context: ExtractionContext,
) {
  return env().ILMU_API_KEY
    ? extractWithIlmu(transcript, context)
    : extractMeetingInsights(transcript, context);
}
