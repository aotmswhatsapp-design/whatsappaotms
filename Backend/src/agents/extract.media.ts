import { Injectable } from "@nestjs/common";

import { ExtractError } from "./ai.errors";
import { OpenAiProvider } from "./ai.openai";
import { extensionOf } from "./extract";

/** Whisper's own list: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm. */
const AUDIO_MIMES = new Set([
  "audio/flac",
  "audio/m4a",
  "audio/mp3",
  "audio/mp4",
  "audio/mpeg",
  "audio/mpga",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
]);

const IMAGE_MIMES = new Set([
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

/** When Meta or a browser sends no mime, the extension decides. */
const MIME_BY_EXTENSION: Record<string, string> = {
  flac: "audio/flac",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  png: "image/png",
  wav: "audio/wav",
  webm: "audio/webm",
  webp: "image/webp",
};

/**
 * The one place an image or a voice note becomes text.
 *
 * Both halves are the same OpenAI key as the reply engine: vision is the
 * agent's own chat model (it is multimodal — verified), and transcription is
 * `whisper-1`. Video is refused here rather than accepted and dropped.
 */
@Injectable()
export class OpenAiMediaExtractor {
  constructor(private readonly provider: OpenAiProvider) {}

  async read(input: {
    bytes: Buffer;
    mime: string;
    name: string;
    /** The agent's model, so vision is read by the model that will answer. */
    model: string;
  }): Promise<{ text: string }> {
    const mime = this.mimeOf(input);

    if (IMAGE_MIMES.has(mime) || mime.startsWith("image/")) {
      const result = await this.provider.describeImage({
        bytes: input.bytes,
        mime,
        model: input.model,
      });

      return { text: result.text };
    }

    if (mime.startsWith("video/")) {
      throw new ExtractError(
        "SOURCE_UNSUPPORTED",
        "Video training arrives in a later release. Upload a document, an image or a voice note for now.",
      );
    }

    if (AUDIO_MIMES.has(mime) || mime.startsWith("audio/")) {
      if (!AUDIO_MIMES.has(mime)) {
        throw new ExtractError(
          "SOURCE_UNSUPPORTED",
          `Whisper cannot read ${mime}. Convert the recording to mp3, m4a, ogg or wav and upload that.`,
        );
      }

      return this.provider.transcribe({
        bytes: input.bytes,
        mime,
        name: input.name,
      });
    }

    throw new ExtractError(
      "SOURCE_UNSUPPORTED",
      "That file type is not one the agent can read.",
    );
  }

  private mimeOf(input: { mime: string; name: string }): string {
    const declared = input.mime.toLowerCase().split(";")[0].trim();

    if (declared.includes("/")) return declared;

    return MIME_BY_EXTENSION[extensionOf(input.name)] ?? "";
  }
}
