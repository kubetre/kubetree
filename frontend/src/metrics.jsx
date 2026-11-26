import React from "react";

import {
  metricKinds,
  metricRows,
  summarize,
  percentage,
  formatCPU,
  formatMemory
} from "./metrics.js";

function display(summary, format, fallback = "N/A") {
  if (summary.value == null) return fallback;
  return format(summary.value) +
    (summary.complete ? "" : " (partial)");
}

function Utilization({label, usage, target}) {
  const percent = usage.complete && target.complete
    ? percentage(usage.value, target.value)
    : null;

  return <div className="metric-utilization">
    <div className="metric-utilization-label">
      <span>{label}</span>
      <strong>{percent == null ? "N/A" : `${percent}%`}</strong>
    </div>
    {percent != null &&
      <div className="metric-track">
        <div
          className={"metric-fill " +
            (percent >= 100 ? "metric-high" :
             percent >= 80 ? "metric-medium" : "")}
          style={{width: `${Math.min(percent, 100)}%`}}
        />
      </div>
    }
  </div>;
}

function MetricCard({title, rows, field, format}) {
  const usage = summarize(rows, field);
  const request = summarize(rows, field + "Request");
  const limit = summarize(rows, field + "Limit");

  return <div className="metric-card">
    <span className="metric-label">{title}</span>
    <strong className="metric-value">
      {display(usage, format)}
    </strong>

    <small>Request: {display(request, format, "Not set")}</small>
    <small>Limit: {display(limit, format, "Not set")}</small>

    <Utilization
      label="% of request"
      usage={usage}
      target={request}
    />

    <Utilization
      label="% of limit"
      usage={usage}
      target={limit}
    />
  </div>;
}

export function MetricSummary({resource, children, metrics}) {
  if (!metricKinds.has(resource.kind)) return null;

  const rows = metricRows(resource, children, metrics);
  const cpu = summarize(rows, "cpu");
  const memory = summarize(rows, "memory");

  return <small className="metric-inline">
    CPU: {display(cpu, formatCPU)}
    {" · "}
    Mem: {display(memory, formatMemory)}
  </small>;
}

export function MetricsPanel({
  resource, children, metrics, state
}) {
  const rows = metricRows(resource, children, metrics);

  return <div className="metrics-panel">

    {state.loading &&
      <p className="hint">Loading metrics…</p>}

    {!state.loading && !state.available &&
      <div className="metrics-notice">
        {state.message || "Metrics unavailable"}
      </div>}

    {!rows.length &&
      <p className="hint">No active container inventory available.</p>}

    <div className="metric-grid">
      <MetricCard
        title="CPU usage"
        rows={rows}
        field="cpu"
        format={formatCPU}
      />

      <MetricCard
        title="Memory usage"
        rows={rows}
        field="memory"
        format={formatMemory}
      />
    </div>

    <h4>Container metrics</h4>

    {rows.length > 0 &&
      <div className="metric-table-wrap">
        <table className="metric-table">
          <thead>
            <tr>
              <th>Pod / Container</th>
              <th>CPU usage</th>
              <th>CPU request</th>
              <th>CPU limit</th>
              <th>Memory usage</th>
              <th>Memory request</th>
              <th>Memory limit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row =>
              <tr key={`${row.namespace}/${row.pod}/${row.container}`}>
                <td>
                  <strong>{row.container}</strong>
                  <small>{row.namespace}/{row.pod}</small>
                </td>
                <td>{formatCPU(row.cpu)}</td>
                <td>{row.cpuRequest == null ? "Not set" : formatCPU(row.cpuRequest)}</td>
                <td>{row.cpuLimit == null ? "Not set" : formatCPU(row.cpuLimit)}</td>
                <td>{formatMemory(row.memory)}</td>
                <td>{row.memoryRequest == null ? "Not set" : formatMemory(row.memoryRequest)}</td>
                <td>{row.memoryLimit == null ? "Not set" : formatMemory(row.memoryLimit)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>}

    <p className="hint">
      Metrics are sampled snapshots. Use the main Refresh
      button to retrieve updated values. Partial values
      represent only containers with available data.
      Totals represent discovered active containers,
      not scheduler-calculated Pod reservations.
    </p>
  </div>;
}
