// api/add-day.mjs
// Vercel Serverless Function — 매일 시황 데이터를 GitHub 저장소에 직접 커밋한다.
// 기존 scripts/add-day.mjs와 동일한 검사 로직을 그대로 사용하고,
// git push(스마트 HTTP) 대신 GitHub REST "Git Data API"로 커밋을 만들기 때문에
// 로컬/클라우드 세션의 git push 권한 문제와 무관하게 동작한다.
//
// 환경변수(Vercel 프로젝트 설정에 등록):
//   GITHUB_TOKEN     - 이 저장소(Contents: Read and write)에만 쓰기 권한이 있는 fine-grained PAT
//   ADD_DAY_SECRET   - 이 엔드포인트 호출을 인증하기 위한 임의의 공유 비밀값
//
// 호출 방법:
//   POST https://<site>/api/add-day
//   Headers: Authorization: Bearer <ADD_DAY_SECRET>, Content-Type: application/json
//   Body: 하루치 시황 JSON (README의 "하루치 시황 형식"과 동일)
//   Body에 "dryRun": true 를 추가하면 실제 커밋 없이 검사·미리보기만 한다.
//
// 응답:
//   200 { ok: true, committed: true, path, commit }       - 커밋 완료
//   200 { ok: true, committed: false, reason: "exists" }  - 같은 날짜가 이미 있어서 아무것도 안 함
//   200 { ok: true, dryRun: true, preview }                - dryRun일 때
//   400 { ok: false, error, details? }                     - 검증 실패/입력 오류
//   401 { ok: false, error: "unauthorized" }                - 비밀값 불일치
//   405 { ok: false, error: "method not allowed" }
//   500 { ok: false, error }                                - GitHub API 오류 등

import { validate } from "../scripts/add-day.mjs";

const OWNER = "Seokhan-Song";
const REPO = "moneyradar";
const BRANCH = "main";
const API = "https://api.github.com";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "moneyradar-add-day-function",
  };
}

async function gh(path, token, init) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...ghHeaders(token), ...(init && init.headers) } });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err = new Error(`GitHub API ${res.status} ${path}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// data/YYYY-MM/YYYY-MM-DD.json 경로 하나의 raw 파일 내용을 읽는다(없으면 null).
async function getFileJson(token, path) {
  try {
    const res = await gh(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`, token, { method: "GET" });
    const content = Buffer.from(res.content, res.encoding || "base64").toString("utf8");
    return JSON.parse(content);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const secret = process.env.ADD_DAY_SECRET;
  if (!token || !secret) {
    res.status(500).json({ ok: false, error: "server not configured (missing GITHUB_TOKEN or ADD_DAY_SECRET env var)" });
    return;
  }

  const auth = req.headers["authorization"] || "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (presented !== secret) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  let day = req.body;
  if (typeof day === "string") {
    try { day = JSON.parse(day); } catch { day = null; }
  }
  if (!day || typeof day !== "object") {
    res.status(400).json({ ok: false, error: "invalid JSON body" });
    return;
  }
  const dryRun = day.dryRun === true;
  if (dryRun) delete day.dryRun;

  const errs = validate(day);
  if (errs.length) {
    res.status(400).json({ ok: false, error: "validation failed", details: errs });
    return;
  }

  const month = day.date.slice(0, 7);
  const dayPath = `data/${month}/${day.date}.json`;
  const indexPath = `data/${month}/index.json`;
  const monthsPath = `data/months.json`;

  try {
    const existing = await getFileJson(token, dayPath);
    if (existing) {
      res.status(200).json({ ok: true, committed: false, reason: "exists", path: dayPath });
      return;
    }

    // 이 달의 index.json 갱신 (최신 날짜가 앞에 오도록 정렬, 새 항목 반영)
    const prevIndex = (await getFileJson(token, indexPath)) || [];
    const summary = { date: day.date, weekday: day.weekday, mood: day.mood, headline: day.headline };
    const newIndex = [...prevIndex.filter(d => d.date !== day.date), summary]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    // months.json 갱신 (새 달이면 추가, 최신 달이 앞)
    const prevMonths = (await getFileJson(token, monthsPath)) || [];
    const monthsChanged = !prevMonths.includes(month);
    const newMonths = monthsChanged
      ? [...prevMonths, month].sort().reverse()
      : prevMonths;

    if (dryRun) {
      res.status(200).json({
        ok: true,
        dryRun: true,
        preview: { dayPath, indexPath, monthsPath: monthsChanged ? monthsPath : null, newIndexCount: newIndex.length, newMonths },
      });
      return;
    }

    // 최신 커밋/트리 조회
    const ref = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`, token, { method: "GET" });
    const baseSha = ref.object.sha;
    const baseCommit = await gh(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`, token, { method: "GET" });
    const baseTreeSha = baseCommit.tree.sha;

    // 바뀐 파일들 blob 생성
    const files = [
      { path: dayPath, content: pretty(day) },
      { path: indexPath, content: pretty(newIndex) },
    ];
    if (monthsChanged) files.push({ path: monthsPath, content: pretty(newMonths) });

    const blobs = [];
    for (const f of files) {
      const blob = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, token, {
        method: "POST",
        body: JSON.stringify({ content: f.content, encoding: "utf-8" }),
      });
      blobs.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    }

    const newTree = await gh(`/repos/${OWNER}/${REPO}/git/trees`, token, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: blobs }),
    });

    const commit = await gh(`/repos/${OWNER}/${REPO}/git/commits`, token, {
      method: "POST",
      body: JSON.stringify({
        message: `시황 추가: ${day.date}`,
        tree: newTree.sha,
        parents: [baseSha],
      }),
    });

    // 그 사이 다른 커밋이 올라갔으면(= baseSha가 더이상 최신이 아니면) 실패시켜
    // 덮어쓰기(force) 없이 안전하게 재시도하도록 한다.
    await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, token, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    res.status(200).json({ ok: true, committed: true, path: dayPath, commit: commit.sha });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
