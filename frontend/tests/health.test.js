import test from "node:test";
import assert from "node:assert/strict";
import {resourceHealth} from "../src/health.js";

test("Ready Pod", () => {
  const health = resourceHealth({
    kind: "Pod",
    status: {
      phase: "Running",
      conditions: [{type: "Ready", status: "True"}],
      containerStatuses: [{restartCount: 2}]
    }
  });

  assert.equal(health.level, "healthy");
  assert.equal(health.restarts, 2);
});

test("CrashLoopBackOff Pod", () => {
  const health = resourceHealth({
    kind: "Pod",
    status: {
      phase: "Running",
      containerStatuses: [{
        restartCount: 5,
        state: {
          waiting: {reason: "CrashLoopBackOff"}
        }
      }]
    }
  });

  assert.equal(health.level, "unhealthy");
  assert.equal(health.label, "CrashLoopBackOff");
  assert.equal(health.restarts, 5);
});

test("Pending Pod", () => {
  assert.equal(resourceHealth({
    kind: "Pod",
    status: {phase: "Pending"}
  }).level, "warning");
});

test("Completed Pod", () => {
  assert.equal(resourceHealth({
    kind: "Pod",
    status: {phase: "Succeeded"}
  }).level, "completed");
});

test("Healthy Deployment", () => {
  assert.equal(resourceHealth({
    kind: "Deployment",
    spec: {replicas: 3},
    status: {readyReplicas: 3}
  }).level, "healthy");
});

test("Partially ready Deployment", () => {
  assert.equal(resourceHealth({
    kind: "Deployment",
    spec: {replicas: 3},
    status: {readyReplicas: 1}
  }).level, "warning");
});

test("Scaled-to-zero Deployment", () => {
  assert.equal(resourceHealth({
    kind: "Deployment",
    spec: {replicas: 0},
    status: {}
  }).label, "Scaled to zero");
});

test("Completed Job", () => {
  assert.equal(resourceHealth({
    kind: "Job",
    status: {
      conditions: [{type: "Complete", status: "True"}]
    }
  }).level, "completed");
});

test("Failed Job", () => {
  assert.equal(resourceHealth({
    kind: "Job",
    status: {
      conditions: [{type: "Failed", status: "True"}]
    }
  }).level, "unhealthy");
});
