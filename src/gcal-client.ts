import { google, type calendar_v3 } from "googleapis";
import { GoogleAuth } from "googleapis-common";
import type { CalendarEvent, SyncedEvent } from "./types.js";

const SYNC_TAG = "timetree-gcal-sync";

export class GCalClient {
  private calendar: calendar_v3.Calendar;
  private calendarId: string;

  constructor(credentials: Record<string, unknown>, calendarId: string) {
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });

    this.calendar = google.calendar({ version: "v3", auth });
    this.calendarId = calendarId;
  }

  /**
   * syncedBy=timetree-gcal-sync の拡張プロパティを持つ全イベントを取得
   */
  async listSyncedEvents(): Promise<SyncedEvent[]> {
    const events: SyncedEvent[] = [];
    let pageToken: string | undefined;

    do {
      const res = await this.calendar.events.list({
        calendarId: this.calendarId,
        privateExtendedProperty: [`syncedBy=${SYNC_TAG}`],
        maxResults: 2500,
        pageToken,
        showDeleted: false,
        singleEvents: false,
      });

      for (const item of res.data.items ?? []) {
        const props = item.extendedProperties?.private ?? {};
        if (props.timetreeUid && item.id) {
          events.push({
            googleEventId: item.id,
            timetreeUid: props.timetreeUid,
            lastModified: props.timetreeLastModified ?? "",
          });
        }
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return events;
  }

  /**
   * Google Calendar にイベントを作成
   */
  async createEvent(event: CalendarEvent): Promise<string> {
    const body = this.toGCalEvent(event);
    const res = await this.calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: body,
    });
    return res.data.id!;
  }

  /**
   * Google Calendar のイベントを更新
   */
  async updateEvent(
    googleEventId: string,
    event: CalendarEvent
  ): Promise<void> {
    const body = this.toGCalEvent(event);
    await this.calendar.events.patch({
      calendarId: this.calendarId,
      eventId: googleEventId,
      requestBody: body,
    });
  }

  /**
   * Google Calendar のイベントを削除
   */
  async deleteEvent(googleEventId: string): Promise<void> {
    await this.calendar.events.delete({
      calendarId: this.calendarId,
      eventId: googleEventId,
    });
  }

  /**
   * CalendarEvent を Google Calendar API のイベント形式に変換
   */
  private toGCalEvent(
    event: CalendarEvent
  ): calendar_v3.Schema$Event {
    const body: calendar_v3.Schema$Event = {
      summary: event.summary,
      description: event.description || undefined,
      location: event.location || undefined,
      extendedProperties: {
        private: {
          syncedBy: SYNC_TAG,
          timetreeUid: event.uid,
          timetreeLastModified: event.lastModified?.toISOString() ?? "",
        },
      },
    };

if (event.allDay) {
  body.start = { date: formatDate(event.start) };
  body.end = { date: formatDate(event.end) };
} else if (event.recurrence.length > 0) {
  body.start = {
    dateTime: toJstDateTime(event.start),
    timeZone: "Asia/Tokyo",
  };
  body.end = {
    dateTime: toJstDateTime(event.end),
    timeZone: "Asia/Tokyo",
  };
} else {
  body.start = { dateTime: event.start.toISOString() };
  body.end = { dateTime: event.end.toISOString() };
}

if (event.recurrence.length > 0) {
  body.recurrence = event.recurrence
    .flatMap((rule) => rule.split(/\r?\n/))
    .filter((rule) => !rule.includes("DTSTART"))
    .map((rule) =>
      rule.replace(/^((?:RRULE|RDATE|EXDATE));TZID=[^:]+:/, "$1:")
    );
}
    return body;
  }
}

/** 日本時間の日時を RFC3339 のローカル時刻としてフォーマット */
function toJstDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

/** YYYY-MM-DD 形式にフォーマット */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
