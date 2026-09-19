#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "lantern_agora.h"
#include "lantern_audio.h"
#include "lantern_board.h"
#include "lantern_board_io.h"
#include "lantern_display.h"
#include "lantern_network.h"
#include "lantern_sd.h"
#include "lantern_storage.h"
#include "lantern_transcript.h"
#include "lantern_wake.h"

typedef enum {
  LOCAL_READY,
  LOCAL_COMMAND_LISTENING,
  LOCAL_COMMAND_PROCESSING,
  LOCAL_AWAITING_CONSENT,
  LOCAL_RECORDING,
  LOCAL_SAVING,
  LOCAL_COMPLETE,
  LOCAL_STATUS,
  LOCAL_ERROR,
} local_state_t;

typedef enum {
  RECOVERY_NONE,
  RECOVERY_SESSION_START,
  RECOVERY_COMMAND,
  RECOVERY_CONSENT_CAPTURE,
  RECOVERY_RECORDING_START,
  RECOVERY_STOP,
  RECOVERY_UPLOAD,
  RECOVERY_STATUS,
  RECOVERY_SUMMARY,
} recovery_action_t;

static const char *TAG = "lantern";
static lantern_config_t s_config;
static local_state_t s_state = LOCAL_READY;
static recovery_action_t s_recovery = RECOVERY_NONE;
#if LANTERN_BATTERY_INSTALLED
static adc_oneshot_unit_handle_t s_adc;
#endif
static int s_battery_level = 50;
static TickType_t s_state_entered_at;
static TickType_t s_last_summary_retry_at;
static lantern_cloud_session_t s_cloud_session;
static lantern_cloud_session_t s_pending_completion;
static unsigned s_last_recording_second = UINT32_MAX;
static volatile bool s_network_update_pending;
static volatile bool s_summary_retrying;
static bool s_summary_retry_pending;
static bool s_pair_announcement_shown;
static bool s_agora_active;
static bool s_used_agora;
static bool s_transcript_uploaded;
static bool s_audio_uploaded;
static bool s_wake_available;
static bool s_sd_recording_active;
static bool s_sd_archive_required;
static unsigned s_recording_duration_seconds;

#define VOICE_ACTIVITY_LEVEL 180
#define VOICE_SILENCE_MS 650
#define VOICE_MIN_CAPTURE_MS 1000

static void show_ready(void);
static void start_spoken_consent(bool announce_request);
static void capture_spoken_consent(void);
static esp_err_t accept_recording_consent(void);
static void finalise_recording(void);
static void upload_current_session(bool announce_upload);
static void play_status_report(void);
static void capture_wake_command(void);
static bool ready_for_cloud_action(void);

static void capture_short_utterance(unsigned maximum_ms) {
  lantern_audio_set_recording(true);
  TickType_t started_at = xTaskGetTickCount();
  TickType_t last_voice_at = started_at;
  bool heard_voice = false;
  while ((xTaskGetTickCount() - started_at) * portTICK_PERIOD_MS < maximum_ms) {
    TickType_t now = xTaskGetTickCount();
    unsigned elapsed_ms = (unsigned)((now - started_at) * portTICK_PERIOD_MS);
    if (lantern_audio_level() >= VOICE_ACTIVITY_LEVEL) {
      heard_voice = true;
      last_voice_at = now;
    } else if (heard_voice && elapsed_ms >= VOICE_MIN_CAPTURE_MS &&
               (now - last_voice_at) * portTICK_PERIOD_MS >= VOICE_SILENCE_MS) {
      break;
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
  lantern_audio_set_recording(false);
  ESP_LOGI(TAG, "voice window captured %u ms activity=%s level=%u",
    (unsigned)((xTaskGetTickCount() - started_at) * portTICK_PERIOD_MS),
    heard_voice ? "yes" : "no", (unsigned)lantern_audio_level());
}

static unsigned elapsed_state_seconds(void) {
  return (unsigned)((xTaskGetTickCount() - s_state_entered_at) * portTICK_PERIOD_MS / 1000);
}

static void show_recording_progress(void) {
  unsigned elapsed = elapsed_state_seconds();
  if (elapsed == s_last_recording_second) return;
  s_last_recording_second = elapsed;
  char detail[40];
  snprintf(detail, sizeof(detail), "%02u:%02u %s", elapsed / 60, elapsed % 60,
    LANTERN_HAS_TOUCHSCREEN ? "TAP SCREEN TO STOP" : "PRESS CENTRE TO STOP");
  lantern_display_show(LANTERN_SCREEN_RECORDING, detail);
}

static void stop_local_capture(void) {
  lantern_wake_set_enabled(false);
  lantern_audio_set_recording(false);
  lantern_audio_set_streaming(false);
  lantern_agora_stop();
  s_agora_active = false;
  if (s_sd_recording_active) {
    lantern_sd_recording_abort();
    s_sd_recording_active = false;
  }
}

static void show_error(recovery_action_t recovery, const char *detail, const char *prompt) {
  stop_local_capture();
  s_recovery = recovery;
  s_state = LOCAL_ERROR;
  s_state_entered_at = xTaskGetTickCount();
  lantern_display_show(LANTERN_SCREEN_ERROR, detail ? detail : "PRESS TO RETRY");
  if (!prompt || lantern_network_play_prompt(prompt) != ESP_OK) lantern_audio_chime(3);
}

static void clear_active_session(void) {
  memset(&s_cloud_session, 0, sizeof(s_cloud_session));
  s_agora_active = false;
  s_used_agora = false;
  s_transcript_uploaded = false;
  s_audio_uploaded = false;
  s_sd_archive_required = false;
  s_recording_duration_seconds = 0;
}

#if LANTERN_BATTERY_INSTALLED
static int battery_from_adc(int raw) {
  const int adc_points[] = {2030, 2134, 2252, 2370, 2488, 2606};
  const int levels[] = {0, 20, 40, 60, 80, 100};
  raw += 80;
  if (raw <= adc_points[0]) return 0;
  if (raw >= adc_points[5]) return 100;
  for (int index = 0; index < 5; ++index) {
    if (raw < adc_points[index + 1]) {
      return levels[index] +
        (raw - adc_points[index]) * (levels[index + 1] - levels[index]) /
        (adc_points[index + 1] - adc_points[index]);
    }
  }
  return 100;
}
#endif

static void power_and_battery_init(void) {
#if LANTERN_HAS_POWER_HOLD
  gpio_config_t output = {
    .pin_bit_mask = 1ULL << LANTERN_POWER_HOLD_GPIO,
    .mode = GPIO_MODE_OUTPUT,
  };
  ESP_ERROR_CHECK(gpio_config(&output));
  gpio_set_level(LANTERN_POWER_HOLD_GPIO, 1);
#endif
#if LANTERN_HAS_CHARGING_SIGNAL
  gpio_config_t charging = {
    .pin_bit_mask = 1ULL << LANTERN_CHARGING_GPIO,
    .mode = GPIO_MODE_INPUT,
  };
  ESP_ERROR_CHECK(gpio_config(&charging));
#endif

#if LANTERN_BATTERY_INSTALLED
  adc_oneshot_unit_init_cfg_t init = { .unit_id = ADC_UNIT_1, .ulp_mode = ADC_ULP_MODE_DISABLE };
  ESP_ERROR_CHECK(adc_oneshot_new_unit(&init, &s_adc));
  adc_oneshot_chan_cfg_t channel = { .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_12 };
  ESP_ERROR_CHECK(adc_oneshot_config_channel(s_adc, LANTERN_BATTERY_ADC_CHANNEL, &channel));
#else
  // The first V2 showcase is USB powered. Avoid turning the unconnected
  // battery-divider pin into random dashboard telemetry.
  s_battery_level = 100;
#endif
}

static void update_battery_level(void) {
#if LANTERN_BATTERY_INSTALLED
  int raw = 0;
  if (adc_oneshot_read(s_adc, LANTERN_BATTERY_ADC_CHANNEL, &raw) == ESP_OK) {
    s_battery_level = battery_from_adc(raw);
  }
#else
  s_battery_level = 100;
#endif
}

static void show_ready(void) {
  lantern_wake_set_enabled(false);
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  s_state = LOCAL_READY;
  s_recovery = RECOVERY_NONE;
  s_state_entered_at = xTaskGetTickCount();
  if (network.setup_portal_active && (!network.wifi_connected || !network.paired)) {
    lantern_display_show(LANTERN_SCREEN_SETUP, network.setup_ssid);
  } else if (network.wifi_connected && network.paired) {
    lantern_display_show(
      LANTERN_SCREEN_READY,
      s_wake_available
        ? (LANTERN_HAS_TOUCHSCREEN ? "SAY COMPUTER OR TAP" : "SAY COMPUTER OR PRESS")
        : (LANTERN_HAS_TOUCHSCREEN ? "TAP SCREEN TO START" : "PRESS CENTRE TO START"));
    if (s_wake_available) lantern_wake_set_enabled(true);
  } else if (network.wifi_connected) {
    lantern_display_show(LANTERN_SCREEN_READY, "PAIR IN DASHBOARD");
  } else {
    lantern_display_show(LANTERN_SCREEN_CONNECTING, "WAIT OR OPEN WIFI SETUP");
  }
}

static void network_changed(const lantern_network_status_t *status) {
  ESP_LOGI(TAG, "network wifi=%d portal=%d paired=%d ip=%s", status->wifi_connected,
    status->setup_portal_active, status->paired, status->ip_address);
  // ESP-IDF invokes this callback on the small sys_evt task. Defer display,
  // speech, and delays to Lantern's health task.
  s_network_update_pending = true;
}

static esp_err_t open_quick_consent(void) {
  lantern_wake_set_enabled(false);
  lantern_display_show(LANTERN_SCREEN_CONNECTING, "OPENING SESSION");
  if (lantern_network_begin_quick(&s_cloud_session) != ESP_OK) {
    lantern_network_status_t network;
    lantern_network_get_status(&network);
    if (!network.paired) {
      clear_active_session();
      show_ready();
      return ESP_FAIL;
    }
    show_error(RECOVERY_SESSION_START, "SESSION START FAILED", "session_error");
    return ESP_FAIL;
  }
  s_state = LOCAL_AWAITING_CONSENT;
  s_state_entered_at = xTaskGetTickCount();
  lantern_display_show(LANTERN_SCREEN_CONSENT, "SAY YES OR NO");
  ESP_LOGI(TAG, "quick mode awaiting spoken consent");
  return ESP_OK;
}

static esp_err_t capture_consent_response(const char *context, char intent[32]) {
  lantern_display_show(LANTERN_SCREEN_CONSENT, "SAY YES OR NO");
  lantern_audio_chime(1);
  vTaskDelay(pdMS_TO_TICKS(250));
  capture_short_utterance(3000);
  if (lantern_audio_buffered_samples() < LANTERN_MIC_SAMPLE_RATE / 2) return ESP_FAIL;
  lantern_display_show(LANTERN_SCREEN_CONNECTING, "VERIFYING CONSENT");
  return lantern_network_run_voice_command(context, s_battery_level, intent, 32);
}

static void cancel_pending_consent(void) {
  if (s_cloud_session.session_id[0] &&
      lantern_network_confirm_consent(&s_cloud_session, false, NULL) != ESP_OK) {
    ESP_LOGW(TAG, "server did not acknowledge rejected consent; requesting reset");
    lantern_network_restart_session();
  }
  clear_active_session();
  show_ready();
}

static esp_err_t accept_recording_consent(void) {
  lantern_agora_transport_t transport;
  memset(&transport, 0, sizeof(transport));
  lantern_display_show(LANTERN_SCREEN_CONNECTING, "STARTING RECORDING");
  if (lantern_network_confirm_consent(&s_cloud_session, true, &transport) != ESP_OK) {
    show_error(RECOVERY_RECORDING_START, "RECORDING START FAILED", "session_error");
    return ESP_FAIL;
  }

  lantern_transcript_reset();
  s_agora_active = lantern_agora_start(&transport) == ESP_OK;
  s_used_agora = s_agora_active;
  if (!s_agora_active) {
    ESP_LOGW(TAG, "Agora device join failed; continuing with the local WAV archive");
    if (lantern_network_play_prompt("local_recording") != ESP_OK) lantern_audio_chime(1);
  }
  if (lantern_network_capture_started(&s_cloud_session) != ESP_OK) {
    show_error(RECOVERY_RECORDING_START, "CLOCK SYNC FAILED", "session_error");
    return ESP_FAIL;
  }

  s_sd_recording_active = lantern_sd_recording_begin(s_cloud_session.session_id) == ESP_OK;
  s_sd_archive_required = s_sd_recording_active;
  s_recording_duration_seconds = 0;
  if (!s_sd_recording_active) {
    ESP_LOGW(TAG, "microSD archive unavailable; retaining the 30-second PSRAM fallback");
  }

  s_state = LOCAL_RECORDING;
  s_recovery = RECOVERY_NONE;
  s_state_entered_at = xTaskGetTickCount();
  s_last_recording_second = UINT32_MAX;
  s_transcript_uploaded = false;
  s_audio_uploaded = false;
  lantern_audio_set_recording(true);
  lantern_audio_set_streaming(s_agora_active);
  show_recording_progress();
  ESP_LOGI(TAG, "%s recording started at %s %s Malaysia time",
    s_agora_active ? "Agora and local" : "local fallback",
    s_cloud_session.local_date, s_cloud_session.local_time);
  return ESP_OK;
}

static void capture_spoken_consent(void) {
  unsigned rejection_count = 0;
  for (unsigned attempt = 0; attempt < 3; ++attempt) {
    char consent[32];
    const char *context = rejection_count ? "consent_retry" : "consent";
    if (capture_consent_response(context, consent) != ESP_OK) {
      show_error(RECOVERY_CONSENT_CAPTURE, "CONSENT CHECK FAILED", "consent_error");
      return;
    }
    if (strcmp(consent, "consent_yes") == 0) {
      accept_recording_consent();
      return;
    }
    if (strcmp(consent, "consent_no") == 0 && ++rejection_count >= 2) {
      cancel_pending_consent();
      return;
    }
  }
  if (lantern_network_play_prompt("consent_failure") != ESP_OK) lantern_audio_chime(2);
  cancel_pending_consent();
}

static void start_spoken_consent(bool announce_request) {
  if (open_quick_consent() != ESP_OK) return;
  if (announce_request && lantern_network_play_prompt("consent_request") != ESP_OK) {
    lantern_audio_chime(1);
  }
  capture_spoken_consent();
}

static void session_complete(bool processing_pending) {
  unsigned captured_seconds = s_recording_duration_seconds
    ? s_recording_duration_seconds
    : lantern_audio_buffered_seconds();
  s_state = LOCAL_COMPLETE;
  s_recovery = RECOVERY_NONE;
  lantern_display_show(
    LANTERN_SCREEN_COMPLETE,
    processing_pending ? "SUMMARY PROCESSING" : "UPLOADED TO DASHBOARD");
  if (lantern_network_play_prompt(
        processing_pending ? "processing_pending" : "upload_complete") != ESP_OK) {
    lantern_audio_chime(2);
  }
  s_state_entered_at = xTaskGetTickCount();
  ESP_LOGI(TAG, "session upload complete; full archive contains %u seconds", captured_seconds);
  clear_active_session();
}

static void upload_current_session(bool announce_upload) {
  s_state = LOCAL_SAVING;
  s_state_entered_at = xTaskGetTickCount();
  if (announce_upload && lantern_network_play_prompt("recording_uploading") != ESP_OK) {
    lantern_audio_chime(1);
  }

  unsigned caption_packets = lantern_transcript_packet_count();
  if (!s_transcript_uploaded && s_used_agora && caption_packets) {
    lantern_display_show(LANTERN_SCREEN_SAVING, "UPLOADING TRANSCRIPT");
    if (lantern_network_upload_transcript(&s_cloud_session) == ESP_OK) {
      s_transcript_uploaded = true;
    } else {
      ESP_LOGW(TAG, "Agora captions unavailable; server will transcribe the WAV archive");
    }
  }

  if (!s_audio_uploaded) {
    if (s_sd_archive_required && !lantern_sd_recording_ready()) {
      ESP_LOGE(TAG, "refusing to replace an SD-backed meeting with the 30-second fallback");
      show_error(RECOVERY_UPLOAD, "FULL SD AUDIO NOT READY", "upload_error");
      return;
    }
    lantern_display_show(LANTERN_SCREEN_SAVING, "UPLOADING AUDIO");
    if (lantern_network_upload_audio(&s_cloud_session) != ESP_OK) {
      show_error(RECOVERY_UPLOAD, "AUDIO UPLOAD PAUSED", "upload_error");
      return;
    }
    s_audio_uploaded = true;
    if (lantern_sd_recording_ready() &&
        lantern_sd_recording_confirm_uploaded() != ESP_OK) {
      ESP_LOGW(TAG, "cloud accepted audio but the local SD copy could not be removed");
    }
  }

  lantern_display_show(LANTERN_SCREEN_SAVING, "PROCESSING SUMMARY");
  if (lantern_network_complete_session(&s_cloud_session) != ESP_OK) {
    s_pending_completion = s_cloud_session;
    s_summary_retry_pending = true;
    s_last_summary_retry_at = xTaskGetTickCount();
    session_complete(true);
    return;
  }
  session_complete(false);
}

static void continue_after_stop(void) {
  lantern_display_show(LANTERN_SCREEN_SAVING, "CLOSING SESSION");
  if (lantern_network_stop_recording(&s_cloud_session) != ESP_OK) {
    show_error(RECOVERY_STOP, "SESSION STOP PAUSED", "stop_error");
    return;
  }
  upload_current_session(true);
}

static void finalise_recording(void) {
  s_state = LOCAL_SAVING;
  s_state_entered_at = xTaskGetTickCount();
  lantern_audio_set_recording(false);
  if (s_sd_recording_active) {
    lantern_display_show(LANTERN_SCREEN_SAVING, "FINALISING SD ARCHIVE");
    if (lantern_sd_recording_finish() != ESP_OK) {
      s_sd_recording_active = false;
      ESP_LOGE(TAG, "microSD finalization failed; the truncated PSRAM fallback will not be uploaded");
      ESP_ERROR_CHECK_WITHOUT_ABORT(lantern_network_abort_session(&s_cloud_session));
      clear_active_session();
      show_error(RECOVERY_NONE, "SD ARCHIVE FAILED", "upload_error");
      return;
    }
    s_sd_recording_active = false;
    size_t archive_bytes = lantern_sd_recording_size();
    if (archive_bytes > 44) {
      s_recording_duration_seconds = (unsigned)(
        (archive_bytes - 44) /
        (LANTERN_MIC_SAMPLE_RATE * sizeof(int16_t)));
    }
    ESP_LOGI(TAG, "complete SD archive ready: %u bytes, %u seconds",
      (unsigned)archive_bytes, s_recording_duration_seconds);
  } else {
    s_recording_duration_seconds = lantern_audio_buffered_seconds();
  }
  lantern_display_show(LANTERN_SCREEN_SAVING, "FINALISING SPEECH");
  // Leave the live microphone path open briefly so Agora can finalize the last
  // sentence. The local archive ends exactly at the centre-button press.
  if (s_agora_active) vTaskDelay(pdMS_TO_TICKS(3000));
  lantern_audio_set_streaming(false);
  lantern_agora_stop();
  s_agora_active = false;
  continue_after_stop();
}

static void play_status_report(void) {
  lantern_wake_set_enabled(false);
  s_state = LOCAL_STATUS;
  s_recovery = RECOVERY_NONE;
  s_state_entered_at = xTaskGetTickCount();
  lantern_display_show(LANTERN_SCREEN_STATUS, "LOADING TODAY");
  if (lantern_network_play_briefing("status", s_battery_level) != ESP_OK) {
    show_error(RECOVERY_STATUS, "REPORT UNAVAILABLE", "status_error");
    return;
  }
  lantern_display_show(LANTERN_SCREEN_STATUS, "REPORT COMPLETE");
  s_state_entered_at = xTaskGetTickCount();
}

static void command_not_recognised(void) {
  s_state = LOCAL_COMMAND_PROCESSING;
  s_state_entered_at = xTaskGetTickCount();
  lantern_display_show(LANTERN_SCREEN_UNDERSTANDING, "COMMAND NOT RECOGNISED");
  lantern_audio_chime(2);
  vTaskDelay(pdMS_TO_TICKS(1200));
  show_ready();
}

static void capture_wake_command(void) {
  if (s_state != LOCAL_READY || !ready_for_cloud_action()) return;
  lantern_wake_set_enabled(false);
  s_state = LOCAL_COMMAND_LISTENING;
  s_recovery = RECOVERY_NONE;
  s_state_entered_at = xTaskGetTickCount();
  lantern_display_show(LANTERN_SCREEN_LISTENING, "START RECORDING OR STATUS");
  lantern_audio_chime(1);
  vTaskDelay(pdMS_TO_TICKS(250));

  capture_short_utterance(4000);
  if (lantern_audio_buffered_samples() < LANTERN_MIC_SAMPLE_RATE / 2) {
    command_not_recognised();
    return;
  }

  s_state = LOCAL_COMMAND_PROCESSING;
  s_state_entered_at = xTaskGetTickCount();
  lantern_display_show(LANTERN_SCREEN_UNDERSTANDING, "CHECKING COMMAND");
  char intent[32];
  esp_err_t result = lantern_network_run_voice_command(
    "wake_command", s_battery_level, intent, sizeof(intent));
  if (result == ESP_ERR_NOT_FOUND) {
    command_not_recognised();
    return;
  }
  if (result != ESP_OK) {
    show_error(RECOVERY_COMMAND, "COMMAND SERVICE OFFLINE", "command_error");
    return;
  }

  if (strcmp(intent, "start_recording") == 0) {
    start_spoken_consent(true);
    return;
  }
  if (strcmp(intent, "status_report") == 0) {
    s_state = LOCAL_STATUS;
    s_recovery = RECOVERY_NONE;
    lantern_display_show(LANTERN_SCREEN_STATUS, "REPORT COMPLETE");
    s_state_entered_at = xTaskGetTickCount();
    return;
  }
  command_not_recognised();
}

static void retry_pending_summary(bool user_requested) {
  if (!s_summary_retry_pending || s_summary_retrying) return;
  s_summary_retrying = true;
  if (user_requested) lantern_display_show(LANTERN_SCREEN_SAVING, "RETRYING SUMMARY");
  esp_err_t result = lantern_network_complete_session(&s_pending_completion);
  s_last_summary_retry_at = xTaskGetTickCount();
  if (result == ESP_OK) {
    s_summary_retry_pending = false;
    memset(&s_pending_completion, 0, sizeof(s_pending_completion));
    ESP_LOGI(TAG, "background summary retry completed");
    if (user_requested) {
      lantern_display_show(LANTERN_SCREEN_COMPLETE, "SUMMARY READY");
      if (lantern_network_play_prompt("upload_complete") != ESP_OK) lantern_audio_chime(2);
      s_state = LOCAL_COMPLETE;
      s_state_entered_at = xTaskGetTickCount();
    }
  } else {
    ESP_LOGW(TAG, "summary retry remains pending");
    if (user_requested) {
      s_state = LOCAL_ERROR;
      s_recovery = RECOVERY_SUMMARY;
      lantern_display_show(LANTERN_SCREEN_ERROR, "SUMMARY STILL PROCESSING");
      if (lantern_network_play_prompt("processing_pending") != ESP_OK) lantern_audio_chime(2);
      s_state_entered_at = xTaskGetTickCount();
    }
  }
  s_summary_retrying = false;
}

static void retry_error(void) {
  recovery_action_t action = s_recovery;
  switch (action) {
    case RECOVERY_SESSION_START:
      lantern_display_show(LANTERN_SCREEN_CONNECTING, "RETRYING SESSION");
      start_spoken_consent(true);
      break;
    case RECOVERY_COMMAND:
      show_ready();
      capture_wake_command();
      break;
    case RECOVERY_CONSENT_CAPTURE:
      s_state = LOCAL_AWAITING_CONSENT;
      if (lantern_network_play_prompt("consent_request") != ESP_OK) lantern_audio_chime(1);
      capture_spoken_consent();
      break;
    case RECOVERY_RECORDING_START:
      s_state = LOCAL_AWAITING_CONSENT;
      accept_recording_consent();
      break;
    case RECOVERY_STOP:
      s_state = LOCAL_SAVING;
      continue_after_stop();
      break;
    case RECOVERY_UPLOAD:
      upload_current_session(false);
      break;
    case RECOVERY_STATUS:
      play_status_report();
      break;
    case RECOVERY_SUMMARY:
      retry_pending_summary(true);
      break;
    case RECOVERY_NONE:
    default:
      show_ready();
      break;
  }
}

static bool ready_for_cloud_action(void) {
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (!network.wifi_connected || !network.paired) {
    show_ready();
    lantern_audio_chime(1);
    return false;
  }
  return true;
}

static void handle_short_press(void) {
  switch (s_state) {
    case LOCAL_READY:
      if (!ready_for_cloud_action()) break;
      if (s_summary_retry_pending) {
        retry_pending_summary(true);
        break;
      }
      start_spoken_consent(true);
      break;
    case LOCAL_RECORDING:
      finalise_recording();
      break;
    case LOCAL_COMPLETE:
    case LOCAL_STATUS:
      show_ready();
      break;
    case LOCAL_ERROR:
      retry_error();
      break;
    case LOCAL_AWAITING_CONSENT:
    case LOCAL_COMMAND_LISTENING:
    case LOCAL_COMMAND_PROCESSING:
    case LOCAL_SAVING:
      break;
  }
}

static void cancel_error(void) {
  lantern_display_show(LANTERN_SCREEN_CONNECTING, "CANCELLING SESSION");
  stop_local_capture();
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (network.wifi_connected && network.paired) {
    if (lantern_network_restart_session() != ESP_OK) {
      ESP_LOGW(TAG, "server reset failed while cancelling; local controls are returning to ready");
    }
  }
  clear_active_session();
  memset(&s_pending_completion, 0, sizeof(s_pending_completion));
  s_summary_retry_pending = false;
  show_ready();
}

static void handle_long_press(void) {
  switch (s_state) {
    case LOCAL_READY:
      if (ready_for_cloud_action()) play_status_report();
      break;
    case LOCAL_RECORDING:
      finalise_recording();
      break;
    case LOCAL_ERROR:
      cancel_error();
      break;
    case LOCAL_COMPLETE:
    case LOCAL_STATUS:
      show_ready();
      break;
    case LOCAL_AWAITING_CONSENT:
    case LOCAL_COMMAND_LISTENING:
    case LOCAL_COMMAND_PROCESSING:
    case LOCAL_SAVING:
      break;
  }
}

static void button_task(void *argument) {
  (void)argument;
#if LANTERN_HAS_PHYSICAL_BUTTONS
  gpio_config_t buttons = {
    .pin_bit_mask = (1ULL << LANTERN_BUTTON_MAIN_GPIO) |
                    (1ULL << LANTERN_BUTTON_UP_GPIO) |
                    (1ULL << LANTERN_BUTTON_DOWN_GPIO),
    .mode = GPIO_MODE_INPUT,
    .pull_up_en = GPIO_PULLUP_ENABLE,
  };
  ESP_ERROR_CHECK(gpio_config(&buttons));
#elif LANTERN_HAS_TOUCHSCREEN
  ESP_ERROR_CHECK(lantern_board_touch_init());
#endif
  // Opening the CH340 serial port briefly drives BOOT. Ignore that transition.
  vTaskDelay(pdMS_TO_TICKS(800));
  bool was_pressed = false;
  bool reset_started = false;
#if LANTERN_HAS_TOUCHSCREEN
  bool touch_reset_announced = false;
#endif
  TickType_t pressed_at = 0;
  TickType_t reset_at = 0;
  while (true) {
    if (s_state == LOCAL_READY && lantern_wake_take_detection()) {
      ESP_LOGI(TAG, "WakeNet activation accepted; opening command window");
      capture_wake_command();
    }
    bool pressed = false;
    bool up_pressed = false;
    bool down_pressed = false;
#if LANTERN_HAS_PHYSICAL_BUTTONS
    pressed = gpio_get_level(LANTERN_BUTTON_MAIN_GPIO) == 0;
    up_pressed = gpio_get_level(LANTERN_BUTTON_UP_GPIO) == 0;
    down_pressed = gpio_get_level(LANTERN_BUTTON_DOWN_GPIO) == 0;
#elif LANTERN_HAS_TOUCHSCREEN
    uint16_t touch_x = 0, touch_y = 0;
    pressed = lantern_board_touch_read(&touch_x, &touch_y);
#endif
    if (pressed && !was_pressed) pressed_at = xTaskGetTickCount();
#if LANTERN_HAS_TOUCHSCREEN
    if (pressed && was_pressed) {
      uint32_t held_ms = (uint32_t)((xTaskGetTickCount() - pressed_at) * portTICK_PERIOD_MS);
      if (held_ms >= 8000) {
        lantern_display_show(LANTERN_SCREEN_SETUP, "RESETTING LANTERN");
        lantern_storage_clear();
        vTaskDelay(pdMS_TO_TICKS(500));
        esp_restart();
      } else if (held_ms >= 5000 && !touch_reset_announced) {
        touch_reset_announced = true;
        lantern_display_show(LANTERN_SCREEN_SETUP, "KEEP HOLDING TO RESET");
      }
    }
#endif
    if (!pressed && was_pressed) {
      uint32_t held_ms = (uint32_t)((xTaskGetTickCount() - pressed_at) * portTICK_PERIOD_MS);
      if (held_ms >= 1200) handle_long_press();
      else if (held_ms >= 40) handle_short_press();
#if LANTERN_HAS_TOUCHSCREEN
      touch_reset_announced = false;
#endif
    }

    if (up_pressed && down_pressed) {
      if (!reset_started) {
        reset_started = true;
        reset_at = xTaskGetTickCount();
      } else if ((xTaskGetTickCount() - reset_at) * portTICK_PERIOD_MS >= 3000) {
        lantern_display_show(LANTERN_SCREEN_SETUP, "CLEARING SETTINGS");
        lantern_storage_clear();
        vTaskDelay(pdMS_TO_TICKS(500));
        esp_restart();
      }
    } else {
      reset_started = false;
    }

    if (s_state == LOCAL_RECORDING) show_recording_progress();
    if ((s_state == LOCAL_COMPLETE || s_state == LOCAL_STATUS) && elapsed_state_seconds() >= 3) {
      show_ready();
    }
    was_pressed = pressed;
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

static void telemetry_task(void *argument) {
  (void)argument;
  unsigned seconds = 0;
  while (true) {
    if (s_network_update_pending) {
      s_network_update_pending = false;
      lantern_network_status_t network;
      lantern_network_get_status(&network);
      if (!network.paired) s_pair_announcement_shown = false;
      if (s_state == LOCAL_READY) {
        if (network.wifi_connected && network.paired && !s_pair_announcement_shown) {
          s_pair_announcement_shown = true;
          lantern_display_show(LANTERN_SCREEN_CONNECTING, "SECTOR 2418 ONLINE");
          if (lantern_network_play_briefing("boot", s_battery_level) != ESP_OK) {
            lantern_audio_chime(2);
            vTaskDelay(pdMS_TO_TICKS(700));
          }
        }
        show_ready();
      }
    }

    update_battery_level();
    if (++seconds % 5 == 0) {
      int charging = 0;
#if LANTERN_HAS_CHARGING_SIGNAL
      charging = gpio_get_level(LANTERN_CHARGING_GPIO);
#endif
      ESP_LOGI(TAG, "health battery=%d%% charging=%d mic_level=%u heap=%u psram=%u state=%d",
        s_battery_level, charging,
        (unsigned)lantern_audio_level(), (unsigned)esp_get_free_heap_size(),
        (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM), s_state);
    }
    if (seconds % 15 == 0 && s_state == LOCAL_READY) {
      lantern_network_send_heartbeat("ready", 0, s_battery_level);
    }

    if (s_summary_retry_pending && !s_summary_retrying && s_state == LOCAL_READY &&
        (xTaskGetTickCount() - s_last_summary_retry_at) * portTICK_PERIOD_MS >= 30000) {
      lantern_network_status_t network;
      lantern_network_get_status(&network);
      if (network.wifi_connected && network.paired) retry_pending_summary(false);
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

void app_main(void) {
  const lantern_board_profile_t *board = lantern_board_profile();
  ESP_LOGI(TAG, "Lantern %s booting on %s (%s, storage=%s)",
    LANTERN_FIRMWARE_VERSION, board->id, board->model, board->storage_kind);
  s_state_entered_at = xTaskGetTickCount();
  power_and_battery_init();
  update_battery_level();
  ESP_ERROR_CHECK(lantern_storage_init());
  ESP_ERROR_CHECK(lantern_storage_load(&s_config));
  lantern_sd_status_t sd_status;
  esp_err_t sd_result = lantern_sd_init(&sd_status);
  if (sd_result != ESP_OK && sd_result != ESP_ERR_NOT_SUPPORTED) {
    ESP_LOGW(TAG, "continuing without microSD archive: %s", esp_err_to_name(sd_result));
  }
  ESP_ERROR_CHECK(lantern_display_init());
  ESP_ERROR_CHECK(lantern_audio_init());
  lantern_audio_set_archive_callback(lantern_sd_recording_write);
  if (lantern_wake_init() == ESP_OK) {
    s_wake_available = true;
    lantern_audio_set_monitor_callback(lantern_wake_feed);
  } else {
    ESP_LOGW(TAG, "WakeNet unavailable; centre-button fallback is active");
  }
  ESP_ERROR_CHECK(lantern_transcript_init());
  // HTTPS and Agora calls have deep library call chains even though their bulk
  // buffers live in PSRAM. Keep enough internal task stack for both paths.
  xTaskCreate(button_task, "lantern_buttons", 8192, NULL, 5, NULL);
  xTaskCreate(telemetry_task, "lantern_health", 8192, NULL, 3, NULL);
  ESP_ERROR_CHECK(lantern_network_start(&s_config, network_changed));
  show_ready();
  ESP_LOGI(TAG,
    "bring-up complete; wake phrase=%s, short press=start/stop, long press=status/cancel",
    s_wake_available ? LANTERN_WAKE_PHRASE : "disabled");
}
