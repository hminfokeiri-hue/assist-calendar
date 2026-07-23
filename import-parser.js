/* ============================================================
   取込パーサー
   エクセル／CSV／PDF から「日付・現場名・開始時間」を読み取る

   対応する形。どれかを自動で見分けます。
   A) カレンダー型 … 月ごとのシート。日付が升目に並び、その下に現場名
   B) 一覧型       … 1行に 日付・現場名・時間 が横に並ぶ
   C) 配置表型     … 日/曜/作業現場名/開始時間/人数 に続いて担当者の○
   ============================================================ */

export const IMP = (() => {
  const Z = (s) =>
    String(s == null ? "" : s)
      .normalize("NFKC")
      .replace(/[\u3000]/g, " ")
      .trim();

  const ROKUYO = ["先勝", "友引", "先負", "仏滅", "大安", "赤口"];
  const WDCH = "日月火水木金土";

  /* 「9:00」「9時」「9:00~」などから時刻を取り出す */
  function pickTime(t) {
    const m = Z(t).match(/(\d{1,2})\s*[:：時]\s*(\d{2})?/);
    if (!m) return "";
    const h = Number(m[1]);
    if (h < 0 || h > 23) return "";
    return String(h).padStart(2, "0") + ":" + (m[2] || "00");
  }
  function stripTime(t) {
    return Z(t)
      .replace(/\d{1,2}\s*[:：時]\s*\d{0,2}\s*[~〜～]?\s*(\d{1,2}\s*[:：時]\s*\d{0,2})?/g, "")
      .replace(/[（(].*?[)）]\s*$/, "")
      .trim();
  }
  /* 現場名として意味のない文字か */
  let EXCLUDE = [];
  function setExclude(names) {
    EXCLUDE = (names || []).map((n) => Z(n).replace(/[\s()（）]/g, "")).filter((n) => n.length >= 2);
  }
  function isPerson(t) {
    const s = Z(t).replace(/[\s()（）]/g, "");
    if (!s) return false;
    /* 「村岡・嘉希」「北浦 〇」のように、担当者名だけで出来ている升 */
    const parts = s.split(/[・,、\/]/).map((x) => x.replace(/[〇○◯✕×x]/gi, "")).filter(Boolean);
    if (!parts.length) return false;
    return parts.every((p) => EXCLUDE.some((e) => p === e || (p.length >= 2 && (e.includes(p) || p.includes(e)))));
  }
  function junk(t) {
    const s = Z(t);
    if (!s) return true;
    if (/^[〇○◯✕×xX\-—―ー･・]+$/.test(s)) return true;
    if (/^[↪→←↑↓⇒]/.test(s)) return true;
    if (isPerson(s)) return true;
    if (ROKUYO.includes(s)) return true;
    if (WDCH.includes(s) && s.length === 1) return true;
    if (/^\d{1,2}\s*日?$/.test(s)) return true;
    if (/^[※*＊]/.test(s)) return true;
    if (/^(合計|計|備考|休|休み|定休)$/.test(s)) return true;
    return false;
  }

  /* シート名や見出しから年月を推測 */
  function guessYm(name, grid, fallbackYear) {
    let y = null, mo = null;
    const n = Z(name);
    let m = n.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月/);
    if (m) return [Number(m[1]), Number(m[2])];
    m = n.match(/令和\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月/);
    if (m) return [2018 + Number(m[1]), Number(m[2])];
    m = n.match(/^(\d{1,2})\s*月/);
    if (m) mo = Number(m[1]);

    /* 上のほうの行から探す */
    for (let r = 0; r < Math.min(8, grid.length); r++) {
      for (const c of grid[r] || []) {
        const t = Z(c);
        let mm = t.match(/(20\d{2})\s*年/);
        if (mm && !y) y = Number(mm[1]);
        mm = t.match(/令和\s*(\d{1,2})\s*年/);
        if (mm && !y) y = 2018 + Number(mm[1]);
        mm = t.match(/(\d{1,2})\s*月/);
        if (mm && !mo) mo = Number(mm[1]);
      }
    }
    if (!y) y = fallbackYear;
    return mo ? [y, mo] : null;
  }

  /* 曜日が合っているか調べて、年のずれを直す */
  function fixYear(y, mo, pairs) {
    if (!pairs.length) return y;
    let best = y, bestHit = -1;
    for (const cand of [y, y - 1, y + 1]) {
      let hit = 0;
      for (const [d, w] of pairs) {
        const dt = new Date(cand, mo - 1, d);
        if (dt.getMonth() !== mo - 1) continue;
        if (WDCH[dt.getDay()] === w) hit++;
      }
      if (hit > bestHit) { bestHit = hit; best = cand; }
    }
    return best;
  }

  const pad = (n) => String(n).padStart(2, "0");

  /* ---------- A) カレンダー型 ---------- */
  function parseCalendar(grid, y, mo) {
    const rows = [];
    const dayPairs = [];
    let cur = {};   // 列 → 日
    const H = grid.length;

    for (let r = 0; r < H; r++) {
      const row = grid[r] || [];
      /* この行に「日付らしい数字」が2つ以上あれば、週の見出し行 */
      const days = {};
      for (let c = 0; c < row.length; c++) {
        const t = Z(row[c]);
        const m = t.match(/^(\d{1,2})\s*日?$/);
        if (!m) continue;
        const d = Number(m[1]);
        if (d < 1 || d > 31) continue;
        days[c] = d;
        /* 隣の升に曜日があれば控える */
        const nx = Z(row[c + 1]);
        if (nx.length === 1 && WDCH.includes(nx)) dayPairs.push([d, nx]);
      }
      const dayCols = Object.keys(days).map(Number).sort((a, b) => a - b);
      if (dayCols.length >= 2) {
        /* 各日の「受け持ち列」を、次の日付列の手前までと決める */
        cur = {};
        dayCols.forEach((c, i) => {
          const end = i + 1 < dayCols.length ? dayCols[i + 1] - 1 : c + 2;
          cur[c] = { day: days[c], end };
        });
        continue;
      }
      if (dayCols.length === 1) {
        /* 1列だけの日付＝縦並びの形。その行の残りを内容とみなす */
        const dc = dayCols[0];
        const d = days[dc];
        for (let c = dc + 1; c < row.length; c++) {
          const t = Z(row[c]);
          if (junk(t)) continue;
          rows.push({ day: d, site: stripTime(t) || t, start: pickTime(t) });
        }
        cur = { [dc]: { day: d, end: dc } };
        continue;
      }
      /* 見出し行の下＝内容の行 */
      if (!Object.keys(cur).length) continue;
      for (const cs of Object.keys(cur)) {
        const c0 = Number(cs), info = cur[cs];
        for (let c = c0; c <= info.end && c < row.length; c++) {
          const raw = Z(row[c]);
          if (junk(raw)) continue;
          for (const part of raw.split(/[\n\r]+/)) {
            const t = Z(part);
            if (junk(t)) continue;
            rows.push({ day: info.day, site: stripTime(t) || t, start: pickTime(t) });
          }
        }
      }
    }
    const yy = fixYear(y, mo, dayPairs);
    return rows.map((r) => ({
      date: `${yy}-${pad(mo)}-${pad(r.day)}`,
      site: r.site,
      start: r.start,
    }));
  }

  /* ---------- B) 一覧型 / C) 配置表型 ---------- */
  function parseTable(grid, y, mo) {
    /* 見出し行を探す */
    let hr = -1, col = {};
    for (let r = 0; r < Math.min(20, grid.length); r++) {
      const row = (grid[r] || []).map(Z);
      const idx = {};
      row.forEach((t, c) => {
        if (/^日$|日付|年月日/.test(t) && idx.day === undefined) idx.day = c;
        if (/^曜/.test(t) && idx.wd === undefined) idx.wd = c;
        if (/現場|場所|作業先|施設|物件/.test(t) && idx.site === undefined) idx.site = c;
        if (/開始|時間|時刻/.test(t) && idx.start === undefined) idx.start = c;
        if (/人数|必要/.test(t) && idx.need === undefined) idx.need = c;
      });
      if (idx.site !== undefined && (idx.day !== undefined || idx.start !== undefined)) {
        hr = r; col = idx; break;
      }
    }
    if (hr < 0) return null;

    const out = [], pairs = [];
    let lastDay = null;
    for (let r = hr + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const cell = (c) => (c === undefined ? "" : Z(row[c]));

      const dRaw = cell(col.day);
      const dm = dRaw.match(/(\d{1,2})/);
      if (dm) {
        const d = Number(dm[1]);
        if (d >= 1 && d <= 31) {
          lastDay = d;
          const w = cell(col.wd);
          if (w && WDCH.includes(w)) pairs.push([d, w]);
        }
      }
      const site = cell(col.site);
      if (!site || junk(site)) continue;
      if (lastDay == null) continue;

      let start = pickTime(cell(col.start));
      if (!start) start = pickTime(site);
      let need = Number(cell(col.need));
      if (!Number.isFinite(need) || need < 0 || need > 99) need = 0;

      out.push({ day: lastDay, site: stripTime(site) || site, start, need });
    }
    const yy = fixYear(y, mo, pairs);
    return out.map((r) => ({
      date: `${yy}-${pad(mo)}-${pad(r.day)}`,
      site: r.site,
      start: r.start,
      need: r.need,
    }));
  }

  /* ---------- 1シートを読む ---------- */
  function parseSheet(name, grid, fallbackYear) {
    /* さわ病院のような「3か月まとめ」は、3列ずつに割って個別に読む */
    const multi = Z(name).match(/^\s*(\d{1,2})\s*[~〜～]\s*(\d{1,2})/);
    if (multi) {
      const a = Number(multi[1]);
      const res = [];
      for (let g = 0; g < 4; g++) {
        const sub = grid.map((row) => (row || []).slice(g * 3, g * 3 + 3));
        if (!sub.some((r) => r.some((c) => Z(c)))) continue;
        const ym = guessYm("", sub, fallbackYear);
        const mo = ym ? ym[1] : ((a + g - 1) % 12) + 1;
        const yr = ym ? ym[0] : fallbackYear;
        res.push(...parseCalendar(sub, yr, mo));
      }
      return res;
    }

    const ym = guessYm(name, grid, fallbackYear);
    if (!ym) return [];
    const [y, mo] = ym;

    const t = parseTable(grid, y, mo);
    if (t && t.length) return t;
    return parseCalendar(grid, y, mo);
  }

  /* ---------- 入口 ---------- */
  /* シートごとに解析。使うシートは呼び出し側で選べる */
  function scan(sheets, fallbackYear) {
    return sheets.map((s) => {
      let rows = [];
      try { rows = dedupe(parseSheet(s.name, s.grid, fallbackYear)); } catch (e) { rows = []; }
      const months = {};
      rows.forEach((r) => (months[r.date.slice(0, 7)] = (months[r.date.slice(0, 7)] || 0) + 1));
      return { name: s.name, rows, months, n: rows.length };
    });
  }
  function fromSheets(sheets, fallbackYear, useNames) {
    const scanned = scan(sheets, fallbackYear);
    const all = [];
    scanned.forEach((s) => {
      if (useNames && useNames.indexOf(s.name) < 0) return;
      all.push(...s.rows);
    });
    return { rows: dedupe(all), per: scanned };
  }

  function dedupe(rows) {
    const map = new Map();
    for (const r of rows) {
      if (!r.site || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
      const [yy, mm, dd] = r.date.split("-").map(Number);
      const d = new Date(yy, mm - 1, dd);
      if (d.getMonth() !== mm - 1 || d.getDate() !== dd) continue;   // 2月31日などを弾く
      const k = r.date + "|" + r.site.replace(/[\s・,、]/g, "");
      const prev = map.get(k);
      if (!prev) { map.set(k, { ...r }); continue; }
      if (!prev.start && r.start) prev.start = r.start;              // 時間があるほうを採用
      if (!prev.need && r.need) prev.need = r.need;
    }
    const out = [...map.values()];
    out.sort((a, b) => a.date.localeCompare(b.date) || (a.start || "zz").localeCompare(b.start || "zz"));
    return out;
  }

  /* PDF や テキストの行から読む（best effort） */
  function fromLines(lines, fallbackYear) {
    const out = [];
    let y = fallbackYear, mo = null;
    for (const raw of lines) {
      const t = Z(raw);
      if (!t) continue;
      let m = t.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月/);
      if (m) { y = Number(m[1]); mo = Number(m[2]); continue; }
      m = t.match(/令和\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月/);
      if (m) { y = 2018 + Number(m[1]); mo = Number(m[2]); continue; }

      /* 2026/8/5 や 8/5 や 5日 で始まる行 */
      m = t.match(/^(?:(20\d{2})[\/\-年])?(?:(\d{1,2})[\/\-月])?(\d{1,2})\s*日?[\s　:：,、]+(.+)$/);
      if (!m) continue;
      const yy = m[1] ? Number(m[1]) : y;
      const mm = m[2] ? Number(m[2]) : mo;
      const dd = Number(m[3]);
      if (!mm || dd < 1 || dd > 31) continue;
      const rest = Z(m[4]);
      if (junk(rest)) continue;
      out.push({ date: `${yy}-${pad(mm)}-${pad(dd)}`, site: stripTime(rest) || rest, start: pickTime(rest) });
    }
    return { rows: dedupe(out), per: [{ name: "テキスト", n: out.length }] };
  }

  return { fromSheets, scan, fromLines, dedupe, pickTime, stripTime, setExclude, Z, parseSheet };
})();
