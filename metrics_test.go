package main

import (
	"errors"
	"strings"
	"testing"
)

func TestMetricsError(t *testing.T) {
	cases := []struct {
		input     string
		expected  string
		retryable bool
	}{
		{
			`Forbidden: User "private-user" cannot list pods`,
			"RBAC",
			false,
		},
		{
			"Unauthorized",
			"authentication",
			false,
		},
		{
			"the server could not find the requested resource",
			"Metrics API unavailable",
			false,
		},
		{
			"context deadline exceeded",
			"timed out",
			true,
		},
		{
			"Service Unavailable",
			"temporarily unavailable",
			true,
		},
		{
			"unexpected internal error",
			"Unable to retrieve metrics",
			true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			message, retryable := metricsError(
				errors.New(tc.input),
			)

			if !strings.Contains(message, tc.expected) {
				t.Errorf("unexpected message: %q", message)
			}

			if retryable != tc.retryable {
				t.Errorf(
					"retryable = %v, want %v",
					retryable,
					tc.retryable,
				)
			}

			if strings.Contains(message, "private-user") {
				t.Error("private identity exposed")
			}
		})
	}
}
