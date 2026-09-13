#pragma once

#include "secrets.h"

#define LANTERN_API_BASE_URL "https://roxanne-two.vercel.app"
#define LANTERN_DEVICE_ID "561bc32e-df1a-4b00-9f46-ef08cf2df9b9"
#define LANTERN_LANGUAGE "en-US"
#define LANTERN_LOCALE "en"

// zhengchen-1.54tft-ml307 ESP32-S3 pin map recovered from its official source.
#define LANTERN_BUTTON_GPIO 0
#define LANTERN_STATUS_GPIO 20

#define LANTERN_MIC_WS_GPIO 4
#define LANTERN_MIC_SCK_GPIO 5
#define LANTERN_MIC_DATA_GPIO 6
#define LANTERN_MIC_SAMPLE_RATE 16000

#define LANTERN_SPK_DATA_GPIO 7
#define LANTERN_SPK_BCLK_GPIO 15
#define LANTERN_SPK_LRCK_GPIO 16
#define LANTERN_RTC_SAMPLE_RATE 8000
