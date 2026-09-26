#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"

#define LANTERN_MAX_WIFI_PROFILES 5

typedef struct {
  char ssid[33];
  char password[65];
} lantern_wifi_profile_t;

typedef struct {
  char wifi_ssid[33];
  char wifi_password[65];
  char pairing_code[21];
  char device_id[37];
  char device_secret[81];
  lantern_wifi_profile_t wifi_profiles[LANTERN_MAX_WIFI_PROFILES];
  size_t wifi_profile_count;
} lantern_config_t;

esp_err_t lantern_storage_init(void);
esp_err_t lantern_storage_load(lantern_config_t *config);
esp_err_t lantern_storage_save_wifi(const char *ssid, const char *password, const char *pairing_code);
esp_err_t lantern_storage_save_pending_secret(const char *device_secret);
esp_err_t lantern_storage_save_device(const char *device_id, const char *device_secret);
esp_err_t lantern_storage_clear_pairing_code(lantern_config_t *config);
esp_err_t lantern_storage_clear_device(lantern_config_t *config);
esp_err_t lantern_storage_clear(void);
bool lantern_storage_has_wifi(const lantern_config_t *config);
bool lantern_storage_is_paired(const lantern_config_t *config);
