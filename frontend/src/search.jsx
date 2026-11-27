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
    const body = await response.text();
    let message = body;
    try { message = JSON.parse(body).error || body; } catch {}
    throw new Error(message);
  }

  return response.json();
}


function GenericDetails({context, resource, yaml}) {
  const [state, setState] = useState({loading:true});
  useEffect(() => {
    const controller = new AbortController();
    setState({loading:true});
    searchAPI("search/object", {
      context, resource:resource.resource, apiVersion:resource.apiVersion,
      namespace:resource.namespace || "", name:resource.name,
      uid:resource.uid || "", format:yaml ? "yaml" : "json"
    }, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({data});
    }).catch(e => {
      if (!controller.signal.aborted) setState({error:e.message});
    });
    return () => controller.abort();
  }, [context, resource, yaml]);
  if (state.loading) return <p role="status">Loading resource…</p>;
  if (state.error) return <p className="error" role="alert">{state.error}</p>;
  return <pre>{yaml ? state.data.yaml : JSON.stringify(state.data.object,null,2)}</pre>;
}

export function SearchPanel({
  context,
  namespace,
  onSelect,
  onOpenResource,
  inventory=[],
  active=true
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
  const timer = useRef(null);
  const inspector = useRef(null);
  const [waiting, setWaiting] = useState(false);

  function cancelSearch() {
    clearTimeout(timer.current);
    timer.current = null;
    request.current?.abort();
    request.current = null;
    setWaiting(false);
    setBusy(false);
  }

  function changeSearch(nextQuery, nextKind) {
    cancelSearch();
    setQuery(nextQuery);
    setKind(nextKind);
    setResult(null);
    setError("");
    setSelected(null);
    setInspected(null);
    if (nextQuery.trim().length < 2 && (nextQuery.trim() || !nextKind)) return;
    setWaiting(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setWaiting(false);
      search(null, nextQuery, nextKind);
    }, 1000);
  }

  useEffect(() => {
    if (inspected) inspector.current?.scrollIntoView({block:"start", behavior:"auto"});
  }, [inspected]);

  useEffect(() => {
    if(!active){cancelSearch();setInspected(null);setSelected(null);return;}
    const controller = new AbortController();

    searchAPI("search/types", {context}, controller.signal)
      .then(setTypes)
      .catch(e => {
        if (e.name !== "AbortError") setError(e.message);
      });

    return () => {
      controller.abort();
      clearTimeout(timer.current);
      request.current?.abort();
      request.current = null;
    };
  }, [context, namespace, active]);

  useEffect(() => {
    if (!inspected) return;
    function escape(e) {
      if (e.key === "Escape") { setInspected(null); setSelected(null); }
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [inspected]);

  async function search(event, text=query, resourceKind=kind) {
    event?.preventDefault();
    if (text.trim().length < 2 && (text.trim() || !resourceKind)) return;
    cancelSearch();

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
        q: text.trim(),
        kind: resourceKind
      }, controller.signal);

      if (!controller.signal.aborted) setResult(data);
    } catch (e) {
      if (!controller.signal.aborted && request.current === controller) setError(e.message);
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
        onChange={e => changeSearch(e.target.value, kind)}
      />

      <select value={kind} onChange={e => changeSearch(query, e.target.value)}>
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

      <button type="submit" hidden aria-hidden="true" tabIndex={-1}>Search</button>
      {(busy || waiting) && <button type="button" onClick={cancelSearch}>Cancel</button>}

      <button
        type="button"
        onClick={()=>{
          cancelSearch();
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

    {waiting && <p role="status">Waiting for typing to finish…</p>}
    {busy && <p role="status">Searching Kubernetes resources...</p>}
    {!busy && !waiting && query.trim().length === 1 && <p>Type at least two characters to search.</p>}
    {error && <p role="alert">{error}</p>}


    {inspected && <div className="search-inspector" ref={inspector}>
      <div className="search-inspector-header">
        <h3>{inspected.kind}: {inspected.name}</h3>
        <button type="button" aria-label="Close inspector" title="Close inspector" onClick={() => {
          setInspected(null);
          setSelected(null);
        }}>×</button>
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
        : <GenericDetails key={selected+":"+tab} context={context} resource={inspected} yaml={tab === "YAML"}/>
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
