import test from "node:test";
import assert from "node:assert/strict";

import {
  quantity,
  formatCPU,
  formatMemory,
  percentage,
  resourcePods,
  metricRows,
  summarize,
  sampleRange
} from "../src/metrics.js";

test("CPU quantity conversion", () => {
  assert.equal(quantity("500m"), 0.5);
  assert.equal(quantity("2"), 2);
  assert.equal(quantity("1000000n"), 0.001);
  assert.ok(Math.abs(quantity("100u") - 0.0001) < 1e-12);
});

test("Memory quantity conversion", () => {
  assert.equal(quantity("1Ki"), 1024);
  assert.equal(quantity("128Mi"), 128 * 1024 ** 2);
  assert.equal(quantity("2Gi"), 2 * 1024 ** 3);
  assert.equal(quantity("1G"), 1000000000);
});

test("Invalid and missing quantities", () => {
  for (const value of [
    null, undefined, "", "invalid", "-1", "10XYZ"
  ]) {
    assert.equal(quantity(value), null);
  }

  assert.equal(quantity("0"), 0);
});

test("CPU and memory formatting", () => {
  assert.equal(formatCPU(null), "N/A");
  assert.equal(formatCPU(0), "0m");
  assert.equal(formatCPU(0.000001), "<0.01m");
  assert.equal(formatCPU(0.5), "500m");
  assert.equal(formatMemory(1024 ** 3), "1 GiB");
  assert.equal(formatMemory(null), "N/A");
});

test("Utilization calculations", () => {
  assert.equal(percentage(0.5, 1), 50);
  assert.equal(percentage(2, 1), 200);
  assert.equal(percentage(0, 1), 0);
  assert.equal(percentage(1, 0), null);
  assert.equal(percentage(null, 1), null);
});

test("Complete and partial aggregation", () => {
  assert.deepEqual(
    summarize([{cpu: 1}, {cpu: 2}], "cpu"),
    {value: 3, complete: true, count: 2, total: 2}
  );

  assert.deepEqual(
    summarize([{cpu: 1}, {cpu: null}], "cpu"),
    {value: 1, complete: false, count: 1, total: 2}
  );

  assert.equal(summarize([], "cpu").value, null);
});

test("Workload traversal avoids duplicate Pods", () => {
  const deployment = {
    kind: "Deployment",
    metadata: {uid: "deployment"}
  };

  const pod = {
    kind: "Pod",
    metadata: {uid: "pod"}
  };

  const children = new Map([
    ["deployment", [pod, pod, deployment]]
  ]);

  assert.equal(resourcePods(deployment, children).length, 1);
});

test("Container metrics and resource requests", () => {
  const pod = {
    kind: "Pod",
    metadata: {
      uid: "pod",
      name: "web",
      namespace: "demo"
    },
    status: {phase: "Running"},
    spec: {
      containers: [{
        name: "nginx",
        resources: {
          requests: {cpu: "100m", memory: "64Mi"},
          limits: {cpu: "500m", memory: "128Mi"}
        }
      }]
    }
  };

  const metrics = new Map([
    ["demo/web", {
      timestamp: "2026-01-01T12:00:00Z",
      containers: [{
        name: "nginx",
        usage: {cpu: "50m", memory: "32Mi"}
      }]
    }]
  ]);

  const rows = metricRows(pod, new Map(), metrics);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].cpu, 0.05);
  assert.equal(rows[0].cpuRequest, 0.1);
  assert.equal(rows[0].memory, 32 * 1024 ** 2);
  assert.equal(percentage(rows[0].cpu, rows[0].cpuRequest), 50);

  pod.status.phase = "Succeeded";

  assert.equal(
    metricRows(pod, new Map(), metrics).length, 0
  );
});

test("Missing metrics do not become zero usage", () => {
  const pod = {
    kind: "Pod",
    metadata: {
      uid: "pod",
      name: "web",
      namespace: "demo"
    },
    spec: {containers: [{name: "nginx"}]}
  };

  const rows = metricRows(pod, new Map(), new Map());

  assert.equal(rows[0].cpu, null);
  assert.equal(rows[0].memory, null);
});

test("Sample timestamp range", () => {
  const first = "2026-01-01T12:00:00Z";
  const last = "2026-01-01T12:00:05Z";

  assert.deepEqual(
    sampleRange([
      {timestamp: first, cpu: 1},
      {timestamp: last, memory: 1},
      {timestamp: "invalid", cpu: 1},
      {timestamp: null, cpu: null}
    ]),
    {
      oldest: Date.parse(first),
      newest: Date.parse(last)
    }
  );

  assert.equal(sampleRange([]), null);
});
