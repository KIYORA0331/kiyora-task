// KIYORA 業務タスク管理 / 予定一覧取得API（Googleカレンダー版）
// GoogleカレンダーのiCal(ics)を読み、繰り返し予定も展開して返す。
// 予定はGoogleカレンダー（Notion Calendar）で管理。NotionのタスクDBとは別系統。
// 機密：iCalの非公開URLはコードに書かず、環境変数 GCAL_ICS_URL に置く。

import IcalExpander from "ical-expander";

const ICS_URL = process.env.GCAL_ICS_URL;
const pad = (n) => String(n).padStart(2, "0");

function formatJST(jsd) {
  const j = new Date(jsd.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}T${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}:00+09:00`;
}

function toDatetime(t) {
  // t: ICAL.Time。終日は日付のみ、時刻ありはJSTのISO。
  if (t.isDate) return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
  return formatJST(t.toJSDate());
}

function mapItem(item, startDate, uid) {
  return {
    id: (uid || "") + "_" + (startDate ? startDate.toString() : ""),
    name: item.summary || "(無題)",
    datetime: toDatetime(startDate),
    type: "",            // Googleカレンダーには種別欄がないため空
    place: item.location || "",
    participants: [],     // 個別メンバーの紐付けは持たない（全員表示で見える）
  };
}

export default async function handler(req, res) {
  if (!ICS_URL) {
    return res.status(500).json({ ok: false, error: "GCAL_ICS_URL 未設定（Googleカレンダーの非公開iCalアドレスを環境変数に登録してください）" });
  }
  try {
    const r = await fetch(ICS_URL);
    if (!r.ok) throw new Error("iCal取得失敗 HTTP " + r.status);
    const ics = await r.text();

    const now = new Date();
    const after = new Date(now.getTime() - 31 * 24 * 3600 * 1000);    // 過去31日
    const before = new Date(now.getTime() + 180 * 24 * 3600 * 1000);  // 先180日

    const expander = new IcalExpander({ ics, maxIterations: 2000 });
    const result = expander.between(after, before);

    const events = [];
    result.events.forEach((e) => events.push(mapItem(e, e.startDate, e.uid)));
    result.occurrences.forEach((o) => events.push(mapItem(o.item, o.startDate, o.item.uid)));
    events.sort((a, b) => (a.datetime < b.datetime ? -1 : a.datetime > b.datetime ? 1 : 0));

    return res.status(200).json({ ok: true, count: events.length, events });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
