/**
 * 输入法还在处理这一下。
 * Safari 组字时 isComposing 可能仍是 false，但 keyCode 是 229。
 * 有的浏览器把这一下的键名写成 Process。组字结束后再按才是普通按键。
 */
export function isImeKeyboardEvent(event: {
  isComposing?: boolean;
  key?: string;
  keyCode?: number;
  which?: number;
}): boolean {
  const code = event.keyCode || event.which;
  return event.isComposing === true || event.key === "Process" || code === 229;
}
