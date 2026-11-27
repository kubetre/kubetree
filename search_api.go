package main

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type GlobalSearchResponse struct {
	Items    []SearchResult `json:"items"`
	Warnings []string       `json:"warnings"`
	Scanned  int            `json:"scanned"`
	Total    int            `json:"total"`
	Limited  bool           `json:"limited"`
}

func matchesSearch(r SearchResult, query string) bool {
	value := strings.ToLower(strings.Join([]string{
		r.Name,
		r.Kind,
		r.Namespace,
		r.Resource,
		r.APIVersion,
	}, " "))

	for _, term := range strings.Fields(strings.ToLower(query)) {
		if !strings.Contains(value, term) {
			return false
		}
	}

	return true
}

func globalSearch(
	ctx context.Context,
	cluster, namespace, query, kind string,
) (GlobalSearchResponse, error) {
	result := GlobalSearchResponse{
		Items:    []SearchResult{},
		Warnings: []string{},
	}

	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	resources, err := discoverSearchResources(ctx, cluster)
	if err != nil {
		return result, err
	}

	client, host, err := newSearchClient(ctx, cluster)
	if err != nil {
		return result, err
	}
	defer client.CloseIdleConnections()

	jobs := make(chan SearchResourceType, len(resources))

	for _, resource := range resources {
		if kind != "" &&
			!strings.EqualFold(resource.Kind, kind) &&
			!strings.EqualFold(resource.Resource, kind) {
			continue
		}

		jobs <- resource
		result.Total++
	}

	close(jobs)

	var wg sync.WaitGroup
	var mu sync.Mutex

	for i := 0; i < 4; i++ {
		wg.Add(1)

		go func() {
			defer wg.Done()

			for resource := range jobs {
				if ctx.Err() != nil {
					return
				}

				items, err := listSearchMetadata(
					ctx, client, host, resource, namespace,
				)

				mu.Lock()

				result.Scanned++

				if err != nil {
					result.Warnings = append(
						result.Warnings,
						fmt.Sprintf("%s: listing incomplete or unavailable",
							resource.Resource),
					)
				}

				for _, item := range items {
					if !matchesSearch(item, query) {
						continue
					}

					if len(result.Items) >= 2000 {
						result.Limited = true
						continue
					}

					result.Items = append(result.Items, item)
				}

				mu.Unlock()
			}
		}()
	}

	wg.Wait()

	if ctx.Err() != nil {
		result.Warnings = append(
			result.Warnings,
			"Search interrupted or timed out; results may be incomplete.",
		)
	}

	sort.Slice(result.Items, func(i, j int) bool {
		a, b := result.Items[i], result.Items[j]

		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		if a.Namespace != b.Namespace {
			return a.Namespace < b.Namespace
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}

		return a.APIVersion < b.APIVersion
	})

	sort.Strings(result.Warnings)

	return result, nil
}

func searchRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/search/object", inspectSearchObject)
	mux.HandleFunc("GET /api/search/types", func(
		w http.ResponseWriter, r *http.Request,
	) {
		cluster := r.URL.Query().Get("context")

		resources, err := discoverSearchResources(
			r.Context(), cluster,
		)

		reply(w, resources, err)
	})

	mux.HandleFunc("GET /api/search", func(
		w http.ResponseWriter, r *http.Request,
	) {
		q := r.URL.Query()

		cluster := q.Get("context")
		namespace := q.Get("namespace")
		query := strings.TrimSpace(q.Get("q"))
		kind := strings.TrimSpace(q.Get("kind"))

		if cluster == "" ||
			(namespace != "*" && !validNS(namespace)) ||
			len(query) > 256 ||
			len(kind) > 256 ||
			(query == "" && kind == "") {

			http.Error(w, "Invalid search parameters",
				http.StatusBadRequest)
			return
		}

		result, err := globalSearch(
			r.Context(),
			cluster,
			namespace,
			query,
			kind,
		)

		reply(w, result, err)
	})
}
