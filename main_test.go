package main

import "testing"

func TestNamespace(t *testing.T) {
	for _, s := range []string{"default", "kube-system", "a1"} {
		if !validNS(s) {
			t.Fatal(s)
		}
	}
	for _, s := range []string{"", "-x", "x-", "UPPER", "a/b", "--help"} {
		if validNS(s) {
			t.Fatal(s)
		}
	}
}
