"use client";
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import type { rebuildDerivedState } from "@/lib/engine";
import type { Snapshot } from "@/lib/types";

export function DataExport({
  data,
  derived,
  preview,
}: {
  data: Snapshot;
  derived: ReturnType<typeof rebuildDerivedState>;
  preview: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<{
    url: string;
    file: File;
    share: boolean;
  } | null>(null);
  const running = useRef(false);
  useEffect(
    () => () => {
      if (ready) URL.revokeObjectURL(ready.url);
    },
    [ready],
  );
  async function prepare() {
    if (running.current || preview) return;
    running.current = true;
    setBusy(true);
    setError("");
    setReady(null);
    try {
      const [{ readExportData }, { createExportWorkbook }] = await Promise.all([
        import("@/lib/export-data"),
        import("@/lib/export-workbook"),
      ]);
      const sources = await readExportData(db(), data);
      const { blob, filename } = await createExportWorkbook(sources, derived);
      const file = new File([blob], filename, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(file);
      setReady({
        url,
        file,
        share: Boolean(navigator.canShare?.({ files: [file] })),
      });
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      setError(
        e instanceof Error &&
          /refresh|read|export|Sign in|file was created/i.test(e.message)
          ? e.message
          : "Could not prepare the spreadsheet. No data was changed. Please try again.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="card settings-card" style={{ gridColumn: "1 / -1" }}>
      <h3>
        <Download size={20} /> Data Export
      </h3>
      <p className="hint">
        Download your complete TeslaTrack history as a spreadsheet compatible
        with Google Sheets.
      </p>
      <div className="button-row">
        <button
          className="button dark"
          disabled={busy || preview}
          onClick={() => void prepare()}
          aria-busy={busy}
        >
          {busy ? "Preparing spreadsheet…" : "Export All Data (.xlsx)"}
        </button>
      </div>
      {preview && (
        <p className="hint">Sign in to export your saved household data.</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {ready && (
        <div role="status">
          <p className="hint">
            Your spreadsheet is ready. If the download did not start, use the
            link below. On iPhone, you can save the file to Files or share it.
          </p>
          <a
            className="button secondary"
            href={ready.url}
            download={ready.file.name}
          >
            Download prepared file
          </a>
          {ready.share && (
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await navigator.share({ files: [ready.file] });
                } catch (e) {
                  if (!(e instanceof Error && e.name === "AbortError"))
                    setError(
                      "Sharing is unavailable. Use Download prepared file, or open this page in Safari and try again.",
                    );
                }
              }}
            >
              Save or share file
            </button>
          )}
        </div>
      )}
    </section>
  );
}
