/**
 * Pinned bytes for the Windows embeddable CPython zip and get-pip bootstrap.
 * A changed upstream file must fail the build until the pin is updated.
 */

const crypto = require("crypto");
const fs = require("fs");

const EMBED_ZIP_SHA256 = {
  "python-3.12.8-embed-amd64.zip":
    "8d3f33be9eb810f23c102f08475af2854e50484b8e4e06275e937be61ce3d2fb",
  "python-3.12.8-embed-win32.zip":
    "c9500db942a6d4f08248d2c47cb2800dc3737963f2ee8a4db340ae998346a380",
};

const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";
const GET_PIP_SHA256 = "fb24e693bab954209a063d90953621412ccad4a500905a726286e038f508ddf6";

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function assertSha256(filePath, expected, label) {
  const actual = sha256File(filePath);
  const want = String(expected || "").toLowerCase();
  if (actual !== want) {
    throw new Error(`${label} sha256 mismatch: expected ${want}, got ${actual}`);
  }
  return actual;
}

function expectedEmbedSha256(zipName) {
  const expected = EMBED_ZIP_SHA256[zipName];
  if (!expected) {
    throw new Error(`No pinned sha256 for ${zipName}`);
  }
  return expected;
}

function reproducibleBuildRequested(env = process.env) {
  return env.CI === "true" || Boolean(env.SOURCE_DATE_EPOCH);
}

module.exports = {
  EMBED_ZIP_SHA256,
  GET_PIP_URL,
  GET_PIP_SHA256,
  sha256File,
  assertSha256,
  expectedEmbedSha256,
  reproducibleBuildRequested,
};
