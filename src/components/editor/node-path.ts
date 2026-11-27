/**
 * Locate a node that was just inserted into a Plate document.
 *
 * `editor.api.findPath(node)` is a path *ref* that can still point at the
 * pre-insertion position, so trusting it after `insertNodes` can put the caret
 * on the void instead of beside it. The inserted node carries Plate's generated
 * `id`; finding that is unambiguous even after Immer has cloned the tree.
 */

import type { Descendant, TElement } from "platejs";

const isText = (node: Descendant): boolean => "text" in node;

const idOf = (node: TElement): string | undefined =>
  (node as TElement & { id?: string }).id;

function sameNode(candidate: TElement, target: TElement): boolean {
  if (candidate === target) return true;

  const targetId = idOf(target);
  if (targetId && idOf(candidate) === targetId) return true;

  // Only used when Plate did not assign an id: compare the meaningful props,
  // never `children` (which contains a fresh text leaf) or `id` (undefined on
  // both sides would otherwise look like a match).
  return Object.keys(target)
    .filter((key) => key !== "children" && key !== "id")
    .every(
      (key) =>
        (candidate as Record<string, unknown>)[key] ===
        (target as Record<string, unknown>)[key]
    );
}

/** Current path of `target`, or `null` when it is not in the tree. */
export function findNodePath(
  nodes: Descendant[],
  target: TElement
): number[] | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (isText(node)) continue;
    const element = node as TElement;
    if (sameNode(element, target)) return [index];

    const nested = findNodePath(element.children as Descendant[], target);
    if (nested) return [index, ...nested];
  }
  return null;
}
