package llms

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestAIProviderManagerRetriesRegisteredPolicy(t *testing.T) {
	manager := newAIProviderManager()
	manager.RegisterRetryPolicy("test-provider", providerRetryPolicy{
		MaxRetries:   2,
		InitialDelay: time.Nanosecond,
		MaxDelay:     time.Nanosecond,
		ShouldRetry: func(err error, emitted bool) providerRetryDecision {
			if err == nil || emitted {
				return providerRetryDecision{}
			}
			return providerRetryDecision{Retry: true, Reason: "test transient"}
		},
	})

	attempts := 0
	var traces []string
	result := manager.ExecuteWithRetry(
		context.Background(),
		"test-provider",
		func(attempt int) providerAttemptResult {
			attempts++
			if attempt < 3 {
				return providerAttemptResult{
					Raw: "failed attempt",
					Err: errors.New("temporary failure"),
				}
			}
			return providerAttemptResult{Raw: "ok"}
		},
		func(title string, text string) error {
			traces = append(traces, title+": "+text)
			return nil
		},
	)

	if result.Err != nil {
		t.Fatalf("expected retry to recover, got %v", result.Err)
	}
	if attempts != 3 {
		t.Fatalf("expected three attempts, got %d", attempts)
	}
	if len(traces) != 2 {
		t.Fatalf("expected two retry traces, got %+v", traces)
	}
	if !strings.Contains(result.Raw, "attempt=1") || !strings.Contains(result.Raw, "attempt=3") {
		t.Fatalf("expected raw attempts to be aggregated, got %q", result.Raw)
	}
}

func TestAIProviderManagerStopsWhenRetryPolicyRejectsEmittedOutput(t *testing.T) {
	manager := newAIProviderManager()
	manager.RegisterRetryPolicy("test-provider", providerRetryPolicy{
		MaxRetries:   2,
		InitialDelay: time.Nanosecond,
		MaxDelay:     time.Nanosecond,
		ShouldRetry: func(err error, emitted bool) providerRetryDecision {
			if err == nil || emitted {
				return providerRetryDecision{}
			}
			return providerRetryDecision{Retry: true}
		},
	})

	attempts := 0
	result := manager.ExecuteWithRetry(
		context.Background(),
		"test-provider",
		func(int) providerAttemptResult {
			attempts++
			return providerAttemptResult{
				Raw:     "partial output",
				Err:     errors.New("stream failed after output"),
				Emitted: true,
			}
		},
		nil,
	)

	if result.Err == nil {
		t.Fatal("expected emitted stream error to be returned")
	}
	if attempts != 1 {
		t.Fatalf("expected no retry after emitted output, got %d attempts", attempts)
	}
}

func TestAIProviderManagerMinimaxPolicyRetriesUnknown999(t *testing.T) {
	manager := newAIProviderManager()
	policy := manager.retryPolicy("minimax")
	policy.InitialDelay = time.Nanosecond
	policy.MaxDelay = time.Nanosecond
	manager.RegisterRetryPolicy("minimax", policy)

	attempts := 0
	result := manager.ExecuteWithRetry(
		context.Background(),
		"minimax",
		func(attempt int) providerAttemptResult {
			attempts++
			if attempt == 1 {
				return providerAttemptResult{
					Raw: "unknown error body",
					Err: errors.New("minimax api error: type=api_error message=unknown error, 999 (1000)"),
				}
			}
			return providerAttemptResult{Raw: "ok"}
		},
		nil,
	)

	if result.Err != nil {
		t.Fatalf("expected minimax transient error to recover, got %v", result.Err)
	}
	if attempts != 2 {
		t.Fatalf("expected minimax policy to retry once, got %d attempts", attempts)
	}
}
