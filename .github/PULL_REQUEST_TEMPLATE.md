## Summary

<!-- Describe the change in 1-3 bullet points. What does this PR do? -->

-

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactoring (no behavior change)
- [ ] Documentation / spec update
- [ ] CI / tooling

## SDD + TDD Checklist

### Spec (Spec-Driven Development)

- [ ] **Spec updated** — `specs/<module>.spec.md` was updated to reflect any behavior change
- [ ] **No spec change needed** — this PR does not change any observable behavior (tooling, docs, refactor)

> If behavior changed without a spec update, explain why:
>
> <!-- ... -->

### Tests (Test-Driven Development)

- [ ] **Tests added or updated** — each `MUST` clause affected by this PR has a corresponding test
- [ ] **All tests pass** — `pnpm test` exits with code 0
- [ ] **Coverage maintained** — `pnpm test:coverage` shows no threshold violations
- [ ] **No tests needed** — this change has no testable logic (e.g. types-only, config, assets)

### Implementation

- [ ] `pnpm compile` passes (no TypeScript errors)
- [ ] `pnpm format:check` passes (code is formatted)
- [ ] No new browser API calls without corresponding mocks in `tests/mocks/`

## Related Specs

<!-- List the spec files relevant to this change -->

- `specs/`

## Test Coverage Impact

<!-- Briefly describe how tests were added/modified. If coverage changed, note it. -->

## Screenshots / Notes

<!-- Optional: add screenshots for UI changes, or notes for reviewers -->
