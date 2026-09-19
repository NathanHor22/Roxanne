#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

esp_err_t lantern_board_i2c_init(void);
esp_err_t lantern_board_audio_codec_init(void *tx_handle, void *rx_handle);
void lantern_board_speaker_enable(bool enabled);
esp_err_t lantern_board_touch_init(void);
bool lantern_board_touch_read(uint16_t *x, uint16_t *y);
