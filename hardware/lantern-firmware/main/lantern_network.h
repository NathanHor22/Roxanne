#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "lantern_storage.h"

typedef struct {
  bool wifi_connected;
  bool setup_portal_active;
  bool paired;
  char setup_ssid[33];
  char ip_address[16];
  char last_error[96];
} lantern_network_status_t;

typedef void (*lantern_network_callback_t)(const lantern_network_status_t *status);

typedef struct {
  char app_id[33];
  char channel[80];
  char token[512];
  uint32_t publisher_uid;
  uint32_t stt_bot_uid;
  char expires_at[40];
} lantern_agora_transport_t;

typedef struct {
  char session_id[37];
  char prompt_id[121];
  char completion_event_id[37];
  unsigned version;
  char local_date[11];
  char local_time[9];
} lantern_cloud_session_t;

esp_err_t lantern_network_start(lantern_config_t *config, lantern_network_callback_t callback);
void lantern_network_get_status(lantern_network_status_t *status);
esp_err_t lantern_network_send_heartbeat(const char *state, unsigned state_version, int battery_level);
esp_err_t lantern_network_begin_quick(lantern_cloud_session_t *session);
esp_err_t lantern_network_confirm_consent(
  lantern_cloud_session_t *session,
  bool accepted,
  lantern_agora_transport_t *transport);
esp_err_t lantern_network_capture_started(lantern_cloud_session_t *session);
esp_err_t lantern_network_stop_recording(lantern_cloud_session_t *session);
esp_err_t lantern_network_abort_session(lantern_cloud_session_t *session);
esp_err_t lantern_network_upload_transcript(const lantern_cloud_session_t *session);
esp_err_t lantern_network_upload_audio(const lantern_cloud_session_t *session);
esp_err_t lantern_network_complete_session(lantern_cloud_session_t *session);
