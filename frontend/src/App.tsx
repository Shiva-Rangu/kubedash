import React, { useEffect, useState } from 'react';

type Section = 'overview' | 'workloads' | 'terminal' | 'events' | 'iam' | 'ai' | 'yaml';

export default function App() {
  const [section, setSection] = useState<Section>('overview');
  const [activeCluster, setActiveCluster] = useState('prod-us-east-eks');
  const [namespace, setNamespace] = useState('default');

  const [overview, setOverview] = useState<any>({
    nodeCount: 3, namespaceCount: 4, totalPods: 6, monthlyCostEst: '$1,368.00 / mo',
    namespaces: ['default', 'kube-system', 'gitops', 'payments'],
    clusters: [], nodes: [], events: [], projects: []
  });

  const [pods, setPods] = useState<any[]>([]);
  const [deployments, setDeployments] = useState<any[]>([]);
  const [iamData, setIamData] = useState<any>({ users: [], auditLogs: [], ssoProviders: [], syslogServer: '' });

  const [selectedPodLogs, setSelectedPodLogs] = useState<{ pod: string; logs: string } | null>(null);
  const [execPod, setExecPod] = useState('api-gateway-7f8b9c-x92k1');
  const [execInput, setExecInput] = useState('kubectl get pods');
  const [terminalHistory, setTerminalHistory] = useState<string[]>([
    'Connected to container runtime via WebSocket SPDY executor...',
    'Type "ls -la", "ps aux", "env", or "kubectl get pods" below.'
  ]);

  const [aiPrompt, setAiPrompt] = useState('Why is payment-worker crashing?');
  const [aiChat, setAiChat] = useState<{ role: string; text: string }[]>([
    { role: 'assistant', text: 'Hello! I am your KubeControl AI Troubleshooter. Ask me about CrashLoopBackOff pods, resource bottlenecks, or cluster costs.' }
  ]);

  const [newClusterName, setNewClusterName] = useState('');
  const [newClusterProvider, setNewClusterProvider] = useState('AWS EKS');
  const [newUser, setNewUser] = useState({ username: '', team: 'Platform-Engineering', role: 'DevOps-Lead', authType: 'OIDC / Okta SSO' });

  const [yamlInput, setYamlInput] = useState(
`apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-service
  namespace: default
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: checkout
        image: nginx:alpine`
  );
  const [yamlStatus, setYamlStatus] = useState('');

  const refreshAll = async () => {
    try {
      const [ovRes, podRes, depRes, iamRes] = await Promise.all([
        fetch('/api/overview'),
        fetch(`/api/pods?namespace=${namespace}`),
        fetch(`/api/deployments?namespace=${namespace}`),
        fetch('/api/iam'),
      ]);
      if (ovRes.ok) setOverview(await ovRes.json());
      if (podRes.ok) setPods((await podRes.json()) || []);
      if (depRes.ok) setDeployments((await depRes.json()) || []);
      if (iamRes.ok) setIamData(await iamRes.json());
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refreshAll();
    const timer = setInterval(refreshAll, 5000);
    return () => clearInterval(timer);
  }, [namespace]);

  const deletePod = async (name: string) => {
    await fetch(`/api/pods?namespace=${namespace}&name=${name}`, { method: 'DELETE' });
    refreshAll();
  };

  const viewLogs = async (pod: string) => {
    const res = await fetch(`/api/logs?namespace=${namespace}&pod=${pod}`);
    setSelectedPodLogs({ pod, logs: await res.text() });
  };

  const controlDeployment = async (name: string, action: 'scale' | 'restart', replicas = 1) => {
    await fetch('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, namespace, name, replicas }),
    });
    refreshAll();
  };

  const runExecCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!execInput.trim()) return;
    const res = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pod: execPod, command: execInput }),
    });
    const data = await res.json();
    setTerminalHistory((prev) => [...prev, `root@${execPod}:~# ${execInput}`, data.output]);
    setExecInput('');
    refreshAll();
  };

  const askAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    const userQ = aiPrompt;
    setAiChat((prev) => [...prev, { role: 'user', text: userQ }]);
    setAiPrompt('');
    const res = await fetch('/api/ai-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: userQ }),
    });
    const data = await res.json();
    setAiChat((prev) => [...prev, { role: 'assistant', text: data.reply }]);
  };

  const importCluster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClusterName) return;
    await fetch('/api/clusters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newClusterName, provider: newClusterProvider }),
    });
    setNewClusterName('');
    refreshAll();
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.username) return;
    await fetch('/api/iam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser),
    });
    setNewUser({ ...newUser, username: '' });
    refreshAll();
  };

  const applyYaml = async () => {
    const res = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: yamlInput }),
    });
    const data = await res.json();
    setYamlStatus(res.ok ? `Applied ${data.kind}/${data.name}` : `Error: ${data.error}`);
    refreshAll();
  };

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between">
        <div>
          <div className="p-5 border-b border-slate-800 flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-bold text-lg tracking-tight">KubePlatform IDP</span>
          </div>
          <nav className="p-3 space-y-1 text-sm">
            {[
              { id: 'overview', label: '🌐 Fleet & Nodes Overview' },
              { id: 'workloads', label: '📦 Workloads & Pods' },
              { id: 'terminal', label: '💻 Integrated Terminal (Exec)' },
              { id: 'events', label: '⚡ Cluster Events Stream' },
              { id: 'iam', label: '🔐 Identity, RBAC & Audit' },
              { id: 'ai', label: '🤖 AI Troubleshooter' },
              { id: 'yaml', label: '📝 YAML / Helm Deploy' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id as Section)}
                className={`w-full text-left px-3.5 py-2.5 rounded-lg font-medium transition ${
                  section === item.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="p-4 border-t border-slate-800 text-xs text-slate-400 space-y-1">
          <div>User: <span className="text-slate-200 font-medium">shiva.admin</span></div>
          <div>Role: <span className="text-emerald-400">ClusterAdmin (SSO)</span></div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col">
        <header className="bg-slate-900/70 border-b border-slate-800 px-6 py-3.5 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-slate-400">Cluster:</span>
              <select
                value={activeCluster}
                onChange={(e) => setActiveCluster(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm font-medium text-indigo-300"
              >
                {overview.clusters?.map((c: any) => (
                  <option key={c.id} value={c.name}>{c.name} ({c.provider})</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-slate-400">Namespace:</span>
              <select
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm"
              >
                {overview.namespaces?.map((ns: string) => (
                  <option key={ns} value={ns}>{ns}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 px-3 py-1 rounded-full">
              Est. Cost: {overview.monthlyCostEst}
            </span>
            <button onClick={refreshAll} className="bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded text-xs font-medium">
              Sync Now
            </button>
          </div>
        </header>

        <main className="p-6 space-y-6 overflow-auto flex-1">
          {section === 'overview' && (
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-semibold text-base">Multi-Cluster Fleet (EKS, AKS, GKE, Talos Omni)</h2>
                  <form onSubmit={importCluster} className="flex gap-2">
                    <input
                      placeholder="New cluster name..."
                      value={newClusterName}
                      onChange={(e) => setNewClusterName(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded px-3 py-1 text-xs"
                    />
                    <select
                      value={newClusterProvider}
                      onChange={(e) => setNewClusterProvider(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs"
                    >
                      <option>AWS EKS</option>
                      <option>Azure AKS</option>
                      <option>Google GKE</option>
                      <option>Talos Omni</option>
                      <option>Kubeconfig Import</option>
                    </select>
                    <button className="bg-indigo-600 hover:bg-indigo-500 px-3 py-1 rounded text-xs font-medium">
                      + Connect Cluster
                    </button>
                  </form>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {overview.clusters?.map((c: any) => (
                    <div key={c.id} className="bg-slate-950 border border-slate-800 p-4 rounded-lg flex justify-between items-center">
                      <div>
                        <div className="text-xs text-indigo-400 font-medium">{c.provider}</div>
                        <div className="font-bold text-base mt-0.5">{c.name}</div>
                        <div className="text-xs text-slate-400 mt-1">{c.version} • {c.nodes} Nodes</div>
                      </div>
                      <span className="bg-emerald-500/20 text-emerald-300 text-xs px-2.5 py-1 rounded font-medium">{c.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                <h2 className="font-semibold text-base mb-4">Node Resource Utilization & Cost Telemetry</h2>
                <div className="grid grid-cols-3 gap-4">
                  {overview.nodes?.map((n: any) => (
                    <div key={n.name} className="bg-slate-950 border border-slate-800 p-4 rounded-lg space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="font-mono text-sm font-semibold">{n.name}</span>
                        <span className="text-xs text-slate-400">{n.hourlyCost}</span>
                      </div>
                      <div className="text-xs text-slate-400">{n.role} • {n.cpuCores} vCPU / {n.memoryGB} GB RAM</div>
                      <div>
                        <div className="flex justify-between text-xs mb-1"><span>CPU</span><span>{n.cpuUsage}%</span></div>
                        <div className="w-full bg-slate-800 h-2 rounded overflow-hidden">
                          <div className="bg-indigo-500 h-full" style={{ width: `${n.cpuUsage}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1"><span>Memory</span><span>{n.memUsage}%</span></div>
                        <div className="w-full bg-slate-800 h-2 rounded overflow-hidden">
                          <div className="bg-emerald-500 h-full" style={{ width: `${n.memUsage}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                <h2 className="font-semibold text-base mb-3">Application Projects & Enforced Quotas</h2>
                <div className="grid grid-cols-2 gap-4">
                  {overview.projects?.map((proj: any) => (
                    <div key={proj.name} className="bg-slate-950 border border-slate-800 p-4 rounded-lg">
                      <div className="font-bold text-sm">{proj.name}</div>
                      <div className="text-xs text-slate-400 mt-1">Owner Team: {proj.team}</div>
                      <div className="text-xs text-indigo-300 mt-2">Namespaces: {proj.namespaces.join(', ')}</div>
                      <div className="text-xs text-emerald-400 mt-1">Quota: {proj.cpuQuota} / {proj.memoryQuota}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === 'workloads' && (
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 font-semibold text-sm">Deployments (Scale & Rolling Restart)</div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-800/60 text-slate-400 text-xs">
                    <tr>
                      <th className="p-3">Name</th>
                      <th className="p-3">Container Image</th>
                      <th className="p-3">Ready</th>
                      <th className="p-3">Scale</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {deployments.map((d) => (
                      <tr key={d.name}>
                        <td className="p-3 font-medium">{d.name}</td>
                        <td className="p-3 font-mono text-xs text-indigo-300">{d.image}</td>
                        <td className="p-3">{d.ready}/{d.replicas}</td>
                        <td className="p-3 flex items-center gap-2">
                          <button onClick={() => controlDeployment(d.name, 'scale', Math.max(0, d.replicas - 1))} className="bg-slate-800 px-2 rounded">-</button>
                          <span className="font-mono text-xs">{d.replicas}</span>
                          <button onClick={() => controlDeployment(d.name, 'scale', d.replicas + 1)} className="bg-slate-800 px-2 rounded">+</button>
                        </td>
                        <td className="p-3 text-right">
                          <button onClick={() => controlDeployment(d.name, 'restart')} className="bg-amber-600/80 hover:bg-amber-600 px-2.5 py-1 rounded text-xs">
                            Rolling Restart
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 font-semibold text-sm">Pods (Metrics, Logs & Exec)</div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-800/60 text-slate-400 text-xs">
                    <tr>
                      <th className="p-3">Pod Name</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">CPU / RAM</th>
                      <th className="p-3">Restarts</th>
                      <th className="p-3">Node</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {pods.map((p) => (
                      <tr key={p.name}>
                        <td className="p-3 font-mono text-xs">{p.name}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            p.phase === 'Running' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                          }`}>{p.phase}</span>
                        </td>
                        <td className="p-3 font-mono text-xs text-slate-300">{p.cpu} / {p.memory}</td>
                        <td className="p-3">{p.restarts}</td>
                        <td className="p-3 text-xs text-slate-400">{p.nodeName}</td>
                        <td className="p-3 text-right space-x-2">
                          <button onClick={() => viewLogs(p.name)} className="bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded text-xs">Logs</button>
                          <button onClick={() => { setExecPod(p.name); setSection('terminal'); }} className="bg-indigo-600/80 hover:bg-indigo-600 px-2.5 py-1 rounded text-xs">Terminal</button>
                          <button onClick={() => deletePod(p.name)} className="bg-rose-600/80 hover:bg-rose-600 px-2.5 py-1 rounded text-xs">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {section === 'terminal' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="font-semibold text-base">Interactive Container Shell (kubectl exec)</h2>
                <select value={execPod} onChange={(e) => setExecPod(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-3 py-1 text-xs font-mono">
                  {pods.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div className="bg-black border border-slate-800 rounded p-4 font-mono text-xs text-emerald-400 h-80 overflow-auto space-y-1.5">
                {terminalHistory.map((line, idx) => (
                  <pre key={idx} className="whitespace-pre-wrap">{line}</pre>
                ))}
              </div>
              <form onSubmit={runExecCommand} className="flex gap-2">
                <input
                  value={execInput}
                  onChange={(e) => setExecInput(e.target.value)}
                  placeholder="Enter command (e.g., ls -la, ps aux, env, kubectl get pods)..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 font-mono text-xs text-white"
                />
                <button className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded text-xs font-medium">Run Command</button>
              </form>
            </div>
          )}

          {section === 'events' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
              <h2 className="font-semibold text-base">Real-Time Cluster Warning & Normal Events</h2>
              {overview.events?.map((ev: any, i: number) => (
                <div key={i} className="bg-slate-950 border border-slate-800 p-3.5 rounded-lg flex justify-between items-center">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        ev.type === 'Warning' ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
                      }`}>{ev.type}: {ev.reason}</span>
                      <span className="font-mono text-xs text-indigo-300">{ev.object}</span>
                    </div>
                    <div className="text-xs text-slate-300">{ev.message}</div>
                  </div>
                  <span className="text-xs text-slate-500">{ev.timestamp}</span>
                </div>
              ))}
            </div>
          )}

          {section === 'iam' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
                  <h3 className="font-semibold text-sm">Pre-Configured SSO & LDAP Providers</h3>
                  {iamData.ssoProviders?.map((sso: string) => (
                    <div key={sso} className="bg-slate-950 border border-slate-800 p-3 rounded text-xs flex justify-between">
                      <span>{sso}</span>
                      <span className="text-emerald-400">Connected</span>
                    </div>
                  ))}
                  <div className="text-xs text-slate-400 pt-2">
                    Centralized Syslog Export: <span className="font-mono text-indigo-300">{iamData.syslogServer}</span>
                  </div>
                </div>

                <form onSubmit={addUser} className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
                  <h3 className="font-semibold text-sm">Provision User / Team Role Binding</h3>
                  <input
                    placeholder="Username (e.g. alex.sre)"
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select value={newUser.team} onChange={(e) => setNewUser({ ...newUser, team: e.target.value })} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs">
                      <option>Platform-Engineering</option>
                      <option>Payments-Squad</option>
                      <option>Security-SecOps</option>
                    </select>
                    <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs">
                      <option>ClusterAdmin</option>
                      <option>DevOps-Lead</option>
                      <option>Developer-Viewer</option>
                    </select>
                  </div>
                  <button className="bg-indigo-600 hover:bg-indigo-500 w-full py-2 rounded text-xs font-medium">Grant RBAC Access</button>
                </form>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                <h3 className="font-semibold text-sm mb-3">Compliance & Activity Audit Trail</h3>
                <div className="space-y-2 max-h-60 overflow-auto">
                  {iamData.auditLogs?.map((log: any, idx: number) => (
                    <div key={idx} className="bg-slate-950 border border-slate-800 px-3 py-2 rounded text-xs flex justify-between font-mono">
                      <span>[{log.timestamp}] <strong className="text-indigo-300">{log.user}</strong> → {log.action}</span>
                      <span className="text-slate-400">{log.resource}</span>
                      <span className="text-emerald-400">{log.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === 'ai' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <h2 className="font-semibold text-base">AI Cluster Diagnostics & Root-Cause Analyzer</h2>
              <div className="bg-slate-950 border border-slate-800 rounded p-4 h-72 overflow-auto space-y-3 text-xs">
                {aiChat.map((m, i) => (
                  <div key={i} className={`p-3 rounded-lg whitespace-pre-wrap ${m.role === 'user' ? 'bg-indigo-600/20 border border-indigo-500/30 ml-12' : 'bg-slate-900 border border-slate-800 mr-12'}`}>
                    <div className="font-bold mb-1 uppercase text-[10px] text-slate-400">{m.role}</div>
                    {m.text}
                  </div>
                ))}
              </div>
              <form onSubmit={askAI} className="flex gap-2">
                <input
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Ask e.g. 'Why is payment-worker crashing?' or 'Analyze node cost efficiency'..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs"
                />
                <button className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded text-xs font-medium">Analyze Cluster</button>
              </form>
            </div>
          )}

          {section === 'yaml' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="font-semibold text-base">Dynamic YAML & Resource Editor</h2>
                <button onClick={applyYaml} className="bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 rounded text-xs font-medium">Apply Manifest</button>
              </div>
              <textarea value={yamlInput} onChange={(e) => setYamlInput(e.target.value)} rows={14} className="w-full bg-slate-950 border border-slate-800 rounded p-3 font-mono text-xs text-emerald-300" />
              {yamlStatus && <div className="text-xs font-mono text-indigo-300">{yamlStatus}</div>}
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
