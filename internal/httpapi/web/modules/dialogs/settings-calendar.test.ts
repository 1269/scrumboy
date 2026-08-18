// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enCatalog from '../i18n/locales/en.json';

const selectorState: { slug: string | null } = { slug: 'alpha' };
const apiFetchMock = vi.fn();
const intlWithSupportedValues = Intl as typeof Intl & {
  supportedValuesOf?: (key: string) => string[];
};
const originalSupportedValuesOf = intlWithSupportedValues.supportedValuesOf;

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

const calendarPayload = {
  agendaEnabled: true,
  agendaTimezone: 'UTC',
  agendaTitle: 'Agenda',
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
};

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('settings calendar tab', () => {
  beforeEach(async () => {
    selectorState.slug = 'alpha';
    apiFetchMock.mockReset();
    const i18n = await import('../i18n/index.js');
    await i18n.initI18n({ locale: 'en', loadLocale: vi.fn(async () => enCatalog) });
    const { clearCalendarSettingsCache } = await import('./settings-calendar.js');
    clearCalendarSettingsCache();
    const { showToast } = await import('../utils.js');
    vi.mocked(showToast).mockClear();
  });

  afterEach(async () => {
    const i18n = await import('../i18n/index.js');
    i18n.resetI18nForTests();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    if (originalSupportedValuesOf) {
      intlWithSupportedValues.supportedValuesOf = originalSupportedValuesOf;
    } else {
      delete intlWithSupportedValues.supportedValuesOf;
    }
  });

  it('renders redacted previews and never interpolates the raw ICS URL', async () => {
    apiFetchMock.mockResolvedValue(calendarPayload);
    const { loadCalendarTabContent } = await import('./settings-calendar.js');
    const html = await loadCalendarTabContent();
    expect(html).toContain('https://calendar.example.com/…');
    expect(html).toContain('Family');
    expect(html).not.toContain('super-secret-token');
    expect(html).toContain('id="agendaEnabledToggle"');
    expect(html).toContain('id="agendaTitleInput"');
    expect(html).toContain('for="agendaTitleInput"');
    expect(html).toContain('id="agendaTimezoneInput"');
    expect(html).toContain('<select class="input" id="agendaTimezoneInput">');
    expect(html).toContain('for="agendaTimezoneInput"');
    expect(html).not.toContain('id="agendaTimezoneSave"');
    expect(html).toContain('data-calendar-source-refresh');
  });

  it('shows the failure toast when manual refresh fails', async () => {
    apiFetchMock.mockResolvedValue(calendarPayload);
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
    await flushMicrotasks();
    expect(showToast).toHaveBeenCalled();
    const messages = vi.mocked(showToast).mock.calls.map((call) => call[0]);
    expect(messages).not.toContain(enCatalog['settings.calendar.toast.refreshed']);
    expect(messages.some((msg) => String(msg).includes('calendar feed request failed') || msg === enCatalog['settings.calendar.toast.refreshFailed'])).toBe(true);
  });

  it('populates timezone options from Intl.supportedValuesOf and selects the saved timezone', async () => {
    intlWithSupportedValues.supportedValuesOf = (key: string) => {
      expect(key).toBe('timeZone');
      return ['Pacific/Auckland', 'America/New_York', 'UTC'];
    };
    apiFetchMock.mockResolvedValue({ ...calendarPayload, agendaTimezone: 'America/New_York' });
    const { loadCalendarTabContent } = await import('./settings-calendar.js');
    const html = await loadCalendarTabContent();
    document.body.innerHTML = html;
    const select = document.getElementById('agendaTimezoneInput') as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toEqual([...new Set(values)].sort((a, b) => a.localeCompare(b)));
    expect(values).toEqual(expect.arrayContaining(['America/New_York', 'Pacific/Auckland', 'UTC']));
    expect(select.value).toBe('America/New_York');
  });

  it('still includes the browser timezone when it is absent from supportedValuesOf', async () => {
    intlWithSupportedValues.supportedValuesOf = () => ['Pacific/Auckland', 'UTC'];
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-US',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Europe/Berlin',
    } as Intl.ResolvedDateTimeFormatOptions);

    const { listAgendaTimezones } = await import('./settings-calendar.js');
    const zones = listAgendaTimezones('UTC');
    expect(zones).toEqual(['Europe/Berlin', 'Pacific/Auckland', 'UTC']);
  });

  it('falls back to UTC, saved timezone, and browser timezone when supportedValuesOf is unavailable', async () => {
    delete intlWithSupportedValues.supportedValuesOf;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-US',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Europe/Berlin',
    } as Intl.ResolvedDateTimeFormatOptions);

    const { listAgendaTimezones } = await import('./settings-calendar.js');
    const zones = listAgendaTimezones('America/Chicago');
    expect(zones).toEqual(['America/Chicago', 'Europe/Berlin', 'UTC']);
    expect(new Set(zones).size).toBe(zones.length);

    apiFetchMock.mockResolvedValue({ ...calendarPayload, agendaTimezone: 'America/Chicago' });
    const { loadCalendarTabContent } = await import('./settings-calendar.js');
    const html = await loadCalendarTabContent();
    document.body.innerHTML = html;
    const select = document.getElementById('agendaTimezoneInput') as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toEqual(expect.arrayContaining(['UTC', 'America/Chicago', 'Europe/Berlin']));
    expect(select.value).toBe('America/Chicago');
  });

  it('treats an empty saved timezone as UTC', async () => {
    const { resolveAgendaTimezone, listAgendaTimezones } = await import('./settings-calendar.js');
    expect(resolveAgendaTimezone('')).toBe('UTC');
    expect(resolveAgendaTimezone('   ')).toBe('UTC');
    expect(listAgendaTimezones('')).toContain('UTC');
  });

  it('saves the selected timezone on change', async () => {
    intlWithSupportedValues.supportedValuesOf = () => ['America/New_York', 'UTC'];
    apiFetchMock.mockResolvedValue(calendarPayload);
    const { loadCalendarTabContent, bindCalendarTabInteractions } = await import('./settings-calendar.js');
    document.body.innerHTML = await loadCalendarTabContent();
    const { showToast } = await import('../utils.js');
    const rerender = vi.fn(async () => {
      document.body.innerHTML = await loadCalendarTabContent();
    });
    bindCalendarTabInteractions({ signal: new AbortController().signal, rerender });

    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValueOnce({});
    apiFetchMock.mockResolvedValueOnce({
      ...calendarPayload,
      agendaTimezone: 'America/New_York',
    });

    const select = document.getElementById('agendaTimezoneInput') as HTMLSelectElement;
    select.value = 'America/New_York';
    select.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    await flushMicrotasks();

    expect(apiFetchMock).toHaveBeenCalledWith('/api/board/alpha/settings', {
      method: 'PATCH',
      body: JSON.stringify({ agendaTimezone: 'America/New_York' }),
    });
    expect(showToast).toHaveBeenCalledWith(enCatalog['settings.calendar.toast.timezoneUpdated']);
    expect(rerender).toHaveBeenCalledTimes(1);
    const saved = document.getElementById('agendaTimezoneInput') as HTMLSelectElement;
    expect(saved.value).toBe('America/New_York');
  });

  it('restores the persisted timezone when the timezone PATCH fails', async () => {
    intlWithSupportedValues.supportedValuesOf = () => ['America/New_York', 'UTC'];
    apiFetchMock.mockResolvedValue(calendarPayload);
    const { loadCalendarTabContent, bindCalendarTabInteractions } = await import('./settings-calendar.js');
    document.body.innerHTML = await loadCalendarTabContent();
    const { showToast } = await import('../utils.js');
    const rerender = vi.fn(async () => {
      document.body.innerHTML = await loadCalendarTabContent();
    });
    bindCalendarTabInteractions({ signal: new AbortController().signal, rerender });

    const err = Object.assign(new Error('invalid agenda timezone'), {
      status: 400,
      data: { error: { code: 'BAD_REQUEST', message: 'invalid agenda timezone' } },
    });
    apiFetchMock.mockReset();
    apiFetchMock.mockRejectedValueOnce(err);
    apiFetchMock.mockResolvedValue(calendarPayload);

    const select = document.getElementById('agendaTimezoneInput') as HTMLSelectElement;
    select.value = 'America/New_York';
    select.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    await flushMicrotasks();

    expect(showToast).toHaveBeenCalled();
    const messages = vi.mocked(showToast).mock.calls.map((call) => call[0]);
    expect(messages).not.toContain(enCatalog['settings.calendar.toast.timezoneUpdated']);
    expect(
      messages.some(
        (msg) =>
          String(msg).includes('invalid agenda timezone') ||
          msg === enCatalog['settings.calendar.toast.timezoneFailed'],
      ),
    ).toBe(true);
    expect(rerender).toHaveBeenCalledTimes(1);
    const restored = document.getElementById('agendaTimezoneInput') as HTMLSelectElement;
    expect(restored.value).toBe('UTC');
  });

  it('saves the lane name on blur', async () => {
    apiFetchMock.mockResolvedValue(calendarPayload);
    const { loadCalendarTabContent, bindCalendarTabInteractions } = await import('./settings-calendar.js');
    document.body.innerHTML = await loadCalendarTabContent();
    const { showToast } = await import('../utils.js');
    const rerender = vi.fn(async () => {
      document.body.innerHTML = await loadCalendarTabContent();
    });
    bindCalendarTabInteractions({ signal: new AbortController().signal, rerender });

    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValueOnce({});
    apiFetchMock.mockResolvedValueOnce({
      ...calendarPayload,
      agendaTitle: 'Team calendar',
    });

    const input = document.getElementById('agendaTitleInput') as HTMLInputElement;
    input.value = 'Team calendar';
    input.dispatchEvent(new Event('blur'));
    await flushMicrotasks();
    await flushMicrotasks();

    expect(apiFetchMock).toHaveBeenCalledWith('/api/board/alpha/settings', {
      method: 'PATCH',
      body: JSON.stringify({ agendaTitle: 'Team calendar' }),
    });
    expect(showToast).toHaveBeenCalledWith(enCatalog['settings.calendar.toast.titleUpdated']);
    expect(rerender).toHaveBeenCalledTimes(1);
  });

  it('does not PATCH an empty lane name', async () => {
    apiFetchMock.mockResolvedValue(calendarPayload);
    const { loadCalendarTabContent, bindCalendarTabInteractions } = await import('./settings-calendar.js');
    document.body.innerHTML = await loadCalendarTabContent();
    const { showToast } = await import('../utils.js');
    const rerender = vi.fn(async () => {
      document.body.innerHTML = await loadCalendarTabContent();
    });
    bindCalendarTabInteractions({ signal: new AbortController().signal, rerender });
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue(calendarPayload);

    const input = document.getElementById('agendaTitleInput') as HTMLInputElement;
    input.value = '   ';
    input.dispatchEvent(new Event('blur'));
    await flushMicrotasks();
    await flushMicrotasks();

    expect(apiFetchMock).not.toHaveBeenCalledWith(
      '/api/board/alpha/settings',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ agendaTitle: '' }) }),
    );
    expect(showToast).toHaveBeenCalledWith(enCatalog['settings.calendar.toast.titleRequired']);
    expect(rerender).toHaveBeenCalledTimes(1);
  });
});
