# PowerShell 实战陷阱（Windows 开发环境）

> 本机为 Windows + Windows PowerShell 5.1。下列坑全部是**实际踩过的**，附真实报错。违反任一条，shell 命令会直接失败或产生意外行为。

## 1. `ls -la` 不可用

`ls` 是 `Get-ChildItem` 的别名，但 **PowerShell 不支持 bash 风格的短参数** `-la`：

```
Get-ChildItem : 找不到与参数名称"la"匹配的参数。
```

✅ 正确写法：

```powershell
Get-ChildItem -Force                 # 含隐藏文件
Get-ChildItem -Force -Name           # 只列名字
Get-ChildItem -Recurse -File         # 递归列文件
```

## 2. `&&` 连命令会直接报语法错误

**Windows PowerShell 5.1 不支持 `&&`**（PowerShell 7+ 才支持）。报错：

```
“&&”不是此版本中的有效语句分隔符。
```

✅ 用 `;` 代替（注意：`;` 不检查上一条是否成功）：

```powershell
git add .harness; git status
```

若必须"前一条成功才执行下一条"，用 `if ($LASTEXITCODE -eq 0) { ... }` 或分两次调用。

## 3. bash heredoc 不可用

`git commit -m "$(cat <<'EOF' ... EOF)"` 这类 bash heredoc 在 PowerShell 直接报 ParserError（`MissingFileSpecification`）。

✅ 多行 commit message 用多个 `-m`：

```powershell
git commit -m "docs: 标题" -m "正文第一段"
```

## 4. 工作目录是**持久状态**，容易走错

Shell 会话的 cwd 在多次命令间保持；用 `working_directory` 切目录后，下一条命令仍在那个目录。**提交 / 建路径前先确认**：

```powershell
Write-Output (Get-Location).Path
```

⚠️ 本仓库 `.venv` 在**项目根**（`c:\Users\zhouyao\PycharmProjects\personal-ai-runtime\.venv`），不在 `backend/` 下。在 `backend/` 目录运行后端脚本要用：

```powershell
..\.venv\Scripts\python.exe -m scripts.check_doc_links
```

## 5. 中文输出可能乱码

PowerShell 控制台对 UTF-8 支持不稳定，命令输出中文（含错误信息、git 输出）可能显示乱码。**不要根据乱码判断命令失败**——以 `Exit code` 和命令实际效果为准。

## 6. Make 命令：用 `Makefile.ps1` 而不是 `make`

本仓库 Unix 侧用 `make`，Windows 提供等价子集 `Makefile.ps1`：

```powershell
powershell -File Makefile.ps1 -Task test-backend
```

可用任务：`help / install / install-hooks / test-backend / test-frontend / lint / typecheck / boundary / layer-deps / backend-ci-* / docker-up / docker-down`。注意 PowerShell 版 `backend-ci-*` 是**顺序执行**（非 Unix 的 `-j` 并行）。

## 快速自查清单

- [ ] 用了 `ls -la` / `find` / `sed` / `head` 等 Unix 惯用法？
- [ ] 用了 `&&` 或 heredoc？
- [ ] 确认当前 cwd 是根目录吗？`.venv` 路径写对了吗？
- [ ] 中文乱码输出是否被误判为失败？
