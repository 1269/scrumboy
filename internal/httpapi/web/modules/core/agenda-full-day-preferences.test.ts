// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setUser } from '../state/mutations.js';
import {
  AGENDA_FULL_DAY_OWNER_KEY,
  AGENDA_FULL_DAY_STORAGE_KEY,
  getAgendaFullDayPreference,
  getAgendaTimelineMode,
  hydrateAgendaFullDayFromServer,
  loadAgendaFullDayPreferenceFromServer,
  normalizeAgendaFullDay,
  onAgendaFullDayAuthUserChanged,
  saveAgendaFullDayPreference,
  setAgendaFullDayPreference,
} from './agenda-full-day-preferences.js';

beforeEach(() => {
  localStorage.clear();
  setUser(null);
  vi.unstubAllGlobals();
});

afterEach(() => {
  setUser(null);
  vi.unstubAllGlobals();
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('agenda full day preferences', () => {
  it('defaults to fit when no preference is stored', () => {
    expect(getAgendaFullDayPreference()).toBe(false);
    expect(getAgendaTimelineMode()).toBe('fit');
  });

  it('persists full day locally and maps to full_day', () => {
    setAgendaFullDayPreference(true);
    expect(localStorage.getItem(AGENDA_FULL_DAY_STORAGE_KEY)).toBe('true');
    expect(getAgendaFullDayPreference()).toBe(true);
    expect(getAgendaTimelineMode()).toBe('full_day');
  });

  it('normalizes full-day values', () => {
    expect(normalizeAgendaFullDay(true)).toBe(true);
    expect(normalizeAgendaFullDay('true')).toBe(true);
    expect(normalizeAgendaFullDay('1')).toBe(true);
    expect(normalizeAgendaFullDay('on')).toBe(true);
    expect(normalizeAgendaFullDay(false)).toBe(false);
    expect(normalizeAgendaFullDay('false')).toBe(false);
    expect(normalizeAgendaFullDay('unexpected')).toBe(false);
  });

  it('hydrates invalid server values back to fit', () => {
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(true);
    hydrateAgendaFullDayFromServer('unexpected');
    expect(getAgendaFullDayPreference()).toBe(false);
    expect(getAgendaTimelineMode()).toBe('fit');
  });

  it('loadAgendaFullDayPreferenceFromServer resets stale local true when server preference is missing', async () => {
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(true);
    await loadAgendaFullDayPreferenceFromServer(async () => ({ value: '' }));
    expect(getAgendaFullDayPreference()).toBe(false);
  });

  it('preserves the same user local full_day when hydration fetch fails', async () => {
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(true);
    await loadAgendaFullDayPreferenceFromServer(async () => {
      throw new Error('network');
    });
    expect(getAgendaFullDayPreference()).toBe(true);
    expect(getAgendaTimelineMode()).toBe('full_day');
  });

  it('loadAgendaFullDayPreferenceFromServer applies server true', async () => {
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(false);
    await loadAgendaFullDayPreferenceFromServer(async () => ({ value: 'true' }));
    expect(getAgendaFullDayPreference()).toBe(true);
    expect(getAgendaTimelineMode()).toBe('full_day');
  });

  it('saves the preference through the existing user preference endpoint when signed in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    setUser({ id: 1, name: 'Ada' });

    await saveAgendaFullDayPreference(true);

    expect(fetchMock).toHaveBeenCalledWith('/api/user/preferences', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ key: 'agendaFullDay', value: 'true' }),
    }));
    expect(getAgendaTimelineMode()).toBe('full_day');
  });

  it('restores the previous local value when remote save fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock);
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(false);

    await expect(saveAgendaFullDayPreference(true)).rejects.toThrow('network');
    expect(getAgendaTimelineMode()).toBe('fit');
  });

  it('does not remote-save when user is not signed in', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setUser(null);

    await saveAgendaFullDayPreference(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(AGENDA_FULL_DAY_STORAGE_KEY)).toBe('true');
  });

  it('does not leak user A full_day to user B', () => {
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(true);
    expect(getAgendaTimelineMode()).toBe('full_day');

    setUser({ id: 2, name: 'Bob' });
    expect(getAgendaTimelineMode()).toBe('fit');
    expect(localStorage.getItem(AGENDA_FULL_DAY_OWNER_KEY)).toBe('1');
  });

  it('clears cached full_day when auth identity changes', () => {
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(true);
    setUser({ id: 2, name: 'Bob' });
    onAgendaFullDayAuthUserChanged(2);
    expect(getAgendaTimelineMode()).toBe('fit');
    expect(localStorage.getItem(AGENDA_FULL_DAY_STORAGE_KEY)).toBe('false');
    expect(localStorage.getItem(AGENDA_FULL_DAY_OWNER_KEY)).toBe('2');
  });

  it('preserves same-user cached full_day when runtime auth starts empty', async () => {
    localStorage.setItem(AGENDA_FULL_DAY_STORAGE_KEY, 'true');
    localStorage.setItem(AGENDA_FULL_DAY_OWNER_KEY, '1');
    setUser({ id: 1, name: 'Ada' });
    onAgendaFullDayAuthUserChanged(1);
    await loadAgendaFullDayPreferenceFromServer(async () => {
      throw new Error('network');
    });
    expect(getAgendaTimelineMode()).toBe('full_day');
    expect(localStorage.getItem(AGENDA_FULL_DAY_STORAGE_KEY)).toBe('true');
    expect(localStorage.getItem(AGENDA_FULL_DAY_OWNER_KEY)).toBe('1');
  });

  it('resets to fit on logout so a previous owner cannot leak', () => {
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(true);
    setUser(null);
    onAgendaFullDayAuthUserChanged(null);
    expect(getAgendaTimelineMode()).toBe('fit');
    expect(localStorage.getItem(AGENDA_FULL_DAY_STORAGE_KEY)).toBe('false');
    expect(localStorage.getItem(AGENDA_FULL_DAY_OWNER_KEY)).toBeNull();
  });

  it('restores last confirmed fit when overlapping true and false saves both fail', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal('fetch', fetchMock);
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(false);

    const saveTrue = saveAgendaFullDayPreference(true);
    const saveFalse = saveAgendaFullDayPreference(false);
    first.reject(new Error('network'));
    second.reject(new Error('network'));
    await Promise.allSettled([saveTrue, saveFalse]);

    expect(getAgendaFullDayPreference()).toBe(false);
    expect(getAgendaTimelineMode()).toBe('fit');
  });

  it('keeps the newer successful false when an older true save later fails', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal('fetch', fetchMock);
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(false);

    const saveTrue = saveAgendaFullDayPreference(true);
    const saveFalse = saveAgendaFullDayPreference(false);
    second.resolve(new Response(null, { status: 204 }));
    await saveFalse;
    first.reject(new Error('network'));
    await expect(saveTrue).rejects.toThrow('network');

    expect(getAgendaFullDayPreference()).toBe(false);
    expect(getAgendaTimelineMode()).toBe('fit');
  });

  it('does not let an older failure roll back a newer successful save', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal('fetch', fetchMock);
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(true);

    const saveFalse = saveAgendaFullDayPreference(false);
    const saveTrue = saveAgendaFullDayPreference(true);
    second.resolve(new Response(null, { status: 204 }));
    await saveTrue;
    first.reject(new Error('network'));
    await expect(saveFalse).rejects.toThrow('network');

    expect(getAgendaFullDayPreference()).toBe(true);
    expect(getAgendaTimelineMode()).toBe('full_day');
  });

  it('does not let an in-flight stale hydrate overwrite a newly saved full_day', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(false);

    const hydrate = deferred<{ value: string }>();
    const hydration = loadAgendaFullDayPreferenceFromServer(() => hydrate.promise);
    await saveAgendaFullDayPreference(true);
    hydrate.resolve({ value: '' });
    await hydration;

    expect(getAgendaTimelineMode()).toBe('full_day');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not let user A in-flight save suppress or overwrite user B hydration', async () => {
    const save = deferred<Response>();
    const fetchMock = vi.fn().mockImplementation(() => save.promise);
    vi.stubGlobal('fetch', fetchMock);
    setUser({ id: 1, name: 'Ada' });
    setAgendaFullDayPreference(true);
    const saveA = saveAgendaFullDayPreference(false);

    setUser({ id: 2, name: 'Bob' });
    onAgendaFullDayAuthUserChanged(2);
    await loadAgendaFullDayPreferenceFromServer(async () => ({ value: 'true' }));
    expect(getAgendaTimelineMode()).toBe('full_day');
    expect(localStorage.getItem(AGENDA_FULL_DAY_OWNER_KEY)).toBe('2');

    save.resolve(new Response(null, { status: 204 }));
    await saveA;
    expect(getAgendaTimelineMode()).toBe('full_day');
    expect(getAgendaFullDayPreference()).toBe(true);
    expect(localStorage.getItem(AGENDA_FULL_DAY_OWNER_KEY)).toBe('2');
  });
});
