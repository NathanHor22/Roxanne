#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "agora_rtc_api.h"
#include "cJSON.h"
#include "driver/gpio.h"
#include "driver/i2s_std.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include "roxanne_config.h"

#define WIFI_CONNECTED_BIT BIT0
#define RTC_JOINED_BIT BIT0
#define TRANSCRIPT_CAPACITY (96 * 1024)
#define HTTP_RESPONSE_CAPACITY 8192
#define MIC_INPUT_SAMPLES 320
#define RTC_OUTPUT_SAMPLES 160

static const char *TAG = "roxanne";

static EventGroupHandle_t s_wifi_events;
static EventGroupHandle_t s_rtc_events;
static i2s_chan_handle_t s_mic_rx;
static i2s_chan_handle_t s_speaker_tx;
static connection_id_t s_connection = CONNECTION_ID_INVALID;
static bool s_rtc_initialized;
static volatile bool s_session_active;
static volatile int64_t s_playing_until_us;
static char *s_transcript;
static size_t s_transcript_length;
static portMUX_TYPE s_transcript_lock = portMUX_INITIALIZER_UNLOCKED;

static char s_app_id[33];
static char s_channel[65];
static char s_rtc_token[513];
static char s_rtm_uid[65];
static char s_rtm_token[513];
static char s_session_id[40];
static char s_agent_id[161];
static uint32_t s_uid;

typedef struct {
  char data[HTTP_RESPONSE_CAPACITY];
  size_t length;
} http_response_t;

static void copy_json_string(cJSON *object, const char *key, char *destination, size_t size) {
  cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
  if (!cJSON_IsString(item) || item->valuestring == NULL) {
    ESP_LOGE(TAG, "Missing response field: %s", key);
    destination[0] = '\0';
    return;
  }
  snprintf(destination, size, "%s", item->valuestring);
}

static esp_err_t http_event_handler(esp_http_client_event_t *event) {
  if (event->event_id != HTTP_EVENT_ON_DATA || event->data_len <= 0) return ESP_OK;
  http_response_t *response = event->user_data;
  if (!response) return ESP_OK;
  size_t available = sizeof(response->data) - response->length - 1;
  size_t copy_length = (size_t)event->data_len < available ? (size_t)event->data_len : available;
  if (copy_length) {
    memcpy(response->data + response->length, event->data, copy_length);
    response->length += copy_length;
    response->data[response->length] = '\0';
  }
  return ESP_OK;
}

static int http_post(const char *url, const char *content_type, const char *body,
                     size_t body_length, http_response_t *response,
                     const char *session_id, const char *agent_id) {
  if (response) memset(response, 0, sizeof(*response));
  esp_http_client_config_t config = {
    .url = url,
    .event_handler = http_event_handler,
    .user_data = response,
    .timeout_ms = 30000,
    .crt_bundle_attach = esp_crt_bundle_attach,
  };
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) return -1;
  esp_http_client_set_method(client, HTTP_METHOD_POST);
  esp_http_client_set_header(client, "Content-Type", content_type);
  if (session_id) {
    esp_http_client_set_header(client, "x-roxanne-device-id", ROXANNE_DEVICE_ID);
    esp_http_client_set_header(client, "x-roxanne-session-id", session_id);
    esp_http_client_set_header(client, "x-roxanne-agent-id", agent_id ? agent_id : "");
    esp_http_client_set_header(client, "x-roxanne-locale", ROXANNE_LOCALE);
  }
  esp_http_client_set_post_field(client, body, (int)body_length);
  esp_err_t result = esp_http_client_perform(client);
  int status = result == ESP_OK ? esp_http_client_get_status_code(client) : -1;
  if (result != ESP_OK) ESP_LOGE(TAG, "HTTP request failed: %s", esp_err_to_name(result));
  esp_http_client_cleanup(client);
  return status;
}

static void wifi_event_handler(void *argument, esp_event_base_t event_base,
                               int32_t event_id, void *event_data) {
  (void)argument;
  (void)event_data;
  if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
    esp_wifi_connect();
  } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
    xEventGroupClearBits(s_wifi_events, WIFI_CONNECTED_BIT);
    esp_wifi_connect();
  } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
    xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
    ESP_LOGI(TAG, "Phone hotspot connected");
  }
}

static void wifi_init(void) {
  s_wifi_events = xEventGroupCreate();
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();
  wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&init));
  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL));
  ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL));
  wifi_config_t wifi = {
    .sta = {
      .ssid = ROXANNE_WIFI_SSID,
      .password = ROXANNE_WIFI_PASSWORD,
      .threshold.authmode = WIFI_AUTH_WPA2_PSK,
    },
  };
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi));
  ESP_ERROR_CHECK(esp_wifi_start());
  ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
}

static void audio_init(void) {
  i2s_chan_config_t speaker_channel = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  speaker_channel.dma_desc_num = 6;
  speaker_channel.dma_frame_num = 240;
  ESP_ERROR_CHECK(i2s_new_channel(&speaker_channel, &s_speaker_tx, NULL));
  i2s_std_config_t speaker = {
    .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(ROXANNE_RTC_SAMPLE_RATE),
    .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO),
    .gpio_cfg = {
      .mclk = I2S_GPIO_UNUSED,
      .bclk = ROXANNE_SPK_BCLK_GPIO,
      .ws = ROXANNE_SPK_LRCK_GPIO,
      .dout = ROXANNE_SPK_DATA_GPIO,
      .din = I2S_GPIO_UNUSED,
      .invert_flags = { false, false, false },
    },
  };
  speaker.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
  ESP_ERROR_CHECK(i2s_channel_init_std_mode(s_speaker_tx, &speaker));
  ESP_ERROR_CHECK(i2s_channel_enable(s_speaker_tx));

  i2s_chan_config_t mic_channel = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
  mic_channel.dma_desc_num = 6;
  mic_channel.dma_frame_num = 240;
  ESP_ERROR_CHECK(i2s_new_channel(&mic_channel, NULL, &s_mic_rx));
  i2s_std_config_t mic = {
    .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(ROXANNE_MIC_SAMPLE_RATE),
    .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO),
    .gpio_cfg = {
      .mclk = I2S_GPIO_UNUSED,
      .bclk = ROXANNE_MIC_SCK_GPIO,
      .ws = ROXANNE_MIC_WS_GPIO,
      .dout = I2S_GPIO_UNUSED,
      .din = ROXANNE_MIC_DATA_GPIO,
      .invert_flags = { false, false, false },
    },
  };
  mic.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
  ESP_ERROR_CHECK(i2s_channel_init_std_mode(s_mic_rx, &mic));
  ESP_ERROR_CHECK(i2s_channel_enable(s_mic_rx));
}

static void transcript_reset(void) {
  portENTER_CRITICAL(&s_transcript_lock);
  s_transcript_length = 0;
  if (s_transcript) s_transcript[0] = '\0';
  portEXIT_CRITICAL(&s_transcript_lock);
}

static void transcript_append(const void *data, size_t length) {
  if (!s_transcript || !data || !length) return;
  portENTER_CRITICAL(&s_transcript_lock);
  size_t remaining = TRANSCRIPT_CAPACITY - s_transcript_length - 2;
  size_t copy_length = length < remaining ? length : remaining;
  if (copy_length) {
    memcpy(s_transcript + s_transcript_length, data, copy_length);
    s_transcript_length += copy_length;
    s_transcript[s_transcript_length++] = '\n';
    s_transcript[s_transcript_length] = '\0';
  }
  portEXIT_CRITICAL(&s_transcript_lock);
}

static void on_join_success(connection_id_t connection, uint32_t uid, int elapsed) {
  (void)connection;
  ESP_LOGI(TAG, "Joined Agora as %lu in %d ms", (unsigned long)uid, elapsed);
  xEventGroupSetBits(s_rtc_events, RTC_JOINED_BIT);
}

static void on_connection_lost(connection_id_t connection) {
  (void)connection;
  xEventGroupClearBits(s_rtc_events, RTC_JOINED_BIT);
  ESP_LOGW(TAG, "Agora connection lost");
}

static void on_rtc_error(connection_id_t connection, int code, const char *message) {
  (void)connection;
  ESP_LOGE(TAG, "Agora error %d: %s", code, message ? message : "unknown");
}

static void on_audio_data(connection_id_t connection, uint32_t uid, uint16_t timestamp,
                          const void *data, size_t length, const audio_frame_info_t *info) {
  (void)connection;
  (void)uid;
  (void)timestamp;
  (void)info;
  if (!data || length < sizeof(int16_t)) return;
  s_playing_until_us = esp_timer_get_time() + 200000;
  const int16_t *samples = data;
  size_t count = length / sizeof(int16_t);
  int32_t output[RTC_OUTPUT_SAMPLES];
  while (count) {
    size_t chunk = count > RTC_OUTPUT_SAMPLES ? RTC_OUTPUT_SAMPLES : count;
    for (size_t i = 0; i < chunk; ++i) output[i] = ((int32_t)samples[i] * 3 / 4) << 16;
    size_t written = 0;
    i2s_channel_write(s_speaker_tx, output, chunk * sizeof(int32_t), &written, pdMS_TO_TICKS(100));
    samples += chunk;
    count -= chunk;
  }
}

static void on_stream_message(connection_id_t connection, uint32_t uid, int stream_id,
                              const char *data, size_t length, uint64_t timestamp) {
  (void)connection;
  (void)uid;
  (void)stream_id;
  (void)timestamp;
  transcript_append(data, length);
}

static void on_rtm_data(const char *uid, const void *message, size_t length) {
  (void)uid;
  transcript_append(message, length);
}

static void on_rtm_event(const char *uid, rtm_event_type_e type, rtm_err_code_e code) {
  ESP_LOGI(TAG, "RTM event uid=%s type=%d code=%d", uid ? uid : "", type, code);
}

static void on_rtm_send_result(const char *uid, uint32_t message_id, rtm_msg_state_e state) {
  (void)uid;
  (void)message_id;
  (void)state;
}

static int request_session(void) {
  char url[192];
  char request_body[160];
  snprintf(url, sizeof(url), "%s/api/hardware/session/start", ROXANNE_API_BASE_URL);
  snprintf(request_body, sizeof(request_body),
           "{\"deviceId\":\"%s\",\"language\":\"%s\"}",
           ROXANNE_DEVICE_ID, ROXANNE_LANGUAGE);
  http_response_t response;
  int status = http_post(url, "application/json", request_body, strlen(request_body), &response, NULL, NULL);
  if (status != 200) {
    ESP_LOGE(TAG, "Session start HTTP %d: %.300s", status, response.data);
    return -1;
  }
  cJSON *root = cJSON_Parse(response.data);
  if (!root) return -1;
  cJSON *agora = cJSON_GetObjectItemCaseSensitive(root, "agora");
  cJSON *agent = cJSON_GetObjectItemCaseSensitive(root, "agent");
  copy_json_string(root, "sessionId", s_session_id, sizeof(s_session_id));
  if (cJSON_IsObject(agora)) {
    copy_json_string(agora, "appId", s_app_id, sizeof(s_app_id));
    copy_json_string(agora, "channel", s_channel, sizeof(s_channel));
    copy_json_string(agora, "token", s_rtc_token, sizeof(s_rtc_token));
    copy_json_string(agora, "rtmUid", s_rtm_uid, sizeof(s_rtm_uid));
    copy_json_string(agora, "rtmToken", s_rtm_token, sizeof(s_rtm_token));
    cJSON *uid = cJSON_GetObjectItemCaseSensitive(agora, "uid");
    s_uid = cJSON_IsNumber(uid) ? (uint32_t)uid->valuedouble : 0;
  }
  if (cJSON_IsObject(agent)) copy_json_string(agent, "agentId", s_agent_id, sizeof(s_agent_id));
  cJSON_Delete(root);
  if (!s_app_id[0] || !s_channel[0] || !s_rtc_token[0] || !s_uid || !s_agent_id[0]) return -1;
  return 0;
}

static int rtc_start(void) {
  agora_rtc_event_handler_t events = { 0 };
  events.on_join_channel_success = on_join_success;
  events.on_connection_lost = on_connection_lost;
  events.on_audio_data = on_audio_data;
  events.on_stream_message = on_stream_message;
  events.on_error = on_rtc_error;
  rtc_service_option_t service = { 0 };
  service.area_code = AREA_CODE_GLOB;
  service.log_cfg.log_level = RTC_LOG_WARNING;
  service.log_cfg.log_disable = false;
  service.log_cfg.log_printf = printf;
  if (agora_rtc_init(s_app_id, &events, &service) < 0) return -1;
  s_rtc_initialized = true;
  if (agora_rtc_create_connection(&s_connection) < 0) return -1;
  rtc_channel_options_t options = { 0 };
  options.auto_subscribe_audio = true;
  options.auto_subscribe_video = false;
  options.audio_codec_opt.audio_codec_type = AUDIO_CODEC_TYPE_G711U;
  options.audio_codec_opt.pcm_sample_rate = ROXANNE_RTC_SAMPLE_RATE;
  options.audio_codec_opt.pcm_channel_num = 1;
  options.audio_codec_opt.pcm_duration = 20;
  xEventGroupClearBits(s_rtc_events, RTC_JOINED_BIT);
  if (agora_rtc_join_channel(s_connection, s_channel, s_uid, s_rtc_token, &options) < 0) return -1;
  EventBits_t joined = xEventGroupWaitBits(s_rtc_events, RTC_JOINED_BIT, pdFALSE, pdTRUE, pdMS_TO_TICKS(15000));
  if (!(joined & RTC_JOINED_BIT)) return -1;
  agora_rtm_handler_t rtm = {
    .on_rtm_data = on_rtm_data,
    .on_rtm_event = on_rtm_event,
    .on_send_rtm_data_result = on_rtm_send_result,
  };
  int rtm_result = agora_rtc_login_rtm(s_rtm_uid, s_rtm_token, &rtm);
  if (rtm_result < 0) ESP_LOGW(TAG, "RTM login failed: %s", agora_rtc_err_2_str(rtm_result));
  return 0;
}

static void rtc_stop(void) {
  if (!s_rtc_initialized) return;
  agora_rtc_logout_rtm();
  if (s_connection != CONNECTION_ID_INVALID) {
    agora_rtc_leave_channel(s_connection);
    agora_rtc_destroy_connection(s_connection);
    s_connection = CONNECTION_ID_INVALID;
  }
  agora_rtc_fini();
  s_rtc_initialized = false;
  xEventGroupClearBits(s_rtc_events, RTC_JOINED_BIT);
}

static void complete_session(void) {
  char url[192];
  snprintf(url, sizeof(url), "%s/api/hardware/session/complete", ROXANNE_API_BASE_URL);
  http_response_t response;
  int status = http_post(url, "text/plain; charset=utf-8", s_transcript,
                         s_transcript_length, &response, s_session_id, s_agent_id);
  if (status == 200) {
    ESP_LOGI(TAG, "Conversation saved to dashboard");
  } else {
    ESP_LOGE(TAG, "Dashboard completion HTTP %d: %.300s", status, response.data);
  }
}

static void start_session(void) {
  ESP_LOGI(TAG, "Starting Roxanne voice session");
  gpio_set_level(ROXANNE_STATUS_GPIO, 1);
  transcript_reset();
  if (request_session() != 0) {
    ESP_LOGE(TAG, "Could not start voice session");
    gpio_set_level(ROXANNE_STATUS_GPIO, 0);
    return;
  }
  if (rtc_start() != 0) {
    ESP_LOGE(TAG, "Could not join the Agora voice session");
    rtc_stop();
    complete_session();
    gpio_set_level(ROXANNE_STATUS_GPIO, 0);
    return;
  }
  s_session_active = true;
  ESP_LOGI(TAG, "Roxanne is listening");
}

static void stop_session(void) {
  ESP_LOGI(TAG, "Stopping Roxanne voice session");
  s_session_active = false;
  gpio_set_level(ROXANNE_STATUS_GPIO, 0);
  rtc_stop();
  complete_session();
  ESP_LOGI(TAG, "Ready for another conversation");
}

static void microphone_task(void *argument) {
  (void)argument;
  int32_t input[MIC_INPUT_SAMPLES];
  int16_t output[RTC_OUTPUT_SAMPLES];
  audio_frame_info_t frame = { .data_type = AUDIO_DATA_TYPE_PCM };
  while (true) {
    size_t bytes_read = 0;
    if (i2s_channel_read(s_mic_rx, input, sizeof(input), &bytes_read, portMAX_DELAY) != ESP_OK) continue;
    if (!s_session_active || esp_timer_get_time() < s_playing_until_us) continue;
    size_t input_samples = bytes_read / sizeof(int32_t);
    size_t output_samples = input_samples / 2;
    if (output_samples > RTC_OUTPUT_SAMPLES) output_samples = RTC_OUTPUT_SAMPLES;
    for (size_t i = 0; i < output_samples; ++i) {
      int32_t value = input[i * 2] >> 12;
      if (value > INT16_MAX) value = INT16_MAX;
      if (value < INT16_MIN) value = INT16_MIN;
      output[i] = (int16_t)value;
    }
    int result = agora_rtc_send_audio_data(s_connection, output,
                                            output_samples * sizeof(int16_t), &frame);
    if (result < 0 && result != -ERR_NOT_IN_CHANNEL) {
      ESP_LOGW(TAG, "Audio send error: %s", agora_rtc_err_2_str(result));
    }
  }
}

static void button_task(void *argument) {
  (void)argument;
  bool previous = true;
  int64_t last_press = 0;
  while (true) {
    bool released = gpio_get_level(ROXANNE_BUTTON_GPIO) != 0;
    if (previous && !released && esp_timer_get_time() - last_press > 400000) {
      last_press = esp_timer_get_time();
      if (s_session_active) stop_session(); else start_session();
    }
    previous = released;
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

void app_main(void) {
  esp_err_t nvs = nvs_flash_init();
  if (nvs == ESP_ERR_NVS_NO_FREE_PAGES || nvs == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    ESP_ERROR_CHECK(nvs_flash_init());
  } else {
    ESP_ERROR_CHECK(nvs);
  }
  s_rtc_events = xEventGroupCreate();
  s_transcript = heap_caps_malloc(TRANSCRIPT_CAPACITY, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_transcript) s_transcript = malloc(TRANSCRIPT_CAPACITY);
  if (!s_transcript) {
    ESP_LOGE(TAG, "Could not allocate transcript buffer");
    abort();
  }
  transcript_reset();

  gpio_config_t output = {
    .pin_bit_mask = 1ULL << ROXANNE_STATUS_GPIO,
    .mode = GPIO_MODE_OUTPUT,
  };
  ESP_ERROR_CHECK(gpio_config(&output));
  gpio_set_level(ROXANNE_STATUS_GPIO, 0);
  gpio_config_t button = {
    .pin_bit_mask = 1ULL << ROXANNE_BUTTON_GPIO,
    .mode = GPIO_MODE_INPUT,
    .pull_up_en = GPIO_PULLUP_ENABLE,
  };
  ESP_ERROR_CHECK(gpio_config(&button));

  audio_init();
  wifi_init();
  ESP_LOGI(TAG, "Connecting to hotspot: %s", ROXANNE_WIFI_SSID);
  xEventGroupWaitBits(s_wifi_events, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);

  xTaskCreatePinnedToCore(microphone_task, "roxanne_mic", 6144, NULL, 20, NULL, 1);
  xTaskCreate(button_task, "roxanne_button", 6144, NULL, 8, NULL);
  ESP_LOGI(TAG, "Firmware ready. Press the main button to talk to Roxanne.");
}
