package calendar

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"scrumboy/internal/store"
)

type calendarProjectFake struct {
	project store.Project
	err     error
}

func (f *calendarProjectFake) GetProject(context.Context, int64) (store.Project, error) {
	return f.project, f.err
}

type calendarRoleFake struct {
	role store.ProjectRole
	err  error
}

func (f *calendarRoleFake) GetProjectRole(context.Context, int64, int64) (store.ProjectRole, error) {
	return f.role, f.err
}

type calendarCipherFake struct {
	enc    string
	dec    []byte
	encErr error
	decErr error
}

func (f *calendarCipherFake) EncryptSecret([]byte) (string, error) {
	if f.encErr != nil {
		return "", f.encErr
	}
	if f.enc != "" {
		return f.enc, nil
	}
	return "v1:ciphertext", nil
}

func (f *calendarCipherFake) DecryptSecret(string) ([]byte, error) {
	if f.decErr != nil {
		return nil, f.decErr
	}
	if f.dec != nil {
		return f.dec, nil
	}
	return []byte("https://calendar.example.com/private/token.ics"), nil
}

type calendarSourceStoreFake struct {
	mu          sync.Mutex
	settings    store.ProjectAgendaSettings
	sources     []store.CalendarSource
	nextID      int64
	createErr   error
	updateErr   error
	createCalls int
}

func (f *calendarSourceStoreFake) GetProjectAgendaSettings(context.Context, int64) (store.ProjectAgendaSettings, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.settings.Timezone == "" {
		return store.ProjectAgendaSettings{Timezone: "UTC"}, nil
	}
	return f.settings, nil
}

func (f *calendarSourceStoreFake) UpdateProjectAgendaSettings(_ context.Context, _ int64, enabled *bool, timezone *string) (store.ProjectAgendaSettings, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if enabled != nil {
		f.settings.Enabled = *enabled
	}
	if timezone != nil {
		f.settings.Timezone = *timezone
	}
	if f.settings.Timezone == "" {
		f.settings.Timezone = "UTC"
	}
	return f.settings, nil
}

func (f *calendarSourceStoreFake) ListCalendarSources(context.Context, int64) ([]store.CalendarSource, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]store.CalendarSource(nil), f.sources...), nil
}

func (f *calendarSourceStoreFake) CountCalendarSources(context.Context, int64) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.sources), nil
}

func (f *calendarSourceStoreFake) GetCalendarSource(_ context.Context, _ int64, sourceID int64) (store.CalendarSource, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, src := range f.sources {
		if src.ID == sourceID {
			return src, nil
		}
	}
	return store.CalendarSource{}, store.ErrNotFound
}

func (f *calendarSourceStoreFake) CreateCalendarSource(_ context.Context, projectID int64, in store.CreateCalendarSourceInput) (store.CalendarSource, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.createCalls++
	if f.createErr != nil {
		return store.CalendarSource{}, f.createErr
	}
	f.nextID++
	src := store.CalendarSource{
		ID:        f.nextID,
		ProjectID: projectID,
		Type:      in.Type,
		Name:      in.Name,
		Enabled:   in.Enabled,
		SecretEnc: in.SecretEnc,
		URLHash:   in.URLHash,
	}
	f.sources = append(f.sources, src)
	return src, nil
}

func (f *calendarSourceStoreFake) UpdateCalendarSource(_ context.Context, projectID int64, sourceID int64, in store.UpdateCalendarSourceInput) (store.CalendarSource, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.updateErr != nil {
		return store.CalendarSource{}, f.updateErr
	}
	for i, src := range f.sources {
		if src.ID != sourceID || src.ProjectID != projectID {
			continue
		}
		if in.Name != nil {
			src.Name = *in.Name
		}
		if in.Enabled != nil {
			src.Enabled = *in.Enabled
		}
		if in.SecretEnc != nil {
			src.SecretEnc = *in.SecretEnc
		}
		if in.URLHash != nil {
			src.URLHash = *in.URLHash
		}
		f.sources[i] = src
		return src, nil
	}
	return store.CalendarSource{}, store.ErrNotFound
}

func (f *calendarSourceStoreFake) DeleteCalendarSource(_ context.Context, _ int64, sourceID int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, src := range f.sources {
		if src.ID == sourceID {
			f.sources = append(f.sources[:i], f.sources[i+1:]...)
			return nil
		}
	}
	return store.ErrNotFound
}

type calendarRefreshFake struct {
	mu         sync.Mutex
	calls      int
	lastReason string
}

func (f *calendarRefreshFake) PublishBoardRefresh(_ context.Context, _ int64, reason string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.lastReason = reason
}

func (f *calendarRefreshFake) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func preparedCalendar(t *testing.T, deps RESTServiceDependencies) *PreparedREST {
	t.Helper()
	ctx := store.WithUserID(context.Background(), 1)
	prepared, err := NewRESTService(deps).Prepare(ctx, ResolvedRESTTarget{ProjectID: 9})
	if err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	return prepared
}

func TestCanonicalCalendarURLRejectsUserinfoAndNonHTTPS(t *testing.T) {
	if _, err := canonicalCalendarURL("https://user:pass@example.com/feed.ics"); err == nil {
		t.Fatal("expected userinfo rejection")
	}
	if _, err := canonicalCalendarURL("http://example.com/feed.ics"); err == nil {
		t.Fatal("expected non-loopback http rejection")
	}
	got, err := canonicalCalendarURL("http://127.0.0.1/feed.ics")
	if err != nil {
		t.Fatalf("loopback http: %v", err)
	}
	if !strings.HasPrefix(got, "http://127.0.0.1") {
		t.Fatalf("canonical = %q", got)
	}
}

func TestURLPreviewOmitsPathAndToken(t *testing.T) {
	preview := urlPreview("https://calendar.example.com/private/token.ics")
	if preview != "https://calendar.example.com/…" {
		t.Fatalf("preview = %q", preview)
	}
	if strings.Contains(preview, "token") {
		t.Fatal("preview leaked path token")
	}
}

func TestPrepareRejectsTemporaryBoard(t *testing.T) {
	expires := time.Now().UTC().Add(time.Hour)
	_, err := NewRESTService(RESTServiceDependencies{
		Projects: &calendarProjectFake{project: store.Project{ID: 9, ExpiresAt: &expires}},
		Roles:    &calendarRoleFake{role: store.RoleMaintainer},
		Cipher:   &calendarCipherFake{},
		Sources:  &calendarSourceStoreFake{},
	}).Prepare(store.WithUserID(context.Background(), 1), ResolvedRESTTarget{ProjectID: 9})
	if !errors.Is(err, ErrDurableRequired) {
		t.Fatalf("Prepare = %v, want ErrDurableRequired", err)
	}
}

func TestCreateRejectsMissingEncryptionKey(t *testing.T) {
	sources := &calendarSourceStoreFake{}
	prepared := preparedCalendar(t, RESTServiceDependencies{
		Projects: &calendarProjectFake{project: store.Project{ID: 9}},
		Roles:    &calendarRoleFake{role: store.RoleMaintainer},
		Cipher:   &calendarCipherFake{encErr: store.ErrEncryptionNotConfigured},
		Sources:  sources,
	})
	_, err := prepared.Create(CreateSourceCommand{
		Name: "Family",
		URL:  "https://calendar.example.com/private/token.ics",
	})
	if !errors.Is(err, store.ErrEncryptionNotConfigured) {
		t.Fatalf("Create = %v, want ErrEncryptionNotConfigured", err)
	}
	if sources.createCalls != 0 {
		t.Fatalf("create calls = %d, want 0", sources.createCalls)
	}
}

func TestCreateEnforcesSourceCapAndRedactsPreview(t *testing.T) {
	existing := make([]store.CalendarSource, maxSources)
	for i := range existing {
		existing[i] = store.CalendarSource{ID: int64(i + 1), Name: "Feed", SecretEnc: "v1:x"}
	}
	prepared := preparedCalendar(t, RESTServiceDependencies{
		Projects: &calendarProjectFake{project: store.Project{ID: 9}},
		Roles:    &calendarRoleFake{role: store.RoleMaintainer},
		Cipher:   &calendarCipherFake{},
		Sources:  &calendarSourceStoreFake{sources: existing},
	})
	_, err := prepared.Create(CreateSourceCommand{Name: "Overflow", URL: "https://calendar.example.com/other.ics"})
	if !errors.Is(err, store.ErrValidation) || !strings.Contains(err.Error(), "calendar source limit reached") {
		t.Fatalf("cap error = %v", err)
	}

	refresh := &calendarRefreshFake{}
	created, err := preparedCalendar(t, RESTServiceDependencies{
		Projects: &calendarProjectFake{project: store.Project{ID: 9}},
		Roles:    &calendarRoleFake{role: store.RoleMaintainer},
		Cipher:   &calendarCipherFake{},
		Sources:  &calendarSourceStoreFake{},
		Refresh:  refresh,
	}).Create(CreateSourceCommand{Name: "Family", URL: "https://calendar.example.com/private/token.ics"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.URLPreview != "https://calendar.example.com/…" {
		t.Fatalf("preview = %q", created.URLPreview)
	}
	if strings.Contains(created.URLPreview, "token") {
		t.Fatal("create preview leaked token")
	}
	if refresh.calls != 1 {
		t.Fatalf("refresh calls = %d, want 1", refresh.calls)
	}
}

func TestPatchSettingsValidatesTimezone(t *testing.T) {
	prepared := preparedCalendar(t, RESTServiceDependencies{
		Projects: &calendarProjectFake{project: store.Project{ID: 9}},
		Roles:    &calendarRoleFake{role: store.RoleMaintainer},
		Cipher:   &calendarCipherFake{},
		Sources:  &calendarSourceStoreFake{},
	})
	bad := "Not/A_Zone"
	_, err := prepared.PatchSettings(PatchSettingsCommand{Timezone: &bad})
	if !errors.Is(err, store.ErrValidation) {
		t.Fatalf("PatchSettings = %v, want ErrValidation", err)
	}
	good := "America/New_York"
	view, err := prepared.PatchSettings(PatchSettingsCommand{Timezone: &good})
	if err != nil {
		t.Fatalf("PatchSettings valid: %v", err)
	}
	if view.Timezone != "America/New_York" {
		t.Fatalf("timezone = %q", view.Timezone)
	}
}
