import { isJsonSnapshot } from "@si-arena/protocol";

export function readRecord(
  raw: unknown,
  required: readonly string[],
  label: string,
): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new TypeError(`${label} must be an object`);
  const keys = Object.keys(raw);
  if (
    required.some((key) => !Object.hasOwn(raw, key)) ||
    keys.some((key) => !required.includes(key))
  )
    throw new TypeError(`${label} has missing or unexpected fields`);
  return raw as Record<string, unknown>;
}

export function readInteger(raw: unknown, min: number, max: number, label: string): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < min || raw > max)
    throw new TypeError(`Invalid ${label}`);
  return raw;
}

export function readId(raw: unknown): string {
  if (typeof raw !== "string" || !raw.length) throw new TypeError("Invalid id");
  return raw;
}

export function readRange(raw: unknown, min: number, max: number, label: string): unknown[] {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max)
    throw new TypeError(`${label} must hold between ${min} and ${max} entries`);
  return raw;
}

/** Dense data arrays: a snapshot passes through, anything else is checked element by element. */
export function readArray(raw: unknown, length: number, label: string): unknown[] {
  if (Array.isArray(raw) && raw.length === length && isJsonSnapshot(raw)) return raw;
  if (!Array.isArray(raw) || raw.length !== length || Reflect.ownKeys(raw).length !== length + 1)
    throw new TypeError(`${label} must be a dense array of length ${length}`);
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, index);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value"))
      throw new TypeError(`${label} must contain only data elements`);
  }
  return raw;
}
