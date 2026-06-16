// KIYORA 業務タスク管理 / 確認記録API（POST）
// 署名を検証し、タスクDBの「確認済み」に who を追加する（二段確認の2段目）。
// 冪等：すでに確認済みなら何もしない。

import { verify } from "../lib/mail.js";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!NOTION_TOKEN) return res.status(500).json({ ok: false, error: "NOTION_TOKEN 未設定" });

  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { task, who, sig } = b;
    if (!task || !who || !sig) return res.status(400).json({ ok: false, error: "パラメータ不足" });
    if (!verify(task, who, sig)) return res.status(403).json({ ok: false, error: "リンクが無効です" });

    // 現在の確認済みを取得
    const cur = await notion(`pages/${task}`, "GET");
    if (!cur.ok) return res.status(cur.status).json({ ok: false, error: "タスク取得失敗" });
    const prop = cur.data.properties && cur.data.properties["確認済み"];
    const list = (prop && prop.multi_select) ? prop.multi_select.map(o => o.name) : [];

    if (list.includes(who)) {
      return res.status(200).json({ ok: true, already: true, confirmed: list });
    }

    const next = [...list, who];
    const upd = await notion(`pages/${task}`, "PATCH", {
      properties: { "確認済み": { multi_select: next.map(n => ({ name: n })) } },
    });
    if (!upd.ok) return res.status(upd.status).json({ ok: false, error: upd.data.message || "更新失敗" });

    return res.status(200).json({ ok: true, already: false, confirmed: next });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
