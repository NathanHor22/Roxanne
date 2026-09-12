#include "lantern_storage.h"

#include <string.h>

#include "esp_check.h"
#include "nvs.h"
#include "nvs_flash.h"

#define STORAGE_NAMESPACE "roxanne"

static esp_err_t read_string(nvs_handle_t handle, const char *key, char *destination, size_t size) {
  size_t required = size;
  esp_err_t result = nvs_get_str(handle, key, destination, &required);
  if (result == ESP_ERR_NVS_NOT_FOUND) {
    destination[0] = '\0';
    return ESP_OK;
  }
  return result;
}

esp_err_t lantern_storage_init(void) {
  esp_err_t result = nvs_flash_init();
  if (result == ESP_ERR_NVS_NO_FREE_PAGES || result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    result = nvs_flash_init();
  }
  return result;
}

esp_err_t lantern_storage_load(lantern_config_t *config) {
  if (!config) return ESP_ERR_INVALID_ARG;
  memset(config, 0, sizeof(*config));
  nvs_handle_t handle;
  esp_err_t result = nvs_open(STORAGE_NAMESPACE, NVS_READONLY, &handle);
  if (result == ESP_ERR_NVS_NOT_FOUND) return ESP_OK;
  if (result != ESP_OK) return result;
  if ((result = read_string(handle, "wifi_ssid", config->wifi_ssid, sizeof(config->wifi_ssid))) == ESP_OK &&
      (result = read_string(handle, "wifi_pass", config->wifi_password, sizeof(config->wifi_password))) == ESP_OK &&
      (result = read_string(handle, "pair_code", config->pairing_code, sizeof(config->pairing_code))) == ESP_OK &&
      (result = read_string(handle, "device_id", config->device_id, sizeof(config->device_id))) == ESP_OK) {
    result = read_string(handle, "dev_secret", config->device_secret, sizeof(config->device_secret));
  }
  nvs_close(handle);
  return result;
}

esp_err_t lantern_storage_save_wifi(const char *ssid, const char *password, const char *pairing_code) {
  if (!ssid || !ssid[0] || strlen(ssid) > 32 || !password || strlen(password) > 64) return ESP_ERR_INVALID_ARG;
  nvs_handle_t handle;
  ESP_RETURN_ON_ERROR(nvs_open(STORAGE_NAMESPACE, NVS_READWRITE, &handle), "storage", "open");
  esp_err_t result = nvs_set_str(handle, "wifi_ssid", ssid);
  if (result == ESP_OK) result = nvs_set_str(handle, "wifi_pass", password);
  if (result == ESP_OK) result = nvs_set_str(handle, "pair_code", pairing_code ? pairing_code : "");
  if (result == ESP_OK) result = nvs_commit(handle);
  nvs_close(handle);
  return result;
}

esp_err_t lantern_storage_save_device(const char *device_id, const char *device_secret) {
  if (!device_id || !device_secret) return ESP_ERR_INVALID_ARG;
  nvs_handle_t handle;
  ESP_RETURN_ON_ERROR(nvs_open(STORAGE_NAMESPACE, NVS_READWRITE, &handle), "storage", "open");
  esp_err_t result = nvs_set_str(handle, "device_id", device_id);
  if (result == ESP_OK) result = nvs_set_str(handle, "dev_secret", device_secret);
  if (result == ESP_OK) result = nvs_erase_key(handle, "pair_code");
  if (result == ESP_ERR_NVS_NOT_FOUND) result = ESP_OK;
  if (result == ESP_OK) result = nvs_commit(handle);
  nvs_close(handle);
  return result;
}

esp_err_t lantern_storage_clear(void) {
  nvs_handle_t handle;
  ESP_RETURN_ON_ERROR(nvs_open(STORAGE_NAMESPACE, NVS_READWRITE, &handle), "storage", "open");
  esp_err_t result = nvs_erase_all(handle);
  if (result == ESP_OK) result = nvs_commit(handle);
  nvs_close(handle);
  return result;
}

bool lantern_storage_has_wifi(const lantern_config_t *config) {
  return config && config->wifi_ssid[0];
}

bool lantern_storage_is_paired(const lantern_config_t *config) {
  return config && config->device_id[0] && config->device_secret[0];
}
