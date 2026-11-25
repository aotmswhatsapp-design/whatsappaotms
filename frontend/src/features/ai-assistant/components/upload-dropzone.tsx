"use client";

import * as React from "react";
import { Loader2, UploadCloud } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { ApiError, uploadSource } from "../api";
import type { Source } from "../types";

/** The same ceiling the server enforces; this copy only fails faster. */
const MAX_BYTES = 25 * 1024 * 1024;

/** What the file picker offers. A drag bypasses it and the server decides. */
const ACCEPT = [
  ".txt",
  ".md",
  ".csv",
  ".docx",
  ".xlsx",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".ogg",
  ".mp3",
  ".m4a",
  ".wav",
  ".opus",
].join(",");

/**
 * One file, up to 25 MB, indexed in the background.
 *
 * The upload itself is fast — the bytes go to Storage and a PENDING row is
 * written. Extraction, chunking and embedding happen on the runner, which is
 * why this component reports "indexing started" rather than "trained".
 */
export function UploadDropzone({
  agentId,
  onUploaded,
}: {
  agentId: string;
  onUploaded: (source: Source) => void;
}) {
  const toast = useToast();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  async function send(file: File) {
    if (busy) return;

    if (file.size > MAX_BYTES) {
      toast.push({
        title: "Too large",
        description: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB.`,
        tone: "error",
      });
      return;
    }

    setBusy(true);

    try {
      const { source } = await uploadSource(agentId, file);
      onUploaded(source);
      toast.push({
        title: "Indexing started",
        description: `${source.title} is being read now.`,
        tone: "success",
      });
    } catch (caught) {
      toast.push({
        title: "Could not add the file",
        description:
          caught instanceof ApiError
            ? caught.message
            : "The file could not be uploaded.",
        tone: "error",
      });
    } finally {
      setBusy(false);

      // Cleared so choosing the same file again still fires a change.
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
        dragging
          ? "border-brand bg-brand-soft"
          : "border-border bg-card/60 hover:border-brand/40",
        busy && "opacity-70",
      )}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);

        const file = event.dataTransfer.files[0];
        if (file) void send(file);
      }}
    >
      <input
        accept={ACCEPT}
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void send(file);
        }}
        ref={input}
        type="file"
      />

      <button
        className="mx-auto flex flex-col items-center gap-2 text-center focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none"
        disabled={busy}
        onClick={() => input.current?.click()}
        type="button"
      >
        <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
          {busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <UploadCloud className="size-5" aria-hidden="true" />
          )}
        </span>
        <span className="text-[13px] font-medium text-foreground">
          {busy ? "Uploading…" : "Drop a file, or choose one"}
        </span>
        <span className="max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
          PDF, Word, Excel, CSV, text, images and voice notes up to 25 MB. Text
          is read from the file; an image is described; audio is transcribed.
        </span>
      </button>
    </div>
  );
}
