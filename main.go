package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Owner struct {
	UID        string `json:"uid"`
	Controller bool   `json:"controller"`
}
type ContainerSpec struct {
	Name      string `json:"name"`
	Resources struct {
		Requests map[string]string `json:"requests,omitempty"`
		Limits   map[string]string `json:"limits,omitempty"`
	} `json:"resources"`
}

type Resource struct {
	Kind     string `json:"kind"`
	Metadata struct {
		UID             string            `json:"uid"`
		Name            string            `json:"name"`
		Namespace       string            `json:"namespace"`
		Labels          map[string]string `json:"labels"`
		OwnerReferences []Owner           `json:"ownerReferences"`
	} `json:"metadata"`
	Spec struct {
		Replicas       *int            `json:"replicas,omitempty"`
		Containers     []ContainerSpec `json:"containers"`
		InitContainers []ContainerSpec `json:"initContainers"`
	} `json:"spec"`
	Status map[string]any `json:"status"`
}
type Inventory struct {
	Items    []Resource `json:"items"`
	Warnings []string   `json:"warnings"`
}

func kube(ctx context.Context, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "kubectl", args...)
	out, err := cmd.Output()
	if err != nil {
		if e, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("kubectl: %s", strings.TrimSpace(string(e.Stderr)))
		}
		return nil, err
	}
	return out, nil
}
func reply(w http.ResponseWriter, v any, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err != nil {
		w.WriteHeader(502)
		v = map[string]string{"error": err.Error()}
	}
	json.NewEncoder(w).Encode(v)
}
func validNS(s string) bool {
	if len(s) == 0 || len(s) > 63 || s[0] == '-' || s[len(s)-1] == '-' {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}
func inventory(ctx context.Context, cluster, ns string) (Inventory, error) {
	result := Inventory{Items: []Resource{}, Warnings: []string{}}
	for _, kind := range []string{"deployments.apps", "replicasets.apps", "pods", "statefulsets.apps", "daemonsets.apps", "jobs.batch", "cronjobs.batch"} {
		args := []string{"--context=" + cluster, "get", kind, "-o", "json", "--request-timeout=15s"}
		if ns == "*" {
			args = append(args, "--all-namespaces")
		} else {
			args = append(args, "--namespace="+ns)
		}
		b, e := kube(ctx, args...)
		var data Inventory
		if e == nil {
			e = json.Unmarshal(b, &data)
		}
		if e != nil {
			result.Warnings = append(result.Warnings, kind+": "+e.Error())
			continue
		}
		for i := range data.Items {
			if data.Items[i].Kind == "" {
				for k, v := range kinds {
					if v == kind {
						data.Items[i].Kind = k
						break
					}
				}
			}
		}
		result.Items = append(result.Items, data.Items...)
	}
	if len(result.Warnings) == 7 {
		return result, fmt.Errorf("%s", strings.Join(result.Warnings, "; "))
	}
	return result, nil
}

//go:embed frontend/dist
var frontendAssets embed.FS

func main() {
	addr := flag.String("listen", "127.0.0.1:8080", "loopback address")
	dir := flag.String("ui", "", "optional external frontend directory override")
	flag.Parse()
	host, _, e := net.SplitHostPort(*addr)
	if e != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		log.Fatal("listen must be a loopback IP and port")
	}
	mux := http.NewServeMux()
	dependencyRoutes(mux)
	metricsRoutes(mux)
	mux.HandleFunc("GET /api/context", func(w http.ResponseWriter, r *http.Request) {
		b, e := kube(r.Context(), "config", "current-context")
		reply(w, map[string]string{"context": strings.TrimSpace(string(b))}, e)
	})
	mux.HandleFunc("GET /api/namespaces", func(w http.ResponseWriter, r *http.Request) {
		c := r.URL.Query().Get("context")
		if c == "" {
			http.Error(w, "context required", 400)
			return
		}
		b, e := kube(r.Context(), "--context="+c, "get", "namespaces", "-o", "json", "--request-timeout=15s")
		var d Inventory
		if e == nil {
			e = json.Unmarshal(b, &d)
		}
		names := []string{}
		for _, x := range d.Items {
			names = append(names, x.Metadata.Name)
		}
		reply(w, names, e)
	})
	mux.HandleFunc("GET /api/resources", func(w http.ResponseWriter, r *http.Request) {
		c, n := r.URL.Query().Get("context"), r.URL.Query().Get("namespace")
		if c == "" || !(n == "*" || validNS(n)) {
			http.Error(w, "invalid context or namespace", 400)
			return
		}
		v, e := inventory(r.Context(), c, n)
		reply(w, v, e)
	})
	mux.HandleFunc("GET /api/logs", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		c, n, pod, container := q.Get("context"), q.Get("namespace"), q.Get("pod"), q.Get("container")
		tail, e := strconv.Atoi(q.Get("tail"))
		if c == "" || !validNS(n) || !validName(pod) || !validNS(container) || e != nil || tail < 1 || tail > 1000 {
			http.Error(w, "Invalid log parameters", 400)
			return
		}
		args := []string{"--context=" + c, "--namespace=" + n, "logs", pod, "--container=" + container, "--tail=" + strconv.Itoa(tail), "--request-timeout=20s"}
		if q.Get("previous") == "true" {
			args = append(args, "--previous")
		}
		if q.Get("timestamps") == "true" {
			args = append(args, "--timestamps")
		}
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "kubectl", args...)
		pipe, err := cmd.StdoutPipe()
		if err != nil {
			reply(w, nil, err)
			return
		}
		if err = cmd.Start(); err != nil {
			reply(w, nil, err)
			return
		}
		b, err := io.ReadAll(io.LimitReader(pipe, 2*1024*1024+1))
		if len(b) > 2*1024*1024 || err != nil {
			cancel()
			cmd.Wait()
			reply(w, nil, fmt.Errorf("Log output exceeded limit or could not be read"))
			return
		}
		if err = cmd.Wait(); err != nil {
			reply(w, nil, fmt.Errorf("Log request failed: check RBAC, container state and cluster connection: %w", err))
			return
		}
		reply(w, map[string]string{"logs": string(b)}, nil)
	})
	var ui http.FileSystem
	if *dir != "" {
		ui = http.Dir(*dir)
	} else {
		assets, err := fs.Sub(frontendAssets, "frontend/dist")
		if err != nil {
			log.Fatal(err)
		}
		ui = http.FS(assets)
	}
	mux.Handle("GET /", http.FileServer(ui))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != *addr {
			http.Error(w, "invalid host", 403)
			return
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" || (strings.HasPrefix(r.URL.Path, "/api/") && r.Header.Get("X-KubeTree-Local") != "1") {
			http.Error(w, "cross-site request blocked", 403)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'")
		mux.ServeHTTP(w, r)
	})
	log.Printf("Open http://%s", *addr)
	log.Fatal((&http.Server{Addr: *addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 90 * time.Second}).ListenAndServe())
}

var resourceName = regexp.MustCompile(`^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$`)

func validName(s string) bool { return len(s) <= 253 && resourceName.MatchString(s) }
