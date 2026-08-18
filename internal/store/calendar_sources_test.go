package store

import (
	"context"
	"errors"
	"strings"
	"testing"

	"scrumboy/internal/crypto"
)

func TestCalendarSourceEncryptDecryptAndUniqueness(t *testing.T) {
	st, cleanup := newTestStoreWith2FA(t)
	defer cleanup()

	ctx := context.Background()
	user, err := st.BootstrapUser(ctx, "calendar-src@example.com", "password123", "Owner")
	if err != nil {
		t.Fatalf("BootstrapUser: %v", err)
	}
	ownerCtx := WithUserID(ctx, user.ID)
	project, err := st.CreateProject(ownerCtx, "Calendar Sources")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	enc, err := st.EncryptSecret([]byte("https://calendar.example.com/private/token.ics"))
	if err != nil {
		t.Fatalf("EncryptSecret: %v", err)
	}
	if !strings.HasPrefix(enc, "v1:") {
		t.Fatalf("ciphertext prefix = %q, want v1:", enc)
	}
	plain, err := st.DecryptSecret(enc)
	if err != nil {
		t.Fatalf("DecryptSecret: %v", err)
	}
	if string(plain) != "https://calendar.example.com/private/token.ics" {
		t.Fatalf("roundtrip = %q", plain)
	}

	first, err := st.CreateCalendarSource(ownerCtx, project.ID, CreateCalendarSourceInput{
		Type:      CalendarSourceTypeICSFeed,
		Name:      "Family",
		Enabled:   true,
		SecretEnc: enc,
		URLHash:   "hash-family",
	})
	if err != nil {
		t.Fatalf("CreateCalendarSource: %v", err)
	}
	if first.Name != "Family" || first.Type != CalendarSourceTypeICSFeed || !first.Enabled {
		t.Fatalf("created = %+v", first)
	}

	_, err = st.CreateCalendarSource(ownerCtx, project.ID, CreateCalendarSourceInput{
		Name:      "Duplicate",
		Enabled:   true,
		SecretEnc: enc,
		URLHash:   "hash-family",
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate hash error = %v, want ErrConflict", err)
	}

	for i := 0; i < MaxCalendarSources-1; i++ {
		if _, err := st.CreateCalendarSource(ownerCtx, project.ID, CreateCalendarSourceInput{
			Name:      "Feed",
			Enabled:   true,
			SecretEnc: enc,
			URLHash:   "hash-" + strings.Repeat("x", i+1),
		}); err != nil {
			t.Fatalf("CreateCalendarSource extra %d: %v", i, err)
		}
	}
	count, err := st.CountCalendarSources(ownerCtx, project.ID)
	if err != nil {
		t.Fatalf("CountCalendarSources: %v", err)
	}
	if count != MaxCalendarSources {
		t.Fatalf("count = %d, want %d", count, MaxCalendarSources)
	}

	listed, err := st.ListCalendarSources(ownerCtx, project.ID)
	if err != nil {
		t.Fatalf("ListCalendarSources: %v", err)
	}
	if len(listed) != MaxCalendarSources {
		t.Fatalf("listed = %d, want %d", len(listed), MaxCalendarSources)
	}

	settings, err := st.UpdateProjectAgendaSettings(ownerCtx, project.ID, boolPtr(true), strPtr("America/New_York"))
	if err != nil {
		t.Fatalf("UpdateProjectAgendaSettings: %v", err)
	}
	if !settings.Enabled || settings.Timezone != "America/New_York" {
		t.Fatalf("settings = %+v", settings)
	}

	if err := st.DeleteCalendarSource(ownerCtx, project.ID, first.ID); err != nil {
		t.Fatalf("DeleteCalendarSource: %v", err)
	}
	if _, err := st.GetCalendarSource(ownerCtx, project.ID, first.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get after delete = %v, want ErrNotFound", err)
	}
}

func TestEncryptSecretWithoutKey(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()
	if _, err := st.EncryptSecret([]byte("https://example.com/feed.ics")); !errors.Is(err, ErrEncryptionNotConfigured) {
		t.Fatalf("EncryptSecret without key = %v, want ErrEncryptionNotConfigured", err)
	}
}

func TestCalendarSourceEncryptSecretUsesAESGCMFraming(t *testing.T) {
	st, cleanup := newTestStoreWith2FA(t)
	defer cleanup()
	enc, err := st.EncryptSecret([]byte("ics-url"))
	if err != nil {
		t.Fatalf("EncryptSecret: %v", err)
	}
	key, err := crypto.DecodeKey("YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=")
	if err != nil {
		t.Fatalf("DecodeKey: %v", err)
	}
	plain, err := crypto.DecryptSecret(key, enc)
	if err != nil {
		t.Fatalf("crypto.DecryptSecret: %v", err)
	}
	if string(plain) != "ics-url" {
		t.Fatalf("plain = %q", plain)
	}
}

func boolPtr(v bool) *bool    { return &v }
func strPtr(v string) *string { return &v }
