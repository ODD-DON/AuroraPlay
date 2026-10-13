import "server-only";
import { num, type Queryable } from "@/server/db";
import { logger } from "@/server/log";

/**
 * Delivers pending alerts to external channels. In-app delivery happens at
 * alert creation. Email and push go out only for high and critical alerts,
 * respect quiet hours (critical alerts excepted), and never re-send.
 */

function inQuietHours(start: number | null, end: number | null, hour: number): boolean {
  if (start === null || end === null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY && !!process.env.ALERT_EMAIL_TO && !!process.env.ALERT_EMAIL_FROM;
}

export function pushConfigured() {
  return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY && !!process.env.VAPID_SUBJECT;
}

async function sendEmail(subject: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_EMAIL_FROM, to: [process.env.ALERT_EMAIL_TO], subject: subject.slice(0, 200), text }),
  });
  if (!res.ok) throw new Error(`Email failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export async function dispatchNotifications(q: Queryable, ownerId: string) {
  const [prefs] = await q.query<{ quiet_hours_start: number | null; quiet_hours_end: number | null; notification_channels: Record<string, boolean> }>(
    `select quiet_hours_start, quiet_hours_end, notification_channels from user_preferences where owner_id = $1`,
    [ownerId],
  );
  const channels = prefs?.notification_channels ?? { in_app: true };
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }));
  const quiet = inQuietHours(prefs?.quiet_hours_start ?? null, prefs?.quiet_hours_end ?? null, hour);
  const alerts = await q.query<{ id: string; priority: string; title: string; body: string; link: string | null }>(
    `select a.id, a.priority, a.title, a.body, a.link from alerts a
      where a.owner_id = $1 and a.priority in ('high','critical') and a.created_at > now() - interval '1 day'
        and not exists (select 1 from notifications n where n.alert_id = a.id and n.channel in ('email','push'))
      order by a.created_at limit 20`,
    [ownerId],
  );
  const base = process.env.APP_BASE_URL ?? "";
  for (const a of alerts) {
    const suppress = quiet && a.priority !== "critical";
    if (channels.email && emailConfigured()) {
      try {
        if (!suppress) await sendEmail(a.title, `${a.body}\n\n${base}${a.link ?? ""}`);
        await q.query(`insert into notifications (owner_id, alert_id, channel, status, sent_at) values ($1,$2,'email',$3,now()) on conflict do nothing`, [ownerId, a.id, suppress ? "suppressed" : "sent"]);
      } catch (e) {
        await q.query(`insert into notifications (owner_id, alert_id, channel, status, error) values ($1,$2,'email','failed',$3) on conflict do nothing`, [ownerId, a.id, (e as Error).message]);
      }
    }
    if (channels.push && pushConfigured()) {
      const webpush = (await import("web-push")).default;
      webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
      const subs = await q.query<{ id: string; endpoint: string; keys: { p256dh: string; auth: string } }>(`select id, endpoint, keys from push_subscriptions where owner_id = $1`, [ownerId]);
      let sent = 0;
      for (const s of subs) {
        if (suppress) break;
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: a.title, body: a.body.slice(0, 180), url: a.link ?? "/" }));
          sent++;
        } catch (e) {
          const status = num((e as { statusCode?: number }).statusCode);
          if (status === 404 || status === 410) await q.query(`delete from push_subscriptions where id = $1`, [s.id]);
          logger.warn("push.failed", { status });
        }
      }
      await q.query(`insert into notifications (owner_id, alert_id, channel, status, sent_at) values ($1,$2,'push',$3,now()) on conflict do nothing`, [
        ownerId, a.id, suppress ? "suppressed" : sent > 0 ? "sent" : "failed",
      ]);
    }
  }
}
