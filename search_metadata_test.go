package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMetadataOnlySearch(t *testing.T) {
	resource := SearchResourceType{
		Resource:   "secrets",
		Kind:       "Secret",
		APIVersion: "v1",
		Namespaced: true,
	}

	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				t.Errorf("unexpected method: %s", r.Method)
			}

			if r.Header.Get("Accept") != metadataAccept {
				t.Error("metadata-only Accept header missing")
			}

			if r.URL.Path != "/api/v1/namespaces/demo/secrets" {
				t.Errorf("unexpected path: %s", r.URL.Path)
			}

			w.Header().Set("Content-Type", "application/json")

			fmt.Fprint(w, `{
				"kind":"PartialObjectMetadataList",
				"apiVersion":"meta.k8s.io/v1",
				"metadata":{},
				"items":[{
					"metadata":{
						"name":"web-secret",
						"namespace":"demo",
						"uid":"test-uid"
					}
				}]
			}`)
		},
	))
	defer server.Close()

	items, err := listSearchMetadata(
		context.Background(),
		server.Client(),
		server.URL,
		resource,
		"demo",
	)

	if err != nil {
		t.Fatal(err)
	}

	if len(items) != 1 || items[0].Name != "web-secret" {
		t.Fatalf("unexpected results: %+v", items)
	}
}

func TestRejectFullObjectResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprint(w, `{
				"kind":"SecretList",
				"apiVersion":"v1",
				"items":[{
					"metadata":{"name":"test"},
					"data":{"password":"dGVzdA=="}
				}]
			}`)
		},
	))
	defer server.Close()

	items, err := listSearchMetadata(
		context.Background(),
		server.Client(),
		server.URL,
		SearchResourceType{
			Resource:   "secrets",
			Kind:       "Secret",
			APIVersion: "v1",
			Namespaced: true,
		},
		"demo",
	)

	if err == nil || len(items) != 0 {
		t.Fatal("full object response must be rejected")
	}
}

func TestSearchMatching(t *testing.T) {
	item := SearchResult{
		SearchResourceType: SearchResourceType{
			Kind:       "Secret",
			Resource:   "secrets",
			APIVersion: "v1",
		},
		Name:      "web-secret",
		Namespace: "demo",
	}

	tests := []struct {
		query string
		want  bool
	}{
		{"web", true},
		{"SECRET", true},
		{"demo web", true},
		{"deployment", false},
		{"web production", false},
	}

	for _, test := range tests {
		if matchesSearch(item, test.query) != test.want {
			t.Errorf("unexpected match for %q", test.query)
		}
	}
}
