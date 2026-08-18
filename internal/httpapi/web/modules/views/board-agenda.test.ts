// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '../types.js';
import { AGENDA_COLUMN_KEY, buildAgendaColumnHtml, renderAgendaEventCard } from './board-agenda.js';
import { getBoardColumns, visibleBoardLaneCount } from './board-rendering.js';
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
