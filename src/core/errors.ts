/**
 * DarkContext error hierarchy.
 *
 * Every expected failure path throws one of these. Unexpected failures use
 * plain `Error` (or whatever the underlying library throws) and bubble up
 * as a generic `internal` at the MCP/CLI boundary.
 *
 *   DarkContextError          abstract base
 *   ├─ NotFoundError          entity with that id / name doesn't exist
 *   ├─ ConflictError          unique constraint / duplicate
 *   ├─ ValidationError        caller-provided input is malformed
 *   ├─ ScopeDeniedError       caller may not read/write that scope
 *   ├─ AuthError              bearer token missing / bad / unregistered
 *   ├─ ImporterParseError     importer could not parse the input
 *   └─ ConfigError            environment / CLI flags are wrong
 *
 * Code should match by type (`err instanceof NotFoundError`) rather than
 * by message string. The MCP audit layer uses the type to classify the
 * outcome structurally (denied vs. error) rather than by text-matching.
 */

export abstract class DarkContextError extends Error {
  public override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    if (cause !== undefined) this.cause = cause;
  }
}

export class NotFoundError extends DarkContextError {
  constructor(public readonly entity: string, public readonly key: string | number) {
    super(`${entity} not found: ${key}`);
  }
}

export class ConflictError extends DarkContextError {
  constructor(public readonly entity: string, public readonly key: string) {
    super(`${entity} already exists: ${key}`);
  }
}

export class ValidationError extends DarkContextError {
  constructor(public readonly field: string, reason: string) {
    super(`invalid ${field}: ${reason}`);
  }
}

export class AuthError extends DarkContextError {}

export class ConfigError extends DarkContextError {}

export class ImporterParseError extends DarkContextError {
  constructor(message: string, public readonly source: string) {
    super(`[${source}] ${message}`);
  }
}

export class ScopeDeniedError extends DarkContextError {
  constructor(
    message: string,
    public readonly kind: 'read' | 'write',
    public readonly scope: string
  ) {
    super(message);
  }
}
