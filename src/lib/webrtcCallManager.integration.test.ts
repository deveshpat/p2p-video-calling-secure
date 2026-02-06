import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createSignalEnvelope, decodeEnvelopeFromTransport, decryptAnswerEnvelope, decryptOfferEnvelope, encodeEnvelopeForTransport } from "./signalPacket";
import { WebRtcCallManager, type ChatMessage } from "./webrtcCallManager";
import { type LiveStats } from "../types/contracts";

type DataChannelCallback = ((event: MessageEvent<string>) => void) | null;

class MockMediaStreamTrack {
  readonly kind: "audio" | "video";

  enabled = true;

  constructor(kind: "audio" | "video") {
    this.kind = kind;
  }

  async applyConstraints(): Promise<void> {
    return Promise.resolve();
  }

  stop(): void {
    // no-op for test
  }
}

class MockMediaStream {
  private readonly tracks: MockMediaStreamTrack[];

  constructor(tracks: MockMediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  addTrack(track: MockMediaStreamTrack): void {
    this.tracks.push(track);
  }

  getTracks(): MockMediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): MockMediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getVideoTracks(): MockMediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }
}

class MockDataChannel {
  readonly label: string;

  readyState: RTCDataChannelState = "open";

  onmessage: DataChannelCallback = null;

  peerChannel: MockDataChannel | null = null;

  constructor(label: string) {
    this.label = label;
  }

  send(data: string): void {
    if (!this.peerChannel || !this.peerChannel.onmessage) {
      return;
    }
    this.peerChannel.onmessage({ data } as MessageEvent<string>);
  }

  close(): void {
    this.readyState = "closed";
  }
}

class MockRtpSender {
  readonly track: MockMediaStreamTrack;

  private params: RTCRtpSendParameters = {
    codecs: [],
    headerExtensions: [],
    rtcp: { cname: "" },
    encodings: [{}],
    transactionId: "mock",
  };

  constructor(track: MockMediaStreamTrack) {
    this.track = track;
  }

  getParameters(): RTCRtpSendParameters {
    return this.params;
  }

  async setParameters(params: RTCRtpSendParameters): Promise<void> {
    this.params = params;
  }
}

class MockPeerConnection extends EventTarget {
  static waitingPeer: MockPeerConnection | null = null;

  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;

  ontrack: ((event: RTCTrackEvent) => void) | null = null;

  onconnectionstatechange: (() => void) | null = null;

  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;

  localDescription: RTCSessionDescription | null = null;

  remoteDescription: RTCSessionDescription | null = null;

  connectionState: RTCPeerConnectionState = "new";

  iceGatheringState: RTCIceGatheringState = "new";

  private readonly senders: MockRtpSender[] = [];

  private readonly pendingChannels: MockDataChannel[] = [];

  private peer: MockPeerConnection | null = null;

  private bytesSent = 0;

  constructor() {
    super();
    if (MockPeerConnection.waitingPeer) {
      this.peer = MockPeerConnection.waitingPeer;
      this.peer.peer = this;
      MockPeerConnection.waitingPeer = null;
      this.connectPendingChannels();
      this.peer.connectPendingChannels();
    } else {
      MockPeerConnection.waitingPeer = this;
    }
  }

  static reset(): void {
    MockPeerConnection.waitingPeer = null;
  }

  addTrack(track: MediaStreamTrack): RTCRtpSender {
    const sender = new MockRtpSender(track as unknown as MockMediaStreamTrack);
    this.senders.push(sender);
    return sender as unknown as RTCRtpSender;
  }

  getSenders(): RTCRtpSender[] {
    return this.senders as unknown as RTCRtpSender[];
  }

  createDataChannel(label: string): RTCDataChannel {
    const local = new MockDataChannel(label);
    this.pendingChannels.push(local);
    this.connectPendingChannels();
    return local as unknown as RTCDataChannel;
  }

  private connectPendingChannels(): void {
    if (!this.peer || this.pendingChannels.length === 0) {
      return;
    }

    for (const localChannel of this.pendingChannels.splice(0)) {
      const remoteChannel = new MockDataChannel(localChannel.label);
      localChannel.peerChannel = remoteChannel;
      remoteChannel.peerChannel = localChannel;
      queueMicrotask(() => {
        this.peer?.ondatachannel?.({
          channel: remoteChannel as unknown as RTCDataChannel,
        } as RTCDataChannelEvent);
      });
    }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return {
      type: "offer",
      sdp: "mock-offer",
    };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return {
      type: "answer",
      sdp: "mock-answer",
    };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc as RTCSessionDescription;
    this.emitIceCandidate();
    this.maybeConnect();
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc as RTCSessionDescription;
    this.maybeConnect();
  }

  async addIceCandidate(): Promise<void> {
    return Promise.resolve();
  }

  close(): void {
    this.connectionState = "closed";
    this.onconnectionstatechange?.();
  }

  async getStats(): Promise<RTCStatsReport> {
    this.bytesSent += 450_000;
    const now = Date.now();
    const report = new Map<string, RTCStats>([
      [
        "outbound",
        {
          id: "outbound",
          timestamp: now,
          type: "outbound-rtp",
          kind: "video",
          isRemote: false,
          bytesSent: this.bytesSent,
          frameWidth: 1280,
          frameHeight: 720,
          framesPerSecond: 30,
        } as unknown as RTCStats,
      ],
      [
        "remoteInbound",
        {
          id: "remoteInbound",
          timestamp: now,
          type: "remote-inbound-rtp",
          kind: "video",
          packetsLost: 1,
          packetsReceived: 300,
          roundTripTime: 0.05,
        } as unknown as RTCStats,
      ],
      [
        "inboundAudio",
        {
          id: "inboundAudio",
          timestamp: now,
          type: "inbound-rtp",
          kind: "audio",
          isRemote: false,
          jitter: 0.004,
        } as unknown as RTCStats,
      ],
      [
        "candidatePair",
        {
          id: "candidatePair",
          timestamp: now,
          type: "candidate-pair",
          state: "succeeded",
          nominated: true,
          currentRoundTripTime: 0.05,
        } as unknown as RTCStats,
      ],
      [
        "audioSource",
        {
          id: "audioSource",
          timestamp: now,
          type: "media-source",
          kind: "audio",
          audioLevel: 0.4,
        } as unknown as RTCStats,
      ],
    ]);
    return report as unknown as RTCStatsReport;
  }

  private emitIceCandidate(): void {
    this.iceGatheringState = "gathering";
    queueMicrotask(() => {
      const candidate = {
        candidate: "candidate:mock",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };
      this.onicecandidate?.({
        candidate: {
          toJSON: () => candidate,
        },
      } as unknown as RTCPeerConnectionIceEvent);
      this.iceGatheringState = "complete";
      this.dispatchEvent(new Event("icegatheringstatechange"));
      this.onicecandidate?.({ candidate: null } as RTCPeerConnectionIceEvent);
    });
  }

  private maybeConnect(): void {
    if (
      !this.peer ||
      !this.localDescription ||
      !this.remoteDescription ||
      !this.peer.localDescription ||
      !this.peer.remoteDescription
    ) {
      return;
    }

    this.connectionState = "connected";
    this.peer.connectionState = "connected";
    this.onconnectionstatechange?.();
    this.peer.onconnectionstatechange?.();

    for (const sender of this.senders) {
      const remoteStream = new MockMediaStream([sender.track]);
      this.peer.ontrack?.({
        track: sender.track as unknown as MediaStreamTrack,
        streams: [remoteStream as unknown as MediaStream],
      } as unknown as RTCTrackEvent);
    }

    for (const sender of this.peer.senders) {
      const remoteStream = new MockMediaStream([sender.track]);
      this.ontrack?.({
        track: sender.track as unknown as MediaStreamTrack,
        streams: [remoteStream as unknown as MediaStream],
      } as unknown as RTCTrackEvent);
    }
  }
}

const originalMediaStream = globalThis.MediaStream;
const originalPeerConnection = globalThis.RTCPeerConnection;

function buildLocalStream(): MediaStream {
  return new MockMediaStream([
    new MockMediaStreamTrack("audio"),
    new MockMediaStreamTrack("video"),
  ]) as unknown as MediaStream;
}

describe("webrtcCallManager integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as { MediaStream: typeof MediaStream }).MediaStream =
      MockMediaStream as unknown as typeof MediaStream;
    (
      globalThis as unknown as {
        RTCPeerConnection: typeof RTCPeerConnection;
      }
    ).RTCPeerConnection = MockPeerConnection as unknown as typeof RTCPeerConnection;
    MockPeerConnection.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as unknown as { MediaStream: typeof MediaStream }).MediaStream =
      originalMediaStream;
    (
      globalThis as unknown as {
        RTCPeerConnection: typeof RTCPeerConnection;
      }
    ).RTCPeerConnection = originalPeerConnection;
    MockPeerConnection.reset();
  });

  it("completes packet handshake, chat, media controls, stats, and diagnostics sync", async () => {
    const hostMessages: ChatMessage[] = [];
    const joinerMessages: ChatMessage[] = [];
    const hostStats: LiveStats[] = [];
    const joinerStats: LiveStats[] = [];
    const failures: string[] = [];
    let joinerRemoteMediaState: { audioEnabled: boolean; videoEnabled: boolean } | null = null;

    const host = WebRtcCallManager.createHost(buildLocalStream(), {
      onChatMessage: (message) => hostMessages.push(message),
      onStats: (value) => hostStats.push(value),
      onFailure: (_code, message) => failures.push(message),
    });

    const hostOffer = await host.createOfferPayload();
    const offerEnvelope = await createSignalEnvelope({
      payload: hostOffer,
      passphrase: "passphrase",
      roomCode: "room-1",
      type: "offer",
      senderRole: "host",
    });
    const offerTransport = encodeEnvelopeForTransport(offerEnvelope);
    const decodedOfferEnvelope = decodeEnvelopeFromTransport(offerTransport);
    const decodedOffer = await decryptOfferEnvelope({
      envelope: decodedOfferEnvelope,
      passphrase: "passphrase",
      roomCode: "room-1",
    });

    const joiner = WebRtcCallManager.createJoiner(buildLocalStream(), {
      onChatMessage: (message) => joinerMessages.push(message),
      onStats: (value) => joinerStats.push(value),
      onRemoteMediaState: (value) => {
        joinerRemoteMediaState = {
          audioEnabled: value.audioEnabled,
          videoEnabled: value.videoEnabled,
        };
      },
      onFailure: (_code, message) => failures.push(message),
    });

    const joinerAnswer = await joiner.acceptOfferAndCreateAnswer(decodedOffer);
    const answerEnvelope = await createSignalEnvelope({
      payload: joinerAnswer,
      passphrase: "passphrase",
      roomCode: "room-1",
      type: "answer",
      senderRole: "joiner",
    });
    const answerTransport = encodeEnvelopeForTransport(answerEnvelope);
    const decodedAnswerEnvelope = decodeEnvelopeFromTransport(answerTransport);
    const decodedAnswer = await decryptAnswerEnvelope({
      envelope: decodedAnswerEnvelope,
      passphrase: "passphrase",
      roomCode: "room-1",
    });

    await host.applyAnswer(decodedAnswer);
    await vi.advanceTimersByTimeAsync(50);

    expect(host.getConnectionState()).toBe("connected");
    expect(joiner.getConnectionState()).toBe("connected");

    host.sendChatMessage("Hello from host");
    expect(hostMessages.some((entry) => entry.from === "local")).toBe(true);
    expect(joinerMessages.some((entry) => entry.text === "Hello from host")).toBe(true);

    host.toggleMicrophoneEnabled(false);
    host.toggleCameraEnabled(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(joinerRemoteMediaState).toEqual({
      audioEnabled: false,
      videoEnabled: false,
    });

    await vi.advanceTimersByTimeAsync(3_100);
    expect(hostStats.length).toBeGreaterThan(0);
    expect(joinerStats.length).toBeGreaterThan(0);
    expect(hostStats[0].rttMs).toBeGreaterThan(0);

    const hostDiag = JSON.parse(host.getDiagnosticsJson()) as {
      localCount: number;
      remoteCount: number;
      events: unknown[];
    };
    const joinerDiag = JSON.parse(joiner.getDiagnosticsJson()) as {
      localCount: number;
      remoteCount: number;
      events: unknown[];
    };
    expect(hostDiag.events.length).toBeGreaterThan(0);
    expect(hostDiag.remoteCount).toBeGreaterThan(0);
    expect(joinerDiag.remoteCount).toBeGreaterThan(0);
    expect(failures).toHaveLength(0);
  });
});
