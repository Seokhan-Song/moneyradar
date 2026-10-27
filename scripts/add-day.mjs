#!/usr/bin/env node
// 사용법:
//   node scripts/add-day.mjs <오늘 시황 JSON 파일 경로>   → 검사 후 data/ 에 추가하고 목록 갱신
//   node scripts/add-day.mjs --check <JSON 파일 경로>    → 검사만 (파일을 쓰지 않음)
//   node scripts/add-day.mjs --rebuild                   → data/ 의 날짜 파일로 목록만 다시 생성
//
// 종료 코드: 0 = 추가 완료, 2 = 같은 날짜가 이미 있음(아무것도 안 함), 1 = 오류(형식 문제 등)
//
// 구조:
//   data/months.json                  ["2026-11", "2026-10", ...]  (최신 달이 앞)
//   data/YYYY-MM/index.json           [{date, weekday, mood, headline}, ...]  (최신 날짜가 앞)
//   data/YYYY-MM/YYYY-MM-DD.json      하루치 시황 전체
// 목록 파일(months.json, index.json)은 날짜 파일들로부터 매번 새로 만들어지므로
// 손으로 고칠 필요가 없고, 기존 날짜 파일은 절대 수정하지 않습니다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MOODS = ["up", "down", "flat", "closed"];

function fail(msg) { console.error("오류: " + msg); process.exit(1); }

function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }

export function validate(day) {
  const errs = [];
  if (!day || typeof day !== "object" || Array.isArray(day)) return ["최상위가 객체가 아님"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date || "")) errs.push("date는 YYYY-MM-DD 형식이어야 함");
  else {
    const dt = new Date(day.date + "T12:00:00Z");
    if (isNaN(dt)) errs.push("date가 올바른 날짜가 아님");
    else if (day.weekday !== WEEKDAYS[dt.getUTCDay()]) errs.push(`weekday가 날짜와 안 맞음 (기대값: ${WEEKDAYS[dt.getUTCDay()]})`);
  }
  if (!MOODS.includes(day.mood)) errs.push("mood는 up/down/flat/closed 중 하나");
  if (day.mood === "closed" && !isNonEmptyString(day.closedNote)) errs.push("휴장(closed)이면 closedNote 필요");
  for (const k of ["headline", "us_market", "kr_market", "macro"]) {
    if (!isNonEmptyString(day[k])) errs.push(`${k}는 비어 있지 않은 문자열이어야 함`);
  }
  const arr = (k, fields, min) => {
    if (!Array.isArray(day[k])) { errs.push(`${k}는 배열이어야 함`); return; }
    if (day[k].length < min) errs.push(`${k}는 최소 ${min}개`);
    day[k].forEach((it, i) => {
      for (const f of fields) if (!isNonEmptyString(it && it[f])) errs.push(`${k}[${i}].${f} 누락`);
    });
  };
  arr("top_news", ["title", "impact"], 1);
  arr("concepts", ["term", "desc"], 1);
  arr("checkpoints", ["item"], 0);
  arr("sources", ["t", "u"], 1);
  (day.sources || []).forEach((s, i) => {
    if (s && typeof s.u === "string" && !/^https?:\/\//.test(s.u)) errs.push(`sources[${i}].u는 http(s) 주소여야 함`);
  });
  // 깨진 글자(유니코드 대체 문자) 검사
  if (JSON.stringify(day).includes("�")) errs.push("깨진 글자(�)가 포함되어 있음");
  return errs;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n", "utf8"); }

export function rebuild() {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);
  const months = fs.readdirSync(DATA)
    .filter(n => /^\d{4}-\d{2}$/.test(n) && fs.statSync(path.join(DATA, n)).isDirectory())
    .sort().reverse();
  const kept = [];
  for (const m of months) {
    const dir = path.join(DATA, m);
    const days = fs.readdirSync(dir)
      .filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .sort().reverse()
      .map(n => readJson(path.join(dir, n)))
      .map(d => ({ date: d.date, weekday: d.weekday, mood: d.mood, headline: d.headline }));
    if (days.length === 0) continue;
    writeJson(path.join(dir, "index.json"), days);
    kept.push(m);
  }
  writeJson(path.join(DATA, "months.json"), kept);
  return kept;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === "--rebuild") {
    const kept = rebuild();
    console.log("목록 재생성 완료: " + kept.join(", "));
    process.exit(0);
  }
  const checkOnly = args[0] === "--check";
  const file = checkOnly ? args[1] : args[0];
  if (!file) fail("시황 JSON 파일 경로를 넣어 주세요.");

  let day;
  try { day = readJson(file); } catch (e) { fail("JSON 파싱 실패 — " + e.message); }
  const errs = validate(day);
  if (errs.length) fail("형식 검사 실패\n - " + errs.join("\n - "));

  const month = day.date.slice(0, 7);
  const target = path.join(DATA, month, day.date + ".json");
  if (fs.existsSync(target)) {
    console.log(`이미 있음: ${path.relative(ROOT, target)} — 아무것도 하지 않습니다.`);
    process.exit(2);
  }
  if (checkOnly) { console.log("형식 검사 통과"); process.exit(0); }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeJson(target, day);
  rebuild();
  console.log("추가 완료: " + path.relative(ROOT, target));
}
