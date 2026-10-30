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
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label} must contain only enumerable data properties`);
    }
  }
  return raw;
}

/** 有限且落在闭区间内的整数。 */
export function readInteger(raw: unknown, min: number, max: number, label: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max)
    throw new TypeError(`${label} must be an integer between ${min} and ${max}`);
  return raw;
}

/** 有限且落在闭区间内的数。 */
export function readNumber(raw: unknown, min: number, max: number, label: string): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < min || raw > max)
    throw new TypeError(`${label} must be a finite number between ${min} and ${max}`);
  return raw;
}

/** 1..32 的可见 ASCII 玩家 id。 */
export function readId(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 32)
    throw new TypeError("Id must be a string of 1..32 characters");
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) throw new TypeError("Id must be printable ASCII");
  }
  return raw;
}
