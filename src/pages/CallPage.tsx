import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import {
  createSignalingWebSocketUrl,
  getRoomStatus,
  getTurnCredentials,
} from "../lib/meetingApi";
import { getLocalMediaStream } from "../lib/media";

interface CallPageProps {
  apiBaseUrl: string;
  roomId: string;
  inviteUrl: string;
  role: "host" | "guest";
  displayName: string;
  onLeave: () => void;
}

interface SignalingMessage {
  type: string;
  payload?: unknown;
  fromPeerId?: string;
  toPeerId?: string;
}

interface ChatLine {
  id: string;
  from: "local" | "remote";
  name: string;
  text: string;
  timestamp: number;
}

function connectionText(state: RTCPeerConnectionState): string {
  switch (state) {
    case "new":
      return "Ready";
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "disconnected":
      return "Reconnecting";
    case "failed":
      return "Connection failed";
    case "closed":
      return "Call ended";
    default:
      return state;
  }
}

function makeChatId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeJsonParse(value: string): SignalingMessage | null {
  try {
    return JSON.parse(value) as SignalingMessage;
  } catch {
    return null;
  }
}

function parseOffer(payload: unknown): RTCSessionDescriptionInit | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const next = payload as { sdp?: unknown; type?: unknown };
  if (typeof next.sdp !== "string") {
    return null;
  }
  const type = next.type === "offer" ? "offer" : next.type === "answer" ? "answer" : null;
  if (!type) {
    return null;
  }
  return {
    sdp: next.sdp,
    type,
  };
}

function parseIceCandidate(payload: unknown): RTCIceCandidateInit | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate = payload as RTCIceCandidateInit;
  if (typeof candidate.candidate !== "string") {
    return null;
  }
  return candidate;
}

function buildIceServers(turn: {
  urls: string[];
  username: string;
  credential: string;
}): RTCIceServer[] {
  const defaultStun: RTCIceServer = {
    urls: ["stun:stun.l.google.com:19302"],
  };

  if (turn.urls.length === 0) {
    return [defaultStun];
  }

  if (turn.username && turn.credential) {
    return [
      {
        urls: turn.urls,
        username: turn.username,
        credential: turn.credential,
      },
      defaultStun,
    ];
  }

  return [
    {
      urls: turn.urls,
    },
    defaultStun,
  ];
}

export function CallPage({
  apiBaseUrl,
  roomId,
  inviteUrl,
  role,
  displayName,
  onLeave,
}: CallPageProps): JSX.Element {
  const [statusText, setStatusText] = useState("Preparing your meeting...");
  const [errorText, setErrorText] = useState("");
  const [connectionState, setConnectionState] =
    useState<RTCPeerConnectionState>("new");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLines, setChatLines] = useState<ChatLine[]>([]);
  const [copyStatus, setCopyStatus] = useState("");

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const offerBusyRef = useRef(false);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const joinerPeerIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const peerIdRef = useRef(crypto.randomUUID());

  const connectionStatusLabel = useMemo(
    () => connectionText(connectionState),
    [connectionState],
  );

  useEffect(() => {
    localStreamRef.current = localStream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    mountedRef.current = true;

    const addChatLine = (line: ChatLine) => {
      setChatLines((previous) => [...previous, line]);
    };

    const sendSignal = (message: SignalingMessage) => {
      const socket = websocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(JSON.stringify(message));
    };

    const createAndSendOffer = async () => {
      if (offerBusyRef.current) {
        return;
      }
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) {
        return;
      }
      if (peerConnection.signalingState !== "stable") {
        return;
      }
      offerBusyRef.current = true;
      try {
        setStatusText("Calling peer...");
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignal({
          type: "offer",
          toPeerId: joinerPeerIdRef.current ?? undefined,
          payload: {
            type: offer.type,
            sdp: offer.sdp,
            displayName,
          },
        });
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "Could not create call offer.");
      } finally {
        offerBusyRef.current = false;
      }
    };

    const setup = async () => {
      try {
        setErrorText("");
        setStatusText("Checking meeting room...");
        await getRoomStatus(apiBaseUrl, roomId);

        const turn = await getTurnCredentials(apiBaseUrl, peerIdRef.current);

        setStatusText("Getting camera and microphone...");
        const nextLocalStream = await getLocalMediaStream();
        if (!mountedRef.current) {
          nextLocalStream.getTracks().forEach((track) => track.stop());
          return;
        }

        setLocalStream(nextLocalStream);
        cameraTrackRef.current = nextLocalStream.getVideoTracks()[0] ?? null;
        setMicEnabled((nextLocalStream.getAudioTracks()[0]?.enabled ?? true));
        setCameraEnabled((nextLocalStream.getVideoTracks()[0]?.enabled ?? true));

        const peerConnection = new RTCPeerConnection({
          iceServers: buildIceServers(turn),
        });
        peerConnectionRef.current = peerConnection;

        nextLocalStream.getTracks().forEach((track) => {
          peerConnection.addTrack(track, nextLocalStream);
        });

        peerConnection.ontrack = (event) => {
          const [stream] = event.streams;
          if (stream) {
            setRemoteStream(stream);
          }
        };

        peerConnection.onconnectionstatechange = () => {
          const state = peerConnection.connectionState;
          setConnectionState(state);
          if (state === "connected") {
            setStatusText("You are connected.");
          }
          if (state === "failed") {
            setErrorText("Connection failed. Please leave and try the link again.");
          }
        };

        peerConnection.onicecandidate = (event) => {
          if (!event.candidate) {
            return;
          }
          sendSignal({
            type: "ice-candidate",
            toPeerId: joinerPeerIdRef.current ?? undefined,
            payload: event.candidate.toJSON(),
          });
        };

        setStatusText("Connecting to meeting service...");
        const signalingUrl = createSignalingWebSocketUrl(apiBaseUrl, {
          roomId,
          peerId: peerIdRef.current,
          role,
        });
        const socket = new WebSocket(signalingUrl);
        websocketRef.current = socket;

        socket.onopen = () => {
          setStatusText(
            role === "host"
              ? "Meeting started. Waiting for someone to join."
              : "Joining meeting...",
          );
          heartbeatTimerRef.current = window.setInterval(() => {
            sendSignal({ type: "heartbeat" });
          }, 20_000);
        };

        socket.onmessage = async (event) => {
          const incoming = safeJsonParse(String(event.data));
          if (!incoming) {
            return;
          }

          if (incoming.type === "session-joined") {
            const payload =
              incoming.payload && typeof incoming.payload === "object"
                ? (incoming.payload as { participantCount?: unknown })
                : null;
            const participantCount =
              payload && typeof payload.participantCount === "number"
                ? payload.participantCount
                : 1;

            if (participantCount > 1 && role === "host") {
              await createAndSendOffer();
            }
            return;
          }

          if (incoming.type === "peer-joined") {
            if (incoming.fromPeerId) {
              joinerPeerIdRef.current = incoming.fromPeerId;
            }
            setStatusText("Peer joined. Starting secure call...");
            if (role === "host") {
              await createAndSendOffer();
            }
            return;
          }

          if (incoming.type === "peer-left") {
            setStatusText("Peer left the meeting.");
            setRemoteStream(null);
            setConnectionState("disconnected");
            return;
          }

          if (incoming.type === "offer" && role === "guest") {
            const offer = parseOffer(incoming.payload);
            if (!offer) {
              return;
            }
            if (incoming.fromPeerId) {
              joinerPeerIdRef.current = incoming.fromPeerId;
            }
            try {
              await peerConnection.setRemoteDescription(offer);
              const answer = await peerConnection.createAnswer();
              await peerConnection.setLocalDescription(answer);
              sendSignal({
                type: "answer",
                payload: {
                  type: answer.type,
                  sdp: answer.sdp,
                  displayName,
                },
              });
              setStatusText("Joining call...");
            } catch (error) {
              setErrorText(
                error instanceof Error ? error.message : "Could not answer host offer.",
              );
            }
            return;
          }

          if (incoming.type === "answer" && role === "host") {
            const answer = parseOffer(incoming.payload);
            if (!answer) {
              return;
            }
            if (peerConnection.signalingState !== "have-local-offer") {
              return;
            }
            try {
              await peerConnection.setRemoteDescription(answer);
              setStatusText("Peer answered. Finalizing connection...");
            } catch (error) {
              setErrorText(
                error instanceof Error ? error.message : "Could not apply peer answer.",
              );
            }
            return;
          }

          if (incoming.type === "ice-candidate") {
            const candidate = parseIceCandidate(incoming.payload);
            if (!candidate) {
              return;
            }
            try {
              await peerConnection.addIceCandidate(candidate);
            } catch {
              // Ignore incompatible ICE candidates.
            }
            return;
          }

          if (incoming.type === "chat") {
            const payload =
              incoming.payload && typeof incoming.payload === "object"
                ? (incoming.payload as { text?: unknown; displayName?: unknown })
                : null;
            if (!payload || typeof payload.text !== "string") {
              return;
            }
            addChatLine({
              id: makeChatId(),
              from: "remote",
              name:
                typeof payload.displayName === "string" && payload.displayName.trim().length > 0
                  ? payload.displayName
                  : "Peer",
              text: payload.text,
              timestamp: Date.now(),
            });
            return;
          }

          if (incoming.type === "error") {
            const payload =
              incoming.payload && typeof incoming.payload === "object"
                ? (incoming.payload as { message?: unknown })
                : null;
            setErrorText(
              payload && typeof payload.message === "string"
                ? payload.message
                : "A signaling error occurred.",
            );
          }
        };

        socket.onerror = () => {
          if (!mountedRef.current) {
            return;
          }
          setErrorText("Lost connection to meeting service. Please reload and retry.");
        };

        socket.onclose = () => {
          if (!mountedRef.current) {
            return;
          }
          if (heartbeatTimerRef.current !== null) {
            clearInterval(heartbeatTimerRef.current);
            heartbeatTimerRef.current = null;
          }
        };
      } catch (error) {
        setErrorText(
          error instanceof Error
            ? error.message
            : "Could not prepare this meeting. Please retry.",
        );
      }
    };

    void setup();

    return () => {
      mountedRef.current = false;

      if (heartbeatTimerRef.current !== null) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }

      const socket = websocketRef.current;
      websocketRef.current = null;
      if (socket) {
        socket.close();
      }

      const peerConnection = peerConnectionRef.current;
      peerConnectionRef.current = null;
      if (peerConnection) {
        peerConnection.close();
      }

      screenTrackRef.current?.stop();
      screenTrackRef.current = null;

      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
    };
  }, [apiBaseUrl, displayName, role, roomId]);

  const onSendChat = () => {
    const socket = websocketRef.current;
    const nextText = chatInput.trim();
    if (!socket || socket.readyState !== WebSocket.OPEN || !nextText) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "chat",
        payload: {
          text: nextText,
          displayName,
        },
      }),
    );

    setChatLines((previous) => [
      ...previous,
      {
        id: makeChatId(),
        from: "local",
        name: displayName,
        text: nextText,
        timestamp: Date.now(),
      },
    ]);
    setChatInput("");
  };

  const toggleMicrophone = () => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    const next = !micEnabled;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMicEnabled(next);
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    const next = !cameraEnabled;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCameraEnabled(next);
  };

  const startScreenShare = async () => {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setErrorText("Screen sharing is not supported in this browser.");
        return;
      }
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) {
        return;
      }
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const [screenTrack] = screenStream.getVideoTracks();
      if (!screenTrack) {
        setErrorText("No screen track was captured.");
        return;
      }

      const videoSender = peerConnection
        .getSenders()
        .find((sender) => sender.track?.kind === "video");
      if (!videoSender) {
        setErrorText("No video sender is available for screen sharing.");
        screenTrack.stop();
        return;
      }

      await videoSender.replaceTrack(screenTrack);
      screenTrackRef.current = screenTrack;
      setScreenSharing(true);
      setStatusText("Screen sharing is on.");

      screenTrack.addEventListener("ended", () => {
        void stopScreenShare();
      });
    } catch {
      setErrorText("Could not start screen sharing.");
    }
  };

  const stopScreenShare = async () => {
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection) {
      return;
    }

    const cameraTrack = cameraTrackRef.current;
    const videoSender = peerConnection
      .getSenders()
      .find((sender) => sender.track?.kind === "video");

    if (cameraTrack && videoSender) {
      await videoSender.replaceTrack(cameraTrack);
    }

    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    setScreenSharing(false);
    setStatusText("Screen sharing is off.");
  };

  const onCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatus("Invite link copied.");
    } catch {
      setCopyStatus("Clipboard is blocked in this tab. Copy the link manually.");
    }
  };

  return (
    <section className="meet-call-shell">
      <header className="meet-call-topbar">
        <div>
          <p className="meet-pill">Meeting code: {roomId}</p>
          <h2>Live meeting</h2>
          <p className="muted">
            Status: <strong>{connectionStatusLabel}</strong>
          </p>
          <p className="muted">{statusText}</p>
        </div>
        <div className="meet-top-actions">
          <button type="button" className="meet-secondary" onClick={() => void onCopyInvite()}>
            Copy invite link
          </button>
          <button type="button" className="meet-danger" onClick={onLeave}>
            Leave meeting
          </button>
        </div>
      </header>

      {copyStatus ? <p className="muted">{copyStatus}</p> : null}
      {errorText ? <p className="error">{errorText}</p> : null}

      <div className={`meet-stage ${chatOpen ? "with-chat" : ""}`}>
        <section className="meet-video-stage">
          {remoteStream ? (
            <video className="meet-remote-video" ref={remoteVideoRef} autoPlay playsInline />
          ) : (
            <div className="meet-remote-placeholder">
              <p>Waiting for the other person to join this link.</p>
            </div>
          )}

          <video className="meet-local-video" ref={localVideoRef} muted autoPlay playsInline />
        </section>

        {chatOpen ? (
          <aside className="meet-chat-panel">
            <h3>Chat</h3>
            <div className="meet-chat-log">
              {chatLines.length === 0 ? <p className="muted">No messages yet.</p> : null}
              {chatLines.map((line) => (
                <article key={line.id} className={`meet-chat-line ${line.from}`}>
                  <strong>{line.from === "local" ? "You" : line.name}</strong>
                  <p>{line.text}</p>
                </article>
              ))}
            </div>
            <div className="meet-chat-compose">
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value.slice(0, 500))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSendChat();
                  }
                }}
                placeholder="Send a message"
              />
              <button type="button" className="meet-secondary" onClick={onSendChat}>
                Send
              </button>
            </div>
          </aside>
        ) : null}
      </div>

      <footer className="meet-control-bar">
        <button type="button" className="meet-control" onClick={toggleMicrophone}>
          {micEnabled ? "Mute" : "Unmute"}
        </button>
        <button type="button" className="meet-control" onClick={toggleCamera}>
          {cameraEnabled ? "Camera off" : "Camera on"}
        </button>
        <button
          type="button"
          className="meet-control"
          onClick={() => void (screenSharing ? stopScreenShare() : startScreenShare())}
        >
          {screenSharing ? "Stop share" : "Share screen"}
        </button>
        <button type="button" className="meet-control" onClick={() => setChatOpen((open) => !open)}>
          {chatOpen ? "Hide chat" : "Chat"}
        </button>
      </footer>
    </section>
  );
}
