import type { NewConnectorEvent } from "@ultron/memory";

/** What a connector can do; UI and tools only offer what's declared (blueprint §17.1). */
export type CapabilityFlag = "READ_FEED" | "READ_DETAILS" | "SEARCH" | "DRAFT" | "WRITE" | "WEBHOOK";

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly code: "auth" | "rate_limited" | "not_found" | "unavailable" | "not_supported" | "bad_request",
    readonly retryAt?: string,
  ) {
    super(message);
  }
}

export interface SyncResult {
  events: NewConnectorEvent[];
  cursor: Record<string, string>;
}
