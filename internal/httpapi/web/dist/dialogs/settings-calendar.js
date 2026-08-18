import { apiFetch } from '../api.js';
import { getSlug } from '../state/selectors.js';
import { confirmDelete, escapeHTML, showToast } from '../utils.js';
import { apiErrorMessageOrRaw, t } from '../i18n/index.js';
let cachedCalendar = null;
export function clearCalendarSettingsCache() {
    cachedCalendar = null;
}
export async function loadCalendarTabContent() {
    const slug = getSlug();
    if (!slug) {
        return `<div class="muted" data-i18n-text="settings.calendar.error.noProject">Open a durable board to configure Agenda.</div>`;
    }
    try {
        cachedCalendar = await apiFetch(`/api/board/${slug}/calendar-sources`);
    }
    catch (err) {
        return `<div class="muted">${escapeHTML(apiErrorMessageOrRaw(err, { fallbackKey: 'settings.calendar.error.loadFailed' }))}</div>`;
    }
    return renderCalendarTabHTML(cachedCalendar);
}
function renderCalendarTabHTML(data) {
    const sources = data.sources ?? [];
    const listHTML = sources.length === 0
        ? `<div class="muted" data-i18n-text="settings.calendar.list.empty">No calendar feeds yet.</div>`
        : sources
            .map((source) => {
            return `
        <div class="settings-calendar-row" data-calendar-source-id="${source.id}">
          <div class="settings-calendar-row__info">
            <strong>${escapeHTML(source.name)}</strong>
            <span class="muted">${escapeHTML(source.urlPreview)}</span>
          </div>
          <label class="field" style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" data-calendar-source-enabled ${source.enabled ? 'checked' : ''} />
            <span data-i18n-text="settings.calendar.source.enabled">Enabled</span>
          </label>
          <button class="btn btn--sm" type="button" data-calendar-source-refresh data-i18n-text="settings.calendar.source.refresh">Refresh</button>
          <button class="btn btn--danger btn--sm" type="button" data-calendar-source-delete data-i18n-text="settings.calendar.source.remove">Remove</button>
        </div>`;
        })
            .join('');
    return `
    <div class="settings-section">
      <label class="field" style="display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" id="agendaEnabledToggle" ${data.agendaEnabled ? 'checked' : ''} />
        <span data-i18n-text="settings.calendar.enableToggle">Enable Agenda for this board</span>
      </label>
      <p class="muted" data-i18n-text="settings.calendar.enableHint">Today's events from ICS feeds appear in a read-only Agenda lane. All members see the same Agenda.</p>
    </div>
    <div class="settings-section">
      <label class="field">
        <span class="field__label" data-i18n-text="settings.calendar.timezone.label">Board timezone</span>
        <input class="input" id="agendaTimezoneInput" value="${escapeHTML(data.agendaTimezone || 'UTC')}" autocomplete="off" />
      </label>
      <p class="muted" data-i18n-text="settings.calendar.timezone.hint">IANA timezone used for “today”, for example America/New_York. Defaults to UTC.</p>
      <button class="btn btn--sm" type="button" id="agendaTimezoneSave" data-i18n-text="settings.calendar.timezone.save">Save timezone</button>
    </div>
    <div class="settings-section">
      <h3 data-i18n-text="settings.calendar.add.title">Add ICS feed</h3>
      <label class="field">
        <span class="field__label" data-i18n-text="settings.calendar.add.name">Name</span>
        <input class="input" id="calendarSourceNameInput" autocomplete="off" />
      </label>
      <label class="field">
        <span class="field__label" data-i18n-text="settings.calendar.add.url">ICS URL</span>
        <input class="input" id="calendarSourceUrlInput" type="url" autocomplete="off" />
      </label>
      <p class="muted" data-i18n-text="settings.calendar.add.urlHint">Paste an HTTPS iCalendar URL. The full URL is stored encrypted and is never shown again.</p>
      <button class="btn btn--sm" type="button" id="calendarSourceAdd" data-i18n-text="settings.calendar.add.submit">Add feed</button>
    </div>
    <div class="settings-section">
      <h3 data-i18n-text="settings.calendar.list.title">Feeds</h3>
      ${listHTML}
    </div>`;
}
export function bindCalendarTabInteractions(options) {
    const slug = getSlug();
    if (!slug)
        return;
    const { signal, rerender } = options;
    const enabledToggle = document.getElementById('agendaEnabledToggle');
    enabledToggle?.addEventListener('change', async () => {
        try {
            await apiFetch(`/api/board/${slug}/settings`, {
                method: 'PATCH',
                body: JSON.stringify({ agendaEnabled: enabledToggle.checked }),
            });
            showToast(t('settings.calendar.toast.enabledUpdated'));
            clearCalendarSettingsCache();
            await rerender();
        }
        catch (err) {
            enabledToggle.checked = !enabledToggle.checked;
            showToast(apiErrorMessageOrRaw(err, { fallbackKey: 'settings.calendar.toast.enabledFailed' }));
        }
    }, { signal });
    const timezoneSave = document.getElementById('agendaTimezoneSave');
    timezoneSave?.addEventListener('click', async () => {
        const input = document.getElementById('agendaTimezoneInput');
        const timezone = input?.value.trim() ?? '';
        try {
            await apiFetch(`/api/board/${slug}/settings`, {
                method: 'PATCH',
                body: JSON.stringify({ agendaTimezone: timezone }),
            });
            showToast(t('settings.calendar.toast.timezoneUpdated'));
            clearCalendarSettingsCache();
            await rerender();
        }
        catch (err) {
            showToast(apiErrorMessageOrRaw(err, { fallbackKey: 'settings.calendar.toast.timezoneFailed' }));
        }
    }, { signal });
    const addBtn = document.getElementById('calendarSourceAdd');
    addBtn?.addEventListener('click', async () => {
        const nameInput = document.getElementById('calendarSourceNameInput');
        const urlInput = document.getElementById('calendarSourceUrlInput');
        const name = nameInput?.value.trim() ?? '';
        const url = urlInput?.value.trim() ?? '';
        try {
            await apiFetch(`/api/board/${slug}/calendar-sources`, {
                method: 'POST',
                body: JSON.stringify({ name, url }),
            });
            if (urlInput)
                urlInput.value = '';
            if (nameInput)
                nameInput.value = '';
            showToast(t('settings.calendar.toast.added'));
            clearCalendarSettingsCache();
            await rerender();
        }
        catch (err) {
            showToast(apiErrorMessageOrRaw(err, { fallbackKey: 'settings.calendar.toast.addFailed' }));
        }
    }, { signal });
    document.querySelectorAll('[data-calendar-source-id]').forEach((row) => {
        const id = Number(row.getAttribute('data-calendar-source-id'));
        if (!Number.isFinite(id) || id <= 0)
            return;
        const enabled = row.querySelector('[data-calendar-source-enabled]');
        enabled?.addEventListener('change', async () => {
            try {
                await apiFetch(`/api/board/${slug}/calendar-sources/${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ enabled: enabled.checked }),
                });
                showToast(t('settings.calendar.toast.sourceUpdated'));
            }
            catch (err) {
                enabled.checked = !enabled.checked;
                showToast(apiErrorMessageOrRaw(err, { fallbackKey: 'settings.calendar.toast.sourceUpdateFailed' }));
            }
        }, { signal });
        const refreshBtn = row.querySelector('[data-calendar-source-refresh]');
        refreshBtn?.addEventListener('click', async () => {
            try {
                await apiFetch(`/api/board/${slug}/calendar-sources/${id}/refresh`, { method: 'POST' });
                showToast(t('settings.calendar.toast.refreshed'));
            }
            catch (err) {
                showToast(apiErrorMessageOrRaw(err, { fallbackKey: 'settings.calendar.toast.refreshFailed' }));
            }
        }, { signal });
        const removeBtn = row.querySelector('[data-calendar-source-delete]');
        removeBtn?.addEventListener('click', async () => {
            const name = row.querySelector('strong')?.textContent ?? '';
            const confirmed = await confirmDelete(t('settings.calendar.confirm.remove', { name }));
            if (!confirmed)
                return;
            try {
                await apiFetch(`/api/board/${slug}/calendar-sources/${id}`, { method: 'DELETE' });
                showToast(t('settings.calendar.toast.removed'));
                clearCalendarSettingsCache();
                await rerender();
            }
            catch (err) {
                showToast(apiErrorMessageOrRaw(err, { fallbackKey: 'settings.calendar.toast.removeFailed' }));
            }
        }, { signal });
    });
}
