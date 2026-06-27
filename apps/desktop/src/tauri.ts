import { invoke } from "@tauri-apps/api/core";
import {
  summarizeResults,
  type Difficulty,
  type ProblemAttemptSummary,
  type ProblemDetail,
  type ProblemLanguage,
  type ProblemNotes,
  type ProblemSource,
  type ProblemStatus,
  type ProblemSummary,
  type RunSummary,
  type SolutionDraft,
  type Submission
} from "@algolab/core";
import sampleMeta from "../../../examples/problems/two-sum/meta.json";
import sampleStatement from "../../../examples/problems/two-sum/problem.md?raw";
import sampleStarter from "../../../examples/problems/two-sum/starter.py?raw";
import sampleTests from "../../../examples/problems/two-sum/tests.json";

const hasTauriRuntime = () => "__TAURI_INTERNALS__" in window;

let mockDraft: SolutionDraft | null = null;
let mockSubmissionId = 1;
let mockSubmissions: Submission[] = [];
let mockCreatedProblems: ProblemDetail[] = [];
let mockUpdatedProblems = new Map<string, ProblemDetail>();
let mockProblemNotes = new Map<string, ProblemNotes>();

export interface CreateProblemInput {
  id: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  source: ProblemSource;
  sourceUrl?: string;
  examName?: string;
  topic?: string;
  pattern?: string;
  status: ProblemStatus;
  language: ProblemLanguage;
  functionName: string;
  timeLimitMs: number;
  statement: string;
  starterCode: string;
  testsJson: string;
}

export type SaveProblemNotesInput = Omit<ProblemNotes, "problemId" | "updatedAt">;

const emptyProblemNotes = (problemId: string): ProblemNotes => ({
  problemId,
  approach: "",
  keyInsight: "",
  mistakes: "",
  complexity: "",
  reviewNotes: "",
  updatedAt: null
});

const emptyAttemptSummary = (problemId: string): ProblemAttemptSummary => ({
  problemId,
  firstAttemptedAt: null,
  lastPracticedAt: null,
  attemptCount: 0,
  bestPassed: 0,
  bestTotal: 0,
  solved: false
});

const getMockAttemptSummary = (problemId: string): ProblemAttemptSummary => {
  const submissions = mockSubmissions
    .filter((submission) => submission.problemId === problemId)
    .slice()
    .sort((left, right) => left.id - right.id);
  const summary = emptyAttemptSummary(problemId);

  for (const submission of submissions) {
    const total = submission.result.results.length;
    const isBetter = submission.result.passed > summary.bestPassed ||
      (submission.result.passed === summary.bestPassed && total > summary.bestTotal);
    summary.firstAttemptedAt ??= submission.createdAt;
    summary.lastPracticedAt = submission.createdAt;
    summary.attemptCount += 1;
    if (isBetter) {
      summary.bestPassed = submission.result.passed;
      summary.bestTotal = total;
    }
    if (total > 0 && submission.result.passed === total) {
      summary.solved = true;
    }
  }

  return summary;
};

const sampleProblem: ProblemDetail = {
  meta: {
    ...(sampleMeta as Omit<ProblemDetail["meta"], "source" | "status" | "language">),
    source: "leetcode",
    topic: "array",
    pattern: "hash map",
    status: "new",
    language: "python"
  },
  statement: sampleStatement,
  starterCode: sampleStarter,
  tests: sampleTests as ProblemDetail["tests"]
};

const buildProblemFromInput = (input: CreateProblemInput): ProblemDetail => ({
  meta: {
    id: input.id,
    title: input.title,
    difficulty: input.difficulty,
    tags: input.tags,
    source: input.source,
    sourceUrl: input.sourceUrl,
    examName: input.examName,
    topic: input.topic,
    pattern: input.pattern,
    status: input.status,
    language: input.language,
    functionName: input.functionName,
    timeLimitMs: input.timeLimitMs
  },
  statement: input.statement,
  starterCode: input.starterCode,
  tests: JSON.parse(input.testsJson) as ProblemDetail["tests"]
});

const getMockProblems = () => [
  mockUpdatedProblems.get(sampleProblem.meta.id) ?? sampleProblem,
  ...mockCreatedProblems.map((problem) => mockUpdatedProblems.get(problem.meta.id) ?? problem)
];

export function listProblems(): Promise<ProblemSummary[]> {
  if (!hasTauriRuntime()) {
    return Promise.resolve(
      getMockProblems().map((problem) => ({
        id: problem.meta.id,
        title: problem.meta.title,
        difficulty: problem.meta.difficulty,
        tags: problem.meta.tags,
        source: problem.meta.source,
        topic: problem.meta.topic,
        status: problem.meta.status,
        attemptSummary: getMockAttemptSummary(problem.meta.id)
      }))
    );
  }

  return invoke("list_problems");
}

export function getProblem(problemId: string): Promise<ProblemDetail> {
  if (!hasTauriRuntime()) {
    const problem = getMockProblems().find((item) => item.meta.id === problemId);
    return problem ? Promise.resolve(problem) : Promise.reject(new Error(`Unknown mock problem: ${problemId}`));
  }

  return invoke("get_problem", { problemId });
}

export function createProblem(input: CreateProblemInput): Promise<ProblemDetail> {
  if (!hasTauriRuntime()) {
    if (getMockProblems().some((problem) => problem.meta.id === input.id)) {
      return Promise.reject(new Error(`Problem '${input.id}' already exists.`));
    }

    const problem = buildProblemFromInput(input);
    mockCreatedProblems = [...mockCreatedProblems, problem];
    return Promise.resolve(problem);
  }

  return invoke("create_problem", { request: input });
}

export function updateProblem(problemId: string, input: CreateProblemInput): Promise<ProblemDetail> {
  if (!hasTauriRuntime()) {
    if (input.id !== problemId) {
      return Promise.reject(new Error("Problem id cannot be changed while editing."));
    }
    if (!getMockProblems().some((problem) => problem.meta.id === problemId)) {
      return Promise.reject(new Error(`Unknown mock problem: ${problemId}`));
    }

    const problem = buildProblemFromInput(input);
    mockUpdatedProblems = new Map(mockUpdatedProblems).set(problemId, problem);
    return Promise.resolve(problem);
  }

  return invoke("update_problem", { problemId, request: input });
}

export function getDraft(problemId: string): Promise<SolutionDraft | null> {
  if (!hasTauriRuntime()) {
    return Promise.resolve(mockDraft?.problemId === problemId ? mockDraft : null);
  }

  return invoke("get_draft", { problemId });
}

export function saveDraft(problemId: string, code: string): Promise<SolutionDraft> {
  if (!hasTauriRuntime()) {
    mockDraft = {
      problemId,
      code,
      updatedAt: new Date().toISOString()
    };
    return Promise.resolve(mockDraft);
  }

  return invoke("save_draft", { problemId, code });
}

export function getProblemNotes(problemId: string): Promise<ProblemNotes> {
  if (!hasTauriRuntime()) {
    return Promise.resolve(mockProblemNotes.get(problemId) ?? emptyProblemNotes(problemId));
  }

  return invoke("get_problem_notes", { problemId });
}

export function saveProblemNotes(problemId: string, notes: SaveProblemNotesInput): Promise<ProblemNotes> {
  if (!hasTauriRuntime()) {
    const savedNotes: ProblemNotes = {
      problemId,
      ...notes,
      updatedAt: new Date().toISOString()
    };
    mockProblemNotes = new Map(mockProblemNotes).set(problemId, savedNotes);
    return Promise.resolve(savedNotes);
  }

  return invoke("save_problem_notes", { problemId, notes });
}

export function getProblemAttemptSummary(problemId: string): Promise<ProblemAttemptSummary> {
  if (!hasTauriRuntime()) {
    return Promise.resolve(getMockAttemptSummary(problemId));
  }

  return invoke("get_problem_attempt_summary", { problemId });
}

export function runProblemTests(problemId: string, code: string): Promise<RunSummary> {
  if (!hasTauriRuntime()) {
    const problem = getMockProblems().find((item) => item.meta.id === problemId) ?? sampleProblem;
    const isSolved = code.includes("seen") && code.includes("target -");
    const results = problem.tests.cases.map((testCase) => ({
      name: testCase.name,
      status: isSolved ? "passed" : "failed",
      input: testCase.input,
      expected: testCase.expected,
      actual: isSolved ? testCase.expected : [],
      stdout: code.includes("print(") ? "Mock browser mode does not execute Python, but desktop mode will show real print output here." : undefined,
      durationMs: 1
    })) as RunSummary["results"];
    const summary = summarizeResults(results);
    mockSubmissions = [
      {
        id: mockSubmissionId++,
        problemId,
        code,
        result: summary,
        createdAt: new Date().toISOString()
      },
      ...mockSubmissions
    ];
    return Promise.resolve(summary);
  }

  return invoke("run_tests", { problemId, code });
}

export function listSubmissions(problemId: string): Promise<Submission[]> {
  if (!hasTauriRuntime()) {
    return Promise.resolve(mockSubmissions.filter((submission) => submission.problemId === problemId));
  }

  return invoke("list_submissions", { problemId });
}
