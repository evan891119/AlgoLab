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
import type { Difficulty, ProblemAttemptSummary, ProblemDetail, ProblemLanguage, ProblemNotes, ProblemSource, ProblemStatus, ProblemSummary, RunSummary, Submission } from "@algolab/core";
import {
  createProblem,
  getDraft,
  getProblem,
  getProblemAttemptSummary,
  getProblemNotes,
  getToolchainStatus,
  listProblems,
  listSubmissions,
  runProblemTests,
  saveDraft,
  saveProblemNotes,
  updateProblem,
  type CreateProblemInput,
  type ToolchainStatus
} from "./tauri";

type LoadState = "idle" | "loading" | "error";
type ProblemFormMode = "create" | "edit";
type ProblemPanelTab = "statement" | "notes";

interface ProblemFilters {
  search: string;
  source: "all" | ProblemSource;
  difficulty: "all" | Difficulty;
  status: "all" | ProblemStatus;
  topic: string;
  tag: string;
}

interface TestCaseForm {
  id: string;
  name: string;
  argumentTexts: string[];
  expectedText: string;
}

const createEmptyTestCase = (index: number, parameterCount = 0): TestCaseForm => ({
  id: crypto.randomUUID(),
  name: `example ${index}`,
  argumentTexts: Array.from({ length: parameterCount }, () => "null"),
  expectedText: "null"
});

const starterTemplates: Record<ProblemLanguage, string> = {
  python: "class Solution:\n    def solve(self):\n        return None\n",
  javascript: "class Solution {\n  solve() {\n    return null;\n  }\n}\n\nmodule.exports = Solution;\n"
};

type ProblemForm = Omit<CreateProblemInput, "tags" | "testsJson"> & {
  tagsText: string;
  parametersText: string;
  testCases: TestCaseForm[];
};

const initialProblemForm: ProblemForm = {
  id: "",
  title: "",
  difficulty: "easy",
  tagsText: "",
  source: "custom",
  sourceUrl: "",
  examName: "",
  topic: "",
  pattern: "",
  status: "new",
  language: "python",
  functionName: "solve",
  parametersText: "",
  timeLimitMs: 2000,
  statement: "# New Problem\n\nPaste the problem statement here.",
  starterCode: starterTemplates.python,
  testCases: [createEmptyTestCase(1)]
};

const initialProblemFilters: ProblemFilters = {
  search: "",
  source: "all",
  difficulty: "all",
  status: "all",
  topic: "",
  tag: ""
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const createEmptyProblemNotes = (problemId: string): ProblemNotes => ({
  problemId,
  approach: "",
  keyInsight: "",
  mistakes: "",
  complexity: "",
  reviewNotes: "",
  updatedAt: null
});

const createEmptyAttemptSummary = (problemId: string): ProblemAttemptSummary => ({
  problemId,
  firstAttemptedAt: null,
  lastPracticedAt: null,
  attemptCount: 0,
  bestPassed: 0,
  bestTotal: 0,
  solved: false
});

const parseParametersFromText = (value: string) => value
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

const parseParametersFromPython = (code: string, functionName: string) => {
  const signaturePattern = new RegExp(`def\\s+${functionName}\\s*\\(([^)]*)\\)`);
  const match = code.match(signaturePattern);
  if (!match) return [];

  return match[1]
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name && name !== "self")
    .map((name) => name.replace(/:.*/, "").replace(/=.*/, "").trim())
    .filter(Boolean);
};

const parseParametersFromJavaScript = (code: string, functionName: string) => {
  const signaturePattern = new RegExp(`${functionName}\\s*\\(([^)]*)\\)`);
  const match = code.match(signaturePattern);
  if (!match) return [];

  return match[1]
    .split(",")
    .map((name) => name.trim())
    .map((name) => name.replace(/=.*/, "").trim())
    .filter(Boolean);
};

const parseParametersFromCode = (language: ProblemLanguage, code: string, functionName: string) => (
  language === "javascript"
    ? parseParametersFromJavaScript(code, functionName)
    : parseParametersFromPython(code, functionName)
);

const editorLanguageForProblem = (language: ProblemLanguage) => (
  language === "javascript" ? "javascript" : "python"
);

const fallbackParameterNames = (count: number) => Array.from({ length: count }, (_, index) => `arg${index + 1}`);

const resizeArgumentTexts = (argumentTexts: string[], parameterCount: number) => [
  ...argumentTexts.slice(0, parameterCount),
  ...Array.from({ length: Math.max(0, parameterCount - argumentTexts.length) }, () => "null")
];

const problemToForm = (detail: ProblemDetail): ProblemForm => {
  const parsedParameterNames = parseParametersFromCode(detail.meta.language, detail.starterCode, detail.meta.functionName);
  const maxInputCount = Math.max(0, ...detail.tests.cases.map((testCase) => testCase.input.length));
  const parameterNames = parsedParameterNames.length > 0 ? parsedParameterNames : fallbackParameterNames(maxInputCount);

  return {
    id: detail.meta.id,
    title: detail.meta.title,
    difficulty: detail.meta.difficulty,
    tagsText: detail.meta.tags.join(", "),
    source: detail.meta.source,
    sourceUrl: detail.meta.sourceUrl ?? "",
    examName: detail.meta.examName ?? "",
    topic: detail.meta.topic ?? "",
    pattern: detail.meta.pattern ?? "",
    status: detail.meta.status,
    language: detail.meta.language,
    functionName: detail.meta.functionName,
    parametersText: parameterNames.join(", "),
    timeLimitMs: detail.meta.timeLimitMs,
    statement: detail.statement,
    starterCode: detail.starterCode,
    testCases: detail.tests.cases.map((testCase, index) => ({
      id: crypto.randomUUID(),
      name: testCase.name || `example ${index + 1}`,
      argumentTexts: resizeArgumentTexts(testCase.input.map((value) => JSON.stringify(value)), parameterNames.length),
      expectedText: JSON.stringify(testCase.expected)
    }))
  };
};

function difficultyClass(difficulty: ProblemSummary["difficulty"]) {
  return `difficulty difficulty-${difficulty}`;
}

function sourceLabel(source: ProblemSource) {
  const labels: Record<ProblemSource, string> = {
    leetcode: "LeetCode",
    hackerrank: "HackerRank",
    codesignal: "CodeSignal",
    company: "Company",
    school: "School",
    custom: "Custom"
  };
  return labels[source];
}

function statusLabel(status: ProblemStatus) {
  const labels: Record<ProblemStatus, string> = {
    new: "New",
    attempted: "Attempted",
    solved: "Solved",
    review: "Review"
  };
  return labels[status];
}

function effectiveStatus(problem: ProblemSummary): ProblemStatus {
  const summary = problem.attemptSummary ?? createEmptyAttemptSummary(problem.id);
  if (summary.solved) return "solved";
  if (summary.attemptCount > 0) return "attempted";
  return problem.status;
}

function attemptSummaryText(summary: ProblemAttemptSummary) {
  if (summary.attemptCount === 0) return "No attempts";
  return `${summary.attemptCount} attempt${summary.attemptCount === 1 ? "" : "s"} · best ${summary.bestPassed}/${summary.bestTotal}`;
}

function formatShortDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
}

function codeFilename(language: ProblemLanguage) {
  return language === "javascript" ? "Solution.js" : "Solution.py";
}

function runtimeStatusText(toolchainStatus: ToolchainStatus | null, language: ProblemLanguage | undefined) {
  if (!language) return "No runtime selected";
  if (!toolchainStatus) return "Checking runtime...";
  if (toolchainStatus.available) {
    return `${toolchainStatus.runtimeName}: ${toolchainStatus.version ?? "available"}`;
  }
  return `${toolchainStatus.runtimeName} missing`;
}

function App() {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [problemFilters, setProblemFilters] = useState<ProblemFilters>(initialProblemFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [problemNotes, setProblemNotes] = useState<ProblemNotes | null>(null);
  const [attemptSummary, setAttemptSummary] = useState<ProblemAttemptSummary | null>(null);
  const [problemPanelTab, setProblemPanelTab] = useState<ProblemPanelTab>("statement");
  const [code, setCode] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [toolchainStatus, setToolchainStatus] = useState<ToolchainStatus | null>(null);
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

  const updateProblemFilter = <Key extends keyof ProblemFilters>(key: Key, value: ProblemFilters[Key]) => {
    setProblemFilters((current) => ({ ...current, [key]: value }));
  };

  const clearProblemFilters = () => {
    setProblemFilters(initialProblemFilters);
  };

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
    setProblemNotes(null);
    setAttemptSummary(null);
    Promise.all([
      getProblem(selectedId),
      getDraft(selectedId),
      getProblemNotes(selectedId),
      getProblemAttemptSummary(selectedId),
      listSubmissions(selectedId)
    ])
      .then(([detail, draft, notes, nextAttemptSummary, submissionItems]) => {
        if (cancelled) return;
        setProblem(detail);
        setProblemNotes(notes);
        setAttemptSummary(nextAttemptSummary);
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

  useEffect(() => {
    if (!problem) {
      setToolchainStatus(null);
      return;
    }

    let cancelled = false;
    setToolchainStatus(null);
    getToolchainStatus(problem.meta.language)
      .then((status) => {
        if (cancelled) return;
        setToolchainStatus(status);
      })
      .catch((error) => {
        if (cancelled) return;
        setToolchainStatus({
          language: problem.meta.language,
          runtimeName: problem.meta.language === "javascript" ? "Node.js" : "Python 3",
          command: problem.meta.language === "javascript" ? "node --version" : "python3 --version",
          available: false,
          version: null,
          installHint: "Install the required runtime and try again.",
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return () => {
      cancelled = true;
    };
  }, [problem]);

  const statementHtml = useMemo(() => {
    if (!problem) return "";
    return DOMPurify.sanitize(marked.parse(problem.statement) as string);
  }, [problem]);

  const parameterNames = useMemo(() => {
    if (!problem) return [];
    return parseParametersFromCode(problem.meta.language, code, problem.tests.functionName).length > 0
      ? parseParametersFromCode(problem.meta.language, code, problem.tests.functionName)
      : parseParametersFromCode(problem.meta.language, problem.starterCode, problem.tests.functionName);
  }, [code, problem]);

  useEffect(() => {
    setSelectedResultIndex(0);
  }, [runSummary]);

  const saveCurrentDraft = useCallback(async () => {
    if (!problem) return;
    setStatus("Saving draft...");
    const draft = await saveDraft(problem.meta.id, code);
    setSavedAt(draft.updatedAt);
    setStatus("Draft saved");
  }, [code, problem]);

  const runCurrentTests = useCallback(async () => {
    if (!problem) return;
    if (toolchainStatus && !toolchainStatus.available) {
      setStatus(`${toolchainStatus.runtimeName} is required. ${toolchainStatus.installHint}`);
      return;
    }
    try {
      setStatus("Running tests...");
      await saveCurrentDraft();
      const summary = await runProblemTests(problem.meta.id, code);
      setRunSummary(summary);
      setSubmissions(await listSubmissions(problem.meta.id));
      setAttemptSummary(await getProblemAttemptSummary(problem.meta.id));
      await refreshProblems(problem.meta.id);
      setStatus(`${summary.passed} passed, ${summary.failed} failed in ${summary.durationMs} ms`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [code, problem, refreshProblems, saveCurrentDraft, toolchainStatus]);

  const updateProblemNotes = <Key extends keyof Omit<ProblemNotes, "problemId" | "updatedAt">>(
    key: Key,
    value: ProblemNotes[Key]
  ) => {
    setProblemNotes((current) => ({
      ...(current ?? createEmptyProblemNotes(problem?.meta.id ?? "")),
      [key]: value
    }));
  };

  const saveCurrentNotes = useCallback(async () => {
    if (!problem) return;
    const currentNotes = problemNotes ?? createEmptyProblemNotes(problem.meta.id);
    setStatus("Saving notes...");
    const savedNotes = await saveProblemNotes(problem.meta.id, {
      approach: currentNotes.approach,
      keyInsight: currentNotes.keyInsight,
      mistakes: currentNotes.mistakes,
      complexity: currentNotes.complexity,
      reviewNotes: currentNotes.reviewNotes
    });
    setProblemNotes(savedNotes);
    setStatus("Notes saved");
  }, [problem, problemNotes]);

  const updateProblemForm = <Key extends keyof typeof problemForm>(key: Key, value: (typeof problemForm)[Key]) => {
    setProblemForm((current) => ({ ...current, [key]: value }));
  };

  const updateParametersText = (value: string) => {
    const parameterCount = parseParametersFromText(value).length;
    setProblemForm((current) => ({
      ...current,
      parametersText: value,
      testCases: current.testCases.map((testCase) => ({
        ...testCase,
        argumentTexts: resizeArgumentTexts(testCase.argumentTexts, parameterCount)
      }))
    }));
  };

  const updateProblemLanguage = (language: ProblemLanguage) => {
    setProblemForm((current) => {
      const starterCode = Object.values(starterTemplates).includes(current.starterCode)
        ? starterTemplates[language]
        : current.starterCode;
      return {
        ...current,
        language,
        starterCode
      };
    });
  };

  const inferParametersFromStarter = () => {
    const parameterNames = parseParametersFromCode(problemForm.language, problemForm.starterCode, problemForm.functionName.trim());
    if (parameterNames.length === 0) {
      setFormError("Could not infer parameters from starter code.");
      return;
    }

    setFormError(null);
    updateParametersText(parameterNames.join(", "));
  };

  const updateTestCase = (caseId: string, patch: Partial<TestCaseForm>) => {
    setProblemForm((current) => ({
      ...current,
      testCases: current.testCases.map((testCase) => (testCase.id === caseId ? { ...testCase, ...patch } : testCase))
    }));
  };

  const updateTestCaseArgument = (caseId: string, parameterIndex: number, value: string) => {
    setProblemForm((current) => ({
      ...current,
      testCases: current.testCases.map((testCase) => {
        if (testCase.id !== caseId) return testCase;
        const argumentTexts = [...testCase.argumentTexts];
        argumentTexts[parameterIndex] = value;
        return { ...testCase, argumentTexts };
      })
    }));
  };

  const addTestCase = () => {
    const parameterCount = parseParametersFromText(problemForm.parametersText).length;
    setProblemForm((current) => ({
      ...current,
      testCases: [...current.testCases, createEmptyTestCase(current.testCases.length + 1, parameterCount)]
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
    const parameterNames = parseParametersFromText(problemForm.parametersText);
    const cases = problemForm.testCases.map((testCase) => ({
      name: testCase.name.trim() || "test case",
      input: parameterNames.map((_, index) => JSON.parse(testCase.argumentTexts[index] ?? "null")),
      expected: JSON.parse(testCase.expectedText)
    }));

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
        source: problemForm.source,
        sourceUrl: problemForm.sourceUrl?.trim() || undefined,
        examName: problemForm.examName?.trim() || undefined,
        topic: problemForm.topic?.trim() || undefined,
        pattern: problemForm.pattern?.trim() || undefined,
        status: problemForm.status,
        language: problemForm.language,
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
  const filteredProblems = useMemo(() => {
    const search = problemFilters.search.trim().toLowerCase();
    const topic = problemFilters.topic.trim().toLowerCase();
    const tag = problemFilters.tag.trim().toLowerCase();

    return problems.filter((item) => {
      const status = effectiveStatus(item);
      if (search && !item.title.toLowerCase().includes(search) && !item.id.toLowerCase().includes(search)) {
        return false;
      }
      if (problemFilters.source !== "all" && item.source !== problemFilters.source) {
        return false;
      }
      if (problemFilters.difficulty !== "all" && item.difficulty !== problemFilters.difficulty) {
        return false;
      }
      if (problemFilters.status !== "all" && status !== problemFilters.status) {
        return false;
      }
      if (topic && !(item.topic ?? "").toLowerCase().includes(topic)) {
        return false;
      }
      if (tag && !item.tags.some((itemTag) => itemTag.toLowerCase().includes(tag))) {
        return false;
      }
      return true;
    });
  }, [problemFilters, problems]);
  const selectedResult = runSummary?.results[selectedResultIndex] ?? null;
  const currentAttemptSummary = attemptSummary ?? createEmptyAttemptSummary(problem?.meta.id ?? "");
  const formParameterNames = parseParametersFromText(problemForm.parametersText);
  const canRunTests = Boolean(problem && toolchainStatus?.available);
  const currentLanguage = problem?.meta.language;
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
          <p>Local algorithm practice for coding exams.</p>
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
          <button className="primary-button" disabled={!canRunTests} onClick={runCurrentTests}>
            Run
          </button>
        </div>
      </header>

      <main className="workspace" ref={workspaceRef}>
        <aside className="problem-list">
          <div className="panel-header">
            <span>Problems</span>
            <strong>{filteredProblems.length}/{problems.length}</strong>
          </div>
          <div className="problem-filters">
            <input
              value={problemFilters.search}
              placeholder="Search title or ID"
              onChange={(event) => updateProblemFilter("search", event.target.value)}
            />
            <div className="filter-grid">
              <select
                value={problemFilters.source}
                onChange={(event) => updateProblemFilter("source", event.target.value as ProblemFilters["source"])}
              >
                <option value="all">All sources</option>
                <option value="leetcode">LeetCode</option>
                <option value="hackerrank">HackerRank</option>
                <option value="codesignal">CodeSignal</option>
                <option value="company">Company</option>
                <option value="school">School</option>
                <option value="custom">Custom</option>
              </select>
              <select
                value={problemFilters.difficulty}
                onChange={(event) => updateProblemFilter("difficulty", event.target.value as ProblemFilters["difficulty"])}
              >
                <option value="all">All levels</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
              <select
                value={problemFilters.status}
                onChange={(event) => updateProblemFilter("status", event.target.value as ProblemFilters["status"])}
              >
                <option value="all">All status</option>
                <option value="new">New</option>
                <option value="attempted">Attempted</option>
                <option value="solved">Solved</option>
                <option value="review">Review</option>
              </select>
              <button className="secondary-button compact-button" type="button" onClick={clearProblemFilters}>
                Clear
              </button>
            </div>
            <div className="filter-grid">
              <input
                value={problemFilters.topic}
                placeholder="Topic"
                onChange={(event) => updateProblemFilter("topic", event.target.value)}
              />
              <input
                value={problemFilters.tag}
                placeholder="Tag"
                onChange={(event) => updateProblemFilter("tag", event.target.value)}
              />
            </div>
          </div>
          <div className="list-scroll">
            {filteredProblems.map((item) => {
              const status = effectiveStatus(item);
              return (
                <button
                  key={item.id}
                  className={item.id === selectedId ? "problem-row selected" : "problem-row"}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="problem-title">{item.title}</span>
                  <span className={difficultyClass(item.difficulty)}>{item.difficulty}</span>
                  <span className="problem-meta-line">
                    <span>{sourceLabel(item.source)}</span>
                    <span className={`status-pill status-${status}`}>{statusLabel(status)}</span>
                    {item.topic ? <span>{item.topic}</span> : null}
                  </span>
                  <span className="problem-attempt-line">{attemptSummaryText(item.attemptSummary ?? createEmptyAttemptSummary(item.id))}</span>
                </button>
              );
            })}
            {filteredProblems.length === 0 ? <div className="empty-state compact-empty-state">No problems match the current filters.</div> : null}
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
            <div className="panel-tabs" role="tablist" aria-label="Problem panel">
              <button
                className={problemPanelTab === "statement" ? "panel-tab selected" : "panel-tab"}
                type="button"
                role="tab"
                aria-selected={problemPanelTab === "statement"}
                onClick={() => setProblemPanelTab("statement")}
              >
                Statement
              </button>
              <button
                className={problemPanelTab === "notes" ? "panel-tab selected" : "panel-tab"}
                type="button"
                role="tab"
                aria-selected={problemPanelTab === "notes"}
                onClick={() => setProblemPanelTab("notes")}
              >
                Notes
              </button>
            </div>
            {problemPanelTab === "notes" ? (
              <button className="secondary-button compact-button" disabled={!problem} onClick={saveCurrentNotes}>
                Save Notes
              </button>
            ) : problem ? (
              <strong>{problem.meta.tags.join(", ")}</strong>
            ) : null}
          </div>
          {problemPanelTab === "statement" ? (
            <article className="statement" dangerouslySetInnerHTML={{ __html: statementHtml }} />
          ) : (
            <div className="notes-panel">
              <div className="notes-meta">
                <span>{selectedProblem?.title ?? "Problem"}</span>
                <span>{problemNotes?.updatedAt ? `Saved ${new Date(problemNotes.updatedAt).toLocaleTimeString()}` : "No notes saved"}</span>
              </div>
              <label>
                <span>Approach</span>
                <textarea
                  value={problemNotes?.approach ?? ""}
                  placeholder="Outline the solution strategy."
                  onChange={(event) => updateProblemNotes("approach", event.target.value)}
                />
              </label>
              <label>
                <span>Key Insight</span>
                <textarea
                  value={problemNotes?.keyInsight ?? ""}
                  placeholder="What made the problem click?"
                  onChange={(event) => updateProblemNotes("keyInsight", event.target.value)}
                />
              </label>
              <label>
                <span>Mistakes</span>
                <textarea
                  value={problemNotes?.mistakes ?? ""}
                  placeholder="Record wrong assumptions, edge cases, or bugs."
                  onChange={(event) => updateProblemNotes("mistakes", event.target.value)}
                />
              </label>
              <label>
                <span>Complexity</span>
                <textarea
                  value={problemNotes?.complexity ?? ""}
                  placeholder="Time and space complexity."
                  onChange={(event) => updateProblemNotes("complexity", event.target.value)}
                />
              </label>
              <label>
                <span>Review Notes</span>
                <textarea
                  value={problemNotes?.reviewNotes ?? ""}
                  placeholder="Things to remember before retrying."
                  onChange={(event) => updateProblemNotes("reviewNotes", event.target.value)}
                />
              </label>
            </div>
          )}
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
            <div className="editor-title">
              <span>{codeFilename(problem?.meta.language ?? "python")}</span>
              <span className={toolchainStatus ? (toolchainStatus.available ? "runtime-inline runtime-ready" : "runtime-inline runtime-missing") : "runtime-inline runtime-checking"}>
                {runtimeStatusText(toolchainStatus, currentLanguage)}
              </span>
            </div>
            <strong>{savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : "Unsaved draft"}</strong>
          </div>
          <div className="attempt-summary-bar">
            <span>Attempts: {currentAttemptSummary.attemptCount}</span>
            <span>Best: {currentAttemptSummary.bestPassed}/{currentAttemptSummary.bestTotal}</span>
            <span>First: {formatShortDateTime(currentAttemptSummary.firstAttemptedAt)}</span>
            <span>Last: {formatShortDateTime(currentAttemptSummary.lastPracticedAt)}</span>
          </div>
          <div className="editor-wrap">
            <Editor
              height="100%"
              language={editorLanguageForProblem(problem?.meta.language ?? "python")}
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
          <div className="case-results">
            <div className="case-tabs" role="tablist" aria-label="Test cases">
              {runSummary.results.map((result, index) => (
                <button
                  key={result.name}
                  className={index === selectedResultIndex ? `case-tab selected case-tab-${result.status}` : `case-tab case-tab-${result.status}`}
                  type="button"
                  role="tab"
                  aria-selected={index === selectedResultIndex}
                  onClick={() => setSelectedResultIndex(index)}
                >
                  Case {index + 1}
                </button>
              ))}
            </div>

            {selectedResult ? (
              <div className={`case-detail result-${selectedResult.status}`}>
                <div className="case-detail-header">
                  <span className="result-status">{selectedResult.status}</span>
                  <span>{selectedResult.name}</span>
                  <span className="result-time">{selectedResult.durationMs} ms</span>
                </div>

                <div className="case-fields">
                  {selectedResult.input.map((value, index) => (
                    <div className="case-field" key={`${selectedResult.name}-${index}`}>
                      <span>{parameterNames[index] ?? `arg${index + 1}`} =</span>
                      <pre>{JSON.stringify(value)}</pre>
                    </div>
                  ))}
                  <div className="case-field">
                    <span>Expected =</span>
                    <pre>{JSON.stringify(selectedResult.expected)}</pre>
                  </div>
                  <div className="case-field">
                    <span>Actual =</span>
                    <pre>{JSON.stringify(selectedResult.actual)}</pre>
                  </div>
                  {selectedResult.stdout ? (
                    <div className="case-field">
                      <span>Stdout =</span>
                      <pre>{selectedResult.stdout}</pre>
                    </div>
                  ) : null}
                  {selectedResult.error ? (
                    <div className="case-field case-field-wide">
                      <span>Error =</span>
                      <pre>{selectedResult.error}</pre>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
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
                <span>Language</span>
                <select
                  value={problemForm.language}
                  onChange={(event) => updateProblemLanguage(event.target.value as ProblemLanguage)}
                >
                  <option value="python">Python</option>
                  <option value="javascript">JavaScript</option>
                </select>
              </label>
              <label>
                <span className="field-title-row">
                  <span>Parameters</span>
                  <button className="secondary-button compact-button" type="button" onClick={inferParametersFromStarter}>
                    Infer
                  </button>
                </span>
                <input
                  value={problemForm.parametersText}
                  placeholder="nums, target"
                  onChange={(event) => updateParametersText(event.target.value)}
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

            <div className="form-section">
              <div className="section-title">Practice Metadata</div>
              <div className="form-grid">
                <label>
                  <span>Source</span>
                  <select
                    value={problemForm.source}
                    onChange={(event) => updateProblemForm("source", event.target.value as ProblemSource)}
                  >
                    <option value="custom">Custom</option>
                    <option value="leetcode">LeetCode</option>
                    <option value="hackerrank">HackerRank</option>
                    <option value="codesignal">CodeSignal</option>
                    <option value="company">Company</option>
                    <option value="school">School</option>
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={problemForm.status}
                    onChange={(event) => updateProblemForm("status", event.target.value as ProblemStatus)}
                  >
                    <option value="new">New</option>
                    <option value="attempted">Attempted</option>
                    <option value="solved">Solved</option>
                    <option value="review">Review</option>
                  </select>
                </label>
                <label>
                  <span>Topic</span>
                  <input
                    value={problemForm.topic ?? ""}
                    placeholder="array, graph, dp"
                    onChange={(event) => updateProblemForm("topic", event.target.value)}
                  />
                </label>
                <label>
                  <span>Pattern</span>
                  <input
                    value={problemForm.pattern ?? ""}
                    placeholder="two pointers, prefix sum"
                    onChange={(event) => updateProblemForm("pattern", event.target.value)}
                  />
                </label>
                <label>
                  <span>Exam Name</span>
                  <input
                    value={problemForm.examName ?? ""}
                    placeholder="company phone screen"
                    onChange={(event) => updateProblemForm("examName", event.target.value)}
                  />
                </label>
                <label>
                  <span>Source URL</span>
                  <input
                    value={problemForm.sourceUrl ?? ""}
                    placeholder="https://..."
                    onChange={(event) => updateProblemForm("sourceUrl", event.target.value)}
                  />
                </label>
              </div>
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
                      <label className="testcase-name-field">
                        <span>Name</span>
                        <input
                          value={testCase.name}
                          onChange={(event) => updateTestCase(testCase.id, { name: event.target.value })}
                        />
                      </label>
                      <div className="testcase-arguments">
                        {formParameterNames.length === 0 ? (
                          <div className="testcase-no-args">No parameters defined. This case will call the function with no arguments.</div>
                        ) : (
                          formParameterNames.map((parameterName, parameterIndex) => (
                            <label key={`${testCase.id}-${parameterName}-${parameterIndex}`}>
                              <span>{parameterName}</span>
                              <input
                                value={testCase.argumentTexts[parameterIndex] ?? "null"}
                                placeholder={parameterIndex === 0 ? "[2,7,11,15]" : "9"}
                                onChange={(event) => updateTestCaseArgument(testCase.id, parameterIndex, event.target.value)}
                              />
                            </label>
                          ))
                        )}
                      </div>
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
                <p className="field-hint">Each parameter value must be JSON. Strings need quotes, arrays use brackets, and objects use braces.</p>
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
