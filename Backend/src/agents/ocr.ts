import { Logger } from "@nestjs/common";
import { tmpdir } from "node:os";

const logger = new Logger("Ocr");

/**
 * Reading a page that has no text layer.
 *
 * A scan is a picture of a page. The only way to its words is to draw the page
 * and read the drawing, which takes two pieces: `pdfjs-dist` rasterises (it
 * already parses these files for their text layer) and `tesseract.js` reads
 * the pixels. Both run in this process — tesseract is WebAssembly on a worker
 * thread, and `@napi-rs/canvas` ships a prebuilt binary — so the Render build
 * still installs and compiles nothing.
 *
 * This module only turns page numbers into text. Which pages need it, and what
 * happens to the result, belong to the caller in `extract.ts`.
 */

/** Dots per inch the page is drawn at. 200 is the floor at which body text in
 *  a normal scan is reliably read; 300 doubles the pixels for a gain a
 *  brochure of 11pt text does not need. */
export const OCR_DPI = 200;

/** The most pixels one page may be drawn at. A poster at 200 DPI would
 *  otherwise be a gigabyte of RGBA, and nothing in this file would notice. */
const MAX_PIXELS = 20_000_000;

/**
 * An engine that reads one drawn page.
 *
 * Behind an interface because the extraction tests drive the page selection
 * and the merge without loading a model: the real reader is what needs a
 * download and a core, and neither belongs in a unit test.
 */
export interface OcrReader {
  /** The words on one page, drawn as a PNG. */
  read(png: Buffer): Promise<string>;
  /** Release the worker and its model. Always called, failure or not. */
  stop(): Promise<void>;
}

/**
 * A reader backed by tesseract.js.
 *
 * One worker is created per document and reused for its pages: loading the
 * model costs seconds, reading a page costs one. The language model itself is
 * fetched once per machine into the temp directory and reused from there —
 * Render's disk does not survive a deploy, so "once per machine" is honest
 * about what it means.
 */
export async function tesseractReader(language: string): Promise<OcrReader> {
  const { createWorker } = await import("tesseract.js");

  const worker = await createWorker(language, undefined, {
    cachePath: tmpdir(),
  });

  return {
    read: async (png) => (await worker.recognize(png)).data.text,
    stop: async () => {
      await worker.terminate();
    },
  };
}

/** The part of a Skia canvas this module uses, so the factory can stay typed
 *  without importing the module at the top of a file that may never render. */
type SkiaCanvas = {
  width: number;
  height: number;
  getContext: (kind: "2d") => unknown;
  toBuffer: (mime: "image/png") => Buffer;
};

/**
 * pdfjs draws an image through a canvas factory, and its Node factory reaches
 * for node-canvas — a module that compiles against cairo and would break a
 * plain `npm ci`. These are the three methods that factory has to have, over a
 * Skia canvas instead.
 */
function skiaCanvasFactory(create: (width: number, height: number) => SkiaCanvas) {
  return {
    create(width: number, height: number) {
      const canvas = create(Math.max(1, width), Math.max(1, height));
      return { canvas, context: canvas.getContext("2d") };
    },
    reset(
      entry: { canvas: { width: number; height: number } },
      width: number,
      height: number,
    ) {
      entry.canvas.width = width;
      entry.canvas.height = height;
    },
    destroy(entry: { canvas: { width: number; height: number } | null }) {
      if (!entry.canvas) return;

      // Freed the way pdfjs's own factories free one: the pixels go with it.
      entry.canvas.width = 0;
      entry.canvas.height = 0;
      entry.canvas = null;
    },
  };
}

/**
 * Draw the named pages and read each one.
 *
 * The text layer is parsed twice when a document is half scanned: once to find
 * out which pages speak for themselves, and once here to draw the rest. It is
 * the price of keeping page selection and rendering in separate files, and a
 * scanned page is an image, so the second parse is cheap.
 *
 * Pages come back keyed by their own number, never by their position in the
 * list, so a citation still names the page the words are printed on.
 */
export async function ocrPages(
  bytes: Buffer,
  pages: number[],
  reader: OcrReader,
): Promise<Map<number, string>> {
  const pdfjs = await import("pdfjs-dist");
  const skia = await import("@napi-rs/canvas");

  const newCanvas = (width: number, height: number) =>
    skia.createCanvas(width, height) as unknown as SkiaCanvas;

  // pdfjs fills both of these from node-canvas, which is not installed. Its
  // own check warns and moves on, and only shading and clipping care — but a
  // warning per document is noise, and Skia's versions are the same shapes.
  const scope = globalThis as unknown as { DOMMatrix?: unknown; Path2D?: unknown };
  scope.DOMMatrix ??= skia.DOMMatrix;
  scope.Path2D ??= skia.Path2D;

  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    canvasFactory: skiaCanvasFactory(newCanvas),
  });

  const out = new Map<number, string>();

  try {
    const document = await task.promise;

    for (const number of pages) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: scaleFor(page.getViewport({ scale: 1 })) });

      const canvas = newCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));

      try {
        const context = canvas.getContext("2d") as {
          fillStyle: string;
          fillRect: (x: number, y: number, width: number, height: number) => void;
        };

        // A scan is paper: drawn on a transparent canvas, a page whose own
        // background is missing reads as light text on nothing.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);

        const render = page.render({
          canvasContext: context,
          viewport,
        } as unknown as Parameters<typeof page.render>[0]);

        await render.promise;

        out.set(number, await reader.read(canvas.toBuffer("image/png")));
      } finally {
        // Native pixels do not belong to the JS heap, so nothing collects this
        // page's while the next one is drawn — and a page at the pixel ceiling
        // is some 80 MB of them. Zeroing the canvas is how pdfjs's own factory
        // frees one, and here it happens per page rather than per document.
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
  } catch (error) {
    logger.warn(
      `Could not draw pages ${pages.join(", ")}: ${error instanceof Error ? error.message : "unknown failure"}`,
    );

    throw error;
  } finally {
    await task.destroy();
  }

  return out;
}

/** The asked-for scale, lowered only when the page would be larger than the
 *  pixel ceiling — a poster, not a document. */
function scaleFor(base: { width: number; height: number }): number {
  const wanted = OCR_DPI / 72;
  const area = base.width * base.height;

  if (area <= 0) return wanted;

  return Math.min(wanted, Math.sqrt(MAX_PIXELS / area));
}