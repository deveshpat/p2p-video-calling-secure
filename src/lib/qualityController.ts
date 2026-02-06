import {
  QualityState,
  type QualityDecision,
  type QualitySnapshot,
} from "../types/contracts";

const QUALITY_STEPS: QualityState[] = [
  QualityState.HD_1080,
  QualityState.HD_720,
  QualityState.SD_480,
];

const BAD_PACKET_LOSS_PCT = 5;
const BAD_RTT_MS = 220;
const BAD_JITTER_MS = 30;
const GOOD_PACKET_LOSS_PCT = 2;
const GOOD_RTT_MS = 130;
const GOOD_JITTER_MS = 16;

export class QualityController {
  private qualityState: QualityState = QualityState.HD_1080;

  private stableSampleCount = 0;

  get state(): QualityState {
    return this.qualityState;
  }

  evaluate(snapshot: QualitySnapshot): QualityDecision {
    const badNetwork =
      snapshot.packetLossPct >= BAD_PACKET_LOSS_PCT ||
      snapshot.rttMs >= BAD_RTT_MS ||
      snapshot.jitterMs >= BAD_JITTER_MS;

    if (badNetwork) {
      this.stableSampleCount = 0;
      const currentIndex = QUALITY_STEPS.indexOf(this.qualityState);
      if (currentIndex < QUALITY_STEPS.length - 1) {
        this.qualityState = QUALITY_STEPS[currentIndex + 1];
        return { nextState: this.qualityState, changed: true };
      }
      return { nextState: this.qualityState, changed: false };
    }

    const goodNetwork =
      snapshot.packetLossPct <= GOOD_PACKET_LOSS_PCT &&
      snapshot.rttMs <= GOOD_RTT_MS &&
      snapshot.jitterMs <= GOOD_JITTER_MS;

    if (!goodNetwork) {
      this.stableSampleCount = 0;
      return { nextState: this.qualityState, changed: false };
    }

    this.stableSampleCount += 1;
    if (this.stableSampleCount < 8) {
      return { nextState: this.qualityState, changed: false };
    }

    this.stableSampleCount = 0;
    const currentIndex = QUALITY_STEPS.indexOf(this.qualityState);
    if (currentIndex > 0) {
      this.qualityState = QualityState.RECOVERING;
      return { nextState: this.qualityState, changed: true };
    }

    return { nextState: this.qualityState, changed: false };
  }

  completeRecovery(): QualityDecision {
    if (this.qualityState !== QualityState.RECOVERING) {
      return { nextState: this.qualityState, changed: false };
    }

    return { nextState: QualityState.HD_1080, changed: true };
  }

  forceState(state: QualityState): QualityDecision {
    const changed = this.qualityState !== state;
    this.qualityState = state;
    this.stableSampleCount = 0;
    return { nextState: this.qualityState, changed };
  }
}

export const qualityProfiles = {
  [QualityState.HD_1080]: {
    width: 1920,
    height: 1080,
    maxBitrate: 3_500_000,
  },
  [QualityState.HD_720]: {
    width: 1280,
    height: 720,
    maxBitrate: 2_000_000,
  },
  [QualityState.SD_480]: {
    width: 854,
    height: 480,
    maxBitrate: 900_000,
  },
} as const;
