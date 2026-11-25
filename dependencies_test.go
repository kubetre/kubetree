package main

import (
	"encoding/json"
	"testing"
)

func TestReferences(t *testing.T) {
	var o obj
	err := json.Unmarshal([]byte(`{"spec":{"template":{"spec":{"containers":[{"envFrom":[{"secretRef":{"name":"credentials"}},{"configMapRef":{"name":"settings"}}]}],"volumes":[{"persistentVolumeClaim":{"claimName":"disk"}}]}}}}`), &o)
	if err != nil {
		t.Fatal(err)
	}
	got := references(o, "Deployment", "default")
	for _, want := range []relation{{"Secret", "credentials", "default", "environment"}, {"ConfigMap", "settings", "default", "environment"}, {"PersistentVolumeClaim", "disk", "default", "volume"}, {"ServiceAccount", "default", "default", "uses identity"}} {
		found := false
		for _, r := range got {
			if r == want {
				found = true
			}
		}
		if !found {
			t.Errorf("missing %+v", want)
		}
	}
}
func TestSelector(t *testing.T) {
	if !subset(obj{"app": "a"}, obj{"app": "a", "other": "b"}) || subset(obj{"app": "b"}, obj{"app": "a"}) || subset(obj{}, obj{}) {
		t.Fatal("selector mismatch")
	}
}
