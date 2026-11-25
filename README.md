# KubeTree

**Visualize your Kubernetes.** A local-first Kubernetes resource explorer by KubeTre.

[Website](https://kubetre.com) · [Downloads](https://github.com/kubetre/kubetree/releases) · [User guide](docs/user-guide.md) · [Issues](https://github.com/kubetre/kubetree/issues)

## Features

- Deployment, ReplicaSet and Pod ownership in list and graph views.
- Namespace selection, resource search, status and label inspection.
- Dependency discovery through configured references and selectors.
- Container logs, filtering, copy and download, optional three-second polling.
- On-demand Secret inspection, Base64 decoding, YAML and first-PEM TLS certificate details.

## Quick start

Install kubectl and configure your kubeconfig. Verify access with `kubectl config current-context` and `kubectl get pods -n default`.

Download the appropriate executable and SHA256SUMS.txt from [Releases](https://github.com/kubetre/kubetree/releases) when published. On Linux AMD64:

```sh
sha256sum --ignore-missing -c SHA256SUMS.txt
chmod +x kubetree-linux-amd64
./kubetree-linux-amd64
```

Open http://127.0.0.1:8080. Stop with Ctrl+C. No Go or Node.js installation is required for downloaded binaries. kubectl remains required.

## Build from source

On Linux, install Git, Go 1.23+, Node.js 22 with npm, GNU make and kubectl.

```sh
git clone https://github.com/kubetre/kubetree.git
cd kubetree
make test
make build
make run
```

## Security and limitations

KubeTree uses existing Kubernetes credentials and RBAC. It has no cluster mutation endpoints or cluster agent. Keep the server bound to loopback; local processes can access the API. Never share credentials, Secret values or sensitive logs. Dependencies are configured references, not traffic observations. Binaries are unsigned. Linux AMD64 runtime has been verified; other target runtimes remain unverified. See the user guide for details.

## Support and license

Report non-sensitive bugs through [GitHub Issues](https://github.com/kubetre/kubetree/issues). Do not post security-sensitive data. License selection and private security reporting arrangements are pending; do not assume open-source redistribution rights until a license is published.
