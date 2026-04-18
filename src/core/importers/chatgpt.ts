import type { ImportedConversation, ImportedMessage } from '../conversations/types.js';
import { Importer, ImporterParseError, toEpochMs } from './importer.js';

interface RawMessage {
  id?: string;
  author?: { role?: string };
  content?: { parts?: unknown[]; content_type?: string };
  create_time?: number | null;
}

interface RawNode {
  id: string;
  message?: RawMessage | null;
  parent?: string | null;
  children?: string[];
}

interface RawConversation {
  id?: string;
  title?: string;
  create_time?: number | string | null;
  mapping?: Record<string, RawNode>;
}

/**
 * ChatGPT `conversations.json` exporter. Each conversation has a `mapping`
 * tree keyed by node id; we linearize it by DFS from the root (the node with
 * no parent), preserving chronological order. Assistant-authored tool calls
 * and system messages are preserved unless the content is empty.
 */
export class ChatGPTImporter implements Importer {
  readonly source = 'chatgpt';

  parse(raw: string): ImportedConversation[] {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new ImporterParseError(`invalid JSON: ${(err as Error).message}`, this.source);
    }
    if (!Array.isArray(data)) {
      throw new ImporterParseError(
        'expected a top-level array of conversations (conversations.json)',
        this.source
      );
    }

    const out: ImportedConversation[] = [];
    for (const item of data as RawConversation[]) {
      if (!item || !item.mapping) continue;
      const messages = linearize(item.mapping);
      if (messages.length === 0) continue;
      out.push({
        ...(item.id ? { externalId: item.id } : {}),
        title: (item.title ?? '(untitled conversation)').trim() || '(untitled conversation)',
        startedAt: toEpochMs(item.create_time ?? messages[0]?.ts),
        messages,
      });
    }
    return out;
  }
}

function linearize(mapping: Record<string, RawNode>): ImportedMessage[] {
  // Find the root — a node with a null/undefined parent, or whose parent isn't
  // in the mapping (defensive against corrupted exports).
  const roots = Object.values(mapping).filter((n) => !n.parent || !mapping[n.parent]);
  if (roots.length === 0) return [];
  const root = roots[0]!;

  const order: string[] = [];
  const visit = (id: string): void => {
    const node = mapping[id];
    if (!node) return;
    order.push(id);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root.id);

  const out: ImportedMessage[] = [];
  for (const id of order) {
    const node = mapping[id];
    const msg = node?.message;
    if (!msg) continue;
    const parts = msg.content?.parts ?? [];
    const text = parts
      .filter((p): p is string => typeof p === 'string')
      .join('\n')
      .trim();
    if (!text) continue;
    out.push({
      role: msg.author?.role ?? 'assistant',
      content: text,
      ts: toEpochMs(msg.create_time ?? null),
    });
  }
  return out;
}
