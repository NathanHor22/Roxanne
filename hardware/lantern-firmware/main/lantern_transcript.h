#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"

esp_err_t lantern_transcript_init(void);
void lantern_transcript_reset(void);
bool lantern_transcript_append(const void *packet, size_t length);
const void *lantern_transcript_data(void);
size_t lantern_transcript_size(void);
unsigned lantern_transcript_packet_count(void);
