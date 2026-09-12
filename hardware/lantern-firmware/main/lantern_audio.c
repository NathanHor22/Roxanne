#include "lantern_audio.h"

#include <limits.h>
#include <stdlib.h>

#include "driver/i2s_std.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "lantern_board.h"

#define AUDIO_READ_SAMPLES 320
#define AUDIO_WRITE_SAMPLES 240
#define RETRY_BUFFER_SECONDS 30
#define RETRY_BUFFER_SAMPLES (LANTERN_MIC_SAMPLE_RATE * RETRY_BUFFER_SECONDS)

static const char *TAG = "lantern_audio";
static i2s_chan_handle_t s_speaker;
static i2s_chan_handle_t s_microphone;
static int16_t *s_retry_buffer;
static size_t s_write_index;
static size_t s_sample_count;
static volatile bool s_recording;
static volatile uint32_t s_level;
static lantern_audio_frame_callback_t s_frame_callback;
static SemaphoreHandle_t s_speaker_lock;

static esp_err_t speaker_start_silent(void) {
  int32_t silence[AUDIO_WRITE_SAMPLES] = {0};
  size_t bytes_loaded = 0;
  ESP_RETURN_ON_ERROR(
    i2s_channel_preload_data(s_speaker, silence, sizeof(silence), &bytes_loaded),
    TAG, "speaker silence preload");
  if (bytes_loaded != sizeof(silence)) {
    ESP_LOGW(TAG, "speaker silence preload accepted %u of %u bytes",
      (unsigned)bytes_loaded, (unsigned)sizeof(silence));
  }
  return i2s_channel_enable(s_speaker);
}

static void speaker_stop_silent(void) {
  int32_t silence[AUDIO_WRITE_SAMPLES] = {0};
  size_t bytes_written = 0;
  if (i2s_channel_write(s_speaker, silence, sizeof(silence), &bytes_written,
      pdMS_TO_TICKS(100)) == ESP_OK) {
    vTaskDelay(pdMS_TO_TICKS(20));
  }
  ESP_ERROR_CHECK_WITHOUT_ABORT(i2s_channel_disable(s_speaker));
}

static int16_t buffered_sample(size_t chronological_index) {
  size_t oldest = s_sample_count == RETRY_BUFFER_SAMPLES ? s_write_index : 0;
  return s_retry_buffer[(oldest + chronological_index) % RETRY_BUFFER_SAMPLES];
}

static void microphone_task(void *argument) {
  (void)argument;
  int32_t raw[AUDIO_READ_SAMPLES];
  int16_t converted[AUDIO_READ_SAMPLES];
  while (true) {
    size_t bytes_read = 0;
    esp_err_t result = i2s_channel_read(
      s_microphone, raw, sizeof(raw), &bytes_read, pdMS_TO_TICKS(250));
    if (result != ESP_OK || !bytes_read) continue;
    size_t samples = bytes_read / sizeof(raw[0]);
    uint64_t absolute_total = 0;
    for (size_t index = 0; index < samples; ++index) {
      int32_t value = raw[index] >> 12;
      if (value > INT16_MAX) value = INT16_MAX;
      if (value < INT16_MIN) value = INT16_MIN;
      int16_t sample = (int16_t)value;
      converted[index] = sample;
      absolute_total += sample < 0 ? (uint32_t)(-sample) : (uint32_t)sample;
      if (s_recording && s_retry_buffer) {
        s_retry_buffer[s_write_index] = sample;
        s_write_index = (s_write_index + 1) % RETRY_BUFFER_SAMPLES;
        if (s_sample_count < RETRY_BUFFER_SAMPLES) ++s_sample_count;
      }
    }
    s_level = samples ? (uint32_t)(absolute_total / samples) : 0;
    lantern_audio_frame_callback_t callback = s_frame_callback;
    if (s_recording && callback && samples) callback(converted, samples);
  }
}

esp_err_t lantern_audio_init(void) {
  s_speaker_lock = xSemaphoreCreateMutex();
  if (!s_speaker_lock) return ESP_ERR_NO_MEM;

  i2s_chan_config_t speaker_channel = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  speaker_channel.dma_desc_num = 6;
  speaker_channel.dma_frame_num = 240;
  speaker_channel.auto_clear = true;
  ESP_RETURN_ON_ERROR(i2s_new_channel(&speaker_channel, &s_speaker, NULL), TAG, "speaker channel");
  i2s_std_config_t speaker = {
    .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(LANTERN_SPK_SAMPLE_RATE),
    .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO),
    .gpio_cfg = {
      .mclk = I2S_GPIO_UNUSED,
      .bclk = LANTERN_SPK_BCLK_GPIO,
      .ws = LANTERN_SPK_LRCK_GPIO,
      .dout = LANTERN_SPK_DATA_GPIO,
      .din = I2S_GPIO_UNUSED,
      .invert_flags = { false, false, false },
    },
  };
  speaker.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
  ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(s_speaker, &speaker), TAG, "speaker mode");

  i2s_chan_config_t microphone_channel = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
  microphone_channel.dma_desc_num = 6;
  microphone_channel.dma_frame_num = 320;
  ESP_RETURN_ON_ERROR(i2s_new_channel(&microphone_channel, NULL, &s_microphone), TAG, "microphone channel");
  i2s_std_config_t microphone = {
    .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(LANTERN_MIC_SAMPLE_RATE),
    .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO),
    .gpio_cfg = {
      .mclk = I2S_GPIO_UNUSED,
      .bclk = LANTERN_MIC_SCK_GPIO,
      .ws = LANTERN_MIC_WS_GPIO,
      .dout = I2S_GPIO_UNUSED,
      .din = LANTERN_MIC_DATA_GPIO,
      .invert_flags = { false, false, false },
    },
  };
  microphone.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
  ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(s_microphone, &microphone), TAG, "microphone mode");
  ESP_RETURN_ON_ERROR(i2s_channel_enable(s_microphone), TAG, "microphone enable");

  s_retry_buffer = heap_caps_malloc(RETRY_BUFFER_SAMPLES * sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_retry_buffer) return ESP_ERR_NO_MEM;
  xTaskCreatePinnedToCore(microphone_task, "lantern_mic", 4096, NULL, 6, NULL, 1);
  ESP_LOGI(TAG, "I2S microphone and speaker ready; 30-second PSRAM buffer allocated");
  return ESP_OK;
}

void lantern_audio_chime(unsigned count) {
  if (!s_speaker || !s_speaker_lock || xSemaphoreTake(s_speaker_lock, pdMS_TO_TICKS(500)) != pdTRUE) return;
  if (speaker_start_silent() != ESP_OK) {
    xSemaphoreGive(s_speaker_lock);
    return;
  }
  int32_t samples[AUDIO_WRITE_SAMPLES];
  for (unsigned tone = 0; tone < count; ++tone) {
    for (int chunk = 0; chunk < 12; ++chunk) {
      for (size_t index = 0; index < AUDIO_WRITE_SAMPLES; ++index) {
        int phase = (int)((index + chunk * AUDIO_WRITE_SAMPLES) % 48);
        int triangle = phase < 24 ? phase : 48 - phase;
        int32_t value = (triangle - 12) * 420;
        samples[index] = value * 32768;
      }
      size_t bytes_written = 0;
      i2s_channel_write(s_speaker, samples, sizeof(samples), &bytes_written, pdMS_TO_TICKS(100));
    }
    if (tone + 1 < count) vTaskDelay(pdMS_TO_TICKS(90));
  }
  speaker_stop_silent();
  xSemaphoreGive(s_speaker_lock);
}

void lantern_audio_set_recording(bool recording) {
  if (recording && !s_recording) {
    s_write_index = 0;
    s_sample_count = 0;
  }
  s_recording = recording;
  ESP_LOGI(TAG, "recording=%s buffered=%u", recording ? "true" : "false", (unsigned)s_sample_count);
}

void lantern_audio_set_frame_callback(lantern_audio_frame_callback_t callback) {
  s_frame_callback = callback;
}

bool lantern_audio_is_recording(void) { return s_recording; }
uint32_t lantern_audio_level(void) { return s_level; }
size_t lantern_audio_buffered_samples(void) { return s_sample_count; }
unsigned lantern_audio_buffered_seconds(void) { return (unsigned)(s_sample_count / LANTERN_MIC_SAMPLE_RATE); }

size_t lantern_audio_copy_samples(int16_t *destination, size_t offset, size_t capacity) {
  if (!destination || !capacity || !s_retry_buffer || s_recording || offset >= s_sample_count) return 0;
  size_t available = s_sample_count - offset;
  size_t copied = capacity < available ? capacity : available;
  for (size_t index = 0; index < copied; ++index) {
    destination[index] = buffered_sample(offset + index);
  }
  return copied;
}

unsigned lantern_audio_play_latest(unsigned max_seconds) {
  if (!s_speaker || !s_speaker_lock || !s_retry_buffer || s_recording || !s_sample_count) return 0;
  if (max_seconds == 0 || max_seconds > RETRY_BUFFER_SECONDS) max_seconds = RETRY_BUFFER_SECONDS;
  size_t input_count = s_sample_count;
  size_t maximum = (size_t)max_seconds * LANTERN_MIC_SAMPLE_RATE;
  if (input_count > maximum) input_count = maximum;
  size_t first = s_sample_count - input_count;
  size_t output_count = input_count * 3 / 2;
  if (xSemaphoreTake(s_speaker_lock, pdMS_TO_TICKS(500)) != pdTRUE) return 0;
  if (speaker_start_silent() != ESP_OK) {
    xSemaphoreGive(s_speaker_lock);
    return 0;
  }
  int32_t output[AUDIO_WRITE_SAMPLES];
  for (size_t output_offset = 0; output_offset < output_count;) {
    size_t chunk = output_count - output_offset;
    if (chunk > AUDIO_WRITE_SAMPLES) chunk = AUDIO_WRITE_SAMPLES;
    for (size_t index = 0; index < chunk; ++index) {
      size_t input_index = first + ((output_offset + index) * 2 / 3);
      output[index] = (int32_t)buffered_sample(input_index) * 32768;
    }
    size_t bytes_written = 0;
    i2s_channel_write(s_speaker, output, chunk * sizeof(output[0]), &bytes_written, pdMS_TO_TICKS(200));
    output_offset += chunk;
  }
  speaker_stop_silent();
  xSemaphoreGive(s_speaker_lock);
  unsigned played = (unsigned)(input_count / LANTERN_MIC_SAMPLE_RATE);
  ESP_LOGI(TAG, "played %u seconds from microphone retry buffer", played);
  return played;
}
