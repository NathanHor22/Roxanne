export type Locale = "en" | "ms" | "zh-CN" | "yue" | "ta";

export type MeetingStatus = "upcoming" | "processing" | "ready" | "failed";
export type FollowUpStatus = "pending" | "approved" | "completed" | "failed";
export type InterestLevel = "low" | "medium" | "high" | "unknown";

export interface Contact {
  id: string;
  name: string;
  company: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  startSeconds?: number;
  endSeconds?: number;
}

export interface Commitment {
  id?: string;
  ownerType: "user" | "contact";
  description: string;
  dueAt?: string | null;
  status?: "open" | "completed";
}

export interface MeetingInsight {
  meetingType: string;
  intent: string;
  interestLevel: InterestLevel;
  wants: string;
  concern: string;
  promised: string;
  next: string;
  keyPoints: string[];
  commitments: Commitment[];
  detectedLanguage?: string;
}

export interface FollowUp {
  id: string;
  meetingId: string;
  contactId: string | null;
  type: "message" | "email" | "schedule" | "call" | "send_file";
  description: string;
  dueAt: string | null;
  status: FollowUpStatus;
  draft?: string | null;
}

export interface Meeting {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status: MeetingStatus;
  source: "manual" | "calendar" | "hardware" | "upload" | "agora";
  contacts: Contact[];
  recordingId?: string | null;
  recordingUrl?: string | null;
  transcript?: TranscriptSegment[];
  insight?: MeetingInsight | null;
  followUps?: FollowUp[];
}

export interface ProcessMeetingResult {
  meeting: Meeting;
  providerStatus: {
    transcription: "live" | "fallback";
    extraction: "live" | "fallback";
    persistence: "live" | "local";
  };
}
