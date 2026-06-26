import Editor from "@monaco-editor/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProblemDetail, ProblemSummary, RunSummary, Submission } from "@lc-lab/core";
import { getDraft, getProblem, listProblems, listSubmissions, runProblemTests, saveDraft } from "./tauri";

type LoadState = "idle" | "loading" | "error";

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

  const selectedProblem = problems.find((item) => item.id === selectedId);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>LC Lab</h1>
          <p>Local coding practice for Python problems.</p>
        </div>
        <div className="toolbar">
          <span className="status-text">{status}</span>
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
    </div>
  );
}

export default App;
