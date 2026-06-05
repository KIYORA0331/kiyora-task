// KIYORA 業務タスク管理 / タスク作成API
// フロントで構造化済みのデータを受け取り、タスクDBに1レコード作成する。
// 依存パッケージなし（Node18+ 内蔵fetch使用）。トークンのみ環境変数。

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const TASK_DB_ID = "c41de31d-0338-4c16-8797-11b5c4231512"; // タスクDB（公開しても単体では実害小・トークン無しでは不可）
const NOTION_VERSION = "2022-06-28";

// 任意のrich_textは空なら省略するためのヘルパ
const rt = (v) => (v && String(v).trim())
  ? { rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }
  : null;
const sel = (v) => (v && String(v).trim()) ? { select: { name: String(v) } } : null;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!NOTION_TOKEN) {
    return res.status(500).json({ ok: false, error: "NOTION_TOKEN 未設定（Vercelの環境変数を確認してください）" });
  }

  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    if (!b.taskName || !String(b.taskName).trim()) {
      return res.status(400).json({ ok: false, error: "タスク名が空です" });
    }

    // プロパティ構築（任意項目はnullを後で除去）
    const props = {
      "タスク名": { title: [{ text: { content: String(b.taskName).slice(0, 200) } }] },
      "担当者": sel(b.assignee),
      "提案者": sel(b.proposer),
      "What_内容": rt(b.what),
      "Why_目的": rt(b.why),
      "How_方法": rt(b.how),
      "Where_場所": rt(b.where),
      "原文_自由記述": rt(b.original),
      "タスク種別": sel(b.taskType),
      "連動目標": sel(b.linkedGoal),
      "重み": sel(b.weight || "中"),
      "優先度": { number: (typeof b.priority === "number" && b.priority >= 1 && b.priority <= 5) ? b.priority : 3 },
      "ステータス": { select: { name: "未着手" } },
      "ブロック起因": { select: { name: "なし" } },
      "現在到達度": { number: 0 },
      "予定到達度": { number: 0 },
      "繰越回数": { number: 0 },
      "委譲可能": { checkbox: !!b.delegatable },
    };

    // When_期限（ISO日付文字列があれば）
    if (b.due && String(b.due).trim()) {
      props["When_期限"] = { date: { start: String(b.due) } };
    }

    // null を除去
    Object.keys(props).forEach((k) => { if (props[k] === null) delete props[k]; });

    const resp = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        parent: { database_id: TASK_DB_ID },
        properties: props,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ ok: false, error: data.message || "Notion API error", detail: data });
    }

    return res.status(200).json({ ok: true, id: data.id, url: data.url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
