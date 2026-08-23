#pragma once

#include "secrets.h"

#define ROXANNE_API_BASE_URL "https://roxanne-assistant.vercel.app"
#define ROXANNE_DEVICE_ID "561bc32e-df1a-4b00-9f46-ef08cf2df9b9"
#define ROXANNE_LANGUAGE "en-US"
#define ROXANNE_LOCALE "en"

// zhengchen-1.54tft-ml307 ESP32-S3 pin map recovered from its official source.
#define ROXANNE_BUTTON_GPIO 0
#define ROXANNE_STATUS_GPIO 20

#define ROXANNE_MIC_WS_GPIO 4
#define ROXANNE_MIC_SCK_GPIO 5
#define ROXANNE_MIC_DATA_GPIO 6
#define ROXANNE_MIC_SAMPLE_RATE 16000

#define ROXANNE_SPK_DATA_GPIO 7
#define ROXANNE_SPK_BCLK_GPIO 15
#define ROXANNE_SPK_LRCK_GPIO 16
#define ROXANNE_RTC_SAMPLE_RATE 8000
