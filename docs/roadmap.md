# AlgoLab Roadmap

AlgoLab is a local-first coding assessment practice tool. The goal is to support LeetCode-style and interview-style exams without depending on scraping, unofficial APIs, login, or cloud sync.

## Product Direction

Most coding exams share the same core workflow:

1. Paste or write a problem statement.
2. Define the function signature and starter code.
3. Add sample and custom test cases.
4. Write a solution locally.
5. Run tests and review the result.
6. Keep notes, attempts, and review history.

The platform-specific differences should mostly live in metadata, collections, notes, and reporting rather than in separate execution flows.

## Current Scope

- Local desktop app.
- Tauri v2, React, Vite, TypeScript, Monaco Editor.
- SQLite for drafts and submissions.
- Python, JavaScript, and C++ runners.
- Local problem files under `examples/problems`.
- No scraping and no unofficial coding-platform APIs.

## Next MVP Work

### 1. Problem Metadata for Multi-Exam Practice

Add fields that let a problem belong to different exam contexts:

- `source`: LeetCode, HackerRank, CodeSignal, Company, School, Custom.
- `sourceUrl`: optional original page URL.
- `examName`: optional interview, contest, company assessment, or class exam name.
- `topic`: broad topic such as array, graph, dynamic programming, SQL.
- `pattern`: technique such as two pointers, sliding window, prefix sum, binary search.
- `status`: new, attempted, solved, review.

Acceptance criteria:

- Add Problem can save the new metadata.
- Problem list can display at least source and status.
- Existing problems remain loadable with reasonable defaults.

### 2. Problem Notes

Add local notes per problem:

- Approach.
- Key insight.
- Mistakes.
- Complexity.
- Review notes.

Acceptance criteria:

- Notes are editable from the problem view.
- Notes persist locally.
- Notes are stored separately from copied problem statements where practical.

### 3. Attempt Summary

Turn raw submissions into a useful practice history:

- First attempted time.
- Last practiced time.
- Number of attempts.
- Best passed/total result.
- Solved state.

Acceptance criteria:

- The problem list can distinguish new, attempted, and solved problems.
- The problem detail view shows recent attempts.
- Running tests updates the summary automatically.

### 4. Better Test Case Input UX

Improve the current test case builder so users do not need to manually write nested JSON arrays for common function arguments.

Potential design:

- Let users define parameter names.
- Let each test case show one input field per parameter.
- Convert those fields into the internal `tests.json` format.

Acceptance criteria:

- Existing JSON-argument mode still works.
- Common cases such as `nums` and `target` are easier to enter.

### 5. Problem List Filters

Add filters for practice management:

- Source.
- Difficulty.
- Tag.
- Topic.
- Status.
- Review flag.

Acceptance criteria:

- Filters work locally without backend dependencies.
- Filter state is lightweight and does not block problem loading.

## Later Work

### Collections and Exam Sets

Support named groups of problems:

- Blind 75.
- NeetCode 150.
- Company interview prep.
- School midterm.
- Weak topics.
- Custom study plan.

### Review Queue

Help users decide what to practice next:

- Mark for review.
- Retry failed problems.
- Surface old solved problems.
- Basic spaced repetition later.

### Statistics Dashboard

Track practice progress:

- Problems solved by topic.
- Pass rate.
- Attempts per problem.
- Weekly practice count.
- Weak tags or patterns.

### Multi-Language Runners

Current local runners:

- Python.
- JavaScript.
- C++.

Later candidates:

- TypeScript.
- Go.
- Rust.
- SQL.

### Import and Export

Support portable local study data:

- Export problem sets.
- Import local problem packs.
- Backup notes and attempts.
- Keep copyrighted problem content out of public sample data by default.

## Non-Goals

- No LeetCode scraping.
- No unofficial coding-platform APIs.
- No automatic bulk question syncing.
- No login or cloud sync in the local-first MVP.
- No public redistribution of copied proprietary problem statements.
