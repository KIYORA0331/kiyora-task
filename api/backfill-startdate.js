// KIYORA 業務タスク管理 / 開始日 埋め戻し（一度だけ実行・再実行しても安全）
// ガントチャート（Notionタイムライン）は開始日が空のレコードを描画しないため、
// 開始日が未設定のタスクについて「開始日 = When_期限」を記録する。
// ＝「着手予定日が未申告のタスクは、期限日に着手する予定」とみなす扱い。
// 冪等：開始日が既にあるタスクはスキップ。期限も無いタスクは対象外。
// サーバレスのタイムアウト対策として1回あたりの処理件数を制限し、残数を返す。
//   → 残数が0になるまで数回叩けば完了する。

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const TASK_DB_ID = "c41de31d-0338-4c16-8797-11b5c4231512";
const NOTION_VERSION = "2022-06-28";

const DEFAULT_LIMIT = 40;

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

export default async function handler(req, res) {
  if (!NOTION_TOKEN) return res.status(500).json({ ok: false, error: "NOTION_TOKEN 未設定" });

  const limit = Math.max(1, Math.min(100, parseInt(req.query?.limit) || DEFAULT_LIMIT));

  try {
    // 開始日が空 かつ 期限あり のタスクを全件取得（完了・取下げも含めて履歴を揃える）
    const targets = [];
    let cursor = undefined;
    do {
      const q = await notion(`databases/${TASK_DB_ID}/query`, "POST", {
        filter: {
          and: [
            { property: "開始日", date: { is_empty: true } },
            { property: "When_期限", date: { is_not_empty: true } },
          ],
        },
        page_size: 100,
        start_cursor: cursor,
      });
      if (!q.ok) return res.status(q.status).json({ ok: false, error: "タスク取得失敗", detail: q.data });
      targets.push(...(q.data.results || []));
      cursor = q.data.has_more ? q.data.next_cursor : undefined;
    } while (cursor);

    const total = targets.length;
    const batch = targets.slice(0, limit);

    let filled = 0;
    const errors = [];

    for (const pg of batch) {
      const due = pg.properties?.["When_期限"]?.date?.start;
      if (!due) continue;
      const upd = await notion(`pages/${pg.id}`, "PATCH", {
        properties: { "開始日": { date: { start: due } } },
      });
      if (upd.ok) filled++;
      else errors.push({ id: pg.id, error: upd.data.message || "更新失敗" });
    }

    const remaining = total - filled;
    return res.status(200).json({
      ok: true,
      total,
      filled,
      remaining,
      done: remaining === 0,
      note: remaining > 0 ? "残りがあります。もう一度このURLを開いてください。" : "埋め戻し完了です。",
      errors,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
