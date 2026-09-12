#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/* The prebuilt Agora SDK expects the ESP-IDF 5.3 restricted-task symbol.
 * ESP32-S3 has no MPU, so the equivalent pinned task is appropriate here. */
BaseType_t xTaskCreateRestrictedPinnedToCore(
    const TaskParameters_t *const definition,
    TaskHandle_t *created_task,
    const BaseType_t core_id) {
  return xTaskCreatePinnedToCore(
      definition->pvTaskCode,
      definition->pcName,
      definition->usStackDepth,
      definition->pvParameters,
      definition->uxPriority,
      created_task,
      core_id);
}
