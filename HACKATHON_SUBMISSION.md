# Lantern Relay — hackathon build record

## Project title

Lantern Relay

## Working description

Lantern Relay is an introduction agent for a physical business event. A
wearable captures consented conversations, Agora transcribes them, and OpenAI
turns Malaysian mixed-language speech into structured memory. Relay then compares
those saved conversations and finds a concrete reason for two
people in the room to meet. Every proposal shows the two source quotes and waits
for the owner to review the exact attendees and time before Google Calendar
sends a Meet invitation.

The place matters: Relay becomes useful because separate conversations happen
inside the same event and can become a relationship graph while the people are
still available to connect.

## Net-new hackathon scope

The existing Lantern foundation may be used as reusable infrastructure. The
submission's core functionality consists of work created for the hackathon:

- cross-conversation evidence DTOs and relationship matching;
- the OpenAI Responses structured-output adapter;
- optional Exa company research with a transcript privacy boundary;
- persistent introduction proposals and status handling;
- the Relay dashboard view and final introduction review;
- binding a saved Relay pair to approval-gated Calendar execution.

Keep these changes identifiable in the public repository history. Do not claim
the earlier dashboard, wearable firmware, Agora pipeline, conversation extraction, or
Google integration as new hackathon work.

## Two-minute demo path

1. Start with two completed event conversations and open their short recaps.
2. Open **Relay** and run the agent.
3. Show the need, offer, exact source quotes, fit score, and any Exa public source.
4. Open each source conversation from the proposal.
5. Review the exact attendees, date, time, and duration.
6. Approve once and show the Google Calendar event with its Meet invitation.
7. Return to Relay and show that the proposal left the approval queue.

The sample workspace can demonstrate steps 2–4 without credentials. The final
submission video should use the real OpenAI path and a controlled Calendar test.

## Required live setup

- Apply Supabase migrations 003 through 006.
- Set `OPENAI_API_KEY` and optionally `EXA_API_KEY` on Vercel.
- Keep `DEMO_ACCESS_MODE=owner` and complete Supabase Google login setup.
- Connect the owner Google Calendar under Lantern Settings.
- Capture or import at least two consented test conversations with confirmed
  participant emails.

## Proof checklist

- Public GitHub repository containing the identifiable net-new Relay commit(s).
- Two-minute demo video.
- Written project description based on the working description above.
- Social post tagging the required event partners.
- Clear disclosure in the README or submission that the named Lantern components
  outside Relay were reusable pre-existing building blocks.
