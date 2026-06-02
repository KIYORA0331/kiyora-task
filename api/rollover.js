// KIYORA 業務タスク管理 / 翌日繰越API
// dashboard 表示時に1回だけ呼ばれる（cron不要・vercel.json不要＝A43教訓と整合）。
// 期限切れの「未着手／繰越」タスクだけを今日に引き寄せ、繰越回数を+1する。
// 「進行中／ブロック」には触らない（task-list 側が期限に関係なく返すため翌日も残る）。
//   → ブロックは翌日に残るが繰越回数は増えない＝評価軸を汚さない。
// 依存パッケージなし（Node18+ 内蔵fetch使用）。トークンのみ環境変数。

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const TASK_DB_ID = "c41de31d-0338-4c16-8797-11b5c4231512";
const NOTION_VERSION = "2022-06-28";

// 【判断】サーバ（Vercel）はUTCで動くため、JSTの「今日」を明示的に算出する。
// これをしないと深夜帯（JST 0:00〜9:00）に日付が1日ずれ、繰越判定を誤る。
function todayJST() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function notion(path, method, body) {
  const resp = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.message || `Notion ${method} /${path} エラー`);
  }
  return data;
}

export default async function handler(req, res) {
  if (!NOTION_TOKEN) {
    return res.status(500).json({ ok: false, error: "NOTION_TOKEN 未設定" });
  }

  try {
    const today = todayJST();

    // 繰越対象：ステータス∈{未着手, 繰越} かつ 期限が今日より前。
    // ※ 期限なしのタスクは date フィルタに一致しないので自動的に対象外。
    // ※ ブロック・進行中・完了・取下げ は対象外。
    const filter = {
      and: [
        {
          or: [
            { property: "ステータス", select: { equals: "未着手" } },
            { property: "ステータス", select: { equals: "繰越" } },
          ],
        },
        { property: "When_期限", date: { before: today } },
      ],
    };

    // ページネーションで全件取得
    let pages = [];
    let cursor = undefined;
    do {
      const data = await notion(`databases/${TASK_DB_ID}/query`, "POST", {
        filter,
        start_cursor: cursor,
        page_size: 100,
      });
      pages = pages.concat(data.results || []);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    let carried = 0;
    let skipped = 0;

    for (const pg of pages) {
      const p = pg.properties;

      // 多重カウント防止：最終繰越日が既に今日なら触らない。
      //（通常は繰越後に期限=今日となり上のフィルタに二度と一致しないが、念のための保険）
      const last = (p["最終繰越日"] && p["最終繰越日"].date) ? p["最終繰越日"].date.start : null;
      if (last && last.slice(0, 10) === today) {
        skipped++;
        continue;
      }

      const cur = (p["繰越回数"] && typeof p["繰越回数"].number === "number") ? p["繰越回数"].number : 0;

      await notion(`pages/${pg.id}`, "PATCH", {
        properties: {
          "When_期限": { date: { start: today } },
          "ステータス": { select: { name: "繰越" } },
          "繰越回数": { number: cur + 1 },
          "最終繰越日": { date: { start: today } },
        },
      });
      carried++;
    }

    return res.status(200).json({ ok: true, date: today, scanned: pages.length, carried, skipped });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
