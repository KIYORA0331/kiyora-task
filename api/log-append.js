// KIYORA 業務タスク管理 / 進捗ログ追記API
// 1) 進捗ログDBに「この回の報告」を1レコード追記（過去は絶対に書き換えない）
// 2) タスクDBの現在到達度・ステータス・ブロック起因を最新値に更新
// 数値は観察データであって査定スコアではない。

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const TASK_DB_ID = "c41de31d-0338-4c16-8797-11b5c4231512";
const LOG_DB_ID = "1fb7d43c-e9b8-4ca1-9b37-e7b5d123d0c8";
const NOTION_VERSION = "2022-06-28";

const rt = (v) => (v && String(v).trim())
  ? { rich_text: [{ text: { content: String(v).slice(0, 2000) } }] } : null;

function logId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const seq = String(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  return `LOG-${stamp}-${seq}`;
}

function jstToday() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

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
    if (!b.taskId) return res.status(400).json({ ok: false, error: "taskId が必要です" });

    const before = (typeof b.before === "number") ? b.before : 0;
    const after = (typeof b.after === "number") ? b.after : before;
    const status = b.status || "進行中";

    // 1) 進捗ログDBに追記
    const logProps = {
      "ログID": { title: [{ text: { content: logId() } }] },
      "対象タスク": { relation: [{ id: b.taskId }] },
      "報告前到達度": { number: before },
      "報告後到達度": { number: after },
      "当時のステータス": { select: { name: status } },
    };
    if (b.member) logProps["担当者"] = { select: { name: b.member } };
    const memoProp = rt(b.memo); if (memoProp) logProps["自己評価メモ"] = memoProp;
    const brProp = rt(b.blockReason); if (brProp) logProps["ブロック理由"] = brProp;

    const logRes = await notion("pages", "POST", {
      parent: { database_id: LOG_DB_ID },
      properties: logProps,
    });
    if (!logRes.ok) return res.status(logRes.status).json({ ok: false, error: "ログ追記失敗: " + (logRes.data.message || ""), detail: logRes.data });

    // 2) タスクDBの現在地を更新
    const taskProps = {
      "現在到達度": { number: after },
      "ステータス": { select: { name: status } },
    };
    if (b.blockCause) taskProps["ブロック起因"] = { select: { name: b.blockCause } };
    if (typeof b.priority === "number" && b.priority >= 1 && b.priority <= 5) taskProps["優先度"] = { number: b.priority };
    if (Array.isArray(b.participants)) taskProps["参加者"] = { multi_select: b.participants.map(n => ({ name: n })) };
    if (typeof b.due === "string") {
      taskProps["When_期限"] = b.due.trim() ? { date: { start: b.due } } : { date: null };
    }
    if (typeof b.start === "string") {
      // 開始日を空にした場合は期限日で補完する（task-create と同じ扱い）。
      // 空のままだとNotionのタイムライン（ガント）から消えてしまうため。
      const fallback = (typeof b.due === "string" && b.due.trim()) ? b.due.trim() : null;
      const startVal = b.start.trim() || fallback;
      taskProps["開始日"] = startVal ? { date: { start: startVal } } : { date: null };
    }
    if (status === "完了") taskProps["現在到達度"] = { number: 100 };

    // タスクメモを上書き保存（空文字ならクリア）。履歴は上の進捗ログに自己評価メモとして残る
    if (typeof b.memo === "string") {
      taskProps["メモ"] = b.memo.trim()
        ? { rich_text: [{ text: { content: b.memo.slice(0, 2000) } }] }
        : { rich_text: [] };
    }

    // 完了日：完了に入った日を記録（既に記録済みなら保持）。完了以外に戻ったらクリア
    if (status === "完了") {
      let already = null;
      const cur = await notion(`pages/${b.taskId}`, "GET");
      if (cur.ok) {
        const dp = cur.data.properties && cur.data.properties["完了日"];
        already = (dp && dp.date) ? dp.date.start : null;
      }
      taskProps["完了日"] = { date: { start: already || jstToday() } };
    } else {
      taskProps["完了日"] = { date: null };
    }

    const taskRes = await notion(`pages/${b.taskId}`, "PATCH", { properties: taskProps });
    if (!taskRes.ok) return res.status(taskRes.status).json({ ok: false, error: "タスク更新失敗: " + (taskRes.data.message || ""), detail: taskRes.data });

    return res.status(200).json({ ok: true, logId: logRes.data.id, delta: after - before });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
