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

#include "lantern_audio.h"
#include "lantern_agora.h"
#include "lantern_board.h"
#include "lantern_display.h"
#include "lantern_network.h"
#include "lantern_storage.h"
#include "lantern_transcript.h"

typedef enum {
  LOCAL_READY,
  LOCAL_AWAITING_CONSENT,
  LOCAL_RECORDING,
  LOCAL_FINALISING,
  LOCAL_SAVED,
  LOCAL_STATUS,
  LOCAL_COMMAND,
  LOCAL_ERROR,
} local_state_t;

static const char *TAG = "lantern";
static lantern_config_t s_config;
static local_state_t s_state = LOCAL_READY;
static adc_oneshot_unit_handle_t s_adc;
static int s_battery_level = 50;
static TickType_t s_state_entered_at;
static lantern_cloud_session_t s_cloud_session;
static unsigned s_last_recording_second = UINT32_MAX;
static volatile bool s_network_update_pending;
static bool s_pair_announcement_shown;

static void show_recording_progress(void) {
  unsigned elapsed =
    (unsigned)((xTaskGetTickCount() - s_state_entered_at) * portTICK_PERIOD_MS / 1000);
  if (elapsed == s_last_recording_second) return;
  s_last_recording_second = elapsed;
  char detail[32];
  snprintf(
    detail,
    sizeof(detail),
    "%.10s %.5s %02u:%02u",
    s_cloud_session.local_date,
    s_cloud_session.local_time,
    elapsed / 60,
    elapsed % 60);
  lantern_display_show(LANTERN_SCREEN_RECORDING, detail);
}

static void show_error(const char *detail) {
  lantern_audio_set_recording(false);
  lantern_agora_stop();
  s_state = LOCAL_ERROR;
  s_state_entered_at = xTaskGetTickCount();
  lantern_display_show(LANTERN_SCREEN_ERROR, detail ? detail : "TRY AGAIN");
  lantern_audio_chime(3);
}

static void abort_cloud_session(void) {
  if (s_cloud_session.session_id[0]) {
    lantern_network_abort_session(&s_cloud_session);
    memset(&s_cloud_session, 0, sizeof(s_cloud_session));
  }
}

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

static void power_and_battery_init(void) {
  gpio_config_t output = {
    .pin_bit_mask = 1ULL << LANTERN_POWER_HOLD_GPIO,
    .mode = GPIO_MODE_OUTPUT,
  };
  ESP_ERROR_CHECK(gpio_config(&output));
  gpio_set_level(LANTERN_POWER_HOLD_GPIO, 1);
  gpio_config_t charging = {
    .pin_bit_mask = 1ULL << LANTERN_CHARGING_GPIO,
    .mode = GPIO_MODE_INPUT,
  };
  ESP_ERROR_CHECK(gpio_config(&charging));

  adc_oneshot_unit_init_cfg_t init = { .unit_id = ADC_UNIT_1, .ulp_mode = ADC_ULP_MODE_DISABLE };
  ESP_ERROR_CHECK(adc_oneshot_new_unit(&init, &s_adc));
  adc_oneshot_chan_cfg_t channel = { .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_12 };
  ESP_ERROR_CHECK(adc_oneshot_config_channel(s_adc, ADC_CHANNEL_7, &channel));
}

static void show_ready(void) {
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (network.setup_portal_active && !network.wifi_connected) {
    lantern_display_show(LANTERN_SCREEN_SETUP, network.setup_ssid);
  } else if (network.wifi_connected && network.paired) {
    lantern_display_show(LANTERN_SCREEN_READY, "PRESS FOR QUICK");
  } else if (network.wifi_connected) {
    lantern_display_show(LANTERN_SCREEN_READY, "HARDWARE READY");
  } else {
    lantern_display_show(LANTERN_SCREEN_CONNECTING, "WAIT OR SETUP");
  }
}

static void network_changed(const lantern_network_status_t *status) {
  ESP_LOGI(TAG, "network wifi=%d portal=%d paired=%d ip=%s", status->wifi_connected,
    status->setup_portal_active, status->paired, status->ip_address);
  // ESP-IDF invokes this callback on the small sys_evt task. Defer display,
  // audio, and delays to Lantern's telemetry task so Wi-Fi events never block
  // or overflow the system event loop.
  s_network_update_pending = true;
}

static esp_err_t open_quick_consent(void) {
  lantern_display_show(LANTERN_SCREEN_CONNECTING, "OPENING SESSION");
  if (lantern_network_begin_quick(&s_cloud_session) != ESP_OK) {
    show_error("HOLD TO RESTART");
    return ESP_FAIL;
  }
  s_state = LOCAL_AWAITING_CONSENT;
  s_state_entered_at = xTaskGetTickCount();
  lantern_display_show(LANTERN_SCREEN_CONSENT, "CONSENT REQUIRED");
  ESP_LOGI(TAG, "quick mode awaiting server-bound consent");
  return ESP_OK;
}

static esp_err_t accept_recording_consent(void) {
  lantern_agora_transport_t transport;
  lantern_display_show(LANTERN_SCREEN_CONNECTING, "STARTING AGORA");
  if (lantern_network_confirm_consent(&s_cloud_session, true, &transport) != ESP_OK) {
    abort_cloud_session();
    show_error("AGORA SETUP FAILED");
    return ESP_FAIL;
  }
  if (lantern_agora_start(&transport) != ESP_OK) {
    lantern_network_stop_recording(&s_cloud_session);
    abort_cloud_session();
    show_error("AGORA JOIN FAILED");
    return ESP_FAIL;
  }
  // Keep the start chime and spoken consent response out of both the recording
  // and the Agora transcript.
  lantern_audio_chime(2);
  if (lantern_network_capture_started(&s_cloud_session) != ESP_OK) {
    lantern_agora_stop();
    abort_cloud_session();
    show_error("CLOCK SYNC FAILED");
    return ESP_FAIL;
  }
  s_state = LOCAL_RECORDING;
  s_state_entered_at = xTaskGetTickCount();
  s_last_recording_second = UINT32_MAX;
  show_recording_progress();
  lantern_audio_set_recording(true);
  lantern_audio_set_streaming(true);
  ESP_LOGI(TAG, "Agora recording started at %s %s Malaysia time",
    s_cloud_session.local_date, s_cloud_session.local_time);
  return ESP_OK;
}

static esp_err_t capture_voice_command(const char *context, unsigned seconds,
                                       const char *screen_detail, char intent[32]) {
  lantern_display_show(LANTERN_SCREEN_STATUS, screen_detail);
  lantern_audio_chime(1);
  vTaskDelay(pdMS_TO_TICKS(250));
  lantern_audio_set_recording(true);
  vTaskDelay(pdMS_TO_TICKS(seconds * 1000));
  lantern_audio_set_recording(false);
  if (lantern_audio_buffered_samples() < LANTERN_MIC_SAMPLE_RATE / 2) return ESP_FAIL;
  lantern_display_show(LANTERN_SCREEN_CONNECTING, "UNDERSTANDING");
  return lantern_network_run_voice_command(context, s_battery_level, intent, 32);
}

static void handle_ready_voice_command(void) {
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (!network.wifi_connected || !network.paired) {
    show_error(network.wifi_connected ? "PAIR IN DASHBOARD" : "CONNECT WIFI FIRST");
    return;
  }
  s_state = LOCAL_COMMAND;
  s_state_entered_at = xTaskGetTickCount();
  char intent[32];
  if (capture_voice_command("ready", 8, "SAY A COMMAND", intent) != ESP_OK) {
    show_error("VOICE COMMAND OFFLINE");
    return;
  }
  if (strcmp(intent, "status_report") == 0) {
    s_state = LOCAL_STATUS;
    lantern_display_show(LANTERN_SCREEN_STATUS, "REPORT COMPLETE");
    return;
  }
  if (strcmp(intent, "start_recording") == 0) {
    if (open_quick_consent() != ESP_OK) return;
    char consent[32];
    if (capture_voice_command("consent", 3, "SAY YES OR NO", consent) != ESP_OK) {
      lantern_network_confirm_consent(&s_cloud_session, false, NULL);
      memset(&s_cloud_session, 0, sizeof(s_cloud_session));
      show_error("CONSENT VOICE OFFLINE");
      return;
    }
    if (strcmp(consent, "consent_yes") == 0) {
      accept_recording_consent();
      return;
    }
    lantern_network_confirm_consent(&s_cloud_session, false, NULL);
    memset(&s_cloud_session, 0, sizeof(s_cloud_session));
    s_state = LOCAL_READY;
    s_state_entered_at = xTaskGetTickCount();
    show_ready();
    return;
  }
  s_state = LOCAL_READY;
  s_state_entered_at = xTaskGetTickCount();
  show_ready();
}

static void handle_short_press(void) {
  switch (s_state) {
    case LOCAL_READY: {
      lantern_network_status_t network;
      lantern_network_get_status(&network);
      if (!network.wifi_connected || !network.paired) {
        show_error(network.wifi_connected ? "PAIR IN DASHBOARD" : "CONNECT WIFI FIRST");
        break;
      }
      if (open_quick_consent() == ESP_OK) {
        lantern_display_show(LANTERN_SCREEN_CONSENT, "PRESS TO AGREE");
        lantern_audio_chime(1);
      }
      break;
    }
    case LOCAL_AWAITING_CONSENT: {
      accept_recording_consent();
      break;
    }
    case LOCAL_RECORDING: {
      lantern_audio_set_recording(false);
      s_state = LOCAL_FINALISING;
      s_state_entered_at = xTaskGetTickCount();
      lantern_display_show(LANTERN_SCREEN_CONNECTING, "FINALISING SPEECH");
      // Stop extending the local WAV at the user's button press, but keep
      // publishing microphone frames briefly. The silence after the utterance
      // lets Agora finalize and return its last sentence before its bot exits.
      vTaskDelay(pdMS_TO_TICKS(3000));
      lantern_audio_set_streaming(false);
      if (lantern_network_stop_recording(&s_cloud_session) != ESP_OK) {
        abort_cloud_session();
        show_error("STOP FAILED");
        break;
      }
      vTaskDelay(pdMS_TO_TICKS(400));
      lantern_agora_stop();
      unsigned caption_packets = lantern_transcript_packet_count();
      ESP_LOGI(TAG, "staged %u Agora caption packets", caption_packets);
      if (caption_packets) {
        lantern_display_show(LANTERN_SCREEN_CONNECTING, "UPLOADING WORDS");
        if (lantern_network_upload_transcript(&s_cloud_session) != ESP_OK) {
          ESP_LOGW(TAG, "Agora captions unavailable; preserving WAV for server transcription");
        }
      } else {
        ESP_LOGW(TAG, "no Agora captions; preserving WAV for server transcription");
      }
      lantern_display_show(LANTERN_SCREEN_CONNECTING, "UPLOADING AUDIO");
      if (lantern_network_upload_audio(&s_cloud_session) != ESP_OK) {
        abort_cloud_session();
        show_error("AUDIO UPLOAD FAILED");
        break;
      }
      lantern_display_show(LANTERN_SCREEN_CONNECTING, "BUILDING BRIEF");
      if (lantern_network_complete_session(&s_cloud_session) != ESP_OK) {
        show_error("BRIEF PROCESS FAILED");
        break;
      }
      s_state = LOCAL_SAVED;
      s_state_entered_at = xTaskGetTickCount();
      lantern_display_show(LANTERN_SCREEN_SAVED, "DASHBOARD READY");
      lantern_audio_chime(2);
      ESP_LOGI(TAG, "conversation saved to dashboard; %u audio seconds",
        lantern_audio_buffered_seconds());
      memset(&s_cloud_session, 0, sizeof(s_cloud_session));
      break;
    }
    case LOCAL_FINALISING:
      break;
    case LOCAL_SAVED:
    case LOCAL_STATUS:
    case LOCAL_COMMAND:
      s_state = LOCAL_READY;
      s_state_entered_at = xTaskGetTickCount();
      show_ready();
      break;
    case LOCAL_ERROR:
      if (s_cloud_session.session_id[0] && s_cloud_session.completion_event_id[0]) {
        lantern_display_show(LANTERN_SCREEN_CONNECTING, "RETRYING BRIEF");
        if (lantern_network_complete_session(&s_cloud_session) == ESP_OK) {
          s_state = LOCAL_SAVED;
          lantern_display_show(LANTERN_SCREEN_SAVED, "DASHBOARD READY");
          lantern_audio_chime(2);
          memset(&s_cloud_session, 0, sizeof(s_cloud_session));
        } else {
          show_error("BRIEF STILL OFFLINE");
        }
      } else {
        s_state = LOCAL_READY;
        s_state_entered_at = xTaskGetTickCount();
        show_ready();
      }
      break;
  }
}

static void handle_long_press(void) {
  if (s_state == LOCAL_RECORDING) {
    handle_short_press();
    return;
  }
  if (s_state == LOCAL_ERROR) {
    lantern_display_show(LANTERN_SCREEN_CONNECTING, "RESTARTING SESSION");
    if (lantern_network_restart_session() != ESP_OK) {
      show_error("RESTART FAILED");
      return;
    }
    memset(&s_cloud_session, 0, sizeof(s_cloud_session));
    s_state = LOCAL_READY;
    s_state_entered_at = xTaskGetTickCount();
    lantern_display_show(LANTERN_SCREEN_PAIRED, "SESSION RESET");
    lantern_audio_chime(1);
    vTaskDelay(pdMS_TO_TICKS(500));
    show_ready();
    ESP_LOGI(TAG, "explicit server session restart completed");
    return;
  }
  if (s_state == LOCAL_AWAITING_CONSENT || s_state == LOCAL_FINALISING ||
      s_state == LOCAL_COMMAND) return;
  if (s_state == LOCAL_SAVED || s_state == LOCAL_STATUS) {
    s_state = LOCAL_READY;
    s_state_entered_at = xTaskGetTickCount();
  }
  handle_ready_voice_command();
}

static void button_task(void *argument) {
  (void)argument;
  gpio_config_t buttons = {
    .pin_bit_mask = (1ULL << LANTERN_BUTTON_MAIN_GPIO) |
                    (1ULL << LANTERN_BUTTON_UP_GPIO) |
                    (1ULL << LANTERN_BUTTON_DOWN_GPIO),
    .mode = GPIO_MODE_INPUT,
    .pull_up_en = GPIO_PULLUP_ENABLE,
  };
  ESP_ERROR_CHECK(gpio_config(&buttons));
  bool was_pressed = false;
  bool up_was_pressed = false;
  bool reset_started = false;
  TickType_t pressed_at = 0;
  TickType_t reset_at = 0;
  while (true) {
    bool pressed = gpio_get_level(LANTERN_BUTTON_MAIN_GPIO) == 0;
    bool up_pressed = gpio_get_level(LANTERN_BUTTON_UP_GPIO) == 0;
    bool down_pressed = gpio_get_level(LANTERN_BUTTON_DOWN_GPIO) == 0;
    if (pressed && !was_pressed) pressed_at = xTaskGetTickCount();
    if (!pressed && was_pressed) {
      uint32_t held_ms = (uint32_t)((xTaskGetTickCount() - pressed_at) * portTICK_PERIOD_MS);
      if (held_ms >= 1200) handle_long_press();
      else if (held_ms >= 40) handle_short_press();
    }
    if (!up_pressed && up_was_pressed && s_state == LOCAL_SAVED) {
      lantern_audio_play_latest(5);
    }
    up_was_pressed = up_pressed;
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
    if (s_state == LOCAL_AWAITING_CONSENT &&
        (xTaskGetTickCount() - s_state_entered_at) * portTICK_PERIOD_MS >= 30000) {
      lantern_network_confirm_consent(&s_cloud_session, false, NULL);
      memset(&s_cloud_session, 0, sizeof(s_cloud_session));
      s_state = LOCAL_READY;
      s_state_entered_at = xTaskGetTickCount();
      show_ready();
      ESP_LOGI(TAG, "local consent prompt expired");
    }
    if (s_state == LOCAL_RECORDING &&
        lantern_agora_take_stop_command()) {
      ESP_LOGI(TAG, "finalising after spoken Ring stop command");
      handle_short_press();
    }
    if (s_state == LOCAL_RECORDING &&
        (xTaskGetTickCount() - s_state_entered_at) * portTICK_PERIOD_MS >= 29000) {
      ESP_LOGI(TAG, "30-second vertical-slice limit reached; finalising automatically");
      handle_short_press();
    }
    if (s_state == LOCAL_RECORDING) show_recording_progress();
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
          lantern_display_show(LANTERN_SCREEN_PAIRED, "SECTOR 2814 ONLINE");
          if (lantern_network_play_briefing("boot", s_battery_level) != ESP_OK) {
            lantern_audio_chime(2);
            vTaskDelay(pdMS_TO_TICKS(700));
          }
        }
        show_ready();
      }
    }
    int raw = 0;
    if (adc_oneshot_read(s_adc, ADC_CHANNEL_7, &raw) == ESP_OK) s_battery_level = battery_from_adc(raw);
    if (++seconds % 5 == 0) {
      ESP_LOGI(TAG, "health battery=%d%% charging=%d mic_level=%u heap=%u psram=%u state=%d",
        s_battery_level, gpio_get_level(LANTERN_CHARGING_GPIO),
        (unsigned)lantern_audio_level(), (unsigned)esp_get_free_heap_size(),
        (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM), s_state);
    }
    if (seconds % 15 == 0 && s_state == LOCAL_READY) {
      lantern_network_send_heartbeat("ready", 0, s_battery_level);
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

void app_main(void) {
  ESP_LOGI(TAG, "Lantern %s booting", LANTERN_FIRMWARE_VERSION);
  s_state_entered_at = xTaskGetTickCount();
  power_and_battery_init();
  ESP_ERROR_CHECK(lantern_storage_init());
  ESP_ERROR_CHECK(lantern_storage_load(&s_config));
  ESP_ERROR_CHECK(lantern_display_init());
  ESP_ERROR_CHECK(lantern_audio_init());
  ESP_ERROR_CHECK(lantern_transcript_init());
  // HTTPS and Agora calls have deep library call chains even though their bulk
  // buffers live in PSRAM. Keep enough internal task stack for both paths.
  xTaskCreate(button_task, "lantern_buttons", 8192, NULL, 5, NULL);
  xTaskCreate(telemetry_task, "lantern_health", 8192, NULL, 3, NULL);
  ESP_ERROR_CHECK(lantern_network_start(&s_config, network_changed));
  show_ready();
  ESP_LOGI(TAG, "bring-up complete; short press=quick, long press=voice command");
}
