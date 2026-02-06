import type { JSX } from "react";

interface HomePageProps {
  displayName: string;
  onDisplayNameChange: (nextName: string) => void;
  joinInput: string;
  onJoinInputChange: (value: string) => void;
  onCreateMeeting: () => Promise<void>;
  onJoinMeeting: () => void;
  busy: boolean;
  statusText: string;
  errorText: string;
}

export function HomePage({
  displayName,
  onDisplayNameChange,
  joinInput,
  onJoinInputChange,
  onCreateMeeting,
  onJoinMeeting,
  busy,
  statusText,
  errorText,
}: HomePageProps): JSX.Element {
  return (
    <section className="meet-home-shell">
      <div className="meet-home-card">
        <p className="meet-pill">Simple 1:1 calling</p>
        <h2>Video calls that feel like Meet</h2>
        <p className="muted">
          Start a new meeting link in one click, then send the link.
        </p>

        <label className="meet-input-label">
          Your name
          <input
            value={displayName}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            placeholder="Guest name"
            autoComplete="name"
          />
        </label>

        <div className="meet-home-actions">
          <button
            type="button"
            className="meet-primary"
            onClick={() => void onCreateMeeting()}
            disabled={busy}
          >
            New meeting
          </button>
        </div>

        <div className="meet-join-row">
          <input
            value={joinInput}
            onChange={(event) => onJoinInputChange(event.target.value)}
            placeholder="Enter a meeting code or full meeting link"
            autoComplete="off"
          />
          <button type="button" className="meet-secondary" onClick={onJoinMeeting} disabled={busy}>
            Join
          </button>
        </div>

        {statusText ? <p className="muted">{statusText}</p> : null}
        {errorText ? <p className="error">{errorText}</p> : null}
      </div>
    </section>
  );
}
