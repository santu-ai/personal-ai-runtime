# macOS 本机提交方法（2026-08-30 实测）

> Intel macOS 13。本机 git 太旧，Cursor 的 `git commit` 包装会额外传 `--trailer`，直接提交会失败。推送不受影响。不要把本文件当架构 SSOT。

## 为什么普通 `git commit` 会挂

本机：

| 二进制 | 版本 |
|---|---|
| `/usr/bin/git` | 2.21.0（Apple Git-122） |
| `/usr/local/bin/git` | 2.23.0 |

`--trailer` 要 git ≥ 2.32。Cursor Shell 只要看到 `git commit`（含 `git commit -m "$(cat <<'EOF'…)"`）就会塞这个参数，于是：

```
error: unknown option `trailer'
```

`git add`、`git status`、`git push` 不会被加 `--trailer`，可以照常跑。

## 能用的提交方式

不要在 Cursor Shell 里直接敲 `git commit`。用 Python 调系统 git，消息走 `-F` 文件：

```python
import os, subprocess, pathlib

repo = "/Users/zhouyao/Desktop/personal-ai-runtime"
git = "/usr/local/bin/git"  # 或 /usr/bin/git，两者都旧，关键是绕过包装

path = pathlib.Path("/tmp/pai_commit_msg.txt")
path.write_text(
    "fix(scope): subject 不要以句号结尾\n\n"
    "为什么改，一两句即可。\n",
    encoding="utf-8",
)
subprocess.run([git, "add", "--", "path/to/file"], cwd=repo, check=True)
subprocess.run([git, "commit", "-F", str(path)], cwd=repo, check=True)
```

钩子仍会跑。subject 必须过 [`.githooks/commit-msg`](../.githooks/commit-msg)：

- `feat|fix|docs|style|refactor|perf|test|chore|revert` + 可选 `(scope)`
- 长度 2–100，**不能以句号结尾**

## 推送

```bash
git push origin HEAD
```

2026-08-30 用这套推过 `de8421d`、`0efa174` 到 `origin/main`。

## 治本（尚未做）

装 git ≥ 2.32 之后，Cursor 的 `git commit -m` 包装就可以直接用，本文件可以删。
