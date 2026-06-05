// KIYORA 業務タスク管理 / 予定一覧取得API
// 予定DB（定例MTG・商談など）を返す。統合カレンダーの「予定」側データ。
// タスクDBとは完全分離。タスク取得（task-list）と同じ方式。

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const EVENT_DB_ID = "b4e09709-fd53-48bb-b9cf-d9edb3347f1c";
const NOTION_VERSION = "2022-06-28";

const txt = (p) => (p && p.rich_text && p.rich_text[0]) ? p.rich_text[0].plain_text : "";
const sel = (p) => (p && p.select) ? p.select.name : "";
const dat = (p) => (p && p.date) ? p.date.start : null;

function mapEvent(pg) {
  const p = pg.properties;
  return {
    id: pg.id,
    name: (p["予定名"] && p["予定名"].title && p["予定名"].title[0]) ? p["予定名"].title[0].plain_text : "(無題)",
    datetime: dat(p["日時"]),
    type: sel(p["種別"]),
    place: txt(p["場所"]),
    memo: txt(p["メモ"]),
    participants: (p["参加者"] && p["参加者"].multi_select) ? p["参加者"].multi_select.map(o => o.name) : [],
  };
}

export default async function handler(req, res) {
  if (!NOTION_TOKEN) {
    return res.status(500).json({ ok: false, error: "NOTION_TOKEN 未設定" });
  }
  try {
    const resp = await fetch(`https://api.notion.com/v1/databases/${EVENT_DB_ID}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        sorts: [{ property: "日時", direction: "ascending" }],
        page_size: 100,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.message || "Notion query error");
    const events = (data.results || []).map(mapEvent).filter(e => e.datetime);
    return res.status(200).json({ ok: true, count: events.length, events });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
