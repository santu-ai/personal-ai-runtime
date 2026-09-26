import type { ReactNode } from "react";

interface Props {
  /** 平时看见的短句或图标加短名字。 */
  preview: ReactNode;
  /** 键盘落到时写出的整句。 */
  full: string;
  previewClassName?: string;
  fullClassName?: string;
}

const previewClass = "inline-flex min-w-0 max-w-full items-center gap-1 group-focus-visible:hidden";
const fullClass =
  "hidden max-w-sm whitespace-normal text-left leading-snug group-focus-visible:block";

/**
 * 放在带 group 的按钮里。平时只看见短句。
 * 键盘落到时写出整句，短句让开。鼠标悬停仍是短句。
 */
export default function PromptChipFace({
  preview,
  full,
  previewClassName = previewClass,
  fullClassName = fullClass,
}: Props) {
  return (
    <>
      <span className={previewClassName}>{preview}</span>
      <span data-prompt-name="" className={fullClassName}>
        {full}
      </span>
    </>
  );
}
