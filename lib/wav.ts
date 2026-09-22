export interface CanonicalWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationSeconds: number;
}

function ascii(data: Uint8Array, offset: number, length: number) {
  return new TextDecoder("ascii").decode(data.subarray(offset, offset + length));
}

/** Validates the canonical PCM WAV emitted by the Quipus firmware. */
export function parseLanternWav(data: Uint8Array): CanonicalWav {
  if (data.length < 44 || ascii(data, 0, 4) !== "RIFF" || ascii(data, 8, 8) !== "WAVEfmt ") {
    throw new Error("Quipus audio is not a WAV file.");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const riffSize = view.getUint32(4, true);
  const formatLength = view.getUint32(16, true);
  const audioFormat = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  if (
    riffSize + 8 !== data.length ||
    formatLength !== 16 ||
    audioFormat !== 1 ||
    channels !== 1 ||
    sampleRate !== 16_000 ||
    bitsPerSample !== 16 ||
    ascii(data, 36, 4) !== "data"
  ) {
    throw new Error("Quipus audio must be canonical 16 kHz mono 16-bit PCM WAV.");
  }
  const dataBytes = view.getUint32(40, true);
  if (dataBytes === 0 || dataBytes + 44 !== data.length || dataBytes % 2 !== 0) {
    throw new Error("Quipus WAV data length is invalid.");
  }
  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
    durationSeconds: dataBytes / (sampleRate * channels * (bitsPerSample / 8)),
  };
}
