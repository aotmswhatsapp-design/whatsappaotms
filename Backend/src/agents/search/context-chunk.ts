/**
 * One passage of training material, as every engine returns it.
 *
 * It is deliberately vendor-free: nothing here is a vector, and nothing here
 * is a prompt. An engine's whole job is to choose rows of this shape, so the
 * cosine engine and the local engine are interchangeable at the seam.
 */
export interface ContextChunk {
  id: string;
  text: string;
  sourceId: string;
  title: string;
  /** What the upload proved the file is (see `knowledge.file.ts`). A citation
   *  decides "CSV" by this, never by the sheet name: a workbook can hold a
   *  worksheet called "CSV". */
  mime: string | null;
  /** Cosine similarity for the vector engine; match confidence for the local
   *  one. Both are 0 to 1, and the two are not comparable with each other. */
  score: number;
  /** 1-based PDF page, when the extractor recorded one. */
  page: number | null;
  /** CSV/XLSX sheet name, when the chunk came from a table. */
  sheet: string | null;
  /** First and last row this chunk covers, in the file's own numbering: a
   *  physical worksheet row for XLSX, a logical record number for CSV (blank
   *  records count, the header does not). Null when the chunk is not tabular. */
  rowFrom: number | null;
  rowTo: number | null;
  /** Nearest preceding heading (DOCX, Markdown). */
  heading: string | null;
}
