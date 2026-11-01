import { describe, expect, it } from "vitest";
import { nodeSecurity } from "../src/system/node-version.ts";

describe("Node.js security check", () => {
  it("accepts patched versions (positive controls) and flags vulnerable or unsupported ones (negative controls)", () => {
    for (const v of ["22.23.4", "22.24.0", "24.22.1", "24.23.0", "26.12.1"]) expect(nodeSecurity(v).ok, v).toBe(true);
    for (const v of ["22.22.0", "22.23.3", "24.22.0", "26.12.0", "20.19.0", "25.1.0", "23.11.0"]) expect(nodeSecurity(v).ok, v).toBe(false);
    expect(nodeSecurity("22.22.0").message).toMatch(/fixed in 22\.23\.4/);
  });
});
