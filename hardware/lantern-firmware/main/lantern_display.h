#pragma once

#include "esp_err.h"

typedef enum {
  LANTERN_SCREEN_BOOTING,
  LANTERN_SCREEN_SETUP,
  LANTERN_SCREEN_CONNECTING,
  LANTERN_SCREEN_READY,
  LANTERN_SCREEN_CONSENT,
  LANTERN_SCREEN_RECORDING,
  LANTERN_SCREEN_SAVED,
  LANTERN_SCREEN_STATUS,
  LANTERN_SCREEN_PAIRED,
  LANTERN_SCREEN_ERROR,
} lantern_screen_t;

esp_err_t lantern_display_init(void);
void lantern_display_show(lantern_screen_t screen, const char *detail);
