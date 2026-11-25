# KubeTree v0.1.0 — MVP preview
Local, read-only Kubernetes ownership explorer by KubeTre.

## Linux setup
Install Go 1.23+, Node.js 22 LTS with npm, GNU make, and kubectl compatible with your cluster. Configure kubeconfig and verify `kubectl config current-context` and `kubectl get pods -n default`. Internet access is required for the initial npm install.

From the extracted project directory:

```sh
make test
make build
make run
```

Open http://127.0.0.1:8080 (not localhost). Stop with Ctrl+C. If port 8080 is occupied, run `./bin/kubetree -listen 127.0.0.1:8081` and open that address. Run from the project root so the frontend assets are found.

## Test checklist
Select a namespace containing workloads (type its name and Apply, or enter `*` for all namespaces). Compare the tree against `kubectl get deployments,replicasets,pods -n YOUR_NAMESPACE`. Expand a Deployment, then a ReplicaSet, select a Pod and check its labels and status. Test search and Refresh. Standalone Pods and resources whose owners are not loaded appear at the root. Partial permission failures appear as warnings. Namespace listing is optional; type a known namespace if it is forbidden. To switch clusters, use `kubectl config use-context NAME` outside the app and click Reconnect (Refresh if the context name is unchanged).

## Architecture and safety
Go HTTP backend calls kubectl with fixed read-only get commands and uses the existing kubeconfig and current context. React/Vite frontend builds to frontend/dist. Relationships use controller owner UID, not name matching. No agent, external telemetry or cluster mutation endpoints. Bind only to loopback; do not expose the server via a proxy or tunnel. Existing kubeconfig credentials and RBAC apply; prefer least-privilege list access to deployments, replicasets, pods and optionally namespaces. Resource status and labels can contain sensitive data; do not share screenshots or errors without reviewing them.

## Limitations and verification
This is source code, not a self-contained executable. kubectl and built frontend files are required at runtime. Go compilation and namespace unit test passed in the authoring environment. npm registry DNS was unavailable, so frontend build and real cluster integration remain unverified. No npm lockfile yet; commit the generated package-lock.json after successful install. Events, networking relationships, live watches, YAML and cross-platform packaging are future work. License is not yet selected; choose one before public open-source release.

## Publish after testing
Create an empty repository named kubetree under your GitHub account. Review all files and choose a license. Then run:

```sh
git init -b main
git add .
git commit -m "Initial KubeTree MVP"
git remote add origin https://github.com/kubetre/kubetree.git
git push -u origin main
```

Do not commit kubeconfig, credentials, node_modules or build outputs.

## Internal release candidate
The header links to kubetre.com in a new tab. Logs are available for Pods and their discovered Deployment/ReplicaSet ancestors. Select a container, tail length, timestamps or previous instance; auto-refresh polls every three seconds (not a streaming connection). Requires existing `get pods/log` permission. Output is capped at 2 MiB per request; logs stay local. Copy/download exports the filtered text. Existing kubectl dependency remains; standalone packaging and live cluster testing are still pending.

## Dependency and Secret inspection (internal RC)
Select a workload in List or Graph view, then click Dependency view. Click a related resource to inspect it; Focus selected resource navigates to its own dependencies. References may be missing or inaccessible. Service matches use selectors, not observed traffic. PDB and NetworkPolicy matchExpressions are not yet supported. Ingress and cert-manager references are forward-only; reverse discovery and EndpointSlice matching are pending.

Secrets are retrieved on selection with existing kubeconfig permissions. Reveal, Decode, Encode, Copy and Download decoded operate locally. YAML is masked until revealed. TLS parsing shows the first PEM certificate, not a full chain validation. Do not share screenshots, clipboard contents or downloaded secrets. Local processes can access the loopback API; do not run on untrusted shared machines. No cluster mutation endpoints are provided. API calls require X-KubeTree-Local: 1. Existing kubectl dependency remains.
