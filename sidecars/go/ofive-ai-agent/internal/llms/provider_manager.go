package llms

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

type providerRetryDecision struct {
	Retry  bool
	Reason string
}

type providerRetryPolicy struct {
	MaxRetries    int
	InitialDelay  time.Duration
	MaxDelay      time.Duration
	ShouldRetry   func(error, bool) providerRetryDecision
	FormatAttempt func(int, string) string
}

type providerAttemptResult struct {
	Raw     string
	Err     error
	Emitted bool
}

type aiProviderManager struct {
	mu       sync.RWMutex
	policies map[string]providerRetryPolicy
}

var defaultAIProviderManager = newAIProviderManager()

func newAIProviderManager() *aiProviderManager {
	manager := &aiProviderManager{
		policies: make(map[string]providerRetryPolicy),
	}
	manager.RegisterRetryPolicy("minimax", providerRetryPolicy{
		MaxRetries:   2,
		InitialDelay: 200 * time.Millisecond,
		MaxDelay:     800 * time.Millisecond,
		ShouldRetry: func(err error, emitted bool) providerRetryDecision {
			if err == nil || emitted {
				return providerRetryDecision{}
			}
			message := strings.ToLower(err.Error())
			if strings.Contains(message, "type=api_error") &&
				strings.Contains(message, "unknown error") &&
				(strings.Contains(message, "999") || strings.Contains(message, "1000")) {
				return providerRetryDecision{Retry: true, Reason: "minimax transient unknown api error"}
			}
			return providerRetryDecision{}
		},
		FormatAttempt: formatProviderRawAttempt,
	})
	manager.RegisterRetryPolicy("openai-compatible", providerRetryPolicy{
		MaxRetries:   maxOpenAICompatibleStreamRetries,
		InitialDelay: 100 * time.Millisecond,
		MaxDelay:     400 * time.Millisecond,
		ShouldRetry: func(err error, emitted bool) providerRetryDecision {
			if err == nil || emitted || !isRetryableOpenAIStreamError(err) {
				return providerRetryDecision{}
			}
			return providerRetryDecision{Retry: true, Reason: "openai-compatible transient stream error"}
		},
		FormatAttempt: formatOpenAIStreamAttempt,
	})
	manager.RegisterRetryPolicy("codex-compatible", manager.retryPolicy("openai-compatible"))
	return manager
}

func (m *aiProviderManager) RegisterRetryPolicy(provider string, policy providerRetryPolicy) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.policies[normalizeProviderID(provider)] = normalizeRetryPolicy(policy)
}

func (m *aiProviderManager) ExecuteWithRetry(
	ctx context.Context,
	provider string,
	attempt func(attempt int) providerAttemptResult,
	trace func(title string, text string) error,
) providerAttemptResult {
	policy := m.retryPolicy(provider)
	formatAttempt := policy.FormatAttempt
	if formatAttempt == nil {
		formatAttempt = formatProviderRawAttempt
	}

	var rawAttempts []string
	for attemptIndex := 0; attemptIndex <= policy.MaxRetries; attemptIndex++ {
		result := attempt(attemptIndex + 1)
		rawAttempts = append(rawAttempts, formatAttempt(attemptIndex+1, result.Raw))
		if result.Err == nil {
			result.Raw = strings.Join(rawAttempts, "\n")
			return result
		}

		decision := providerRetryDecision{}
		if policy.ShouldRetry != nil && (ctx == nil || ctx.Err() == nil) {
			decision = policy.ShouldRetry(result.Err, result.Emitted)
		}
		if !decision.Retry || attemptIndex >= policy.MaxRetries {
			result.Raw = strings.Join(rawAttempts, "\n")
			return result
		}

		if trace != nil {
			if err := trace("Model HTTP retry", formatProviderRetryTrace(attemptIndex+1, attemptIndex+2, decision.Reason, result.Err)); err != nil {
				return providerAttemptResult{Raw: strings.Join(rawAttempts, "\n"), Err: err}
			}
		}
		if err := sleepProviderBackoff(ctx, providerBackoffDelay(policy, attemptIndex)); err != nil {
			return providerAttemptResult{Raw: strings.Join(rawAttempts, "\n"), Err: err}
		}
	}
	return providerAttemptResult{Raw: strings.Join(rawAttempts, "\n")}
}

func (m *aiProviderManager) retryPolicy(provider string) providerRetryPolicy {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return normalizeRetryPolicy(m.policies[normalizeProviderID(provider)])
}

func normalizeRetryPolicy(policy providerRetryPolicy) providerRetryPolicy {
	if policy.MaxRetries < 0 {
		policy.MaxRetries = 0
	}
	if policy.InitialDelay <= 0 {
		policy.InitialDelay = 100 * time.Millisecond
	}
	if policy.MaxDelay <= 0 || policy.MaxDelay < policy.InitialDelay {
		policy.MaxDelay = policy.InitialDelay
	}
	return policy
}

func normalizeProviderID(provider string) string {
	return strings.ToLower(strings.TrimSpace(provider))
}

func providerBackoffDelay(policy providerRetryPolicy, attemptIndex int) time.Duration {
	delay := policy.InitialDelay
	for i := 0; i < attemptIndex; i++ {
		delay *= 2
		if delay >= policy.MaxDelay {
			return policy.MaxDelay
		}
	}
	return delay
}

func sleepProviderBackoff(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	if ctx == nil {
		time.Sleep(delay)
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func formatProviderRetryTrace(attempt int, nextAttempt int, reason string, err error) string {
	if strings.TrimSpace(reason) == "" {
		reason = "transient provider error"
	}
	return fmt.Sprintf(
		"attempt=%d next_attempt=%d reason=%s error=%s",
		attempt,
		nextAttempt,
		reason,
		err.Error(),
	)
}

func formatProviderRawAttempt(attempt int, raw string) string {
	return fmt.Sprintf("attempt=%d\n%s", attempt, strings.TrimSpace(raw))
}
