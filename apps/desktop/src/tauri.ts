import { invoke } from "@tauri-apps/api/core";
import { summarizeResults, type Difficulty, type ProblemDetail, type ProblemSummary, type RunSummary, type SolutionDraft, type Submission } from "@algolab/core";
import sampleMeta from "../../../examples/problems/two-sum/meta.json";
import sampleStatement from "../../../examples/problems/two-sum/problem.md?raw";
import sampleStarter from "../../../examples/problems/two-sum/starter.py?raw";
import sampleTests from "../../../examples/problems/two-sum/tests.json";

const hasTauriRuntime = () => "__TAURI_INTERNALS__" in window;

let mockDraft: SolutionDraft | null = null;
let mockSubmissionId = 1;
let mockSubmissions: Submission[] = [];
let mockCreatedProblems: ProblemDetail[] = [];

export interface CreateProblemInput {
  id: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  functionName: string;
  timeLimitMs: number;
  statement: string;
  starterCode: string;
  testsJson: string;
}

const sampleProblem: ProblemDetail = {
  meta: sampleMeta as ProblemDetail["meta"],
  statement: sampleStatement,
  starterCode: sampleStarter,
  tests: sampleTests as ProblemDetail["tests"]
};

export function listProblems(): Promise<ProblemSummary[]> {
  if (!hasTauriRuntime()) {
    return Promise.resolve([
      {
        id: sampleProblem.meta.id,
        title: sampleProblem.meta.title,
        difficulty: sampleProblem.meta.difficulty,
        tags: sampleProblem.meta.tags
      },
      ...mockCreatedProblems.map((problem) => ({
        id: problem.meta.id,
        title: problem.meta.title,
        difficulty: problem.meta.difficulty,
        tags: problem.meta.tags
      }))
    ]);
  }

  return invoke("list_problems");
}

export function getProblem(problemId: string): Promise<ProblemDetail> {
  if (!hasTauriRuntime()) {
    const problem = [sampleProblem, ...mockCreatedProblems].find((item) => item.meta.id === problemId);
    return problem ? Promise.resolve(problem) : Promise.reject(new Error(`Unknown mock problem: ${problemId}`));
  }

  return invoke("get_problem", { problemId });
}

export function createProblem(input: CreateProblemInput): Promise<ProblemDetail> {
  if (!hasTauriRuntime()) {
    if ([sampleProblem, ...mockCreatedProblems].some((problem) => problem.meta.id === input.id)) {
      return Promise.reject(new Error(`Problem '${input.id}' already exists.`));
    }

    const parsedTests = JSON.parse(input.testsJson) as ProblemDetail["tests"];
    const problem: ProblemDetail = {
      meta: {
        id: input.id,
        title: input.title,
        difficulty: input.difficulty,
        tags: input.tags,
        functionName: input.functionName,
        timeLimitMs: input.timeLimitMs
      },
      statement: input.statement,
      starterCode: input.starterCode,
      tests: parsedTests
    };
    mockCreatedProblems = [...mockCreatedProblems, problem];
    return Promise.resolve(problem);
  }

  return invoke("create_problem", { request: input });
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

export function runProblemTests(problemId: string, code: string): Promise<RunSummary> {
  if (!hasTauriRuntime()) {
    const isSolved = code.includes("seen") && code.includes("target -");
    const results = sampleProblem.tests.cases.map((testCase) => ({
      name: testCase.name,
      status: isSolved ? "passed" : "failed",
      input: testCase.input,
      expected: testCase.expected,
      actual: isSolved ? testCase.expected : [],
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
