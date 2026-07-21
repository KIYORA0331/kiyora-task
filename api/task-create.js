// KIYORA 業務タスク管理 / タスク作成API
// フロントで構造化済みのデータを受け取り、タスクDBに1レコード作成する。
// 依存パッケージなし（Node18+ 内蔵fetch使用）。トークンのみ環境変数。

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const TASK_DB_ID = "c41de31d-0338-4c16-8797-11b5c4231512"; // タスクDB（公開しても単体では実害小・トークン無しでは不可）
const NOTION_VERSION = "2022-06-28";

import { emailFor, sign, sendMail, buildTaskConfirmMail } from "../lib/mail.js";

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
      "メモ": rt(b.memo),
      "タスク種別": sel(b.taskType),
      "連動目標": sel(b.linkedGoal),
      "重み": sel(b.weight || "中"),
      "優先度": { number: (typeof b.priority === "number" && b.priority >= 1 && b.priority <= 5) ? b.priority : 3 },
      "参加者": { multi_select: Array.isArray(b.participants) ? b.participants.map(n => ({ name: n })) : [] },
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

    // 開始日（ISO日付文字列があれば）。期限とは独立の任意項目。
    // 【判断】未入力なら期限日を開始日として記録する。Notionのタイムライン（ガント）は
    // 開始日が空のレコードを描画しないため、空のままだと新規タスクがガントから消える。
    // 「着手予定日が未申告＝期限日に着手する予定」とみなす扱いで、着手遅れ通知も誤発火しない。
    const startVal = (b.start && String(b.start).trim()) ? String(b.start)
      : (b.due && String(b.due).trim()) ? String(b.due) : null;
    if (startVal) {
      props["開始日"] = { date: { start: startVal } };
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

    // 担当者＋参加者の全員へ確認メールを送信（重複除外）。メール失敗でもタスク作成は成功扱い。
    let notified = [];
    try {
      const recipients = Array.from(new Set(
        [b.assignee, ...(Array.isArray(b.participants) ? b.participants : [])].filter(Boolean)
      ));
      const host = req.headers["x-forwarded-host"] || req.headers.host || "kiyora-task.vercel.app";
      const base = `https://${host}`;
      const dashboardUrl = `${base}/dashboard.html`;
      const parts = Array.isArray(b.participants) ? b.participants : [];
      for (const who of recipients) {
        const addr = emailFor(who);
        if (!addr) continue;
        const sig = sign(data.id, who);
        const confirmUrl = `${base}/confirm.html?task=${encodeURIComponent(data.id)}&who=${encodeURIComponent(who)}&sig=${sig}`;
        const mail = buildTaskConfirmMail({ taskName: String(b.taskName), who, start: b.start || null, due: b.due || null, participants: parts, confirmUrl, dashboardUrl });
        await sendMail({ to: addr, subject: mail.subject, html: mail.html, text: mail.text });
        notified.push(who);
      }
    } catch (mailErr) {
      return res.status(200).json({ ok: true, id: data.id, url: data.url, notified, mailWarning: String(mailErr && mailErr.message ? mailErr.message : mailErr) });
    }

    return res.status(200).json({ ok: true, id: data.id, url: data.url, notified });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
