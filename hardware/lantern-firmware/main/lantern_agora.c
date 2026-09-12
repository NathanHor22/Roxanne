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

static const char *TAG = "lantern_agora";
static EventGroupHandle_t s_events;
static connection_id_t s_connection = CONNECTION_ID_INVALID;
static bool s_initialized;
static uint32_t s_stt_bot_uid;

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

static void on_error(connection_id_t connection, int code, const char *message) {
  (void)connection;
  ESP_LOGE(TAG, "Agora error %d: %s", code, message ? message : "unknown");
}

static void on_stream_message(connection_id_t connection, uint32_t uid, int stream_id,
                              const char *data, size_t length, uint64_t sent_ts) {
  (void)connection;
  (void)stream_id;
  (void)sent_ts;
  if (uid != s_stt_bot_uid || !data || !length) return;
  if (!lantern_transcript_append(data, length)) {
    ESP_LOGW(TAG, "could not stage %u-byte STT packet", (unsigned)length);
  }
}

static void send_microphone_frame(const int16_t *samples, size_t count) {
  if (!samples || !count || s_connection == CONNECTION_ID_INVALID ||
      !(xEventGroupGetBits(s_events) & AGORA_JOINED_BIT)) return;
  audio_frame_info_t frame = { .data_type = AUDIO_DATA_TYPE_PCM };
  int result = agora_rtc_send_audio_data(
    s_connection, samples, count * sizeof(samples[0]), &frame);
  if (result < 0 && result != -ERR_NOT_IN_CHANNEL) {
    ESP_LOGW(TAG, "audio send failed: %s", agora_rtc_err_2_str(result));
  }
}

static void cleanup(void) {
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

  agora_rtc_event_handler_t handlers = {0};
  handlers.on_join_channel_success = on_join_success;
  handlers.on_connection_lost = on_connection_lost;
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
  options.audio_codec_opt.audio_codec_type = AUDIO_CODEC_TYPE_OPUS;
  options.audio_codec_opt.pcm_sample_rate = LANTERN_MIC_SAMPLE_RATE;
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
