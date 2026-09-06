"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Meeting, ScheduleDetails } from "@/lib/types";
import {
  approveSample,
  liveApprovalRequest,
  updateApproval,
  type MeetingApproval,
  type WorkspaceMode,
} from "@/lib/workspace/model";
import {
  createSampleWorkspace,
  readSampleWorkspace,
  SAMPLE_STORAGE_KEY,
} from "@/lib/workspace/sample";

export function useWorkspace() {
  const [mode, setMode] = useState<WorkspaceMode>("live");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<Record<string, boolean>>({});
  const [working, setWorking] = useState<string | null>(null);
  const generation = useRef(0);
  const actionLock = useRef(false);

  const loadSample = useCallback((reset = false) => {
    generation.current++;
    let data = createSampleWorkspace();
    try {
      if (!reset)
        data =
          readSampleWorkspace(localStorage.getItem(SAMPLE_STORAGE_KEY)) || data;
    } catch {
      /* Memory-only sample remains usable when storage is unavailable. */
    }
    setMode("sample");
    setMeetings(data.meetings);
    setLoading(false);
    setError(null);
    setIntegrations({});
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "sample");
    window.history.replaceState({}, "", url);
    if (reset) setNotice("Sample workspace reset.");
  }, []);

  const loadLive = useCallback(
    async (allowSample = false) => {
      const current = ++generation.current;
      setMode("live");
      setMeetings([]);
      setLoading(true);
      setError(null);
      setIntegrations({});
      const url = new URL(window.location.href);
      url.searchParams.delete("mode");
      window.history.replaceState({}, "", url);
      try {
        const response = await fetch("/api/meetings", { cache: "no-store" });
        const payload = await response.json();
        if (current !== generation.current) return;
        if (!response.ok)
          throw new Error(
            payload.error || "Your workspace could not be loaded.",
          );
        if (payload.source === "seed") {
          if (allowSample) {
            loadSample();
            return;
          }
          throw new Error(
            "Your workspace is not connected yet. You can explore the sample workspace while it is being set up.",
          );
        }
        setMeetings(payload.meetings || []);
        const result = await fetch("/api/integrations", { cache: "no-store" });
        if (result.ok && current === generation.current)
          setIntegrations((await result.json()).integrations || {});
      } catch (cause) {
        if (current === generation.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Your workspace could not be loaded.",
          );
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [loadSample],
  );

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "sample")
      loadSample();
    else void loadLive(true);
    return () => {
      generation.current++;
    };
  }, [loadLive, loadSample]);

  useEffect(() => {
    if (mode !== "sample" || loading) return;
    try {
      localStorage.setItem(
        SAMPLE_STORAGE_KEY,
        JSON.stringify({ version: 1, meetings }),
      );
    } catch {
      setNotice(
        "Changes are available in this tab. Browser storage is unavailable.",
      );
    }
  }, [mode, meetings, loading]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const approve = async (
    approval: MeetingApproval,
  ): Promise<Meeting | null> => {
    if (actionLock.current) return null;
    actionLock.current = true;
    setWorking(approval.id);
    setError(null);
    try {
      if (mode === "sample") {
        const next = approveSample(meetings, approval);
        setMeetings(next);
        setNotice("Added to your sample calendar. No invitation was sent.");
        return (
          next.find((meeting) => meeting.sourceApprovalId === approval.id) ||
          null
        );
      }
      const response = await fetch("/api/actions/calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(liveApprovalRequest(approval)),
      });
      const payload = await response.json();
      if (!response.ok || !payload.event)
        throw new Error(
          payload.error || "The calendar invitation could not be created.",
        );
      const created: Meeting = {
        id: payload.roxanneMeetingId || `calendar:${payload.event.id}`,
        title: payload.event.summary,
        startAt: payload.event.startAt,
        endAt: payload.event.endAt,
        status: "upcoming",
        source: "calendar",
        calendarEventId: payload.event.id,
        sourceConversationId: approval.conversationId,
        sourceApprovalId: approval.id,
        contacts:
          meetings.find((meeting) => meeting.id === approval.conversationId)
            ?.contacts || [],
      };
      setMeetings((current) => [
        ...updateApproval(
          current.filter((meeting) => meeting.id !== created.id),
          approval.id,
          { status: "completed", schedule: approval.details },
        ),
        created,
      ]);
      setNotice("Meeting added to Google Calendar. Invitation sent.");
      return created;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The meeting could not be approved.",
      );
      return null;
    } finally {
      actionLock.current = false;
      setWorking(null);
    }
  };

  const patchFollowUp = async (
    id: string,
    changes: {
      status?: "pending" | "completed" | "dismissed";
      schedule?: ScheduleDetails;
    },
  ) => {
    if (actionLock.current) return false;
    actionLock.current = true;
    setWorking(id);
    setError(null);
    try {
      if (mode === "live") {
        if (id.startsWith("sample:"))
          throw new Error("Sample items cannot update your workspace.");
        const response = await fetch(
          `/api/follow-ups/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(changes),
          },
        );
        const payload = await response.json();
        if (!response.ok || !payload.persisted)
          throw new Error(payload.error || "The change could not be saved.");
      }
      setMeetings((current) => updateApproval(current, id, changes));
      if (changes.status === "dismissed") setNotice("Approval dismissed.");
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The change could not be saved.",
      );
      return false;
    } finally {
      actionLock.current = false;
      setWorking(null);
    }
  };

  return {
    mode,
    meetings,
    loading,
    error,
    notice,
    integrations,
    working,
    approve,
    patchFollowUp,
    loadSample,
    loadLive,
    setError,
    setNotice,
  };
}
