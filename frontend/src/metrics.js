export const metricKinds = new Set([
  "Pod", "Deployment", "ReplicaSet",
  "StatefulSet", "DaemonSet", "Job", "CronJob"
]);

export function quantity(value) {
  if (value == null || value === "") return null;

  const match = String(value).match(
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([eE][+-]?\d+|[a-zA-Z]*)$/
  );

  if (!match) return null;

  const units = {
    "": 1,
    n: 1e-9,
    u: 1e-6,
    m: 1e-3,
    k: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6
  };

  const suffix = match[2];
  const multiplier = /^[eE][+-]?\d+$/.test(suffix)
    ? 10 ** Number(suffix.slice(1))
    : units[suffix];

  const result = Number(match[1]) * multiplier;

  return Number.isFinite(result) && result >= 0
    ? result : null;
}

export function formatCPU(value) {
  if (value == null) return "N/A";
  if (value > 0 && value < 0.00001) return "<0.01m";
  return value >= 1
    ? `${Number(value.toFixed(2))} cores`
    : `${Number((value * 1000).toFixed(2))}m`;
}

export function formatMemory(value) {
  if (value == null) return "N/A";
  if (value >= 1024 ** 3)
    return `${Number((value / 1024 ** 3).toFixed(2))} GiB`;
  return `${Number((value / 1024 ** 2).toFixed(2))} MiB`;
}

export function percentage(usage, target) {
  if (usage == null || target == null || target <= 0)
    return null;
  return Math.round(usage / target * 100);
}

export function resourcePods(resource, children) {
  const pods = [];
  const seen = new Set();

  function visit(x) {
    if (seen.has(x.metadata.uid)) return;
    seen.add(x.metadata.uid);

    if (x.kind === "Pod") {
      pods.push(x);
      return;
    }

    (children.get(x.metadata.uid) || []).forEach(visit);
  }

  visit(resource);
  return pods;
}

export function metricKey(resource) {
  return `${resource.metadata.namespace}/${resource.metadata.name}`;
}

export function metricRows(resource, children, metrics) {
  const rows = [];

  for (const pod of resourcePods(resource, children)) {
    if (["Succeeded", "Failed"].includes(pod.status?.phase))
      continue;

    const metric = metrics.get(metricKey(pod));

    const runningInit = new Set(
      (pod.status?.initContainerStatuses || [])
        .filter(c => c.state?.running)
        .map(c => c.name)
    );

    const containers = [
      ...(pod.spec?.containers || []),
      ...(pod.spec?.initContainers || [])
        .filter(c => runningInit.has(c.name))
    ];

    for (const container of containers) {
      const usage = metric?.containers?.find(
        c => c.name === container.name
      )?.usage;

      rows.push({
        pod: pod.metadata.name,
        namespace: pod.metadata.namespace,
        container: container.name,
        cpu: quantity(usage?.cpu),
        memory: quantity(usage?.memory),
        cpuRequest: quantity(container.resources?.requests?.cpu),
        memoryRequest: quantity(container.resources?.requests?.memory),
        cpuLimit: quantity(container.resources?.limits?.cpu),
        memoryLimit: quantity(container.resources?.limits?.memory)
      });
    }
  }

  return rows;
}

export function summarize(rows, field) {
  const values = rows
    .map(row => row[field])
    .filter(value => value != null);

  return {
    value: values.length
      ? values.reduce((a, b) => a + b, 0)
      : null,
    complete: rows.length > 0 && values.length === rows.length,
    count: values.length,
    total: rows.length
  };
}
