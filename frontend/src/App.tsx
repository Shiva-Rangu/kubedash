import React, { useEffect, useState } from 'react';

type Section =
  | 'overview'
  | 'workloads'
  | 'gitops'
  | 'helm'
  | 'governance'
  | 'security'
  | 'netstorage'
  | 'plugins'
  | 'terminal'
  | 'events'
  | 'iam'
  | 'ai'
  | 'yaml';

export default function App() {
  const [section, setSection] = useState<Section>('overview');
  const [activeCluster, setActiveCluster] = useState('prod-us-east-eks');
  const [namespace, setNamespace] = useState('default');
  const [bannerMsg, setBannerMsg] = useState('');

  const [overview, setOverview] = useState<any>({
    nodeCount: 3, namespaceCount: 4, totalPods: 4, monthlyCostEst: '$1,368.00 / mo',
    namespaces: ['default', 'kube-system', 'gitops', 'payments'],
    clusters: [], nodes: [], events: [], projects: []
  });

  const [pods, setPods] = useState<any[]>([]);
  const [deployments, setDeployments] = useState<any[]>([]);
  const [iamData, setIamData] = useState<any>({
    users: [], rbacRoles: [], ldapConfig: {}, auditLogs: [], ssoProviders: [], syslogServer: ''
  });
  const [gitopsData, setGitopsData] = useState<any>({ apps: [], credentials: [], itsmWindowOpen: true, enforceGitOnly: false });
  const [helmReleases, setHelmReleases] = useState<any[]>([]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [imageScans, setImageScans] = useState<any[]>([]);
  const [netStorage, setNetStorage] = useState<any>({ pvcs: [], portForwards: [] });
  const [plugins, setPlugins] = useState<any[]>([]);

  const [selectedPodLogs, setSelectedPodLogs] = useState<{ pod: string; logs: string } | null>(null);
  const [execPod, setExecPod] = useState('api-gateway-7f8b9c-x92k1');
  const [execInput, setExecInput] = useState('kubectl get pods');
  const [terminalHistory, setTerminalHistory] = useState<string[]>([
    'Connected to container runtime via WebSocket SPDY executor...',
    'Type "kubectl get pods" or any shell command below.'
  ]);

  const [aiPrompt, setAiPrompt] = useState('Why is payment-worker crashing?');
  const [aiChat, setAiChat] = useState<{ role: string; text: string }[]>([
    { role: 'assistant', text: 'Hello! Ask me about CrashLoopBackOff pods, CVE vulnerabilities, or cluster cost optimization.' }
  ]);

  const [newClusterName, setNewClusterName] = useState('');
  const [newClusterProvider, setNewClusterProvider] = useState('Talos Omni');
  const [newHelm, setNewHelm] = useState({ releaseName: 'cert-manager', chart: 'jetstack/cert-manager', version: '1.15.3', namespace: 'kube-system' });
  const [newTunnel, setNewTunnel] = useState({ service: 'redis-headless', namespace: 'default', localPort: 6379, targetPort: 6379 });

  // Batch 3 State: Guided RBAC Role Builder, User Creation Sources & Custom Plugin Form
  const [newUser, setNewUser] = useState({
    username: '', team: 'Platform-Engineering', role: 'DevOps-Lead', authType: 'OIDC / Okta SSO', sourceType: 'Guided Form'
  });
  const [roleBuilder, setRoleBuilder] = useState({
    name: 'sre-pod-operator',
    scope: 'ClusterRole',
    resources: ['pods', 'deployments', 'services'],
    verbs: ['get', 'list', 'watch', 'create', 'delete']
  });
  const [newPlugin, setNewPlugin] = useState({
    name: '', vendor: 'Internal Platform Team', version: 'v1.0.0', category: 'Custom', description: ''
  });

  const [yamlInput, setYamlInput] = useState(
`apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-service
  namespace: default
spec:
  replicas: 2`
  );

  const flash = (msg: string) => {
    setBannerMsg(msg);
    setTimeout(() => setBannerMsg(''), 4000);
  };

  const refreshAll = async () => {
    try {
      const [ovRes, podRes, depRes, iamRes, gitRes, helmRes, govRes, secRes, nsRes, plugRes] = await Promise.all([
        fetch('/api/overview'),
        fetch(`/api/pods?namespace=${namespace}`),
        fetch(`/api/deployments?namespace=${namespace}`),
        fetch('/api/iam'),
        fetch('/api/gitops'),
        fetch('/api/helm'),
        fetch('/api/governance'),
        fetch('/api/security'),
        fetch('/api/network-storage'),
        fetch('/api/plugins'),
      ]);
      if (ovRes.ok) setOverview(await ovRes.json());
      if (podRes.ok) setPods((await podRes.json()) || []);
      if (depRes.ok) setDeployments((await depRes.json()) || []);
      if (iamRes.ok) setIamData(await iamRes.json());
      if (gitRes.ok) setGitopsData(await gitRes.json());
      if (helmRes.ok) setHelmReleases((await helmRes.json()) || []);
      if (govRes.ok) setPolicies((await govRes.json()) || []);
      if (secRes.ok) setImageScans((await secRes.json()) || []);
      if (nsRes.ok) setNetStorage(await nsRes.json());
      if (plugRes.ok) setPlugins((await plugRes.json()) || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refreshAll();
    const timer = setInterval(refreshAll, 5000);
    return () => clearInterval(timer);
  }, [namespace]);

  const controlDeployment = async (name: string, action: 'scale' | 'restart', replicas = 1) => {
    const res = await fetch('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, namespace, name, replicas }),
    });
    const data = await res.json();
    if (!res.ok) flash(data.error);
    refreshAll();
  };

  const gitopsAction = async (payload: any) => {
    const res = await fetch('/api/gitops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) flash(data.error);
    else flash('GitOps configuration updated');
    refreshAll();
  };

  const toggleArrayItem = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item];

  const createRBACRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleBuilder.name) return;
    await fetch('/api/iam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_role',
        roleDef: {
          name: roleBuilder.name,
          scope: roleBuilder.scope,
          apiGroups: ['', 'apps', 'batch'],
          resources: roleBuilder.resources,
          verbs: roleBuilder.verbs,
        },
      }),
    });
    flash(`Created RBAC ${roleBuilder.scope}: ${roleBuilder.name}`);
    refreshAll();
  };

  const provisionUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.username) return;
    await fetch('/api/iam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_user', user: newUser }),
    });
    setNewUser({ ...newUser, username: '' });
    flash(`Provisioned user ${newUser.username} via ${newUser.sourceType}`);
    refreshAll();
  };

  const triggerADSync = async () => {
    await fetch('/api/iam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ad_sync' }),
    });
    flash('Active Directory LDAP Group & User Sync completed!');
    refreshAll();
  };

  const togglePlugin = async (id: string) => {
    await fetch('/api/plugins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', id }),
    });
    flash('Updated Plugin status');
    refreshAll();
  };

  const registerCustomPlugin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlugin.name) return;
    await fetch('/api/plugins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register', customPlugin: newPlugin }),
    });
    setNewPlugin({ name: '', vendor: 'Internal Platform Team', version: 'v1.0.0', category: 'Custom', description: '' });
    flash(`Registered & enabled plugin: ${newPlugin.name}`);
    refreshAll();
  };

  const generatedRBACYaml = `apiVersion: rbac.authorization.k8s.io/v1
kind: ${roleBuilder.scope}
metadata:
  name: ${roleBuilder.name}
rules:
- apiGroups: ["", "apps", "batch"]
  resources: [${roleBuilder.resources.map((r) => `"${r}"`).join(', ')}]
  verbs: [${roleBuilder.verbs.map((v) => `"${v}"`).join(', ')}]`;

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      {/* Left Enterprise Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between shrink-0">
        <div>
          <div className="p-4 border-b border-slate-800 flex items-center gap-2.5">
            <div className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-bold text-base tracking-tight">KubePlatform IDP v3</span>
          </div>
          <nav className="p-2.5 space-y-1 text-xs">
            {[
              { id: 'overview', label: '🌐 Fleet, Cloud & Nodes' },
              { id: 'workloads', label: '📦 Workloads & Pods' },
              { id: 'gitops', label: '🚀 GitOps & ITSM Gates' },
              { id: 'helm', label: '⎈ Helm Chart Catalog' },
              { id: 'governance', label: '🛡️ Fleet Governance & Drift' },
              { id: 'security', label: '🔒 Security CVEs & Registries' },
              { id: 'netstorage', label: '🔌 Storage & Port-Forwarding' },
              { id: 'plugins', label: '🧩 Plugins & Extensions' },
              { id: 'iam', label: '🔐 Identity, AD Sync & RBAC' },
              { id: 'terminal', label: '💻 Container Terminal (Exec)' },
              { id: 'events', label: '⚡ Cluster Events Stream' },
              { id: 'ai', label: '🤖 AI Troubleshooter' },
              { id: 'yaml', label: '📝 Dynamic YAML Editor' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id as Section)}
                className={`w-full text-left px-3 py-2 rounded-lg font-medium transition ${
                  section === item.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="p-3.5 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
          <div>ITSM Gate: <span className={gitopsData.itsmWindowOpen ? 'text-emerald-400' : 'text-rose-400'}>{gitopsData.itsmWindowOpen ? 'OPEN' : 'FROZEN'}</span></div>
          <div>Active Plugins: <span className="text-indigo-300">{plugins.filter((p) => p.installed).length} Enabled</span></div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        <header className="bg-slate-900/70 border-b border-slate-800 px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <select value={activeCluster} onChange={(e) => setActiveCluster(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs font-medium text-indigo-300">
              {overview.clusters?.map((c: any) => <option key={c.id} value={c.name}>{c.name} ({c.provider})</option>)}
            </select>
            <select value={namespace} onChange={(e) => setNamespace(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs">
              {overview.namespaces?.map((ns: string) => <option key={ns} value={ns}>ns: {ns}</option>)}
            </select>
          </div>
          {bannerMsg && <div className="bg-indigo-600/30 border border-indigo-500 text-indigo-200 px-3 py-1 rounded text-xs">{bannerMsg}</div>}
          <span className="text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 px-3 py-1 rounded-full">
            Fleet Cost: {overview.monthlyCostEst}
          </span>
        </header>

        <main className="p-6 space-y-6 overflow-auto flex-1">
          {/* 1. OVERVIEW (+ Active Plugin Widgets) */}
          {section === 'overview' && (
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-semibold text-sm">Multi-Cluster & Talos Omni Cloud Provisioning</h2>
                  <form onSubmit={async (e) => { e.preventDefault(); if (!newClusterName) return; await fetch('/api/clusters', { method: 'POST', body: JSON.stringify({ name: newClusterName, provider: newClusterProvider }) }); setNewClusterName(''); refreshAll(); }} className="flex gap-2">
                    <input placeholder="Cluster name..." value={newClusterName} onChange={(e) => setNewClusterName(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs" />
                    <select value={newClusterProvider} onChange={(e) => setNewClusterProvider(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs">
                      <option>Talos Omni</option><option>AWS EKS</option><option>Azure AKS</option><option>Google GKE</option><option>Kubeconfig Import</option>
                    </select>
                    <button className="bg-indigo-600 px-3 py-1 rounded text-xs font-medium">+ Provision / Import</button>
                  </form>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {overview.clusters?.map((c: any) => (
                    <div key={c.id} className="bg-slate-950 border border-slate-800 p-4 rounded-lg flex justify-between items-center">
                      <div>
                        <div className="text-xs text-indigo-400">{c.provider}</div>
                        <div className="font-bold text-sm">{c.name}</div>
                        <div className="text-xs text-slate-400">{c.version} • {c.nodes} Nodes</div>
                      </div>
                      <span className="bg-emerald-500/20 text-emerald-300 text-xs px-2 py-0.5 rounded">{c.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {overview.nodes?.map((n: any) => (
                  <div key={n.name} className="bg-slate-900 border border-slate-800 p-4 rounded-lg space-y-2">
                    <div className="flex justify-between"><span className="font-mono text-xs font-bold">{n.name}</span><span className="text-xs text-emerald-400">{n.hourlyCost}</span></div>
                    <div className="text-xs text-slate-400">CPU: {n.cpuUsage}% | RAM: {n.memUsage}%</div>
                    <div className="w-full bg-slate-800 h-1.5 rounded"><div className="bg-indigo-500 h-full rounded" style={{ width: `${n.cpuUsage}%` }} /></div>
                  </div>
                ))}
              </div>

              {/* Active Extension Widgets */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-sm">Active Custom Plugin & Extension Telemetry</h3>
                  <button onClick={() => setSection('plugins')} className="text-xs text-indigo-400 hover:underline">Manage Plugins →</button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {plugins.filter((p) => p.installed).map((plug) => (
                    <div key={plug.id} className="bg-slate-950 border border-slate-800 p-3.5 rounded-lg">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-xs text-indigo-300">{plug.name} ({plug.version})</span>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">{plug.category}</span>
                      </div>
                      <div className="font-mono text-xs text-slate-300 mt-2">{plug.widgetData}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 2. WORKLOADS */}
          {section === 'workloads' && (
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 font-semibold text-sm">Workloads (Deployments, StatefulSets, DaemonSets)</div>
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800/60 text-slate-400">
                    <tr><th className="p-3">Name</th><th className="p-3">Kind</th><th className="p-3">Image</th><th className="p-3">Scale</th><th className="p-3 text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {deployments.map((d) => (
                      <tr key={d.name}>
                        <td className="p-3 font-medium">{d.name}</td>
                        <td className="p-3 text-indigo-300">{d.kind}</td>
                        <td className="p-3 font-mono">{d.image}</td>
                        <td className="p-3 flex items-center gap-2">
                          <button onClick={() => controlDeployment(d.name, 'scale', Math.max(0, d.replicas - 1))} className="bg-slate-800 px-2 rounded">-</button>
                          <span>{d.ready}/{d.replicas}</span>
                          <button onClick={() => controlDeployment(d.name, 'scale', d.replicas + 1)} className="bg-slate-800 px-2 rounded">+</button>
                        </td>
                        <td className="p-3 text-right">
                          <button onClick={() => controlDeployment(d.name, 'restart')} className="bg-amber-600/80 px-2.5 py-1 rounded">Rolling Restart</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 font-semibold text-sm">Pods</div>
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800/60 text-slate-400">
                    <tr><th className="p-3">Pod</th><th className="p-3">Status</th><th className="p-3">CPU/RAM</th><th className="p-3 text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {pods.map((p) => (
                      <tr key={p.name}>
                        <td className="p-3 font-mono">{p.name}</td>
                        <td className="p-3"><span className={`px-2 py-0.5 rounded ${p.phase === 'Running' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>{p.phase}</span></td>
                        <td className="p-3 font-mono">{p.cpu} / {p.memory}</td>
                        <td className="p-3 text-right space-x-2">
                          <button onClick={async () => { const r = await fetch(`/api/logs?namespace=${namespace}&pod=${p.name}`); setSelectedPodLogs({ pod: p.name, logs: await r.text() }); }} className="bg-slate-800 px-2 py-1 rounded">Logs</button>
                          <button onClick={() => { setExecPod(p.name); setSection('terminal'); }} className="bg-indigo-600 px-2 py-1 rounded">Exec</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. GITOPS & ITSM CHANGE GATES */}
          {section === 'gitops' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg flex justify-between items-center">
                  <div>
                    <div className="font-semibold text-sm">ITSM Change Window Gate</div>
                    <div className="text-xs text-slate-400">Blocks syncs and YAML deploys outside approved change hours</div>
                  </div>
                  <button onClick={() => gitopsAction({ action: 'toggle_itsm' })} className={`px-3 py-1.5 rounded text-xs font-medium ${gitopsData.itsmWindowOpen ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                    {gitopsData.itsmWindowOpen ? 'Window OPEN' : 'Window FROZEN'}
                  </button>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg flex justify-between items-center">
                  <div>
                    <div className="font-semibold text-sm">Enforce Code-Based Deployment Only</div>
                    <div className="text-xs text-slate-400">Disables manual UI scaling/restarts; requires Git commit</div>
                  </div>
                  <button onClick={() => gitopsAction({ action: 'toggle_gitonly' })} className={`px-3 py-1.5 rounded text-xs font-medium ${gitopsData.enforceGitOnly ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                    {gitopsData.enforceGitOnly ? 'Enforced (Git-Only)' : 'Disabled (UI Allowed)'}
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
                <h3 className="font-semibold text-sm">Argo CD & Flux CD GitOps Pipelines</h3>
                {gitopsData.apps?.map((app: any) => (
                  <div key={app.name} className="bg-slate-950 border border-slate-800 p-4 rounded-lg flex justify-between items-center">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded">{app.engine}</span>
                        <span className="font-bold text-sm">{app.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${app.syncStatus === 'Synced' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>{app.syncStatus}</span>
                      </div>
                      <div className="text-xs font-mono text-slate-400">{app.repoUrl} ({app.branch} → {app.path})</div>
                      <div className="text-xs text-slate-500">Last Commit: {app.lastCommit}</div>
                    </div>
                    <button onClick={() => gitopsAction({ action: 'sync', name: app.name })} className="bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded text-xs font-medium">
                      Webhook Sync Now
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. HELM CHART CATALOG */}
          {section === 'helm' && (
            <div className="space-y-6">
              <form onSubmit={async (e) => { e.preventDefault(); await fetch('/api/helm', { method: 'POST', body: JSON.stringify(newHelm) }); flash(`Helm Chart ${newHelm.releaseName} deployed!`); refreshAll(); }} className="bg-slate-900 border border-slate-800 p-5 rounded-lg space-y-3">
                <h3 className="font-semibold text-sm">Deploy from Helm Chart Repository</h3>
                <div className="grid grid-cols-4 gap-3">
                  <input value={newHelm.releaseName} onChange={(e) => setNewHelm({ ...newHelm, releaseName: e.target.value })} placeholder="Release Name" className="bg-slate-950 border border-slate-800 rounded p-2 text-xs" />
                  <select value={newHelm.chart} onChange={(e) => setNewHelm({ ...newHelm, chart: e.target.value })} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs">
                    <option value="jetstack/cert-manager">jetstack/cert-manager</option>
                    <option value="argo/argo-cd">argo/argo-cd</option>
                    <option value="bitnami/redis">bitnami/redis</option>
                    <option value="grafana/loki-stack">grafana/loki-stack</option>
                  </select>
                  <input value={newHelm.version} onChange={(e) => setNewHelm({ ...newHelm, version: e.target.value })} placeholder="Chart Version" className="bg-slate-950 border border-slate-800 rounded p-2 text-xs" />
                  <button className="bg-emerald-600 hover:bg-emerald-500 rounded text-xs font-medium">Install Helm Chart</button>
                </div>
              </form>

              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 font-semibold text-sm">Installed Helm Releases</div>
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800/60 text-slate-400">
                    <tr><th className="p-3">Release</th><th className="p-3">Chart</th><th className="p-3">Version</th><th className="p-3">Namespace</th><th className="p-3">Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {helmReleases.map((h) => (
                      <tr key={h.releaseName}>
                        <td className="p-3 font-bold">{h.releaseName}</td>
                        <td className="p-3 font-mono text-indigo-300">{h.chart}</td>
                        <td className="p-3">{h.version}</td>
                        <td className="p-3">{h.namespace}</td>
                        <td className="p-3"><span className="bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">{h.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5. FLEET GOVERNANCE */}
          {section === 'governance' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <h2 className="font-semibold text-sm">Fleet Governance Policies & Automatic Drift Remediation</h2>
              {policies.map((pol) => (
                <div key={pol.id} className="bg-slate-950 border border-slate-800 p-4 rounded-lg flex justify-between items-center">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-indigo-300">{pol.category}</span>
                      <span className="font-semibold text-sm">{pol.name}</span>
                    </div>
                    <div className="text-xs text-slate-400">Target Fleet: {pol.targetFleet} | Status: <strong className={pol.driftStatus.includes('Drifted') ? 'text-amber-400' : 'text-emerald-400'}>{pol.driftStatus}</strong></div>
                  </div>
                  <div className="flex gap-2">
                    {pol.driftStatus.includes('Drifted') && (
                      <button onClick={async () => { await fetch('/api/governance', { method: 'POST', body: JSON.stringify({ id: pol.id, action: 'remediate' }) }); flash('Policy drift remediated'); refreshAll(); }} className="bg-amber-600 hover:bg-amber-500 px-3 py-1.5 rounded text-xs font-medium">
                        Auto-Remediate Drift
                      </button>
                    )}
                    <button onClick={async () => { await fetch('/api/governance', { method: 'POST', body: JSON.stringify({ id: pol.id, action: 'toggle' }) }); refreshAll(); }} className={`px-3 py-1.5 rounded text-xs ${pol.enforced ? 'bg-emerald-600/30 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                      {pol.enforced ? 'Enforced' : 'Audit-Only'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 6. SECURITY & REGISTRIES */}
          {section === 'security' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <h2 className="font-semibold text-sm">Container Vulnerability Scanner (Trivy) & New Image Availability</h2>
              <div className="space-y-3">
                {imageScans.map((img) => (
                  <div key={img.image} className="bg-slate-950 border border-slate-800 p-4 rounded-lg flex justify-between items-center">
                    <div className="space-y-1">
                      <div className="font-mono text-sm font-bold text-indigo-300">{img.image}:{img.currentTag}</div>
                      <div className="text-xs text-slate-400">Registry: {img.registry} | Critical CVEs: <strong className={img.criticalCVEs > 0 ? 'text-rose-400' : 'text-emerald-400'}>{img.criticalCVEs}</strong> | High CVEs: {img.highCVEs}</div>
                    </div>
                    {img.updateAvail ? (
                      <button onClick={async () => { await fetch('/api/security', { method: 'POST', body: JSON.stringify({ image: img.image }) }); flash(`Upgraded ${img.image}`); refreshAll(); }} className="bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded text-xs font-medium">
                        ⬆️ Upgrade to {img.latestTag}
                      </button>
                    ) : (
                      <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded">Up to Date ({img.scanStatus})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 7. STORAGE & PORT-FORWARDING */}
          {section === 'netstorage' && (
            <div className="space-y-6">
              <form onSubmit={async (e) => { e.preventDefault(); await fetch('/api/network-storage', { method: 'POST', body: JSON.stringify(newTunnel) }); flash(`Port-Forward active on :${newTunnel.localPort}`); refreshAll(); }} className="bg-slate-900 border border-slate-800 p-5 rounded-lg space-y-3">
                <h3 className="font-semibold text-sm">Local Port-Forwarding Tunnel</h3>
                <div className="grid grid-cols-4 gap-3">
                  <input value={newTunnel.service} onChange={(e) => setNewTunnel({ ...newTunnel, service: e.target.value })} placeholder="Service Name" className="bg-slate-950 border border-slate-800 rounded p-2 text-xs" />
                  <input type="number" value={newTunnel.localPort} onChange={(e) => setNewTunnel({ ...newTunnel, localPort: Number(e.target.value) })} placeholder="Local Port" className="bg-slate-950 border border-slate-800 rounded p-2 text-xs" />
                  <input type="number" value={newTunnel.targetPort} onChange={(e) => setNewTunnel({ ...newTunnel, targetPort: Number(e.target.value) })} placeholder="Target Port" className="bg-slate-950 border border-slate-800 rounded p-2 text-xs" />
                  <button className="bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-medium">Start Port-Forward</button>
                </div>
                <div className="space-y-2 pt-2">
                  {netStorage.portForwards?.map((pf: any) => (
                    <div key={pf.id} className="bg-slate-950 border border-slate-800 p-2.5 rounded text-xs flex justify-between font-mono">
                      <span>svc/{pf.service} ({pf.namespace})</span>
                      <span className="text-emerald-400">{pf.status} → :{pf.targetPort}</span>
                    </div>
                  ))}
                </div>
              </form>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-lg space-y-3">
                <h3 className="font-semibold text-sm">PersistentVolumeClaims (PVCs)</h3>
                {netStorage.pvcs?.map((pvc: any) => (
                  <div key={pvc.name} className="bg-slate-950 border border-slate-800 p-3 rounded text-xs flex justify-between">
                    <span className="font-mono">{pvc.name} ({pvc.namespace})</span>
                    <span>{pvc.storageClass} • {pvc.capacity} • <strong className="text-emerald-400">{pvc.status}</strong></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 8. BATCH 3: CUSTOM PLUGINS & EXTENSIONS MARKETPLACE */}
          {section === 'plugins' && (
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
                <h2 className="font-semibold text-sm">Custom Plugins & Lens Extensions Marketplace</h2>
                <div className="grid grid-cols-2 gap-4">
                  {plugins.map((plug) => (
                    <div key={plug.id} className="bg-slate-950 border border-slate-800 p-4 rounded-lg flex flex-col justify-between space-y-3">
                      <div>
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded uppercase">{plug.category}</span>
                            <h3 className="font-bold text-sm mt-1">{plug.name}</h3>
                            <div className="text-xs text-slate-500">{plug.vendor} • {plug.version}</div>
                          </div>
                          <button
                            onClick={() => togglePlugin(plug.id)}
                            className={`px-3 py-1 rounded text-xs font-medium ${plug.installed ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'bg-indigo-600 text-white'}`}
                          >
                            {plug.installed ? '✓ Enabled' : '+ Install Extension'}
                          </button>
                        </div>
                        <p className="text-xs text-slate-400 mt-2">{plug.description}</p>
                      </div>
                      {plug.installed && (
                        <div className="bg-slate-900 border border-slate-800 p-2.5 rounded font-mono text-[11px] text-emerald-300">
                          {plug.widgetData}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <form onSubmit={registerCustomPlugin} className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
                <h3 className="font-semibold text-sm">Register Custom Internal Dashboard Extension / SDK Plugin</h3>
                <div className="grid grid-cols-4 gap-3">
                  <input placeholder="Plugin Name (e.g. PagerDuty Oncall)" value={newPlugin.name} onChange={(e) => setNewPlugin({ ...newPlugin, name: e.target.value })} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs" />
                  <input placeholder="Category (e.g. Alerting)" value={newPlugin.category} onChange={(e) => setNewPlugin({ ...newPlugin, category: e.target.value })} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs" />
                  <input placeholder="Short Description" value={newPlugin.description} onChange={(e) => setNewPlugin({ ...newPlugin, description: e.target.value })} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs" />
                  <button className="bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-medium">+ Load Custom Plugin</button>
                </div>
              </form>
            </div>
          )}

          {/* 9. BATCH 3: IDENTITY, ACTIVE DIRECTORY SYNC & GUIDED RBAC BUILDER */}
          {section === 'iam' && (
            <div className="space-y-6">
              {/* Row 1: Active Directory Sync Wizard & Multi-Source User Provisioning */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-sm">Active Directory / LDAP Auto-Sync</h3>
                    <button onClick={triggerADSync} className="bg-emerald-600 hover:bg-emerald-500 px-3 py-1 rounded text-xs font-medium">
                      🔄 Run AD Sync Now
                    </button>
                  </div>
                  <div className="text-xs text-slate-400 space-y-1.5 font-mono bg-slate-950 p-3 rounded border border-slate-800">
                    <div>Server: <span className="text-indigo-300">{iamData.ldapConfig?.serverUrl}</span></div>
                    <div>Bind DN: <span className="text-slate-300">{iamData.ldapConfig?.bindDN}</span></div>
                    <div>User OU: <span className="text-slate-300">{iamData.ldapConfig?.userSearchOU}</span></div>
                    <div>Group OU: <span className="text-slate-300">{iamData.ldapConfig?.groupSearchOU}</span></div>
                    <div>Status: <span className="text-emerald-400">Last Sync {iamData.ldapConfig?.lastSync} ({iamData.ldapConfig?.syncedGroups} AD Groups Mapped)</span></div>
                  </div>
                </div>

                <form onSubmit={provisionUser} className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
                  <h3 className="font-semibold text-sm">Provision User & Team (Guided Form, YAML, Git, or Helm)</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Username (e.g. dev.lead)" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs" />
                    <select value={newUser.sourceType} onChange={(e) => setNewUser({ ...newUser, sourceType: e.target.value })} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs text-indigo-300">
                      <option value="Guided Form">Source: Guided UI Form</option>
                      <option value="YAML Manifest">Source: YAML Manifest</option>
                      <option value="GitOps Repo">Source: Git Repository</option>
                      <option value="Helm Chart">Source: Helm Chart</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={newUser.team} onChange={(e) => setNewUser({ ...newUser, team: e.target.value })} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs">
                      <option>Platform-Engineering</option>
                      <option>Payments-Squad</option>
                      <option>Cloud-SRE-AD-Group</option>
                    </select>
                    <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs">
                      {iamData.rbacRoles?.map((r: any) => <option key={r.name} value={r.name}>{r.name} ({r.scope})</option>)}
                    </select>
                  </div>
                  <button className="bg-indigo-600 hover:bg-indigo-500 w-full py-2 rounded text-xs font-medium">Create User & Bind Role</button>
                </form>
              </div>

              {/* Row 2: Guided Visual RBAC Role Builder + Live YAML Preview */}
              <div className="grid grid-cols-2 gap-6">
                <form onSubmit={createRBACRole} className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
                  <h3 className="font-semibold text-sm">Guided Visual RBAC Role Builder</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={roleBuilder.name} onChange={(e) => setRoleBuilder({ ...roleBuilder, name: e.target.value })} placeholder="Role Name" className="bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono" />
                    <select value={roleBuilder.scope} onChange={(e) => setRoleBuilder({ ...roleBuilder, scope: e.target.value })} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs">
                      <option value="ClusterRole">ClusterRole (Cluster-Wide)</option>
                      <option value="Role">Role (Namespace-Scoped)</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Kubernetes Resources:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {['pods', 'pods/log', 'deployments', 'statefulsets', 'services', 'ingresses', 'secrets', 'configmaps', 'nodes'].map((res) => (
                        <button
                          type="button"
                          key={res}
                          onClick={() => setRoleBuilder({ ...roleBuilder, resources: toggleArrayItem(roleBuilder.resources, res) })}
                          className={`px-2 py-1 rounded text-xs font-mono ${roleBuilder.resources.includes(res) ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-400 border border-slate-800'}`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Allowed Verbs:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'].map((v) => (
                        <button
                          type="button"
                          key={v}
                          onClick={() => setRoleBuilder({ ...roleBuilder, verbs: toggleArrayItem(roleBuilder.verbs, v) })}
                          className={`px-2 py-1 rounded text-xs font-mono ${roleBuilder.verbs.includes(v) ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-400 border border-slate-800'}`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button className="bg-emerald-600 hover:bg-emerald-500 w-full py-2 rounded text-xs font-medium">Save & Apply RBAC Role</button>
                </form>

                <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col justify-between">
                  <h3 className="font-semibold text-sm mb-2">Live Generated Kubernetes RBAC YAML</h3>
                  <pre className="bg-slate-950 border border-slate-800 rounded p-3 font-mono text-xs text-emerald-300 overflow-auto flex-1">
                    {generatedRBACYaml}
                  </pre>
                </div>
              </div>

              {/* Row 3: Provisioned Users Table & Compliance Audit Trail */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
                <h3 className="font-semibold text-sm">Provisioned Users & Teams</h3>
                <div className="grid grid-cols-3 gap-3">
                  {iamData.users?.map((u: any, i: number) => (
                    <div key={i} className="bg-slate-950 border border-slate-800 p-3 rounded text-xs space-y-1">
                      <div className="font-bold text-indigo-300">{u.username}</div>
                      <div className="text-slate-400">Team: {u.team} | Role: <strong className="text-emerald-400">{u.role}</strong></div>
                      <div className="text-[11px] text-slate-500">{u.authType} • Created via {u.sourceType}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                <h3 className="font-semibold text-sm mb-3">Compliance & Activity Audit Trail (Syslog: {iamData.syslogServer})</h3>
                <div className="space-y-1.5 max-h-56 overflow-auto">
                  {iamData.auditLogs?.map((log: any, idx: number) => (
                    <div key={idx} className="bg-slate-950 border border-slate-800 px-3 py-2 rounded text-xs flex justify-between font-mono">
                      <span>[{log.timestamp}] <strong className="text-indigo-300">{log.user}</strong> → {log.action}</span>
                      <span className="text-slate-400">{log.resource}</span>
                      <span className={log.status === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}>{log.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 10. TERMINAL */}
          {section === 'terminal' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <h2 className="font-semibold text-sm">Interactive Container Shell ({execPod})</h2>
              <div className="bg-black border border-slate-800 rounded p-4 font-mono text-xs text-emerald-400 h-72 overflow-auto space-y-1">
                {terminalHistory.map((l, i) => <pre key={i}>{l}</pre>)}
              </div>
              <form onSubmit={async (e) => { e.preventDefault(); const r = await fetch('/api/exec', { method: 'POST', body: JSON.stringify({ pod: execPod, command: execInput }) }); const d = await r.json(); setTerminalHistory((p) => [...p, `# ${execInput}`, d.output]); setExecInput(''); }} className="flex gap-2">
                <input value={execInput} onChange={(e) => setExecInput(e.target.value)} className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 font-mono text-xs" />
                <button className="bg-indigo-600 px-4 py-2 rounded text-xs">Execute</button>
              </form>
            </div>
          )}

          {/* 11. EVENTS */}
          {section === 'events' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
              <h2 className="font-semibold text-sm">Cluster Events</h2>
              {overview.events?.map((ev: any, i: number) => (
                <div key={i} className="bg-slate-950 border border-slate-800 p-3 rounded text-xs flex justify-between">
                  <span><strong>{ev.type} ({ev.reason}):</strong> {ev.object} — {ev.message}</span>
                  <span className="text-slate-500">{ev.timestamp}</span>
                </div>
              ))}
            </div>
          )}

          {/* 12. AI TROUBLESHOOTER */}
          {section === 'ai' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <h2 className="font-semibold text-sm">AI Cluster Root-Cause Assistant</h2>
              <div className="bg-slate-950 border border-slate-800 rounded p-4 h-64 overflow-auto space-y-2 text-xs">
                {aiChat.map((m, i) => <div key={i} className="p-2.5 bg-slate-900 rounded"><strong>{m.role}:</strong> {m.text}</div>)}
              </div>
              <form onSubmit={async (e) => { e.preventDefault(); const r = await fetch('/api/ai-assistant', { method: 'POST', body: JSON.stringify({ prompt: aiPrompt }) }); const d = await r.json(); setAiChat((p) => [...p, { role: 'user', text: aiPrompt }, { role: 'assistant', text: d.reply }]); setAiPrompt(''); }} className="flex gap-2">
                <input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs" />
                <button className="bg-emerald-600 px-4 py-2 rounded text-xs">Ask AI</button>
              </form>
            </div>
          )}

          {/* 13. YAML EDITOR */}
          {section === 'yaml' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
              <div className="flex justify-between">
                <h2 className="font-semibold text-sm">Dynamic YAML Manifest Applier</h2>
                <button onClick={async () => { const r = await fetch('/api/apply', { method: 'POST', body: JSON.stringify({ yaml: yamlInput }) }); const d = await r.json(); flash(r.ok ? `Applied ${d.kind}/${d.name}` : d.error); refreshAll(); }} className="bg-emerald-600 px-4 py-1.5 rounded text-xs">Apply YAML</button>
              </div>
              <textarea value={yamlInput} onChange={(e) => setYamlInput(e.target.value)} rows={12} className="w-full bg-slate-950 border border-slate-800 rounded p-3 font-mono text-xs text-emerald-300" />
            </div>
          )}
        </main>
      </div>

      {selectedPodLogs && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-3xl w-full p-4">
            <div className="flex justify-between pb-2 border-b border-slate-800">
              <span className="font-mono text-xs">{selectedPodLogs.pod}</span>
              <button onClick={() => setSelectedPodLogs(null)} className="text-xs text-slate-400">Close ✕</button>
            </div>
            <pre className="mt-3 p-3 bg-slate-950 rounded text-xs font-mono text-slate-300 overflow-auto max-h-80">{selectedPodLogs.logs}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
