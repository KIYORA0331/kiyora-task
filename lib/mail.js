// KIYORA 業務タスク管理 / メール送信・確認リンク署名 共通モジュール
// Gmail SMTP（アプリパスワード）で送信。確認リンクはHMAC署名で改ざん防止。
// 環境変数：GMAIL_USER, GMAIL_APP_PASSWORD, CONFIRM_SECRET, MEMBER_EMAILS_JSON

import nodemailer from "nodemailer";
import crypto from "crypto";

const SECRET = process.env.CONFIRM_SECRET || "";

function memberEmails() {
  try { return JSON.parse(process.env.MEMBER_EMAILS_JSON || "{}"); }
  catch { return {}; }
}
export function emailFor(name) {
  return memberEmails()[name] || null;
}

export function sign(taskId, who) {
  return crypto.createHmac("sha256", SECRET).update(`${taskId}:${who}`).digest("hex").slice(0, 32);
}
export function verify(taskId, who, sig) {
  if (!sig || !SECRET) return false;
  const expect = sign(taskId, who);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expect);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

let _t;
function transporter() {
  if (!_t) {
    _t = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return _t;
}

export async function sendMail({ to, subject, html, text }) {
  const from = `KIYORA 業務管理 <${process.env.GMAIL_USER}>`;
  return transporter().sendMail({ from, to, subject, html, text });
}

// タスク確認メールの本文を組み立てる
export function buildTaskConfirmMail({ taskName, who, due, participants, confirmUrl, dashboardUrl }) {
  const subject = `【確認依頼】新しいタスク：${taskName}`;
  const dueLine = due ? `期限：${String(due).slice(0, 10)}` : "期限：未設定";
  const partLine = (participants && participants.length) ? `関係者：${participants.join("・")}` : "";
  const dashTextBlock = dashboardUrl
    ? `

▼ ダッシュボードを開く（タスク全体を確認できます）
${dashboardUrl}`
    : "";
  const text =
`${who} さん

KIYORAに新しいタスクが登録されました。内容をご確認ください。

タスク：${taskName}
${dueLine}
${partLine}

▼ 内容を確認する（クリックして開いたページで「確認しました」を押してください）
${confirmUrl}${dashTextBlock}

— KIYORA 業務管理`;
  const dashButton = dashboardUrl
    ? `
    <a href="${dashboardUrl}" style="display:inline-block;background:#fff;color:#1F3864;text-decoration:none;padding:10px 20px;border:1.5px solid #1F3864;border-radius:8px;font-weight:600;margin-left:8px">ダッシュボードを開く</a>`
    : "";
  const dashFallback = dashboardUrl
    ? `
  <p style="color:#888;font-size:12px">ダッシュボード：<br>${dashboardUrl}</p>`
    : "";
  const html =
`<div style="font-family:sans-serif;line-height:1.7;color:#1a1a1a">
  <p>${escapeHtml(who)} さん</p>
  <p>KIYORAに新しいタスクが登録されました。内容をご確認ください。</p>
  <table style="border-collapse:collapse;margin:10px 0">
    <tr><td style="color:#666;padding:2px 12px 2px 0">タスク</td><td style="font-weight:600">${escapeHtml(taskName)}</td></tr>
    <tr><td style="color:#666;padding:2px 12px 2px 0">${due ? "期限" : ""}</td><td>${due ? escapeHtml(String(due).slice(0,10)) : ""}</td></tr>
    ${partLine ? `<tr><td style="color:#666;padding:2px 12px 2px 0">関係者</td><td>${escapeHtml(participants.join("・"))}</td></tr>` : ""}
  </table>
  <p>
    <a href="${confirmUrl}" style="display:inline-block;background:#1F3864;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600">内容を確認する</a>${dashButton}
  </p>
  <p style="color:#888;font-size:12px">ボタンが開かない場合は次のURLを開いてください：<br>${confirmUrl}</p>${dashFallback}
  <p style="color:#888;font-size:12px">— KIYORA 業務管理</p>
</div>`;
  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
