import { describe, expect, it } from "vitest";
import { checkWebhookUrl, isPrivateAddress } from "./url-guard";

describe("webhook URLs", () => {
  it("accept public https addresses", () => {
    expect(checkWebhookUrl("https://hooks.example.com/scaler")).toBeNull();
    expect(checkWebhookUrl("https://93.184.216.34/in")).toBeNull();
  });

  it("refuse http, credentials and private networks", () => {
    expect(checkWebhookUrl("http://hooks.example.com")).toMatch(/https/);
    expect(checkWebhookUrl("https://user:pw@hooks.example.com")).toMatch(/user name/);
    expect(checkWebhookUrl("https://localhost/x")).toMatch(/public/);
    expect(checkWebhookUrl("https://10.0.0.5/x")).toMatch(/public/);
    expect(checkWebhookUrl("https://[::1]/x")).toMatch(/public/);
    expect(checkWebhookUrl("https://db.internal/x")).toMatch(/public/);
    expect(checkWebhookUrl("not a url")).toMatch(/full URL/);
  });

  it("know the private ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.1.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});
