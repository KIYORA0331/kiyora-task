// KIYORA 業務タスク管理 / 予定登録API
// 予定DBに「予定（定例MTG・商談など）」を1件作成する。
// タスクDBとは完全分離。Notionカレンダーに反映される時間枠。

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const EVENT_DB_ID = "b4e09709-fd53-48bb-b9cf-d9edb3347f1c";
const NOTION_VERSION = "2022-06-28";

const rt = (v) => (v && String(v).trim())
  ? { rich_text: [{ text: { content: String(v).slice(0, 2000) } }] } : null;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!NOTION_TOKEN) return res.status(500).json({ ok: false, error: "NOTION_TOKEN 未設定" });

  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ ok: false, error: "予定名が空です" });

    const props = {
      "予定名": { title: [{ text: { content: String(b.name).slice(0, 200) } }] },
    };
    if (b.type) props["種別"] = { select: { name: b.type } };
    if (b.place) { const pl = rt(b.place); if (pl) props["場所"] = pl; }
    if (b.memo) { const mp = rt(b.memo); if (mp) props["メモ"] = mp; }

    // 日時（時刻ありならそのままISO datetime、日付のみも可）
    if (b.datetime && String(b.datetime).trim()) {
      props["日時"] = { date: { start: String(b.datetime) } };
    }

    // 参加者（multi_select・配列）
    if (Array.isArray(b.participants) && b.participants.length) {
      props["参加者"] = { multi_select: b.participants.map((n) => ({ name: n })) };
    }

    const r = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({ parent: { database_id: EVENT_DB_ID }, properties: props }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ ok: false, error: data.message || "Notion API error", detail: data });

    return res.status(200).json({ ok: true, id: data.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
