package main

import (
	"encoding/json"
	"fmt"
	"net/http"
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
}

func metricsRoutes(mux *http.ServeMux) {
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
			result.Message = "Metrics unavailable: check Metrics API and permissions."
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
