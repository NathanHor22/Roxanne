#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

typedef struct {
  bool present;
  bool mounted;
  uint64_t capacity_bytes;
  uint64_t free_bytes;
  uint32_t sector_size;
  char name[8];
} lantern_sd_status_t;

// Mounts a FAT16/FAT32 card without formatting it. Calling this again is safe;
// recording_begin also retries the mount so a card inserted after boot is used.
esp_err_t lantern_sd_init(lantern_sd_status_t *status);
void lantern_sd_get_status(lantern_sd_status_t *status);

// Streams canonical 16 kHz mono, signed 16-bit PCM into a temporary file. The
// finished file is made visible only after its WAV header and data are synced.
esp_err_t lantern_sd_recording_begin(const char *session_id);
void lantern_sd_recording_write(const int16_t *samples, size_t count);
esp_err_t lantern_sd_recording_finish(void);
void lantern_sd_recording_abort(void);

bool lantern_sd_recording_ready(void);
const char *lantern_sd_recording_path(void);
size_t lantern_sd_recording_size(void);

// Removes the finalized local file only after the cloud accepted every chunk.
esp_err_t lantern_sd_recording_confirm_uploaded(void);
