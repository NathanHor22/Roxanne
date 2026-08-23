idf_component_register(
  SRCS "main.c" "freertos_compat.c"
  INCLUDE_DIRS "."
  REQUIRES
    agora_iot_sdk
    driver
    esp_event
    esp_http_client
    esp_netif
    esp_timer
    esp_wifi
    json
    mbedtls
    nvs_flash
)

target_link_libraries(${COMPONENT_LIB} INTERFACE "-u xTaskCreateRestrictedPinnedToCore")
