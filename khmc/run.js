// 경희의료원 사이버연수원(khmc.migaedu.com) 필수교육 자동 수강신청 + 수강.
// 사용: node khmc/run.js   (SPEED=1.5 기본, HEADED=1 이면 창 표시, SET=special 이면 특성화과정)
//       ACCOUNT=<사번> SET=auto node khmc/run.js  → 다른 계정(최초 PW=사번, PW= 로 지정 가능), 과정목록에서 미수료 과정 자동 수집
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://khmc.migaedu.com';
const ACCOUNT = process.env.ACCOUNT;
const cred = ACCOUNT ? { userId: ACCOUNT, password: process.env.PW || ACCOUNT } : require('./.env.khmc.json');
const cfg = (() => { try { return require('../.env.json'); } catch { return {}; } })();
const STATE = path.join(__dirname, ACCOUNT ? `state_${ACCOUNT}.json` : 'state.json');
const SPEED = Number(process.env.SPEED || 1.5); // 플레이어 UI 최대 1.5배속
const HEADED = process.env.HEADED === '1';

// [필수] 법정(7) + 인증(8) + 직원공통(4) = 19개. 값 = 수강신청/강의실 sdNo
const REQUIRED = {
  23847: '노인학대 신고의무자 교육', 23848: '성희롱 예방교육', 23849: '긴급복지 신고 의무자 교육',
  23850: '아동학대예방 및 신고의무자교육', 23859: '장애인학대신고의무자교육', 23991: '자살예방인식개선 교육',
  23992: '직장 내 장애인 인식개선 교육',
  23845: '직장 내 괴롭힘 및 폭력예방 교육', 23846: '정보보호/보안', 23851: '환자의 권리와 의무',
  23853: 'CPR_이론과정', 23855: '소방안전관리', 23858: '감염관리 교육', 23885: '질향상', 23886: '환자안전',
  23852: '경희의료원 미션과 비전', 23979: '청탁금지법의 이해', 23980: '우리가 알아야할 결핵(의료기관 종사자)',
  23994: '금연 교육',
};
// [필수] 특성화과정 — 의사직/간호직 해당 8개 (정신건강의학과·지표담당자 과정 제외)
const SPECIAL = {
  24089: '신체보호대', 24090: '낙상예방활동', 24179: '호스피스', 24181: '항암화학요법 수행자 교육',
  24182: '의약품 관리 교육', 24205: '수술 및 마취진정관리', 24213: '진료지침', 24318: '항생제 처방 지침 교육',
};
// 특성화 중 직종 비해당 2개 — 진료과 불명이라 예비로 수강
const EXTRA = { 24320: '입·퇴원 절차와 격리·강박 최신 기준', 24212: '임상질지표관리' };
// SET=special 이면 특성화, SET=extra 면 예비 2개, 기본은 필수 19개 (위 sdNo는 2026-09 기준)
// SET=auto 면 과정목록에서 수집 — sdNo가 매월 바뀌므로(10월 법정=24172~ 등) 새 달에는 auto 사용
const SETS = { special: SPECIAL, extra: EXTRA };
// 법정·인증·직원공통·특성화 과정목록
const LISTS = ['010001', '010002', '010004', '010003'];

const ts = () => new Date().toLocaleTimeString('ko-KR', { hour12: false });
const log = (...a) => console.log(`[${ts()}]`, ...a);

async function notify(msg) {
  if (!cfg.discordToken || !cfg.discordChannelId) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${cfg.discordChannelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${cfg.discordToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `[경희의료원 필수교육${ACCOUNT ? ' ' + ACCOUNT : ''}] ${msg}` }),
    });
  } catch (e) { log('discord 실패', e.message); }
}

// 세션이 끊기면(대개 본인이 다른 곳에서 로그인 → 중복로그인으로 이쪽 세션 삭제) 바로 재로그인하면 본인을 쫓아내므로
// RELOGIN_WAIT분(기본 20) × 끊긴 횟수(최대 6배) 기다렸다 재로그인
const RELOGIN_WAIT = Number(process.env.RELOGIN_WAIT || 20) * 60e3;
let logins = 0;

async function ensureLogin(ctx, page) {
  await page.goto(`${BASE}/Main/Index.nm`, { waitUntil: 'domcontentloaded' });
  if (await page.$('#outMdID')) {
    if (logins > 0) {
      const wait = Math.min(logins, 6) * RELOGIN_WAIT;
      log(`세션 끊김 ${logins}회 — 다른 곳에서 로그인 중일 수 있어 ${wait / 60e3}분 후 재로그인`);
      await notify(`⏸ 세션 끊김(${logins}회) — ${wait / 60e3}분 후 재로그인`);
      await page.waitForTimeout(wait);
      await page.goto(`${BASE}/Main/Index.nm`, { waitUntil: 'domcontentloaded' });
    }
    logins++;
    log('로그인');
    await page.fill('#outMdID', cred.userId);
    await page.fill('#outMdPW', cred.password);
    await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('#outLogin input[type=submit]')]);
    await page.waitForTimeout(2000);
    if (await page.$('#outMdID')) throw new Error('로그인 실패');
    await ctx.storageState({ path: STATE });
  }
}

// 과정목록 → 수료완료가 아닌 과정 { sdNo: 과정명 } (행의 수강신청/강의실 링크에서 sdNo 추출)
async function discoverCourses(page) {
  const found = {};
  for (const cc of LISTS) {
    await page.goto(`${BASE}/Study/Index/ccCode/${cc}.nm`, { waitUntil: 'domcontentloaded' });
    const rows = await page.evaluate(() => [...document.querySelectorAll('tr')].map(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 5) return null;
      const sd = ([...tr.querySelectorAll('a')].map(a => a.getAttribute('href') || '').join(' ').match(/\/(\d{5})\.nm/) || [])[1];
      return sd ? { sd, name: tds[1].innerText.split('\n')[0].trim(), done: tr.innerText.includes('수료완료') } : null;
    }).filter(Boolean));
    rows.filter(r => !r.done).forEach(r => { found[r.sd] = r.name; });
  }
  return found;
}

// 강의실 페이지 → 차시 목록 [{idx, pct, locked}] + 전체 진도율
async function readClassroom(page, sdNo) {
  // 세션이 끊긴 상태면 로그인 페이지로 리다이렉트되며 실행 컨텍스트가 날아가므로 오류 = 미로그인으로 취급
  try { return await readClassroomOnce(page, sdNo); }
  catch (e) { log('  강의실 읽기 오류', e.message.split('\n')[0]); return null; }
}

async function readClassroomOnce(page, sdNo) {
  await page.goto(`${BASE}/Mystudy/LearnView/${sdNo}.nm`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  if (await page.$('#outMdID') || /Login|Index\.nm/.test(page.url()) && !/LearnView/.test(page.url())) return null;
  return page.evaluate(() => {
    const body = document.body.innerText;
    const m = body.match(/진도율\s*\n?[^\n]*?\t(\d+)%/) || body.match(/(\d+)%\s*\n\s*\n\s*최초/);
    const rows = [];
    document.querySelectorAll('tr').forEach(tr => {
      const a = tr.querySelector('a.studyPopup, a.studyPopup1, a.studyPopup1R, a.studyAlert');
      if (!a) return;
      const pm = tr.innerText.match(/(\d+)%/);
      rows.push({ idx: rows.length, pct: pm ? Number(pm[1]) : 0, locked: a.classList.contains('studyAlert') });
    });
    const total = (() => { const t = document.body.innerText.split('수강상태')[1] || ''; const x = t.match(/(\d+)%/); return x ? Number(x[1]) : null; })();
    return { rows, total };
  });
}

async function watchChapter(ctx, page, sdNo, rowIdx) {
  const links = await page.$$('a.studyPopup, a.studyPopup1, a.studyPopup1R');
  const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 30000 }), links[rowIdx].click()]);
  await pop.waitForLoadState('domcontentloaded');
  let lastKey = '', stall = 0;
  const started = Date.now();
  while (Date.now() - started < 3 * 3600e3) {
    await pop.waitForTimeout(5000);
    if (pop.isClosed()) break;
    const f = pop.frames().find(fr => fr.url().includes('/course/'));
    if (!f) { if (++stall > 24) { log('  콘텐츠 프레임 없음 — 중단'); break; } continue; }
    const s = await f.evaluate(sp => {
      const v = document.querySelector('video');
      const cur = typeof thisPageNum !== 'undefined' ? thisPageNum : null;
      const tot = typeof totalPageNum !== 'undefined' ? totalPageNum : null;
      if (!v) return { noVideo: true, cur, tot };
      if (v.playbackRate !== sp) v.playbackRate = sp;
      v.muted = true;
      if (v.paused && !v.ended) v.play().catch(() => {});
      return { t: Math.floor(v.currentTime), d: Math.floor(v.duration || 0), ended: v.ended, cur, tot };
    }, SPEED).catch(() => null);
    if (!s) continue;
    const key = `${s.cur}/${s.tot} ${s.t}`;
    if (key === lastKey && !s.ended) { if (++stall % 12 === 0) log(`  멈춤 의심 ${key}`); if (stall > 60) break; }
    else stall = 0;
    lastKey = key;
    if (s.ended || (s.d > 0 && s.t >= s.d)) {
      if (s.cur && s.tot && s.cur < s.tot) {
        log(`  페이지 ${s.cur}/${s.tot} 완료 → 다음`);
        await f.evaluate(() => { try { percent = 100; } catch (e) {} MoveToPage('next'); }).catch(async () => {
          const u = pop.url().replace(/\/(\d+)\.nm$/, (_, n) => `/${Number(n) + 1}.nm`);
          await pop.goto(u, { waitUntil: 'domcontentloaded' });
        });
        await pop.waitForTimeout(3000);
      } else {
        log(`  차시 끝 (페이지 ${s.cur}/${s.tot})`);
        await pop.waitForTimeout(8000);
        break;
      }
    }
  }
  if (!pop.isClosed()) await pop.close({ runBeforeUnload: true });
  await page.waitForTimeout(3000);
}

async function main() {
  const browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext(fs.existsSync(STATE) ? { storageState: STATE } : {});
  ctx.on('dialog', d => { log('  alert:', d.message().replace(/\s+/g, ' ')); d.accept().catch(() => {}); });
  ctx.on('page', p => p.on('dialog', d => { log('  alert:', d.message().replace(/\s+/g, ' ')); d.accept().catch(() => {}); }));
  const page = await ctx.newPage();
  await ensureLogin(ctx, page);
  const COURSES = process.env.SET === 'auto' ? await discoverCourses(page) : SETS[process.env.SET] || REQUIRED;
  log(`대상 ${Object.keys(COURSES).length}개`, Object.values(COURSES));
  await notify(`수강 시작 (${Object.keys(COURSES).length}개 과정, ${SPEED}배속)`);

  const done = [], failed = [];
  for (const [sdNo, name] of Object.entries(COURSES)) {
    log(`■ ${name} (${sdNo})`);
    let info = await readClassroom(page, sdNo);
    if (!info) { await ensureLogin(ctx, page); info = await readClassroom(page, sdNo); }
    if (!info || info.rows.length === 0) {
      log('  미신청 → 수강신청');
      await page.goto(`${BASE}/Study/Proc/Request/${sdNo}.nm`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      info = await readClassroom(page, sdNo);
    }
    if (!info || info.rows.length === 0) { log('  강의실 진입 실패'); failed.push(name); continue; }
    let tries = 0;
    while (info.total !== 100 && tries++ < info.rows.length * 3 + 2) {
      const next = info.rows.find(r => r.pct < 100);
      if (!next) break;
      log(`  차시 ${next.idx + 1}/${info.rows.length} (${next.pct}%) 수강 — 전체 ${info.total}%`);
      try { await watchChapter(ctx, page, sdNo, next.idx); }
      catch (e) { log('  오류', e.message); await ensureLogin(ctx, page).catch(() => {}); }
      info = await readClassroom(page, sdNo) || (await ensureLogin(ctx, page), await readClassroom(page, sdNo));
      if (!info) break;
    }
    if (!info) { log('  강의실 재진입 실패'); failed.push(name); continue; }
    log(`  → 진도율 ${info.total}%`);
    if (info.total === 100) { done.push(name); await notify(`✅ ${name} 100% (${done.length}/${Object.keys(COURSES).length})`); }
    else { failed.push(`${name}(${info.total}%)`); await notify(`⚠️ ${name} 미완 ${info.total}%`); }
  }
  log(`완료 ${done.length}개 / 미완 ${failed.length}개`, failed);
  await notify(`🎉 종료 — 완료 ${done.length}개, 미완 ${failed.length}개 ${failed.join(', ')}`);
  await browser.close();
}

main().catch(async e => { log('치명적 오류', e); await notify(`❌ 오류로 중단: ${e.message}`); process.exit(1); });
