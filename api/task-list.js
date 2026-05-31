// KIYORA 業務タスク管理 / タスク一覧取得API
// タスクDBから「今アクティブな」タスク（完了・取下げ以外）を取得して返す。
// ダッシュボードの「今日やること」リストとカレンダーの元データ。

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const TASK_DB_ID = "c41de31d-0338-4c16-8797-11b5c4231512";
const NOTION_VERSION = "2022-06-28";

const txt = (p) => (p && p.rich_text && p.rich_text[0]) ? p.rich_text[0].plain_text : "";
const sel = (p) => (p && p.select) ? p.select.name : "";
const num = (p) => (p && typeof p.number === "number") ? p.number : null;
const chk = (p) => !!(p && p.checkbox);
const dat = (p) => (p && p.date) ? p.date.start : null;

export default async function handler(req, res) {
  if (!NOTION_TOKEN) {
    return res.status(500).json({ ok: false, error: "NOTION_TOKEN 未設定" });
  }
  try {
    const resp = await fetch(`https://api.notion.com/v1/databases/${TASK_DB_ID}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        filter: {
          and: [
            { property: "ステータス", select: { does_not_equal: "完了" } },
            { property: "ステータス", select: { does_not_equal: "取下げ" } },
          ],
        },
        sorts: [{ property: "When_期限", direction: "ascending" }],
        page_size: 100,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ ok: false, error: data.message || "Notion query error" });
    }

    const tasks = (data.results || []).map((pg) => {
      const p = pg.properties;
      return {
        id: pg.id,
        name: (p["タスク名"] && p["タスク名"].title && p["タスク名"].title[0]) ? p["タスク名"].title[0].plain_text : "(無題)",
        member: sel(p["担当者"]),
        proposer: sel(p["提案者"]),
        what: txt(p["What_内容"]),
        due: dat(p["When_期限"]),
        type: sel(p["タスク種別"]),
        current: num(p["現在到達度"]),
        planned: num(p["予定到達度"]),
        status: sel(p["ステータス"]),
        blockCause: sel(p["ブロック起因"]),
        delegatable: chk(p["委譲可能"]),
        goal: sel(p["連動目標"]),
        weight: sel(p["重み"]),
        carryCount: num(p["繰越回数"]),
      };
    });

    return res.status(200).json({ ok: true, count: tasks.length, tasks });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
