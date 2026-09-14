#include "lantern_agora.h"

#include <stdio.h>
#include <string.h>

#include "agora_rtc_api.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

#include "lantern_audio.h"
#include "lantern_board.h"
#include "lantern_transcript.h"

#define AGORA_JOINED_BIT BIT0
#define AGORA_PCM_SAMPLE_RATE 8000
#define AGORA_PCM_FRAME_SAMPLES 160

static const char *TAG = "lantern_agora";
static EventGroupHandle_t s_events;
static connection_id_t s_connection = CONNECTION_ID_INVALID;
static bool s_initialized;
static uint32_t s_stt_bot_uid;
static uint32_t s_sent_frames;
static volatile bool s_stop_command_requested;
static char s_command_window[384];

static bool protobuf_varint(const uint8_t *data, size_t length, size_t *cursor,
                            uint64_t *value) {
  if (!data || !cursor || !value) return false;
  *value = 0;
  unsigned shift = 0;
  while (*cursor < length && shift <= 63) {
    uint8_t byte = data[(*cursor)++];
    *value |= (uint64_t)(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return true;
    shift += 7;
  }
  return false;
}

static bool protobuf_delimited(const uint8_t *data, size_t length, size_t *cursor,
                               const uint8_t **value, size_t *value_length) {
  uint64_t encoded_length = 0;
  if (!protobuf_varint(data, length, cursor, &encoded_length) ||
      encoded_length > SIZE_MAX || *cursor + (size_t)encoded_length > length) {
    return false;
  }
  *value = data + *cursor;
  *value_length = (size_t)encoded_length;
  *cursor += *value_length;
  return true;
}

static bool protobuf_skip(const uint8_t *data, size_t length, size_t *cursor,
                          unsigned wire_type) {
  uint64_t ignored = 0;
  const uint8_t *bytes = NULL;
  size_t byte_length = 0;
  if (wire_type == 0) return protobuf_varint(data, length, cursor, &ignored);
  if (wire_type == 1 && *cursor + 8 <= length) {
    *cursor += 8;
    return true;
  }
  if (wire_type == 2) {
    return protobuf_delimited(data, length, cursor, &bytes, &byte_length);
  }
  if (wire_type == 5 && *cursor + 4 <= length) {
    *cursor += 4;
    return true;
  }
  return false;
}

static bool decode_final_word(const uint8_t *data, size_t length,
                              char *text, size_t capacity) {
  size_t cursor = 0;
  bool is_final = false;
  text[0] = '\0';
  while (cursor < length) {
    uint64_t tag = 0;
    if (!protobuf_varint(data, length, &cursor, &tag)) return false;
    unsigned field = (unsigned)(tag >> 3);
    unsigned wire_type = (unsigned)(tag & 7);
    if (field == 1 && wire_type == 2) {
      const uint8_t *value = NULL;
      size_t value_length = 0;
      if (!protobuf_delimited(data, length, &cursor, &value, &value_length)) return false;
      size_t copy = value_length < capacity - 1 ? value_length : capacity - 1;
      memcpy(text, value, copy);
      text[copy] = '\0';
    } else if (field == 4 && wire_type == 0) {
      uint64_t value = 0;
      if (!protobuf_varint(data, length, &cursor, &value)) return false;
      is_final = value != 0;
    } else if (!protobuf_skip(data, length, &cursor, wire_type)) {
      return false;
    }
  }
  return is_final && text[0];
}

static void append_command_words(const char *words) {
  if (!words || !words[0]) return;
  char normalized[160];
  size_t count = 0;
  for (const unsigned char *cursor = (const unsigned char *)words;
       *cursor && count < sizeof(normalized) - 1; ++cursor) {
    unsigned char value = *cursor;
    normalized[count++] = value >= 'A' && value <= 'Z' ? (char)(value + ('a' - 'A')) : (char)value;
  }
  normalized[count] = '\0';
  size_t current = strlen(s_command_window);
  size_t incoming = strlen(normalized);
  size_t needed = incoming + (current ? 1 : 0);
  if (needed >= sizeof(s_command_window)) {
    memcpy(s_command_window, normalized + incoming - (sizeof(s_command_window) - 1),
      sizeof(s_command_window) - 1);
    s_command_window[sizeof(s_command_window) - 1] = '\0';
  } else {
    if (current + needed >= sizeof(s_command_window)) {
      size_t remove = current + needed - sizeof(s_command_window) + 1;
      memmove(s_command_window, s_command_window + remove, current - remove + 1);
      current -= remove;
    }
    if (current) s_command_window[current++] = ' ';
    memcpy(s_command_window + current, normalized, incoming + 1);
  }
  if (strstr(s_command_window, "ring stop") ||
      strstr(s_command_window, "lantern stop") ||
      strstr(s_command_window, "ring we're done") ||
      strstr(s_command_window, "ring we are done") ||
      strstr(s_command_window, "ring meeting done") ||
      strstr(s_command_window, "ring habis") ||
      strstr(s_command_window, "lantern habis")) {
    s_stop_command_requested = true;
    ESP_LOGI(TAG, "voice stop command recognised from Agora captions");
  }
}

static void inspect_command_packet(const char *packet, size_t length) {
  const uint8_t *data = (const uint8_t *)packet;
  size_t cursor = 0;
  while (cursor < length) {
    uint64_t tag = 0;
    if (!protobuf_varint(data, length, &cursor, &tag)) return;
    unsigned field = (unsigned)(tag >> 3);
    unsigned wire_type = (unsigned)(tag & 7);
    if (field == 10 && wire_type == 2) {
      const uint8_t *word = NULL;
      size_t word_length = 0;
      if (!protobuf_delimited(data, length, &cursor, &word, &word_length)) return;
      char text[160];
      if (decode_final_word(word, word_length, text, sizeof(text))) append_command_words(text);
    } else if (!protobuf_skip(data, length, &cursor, wire_type)) {
      return;
    }
  }
}

static void on_join_success(connection_id_t connection, uint32_t uid, int elapsed) {
  (void)connection;
  ESP_LOGI(TAG, "joined Agora as %lu in %d ms", (unsigned long)uid, elapsed);
  xEventGroupSetBits(s_events, AGORA_JOINED_BIT);
}

static void on_connection_lost(connection_id_t connection) {
  (void)connection;
  ESP_LOGW(TAG, "Agora connection lost");
  xEventGroupClearBits(s_events, AGORA_JOINED_BIT);
}

static void on_user_joined(connection_id_t connection, uint32_t uid, int elapsed) {
  (void)connection;
  ESP_LOGI(TAG, "remote Agora user %lu joined in %d ms%s", (unsigned long)uid, elapsed,
    uid == s_stt_bot_uid ? " (STT bot)" : "");
}

static void on_user_offline(connection_id_t connection, uint32_t uid, int reason) {
  (void)connection;
  ESP_LOGI(TAG, "remote Agora user %lu left (reason %d)%s", (unsigned long)uid, reason,
    uid == s_stt_bot_uid ? " (STT bot)" : "");
}

static void on_error(connection_id_t connection, int code, const char *message) {
  (void)connection;
  ESP_LOGE(TAG, "Agora error %d: %s", code, message ? message : "unknown");
}

static void on_stream_message(connection_id_t connection, uint32_t uid, int stream_id,
                              const char *data, size_t length, uint64_t sent_ts) {
  (void)connection;
  (void)stream_id;
  (void)sent_ts;
  if (!data || !length) return;
  // Each Lantern session uses a random, token-protected RTC channel containing
  // only the wearable and its STT bot. Accept the remote data stream even if an
  // embedded SDK reports a remapped bot UID, while retaining the mismatch in
  // diagnostics.
  if (uid != s_stt_bot_uid) {
    ESP_LOGW(TAG, "caption packet came from unexpected Agora uid %lu (expected %lu)",
      (unsigned long)uid, (unsigned long)s_stt_bot_uid);
  }
  if (!lantern_transcript_append(data, length)) {
    ESP_LOGW(TAG, "could not stage %u-byte STT packet", (unsigned)length);
  } else {
    ESP_LOGI(TAG, "staged Agora caption packet %u (%u bytes)",
      lantern_transcript_packet_count(), (unsigned)length);
  }
  inspect_command_packet(data, length);
}

static void send_microphone_frame(const int16_t *samples, size_t count) {
  if (!samples || !count || s_connection == CONNECTION_ID_INVALID ||
      !(xEventGroupGetBits(s_events) & AGORA_JOINED_BIT)) return;
  // This ESP32-S3 build of Agora IoT SDK includes the G.711u encoder. Its
  // built-in Opus encoder is absent and aborts during channel setup. Keep the
  // local WAV at 16 kHz, then downsample each 20 ms microphone frame to the
  // 8 kHz PCM input required by G.711u before publishing it to Agora.
  if (count != AGORA_PCM_FRAME_SAMPLES * 2) {
    ESP_LOGW(TAG, "unexpected microphone frame: %u samples", (unsigned)count);
    return;
  }
  int16_t downsampled[AGORA_PCM_FRAME_SAMPLES];
  for (size_t index = 0; index < AGORA_PCM_FRAME_SAMPLES; ++index) {
    downsampled[index] = samples[index * 2];
  }
  audio_frame_info_t frame = { .data_type = AUDIO_DATA_TYPE_PCM };
  int result = agora_rtc_send_audio_data(
    s_connection, downsampled, sizeof(downsampled), &frame);
  if (result < 0 && result != -ERR_NOT_IN_CHANNEL) {
    ESP_LOGW(TAG, "audio send failed: %s", agora_rtc_err_2_str(result));
  } else if (result == 0 && ++s_sent_frames % 250 == 0) {
    ESP_LOGI(TAG, "published %lu Agora microphone frames", (unsigned long)s_sent_frames);
  }
}

static void cleanup(void) {
  lantern_audio_set_streaming(false);
  lantern_audio_set_frame_callback(NULL);
  if (s_connection != CONNECTION_ID_INVALID) {
    agora_rtc_leave_channel(s_connection);
    agora_rtc_destroy_connection(s_connection);
    s_connection = CONNECTION_ID_INVALID;
  }
  if (s_initialized) {
    agora_rtc_fini();
    s_initialized = false;
  }
  if (s_events) xEventGroupClearBits(s_events, AGORA_JOINED_BIT);
}

esp_err_t lantern_agora_start(const lantern_agora_transport_t *transport) {
  if (!transport || !transport->app_id[0] || !transport->channel[0] ||
      !transport->token[0] || !transport->publisher_uid || !transport->stt_bot_uid) {
    return ESP_ERR_INVALID_ARG;
  }
  cleanup();
  if (!s_events) s_events = xEventGroupCreate();
  if (!s_events) return ESP_ERR_NO_MEM;
  lantern_transcript_reset();
  s_stt_bot_uid = transport->stt_bot_uid;
  s_sent_frames = 0;
  s_stop_command_requested = false;
  s_command_window[0] = '\0';

  agora_rtc_event_handler_t handlers = {0};
  handlers.on_join_channel_success = on_join_success;
  handlers.on_connection_lost = on_connection_lost;
  handlers.on_user_joined = on_user_joined;
  handlers.on_user_offline = on_user_offline;
  handlers.on_error = on_error;
  handlers.on_stream_message = on_stream_message;
  rtc_service_option_t service = {0};
  service.area_code = AREA_CODE_GLOB;
  service.log_cfg.log_level = RTC_LOG_WARNING;
  service.log_cfg.log_disable = false;
  service.log_cfg.log_printf = printf;
  int result = agora_rtc_init(transport->app_id, &handlers, &service);
  if (result < 0) {
    ESP_LOGE(TAG, "Agora init failed: %s", agora_rtc_err_2_str(result));
    return ESP_FAIL;
  }
  s_initialized = true;
  result = agora_rtc_create_connection(&s_connection);
  if (result < 0) {
    ESP_LOGE(TAG, "Agora connection failed: %s", agora_rtc_err_2_str(result));
    cleanup();
    return ESP_FAIL;
  }
  rtc_channel_options_t options = {0};
  options.auto_subscribe_audio = false;
  options.auto_subscribe_video = false;
  options.audio_codec_opt.audio_codec_type = AUDIO_CODEC_TYPE_G711U;
  options.audio_codec_opt.pcm_sample_rate = AGORA_PCM_SAMPLE_RATE;
  options.audio_codec_opt.pcm_channel_num = 1;
  options.audio_codec_opt.pcm_duration = 20;
  xEventGroupClearBits(s_events, AGORA_JOINED_BIT);
  result = agora_rtc_join_channel(
    s_connection, transport->channel, transport->publisher_uid,
    transport->token, &options);
  if (result < 0) {
    ESP_LOGE(TAG, "Agora join failed: %s", agora_rtc_err_2_str(result));
    cleanup();
    return ESP_FAIL;
  }
  EventBits_t joined = xEventGroupWaitBits(
    s_events, AGORA_JOINED_BIT, pdFALSE, pdTRUE, pdMS_TO_TICKS(15000));
  if (!(joined & AGORA_JOINED_BIT)) {
    ESP_LOGE(TAG, "Agora join timed out");
    cleanup();
    return ESP_ERR_TIMEOUT;
  }
  lantern_audio_set_frame_callback(send_microphone_frame);
  return ESP_OK;
}

void lantern_agora_stop(void) { cleanup(); }

bool lantern_agora_is_connected(void) {
  return s_events && (xEventGroupGetBits(s_events) & AGORA_JOINED_BIT);
}

bool lantern_agora_take_stop_command(void) {
  bool requested = s_stop_command_requested;
  s_stop_command_requested = false;
  return requested;
}
