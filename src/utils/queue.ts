/**
 * Sync queue management for offline operations
 * Stores operations (create/update/delete snippets) to be synced when online
 */

export type QueueOperationType = "create" | "update" | "delete";

export interface QueuedOperation {
  id: string; // Unique operation ID
  type: QueueOperationType;
  snippetId?: number; // For update/delete (int64 from backend)
  data: Record<string, unknown>; // Operation data
  createdAt: number; // Timestamp
  retries: number; // Retry count
}

export interface SyncQueue {
  operations: QueuedOperation[];
  lastSyncAt?: number;
  syncInProgress: boolean;
}

/**
 * Default empty queue
 */
export const getEmptyQueue = (): SyncQueue => ({
  operations: [],
  syncInProgress: false,
});

/**
 * Validate queued operation
 */
export const isValidQueuedOperation = (op: unknown): op is QueuedOperation => {
  if (!op || typeof op !== "object") return false;
  const o = op as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    ["create", "update", "delete"].includes(o.type as string) &&
    typeof o.data === "object" &&
    typeof o.createdAt === "number" &&
    typeof o.retries === "number"
  );
};

/**
 * Generate unique operation ID
 */
export const generateOperationId = (): string => {
  return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};
