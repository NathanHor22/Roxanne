import type { Contact, FollowUp, Meeting } from "./types";

/** The fixed clock used by the August 2026 seeded workspace and its tests. */
export const DEMO_NOW = "2026-08-23T17:00:00+08:00";
export const DEMO_MONTH = "2026-08";
export const DEMO_TIME_ZONE = "Asia/Kuala_Lumpur";

export const DEMO_IDS = {
  contacts: {
    james: "contact-james-tan",
    amir: "contact-amir-rahman",
    sarah: "contact-sarah-lim",
    meiLing: "contact-mei-ling",
    raj: "contact-raj-kumar",
  },
  meetings: {
    james: "meeting-james-acme-2026-08-23",
    amir: "meeting-amir-nusantara-2026-08-20",
    sarah: "meeting-sarah-brightpath-2026-08-18",
    meiLing: "meeting-mei-ling-kinara-2026-08-24",
    raj: "meeting-raj-meridian-2026-08-27",
    processing: "meeting-networking-upload-2026-08-23",
  },
  followUps: {
    jamesPricing: "follow-up-james-pricing",
    jamesDemo: "follow-up-james-demo",
    amirRequirements: "follow-up-amir-requirements",
    sarahWorkspace: "follow-up-sarah-workspace",
    sarahThanks: "follow-up-sarah-thanks",
  },
} as const;

export const demoContacts: Contact[] = [
  {
    id: DEMO_IDS.contacts.james,
    name: "James Tan",
    company: "Acme Manufacturing",
    role: "Head of Procurement",
    // Safe hackathon destination supplied by the Lantern owner.
    email: "nathanhor2001@gmail.com",
    phone: "+601154444038",
  },
  {
    id: DEMO_IDS.contacts.amir,
    name: "Amir Rahman",
    company: "Nusantara Supply",
    role: "Operations Director",
    email: "amir@example.invalid",
    phone: null,
  },
  {
    id: DEMO_IDS.contacts.sarah,
    name: "Sarah Lim",
    company: "BrightPath Systems",
    role: "Partnerships Lead",
    email: "sarah@example.invalid",
    phone: null,
  },
  {
    id: DEMO_IDS.contacts.meiLing,
    name: "Mei Ling Wong",
    company: "Kinara Retail",
    role: "Commercial Manager",
    email: "meiling@example.invalid",
    phone: null,
  },
  {
    id: DEMO_IDS.contacts.raj,
    name: "Raj Kumar",
    company: "Meridian Logistics",
    role: "Founder",
    email: "raj@example.invalid",
    phone: null,
  },
];

const contactsById = new Map(demoContacts.map((contact) => [contact.id, contact]));

function contact(id: string): Contact {
  const result = contactsById.get(id);
  if (!result) throw new Error(`Missing seeded contact: ${id}`);
  return result;
}

export const demoFollowUps: FollowUp[] = [
  {
    id: DEMO_IDS.followUps.jamesPricing,
    meetingId: DEMO_IDS.meetings.james,
    contactId: DEMO_IDS.contacts.james,
    type: "email",
    description: "Send revised pricing",
    dueAt: "2026-08-28T17:00:00+08:00",
    status: "pending",
    draft:
      "Hi James, great speaking earlier. As promised, here is the revised pricing for the Acme pilot. I have also included the ERP integration notes we discussed. Best, Nathan",
  },
  {
    id: DEMO_IDS.followUps.jamesDemo,
    meetingId: DEMO_IDS.meetings.james,
    contactId: DEMO_IDS.contacts.james,
    type: "schedule",
    description: "Book product demo next Thursday",
    dueAt: "2026-08-24T17:00:00+08:00",
    status: "pending",
  },
  {
    id: DEMO_IDS.followUps.amirRequirements,
    meetingId: DEMO_IDS.meetings.amir,
    contactId: DEMO_IDS.contacts.amir,
    type: "send_file",
    description: "Send integration requirements",
    dueAt: "2026-08-22T17:00:00+08:00",
    status: "pending",
  },
  {
    id: DEMO_IDS.followUps.sarahWorkspace,
    meetingId: DEMO_IDS.meetings.sarah,
    contactId: DEMO_IDS.contacts.sarah,
    type: "email",
    description: "Share demo workspace",
    dueAt: "2026-08-24T12:00:00+08:00",
    status: "approved",
    draft:
      "Hi Sarah, here is the demo workspace from our conversation. Let me know which workflow you would like us to explore first.",
  },
  {
    id: DEMO_IDS.followUps.sarahThanks,
    meetingId: DEMO_IDS.meetings.sarah,
    contactId: DEMO_IDS.contacts.sarah,
    type: "message",
    description: "Send thank-you note",
    dueAt: "2026-08-19T10:00:00+08:00",
    status: "completed",
  },
];

const followUpsFor = (meetingId: string): FollowUp[] =>
  demoFollowUps.filter((followUp) => followUp.meetingId === meetingId);

export const demoMeetings: Meeting[] = [
  {
    id: DEMO_IDS.meetings.sarah,
    title: "Sarah · BrightPath",
    startAt: "2026-08-18T10:00:00+08:00",
    endAt: "2026-08-18T10:38:00+08:00",
    status: "ready",
    source: "calendar",
    contacts: [contact(DEMO_IDS.contacts.sarah)],
    recordingId: "recording-sarah-brightpath",
    transcript: [
      { speaker: "You", text: "Which partnership workflow creates the most friction today?" },
      { speaker: "Sarah", text: "A shared demo space would help our team evaluate it together." },
    ],
    insight: {
      meetingType: "partnership",
      intent: "Evaluate a shared client workflow",
      interestLevel: "medium",
      wants: "Shared demo workspace",
      concern: "Team onboarding",
      promised: "Demo access",
      next: "Internal review",
      keyPoints: ["Three-person evaluation team", "Needs a simple onboarding flow"],
      commitments: [
        {
          ownerType: "user",
          description: "Share demo workspace",
          dueAt: "2026-08-24T12:00:00+08:00",
          status: "open",
        },
      ],
      detectedLanguage: "English",
    },
    followUps: followUpsFor(DEMO_IDS.meetings.sarah),
  },
  {
    id: DEMO_IDS.meetings.amir,
    title: "Amir · Nusantara",
    startAt: "2026-08-20T14:30:00+08:00",
    endAt: "2026-08-20T15:05:00+08:00",
    status: "ready",
    source: "agora",
    contacts: [contact(DEMO_IDS.contacts.amir)],
    recordingId: "recording-amir-nusantara",
    transcript: [
      { speaker: "Amir", text: "Boleh send integration requirements dulu? Our operations team wants to review them." },
      { speaker: "You", text: "Can. I will send the requirements tomorrow morning." },
    ],
    insight: {
      meetingType: "sales",
      intent: "Technical evaluation",
      interestLevel: "medium",
      wants: "Integration requirements",
      concern: "Implementation effort",
      promised: "Requirements document",
      next: "Operations review",
      keyPoints: ["Operations team will review", "Implementation scope is the key concern"],
      commitments: [
        {
          ownerType: "user",
          description: "Send integration requirements",
          dueAt: "2026-08-22T17:00:00+08:00",
          status: "open",
        },
      ],
      detectedLanguage: "English, Bahasa Malaysia",
    },
    followUps: followUpsFor(DEMO_IDS.meetings.amir),
  },
  {
    id: DEMO_IDS.meetings.james,
    title: "James · Acme",
    startAt: "2026-08-23T14:00:00+08:00",
    endAt: "2026-08-23T14:44:00+08:00",
    status: "ready",
    source: "upload",
    contacts: [contact(DEMO_IDS.contacts.james)],
    recordingId: "recording-james-acme",
    transcript: [
      {
        speaker: "You",
        text: "For the pilot, what does the procurement team need to see first?",
        startSeconds: 18,
      },
      {
        speaker: "James",
        text: "We are interested in the pilot. Supplier comparison looks good, but I am worried about the ERP integration.",
        startSeconds: 25,
      },
      {
        speaker: "James",
        text: "Okay, nanti you send the revised pricing by Friday, then next Thursday kita buat product demo.",
        startSeconds: 51,
      },
      {
        speaker: "You",
        text: "Can. I will send pricing by Friday and set up the demo for next Thursday.",
        startSeconds: 63,
      },
    ],
    insight: {
      meetingType: "partnership",
      intent: "Evaluate procurement automation pilot",
      interestLevel: "high",
      wants: "Pilot",
      concern: "ERP integration",
      promised: "Pricing Friday",
      next: "Demo next Thursday",
      keyPoints: [
        "Interested in procurement automation",
        "Needs supplier comparison",
        "ERP integration must be addressed",
      ],
      commitments: [
        {
          ownerType: "user",
          description: "Send revised pricing",
          dueAt: "2026-08-28T17:00:00+08:00",
          status: "open",
        },
        {
          ownerType: "user",
          description: "Schedule product demo",
          dueAt: "2026-08-24T17:00:00+08:00",
          status: "open",
        },
      ],
      detectedLanguage: "English, Bahasa Malaysia",
    },
    followUps: followUpsFor(DEMO_IDS.meetings.james),
  },
  {
    id: DEMO_IDS.meetings.processing,
    title: "Networking conversation",
    startAt: "2026-08-23T16:15:00+08:00",
    endAt: "2026-08-23T16:37:00+08:00",
    status: "processing",
    source: "upload",
    contacts: [],
    recordingId: "recording-networking-processing",
    followUps: [],
  },
  {
    id: DEMO_IDS.meetings.meiLing,
    title: "Mei Ling · Kinara",
    startAt: "2026-08-24T10:30:00+08:00",
    endAt: "2026-08-24T11:00:00+08:00",
    status: "upcoming",
    source: "calendar",
    contacts: [contact(DEMO_IDS.contacts.meiLing)],
    followUps: [],
  },
  {
    id: DEMO_IDS.meetings.raj,
    title: "Raj · Meridian",
    startAt: "2026-08-27T15:30:00+08:00",
    endAt: "2026-08-27T16:00:00+08:00",
    status: "upcoming",
    source: "calendar",
    contacts: [contact(DEMO_IDS.contacts.raj)],
    followUps: [],
  },
];

export const jamesContact = contact(DEMO_IDS.contacts.james);
export const jamesMeeting = demoMeetings.find(
  (meeting) => meeting.id === DEMO_IDS.meetings.james,
)!;

// Uppercase aliases make the constants convenient in API routes and tests.
export const DEMO_CONTACTS = demoContacts;
export const DEMO_FOLLOW_UPS = demoFollowUps;
export const DEMO_MEETINGS = demoMeetings;
