import { useMemo, useState } from "react";
import type { JSX } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getTransportChunksFromText } from "../lib/signalPacket";

interface PacketShareProps {
  title: string;
  packetText: string;
}

export function PacketShare({ title, packetText }: PacketShareProps): JSX.Element {
  const chunks = useMemo(() => getTransportChunksFromText(packetText), [packetText]);
  const [chunkIndex, setChunkIndex] = useState(0);
  const selectedChunk = chunks[chunkIndex] ?? "";

  const onCopyAll = async () => {
    await navigator.clipboard.writeText(packetText);
  };

  const onCopyCurrentChunk = async () => {
    if (!selectedChunk) {
      return;
    }
    await navigator.clipboard.writeText(selectedChunk);
  };

  return (
    <section className="panel packet-panel">
      <h3>{title}</h3>
      <p className="muted">
        Share this packet as text or QR. If there are multiple chunks, send all chunks in
        order.
      </p>

      <div className="button-row">
        <button type="button" onClick={onCopyAll}>
          Copy Full Packet
        </button>
        <button type="button" onClick={onCopyCurrentChunk} disabled={!selectedChunk}>
          Copy This Chunk
        </button>
      </div>

      <textarea readOnly value={packetText} className="packet-textarea" />

      {selectedChunk ? (
        <div className="qr-block">
          <QRCodeSVG value={selectedChunk} size={220} includeMargin />
          <div className="chunk-controls">
            <button
              type="button"
              onClick={() => setChunkIndex((value) => Math.max(0, value - 1))}
              disabled={chunkIndex === 0}
            >
              Previous Chunk
            </button>
            <span>
              Chunk {chunkIndex + 1} / {chunks.length}
            </span>
            <button
              type="button"
              onClick={() =>
                setChunkIndex((value) => Math.min(chunks.length - 1, value + 1))
              }
              disabled={chunkIndex >= chunks.length - 1}
            >
              Next Chunk
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
