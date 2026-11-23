import { describe, it, expect } from "vitest";
import { appMemoryPct, appMemoryCeiling } from "../../src/utils/dashboardMetrics.js";

// Regression: the dashboard's app-memory gauge used to divide heapUsed by
// heapTotal. V8's GC keeps live usage NEAR the allocated heap by design, so
// a perfectly healthy process read 85-95% and the gauge was permanently red.
describe("appMemoryPct", () => {
  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;

  it("measures the heap against the V8 heap limit, not heapTotal", () => {
    // The exact shape from the user's screenshot: 51.0MB used of 54.1MB
    // allocated — it read 94% red, though the limit is ~4GB.
    const memory = {
      heapUsed: 51 * MB,
      heapTotal: 54.1 * MB,
      heapLimit: 4 * GB,
    };
    expect(appMemoryPct(memory)).toBe(1);
    expect(appMemoryCeiling(memory)).toBe(4 * GB);
  });

  it("reports real danger when the heap approaches the limit", () => {
    const memory = {
      heapUsed: 3.8 * GB,
      heapTotal: 4 * GB,
      heapLimit: 4 * GB,
    };
    expect(appMemoryPct(memory)).toBe(95);
  });

  it("caps at 100%", () => {
    const memory = { heapUsed: 5 * GB, heapTotal: 4 * GB, heapLimit: 4 * GB };
    expect(appMemoryPct(memory)).toBe(100);
  });

  it("falls back to heapTotal for old server payloads without heapLimit", () => {
    const memory = { heapUsed: 27 * MB, heapTotal: 54 * MB };
    expect(appMemoryPct(memory)).toBe(50);
    expect(appMemoryCeiling(memory)).toBe(54 * MB);
  });

  it("returns 0 for missing, empty or zero memory payloads", () => {
    expect(appMemoryPct(null)).toBe(0);
    expect(appMemoryPct(undefined)).toBe(0);
    expect(appMemoryPct({})).toBe(0);
    expect(appMemoryPct({ heapUsed: 0, heapTotal: 0, heapLimit: 0 })).toBe(0);
  });
});
