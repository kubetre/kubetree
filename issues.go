package main

import (
	"encoding/json"
	"fmt"
	"net/http"
)

func issueRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/issues/events", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		c, n := q.Get("context"), q.Get("namespace")
		if c == "" || (n != "*" && !validNS(n)) {
			http.Error(w, "Invalid scope", 400)
			return
		}
		args := []string{"--context=" + c, "get", "events", "--field-selector=type=Warning", "-o", "json", "--request-timeout=15s"}
		if n == "*" {
			args = append(args, "--all-namespaces")
		} else {
			args = append(args, "--namespace="+n)
		}
		b, err := kube(r.Context(), args...)
		if err != nil {
			reply(w, nil, fmt.Errorf("Check event list permissions and cluster connectivity"))
			return
		}
		d := struct {
			Items []json.RawMessage `json:"items"`
		}{Items: []json.RawMessage{}}
		err = json.Unmarshal(b, &d)
		reply(w, d.Items, err)
	})
}
