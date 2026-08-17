/** Barrel re-export of domain API modules.
 *  Prefer importing from domain modules (e.g. `../api/chat`).
 */

// Core
export {
  setAuthToken,
  getAuthToken,
  isAuthConfigured,
  authHeaders,
  request,
  ApiError,
} from "./core";

// Types
export type {
  HealthResponse,
  Conversation,
  Message,
  StreamEvent,
  SourceCitation,
  Notification,
  CostSummary,
  ModelCostItem,
  ToolSummaryItem,
  MemoryStats,
  HealthSnapshot,
  MemoryRow,
  MemoriesGrouped,
  SystemInfo,
  LlmProvidersResponse,
  McpServerStatus,
  McpStatusResponse,
  InboxEmail,
  WorkItemType,
  WorkItem,
  WorkItemEvent,
  Approval,
  EnrichedApproval,
  DataSovereignty,
  DashboardData,
} from "./types";

// Chat
export {
  createConversation,
  listConversations,
  deleteConversation,
  updateConversation,
  getMessages,
  sendMessage,
} from "./chat";

// System
export {
  getSystemHealth,
  fetchSystemInfo,
  getLlmProviders,
  getMcpStatus,
  downloadExport,
  exportEncryptedData,
  importData,
  importEncryptedData,
  destroyAllData,
  getDashboard,
} from "./system";

// Goals (work_type=goal helpers over work-items)
export {
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  createGoalAction,
  updateGoalAction,
  decomposeGoal,
  listWorkItems,
  getWorkItem,
  createWorkItem,
  updateWorkItem,
  deleteWorkItem,
  executeWorkItem,
  cancelWorkItem,
  decomposeWorkItem,
} from "./workItems";

// Inbox
export {
  listInboxEmails,
  getInboxDigest,
  triggerInboxPoll,
  getInboxSyncStatus,
  updateInboxEmailStatus,
  getInboxEmailDetail,
  getInboxEmailSummary,
} from "./inbox";
export type { InboxSyncStatus, InboxSyncMetrics, InboxPollErrorKind } from "./inbox";

// Memory
export {
  listMemoriesGrouped,
  countMemories,
  searchMemories,
  createMemory,
  deleteMemory,
  updateMemory,
  ratifyMemory,
  rejectMemory,
  bulkClaimAction,
  getMemoryGraph,
  getMemoryProvenance,
} from "./memory";
export type {
  MemoryGraphNode,
  MemoryGraphEdge,
  MemoryGraph,
  MemoryProvenance,
  MemoryProvenanceEvent,
  ListMemoriesGroupedOpts,
} from "./memory";

// Telemetry
export {
  getCostSummary,
  getCostByModel,
  getToolSummary,
  getMemoryStats,
  getHealth,
} from "./telemetry";

// Settings
export {
  getLlmSettings,
  updateLlmSettings,
  testLlmConnection,
  getEmailSettings,
  updateEmailSettings,
  testEmailConnection,
  getPromptConfig,
  updatePromptConfig,
  getCapabilityPolicy,
} from "./settings";
export type {
  LlmConfig,
  LlmProviderConfig,
  LlmSettingsResponse,
  EmailConfig,
  EmailSettingsResponse,
  LlmTestResult,
  EmailTestResult,
  PromptConfig,
  CapabilityPolicy,
} from "./settings";

// Approvals
export {
  listPendingApprovals,
  listEnrichedPendingApprovals,
  approveApproval,
  rejectApproval,
  resolveApproval,
} from "./approvals";

// Notifications
export { listNotifications, markNotificationRead, markAllNotificationsRead } from "./notifications";

// Timeline
export { listTimelineEvents } from "./timeline";
export type { TimelineEvent, TimelineResponse } from "./timeline";

// Connectors / MCP marketplace
export { listMcpRegistry, installMcpConnector } from "./connectors";
export type { McpRegistryServer } from "./connectors";
