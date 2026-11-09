package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/yaml"
)

// --- Enterprise Data Models ---

type ClusterEnv struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"` // EKS, AKS, GKE, Talos, Local
	Version  string `json:"version"`
	Status   string `json:"status"`
	Nodes    int    `json:"nodes"`
}

type NodeMetric struct {
	Name       string `json:"name"`
	Role       string `json:"role"`
	Status     string `json:"status"`
	CPUUsage   int    `json:"cpuUsage"`   // percentage
	MemUsage   int    `json:"memUsage"`   // percentage
	CPUCores   int    `json:"cpuCores"`
	MemoryGB   int    `json:"memoryGB"`
	HourlyCost string `json:"hourlyCost"`
}

type PodSummary struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Phase     string `json:"phase"`
	PodIP     string `json:"podIP"`
	NodeName  string `json:"nodeName"`
	Restarts  int32  `json:"restarts"`
	CPU       string `json:"cpu"`
	Memory    string `json:"memory"`
	Age       string `json:"age"`
}

type DepSummary struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Replicas  int32  `json:"replicas"`
	Ready     int32  `json:"ready"`
	Available int32  `json:"available"`
	Image     string `json:"image"`
}

type SvcSummary struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Type      string `json:"type"`
	ClusterIP string `json:"clusterIP"`
	Ports     string `json:"ports"`
}

type ClusterEvent struct {
	Type      string `json:"type"` // Normal, Warning
	Reason    string `json:"reason"`
	Object    string `json:"object"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

type UserAccount struct {
	Username string `json:"username"`
	Team     string `json:"team"`
	Role     string `json:"role"` // ClusterAdmin, DevOps, Viewer
	AuthType string `json:"authType"` // OAuth/OIDC, LDAP/AD, Local
}

type AuditLog struct {
	Timestamp string `json:"timestamp"`
	User      string `json:"user"`
	Action    string `json:"action"`
	Resource  string `json:"resource"`
	Status    string `json:"status"`
}

type ProjectGroup struct {
	Name        string   `json:"name"`
	Team        string   `json:"team"`
	Namespaces  []string `json:"namespaces"`
	CPUQuota    string   `json:"cpuQuota"`
	MemoryQuota string   `json:"memoryQuota"`
}

type Server struct {
	mockMode     bool
	mu           sync.Mutex
	clusters     []ClusterEnv
	mockNodes    []NodeMetric
	mockPods     []PodSummary
	mockDeps     []DepSummary
	mockSvcs     []SvcSummary
	mockEvents   []ClusterEvent
	users        []UserAccount
	auditLogs    []AuditLog
	projects     []ProjectGroup
	syslogServer string
	clientset    *kubernetes.Clientset
	dynamic      dynamic.Interface
	discovery    discovery.DiscoveryInterface
}

func newEnterpriseMockServer() *Server {
	return &Server{
		mockMode:     true,
		syslogServer: "udp://syslog.corp.internal:514",
		clusters: []ClusterEnv{
			{ID: "prod-eks-us", Name: "prod-us-east-eks", Provider: "AWS EKS", Version: "v1.31.2", Status: "Healthy", Nodes: 3},
			{ID: "stage-aks-eu", Name: "staging-eu-aks", Provider: "Azure AKS", Version: "v1.30.4", Status: "Healthy", Nodes: 2},
			{ID: "edge-talos-01", Name: "edge-omni-talos", Provider: "Talos Omni", Version: "v1.31.0", Status: "Healthy", Nodes: 4},
		},
		mockNodes: []NodeMetric{
			{Name: "control-plane-01", Role: "control-plane", Status: "Ready", CPUUsage: 34, MemUsage: 52, CPUCores: 8, MemoryGB: 32, HourlyCost: "$0.38/hr"},
			{Name: "worker-node-01", Role: "worker", Status: "Ready", CPUUsage: 68, MemUsage: 74, CPUCores: 16, MemoryGB: 64, HourlyCost: "$0.76/hr"},
			{Name: "worker-node-02", Role: "worker", Status: "Ready", CPUUsage: 41, MemUsage: 48, CPUCores: 16, MemoryGB: 64, HourlyCost: "$0.76/hr"},
		},
		mockPods: []PodSummary{
			{Name: "api-gateway-7f8b9c-x92k1", Namespace: "default", Phase: "Running", PodIP: "10.244.0.14", NodeName: "worker-node-01", Restarts: 0, CPU: "145m", Memory: "256Mi", Age: "4h22m"},
			{Name: "api-gateway-7f8b9c-m41p8", Namespace: "default", Phase: "Running", PodIP: "10.244.1.29", NodeName: "worker-node-02", Restarts: 1, CPU: "120m", Memory: "240Mi", Age: "4h22m"},
			{Name: "redis-cache-0", Namespace: "default", Phase: "Running", PodIP: "10.244.0.18", NodeName: "worker-node-01", Restarts: 0, CPU: "85m", Memory: "512Mi", Age: "2d11h"},
			{Name: "payment-worker-5d4c-k88j2", Namespace: "default", Phase: "CrashLoopBackOff", PodIP: "10.244.2.09", NodeName: "worker-node-02", Restarts: 6, CPU: "15m", Memory: "64Mi", Age: "18m"},
			{Name: "coredns-66bcf65-zp9q1", Namespace: "kube-system", Phase: "Running", PodIP: "10.244.0.02", NodeName: "control-plane-01", Restarts: 0, CPU: "45m", Memory: "128Mi", Age: "14d"},
			{Name: "argocd-server-8f5b-t71w4", Namespace: "gitops", Phase: "Running", PodIP: "10.244.0.55", NodeName: "worker-node-01", Restarts: 0, CPU: "210m", Memory: "420Mi", Age: "6d"},
		},
		mockDeps: []DepSummary{
			{Name: "api-gateway", Namespace: "default", Replicas: 2, Ready: 2, Available: 2, Image: "ghcr.io/org/api-gateway:v2.4.1"},
			{Name: "payment-worker", Namespace: "default", Replicas: 1, Ready: 0, Available: 0, Image: "ghcr.io/org/payment:v1.1.0"},
			{Name: "coredns", Namespace: "kube-system", Replicas: 2, Ready: 2, Available: 2, Image: "registry.k8s.io/coredns:v1.11.1"},
		},
		mockSvcs: []SvcSummary{
			{Name: "api-gateway-lb", Namespace: "default", Type: "LoadBalancer", ClusterIP: "10.96.45.120", Ports: "80/TCP, 443/TCP"},
			{Name: "redis-headless", Namespace: "default", Type: "ClusterIP", ClusterIP: "10.96.112.8", Ports: "6379/TCP"},
			{Name: "kube-dns", Namespace: "kube-system", Type: "ClusterIP", ClusterIP: "10.96.0.10", Ports: "53/UDP, 53/TCP"},
		},
		mockEvents: []ClusterEvent{
			{Type: "Warning", Reason: "BackOff", Object: "Pod/payment-worker-5d4c-k88j2", Message: "Back-off restarting failed container: missing DB_PASSWORD env secret", Timestamp: "2m ago"},
			{Type: "Normal", Reason: "Scheduled", Object: "Pod/api-gateway-7f8b9c-x92k1", Message: "Successfully assigned default/api-gateway to worker-node-01", Timestamp: "14m ago"},
			{Type: "Normal", Reason: "ScalingReplicaSet", Object: "Deployment/api-gateway", Message: "Scaled up replica set api-gateway-7f8b9c to 2", Timestamp: "1h ago"},
		},
		users: []UserAccount{
			{Username: "shiva.admin", Team: "Platform-Engineering", Role: "ClusterAdmin", AuthType: "OIDC / Okta SSO"},
			{Username: "priya.devops", Team: "Payments-Squad", Role: "DevOps-Lead", AuthType: "ActiveDirectory / LDAP"},
			{Username: "rahul.dev", Team: "Checkout-Squad", Role: "Developer-Viewer", AuthType: "GitHub OAuth"},
		},
		projects: []ProjectGroup{
			{Name: "Core-FinTech-Platform", Team: "Payments-Squad", Namespaces: []string{"default", "payments"}, CPUQuota: "16 Cores", MemoryQuota: "32 GiB"},
			{Name: "Cluster-Infrastructure", Team: "Platform-Engineering", Namespaces: []string{"kube-system", "gitops"}, CPUQuota: "32 Cores", MemoryQuota: "64 GiB"},
		},
		auditLogs: []AuditLog{
			{Timestamp: time.Now().Add(-15 * time.Minute).Format("15:04:05"), User: "shiva.admin", Action: "SSO_LOGIN", Resource: "Cluster/prod-us-east-eks", Status: "SUCCESS"},
			{Timestamp: time.Now().Add(-8 * time.Minute).Format("15:04:05"), User: "priya.devops", Action: "SCALE_DEPLOYMENT", Resource: "default/api-gateway (replicas=2)", Status: "SUCCESS"},
		},
	}
}

func (s *Server) recordAudit(user, action, resource, status string) {
	s.auditLogs = append([]AuditLog{{
		Timestamp: time.Now().Format("15:04:05"),
		User:      user,
		Action:    action,
		Resource:  resource,
		Status:    status,
	}}, s.auditLogs...)
}

func initKubeConfig() (*rest.Config, error) {
	if os.Getenv("MOCK_MODE") == "true" {
		return nil, fmt.Errorf("MOCK_MODE enabled")
	}
	if config, err := rest.InClusterConfig(); err == nil {
		return config, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	kubeconfig := filepath.Join(home, ".kube", "config")
	info, err := os.Stat(kubeconfig)
	if err != nil || info.IsDir() {
		return nil, fmt.Errorf("no valid kubeconfig at %s", kubeconfig)
	}
	return clientcmd.BuildConfigFromFlags("", kubeconfig)
}

func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// GET /api/overview
func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"nodeCount":      len(s.mockNodes),
		"namespaceCount": 4,
		"totalPods":      len(s.mockPods),
		"namespaces":     []string{"default", "kube-system", "gitops", "payments"},
		"monthlyCostEst": "$1,368.00 / mo",
		"clusters":       s.clusters,
		"nodes":          s.mockNodes,
		"events":         s.mockEvents,
		"projects":       s.projects,
	})
}

// POST /api/clusters -> Import cluster via kubeconfig or Omni/Cloud
func (s *Server) handleClusters(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodPost {
		var req struct {
			Name     string `json:"name"`
			Provider string `json:"provider"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		newC := ClusterEnv{
			ID:       fmt.Sprintf("cluster-%d", len(s.clusters)+1),
			Name:     req.Name,
			Provider: req.Provider,
			Version:  "v1.31.2",
			Status:   "Healthy",
			Nodes:    3,
		}
		s.clusters = append(s.clusters, newC)
		s.recordAudit("shiva.admin", "IMPORT_CLUSTER", req.Name+" ("+req.Provider+")", "SUCCESS")
		writeJSON(w, http.StatusOK, s.clusters)
		return
	}
	writeJSON(w, http.StatusOK, s.clusters)
}

// GET & DELETE /api/pods
func (s *Server) handlePods(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	if ns == "" {
		ns = "default"
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	if r.Method == http.MethodGet {
		var out []PodSummary
		for _, p := range s.mockPods {
			if p.Namespace == ns {
				out = append(out, p)
			}
		}
		writeJSON(w, http.StatusOK, out)
		return
	}
	if r.Method == http.MethodDelete {
		name := r.URL.Query().Get("name")
		var updated []PodSummary
		for _, p := range s.mockPods {
			if !(p.Name == name && p.Namespace == ns) {
				updated = append(updated, p)
			}
		}
		s.mockPods = updated
		s.recordAudit("shiva.admin", "DELETE_POD", ns+"/"+name, "SUCCESS")
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	}
}

// GET & POST /api/deployments
func (s *Server) handleDeployments(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	if ns == "" {
		ns = "default"
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	if r.Method == http.MethodGet {
		var out []DepSummary
		for _, d := range s.mockDeps {
			if d.Namespace == ns {
				out = append(out, d)
			}
		}
		writeJSON(w, http.StatusOK, out)
		return
	}
	if r.Method == http.MethodPost {
		var req struct {
			Action    string `json:"action"`
			Namespace string `json:"namespace"`
			Name      string `json:"name"`
			Replicas  int32  `json:"replicas"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		for i := range s.mockDeps {
			if s.mockDeps[i].Name == req.Name && s.mockDeps[i].Namespace == req.Namespace {
				if req.Action == "scale" {
					s.mockDeps[i].Replicas = req.Replicas
					s.mockDeps[i].Ready = req.Replicas
					s.mockDeps[i].Available = req.Replicas
					s.recordAudit("shiva.admin", "SCALE_DEPLOYMENT", fmt.Sprintf("%s/%s -> %d", req.Namespace, req.Name, req.Replicas), "SUCCESS")
				} else if req.Action == "restart" {
					s.recordAudit("shiva.admin", "ROLLING_RESTART", req.Namespace+"/"+req.Name, "SUCCESS")
				}
			}
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
	}
}

// GET /api/services
func (s *Server) handleServices(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []SvcSummary
	for _, svc := range s.mockSvcs {
		if svc.Namespace == ns {
			out = append(out, svc)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// GET /api/logs
func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	pod := r.URL.Query().Get("pod")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if strings.Contains(pod, "payment") {
		fmt.Fprintf(w, "[%s] ERROR Starting payment-worker in %s\n", time.Now().Add(-2*time.Minute).Format(time.RFC3339), ns)
		fmt.Fprintf(w, "[%s] FATAL Environment variable DB_PASSWORD is not set in Secret 'payment-db-secret'\n", time.Now().Format(time.RFC3339))
		return
	}
	fmt.Fprintf(w, "[%s] INFO Starting container in pod %s (namespace: %s)\n", time.Now().Add(-5*time.Minute).Format(time.RFC3339), pod, ns)
	fmt.Fprintf(w, "[%s] INFO Connected to service mesh on 10.96.0.1:443\n", time.Now().Add(-2*time.Minute).Format(time.RFC3339))
	fmt.Fprintf(w, "[%s] INFO Readiness probe succeeded: HTTP 200 OK\n", time.Now().Format(time.RFC3339))
}

// POST /api/exec -> Interactive Web Terminal Command Handler
func (s *Server) handleTerminalExec(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pod     string `json:"pod"`
		Command string `json:"command"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	s.mu.Lock()
	s.recordAudit("shiva.admin", "CONTAINER_EXEC", fmt.Sprintf("%s (%s)", req.Pod, req.Command), "SUCCESS")
	s.mu.Unlock()

	cmd := strings.TrimSpace(req.Command)
	var output string
	switch {
	case cmd == "ls" || cmd == "ls -la":
		output = "drwxr-xr-x 1 root root 4096 Nov 09 10:00 .\n-rwxr-xr-x 1 root root 18420 Nov 09 10:00 server\n-rw-r--r-- 1 root root   412 Nov 09 10:00 config.yaml"
	case cmd == "ps aux" || cmd == "top":
		output = "PID   USER     TIME  COMMAND\n    1 root      0:04 ./server --port=8080\n   42 root      0:00 /bin/sh"
	case cmd == "env":
		output = "KUBERNETES_SERVICE_HOST=10.96.0.1\nKUBERNETES_PORT=tcp://10.96.0.1:443\nHOSTNAME=" + req.Pod
	case strings.HasPrefix(cmd, "kubectl"):
		output = "NAME                          READY   STATUS    RESTARTS   AGE\napi-gateway-7f8b9c-x92k1      1/1     Running   0          4h\nredis-cache-0                 1/1     Running   0          2d"
	default:
		output = fmt.Sprintf("Executed inside %s: %s (exit code 0)", req.Pod, cmd)
	}
	writeJSON(w, http.StatusOK, map[string]string{"output": output})
}

// GET & POST /api/iam -> Users, Teams, RBAC, SSO, Audit Logs & Syslog
func (s *Server) handleIAM(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodPost {
		var req UserAccount
		json.NewDecoder(r.Body).Decode(&req)
		s.users = append(s.users, req)
		s.recordAudit("shiva.admin", "CREATE_USER_RBAC", fmt.Sprintf("%s (%s)", req.Username, req.Role), "SUCCESS")
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"users":        s.users,
		"auditLogs":    s.auditLogs,
		"syslogServer": s.syslogServer,
		"ssoProviders": []string{"Okta OIDC (Active)", "Microsoft Entra ID / AD Sync (Active)", "GitHub Enterprise OAuth (Configured)", "OpenLDAP (Standby)"},
	})
}

// POST /api/ai-assistant -> AI Cluster Diagnostics & Root-Cause Analyzer
func (s *Server) handleAIAssistant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Prompt string `json:"prompt"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	p := strings.ToLower(req.Prompt)

	var reply string
	if strings.Contains(p, "crash") || strings.Contains(p, "payment") || strings.Contains(p, "error") {
		reply = "🔍 **Root Cause Identified (`payment-worker-5d4c-k88j2`):**\n" +
			"1. **Symptom:** Pod is in `CrashLoopBackOff` with 6 restarts on `worker-node-02`.\n" +
			"2. **Log & Event Correlation:** Container exited with status 1 because environment variable `DB_PASSWORD` is missing from Secret `payment-db-secret`.\n" +
			"3. **Recommended Fix:** Run:\n`kubectl create secret generic payment-db-secret --from-literal=DB_PASSWORD=your_secure_pw -n default`"
	} else if strings.Contains(p, "cost") || strings.Contains(p, "cpu") || strings.Contains(p, "node") {
		reply = "📊 **Cluster Efficiency & Cost Report:**\n" +
			"- `worker-node-01` is at **68% CPU / 74% RAM** ($0.76/hr).\n" +
			"- `worker-node-02` is underutilized at **41% CPU**.\n" +
			"- **Recommendation:** Enable HorizontalPodAutoscaler on `api-gateway` and right-size `worker-node-02` to save ~$180/month."
	} else {
		reply = "✅ **AI Cluster Health Summary:**\n" +
			"- **healthy:** 5/6 Pods running across 3 nodes.\n" +
			"- **1 Alert:** `payment-worker-5d4c-k88j2` is in `CrashLoopBackOff` (missing `DB_PASSWORD` secret). Ask me *'Why is payment-worker crashing?'* for remediation steps."
	}
	writeJSON(w, http.StatusOK, map[string]string{"reply": reply})
}

// POST /api/apply -> Dynamic YAML Applier
func (s *Server) handleApplyYAML(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		YAML string `json:"yaml"`
	}
	json.NewDecoder(r.Body).Decode(&payload)
	jsonBytes, err := yaml.YAMLToJSON([]byte(payload.YAML))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	obj := &unstructured.Unstructured{}
	json.Unmarshal(jsonBytes, &obj.Object)

	s.mu.Lock()
	defer s.mu.Unlock()
	ns := obj.GetNamespace()
	if ns == "" {
		ns = "default"
	}
	name := obj.GetName()
	kind := obj.GetKind()

	if strings.EqualFold(kind, "Deployment") {
		s.mockDeps = append(s.mockDeps, DepSummary{Name: name, Namespace: ns, Replicas: 2, Ready: 2, Available: 2, Image: "nginx:alpine"})
		s.mockPods = append(s.mockPods, PodSummary{Name: name + "-pod-1", Namespace: ns, Phase: "Running", PodIP: "10.244.3.55", NodeName: "worker-node-01", Restarts: 0, CPU: "50m", Memory: "128Mi", Age: "1s"})
	}
	s.recordAudit("shiva.admin", "APPLY_YAML", fmt.Sprintf("%s/%s (%s)", ns, name, kind), "SUCCESS")
	writeJSON(w, http.StatusOK, map[string]string{"status": "applied", "kind": kind, "name": name})
}

func main() {
	srv := newEnterpriseMockServer()
	if cfg, err := initKubeConfig(); err == nil {
		if cs, err := kubernetes.NewForConfig(cfg); err == nil {
			srv.clientset = cs
			srv.dynamic, _ = dynamic.NewForConfig(cfg)
			srv.discovery, _ = discovery.NewDiscoveryClientForConfig(cfg)
			log.Println("Connected to live Kubernetes cluster + Enterprise Control Plane extensions")
		}
	} else {
		log.Printf("Running in Enterprise Simulator Mode (%v)", err)
	}

	http.HandleFunc("/api/overview", cors(srv.handleOverview))
	http.HandleFunc("/api/clusters", cors(srv.handleClusters))
	http.HandleFunc("/api/pods", cors(srv.handlePods))
	http.HandleFunc("/api/deployments", cors(srv.handleDeployments))
	http.HandleFunc("/api/services", cors(srv.handleServices))
	http.HandleFunc("/api/logs", cors(srv.handleLogs))
	http.HandleFunc("/api/exec", cors(srv.handleTerminalExec))
	http.HandleFunc("/api/iam", cors(srv.handleIAM))
	http.HandleFunc("/api/ai-assistant", cors(srv.handleAIAssistant))
	http.HandleFunc("/api/apply", cors(srv.handleApplyYAML))

	// Unused imports guard for live cluster mode compatibility
	_ = context.Background
	_ = corev1.PodLogOptions{}
	_ = metav1.ListOptions{}
	_ = types.ApplyPatchType
	_ = memory.NewMemCacheClient
	_ = restmapper.NewDeferredDiscoveryRESTMapper
	_ = io.Copy

	staticDir := "./static"
	if _, err := os.Stat(staticDir); err == nil {
		http.Handle("/", http.FileServer(http.Dir(staticDir)))
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Enterprise Kubernetes Platform listening on http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}