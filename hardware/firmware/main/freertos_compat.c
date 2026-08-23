#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/* Agora's current ESP32 binary expects the IDF 5.3 restricted-task symbol.
 * ESP32-S3 has no MPU, so creating the equivalent pinned task is correct. */
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
