import { describe, expect, it } from "vitest";
import { shield } from "../src/shield.ts";

describe("privacy shield (cloud brains only)", () => {
  it("hides secrets but leaves ordinary text alone", () => {
    expect(shield("my card is 4111 1111 1111 1111, expires 12/28").text).toBe("my card is [card number hidden], expires 12/28");
    expect(shield("password: hunter2 and pin is 4821").text).toBe("password: [hidden] and pin is [hidden]");
    expect(shield("key sk-ant-api03-abcdefghijklmnop1234 please").text).toBe("key [secret key hidden] please");
    expect(shield("SSN 123-45-6789").text).toBe("SSN [ID number hidden]");
    expect(shield("IBAN GB82 WEST 1234 5698 7654 32").text).toBe("IBAN [bank account hidden]");
    const plain = "Order 1234567890123 shipped; call 555-123-4567 at 3pm; it costs $1,299.";
    expect(shield(plain)).toEqual({ text: plain, hidden: 0 });
  });
});
