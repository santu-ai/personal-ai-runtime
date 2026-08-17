/** Human-readable labels and parameter descriptions for tool calls. */

import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Bug,
  Calendar,
  Camera,
  CircleCheck,
  Clipboard,
  Clock,
  Database,
  Download,
  Eye,
  FileInput,
  FilePen,
  FileText,
  FlaskConical,
  Folder,
  GitBranch,
  GitPullRequest,
  Globe,
  Hourglass,
  Keyboard,
  List,
  Mail,
  Maximize2,
  MessageSquare,
  MousePointer,
  Package,
  ScanText,
  Search,
  SquareTerminal,
  Target,
  Timer,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";

interface ToolLabel {
  label: string;
  icon: LucideIcon;
  /** Describe key arguments in plain Chinese, or a factory that builds a sentence from args. */
  describeArgs?: (args: Record<string, unknown>) => string;
}

// Internal map keyed by full tool name (builtin or mcp prefix).
// Falls back to common-sense patterns for unknown tools.
const TOOL_LABELS: Record<string, ToolLabel> = {
  // ── builtin ──
  get_current_time: { label: "获取当前时间", icon: Clock },
  read_file: {
    label: "读取文件",
    icon: FileText,
    describeArgs: (a) => String(a.path || "?"),
  },
  write_file: { label: "写入文件", icon: FilePen },
  apply_patch: {
    label: "修改文件",
    icon: FilePen,
    describeArgs: (a) => String(a.path || "?"),
  },
  list_directory: { label: "列出目录内容", icon: Folder },
  search_files: { label: "搜索文件", icon: Search },
  web_search: {
    label: "搜索网页",
    icon: Globe,
    describeArgs: (a) => String(a.query || "?"),
  },
  fetch_url: {
    label: "抓取网页内容",
    icon: Download,
    describeArgs: (a) => String(a.url || "?"),
  },
  list_calendar_events: { label: "查看日历日程", icon: Calendar },
  add_calendar_event: { label: "添加日历日程", icon: Calendar },
  get_upcoming_events: { label: "查看近期日程", icon: Calendar },
  check_inbox: { label: "检查收件箱", icon: Mail },
  read_inbox_email: { label: "阅读邮件", icon: Mail },
  send_email: { label: "发送邮件", icon: Mail },
  get_clipboard: { label: "读取剪贴板", icon: Clipboard },
  ocr_image: { label: "图片文字识别", icon: ScanText },
  shell_exec: {
    label: "执行命令",
    icon: SquareTerminal,
    describeArgs: (a) => `$ ${a.command || "?"}`,
  },
  set_timer: {
    label: "创建定时提醒",
    icon: Timer,
    describeArgs: (a) => String(a.message || a.delay_seconds || "?"),
  },
  delete_goal: {
    label: "删除目标",
    icon: Trash2,
    describeArgs: (a) => {
      const gid = typeof a.goal_id === "string" ? a.goal_id.slice(0, 8) : "?";
      return gid;
    },
  },
  computer_screenshot: { label: "截取屏幕", icon: Camera },
  computer_click: { label: "点击屏幕", icon: MousePointer },
  computer_type: { label: "键盘输入", icon: Keyboard },
  computer_move: { label: "移动鼠标", icon: MousePointer },
  computer_scroll: { label: "滚动屏幕", icon: MousePointer },
  computer_key: { label: "按下按键", icon: Keyboard },
  git_status: { label: "查看 Git 状态", icon: BarChart3 },
  git_log: { label: "查看提交历史", icon: GitBranch },
  git_diff: { label: "查看代码变更", icon: FileText },
  telegram_send: { label: "发送 Telegram 消息", icon: MessageSquare },
  telegram_updates: { label: "查看 Telegram 消息", icon: MessageSquare },

  // ── goals ──
  create_goal: {
    label: "创建目标",
    icon: Target,
    describeArgs: (a) => String(a.title || "?"),
  },
  update_goal_progress: {
    label: "更新目标进度",
    icon: BarChart3,
    describeArgs: (a) => {
      const gid = typeof a.goal_id === "string" ? a.goal_id.slice(0, 8) : "?";
      const pct = typeof a.progress === "number" ? Math.round(a.progress * 100) : 0;
      return `${gid} → ${pct}%`;
    },
  },
  complete_goal: {
    label: "完成目标",
    icon: CircleCheck,
    describeArgs: (a) => {
      const gid = typeof a.goal_id === "string" ? a.goal_id.slice(0, 8) : "?";
      return gid;
    },
  },
  list_active_goals: { label: "查看活跃目标", icon: List },

  // ── MCP: playwright ──
  playwright_browser_navigate: {
    label: "打开网页",
    icon: Globe,
    describeArgs: (a) => String(a.url || "?"),
  },
  playwright_browser_snapshot: { label: "查看页面内容", icon: Eye },
  playwright_browser_take_screenshot: { label: "截取页面截图", icon: Camera },
  playwright_browser_click: {
    label: "点击页面元素",
    icon: MousePointer,
    describeArgs: (a) =>
      a.element || a.target || a.selector || a.ref
        ? `点击 «${a.element || a.target || a.selector || a.ref}»`
        : "点击指定元素",
  },
  playwright_browser_type: {
    label: "输入文字",
    icon: Keyboard,
    describeArgs: (a) => {
      const el = a.element || a.target || a.selector || a.ref || "目标";
      const txt = a.text || a.value || "…";
      return `在 «${el}» 输入 «${txt}»`;
    },
  },
  playwright_browser_tabs: { label: "管理浏览器标签页", icon: Clipboard },
  playwright_browser_close: { label: "关闭浏览器", icon: X },
  playwright_browser_fill_form: { label: "填写表单", icon: FileInput },
  playwright_browser_press_key: { label: "按下键盘按键", icon: Keyboard },
  playwright_browser_select_option: { label: "选择下拉选项", icon: Clipboard },
  playwright_browser_hover: { label: "鼠标悬停", icon: MousePointer },
  playwright_browser_drag: { label: "拖拽元素", icon: MousePointer },
  playwright_browser_evaluate: { label: "执行页面脚本", icon: Zap },
  playwright_browser_wait_for: { label: "等待页面加载", icon: Hourglass },
  playwright_browser_navigate_back: { label: "返回上一页", icon: ArrowLeft },
  playwright_browser_resize: { label: "调整窗口大小", icon: Maximize2 },
  playwright_browser_console_messages: { label: "查看控制台日志", icon: Clipboard },
  playwright_browser_network_requests: { label: "查看网络请求", icon: Globe },

  // ── MCP: context7 ──
  context7_resolve_library_id: {
    label: "查询技术文档",
    icon: BookOpen,
    describeArgs: (a) => String(a.query || a.libraryId || a.library || a.lib || "?"),
  },
  context7_query_docs: {
    label: "查询技术文档",
    icon: BookOpen,
    describeArgs: (a) => String(a.query || a.libraryId || a.library || a.lib || "?"),
  },

  // ── MCP: brave ──
  brave_brave_web_search: {
    label: "搜索网页",
    icon: Search,
    describeArgs: (a) => String(a.query || "?"),
  },

  // ── MCP: tavily ──
  tavily_tavily_search: {
    label: "深度搜索",
    icon: FlaskConical,
    describeArgs: (a) => String(a.query || "?"),
  },
  tavily_tavily_extract: {
    label: "提取网页内容",
    icon: Download,
    describeArgs: (a) => String(a.url || "?"),
  },

  // ── MCP: github ──
  github_search_repositories: {
    label: "搜索仓库",
    icon: Package,
    describeArgs: (a) => String(a.query || "?"),
  },
  github_search_code: {
    label: "搜索代码",
    icon: Search,
    describeArgs: (a) => String(a.query || "?"),
  },
  github_search_issues: {
    label: "搜索 Issue",
    icon: Bug,
    describeArgs: (a) => String(a.query || "?"),
  },
  github_get_file_contents: { label: "查看文件内容", icon: FileText },
  github_get_pull_request: { label: "查看 PR", icon: GitPullRequest },
  github_list_pull_requests: { label: "列出 PR", icon: List },
  github_get_pull_request_files: { label: "查看 PR 变更文件", icon: Folder },
  github_get_pull_request_status: { label: "查看 PR 状态", icon: CircleCheck },

  // ── MCP: notion ──
  notion_API_post_search: {
    label: "搜索文档",
    icon: FileText,
    describeArgs: (a) => String(a.query || "?"),
  },
  notion_API_retrieve_a_page: { label: "查看文档", icon: FileText },
  notion_API_get_block_children: { label: "查看文章内容", icon: Clipboard },
  notion_API_query_data_source: { label: "查询数据库", icon: Database },
};

/** Human-readable label for a tool name. Never exposes raw internal names. */
export function toolLabel(name: string): string {
  return TOOL_LABELS[name]?.label ?? fallbackLabel(name);
}

/** Lucide icon component for a tool name. */
export function toolIcon(name: string): LucideIcon {
  return TOOL_LABELS[name]?.icon ?? fallbackIcon(name);
}

/** Build a one-line Chinese sentence describing what the tool will do. */
export function describeToolAction(name: string, args: Record<string, unknown>): string {
  const entry = TOOL_LABELS[name];
  if (entry?.describeArgs) {
    return entry.describeArgs(args);
  }
  // Default: just show the label
  return entry?.label ?? fallbackLabel(name);
}

// ── fallbacks ──

function fallbackLabel(name: string): string {
  // Strip known prefixes
  const clean = name
    .replace(/^(playwright_|context7_|brave_|tavily_|github_|notion_)/, "")
    .replace(/_/g, " ")
    .replace(/\bAPI /g, "")
    .trim();
  const guess: Record<string, string> = {
    search: "搜索",
    navigate: "导航",
    click: "点击",
    type: "输入",
    read: "读取",
    write: "写入",
    get: "获取",
    list: "列出",
    create: "创建",
    update: "更新",
    delete: "删除",
    send: "发送",
    fetch: "抓取",
    query: "查询",
    resolve: "查询",
  };
  for (const [key, val] of Object.entries(guess)) {
    if (clean.toLowerCase().includes(key)) return val;
  }
  return clean || "执行操作";
}

function fallbackIcon(name: string): LucideIcon {
  if (name.includes("search") || name.includes("query")) return Search;
  if (name.includes("navigate") || name.includes("web") || name.includes("page")) return Globe;
  if (name.includes("click") || name.includes("hover")) return MousePointer;
  if (name.includes("type") || name.includes("input")) return Keyboard;
  if (name.includes("snapshot") || name.includes("screenshot")) return Camera;
  if (
    name.includes("read") ||
    name.includes("get") ||
    name.includes("list") ||
    name.includes("retrieve")
  )
    return FileText;
  if (name.includes("write") || name.includes("create") || name.includes("send")) return FilePen;
  return Wrench;
}
