import {
  CallFailureCode,
  QualityState,
  type AnswerPayloadV1,
  type DiagEventV1,
  type LiveStats,
  type OfferPayloadV1,
  type QualitySnapshot,
  type SenderRole,
} from "../types/contracts";
import { DiagnosticsLog } from "./diagnosticsLog";
import { QualityController, qualityProfiles } from "./qualityController";

interface DataMessage {
  type: "chat" | "diag" | "control";
  payload: unknown;
}

interface ControlPayload {
  audioEnabled: boolean;
  videoEnabled: boolean;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  from: "local" | "remote";
  text: string;
  timestamp: number;
}

export interface CallManagerCallbacks {
  onRemoteStream?: (stream: MediaStream) => void;
  onChatMessage?: (message: ChatMessage) => void;
  onStats?: (stats: LiveStats) => void;
  onFailure?: (code: CallFailureCode, message: string) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onRemoteMediaState?: (state: ControlPayload) => void;
}

interface StatsSample {
  rttMs: number;
  jitterMs: number;
  packetLossPct: number;
  bitrateKbps: number;
  frameWidth: number;
  frameHeight: number;
  fps: number;
  audioLevel: number;
}

type StatsLike = Record<string, unknown>;
const MAX_DATA_CHANNEL_MESSAGE_CHARS = 16_000;
const MAX_CHAT_CHARS = 500;
const MIN_CHAT_INTERVAL_MS = 250;

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const STATS_INTERVAL_MS = 1_000;
const CONNECTION_TIMEOUT_MS = 25_000;
const ICE_GATHER_MAX_WAIT_MS = 1_500;
const ICE_GATHER_SETTLE_MS = 250;
const PROFILE_RECOVERY_ORDER = [
  QualityState.SD_480,
  QualityState.HD_720,
  QualityState.HD_1080,
];

type ActiveQualityState = Exclude<QualityState, typeof QualityState.RECOVERING>;

function isActiveQualityState(value: QualityState): value is ActiveQualityState {
  return value !== QualityState.RECOVERING;
}

function randomId(): string {
  return crypto.randomUUID();
}

function getClientInfo(): string {
  const ua = navigator.userAgent || "unknown-user-agent";
  return `web:${ua.slice(0, 120)}`;
}

function safeJsonParse(message: string): unknown | null {
  try {
    return JSON.parse(message) as unknown;
  } catch {
    return null;
  }
}

export class WebRtcCallManager {
  private readonly peerConnection: RTCPeerConnection;

  private readonly callbacks: CallManagerCallbacks;

  private readonly localStream: MediaStream;

  private readonly remoteStream = new MediaStream();

  private readonly role: SenderRole;

  private readonly qualityController = new QualityController();

  private readonly diagnosticsLog = new DiagnosticsLog();

  private readonly localIceCandidates: RTCIceCandidateInit[] = [];

  private sessionId = randomId();

  private activeQuality: ActiveQualityState = QualityState.HD_1080;

  private chatChannel: RTCDataChannel | null = null;

  private diagChannel: RTCDataChannel | null = null;

  private statsTimer: number | null = null;

  private connectWatchdog: number | null = null;

  private previousOutboundBytes = 0;

  private previousStatsTimestampMs = 0;

  private lastChatSentAt = 0;

  private constructor({
    role,
    localStream,
    callbacks,
  }: {
    role: SenderRole;
    localStream: MediaStream;
    callbacks: CallManagerCallbacks;
  }) {
    this.role = role;
    this.localStream = localStream;
    this.callbacks = callbacks;
    this.peerConnection = new RTCPeerConnection({ iceServers: [] });
    this.attachCoreHandlers();
    this.attachLocalMediaTracks();

    if (role === "host") {
      this.initializeHostDataChannels();
    } else {
      this.initializeJoinerDataChannels();
    }
  }

  static createHost(
    localStream: MediaStream,
    callbacks: CallManagerCallbacks,
  ): WebRtcCallManager {
    return new WebRtcCallManager({
      role: "host",
      localStream,
      callbacks,
    });
  }

  static createJoiner(
    localStream: MediaStream,
    callbacks: CallManagerCallbacks,
  ): WebRtcCallManager {
    return new WebRtcCallManager({
      role: "joiner",
      localStream,
      callbacks,
    });
  }

  getDiagnosticsJson(): string {
    return this.diagnosticsLog.exportMergedJson();
  }

  getCurrentQualityState(): QualityState {
    return this.activeQuality;
  }

  getConnectionState(): RTCPeerConnectionState {
    return this.peerConnection.connectionState;
  }

  async createOfferPayload(): Promise<OfferPayloadV1> {
    this.localIceCandidates.length = 0;
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    await this.waitForIceGatheringComplete();
    this.startConnectWatchdog();

    return {
      sessionId: this.sessionId,
      sdpOffer: this.peerConnection.localDescription?.sdp ?? "",
      iceCandidates: [...this.localIceCandidates],
      mediaTarget: "1080p30",
      clientInfo: getClientInfo(),
    };
  }

  async acceptOfferAndCreateAnswer(offer: OfferPayloadV1): Promise<AnswerPayloadV1> {
    this.sessionId = offer.sessionId;
    await this.peerConnection.setRemoteDescription({
      type: "offer",
      sdp: offer.sdpOffer,
    });

    for (const candidate of offer.iceCandidates) {
      try {
        await this.peerConnection.addIceCandidate(candidate);
      } catch {
        // Ignore duplicate or incompatible candidates.
      }
    }

    this.localIceCandidates.length = 0;
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    await this.waitForIceGatheringComplete();
    this.startConnectWatchdog();

    return {
      sessionId: offer.sessionId,
      sdpAnswer: this.peerConnection.localDescription?.sdp ?? "",
      iceCandidates: [...this.localIceCandidates],
      acceptedMediaTarget: "1080p30",
      clientInfo: getClientInfo(),
    };
  }

  async applyAnswer(answer: AnswerPayloadV1): Promise<void> {
    if (answer.sessionId !== this.sessionId) {
      throw new Error("The answer packet is for a different session.");
    }

    await this.peerConnection.setRemoteDescription({
      type: "answer",
      sdp: answer.sdpAnswer,
    });

    for (const candidate of answer.iceCandidates) {
      try {
        await this.peerConnection.addIceCandidate(candidate);
      } catch {
        // Ignore duplicate or incompatible candidates.
      }
    }
  }

  sendChatMessage(text: string): ChatMessage {
    const now = Date.now();
    if (now - this.lastChatSentAt < MIN_CHAT_INTERVAL_MS) {
      throw new Error("Please wait a moment before sending another message.");
    }

    const cleanText = this.sanitizeChatText(text);
    if (!cleanText) {
      throw new Error("Message is empty after security filtering.");
    }

    const payload = {
      id: randomId(),
      text: cleanText,
      timestamp: now,
    };
    this.lastChatSentAt = now;
    this.sendDataMessage("chat", payload);

    const localMessage: ChatMessage = {
      id: payload.id,
      from: "local",
      text: cleanText,
      timestamp: payload.timestamp,
    };
    this.callbacks.onChatMessage?.(localMessage);
    return localMessage;
  }

  toggleMicrophoneEnabled(enabled: boolean): void {
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = enabled;
    }
    this.sendControlState();
  }

  toggleCameraEnabled(enabled: boolean): void {
    for (const track of this.localStream.getVideoTracks()) {
      track.enabled = enabled;
    }
    this.sendControlState();
  }

  isMicrophoneEnabled(): boolean {
    const audioTrack = this.localStream.getAudioTracks()[0];
    return audioTrack ? audioTrack.enabled : false;
  }

  isCameraEnabled(): boolean {
    const videoTrack = this.localStream.getVideoTracks()[0];
    return videoTrack ? videoTrack.enabled : false;
  }

  close(): void {
    if (this.statsTimer !== null) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    if (this.connectWatchdog !== null) {
      clearTimeout(this.connectWatchdog);
      this.connectWatchdog = null;
    }

    this.chatChannel?.close();
    this.diagChannel?.close();
    this.peerConnection.close();
  }

  private attachCoreHandlers(): void {
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.localIceCandidates.push(event.candidate.toJSON());
      }
    };

    this.peerConnection.ontrack = (event) => {
      const [firstStream] = event.streams;
      if (firstStream) {
        for (const track of firstStream.getTracks()) {
          this.remoteStream.addTrack(track);
        }
      } else {
        this.remoteStream.addTrack(event.track);
      }

      this.callbacks.onRemoteStream?.(this.remoteStream);
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      this.callbacks.onConnectionStateChange?.(state);

      if (state === "connected") {
        this.clearConnectWatchdog();
        this.startStatsLoop();
      }

      if (state === "failed") {
        this.callbacks.onFailure?.(
          CallFailureCode.NAT_BLOCKED,
          "Direct peer path failed. This network pair likely blocks direct connection.",
        );
      }
    };
  }

  private attachLocalMediaTracks(): void {
    for (const track of this.localStream.getTracks()) {
      this.peerConnection.addTrack(track, this.localStream);
    }
  }

  private initializeHostDataChannels(): void {
    this.chatChannel = this.peerConnection.createDataChannel("chat", {
      ordered: true,
    });
    this.bindChatChannel(this.chatChannel);

    this.diagChannel = this.peerConnection.createDataChannel("diag", {
      ordered: true,
    });
    this.bindDiagChannel(this.diagChannel);
  }

  private initializeJoinerDataChannels(): void {
    this.peerConnection.ondatachannel = (event) => {
      if (event.channel.label === "chat") {
        this.chatChannel = event.channel;
        this.bindChatChannel(event.channel);
        return;
      }

      if (event.channel.label === "diag") {
        this.diagChannel = event.channel;
        this.bindDiagChannel(event.channel);
      }
    };
  }

  private bindChatChannel(channel: RTCDataChannel): void {
    channel.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      if (event.data.length > MAX_DATA_CHANNEL_MESSAGE_CHARS) {
        return;
      }

      const decoded = safeJsonParse(event.data);
      if (
        !decoded ||
        typeof decoded !== "object" ||
        !("type" in decoded) ||
        !("payload" in decoded)
      ) {
        return;
      }

      const message = decoded as DataMessage;
      if (message.type === "chat" && typeof message.payload === "object" && message.payload) {
        const payload = message.payload as {
          id: string;
          text: string;
          timestamp: number;
        };
        const cleanText = this.sanitizeChatText(payload.text);
        if (!cleanText) {
          return;
        }
        this.callbacks.onChatMessage?.({
          id: payload.id,
          from: "remote",
          text: cleanText,
          timestamp: payload.timestamp,
        });
        return;
      }

      if (
        message.type === "control" &&
        typeof message.payload === "object" &&
        message.payload
      ) {
        const payload = message.payload as Partial<ControlPayload>;
        if (
          typeof payload.audioEnabled === "boolean" &&
          typeof payload.videoEnabled === "boolean" &&
          typeof payload.timestamp === "number"
        ) {
          this.callbacks.onRemoteMediaState?.({
            audioEnabled: payload.audioEnabled,
            videoEnabled: payload.videoEnabled,
            timestamp: payload.timestamp,
          });
        }
      }
    };
  }

  private bindDiagChannel(channel: RTCDataChannel): void {
    channel.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      if (event.data.length > MAX_DATA_CHANNEL_MESSAGE_CHARS) {
        return;
      }

      const decoded = safeJsonParse(event.data);
      if (
        !decoded ||
        typeof decoded !== "object" ||
        !("type" in decoded) ||
        !("payload" in decoded)
      ) {
        return;
      }

      const message = decoded as DataMessage;
      if (message.type === "diag" && typeof message.payload === "object" && message.payload) {
        const diagEvent = this.safeDiagEvent(message.payload);
        if (diagEvent) {
          this.diagnosticsLog.addRemoteEvent(diagEvent);
        }
      }
    };
  }

  private sendControlState(): void {
    this.sendDataMessage("control", {
      audioEnabled: this.isMicrophoneEnabled(),
      videoEnabled: this.isCameraEnabled(),
      timestamp: Date.now(),
    } satisfies ControlPayload);
  }

  private sendDataMessage(type: DataMessage["type"], payload: unknown): void {
    const channel = type === "diag" ? this.diagChannel : this.chatChannel;
    if (!channel || channel.readyState !== "open") {
      return;
    }

    const serialized = JSON.stringify({ type, payload } satisfies DataMessage);
    if (serialized.length > MAX_DATA_CHANNEL_MESSAGE_CHARS) {
      return;
    }
    channel.send(serialized);
  }

  private sanitizeChatText(input: string): string {
    const cleaned = input
      .replace(/[\p{Cc}]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    return cleaned.slice(0, MAX_CHAT_CHARS);
  }

  private safeDiagEvent(payload: unknown): DiagEventV1 | null {
    const event = payload as Partial<DiagEventV1>;
    if (typeof event !== "object" || event === null) {
      return null;
    }

    if (
      typeof event.timestamp !== "number" ||
      typeof event.peerId !== "string" ||
      typeof event.rttMs !== "number" ||
      typeof event.jitterMs !== "number" ||
      typeof event.packetLossPct !== "number" ||
      typeof event.bitrateKbps !== "number" ||
      typeof event.frameWidth !== "number" ||
      typeof event.frameHeight !== "number" ||
      typeof event.fps !== "number" ||
      typeof event.audioLevel !== "number" ||
      typeof event.eventType !== "string" ||
      typeof event.message !== "string"
    ) {
      return null;
    }

    if (
      event.peerId.length > 32 ||
      event.eventType.length > 64 ||
      event.message.length > 512
    ) {
      return null;
    }

    return {
      timestamp: event.timestamp,
      peerId: event.peerId,
      rttMs: event.rttMs,
      jitterMs: event.jitterMs,
      packetLossPct: event.packetLossPct,
      bitrateKbps: event.bitrateKbps,
      frameWidth: event.frameWidth,
      frameHeight: event.frameHeight,
      fps: event.fps,
      audioLevel: event.audioLevel,
      eventType: event.eventType,
      message: event.message,
    };
  }

  private startStatsLoop(): void {
    if (this.statsTimer !== null) {
      return;
    }

    void this.applyQualityProfile(this.activeQuality);
    this.statsTimer = window.setInterval(() => {
      void this.collectAndBroadcastStats();
    }, STATS_INTERVAL_MS);
  }

  private async collectAndBroadcastStats(): Promise<void> {
    const stats = await this.collectStatsSample();
    const diagEvent: DiagEventV1 = {
      timestamp: Date.now(),
      peerId: this.role,
      rttMs: stats.rttMs,
      jitterMs: stats.jitterMs,
      packetLossPct: stats.packetLossPct,
      bitrateKbps: stats.bitrateKbps,
      frameWidth: stats.frameWidth,
      frameHeight: stats.frameHeight,
      fps: stats.fps,
      audioLevel: stats.audioLevel,
      eventType: "stats",
      message: "Periodic call-quality sample",
    };

    this.diagnosticsLog.addLocalEvent(diagEvent);
    this.sendDataMessage("diag", diagEvent);

    const qualitySnapshot: QualitySnapshot = {
      rttMs: stats.rttMs,
      jitterMs: stats.jitterMs,
      packetLossPct: stats.packetLossPct,
    };
    const qualityDecision = this.qualityController.evaluate(qualitySnapshot);
    if (qualityDecision.changed) {
      if (qualityDecision.nextState === QualityState.RECOVERING) {
        const currentIndex = PROFILE_RECOVERY_ORDER.indexOf(this.activeQuality);
        const nextIndex = Math.min(
          PROFILE_RECOVERY_ORDER.length - 1,
          currentIndex + 1,
        );
        this.activeQuality = PROFILE_RECOVERY_ORDER[nextIndex];
        this.qualityController.forceState(this.activeQuality);
      } else if (isActiveQualityState(qualityDecision.nextState)) {
        this.activeQuality = qualityDecision.nextState;
      }

      await this.applyQualityProfile(this.activeQuality);
    }

    this.callbacks.onStats?.({
      ...stats,
      connectionState: this.peerConnection.connectionState,
      qualityState: this.activeQuality,
    });
  }

  private async collectStatsSample(): Promise<StatsSample> {
    const report = await this.peerConnection.getStats();

    let outboundVideo: StatsLike | null = null;
    let remoteInboundVideo: StatsLike | null = null;
    let inboundAudio: StatsLike | null = null;
    let candidatePair: StatsLike | null = null;
    let mediaSourceAudio: StatsLike | null = null;

    report.forEach((stat) => {
      const current = stat as unknown as StatsLike;
      const statType = current.type;
      const kind = current.kind;
      const isRemote = current.isRemote;
      const state = current.state;
      const nominated = current.nominated;
      if (
        statType === "outbound-rtp" &&
        kind === "video" &&
        isRemote !== true
      ) {
        outboundVideo = current;
      }

      if (statType === "remote-inbound-rtp" && kind === "video") {
        remoteInboundVideo = current;
      }

      if (
        statType === "inbound-rtp" &&
        kind === "audio" &&
        isRemote !== true
      ) {
        inboundAudio = current;
      }

      if (statType === "candidate-pair" && state === "succeeded" && nominated === true) {
        candidatePair = current;
      }

      if (statType === "media-source" && kind === "audio") {
        mediaSourceAudio = current;
      }
    });

    const now = Date.now();
    const bytesSent = readNumber(outboundVideo?.["bytesSent"]);
    const deltaBytes = Math.max(0, bytesSent - this.previousOutboundBytes);
    const deltaMs = Math.max(1, now - this.previousStatsTimestampMs);
    const bitrateKbps = Math.round((deltaBytes * 8) / deltaMs);
    this.previousOutboundBytes = bytesSent;
    this.previousStatsTimestampMs = now;

    const packetsLost = readNumber(remoteInboundVideo?.["packetsLost"]);
    const packetsReceived = readNumber(remoteInboundVideo?.["packetsReceived"]);
    const packetLossPct =
      packetsLost + packetsReceived > 0
        ? (packetsLost / (packetsLost + packetsReceived)) * 100
        : 0;

    const rttFromRemote = readNumber(remoteInboundVideo?.["roundTripTime"]) * 1_000;
    const rttFromCandidate =
      readNumber(candidatePair?.["currentRoundTripTime"]) * 1_000;
    const rttMs = Math.round(Math.max(rttFromRemote, rttFromCandidate));

    const jitterMs = Math.round(readNumber(inboundAudio?.["jitter"]) * 1_000);
    const frameWidth = Math.round(readNumber(outboundVideo?.["frameWidth"]));
    const frameHeight = Math.round(readNumber(outboundVideo?.["frameHeight"]));
    const fps = Math.round(readNumber(outboundVideo?.["framesPerSecond"]));
    const audioLevel =
      Math.round(readNumber(mediaSourceAudio?.["audioLevel"]) * 1000) / 1000;

    return {
      rttMs,
      jitterMs,
      packetLossPct: Math.round(packetLossPct * 100) / 100,
      bitrateKbps,
      frameWidth,
      frameHeight,
      fps,
      audioLevel,
    };
  }

  private async applyQualityProfile(qualityState: ActiveQualityState): Promise<void> {
    const profile = qualityProfiles[qualityState];
    if (!profile) {
      return;
    }

    const sender = this.peerConnection
      .getSenders()
      .find((entry) => entry.track?.kind === "video");

    if (!sender) {
      return;
    }

    const params = sender.getParameters();
    const firstEncoding = params.encodings?.[0] ?? {};
    const updatedParameters: RTCRtpSendParameters = {
      ...params,
      encodings: [{ ...firstEncoding, maxBitrate: profile.maxBitrate }],
    };
    try {
      await sender.setParameters(updatedParameters);
    } catch {
      // Ignore bitrate reconfiguration failures on older browser versions.
    }

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack || !videoTrack.applyConstraints) {
      return;
    }

    try {
      await videoTrack.applyConstraints({
        width: { ideal: profile.width, max: 1920 },
        height: { ideal: profile.height, max: 1080 },
        frameRate: { ideal: 30, max: 30 },
      });
    } catch {
      // Ignore local camera constraint failures and keep call active.
    }
  }

  private startConnectWatchdog(): void {
    this.clearConnectWatchdog();
    this.connectWatchdog = window.setTimeout(() => {
      if (this.peerConnection.connectionState === "connected") {
        return;
      }
      this.callbacks.onFailure?.(
        CallFailureCode.CONNECTION_TIMEOUT,
        "Connection timed out. Please regenerate packets and retry.",
      );
    }, CONNECTION_TIMEOUT_MS);
  }

  private clearConnectWatchdog(): void {
    if (this.connectWatchdog !== null) {
      clearTimeout(this.connectWatchdog);
      this.connectWatchdog = null;
    }
  }

  private waitForIceGatheringComplete(timeoutMs = ICE_GATHER_MAX_WAIT_MS): Promise<void> {
    if (this.peerConnection.iceGatheringState === "complete") {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settleTimer: number | null = null;
      let done = false;

      const finalize = () => {
        if (done) {
          return;
        }
        done = true;
        cleanup();
        resolve();
      };

      const timeout = window.setTimeout(finalize, timeoutMs);

      const settleSoon = () => {
        if (settleTimer !== null) {
          clearTimeout(settleTimer);
        }
        settleTimer = window.setTimeout(finalize, ICE_GATHER_SETTLE_MS);
      };

      const gatheringListener = () => {
        if (this.peerConnection.iceGatheringState !== "complete") {
          return;
        }
        finalize();
      };

      const candidateListener = (event: RTCPeerConnectionIceEvent) => {
        if (!event.candidate) {
          finalize();
          return;
        }
        settleSoon();
      };

      const cleanup = () => {
        clearTimeout(timeout);
        if (settleTimer !== null) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
        this.peerConnection.removeEventListener(
          "icegatheringstatechange",
          gatheringListener,
        );
        this.peerConnection.removeEventListener("icecandidate", candidateListener);
      };

      this.peerConnection.addEventListener(
        "icegatheringstatechange",
        gatheringListener,
      );
      this.peerConnection.addEventListener("icecandidate", candidateListener);
      settleSoon();
    });
  }
}
