use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Instant,
};
use tauri::Manager;
use tempfile::tempdir;
use wait_timeout::ChildExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
enum Difficulty {
    Easy,
    Medium,
    Hard,
}

fn default_problem_source() -> String {
    "custom".to_string()
}

fn default_problem_status() -> String {
    "new".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProblemMeta {
    id: String,
    title: String,
    difficulty: Difficulty,
    tags: Vec<String>,
    #[serde(default = "default_problem_source")]
    source: String,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    exam_name: Option<String>,
    #[serde(default)]
    topic: Option<String>,
    #[serde(default)]
    pattern: Option<String>,
    #[serde(default = "default_problem_status")]
    status: String,
    function_name: String,
    time_limit_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TestCase {
    name: String,
    input: Vec<Value>,
    expected: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProblemTests {
    version: u8,
    function_name: String,
    cases: Vec<TestCase>,
}

#[derive(Debug, Serialize)]
struct ProblemSummary {
    id: String,
    title: String,
    difficulty: Difficulty,
    tags: Vec<String>,
    source: String,
    topic: Option<String>,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProblemDetail {
    meta: ProblemMeta,
    statement: String,
    starter_code: String,
    tests: ProblemTests,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProblemWriteRequest {
    id: String,
    title: String,
    difficulty: Difficulty,
    tags: Vec<String>,
    source: String,
    source_url: Option<String>,
    exam_name: Option<String>,
    topic: Option<String>,
    pattern: Option<String>,
    status: String,
    function_name: String,
    time_limit_ms: u64,
    statement: String,
    starter_code: String,
    tests_json: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum TestStatus {
    Passed,
    Failed,
    Error,
    Timeout,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestResult {
    name: String,
    status: TestStatus,
    input: Vec<Value>,
    expected: Value,
    actual: Option<Value>,
    error: Option<String>,
    stdout: Option<String>,
    duration_ms: u128,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunSummary {
    passed: usize,
    failed: usize,
    duration_ms: u128,
    results: Vec<TestResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SolutionDraft {
    problem_id: String,
    code: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProblemNotes {
    problem_id: String,
    approach: String,
    key_insight: String,
    mistakes: String,
    complexity: String,
    review_notes: String,
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProblemNotesRequest {
    approach: String,
    key_insight: String,
    mistakes: String,
    complexity: String,
    review_notes: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Submission {
    id: i64,
    problem_id: String,
    code: String,
    result: RunSummary,
    created_at: String,
}

fn repo_root() -> Result<PathBuf, String> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .map(Path::to_path_buf)
        .ok_or_else(|| "Could not locate repository root.".to_string())
}

fn problems_dir() -> Result<PathBuf, String> {
    Ok(repo_root()?.join("examples").join("problems"))
}

fn problem_path(problem_id: &str) -> Result<PathBuf, String> {
    if problem_id.contains('/') || problem_id.contains('\\') || problem_id.contains("..") {
        return Err("Invalid problem id.".to_string());
    }

    Ok(problems_dir()?.join(problem_id))
}

fn validate_problem_id(problem_id: &str) -> Result<(), String> {
    if problem_id.is_empty() {
        return Err("Problem id is required.".to_string());
    }

    let valid = problem_id.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    });
    if !valid {
        return Err(
            "Problem id may only contain lowercase letters, numbers, and hyphens.".to_string(),
        );
    }

    Ok(())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let raw =
        fs::read_to_string(path).map_err(|error| format!("Failed to read {path:?}: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("Failed to parse {path:?}: {error}"))
}

fn read_problem(problem_id: &str) -> Result<ProblemDetail, String> {
    let path = problem_path(problem_id)?;
    let meta: ProblemMeta = read_json(&path.join("meta.json"))?;
    let tests: ProblemTests = read_json(&path.join("tests.json"))?;
    let statement = fs::read_to_string(path.join("problem.md"))
        .map_err(|error| format!("Failed to read problem statement: {error}"))?;
    let starter_code = fs::read_to_string(path.join("starter.py"))
        .map_err(|error| format!("Failed to read starter code: {error}"))?;

    Ok(ProblemDetail {
        meta,
        statement,
        starter_code,
        tests,
    })
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;
    Ok(dir.join("algolab.sqlite3"))
}

fn open_database(app: &tauri::AppHandle) -> Result<Connection, String> {
    let connection = Connection::open(database_path(app)?)
        .map_err(|error| format!("Could not open SQLite database: {error}"))?;
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS drafts (
                problem_id TEXT PRIMARY KEY,
                code TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                problem_id TEXT NOT NULL,
                code TEXT NOT NULL,
                result_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS problem_notes (
                problem_id TEXT PRIMARY KEY,
                approach TEXT NOT NULL,
                key_insight TEXT NOT NULL,
                mistakes TEXT NOT NULL,
                complexity TEXT NOT NULL,
                review_notes TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ",
        )
        .map_err(|error| format!("Could not initialize SQLite schema: {error}"))?;
    Ok(connection)
}

fn empty_problem_notes(problem_id: String) -> ProblemNotes {
    ProblemNotes {
        problem_id,
        approach: String::new(),
        key_insight: String::new(),
        mistakes: String::new(),
        complexity: String::new(),
        review_notes: String::new(),
        updated_at: None,
    }
}

#[tauri::command]
fn list_problems() -> Result<Vec<ProblemSummary>, String> {
    let mut problems = Vec::new();
    let entries = fs::read_dir(problems_dir()?)
        .map_err(|error| format!("Could not read problems directory: {error}"))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not read problem directory entry: {error}"))?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }

        let meta_path = entry.path().join("meta.json");
        if !meta_path.exists() {
            continue;
        }

        let meta: ProblemMeta = read_json(&meta_path)?;
        problems.push(ProblemSummary {
            id: meta.id,
            title: meta.title,
            difficulty: meta.difficulty,
            tags: meta.tags,
            source: meta.source,
            topic: meta.topic,
            status: meta.status,
        });
    }

    problems.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(problems)
}

#[tauri::command]
fn get_problem(problem_id: String) -> Result<ProblemDetail, String> {
    read_problem(&problem_id)
}

fn validate_problem_write_request(
    request: &ProblemWriteRequest,
) -> Result<(ProblemMeta, ProblemTests), String> {
    validate_problem_id(&request.id)?;

    if request.title.trim().is_empty() {
        return Err("Title is required.".to_string());
    }
    if request.function_name.trim().is_empty() {
        return Err("Function name is required.".to_string());
    }
    if request.statement.trim().is_empty() {
        return Err("Problem statement is required.".to_string());
    }
    if !matches!(
        request.source.as_str(),
        "leetcode" | "hackerrank" | "codesignal" | "company" | "school" | "custom"
    ) {
        return Err("Problem source is invalid.".to_string());
    }
    if !matches!(
        request.status.as_str(),
        "new" | "attempted" | "solved" | "review"
    ) {
        return Err("Problem status is invalid.".to_string());
    }

    let tests: ProblemTests = serde_json::from_str(&request.tests_json)
        .map_err(|error| format!("Tests JSON is invalid: {error}"))?;
    if tests.version != 1 {
        return Err("Tests JSON version must be 1.".to_string());
    }
    if tests.function_name != request.function_name {
        return Err("Tests JSON functionName must match the problem function name.".to_string());
    }

    let meta = ProblemMeta {
        id: request.id.clone(),
        title: request.title.clone(),
        difficulty: request.difficulty.clone(),
        tags: request.tags.clone(),
        source: request.source.clone(),
        source_url: request
            .source_url
            .clone()
            .filter(|value| !value.trim().is_empty()),
        exam_name: request
            .exam_name
            .clone()
            .filter(|value| !value.trim().is_empty()),
        topic: request
            .topic
            .clone()
            .filter(|value| !value.trim().is_empty()),
        pattern: request
            .pattern
            .clone()
            .filter(|value| !value.trim().is_empty()),
        status: request.status.clone(),
        function_name: request.function_name.clone(),
        time_limit_ms: request.time_limit_ms,
    };

    Ok((meta, tests))
}

fn write_problem_files(
    problem_dir: &Path,
    meta: &ProblemMeta,
    tests: &ProblemTests,
    request: ProblemWriteRequest,
) -> Result<ProblemDetail, String> {
    fs::create_dir_all(problems_dir()?)
        .map_err(|error| format!("Could not create problems directory: {error}"))?;
    fs::write(
        problem_dir.join("meta.json"),
        serde_json::to_string_pretty(&meta).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Could not write meta.json: {error}"))?;
    fs::write(problem_dir.join("problem.md"), request.statement)
        .map_err(|error| format!("Could not write problem.md: {error}"))?;
    fs::write(problem_dir.join("starter.py"), request.starter_code)
        .map_err(|error| format!("Could not write starter.py: {error}"))?;
    fs::write(
        problem_dir.join("tests.json"),
        serde_json::to_string_pretty(&tests).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Could not write tests.json: {error}"))?;

    read_problem(&meta.id)
}

#[tauri::command]
fn create_problem(request: ProblemWriteRequest) -> Result<ProblemDetail, String> {
    let (meta, tests) = validate_problem_write_request(&request)?;
    let problem_dir = problem_path(&request.id)?;
    if problem_dir.exists() {
        return Err(format!("Problem '{}' already exists.", request.id));
    }

    fs::create_dir_all(problems_dir()?)
        .map_err(|error| format!("Could not create problems directory: {error}"))?;
    fs::create_dir(&problem_dir)
        .map_err(|error| format!("Could not create problem directory: {error}"))?;
    write_problem_files(&problem_dir, &meta, &tests, request)
}

#[tauri::command]
fn update_problem(
    problem_id: String,
    request: ProblemWriteRequest,
) -> Result<ProblemDetail, String> {
    validate_problem_id(&problem_id)?;
    if request.id != problem_id {
        return Err("Problem id cannot be changed while editing.".to_string());
    }

    let (meta, tests) = validate_problem_write_request(&request)?;
    let problem_dir = problem_path(&problem_id)?;
    if !problem_dir.exists() {
        return Err(format!("Problem '{problem_id}' does not exist."));
    }

    write_problem_files(&problem_dir, &meta, &tests, request)
}

#[tauri::command]
fn get_draft(app: tauri::AppHandle, problem_id: String) -> Result<Option<SolutionDraft>, String> {
    let connection = open_database(&app)?;
    let mut statement = connection
        .prepare("SELECT problem_id, code, updated_at FROM drafts WHERE problem_id = ?1")
        .map_err(|error| error.to_string())?;

    let mut rows = statement
        .query_map(params![problem_id], |row| {
            Ok(SolutionDraft {
                problem_id: row.get(0)?,
                code: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;

    match rows.next() {
        Some(row) => row.map(Some).map_err(|error| error.to_string()),
        None => Ok(None),
    }
}

#[tauri::command]
fn save_draft(
    app: tauri::AppHandle,
    problem_id: String,
    code: String,
) -> Result<SolutionDraft, String> {
    let updated_at = Utc::now().to_rfc3339();
    let connection = open_database(&app)?;
    connection
        .execute(
            "
            INSERT INTO drafts (problem_id, code, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(problem_id) DO UPDATE SET
                code = excluded.code,
                updated_at = excluded.updated_at
            ",
            params![problem_id, code, updated_at],
        )
        .map_err(|error| format!("Could not save draft: {error}"))?;

    Ok(SolutionDraft {
        problem_id,
        code,
        updated_at,
    })
}

#[tauri::command]
fn get_problem_notes(app: tauri::AppHandle, problem_id: String) -> Result<ProblemNotes, String> {
    validate_problem_id(&problem_id)?;
    let connection = open_database(&app)?;
    let mut statement = connection
        .prepare(
            "
            SELECT problem_id, approach, key_insight, mistakes, complexity, review_notes, updated_at
            FROM problem_notes
            WHERE problem_id = ?1
            ",
        )
        .map_err(|error| error.to_string())?;

    let mut rows = statement
        .query_map(params![problem_id.clone()], |row| {
            Ok(ProblemNotes {
                problem_id: row.get(0)?,
                approach: row.get(1)?,
                key_insight: row.get(2)?,
                mistakes: row.get(3)?,
                complexity: row.get(4)?,
                review_notes: row.get(5)?,
                updated_at: Some(row.get(6)?),
            })
        })
        .map_err(|error| error.to_string())?;

    match rows.next() {
        Some(row) => row.map_err(|error| error.to_string()),
        None => Ok(empty_problem_notes(problem_id)),
    }
}

#[tauri::command]
fn save_problem_notes(
    app: tauri::AppHandle,
    problem_id: String,
    notes: ProblemNotesRequest,
) -> Result<ProblemNotes, String> {
    validate_problem_id(&problem_id)?;
    let updated_at = Utc::now().to_rfc3339();
    let connection = open_database(&app)?;
    connection
        .execute(
            "
            INSERT INTO problem_notes (
                problem_id, approach, key_insight, mistakes, complexity, review_notes, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(problem_id) DO UPDATE SET
                approach = excluded.approach,
                key_insight = excluded.key_insight,
                mistakes = excluded.mistakes,
                complexity = excluded.complexity,
                review_notes = excluded.review_notes,
                updated_at = excluded.updated_at
            ",
            params![
                &problem_id,
                notes.approach,
                notes.key_insight,
                notes.mistakes,
                notes.complexity,
                notes.review_notes,
                updated_at
            ],
        )
        .map_err(|error| format!("Could not save problem notes: {error}"))?;

    get_problem_notes(app, problem_id)
}

#[tauri::command]
fn list_submissions(app: tauri::AppHandle, problem_id: String) -> Result<Vec<Submission>, String> {
    let connection = open_database(&app)?;
    let mut statement = connection
        .prepare(
            "
            SELECT id, problem_id, code, result_json, created_at
            FROM submissions
            WHERE problem_id = ?1
            ORDER BY id DESC
            LIMIT 50
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![problem_id], |row| {
            let result_json: String = row.get(3)?;
            let result = serde_json::from_str(&result_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    3,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(Submission {
                id: row.get(0)?,
                problem_id: row.get(1)?,
                code: row.get(2)?,
                result,
                created_at: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn build_runner(tests: &ProblemTests) -> Result<String, String> {
    let tests_json = serde_json::to_string(tests).map_err(|error| error.to_string())?;
    Ok(format!(
        r#"
import importlib.util
import contextlib
import io
import json
import time
import traceback

TESTS = json.loads({tests_json:?})

def deep_equal(left, right):
    return left == right

def run_case(solution, case):
    started = time.perf_counter()
    stdout_buffer = io.StringIO()
    try:
        fn = getattr(solution, TESTS["functionName"])
        with contextlib.redirect_stdout(stdout_buffer):
            actual = fn(*case["input"])
        duration_ms = int((time.perf_counter() - started) * 1000)
        status = "passed" if deep_equal(actual, case["expected"]) else "failed"
        return {{
            "name": case["name"],
            "status": status,
            "input": case["input"],
            "expected": case["expected"],
            "actual": actual,
            "error": None,
            "stdout": stdout_buffer.getvalue() or None,
            "durationMs": duration_ms
        }}
    except Exception:
        duration_ms = int((time.perf_counter() - started) * 1000)
        return {{
            "name": case["name"],
            "status": "error",
            "input": case["input"],
            "expected": case["expected"],
            "actual": None,
            "error": traceback.format_exc(limit=8),
            "stdout": stdout_buffer.getvalue() or None,
            "durationMs": duration_ms
        }}

spec = importlib.util.spec_from_file_location("solution", "solution.py")
module = importlib.util.module_from_spec(spec)
setup_stdout = io.StringIO()
with contextlib.redirect_stdout(setup_stdout):
    spec.loader.exec_module(module)
    solution = module.Solution()
results = [run_case(solution, case) for case in TESTS["cases"]]
setup_output = setup_stdout.getvalue()
if setup_output and results:
    results[0]["stdout"] = setup_output + (results[0].get("stdout") or "")
print(json.dumps(results))
"#
    ))
}

fn execute_python(
    code: &str,
    tests: &ProblemTests,
    timeout_ms: u64,
) -> Result<Vec<TestResult>, String> {
    let dir = tempdir().map_err(|error| format!("Could not create temp directory: {error}"))?;
    let solution_path = dir.path().join("solution.py");
    let runner_path = dir.path().join("runner.py");

    fs::write(&solution_path, code)
        .map_err(|error| format!("Could not write solution: {error}"))?;
    fs::write(&runner_path, build_runner(tests)?)
        .map_err(|error| format!("Could not write runner: {error}"))?;

    let mut child = Command::new("python3")
        .arg(&runner_path)
        .current_dir(dir.path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start python3: {error}"))?;

    let timeout = std::time::Duration::from_millis(timeout_ms);
    match child
        .wait_timeout(timeout)
        .map_err(|error| error.to_string())?
    {
        Some(_) => {
            let output = child
                .wait_with_output()
                .map_err(|error| error.to_string())?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                return Ok(tests
                    .cases
                    .iter()
                    .map(|case| TestResult {
                        name: case.name.clone(),
                        status: TestStatus::Error,
                        input: case.input.clone(),
                        expected: case.expected.clone(),
                        actual: None,
                        error: Some(stderr.clone()),
                        stdout: None,
                        duration_ms: 0,
                    })
                    .collect());
            }

            let stdout = String::from_utf8(output.stdout).map_err(|error| error.to_string())?;
            serde_json::from_str(stdout.trim())
                .map_err(|error| format!("Could not parse runner output: {error}"))
        }
        None => {
            child.kill().map_err(|error| error.to_string())?;
            let _ = child.wait();
            Ok(tests
                .cases
                .iter()
                .map(|case| TestResult {
                    name: case.name.clone(),
                    status: TestStatus::Timeout,
                    input: case.input.clone(),
                    expected: case.expected.clone(),
                    actual: None,
                    error: Some(format!("Execution exceeded {timeout_ms} ms.")),
                    stdout: None,
                    duration_ms: timeout_ms as u128,
                })
                .collect())
        }
    }
}

#[tauri::command]
fn run_tests(
    app: tauri::AppHandle,
    problem_id: String,
    code: String,
) -> Result<RunSummary, String> {
    let problem = read_problem(&problem_id)?;
    let started = Instant::now();
    let results = execute_python(&code, &problem.tests, problem.meta.time_limit_ms)?;
    let summary = RunSummary {
        passed: results
            .iter()
            .filter(|result| matches!(result.status, TestStatus::Passed))
            .count(),
        failed: results
            .iter()
            .filter(|result| !matches!(result.status, TestStatus::Passed))
            .count(),
        duration_ms: started.elapsed().as_millis(),
        results,
    };

    record_submission(&app, &problem_id, &code, &summary)?;
    Ok(summary)
}

fn record_submission(
    app: &tauri::AppHandle,
    problem_id: &str,
    code: &str,
    result: &RunSummary,
) -> Result<(), String> {
    let connection = open_database(app)?;
    let result_json = serde_json::to_string(result).map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            INSERT INTO submissions (problem_id, code, result_json, created_at)
            VALUES (?1, ?2, ?3, ?4)
            ",
            params![problem_id, code, result_json, Utc::now().to_rfc3339()],
        )
        .map_err(|error| format!("Could not record submission: {error}"))?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let _ = open_database(app.handle()).map_err(|error| {
                Box::<dyn std::error::Error>::from(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    error,
                ))
            })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_problems,
            get_problem,
            create_problem,
            update_problem,
            get_draft,
            save_draft,
            get_problem_notes,
            save_problem_notes,
            run_tests,
            list_submissions
        ])
        .run(tauri::generate_context!())
        .expect("error while running AlgoLab");
}
