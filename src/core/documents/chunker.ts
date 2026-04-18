export interface ChunkOptions {
  /** Target characters per chunk. Default 1200 (~300 tokens). */
  size?: number;
  /** Overlap characters between adjacent chunks. Default 150. */
  overlap?: number;
}

/**
 * Split text into overlapping chunks on paragraph/sentence boundaries when
 * possible, falling back to hard character cuts. Deliberately simple — a
 * smarter tokenizer-aware splitter can replace this behind the same API.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const size = opts.size ?? 1200;
  const overlap = opts.overlap ?? 150;
  if (size <= 0) throw new Error('chunk size must be positive');
  if (overlap < 0 || overlap >= size) throw new Error('overlap must be in [0, size)');

  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= size) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + size, normalized.length);
    let cut = end;
    if (end < normalized.length) {
      // Prefer paragraph, then sentence, then whitespace boundaries.
      const window = normalized.slice(start, end);
      const paragraph = window.lastIndexOf('\n\n');
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
      const space = window.lastIndexOf(' ');
      const pick = paragraph > size * 0.4 ? paragraph : sentence > size * 0.4 ? sentence : space > size * 0.6 ? space : -1;
      if (pick > 0) cut = start + pick + 1;
    }
    const slice = normalized.slice(start, cut).trim();
    if (slice.length > 0) chunks.push(slice);
    if (cut >= normalized.length) break;
    start = Math.max(cut - overlap, start + 1);
  }
  return chunks;
}
