import { createClient } from '@supabase/supabase-js';

// Read-only release checks. Never print settings or signed recording URLs.
const envFile = process.argv[2];
if (envFile) process.loadEnvFile(envFile);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Provide NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or an env-file argument. Sensitive Vercel variables may be exported as empty values; run this check in an environment with the actual server key.');
  process.exit(1);
}
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
});
let failures = 0;
const report = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
  if (!ok) failures++;
};
const requirements = [
  ['lantern_sessions', 'id,processing_stage,upload_bytes,upload_total_bytes,final_transcription,recording_started_at'],
  ['lantern_audio_uploads', 'session_id'],
  ['lantern_processing_jobs', 'session_id'],
  ['device_reports', 'id'],
  ['device_voice_prompts', 'id'],
  ['meeting_delivery_preferences', 'user_id'],
  ['meeting_deliveries', 'id'],
];
await Promise.all(requirements.map(async ([table, columns]) => {
  const { error } = await client.from(table).select(columns).limit(0);
  report(table, !error, error ? `${error.code}: ${error.message}` : 'schema available');
}));
const { data: bucket, error: bucketError } = await client.storage.getBucket('recordings');
report('Private recordings bucket', !bucketError && bucket?.public === false);
report('Recording size limit', !bucketError && (!bucket.file_size_limit || Number(bucket.file_size_limit) >= 25 * 1024 * 1024), 'must allow at least 25 MiB');
report('Background-processing secret', (process.env.PROCESSING_WORKER_SECRET?.length || 0) >= 32, 'must be configured identically on web and worker');

const { data: devices, error: deviceError } = await client.from('devices').select('*').order('last_seen_at', { ascending: false }).limit(5);
if (deviceError) report('Device health read', false, deviceError.message);
else console.log('Devices:', JSON.stringify(devices.map(d => ({
  id: d.id, model: d.model, firmware: d.firmware_version, status: d.status,
  lastSeenAt: d.last_seen_at, telemetry: d.telemetry ? {
    state: d.telemetry.state, firmware: d.telemetry.firmwareVersion,
  } : undefined,
}))));

process.exitCode = failures ? 1 : 0;
