import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, JSX } from "react";
import "./App.css";
import { PacketShare } from "./components/PacketShare";
import { QrScanInput } from "./components/QrScanInput";
import { getLocalMediaStream } from "./lib/media";
import {
  createSignalEnvelope,
  decodeEnvelopeFromTransport,
  decryptAnswerEnvelope,
  decryptOfferEnvelope,
  describeFailure,
  encodeEnvelopeForTransport,
} from "./lib/signalPacket";
import { WebRtcCallManager, type ChatMessage } from "./lib/webrtcCallManager";
import {
  CallFailureCode,
  type LiveStats,
  type QualityState,
  type SenderRole,
} from "./types/contracts";

type Role = SenderRole;

interface RemoteMediaState {
  audioEnabled: boolean;
  videoEnabled: boolean;
  timestamp: number;
}

interface AppError {
  code: string;
  message: string;
}

const emptyRemoteState: RemoteMediaState = {
  audioEnabled: true,
  videoEnabled: true,
  timestamp: 0,
};

const ROOM_CODE_PATTERN = /^[a-zA-Z0-9_-]{4,48}$/u;
const MIN_PASSPHRASE_LENGTH = 14;
const MAX_PACKET_INPUT_CHARS = 200_000;
const MAX_DECRYPT_FAILS = 5;
const DECRYPT_COOLDOWN_MS = 60_000;
const MAX_CHAT_INPUT_CHARS = 500;

function appendChunk(existingText: string, chunk: string): string {
  const trimmed = chunk.trim();
  if (!trimmed) {
    return existingText;
  }
  const lines = existingText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.includes(trimmed)) {
    return existingText;
  }
  return [...lines, trimmed].join("\n");
}

function friendlyMediaError(error: unknown): AppError {
  if (error instanceof Error && error.message === CallFailureCode.DEVICE_DENIED) {
    return {
      code: CallFailureCode.DEVICE_DENIED,
      message: "Camera or microphone access was blocked. Please allow access and retry.",
    };
  }
  if (error instanceof Error && error.message === CallFailureCode.MEDIA_UNSUPPORTED) {
    return {
      code: CallFailureCode.MEDIA_UNSUPPORTED,
      message: "This browser cannot start media capture for this call.",
    };
  }
  return {
    code: "UNKNOWN",
    message: error instanceof Error ? error.message : "Unknown error.",
  };
}

function validateCredentials(roomCode: string, passphrase: string): AppError | null {
  if (!roomCode.trim() || !passphrase.trim()) {
    return {
      code: "MISSING_CREDENTIALS",
      message: "Room code and passphrase are both required.",
    };
  }

  const cleanRoomCode = roomCode.trim();
  if (!ROOM_CODE_PATTERN.test(cleanRoomCode)) {
    return {
      code: "ROOM_CODE_INVALID",
      message: "Room code must be 4-48 characters using letters, numbers, - or _.",
    };
  }

  const cleanPassphrase = passphrase.trim();
  const hasUpper = /[A-Z]/u.test(cleanPassphrase);
  const hasLower = /[a-z]/u.test(cleanPassphrase);
  const hasNumber = /[0-9]/u.test(cleanPassphrase);
  const hasSymbol = /[^A-Za-z0-9]/u.test(cleanPassphrase);
  if (
    cleanPassphrase.length < MIN_PASSPHRASE_LENGTH ||
    !hasUpper ||
    !hasLower ||
    !hasNumber ||
    !hasSymbol
  ) {
    return {
      code: "PASSPHRASE_WEAK",
      message:
        "Passphrase must be at least 14 characters and include uppercase, lowercase, number, and symbol.",
    };
  }

  return null;
}

function formatState(state: RTCPeerConnectionState): string {
  switch (state) {
    case "new":
      return "New";
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "disconnected":
      return "Disconnected";
    case "failed":
      return "Failed";
    case "closed":
      return "Closed";
    default:
      return state;
  }
}

function App(): JSX.Element {
  const [role, setRole] = useState<Role>("host");
  const [roomCode, setRoomCode] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [statusText, setStatusText] = useState(
    "Enter room code and passphrase, then start as host or joiner.",
  );
  const [errorState, setErrorState] = useState<AppError | null>(null);
  const [hostPacketText, setHostPacketText] = useState("");
  const [joinPacketInput, setJoinPacketInput] = useState("");
  const [answerPacketText, setAnswerPacketText] = useState("");
  const [answerPacketInput, setAnswerPacketInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteMediaState, setRemoteMediaState] =
    useState<RemoteMediaState>(emptyRemoteState);
  const [connectionState, setConnectionState] =
    useState<RTCPeerConnectionState>("new");
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [manager, setManager] = useState<WebRtcCallManager | null>(null);
  const [decryptFailureCount, setDecryptFailureCount] = useState(0);
  const [decryptCooldownUntil, setDecryptCooldownUntil] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const qualityState: QualityState | null = useMemo(
    () => (stats ? stats.qualityState : null),
    [stats],
  );

  useEffect(() => {
    if (!localVideoRef.current) {
      return;
    }
    localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (!remoteVideoRef.current) {
      return;
    }
    remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    return () => {
      manager?.close();
      localStream?.getTracks().forEach((track) => track.stop());
    };
  }, [manager, localStream]);

  const resetCallUi = () => {
    setHostPacketText("");
    setJoinPacketInput("");
    setAnswerPacketText("");
    setAnswerPacketInput("");
    setMessages([]);
    setStats(null);
    setRemoteStream(null);
    setRemoteMediaState(emptyRemoteState);
    setConnectionState("new");
    setMicEnabled(true);
    setCameraEnabled(true);
  };

  const applyManagerCallbacks = (callManager: WebRtcCallManager) => {
    setManager(callManager);
    setConnectionState(callManager.getConnectionState());
  };

  const newManagerCallbacks = () => ({
    onRemoteStream: (stream: MediaStream) => {
      setRemoteStream(stream);
    },
    onChatMessage: (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    },
    onStats: (live: LiveStats) => {
      setStats(live);
    },
    onFailure: (code: CallFailureCode, message: string) => {
      setErrorState({ code, message });
      setStatusText(message);
    },
    onConnectionStateChange: (state: RTCPeerConnectionState) => {
      setConnectionState(state);
      if (state === "connected") {
        setStatusText("Call connected.");
      }
    },
    onRemoteMediaState: (state: RemoteMediaState) => {
      setRemoteMediaState(state);
    },
  });

  const ensureRoomAndPassphrase = (): boolean => {
    const validationError = validateCredentials(roomCode, passphrase);
    if (validationError) {
      setErrorState(validationError);
      return false;
    }
    return true;
  };

  const checkDecryptCooldown = (): boolean => {
    if (Date.now() < decryptCooldownUntil) {
      const remainingSeconds = Math.ceil((decryptCooldownUntil - Date.now()) / 1000);
      setErrorState({
        code: "SECURITY_COOLDOWN",
        message: `Too many failed packet unlock attempts. Wait ${remainingSeconds}s and try again.`,
      });
      return false;
    }
    return true;
  };

  const resetDecryptProtection = () => {
    setDecryptFailureCount(0);
    setDecryptCooldownUntil(0);
  };

  const recordDecryptFailure = (code: string) => {
    if (code !== CallFailureCode.PASS_PHRASE_MISMATCH) {
      return;
    }

    setDecryptFailureCount((currentCount) => {
      const nextCount = currentCount + 1;
      if (nextCount >= MAX_DECRYPT_FAILS) {
        setDecryptCooldownUntil(Date.now() + DECRYPT_COOLDOWN_MS);
        return 0;
      }
      return nextCount;
    });
  };

  const ensureLocalStream = async (): Promise<MediaStream> => {
    if (localStream) {
      return localStream;
    }
    try {
      const stream = await getLocalMediaStream();
      setLocalStream(stream);
      return stream;
    } catch (error) {
      const friendly = friendlyMediaError(error);
      setErrorState(friendly);
      throw error;
    }
  };

  const stopExistingCallManager = () => {
    if (manager) {
      manager.close();
      setManager(null);
    }
  };

  const handleStartHost = async () => {
    if (!ensureRoomAndPassphrase()) {
      return;
    }
    setBusy(true);
    setErrorState(null);
    setStatusText("Preparing host offer packet...");
    try {
      stopExistingCallManager();
      resetCallUi();
      const stream = await ensureLocalStream();
      const callManager = WebRtcCallManager.createHost(stream, newManagerCallbacks());
      applyManagerCallbacks(callManager);

      const offerPayload = await callManager.createOfferPayload();
      const envelope = await createSignalEnvelope({
        payload: offerPayload,
        passphrase: passphrase.trim(),
        roomCode: roomCode.trim(),
        type: "offer",
        senderRole: "host",
      });
      const encoded = encodeEnvelopeForTransport(envelope);
      setHostPacketText(encoded);
      setStatusText("Invite packet is ready. Share it with your peer.");
    } catch (error) {
      const failure = describeFailure(error);
      setErrorState({
        code: failure.code,
        message: failure.message,
      });
      setStatusText(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const handleJoinAndCreateAnswer = async () => {
    if (!ensureRoomAndPassphrase() || !checkDecryptCooldown()) {
      return;
    }
    const inboundPacketText = joinPacketInput;
    if (inboundPacketText.length > MAX_PACKET_INPUT_CHARS) {
      setErrorState({
        code: "PACKET_TOO_LARGE",
        message: "Packet input is too large and was blocked for safety.",
      });
      return;
    }

    setBusy(true);
    setErrorState(null);
    setStatusText("Reading host packet and creating answer...");
    try {
      const envelope = decodeEnvelopeFromTransport(inboundPacketText);
      const offerPayload = await decryptOfferEnvelope({
        envelope,
        roomCode: roomCode.trim(),
        passphrase: passphrase.trim(),
      });

      stopExistingCallManager();
      resetCallUi();
      const stream = await ensureLocalStream();
      const callManager = WebRtcCallManager.createJoiner(stream, newManagerCallbacks());
      applyManagerCallbacks(callManager);

      const answerPayload = await callManager.acceptOfferAndCreateAnswer(offerPayload);
      const answerEnvelope = await createSignalEnvelope({
        payload: answerPayload,
        passphrase: passphrase.trim(),
        roomCode: roomCode.trim(),
        type: "answer",
        senderRole: "joiner",
      });
      const encodedAnswer = encodeEnvelopeForTransport(answerEnvelope);
      setAnswerPacketText(encodedAnswer);
      setJoinPacketInput("");
      resetDecryptProtection();
      setStatusText("Answer packet is ready. Share it back to the host.");
    } catch (error) {
      const failure = describeFailure(error);
      recordDecryptFailure(failure.code);
      setErrorState({
        code: failure.code,
        message: failure.message,
      });
      setStatusText(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const handleHostApplyAnswer = async () => {
    if (!manager) {
      setErrorState({
        code: "HOST_NOT_READY",
        message: "Start host mode first so there is an active session.",
      });
      return;
    }
    if (!checkDecryptCooldown()) {
      return;
    }
    if (answerPacketInput.length > MAX_PACKET_INPUT_CHARS) {
      setErrorState({
        code: "PACKET_TOO_LARGE",
        message: "Packet input is too large and was blocked for safety.",
      });
      return;
    }

    setBusy(true);
    setErrorState(null);
    setStatusText("Applying answer packet and connecting...");
    try {
      const envelope = decodeEnvelopeFromTransport(answerPacketInput);
      const answerPayload = await decryptAnswerEnvelope({
        envelope,
        roomCode: roomCode.trim(),
        passphrase: passphrase.trim(),
      });
      await manager.applyAnswer(answerPayload);
      setAnswerPacketInput("");
      resetDecryptProtection();
      setStatusText("Answer accepted. Waiting for peer connection...");
    } catch (error) {
      const failure = describeFailure(error);
      recordDecryptFailure(failure.code);
      setErrorState({
        code: failure.code,
        message: failure.message,
      });
      setStatusText(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const onSubmitChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!manager || !chatInput.trim()) {
      return;
    }
    try {
      manager.sendChatMessage(chatInput.trim());
      setChatInput("");
    } catch (error) {
      setErrorState({
        code: "CHAT_BLOCKED",
        message: error instanceof Error ? error.message : "Chat message was blocked.",
      });
    }
  };

  const toggleMicrophone = () => {
    if (!manager) {
      return;
    }
    const next = !micEnabled;
    manager.toggleMicrophoneEnabled(next);
    setMicEnabled(manager.isMicrophoneEnabled());
  };

  const toggleCamera = () => {
    if (!manager) {
      return;
    }
    const next = !cameraEnabled;
    manager.toggleCameraEnabled(next);
    setCameraEnabled(manager.isCameraEnabled());
  };

  const exportDiagnostics = () => {
    if (!manager) {
      return;
    }
    const json = manager.getDiagnosticsJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `call-diagnostics-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const switchRole = (nextRole: Role) => {
    setRole(nextRole);
    setStatusText(`Switched to ${nextRole} mode.`);
    setErrorState(null);
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <h1>Direct P2P Video Calling</h1>
        <p>
          Torrent-style manual connection. No signaling server, no relay server, no call backend.
        </p>
      </header>

      <section className="panel">
        <h2>Session Setup</h2>
        <div className="grid two">
          <label>
            Room Code
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value)}
              placeholder="example: room-7391"
              autoComplete="off"
            />
          </label>
          <label>
            Passphrase
            <input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="shared secret"
              autoComplete="off"
            />
          </label>
        </div>
        <div className="button-row">
          <button
            type="button"
            className={role === "host" ? "active" : ""}
            onClick={() => switchRole("host")}
          >
            Host
          </button>
          <button
            type="button"
            className={role === "joiner" ? "active" : ""}
            onClick={() => switchRole("joiner")}
          >
            Joiner
          </button>
        </div>
      </section>

      {role === "host" ? (
        <section className="panel">
          <h2>Host Flow</h2>
          <div className="button-row">
            <button type="button" onClick={() => void handleStartHost()} disabled={busy}>
              Create Invite Packet
            </button>
          </div>

          {hostPacketText ? (
            <PacketShare title="Host Invite Packet" packetText={hostPacketText} />
          ) : null}

          <label>
            Paste Joiner Answer Packet
            <textarea
              value={answerPacketInput}
              onChange={(event) => setAnswerPacketInput(event.target.value)}
              className="packet-textarea"
              placeholder="Paste answer packet lines here..."
            />
          </label>

          <QrScanInput
            onDecoded={(chunk) =>
              setAnswerPacketInput((existing) => appendChunk(existing, chunk))
            }
          />

          <button
            type="button"
            onClick={() => void handleHostApplyAnswer()}
            disabled={busy || !answerPacketInput.trim()}
          >
            Apply Answer and Connect
          </button>
        </section>
      ) : (
        <section className="panel">
          <h2>Joiner Flow</h2>
          <label>
            Paste Host Invite Packet
            <textarea
              value={joinPacketInput}
              onChange={(event) => setJoinPacketInput(event.target.value)}
              className="packet-textarea"
              placeholder="Paste host packet lines here..."
            />
          </label>

          <QrScanInput
            onDecoded={(chunk) =>
              setJoinPacketInput((existing) => appendChunk(existing, chunk))
            }
          />

          <button
            type="button"
            onClick={() => void handleJoinAndCreateAnswer()}
            disabled={busy || !joinPacketInput.trim()}
          >
            Join and Create Answer
          </button>

          {answerPacketText ? (
            <PacketShare title="Joiner Answer Packet" packetText={answerPacketText} />
          ) : null}
        </section>
      )}

      <section className="grid two video-grid">
        <div className="panel">
          <h3>Local Video</h3>
          <video ref={localVideoRef} muted autoPlay playsInline />
        </div>
        <div className="panel">
          <h3>Remote Video</h3>
          <video ref={remoteVideoRef} autoPlay playsInline />
        </div>
      </section>

      <section className="panel">
        <h2>Call Controls</h2>
        <div className="button-row">
          <button type="button" onClick={toggleMicrophone} disabled={!manager}>
            {micEnabled ? "Mute Mic" : "Unmute Mic"}
          </button>
          <button type="button" onClick={toggleCamera} disabled={!manager}>
            {cameraEnabled ? "Turn Camera Off" : "Turn Camera On"}
          </button>
          <button type="button" onClick={exportDiagnostics} disabled={!manager}>
            Export Diagnostics JSON
          </button>
        </div>
        <p className="muted">
          Peer media state: audio {remoteMediaState.audioEnabled ? "on" : "off"}, video{" "}
          {remoteMediaState.videoEnabled ? "on" : "off"}
        </p>
      </section>

      <section className="panel">
        <h2>In-Call Chat</h2>
        <div className="chat-log">
          {messages.length === 0 ? (
            <p className="muted">No chat messages yet.</p>
          ) : (
            messages.map((message) => (
              <article key={message.id} className={`chat-message ${message.from}`}>
                <strong>{message.from === "local" ? "You" : "Peer"}</strong>
                <p>{message.text}</p>
              </article>
            ))
          )}
        </div>
        <form onSubmit={onSubmitChat} className="chat-form">
          <input
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value.slice(0, MAX_CHAT_INPUT_CHARS))}
            placeholder="Type a message..."
          />
          <button type="submit" disabled={!manager || !chatInput.trim()}>
            Send
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Live Connection Stats</h2>
        <div className="stats-grid">
          <div>Connection: {formatState(connectionState)}</div>
          <div>Quality state: {qualityState ?? "Not started"}</div>
          <div>RTT: {stats ? `${stats.rttMs} ms` : "N/A"}</div>
          <div>Jitter: {stats ? `${stats.jitterMs} ms` : "N/A"}</div>
          <div>Packet loss: {stats ? `${stats.packetLossPct}%` : "N/A"}</div>
          <div>Bitrate: {stats ? `${stats.bitrateKbps} kbps` : "N/A"}</div>
          <div>
            Resolution:{" "}
            {stats && stats.frameWidth > 0
              ? `${stats.frameWidth}x${stats.frameHeight}`
              : "N/A"}
          </div>
          <div>FPS: {stats ? stats.fps : "N/A"}</div>
        </div>
      </section>

      <section className="panel status-panel">
        <p>{statusText}</p>
        {decryptFailureCount > 0 ? (
          <p className="muted">
            Failed unlock attempts: {decryptFailureCount} / {MAX_DECRYPT_FAILS}
          </p>
        ) : null}
        {errorState ? (
          <p className="error">
            [{errorState.code}] {errorState.message}
          </p>
        ) : null}
      </section>
    </main>
  );
}

export default App;
