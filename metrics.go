package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type MetricUsage struct {
	CPU    string `json:"cpu"`
	Memory string `json:"memory"`
}

type MetricContainer struct {
	Name  string      `json:"name"`
	Usage MetricUsage `json:"usage"`
}

type MetricItem struct {
	Metadata struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace,omitempty"`
	} `json:"metadata"`
	Timestamp  string            `json:"timestamp"`
	Window     string            `json:"window"`
	Usage      MetricUsage       `json:"usage"`
	Containers []MetricContainer `json:"containers,omitempty"`
}

type MetricsResponse struct {
	Available bool         `json:"available"`
	Items     []MetricItem `json:"items"`
	Message   string       `json:"message,omitempty"`
	Retryable bool         `json:"retryable"`
}

func metricsError(err error) (string, bool) {
	msg := strings.ToLower(err.Error())

	switch {
	case strings.Contains(msg, "forbidden"):
		return "Metrics access denied by Kubernetes RBAC. Check permissions or select an authorized namespace.", false

	case strings.Contains(msg, "unauthorized"),
		strings.Contains(msg, "must be logged in"):
		return "Kubernetes authentication failed. Reconnect after checking your credentials.", false

	case strings.Contains(msg, "not found"),
		strings.Contains(msg, "could not find the requested resource"):
		return "Metrics API unavailable. Check whether Metrics Server is installed and running.", false

	case strings.Contains(msg, "timeout"),
		strings.Contains(msg, "deadline exceeded"):
		return "Metrics request timed out.", true

	case strings.Contains(msg, "service unavailable"),
		strings.Contains(msg, "connection refused"):
		return "Metrics service temporarily unavailable.", true

	default:
		return "Unable to retrieve metrics. Check cluster connectivity and Metrics API availability.", true
	}
}

func metricsRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/nodes", func(w http.ResponseWriter, r *http.Request) {
		c := r.URL.Query().Get("context")
		if c == "" {
			http.Error(w, "Invalid context", 400)
			return
		}

		b, err := kube(
			r.Context(),
			"--context="+c,
			"get", "nodes",
			"-o", "json",
			"--request-timeout=15s",
		)

		if err != nil {
			reply(w, map[string]any{
				"available": false,
				"items":     []any{},
				"message":   "Node inventory unavailable: check API access and permissions.",
			}, nil)
			return
		}

		var data struct {
			Items []struct {
				Metadata struct {
					Name string `json:"name"`
				} `json:"metadata"`
				Status struct {
					Capacity    map[string]string `json:"capacity"`
					Allocatable map[string]string `json:"allocatable"`
					Conditions  []struct {
						Type   string `json:"type"`
						Status string `json:"status"`
					} `json:"conditions"`
				} `json:"status"`
			} `json:"items"`
		}

		if err := json.Unmarshal(b, &data); err != nil {
			reply(w, map[string]any{
				"available": false,
				"items":     []any{},
				"message":   "Unable to read Node inventory.",
			}, nil)
			return
		}

		reply(w, map[string]any{
			"available": true,
			"items":     data.Items,
		}, nil)
	})

	mux.HandleFunc("GET /api/metrics", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		c := q.Get("context")
		n := q.Get("namespace")
		scope := q.Get("scope")

		if c == "" || !(n == "*" || validNS(n)) {
			http.Error(w, "Invalid context or namespace", 400)
			return
		}

		var path string

		switch scope {
		case "", "pods":
			if n == "*" {
				path = "/apis/metrics.k8s.io/v1beta1/pods"
			} else {
				path = fmt.Sprintf(
					"/apis/metrics.k8s.io/v1beta1/namespaces/%s/pods", n)
			}
		case "nodes":
			path = "/apis/metrics.k8s.io/v1beta1/nodes"
		default:
			http.Error(w, "Invalid metrics scope", 400)
			return
		}

		result := MetricsResponse{
			Items: []MetricItem{},
		}

		b, err := kube(
			r.Context(),
			"--context="+c,
			"get",
			"--raw="+path,
			"--request-timeout=15s",
		)

		if err != nil {
			result.Message, result.Retryable = metricsError(err)
			reply(w, result, nil)
			return
		}

		var data struct {
			Items []MetricItem `json:"items"`
		}

		if err := json.Unmarshal(b, &data); err != nil {
			result.Message = "Unable to read metrics response."
			reply(w, result, nil)
			return
		}

		result.Available = true

		if data.Items != nil {
			result.Items = data.Items
		}

		reply(w, result, nil)
	})
}
