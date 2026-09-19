const DEVICE_AUDIO_RATE = 24_000;

export function deviceAudioRate() {
  return DEVICE_AUDIO_RATE;
}

export function createAcknowledgementTone(kind: string) {
  const durationSeconds = 0.24;
  const sampleCount = Math.round(DEVICE_AUDIO_RATE * durationSeconds);
  const pcm = Buffer.alloc(sampleCount * 2);
  const frequencies =
    kind === "consent_no" || kind === "consent_failure"
      ? [520, 390]
      : kind === "unknown"
        ? [330, 330]
        : [660, 880];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const progress = sample / sampleCount;
    const frequency = frequencies[progress < 0.5 ? 0 : 1];
    const envelope = Math.sin(Math.PI * progress);
    const value = Math.round(
      Math.sin((2 * Math.PI * frequency * sample) / DEVICE_AUDIO_RATE) *
        envelope *
        7_000,
    );
    pcm.writeInt16LE(value, sample * 2);
  }
  return pcm;
}
