package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"sigs.k8s.io/yaml"
)

// Only single objects explicitly selected by the user are retrieved.
func inspectSearchObject(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cluster, name, ns := q.Get("context"), q.Get("name"), q.Get("namespace")
	format := q.Get("format")
	if cluster == "" || name == "" || len(name) > 253 || name == "." || name == ".." || strings.ContainsAny(name, "/\\%\x00\r\n") || (format != "json" && format != "yaml") {
		http.Error(w, "Invalid inspection parameters", 400)
		return
	}
	types, err := discoverSearchResources(r.Context(), cluster)
	if err != nil {
		reply(w, nil, err)
		return
	}
	for _, t := range types {
		if t.Resource != q.Get("resource") || t.APIVersion != q.Get("apiVersion") {
			continue
		}
		if (t.Namespaced && !validNS(ns)) || (!t.Namespaced && ns != "") {
			http.Error(w, "Invalid resource namespace", 400)
			return
		}
		// Core Secrets must continue through the specialized viewer.
		if t.Resource == "secrets" && t.APIVersion == "v1" {
			http.Error(w, "Use the Secret viewer", 400)
			return
		}
		client, host, err := newSearchClient(r.Context(), cluster)
		if err != nil {
			reply(w, nil, err)
			return
		}
		defer client.CloseIdleConnections()
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, host+searchResourcePath(t, ns)+"/"+url.PathEscape(name), nil)
		if err != nil {
			reply(w, nil, err)
			return
		}
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			reply(w, nil, err)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			reply(w, nil, fmt.Errorf("Resource inspection failed (HTTP %d): check permissions or whether the resource still exists", resp.StatusCode))
			return
		}
		const max = 4 * 1024 * 1024
		data, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
		if err != nil || len(data) > max {
			reply(w, nil, fmt.Errorf("Resource response too large or unreadable"))
			return
		}
		var identity struct {
			Kind       string
			APIVersion string
			Metadata   struct {
				Name      string
				Namespace string
				UID       string
			}
		}
		if json.Unmarshal(data, &identity) != nil || identity.Kind != t.Kind || identity.APIVersion != t.APIVersion || identity.Metadata.Name != name || identity.Metadata.Namespace != ns || (q.Get("uid") != "" && identity.Metadata.UID != q.Get("uid")) {
			reply(w, nil, fmt.Errorf("Resource identity changed or response was unexpected; search again"))
			return
		}
		if format == "yaml" {
			out, err := yaml.JSONToYAML(data)
			reply(w, map[string]string{"yaml": string(out)}, err)
			return
		}
		reply(w, map[string]json.RawMessage{"object": data}, nil)
		return
	}
	http.Error(w, "Resource type is no longer discoverable", 404)
}
