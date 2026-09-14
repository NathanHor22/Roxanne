import assert from "node:assert/strict";
import test from "node:test";

import { commandReply, interpretDeviceCommand } from "../lib/device-command";

test("recognises ready-state voice commands in English and Malaysian phrasing", () => {
  assert.equal(
    interpretDeviceCommand("Ring, we're talking now. Start recording.", "ready"),
    "start_recording",
  );
  assert.equal(
    interpretDeviceCommand("Lantern, mula rakam meeting sekarang", "ready"),
    "start_recording",
  );
  assert.equal(
    interpretDeviceCommand("Ring status report for today", "ready"),
    "status_report",
  );
  assert.equal(
    interpretDeviceCommand("Lantern, laporan hari ini", "ready"),
    "status_report",
  );
  assert.equal(
    interpretDeviceCommand("Ring, we're done. Stop recording.", "ready"),
    "stop_recording",
  );
});

test("the oath unlocks a status report without requiring an exact recitation", () => {
  assert.equal(
    interpretDeviceCommand(
      "In brightest day, in blackest night, no evil shall escape my sight. Beware my power, Green Lantern's light.",
      "ready",
    ),
    "status_report",
  );
});

test("consent is explicit and a negative answer wins", () => {
  assert.equal(interpretDeviceCommand("Yes, saya setuju", "consent"), "consent_yes");
  assert.equal(interpretDeviceCommand("No, jangan record", "consent"), "consent_no");
  assert.equal(interpretDeviceCommand("Maybe later", "consent"), "unknown");
  assert.match(commandReply("start_recording"), /consent/iu);
});
