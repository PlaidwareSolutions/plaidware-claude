import { describe, expect, it } from "vitest";
import { classifyProbe } from "./probe-logic";

describe("classifyProbe", () => {
  it("grades the health endpoint when it exists", () => {
    expect(classifyProbe({ status: 200 })).toMatchObject({ status: "healthy", statusCode: 200, usedHomepage: false });
    expect(classifyProbe({ status: 503 })).toMatchObject({ status: "down", statusCode: 503 });
    expect(classifyProbe({ status: 401 })).toMatchObject({ status: "degraded", statusCode: 401 });
  });
  it("falls back to the homepage when the health path is a 404", () => {
    const r = classifyProbe({ status: 404 }, { status: 200 });
    expect(r).toMatchObject({ status: "healthy", statusCode: 200, usedHomepage: true });
    expect(r.detail).toMatch(/No \/api\/system\/health endpoint/);
    expect(classifyProbe({ status: 404 }, { status: 500 })).toMatchObject({ status: "down", statusCode: 500 });
    expect(classifyProbe({ status: 404 }, { error: "timeout" })).toMatchObject({ status: "down", statusCode: null });
  });
  it("keeps a 404 as degraded when no homepage result is supplied", () => {
    expect(classifyProbe({ status: 404 })).toMatchObject({ status: "degraded", statusCode: 404 });
  });
  it("is down when the request itself fails", () => {
    expect(classifyProbe({ error: "ECONNREFUSED" })).toMatchObject({ status: "down", detail: "ECONNREFUSED" });
  });
});
