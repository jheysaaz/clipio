import type { ReactNode } from "react";

interface LeafProps {
  children: ReactNode;
  attributes: Record<string, unknown>;
}

export function BoldLeaf({ children, attributes }: LeafProps) {
  return <strong {...attributes}>{children}</strong>;
}

export function ItalicLeaf({ children, attributes }: LeafProps) {
  return <em {...attributes}>{children}</em>;
}

export function UnderlineLeaf({ children, attributes }: LeafProps) {
  return <u {...attributes}>{children}</u>;
}

export function StrikethroughLeaf({ children, attributes }: LeafProps) {
  return <s {...attributes}>{children}</s>;
}

export function CodeLeaf({ children, attributes }: LeafProps) {
  return (
    <code
      {...attributes}
      className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded text-sm font-mono"
    >
      {children}
    </code>
  );
}
