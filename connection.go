package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"k8s.io/client-go/tools/clientcmd"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

type connectionKey struct{}
type connection struct {
	paths []string
	name  string
}

var connections = struct {
	sync.Mutex
	entries map[string]connection
}{entries: map[string]connection{}}

func sourcePaths(source string) ([]string, error) {
	if source == "" {
		source = os.Getenv("KUBECONFIG")
		if source != "" {
			return filepath.SplitList(source), nil
		}

		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}

		path := filepath.Join(home, ".kube", "config")
		info, err := os.Stat(path)
		if os.IsNotExist(err) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("Default kubeconfig is not a regular file")
		}
		return []string{path}, nil
	}
	if !filepath.IsAbs(source) {
		return nil, fmt.Errorf("Enter an absolute local path")
	}
	info, err := os.Stat(source)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("Not a regular file")
		}
		return []string{source}, nil
	}
	entries, err := os.ReadDir(source)
	if err != nil {
		return nil, err
	}
	paths := []string{}
	seen := map[string]bool{}
	for _, e := range entries {
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if !e.Type().IsRegular() || (ext != ".yaml" && ext != ".yml" && e.Name() != "config" && ext != ".kubeconfig") {
			continue
		}
		p := filepath.Join(source, e.Name())
		cfg, err := clientcmd.LoadFromFile(p)
		if err == nil && len(cfg.Contexts) > 0 {
			for n := range cfg.Contexts {
				if seen["context:"+n] {
					return nil, fmt.Errorf("Duplicate context %q; select a single file instead", n)
				}
				seen["context:"+n] = true
			}
			for n := range cfg.Clusters {
				if seen["cluster:"+n] {
					return nil, fmt.Errorf("Duplicate cluster %q; select a single file instead", n)
				}
				seen["cluster:"+n] = true
			}
			for n := range cfg.AuthInfos {
				if seen["user:"+n] {
					return nil, fmt.Errorf("Duplicate user %q; select a single file instead", n)
				}
				seen["user:"+n] = true
			}
			paths = append(paths, p)
		}
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("No kubeconfig files found in directory")
	}
	return paths, nil
}
func connectionRules(paths []string) *clientcmd.ClientConfigLoadingRules {
	return &clientcmd.ClientConfigLoadingRules{Precedence: paths}
}
func connectionRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/local-files", func(w http.ResponseWriter, r *http.Request) {
		dir := r.URL.Query().Get("path")
		if dir == "" {
			dir, _ = os.UserHomeDir()
		}
		if !filepath.IsAbs(dir) {
			reply(w, nil, fmt.Errorf("Absolute directory required"))
			return
		}
		dir = filepath.Clean(dir)
		entries, err := os.ReadDir(dir)
		if err != nil {
			reply(w, nil, err)
			return
		}
		type entry struct {
			Name      string `json:"name"`
			Path      string `json:"path"`
			Directory bool   `json:"directory"`
		}
		result := []entry{}
		for _, e := range entries {
			path := filepath.Join(dir, e.Name())
			info, err := os.Stat(path)
			if err != nil || (!info.IsDir() && !info.Mode().IsRegular()) {
				continue
			}
			result = append(result, entry{e.Name(), path, info.IsDir()})
		}
		reply(w, map[string]any{"path": dir, "parent": filepath.Dir(dir), "entries": result}, nil)
	})
	mux.HandleFunc("GET /api/connections", func(w http.ResponseWriter, r *http.Request) {
		paths, err := sourcePaths(r.URL.Query().Get("source"))
		if err != nil {
			reply(w, nil, err)
			return
		}
		names := []string{}
		current := ""
		if len(paths) > 0 {
			cfg, e := connectionRules(paths).Load()
			if e != nil {
				reply(w, nil, e)
				return
			}
			current = cfg.CurrentContext
			for n := range cfg.Contexts {
				names = append(names, n)
			}
			sort.Strings(names)
		}
		reply(w, map[string]any{"contexts": names, "current": current, "source": r.URL.Query().Get("source"), "exported": os.Getenv("KUBECONFIG")}, nil)
	})
	mux.HandleFunc("POST /api/connections", func(w http.ResponseWriter, r *http.Request) {
		paths, err := sourcePaths(r.URL.Query().Get("source"))
		if err != nil || len(paths) == 0 {
			reply(w, nil, fmt.Errorf("No usable kubeconfig source"))
			return
		}
		cfg, err := connectionRules(paths).Load()
		if err != nil {
			reply(w, nil, err)
			return
		}
		name := r.URL.Query().Get("name")
		if cfg.Contexts[name] == nil {
			reply(w, nil, fmt.Errorf("Unknown context"))
			return
		}
		var raw [24]byte
		if _, err = rand.Read(raw[:]); err != nil {
			reply(w, nil, err)
			return
		}
		id := hex.EncodeToString(raw[:])
		connections.Lock()
		if len(connections.entries) >= 1024 {
			connections.Unlock()
			reply(w, nil, fmt.Errorf("Connection limit reached; restart KubeTree"))
			return
		}
		connections.entries[id] = connection{paths, name}
		connections.Unlock()
		reply(w, map[string]string{"context": id, "name": name, "namespace": cfg.Contexts[name].Namespace}, nil)
	})
}
func bindConnection(w http.ResponseWriter, r *http.Request) (*http.Request, bool) {
	q := r.URL.Query()
	id := q.Get("context")
	connections.Lock()
	c, ok := connections.entries[id]
	connections.Unlock()
	if !ok {
		http.Error(w, "Select a connection first", 400)
		return r, false
	}
	q.Set("context", c.name)
	u := *r.URL
	u.RawQuery = q.Encode()
	r = r.WithContext(context.WithValue(r.Context(), connectionKey{}, c))
	r.URL = &u
	return r, true
}
func kubeCommand(ctx context.Context, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "kubectl", args...)
	if c, ok := ctx.Value(connectionKey{}).(connection); ok {
		env := []string{}
		for _, v := range os.Environ() {
			if !strings.EqualFold(strings.SplitN(v, "=", 2)[0], "KUBECONFIG") {
				env = append(env, v)
			}
		}
		cmd.Env = append(env, "KUBECONFIG="+strings.Join(c.paths, string(os.PathListSeparator)))
	}
	return cmd
}
