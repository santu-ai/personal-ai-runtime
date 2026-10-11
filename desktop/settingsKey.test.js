import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { handoffSettingsKey } = require("./settingsKey");

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString(secret) {
      return Buffer.from(Buffer.from(secret, "utf8").map((byte) => byte ^ 0x5a));
    },
    decryptString(blob) {
      return Buffer.from(blob).map((byte) => byte ^ 0x5a).toString("utf8");
    },
  };
}

describe("settings key handoff", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "settings-key-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("wraps a legacy raw key and does not leave it on disk", () => {
    const legacy = "q3o1q0m1q0m1q0m1q0m1q0m1q0m1q0m1q0m1q0m=";
    writeFileSync(join(dir, "settings.key"), `${legacy}\n`, { mode: 0o600 });
    const handed = handoffSettingsKey(dir, fakeSafeStorage());
    const body = readFileSync(join(dir, "settings.key"), "utf8");
    expect(handed).toBe(legacy);
    expect(body.startsWith("os:v1\nelectron\n")).toBe(true);
    expect(body).not.toContain(legacy);
    expect(handoffSettingsKey(dir, fakeSafeStorage())).toBe(legacy);
  });

  it("leaves a backend OS key file alone", () => {
    const body = "os:v1\nprocess\nabc\n";
    writeFileSync(join(dir, "settings.key"), body);
    expect(handoffSettingsKey(dir, fakeSafeStorage())).toBeNull();
    expect(readFileSync(join(dir, "settings.key"), "utf8")).toBe(body);
  });

  it("does not wrap when the OS store is unavailable", () => {
    const legacy = "raw-fernet-key";
    writeFileSync(join(dir, "settings.key"), legacy);
    const safeStorage = { isEncryptionAvailable: () => false, encryptString: () => Buffer.from("x") };
    expect(handoffSettingsKey(dir, safeStorage)).toBeNull();
    expect(readFileSync(join(dir, "settings.key"), "utf8")).toBe(legacy);
  });
});
