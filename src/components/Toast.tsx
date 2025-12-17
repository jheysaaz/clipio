import { AlertCircle, CheckCircle, Info, X, AlertTriangle } from "lucide-react";
import { useEffect, useState, useCallback } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

export default function Toast({
  message,
  type,
  onClose,
  duration = 5000,
}: ToastProps) {
  const [closing, setClosing] = useState(false);
  const ANIMATION_MS = 200;

  const beginClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const timer = setTimeout(() => {
      onClose();
    }, ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [closing, onClose]);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        beginClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, beginClose]);

  const getIcon = () => {
    switch (type) {
      case "success":
        return <CheckCircle className="h-5 w-5" />;
      case "error":
        return <AlertCircle className="h-5 w-5" />;
      case "warning":
        return <AlertTriangle className="h-5 w-5" />;
      case "info":
        return <Info className="h-5 w-5" />;
    }
  };

  const getStyles = () => {
    switch (type) {
      case "success":
        return "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200";
      case "error":
        return "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200";
      case "warning":
        return "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200";
      case "info":
        return "bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200";
    }
  };

  return (
    <div
      className={`fixed top-4 right-4 left-4 max-w-md mx-auto z-50 flex items-start gap-3 p-4 border rounded-lg shadow-lg ${closing ? "animate-slide-out" : "animate-slide-in"} ${getStyles()}`}
    >
      <div className="shrink-0 mt-0.5">{getIcon()}</div>
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button
        onClick={beginClose}
        className="shrink-0 hover:opacity-70 transition-opacity"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
