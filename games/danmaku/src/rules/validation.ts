import { isJsonSnapshot } from "@si-arena/protocol";

/** Validate data properties before reading them; accessors are not part of the JSON contract. */
export function readRecord(
  raw: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actualKeys = Reflect.ownKeys(raw);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    throw new TypeError(`${label} has missing or unexpected fields`);
  }
  // Snapshots were already checked for data properties when they were taken.
  if (isJsonSnapshot(raw)) return raw as Record<string, unknown>;
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label} must contain only enumerable data properties`);
    }
  }
  return raw as Record<string, unknown>;
}

export function readArray(raw: unknown, length: number, label: string): unknown[] {
  if (Array.isArray(raw) && raw.length === length && isJsonSnapshot(raw)) return raw;
  if (!Array.isArray(raw) || raw.length !== length || Reflect.ownKeys(raw).length !== length + 1) {
    throw new TypeError(`${label} must be a dense array of length ${length}`);
  }
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, index);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label} must contain only data elements`);
    }
  }
  return raw;
}

export function readId(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0)
    throw new TypeError("Player ID must be a nonempty string");
  return raw;
}

export function readInteger(raw: unknown, min: number, max: number, label: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new TypeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return raw;
}
