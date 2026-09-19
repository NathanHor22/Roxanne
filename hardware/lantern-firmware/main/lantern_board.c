#include "lantern_board.h"

static const lantern_board_profile_t PROFILE = {
  .id = LANTERN_BOARD_ID,
  .model = LANTERN_MODEL,
  .storage_kind = LANTERN_STORAGE_KIND,
  .has_sd_card = LANTERN_HAS_SD_CARD,
  .has_touchscreen = LANTERN_HAS_TOUCHSCREEN,
  .has_physical_buttons = LANTERN_HAS_PHYSICAL_BUTTONS,
  .has_battery_monitor = LANTERN_HAS_BATTERY_MONITOR,
};

const lantern_board_profile_t *lantern_board_profile(void) {
  return &PROFILE;
}
