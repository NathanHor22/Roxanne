"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import type { IAgoraRTCClient, IMicrophoneAudioTrack } from "agora-rtc-sdk-ng";
import { motion } from "motion/react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

type RecorderState = "idle" | "connecting" | "live" | "stopping";

export function LiveRecorder({ onRecorded, onError }: { onRecorded: (file: File, channel: string, timing?: { startAt: string; endAt: string }) => void; onError: (message: string) => void }) {
  const { dict } = useLanguage();
  const [state, setState] = useState<RecorderState>("idle");
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const trackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const channelRef = useRef("");
  const generationRef = useRef(0);
  const startedAtRef = useRef("");

  const cleanup = useCallback(async () => {
    try { trackRef.current?.stop(); trackRef.current?.close(); } catch { /* already closed */ }
    trackRef.current = null;
    try { await clientRef.current?.leave(); } catch { /* already left */ }
    clientRef.current = null;
  }, []);

  useEffect(() => () => {
    generationRef.current++;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    void cleanup();
  }, [cleanup]);

  const start = async () => {
    const generation = ++generationRef.current;
    setState("connecting");
    chunksRef.current = [];
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot record audio.");
      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
      if (generation !== generationRef.current) return;
      AgoraRTC.setLogLevel(3);
      const channel = `roxanne-${crypto.randomUUID()}`;
      const uid = Math.floor(Math.random() * 2_000_000_000) + 1;
      const credentials = await fetch("/api/agora/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel, uid }) });
      const payload = await credentials.json();
      if (generation !== generationRef.current) return;
      if (!credentials.ok) throw new Error(payload.error || "Could not connect to Agora.");
      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      clientRef.current = client;
      await client.join(payload.appId, channel, payload.token ?? null, uid);
      if (generation !== generationRef.current) { await client.leave(); return; }
      const track = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: "speech_standard", AEC: true, ANS: true, AGC: true });
      if (generation !== generationRef.current) { track.stop(); track.close(); await client.leave(); return; }
      trackRef.current = track;
      await client.publish(track);
      if (generation !== generationRef.current) { await cleanup(); return; }

      const stream = new MediaStream([track.getMediaStreamTrack()]);
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.start(1000);
      startedAtRef.current = new Date().toISOString();
      channelRef.current = channel;
      setState("live");
    } catch (error) {
      await cleanup();
      if (generation !== generationRef.current) return;
      setState("idle");
      onError(error instanceof Error ? error.message : "Could not start live audio.");
    }
  };

  const stop = async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setState("stopping");
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      recorder.stop();
    });
    recorderRef.current = null;
    await cleanup();
    setState("idle");
    if (!blob.size) return onError("The live recording was empty.");
    onRecorded(new File([blob], `roxanne-${Date.now()}.webm`, { type: blob.type }), channelRef.current, { startAt: startedAtRef.current, endAt: new Date().toISOString() });
  };

  const live = state === "live" || state === "stopping";
  return (
    <motion.button type="button" className={live ? "button live-recorder is-live" : "button live-recorder"} whileTap={{ scale: .98 }} disabled={state === "connecting" || state === "stopping"} onClick={() => live ? void stop() : void start()}>
      {live ? <Square /> : <Mic />}
      <span>{state === "connecting" ? dict.audio.joining : live ? dict.audio.stopRecording : dict.audio.startRecording}</span>
      {live ? <i aria-hidden="true" /> : null}
    </motion.button>
  );
}
