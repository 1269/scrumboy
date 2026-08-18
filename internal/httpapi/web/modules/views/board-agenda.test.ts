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
    expect(html).not.toContain('data-todo-id');
    expect(html).not.toContain('data-todo-local-id');
    expect(html).not.toContain('card__drag-handle');
    expect(html).not.toContain('id="localId"');
    expect(html).not.toContain('data-status=');
    expect(html).toContain('Calendar may be out of date.');
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
});
