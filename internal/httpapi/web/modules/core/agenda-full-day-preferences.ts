import { apiFetch } from '../api.js';
import { getUser } from '../state/selectors.js';

export const AGENDA_FULL_DAY_DEFAULT = false;
export const AGENDA_FULL_DAY_STORAGE_KEY = 'scrumboy.agendaFullDay';
export const AGENDA_FULL_DAY_OWNER_KEY = 'scrumboy.agendaFullDay.userId';
export const AGENDA_FULL_DAY_PREFERENCE_KEY = 'agendaFullDay';

export type AgendaTimelineMode = 'full_day' | 'fit';

let saveEpoch = 0;
let ownerGeneration = 0;
let inFlightSaves = 0;
let lastSuccessEpoch = 0;
let lastConfirmed = AGENDA_FULL_DAY_DEFAULT;

export function normalizeAgendaFullDay(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

function readStoredOwnerId(): number | null {
  try {
    const raw = localStorage.getItem(AGENDA_FULL_DAY_OWNER_KEY);
    if (!raw) return null;
    const id = Number.parseInt(raw, 10);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

function writeLocalPreference(enabled: boolean, ownerUserId: number | null): void {
  const serialized = String(normalizeAgendaFullDay(enabled));
  try {
    localStorage.setItem(AGENDA_FULL_DAY_STORAGE_KEY, serialized);
    if (ownerUserId == null) {
      localStorage.removeItem(AGENDA_FULL_DAY_OWNER_KEY);
    } else {
      localStorage.setItem(AGENDA_FULL_DAY_OWNER_KEY, String(ownerUserId));
    }
  } catch {
  }
}

export function getAgendaFullDayPreference(): boolean {
  try {
    const user = getUser();
    const ownerId = readStoredOwnerId();
    if (user && ownerId !== user.id) {
      return AGENDA_FULL_DAY_DEFAULT;
    }
    return normalizeAgendaFullDay(localStorage.getItem(AGENDA_FULL_DAY_STORAGE_KEY));
  } catch {
    return AGENDA_FULL_DAY_DEFAULT;
  }
}

export function getAgendaTimelineMode(): AgendaTimelineMode {
  return getAgendaFullDayPreference() ? 'full_day' : 'fit';
}

/** Local-only write. Remote persistence goes through saveAgendaFullDayPreference. */
export function setAgendaFullDayPreference(enabled: boolean): void {
  const next = normalizeAgendaFullDay(enabled);
  writeLocalPreference(next, getUser()?.id ?? null);
  if (inFlightSaves === 0) {
    lastConfirmed = next;
  }
}

export async function saveAgendaFullDayPreference(enabled: boolean): Promise<void> {
  const next = normalizeAgendaFullDay(enabled);
  const user = getUser();
  const userId = user?.id ?? null;
  if (inFlightSaves === 0) {
    lastConfirmed = getAgendaFullDayPreference();
  }
  const epoch = ++saveEpoch;
  const generation = ownerGeneration;
  writeLocalPreference(next, userId);
  if (!user) {
    lastConfirmed = next;
    return;
  }
  inFlightSaves += 1;
  try {
    await apiFetch('/api/user/preferences', {
      method: 'PUT',
      body: JSON.stringify({ key: AGENDA_FULL_DAY_PREFERENCE_KEY, value: String(next) }),
    });
    if (generation !== ownerGeneration || getUser()?.id !== userId) {
      return;
    }
    if (epoch >= lastSuccessEpoch) {
      lastSuccessEpoch = epoch;
      lastConfirmed = next;
    }
  } finally {
    if (generation === ownerGeneration) {
      inFlightSaves -= 1;
      if (inFlightSaves === 0 && getUser()?.id === userId) {
        writeLocalPreference(lastConfirmed, userId);
      }
    }
  }
}

export function hydrateAgendaFullDayFromServer(value: unknown): void {
  const next = normalizeAgendaFullDay(value);
  writeLocalPreference(next, getUser()?.id ?? null);
  if (inFlightSaves === 0) {
    lastConfirmed = next;
  }
}

export async function loadAgendaFullDayPreferenceFromServer(
  fetchPreference: () => Promise<{ value?: string } | null | undefined>,
): Promise<void> {
  const user = getUser();
  if (!user) return;
  const userId = user.id;
  const epochAtStart = saveEpoch;
  try {
    const response = await fetchPreference();
    if (getUser()?.id !== userId) return;
    if (inFlightSaves > 0 || saveEpoch !== epochAtStart) return;
    hydrateAgendaFullDayFromServer(response?.value ?? false);
  } catch {
    // Keep this user's existing local preference on transient GET failure.
  }
}

/**
 * Reconcile the local cache with the authenticated identity.
 * Uses the persisted owner ID so a cold reload (runtime user starts empty)
 * does not wipe the same user's cached preference.
 */
export function onAgendaFullDayAuthUserChanged(userId: number | null): void {
  const storedOwner = readStoredOwnerId();
  if (userId != null && storedOwner === userId) {
    lastConfirmed = getAgendaFullDayPreference();
    return;
  }
  ownerGeneration += 1;
  saveEpoch += 1;
  inFlightSaves = 0;
  lastSuccessEpoch = 0;
  lastConfirmed = AGENDA_FULL_DAY_DEFAULT;
  writeLocalPreference(AGENDA_FULL_DAY_DEFAULT, userId);
}
