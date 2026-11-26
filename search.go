package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

type SearchResourceType struct {
	Resource   string `json:"resource"`
	Kind       string `json:"kind"`
	APIVersion string `json:"apiVersion"`
	Namespaced bool   `json:"namespaced"`
}

func parseResourceDiscovery(output string) []SearchResourceType {
	result := []SearchResourceType{}
	seen := map[string]bool{}

	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)

		if len(fields) < 5 || fields[0] == "NAME" {
			continue
		}

		for i := 2; i < len(fields)-2; i++ {
			if fields[i] != "true" && fields[i] != "false" {
				continue
			}

			resource := fields[0]
			version := fields[i-1]
			kind := fields[i+1]

			if strings.Contains(resource, "/") {
				break
			}

			group, _, grouped := strings.Cut(version, "/")
			if grouped {
				resource += "." + group
			}

			key := resource + ":" + version
			if seen[key] {
				break
			}

			seen[key] = true
			result = append(result, SearchResourceType{
				Resource:   resource,
				Kind:       kind,
				APIVersion: version,
				Namespaced: fields[i] == "true",
			})
			break
		}
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].Kind == result[j].Kind {
			return result[i].Resource < result[j].Resource
		}
		return result[i].Kind < result[j].Kind
	})

	return result
}

func discoverSearchResources(
	ctx context.Context,
	cluster string,
) ([]SearchResourceType, error) {
	if cluster == "" {
		return nil, fmt.Errorf("context required")
	}

	output, err := kube(
		ctx,
		"--context="+cluster,
		"api-resources",
		"--verbs=list",
		"-o", "wide",
		"--request-timeout=15s",
	)

	if err != nil {
		return nil, err
	}

	return parseResourceDiscovery(string(output)), nil
}
