import { useState, useEffect, useRef } from "react";
import { Copy, Check, MoreVertical, Edit, Trash2 } from "lucide-react";
import { getRelativeTime } from "../utils/dateUtils";
import {
  getSnippetUsageCount,
  incrementSnippetUsage,
} from "../utils/usageTracking";
import { authenticatedFetch } from "../utils/api";
import type { Snippet, SnippetFormData } from "../types";
import ConfirmDialog from "./ConfirmDialog";
import AddSnippetModal from "./AddSnippetModal";
import { API_BASE_URL, API_ENDPOINTS } from "../config/constants";
import { useAppDispatch } from "../store/hooks";
import { showToast } from "../store/slices/toastSlice";
import { logger } from "../utils/logger";

interface SnippetCardProps {
  snippet: Snippet;
  onDelete?: () => void;
  onUpdate?: () => void;
}

export default function SnippetCard({
  snippet,
  onDelete,
  onUpdate,
}: SnippetCardProps) {
  const dispatch = useAppDispatch();
  const [copied, setCopied] = useState(false);
  const [usageCount, setUsageCount] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load usage count when component mounts
    const loadUsageCount = async () => {
      const count = await getSnippetUsageCount(snippet.id);
      setUsageCount(count);
    };
    loadUsageCount();
  }, [snippet.id]);

  useEffect(() => {
    // Close menu when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMenuOpen]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);

      // Increment usage count
      const newCount = await incrementSnippetUsage(snippet.id);
      setUsageCount(newCount);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleEdit = () => {
    setShowEditModal(true);
    setIsMenuOpen(false);
  };

  const handleEditSubmit = async (updatedSnippet: SnippetFormData) => {
    try {
      const response = await authenticatedFetch(
        API_BASE_URL + API_ENDPOINTS.SNIPPET_BY_ID(snippet.id),
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updatedSnippet),
        }
      );

      if (response.ok) {
        dispatch(
          showToast({
            message: "Snippet updated successfully!",
            type: "success",
          })
        );
        if (onUpdate) {
          onUpdate();
        }
        setShowEditModal(false);
      } else {
        const error = await response.json();
        dispatch(
          showToast({
            message:
              error.message || "Failed to update snippet. Please try again.",
            type: "error",
          })
        );
      }
    } catch (error) {
      console.error("Error updating snippet:", error);
      dispatch(
        showToast({
          message: "Failed to update snippet. Please try again.",
          type: "error",
        })
      );
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteDialog(true);
    setIsMenuOpen(false);
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);

    try {
      const response = await authenticatedFetch(
        API_BASE_URL + API_ENDPOINTS.SNIPPET_BY_ID(snippet.id),
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        logger.success("Snippet deleted successfully", {
          data: { snippetId: snippet.id },
        });
        dispatch(
          showToast({
            message: "Snippet deleted successfully!",
            type: "success",
          })
        );
        // Call the onDelete callback to refresh the list
        if (onDelete) {
          onDelete();
        }
      } else {
        const error = await response.json();
        logger.error("Failed to delete snippet", { data: { error } });
        dispatch(
          showToast({
            message:
              error.message || "Failed to delete snippet. Please try again.",
            type: "error",
          })
        );
      }
    } catch (error) {
      logger.error("Error deleting snippet", { data: { error } });
      dispatch(
        showToast({
          message: "Failed to delete snippet. Please try again.",
          type: "error",
        })
      );
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <div className="group p-4 border border-gray-200 dark:border-zinc-800 rounded-xl hover:border-gray-300 dark:hover:border-zinc-700 transition-all bg-white dark:bg-zinc-900 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-semibold text-base text-gray-900 dark:text-white">
              {snippet.label}
            </h3>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm font-mono font-semibold border border-gray-300 dark:border-gray-700">
              {snippet.shortcut}
            </span>
          </div>
        </div>
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="shrink-0 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors relative"
          title="More options"
        >
          <MoreVertical className="h-5 w-5 text-gray-400 dark:text-zinc-500" />

          {/* Context Menu */}
          {isMenuOpen && (
            <div
              ref={menuRef}
              className="absolute right-0 top-8 z-10 w-40 p-2 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg"
            >
              <button
                onClick={handleEdit}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700 rounded-md transition-colors"
              >
                <Edit className="h-4 w-4" />
                <span>Edit</span>
              </button>
              <button
                onClick={handleDeleteClick}
                disabled={isDeleting}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600 dark:hover:text-red-400 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-4 w-4" />
                <span>{isDeleting ? "Deleting..." : "Delete"}</span>
              </button>
            </div>
          )}
        </button>
      </div>{" "}
      <pre className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-zinc-950 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap wrap-break-word font-mono mb-3 border border-gray-100 dark:border-zinc-800">
        <code>{snippet.content}</code>
      </pre>
      <div className=" ">
        <div className="flex items-center justify-between w-full">
          {snippet.tags && snippet.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {snippet.tags.map((tag, index) => (
                <span
                  key={index}
                  className="px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <button
            onClick={handleCopy}
            className="shrink-0 py-1.5 px-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 text-sm transition-colors"
            title="Copy to clipboard"
          >
            {copied ? (
              <div className="flex items-center gap-1  text-green-600">
                <Check className="h-4 w-4" />
                <span>Copied!</span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <Copy className="h-4 w-4" /> <span>Copy</span>
              </div>
            )}
          </button>
        </div>
        <hr className="my-1.5 border-t-[0.5px] border-zinc-400 dark:border-zinc-700" />
        <div className="flex items-center justify-between  text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <Copy className="h-4 w-4" />
            <span>{usageCount} uses</span>
          </div>
          <span>{getRelativeTime(snippet.updatedAt)}</span>
        </div>
      </div>
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Snippet"
        message={`Are you sure you want to delete "${snippet.label}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
      <AddSnippetModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSubmit={handleEditSubmit}
        initialData={{
          label: snippet.label,
          shortcut: snippet.shortcut,
          content: snippet.content,
          tags: snippet.tags || [],
        }}
        title="Edit Snippet"
        submitText="Update Snippet"
      />
    </div>
  );
}
