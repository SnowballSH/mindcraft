export const SCHEMA_VERSION = 1;

export function nowMs() {
  return Date.now();
}

export function makeEvent(type, data) {
  return {
    schema_version: SCHEMA_VERSION,
    type,
    ts: nowMs(),
    ...data,
  };
}


