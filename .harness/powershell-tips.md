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

⚠️ **必须用项目 `.venv` 的 python，不要用系统 python**。实测系统 python 的 `mcp==1.12.4` 与项目锁定 `mcp==2.0.0` 漂移，导致 `test_mcp_mesh.py`/`test_runtime_gateway_mcp.py` 收集失败（`No module named 'mcp.server.mcpserver'`）。桌面端 `resolvePythonCommand()` 开发模式也会优先仓库根 `.venv`。用绝对路径最稳：

```powershell
C:\Users\zhouyao\PycharmProjects\personal-ai-runtime\.venv\Scripts\python.exe -m pytest tests/ -q
```

## 5. 中文输出可能乱码

PowerShell 控制台对 UTF-8 支持不稳定，命令输出中文（含错误信息、git 输出）可能显示乱码。**不要根据乱码判断命令失败**——以 `Exit code` 和命令实际效果为准。

## 6. Make 命令：用 `Makefile.ps1` 而不是 `make`

本仓库 Unix 侧用 `make`，Windows 提供等价子集 `Makefile.ps1`：

```powershell
powershell -File Makefile.ps1 -Task test-backend
```

⚠️ **`Makefile.ps1` 参数名不要用 `$Args`**：它与 PowerShell 自动变量 `$args` 冲突，会导致 `python` 空参数进入交互 REPL。本仓库已改为 `-PyArgs`。

⚠️ `-Task test-backend` 后面的 pytest 参数**不要用 `-Args "..."`** 直接拼——本次实测 `powershell -File Makefile.ps1 -Task test-backend -Args "..."` 会卡死并触发 python REPL 的 WinError 循环。要跑子集测试，绕过 Makefile 直接用 venv python：

```powershell
C:\Users\zhouyao\PycharmProjects\personal-ai-runtime\.venv\Scripts\python.exe -m pytest tests/runtime/test_xxx.py -q
```

## 7. `Get-ChildItem` 过滤在路径不存在时静默空输出

`Get-ChildItem -Recurse -Filter *.py | Select-String ...` 在目标文件缺失时**不报错、直接空结果**（且 `Get-ChildItem -File` 对纯文件名目录可能异常），容易被误读为"无残留"。兜底用 `cmd`：

```powershell
cmd /c "dir /b C:\path\to\dir"        # 列目录真实内容
Test-Path C:\path\to\file             # 文件是否存在
```

这是 grep/索引滞后之外，第二个"以磁盘为准"的落地手段。

## 快速自查清单

- [ ] 用了 `ls -la` / `find` / `sed` / `head` 等 Unix 惯用法？
- [ ] 用了 `&&` 或 heredoc？
- [ ] 确认当前 cwd 是根目录吗？`.venv` 路径写对了吗？
- [ ] 中文乱码输出是否被误判为失败？
- [ ] grep 报出的"残留"是否用 `Test-Path` / `cmd /c dir /b` 核实过磁盘真实存在？
