# Module: <Name>

> Source: `src/path/to/module.ts`
> Coverage target: XX%

## Purpose

One paragraph describing what this module does and why it exists in the codebase.

## Scope

What is in scope and what is explicitly out of scope for this module.

---

## Public API

### `functionName(param: Type): ReturnType`

**Description:** What this function does in one sentence.

**Behavior:**

- MUST return X when given Y
- MUST throw `ErrorType` with message "..." when given invalid input
- MUST NOT modify the input (pure function)
- MUST handle empty/null/undefined input gracefully

**Edge Cases:**

- Empty string input → returns `""`
- `null` or `undefined` → throws `TypeError`
- Very large inputs → truncates/handles gracefully

**Invariants:**

- Output is always a valid `Type`
- Function is pure: same input always produces same output
- No side effects

**Examples:**

```ts
functionName("hello"); // → "expected output"
functionName(""); // → ""
functionName(null); // → throws TypeError
```

---

## Error Handling

Describe error scenarios and what the module guarantees in error cases.

## Dependencies

List any external dependencies (other modules, browser APIs) and how they affect
testability (e.g., "requires mocking `browser.storage`").

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| YYYY-MM-DD | Initial spec | —      |
