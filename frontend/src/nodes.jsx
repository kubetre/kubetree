import React, {useEffect, useState} from "react";

import {
  quantity,
  formatCPU,
  formatMemory,
  percentage
} from "./metrics.js";

async function readAPI(path, params, signal) {
  const response = await fetch(
    "/api/" + path + "?" + new URLSearchParams(params),
    {
      signal,
      headers: {"X-KubeTree-Local": "1"}
    }
  );

  if (!response.ok) throw Error("Request failed");

  return response.json();
}

function NodeUsage({label, usage, capacity, allocatable, format}) {
  const percent = percentage(usage, allocatable);

  return <div className="metric-card">
    <span className="metric-label">{label}</span>

    <strong className="metric-value">
      {format(usage)}
    </strong>

    <small>Capacity: {format(capacity)}</small>
    <small>Allocatable: {format(allocatable)}</small>

    <div className="metric-utilization-label">
      <span>% of allocatable</span>
      <strong>
        {percent == null ? "N/A" : `${percent}%`}
      </strong>
    </div>

    {percent != null &&
      <div className="metric-track">
        <div
          className={"metric-fill " +
            (percent >= 100 ? "metric-high" :
             percent >= 80 ? "metric-medium" : "")}
          style={{width: `${Math.min(percent, 100)}%`}}
        />
      </div>}
  </div>;
}

export function NodesPanel({context, interval, refresh}) {
  const [inventory, setInventory] = useState({
    loading: true, items: []
  });

  const [metrics, setMetrics] = useState({
    loading: true, items: []
  });


  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    setInventory({loading: true, items: []});

    readAPI("nodes", {context}, controller.signal)
      .then(data => {
        if (active)
          setInventory({...data, loading: false});
      })
      .catch(() => {
        if (active)
          setInventory({
            available: false,
            loading: false,
            items: [],
            message: "Node inventory request failed."
          });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [context, refresh]);

  useEffect(() => {
    let active = true;
    let timer;
    const controller = new AbortController();

    async function read() {
      try {
        const data = await readAPI("metrics", {
          context,
          namespace: "*",
          scope: "nodes"
        }, controller.signal);

        if (!active) return;

        setMetrics({
          ...data,
          loading: false,
          updatedAt: data.available ? new Date() : null
        });

        if (active && interval > 0) {
          if (data.available)
            timer = setTimeout(read, interval * 1000);
          else if (data.retryable)
            timer = setTimeout(
              read, Math.max(interval, 30) * 1000
            );
        }

      } catch {
        if (active)
          setMetrics({
            available: false,
            loading: false,
            items: [],
            message: "Node metrics request failed.",
            retryable: true
          });

        if (active && interval > 0)
          timer = setTimeout(
            read, Math.max(interval, 30) * 1000
          );
      }
    }

    read();

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [context, interval, refresh]);

  const nodes = new Map(
    (inventory.items || []).map(n => [n.metadata.name, n])
  );

  const usage = new Map(
    (metrics.items || []).map(n => [n.metadata.name, n])
  );

  const names = [...new Set([
    ...nodes.keys(), ...usage.keys()
  ])].sort();

  const ready = [...nodes.values()].filter(n =>
    n.status?.conditions?.some(c =>
      c.type === "Ready" && c.status === "True"
    )
  ).length;

  return <section className="nodes-panel">
    <div className="nodes-heading">
      <h2>Cluster Nodes</h2>
    </div>

    <p className="hint">
      Cluster-wide · {context}
    </p>

    <div className="metric-grid">
      <div className="metric-card">
        <span className="metric-label">Discovered nodes</span>
        <strong className="metric-value">
          {names.length || (inventory.available ? 0 : "N/A")}
        </strong>
      </div>

      <div className="metric-card">
        <span className="metric-label">Ready nodes</span>
        <strong className="metric-value">
          {inventory.available
            ? `${ready}/${nodes.size}` : "N/A"}
        </strong>
      </div>

      <div className="metric-card">
        <span className="metric-label">Metrics retrieved</span>
        <strong>
          {metrics.updatedAt?.toLocaleTimeString() || "N/A"}
        </strong>
        <small>
          {metrics.loading ? "Loading…" :
           !metrics.available
             ? interval && metrics.retryable
               ? "Unavailable · retrying"
               : interval
                 ? "Unavailable · polling stopped"
                 : "Unavailable"
             :
           interval ? `Auto-refresh: ${interval}s` : "Manual"}
        </small>
      </div>
    </div>

    {inventory.loading && <p>Loading Node inventory…</p>}
    {metrics.loading && <p>Loading Node metrics…</p>}

    {!inventory.loading && !inventory.available &&
      <p className="metrics-notice">{inventory.message}</p>}

    {!metrics.loading && !metrics.available &&
      <p className="metrics-notice">{metrics.message}</p>}

    {names.map(name => {
      const node = nodes.get(name);
      const metric = usage.get(name);

      const status = node?.status?.conditions?.find(
        c => c.type === "Ready"
      )?.status;

      return <div className="node-metric-card" key={name}>
        <div className="nodes-heading">
          <h3>{name}</h3>

          <span className={"health-status health-" +
            (status === "True" ? "healthy" :
             status === "False" ? "unhealthy" : "unknown")}>
            <span className="health-dot"/>
            {status === "True" ? "Ready" :
             status === "False" ? "Not Ready" : "Unknown"}
          </span>
        </div>

        <div className="metric-grid">
          <NodeUsage
            label="CPU usage"
            usage={quantity(metric?.usage?.cpu)}
            capacity={quantity(node?.status?.capacity?.cpu)}
            allocatable={quantity(node?.status?.allocatable?.cpu)}
            format={formatCPU}
          />

          <NodeUsage
            label="Memory usage"
            usage={quantity(metric?.usage?.memory)}
            capacity={quantity(node?.status?.capacity?.memory)}
            allocatable={quantity(node?.status?.allocatable?.memory)}
            format={formatMemory}
          />
        </div>

        <p className="hint">
          Sample: {metric?.timestamp
            ? new Date(metric.timestamp).toLocaleString()
            : "N/A"}
          {" · "}
          Window: {metric?.window || "N/A"}
        </p>
      </div>;
    })}

    <p className="hint">
      Utilization compares measured Node usage against
      allocatable resources. Node usage may include system
      processes. Readiness and capacity update when Node
      inventory is refreshed.
    </p>
  </section>;
}
