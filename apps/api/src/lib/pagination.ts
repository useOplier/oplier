import { ApiError } from "@oplier/shared-types";

/**
 * Opaque cursor encoding a (timestamp, id) pair, used for GET /activity's keyset pagination.
 * Keyset (not OFFSET) pagination so results stay correct as new transactions are inserted
 * between page fetches — important for a screen a user may leave open while a System executes.
 */
export interface Cursor {
  timestamp: string; // ISO 8601
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed.timestamp !== "string" || typeof parsed.id !== "string") {
      throw new Error("malformed cursor payload");
    }
    return parsed as Cursor;
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Invalid pagination cursor.");
  }
}
