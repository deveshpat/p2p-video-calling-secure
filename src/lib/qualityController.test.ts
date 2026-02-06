import { describe, expect, it } from "vitest";
import { QualityState } from "../types/contracts";
import { QualityController } from "./qualityController";

describe("qualityController", () => {
  it("degrades quality on bad network", () => {
    const controller = new QualityController();

    const firstDecision = controller.evaluate({
      packetLossPct: 8,
      rttMs: 260,
      jitterMs: 35,
    });

    expect(firstDecision.changed).toBe(true);
    expect(firstDecision.nextState).toBe(QualityState.HD_720);

    const secondDecision = controller.evaluate({
      packetLossPct: 8,
      rttMs: 260,
      jitterMs: 35,
    });
    expect(secondDecision.changed).toBe(true);
    expect(secondDecision.nextState).toBe(QualityState.SD_480);
  });

  it("recovers after stable good network samples", () => {
    const controller = new QualityController();
    controller.forceState(QualityState.SD_480);

    for (let index = 0; index < 7; index += 1) {
      const decision = controller.evaluate({
        packetLossPct: 0.8,
        rttMs: 70,
        jitterMs: 5,
      });
      expect(decision.changed).toBe(false);
    }

    const recoveryDecision = controller.evaluate({
      packetLossPct: 0.8,
      rttMs: 70,
      jitterMs: 5,
    });
    expect(recoveryDecision.changed).toBe(true);
    expect(recoveryDecision.nextState).toBe(QualityState.RECOVERING);
  });
});
