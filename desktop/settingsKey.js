/**
 * Wrap a legacy settings.key with Electron safeStorage before the backend starts.
 *
 * The file then holds only ciphertext. The plaintext Fernet key is returned so
 * the desktop can hand it to the backend on a pipe, not via argv or the environment.
 * Other os:v1 schemes belong to the backend's own OS store and are left alone.
 */

const fs = require("fs");
const path = require("path");

function settingsKeyPath(dataDir) {
  return path.join(dataDir, "settings.key");
}

function encryptionAvailable(safeStorage) {
  try {
    return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

function handoffSettingsKey(dataDir, safeStorage) {
  const keyPath = settingsKeyPath(dataDir);
  if (!fs.existsSync(keyPath)) return null;
  const text = fs.readFileSync(keyPath, "utf8");
  const lines = text.split("\n");
  if (lines[0] === "os:v1" && lines[1] && lines[1] !== "electron") return null;
  if (!encryptionAvailable(safeStorage)) return null;

  let secret;
  if (lines[0] === "os:v1" && lines[1] === "electron") {
    const blob = Buffer.from(lines[2] || "", "base64");
    secret = safeStorage.decryptString(blob);
  } else {
    secret = text.trim();
    const encrypted = safeStorage.encryptString(secret);
    const body = `os:v1\nelectron\n${encrypted.toString("base64")}\n`;
    const tmp = `${keyPath}.tmp`;
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, keyPath);
    try {
      fs.chmodSync(keyPath, 0o600);
    } catch {
      /* Windows may ignore the mode. */
    }
  }
  if (!secret || fs.readFileSync(keyPath, "utf8").includes(secret)) {
    throw new Error("settings key was not wrapped");
  }
  return secret;
}

module.exports = { handoffSettingsKey };
