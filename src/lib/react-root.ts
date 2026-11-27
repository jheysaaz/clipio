import type { Root } from "react-dom/client";

type RootHost = { __clipioReactRoot?: Root };

/**
 * Return the one React root mounted on a container.
 *
 * An extension page can evaluate its entrypoint more than once — WXT's dev
 * reload does — and React rejects a second `createRoot()` on the same node.
 * Keeping the root on the container survives module re-evaluation; rendering
 * into that root is the supported way to update the tree.
 */
export function getOrCreateRoot(container: object, create: () => Root): Root {
  const host = container as RootHost;
  const existing = host.__clipioReactRoot;
  if (existing) return existing;
  const created = create();
  host.__clipioReactRoot = created;
  return created;
}
