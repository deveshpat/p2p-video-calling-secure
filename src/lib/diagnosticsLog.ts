import type { DiagEventV1 } from "../types/contracts";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export class DiagnosticsLog {
  private readonly localEvents: DiagEventV1[] = [];

  private readonly remoteEvents: DiagEventV1[] = [];

  addLocalEvent(event: DiagEventV1): void {
    this.localEvents.push(event);
    this.pruneOldEntries();
  }

  addRemoteEvent(event: DiagEventV1): void {
    this.remoteEvents.push(event);
    this.pruneOldEntries();
  }

  getMergedEvents(): DiagEventV1[] {
    return [...this.localEvents, ...this.remoteEvents].sort(
      (first, second) => first.timestamp - second.timestamp,
    );
  }

  exportMergedJson(): string {
    return JSON.stringify(
      {
        exportedAt: Date.now(),
        localCount: this.localEvents.length,
        remoteCount: this.remoteEvents.length,
        events: this.getMergedEvents(),
      },
      null,
      2,
    );
  }

  private pruneOldEntries(): void {
    const minTimestamp = Date.now() - FIFTEEN_MINUTES_MS;

    while (this.localEvents.length > 0 && this.localEvents[0].timestamp < minTimestamp) {
      this.localEvents.shift();
    }

    while (
      this.remoteEvents.length > 0 &&
      this.remoteEvents[0].timestamp < minTimestamp
    ) {
      this.remoteEvents.shift();
    }
  }
}
