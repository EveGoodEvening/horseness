export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type CliResultV1 =
  | { readonly schemaVersion: "1"; readonly ok: true; readonly command: string; readonly data: JsonValue }
  | {
      readonly schemaVersion: "1";
      readonly ok: false;
      readonly command: string;
      readonly error: { readonly code: string; readonly message: string; readonly details: JsonValue | null };
    };

const SECRET_KEY = /(?:authorization|bootstrap|credential|password|passwd|private[-_]?key|recovery|secret|token)/iu;
const SECRET_VALUE = /(?:bearer\s+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:authorization|bootstrap|credential|password|passwd|private[-_]?key|recovery|secret|token)\b|\b(?:gh[pousr]_|sk[_-]|xox[baprs]-)[A-Za-z0-9_-]+)/iu;
const REDACTED = "[REDACTED]" as const;

export function redactCliValueV1(value: JsonValue, secretKeys: readonly string[] = []): JsonValue {
  const explicit = new Set(secretKeys.map((key) => key.toLowerCase()));
  function visit(current: JsonValue, key?: string): JsonValue {
    if (key !== undefined && (explicit.has(key.toLowerCase()) || SECRET_KEY.test(key))) return REDACTED;
    if (typeof current === "string" && key !== "command") return SECRET_VALUE.test(current) ? REDACTED : current;
    if (Array.isArray(current)) return current.map((item) => visit(item));
    if (current !== null && typeof current === "object") {
      const redacted: Record<string, JsonValue> = {};
      for (const childKey of Object.keys(current).sort()) {
        redacted[childKey] = visit((current as Readonly<Record<string, JsonValue>>)[childKey] ?? null, childKey);
      }
      return redacted;
    }
    return current;
  }
  return visit(value);
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize((value as Readonly<Record<string, JsonValue>>)[key] ?? null);
    }
    return sorted;
  }
  return value;
}

export function cliSuccessV1(command: string, data: JsonValue): CliResultV1 {
  return { schemaVersion: "1", ok: true, command, data };
}

export function cliFailureV1(command: string, code: string, message: string, details: JsonValue | null): CliResultV1 {
  return { schemaVersion: "1", ok: false, command, error: { code, message, details } };
}

export function renderCliJsonV1(result: CliResultV1, secretKeys: readonly string[] = []): string {
  const safe = redactCliValueV1(result as unknown as JsonValue, secretKeys);
  return `${JSON.stringify(canonicalize(safe))}\n`;
}
export function renderCliHumanV1(result: CliResultV1, secretKeys: readonly string[] = []): string {
  const safe = redactCliValueV1(result as unknown as JsonValue, secretKeys) as unknown as CliResultV1;
  if (!safe.ok) {
    const details = safe.error.details === null ? "" : `\n${JSON.stringify(canonicalize(safe.error.details), null, 2)}`;
    return `${safe.command}: ${safe.error.code}: ${safe.error.message}${details}\n`;
  }
  if (safe.data === null) return `${safe.command}: ok\n`;
  if (typeof safe.data === "string") return `${safe.data}\n`;
  return `${JSON.stringify(canonicalize(safe.data), null, 2)}\n`;
}
