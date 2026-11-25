package main

import (
	"context"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
)

type obj = map[string]any

func m(v any) obj    { x, _ := v.(map[string]any); return x }
func s(v any) string { x, _ := v.(string); return x }
func a(v any) []any  { x, _ := v.([]any); return x }

var kinds = map[string]string{"Deployment": "deployments.apps", "ReplicaSet": "replicasets.apps", "Pod": "pods", "StatefulSet": "statefulsets.apps", "DaemonSet": "daemonsets.apps", "Job": "jobs.batch", "CronJob": "cronjobs.batch", "ConfigMap": "configmaps", "Secret": "secrets", "Service": "services", "Ingress": "ingresses.networking.k8s.io", "PersistentVolumeClaim": "persistentvolumeclaims", "PersistentVolume": "persistentvolumes", "ServiceAccount": "serviceaccounts", "HorizontalPodAutoscaler": "horizontalpodautoscalers.autoscaling", "PodDisruptionBudget": "poddisruptionbudgets.policy", "NetworkPolicy": "networkpolicies.networking.k8s.io", "Certificate": "certificates.cert-manager.io", "Issuer": "issuers.cert-manager.io", "ClusterIssuer": "clusterissuers.cert-manager.io"}

func clusterScoped(k string) bool { return k == "PersistentVolume" || k == "ClusterIssuer" }
func getObject(ctx context.Context, c, n, k, name, format string) ([]byte, error) {
	r, ok := kinds[k]
	if !ok || c == "" || !validName(name) || (!clusterScoped(k) && !validNS(n)) {
		return nil, fmt.Errorf("Invalid resource parameters")
	}
	args := []string{"--context=" + c, "get", r, name, "-o", format, "--request-timeout=15s"}
	if !clusterScoped(k) {
		args = append(args, "--namespace="+n)
	}
	return kube(ctx, args...)
}

type relation struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Relation  string `json:"relation"`
}

func references(o obj, k, n string) []relation {
	out := []relation{}
	seen := map[relation]bool{}
	add := func(k, name, why string) {
		if name == "" {
			return
		}
		ns := n
		if clusterScoped(k) {
			ns = ""
		}
		r := relation{k, name, ns, why}
		if !seen[r] {
			seen[r] = true
			out = append(out, r)
		}
	}
	spec := m(o["spec"])
	p := spec
	if k != "Pod" {
		p = m(m(spec["template"])["spec"])
		if k == "CronJob" {
			p = m(m(m(m(spec["jobTemplate"])["spec"])["template"])["spec"])
		}
	}
	if p != nil {
		sa := s(p["serviceAccountName"])
		if sa == "" {
			sa = "default"
		}
		add("ServiceAccount", sa, "uses identity")
		for _, v := range a(p["imagePullSecrets"]) {
			add("Secret", s(m(v)["name"]), "image pull")
		}
		for _, v := range a(p["volumes"]) {
			x := m(v)
			add("ConfigMap", s(m(x["configMap"])["name"]), "volume")
			add("Secret", s(m(x["secret"])["secretName"]), "volume")
			add("PersistentVolumeClaim", s(m(x["persistentVolumeClaim"])["claimName"]), "volume")
			for _, src := range a(m(x["projected"])["sources"]) {
				add("ConfigMap", s(m(m(src)["configMap"])["name"]), "projected volume")
				add("Secret", s(m(m(src)["secret"])["name"]), "projected volume")
			}
		}
		for _, field := range []string{"containers", "initContainers", "ephemeralContainers"} {
			for _, v := range a(p[field]) {
				for _, e := range a(m(v)["envFrom"]) {
					add("ConfigMap", s(m(m(e)["configMapRef"])["name"]), "environment")
					add("Secret", s(m(m(e)["secretRef"])["name"]), "environment")
				}
				for _, e := range a(m(v)["env"]) {
					f := m(m(e)["valueFrom"])
					add("ConfigMap", s(m(f["configMapKeyRef"])["name"]), "environment")
					add("Secret", s(m(f["secretKeyRef"])["name"]), "environment")
				}
			}
		}
	}
	for _, v := range a(m(o["metadata"])["ownerReferences"]) {
		add(s(m(v)["kind"]), s(m(v)["name"]), "owned by")
	}
	if k == "Ingress" {
		for _, v := range a(spec["tls"]) {
			add("Secret", s(m(v)["secretName"]), "TLS")
		}
		add("Service", s(m(m(spec["defaultBackend"])["service"])["name"]), "routes to")
		for _, v := range a(spec["rules"]) {
			for _, path := range a(m(m(v)["http"])["paths"]) {
				add("Service", s(m(m(m(path)["backend"])["service"])["name"]), "routes to")
			}
		}
	}
	if k == "PersistentVolumeClaim" {
		add("PersistentVolume", s(spec["volumeName"]), "bound to")
	}
	if k == "Certificate" {
		add("Secret", s(spec["secretName"]), "writes TLS secret")
		i := m(spec["issuerRef"])
		ik := s(i["kind"])
		if ik == "" {
			ik = "Issuer"
		}
		add(ik, s(i["name"]), "issued by")
	}
	return out
}
func subset(sel, labels obj) bool {
	if len(sel) == 0 {
		return false
	}
	for k, v := range sel {
		if s(v) != s(labels[k]) {
			return false
		}
	}
	return true
}
func dependencyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/object", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		b, e := getObject(r.Context(), q.Get("context"), q.Get("namespace"), q.Get("kind"), q.Get("name"), "json")
		var o obj
		if e == nil {
			e = json.Unmarshal(b, &o)
		}
		if e != nil {
			reply(w, nil, e)
			return
		}
		if q.Get("kind") == "Secret" {
			raw, _ := base64.StdEncoding.DecodeString(s(m(o["data"])["tls.crt"]))
			block, _ := pem.Decode(raw)
			if block != nil {
				if cert, err := x509.ParseCertificate(block.Bytes); err == nil {
					o["kubetreeCertificate"] = obj{"subject": cert.Subject.String(), "issuer": cert.Issuer.String(), "notBefore": cert.NotBefore, "notAfter": cert.NotAfter, "dnsNames": cert.DNSNames}
				}
			}
		}
		reply(w, o, nil)
	})
	mux.HandleFunc("GET /api/yaml", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		b, e := getObject(r.Context(), q.Get("context"), q.Get("namespace"), q.Get("kind"), q.Get("name"), "yaml")
		reply(w, obj{"yaml": string(b)}, e)
	})
	mux.HandleFunc("GET /api/dependencies", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		c, n, k, name := q.Get("context"), q.Get("namespace"), q.Get("kind"), q.Get("name")
		if k == "Secret" {
			reply(w, obj{"items": []relation{}, "warnings": []string{"Open Secret details to retrieve contents."}}, nil)
			return
		}
		b, e := getObject(r.Context(), c, n, k, name, "json")
		var o obj
		if e == nil {
			e = json.Unmarshal(b, &o)
		}
		if e != nil {
			reply(w, nil, e)
			return
		}
		out := references(o, k, n)
		warnings := []string{}
		labels := m(m(m(m(o["spec"])["template"])["metadata"])["labels"])
		if k == "Pod" {
			labels = m(m(o["metadata"])["labels"])
		}
		if len(labels) > 0 {
			for _, kind := range []string{"Service", "HorizontalPodAutoscaler", "PodDisruptionBudget", "NetworkPolicy"} {
				b, e := kube(r.Context(), "--context="+c, "--namespace="+n, "get", kinds[kind], "-o", "json", "--request-timeout=15s")
				var list obj
				if e == nil {
					e = json.Unmarshal(b, &list)
				}
				if e != nil {
					warnings = append(warnings, kind+": unavailable")
					continue
				}
				for _, v := range a(list["items"]) {
					x := m(v)
					sp := m(x["spec"])
					match := false
					why := "selector matches template labels"
					switch kind {
					case "Service":
						match = subset(m(sp["selector"]), labels)
					case "HorizontalPodAutoscaler":
						t := m(sp["scaleTargetRef"])
						match = s(t["kind"]) == k && s(t["name"]) == name
						why = "scales workload"
					case "PodDisruptionBudget", "NetworkPolicy":
						field := "selector"
						if kind == "NetworkPolicy" {
							field = "podSelector"
						}
						sel := m(sp[field])
						match = sel != nil && len(a(sel["matchExpressions"])) == 0 && (len(m(sel["matchLabels"])) == 0 || subset(m(sel["matchLabels"]), labels))
					}
					if match {
						out = append(out, relation{kind, s(m(x["metadata"])["name"]), n, why})
					}
				}
			}
		}
		reply(w, obj{"items": out, "warnings": warnings}, nil)
	})
}
