import type { RunSummary } from "./judge";

export interface Submission {
  id: number;
  problemId: string;
  code: string;
  result: RunSummary;
  createdAt: string;
}

export interface SolutionDraft {
  problemId: string;
  code: string;
  updatedAt: string;
}

export interface StorageAdapter {
  getDraft(problemId: string): Promise<SolutionDraft | null>;
  saveDraft(problemId: string, code: string): Promise<SolutionDraft>;
  recordSubmission(problemId: string, code: string, result: RunSummary): Promise<Submission>;
  listSubmissions(problemId: string): Promise<Submission[]>;
}
