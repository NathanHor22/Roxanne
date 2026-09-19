#include "lantern_board_io.h"

#include "driver/gpio.h"
#include "driver/i2c.h"
#include "driver/i2s_std.h"
#include "esp_check.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_log.h"
#include "es8311_codec.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "lantern_board.h"

#if CONFIG_LANTERN_BOARD_ES3C28P

static const char *TAG = "lantern_board_io";

#define BOARD_I2C_PORT I2C_NUM_0

static bool s_i2c_ready;
static bool s_touch_ready;
static esp_codec_dev_handle_t s_codec;

static esp_err_t read_registers(uint8_t address, uint8_t reg, void *data, size_t length) {
  return i2c_master_write_read_device(
    BOARD_I2C_PORT, address, &reg, 1, data, length, pdMS_TO_TICKS(100));
}

esp_err_t lantern_board_i2c_init(void) {
  if (s_i2c_ready) return ESP_OK;
  i2c_config_t config = {
    .mode = I2C_MODE_MASTER,
    .sda_io_num = LANTERN_I2C_SDA_GPIO,
    .scl_io_num = LANTERN_I2C_SCL_GPIO,
    .sda_pullup_en = GPIO_PULLUP_ENABLE,
    .scl_pullup_en = GPIO_PULLUP_ENABLE,
    .master.clk_speed = 400000,
    .clk_flags = 0,
  };
  ESP_RETURN_ON_ERROR(i2c_param_config(BOARD_I2C_PORT, &config), TAG, "I2C config failed");
  esp_err_t result = i2c_driver_install(BOARD_I2C_PORT, config.mode, 0, 0, 0);
  if (result != ESP_OK && result != ESP_ERR_INVALID_STATE) return result;
  s_i2c_ready = true;
  ESP_LOGI(TAG, "shared touch/audio I2C ready on SDA=%d SCL=%d",
    LANTERN_I2C_SDA_GPIO, LANTERN_I2C_SCL_GPIO);
  return ESP_OK;
}

esp_err_t lantern_board_audio_codec_init(void *tx_handle, void *rx_handle) {
  ESP_RETURN_ON_FALSE(tx_handle && rx_handle, ESP_ERR_INVALID_ARG, TAG, "I2S handles missing");
  ESP_RETURN_ON_ERROR(lantern_board_i2c_init(), TAG, "I2C unavailable");
  gpio_config_t amplifier = {
    .pin_bit_mask = 1ULL << LANTERN_AUDIO_AMP_ENABLE_GPIO,
    .mode = GPIO_MODE_OUTPUT,
  };
  ESP_RETURN_ON_ERROR(gpio_config(&amplifier), TAG, "amplifier GPIO failed");
  gpio_set_level(LANTERN_AUDIO_AMP_ENABLE_GPIO, 1);

  audio_codec_i2c_cfg_t control_config = {
    .port = BOARD_I2C_PORT,
    // esp_codec_dev uses the ES8311's 8-bit wire address (0x18 << 1).
    .addr = ES8311_CODEC_DEFAULT_ADDR,
    .bus_handle = NULL,
  };
  const audio_codec_ctrl_if_t *control = audio_codec_new_i2c_ctrl(&control_config);
  const audio_codec_gpio_if_t *gpio = audio_codec_new_gpio();
  audio_codec_i2s_cfg_t data_config = {
    .port = I2S_NUM_0,
    .rx_handle = rx_handle,
    .tx_handle = tx_handle,
    .clk_src = 0,
  };
  const audio_codec_data_if_t *data = audio_codec_new_i2s_data(&data_config);
  ESP_RETURN_ON_FALSE(control && gpio && data, ESP_ERR_NO_MEM, TAG, "codec interfaces unavailable");

  es8311_codec_cfg_t codec_config = {
    .ctrl_if = control,
    .gpio_if = gpio,
    .codec_mode = ESP_CODEC_DEV_WORK_MODE_BOTH,
    .pa_pin = LANTERN_AUDIO_AMP_ENABLE_GPIO,
    .pa_reverted = true,
    .master_mode = false,
    .use_mclk = true,
    .digital_mic = false,
    .invert_mclk = false,
    .invert_sclk = false,
    .hw_gain = {
      .pa_voltage = 5.0f,
      .codec_dac_voltage = 3.3f,
    },
    .no_dac_ref = false,
    .mclk_div = 256,
  };
  const audio_codec_if_t *codec = es8311_codec_new(&codec_config);
  ESP_RETURN_ON_FALSE(codec, ESP_FAIL, TAG, "ES8311 interface failed");
  esp_codec_dev_cfg_t device_config = {
    .dev_type = ESP_CODEC_DEV_TYPE_IN_OUT,
    .codec_if = codec,
    .data_if = data,
  };
  s_codec = esp_codec_dev_new(&device_config);
  ESP_RETURN_ON_FALSE(s_codec, ESP_ERR_NO_MEM, TAG, "ES8311 device failed");
  esp_codec_dev_sample_info_t format = {
    .bits_per_sample = 16,
    .channel = 1,
    .channel_mask = 0,
    .sample_rate = LANTERN_MIC_SAMPLE_RATE,
    .mclk_multiple = 256,
  };
  int result = esp_codec_dev_open(s_codec, &format);
  ESP_RETURN_ON_FALSE(result == ESP_CODEC_DEV_OK, (esp_err_t)result, TAG, "ES8311 open failed");
  result = esp_codec_dev_set_out_vol(s_codec, 85);
  ESP_RETURN_ON_FALSE(result == ESP_CODEC_DEV_OK, (esp_err_t)result, TAG, "ES8311 volume failed");
  result = esp_codec_dev_set_in_gain(s_codec, 42.0f);
  ESP_RETURN_ON_FALSE(result == ESP_CODEC_DEV_OK, (esp_err_t)result, TAG, "ES8311 microphone gain failed");
  int reset = 0;
  result = esp_codec_dev_read_reg(s_codec, 0x00, &reset);
  ESP_RETURN_ON_FALSE(result == ESP_CODEC_DEV_OK, (esp_err_t)result, TAG, "ES8311 probe failed");
  ESP_LOGI(TAG, "ES8311 capture/playback device open at 16 kHz (reset=0x%02x)", reset);
  return ESP_OK;
}

void lantern_board_speaker_enable(bool enabled) {
  gpio_set_level(LANTERN_AUDIO_AMP_ENABLE_GPIO, enabled ? 0 : 1);
}

esp_err_t lantern_board_touch_init(void) {
  ESP_RETURN_ON_ERROR(lantern_board_i2c_init(), TAG, "I2C unavailable");
  gpio_config_t reset = {
    .pin_bit_mask = 1ULL << LANTERN_TOUCH_RESET_GPIO,
    .mode = GPIO_MODE_OUTPUT,
  };
  gpio_config_t interrupt = {
    .pin_bit_mask = 1ULL << LANTERN_TOUCH_INTERRUPT_GPIO,
    .mode = GPIO_MODE_INPUT,
    .pull_up_en = GPIO_PULLUP_ENABLE,
  };
  ESP_RETURN_ON_ERROR(gpio_config(&reset), TAG, "touch reset GPIO failed");
  ESP_RETURN_ON_ERROR(gpio_config(&interrupt), TAG, "touch interrupt GPIO failed");
  gpio_set_level(LANTERN_TOUCH_RESET_GPIO, 0);
  vTaskDelay(pdMS_TO_TICKS(10));
  gpio_set_level(LANTERN_TOUCH_RESET_GPIO, 1);
  vTaskDelay(pdMS_TO_TICKS(300));
  uint8_t touches = 0;
  ESP_RETURN_ON_ERROR(
    read_registers(LANTERN_TOUCH_I2C_ADDRESS, 0x02, &touches, 1), TAG, "FT6336G probe failed");
  s_touch_ready = true;
  ESP_LOGI(TAG, "FT6336G touch ready");
  return ESP_OK;
}

bool lantern_board_touch_read(uint16_t *x, uint16_t *y) {
  if (!s_touch_ready || !x || !y) return false;
  uint8_t data[5] = {0};
  if (read_registers(LANTERN_TOUCH_I2C_ADDRESS, 0x02, data, sizeof(data)) != ESP_OK) return false;
  if (data[0] == 0 || data[0] > 2) return false;
  *x = (uint16_t)(((data[1] & 0x0f) << 8) | data[2]);
  *y = (uint16_t)(((data[3] & 0x0f) << 8) | data[4]);
  return *x < LANTERN_DISPLAY_WIDTH && *y < LANTERN_DISPLAY_HEIGHT;
}

#else

esp_err_t lantern_board_i2c_init(void) { return ESP_ERR_NOT_SUPPORTED; }
esp_err_t lantern_board_audio_codec_init(void *tx_handle, void *rx_handle) {
  (void)tx_handle;
  (void)rx_handle;
  return ESP_OK;
}
void lantern_board_speaker_enable(bool enabled) { (void)enabled; }
esp_err_t lantern_board_touch_init(void) { return ESP_ERR_NOT_SUPPORTED; }
bool lantern_board_touch_read(uint16_t *x, uint16_t *y) {
  (void)x;
  (void)y;
  return false;
}

#endif
