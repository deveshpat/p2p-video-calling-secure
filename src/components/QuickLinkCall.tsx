import { useMemo, useState } from "react";
import type { JSX } from "react";
import { CallPage } from "../pages/CallPage";
import { HomePage } from "../pages/HomePage";
import {
  createRoom,
  resolveApiBaseUrl,
} from "../lib/meetingApi";
import {
  clearHostRoomForSession,
  getHostRoomForSession,
  getOrCreateDisplayName,
  markRoomAsCreated,
  saveDisplayName,
  setHostRoomForSession,
} from "../lib/meetingLocalState";
import {
  buildQuickInviteUrl,
  parseAppRouteFromHash,
  sanitizeQuickRoomId,
} from "../lib/quickRoute";

interface QuickLinkCallProps {
  roomId: string | null;
  onRoomChange: (roomId: string | null) => void;
}

function resolveRoomId(rawValue: string): string | null {
  const cleanRoom = sanitizeQuickRoomId(rawValue);
  if (cleanRoom) {
    return cleanRoom;
  }

  try {
    const parsedUrl = new URL(rawValue);
    const route = parseAppRouteFromHash(parsedUrl.hash);
    return route.mode === "quick" ? route.roomId : null;
  } catch {
    return null;
  }
}

export function QuickLinkCall({ roomId, onRoomChange }: QuickLinkCallProps): JSX.Element {
  const [displayName, setDisplayName] = useState(() => getOrCreateDisplayName());
  const [joinInput, setJoinInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");

  const apiBaseUrl = useMemo(() => resolveApiBaseUrl(), []);

  const inviteUrl = useMemo(() => {
    if (!roomId) {
      return "";
    }
    return buildQuickInviteUrl(roomId, {
      origin: window.location.origin,
      pathname: window.location.pathname,
      search: window.location.search,
    });
  }, [roomId]);

  const role = roomId && getHostRoomForSession() === roomId ? "host" : "guest";

  const onCreateMeeting = async () => {
    setBusy(true);
    setErrorText("");
    setStatusText("Creating your new meeting link...");
    try {
      const created = await createRoom(apiBaseUrl);
      markRoomAsCreated(created.roomId);
      setHostRoomForSession(created.roomId);
      onRoomChange(created.roomId);

      const nextInvite = buildQuickInviteUrl(created.roomId, {
        origin: window.location.origin,
        pathname: window.location.pathname,
        search: window.location.search,
      });

      try {
        await navigator.clipboard.writeText(nextInvite);
        setStatusText("Meeting link is ready and copied.");
      } catch {
        setStatusText("Meeting link is ready. Copy it from the call page.");
      }
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : "Could not create the meeting right now.",
      );
    } finally {
      setBusy(false);
    }
  };

  const onJoinMeeting = () => {
    setErrorText("");
    const nextRoomId = resolveRoomId(joinInput.trim());
    if (!nextRoomId) {
      setErrorText("Use a full meeting link or a valid meeting code.");
      return;
    }

    setStatusText("");
    clearHostRoomForSession();
    onRoomChange(nextRoomId);
  };

  const onDisplayNameChange = (nextName: string) => {
    const clean = nextName.trimStart().slice(0, 40);
    setDisplayName(clean);
    if (clean.trim().length > 0) {
      saveDisplayName(clean);
    }
  };

  if (roomId) {
    return (
      <CallPage
        apiBaseUrl={apiBaseUrl}
        roomId={roomId}
        inviteUrl={inviteUrl}
        role={role}
        displayName={displayName || "Guest"}
        onLeave={() => {
          clearHostRoomForSession(roomId);
          onRoomChange(null);
        }}
      />
    );
  }

  return (
    <HomePage
      displayName={displayName}
      onDisplayNameChange={onDisplayNameChange}
      joinInput={joinInput}
      onJoinInputChange={setJoinInput}
      onCreateMeeting={onCreateMeeting}
      onJoinMeeting={onJoinMeeting}
      busy={busy}
      statusText={statusText}
      errorText={errorText}
    />
  );
}
