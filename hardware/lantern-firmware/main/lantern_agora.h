#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "lantern_network.h"

esp_err_t lantern_agora_start(const lantern_agora_transport_t *transport);
void lantern_agora_stop(void);
bool lantern_agora_is_connected(void);
bool lantern_agora_take_stop_command(void);
