#include "lantern_display.h"

#include <ctype.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "lantern_board.h"

static const char *TAG = "lantern_display";
static esp_lcd_panel_handle_t s_panel;
static uint16_t *s_pixels;
static SemaphoreHandle_t s_lock;

static uint16_t rgb565(uint8_t red, uint8_t green, uint8_t blue) {
  return (uint16_t)(((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >> 3));
}

static void pixel(int x, int y, uint16_t color) {
  if (!s_pixels || x < 0 || y < 0 || x >= LANTERN_DISPLAY_WIDTH || y >= LANTERN_DISPLAY_HEIGHT) return;
  s_pixels[y * LANTERN_DISPLAY_WIDTH + x] = color;
}

static void fill(uint16_t color) {
  if (!s_pixels) return;
  for (size_t index = 0; index < LANTERN_DISPLAY_WIDTH * LANTERN_DISPLAY_HEIGHT; ++index) {
    s_pixels[index] = color;
  }
}

static void rect(int x, int y, int width, int height, uint16_t color) {
  for (int row = y; row < y + height; ++row) {
    for (int column = x; column < x + width; ++column) pixel(column, row, color);
  }
}

static void ring(int center_x, int center_y, int outer_radius, int thickness, uint16_t color) {
  const int outer = outer_radius * outer_radius;
  const int inner_radius = outer_radius - thickness;
  const int inner = inner_radius * inner_radius;
  for (int y = -outer_radius; y <= outer_radius; ++y) {
    for (int x = -outer_radius; x <= outer_radius; ++x) {
      int distance = x * x + y * y;
      if (distance <= outer && distance >= inner) pixel(center_x + x, center_y + y, color);
    }
  }
}

static const uint8_t *glyph(char raw) {
  static const uint8_t space[5] = {0, 0, 0, 0, 0};
  static const uint8_t dash[5] = {0x08, 0x08, 0x08, 0x08, 0x08};
  static const uint8_t dot[5] = {0, 0x60, 0x60, 0, 0};
  static const uint8_t colon[5] = {0, 0x36, 0x36, 0, 0};
  static const uint8_t slash[5] = {0x20, 0x10, 0x08, 0x04, 0x02};
  static const uint8_t digits[10][5] = {
    {0x3e, 0x51, 0x49, 0x45, 0x3e}, {0x00, 0x42, 0x7f, 0x40, 0x00},
    {0x42, 0x61, 0x51, 0x49, 0x46}, {0x21, 0x41, 0x45, 0x4b, 0x31},
    {0x18, 0x14, 0x12, 0x7f, 0x10}, {0x27, 0x45, 0x45, 0x45, 0x39},
    {0x3c, 0x4a, 0x49, 0x49, 0x30}, {0x01, 0x71, 0x09, 0x05, 0x03},
    {0x36, 0x49, 0x49, 0x49, 0x36}, {0x06, 0x49, 0x49, 0x29, 0x1e},
  };
  static const uint8_t letters[26][5] = {
    {0x7e, 0x11, 0x11, 0x11, 0x7e}, {0x7f, 0x49, 0x49, 0x49, 0x36},
    {0x3e, 0x41, 0x41, 0x41, 0x22}, {0x7f, 0x41, 0x41, 0x22, 0x1c},
    {0x7f, 0x49, 0x49, 0x49, 0x41}, {0x7f, 0x09, 0x09, 0x09, 0x01},
    {0x3e, 0x41, 0x49, 0x49, 0x7a}, {0x7f, 0x08, 0x08, 0x08, 0x7f},
    {0x00, 0x41, 0x7f, 0x41, 0x00}, {0x20, 0x40, 0x41, 0x3f, 0x01},
    {0x7f, 0x08, 0x14, 0x22, 0x41}, {0x7f, 0x40, 0x40, 0x40, 0x40},
    {0x7f, 0x02, 0x0c, 0x02, 0x7f}, {0x7f, 0x04, 0x08, 0x10, 0x7f},
    {0x3e, 0x41, 0x41, 0x41, 0x3e}, {0x7f, 0x09, 0x09, 0x09, 0x06},
    {0x3e, 0x41, 0x51, 0x21, 0x5e}, {0x7f, 0x09, 0x19, 0x29, 0x46},
    {0x46, 0x49, 0x49, 0x49, 0x31}, {0x01, 0x01, 0x7f, 0x01, 0x01},
    {0x3f, 0x40, 0x40, 0x40, 0x3f}, {0x1f, 0x20, 0x40, 0x20, 0x1f},
    {0x3f, 0x40, 0x38, 0x40, 0x3f}, {0x63, 0x14, 0x08, 0x14, 0x63},
    {0x07, 0x08, 0x70, 0x08, 0x07}, {0x61, 0x51, 0x49, 0x45, 0x43},
  };
  char value = (char)toupper((unsigned char)raw);
  if (value >= 'A' && value <= 'Z') return letters[value - 'A'];
  if (value >= '0' && value <= '9') return digits[value - '0'];
  if (value == '-') return dash;
  if (value == '.') return dot;
  if (value == ':') return colon;
  if (value == '/') return slash;
  return space;
}

static int text_width(const char *text, int scale) {
  return text ? (int)strlen(text) * 6 * scale - scale : 0;
}

static void draw_text(int x, int y, const char *text, int scale, uint16_t color) {
  if (!text) return;
  for (; *text; ++text) {
    const uint8_t *columns = glyph(*text);
    for (int column = 0; column < 5; ++column) {
      for (int row = 0; row < 7; ++row) {
        if (columns[column] & (1U << row)) rect(x + column * scale, y + row * scale, scale, scale, color);
      }
    }
    x += 6 * scale;
  }
}

static void centered_text(int y, const char *text, int scale, uint16_t color) {
  int x = (LANTERN_DISPLAY_WIDTH - text_width(text, scale)) / 2;
  draw_text(x < 0 ? 0 : x, y, text, scale, color);
}

esp_err_t lantern_display_init(void) {
  gpio_config_t backlight = {
    .pin_bit_mask = 1ULL << LANTERN_DISPLAY_BACKLIGHT_GPIO,
    .mode = GPIO_MODE_OUTPUT,
  };
  ESP_ERROR_CHECK(gpio_config(&backlight));
  gpio_set_level(LANTERN_DISPLAY_BACKLIGHT_GPIO, 0);

  spi_bus_config_t bus = {
    .mosi_io_num = LANTERN_DISPLAY_MOSI_GPIO,
    .miso_io_num = GPIO_NUM_NC,
    .sclk_io_num = LANTERN_DISPLAY_SCLK_GPIO,
    .quadwp_io_num = GPIO_NUM_NC,
    .quadhd_io_num = GPIO_NUM_NC,
    .max_transfer_sz = LANTERN_DISPLAY_WIDTH * LANTERN_DISPLAY_HEIGHT * sizeof(uint16_t),
  };
  ESP_RETURN_ON_ERROR(spi_bus_initialize(SPI3_HOST, &bus, SPI_DMA_CH_AUTO), TAG, "SPI init failed");

  esp_lcd_panel_io_handle_t panel_io = NULL;
  esp_lcd_panel_io_spi_config_t io = {
    .cs_gpio_num = LANTERN_DISPLAY_CS_GPIO,
    .dc_gpio_num = LANTERN_DISPLAY_DC_GPIO,
    .spi_mode = 3,
    .pclk_hz = 40 * 1000 * 1000,
    .trans_queue_depth = 4,
    .lcd_cmd_bits = 8,
    .lcd_param_bits = 8,
  };
  ESP_RETURN_ON_ERROR(
    esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)SPI3_HOST, &io, &panel_io),
    TAG,
    "panel IO failed");

  esp_lcd_panel_dev_config_t panel_config = {
    .reset_gpio_num = LANTERN_DISPLAY_RESET_GPIO,
    .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
    // The framebuffer contains native ESP32 little-endian RGB565 words. Without
    // this RAMCTRL setting, the ST7789 interprets Lantern green as purple.
    .data_endian = LCD_RGB_DATA_ENDIAN_LITTLE,
    .bits_per_pixel = 16,
  };
  ESP_RETURN_ON_ERROR(esp_lcd_new_panel_st7789(panel_io, &panel_config, &s_panel), TAG, "panel failed");
  ESP_ERROR_CHECK(esp_lcd_panel_reset(s_panel));
  ESP_ERROR_CHECK(esp_lcd_panel_init(s_panel));
  ESP_ERROR_CHECK(esp_lcd_panel_swap_xy(s_panel, false));
  ESP_ERROR_CHECK(esp_lcd_panel_mirror(s_panel, false, false));
  ESP_ERROR_CHECK(esp_lcd_panel_invert_color(s_panel, true));
  ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(s_panel, true));

  s_pixels = heap_caps_malloc(
    LANTERN_DISPLAY_WIDTH * LANTERN_DISPLAY_HEIGHT * sizeof(uint16_t),
    MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_pixels) {
    s_pixels = heap_caps_malloc(
      LANTERN_DISPLAY_WIDTH * LANTERN_DISPLAY_HEIGHT * sizeof(uint16_t),
      MALLOC_CAP_DMA | MALLOC_CAP_8BIT);
  }
  if (!s_pixels) return ESP_ERR_NO_MEM;
  s_lock = xSemaphoreCreateMutex();
  if (!s_lock) return ESP_ERR_NO_MEM;
  gpio_set_level(LANTERN_DISPLAY_BACKLIGHT_GPIO, 1);
  lantern_display_show(LANTERN_SCREEN_BOOTING, "HARDWARE CHECK");
  ESP_LOGI(TAG, "ST7789 ready at 240x240");
  return ESP_OK;
}

void lantern_display_show(lantern_screen_t screen, const char *detail) {
  if (!s_pixels || !s_panel || !s_lock) return;
  if (xSemaphoreTake(s_lock, pdMS_TO_TICKS(1000)) != pdTRUE) return;

  const uint16_t background = rgb565(2, 8, 7);
  const uint16_t green = rgb565(48, 255, 136);
  const uint16_t dim_green = rgb565(18, 92, 58);
  const uint16_t white = rgb565(226, 244, 235);
  const uint16_t amber = rgb565(255, 184, 72);
  const uint16_t red = rgb565(255, 78, 86);
  uint16_t accent = green;
  const char *title = "LANTERN";
  const char *status = "BOOTING";

  switch (screen) {
    case LANTERN_SCREEN_SETUP: status = "WIFI SETUP"; accent = amber; break;
    case LANTERN_SCREEN_CONNECTING: status = "CONNECTING"; accent = amber; break;
    case LANTERN_SCREEN_READY: status = "READY"; break;
    case LANTERN_SCREEN_CONSENT: status = "CONSENT"; accent = amber; break;
    case LANTERN_SCREEN_RECORDING: status = "RECORDING"; accent = red; break;
    case LANTERN_SCREEN_SAVED: status = "CLIP SAVED"; break;
    case LANTERN_SCREEN_STATUS: status = "STATUS REPORT"; break;
    case LANTERN_SCREEN_PAIRED: status = "PAIRED"; break;
    case LANTERN_SCREEN_ERROR: status = "ERROR"; accent = red; break;
    case LANTERN_SCREEN_BOOTING: default: break;
  }

  fill(background);
  ring(120, 92, 51, 9, dim_green);
  ring(120, 92, 38, 5, accent);
  rect(86, 48, 68, 8, accent);
  rect(86, 128, 68, 8, accent);
  centered_text(12, title, 3, white);
  centered_text(162, status, 2, accent);
  if (detail && detail[0]) centered_text(202, detail, 1, white);

  esp_err_t result = esp_lcd_panel_draw_bitmap(
    s_panel, 0, 0, LANTERN_DISPLAY_WIDTH, LANTERN_DISPLAY_HEIGHT, s_pixels);
  if (result != ESP_OK) ESP_LOGE(TAG, "draw failed: %s", esp_err_to_name(result));
  xSemaphoreGive(s_lock);
}
