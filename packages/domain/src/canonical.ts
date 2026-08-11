import { createHash } from "node:crypto";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

export class DomainError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "DomainError";
  }
}
function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new DomainError("INVALID_UNICODE");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new DomainError("INVALID_UNICODE");
    }
  }
}


function assertJson(value: unknown, seen: Set<object>): asserts value is JsonValue {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    assertValidUnicode(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DomainError("INVALID_JSON_VALUE");
    return;
  }
  if (typeof value !== "object") throw new DomainError("INVALID_JSON_VALUE");
  if (seen.has(value)) throw new DomainError("INVALID_JSON_VALUE", "cyclic JSON value");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJson(item, seen);
  } else {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) throw new DomainError("INVALID_JSON_VALUE");
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) throw new DomainError("INVALID_JSON_VALUE");
    for (const key of keys as string[]) {
      assertValidUnicode(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new DomainError("INVALID_JSON_VALUE");
      assertJson(descriptor.value, seen);
    }
  }
  seen.delete(value);
}

export function assertJsonValue(value: unknown): asserts value is JsonValue {
  assertJson(value, new Set());
}

function serialize(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "0" : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${serialize(value[key] as JsonValue)}`).join(",")}}`;
}

/** RFC 8785-compatible serialization for the I-JSON subset accepted by Horseness. */
export function canonicalJson(value: unknown): string {
  assertJsonValue(value);
  return serialize(value);
}

export function sha256Hex(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function domainDigest(domain: string, value: unknown): string {
  return sha256Hex(`${domain}\0${canonicalJson(value)}`);
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
export function lowercaseBase32NoPadding(bytes: Uint8Array): string {
  let bits = 0;
  let accumulator = 0;
  let output = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32[(accumulator >>> bits) & 31];
    }
  }
  if (bits > 0) output += BASE32[(accumulator << (5 - bits)) & 31];
  return output;
}

export function digestId(prefix: string, digest: string): string {
  return `${prefix}${lowercaseBase32NoPadding(Buffer.from(digest, "hex"))}`;
}

export function jsonValueDigest(value: JsonValue): string {
  return domainDigest("horseness.json-value.v1", value);
}

export function deepClone<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
