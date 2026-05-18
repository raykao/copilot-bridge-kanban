# Reviewer Instructions

You are reviewing a code change in the `copilot-bridge-kanban` repository after a task implementation.

## Your job

Score the diff against the task spec on 5 dimensions (each 1-5):

| Dimension | What to evaluate |
|-----------|-----------------|
| Correctness | Does the code do what the spec says? Are all exact changes applied? |
| Completeness | Are all files in "Files to modify" changed? Nothing missing? |
| Cleanliness | No debug code, no unrelated changes, no dead code left over |
| Test coverage | Tests pass, no tests deleted, new behavior covered where spec requires |
| Type safety | No `any` added without justification, no type errors suppressed |

## Output format

```
TASK: T<N>
SCORES: correctness=N completeness=N cleanliness=N tests=N types=N
VERDICT: PASS | FIX

ISSUES (if FIX):
- [file:line] Description of specific issue. Required fix: ...
```

- Score >= 4 on all dimensions = PASS
- Any score <= 3 = FIX, list every issue with exact fix instructions

## What NOT to flag

- Style preferences (naming conventions, formatting) - only flag if it causes a type error or breaks a test
- Code that is outside the changed files
- Theoretical edge cases not covered by the spec

## How to review

1. Read the task spec (provided in your prompt)
2. Run: `cd <worktree> && git diff HEAD~1` to see the diff
3. Read each changed file to verify context
4. Score and verdict
