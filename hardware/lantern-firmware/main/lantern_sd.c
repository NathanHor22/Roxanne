#include "lantern_sd.h"

#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "driver/sdmmc_host.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_vfs_fat.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/stream_buffer.h"
#include "freertos/task.h"
#include "sdmmc_cmd.h"

#include "lantern_board.h"

#if LANTERN_HAS_SD_CARD
#define SD_MOUNT_POINT "/sdcard"
#define SD_RECORDING_DIRECTORY SD_MOUNT_POINT "/lantern"
#define SD_WRITE_BUFFER_BYTES (128 * 1024)
#define SD_WRITE_BLOCK_BYTES (16 * 1024)

static const char *TAG = "lantern_sd";
static lantern_sd_status_t s_status;
static sdmmc_card_t *s_card;
static FILE *s_file;
static char s_temporary_path[96];
static char s_recording_path[96];
static size_t s_pcm_bytes;
static size_t s_last_sync_bytes;
static size_t s_recording_bytes;
static volatile bool s_accepting;
static volatile bool s_finish_requested;
static volatile bool s_writer_failed;
static StreamBufferHandle_t s_write_stream;
static StaticStreamBuffer_t s_write_stream_state;
static uint8_t *s_write_stream_storage;
static SemaphoreHandle_t s_writer_finished;
static TaskHandle_t s_writer_task;

static void log_directory_contents(const char *directory) {
  DIR *handle = opendir(directory);
  if (!handle) {
    ESP_LOGW(TAG, "SD inventory could not open %s (errno=%d)", directory, errno);
    return;
  }

  unsigned entries = 0;
  bool truncated = false;
  struct dirent *entry;
  while ((entry = readdir(handle)) != NULL) {
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    if (entries >= 100) {
      truncated = true;
      break;
    }

    char path[256];
    int length = snprintf(path, sizeof(path), "%s/%s", directory, entry->d_name);
    struct stat information;
    if (length < 0 || length >= (int)sizeof(path) || stat(path, &information) != 0) {
      ESP_LOGI(TAG, "SD entry parent=%s name=%s type=unknown", directory, entry->d_name);
    } else if (S_ISDIR(information.st_mode)) {
      ESP_LOGI(TAG, "SD entry parent=%s name=%s type=directory", directory, entry->d_name);
    } else {
      ESP_LOGI(TAG, "SD entry parent=%s name=%s type=file bytes=%llu", directory,
        entry->d_name, (unsigned long long)information.st_size);
    }
    entries++;
  }
  closedir(handle);
  ESP_LOGI(TAG, "SD inventory path=%s entries=%u%s", directory, entries,
    truncated ? " (first 100 shown)" : "");
}

static void wav_u16(uint8_t *output, uint16_t value) {
  output[0] = (uint8_t)value;
  output[1] = (uint8_t)(value >> 8);
}

static void wav_u32(uint8_t *output, uint32_t value) {
  output[0] = (uint8_t)value;
  output[1] = (uint8_t)(value >> 8);
  output[2] = (uint8_t)(value >> 16);
  output[3] = (uint8_t)(value >> 24);
}

static void build_wav_header(uint8_t header[44], size_t pcm_bytes) {
  memset(header, 0, 44);
  memcpy(header, "RIFF", 4);
  wav_u32(header + 4, 36 + (uint32_t)pcm_bytes);
  memcpy(header + 8, "WAVEfmt ", 8);
  wav_u32(header + 16, 16);
  wav_u16(header + 20, 1);
  wav_u16(header + 22, 1);
  wav_u32(header + 24, LANTERN_MIC_SAMPLE_RATE);
  wav_u32(header + 28, LANTERN_MIC_SAMPLE_RATE * 2);
  wav_u16(header + 32, 2);
  wav_u16(header + 34, 16);
  memcpy(header + 36, "data", 4);
  wav_u32(header + 40, (uint32_t)pcm_bytes);
}

static void refresh_space(void) {
  uint64_t filesystem_bytes = 0;
  if (s_status.mounted &&
      esp_vfs_fat_info(SD_MOUNT_POINT, &filesystem_bytes, &s_status.free_bytes) == ESP_OK &&
      filesystem_bytes) {
    s_status.capacity_bytes = filesystem_bytes;
  }
}

static void close_active_file(void) {
  if (!s_file) return;
  fclose(s_file);
  s_file = NULL;
}

static void unmount_card(void) {
  close_active_file();
  if (s_status.mounted && s_card) {
    esp_vfs_fat_sdcard_unmount(SD_MOUNT_POINT, s_card);
  }
  s_card = NULL;
  s_status.mounted = false;
}

static esp_err_t ensure_writer(void);

static esp_err_t mount_card(void) {
  if (s_status.mounted) {
    refresh_space();
    return ESP_OK;
  }

  sdmmc_host_t host = SDMMC_HOST_DEFAULT();
  // One-bit SDIO at 10 MHz is well above Lantern's 32 KB/s PCM stream and
  // leaves generous signal margin on the integrated prototype slot.
  host.max_freq_khz = 10000;
  sdmmc_slot_config_t slot = SDMMC_SLOT_CONFIG_DEFAULT();
  slot.width = 1;
  slot.clk = LANTERN_SD_CLK_GPIO;
  slot.cmd = LANTERN_SD_CMD_GPIO;
  slot.d0 = LANTERN_SD_D0_GPIO;
  slot.flags |= SDMMC_SLOT_FLAG_INTERNAL_PULLUP;
  const esp_vfs_fat_mount_config_t mount = {
    .format_if_mount_failed = false,
    .max_files = 4,
    .allocation_unit_size = 64 * 1024,
    .disk_status_check_enable = true,
  };

  esp_err_t result = esp_vfs_fat_sdmmc_mount(
    SD_MOUNT_POINT, &host, &slot, &mount, &s_card);
  if (result != ESP_OK) {
    memset(&s_status, 0, sizeof(s_status));
    ESP_LOGW(TAG,
      "microSD could not be mounted (%s); use a FAT32 card, existing data was not changed",
      esp_err_to_name(result));
    return result;
  }

  s_status.present = true;
  s_status.mounted = true;
  s_status.sector_size = s_card->csd.sector_size;
  s_status.capacity_bytes =
    (uint64_t)s_card->csd.capacity * (uint64_t)s_card->csd.sector_size;
  snprintf(s_status.name, sizeof(s_status.name), "%s", s_card->cid.name);
  refresh_space();
  if (mkdir(SD_RECORDING_DIRECTORY, 0775) != 0 && errno != EEXIST) {
    ESP_LOGE(TAG, "could not create %s: errno=%d", SD_RECORDING_DIRECTORY, errno);
    unmount_card();
    return ESP_FAIL;
  }
  ESP_RETURN_ON_ERROR(ensure_writer(), TAG, "SD writer");
  ESP_LOGI(TAG, "microSD mounted name=%s capacity=%llu MiB free=%llu MiB",
    s_status.name[0] ? s_status.name : "unknown",
    s_status.capacity_bytes / (1024ULL * 1024ULL),
    s_status.free_bytes / (1024ULL * 1024ULL));
  log_directory_contents(SD_MOUNT_POINT);
  log_directory_contents(SD_RECORDING_DIRECTORY);
  return ESP_OK;
}

static void finish_file(void) {
  esp_err_t outcome = ESP_OK;
  if (!s_file || s_writer_failed) {
    outcome = ESP_FAIL;
  } else {
    uint8_t header[44];
    build_wav_header(header, s_pcm_bytes);
    if (fflush(s_file) != 0 || fseek(s_file, 0, SEEK_SET) != 0 ||
        fwrite(header, 1, sizeof(header), s_file) != sizeof(header) ||
        fflush(s_file) != 0 || fsync(fileno(s_file)) != 0) {
      outcome = ESP_FAIL;
    }
  }
  close_active_file();
  if (outcome == ESP_OK) {
    remove(s_recording_path);
    if (rename(s_temporary_path, s_recording_path) != 0) outcome = ESP_FAIL;
  }
  if (outcome == ESP_OK) {
    s_recording_bytes = 44 + s_pcm_bytes;
    ESP_LOGI(TAG, "WAV finalized path=%s bytes=%u seconds=%u",
      s_recording_path, (unsigned)s_recording_bytes,
      (unsigned)(s_pcm_bytes / (LANTERN_MIC_SAMPLE_RATE * sizeof(int16_t))));
  } else {
    s_writer_failed = true;
    s_recording_bytes = 0;
    ESP_LOGE(TAG, "microSD recording could not be finalized; temporary file retained");
  }
  refresh_space();
  s_finish_requested = false;
  xSemaphoreGive(s_writer_finished);
}

static void writer_task(void *argument) {
  (void)argument;
  uint8_t *block = heap_caps_malloc(
    SD_WRITE_BLOCK_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!block) {
    ESP_LOGE(TAG, "could not allocate SD writer block");
    vTaskDelete(NULL);
    return;
  }
  while (true) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    while (s_file) {
      size_t received = xStreamBufferReceive(
        s_write_stream, block, SD_WRITE_BLOCK_BYTES, pdMS_TO_TICKS(100));
      if (received) {
        size_t written = fwrite(block, 1, received, s_file);
        s_pcm_bytes += written;
        if (written != received) {
          s_writer_failed = true;
          s_accepting = false;
          ESP_LOGE(TAG, "microSD write failed after %u PCM bytes", (unsigned)s_pcm_bytes);
        } else if (s_pcm_bytes - s_last_sync_bytes >= 1024 * 1024) {
          // Flush about every 32 seconds so a sudden power loss sacrifices at
          // most the newest buffered tail instead of the whole meeting.
          if (fflush(s_file) != 0) {
            s_writer_failed = true;
            s_accepting = false;
            ESP_LOGE(TAG, "microSD periodic flush failed");
          } else {
            s_last_sync_bytes = s_pcm_bytes;
          }
        }
      }
      if (s_finish_requested && xStreamBufferBytesAvailable(s_write_stream) == 0) {
        finish_file();
        break;
      }
      if (!received && !s_finish_requested) break;
    }
  }
}

static esp_err_t ensure_writer(void) {
  if (s_writer_task) return ESP_OK;
  s_write_stream_storage = heap_caps_malloc(
    SD_WRITE_BUFFER_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  s_writer_finished = xSemaphoreCreateBinary();
  if (!s_write_stream_storage || !s_writer_finished) return ESP_ERR_NO_MEM;
  s_write_stream = xStreamBufferCreateStatic(
    SD_WRITE_BUFFER_BYTES, 1, s_write_stream_storage, &s_write_stream_state);
  if (!s_write_stream) return ESP_ERR_NO_MEM;
  if (xTaskCreatePinnedToCore(
        writer_task, "lantern_sd_write", 4096, NULL, 5, &s_writer_task, 0) != pdPASS) {
    s_writer_task = NULL;
    return ESP_ERR_NO_MEM;
  }
  return ESP_OK;
}
#endif

esp_err_t lantern_sd_init(lantern_sd_status_t *status) {
#if !LANTERN_HAS_SD_CARD
  if (status) memset(status, 0, sizeof(*status));
  return ESP_ERR_NOT_SUPPORTED;
#else
  esp_err_t result = mount_card();
  if (status) *status = s_status;
  return result;
#endif
}

void lantern_sd_get_status(lantern_sd_status_t *status) {
  if (!status) return;
#if !LANTERN_HAS_SD_CARD
  memset(status, 0, sizeof(*status));
#else
  refresh_space();
  *status = s_status;
#endif
}

esp_err_t lantern_sd_recording_begin(const char *session_id) {
#if !LANTERN_HAS_SD_CARD
  (void)session_id;
  return ESP_ERR_NOT_SUPPORTED;
#else
  if (!session_id || !session_id[0] || s_file) return ESP_ERR_INVALID_STATE;
  if (mount_card() != ESP_OK) return ESP_FAIL;
  snprintf(s_temporary_path, sizeof(s_temporary_path),
    SD_RECORDING_DIRECTORY "/%.36s.tmp", session_id);
  snprintf(s_recording_path, sizeof(s_recording_path),
    SD_RECORDING_DIRECTORY "/%.36s.wav", session_id);
  remove(s_temporary_path);
  s_file = fopen(s_temporary_path, "wb+");
  if (!s_file) {
    ESP_LOGW(TAG, "opening recording failed; remounting card once (errno=%d)", errno);
    unmount_card();
    if (mount_card() == ESP_OK) s_file = fopen(s_temporary_path, "wb+");
  }
  if (!s_file) return ESP_FAIL;
  uint8_t placeholder[44] = {0};
  if (fwrite(placeholder, 1, sizeof(placeholder), s_file) != sizeof(placeholder)) {
    close_active_file();
    return ESP_FAIL;
  }
  xStreamBufferReset(s_write_stream);
  while (xSemaphoreTake(s_writer_finished, 0) == pdTRUE) {}
  s_pcm_bytes = 0;
  s_last_sync_bytes = 0;
  s_recording_bytes = 0;
  s_writer_failed = false;
  s_finish_requested = false;
  s_accepting = true;
  ESP_LOGI(TAG, "microSD recording opened for session %.36s", session_id);
  return ESP_OK;
#endif
}

void lantern_sd_recording_write(const int16_t *samples, size_t count) {
#if LANTERN_HAS_SD_CARD
  if (!samples || !count || !s_accepting || !s_file || s_writer_failed) return;
  size_t bytes = count * sizeof(int16_t);
  size_t sent = xStreamBufferSend(s_write_stream, samples, bytes, pdMS_TO_TICKS(10));
  if (sent != bytes) {
    s_writer_failed = true;
    s_accepting = false;
    ESP_LOGE(TAG, "microSD writer queue overflowed; local WAV is incomplete");
  }
  xTaskNotifyGive(s_writer_task);
#else
  (void)samples;
  (void)count;
#endif
}

esp_err_t lantern_sd_recording_finish(void) {
#if !LANTERN_HAS_SD_CARD
  return ESP_ERR_NOT_SUPPORTED;
#else
  if (!s_file) return ESP_ERR_INVALID_STATE;
  s_accepting = false;
  s_finish_requested = true;
  xTaskNotifyGive(s_writer_task);
  if (xSemaphoreTake(s_writer_finished, pdMS_TO_TICKS(15000)) != pdTRUE) {
    ESP_LOGE(TAG, "microSD finalization timed out");
    return ESP_ERR_TIMEOUT;
  }
  return s_writer_failed || !s_recording_bytes ? ESP_FAIL : ESP_OK;
#endif
}

void lantern_sd_recording_abort(void) {
#if LANTERN_HAS_SD_CARD
  // An interrupted cloud/session flow must not race the writer or discard
  // audio already captured. Finalize the partial meeting and leave it on-card.
  if (s_file) {
    esp_err_t result = lantern_sd_recording_finish();
    if (result != ESP_OK) {
      ESP_LOGW(TAG, "interrupted SD archive remains as %s", s_temporary_path);
    }
  }
#endif
}

bool lantern_sd_recording_ready(void) {
#if LANTERN_HAS_SD_CARD
  return s_status.mounted && !s_file && !s_writer_failed && s_recording_bytes > 44;
#else
  return false;
#endif
}

const char *lantern_sd_recording_path(void) {
#if LANTERN_HAS_SD_CARD
  return lantern_sd_recording_ready() ? s_recording_path : NULL;
#else
  return NULL;
#endif
}

size_t lantern_sd_recording_size(void) {
#if LANTERN_HAS_SD_CARD
  return lantern_sd_recording_ready() ? s_recording_bytes : 0;
#else
  return 0;
#endif
}

esp_err_t lantern_sd_recording_confirm_uploaded(void) {
#if !LANTERN_HAS_SD_CARD
  return ESP_ERR_NOT_SUPPORTED;
#else
  if (!lantern_sd_recording_ready()) return ESP_ERR_INVALID_STATE;
  if (remove(s_recording_path) != 0) return ESP_FAIL;
  ESP_LOGI(TAG, "cloud confirmed WAV; removed local file %s", s_recording_path);
  s_recording_bytes = 0;
  s_recording_path[0] = '\0';
  refresh_space();
  return ESP_OK;
#endif
}
