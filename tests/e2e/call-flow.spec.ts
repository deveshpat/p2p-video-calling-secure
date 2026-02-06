import { test } from "@playwright/test";

test.skip(
  "real browser peer-to-peer call flow",
  "Skipped in automated CI because true direct WebRTC pairing without STUN/TURN is highly environment-dependent.",
);
