import Editor from "@monaco-editor/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { Difficulty, ProblemDetail, ProblemSummary, RunSummary, Submission } from "@algolab/core";
import { createProblem, getDraft, getProblem, listProblems, listSubmissions, runProblemTests, saveDraft, updateProblem, type CreateProblemInput } from "./tauri";

type LoadState = "idle" | "loading" | "error";
type ProblemFormMode = "create" | "edit";

interface TestCaseForm {
  id: string;
  name: string;
  inputText: string;
  expectedText: string;
}

const createEmptyTestCase = (index: number): TestCaseForm => ({
  id: crypto.randomUUID(),
  name: `example ${index}`,
  inputText: "[]",
  expectedText: "null"
});

type ProblemForm = Omit<CreateProblemInput, "tags" | "testsJson"> & { tagsText: string; testCases: TestCaseForm[] };

const initialProblemForm: ProblemForm = {
  id: "",
  title: "",
  difficulty: "easy",
  tagsText: "",
  functionName: "solve",
  timeLimitMs: 2000,
  statement: "# New Problem\n\nPaste the problem statement here.",
  starterCode: "class Solution:\n    def solve(self):\n        return None\n",
  testCases: [createEmptyTestCase(1)]
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const problemToForm = (detail: ProblemDetail): ProblemForm => ({
  id: detail.meta.id,
  title: detail.meta.title,
  difficulty: detail.meta.difficulty,
  tagsText: detail.meta.tags.join(", "),
  functionName: detail.meta.functionName,
  timeLimitMs: detail.meta.timeLimitMs,
  statement: detail.statement,
  starterCode: detail.starterCode,
  testCases: detail.tests.cases.map((testCase, index) => ({
    id: crypto.randomUUID(),
    name: testCase.name || `example ${index + 1}`,
    inputText: JSON.stringify(testCase.input),
    expectedText: JSON.stringify(testCase.expected)
  }))
});

function difficultyClass(difficulty: ProblemSummary["difficulty"]) {
  return `difficulty difficulty-${difficulty}`;
}

function App() {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [code, setCode] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [status, setStatus] = useState("Ready");
  const [isAddOpen, setIsAddOpen] = useState(() => new URLSearchParams(window.location.search).has("addProblem"));
  const [problemFormMode, setProblemFormMode] = useState<ProblemFormMode>("create");
  const [problemForm, setProblemForm] = useState(initialProblemForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isStatementExpanded, setIsStatementExpanded] = useState(false);
  const [layout, setLayout] = useState({
    problemListWidth: 260,
    statementWidth: 460,
    resultsHeight: 210
  });

  const refreshProblems = useCallback(async (nextSelectedId?: string) => {
    const items = await listProblems();
    setProblems(items);
    setSelectedId(nextSelectedId ?? selectedId ?? items[0]?.id ?? null);
    return items;
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    listProblems()
      .then((items) => {
        if (cancelled) return;
        setProblems(items);
        setSelectedId(items[0]?.id ?? null);
        setLoadState("idle");
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus(String(error));
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;

    let cancelled = false;
    setLoadState("loading");
    setRunSummary(null);
    Promise.all([getProblem(selectedId), getDraft(selectedId), listSubmissions(selectedId)])
      .then(([detail, draft, submissionItems]) => {
        if (cancelled) return;
        setProblem(detail);
        setCode(draft?.code ?? detail.starterCode);
        setSavedAt(draft?.updatedAt ?? null);
        setSubmissions(submissionItems);
        setStatus(`Loaded ${detail.meta.title}`);
        setLoadState("idle");
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus(String(error));
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const statementHtml = useMemo(() => {
    if (!problem) return "";
    return DOMPurify.sanitize(marked.parse(problem.statement) as string);
  }, [problem]);

  const saveCurrentDraft = useCallback(async () => {
    if (!problem) return;
    setStatus("Saving draft...");
    const draft = await saveDraft(problem.meta.id, code);
    setSavedAt(draft.updatedAt);
    setStatus("Draft saved");
  }, [code, problem]);

  const runCurrentTests = useCallback(async () => {
    if (!problem) return;
    setStatus("Running tests...");
    await saveCurrentDraft();
    const summary = await runProblemTests(problem.meta.id, code);
    setRunSummary(summary);
    setSubmissions(await listSubmissions(problem.meta.id));
    setStatus(`${summary.passed} passed, ${summary.failed} failed in ${summary.durationMs} ms`);
  }, [code, problem, saveCurrentDraft]);

  const updateProblemForm = <Key extends keyof typeof problemForm>(key: Key, value: (typeof problemForm)[Key]) => {
    setProblemForm((current) => ({ ...current, [key]: value }));
  };

  const updateTestCase = (caseId: string, patch: Partial<TestCaseForm>) => {
    setProblemForm((current) => ({
      ...current,
      testCases: current.testCases.map((testCase) => (testCase.id === caseId ? { ...testCase, ...patch } : testCase))
    }));
  };

  const addTestCase = () => {
    setProblemForm((current) => ({
      ...current,
      testCases: [...current.testCases, createEmptyTestCase(current.testCases.length + 1)]
    }));
  };

  const removeTestCase = (caseId: string) => {
    setProblemForm((current) => ({
      ...current,
      testCases: current.testCases.length === 1
        ? current.testCases
        : current.testCases.filter((testCase) => testCase.id !== caseId)
    }));
  };

  const buildTestsJson = () => {
    const cases = problemForm.testCases.map((testCase) => ({
      name: testCase.name.trim() || "test case",
      input: JSON.parse(testCase.inputText),
      expected: JSON.parse(testCase.expectedText)
    }));

    if (cases.some((testCase) => !Array.isArray(testCase.input))) {
      throw new Error("Each Arguments value must be a JSON array, for example [[2,7,11,15],9].");
    }

    return JSON.stringify(
      {
        version: 1,
        functionName: problemForm.functionName.trim(),
        cases
      },
      null,
      2
    );
  };

  const openCreateProblem = () => {
    setProblemFormMode("create");
    setProblemForm({ ...initialProblemForm, testCases: [createEmptyTestCase(1)] });
    setFormError(null);
    setIsStatementExpanded(false);
    setIsAddOpen(true);
  };

  const openEditProblem = () => {
    if (!problem) return;
    setProblemFormMode("edit");
    setProblemForm(problemToForm(problem));
    setFormError(null);
    setIsStatementExpanded(false);
    setIsAddOpen(true);
  };

  const closeProblemForm = () => {
    setIsAddOpen(false);
    setFormError(null);
    setIsStatementExpanded(false);
  };

  const submitProblemForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setIsCreating(true);

    try {
      const input: CreateProblemInput = {
        id: problemForm.id.trim(),
        title: problemForm.title.trim(),
        difficulty: problemForm.difficulty,
        tags: problemForm.tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        functionName: problemForm.functionName.trim(),
        timeLimitMs: Number(problemForm.timeLimitMs),
        statement: problemForm.statement,
        starterCode: problemForm.starterCode,
        testsJson: buildTestsJson()
      };

      const savedProblem = problemFormMode === "edit"
        ? await updateProblem(input.id, input)
        : await createProblem(input);
      await refreshProblems(savedProblem.meta.id);
      setProblem(savedProblem);
      setRunSummary(null);
      setProblemForm({ ...initialProblemForm, testCases: [createEmptyTestCase(1)] });
      setIsAddOpen(false);
      setStatus(`${problemFormMode === "edit" ? "Updated" : "Created"} ${savedProblem.meta.title}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreating(false);
    }
  };

  const selectedProblem = problems.find((item) => item.id === selectedId);
  const layoutStyle = {
    "--problem-list-width": `${layout.problemListWidth}px`,
    "--statement-width": `${layout.statementWidth}px`,
    "--results-height": `${layout.resultsHeight}px`
  } as CSSProperties;

  const startColumnResize = useCallback((target: "problemList" | "statement", event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startLayout = layout;
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const minEditorWidth = 420;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;

      setLayout((current) => {
        if (target === "problemList") {
          const maxProblemListWidth = Math.min(420, workspaceWidth - startLayout.statementWidth - minEditorWidth);
          return {
            ...current,
            problemListWidth: clamp(startLayout.problemListWidth + deltaX, 200, maxProblemListWidth)
          };
        }

        const maxStatementWidth = Math.min(720, workspaceWidth - startLayout.problemListWidth - minEditorWidth);
        return {
          ...current,
          statementWidth: clamp(startLayout.statementWidth + deltaX, 320, maxStatementWidth)
        };
      });
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
  }, [layout]);

  const startResultsResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = layout.resultsHeight;
    const maxResultsHeight = Math.min(460, window.innerHeight - 240);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setLayout((current) => ({
        ...current,
        resultsHeight: clamp(startHeight - (moveEvent.clientY - startY), 150, maxResultsHeight)
      }));
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
  }, [layout.resultsHeight]);

  return (
    <div className="app-shell" style={layoutStyle}>
      <header className="topbar">
        <div>
          <h1>AlgoLab</h1>
          <p>Local algorithm practice for Python problems.</p>
        </div>
        <div className="toolbar">
          <span className="status-text">{status}</span>
          <button className="secondary-button" disabled={!problem} onClick={openEditProblem}>
            Edit Problem
          </button>
          <button className="secondary-button" onClick={openCreateProblem}>
            Add Problem
          </button>
          <button className="secondary-button" disabled={!problem} onClick={saveCurrentDraft}>
            Save
          </button>
          <button className="primary-button" disabled={!problem} onClick={runCurrentTests}>
            Run
          </button>
        </div>
      </header>

      <main className="workspace" ref={workspaceRef}>
        <aside className="problem-list">
          <div className="panel-header">
            <span>Problems</span>
            <strong>{problems.length}</strong>
          </div>
          <div className="list-scroll">
            {problems.map((item) => (
              <button
                key={item.id}
                className={item.id === selectedId ? "problem-row selected" : "problem-row"}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="problem-title">{item.title}</span>
                <span className={difficultyClass(item.difficulty)}>{item.difficulty}</span>
              </button>
            ))}
          </div>
        </aside>

        <div
          className="resize-handle resize-handle-vertical"
          role="separator"
          aria-label="Resize problem list"
          aria-orientation="vertical"
          onPointerDown={(event) => startColumnResize("problemList", event)}
        />

        <section className="statement-pane">
          <div className="panel-header">
            <span>{selectedProblem?.title ?? "Problem"}</span>
            {problem ? <strong>{problem.meta.tags.join(", ")}</strong> : null}
          </div>
          <article className="statement" dangerouslySetInnerHTML={{ __html: statementHtml }} />
        </section>

        <div
          className="resize-handle resize-handle-vertical"
          role="separator"
          aria-label="Resize statement and editor"
          aria-orientation="vertical"
          onPointerDown={(event) => startColumnResize("statement", event)}
        />

        <section className="editor-pane">
          <div className="panel-header">
            <span>Solution.py</span>
            <strong>{savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : "Unsaved draft"}</strong>
          </div>
          <div className="editor-wrap">
            <Editor
              height="100%"
              language="python"
              theme="vs-dark"
              value={code}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: "Menlo, Monaco, Consolas, monospace",
                padding: { top: 16, bottom: 16 },
                scrollBeyondLastLine: false,
                automaticLayout: true
              }}
              onChange={(value) => setCode(value ?? "")}
            />
          </div>
        </section>
      </main>

      <div
        className="resize-handle resize-handle-horizontal"
        role="separator"
        aria-label="Resize test results"
        aria-orientation="horizontal"
        onPointerDown={startResultsResize}
      />

      <section className="results-pane">
        <div className="panel-header">
          <span>Test Results</span>
          {runSummary ? <strong>{runSummary.passed}/{runSummary.results.length} passed</strong> : <strong>No run yet</strong>}
        </div>
        {loadState === "error" ? <div className="empty-state">Could not load the local project data.</div> : null}
        {!runSummary ? (
          <div className="empty-state">Run the solution to see local test output.</div>
        ) : (
          <div className="results-grid">
            {runSummary.results.map((result) => (
              <div key={result.name} className={`result-row result-${result.status}`}>
                <span className="result-status">{result.status}</span>
                <span className="result-name">{result.name}</span>
                <span className="result-detail">expected {JSON.stringify(result.expected)}</span>
                <span className="result-detail">actual {JSON.stringify(result.actual)}</span>
                <span className="result-time">{result.durationMs} ms</span>
                {result.stdout ? <pre className="result-stdout">{result.stdout}</pre> : null}
                {result.error ? <pre className="result-error">{result.error}</pre> : null}
              </div>
            ))}
          </div>
        )}
        <div className="submission-strip">
          {submissions.slice(0, 5).map((submission) => (
            <span key={submission.id}>
              #{submission.id} {submission.result.passed}/{submission.result.results.length} passed
            </span>
          ))}
        </div>
      </section>

      {isAddOpen ? (
        <div className="modal-backdrop" role="presentation">
          <form className="problem-modal" onSubmit={submitProblemForm}>
            <div className="modal-header">
              <div>
                <h2>{problemFormMode === "edit" ? "Edit Problem" : "Add Problem"}</h2>
                <p>{problemFormMode === "edit" ? "Update the local statement, starter code, and tests." : "Create a local problem from pasted content."}</p>
              </div>
              <button className="icon-button" type="button" aria-label="Close" onClick={closeProblemForm}>
                x
              </button>
            </div>

            <div className="form-grid">
              <label>
                <span>Problem ID</span>
                <input
                  value={problemForm.id}
                  placeholder="valid-anagram"
                  onChange={(event) => updateProblemForm("id", event.target.value)}
                  disabled={problemFormMode === "edit"}
                  required
                />
              </label>
              <label>
                <span>Title</span>
                <input
                  value={problemForm.title}
                  placeholder="Valid Anagram"
                  onChange={(event) => updateProblemForm("title", event.target.value)}
                  required
                />
              </label>
              <label>
                <span>Difficulty</span>
                <select
                  value={problemForm.difficulty}
                  onChange={(event) => updateProblemForm("difficulty", event.target.value as Difficulty)}
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </label>
              <label>
                <span>Function Name</span>
                <input
                  value={problemForm.functionName}
                  placeholder="isAnagram"
                  onChange={(event) => updateProblemForm("functionName", event.target.value)}
                  required
                />
              </label>
              <label>
                <span>Tags</span>
                <input
                  value={problemForm.tagsText}
                  placeholder="array, hash-map"
                  onChange={(event) => updateProblemForm("tagsText", event.target.value)}
                />
              </label>
              <label>
                <span>Timeout</span>
                <input
                  min={100}
                  step={100}
                  type="number"
                  value={problemForm.timeLimitMs}
                  onChange={(event) => updateProblemForm("timeLimitMs", Number(event.target.value))}
                  required
                />
              </label>
            </div>

            <label className="stacked-field">
              <span className="field-title-row">
                <span>Statement Markdown</span>
                <button className="secondary-button compact-button" type="button" onClick={() => setIsStatementExpanded(true)}>
                  Expand
                </button>
              </span>
              <textarea value={problemForm.statement} onChange={(event) => updateProblemForm("statement", event.target.value)} />
            </label>

            <div className="split-fields">
              <label className="stacked-field">
                <span>Starter Code</span>
                <textarea value={problemForm.starterCode} onChange={(event) => updateProblemForm("starterCode", event.target.value)} />
              </label>
              <div className="testcase-panel">
                <div className="testcase-panel-header">
                  <span>Test Cases</span>
                  <button className="secondary-button compact-button" type="button" onClick={addTestCase}>
                    Add Case
                  </button>
                </div>
                <div className="testcase-list">
                  {problemForm.testCases.map((testCase, index) => (
                    <div className="testcase-row" key={testCase.id}>
                      <label>
                        <span>Name</span>
                        <input
                          value={testCase.name}
                          onChange={(event) => updateTestCase(testCase.id, { name: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Arguments JSON</span>
                        <input
                          value={testCase.inputText}
                          placeholder="[[2,7,11,15],9]"
                          onChange={(event) => updateTestCase(testCase.id, { inputText: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Expected JSON</span>
                        <input
                          value={testCase.expectedText}
                          placeholder="[0,1]"
                          onChange={(event) => updateTestCase(testCase.id, { expectedText: event.target.value })}
                        />
                      </label>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Remove test case ${index + 1}`}
                        disabled={problemForm.testCases.length === 1}
                        onClick={() => removeTestCase(testCase.id)}
                      >
                        -
                      </button>
                    </div>
                  ))}
                </div>
                <p className="field-hint">Arguments must be a JSON array of function arguments. For Two Sum, use [[2,7,11,15],9].</p>
              </div>
            </div>

            {formError ? <div className="form-error">{formError}</div> : null}

            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={closeProblemForm}>
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={isCreating}>
                {isCreating ? "Saving..." : problemFormMode === "edit" ? "Save Changes" : "Create"}
              </button>
            </div>
          </form>

          {isStatementExpanded ? (
            <div className="expanded-editor-panel">
              <div className="expanded-editor-header">
                <div>
                  <h3>Statement Markdown</h3>
                  <p>Edit pasted problem text and restore inline code formatting.</p>
                </div>
                <button className="icon-button" type="button" aria-label="Close expanded statement editor" onClick={() => setIsStatementExpanded(false)}>
                  x
                </button>
              </div>
              <textarea
                className="expanded-editor-textarea"
                value={problemForm.statement}
                onChange={(event) => updateProblemForm("statement", event.target.value)}
              />
              <div className="expanded-editor-footer">
                <span>Inline code example: `1 &lt;= nums.length &lt;= 10^5`</span>
                <button className="primary-button" type="button" onClick={() => setIsStatementExpanded(false)}>
                  Done
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default App;
