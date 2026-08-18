// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enCatalog from '../i18n/locales/en.json';

const selectorState: { slug: string | null } = { slug: 'alpha' };
const apiFetchMock = vi.fn();

vi.mock('../api.js', () => ({ apiFetch: apiFetchMock }));
vi.mock('../state/selectors.js', () => ({ getSlug: () => selectorState.slug }));
vi.mock('../utils.js', () => ({
  escapeHTML: (s: string) =>
    String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;'),
  confirmDelete: vi.fn(),
  showToast: vi.fn(),
}));

describe('settings calendar tab', () => {
  beforeEach(async () => {
    selectorState.slug = 'alpha';
    apiFetchMock.mockReset();
    const i18n = await import('../i18n/index.js');
    await i18n.initI18n({ locale: 'en', loadLocale: vi.fn(async () => enCatalog) });
  });

  afterEach(async () => {
    const i18n = await import('../i18n/index.js');
    i18n.resetI18nForTests();
    document.body.innerHTML = '';
  });

  it('renders redacted previews and never interpolates the raw ICS URL', async () => {
    apiFetchMock.mockResolvedValue({
      agendaEnabled: true,
      agendaTimezone: 'UTC',
      sources: [
        {
          id: 3,
          name: 'Family',
          type: 'ics_feed',
          enabled: true,
          urlConfigured: true,
          urlPreview: 'https://calendar.example.com/…',
        },
      ],
    });
    const { loadCalendarTabContent } = await import('./settings-calendar.js');
    const html = await loadCalendarTabContent();
    expect(html).toContain('https://calendar.example.com/…');
    expect(html).toContain('Family');
    expect(html).not.toContain('super-secret-token');
    expect(html).toContain('id="agendaEnabledToggle"');
    expect(html).toContain('id="agendaTimezoneInput"');
    expect(html).toContain('data-calendar-source-refresh');
  });

  it('shows the failure toast when manual refresh fails', async () => {
    apiFetchMock.mockResolvedValue({
      agendaEnabled: true,
      agendaTimezone: 'UTC',
      sources: [
        {
          id: 3,
          name: 'Family',
          type: 'ics_feed',
          enabled: true,
          urlConfigured: true,
          urlPreview: 'https://calendar.example.com/…',
        },
      ],
    });
    const { loadCalendarTabContent, bindCalendarTabInteractions } = await import('./settings-calendar.js');
    const html = await loadCalendarTabContent();
    document.body.innerHTML = html;
    const { showToast } = await import('../utils.js');
    apiFetchMock.mockReset();
    const err = Object.assign(new Error('calendar feed request failed'), {
      status: 502,
      data: { error: { code: 'BAD_GATEWAY', message: 'calendar feed request failed' } },
    });
    apiFetchMock.mockRejectedValueOnce(err);
    bindCalendarTabInteractions({ signal: new AbortController().signal, rerender: async () => {} });
    document.querySelector<HTMLButtonElement>('[data-calendar-source-refresh]')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(showToast).toHaveBeenCalled();
    const messages = vi.mocked(showToast).mock.calls.map((call) => call[0]);
    expect(messages).not.toContain(enCatalog['settings.calendar.toast.refreshed']);
    expect(messages.some((msg) => String(msg).includes('calendar feed request failed') || msg === enCatalog['settings.calendar.toast.refreshFailed'])).toBe(true);
  });
});
