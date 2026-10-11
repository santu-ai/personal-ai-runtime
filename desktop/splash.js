/**
 * First-launch splash copy. The window itself lives in main.js.
 * Status text is the only thing smoke mode waits on, so keep these strings stable.
 */

const SPLASH_STARTING = "正在启动";
const SPLASH_BACKEND = "正在启动后端";
const SPLASH_DATA = "正在准备数据";
const SPLASH_FAILED = "后端没有启动";

function splashStatusScript(message) {
  const text = JSON.stringify(String(message ?? ""));
  return `(() => {
    const node = document.getElementById("splash-status");
    if (!node) return false;
    node.textContent = ${text};
    return true;
  })()`;
}

function splashReadyScript() {
  return `(() => {
    const node = document.getElementById("splash-status");
    return !!node && (node.textContent || "").trim().length > 0;
  })()`;
}

module.exports = {
  SPLASH_STARTING,
  SPLASH_BACKEND,
  SPLASH_DATA,
  SPLASH_FAILED,
  splashStatusScript,
  splashReadyScript,
};
