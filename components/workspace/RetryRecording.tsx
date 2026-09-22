"use client";
import { useState } from "react";
export function RetryRecording({ recordingId, sample }: { recordingId: string; sample: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const retry = async () => {
    if (busy || sample) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/recordings/${encodeURIComponent(recordingId)}/retry`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not retry processing.");
      setMessage("Processing the saved recording again. This view will update automatically.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); setBusy(false); }
  };
  return <div><button disabled={busy || sample} onClick={() => void retry()}>{busy ? "Retry queued" : "Retry transcript and brief"}</button>{message && <p role="status">{message}</p>}</div>;
}
