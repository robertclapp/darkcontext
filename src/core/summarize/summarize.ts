import type { Conversations, HistoryHit } from '../conversations/index.js';
import type { Memory, Memories } from '../memories/index.js';
import type { LLMProvider } from '../llm/index.js';
import { ValidationError } from '../errors.js';

/**
 * `Summarize` collapses search-relevant history into a single LLM-written
 * summary. It does NOT touch the embedding path or expand it into a new
 * vector index — the LLM is layered on top of the existing
 * `Conversations.search()` retrieval.
 *
 * Why combine retrieval + generation in one class:
 *   - Tests can drive the full path with a stub LLM, no real model.
 *   - The retrieval signature stays scope-agnostic (the ScopeFilter
 *     restricts scope at the MCP edge); the LLM call is a pure
 *     transform with no DB writes unless the caller asks for one.
 *   - Saving the summary as a memory is opt-in and routes through
 *     `Memories.remember`, so it inherits FTS + vector indexing.
 */

export interface SummarizeOptions {
  /** What the user wants summarized. Used as the retrieval query and prompt anchor. */
  topic: string;
  /** Restrict retrieval to a single scope. */
  scope?: string;
  /** Restrict to one importer source: 'chatgpt' | 'claude' | 'gemini' | 'generic'. */
  source?: string;
  /** How many history messages to feed the LLM. Default 20, max 100. */
  limit?: number;
  /** Soft cap on output tokens. Default 400. */
  maxTokens?: number;
  /**
   * If true, persist the summary as a memory under `scope` (or the
   * default scope) with kind 'summary'. The memory's `source` is set to
   * `summary:<topic>` for traceability.
   */
  save?: boolean;
}

export interface SummarizeResult {
  topic: string;
  scope: string | null;
  source: string | null;
  summary: string;
  /** Number of history messages actually included in the prompt. */
  sourceCount: number;
  /** Memory id when `save: true` resulted in a write; null otherwise. */
  savedMemoryId: number | null;
  /** LLM provider name, surfaced for the audit trail. */
  provider: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_MAX_TOKENS = 400;
const PROMPT_CONTENT_CAP = 1200;

export class Summarize {
  constructor(
    private readonly conversations: Conversations,
    private readonly memories: Memories,
    private readonly llm: LLMProvider
  ) {}

  async run(opts: SummarizeOptions): Promise<SummarizeResult> {
    const topic = opts.topic.trim();
    if (!topic) throw new ValidationError('topic', 'must not be empty');

    const limit = clampLimit(opts.limit);
    const hits = await this.conversations.search(topic, {
      limit,
      ...(opts.scope ? { scope: opts.scope } : {}),
      ...(opts.source ? { source: opts.source } : {}),
    });

    const prompt = buildPrompt(topic, hits);
    const summary = await this.llm.complete(prompt, {
      maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: 0.2,
    });

    let savedMemoryId: number | null = null;
    if (opts.save) {
      const saved = await this.saveAsMemory(topic, summary, opts.scope);
      savedMemoryId = saved.id;
    }

    return {
      topic,
      scope: opts.scope ?? null,
      source: opts.source ?? null,
      summary,
      sourceCount: hits.length,
      savedMemoryId,
      provider: this.llm.name,
    };
  }

  private async saveAsMemory(topic: string, summary: string, scope?: string): Promise<Memory> {
    return this.memories.remember({
      content: summary,
      kind: 'summary',
      ...(scope ? { scope } : {}),
      source: `summary:${topic}`,
    });
  }
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(raw) || raw <= 0) {
    throw new ValidationError('limit', `must be a positive integer, got ${raw}`);
  }
  return Math.min(raw, MAX_LIMIT);
}

/**
 * Prompt shape: a short instruction header, the topic, then each
 * retrieved message labeled with role + scope. The trailing `INPUT:`
 * marker lets the stub LLM locate the body deterministically; real
 * models ignore it. Each message body is truncated to keep the prompt
 * within a reasonable context window even for long histories.
 */
function buildPrompt(topic: string, hits: HistoryHit[]): string {
  if (hits.length === 0) {
    return [
      'You are summarizing conversation history.',
      `TOPIC: ${topic}`,
      'No relevant history found. Reply with a single sentence saying so.',
      'INPUT:',
      '(no history)',
    ].join('\n');
  }
  const lines: string[] = [
    'You are summarizing conversation history for the user.',
    `TOPIC: ${topic}`,
    'Produce a concise summary (3-5 sentences) of the relevant points across the messages below.',
    'Do not invent details. If the messages disagree, say so.',
    'INPUT:',
  ];
  for (const h of hits) {
    const body = h.content.length > PROMPT_CONTENT_CAP
      ? `${h.content.slice(0, PROMPT_CONTENT_CAP)}…`
      : h.content;
    lines.push(`- [${h.source} / ${h.scope ?? '-'}] ${h.role}: ${body}`);
  }
  return lines.join('\n');
}
