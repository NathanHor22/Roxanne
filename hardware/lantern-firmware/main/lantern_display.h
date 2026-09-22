#pragma once

#include "esp_err.h"

typedef enum {
  LANTERN_SCREEN_BOOTING,
  LANTERN_SCREEN_SETUP,
  LANTERN_SCREEN_CONNECTING,
  LANTERN_SCREEN_READY,
  LANTERN_SCREEN_LISTENING,
  LANTERN_SCREEN_UNDERSTANDING,
  LANTERN_SCREEN_CONSENT,
  LANTERN_SCREEN_RECORDING,
  LANTERN_SCREEN_SAVING,
  LANTERN_SCREEN_COMPLETE,
  LANTERN_SCREEN_STATUS,
  LANTERN_SCREEN_ERROR,
} lantern_screen_t;

esp_err_t lantern_display_init(void);
// Non-blocking, task-context only; copies detail and coalesces pending updates.
void lantern_display_show(lantern_screen_t screen, const char *detail);
