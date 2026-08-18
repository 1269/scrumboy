// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaEvent, Board } from '../types.js';
import {
  AGENDA_COLUMN_KEY,
  agendaDayWindow,
  buildAgendaColumnHtml,
  layoutAgendaTimedEvents,
  renderAgendaEventCard,
} from './board-agenda.js';
import { getBoardColumns, visibleBoardLaneCount } from './board-rendering.js';
import { setAgendaFullDayPreference } from '../core/agenda-full-day-preferences.js';
import enCatalog from '../i18n/locales/en.json';

function agendaBoard(): Board {
  return {
    project: { id: 1, name: 'Alpha', slug: 'alpha', dominantColor: '#123456' },
    tags: [],
    columnOrder: [
      { key: 'backlog', name: 'Backlog', isDone: false },
      { key: 'doing', name: 'In Progress', isDone: false },
    ],
    columns: { backlog: [], doing: [] },
    agenda: {
      enabled: true,
      timezone: 'UTC',
      stale: true,
      error: null,
      events: [
        {
          id: '3:pickup:1',
          sourceId: 3,
          calendarName: 'Family',
          title: 'Pickup',
          startsAt: '2026-08-17T20:00:00Z',
          endsAt: '2026-08-17T20:30:00Z',
          allDay: false,
          location: 'School',
          provider: 'ics_feed',
        },
      ],
    },
  };
}

describe('agenda virtual lane', () => {
  beforeEach(() => {
    localStorage.clear();
    setAgendaFullDayPreference(false);
  });

  afterEach(async () => {
    const i18n = await import('../i18n/index.js');
    i18n.resetI18nForTests();
  });

  it('renders event cards without todo identifiers or drag handles', async () => {
    const i18n = await import('../i18n/index.js');
    await i18n.initI18n({ locale: 'en', loadLocale: vi.fn(async () => enCatalog) });
    const html = buildAgendaColumnHtml(agendaBoard(), null);
    expect(html).toContain('col--agenda');
    expect(html).toContain('card--agenda');
    expect(html).toContain('Pickup');
    expect(html).toContain('data-agenda-event-id="3:pickup:1"');
    const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' };
    const start = new Date('2026-08-17T20:00:00Z').toLocaleTimeString(undefined, timeOpts);
    const end = new Date('2026-08-17T20:30:00Z').toLocaleTimeString(undefined, timeOpts);
    expect(html).toContain(`${start} - ${end}`);
    expect(html).not.toContain('Family');
    expect(html).not.toContain('data-todo-id');
    expect(html).not.toContain('data-todo-local-id');
    expect(html).not.toContain('card__drag-handle');
    expect(html).not.toContain('id="localId"');
    expect(html).not.toContain('data-status=');
    expect(html).toContain('Calendar may be out of date.');
    expect(html).toContain('Agenda');
    expect(html).not.toContain('data-i18n-text="board.agenda.title"');
  });

  it('uses a custom agenda lane title instead of the default', async () => {
    const i18n = await import('../i18n/index.js');
    await i18n.initI18n({ locale: 'en', loadLocale: vi.fn(async () => enCatalog) });
    const board = agendaBoard();
    board.agenda = { ...board.agenda!, title: 'Team calendar' };
    const html = buildAgendaColumnHtml(board, null);
    expect(html).toContain('Team calendar');
    expect(html).not.toContain('>Agenda<');
    expect(html).not.toContain('Family');
  });

  it('does not treat agenda as a workflow column', () => {
    const board = agendaBoard();
    expect(getBoardColumns(board).map((c) => c.key)).toEqual(['backlog', 'doing']);
    expect(visibleBoardLaneCount(board)).toBe(3);
  });

  it('renders all-day events without todo selection chrome', async () => {
    const i18n = await import('../i18n/index.js');
    await i18n.initI18n({ locale: 'en', loadLocale: vi.fn(async () => enCatalog) });
    const html = renderAgendaEventCard(
      {
        id: '3:holiday:1',
        sourceId: 3,
        calendarName: 'Family',
        title: 'Holiday',
        startsAt: '2026-08-17T00:00:00Z',
        endsAt: '2026-08-18T00:00:00Z',
        allDay: true,
        location: '',
        provider: 'ics_feed',
      },
      'UTC',
    );
    expect(html).toContain('Holiday');
    expect(html).toContain('All day');
    expect(html).not.toContain('Family');
    expect(html).not.toContain(' - ');
    expect(html).not.toContain('card--selected');
    expect(html).not.toContain('checkbox');
    expect(AGENDA_COLUMN_KEY).toBe('agenda');
  });

  it('omits empty copy when first fetch failed with no events', async () => {
    const i18n = await import('../i18n/index.js');
    await i18n.initI18n({ locale: 'en', loadLocale: vi.fn(async () => enCatalog) });
    const board = agendaBoard();
    board.agenda = {
      enabled: true,
      timezone: 'UTC',
      stale: true,
      error: 'calendar feed too large',
      events: [],
    };
    const html = buildAgendaColumnHtml(board, null);
    expect(html).toContain('calendar feed too large');
    expect(html).not.toContain('No events today.');
    expect(html).not.toContain('col__agenda-empty');
  });

  it('shows empty copy when a successful snapshot has no events today', async () => {
    const i18n = await import('../i18n/index.js');
    await i18n.initI18n({ locale: 'en', loadLocale: vi.fn(async () => enCatalog) });
    const board = agendaBoard();
    board.agenda = {
      enabled: true,
      timezone: 'UTC',
      stale: false,
      error: null,
      events: [],
    };
    const html = buildAgendaColumnHtml(board, null);
    expect(html).toContain('No events today.');
    expect(html).toContain('col__agenda-empty');
    expect(html).not.toContain('col__agenda-status');
  });

  it('shows last-good events together with a refresh error', async () => {
    const i18n = await import('../i18n/index.js');
    await i18n.initI18n({ locale: 'en', loadLocale: vi.fn(async () => enCatalog) });
    const board = agendaBoard();
    board.agenda = {
      ...board.agenda!,
      stale: true,
      error: 'calendar feed request failed',
    };
    const html = buildAgendaColumnHtml(board, null);
    expect(html).toContain('calendar feed request failed');
    expect(html).toContain('Pickup');
    expect(html).not.toContain('No events today.');
  });

  it('renders Google and Apple host badges and omits a badge for other', async () => {
    const i18n = await import('../i18n/index.js');
    await i18n.initI18n({ locale: 'en', loadLocale: vi.fn(async () => enCatalog) });
    const google = renderAgendaEventCard(
      {
        id: '3:pickup:1',
        sourceId: 3,
        calendarName: 'Family',
        title: 'Pickup',
        startsAt: '2026-08-17T20:00:00Z',
        endsAt: '2026-08-17T20:30:00Z',
        allDay: false,
        location: '',
        provider: 'ics_feed',
        hostKind: 'google',
      },
      'UTC',
    );
    expect(google).toContain('/assets/calendar/google.webp');
    expect(google).toContain('card__agenda-badge--google');
    expect(google).toContain('role="img"');
    expect(google).toContain('alt=""');
    expect(google).toContain(`aria-label="${enCatalog['board.agenda.badge.google']}"`);
    expect(google).not.toContain('/assets/calendar/apple.webp');

    const apple = renderAgendaEventCard(
      {
        id: '3:pickup:1',
        sourceId: 3,
        calendarName: 'Family',
        title: 'Pickup',
        startsAt: '2026-08-17T20:00:00Z',
        endsAt: '2026-08-17T20:30:00Z',
        allDay: false,
        location: '',
        provider: 'ics_feed',
        hostKind: 'apple',
      },
      'UTC',
    );
    expect(apple).toContain('/assets/calendar/apple.webp');
    expect(apple).toContain('card__agenda-badge--apple');
    expect(apple).toContain('role="img"');
    expect(apple).toContain('alt=""');
    expect(apple).toContain(`aria-label="${enCatalog['board.agenda.badge.apple']}"`);
    expect(apple).not.toContain('/assets/calendar/google.webp');

    const other = renderAgendaEventCard(
      {
        id: '3:pickup:1',
        sourceId: 3,
        calendarName: 'Family',
        title: 'Pickup',
        startsAt: '2026-08-17T20:00:00Z',
        endsAt: '2026-08-17T20:30:00Z',
        allDay: false,
        location: '',
        provider: 'ics_feed',
        hostKind: 'other',
      },
      'UTC',
    );
    expect(other).not.toContain('card__agenda-badge');
    expect(other).not.toContain('/assets/calendar/');

    const missing = renderAgendaEventCard(
      {
        id: '3:pickup:1',
        sourceId: 3,
        calendarName: 'Family',
        title: 'Pickup',
        startsAt: '2026-08-17T20:00:00Z',
        endsAt: '2026-08-17T20:30:00Z',
        allDay: false,
        location: '',
        provider: 'ics_feed',
      },
      'UTC',
    );
    expect(missing).not.toContain('card__agenda-badge');
    expect(missing).not.toContain('/assets/calendar/');
  });
});

function timedEvent(id: string, startsAt: string, endsAt: string, extras: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    id,
    sourceId: 3,
    calendarName: 'Family',
    title: extras.title || id,
    startsAt,
    endsAt,
    allDay: false,
    location: '',
    provider: 'ics_feed',
    ...extras,
  };
}

describe('agenda day window and timed layout', () => {
  const utcNoon = new Date('2026-08-17T12:00:00Z');

  it('uses a fit window from first timed hour to last timed hour and ignores all-day events', () => {
    const events = [
      timedEvent('a', '2026-08-17T09:15:00Z', '2026-08-17T09:45:00Z'),
      timedEvent('b', '2026-08-17T15:00:00Z', '2026-08-17T16:00:00Z'),
      {
        ...timedEvent('holiday', '2026-08-17T00:00:00Z', '2026-08-18T00:00:00Z'),
        allDay: true,
        title: 'Holiday',
      },
    ];
    expect(agendaDayWindow(events, 'UTC', 'fit', utcNoon)).toEqual({ startMinute: 540, endMinute: 960 });
    expect(agendaDayWindow(events.filter((event) => event.allDay), 'UTC', 'fit', utcNoon)).toBeNull();
  });

  it('full_day is always 00:00-24:00 even with no events', () => {
    expect(agendaDayWindow([], 'UTC', 'full_day', utcNoon)).toEqual({ startMinute: 0, endMinute: 1440 });
  });

  it('places overlapping events in two columns and a later cluster at full width', () => {
    const events = [
      timedEvent('A', '2026-08-17T09:00:00Z', '2026-08-17T10:00:00Z'),
      timedEvent('B', '2026-08-17T09:30:00Z', '2026-08-17T10:30:00Z'),
      timedEvent('C', '2026-08-17T15:00:00Z', '2026-08-17T16:00:00Z'),
    ];
    const window = agendaDayWindow(events, 'UTC', 'fit', utcNoon)!;
    const layout = layoutAgendaTimedEvents(events, 'UTC', window, utcNoon);
    const byId = Object.fromEntries(layout.map((item) => [item.event.id, item]));
    expect(byId.A.columnCount).toBe(2);
    expect(byId.B.columnCount).toBe(2);
    expect(byId.A.column).not.toBe(byId.B.column);
    expect(byId.C.column).toBe(0);
    expect(byId.C.columnCount).toBe(1);
  });

  it('lets sequential events occupy full width', () => {
    const events = [
      timedEvent('A', '2026-08-17T10:00:00Z', '2026-08-17T11:00:00Z'),
      timedEvent('B', '2026-08-17T11:00:00Z', '2026-08-17T12:00:00Z'),
    ];
    const window = { startMinute: 600, endMinute: 720 };
    const layout = layoutAgendaTimedEvents(events, 'UTC', window, utcNoon);
    expect(layout).toHaveLength(2);
    expect(layout.every((item) => item.columnCount === 1 && item.column === 0)).toBe(true);
  });

  it('keeps all-day events out of timed packing', () => {
    const events = [
      {
        ...timedEvent('holiday', '2026-08-17T00:00:00Z', '2026-08-18T00:00:00Z'),
        allDay: true,
        title: 'Holiday',
      },
      timedEvent('A', '2026-08-17T10:00:00Z', '2026-08-17T11:00:00Z'),
    ];
    const window = { startMinute: 0, endMinute: 1440 };
    const layout = layoutAgendaTimedEvents(events, 'UTC', window, utcNoon);
    expect(layout.map((item) => item.event.id)).toEqual(['A']);
  });

  it('clamps overnight events to the visible day', () => {
    const event = timedEvent('night', '2026-08-17T22:00:00Z', '2026-08-18T02:00:00Z');
    const startDay = layoutAgendaTimedEvents(
      [event],
      'UTC',
      { startMinute: 0, endMinute: 1440 },
      new Date('2026-08-17T12:00:00Z'),
    );
    expect(startDay[0].startMinute).toBe(1320);
    expect(startDay[0].endMinute).toBe(1440);

    const nextDay = layoutAgendaTimedEvents(
      [event],
      'UTC',
      { startMinute: 0, endMinute: 1440 },
      new Date('2026-08-18T12:00:00Z'),
    );
    expect(nextDay[0].startMinute).toBe(0);
    expect(nextDay[0].endMinute).toBe(120);
  });

  it('positions spring-forward 03:00 at wall-clock minute 180, not elapsed-from-midnight', () => {
    const now = new Date('2026-03-08T16:00:00Z');
    const event = timedEvent('spring', '2026-03-08T07:00:00Z', '2026-03-08T08:00:00Z');
    const layout = layoutAgendaTimedEvents(
      [event],
      'America/New_York',
      { startMinute: 0, endMinute: 1440 },
      now,
    );
    expect(layout[0].startMinute).toBe(180);
    expect(layout[0].startMinute).not.toBe(120);
  });

  it('maps both fall-back 01:30 instants to the same wall-clock slot', () => {
    const now = new Date('2026-11-01T16:00:00Z');
    const events = [
      timedEvent('first', '2026-11-01T05:30:00Z', '2026-11-01T06:00:00Z'),
      timedEvent('second', '2026-11-01T06:30:00Z', '2026-11-01T07:00:00Z'),
    ];
    const layout = layoutAgendaTimedEvents(
      events,
      'America/New_York',
      { startMinute: 0, endMinute: 1440 },
      now,
    );
    expect(layout[0].startMinute).toBe(90);
    expect(layout[1].startMinute).toBe(90);
  });
});

describe('agenda day grid HTML', () => {
  const now = new Date('2026-08-17T12:00:00Z');

  beforeEach(() => {
    localStorage.clear();
    setAgendaFullDayPreference(false);
  });

  afterEach(async () => {
    const i18n = await import('../i18n/index.js');
    i18n.resetI18nForTests();
  });

  it('places timed cards with inline top/height and all-day events above the grid', async () => {
    const i18n = await import('../i18n/index.js');
    await i18n.initI18n({ locale: 'en', loadLocale: vi.fn(async () => enCatalog) });
    const board = agendaBoard();
    board.agenda = {
      ...board.agenda!,
      stale: false,
      error: null,
      events: [
        {
          ...timedEvent('holiday', '2026-08-17T00:00:00Z', '2026-08-18T00:00:00Z'),
          allDay: true,
          title: 'Holiday',
        },
        timedEvent('Pickup', '2026-08-17T20:00:00Z', '2026-08-17T20:30:00Z', { title: 'Pickup' }),
      ],
    };
    const html = buildAgendaColumnHtml(board, null, now);
    expect(html).toContain('agenda-allday');
    expect(html).toContain('Holiday');
    expect(html.indexOf('agenda-allday')).toBeLessThan(html.indexOf('agenda-day'));
    expect(html).toContain('agenda-day');
    expect(html).toContain('agenda-hour');
    expect(html).toContain('card--agenda-timed');
    expect(html).toMatch(/style="top:\d/);
    expect(html).not.toContain("card.replace");
    expect(html).toContain('Pickup');
    expect(html).not.toContain('col__agenda-empty');
  });

  it('renders hour rows for an empty full_day grid and omits empty copy', async () => {
    const i18n = await import('../i18n/index.js');
    await i18n.initI18n({ locale: 'en', loadLocale: vi.fn(async () => enCatalog) });
    setAgendaFullDayPreference(true);
    const board = agendaBoard();
    board.agenda = { enabled: true, timezone: 'UTC', stale: false, error: null, events: [] };
    const html = buildAgendaColumnHtml(board, null, now);
    expect(html).toContain('agenda-day');
    expect(html.match(/class="agenda-hour"/g)?.length).toBe(24);
    expect(html).not.toContain('No events today.');
    expect(html).not.toContain('col__agenda-empty');
  });

  it('does not render a 24-hour grid in fit mode with no timed events', async () => {
    const i18n = await import('../i18n/index.js');
    await i18n.initI18n({ locale: 'en', loadLocale: vi.fn(async () => enCatalog) });
    const board = agendaBoard();
    board.agenda = {
      enabled: true,
      timezone: 'UTC',
      stale: false,
      error: null,
      events: [
        {
          ...timedEvent('holiday', '2026-08-17T00:00:00Z', '2026-08-18T00:00:00Z'),
          allDay: true,
          title: 'Holiday',
        },
      ],
    };
    const html = buildAgendaColumnHtml(board, null, now);
    expect(html).toContain('Holiday');
    expect(html).toContain('agenda-allday');
    expect(html).not.toContain('agenda-day');
    expect(html).not.toContain('No events today.');
  });
});
