package main

import "testing"

func TestParseResourceDiscovery(t *testing.T) {
	input := `NAME SHORTNAMES APIVERSION NAMESPACED KIND VERBS
pods po v1 true Pod get,list
secrets v1 true Secret get,list
deployments deploy apps/v1 true Deployment get,list
nodes no v1 false Node get,list
pods metrics.k8s.io/v1beta1 true PodMetrics get,list
certificates cert-manager.io/v1 true Certificate get,list
clusterissuers cert-manager.io/v1 false ClusterIssuer get,list
pods/status v1 true Pod get,list
pods po v1 true Pod get,list
`

	got := parseResourceDiscovery(input)

	if len(got) != 7 {
		t.Fatalf("expected 7 resource types, got %d: %+v", len(got), got)
	}

	want := map[string]SearchResourceType{
		"pods": {
			"pods", "Pod", "v1", true,
		},
		"secrets": {
			"secrets", "Secret", "v1", true,
		},
		"deployments.apps": {
			"deployments.apps", "Deployment", "apps/v1", true,
		},
		"nodes": {
			"nodes", "Node", "v1", false,
		},
		"pods.metrics.k8s.io": {
			"pods.metrics.k8s.io", "PodMetrics",
			"metrics.k8s.io/v1beta1", true,
		},
		"certificates.cert-manager.io": {
			"certificates.cert-manager.io", "Certificate",
			"cert-manager.io/v1", true,
		},
		"clusterissuers.cert-manager.io": {
			"clusterissuers.cert-manager.io", "ClusterIssuer",
			"cert-manager.io/v1", false,
		},
	}

	for _, resource := range got {
		expected, ok := want[resource.Resource]
		if !ok || resource != expected {
			t.Errorf("unexpected resource: %+v", resource)
		}
	}
}

func TestEmptyResourceDiscovery(t *testing.T) {
	if got := parseResourceDiscovery(""); len(got) != 0 {
		t.Fatalf("expected empty result, got %+v", got)
	}
}
