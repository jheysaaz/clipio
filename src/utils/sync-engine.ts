/**
 * Sync queue processor - handles syncing queued operations when online
 */

import { authenticatedFetch } from "./api";
import {
  getSyncQueue,
  removeQueuedOperation,
  setSyncInProgress,
} from "./storage";
import { API_BASE_URL, API_ENDPOINTS } from "../config/constants";
import { logger } from "./logger";
import { getOnlineStatus } from "./offline";
import type { QueuedOperation } from "./queue";

interface SyncResult {
  operationId: string;
  success: boolean;
  error?: string;
}

/**
 * Process a single queued operation
 */
const processSingleOperation = async (
  operation: QueuedOperation
): Promise<SyncResult> => {
  try {
    let url = API_BASE_URL + API_ENDPOINTS.SNIPPETS;
    let method = "POST";
    let body: string | undefined;

    switch (operation.type) {
      case "create": {
        method = "POST";
        body = JSON.stringify(operation.data);
        break;
      }

      case "update": {
        if (!operation.snippetId) {
          throw new Error("Missing snippetId for update operation");
        }
        method = "PUT";
        url = API_BASE_URL + API_ENDPOINTS.SNIPPET_BY_ID(operation.snippetId);
        body = JSON.stringify(operation.data);
        break;
      }

      case "delete": {
        if (!operation.snippetId) {
          throw new Error("Missing snippetId for delete operation");
        }
        method = "DELETE";
        url = API_BASE_URL + API_ENDPOINTS.SNIPPET_BY_ID(operation.snippetId);
        break;
      }

      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }

    const response = await authenticatedFetch(url, {
      method,
      body,
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      
      // If snippet not found (404), it might have been created offline or deleted elsewhere
      // Remove from queue to avoid retrying indefinitely
      if (response.status === 404 && (operation.type === "update" || operation.type === "delete")) {
        logger.warn("Snippet not found on server, removing from queue", {
          data: { operationId: operation.id, snippetId: operation.snippetId },
        });
        return { operationId: operation.id, success: true }; // Treat as success to remove from queue
      }
      
      throw new Error(`API error: ${response.status} ${errorText}`);
    }

    logger.success("Operation synced successfully", {
      data: { operationId: operation.id, type: operation.type },
    });

    return { operationId: operation.id, success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to sync operation", {
      data: { operationId: operation.id, error: errorMsg },
    });

    return {
      operationId: operation.id,
      success: false,
      error: errorMsg,
    };
  }
};

/**
 * Process all queued operations
 * Syncs in order, retrying failed operations
 */
export const processSyncQueue = async (): Promise<{ successful: number; failed: number }> => {
  // Check if online
  if (!getOnlineStatus()) {
    logger.warn("Not online, skipping sync");
    return { successful: 0, failed: 0 };
  }

  // Get queue
  const queue = await getSyncQueue();

  // Check if already syncing
  if (queue.syncInProgress) {
    logger.warn("Sync already in progress, skipping");
    return { successful: 0, failed: 0 };
  }

  if (queue.operations.length === 0) {
    logger.info("No operations to sync");
    return { successful: 0, failed: 0 };
  }

  logger.info("Starting sync of queued operations", {
    data: { count: queue.operations.length },
  });

  // Mark sync as in progress
  await setSyncInProgress(true);

  let successful = 0;
  let failed = 0;

  // Process operations in order
  for (const operation of queue.operations) {
    const result = await processSingleOperation(operation);

    if (result.success) {
      successful++;
      // Remove successful operation from queue
      await removeQueuedOperation(operation.id);
    } else {
      failed++;
      // Increment retry count but don't remove from queue
      // In production, might implement exponential backoff here
    }
  }

  // Mark sync as complete
  await setSyncInProgress(false);

  logger.success("Sync queue processing completed", {
    data: { successful, failed },
  });

  return { successful, failed };
};

/**
 * Get pending operation count
 */
export const getPendingOperationCount = async (): Promise<number> => {
  const queue = await getSyncQueue();
  return queue.operations.length;
};
