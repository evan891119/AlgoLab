import Editor from "@monaco-editor/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Difficulty, ProblemDetail, ProblemSummary, RunSummary, Submission } from "@algolab/core";
import { createProblem, getDraft, getProblem, listProblems, listSubmissions, runProblemTests, saveDraft, type CreateProblemInput } from "./tauri";

type LoadState = "idle" | "loading" | "error";

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

const initialProblemForm: Omit<CreateProblemInput, "tags" | "testsJson"> & { tagsText: string; testCases: TestCaseForm[] } = {
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

function difficultyClass(difficulty: ProblemSummary["difficulty"]) {
  return `difficulty difficulty-${difficulty}`;
}

function App() {
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
  const [problemForm, setProblemForm] = useState(initialProblemForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

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

  const submitNewProblem = async (event: FormEvent<HTMLFormElement>) => {
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
      const created = await createProblem(input);
      await refreshProblems(created.meta.id);
      setProblemForm({ ...initialProblemForm, testCases: [createEmptyTestCase(1)] });
      setIsAddOpen(false);
      setStatus(`Created ${created.meta.title}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreating(false);
    }
  };

  const selectedProblem = problems.find((item) => item.id === selectedId);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>AlgoLab</h1>
          <p>Local algorithm practice for Python problems.</p>
        </div>
        <div className="toolbar">
          <span className="status-text">{status}</span>
          <button className="secondary-button" onClick={() => setIsAddOpen(true)}>
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

      <main className="workspace">
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

        <section className="statement-pane">
          <div className="panel-header">
            <span>{selectedProblem?.title ?? "Problem"}</span>
            {problem ? <strong>{problem.meta.tags.join(", ")}</strong> : null}
          </div>
          <article className="statement" dangerouslySetInnerHTML={{ __html: statementHtml }} />
        </section>

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
          <form className="problem-modal" onSubmit={submitNewProblem}>
            <div className="modal-header">
              <div>
                <h2>Add Problem</h2>
                <p>Create a local problem from pasted content.</p>
              </div>
              <button className="icon-button" type="button" aria-label="Close" onClick={() => setIsAddOpen(false)}>
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
              <span>Statement Markdown</span>
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
              <button className="secondary-button" type="button" onClick={() => setIsAddOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={isCreating}>
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default App;
