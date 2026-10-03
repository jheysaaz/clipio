import type { ReactNode } from "react";

interface LinkElementProps {
  children: ReactNode;
  attributes: Record<string, unknown>;
  element: { url?: string };
}

export function LinkElementComponent({
  children,
  attributes,
  element,
}: LinkElementProps) {
  const url = element.url || "";

  return (
    <a
      {...attributes}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-indigo-600 dark:text-indigo-400 underline decoration-indigo-400/50 dark:decoration-indigo-500/50 hover:decoration-indigo-600 dark:hover:decoration-indigo-400 transition-colors cursor-pointer"
      title={url}
      onClick={(e) => {
        // Allow cmd/ctrl+click to open link, otherwise prevent navigation in editor
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </a>
  );
}
