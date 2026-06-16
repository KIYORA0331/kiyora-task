// KIYORA 業務タスク管理 / 確認ページ用 情報取得API（GET）
// 署名を検証し、確認ページに表示するタスク名と確認状況を返す。記録はしない。

import { verify } from "../lib/mail.js";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = "2022-06-28";

export default async function handler(req, res) {
  if (!NOTION_TOKEN) return res.status(500).json({ ok: false, error: "NOTION_TOKEN 未設定" });

  const task = req.query.task;
  const who = req.query.who;
  const sig = req.query.sig;
  if (!task || !who || !sig) return res.status(400).json({ ok: false, error: "パラメータ不足" });
  if (!verify(task, who, sig)) return res.status(403).json({ ok: false, error: "リンクが無効です" });

  try {
    const r = await fetch(`https://api.notion.com/v1/pages/${task}`, {
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
      },
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ ok: false, error: data.message || "タスク取得失敗" });

    const p = data.properties || {};
    const taskName = (p["タスク名"] && p["タスク名"].title && p["タスク名"].title[0]) ? p["タスク名"].title[0].plain_text : "(無題)";
    const due = (p["When_期限"] && p["When_期限"].date) ? p["When_期限"].date.start : null;
    const confirmed = (p["確認済み"] && p["確認済み"].multi_select) ? p["確認済み"].multi_select.map(o => o.name) : [];

    return res.status(200).json({ ok: true, taskName, who, due, already: confirmed.includes(who) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
