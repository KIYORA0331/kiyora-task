// KIYORA 業務タスク管理 / 完了日 埋め戻し（一度だけ実行）
// すでに「完了」になっているタスクのうち「完了日」が空のものについて、
// 進捗ログDBで初めて「完了」になったログの作成日時を「完了日」として記録する。
// 冪等：完了日が既にあるタスクはスキップ。何度叩いても二重記録されない。

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const TASK_DB_ID = "c41de31d-0338-4c16-8797-11b5c4231512";
const LOG_DB_ID = "1fb7d43c-e9b8-4ca1-9b37-e7b5d123d0c8";
const NOTION_VERSION = "2022-06-28";

async function notion(path, method, body) {
  const r = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

// ISO日時 → JSTの日付(YYYY-MM-DD)
function toJstDate(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (!NOTION_TOKEN) return res.status(500).json({ ok: false, error: "NOTION_TOKEN 未設定" });

  try {
    // 1) 完了ステータスのタスクを全件取得（完了日が空のものだけ対象）
    const completed = [];
    let cursor = undefined;
    do {
      const q = await notion(`databases/${TASK_DB_ID}/query`, "POST", {
        filter: { property: "ステータス", select: { equals: "完了" } },
        page_size: 100,
        start_cursor: cursor,
      });
      if (!q.ok) return res.status(q.status).json({ ok: false, error: "タスク取得失敗", detail: q.data });
      completed.push(...(q.data.results || []));
      cursor = q.data.has_more ? q.data.next_cursor : undefined;
    } while (cursor);

    let scanned = 0, filled = 0, skipped = 0, fallback = 0;
    const results = [];

    for (const pg of completed) {
      scanned++;
      const already = pg.properties?.["完了日"]?.date?.start;
      if (already) { skipped++; continue; }

      // 2) このタスクで初めて「完了」になったログを探す
      const logQ = await notion(`databases/${LOG_DB_ID}/query`, "POST", {
        filter: {
          and: [
            { property: "対象タスク", relation: { contains: pg.id } },
            { property: "当時のステータス", select: { equals: "完了" } },
          ],
        },
        sorts: [{ timestamp: "created_time", direction: "ascending" }],
        page_size: 1,
      });

      let doneIso = null, src = null;
      if (logQ.ok && logQ.data.results && logQ.data.results[0]) {
        doneIso = logQ.data.results[0].created_time; // ログ作成時刻＝完了に入った時刻
        src = "log";
      } else {
        doneIso = pg.last_edited_time; // ログが無い場合のフォールバック（近似）
        src = "fallback";
        fallback++;
      }

      const doneDate = toJstDate(doneIso);
      const upd = await notion(`pages/${pg.id}`, "PATCH", {
        properties: { "完了日": { date: { start: doneDate } } },
      });
      if (upd.ok) { filled++; results.push({ id: pg.id, doneDate, src }); }
      else { results.push({ id: pg.id, error: upd.data.message || "更新失敗" }); }
    }

    return res.status(200).json({ ok: true, scanned, filled, skipped, fallback, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
