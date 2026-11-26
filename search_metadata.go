package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

const metadataAccept = "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1"

type SearchResult struct {
	SearchResourceType
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	UID       string `json:"uid"`
}

type searchMetadataList struct {
	Kind       string `json:"kind"`
	APIVersion string `json:"apiVersion"`
	Metadata   struct {
		Continue string `json:"continue"`
	} `json:"metadata"`
	Items []struct {
		Metadata struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
			UID       string `json:"uid"`
		} `json:"metadata"`
	} `json:"items"`
}

func newSearchClient(cluster string) (*http.Client, string, error) {
	if cluster == "" {
		return nil, "", fmt.Errorf("context required")
	}

	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	overrides := &clientcmd.ConfigOverrides{
		CurrentContext: cluster,
	}

	config, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		rules, overrides,
	).ClientConfig()

	if err != nil {
		return nil, "", err
	}

	config.Timeout = 15 * time.Second

	client, err := rest.HTTPClientFor(config)
	if err != nil {
		return nil, "", err
	}

	return client, strings.TrimRight(config.Host, "/"), nil
}

func searchResourcePath(r SearchResourceType, namespace string) string {
	resource, _, _ := strings.Cut(r.Resource, ".")

	path := "/api/" + r.APIVersion
	if strings.Contains(r.APIVersion, "/") {
		path = "/apis/" + r.APIVersion
	}

	if r.Namespaced && namespace != "*" {
		path += "/namespaces/" + namespace
	}

	return path + "/" + resource
}

func listSearchMetadata(
	ctx context.Context,
	client *http.Client,
	host string,
	r SearchResourceType,
	namespace string,
) ([]SearchResult, error) {
	if r.Namespaced && namespace != "*" && !validNS(namespace) {
		return nil, fmt.Errorf("invalid namespace")
	}

	results := []SearchResult{}
	next := ""

	for {
		req, err := http.NewRequestWithContext(
			ctx,
			http.MethodGet,
			host+searchResourcePath(r, namespace),
			nil,
		)
		if err != nil {
			return results, err
		}

		req.Header.Set("Accept", metadataAccept)

		query := req.URL.Query()
		query.Set("limit", "500")
		if next != "" {
			query.Set("continue", next)
		}
		req.URL.RawQuery = query.Encode()

		resp, err := client.Do(req)
		if err != nil {
			return results, err
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return results, fmt.Errorf(
				"%s: HTTP %d", r.Resource, resp.StatusCode,
			)
		}

		var page searchMetadataList
		err = json.NewDecoder(resp.Body).Decode(&page)
		resp.Body.Close()

		if err != nil {
			return results, err
		}

		if page.Kind != "PartialObjectMetadataList" ||
			page.APIVersion != "meta.k8s.io/v1" {
			return results, fmt.Errorf(
				"%s: metadata-only response unavailable",
				r.Resource,
			)
		}

		for _, item := range page.Items {
			results = append(results, SearchResult{
				SearchResourceType: r,
				Name:               item.Metadata.Name,
				Namespace:          item.Metadata.Namespace,
				UID:                item.Metadata.UID,
			})
		}

		if page.Metadata.Continue == "" {
			return results, nil
		}

		if page.Metadata.Continue == next {
			return results, fmt.Errorf("repeated pagination token")
		}

		next = page.Metadata.Continue
	}
}
