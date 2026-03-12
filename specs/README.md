# Clipio Spec Documents

This directory contains **behavioral specifications** for every testable module in Clipio.
Specs are the source of truth for what each module is supposed to do.

## Workflow (SDD + TDD)

```
1. SPEC   → Write/update specs/<module>.spec.md describing the behavior
2. TEST   → Write failing tests that encode each MUST clause from the spec
3. CODE   → Implement until all tests pass
4. REVIEW → PR must include: spec update + tests + implementation
```

## Conventions

- Every **MUST** clause in a spec becomes at least one test case.
- Tests reference the spec section they validate via a comment: `// spec: <module>.spec.md#section`
- Specs describe **what** and **why**, never **how** (no implementation details).
- When behavior changes, update the spec **first**, then tests, then code.

## Directory Index

| File                        | Module                                   | Coverage Target |
| --------------------------- | ---------------------------------------- | --------------- |
| `date-utils.spec.md`        | `src/utils/dateUtils.ts`                 | 95%             |
| `snippet-model.spec.md`     | `src/types/index.ts`                     | 95%             |
| `importers.spec.md`         | `src/lib/importers/`                     | 90%             |
| `exporters.spec.md`         | `src/lib/exporters/clipio.ts`            | 95%             |
| `serialization.spec.md`     | `src/components/editor/serialization.ts` | 90%             |
| `markdown.spec.md`          | `src/lib/markdown.ts`                    | 90%             |
| `content-expansion.spec.md` | `src/lib/content-helpers.ts`             | 85%             |
| `sentry-scrub.spec.md`      | `src/lib/sentry-scrub.ts`                | 90%             |
| `storage.spec.md`           | `src/storage/`                           | 80%             |
| `usage-tracking.spec.md`    | `src/utils/usageTracking.ts`             | 85%             |

## Spec Template

See `template.spec.md` for the standard structure all specs must follow.
