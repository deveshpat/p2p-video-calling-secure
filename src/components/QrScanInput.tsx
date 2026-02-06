import { useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface QrScanInputProps {
  onDecoded: (value: string) => void;
}

export function QrScanInput({ onDecoded }: QrScanInputProps): JSX.Element {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("Scanner is idle.");
  const scannerElementId = useMemo(
    () => `qr-reader-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );
  const scannerInstanceRef = useRef<Html5Qrcode | null>(null);

  const stopScan = async () => {
    if (!scannerInstanceRef.current) {
      setActive(false);
      return;
    }
    try {
      await scannerInstanceRef.current.stop();
      await scannerInstanceRef.current.clear();
    } catch {
      // No action needed if scanner is already stopped.
    } finally {
      scannerInstanceRef.current = null;
      setActive(false);
      setStatus("Scanner stopped.");
    }
  };

  const startScan = async () => {
    if (active) {
      return;
    }

    const scanner = new Html5Qrcode(scannerElementId);
    scannerInstanceRef.current = scanner;

    try {
      setActive(true);
      setStatus("Starting camera...");
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decodedText) => {
          onDecoded(decodedText);
          setStatus("QR chunk captured.");
          await stopScan();
        },
        () => {
          // Frame decode misses are normal during scanning.
        },
      );
      setStatus("Point the camera at a packet QR.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Could not start scanner: ${error.message}`
          : "Could not start scanner.",
      );
      await stopScan();
    }
  };

  return (
    <section className="panel">
      <h3>Scan Packet QR</h3>
      <p className="muted">Scan one chunk at a time. Repeat until all chunks are captured.</p>
      <div className="button-row">
        <button type="button" onClick={startScan} disabled={active}>
          Start Scanner
        </button>
        <button type="button" onClick={() => void stopScan()} disabled={!active}>
          Stop Scanner
        </button>
      </div>
      <p className="muted">{status}</p>
      <div id={scannerElementId} className="qr-reader-box" />
    </section>
  );
}
