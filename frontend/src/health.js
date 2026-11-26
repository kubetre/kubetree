export function resourceHealth(resource) {
  const s = resource.status || {};
  const result = (level, label) => ({level, label});

  if (resource.kind === "Pod") {
    const containers = [
      ...(s.initContainerStatuses || []),
      ...(s.containerStatuses || [])
    ];

    const restarts = containers.reduce(
      (total, c) => total + (c.restartCount || 0), 0
    );

    const failureReasons = [
      "CrashLoopBackOff",
      "ImagePullBackOff",
      "ErrImagePull",
      "CreateContainerConfigError",
      "CreateContainerError",
      "RunContainerError",
      "OOMKilled"
    ];

    const failure = containers
      .map(c => c.state?.waiting?.reason ||
        c.state?.terminated?.reason)
      .find(reason => failureReasons.includes(reason));

    let health;

    if (s.phase === "Failed" || failure) {
      health = result("unhealthy", failure || s.reason || "Failed");
    } else if (s.phase === "Succeeded") {
      health = result("completed", "Completed");
    } else if (s.phase === "Running") {
      const ready = s.conditions?.find(c => c.type === "Ready");
      health = ready?.status === "True"
        ? result("healthy", "Running")
        : result("warning", "Not ready");
    } else if (s.phase === "Pending") {
      health = result("warning", "Pending");
    } else {
      health = result("unknown", s.phase || "Unknown");
    }

    return {...health, restarts};
  }

  if (["Deployment", "ReplicaSet", "StatefulSet"].includes(resource.kind)) {
    const total = s.replicas;
    const ready = s.readyReplicas || 0;

    if (s.conditions?.some(c =>
      (c.type === "ReplicaFailure" && c.status === "True") ||
      c.reason === "ProgressDeadlineExceeded"
    )) {
      return result("unhealthy", "Workload failed");
    }

    if (total == null) return result("unknown", "Unknown");
    if (total === 0) return result("unknown", "No replicas");

    return result(
      ready >= total ? "healthy" : "warning",
      `${ready}/${total} Ready`
    );
  }

  if (resource.kind === "DaemonSet") {
    const total = s.desiredNumberScheduled;
    const ready = s.numberReady || 0;

    if (total == null) return result("unknown", "Unknown");
    if (total === 0) return result("unknown", "Not scheduled");

    return result(
      ready >= total ? "healthy" : "warning",
      `${ready}/${total} Ready`
    );
  }

  if (resource.kind === "Job") {
    if (s.conditions?.some(c =>
      c.type === "Failed" && c.status === "True"
    )) return result("unhealthy", "Failed");

    if (s.conditions?.some(c =>
      c.type === "Complete" && c.status === "True"
    )) return result("completed", "Completed");

    if (s.active) return result("healthy", "Active");

    return result("unknown", "Waiting");
  }

  if (resource.kind === "CronJob") {
    return result("unknown", s.active?.length ? "Active jobs" : "Scheduled");
  }

  return result("unknown", "Not applicable");
}
