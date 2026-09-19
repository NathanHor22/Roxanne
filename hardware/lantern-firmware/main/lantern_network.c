#include "lantern_network.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "cJSON.h"
#include "esp_check.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_http_server.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_ota_ops.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"

#include "lantern_board.h"
#include "lantern_audio.h"
#include "lantern_transcript.h"

#define WIFI_CONNECTED_BIT BIT0
#define RESPONSE_CAPACITY 6144

static const char *TAG = "lantern_network";
static EventGroupHandle_t s_wifi_events;
static lantern_config_t *s_config;
static lantern_network_callback_t s_callback;
static lantern_network_status_t s_status;
static httpd_handle_t s_server;

typedef struct {
  char data[RESPONSE_CAPACITY];
  size_t length;
} response_buffer_t;

typedef struct {
  response_buffer_t response;
  bool content_is_pcm;
  bool playback_started;
  bool playback_failed;
  size_t audio_bytes;
  char command[32];
} audio_response_t;

static response_buffer_t *response_buffer_create(void) {
  response_buffer_t *response = heap_caps_calloc(
    1, sizeof(response_buffer_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!response) ESP_LOGE(TAG, "could not allocate HTTP response buffer in PSRAM");
  return response;
}

static void notify(void) {
  if (s_callback) s_callback(&s_status);
}

static void set_error(const char *message) {
  snprintf(s_status.last_error, sizeof(s_status.last_error), "%s", message ? message : "unknown error");
  ESP_LOGW(TAG, "%s", s_status.last_error);
  notify();
}

static void uuid_v4(char output[37]) {
  uint8_t bytes[16];
  for (size_t index = 0; index < sizeof(bytes); index += 4) {
    uint32_t random = esp_random();
    memcpy(bytes + index, &random, 4);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  snprintf(output, 37,
    "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]);
}

static esp_err_t http_event(esp_http_client_event_t *event) {
  if (event->event_id != HTTP_EVENT_ON_DATA || !event->user_data || event->data_len <= 0) return ESP_OK;
  response_buffer_t *response = event->user_data;
  size_t remaining = sizeof(response->data) - response->length - 1;
  size_t copy = (size_t)event->data_len < remaining ? (size_t)event->data_len : remaining;
  if (copy) {
    memcpy(response->data + response->length, event->data, copy);
    response->length += copy;
    response->data[response->length] = '\0';
  }
  return ESP_OK;
}

static esp_err_t audio_http_event(esp_http_client_event_t *event) {
  audio_response_t *audio = event->user_data;
  if (!audio) return ESP_OK;
  if (event->event_id == HTTP_EVENT_ON_HEADER && event->header_key && event->header_value &&
      strcasecmp(event->header_key, "content-type") == 0) {
    audio->content_is_pcm = strncasecmp(event->header_value, "audio/pcm", 9) == 0;
    return ESP_OK;
  }
  if (event->event_id == HTTP_EVENT_ON_HEADER && event->header_key && event->header_value &&
      strcasecmp(event->header_key, "x-lantern-command") == 0) {
    snprintf(audio->command, sizeof(audio->command), "%s", event->header_value);
    return ESP_OK;
  }
  if (event->event_id != HTTP_EVENT_ON_DATA || !event->data || event->data_len <= 0) return ESP_OK;
  if (audio->content_is_pcm) {
    if (!audio->playback_started) {
      if (lantern_audio_pcm_begin() != ESP_OK) {
        audio->playback_failed = true;
        return ESP_FAIL;
      }
      audio->playback_started = true;
    }
    if (lantern_audio_pcm_write(event->data, (size_t)event->data_len) != ESP_OK) {
      audio->playback_failed = true;
      return ESP_FAIL;
    }
    audio->audio_bytes += (size_t)event->data_len;
    return ESP_OK;
  }
  size_t remaining = sizeof(audio->response.data) - audio->response.length - 1;
  size_t copy = (size_t)event->data_len < remaining ? (size_t)event->data_len : remaining;
  if (copy) {
    memcpy(audio->response.data + audio->response.length, event->data, copy);
    audio->response.length += copy;
    audio->response.data[audio->response.length] = '\0';
  }
  return ESP_OK;
}

static int post_json(const char *path, const char *body, const char *authorization, response_buffer_t *response) {
  char url[256];
  snprintf(url, sizeof(url), "%s%s", LANTERN_API_BASE_URL, path);
  memset(response, 0, sizeof(*response));
  esp_http_client_config_t config = {
    .url = url,
    .event_handler = http_event,
    .user_data = response,
    .timeout_ms = 20000,
    .crt_bundle_attach = esp_crt_bundle_attach,
  };
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) return -1;
  esp_http_client_set_method(client, HTTP_METHOD_POST);
  esp_http_client_set_header(client, "Content-Type", "application/json");
  if (authorization && authorization[0]) esp_http_client_set_header(client, "Authorization", authorization);
  esp_http_client_set_post_field(client, body, (int)strlen(body));
  esp_err_t result = esp_http_client_perform(client);
  int status = result == ESP_OK ? esp_http_client_get_status_code(client) : -1;
  if (result != ESP_OK) ESP_LOGW(TAG, "POST %s failed: %s", path, esp_err_to_name(result));
  esp_http_client_cleanup(client);
  return status;
}

static int post_binary(const char *path, const char *content_type, const void *body,
                       size_t body_length, const char *authorization,
                       const char *event_id, response_buffer_t *response) {
  char url[256];
  snprintf(url, sizeof(url), "%s%s", LANTERN_API_BASE_URL, path);
  memset(response, 0, sizeof(*response));
  esp_http_client_config_t config = {
    .url = url,
    .event_handler = http_event,
    .user_data = response,
    .timeout_ms = 60000,
    .crt_bundle_attach = esp_crt_bundle_attach,
    .buffer_size_tx = 4096,
  };
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) return -1;
  esp_http_client_set_method(client, HTTP_METHOD_POST);
  esp_http_client_set_header(client, "Content-Type", content_type);
  if (authorization && authorization[0]) esp_http_client_set_header(client, "Authorization", authorization);
  if (event_id && event_id[0]) esp_http_client_set_header(client, "X-Lantern-Event-Id", event_id);
  esp_http_client_set_post_field(client, (const char *)body, (int)body_length);
  esp_err_t result = esp_http_client_perform(client);
  int status = result == ESP_OK ? esp_http_client_get_status_code(client) : -1;
  if (result != ESP_OK) ESP_LOGW(TAG, "POST %s failed: %s", path, esp_err_to_name(result));
  esp_http_client_cleanup(client);
  return status;
}

static void device_authorization(char output[140]) {
  snprintf(output, 140, "Device %s.%s", s_config->device_id, s_config->device_secret);
}

static void copy_json_string(cJSON *object, const char *name, char *destination, size_t capacity) {
  cJSON *value = cJSON_GetObjectItemCaseSensitive(object, name);
  if (cJSON_IsString(value) && value->valuestring) {
    snprintf(destination, capacity, "%s", value->valuestring);
  }
}

static bool parse_session_response(const char *body, lantern_cloud_session_t *session,
                                   lantern_agora_transport_t *transport) {
  cJSON *root = cJSON_Parse(body);
  cJSON *machine = root ? cJSON_GetObjectItemCaseSensitive(root, "session") : NULL;
  if (!cJSON_IsObject(machine)) {
    cJSON_Delete(root);
    return false;
  }
  copy_json_string(machine, "sessionId", session->session_id, sizeof(session->session_id));
  cJSON *version = cJSON_GetObjectItemCaseSensitive(machine, "version");
  if (cJSON_IsNumber(version)) session->version = (unsigned)version->valuedouble;
  cJSON *prompt = cJSON_GetObjectItemCaseSensitive(machine, "prompt");
  if (cJSON_IsObject(prompt)) copy_json_string(prompt, "id", session->prompt_id, sizeof(session->prompt_id));
  else session->prompt_id[0] = '\0';
  cJSON *clock = cJSON_GetObjectItemCaseSensitive(root, "clock");
  if (cJSON_IsObject(clock)) {
    copy_json_string(clock, "localDate", session->local_date, sizeof(session->local_date));
    copy_json_string(clock, "localTime", session->local_time, sizeof(session->local_time));
  }
  if (transport) {
    memset(transport, 0, sizeof(*transport));
    cJSON *value = cJSON_GetObjectItemCaseSensitive(root, "transport");
    if (cJSON_IsObject(value)) {
      copy_json_string(value, "appId", transport->app_id, sizeof(transport->app_id));
      copy_json_string(value, "channel", transport->channel, sizeof(transport->channel));
      copy_json_string(value, "token", transport->token, sizeof(transport->token));
      copy_json_string(value, "expiresAt", transport->expires_at, sizeof(transport->expires_at));
      cJSON *publisher = cJSON_GetObjectItemCaseSensitive(value, "publisherUid");
      cJSON *bot = cJSON_GetObjectItemCaseSensitive(value, "sttBotUid");
      if (cJSON_IsNumber(publisher)) transport->publisher_uid = (uint32_t)publisher->valuedouble;
      if (cJSON_IsNumber(bot)) transport->stt_bot_uid = (uint32_t)bot->valuedouble;
    }
  }
  bool valid = session->session_id[0] && cJSON_IsNumber(version);
  cJSON_Delete(root);
  return valid;
}

static void provider_error(const char *operation, int status, const response_buffer_t *response) {
  char detail[96];
  cJSON *root = cJSON_Parse(response->data);
  cJSON *error = root ? cJSON_GetObjectItemCaseSensitive(root, "error") : NULL;
  if (cJSON_IsString(error) && error->valuestring) {
    snprintf(detail, sizeof(detail), "%.72s", error->valuestring);
  } else {
    snprintf(detail, sizeof(detail), "%s HTTP %d", operation, status);
  }
  cJSON_Delete(root);
  set_error(detail);
}

static bool normalize_pairing_code(char *code) {
  char normalized[21] = {0};
  size_t length = 0;
  for (const char *cursor = code; *cursor && length < sizeof(normalized) - 1; ++cursor) {
    if (*cursor == '-' || isspace((unsigned char)*cursor)) continue;
    normalized[length++] = (char)toupper((unsigned char)*cursor);
  }
  if (length != 10) return false;
  memcpy(code, normalized, length + 1);
  return true;
}

static esp_err_t claim_device(void) {
  if (!s_config || !s_config->pairing_code[0] || lantern_storage_is_paired(s_config)) return ESP_OK;
  if (!normalize_pairing_code(s_config->pairing_code)) {
    set_error("Pair code must have 10 characters");
    return ESP_ERR_INVALID_ARG;
  }
  uint8_t mac[6];
  ESP_ERROR_CHECK(esp_read_mac(mac, ESP_MAC_WIFI_STA));
  char body[384];
  snprintf(body, sizeof(body),
    "{\"pairingCode\":\"%s\",\"hardwareId\":\"esp32s3:%02x%02x%02x%02x%02x%02x\","
    "\"model\":\"%s\",\"firmwareVersion\":\"%s\"}",
    s_config->pairing_code, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5],
    LANTERN_MODEL, LANTERN_FIRMWARE_VERSION);
  response_buffer_t *response = response_buffer_create();
  if (!response) return ESP_ERR_NO_MEM;
  int status = post_json("/api/device/v1/claim", body, NULL, response);
  if (status != 201) {
    char message[96];
    snprintf(message, sizeof(message), "Pairing failed HTTP %d", status);
    set_error(message);
    ESP_LOGW(TAG, "claim response: %.256s", response->data);
    free(response);
    return ESP_FAIL;
  }
  cJSON *root = cJSON_Parse(response->data);
  cJSON *device = root ? cJSON_GetObjectItemCaseSensitive(root, "device") : NULL;
  cJSON *credential = root ? cJSON_GetObjectItemCaseSensitive(root, "credential") : NULL;
  cJSON *id = device ? cJSON_GetObjectItemCaseSensitive(device, "id") : NULL;
  cJSON *secret = credential ? cJSON_GetObjectItemCaseSensitive(credential, "secret") : NULL;
  if (!cJSON_IsString(id) || !cJSON_IsString(secret)) {
    cJSON_Delete(root);
    free(response);
    set_error("Pairing response was invalid");
    return ESP_FAIL;
  }
  snprintf(s_config->device_id, sizeof(s_config->device_id), "%s", id->valuestring);
  snprintf(s_config->device_secret, sizeof(s_config->device_secret), "%s", secret->valuestring);
  esp_err_t save = lantern_storage_save_device(s_config->device_id, s_config->device_secret);
  cJSON_Delete(root);
  free(response);
  if (save != ESP_OK) {
    set_error("Could not save device credential");
    return save;
  }
  s_status.paired = true;
  s_status.last_error[0] = '\0';
  ESP_LOGI(TAG, "device paired successfully");
  notify();
  return ESP_OK;
}

static void decode_form_value(const char *source, char *destination, size_t destination_size) {
  size_t written = 0;
  while (*source && *source != '&' && written + 1 < destination_size) {
    if (*source == '+') {
      destination[written++] = ' ';
      ++source;
    } else if (*source == '%' && source[1] && source[2]) {
      char hex[3] = { source[1], source[2], 0 };
      destination[written++] = (char)strtoul(hex, NULL, 16);
      source += 3;
    } else {
      destination[written++] = *source++;
    }
  }
  destination[written] = '\0';
}

static void form_field(const char *body, const char *name, char *destination, size_t destination_size) {
  destination[0] = '\0';
  char needle[32];
  snprintf(needle, sizeof(needle), "%s=", name);
  const char *value = strstr(body, needle);
  if (!value || (value != body && value[-1] != '&')) return;
  decode_form_value(value + strlen(needle), destination, destination_size);
}

static esp_err_t setup_page(httpd_req_t *request) {
  static const char page[] =
    "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
    "<title>Lantern setup</title><style>body{font:16px system-ui;background:#03110c;color:#e8fff2;"
    "max-width:420px;margin:40px auto;padding:24px}h1{color:#35ff8c}p{color:#a9c9b7;line-height:1.55}label{display:block;margin-top:18px;color:#d9f7e5}"
    "input{width:100%;box-sizing:border-box;padding:13px;margin-top:7px;border-radius:8px;border:1px solid #28704c;background:#071b12;color:#effff5}"
    "button{margin-top:24px;width:100%;padding:14px;border:0;border-radius:8px;background:#35ff8c;color:#03110c;font-weight:700}</style></head>"
    "<body><h1>Lantern</h1><p>Connect this device to a 2.4 GHz Wi-Fi network or phone hotspot. Use the one-time pairing code from your Lantern dashboard.</p>"
    "<form method=post action=/configure><label>Wi-Fi name<input name=ssid maxlength=32 required></label>"
    "<label>Wi-Fi password<input name=password type=password maxlength=64></label>"
    "<label>Pairing code (required on first setup)<input name=code maxlength=20 placeholder='XXXXX-XXXXX'></label><button>Connect Lantern</button></form>"
    "<p><a href=/audio.wav style='color:#35ff8c'>Download the latest microphone test</a></p>"
    "<hr style='border-color:#164d34'><h2>Local firmware update</h2><input id=firmware type=file accept=.bin>"
    "<button type=button onclick='updateFirmware()'>Install update</button><p id=result></p>"
    "<script>async function updateFirmware(){const f=document.getElementById(\"firmware\").files[0];"
    "if(!f){result.textContent=\"Choose lantern.bin first\";return;}result.textContent=\"Uploading...\";"
    "const r=await fetch(\"/firmware\",{method:\"POST\",headers:{\"Content-Type\":\"application/octet-stream\"},body:f});"
    "result.textContent=await r.text();}</script></body></html>";
  httpd_resp_set_type(request, "text/html");
  return httpd_resp_send(request, page, HTTPD_RESP_USE_STRLEN);
}

static void wav_u16(uint8_t *target, uint16_t value) {
  target[0] = (uint8_t)(value & 0xff);
  target[1] = (uint8_t)(value >> 8);
}

static void wav_u32(uint8_t *target, uint32_t value) {
  target[0] = (uint8_t)(value & 0xff);
  target[1] = (uint8_t)((value >> 8) & 0xff);
  target[2] = (uint8_t)((value >> 16) & 0xff);
  target[3] = (uint8_t)((value >> 24) & 0xff);
}

static esp_err_t audio_download(httpd_req_t *request) {
  size_t samples = lantern_audio_buffered_samples();
  if (lantern_audio_is_recording()) {
    httpd_resp_set_status(request, "409 Conflict");
    httpd_resp_send(request, "Stop recording before playback", HTTPD_RESP_USE_STRLEN);
    return ESP_FAIL;
  }
  if (!samples) {
    httpd_resp_send_err(request, HTTPD_404_NOT_FOUND, "No microphone test has been recorded");
    return ESP_FAIL;
  }
  uint32_t data_bytes = (uint32_t)(samples * sizeof(int16_t));
  uint8_t header[44] = {0};
  memcpy(header, "RIFF", 4);
  wav_u32(header + 4, 36 + data_bytes);
  memcpy(header + 8, "WAVEfmt ", 8);
  wav_u32(header + 16, 16);
  wav_u16(header + 20, 1);
  wav_u16(header + 22, 1);
  wav_u32(header + 24, LANTERN_MIC_SAMPLE_RATE);
  wav_u32(header + 28, LANTERN_MIC_SAMPLE_RATE * 2);
  wav_u16(header + 32, 2);
  wav_u16(header + 34, 16);
  memcpy(header + 36, "data", 4);
  wav_u32(header + 40, data_bytes);
  char length[16];
  snprintf(length, sizeof(length), "%u", (unsigned)(44 + data_bytes));
  httpd_resp_set_type(request, "audio/wav");
  httpd_resp_set_hdr(request, "Content-Disposition", "attachment; filename=lantern-mic-test.wav");
  httpd_resp_set_hdr(request, "Content-Length", length);
  ESP_RETURN_ON_ERROR(httpd_resp_send_chunk(request, (const char *)header, sizeof(header)), TAG, "WAV header");
  int16_t chunk[512];
  for (size_t offset = 0; offset < samples;) {
    size_t copied = lantern_audio_copy_samples(chunk, offset, 512);
    if (!copied) break;
    ESP_RETURN_ON_ERROR(
      httpd_resp_send_chunk(request, (const char *)chunk, copied * sizeof(chunk[0])),
      TAG,
      "WAV chunk");
    offset += copied;
  }
  return httpd_resp_send_chunk(request, NULL, 0);
}

static void delayed_restart(void *argument) {
  (void)argument;
  vTaskDelay(pdMS_TO_TICKS(1200));
  esp_restart();
}

static esp_err_t firmware_update(httpd_req_t *request) {
  if (request->content_len <= 0) {
    httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Firmware file is empty");
    return ESP_FAIL;
  }
  const esp_partition_t *partition = esp_ota_get_next_update_partition(NULL);
  if (!partition || request->content_len > partition->size) {
    httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Firmware does not fit the OTA slot");
    return ESP_FAIL;
  }
  esp_ota_handle_t update = 0;
  esp_err_t result = esp_ota_begin(partition, request->content_len, &update);
  if (result != ESP_OK) {
    httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR, "Could not begin firmware update");
    return result;
  }
  char buffer[2048];
  int remaining = request->content_len;
  while (remaining > 0) {
    int requested = remaining < (int)sizeof(buffer) ? remaining : (int)sizeof(buffer);
    int received = httpd_req_recv(request, buffer, requested);
    if (received == HTTPD_SOCK_ERR_TIMEOUT) continue;
    if (received <= 0) {
      esp_ota_abort(update);
      return ESP_FAIL;
    }
    result = esp_ota_write(update, buffer, received);
    if (result != ESP_OK) {
      esp_ota_abort(update);
      httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR, "Could not write firmware update");
      return result;
    }
    remaining -= received;
  }
  result = esp_ota_end(update);
  if (result == ESP_OK) result = esp_ota_set_boot_partition(partition);
  if (result != ESP_OK) {
    httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Firmware image failed validation");
    return result;
  }
  ESP_LOGI(TAG, "OTA image accepted in %s (%u bytes)", partition->label, (unsigned)request->content_len);
  httpd_resp_send(request, "Update installed. Lantern is restarting.", HTTPD_RESP_USE_STRLEN);
  xTaskCreate(delayed_restart, "ota_restart", 2048, NULL, 4, NULL);
  return ESP_OK;
}

static esp_err_t configure(httpd_req_t *request) {
  if (request->content_len <= 0 || request->content_len >= 256) {
    httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Invalid form");
    return ESP_FAIL;
  }
  char body[256] = {0};
  int received = httpd_req_recv(request, body, request->content_len);
  if (received <= 0) return ESP_FAIL;
  body[received] = '\0';
  char ssid[33], password[65], code[21];
  form_field(body, "ssid", ssid, sizeof(ssid));
  form_field(body, "password", password, sizeof(password));
  form_field(body, "code", code, sizeof(code));
  bool has_valid_code = code[0] && normalize_pairing_code(code);
  if (!ssid[0] || (!lantern_storage_is_paired(s_config) && !has_valid_code) ||
      (code[0] && !has_valid_code)) {
    httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Check the Wi-Fi name and 10-character pairing code");
    return ESP_FAIL;
  }
  esp_err_t result = lantern_storage_save_wifi(ssid, password, code);
  if (result != ESP_OK) {
    httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR, "Could not save settings");
    return result;
  }
  httpd_resp_set_type(request, "text/html");
  httpd_resp_send(request, "<h1>Connected</h1><p>Lantern is restarting now.</p>", HTTPD_RESP_USE_STRLEN);
  xTaskCreate(delayed_restart, "restart", 2048, NULL, 4, NULL);
  return ESP_OK;
}

static esp_err_t start_setup_portal(void) {
  if (s_server) return ESP_OK;
  uint8_t mac[6];
  ESP_ERROR_CHECK(esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP));
  snprintf(s_status.setup_ssid, sizeof(s_status.setup_ssid), "Lantern-%02X%02X", mac[4], mac[5]);
  wifi_config_t ap = {0};
  ap.ap.ssid_len = strnlen(s_status.setup_ssid, sizeof(ap.ap.ssid));
  memcpy(ap.ap.ssid, s_status.setup_ssid, ap.ap.ssid_len);
  size_t setup_password_length = strlen(LANTERN_SETUP_AP_PASSWORD);
  memcpy(ap.ap.password, LANTERN_SETUP_AP_PASSWORD, setup_password_length);
  ap.ap.channel = 1;
  ap.ap.max_connection = 2;
  ap.ap.authmode = WIFI_AUTH_WPA2_PSK;
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap));

  httpd_config_t server_config = HTTPD_DEFAULT_CONFIG();
  // The setup AP accepts at most two clients. Keeping HTTPD's default seven
  // sessions leaves no spare lwIP descriptors on this build once its three
  // internal sockets are allocated.
  server_config.max_open_sockets = 2;
  server_config.max_uri_handlers = 4;
  server_config.stack_size = 3072;
  server_config.lru_purge_enable = true;
  ESP_LOGI(TAG, "starting setup server; internal_free=%u largest_internal=%u",
    (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
    (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
  esp_err_t server_result = httpd_start(&s_server, &server_config);
  if (server_result != ESP_OK) {
    s_server = NULL;
    ESP_LOGE(TAG, "setup server failed: %s (0x%x)",
      esp_err_to_name(server_result), (unsigned)server_result);
    return server_result;
  }
  const httpd_uri_t root = { .uri = "/", .method = HTTP_GET, .handler = setup_page };
  const httpd_uri_t save = { .uri = "/configure", .method = HTTP_POST, .handler = configure };
  const httpd_uri_t audio = { .uri = "/audio.wav", .method = HTTP_GET, .handler = audio_download };
  const httpd_uri_t firmware = { .uri = "/firmware", .method = HTTP_POST, .handler = firmware_update };
  ESP_ERROR_CHECK(httpd_register_uri_handler(s_server, &root));
  ESP_ERROR_CHECK(httpd_register_uri_handler(s_server, &save));
  ESP_ERROR_CHECK(httpd_register_uri_handler(s_server, &audio));
  ESP_ERROR_CHECK(httpd_register_uri_handler(s_server, &firmware));
  s_status.setup_portal_active = true;
  ESP_LOGI(TAG, "setup portal: SSID=%s URL=http://192.168.4.1", s_status.setup_ssid);
  notify();
  return ESP_OK;
}

static void wifi_event(void *argument, esp_event_base_t base, int32_t id, void *data) {
  (void)argument;
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START && lantern_storage_has_wifi(s_config)) {
    esp_wifi_connect();
  } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    s_status.wifi_connected = false;
    xEventGroupClearBits(s_wifi_events, WIFI_CONNECTED_BIT);
    esp_wifi_connect();
    notify();
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    const ip_event_got_ip_t *event = data;
    snprintf(s_status.ip_address, sizeof(s_status.ip_address), IPSTR, IP2STR(&event->ip_info.ip));
    s_status.wifi_connected = true;
    s_status.last_error[0] = '\0';
    xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
    ESP_LOGI(TAG, "Wi-Fi connected at %s", s_status.ip_address);
    notify();
  }
}

static void connection_task(void *argument) {
  (void)argument;
  if (!lantern_storage_has_wifi(s_config)) {
    start_setup_portal();
    vTaskDelete(NULL);
    return;
  }
  EventBits_t bits = xEventGroupWaitBits(s_wifi_events, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE, pdMS_TO_TICKS(15000));
  if (!(bits & WIFI_CONNECTED_BIT)) {
    set_error("Wi-Fi timed out; setup portal started");
    start_setup_portal();
    vTaskDelete(NULL);
    return;
  }
  if (!lantern_storage_is_paired(s_config) && s_config->pairing_code[0]) claim_device();
  if (!lantern_storage_is_paired(s_config)) start_setup_portal();
  vTaskDelete(NULL);
}

esp_err_t lantern_network_start(lantern_config_t *config, lantern_network_callback_t callback) {
  if (!config) return ESP_ERR_INVALID_ARG;
  s_config = config;
  s_callback = callback;
  memset(&s_status, 0, sizeof(s_status));
  s_status.paired = lantern_storage_is_paired(config);
  s_wifi_events = xEventGroupCreate();
  if (!s_wifi_events) return ESP_ERR_NO_MEM;
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();
  esp_netif_create_default_wifi_ap();
  wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&init));
  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL));
  ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, NULL));
  bool has_wifi = lantern_storage_has_wifi(config);
  esp_err_t portal_result = ESP_OK;
  if (has_wifi) {
    wifi_config_t station = {0};
    size_t ssid_length = strnlen(config->wifi_ssid, sizeof(station.sta.ssid));
    size_t password_length = strnlen(config->wifi_password, sizeof(station.sta.password));
    memcpy(station.sta.ssid, config->wifi_ssid, ssid_length);
    memcpy(station.sta.password, config->wifi_password, password_length);
    station.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &station));
  } else {
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    // Reserve the HTTP task before esp_wifi_start consumes the remaining
    // internal-memory blocks. The listener can bind before the AP comes up.
    portal_result = start_setup_portal();
  }
  ESP_ERROR_CHECK(esp_wifi_start());
  // Voice commands and streamed PCM are latency-sensitive. Modem power save
  // can defer hotspot packets until the next beacon and cause audible gaps.
  esp_wifi_set_ps(WIFI_PS_NONE);
  if (portal_result != ESP_OK) return portal_result;
  if (has_wifi && xTaskCreate(connection_task, "lantern_connect", 8192, NULL, 5, NULL) != pdPASS) {
    return ESP_ERR_NO_MEM;
  }
  return ESP_OK;
}

void lantern_network_get_status(lantern_network_status_t *status) {
  if (status) *status = s_status;
}

esp_err_t lantern_network_send_heartbeat(const char *state, unsigned state_version, int battery_level) {
  if (!s_config || !s_status.wifi_connected || !lantern_storage_is_paired(s_config)) return ESP_ERR_INVALID_STATE;
  char event_id[37];
  uuid_v4(event_id);
  char authorization[140];
  snprintf(authorization, sizeof(authorization), "Device %s.%s", s_config->device_id, s_config->device_secret);
  char body[512];
  snprintf(body, sizeof(body),
    "{\"eventId\":\"%s\",\"firmwareVersion\":\"%s\",\"state\":\"%s\","
    "\"stateVersion\":%u,\"batteryLevel\":%d,\"networkType\":\"wifi\","
    "\"freeHeapBytes\":%u,\"lastError\":null}",
    event_id, LANTERN_FIRMWARE_VERSION, state, state_version, battery_level,
    (unsigned)esp_get_free_heap_size());
  response_buffer_t *response = response_buffer_create();
  if (!response) return ESP_ERR_NO_MEM;
  int status = post_json("/api/device/v1/heartbeat", body, authorization, response);
  if (status != 200) {
    ESP_LOGW(TAG, "heartbeat HTTP %d: %.192s", status, response->data);
    free(response);
    return ESP_FAIL;
  }
  free(response);
  ESP_LOGI(TAG, "heartbeat acknowledged");
  return ESP_OK;
}

esp_err_t lantern_network_play_briefing(const char *kind, int battery_level) {
  if (!kind || !s_config || !s_status.wifi_connected || !lantern_storage_is_paired(s_config)) {
    return ESP_ERR_INVALID_STATE;
  }
  char url[256];
  snprintf(url, sizeof(url), "%s/api/device/v1/briefing", LANTERN_API_BASE_URL);
  audio_response_t *audio = heap_caps_calloc(
    1, sizeof(audio_response_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!audio) return ESP_ERR_NO_MEM;
  esp_http_client_config_t config = {
    .url = url,
    .event_handler = audio_http_event,
    .user_data = audio,
    .timeout_ms = 60000,
    .crt_bundle_attach = esp_crt_bundle_attach,
    .buffer_size = 4096,
  };
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) {
    free(audio);
    return ESP_FAIL;
  }
  char authorization[140];
  device_authorization(authorization);
  char body[96];
  snprintf(body, sizeof(body), "{\"kind\":\"%s\",\"batteryLevel\":%d}", kind, battery_level);
  esp_http_client_set_method(client, HTTP_METHOD_POST);
  esp_http_client_set_header(client, "Content-Type", "application/json");
  esp_http_client_set_header(client, "Authorization", authorization);
  esp_http_client_set_post_field(client, body, (int)strlen(body));
  esp_err_t result = esp_http_client_perform(client);
  int status = result == ESP_OK ? esp_http_client_get_status_code(client) : -1;
  if (audio->playback_started) lantern_audio_pcm_end();
  bool success = result == ESP_OK && status == 200 && audio->content_is_pcm &&
    audio->audio_bytes > 0 && !audio->playback_failed;
  if (!success) {
    ESP_LOGW(TAG, "briefing %s failed HTTP %d: %.192s", kind, status, audio->response.data);
  } else {
    ESP_LOGI(TAG, "briefing %s played %u PCM bytes", kind, (unsigned)audio->audio_bytes);
  }
  esp_http_client_cleanup(client);
  free(audio);
  return success ? ESP_OK : ESP_FAIL;
}

esp_err_t lantern_network_play_prompt(const char *kind) {
  if (!kind || !s_config || !s_status.wifi_connected || !lantern_storage_is_paired(s_config)) {
    return ESP_ERR_INVALID_STATE;
  }
  char url[256];
  snprintf(url, sizeof(url), "%s/api/device/v1/speak", LANTERN_API_BASE_URL);
  audio_response_t *audio = heap_caps_calloc(
    1, sizeof(audio_response_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!audio) return ESP_ERR_NO_MEM;
  esp_http_client_config_t config = {
    .url = url,
    .event_handler = audio_http_event,
    .user_data = audio,
    .timeout_ms = 60000,
    .crt_bundle_attach = esp_crt_bundle_attach,
    .buffer_size = 4096,
  };
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) {
    free(audio);
    return ESP_FAIL;
  }
  char authorization[140];
  device_authorization(authorization);
  char body[80];
  snprintf(body, sizeof(body), "{\"kind\":\"%s\"}", kind);
  esp_http_client_set_method(client, HTTP_METHOD_POST);
  esp_http_client_set_header(client, "Content-Type", "application/json");
  esp_http_client_set_header(client, "Authorization", authorization);
  esp_http_client_set_post_field(client, body, (int)strlen(body));
  esp_err_t result = esp_http_client_perform(client);
  int status = result == ESP_OK ? esp_http_client_get_status_code(client) : -1;
  if (audio->playback_started) lantern_audio_pcm_end();
  bool success = result == ESP_OK && status == 200 && audio->content_is_pcm &&
    audio->audio_bytes > 0 && !audio->playback_failed;
  if (!success) {
    ESP_LOGW(TAG, "prompt %s failed HTTP %d: %.192s", kind, status, audio->response.data);
  } else {
    ESP_LOGI(TAG, "prompt %s played %u PCM bytes", kind, (unsigned)audio->audio_bytes);
  }
  esp_http_client_cleanup(client);
  free(audio);
  return success ? ESP_OK : ESP_FAIL;
}

esp_err_t lantern_network_run_voice_command(const char *context, int battery_level,
                                            char *intent, size_t intent_capacity) {
  if (!context || !intent || !intent_capacity || !s_config || !s_status.wifi_connected ||
      !lantern_storage_is_paired(s_config)) {
    return ESP_ERR_INVALID_ARG;
  }
  intent[0] = '\0';
  size_t samples = lantern_audio_buffered_samples();
  if (!samples) return ESP_ERR_INVALID_STATE;
  size_t data_bytes = samples * sizeof(int16_t);
  size_t wav_size = 44 + data_bytes;
  uint8_t *wav = heap_caps_malloc(wav_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!wav) return ESP_ERR_NO_MEM;
  memset(wav, 0, 44);
  memcpy(wav, "RIFF", 4);
  wav_u32(wav + 4, 36 + (uint32_t)data_bytes);
  memcpy(wav + 8, "WAVEfmt ", 8);
  wav_u32(wav + 16, 16);
  wav_u16(wav + 20, 1);
  wav_u16(wav + 22, 1);
  wav_u32(wav + 24, LANTERN_MIC_SAMPLE_RATE);
  wav_u32(wav + 28, LANTERN_MIC_SAMPLE_RATE * 2);
  wav_u16(wav + 32, 2);
  wav_u16(wav + 34, 16);
  memcpy(wav + 36, "data", 4);
  wav_u32(wav + 40, (uint32_t)data_bytes);
  size_t copied = lantern_audio_copy_samples((int16_t *)(wav + 44), 0, samples);
  if (copied != samples) {
    free(wav);
    return ESP_FAIL;
  }

  char url[256], authorization[140], battery[8];
  snprintf(url, sizeof(url), "%s/api/device/v1/command", LANTERN_API_BASE_URL);
  device_authorization(authorization);
  snprintf(battery, sizeof(battery), "%d", battery_level);
  audio_response_t *audio = heap_caps_calloc(
    1, sizeof(audio_response_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!audio) {
    free(wav);
    return ESP_ERR_NO_MEM;
  }
  esp_http_client_config_t config = {
    .url = url,
    .event_handler = audio_http_event,
    .user_data = audio,
    .timeout_ms = 120000,
    .crt_bundle_attach = esp_crt_bundle_attach,
    .buffer_size_tx = 4096,
  };
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) {
    free(audio);
    free(wav);
    return ESP_FAIL;
  }
  esp_http_client_set_method(client, HTTP_METHOD_POST);
  esp_http_client_set_header(client, "Content-Type", "audio/wav");
  esp_http_client_set_header(client, "Authorization", authorization);
  esp_http_client_set_header(client, "X-Lantern-Command-Context", context);
  esp_http_client_set_header(client, "X-Lantern-Battery-Level", battery);
  esp_http_client_set_post_field(client, (const char *)wav, (int)wav_size);
  esp_err_t result = esp_http_client_perform(client);
  int status = result == ESP_OK ? esp_http_client_get_status_code(client) : -1;
  if (audio->playback_started) lantern_audio_pcm_end();
  esp_http_client_cleanup(client);
  free(wav);
  if (result == ESP_OK && status == 204) {
    ESP_LOGI(TAG, "cloud wake verifier ignored a non-Lantern utterance");
    free(audio);
    return ESP_ERR_NOT_FOUND;
  }
  if (result != ESP_OK || status != 200 || !audio->content_is_pcm ||
      !audio->audio_bytes || audio->playback_failed || !audio->command[0]) {
    if (!audio->content_is_pcm && audio->response.length) {
      ESP_LOGW(TAG, "voice command HTTP %d: %.192s", status, audio->response.data);
    } else {
      ESP_LOGW(TAG, "voice command failed result=%s HTTP %d bytes=%u command=%s",
        esp_err_to_name(result), status, (unsigned)audio->audio_bytes,
        audio->command[0] ? audio->command : "missing");
    }
    free(audio);
    return ESP_FAIL;
  }
  snprintf(intent, intent_capacity, "%s", audio->command);
  ESP_LOGI(TAG, "voice command %s played %u PCM bytes", intent, (unsigned)audio->audio_bytes);
  free(audio);
  return ESP_OK;
}

esp_err_t lantern_network_restart_session(void) {
  if (!s_config || !s_status.wifi_connected || !lantern_storage_is_paired(s_config)) {
    return ESP_ERR_INVALID_STATE;
  }
  char event_id[37];
  uuid_v4(event_id);
  char body[64];
  snprintf(body, sizeof(body), "{\"eventId\":\"%s\"}", event_id);
  char authorization[140];
  device_authorization(authorization);
  response_buffer_t *response = response_buffer_create();
  if (!response) return ESP_ERR_NO_MEM;
  int status = post_json("/api/device/v1/restart", body, authorization, response);
  if (status != 200) {
    provider_error("Session restart", status, response);
    free(response);
    return ESP_FAIL;
  }
  free(response);
  ESP_LOGI(TAG, "server session reset acknowledged");
  return ESP_OK;
}

esp_err_t lantern_network_begin_quick(lantern_cloud_session_t *session) {
  if (!session || !s_config || !s_status.wifi_connected || !lantern_storage_is_paired(s_config)) {
    return ESP_ERR_INVALID_STATE;
  }
  char preserved_event_id[37];
  snprintf(preserved_event_id, sizeof(preserved_event_id), "%s", session->begin_event_id);

  for (unsigned attempt = 0; attempt < 2; ++attempt) {
    memset(session, 0, sizeof(*session));
    if (attempt == 0 && preserved_event_id[0]) {
      snprintf(session->begin_event_id, sizeof(session->begin_event_id), "%s",
        preserved_event_id);
    } else {
      uuid_v4(session->begin_event_id);
    }

    char body[128];
    snprintf(body, sizeof(body), "{\"eventId\":\"%s\",\"mode\":\"quick\"}",
      session->begin_event_id);
    char authorization[140];
    device_authorization(authorization);
    response_buffer_t *response = response_buffer_create();
    if (!response) return ESP_ERR_NO_MEM;
    int status = post_json("/api/device/v1/sessions", body, authorization, response);

    if (status == 409 && attempt == 0) {
      provider_error("Session start", status, response);
      free(response);
      ESP_LOGW(TAG, "stale cloud session detected; resetting it before one fresh start");
      if (lantern_network_restart_session() != ESP_OK) return ESP_FAIL;
      continue;
    }
    if (status != 201 && status != 200) {
      provider_error("Session start", status, response);
      free(response);
      return ESP_FAIL;
    }
    bool valid = parse_session_response(response->data, session, NULL) && session->prompt_id[0];
    free(response);
    if (!valid) {
      set_error("Session response was invalid");
      return ESP_FAIL;
    }
    return ESP_OK;
  }
  return ESP_FAIL;
}

static esp_err_t send_session_event(lantern_cloud_session_t *session, const char *event_json,
                                    lantern_agora_transport_t *transport,
                                    char persistent_event_id[37]) {
  if (!session || !session->session_id[0]) return ESP_ERR_INVALID_ARG;
  char event_id[37];
  char *selected_event_id = event_id;
  if (persistent_event_id) {
    if (!persistent_event_id[0]) uuid_v4(persistent_event_id);
    selected_event_id = persistent_event_id;
  } else {
    uuid_v4(event_id);
  }
  char path[160];
  snprintf(path, sizeof(path), "/api/device/v1/sessions/%s/events", session->session_id);
  size_t needed = strlen(event_json) + 180;
  char *body = heap_caps_malloc(needed, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!body) return ESP_ERR_NO_MEM;
  snprintf(body, needed,
    "{\"eventId\":\"%s\",\"expectedVersion\":%u,\"event\":%s}",
    selected_event_id, session->version, event_json);
  char authorization[140];
  device_authorization(authorization);
  response_buffer_t *response = response_buffer_create();
  if (!response) {
    free(body);
    return ESP_ERR_NO_MEM;
  }
  int status = post_json(path, body, authorization, response);
  free(body);
  if (status != 200) {
    provider_error("Session event", status, response);
    free(response);
    return ESP_FAIL;
  }
  bool valid = parse_session_response(response->data, session, transport);
  free(response);
  if (!valid) {
    set_error("Session event response was invalid");
    return ESP_FAIL;
  }
  return ESP_OK;
}

esp_err_t lantern_network_confirm_consent(lantern_cloud_session_t *session, bool accepted,
                                          lantern_agora_transport_t *transport) {
  char event[320];
  snprintf(event, sizeof(event),
    "{\"type\":\"RECORDING_CONSENT\",\"at\":\"1970-01-01T00:00:00Z\"," 
    "\"promptId\":\"%s\",\"accepted\":%s}",
    session ? session->prompt_id : "", accepted ? "true" : "false");
  esp_err_t result = send_session_event(
    session, event, transport, session ? session->consent_event_id : NULL);
  if (result != ESP_OK || !accepted) return result;
  if (!transport || !transport->app_id[0] || !transport->channel[0] ||
      !transport->token[0] || !transport->publisher_uid || !transport->stt_bot_uid) {
    set_error("Agora transport was missing");
    return ESP_FAIL;
  }
  return ESP_OK;
}

esp_err_t lantern_network_capture_started(lantern_cloud_session_t *session) {
  return send_session_event(
    session, "{\"type\":\"CAPTURE_STARTED\",\"at\":\"1970-01-01T00:00:00Z\"}", NULL,
    session ? session->capture_event_id : NULL);
}

esp_err_t lantern_network_stop_recording(lantern_cloud_session_t *session) {
  return send_session_event(
    session, "{\"type\":\"STOP\",\"at\":\"1970-01-01T00:00:00Z\"}", NULL,
    session ? session->stop_event_id : NULL);
}

esp_err_t lantern_network_abort_session(lantern_cloud_session_t *session) {
  return send_session_event(
    session, "{\"type\":\"RESET\",\"at\":\"1970-01-01T00:00:00Z\"}", NULL, NULL);
}

esp_err_t lantern_network_upload_transcript(lantern_cloud_session_t *session) {
  if (!session || !session->session_id[0] || !lantern_transcript_size()) return ESP_ERR_INVALID_STATE;
  char path[168], authorization[140], event_id[37];
  snprintf(path, sizeof(path), "/api/device/v1/sessions/%s/transcript", session->session_id);
  device_authorization(authorization);
  if (!session->transcript_event_id[0]) uuid_v4(session->transcript_event_id);
  snprintf(event_id, sizeof(event_id), "%s", session->transcript_event_id);
  response_buffer_t *response = response_buffer_create();
  if (!response) return ESP_ERR_NO_MEM;
  int status = post_binary(path, "application/x-lantern-agora-caption-batch",
    lantern_transcript_data(), lantern_transcript_size(), authorization, event_id, response);
  if (status != 201 && status != 200) {
    provider_error("Transcript upload", status, response);
    free(response);
    return ESP_FAIL;
  }
  free(response);
  return ESP_OK;
}

esp_err_t lantern_network_upload_audio(lantern_cloud_session_t *session) {
  if (!session || !session->session_id[0]) return ESP_ERR_INVALID_ARG;
  size_t samples = lantern_audio_buffered_samples();
  if (!samples) return ESP_ERR_INVALID_STATE;
  size_t data_bytes = samples * sizeof(int16_t);
  size_t wav_size = 44 + data_bytes;
  uint8_t *wav = heap_caps_malloc(wav_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!wav) return ESP_ERR_NO_MEM;
  memset(wav, 0, 44);
  memcpy(wav, "RIFF", 4);
  wav_u32(wav + 4, 36 + (uint32_t)data_bytes);
  memcpy(wav + 8, "WAVEfmt ", 8);
  wav_u32(wav + 16, 16);
  wav_u16(wav + 20, 1);
  wav_u16(wav + 22, 1);
  wav_u32(wav + 24, LANTERN_MIC_SAMPLE_RATE);
  wav_u32(wav + 28, LANTERN_MIC_SAMPLE_RATE * 2);
  wav_u16(wav + 32, 2);
  wav_u16(wav + 34, 16);
  memcpy(wav + 36, "data", 4);
  wav_u32(wav + 40, (uint32_t)data_bytes);
  size_t copied = lantern_audio_copy_samples((int16_t *)(wav + 44), 0, samples);
  if (copied != samples) {
    free(wav);
    return ESP_FAIL;
  }
  char path[160], authorization[140], event_id[37];
  snprintf(path, sizeof(path), "/api/device/v1/sessions/%s/audio", session->session_id);
  device_authorization(authorization);
  if (!session->audio_event_id[0]) uuid_v4(session->audio_event_id);
  snprintf(event_id, sizeof(event_id), "%s", session->audio_event_id);
  response_buffer_t *response = response_buffer_create();
  if (!response) {
    free(wav);
    return ESP_ERR_NO_MEM;
  }
  int status = post_binary(path, "audio/wav", wav, wav_size, authorization, event_id, response);
  free(wav);
  if (status != 201 && status != 200) {
    provider_error("Audio upload", status, response);
    free(response);
    return ESP_FAIL;
  }
  free(response);
  return ESP_OK;
}

esp_err_t lantern_network_complete_session(lantern_cloud_session_t *session) {
  if (!session || !session->session_id[0]) return ESP_ERR_INVALID_ARG;
  char path[160], authorization[140], body[80];
  if (!session->completion_event_id[0]) uuid_v4(session->completion_event_id);
  snprintf(path, sizeof(path), "/api/device/v1/sessions/%s/complete", session->session_id);
  snprintf(body, sizeof(body), "{\"eventId\":\"%s\"}", session->completion_event_id);
  device_authorization(authorization);
  response_buffer_t *response = response_buffer_create();
  if (!response) return ESP_ERR_NO_MEM;
  int status = post_json(path, body, authorization, response);
  if (status != 201 && status != 200) {
    provider_error("Meeting processing", status, response);
    free(response);
    return ESP_FAIL;
  }
  bool valid = parse_session_response(response->data, session, NULL);
  free(response);
  return valid ? ESP_OK : ESP_FAIL;
}
