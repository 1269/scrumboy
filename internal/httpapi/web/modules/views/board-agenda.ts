import type { AgendaEvent, Board } from '../types.js';
import { escapeHTML } from '../utils.js';
import { t } from '../i18n/index.js';

export const AGENDA_COLUMN_KEY = 'agenda';

export function isAgendaEnabled(board: Board): boolean {
  return !!board.agenda?.enabled;
}

export function agendaEvents(board: Board): AgendaEvent[] {
  return board.agenda?.events ?? [];
}

export function renderAgendaEventCard(event: AgendaEvent, timezone: string): string {
  const timeLabel = formatAgendaEventTime(event, timezone);
  const calendar = event.calendarName ? escapeHTML(event.calendarName) : '';
  const location = event.location ? `<div class="muted">${escapeHTML(event.location)}</div>` : '';
  const meta = [timeLabel, calendar].filter(Boolean).join(' · ');
  return `
    <article class="card card--agenda" data-agenda-event-id="${escapeHTML(event.id)}">
      <div class="card__title">${escapeHTML(event.title || '')}</div>
      ${meta ? `<div class="muted card__agenda-meta">${escapeHTML(meta)}</div>` : ''}
      ${location}
    </article>
  `;
}

export function buildAgendaColumnHtml(board: Board, activeMobileTab: string | null | undefined): string {
  if (!isAgendaEnabled(board)) return '';
  const events = agendaEvents(board);
  const timezone = board.agenda?.timezone || 'UTC';
  const isMobileActive = activeMobileTab === AGENDA_COLUMN_KEY;
  const stale = board.agenda?.stale || !!board.agenda?.error;
  const status = board.agenda?.error
    ? `<div class="muted col__agenda-status">${escapeHTML(board.agenda.error)}</div>`
    : stale
      ? `<div class="muted col__agenda-status" data-i18n-text="board.agenda.stale">${escapeHTML(t('board.agenda.stale'))}</div>`
      : '';
  const body =
    events.length > 0
      ? events.map((event) => renderAgendaEventCard(event, timezone)).join('')
      : board.agenda?.error
        ? ''
        : `<div class="muted col__agenda-empty" data-i18n-text="board.agenda.empty">${escapeHTML(t('board.agenda.empty'))}</div>`;
  const title = escapeHTML(t('board.agenda.title'));
  return `
    <section class="col col--agenda${isMobileActive ? ' col--mobile-active' : ''}" data-column="${AGENDA_COLUMN_KEY}">
      <div class="col__head col__head--agenda">
        <span class="col__title" data-i18n-text="board.agenda.title">${title}</span>
        <span class="col__count" data-count-for="${AGENDA_COLUMN_KEY}">${events.length}</span>
      </div>
      ${status}
      <div class="col__list" id="list_${AGENDA_COLUMN_KEY}">
        ${body}
      </div>
    </section>
  `;
}

function formatAgendaEventTime(event: AgendaEvent, timezone: string): string {
  if (event.allDay) {
    return t('board.agenda.allDay');
  }
  const start = new Date(event.startsAt);
  if (Number.isNaN(start.getTime())) {
    return '';
  }
  try {
    return start.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || 'UTC',
    });
  } catch {
    return start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
}
