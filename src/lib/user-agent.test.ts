import { describe, expect, it } from "vitest";
import { describeUserAgent } from "./user-agent";

const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.0.0 Mobile/15E148 Safari/604.1",
  linuxNoBrowser: "Mozilla/5.0 (X11; Linux x86_64)",
};

describe("describeUserAgent", () => {
  it("names the browser and OS", () => {
    expect(describeUserAgent(UA.chromeMac)).toEqual({ browser: "Chrome", os: "macOS", label: "Chrome on macOS" });
    expect(describeUserAgent(UA.safariIphone).label).toBe("Safari on iOS");
    expect(describeUserAgent(UA.firefoxWindows).label).toBe("Firefox on Windows");
    expect(describeUserAgent(UA.chromeAndroid).label).toBe("Chrome on Android");
    expect(describeUserAgent(UA.chromeIos).label).toBe("Chrome on iOS");
  });
  it("recognises Edge even though it also says Chrome and Safari", () => {
    expect(describeUserAgent(UA.edgeWindows).label).toBe("Edge on Windows");
  });
  it("falls back gracefully", () => {
    expect(describeUserAgent(UA.linuxNoBrowser)).toEqual({ browser: null, os: "Linux", label: "Linux" });
    expect(describeUserAgent("curl/8.4.0").label).toBe("Unknown device");
    expect(describeUserAgent("").label).toBe("Unknown device");
    expect(describeUserAgent(null).label).toBe("Unknown device");
  });
});
