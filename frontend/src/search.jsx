import {ObjectDetails} from "./dependencies.jsx";
import React, {useEffect, useRef, useState} from "react";

async function searchAPI(path, params, signal) {
  const response = await fetch(
    `/api/${path}?${new URLSearchParams(params)}`,
    {
      headers: {"X-KubeTree-Local": "1"},
      cache: "no-store",
      signal
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}


export function SearchPanel({
  context,
  namespace,
  onSelect,
  onOpenResource,
  inventory=[]
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [types, setTypes] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [inspected, setInspected] = useState(null);
  const [tab, setTab] = useState("Details");
  const request = useRef(null);

  useEffect(() => {
    const controller = new AbortController();

    searchAPI("search/types", {context}, controller.signal)
      .then(setTypes)
      .catch(e => {
        if (e.name !== "AbortError") setError(e.message);
      });

    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [context, namespace]);

  async function search(event) {
    event.preventDefault();

    if (!query.trim() && !kind) return;

    request.current?.abort();

    const controller = new AbortController();
    request.current = controller;

    setBusy(true);
    setError("");
    setResult(null);
    setSelected(null);
    setInspected(null);

    try {
      const data = await searchAPI("search", {
        context,
        namespace,
        q: query.trim(),
        kind
      }, controller.signal);

      if (!controller.signal.aborted) setResult(data);
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      if (request.current === controller) setBusy(false);
    }
  }

  return <section className="global-search">
    <form className="global-search-controls" onSubmit={search}>
      <input
        className="global-search-input"
        placeholder="Search any Kubernetes resource..."
        value={query}
        maxLength={256}
        onChange={e => setQuery(e.target.value)}
      />

      <select value={kind} onChange={e => setKind(e.target.value)}>
        <option value="">All resource kinds</option>
        {types.map(t =>
          <option
            key={`${t.resource}:${t.apiVersion}`}
            value={t.resource}
          >
            {t.kind} ({t.apiVersion})
          </option>
        )}
      </select>

      <button
        type="submit"
        disabled={busy || (!query.trim() && !kind)}
      >
        Search
      </button>

      <button
        type="button"
        disabled={!busy}
        onClick={() => request.current?.abort()}
      >
        Cancel
      </button>

      <button
        type="button"
        onClick={()=>{
          request.current?.abort();
          setQuery("");
          setKind("");
          setResult(null);
          setSelected(null);
          setInspected(null);
          setError("");
          setBusy(false);
        }}
      >
        Clear
      </button>
    </form>

    <p className="global-search-summary">
      Scope: {namespace === "*" ? "All namespaces" : namespace}
      {" · "}Includes cluster-scoped resources
    </p>

    {busy && <p>Searching Kubernetes resources...</p>}
    {error && <p role="alert">{error}</p>}


    {inspected && <div className="search-inspector">
      <div className="search-inspector-header">
        <h3>{inspected.kind}: {inspected.name}</h3>
        <button onClick={() => {
          setInspected(null);
          setSelected(null);
        }}>Close</button>
      </div>

      <p className="global-search-summary">
        {inspected.namespace || "Cluster-wide"}
        {" · "}{inspected.apiVersion}
      </p>


      <div className="view-controls">
        {inventory.some(x=>
          x.metadata.uid===inspected.uid &&
          x.kind===inspected.kind &&
          x.metadata.namespace===inspected.namespace &&
          x.metadata.name===inspected.name
        ) && <>
          <button onClick={()=>
            onOpenResource(inspected,"list")
          }>Resource Tree</button>

          <button onClick={()=>
            onOpenResource(inspected,"graph")
          }>Graph View</button>

          <button onClick={()=>
            onOpenResource(inspected,"dep")
          }>Dependencies</button>
        </>}

        {["Details", "YAML"].map(t =>
          <button
            key={t}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >{t}</button>
        )}
      </div>

      {({
        Pod:"pods",
        Deployment:"deployments.apps",
        ReplicaSet:"replicasets.apps",
        StatefulSet:"statefulsets.apps",
        DaemonSet:"daemonsets.apps",
        Job:"jobs.batch",
        CronJob:"cronjobs.batch",
        Secret:"secrets",
        ConfigMap:"configmaps",
        Service:"services",
        Ingress:"ingresses.networking.k8s.io",
        PersistentVolumeClaim:"persistentvolumeclaims",
        PersistentVolume:"persistentvolumes",
        ServiceAccount:"serviceaccounts",
        HorizontalPodAutoscaler:"horizontalpodautoscalers.autoscaling",
        PodDisruptionBudget:"poddisruptionbudgets.policy",
        NetworkPolicy:"networkpolicies.networking.k8s.io",
        Certificate:"certificates.cert-manager.io",
        Issuer:"issuers.cert-manager.io",
        ClusterIssuer:"clusterissuers.cert-manager.io"
      })[inspected.kind] === inspected.resource
        ? <ObjectDetails
            key={selected+":"+tab}
            context={context}
            resource={{
              kind: inspected.kind,
              metadata: {
                name: inspected.name,
                namespace: inspected.namespace,
                uid: inspected.uid
              }
            }}
            yaml={tab === "YAML"}
          />
        : <p>Generic resource inspection is not yet connected.</p>
      }
    </div>}

    {result && <>
      <p className="global-search-summary">
        {result.items.length} matches
        {" · "}{result.scanned}/{result.total} resource types scanned
        {result.limited && " · Result limit reached"}
      </p>

      {!!result.warnings.length && <details>
        <summary>
          {result.warnings.length} search warnings
        </summary>
        {result.warnings.map((warning, i) =>
          <p key={i}>{warning}</p>
        )}
      </details>}

      <div className="global-search-table-wrap">
        <table className="global-search-table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Name</th>
              <th>Namespace</th>
              <th>API version</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {result.items.map(item => {
              const key = [
                item.resource,
                item.apiVersion,
                item.namespace,
                item.name
              ].join(":");

              return <tr
                key={key}
                className={selected === key ? "search-selected" : ""}
              >
                <td>{item.kind}</td>
                <td>{item.name}</td>
                <td>{item.namespace || "Cluster-wide"}</td>
                <td>{item.apiVersion}</td>
                <td>
                  <button onClick={() => {
                    setSelected(key);
                    setInspected(item);
                    setTab("Details");
                    onSelect?.(item);
                  }}>Inspect</button>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>

      {!result.items.length && <p>No matching resources found.</p>}
    </>}
  </section>;
}
